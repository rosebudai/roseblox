import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { World } from "miniplex";
import { createCameraObstacles } from "../src/resources/cameraObstacles.js";

const hit = controls => new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1)).intersectObjects(controls.colliderMeshes)[0];
const transform = z => ({ position: new THREE.Vector3(0, 0, z), rotation: new THREE.Quaternion() });
const fixed = () => ({ rigidBody: { isValid: () => true, isFixed: () => true }, collider: { isSensor: () => false } });

test("fixed proxies use current transforms and exclude the followed entity, actors and sensors", () => {
  const world = new World(), controls = { colliderMeshes: [] }, registry = createCameraObstacles(world, controls);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const entity = { mesh, renderable: { mesh }, transform: transform(5), physicsBody: fixed() };
  world.add(entity);
  registry.register(mesh, { owner: entity, primitive: true });
  assert.equal(hit(controls), undefined, "follow-only geometry is inactive outside follow mode");
  registry.setFollowTarget({});
  assert.equal(hit(controls).distance, 4.5);
  entity.transform.position.z = 3;
  registry.sync();
  assert.equal(hit(controls).distance, 2.5, "no render frame or matrix traversal is needed after teleport");
  registry.setFollowTarget(entity); assert.equal(hit(controls), undefined);
  registry.setFollowTarget({});
  entity.physicsBody.collider.isSensor = () => true; registry.sync(); assert.equal(hit(controls), undefined);
  entity.physicsBody.collider.isSensor = () => false;
  entity.physicsBody.rigidBody.isFixed = () => false; registry.sync(); assert.equal(hit(controls), undefined);
  entity.physicsBody.rigidBody.isFixed = () => true; registry.sync(); assert.ok(hit(controls));
  world.remove(entity); assert.equal(hit(controls), undefined);
  registry.dispose(); mesh.geometry.dispose(); mesh.material.dispose();
});

test("camera registry never disposes borrowed scene geometry/materials and preserves external entries", () => {
  const world = new World(), external = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const controls = { colliderMeshes: [external] }, registry = createCameraObstacles(world, controls);
  const source = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); source.position.z = 4;
  let geometryDisposed = 0, materialDisposed = 0, proxyDisposed = 0;
  source.geometry.addEventListener("dispose", () => geometryDisposed++); source.material.addEventListener("dispose", () => materialDisposed++);
  const unregister = registry.register(source); registry.setFollowTarget({});
  controls.colliderMeshes[1].material.addEventListener("dispose", () => proxyDisposed++);
  unregister(); unregister(); registry.dispose(); registry.dispose();
  assert.equal(geometryDisposed, 0); assert.equal(materialDisposed, 0); assert.equal(proxyDisposed, 1);
  assert.deepEqual(controls.colliderMeshes, [external]);
  source.geometry.dispose(); source.material.dispose(); external.geometry.dispose(); external.material.dispose();
});

test("instanced obstacles raycast real instance placement, include inside back faces, and release independently", () => {
  const world = new World(), controls = { colliderMeshes: [] }, registry = createCameraObstacles(world, controls);
  const source = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
  source.setMatrixAt(0, new THREE.Matrix4().makeTranslation(20, 0, 5));
  source.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0, 0, 5)); source.computeBoundingSphere();
  const release = registry.register(source); registry.setFollowTarget({}); assert.equal(hit(controls).distance, 4.5);
  const inside = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 1)).intersectObjects(controls.colliderMeshes)[0];
  assert.equal(inside.distance, .5);
  release(); assert.equal(hit(controls), undefined);
  registry.dispose(); source.dispose(); source.geometry.dispose(); source.material.dispose();
});

test("legacy terrain registers before or after setup, removes immediately and stays isolated between games", () => {
  const firstWorld = new World(), secondWorld = new World();
  const geometry = new THREE.BoxGeometry().translate(0, 0, 3);
  const first = { isTerrain: { collisionGeometry: geometry } }, second = { isTerrain: { collisionGeometry: geometry } };
  firstWorld.add(first);
  const a = { colliderMeshes: [] }, b = { colliderMeshes: [] };
  const ra = createCameraObstacles(firstWorld, a), rb = createCameraObstacles(secondWorld, b);
  secondWorld.add(second);
  assert.equal(hit(a).distance, 2.5); assert.equal(hit(b).distance, 2.5);
  firstWorld.remove(first); assert.equal(hit(a), undefined); assert.equal(hit(b).distance, 2.5);
  ra.dispose(); assert.equal(hit(b).distance, 2.5); rb.dispose(); geometry.dispose();
});

test("late legacy components and collision-geometry replacement retire stale proxies", () => {
  const world = new World(), controls = { colliderMeshes: [] }, registry = createCameraObstacles(world, controls);
  const entity = {}; world.add(entity);
  world.addComponent(entity, "isTerrain", {}); registry.sync(); assert.equal(hit(controls), undefined);
  const first = new THREE.BoxGeometry().translate(0, 0, 3), second = new THREE.BoxGeometry().translate(0, 0, 6);
  entity.isTerrain.collisionGeometry = first; registry.sync(); assert.equal(hit(controls).distance, 2.5);
  entity.isTerrain.collisionGeometry = second; registry.sync(); assert.equal(hit(controls).distance, 5.5);
  assert.equal(controls.colliderMeshes.length, 1);
  delete entity.isTerrain.collisionGeometry; registry.sync(); assert.equal(hit(controls), undefined);
  entity.isTerrain.collisionGeometry = first; registry.sync();
  world.removeComponent(entity, "isTerrain"); assert.equal(hit(controls), undefined);
  registry.dispose(); first.dispose(); second.dispose();
});
