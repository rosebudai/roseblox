import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createMechanics } from "../src/mechanics.js";

function surface() {
  const doc = new EventTarget(), win = new EventTarget(); doc.defaultView = win; doc.hidden = false;
  class Canvas extends EventTarget {
    ownerDocument = doc; tabIndex = -1;
    getAttribute() { return null; } removeAttribute() { this.tabIndex = -1; }
    focus() { doc.activeElement = this; }
  }
  return { canvas: new Canvas(), camera: new THREE.PerspectiveCamera(65, 16 / 9, .1, 500), doc, win };
}
function event(target, name, values = {}) {
  const e = new Event(name, { cancelable: true });
  for (const [key, value] of Object.entries(values)) Object.defineProperty(e, key, { value });
  target.dispatchEvent(e); return e;
}
const advance = (m, seconds, hz = 60) => { for (let i = 0; i < Math.round(seconds * hz); i++) m.advance(1 / hz); };
async function fixture(t, config = {}) {
  const m = await createMechanics({ interpolate: false }); t.after(() => m.dispose());
  m.addBody({ shape: { type: "box", size: [1000, 1, 1000] }, position: [0, -.5, 0] });
  const car = await m.addArcadeVehicle(config); advance(m, .5); car.start();
  return { m, car };
}

test("vehicle speed and displacement are independent of render rate, with bounded forward/reverse speeds", async t => {
  const poses = [];
  for (const hz of [30, 60, 144]) {
    const { m, car } = await fixture(t);
    car.setControls({ throttle: 1 }); advance(m, 4, hz);
    assert.ok(car.speed > 31 && car.speed <= 32.01, `speed ${car.speed}`);
    assert.ok(car.position.z < -80); poses.push(car.position);
    car.setControls({ throttle: -1 }); advance(m, .5, hz);
    assert.ok(car.speed > 10, "reverse first brakes, without flipping forward momentum");
    advance(m, 4, hz); assert.ok(car.speed < -9 && car.speed >= -10.01);
  }
  for (const p of poses) assert.ok(p.distanceTo(poses[0]) < 1e-4);
});

test("right and left steering have the expected signs, reverse steering flips, and rest cannot pivot", async t => {
  for (const [throttle, steer, expectedX] of [[1, 1, 1], [1, -1, -1], [-1, 1, 1]]) {
    const { m, car } = await fixture(t);
    car.setControls({ steer }); advance(m, .5);
    assert.ok(car.quaternion.angleTo(new THREE.Quaternion()) < 1e-5);
    car.setControls({ throttle, steer }); advance(m, 1);
    assert.ok(car.position.x * expectedX > .5, `${throttle}, ${steer}: ${car.position.x}`);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(car.quaternion);
    assert.ok(forward.x * steer * throttle > .2);
  }
});

test("dynamic collision stops a fast chassis at thin cover and reports checkpoint sensors", async t => {
  const { m, car } = await fixture(t, { maxSpeed: 100, acceleration: 200 });
  const sensor = m.addBody({ position: [0, 1, -4], shape: { type: "box", size: [10, 4, 1] }, sensor: true });
  const wall = m.addBody({ position: [0, 1, -14], shape: { type: "box", size: [30, 4, .1] } });
  const events = []; m.onCollision(e => events.push(e));
  car.setControls({ throttle: 1 }); advance(m, 2);
  assert.ok(car.position.z > -12.3, `wall penetration: ${car.position.z}`);
  assert.ok(Math.abs(car.speed) < 1, "drive reads solver velocity after impact");
  assert.ok(events.some(e => e.type === "start" && [e.a, e.b].includes(sensor) && [e.a, e.b].includes(car)));
  assert.ok(events.some(e => e.type === "start" && [e.a, e.b].includes(wall) && [e.a, e.b].includes(car)));
  const q = car.quaternion; assert.ok(Math.abs(q.x) + Math.abs(q.z) < 1e-5, "chassis remains upright");
});

test("handbrake retains more sideways motion, explicit brake stops, and airborne throttle cannot fly", async t => {
  const sideways = [];
  for (const handbrake of [false, true]) {
    const { m, car } = await fixture(t);
    car.setVelocity([10, 0, -10]); car.setControls({ handbrake }); advance(m, .25);
    sideways.push(car.position.x);
    car.setControls({ brake: 1 }); advance(m, 1);
    assert.ok(Math.abs(car.speed) < .1);
  }
  assert.ok(sideways[1] > sideways[0] * 1.4);
  const { m, car } = await fixture(t, { position: [0, 20, 0] });
  car.setControls({ throttle: 1, steer: 1 }); const p = car.position; advance(m, .25);
  assert.equal(car.grounded, false); assert.ok(car.position.y < p.y);
  assert.ok(Math.abs(car.position.x) + Math.abs(car.position.z) < 1e-6);
  assert.ok(car.quaternion.angleTo(new THREE.Quaternion()) < 1e-6);
});

