import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createMechanics } from "../src/mechanics.js";

function surface(native = false) {
  const doc = new EventTarget(), win = new EventTarget();
  doc.defaultView = win; doc.hidden = false;
  class Canvas extends EventTarget {
    style = { cursor: "crosshair" }; dataset = {}; ownerDocument = doc; tabIndex = -1;
    attributes = new Map();
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    focus() { doc.activeElement = this; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
  }
  const canvas = new Canvas(), camera = new THREE.PerspectiveCamera(72, 16 / 9, .1, 200);
  doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.dispatchEvent(new Event("pointerlockchange")); };
  if (native) canvas.requestPointerLock = () => { doc.pointerLockElement = canvas; doc.dispatchEvent(new Event("pointerlockchange")); };
  return { canvas, camera, doc, win };
}
function event(target, name, fields = {}) {
  const e = new Event(name, { cancelable: true });
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(e, key, { value });
  target.dispatchEvent(e);
}
async function fixture(t, options = {}) {
  const m = await createMechanics(options); t.after(() => m.dispose());
  m.addBody({ shape: { type: "box", size: [40, 1, 40] }, position: [0, -.5, 0] });
  return m;
}
function advance(m, seconds, hz = 60) { for (let i = 0; i < Math.round(seconds * hz); i++) m.advance(1 / hz); }

