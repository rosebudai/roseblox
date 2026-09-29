import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createWorld, fitModel } from "../src/controls.js";
import { setupInput } from "../src/resources/inputSetup.js";

function surface(native) {
  const doc = new EventTarget(), win = new EventTarget();
  doc.defaultView = win; doc.hidden = false;
  class Canvas extends EventTarget {
    style = { cursor: "crosshair" }; dataset = {}; ownerDocument = doc; tabIndex = -1;
    getAttribute() { return null; } setAttribute() {} removeAttribute() {}
    focus() { doc.activeElement = this; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
  }
  const canvas = new Canvas();
  let requests = 0;
  doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.dispatchEvent(new Event("pointerlockchange")); };
  if (native) canvas.requestPointerLock = () => { requests++; doc.pointerLockElement = canvas; doc.dispatchEvent(new Event("pointerlockchange")); };
  return { canvas, camera: new THREE.PerspectiveCamera(60, 16 / 9, .1, 100), doc, win, requests: () => requests };
}
const hero = () => new THREE.Mesh(new THREE.BoxGeometry(.6, 1.8, .4));
function advance(world, seconds) { for (let i = 0; i < Math.round(seconds * 60); i++) world.advance(1 / 60); }
async function fixture(t) {
  const world = await createWorld({ interpolate: false }); t.after(() => world.dispose());
  world.addBody({ shape: { type: "box", size: [100, 1, 100] }, position: [0, -.5, 0] });
  return world;
}

test("analog axis adds to keyboard movement, is clamped to unit length and clears on reset", async () => {
  const win = new EventTarget(), doc = new EventTarget();
  const input = await setupInput({ inputWindow: win, inputDocument: doc, inputTarget: win });
  input.setAxis(.3, -.4);
  assert.deepEqual(input.getMovementVector(), { x: .3, z: -.4 });
  input.setAxis(3, 4);
  const v = input.getMovementVector();
  assert.ok(Math.abs(v.x - .6) < 1e-9 && Math.abs(v.z - .8) < 1e-9);
  assert.throws(() => input.setAxis(NaN, 0));
  input.reset();
  assert.deepEqual(input.getMovementVector(), { x: 0, z: 0 });
});

test("createWorld players default to captured-mouse controls and movement facing; touch is off without a coarse pointer", async t => {
  const world = await fixture(t), browser = surface(true);
  const player = await world.addPlayer({ ...browser, model: hero(), feet: [0, 0, 0] });
  assert.equal(player.touch, false);
  player.start();
  assert.equal(browser.requests(), 1, "pointer control mode captures the mouse");
  assert.equal(player.active, true);
  advance(world, .5);
  const start = player.position.clone();
  player.setAxis(.5, 0);
  advance(world, 1);
  const moved = player.position.clone().sub(start);
  assert.ok(moved.x > 1.5 && moved.x < 3.5, `half stick walks at about half speed (${moved.x})`);
  assert.ok(Math.abs(player.forward.x - 1) < .05, "the hero turns toward its movement");
  assert.ok(fitModel);
});

for (const view of ["third", "first"]) test(`a ${view}-person player or NPC without a model stands in as a capsule`, async t => {
  const world = await fixture(t), browser = surface(true);
  const player = await world.addPlayer({ ...browser, model: undefined, feet: [0, 0, 0], height: 1.7, view });
  const npc = world.addNpc({ feet: [3, 0, 0] });
  for (const actor of [player, npc]) {
    const size = new THREE.Box3().setFromObject(actor.visual).getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.y - (actor === player ? 1.7 : 1.8)) < .01, `fitted to its height (${size.y})`);
  }
  player.start(); player.setAxis(1, 0); advance(world, .5);
  assert.ok(player.position.x > .5, "the stand-in player moves");
  player.remove(); npc.remove();
});

for (const view of ["third", "first"]) test(`${view}-person look() turns the view only while playing`, async t => {
  const world = await fixture(t), browser = surface(true);
  const player = await world.addPlayer({ ...browser, model: hero(), view });
  const dir = () => browser.camera.getWorldDirection(new THREE.Vector3());
  player.start(); advance(world, .2);
  const before = dir();
  player.look(200, 0); advance(world, .1);
  assert.ok(before.angleTo(dir()) > .3, "look turns the camera");
  player.stop();
  const stopped = dir();
  player.look(200, 0);
  assert.ok(stopped.angleTo(dir()) < 1e-6, "look is ignored when not playing");
});

