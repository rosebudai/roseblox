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

for (const native of [true, false]) test(`RPG opt-in captured mouse ${native ? "native" : "fallback"} jumps, faces orbit heading and uses feet coordinates`, async t => {
  const world = await createRpgWorld({ interpolate: false }); t.after(() => world.dispose());
  const browser = surface(native), scene = new THREE.Scene();
  world.addBody({ position: [0, -.5, 0], shape: { type: "box", size: [40, 1, 40] } });
  let attacks = 0;
  const player = await world.addPlayer({ ...browser, controlMode: "pointer", model: model(), feet: [0, 0, 0], onAttack: () => attacks++ });
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
  const front = new THREE.Vector3(0, 0, 1).applyQuaternion(player.visual.getWorldQuaternion(new THREE.Quaternion()));
  const look = browser.camera.getWorldDirection(new THREE.Vector3()); look.y = 0; look.normalize();
  assert.ok(front.dot(look) > .999, "the asset's +Z front faces where the camera looks, not back toward the camera");
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

test("RPG free cursor selects world targets, right drag turns and release restores selection without a camera jump", async t => {
  const world = await createRpgWorld({ interpolate: false }); t.after(() => world.dispose());
  const b = surface(true), selections = [];
  world.addBody({ position: [0, -.5, 0], shape: { type: "box", size: [40, 1, 40] } });
  const target = world.addBody({ position: [-2, 1, -3], shape: { type: "box", size: [1, 2, 1] }, data: { name: "Elder" } });
  const player = await world.addPlayer({ ...b, model: model(), onSelect: value => selections.push(value), sensitivity: .01 });
  player.start(); advance(world, 1);
  assert.equal(player.locked, false); assert.equal(b.canvas.style.cursor, "default");
  const initial = b.camera.quaternion.clone();
  event(b.doc, "pointermove", { pointerId: 1, buttons: 0, clientX: 300, clientY: 200 });
  advance(world, .1); assert.ok(initial.angleTo(b.camera.quaternion) < 1e-6, "moving the free cursor leaves the camera alone");
  const projected = target.position.project(b.camera);
  const point = { pointerId: 1, clientX: (projected.x + 1) * 640, clientY: (1 - projected.y) * 360 };
  event(b.canvas, "pointerdown", { ...point, button: 0 });
  event(b.doc, "pointerup", { ...point, button: 0 });
  assert.equal(selections[0].hit.body, target); assert.equal(selections[0].hit.body.data.name, "Elder");
  assert.ok(selections[0].ray.direction.length() > .99);
  event(b.canvas, "pointerdown", { pointerId: 1, button: 2, clientX: 300, clientY: 200 });
  event(b.doc, "pointermove", { pointerId: 1, buttons: 2, clientX: 400, clientY: 225 });
  advance(world, .1);
  assert.ok(initial.angleTo(b.camera.quaternion) > .9);
  const front = new THREE.Vector3(0, 0, 1).applyQuaternion(player.root.quaternion);
  const look = b.camera.getWorldDirection(new THREE.Vector3()); look.y = 0; look.normalize();
  assert.ok(front.dot(look) > .999, "right-drag turns the visible hero with the camera");
  event(b.doc, "pointerup", { pointerId: 1, button: 2, clientX: 400, clientY: 225 });
  const released = b.camera.quaternion.clone();
  event(b.doc, "pointermove", { pointerId: 1, buttons: 0, clientX: 900, clientY: 600 });
  advance(world, .1); assert.ok(released.angleTo(b.camera.quaternion) < 1e-6);
  assert.equal(selections.length, 1, "an orbit gesture never selects or attacks");
  const distance = b.camera.position.distanceTo(player.body.position);
  event(b.canvas, "wheel", { deltaY: -600, deltaMode: 0 }); assert.ok(b.camera.position.distanceTo(player.body.position) < distance - 1);
  event(b.win, "keydown", { code: "Space" }); event(b.win, "keyup", { code: "Space" });
  advance(world, .25); assert.ok(player.position.y > .8); advance(world, 2); assert.equal(player.grounded, true);
  event(b.win, "keydown", { code: "Escape" }); assert.equal(player.active, false);
  const paused = b.camera.quaternion.clone(); player.start(); advance(world, .1);
  assert.ok(paused.angleTo(b.camera.quaternion) < 1e-6, "resume retains the view");
});

for (const layout of ["classic", "orbit"]) test(`RPG ${layout} keyboard turning, strafing and mouse chord movement`, async t => {
  const world = await createRpgWorld({ interpolate: false }); t.after(() => world.dispose());
  const b = surface(); world.addBody({ position: [0, -.5, 0], shape: { type: "box", size: [40, 1, 40] } });
  const player = await world.addPlayer({ ...b, model: model(), keyboardLayout: layout }); player.start(); advance(world, 1);
  const turningKey = layout === "classic" ? "KeyA" : "KeyQ";
  const strafeKey = layout === "classic" ? "KeyE" : "KeyD";
  const before = player.position, camera = b.camera.quaternion.clone();
  event(b.win, "keydown", { code: turningKey }); advance(world, .3); event(b.win, "keyup", { code: turningKey });
  assert.ok(camera.angleTo(b.camera.quaternion) > .5); assert.ok(player.position.distanceTo(before) < .02);
  const aim = b.camera.quaternion.clone();
  event(b.win, "keydown", { code: strafeKey }); advance(world, .3); event(b.win, "keyup", { code: strafeKey });
  assert.ok(player.position.distanceTo(before) > 1.4); assert.ok(aim.angleTo(b.camera.quaternion) < 1e-6);
  event(b.canvas, "pointerdown", { pointerId: 1, button: 2, clientX: 500, clientY: 300 });
  if (layout === "classic") {
    const start = player.position;
    event(b.win, "keydown", { code: "KeyA" }); advance(world, .3); event(b.win, "keyup", { code: "KeyA" });
    assert.ok(player.position.distanceTo(start) > 1.4); assert.ok(aim.angleTo(b.camera.quaternion) < 1e-6, "RMB+A strafes instead of keyboard turning");
  }
  const start = player.position;
  event(b.doc, "pointermove", { pointerId: 1, buttons: 3, clientX: 500, clientY: 300 }); advance(world, .3);
  assert.ok(player.position.distanceTo(start) > 1.4, "both mouse buttons walk forward");
  event(b.win, "blur", {}); assert.equal(player.active, false); player.start();
  const stopped = player.position; advance(world, .3); assert.ok(player.position.distanceTo(stopped) < .02, "focus loss clears the mouse chord");
});

test("RPG NPCs fit models, face motion through physics, retain idle heading and support authored front corrections", async t => {
  const world = await createRpgWorld({ interpolate: false }); t.after(() => world.dispose());
  world.addBody({ position: [0, -.5, 0], shape: { type: "box", size: [40, 1, 40] } });
  const asset = model(), npc = world.addNpc({ model: asset, feet: [0, 0, 0], height: 2 });
  const scene = new THREE.Scene(); scene.add(npc.root); advance(world, 1);
  assert.equal(npc.grounded, true);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(npc.root).min.y - npc.position.y) < 1e-6);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(npc.root).getSize(new THREE.Vector3()).y - 2) < 1e-6);
  for (const direction of [[1, 0, 0], [0, 0, -1], [-1, 0, 0], [0, 0, 1]]) {
    const start = npc.position; npc.setVelocity(direction); advance(world, .25);
    const expected = new THREE.Vector3(...direction);
    assert.ok(npc.position.sub(start).dot(expected) > .2);
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(asset.getWorldQuaternion(new THREE.Quaternion()));
    assert.ok(front.dot(expected) > .999, "visible heading survives body synchronization");
  }
  npc.setVelocity([0, 0, 0]); const idle = npc.root.quaternion.clone(); advance(world, .1);
  assert.ok(idle.angleTo(npc.root.quaternion) < 1e-6);
  npc.faceDirection([-1, 0, 0]); advance(world, .1);
  assert.ok(new THREE.Vector3(0, 0, 1).applyQuaternion(npc.root.quaternion).x < -.999);
  npc.faceDirection([0, 0, 0]); advance(world, .1);
  assert.ok(new THREE.Vector3(0, 0, 1).applyQuaternion(npc.root.quaternion).x < -.999, "a zero direction retains the last heading");
  assert.equal(npc.jump(), true); advance(world, .25); assert.ok(npc.position.y > .7);
  npc.teleport([5, 2, 4]); assert.ok(npc.position.distanceTo(new THREE.Vector3(5, 2, 4)) < .06);
  npc.remove(); assert.equal(npc.root.parent, null); assert.equal(world.getDiagnostics().bodies, 1);

  const reversedAsset = model();
  const reversed = world.addNpc({ model: reversedAsset, modelYaw: Math.PI, autoFaceMovement: false });
  reversed.faceDirection([1, 0, 0]); reversed.setVelocity([0, 0, -1]); advance(world, .25);
  const authoredFront = new THREE.Vector3(0, 0, -1).applyQuaternion(reversedAsset.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(authoredFront.x > .999, "manual facing and a nonstandard asset front remain supported");
});

