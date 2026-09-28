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