// The overlay's gestures are covered by scripts/check-controls.mjs in a touch browser.
test("a player created for touch play enters without pointer lock", async t => {
  const world = await fixture(t), browser = surface(true);
  const appended = [];
  const node = () => ({ style: {}, dataset: {}, append(...c) { appended.push(...c); }, addEventListener() {}, remove() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) });
  browser.doc.createElement = node; browser.doc.body = node();
  const player = await world.addPlayer({ ...browser, model: hero(), touch: true });
  assert.equal(player.touch, true);
  player.start();
  assert.equal(browser.requests(), 0);
  assert.equal(player.active, true);
  advance(world, .1);
  player.remove();
});

async function playing(t, config = {}) {
  const world = await fixture(t), browser = surface(true);
  const player = await world.addPlayer({ ...browser, model: hero(), feet: [0, 0, 0], ...config });
  player.start(); advance(world, .5);
  return { world, player };
}
function peak(world, player, seconds, afterStep) {
  let top = -Infinity;
  for (let i = 0; i < Math.round(seconds * 60); i++) world.advance(1 / 60, { afterStep: dt => { afterStep?.(dt); top = Math.max(top, player.position.y); } });
  return top;
}

test("the default jump peaks near jumpSpeed squared over 40, about one metre", async t => {
  const { world, player } = await playing(t);
  player.setAction("jump", true);
  const top = peak(world, player, 1.2);
  assert.ok(top > .85 && top < 1.1, `default apex ${top}`);
});

test("setVelocity launches the player and hands horizontal control back to input", async t => {
  const { world, player } = await playing(t);
  player.setVelocity([12, 9, 0]);
  const top = peak(world, player, .5);
  assert.ok(top > 1.6, `vertical launch reaches jumpSpeed-style height (${top})`);
  assert.ok(player.velocity.x > 0 && player.velocity.x < 12, `the horizontal push is fading (${player.velocity.x})`);
  advance(world, 1.5);
  assert.equal(player.grounded, true);
  assert.ok(Math.abs(player.velocity.x) < .05, `input takes back over (${player.velocity.x})`);
  assert.ok(player.position.x > 2, `the push moved the player (${player.position.x})`);
  const before = player.position.clone();
  player.setAxis(1, 0); advance(world, .3);
  const walking = player.velocity;
  player.setVelocity([walking.x, 0, walking.z]);
  advance(world, .05);
  assert.ok(Math.abs(player.velocity.x - walking.x) < .3, "passing the current velocity back changes nothing");
  assert.ok(player.position.x > before.x);
});

test("jumpPressed reports only presses the engine did not use, so games can add air jumps", async t => {
  const { world, player } = await playing(t);
  const presses = [];
  const track = () => { if (player.jumpPressed) presses.push(player.grounded); };
  player.setAction("jump", true);
  world.advance(1 / 60, { afterStep: track }); world.advance(1 / 60, { afterStep: track });
  assert.deepEqual(presses, [], "a ground jump is not reported");
  assert.equal(player.jumpHeld, true);
  player.setAction("jump", false); advance(world, .1);
  assert.equal(player.jumpHeld, false);
  const single = player.position.y;
  let airJumps = 1;
  player.setAction("jump", true);
  const top = peak(world, player, 1.2, () => {
    track();
    if (player.jumpPressed && !player.grounded && airJumps > 0) { airJumps--; const v = player.velocity; player.setVelocity([v.x, 6.25, v.z]); }
  });
  assert.deepEqual(presses, [false], "one mid-air press, reported once");
  assert.ok(top > 1.4, `the game's double jump climbs above the one-metre single jump (from ${single} to ${top})`);
});

for (const mover of ["teleport", "moveTo"]) test(`a kinematic platform moved with ${mover} carries a player standing on it`, async t => {
  const world = await fixture(t), browser = surface(true);
  const platform = world.addBody({ type: "kinematic", shape: { type: "box", size: [4, .5, 4] }, position: [0, 2, 0] });
  const player = await world.addPlayer({ ...browser, model: hero(), feet: [0, 2.3, 0] });
  player.start(); advance(world, .5);
  assert.equal(player.grounded, true);
  const start = player.position.clone();
  for (let i = 1; i <= 60; i++) world.advance(1 / 60, { beforeStep: () => platform[mover]([i * 2 / 60, 2 + i * .5 / 60, 0]) });
  const moved = player.position.clone().sub(start);
  assert.ok(Math.abs(moved.x - 2) < .25, `rides sideways with the platform (${moved.x})`);
  assert.ok(Math.abs(moved.y - .5) < .15, `rides up with the platform (${moved.y})`);
  assert.equal(player.grounded, true);
});

