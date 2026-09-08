import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { World } from "miniplex";
import { sceneManagementSystem, setupSceneManagement } from "../src/systems/sceneManagementSystem.js";
import { triggerDetectionSystem } from "../src/systems/triggerDetectionSystem.js";
import { animationSetupSystem } from "../src/systems/animationSetupSystem.js";
import { collisionSystem, setControllerContacts } from "../src/systems/collisionSystem.js";

function fixture() {
  const world = new World();
  const scene = new THREE.Scene();
  const removedBodies = [];
  const renderer = { scene, getMeshFactory() {} };
  const physics = { world: { removeRigidBody(body) { removedBodies.push(body); } } };
  return { world, scene, renderer, physics, assets: {}, removedBodies };
}

test("trigger memberships exit immediately on entity, detector and zone removal", () => {
  const world = new World();
  const zone = world.add({ transform: { position: new THREE.Vector3() }, triggerZone: { radius: 2 } });
  const events = [];
  const bus = { emit(type) { events.push(type); } };
  for (let i = 0; i < 100; i++) {
    const actor = world.add({ transform: { position: new THREE.Vector3() }, triggerDetector: { radius: .5 } });
    triggerDetectionSystem(world, bus);
    if (i % 2) world.removeComponent(actor, "triggerDetector");
    world.remove(actor);
    assert.equal(zone.triggerZone.currentlyInside.size, 0);
  }
  const actor = world.add({ transform: { position: new THREE.Vector3() }, triggerDetector: { radius: .5 } });
  triggerDetectionSystem(world, bus);
  const component = zone.triggerZone;
  world.removeComponent(zone, "triggerZone");
  assert.equal(component.currentlyInside.size, 0);
  world.remove(actor);
  assert.equal(events.filter(e => e === "trigger-entered").length, 101);
  assert.equal(events.filter(e => e === "trigger-exited").length, 101);
});

test("physics and controller contacts share one transition until the final source leaves", () => {
  const world = new World();
  const a = world.add({ physicsBody: {} }), b = world.add({ physicsBody: {} });
  const colliders = new Map([[1, { userData: { entity: a } }], [2, { userData: { entity: b } }]]);
  let queue = [[1, 2, true]];
  const physics = { world: { getCollider: handle => colliders.get(handle) }, eventQueue: { drainCollisionEvents(fn) { for (const event of queue) fn(...event); queue = []; } } };
  const events = []; const eventBus = { emit(type) { events.push(type); } };
  setControllerContacts(physics, [{ entityA: b, entityB: a, controllerCollision: true }]);
  collisionSystem(world, { physics, eventBus });
  setControllerContacts(physics, []);
  collisionSystem(world, { physics, eventBus });
  assert.deepEqual(events, ["collision-started"]);
  queue = [[1, 2, false]];
  collisionSystem(world, { physics, eventBus });
  collisionSystem(world, { physics, eventBus });
  assert.deepEqual(events, ["collision-started", "collision-ended"]);
});

test("owned instanced meshes release instance buffers and shared geometry exactly once", () => {
  const game = fixture();
  const lifecycle = setupSceneManagement(game.world, game);
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  const parent = new THREE.Group();
  const first = new THREE.InstancedMesh(geometry, material, 2);
  const second = new THREE.InstancedMesh(geometry, material, 3);
  parent.add(first, second);
  const released = { first: 0, second: 0, geometry: 0, material: 0 };
  for (const [key, resource] of Object.entries({ first, second, geometry, material })) resource.addEventListener("dispose", () => released[key]++);
  game.scene.add(parent);
  const entity = game.world.add({ renderable: { mesh: parent, needsMesh: false } });
  game.world.remove(entity);
  lifecycle.dispose();
  assert.deepEqual(released, { first: 1, second: 1, geometry: 1, material: 1 });
});

