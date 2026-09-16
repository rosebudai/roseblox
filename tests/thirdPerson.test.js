import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createMechanics } from "../src/mechanics.js";

function surface(native = true) {
  const doc = new EventTarget(), win = new EventTarget(); doc.defaultView = win; doc.hidden = false;
  class Canvas extends EventTarget {
    ownerDocument = doc; tabIndex = -1; style = { cursor: "crosshair" }; dataset = {};
    getAttribute() { return null; } removeAttribute() { this.tabIndex = -1; }
    focus() { doc.activeElement = this; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720 }; }
  }
  const canvas = new Canvas();
  doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.dispatchEvent(new Event("pointerlockchange")); };
  if (native) canvas.requestPointerLock = () => { doc.pointerLockElement = canvas; doc.dispatchEvent(new Event("pointerlockchange")); };
  return { canvas, camera: new THREE.PerspectiveCamera(65, 16 / 9, .1, 500), doc, win };
}
function event(target, name, fields = {}) {
  const e = new Event(name, { cancelable: true });
  for (const [key, value] of Object.entries(fields)) Object.defineProperty(e, key, { value });
  target.dispatchEvent(e); return e;
}
const advance = (m, seconds, hz = 60) => { for (let i = 0; i < Math.round(seconds * hz); i++) m.advance(1 / hz); };
async function fixture(t) {
  const m = await createMechanics({ interpolate: false }); t.after(() => m.dispose());
  m.addBody({ shape: { type: "box", size: [100, 1, 100] }, position: [0, -.5, 0] });
  return m;
}

test("generic characters can request a grounded jump, but cannot double jump or retain it through teleport", async t => {
  const m = await fixture(t), actor = m.addCharacter({ jumpSpeed: 6 });
  assert.equal(actor.jump(), false); advance(m, 1); const floor = actor.position.y;
  assert.equal(actor.jump(), true); m.advance(0); advance(m, .2);
  assert.ok(actor.position.y > floor + .8); assert.equal(actor.jump(), false);
  advance(m, 2); assert.equal(actor.grounded, true); assert.equal(actor.jump(), true);
  actor.teleport([0, 1, 0]); advance(m, .3); assert.ok(actor.position.y < 1.1);
  const disabled = m.addCharacter({ position: [4, 2, 0], jumpSpeed: 0 }); advance(m, 1); assert.equal(disabled.jump(), false);
});

for (const kind of ["addFpsPlayer", "addThirdPersonPlayer"]) test(`${kind} consumes a quick Space tap between frames and preserves jump/landing across render rates`, async t => {
  const tops = [];
  for (const hz of [30, 60, 144]) {
    const m = await fixture(t), browser = surface(), actor = await m[kind]({ ...browser, jumpSpeed: 6 });
    actor.start(); advance(m, 1, hz); const floor = actor.position.y;
    event(browser.win, "keydown", { code: "Space" }); event(browser.win, "keyup", { code: "Space" });
    advance(m, .5, hz); tops.push(actor.position.y);
    assert.ok(actor.position.y > floor + 1.5);
    advance(m, 2, hz); assert.equal(actor.grounded, true);
    actor.setAction("jump", true); advance(m, 3, hz); assert.ok(Math.abs(actor.position.y - floor) < .01, "holding jump does not bunny-hop");
  }
  for (const y of tops) assert.ok(Math.abs(y - tops[0]) < 1e-4);
});