// Kinematic floors: Rapier's character controller alone stalls walking on them and loses a descending one.
async function rider(t, { platform = { size: [20, .5, 10], position: [0, 20, 0] }, feet = [0, 20.3, 0], ground = true } = {}) {
  const world = await createWorld({ interpolate: false }); t.after(() => world.dispose());
  if (ground) world.addBody({ shape: { type: "box", size: [100, 1, 100] }, position: [0, -.5, 0] });
  const floor = world.addBody({ type: "kinematic", shape: { type: "box", size: platform.size }, position: platform.position, quaternion: platform.quaternion });
  const player = await world.addPlayer({ ...surface(true), model: hero(), feet });
  player.start(); advance(world, .5);
  return { world, floor, player };
}
/** Runs `frames` steps, moving each kinematic body in `moves` to `at(i)` before step i, and counts airborne steps. */
function ride(world, player, frames, moves, afterStep) {
  let air = 0;
  for (let i = 1; i <= frames; i++) world.advance(1 / 60, {
    beforeStep: () => { for (const [body, at] of moves) body.moveTo(at(i)); },
    afterStep: () => { if (!player.grounded) air++; afterStep?.(i); },
  });
  return air;
}
const sinking = (y, speed = 2) => i => [0, y - i * speed / 60, 0];

for (const [label, at] of [["still", null], ["moved in place", () => [0, 20, 0]], ["moving sideways", i => [i / 60, 20, 0]], ["rising", i => [0, 20 + i / 60, 0]], ["descending", sinking(20, 1)]]) test(`walking on a kinematic floor that is ${label} covers normal ground`, async t => {
  const { world, floor, player } = await rider(t), start = player.position.x;
  player.setAxis(.5, 0);
  const air = ride(world, player, 60, at ? [[floor, at]] : []);
  const walked = player.position.x - start - (at ? at(60)[0] : 0);
  assert.ok(walked > 2.3, `walks about 2.5 m in a second at half speed (${walked})`);
  assert.equal(air, 0);
});

test("a rider walks off a descending platform's edge and falls, and walks off once it stops", async t => {
  const { world, floor, player } = await rider(t, { platform: { size: [4, .5, 4], position: [0, 20, 0] } });
  let y = 20, fell = false;
  player.setAxis(1, 0);
  ride(world, player, 40, [[floor, i => [0, y = 20 - i * 2 / 60, 0]]], () => { if (player.position.x > 2.5 && player.position.y < y - .5) fell = true; });
  assert.ok(fell, `drops past the platform once off its edge (x ${player.position.x})`);

  const lift = await rider(t, { platform: { size: [4, .5, 4], position: [0, 5, 0] }, feet: [0, 5.3, 0] });
  ride(lift.world, lift.player, 60, [[lift.floor, sinking(5)]]);
  const start = lift.player.position.x;
  lift.player.setAxis(.5, 0);
  ride(lift.world, lift.player, 120, [[lift.floor, () => [0, 3, 0]]]);
  assert.ok(lift.player.position.x - start > 4, `walks off the stopped elevator (${lift.player.position.x - start})`);
  assert.ok(lift.player.position.y < .1, `lands on the ground (${lift.player.position.y})`);
});

test("a jump from a descending platform rises as high as one from the ground", async t => {
  const { world, floor, player } = await rider(t, { platform: { size: [20, .5, 20], position: [0, 30, 0] }, feet: [0, 30.3, 0] });
  let frame = 0;
  const move = [[floor, () => [0, 30 - ++frame * 3 / 60, 0]]];
  ride(world, player, 20, move);
  assert.equal(player.grounded, true);
  const takeoff = player.position.y;
  let top = -Infinity;
  player.setAction("jump", true);
  ride(world, player, 2, move, () => { top = Math.max(top, player.position.y); });
  player.setAction("jump", false);
  ride(world, player, 60, move, () => { top = Math.max(top, player.position.y); });
  assert.ok(top - takeoff > .9, `jumps about a metre (${top - takeoff})`);
});

