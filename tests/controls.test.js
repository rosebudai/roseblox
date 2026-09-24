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