test("RPG player and NPC feet follow the authored raised slope instead of a separate flat floor", async t => {
  const world = await createRpgWorld({ interpolate: false }); t.after(() => world.dispose());
  const terrain = new THREE.Mesh(new THREE.PlaneGeometry(30, 30, 4, 4));
  terrain.geometry.rotateX(-Math.PI / 2);
  const positions = terrain.geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) positions.setY(i, positions.getX(i) * .12);
  terrain.position.y = 2; world.addStaticMesh(terrain);
  const player = await world.addPlayer({ ...surface(false), model: model(), feet: [-3, 4, 0] });
  const npc = world.addNpc({ model: model(), feet: [3, 4, 0] });
  player.start(); advance(world, 2);
  for (const actor of [player, npc]) {
    assert.equal(actor.grounded, true);
    const surfaceY = 2 + actor.position.x * .12;
    assert.ok(Math.abs(actor.position.y - surfaceY) < .08, `feet ${actor.position.y} match surface ${surfaceY}`);
    assert.ok(Math.abs(new THREE.Box3().setFromObject(actor.root).min.y - actor.position.y) < 1e-6);
    const before = actor.position.y; assert.equal(actor.jump(), true); advance(world, .25);
    assert.ok(actor.position.y > before + .7); advance(world, 2);
    assert.equal(actor.grounded, true);
  }
  const before = npc.position; npc.setVelocity([2, 0, 0]); advance(world, 1);
  assert.ok(npc.position.x > before.x + 1.8);
  assert.ok(npc.position.y > before.y + .2, "walking uphill rises with the visible terrain");
});