test("walls beside a descending platform stop its rider without lifting or sinking it", async t => {
  for (const wallType of ["fixed", "kinematic"]) {
    const { world, floor, player } = await rider(t);
    // A fixed wall spans the whole descent; a kinematic one is the platform's own wall, moving with it.
    const wall = world.addBody({ type: wallType, ...wallType === "fixed" ? { shape: { type: "box", size: [1, 40, 10] }, position: [3, 20, 0] } : { shape: { type: "box", size: [1, 3, 10] }, position: [3, 21.75, 0] } });
    let y = 20, low = Infinity, high = -Infinity;
    player.setAxis(1, 0);
    const air = ride(world, player, 90, [[floor, i => [0, y = 20 - i * 2 / 60, 0]], ...wallType === "kinematic" ? [[wall, i => [3, 21.75 - i * 2 / 60, 0]]] : []], () => {
      const gap = player.position.y - (y + .25); low = Math.min(low, gap); high = Math.max(high, gap);
    });
    assert.equal(air, 0, wallType);
    assert.ok(low > -.01 && high < .05, `${wallType} wall: stays on the floor (gap ${low} to ${high})`);
    assert.ok(player.position.x < 2.5, `${wallType} wall: stops at the wall (${player.position.x})`);
  }
});

test("two riders pushing each other on a descending platform both stay grounded", async t => {
  const { world, floor, player } = await rider(t, { platform: { size: [20, .5, 20], position: [0, 20, 0] } });
  const other = await world.addPlayer({ ...surface(true), model: hero(), feet: [2, 20.3, 0] });
  other.start(); advance(world, .1);
  let otherAir = 0;
  player.setAxis(.5, 0);
  const air = ride(world, player, 90, [[floor, sinking(20)]], () => { if (!other.grounded) otherAir++; });
  assert.equal(air, 0); assert.equal(otherAir, 0);
});

test("a rider crosses the seam between two platforms moving together", async t => {
  const { world, floor, player } = await rider(t, { platform: { size: [2, .5, 4], position: [-1, 20, 0] }, feet: [-1, 20.3, 0] });
  const next = world.addBody({ type: "kinematic", shape: { type: "box", size: [2, .5, 4] }, position: [1, 20, 0] });
  player.setAxis(.5, 0);
  const air = ride(world, player, 60, [[floor, i => [-1, 20 - i * 2 / 60, 0]], [next, i => [1, 20 - i * 2 / 60, 0]]]);
  assert.ok(player.position.x > 1, `crosses onto the second platform (${player.position.x})`);
  assert.equal(air, 0);
});

test("a platform moving diagonally or turning carries its rider along", async t => {
  const diagonal = await rider(t), start = diagonal.player.position.clone();
  diagonal.player.setAxis(0, -.5);
  const air = ride(diagonal.world, diagonal.player, 60, [[diagonal.floor, i => [i * 2 / 60, 20 - i / 60, 0]]]);
  const moved = diagonal.player.position.clone().sub(start);
  assert.ok(Math.abs(moved.x - 2) < .1 && Math.abs(moved.y + 1) < .05, `rides 2 m across and 1 m down (${moved.x}, ${moved.y})`);
  assert.equal(air, 0);

  const { world, floor, player } = await rider(t, { platform: { size: [10, .5, 10], position: [0, 1, 0] }, feet: [3, 1.3, 0] });
  const spin = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  let radius = 0;
  for (let i = 1; i <= 90; i++) world.advance(1 / 60, { beforeStep: () => floor.moveTo([0, 1, 0], spin.setFromAxisAngle(up, i / 60)), afterStep: () => { radius = Math.max(radius, Math.abs(Math.hypot(player.position.x, player.position.z) - 3)); } });
  const angle = Math.atan2(-player.position.z, player.position.x);
  assert.ok(Math.abs(angle - 1.5) < .05, `turns 1.5 rad with the turntable (${angle})`);
  assert.ok(radius < .05, `keeps its distance from the axis (off by ${radius})`);
});

