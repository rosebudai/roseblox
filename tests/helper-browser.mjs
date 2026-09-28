import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.argv[2] ?? "http://127.0.0.1:8893";
const output = process.argv[3] ?? "/tmp/roseblox-helper-evidence";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/local/bin/chromium", headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
try {
  await page.goto(`${base}/examples/modern/`);
  await page.waitForFunction(() => window.exampleGame?.game.getDiagnostics().frames > 1, { timeout: 60000 });
  const results = await page.evaluate(async () => {
    const { createGame } = await import("/build/roseblox.js");
    window.exampleGame.game.dispose();
    const canvas = document.querySelector("canvas");
    const game = await createGame({ canvas, autoStart: false });
    const checks = [];
    const check = async (name, callback) => {
      try { const detail = await callback(); checks.push({ name, status: "pass", detail }); }
      catch (error) { checks.push({ name, status: "fail", error: error.message }); }
    };
    const expect = (condition, message) => { if (!condition) throw new Error(message); };
    const advance = (seconds) => { for (let i = 0; i < seconds * 60; i++) game.engine.update(1 / 60); };
    const clear = () => { game.input.reset(); for (const entity of [...game.world]) game.remove(entity); };

    await check("raycasts use new, teleported and rotated scene state before rendering", () => {
      const target = game.addBox({ position: [5, 0, -10], body: "none" });
      game.controls.setLookAt(5, 0, 0, 5, 0, -10, false);
      game.controls.update(0);
      expect(game.raycast()?.entity === target, "Freshly added mesh was not hit before its first render");
      game.teleport(target, [7, 0, -10]);
      expect(game.raycast({ entities: [target] }) === null, "Raycast used stale pre-teleport matrix");
      game.camera.position.set(7, 0, 0);
      game.camera.lookAt(7, 0, -10);
      expect(game.raycast()?.entity === target, "Raycast used stale camera matrix");
      clear();
    });
    clear();
    await check("onFrame runs after camera controls and once per visual frame", () => {
      expect(typeof game.onFrame === "function", "No post-camera presentation hook is available");
      let frames = 0;
      let steps = 0;
      game.controls.enabled = false;
      const stopFrame = game.onFrame(() => {
        frames++;
        game.camera.position.set(3, 2, 5);
        game.camera.lookAt(3, 2, -10);
      });
      const stopUpdate = game.onUpdate(() => steps++);
      for (let index = 0; index < 144; index++) game.engine.update(1 / 144);
      expect(frames === 144 && steps === 60, `Expected 144 visual frames/60 simulation steps, got ${frames}/${steps}`);
      expect(game.camera.position.distanceTo({ x: 3, y: 2, z: 5 }) < 1e-6, "Built-in controls overwrote custom FPS camera");
      stopFrame(); stopUpdate(); game.releaseCamera();
    });
    await check("helper bodies emit real physics collision events", () => {
      const ground = game.addBox({ size: [20, 1, 20], position: [0, -0.5, 0] });
      const ball = game.addSphere({ body: "dynamic", position: [0, 3, 0] });
      let collisions = 0;
      const off = game.engine.on("collision-started", ({ entityA, entityB }) => {
        if ((entityA === ball && entityB === ground) || (entityB === ball && entityA === ground)) collisions++;
      });
      advance(2);
      expect(Math.abs(ball.transform.position.y - 0.5) < 0.1, "Dynamic sphere did not settle on floor");
      expect(collisions > 0, "Helper colliders did not emit collision-started with entity references");
      off(); clear();
    });
    clear();
    await check("players pass sensors, stop at solid walls and resume when walls are removed", () => {
      game.addBox({ size: [30, 1, 30], position: [0, -0.5, 0] });
      const sensor = game.addBox({ size: [8, 4, 1], position: [0, 2, 2], sensor: true });
      const wall = game.addBox({ size: [8, 4, 1], position: [0, 2, -2] });
      const player = game.addPlayer({ position: [0, 1.1, 4], cameraRelative: false });
      let sensorEntries = 0;
      const offSensor = game.engine.on("collision-started", ({ entityA, entityB }) => {
        if ((entityA === sensor && entityB === player) || (entityA === player && entityB === sensor)) sensorEntries++;
      });
      advance(0.5);
      game.input.setAction("forward", true);
      advance(1.5);
      const blockedZ = player.transform.position.z;
      expect(blockedZ < 0 && blockedZ > -1.25, `Player sensor/solid collision incorrect; z=${blockedZ}`);
      expect(sensorEntries > 0, "Player did not produce a real sensor overlap event");
      offSensor();
      game.remove(wall);
      advance(0.5);
      expect(player.transform.position.z < -2, `Player did not resume after wall removal: blocked=${blockedZ}, final=${player.transform.position.toArray()}, input=${JSON.stringify(game.input.getMovementVector())}, bodies=${game.physics.world.bodies.len()}`);
      clear();
      return { blockedZ };
    });
    clear();
    await check("players climb low steps and remain above the floor", () => {
      game.addBox({ size: [30, 1, 30], position: [0, -0.5, 0] });
      game.addBox({ size: [3, 0.2, 2], position: [0, 0.1, -2] });
      const player = game.addPlayer({ position: [0, 1.1, 2], cameraRelative: false });
      advance(0.5);
      game.input.setAction("forward", true);
      let maxHeight = player.transform.position.y;
      let minHeight = player.transform.position.y;
      for (let frame = 0; frame < 90; frame++) {
        game.engine.update(1 / 60);
        maxHeight = Math.max(maxHeight, player.transform.position.y);
        minHeight = Math.min(minHeight, player.transform.position.y);
      }
      expect(maxHeight > 1.15, `Player did not climb 0.2m step: ${maxHeight}`);
      expect(minHeight > 0.95, `Player penetrated the floor: ${minHeight}`);
      expect(player.transform.position.z < -3.5, "Player failed to cross low step");
      clear();
      return { maxHeight, minHeight };
    });
    clear();
    await check("removing the followed entity releases orbit controls", () => {
      const target = game.addBox({ body: "none" });
      const previousEnabled = game.controls.enabled;
      game.followCamera(target);
      expect(game.controls.enabled === true, "Follow camera did not enable orbit input");
      game.remove(target);
      expect(game.controls.enabled === previousEnabled, "Removing follow target did not restore controls");
    });
    await check("failed collider creation does not leave orphan bodies or entities", () => {
      const beforeBodies = game.physics.world.bodies.len();
      const beforeEntities = game.getDiagnostics().entities;
      const createCollider = game.physics.world.createCollider;
      game.physics.world.createCollider = () => { throw new Error("intentional collider failure"); };
      try {
        let threw = false;
        try { game.addBox({ body: "dynamic" }); } catch (error) { threw = /intentional collider failure/.test(error.message); }
        expect(threw, "Failure injection did not execute");
        expect(game.physics.world.bodies.len() === beforeBodies, "Failed shape creation leaked a Rapier body");
        expect(game.getDiagnostics().entities === beforeEntities, "Failed shape creation leaked an ECS entity");
      } finally { game.physics.world.createCollider = createCollider; }
    });
    game.dispose();
    await check("disposed helper APIs reject new work", () => {
      for (const [name, action] of [
        ["onUpdate", () => game.onUpdate(() => {})],
        ["onFrame", () => game.onFrame(() => {})],
        ["raycast", () => game.raycast()],
      ]) {
        let rejected = false;
        try { action(); } catch (error) { rejected = /disposed/.test(error.message); }
        expect(rejected, `${name} did not reject operations on a disposed game`);
      }
    });
    return checks;
  });
  const report = { status: results.every(result => result.status === "pass") && errors.length === 0 ? "pass" : "fail", results, errors };
  await writeFile(`${output}/result.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.status, "pass");
} finally { await browser.close(); }