test("explicit RPG suspension blocks canvas auto-resume and preserves the camera", async t => {
  const world = await createRpgWorld(); t.after(() => world.dispose());
  const b = surface(); world.addBody({ position: [0, -.5, 0], shape: { type: "box", size: [40, 1, 40] } });
  const player = await world.addPlayer({ ...b, model: model() }); player.start(); advance(world, 1);
  event(b.win, "keydown", { code: "KeyA" }); advance(world, .3); event(b.win, "keyup", { code: "KeyA" });
  const view = b.camera.quaternion.clone(); player.pause();
  event(b.canvas, "click", {}); player.start(); assert.equal(player.active, false);
  player.resume(); advance(world, .1); assert.equal(player.active, true);
  assert.ok(view.angleTo(b.camera.quaternion) < 1e-6);
  player.stop(); player.start(); advance(world, .1);
  assert.ok(view.angleTo(b.camera.quaternion) < 1e-6, "stop/start no longer resets heading");
});

test("RPG left drag orbits independently; right press aligns the hero without resetting the view", async t => {
  const world = await createRpgWorld({ interpolate: false }); t.after(() => world.dispose());
  const b = surface(), selections = [];
  world.addBody({ position: [0, -.5, 0], shape: { type: 'box', size: [60, 1, 60] } });
  const player = await world.addPlayer({ ...b, model: model(), sensitivity: .01, onSelect: v => selections.push(v) });
  player.start(); advance(world, 1);
  const originalFacing = player.body.quaternion, originalView = b.camera.quaternion.clone();
  event(b.canvas, 'pointerdown', { pointerId: 1, button: 0, clientX: 400, clientY: 300 });
  event(b.doc, 'pointermove', { pointerId: 1, buttons: 1, clientX: 403, clientY: 302 });
  assert.ok(originalView.angleTo(b.camera.quaternion) < 1e-6, 'click tolerance does not jitter the view');
  event(b.doc, 'pointermove', { pointerId: 1, buttons: 1, clientX: 550, clientY: 320 });
  advance(world, .1);
  assert.ok(originalView.angleTo(b.camera.quaternion) > 1.4);
  assert.ok(originalFacing.angleTo(player.body.quaternion) < 1e-6);
  const start = player.position;
  player.setAction('forward', true); advance(world, .3); player.setAction('forward', false);
  assert.ok(player.position.z < start.z - 1.4 && Math.abs(player.position.x - start.x) < .01, 'W still follows the hero while looking sideways');
  const orbit = b.camera.quaternion.clone();
  event(b.win, 'keydown', { code: 'KeyA' }); advance(world, .2); event(b.win, 'keyup', { code: 'KeyA' });
  assert.ok(originalFacing.angleTo(player.body.quaternion) > .35);
  assert.ok(orbit.angleTo(b.camera.quaternion) < 1e-6, 'held LMB keeps the view independent of keyboard turning');
  event(b.doc, 'pointerup', { pointerId: 1, button: 0, clientX: 550, clientY: 320 });
  assert.equal(selections.length, 0, 'drag release does not select');
  event(b.canvas, 'pointerdown', { pointerId: 1, button: 2, clientX: 550, clientY: 320 });
  advance(world, .1);
  assert.ok(orbit.angleTo(b.camera.quaternion) < 1e-6, 'right press preserves the view');
  const front = new THREE.Vector3(0, 0, 1).applyQuaternion(player.body.quaternion);
  const look = b.camera.getWorldDirection(new THREE.Vector3()); look.y = 0; look.normalize();
  assert.ok(front.dot(look) > .999);
  event(b.doc, 'pointerup', { pointerId: 1, button: 2, clientX: 550, clientY: 320 });
  event(b.canvas, 'pointerdown', { pointerId: 1, button: 0, clientX: 500, clientY: 300 });
  event(b.doc, 'pointerup', { pointerId: 1, button: 0, clientX: 500, clientY: 300 });
  assert.equal(selections.length, 1, 'ordinary click selection still works after orbiting');
});