test("a rider stays grounded on a sloped descending platform and on a ledge beside one", async t => {
  for (const degrees of [10, 20]) {
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), degrees * Math.PI / 180);
    const { world, floor, player } = await rider(t, { platform: { size: [20, .5, 20], position: [0, 30, 0], quaternion: tilt.toArray() }, feet: [0, 30.5, 0] });
    player.setAxis(0, 1);
    assert.equal(ride(world, player, 60, [[floor, sinking(30)]]), 0, `${degrees}° slope`);
  }
  const { world, floor, player } = await rider(t, { platform: { size: [4, .5, 4], position: [-2, 10, 0] }, feet: [0, 10.3, 0] });
  world.addBody({ shape: { type: "box", size: [4, .5, 4] }, position: [2, 10, 0] });
  const air = ride(world, player, 60, [[floor, i => [-2, 10 - i * 2 / 60, 0]]]);
  assert.equal(air, 0);
  assert.ok(Math.abs(player.position.y - 10.25) < .05, `stays on the ledge as the platform drops (${player.position.y})`);
});

test("a rider keeps one contact with its descending floor until it walks off", async t => {
  const { world, floor, player } = await rider(t, { platform: { size: [4, .5, 4], position: [0, 20, 0] } });
  const events = []; world.onCollision(e => { if ([e.a, e.b].includes(player.body) && [e.a, e.b].includes(floor)) events.push(e.type); });
  let frame = 0;
  const move = [[floor, () => [0, 20 - ++frame * 2 / 60, 0]]];
  ride(world, player, 30, move);
  assert.deepEqual(events, [], "the contact made on landing holds while riding");
  player.setAxis(1, 0);
  ride(world, player, 60, move);
  assert.deepEqual(events, ["end"]);
});

test("player position, velocity, forward, their clones and ray hits read as .x or [0], like the [x, y, z] inputs", async t => {
  const { world, player } = await playing(t);
  player.setAxis(1, 0); advance(world, .2);
  for (const name of ["position", "velocity", "forward"]) {
    const v = player[name];
    assert.deepEqual([v[0], v[1], v[2]], [v.x, v.y, v.z], name);
  }
  const v = player.velocity; player.setVelocity([v[0], 6, v[2]]);
  assert.equal(player.velocity[1], 6);
  const hit = world.castRay([0, 5, 0], [0, -1, 0], { exclude: player.body });
  const copies = { clone: player.position.clone(), point: hit.point, normal: hit.normal, "point.clone": hit.point.clone() };
  for (const [name, c] of Object.entries(copies)) assert.deepEqual([c[0], c[1], c[2]], [c.x, c.y, c.z], name);
  assert.equal(hit.normal[1], 1);
});

test("pushing the analog stick to its edge runs, so touch play can reach run speed", async t => {
  const { world, player } = await playing(t);
  player.setAxis(.6, 0); advance(world, .3);
  const walk = Math.hypot(player.velocity.x, player.velocity.z);
  player.setAxis(1, 0); advance(world, .3);
  const run = Math.hypot(player.velocity.x, player.velocity.z);
  assert.ok(Math.abs(walk - 3) < .1, `a partial push walks proportionally (${walk})`);
  assert.ok(Math.abs(run - 8) < .1, `a full push runs (${run})`);
});

function riggedHero(names = ["Idle", "Walk", "Run", "Jump_Loop", "Wave"]) {
  const scene = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(.6, 1.8, .4));
  body.name = "Body"; scene.add(body);
  const clip = (name, duration = 1) => new THREE.AnimationClip(name, duration, [new THREE.VectorKeyframeTrack("Body.scale", [0, duration], [1, 1, 1, 1, 1, 1])]);
  return { scene, animations: names.map(name => clip(name, name === "Wave" ? .5 : 1)) };
}

