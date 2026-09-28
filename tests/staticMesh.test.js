import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createMechanics } from "../src/mechanics.js";

test("static mesh collisions match indexed/nonindexed transformed art, including mirrored parents, without changing it", async t => {
  const m = await createMechanics(); t.after(() => m.dispose());
  for (const indexed of [true, false]) {
    const root = new THREE.Group(); root.position.set(indexed ? 10 : -10, 2, 4); root.rotation.y = .5; root.scale.set(-2, 1, 3);
    const geometry = new THREE.BoxGeometry(2, .4, 2), material = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(indexed ? geometry : geometry.toNonIndexed(), material); mesh.rotation.z = .15; root.add(mesh);
    const bytes = mesh.geometry.getAttribute("position").array.slice(), pose = mesh.position.clone();
    const collider = m.addStaticMesh(mesh, { data: { track: true } });
    const ray = new THREE.Raycaster(new THREE.Vector3(root.position.x, 8, 4), new THREE.Vector3(0, -1, 0));
    const visual = ray.intersectObject(mesh)[0], hit = m.castRay(ray.ray.origin, ray.ray.direction);
    assert.equal(hit.body, collider); assert.ok(hit.point.distanceTo(visual.point) < 1e-5);
    assert.deepEqual(mesh.geometry.getAttribute("position").array, bytes); assert.deepEqual(mesh.position, pose);
    collider.remove(); assert.equal(mesh.parent, root); mesh.geometry.dispose(); material.dispose(); geometry.dispose();
  }
});

for (const reversed of [false, true]) test(`vehicle drives across ${reversed ? "downward-wound" : "upward-wound"} mesh road with elevation and internal triangle seams`, async t => {
  const m = await createMechanics({ interpolate: false }); t.after(() => m.dispose());
  const geometry = new THREE.PlaneGeometry(20, 100, 4, 100); geometry.rotateX(-Math.PI / 2);
  const points = geometry.getAttribute("position");
  for (let i = 0; i < points.count; i++) points.setY(i, .6 * Math.sin(-points.getZ(i) * .08));
  if (reversed) { const indices = geometry.index.array; for (let i = 0; i < indices.length; i += 3) [indices[i], indices[i + 1]] = [indices[i + 1], indices[i]]; }
  const mesh = new THREE.Mesh(geometry); m.addStaticMesh(mesh, { surfaceUp: [0, 1, 0] });
  const car = await m.addArcadeVehicle({ position: [0, .8, 35], maxSpeed: 15 });
  for (let i = 0; i < 60; i++) m.advance(1 / 60); car.start(); car.setControls({ throttle: 1 });
  let minimumSpeed = Infinity;
  for (let i = 0; i < 240; i++) { m.advance(1 / 60); if (i > 90) minimumSpeed = Math.min(minimumSpeed, car.speed); }
  assert.ok(car.position.z < -14, `progress ${car.position.z}`);
  assert.ok(minimumSpeed > 12, `internal seam slowdown ${minimumSpeed}`);
  const roadHeight = .6 * Math.sin(-car.position.z * .08);
  assert.ok(Math.abs(car.position.y - .4 - roadHeight) < .12, `road offset ${car.position.y - .4 - roadHeight}`);
  geometry.dispose(); mesh.material.dispose();
});

test("invalid collision geometry fails without leaving bodies or borrowing mutable geometry", async t => {
  const m = await createMechanics(); t.after(() => m.dispose());
  const mesh = new THREE.Mesh(new THREE.BoxGeometry());
  mesh.scale.y = 0; assert.throws(() => m.addStaticMesh(mesh), /transform/);
  mesh.scale.y = 1; mesh.geometry.setIndex([0, 1, 999]); assert.throws(() => m.addStaticMesh(mesh), /bounds/);
  assert.throws(() => m.addStaticMesh(new THREE.Group()), /static/);
  assert.equal(m.getDiagnostics().bodies, 0); mesh.geometry.dispose(); mesh.material.dispose();
});