test("supplied meshes and physics bodies clean up only in their owning game", () => {
  const first = fixture();
  const second = fixture();
  function add(game) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    let releases = 0;
    mesh.geometry.addEventListener("dispose", () => releases++);
    game.scene.add(mesh);
    const entity = game.world.add({ renderable: { mesh, needsMesh: false }, physicsBody: { rigidBody: { isValid: () => true } } });
    return { entity, mesh, releases: () => releases };
  }
  const a = add(first);
  const b = add(second);
  sceneManagementSystem(first.world, first);
  sceneManagementSystem(second.world, second);
  first.world.remove(a.entity);
  sceneManagementSystem(first.world, first);
  assert.equal(first.scene.children.length, 0);
  assert.equal(a.releases(), 1);
  assert.deepEqual(first.removedBodies, [a.entity.physicsBody.rigidBody]);
  assert.equal(second.scene.children[0], b.mesh);
  assert.equal(b.releases(), 0);
  sceneManagementSystem(first.world, first);
  assert.equal(a.releases(), 1);
  second.world.remove(b.entity);
  sceneManagementSystem(second.world, second);
});

test("removing a GLTF clone does not dispose buffers shared by another clone", () => {
  const game = fixture();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  let releases = 0;
  mesh.geometry.addEventListener("dispose", () => releases++);
  const other = mesh.clone();
  game.scene.add(mesh, other);
  const entity = game.world.add({ renderable: { type: "gltf", mesh } });
  game.world.add({ renderable: { type: "gltf", mesh: other } });
  sceneManagementSystem(game.world, game);
  game.world.remove(entity);
  sceneManagementSystem(game.world, game);
  assert.equal(releases, 0);
  assert.equal(other.parent, game.scene);
  mesh.geometry.dispose();
  mesh.material.dispose();
});