test("several NPCs share one skinned glTF, each with its own clone, skeleton and clips", async t => {
  const world = await fixture(t);
  const bone = new THREE.Bone(); bone.name = "Hips";
  const geometry = new THREE.BoxGeometry(.6, 1.8, .4), count = geometry.attributes.position.count;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array.from({ length: count * 4 }, (_, i) => i % 4 ? 0 : 1), 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  const scene = new THREE.Group(); scene.add(bone, mesh); mesh.bind(new THREE.Skeleton([bone]));
  const walk = new THREE.AnimationClip("Walk", 1, [new THREE.VectorKeyframeTrack("Hips.position", [0, 1], [0, 0, 0, 0, .1, 0])]);
  const gltf = { scene, animations: [new THREE.AnimationClip("Idle", 1, walk.tracks), walk] };
  const npcs = [0, 1, 2].map(i => world.addNpc({ model: gltf, feet: [i * 2, 0, 0] }));
  const skinned = npcs.map(npc => { let found; npc.visual.traverse(o => { if (o.isSkinnedMesh) found = o; }); return found; });
  assert.equal(new Set(skinned).size, 3, "every NPC draws its own mesh");
  for (const mesh of skinned) {
    let root = mesh; while (root.parent) root = root.parent;
    let ancestor = mesh.skeleton.bones[0]; while (ancestor.parent) ancestor = ancestor.parent;
    assert.equal(ancestor, root, "the skeleton's bones live in that NPC's own model");
  }
  for (const npc of npcs) assert.ok(npc.mixer instanceof THREE.AnimationMixer);
  npcs.forEach(npc => npc.setVelocity([2, 0, 0])); advance(world, .3);
  assert.deepEqual(npcs.map(npc => npc.animation), ["walk", "walk", "walk"]);
});

test("a player given a glTF with movement clips plays idle, walk, run and in-air automatically", async t => {
  const { world, player } = await playing(t, { model: riggedHero() });
  assert.ok(player.mixer instanceof THREE.AnimationMixer);
  assert.equal(player.animation, "idle");
  player.setAxis(.5, 0); advance(world, .3);
  assert.equal(player.animation, "walk");
  player.setAxis(1, 0); advance(world, .3);
  assert.equal(player.animation, "run");
  player.setAxis(0, 0); player.jump(); advance(world, .3);
  assert.equal(player.animation, "air");
  advance(world, 1);
  assert.equal(player.animation, "idle");
  const running = name => player.mixer._actions.filter(a => a.isRunning() && a.getEffectiveWeight() > .5).map(a => a.getClip().name);
  assert.deepEqual(running(), ["Idle"]);
});

test("playAnimation plays a named clip once, then returns to movement", async t => {
  const { world, player } = await playing(t, { model: riggedHero() });
  assert.equal(player.playAnimation("wave"), .5, "case-insensitive, returns the duration");
  advance(world, .2);
  assert.equal(player.animation, "Wave");
  advance(world, .6);
  assert.equal(player.animation, "idle");
  assert.equal(player.playAnimation("Missing"), null);
});

test("models without clips, first person and animate:false leave animation to the game", async t => {
  const plain = await playing(t);
  assert.equal(plain.player.mixer, null); assert.equal(plain.player.animation, null); assert.equal(plain.player.playAnimation("Idle"), null);
  const off = await playing(t, { model: riggedHero(), animate: false });
  assert.equal(off.player.mixer, null);
  const fps = await playing(t, { model: riggedHero(), view: "first" });
  assert.equal(fps.player.mixer, null);
  const loose = await playing(t, { model: riggedHero().scene, animations: riggedHero(["Walk"]).animations });
  assert.equal(loose.player.animation, "idle", "a walk-only rig holds a still walk pose for idle");
  const idleOnly = await playing(t, { model: riggedHero(["Idle"]) });
  idleOnly.player.setAxis(1, 0); advance(idleOnly.world, .3);
  assert.ok(Math.hypot(idleOnly.player.velocity.x, idleOnly.player.velocity.z) > 1, "an idle-only rig still moves");
  assert.deepEqual(idleOnly.player.mixer._actions.filter(a => a.isRunning()).map(a => a.getClip().name), ["Idle"]);
});

test("an NPC with clips animates from the velocity the game gives it", async t => {
  const world = await fixture(t);
  const npc = world.addNpc({ model: riggedHero(), feet: [3, 0, 0] });
  advance(world, .3);
  assert.equal(npc.animation, "idle");
  npc.setVelocity([2, 0, 0]); advance(world, .3);
  assert.equal(npc.animation, "walk");
  npc.setVelocity([6, 0, 0]); advance(world, .3);
  assert.equal(npc.animation, "run");
  npc.remove();
  advance(world, .1);
});