test("host owns rendering and art; bindings follow world poses and release without disposing borrowed resources", async t => {
  const m = await fixture(t, { interpolate: false });
  const scene = new THREE.Scene(), root = new THREE.Group(); root.position.set(10, 0, 0); root.rotation.y = .4; scene.add(root);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); root.add(mesh);
  let releases = 0; mesh.geometry.addEventListener("dispose", () => releases++); mesh.material.addEventListener("dispose", () => releases++);
  const body = m.addBody({ type: "dynamic", position: [2, 4, 1] }); body.bindObject(mesh);
  advance(m, 1);
  assert.ok(mesh.getWorldPosition(new THREE.Vector3()).distanceTo(body.position) < 1e-5);
  assert.ok(body.position.y < 4);
  body.remove(); body.remove(); m.dispose(); m.dispose();
  assert.equal(releases, 0); assert.equal(mesh.parent, root); assert.equal(scene.children.length, 1);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test("collider queries include hidden cover, see new bodies and teleports immediately, and exclude the shooter", async t => {
  const m = await fixture(t);
  const shooter = m.addCharacter({ position: [0, 2, 0], spawnClearance: 0 });
  const cover = m.addBody({ position: [0, 2, -4], shape: { type: "box", size: [4, 4, 1] } });
  const target = m.addCharacter({ position: [0, 2, -8], spawnClearance: 0 });
  assert.equal(m.castRay([0, 2, 0], [0, 0, -1], { exclude: shooter }).body, cover);
  const mesh = new THREE.Object3D(); mesh.visible = false; cover.bindObject(mesh);
  assert.equal(m.castSegment([0, 2, 0], [0, 2, -9], { exclude: shooter }).body, cover);
  m.advance(1 / 60);
  cover.teleport([8, 2, -4]);
  assert.equal(m.castRay([0, 2, 0], [0, 0, -1], { exclude: shooter }).body, target);
  target.remove(); assert.equal(m.castRay([0, 2, 0], [0, 0, -1], { exclude: shooter }), null);
});

test("shared FPS motor preserves speed across render rates and supports jump, landing, and ceiling contacts", async t => {
  const distances = [];
  for (const hz of [30, 60, 144]) {
    const m = await fixture(t), browser = surface();
    const player = await m.addFpsPlayer({ ...browser, position: [0, 1.1, 0], speed: 4, jumpSpeed: 6 });
    player.start(); advance(m, 1, hz); assert.equal(player.grounded, true);
    player.setAction("forward", true); advance(m, 1, hz); player.setAction("forward", false);
    distances.push(player.position.z);
    const floorY = player.position.y;
    player.setAction("jump", true); advance(m, .25, hz);
    assert.ok(player.position.y > floorY + .7);
    player.setAction("jump", false); advance(m, 2, hz); assert.equal(player.grounded, true);
    m.addBody({ position: [0, 2.3, -4], shape: { type: "box", size: [4, .3, 4] } });
    player.setAction("jump", true); advance(m, .4, hz);
    assert.ok(player.position.y < 1.5, "the underside stops upward motion");
    advance(m, 1, hz); assert.equal(player.grounded, true);
  }
  distances.forEach(z => {
    assert.ok(z < -3.8 && z > -4.1, "grounded motion remains close to the requested speed");
    assert.ok(Math.abs(z - distances[0]) < 1e-5, "render rate does not change simulated motion");
  });
});

test("sensor and solid contacts emit one transition and removal ends contact without retaining bodies", async t => {
  const m = await fixture(t);
  const wall = m.addBody({ position: [0, 1.5, -3], shape: { type: "box", size: [8, 3, .5] } });
  const sensor = m.addBody({ position: [0, 1.5, -1], shape: { type: "box", size: [8, 3, .2] }, sensor: true });
  const actor = m.addCharacter({ position: [0, 1, 2], velocity: [0, 0, -3] });
  const events = []; m.onCollision(e => events.push(e));
  advance(m, 2);
  const matches = (type, other) => events.filter(e => e.type === type && [e.a, e.b].includes(actor) && [e.a, e.b].includes(other)).length;
  assert.ok(actor.position.z > -2.5); assert.equal(matches("start", wall), 1); assert.equal(matches("start", sensor), 1);
  actor.remove(); assert.equal(matches("end", wall), 1);
  const count = m.getDiagnostics().bodies;
  for (let i = 0; i < 50; i++) m.addCharacter().remove();
  assert.equal(m.getDiagnostics().bodies, count);
});

test("pause freezes simulation and callbacks, clears held input, and resumes without catch-up", async t => {
  const m = await fixture(t), browser = surface();
  const player = await m.addFpsPlayer({ ...browser, position: [0, 1.1, 0] });
  player.start(); advance(m, 1); player.setAction("forward", true);
  const before = player.position, steps = m.getDiagnostics().fixedSteps;
  let calls = 0;
  m.advance(30, { paused: true, beforeStep: () => calls++, afterStep: () => calls++ });
  assert.equal(calls, 0); assert.equal(m.getDiagnostics().fixedSteps, steps); assert.deepEqual(player.position, before);
  m.advance(1 / 60, { paused: false });
  assert.ok(player.position.distanceTo(before) < .01); assert.equal(m.getDiagnostics().fixedSteps, steps + 1);
});

for (const native of [false, true]) test(`${native ? "native" : "fallback"} FPS preserves mouse-look, click fire, pause/resume and borrowed camera ownership`, async t => {
  const m = await fixture(t), browser = surface(native);
  let shots = 0;
  const player = await m.addFpsPlayer({ ...browser, onFire: () => shots++ });
  player.start(); assert.equal(player.active, true); assert.equal(player.locked, native);
  await assert.rejects(m.addFpsPlayer(browser), /existing FPS/);
  const initial = browser.camera.quaternion.clone();
  const look = native ? { movementX: 80, movementY: 20 } : { target: browser.canvas, clientX: 500, clientY: 300 };
  event(browser.doc, "mousemove", look);
  if (!native) event(browser.doc, "mousemove", { ...look, clientX: 580, clientY: 320 });
  assert.ok(initial.angleTo(browser.camera.quaternion) > .1);
  event(browser.canvas, "mousedown", { button: 0 }); assert.equal(shots, 1);
  const aim = browser.camera.quaternion.clone();
  event(browser.win, "blur"); assert.equal(player.active, false);
  player.start(); assert.ok(aim.angleTo(browser.camera.quaternion) < 1e-6); assert.equal(player.active, true);
  player.remove(); assert.equal(browser.canvas.style.cursor, "crosshair");
  const second = await m.addFpsPlayer(browser); second.start(); assert.equal(second.active, true);
});

test("render interpolation remains smooth and teleport is immediate without a physics step", async t => {
  const m = await fixture(t, { gravity: [0, 0, 0] });
  const actor = m.addCharacter({ position: [0, 3, 0], velocity: [0, 0, -3], spawnClearance: 0 });
  const mesh = new THREE.Object3D(); actor.bindObject(mesh); advance(m, 1);
  let last = mesh.position.z;
  for (let i = 0; i < 144; i++) { m.advance(1 / 144); assert.ok(Math.abs((mesh.position.z - last) + 3 / 144) < 1e-5); last = mesh.position.z; }
  actor.teleport([5, 3, 4]); assert.deepEqual(mesh.position.toArray(), [5, 3, 4]); assert.deepEqual(actor.position.toArray(), [5, 3, 4]);
});

test("fixed callbacks can remove bodies or dispose the world; stalled frames have bounded simulation work", async t => {
  const m = await fixture(t);
  m.advance(5); const d = m.getDiagnostics(); assert.equal(d.fixedSteps, 8); assert.ok(d.droppedSeconds > 4.8);
  const actor = m.addCharacter();
  m.advance(1 / 60, { beforeStep: () => actor.remove() }); assert.equal(actor.removed, true);
  m.advance(1 / 60, { afterStep: () => m.dispose() }); assert.equal(m.getDiagnostics().disposed, true);
});

test("a negative render timestamp delta skips simulation and the next frame remains playable", async t => {
  const m = await fixture(t, { interpolate: false }), browser = surface();
  const player = await m.addFpsPlayer({ ...browser, position: [0, 1.1, 0] });
  player.start(); player.setAction("forward", true);
  const before = player.position; let callbacks = 0;
  m.advance(-.0123, { beforeStep: () => callbacks++, afterStep: () => callbacks++ });
  assert.deepEqual(player.position, before);
  assert.equal(callbacks, 0); assert.equal(m.getDiagnostics().fixedSteps, 0);
  advance(m, 1); assert.ok(player.position.z < before.z - 4);
  assert.ok(browser.camera.position.toArray().every(Number.isFinite));
  const steps = m.getDiagnostics().fixedSteps, after = player.position;
  m.advance(-.003); assert.equal(m.getDiagnostics().fixedSteps, steps); assert.deepEqual(player.position, after);
  advance(m, .1); assert.ok(player.position.z < after.z);
  assert.equal(m.getDiagnostics().negativeDeltaFrames, 2);
  assert.equal(m.getDiagnostics().droppedSeconds, 0);
  for (const invalid of [NaN, Infinity, -Infinity]) assert.throws(() => m.advance(invalid), /finite/);
});