for (const replacementType of [null, "procedural"]) {
  test(`removing a GLTF ${replacementType ? "mesh during procedural replacement" : "renderable component"} preserves shared resources`, () => {
    const game = fixture();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const other = mesh.clone();
    let releases = 0;
    mesh.geometry.addEventListener("dispose", () => releases++);
    mesh.material.addEventListener("dispose", () => releases++);
    game.scene.add(mesh, other);
    const entity = game.world.add({ renderable: { type: "gltf", mesh } });
    game.world.add({ renderable: { type: "gltf", mesh: other } });
    sceneManagementSystem(game.world, game);

    game.world.removeComponent(entity, "renderable");
    let replacement;
    if (replacementType) {
      replacement = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
      game.scene.add(replacement);
      game.world.addComponent(entity, "renderable", { type: replacementType, mesh: replacement });
    }
    sceneManagementSystem(game.world, game);
    assert.equal(mesh.parent, null);
    assert.equal(other.parent, game.scene);
    assert.equal(releases, 0);
    if (replacement) assert.equal(replacement.parent, game.scene);
    game.world.remove(entity);
    assert.equal(releases, 0);
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
}

test("replacing a procedural mesh with GLTF releases the old owned resources once", () => {
  const game = fixture();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const gltf = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  let geometryReleases = 0;
  let materialReleases = 0;
  let gltfReleases = 0;
  mesh.geometry.addEventListener("dispose", () => geometryReleases++);
  mesh.material.addEventListener("dispose", () => materialReleases++);
  gltf.geometry.addEventListener("dispose", () => gltfReleases++);
  gltf.material.addEventListener("dispose", () => gltfReleases++);
  game.scene.add(mesh);
  const entity = game.world.add({ renderable: { type: "procedural", mesh } });
  sceneManagementSystem(game.world, game);
  game.world.removeComponent(entity, "renderable");
  game.world.addComponent(entity, "renderable", { type: "gltf", mesh: gltf });
  game.scene.add(gltf);

  sceneManagementSystem(game.world, game);
  assert.equal(mesh.parent, null);
  assert.equal(gltf.parent, game.scene);
  assert.equal(geometryReleases, 1);
  assert.equal(materialReleases, 1);
  assert.equal(gltfReleases, 0);
  game.world.remove(entity);
  sceneManagementSystem(game.world, game);
  assert.equal(geometryReleases, 1);
  assert.equal(materialReleases, 1);
  assert.equal(gltfReleases, 0);
  gltf.geometry.dispose();
  gltf.material.dispose();
});

for (const initialized of [false, true]) {
test(`replacement mesh preserves its animation while the old ${initialized ? "initialized" : "pending"} mixer stops`, () => {
  const game = fixture();
  const oldMesh = new THREE.Object3D();
  const newMesh = new THREE.Object3D();
  const clip = new THREE.AnimationClip("move", 1, [
    new THREE.NumberKeyframeTrack(".position[x]", [0, 1], [0, 1]),
  ]);
  const oldMixer = new THREE.AnimationMixer(oldMesh);
  const newMixer = new THREE.AnimationMixer(newMesh);
  const oldAction = oldMixer.clipAction(clip).play();
  const newAction = newMixer.clipAction(clip).play();
  game.scene.add(oldMesh);
  const entity = game.world.add({
    renderable: { type: "gltf", mesh: oldMesh },
    animationData: { mixer: oldMixer, animations: [clip] },
  });
  sceneManagementSystem(game.world, game);
  if (initialized) animationSetupSystem(game.world);
  game.renderer.getMeshFactory = () => (owner) => {
    // A replacement GLTF factory attaches its new animationData before the
    // frame's cleanup releases the previously tracked mesh.
    owner.animationData = { mixer: newMixer, animations: [clip] };
    return newMesh;
  };
  game.world.removeComponent(entity, "renderable");
  game.world.addComponent(entity, "renderable", { type: "gltf", needsMesh: true });
  sceneManagementSystem(game.world, game);
  animationSetupSystem(game.world);

  assert.equal(oldMesh.parent, null);
  assert.equal(newMesh.parent, game.scene);
  assert.deepEqual({ old: oldAction.isRunning(), replacement: newAction.isRunning() }, { old: false, replacement: true });
  assert.ok(entity.animationMixer.mixer === newMixer, "replacement mixer must be scheduled for updates");
  assert.equal(entity.animationData, undefined);
  game.world.remove(entity);
  assert.equal(newAction.isRunning(), false);
});
}

test("unknown mesh factories produce actionable errors", () => {
  const game = fixture();
  game.world.add({ renderable: { type: "typo", needsMesh: true } });
  assert.throws(() => sceneManagementSystem(game.world, game), /No mesh factory.*typo.*Register/);
});

test("trigger detection distinguishes entities that have no synthetic id", () => {
  const world = new World();
  world.add({ transform: { position: new THREE.Vector3() }, triggerZone: { radius: 2 } });
  const first = world.add({ transform: { position: new THREE.Vector3() }, triggerDetector: { radius: 0.5 } });
  const second = world.add({ transform: { position: new THREE.Vector3() }, triggerDetector: { radius: 0.5 } });
  const events = [];
  const bus = { emit(name, value) { events.push({ name, entity: value.triggerable }); } };
  triggerDetectionSystem(world, bus);
  triggerDetectionSystem(world, bus);
  assert.deepEqual(events, [{ name: "trigger-entered", entity: first }, { name: "trigger-entered", entity: second }]);
  second.transform.position.x = 10;
  triggerDetectionSystem(world, bus);
  assert.deepEqual(events.at(-1), { name: "trigger-exited", entity: second });
});


test("add/remove before the first frame releases mesh/body immediately", () => {
  const game = fixture();
  const lifecycle = setupSceneManagement(game.world, game);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  let releases = 0;
  mesh.geometry.addEventListener("dispose", () => releases++);
  game.scene.add(mesh);
  const entity = game.world.add({ renderable: { mesh, needsMesh: false } });
  // A body can be attached after world.add and still needs immediate cleanup.
  entity.physicsBody = { rigidBody: { isValid: () => true } };
  game.world.remove(entity);
  assert.equal(game.scene.children.length, 0);
  assert.equal(releases, 1);
  assert.deepEqual(game.removedBodies, [entity.physicsBody.rigidBody]);
  sceneManagementSystem(game.world, game);
  assert.equal(releases, 1);
  lifecycle.dispose();
});