test("an animated NPC removed through its body handle, such as a ray hit, stops animating", async t => {
  const world = await fixture(t), scene = new THREE.Scene();
  const npc = world.addNpc({ model: riggedHero(), feet: [3, 0, 0] });
  scene.add(npc.root); advance(world, .2);
  const hit = world.castRay([3, 5, 0], [0, -1, 0]);
  assert.equal(hit.body, npc.body);
  hit.body.remove();
  advance(world, .1);
  npc.remove();
  assert.equal(npc.root.parent, null, "the handle's own remove still detaches the model");
  advance(world, .1);
});

test("an unrelated pointercancel or a teleport keeps held stick and button input", async t => {
  const world = await fixture(t), browser = surface(true);
  const player = await world.addPlayer({ ...browser, model: hero(), feet: [0, 0, 0] });
  player.start(); advance(world, .3);
  player.setAxis(1, 0); player.setAction("run", true); advance(world, .2);
  browser.doc.dispatchEvent(new Event("pointercancel")); advance(world, .2);
  assert.ok(player.velocity.x > 7, `a cancelled pointer elsewhere does not drop the stick (${player.velocity.x})`);
  player.teleport([0, 0, 5]); advance(world, .2);
  assert.ok(player.velocity.x > 7, `teleport clears motion, not held input (${player.velocity.x})`);
});

test("in free mouse look only a real mouse leaving the canvas pauses, not a tap on the game's own buttons", async t => {
  const world = await fixture(t), browser = surface(false);
  const player = await world.addPlayer({ ...browser, model: hero() });
  player.start(); assert.equal(player.active, true, "no pointer lock API: free mouse look");
  const pointer = (type, pointerType) => browser.doc.dispatchEvent(Object.assign(new Event(type), { pointerType }));
  pointer("pointerdown", "touch");
  browser.canvas.dispatchEvent(new Event("mouseleave"));
  assert.equal(player.active, true, "a tap's compatibility mouseleave");
  browser.canvas.dispatchEvent(Object.assign(new Event("mouseleave"), { sourceCapabilities: { firesTouchEvents: true } }));
  assert.equal(player.active, true, "a mouseleave marked as coming from touch");
  pointer("pointermove", "mouse");
  browser.canvas.dispatchEvent(new Event("mouseleave"));
  assert.equal(player.active, false, "a real mouse leaving");
});

test("touch-only play never pauses on mouseleave", async t => {
  const world = await fixture(t), browser = surface(true);
  const node = () => ({ style: {}, dataset: {}, append() {}, addEventListener() {}, remove() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) });
  browser.doc.createElement = node; browser.doc.body = node();
  const player = await world.addPlayer({ ...browser, model: hero(), touch: true });
  player.start(); assert.equal(player.active, true);
  browser.canvas.dispatchEvent(new Event("mouseleave"));
  assert.equal(player.active, true);
  player.remove();
});

test("a touch player can be removed after world.dispose(), and the reverse", async () => {
  const touchPlayer = async () => {
    const world = await createWorld({ interpolate: false }), browser = surface(true);
    const node = () => ({ style: {}, dataset: {}, append() {}, addEventListener() {}, remove() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) });
    browser.doc.createElement = node; browser.doc.body = node();
    return { world, player: await world.addPlayer({ ...browser, model: riggedHero(), touch: true }) };
  };
  const a = await touchPlayer();
  a.world.dispose(); a.player.remove(); a.player.remove();
  const b = await touchPlayer();
  b.player.remove(); b.world.dispose();
});

for (const view of ["third", "first"]) test(`${view}-person start() resumes after pause(), so a pause menu can use either`, async t => {
  const world = await fixture(t), browser = surface(true);
  const player = await world.addPlayer({ ...browser, model: hero(), view });
  player.start(); advance(world, .1);
  player.pause(); advance(world, .1);
  browser.canvas.dispatchEvent(new Event("click"));
  assert.equal(player.active, false, "a canvas click does not end pause()");
  player.start(); advance(world, .1);
  assert.equal(player.active, true);
});

test("a looping playAnimation holds over movement until stopAnimation", async t => {
  const { world, player } = await playing(t, { model: riggedHero() });
  player.playAnimation("Wave", { loop: true });
  player.setAxis(.5, 0); advance(world, 1.2);
  assert.equal(player.animation, "Wave", "outlasts its clip and ignores walking");
  player.stopAnimation(); advance(world, .1);
  assert.equal(player.animation, "walk");
  player.playAnimation("Wave"); player.stopAnimation();
  assert.equal(player.animation, "walk", "also ends a one-shot early");
});
