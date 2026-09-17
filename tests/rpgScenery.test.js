import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createRpgWorld } from "../src/rpg.js";
import { createRpgScenery } from "../src/rpgScenery.js";

const mesh = (size, position) => {
  const object = new THREE.Mesh(new THREE.BoxGeometry(...size));
  object.position.fromArray(position);
  return object;
};
async function setup(t) {
  const scene = new THREE.Scene(), world = await createRpgWorld({ interpolate: false });
  const scenery = createRpgScenery(scene, world);
  t.after(() => { world.dispose(); scene.traverse(n => { n.geometry?.dispose(); n.material?.dispose(); }); });
  return { scene, world, scenery };
}

test("directly authored terrain, trees, rocks and structures collide while doorways stay open", async t => {
  const { scene, world, scenery } = await setup(t);
  scene.add(mesh([40, 1, 40], [0, -.5, 0]));
  const tree = new THREE.Group(); tree.position.set(-5, 0, 2); tree.scale.set(2, 1, 1);
  tree.add(mesh([.5, 4, .5], [0, 2, 0])); scene.add(tree);
  scene.add(mesh([2, 1, 2], [5, .5, 2]));
  const arch = new THREE.Group(); arch.position.set(0, 0, -5);
  arch.add(mesh([1, 4, 1], [-2, 2, 0]), mesh([1, 4, 1], [2, 2, 0]), mesh([5, 1, 1], [0, 4, 0]));
  scene.add(arch, mesh([2, .25, 1], [5, .125, -5]));
  scenery.finalize();
  assert.ok(world.castRay([-7, 1, 2], [1, 0, 0], { maxDistance: 3 }));
  assert.ok(world.castRay([3, .5, 2], [1, 0, 0], { maxDistance: 3 }));
  assert.ok(world.castRay([-2, 1, -3], [0, 0, -1], { maxDistance: 4 }));
  assert.equal(world.castRay([0, 1, -3], [0, 0, -1], { maxDistance: 4 }), null);
  assert.ok(Math.abs(world.castRay([5, 2, -5], [0, -1, 0]).distance - 1.75) < 1e-5);
  const actor = world.addCharacter({ position: [-7, 1, 2], radius: .35, height: 1.1 });
  actor.setVelocity([3, 0, 0]);
  for (let i = 0; i < 120; i++) world.advance(1 / 60);
  assert.ok(actor.position.x < -5.8 && actor.position.x > -6, `trunk stop ${actor.position.x}`);
  actor.teleport([0, 1, -3]); actor.setVelocity([0, 0, -3]);
  for (let i = 0; i < 90; i++) world.advance(1 / 60);
  assert.ok(actor.position.z < -6, `doorway passage ${actor.position.z}`);
});

test("solid props default to collision; decoration and foliage opt out without duplicate bodies or removal ghosts", async t => {
  const { scene, world, scenery } = await setup(t);
  const floor = mesh([30, 1, 30], [0, -.5, 0]);
  const floorBody = scenery.addSurface(floor);
  assert.equal(scenery.addStaticMesh(floor), floorBody);
  const tree = new THREE.Group(), trunk = mesh([1, 3, 1], [0, 1.5, 0]), crown = mesh([4, 3, 4], [0, 4, 0]);
  crown.userData.rpgCollider = false; tree.add(trunk, crown);
  scenery.addProp(tree, { position: [3, 0, 0] });
  scenery.addDecoration(mesh([2, 2, 2], [-3, 1, 0]));
  scenery.addProp(mesh([2, 2, 2], [-6, 1, 0]), { collider: false });
  const explicit = mesh([1, 2, 1], [0, 1, -4]); scene.add(explicit);
  scenery.addStaticMesh(explicit, { data: { authored: true } });
  scenery.finalize(); scenery.finalize();
  assert.equal(world.getDiagnostics().bodies, 3);
  assert.equal(world.castRay([1, 4, 0], [1, 0, 0], { maxDistance: 5 }), null);
  assert.equal(world.castRay([-8, 1, 0], [1, 0, 0], { maxDistance: 8 }), null);
  assert.equal(world.castRay([0, 1, -2], [0, 0, -1], { maxDistance: 4 }).body.data.authored, true);
  scenery.addProp(tree, { position: [6, 0, 0] });
  assert.equal(world.castRay([1, 1, 0], [1, 0, 0], { maxDistance: 3 }), null);
  assert.ok(world.castRay([4, 1, 0], [1, 0, 0], { maxDistance: 3 }));
  assert.equal(world.getDiagnostics().bodies, 3);
  scenery.removeProp(tree);
  assert.equal(world.castRay([4, 1, 0], [1, 0, 0], { maxDistance: 3 }), null);
  assert.equal(world.getDiagnostics().bodies, 2);
});

test("instanced and morphed static props snapshot their visible transforms without changing their art", async t => {
  const { scene, world, scenery } = await setup(t);
  const instances = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial(), 2);
  instances.position.set(4, 0, 2); instances.scale.set(-2, 1, 1);
  instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 1, 0));
  instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(3, 1, 0));
  scene.add(instances);
  const morphed = mesh([1, 2, 1], [0, 1, -4]), original = morphed.geometry.attributes.position.array.slice();
  const target = morphed.geometry.attributes.position.clone();
  for (let i = 0; i < target.count; i++) target.setX(i, target.getX(i) + 3);
  morphed.geometry.morphAttributes.position = [target]; morphed.updateMorphTargets(); morphed.morphTargetInfluences[0] = 1;
  scene.add(morphed); scenery.finalize();
  assert.ok(world.castRay([4, 1, 0], [0, 0, 1], { maxDistance: 4 }));
  assert.ok(world.castRay([-2, 1, 0], [0, 0, 1], { maxDistance: 4 }));
  assert.equal(world.castRay([0, 1, -2], [0, 0, -1], { maxDistance: 4 }), null);
  assert.ok(world.castRay([3, 1, -2], [0, 0, -1], { maxDistance: 4 }));
  assert.deepEqual(morphed.geometry.attributes.position.array, original);
  assert.equal(scene.children.length, 2);
});
