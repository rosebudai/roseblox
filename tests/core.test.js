import test from "node:test";
import assert from "node:assert/strict";
import { GameSystems } from "../src/gameSystems.js";
import { setupPhysics } from "../src/resources/physics/physicsSetup.js";
import { stepPhysics } from "../src/systems/stepPhysicsSystem.js";

const create = (options = {}) => new GameSystems({ coreSystems: false, ...options });
const manual = { autoStart: false };

test("instances isolate worlds, resources and events", async () => {
  const first = create();
  const second = create();
  const heard = [];
  first.on("score", (score) => heard.push(score));
  first.world.add({ name: "first" });
  first.registerResource("score", () => 0);
  await first.init(manual);
  await second.init(manual);
  assert.equal(first.getResource("score"), 0);
  assert.throws(() => second.getResource("score"), /not available/);
  assert.equal([...second.world].length, 0);
  second.emit("score", 2);
  first.emit("score", 1);
  assert.deepEqual(heard, [1]);
  first.dispose();
  assert.equal(second.isInitialized(), true);
  second.dispose();
});

test("setup and resource dependencies resolve regardless of registration order", async () => {
  const game = create();
  const order = [];
  game.registerResource("derived", (_, { terrain }) => terrain.height * 2, { dependencies: ["terrain"] });
  game.registerSetup("player", {
    dependencies: ["derived", "camera"],
    init: (_, { derived, camera }) => order.push(`player:${derived}:${camera.fov}`),
  });
  // Legacy setups need not declare provides if they call addResource.
  game.registerSetup("terrain", { init: (_, __, ___, engine) => { order.push("terrain"); engine.addResource("terrain", { height: 4 }); } });
  game.registerSetup("camera", { provides: ["camera"], init: (_, __, ___, engine) => engine.addResource("camera", { fov: 70 }) });
  await game.init(manual);
  assert.deepEqual(order, ["terrain", "player:8:70"]);
  game.dispose();
});

test("missing and circular dependencies fail with names and release initialized resources", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const cycle of [false, true]) {
    const game = create();
    let released = 0;
    game.registerResource("owned", () => ({ dispose() { released++; } }));
    game.registerSetup("spawn", { dependencies: ["terrain"], provides: ["player"], init() {} });
    if (cycle) game.registerSetup("land", { dependencies: ["player"], provides: ["terrain"], init() {} });
    await assert.rejects(game.init(manual), /spawn.*terrain/);
    assert.equal(released, 1);
    assert.equal(game.disposed, true);
    assert.equal(game.getDiagnostics().errorCount, 1);
    game.dispose();
    assert.equal(released, 1);
  }
});

test("declared outputs and runtime dependencies are checked before starting", async (t) => {
  t.mock.method(console, "error", () => {});
  const game = create();
  game.registerSetup("level", { provides: ["terrain"], init() {} });
  await assert.rejects(game.init(manual), /level.*terrain.*not provided/);
  const runtime = create();
  runtime.registerSystem("score", { dependencies: ["missing"], update() {} });
  await assert.rejects(runtime.init(manual), /score.*missing/);
});

test("disposal during async resource initialization releases late resources", async (t) => {
  t.mock.method(console, "error", () => {});
  const game = create();
  let resolveResource;
  let released = 0;
  game.registerResource("slow", () => new Promise((resolve) => { resolveResource = resolve; }));
  const initializing = game.init(manual);
  game.dispose();
  resolveResource({ dispose() { released++; } });
  await assert.rejects(initializing, /disposed during initialization/);
  assert.equal(released, 1);
  assert.equal(game.getDiagnostics().disposed, true);
});

