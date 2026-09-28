import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { World } from "miniplex";
import { createTransform } from "../src/components/transform.js";
import { transformSyncSystem } from "../src/systems/transformSyncSystem.js";

test("Three-style quaternion aiming survives engine transform synchronization", () => {
  const world = new World();
  const mesh = new THREE.Object3D();
  const transform = createTransform(new THREE.Vector3(2, 3, 4));
  world.add({ transform, renderable: { mesh } });
  const direction = new THREE.Vector3(1, 0.4, -2).normalize();
  transform.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  // An actual engine frame must preserve the requested tracer orientation.
  transformSyncSystem(world);
  transformSyncSystem(world);
  assert.ok(new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion).distanceTo(direction) < 1e-10);
  assert.deepEqual(mesh.position.toArray(), [2, 3, 4]);
});

test("quaternion assignment keeps owned rotation storage and the legacy rotation API", () => {
  const source = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);
  const first = createTransform(undefined, source);
  const second = createTransform(undefined, source);
  const owned = first.rotation;
  first.quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 1.2);
  assert.equal(first.rotation, owned);
  assert.equal(first.quaternion, first.rotation);
  assert.ok(second.rotation.angleTo(source) < 1e-10);
  assert.ok(first.rotation.angleTo(second.rotation) > 0.5);
  first.rotation = source.clone();
  assert.equal(first.quaternion, first.rotation);
  first.rotation.identity();
  assert.ok(source.angleTo(second.rotation) < 1e-10);
  assert.ok(first.quaternion.angleTo(new THREE.Quaternion()) < 1e-10);
});