for (const native of [true, false]) test(`third-person ${native ? "native" : "fallback"} mouse orbit, camera-relative movement, facing, zoom and resume`, async t => {
  const m = await fixture(t), browser = surface(native);
  let attacks = 0;
  const actor = await m.addThirdPersonPlayer({ ...browser, onAttack: () => attacks++, sensitivity: .01 });
  const root = new THREE.Group(), model = new THREE.Object3D(); model.rotation.y = Math.PI; model.position.y = -.9; root.add(model); actor.bindObject(root);
  actor.start(); advance(m, 1); assert.equal(actor.locked, native);
  const look = (dx, dy) => {
    if (native) event(browser.doc, "mousemove", { movementX: dx, movementY: dy });
    else { event(browser.doc, "mousemove", { target: browser.canvas, clientX: 400, clientY: 300 }); event(browser.doc, "mousemove", { target: browser.canvas, clientX: 400 + dx, clientY: 300 + dy }); }
  };
  look(Math.PI / .02, 0); m.advance(1 / 60);
  actor.setAction("forward", true); advance(m, .5); actor.setAction("forward", false);
  assert.ok(actor.position.x > 2.4 && Math.abs(actor.position.z) < .01, "W follows rotated camera, not original world forward");
  assert.ok(new THREE.Vector3(0, 0, -1).applyQuaternion(root.quaternion).x > .99);
  assert.equal(model.rotation.y, Math.PI); assert.equal(model.position.y, -.9);
  const before = browser.camera.position.distanceTo(actor.position);
  event(browser.canvas, "wheel", { deltaY: -600, deltaMode: 0 }); assert.ok(browser.camera.position.distanceTo(actor.position) < before - 1);
  event(browser.canvas, "mousedown", { button: 0 }); assert.equal(attacks, 1);
  const aim = browser.camera.quaternion.clone(), pos = actor.position, clock = m.getDiagnostics().simulatedSeconds;
  event(browser.win, "blur"); assert.equal(actor.active, false);
  let rules = 0; m.advance(30, { afterStep: () => rules++ });
  assert.equal(rules, 0); assert.deepEqual(actor.position, pos); assert.equal(m.getDiagnostics().simulatedSeconds, clock);
  actor.start(); m.advance(1 / 60); assert.ok(aim.angleTo(browser.camera.quaternion) < 1e-5, "resume preserves orbit");
  actor.remove(); assert.equal(browser.canvas.style.cursor, "crosshair");
  const replacement = await m.addFpsPlayer(browser); replacement.start(); assert.equal(replacement.active, true);
});

test("third-person camera orbits through full turns, has broad finite pitch, and retracts at a wall", async t => {
  const m = await fixture(t), browser = surface();
  const actor = await m.addThirdPersonPlayer({ ...browser, sensitivity: .01 }); actor.start(); advance(m, 1);
  for (let i = 0; i < 90; i++) {
    const before = browser.camera.quaternion.clone();
    event(browser.doc, "mousemove", { movementX: 10, movementY: 0 });
    assert.ok(before.angleTo(browser.camera.quaternion) < .101, "yaw wrap never snaps");
  }
  event(browser.doc, "mousemove", { movementX: -900, movementY: 200 });
  assert.ok(browser.camera.getWorldDirection(new THREE.Vector3()).y < -.99);
  event(browser.doc, "mousemove", { movementX: 0, movementY: -400 });
  assert.ok(browser.camera.getWorldDirection(new THREE.Vector3()).y > .96);
  event(browser.doc, "mousemove", { movementX: 0, movementY: 160 });
  actor.stop(); actor.start();
  const wall = m.addBody({ position: [0, 2, 3], shape: { type: "box", size: [20, 8, .5] } });
  m.advance(0); assert.ok(browser.camera.position.z < 2.6);
  wall.remove(); m.advance(0); assert.ok(browser.camera.position.z > 5);
});

test("third-person validation and asynchronous removal release the camera and input", async t => {
  const m = await fixture(t), browser = surface(); const bodies = m.getDiagnostics().bodies;
  for (const config of [{ sensitivity: 0 }, { minDistance: 20 }, { facing: "sideways" }, { jumpSpeed: -1 }]) {
    await assert.rejects(m.addThirdPersonPlayer({ ...browser, ...config })); assert.equal(m.getDiagnostics().bodies, bodies);
  }
  const pending = m.addThirdPersonPlayer(browser); m.dispose();
  await assert.rejects(pending, /removed during input initialization/); assert.equal(browser.canvas.tabIndex, -1);
});

test("movement-facing permits independent orbit, and game speed changes preserve engine-owned jumping", async t => {
  const m = await fixture(t), browser = surface();
  const actor = await m.addThirdPersonPlayer({ ...browser, facing: "movement", sensitivity: .01 });
  actor.start(); advance(m, 1); const facing = actor.quaternion;
  event(browser.doc, "mousemove", { movementX: Math.PI / .02, movementY: 0 });
  m.advance(1 / 60); assert.ok(actor.quaternion.angleTo(facing) < 1e-6);
  const aim = browser.camera.quaternion.clone();
  actor.setMoveSpeed(2); actor.setAction("right", true); const start = actor.position; advance(m, .5);
  assert.ok(actor.position.z > start.z + .95 && actor.position.z < start.z + 1.05);
  assert.ok(new THREE.Vector3(0, 0, -1).applyQuaternion(actor.quaternion).z > .99);
  assert.ok(aim.angleTo(browser.camera.quaternion) < 1e-6);
  actor.setMoveSpeed(0); actor.setAction("jump", true); const stopped = actor.position; advance(m, .2);
  assert.ok(Math.abs(actor.position.z - stopped.z) < .01); assert.ok(actor.position.y > stopped.y + .8);
  assert.throws(() => actor.setMoveSpeed(-1), /non-negative/);
});