test("start is idempotent, stop cancels RAF, resume excludes paused time", async () => {
  const pending = new Map();
  let sequence = 0;
  const game = create({
    requestAnimationFrame(callback) { const id = ++sequence; pending.set(id, callback); return id; },
    cancelAnimationFrame(id) { pending.delete(id); },
  });
  await game.init(manual);
  const tick = (timestamp) => {
    const [id, callback] = pending.entries().next().value;
    pending.delete(id);
    callback(timestamp);
  };
  game.start().start();
  assert.equal(pending.size, 1);
  tick(0);
  tick(1000 / 60);
  assert.equal(game.getDiagnostics().fixedSteps, 1);
  game.stop();
  assert.equal(pending.size, 0);
  game.start();
  tick(10000);
  tick(10000 + 1000 / 60);
  assert.equal(game.getDiagnostics().fixedSteps, 2);
  game.dispose();
  assert.equal(pending.size, 0);
  assert.throws(() => game.start(), /live engine/);
});

test("real physics and gameplay cover the same elapsed time at 30, 60 and 144 Hz", async () => {
  const results = [];
  for (const rate of [30, 60, 144]) {
    const game = create();
    game.registerResource("physics", setupPhysics);
    let body;
    const order = [];
    game.registerSetup("body", { dependencies: ["physics"], init(_, { physics }) { body = physics.world.createRigidBody(physics.RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 20, 0)); physics.world.createCollider(physics.RAPIER.ColliderDesc.ball(0.5), body); } });
    game.registerSystem("move", { priority: 30, update(_, __, dt) { body.setLinvel({ x: 2, y: body.linvel().y, z: 0 }, true); order.push(["move", dt]); } });
    game.registerSystem("physics", { priority: 40, dependencies: ["physics"], update(_, { physics }, dt) { stepPhysics(physics.world, physics.eventQueue, dt); order.push(["physics", dt]); } });
    let presentations = 0;
    game.registerSystem("presentation", { phase: "frame", update() { presentations++; } });
    await game.init(manual);
    for (let frame = 0; frame < rate; frame++) game.update(1 / rate);
    assert.equal(game.getDiagnostics().fixedSteps, 60);
    assert.equal(presentations, rate);
    assert.equal(order.length, 120);
    for (let index = 0; index < order.length; index += 2) assert.deepEqual(order.slice(index, index + 2), [["move", 1 / 60], ["physics", 1 / 60]]);
    results.push(body.translation());
    game.dispose();
  }
  for (const result of results) {
    assert.ok(Math.abs(result.x - 2) < 1e-5);
    assert.ok(result.y < 16 && result.y > 14);
    assert.deepEqual(result, results[0]);
  }
});

test("stalled frames cap simulation work and expose discarded time", async () => {
  const game = create();
  await game.init({ ...manual, maxSubSteps: 3 });
  game.update(10);
  const diagnostics = game.getDiagnostics();
  assert.equal(diagnostics.fixedSteps, 3);
  assert.ok(Math.abs(diagnostics.simulatedSeconds + diagnostics.droppedSeconds - 10) < 1e-8);
  assert.throws(() => game.update(NaN), /finite/);
  game.dispose();
});

test("runtime failures stop once and include system/phase diagnostics", async (t) => {
  t.mock.method(console, "error", () => {});
  const game = create();
  const errors = [];
  game.registerSystem("shoot", { update() { throw new Error("projectile missing"); } });
  await game.init({ ...manual, onError: (error) => errors.push(error) });
  assert.throws(() => game.update(1 / 60), /shoot.*projectile missing/);
  assert.equal(errors[0].phase, "fixed");
  assert.equal(errors[0].system, "shoot");
  assert.equal(game.running, false);
  game.dispose();
  assert.equal(game.getDiagnostics().errorCount, 1);
});

test("continue mode disables a broken system and preserves other gameplay", async (t) => {
  t.mock.method(console, "error", () => {});
  const game = create();
  let count = 0;
  game.registerSystem("broken", { update() { throw new Error("broken"); } });
  game.registerSystem("working", { update() { count++; } });
  await game.init({ ...manual, errorMode: "continue" });
  game.update(1 / 30);
  assert.equal(count, 2);
  assert.equal(game.getDiagnostics().errorCount, 1);
  game.dispose();
});