test("RPG left/right mouse chording and capture loss do not retain movement or select on release", async t => {
  const world = await createRpgWorld({ interpolate: false }); t.after(() => world.dispose());
  const b = surface(); let selections = 0;
  world.addBody({ position: [0, -.5, 0], shape: { type: 'box', size: [60, 1, 60] } });
  const player = await world.addPlayer({ ...b, model: model(), onSelect: () => selections++ });
  player.start(); advance(world, 1);
  event(b.canvas, 'pointerdown', { pointerId: 1, button: 0, clientX: 400, clientY: 300 });
  event(b.doc, 'pointermove', { pointerId: 1, buttons: 1, clientX: 650, clientY: 300 });
  const view = b.camera.quaternion.clone();
  event(b.doc, 'pointermove', { pointerId: 1, buttons: 3, clientX: 650, clientY: 300 });
  const start = player.position; advance(world, .2);
  assert.ok(player.position.distanceTo(start) > .9);
  assert.ok(view.angleTo(b.camera.quaternion) < 1e-6);
  event(b.doc, 'pointermove', { pointerId: 1, buttons: 1, clientX: 650, clientY: 300 });
  const facing = player.body.quaternion;
  event(b.doc, 'pointermove', { pointerId: 1, buttons: 1, clientX: 750, clientY: 300 });
  advance(world, .1); assert.ok(facing.angleTo(player.body.quaternion) < 1e-6);
  event(b.canvas, 'lostpointercapture', {});
  const stopped = player.position, camera = b.camera.quaternion.clone();
  event(b.doc, 'pointermove', { pointerId: 1, buttons: 3, clientX: 950, clientY: 500 }); advance(world, .3);
  assert.ok(stopped.distanceTo(player.position) < .01); assert.ok(camera.angleTo(b.camera.quaternion) < 1e-6);
  event(b.doc, 'pointerup', { pointerId: 1, button: 0, clientX: 950, clientY: 500 }); assert.equal(selections, 0);
});