test("focus, pause and reset clear controls, resume does not require pointer lock, teardown releases ownership", async t => {
  const browser = surface(), { m, car } = await fixture(t, browser);
  assert.equal(car.active, true); assert.equal(browser.doc.activeElement, browser.canvas);
  event(browser.win, "keydown", { code: "KeyW" }); advance(m, .5); assert.ok(car.speed > 5);
  event(browser.win, "blur"); assert.equal(car.active, false);
  const speed = car.speed; advance(m, .25); assert.ok(car.speed < speed);
  event(browser.canvas, "mousedown"); assert.equal(car.active, true);
  event(browser.win, "keydown", { code: "Escape" }); event(browser.win, "keyup", { code: "Escape" });
  assert.equal(car.active, false, "a quick Escape tap pauses without waiting for a physics step");
  car.start();
  car.reset(); assert.ok(Math.abs(car.speed) < 1e-8); advance(m, .5); assert.ok(Math.abs(car.speed) < .01);
  car.setControls({ throttle: 1 }); advance(m, .4);
  event(browser.win, "keydown", { code: "KeyR", repeat: false }); assert.ok(Math.abs(car.position.z) < .001);
  car.setControls({ throttle: 1 }); advance(m, .3); const afterReset = car.position.z;
  event(browser.win, "keydown", { code: "KeyR", repeat: true }); assert.equal(car.position.z, afterReset);
  car.reset(); advance(m, .5);
  browser.doc.activeElement = { tagName: "INPUT" };
  assert.equal(event(browser.win, "keydown", { code: "KeyW", target: browser.doc.activeElement }).defaultPrevented, false);
  advance(m, .2); assert.ok(Math.abs(car.speed) < .01);
  browser.canvas.focus(); car.setControls({ throttle: 1 });
  const p = car.position, steps = m.getDiagnostics().fixedSteps;
  m.advance(20, { paused: true }); assert.deepEqual(car.position, p); assert.equal(m.getDiagnostics().fixedSteps, steps);
  m.advance(1 / 60); advance(m, .2); assert.ok(Math.abs(car.speed) < .01);
  await assert.rejects(m.addArcadeVehicle(browser), /existing controller/);
  await assert.rejects(m.addFpsPlayer(browser), /existing FPS/);
  car.remove(); assert.equal(browser.canvas.tabIndex, -1);
  const replacement = await m.addArcadeVehicle(browser); replacement.start(); assert.equal(replacement.active, true);
  m.dispose(); assert.equal(browser.canvas.tabIndex, -1);
  assert.throws(() => replacement.setControls({ throttle: 1 }), /disposed/);
});

test("ground probes ignore sensors and collision-filtered floors; gentle ramps remain driveable", async t => {
  const m = await createMechanics(); t.after(() => m.dispose());
  m.addBody({ shape: { type: "box", size: [100, 1, 100] }, position: [0, -.5, 0], collisionGroups: 0x00020002 });
  m.addBody({ shape: { type: "box", size: [100, 1, 100] }, position: [0, -.5, 0], sensor: true });
  const falling = await m.addArcadeVehicle({ position: [0, .45, 0], collisionGroups: 0x00010001 });
  falling.start(); falling.setControls({ throttle: 1 }); advance(m, .1);
  assert.equal(falling.grounded, false); assert.ok(Math.abs(falling.position.z) < 1e-6);
  const f = await fixture(t, { maxSpeed: 8 });
  f.m.addBody({ shape: { type: "box", size: [12, .3, 20] }, position: [0, 1.05, -14], quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .12) });
  f.car.setControls({ throttle: 1 }); advance(f.m, 2.5);
  assert.ok(f.car.position.z < -12, `ramp progress ${f.car.position.z}`);
  assert.ok(f.car.position.y > 1, `ramp height ${f.car.position.y}`);
});

test("chase camera stays above the chassis, retracts at cover and snaps on reset without changing art", async t => {
  const browser = surface(), { m, car } = await fixture(t, browser);
  const group = new THREE.Group(), child = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: "red" }));
  child.position.y = -.4; child.rotation.y = Math.PI; group.add(child); car.bindObject(group);
  const color = child.material.color.clone(), childPose = child.position.clone();
  assert.ok(browser.camera.position.y > car.position.y + 3);
  assert.ok(browser.camera.position.z > car.position.z + 6);
  const wall = m.addBody({ position: [0, 2, 3], shape: { type: "box", size: [20, 8, .5] } });
  m.advance(0); assert.ok(browser.camera.position.z < 2.6);
  wall.remove(); car.reset([20, 1, 20], Math.PI);
  assert.deepEqual(group.position.toArray(), [20, 1, 20]);
  assert.ok(browser.camera.position.z < 14 && browser.camera.position.y > 4);
  assert.ok(browser.camera.getWorldDirection(new THREE.Vector3()).z > .7);
  assert.deepEqual(child.position, childPose); assert.deepEqual(child.material.color, color);
  car.remove(); assert.equal(child.parent, group);
  child.geometry.dispose(); child.material.dispose();
});

test("invalid config fails before claiming resources; input initialization can be disposed safely", async t => {
  const m = await createMechanics(); t.after(() => m.dispose()); const browser = surface();
  for (const config of [{ acceleration: NaN }, { size: [-1, 1, 1] }, { heading: Infinity }]) {
    await assert.rejects(m.addArcadeVehicle({ ...browser, ...config })); assert.equal(m.getDiagnostics().bodies, 0);
  }
  const car = await m.addArcadeVehicle(browser);
  assert.throws(() => car.setControls({ throttle: NaN }), /finite/); car.remove();
  const pending = m.addArcadeVehicle(browser); m.dispose();
  await assert.rejects(pending, /removed during input initialization/);
  assert.equal(browser.canvas.tabIndex, -1);
});
