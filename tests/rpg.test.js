import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createRpgWorld, fitRpgModel } from "../src/rpg.js";

function model(height = 10) {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, height, 1));
  mesh.position.set(3, 4, -2); root.add(mesh);
  return root;
}
function surface(native) {
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
  const canvas = new Canvas();
  doc.exitPointerLock = () => { doc.pointerLockElement = null; doc.dispatchEvent(new Event("pointerlockchange")); };
  if (native) canvas.requestPointerLock = () => { doc.pointerLockElement = canvas; doc.dispatchEvent(new Event("pointerlockchange")); };
  return { canvas, camera: new THREE.PerspectiveCamera(60, 16 / 9, .1, 100), doc, win };
}
function event(target, type, fields) {
  const e = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries(fields)) Object.defineProperty(e, k, { value: v });
  target.dispatchEvent(e);
}
function advance(world, seconds) { for (let i = 0; i < seconds * 60; i++) world.advance(1 / 60); }

test("RPG model fitting preserves a feet-origin, unscaled equipment frame", () => {
  const hero = fitRpgModel(model(), { height: 1.8, yaw: Math.PI });
  const bounds = new THREE.Box3().setFromObject(hero);
  assert.ok(Math.abs(bounds.min.y) < 1e-6);
  assert.ok(Math.abs(bounds.max.y - 1.8) < 1e-6);
  assert.deepEqual(hero.scale.toArray(), [1, 1, 1]);
  const sword = fitRpgModel(model(20), { height: .8 });
  hero.add(sword); sword.position.set(.4, .9, -.2);
  const swordBounds = new THREE.Box3().setFromObject(sword);
  assert.ok(Math.abs(swordBounds.getSize(new THREE.Vector3()).y - .8) < 1e-6);
  assert.ok(Math.abs(swordBounds.min.y - .9) < 1e-6);
});

for (const native of [true, false]) test(`RPG ${native ? "native" : "fallback"} player jumps, faces orbit heading and uses feet coordinates`, async t => {
  const world = await createRpgWorld({ interpolate: false }); t.after(() => world.dispose());
  const browser = surface(native), scene = new THREE.Scene();
  world.addBody({ position: [0, -.5, 0], shape: { type: "box", size: [40, 1, 40] } });
  let attacks = 0;
  const player = await world.addPlayer({ ...browser, model: model(), feet: [0, 0, 0], onAttack: () => attacks++ });
  scene.add(player.root); player.start(); advance(world, 1);
  assert.equal(player.grounded, true); assert.equal(player.locked, native);
  assert.ok(Math.abs(player.position.y) < .06);
  const feet = new THREE.Box3().setFromObject(player.root).min.y;
  assert.ok(Math.abs(feet - player.position.y) < 1e-6);
  const startRotation = player.root.quaternion.clone();
  if (native) event(browser.doc, "mousemove", { movementX: 100, movementY: 30 });
  else {
    event(browser.doc, "mousemove", { target: browser.canvas, clientX: 500, clientY: 300 });
    event(browser.doc, "mousemove", { target: browser.canvas, clientX: 600, clientY: 330 });
  }
  advance(world, .1);
  assert.ok(player.root.quaternion.angleTo(startRotation) > .15, "standing model follows camera heading");
  event(browser.canvas, "mousedown", { button: 0 }); assert.equal(attacks, 1);
  player.setAction("jump", true); advance(world, .25);
  assert.ok(player.position.y > .9); player.setAction("jump", false);
  advance(world, 2); assert.equal(player.grounded, true);
  player.teleport([5, 2, 4]);
  assert.ok(player.position.distanceTo(new THREE.Vector3(5, 2, 4)) < .06);
  assert.equal(world.castRay([5, 4, 4], [0, -1, 0], { maxDistance: 3, exclude: player.body }), null);
  event(browser.win, "blur", {}); assert.equal(player.active, false);
  player.start(); assert.equal(player.active, true);
  player.remove(); assert.equal(player.root.parent, null);
  assert.equal(world.getDiagnostics().bodies, 1);
});
