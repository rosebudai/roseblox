import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { World } from "miniplex";
import { AssetManager } from "../src/resources/assetManager.js";
import { createModelAttachments } from "../src/modelAttachments.js";
import { disposeObject } from "../src/resources/renderer/disposeObject.js";
import { setupSceneManagement, sceneManagementSystem } from "../src/systems/sceneManagementSystem.js";
import { GameSystems } from "../src/gameSystems.js";
import { createGame } from "../src/game.js";

function asset({ skinned = false } = {}) {
  const scene = new THREE.Group();
  scene.position.set(7, -3, 2);
  scene.scale.set(2, 3, 4);
  scene.rotation.y = .3;
  const geometry = new THREE.BoxGeometry(2, 4, 1);
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, color: "red" });
  const mesh = skinned ? new THREE.SkinnedMesh(geometry, material) : new THREE.Mesh(geometry, material);
  mesh.name = "model";
  mesh.position.set(1, 2, -1);
  if (skinned) {
    const count = geometry.attributes.position.count;
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array.from({ length: count * 4 }, (_, i) => i % 4 === 0 ? 1 : 0), 4));
    const bone = new THREE.Bone();
    mesh.add(bone); mesh.bind(new THREE.Skeleton([bone]));
  }
  scene.add(mesh);
  const animations = [new THREE.AnimationClip("move", 1, [new THREE.NumberKeyframeTrack("model.position[x]", [0, 1], [1, 3])])];
  return { scene, scenes: [scene], animations, mesh, geometry, material, texture };
}

function fixture(t, source = asset()) {
  const world = new World(), scene = new THREE.Scene(), assets = new AssetManager();
  let loads = 0;
  assets.gltfLoader.load = (_url, done) => { loads++; done(source); };
  const renderer = { scene, getMeshFactory() {} }, physics = { world: {} };
  const lifecycle = setupSceneManagement(world, { renderer, physics });
  const registered = new Map();
  const models = createModelAttachments({ world, assets, registerCameraVisual(entity) {
    registered.set(entity, (registered.get(entity) ?? 0) + 1);
    return () => registered.set(entity, registered.get(entity) - 1);
  } });
  const add = () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    scene.add(mesh);
    return world.add({ mesh, renderable: { mesh, needsMesh: false } });
  };
  t.after(() => { models.dispose(); for (const entity of [...world]) world.remove(entity); lifecycle.dispose(); assets.dispose(); });
  return { world, scene, assets, models, source, registered, add, loads: () => loads,
    frame: dt => { sceneManagementSystem(world, { renderer, physics, assets }); models.update(dt); } };
}

const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} != ${b}`);

test("attachment fits rotated authored bounds without changing scene transforms or collider root", async t => {
  const f = fixture(t), entity = f.add(), root = entity.mesh;
  const handle = await f.models.attachModel(entity, "assets/models/vehicle.glb", { height: 2, rotation: [0, Math.PI / 2, 0], anchor: "bottom", offset: [0, -1, 0] });
  near(handle.bounds.getSize(new THREE.Vector3()).y, 2, "fitted height");
  near(handle.bounds.min.y, -1, "bottom offset");
  near(handle.bounds.getCenter(new THREE.Vector3()).x, 0, "centered X");
  const clonedScene = handle.mesh.children[0].children[0];
  assert.deepEqual(clonedScene.position.toArray(), f.source.scene.position.toArray());
  assert.deepEqual(clonedScene.scale.toArray(), f.source.scene.scale.toArray());
  assert.ok(clonedScene.quaternion.equals(f.source.scene.quaternion), "authored root rotation is preserved");
  assert.equal(entity.mesh, root); assert.equal(entity.renderable.mesh, root);
  assert.equal(handle.mesh.parent, root);
  const other = await f.models.attachModel(f.add(), "assets/models/vehicle.glb", { maxDimension: 3 });
  const size = other.bounds.getSize(new THREE.Vector3());
  near(Math.max(size.x, size.y, size.z), 3, "max dimension");
  near(other.bounds.getCenter(new THREE.Vector3()).length(), 0, "default center anchor");
  assert.equal(f.loads(), 1, "same URL parses only once per game");
});

test("multiple attachments hide only the proxy, preserve shared materials, and restore on final detach", async t => {
  const f = fixture(t), entity = f.add(), sibling = f.add();
  sibling.mesh.material.dispose(); sibling.mesh.material = entity.mesh.material;
  const original = entity.mesh.material;
  original.visible = false;
  const first = await f.models.attachModel(entity, "actor.glb", { height: 2 });
  const second = await f.models.attachModel(entity, "actor.glb", { height: .2, offset: [1, 0, 0] });
  assert.equal(entity.mesh.visible, true); assert.equal(first.mesh.visible, true);
  assert.notEqual(entity.mesh.material, original); assert.equal(entity.mesh.material.visible, false);
  assert.equal(sibling.mesh.material, original); assert.equal(original.visible, false);
  first.dispose(); first.dispose();
  assert.equal(second.mesh.parent, entity.mesh); assert.equal(entity.mesh.material.visible, false);
  second.dispose(); assert.equal(entity.mesh.material, original); assert.equal(original.visible, false);
  const visibleProxy = await f.models.attachModel(entity, "actor.glb", { hideProxy: false, anchor: false });
  assert.equal(entity.mesh.material, original);
  visibleProxy.dispose(); assert.equal(entity.mesh.children.length, 0);
});

test("removing one instance disposes its materials/skeleton but preserves cached geometry and textures for siblings", async t => {
  const f = fixture(t, asset({ skinned: true })), a = f.add(), b = f.add();
  const first = await f.models.attachModel(a, "character.glb"), second = await f.models.attachModel(b, "character.glb");
  const firstMesh = first.mesh.getObjectByName("model"), secondMesh = second.mesh.getObjectByName("model");
  assert.notEqual(firstMesh.skeleton, secondMesh.skeleton);
  assert.notEqual(firstMesh.material, secondMesh.material);
  assert.equal(firstMesh.geometry, secondMesh.geometry);
  assert.equal(firstMesh.material.map, secondMesh.material.map);
  firstMesh.material.color.set("blue"); assert.equal(secondMesh.material.color.getHex(), 0xff0000);
  firstMesh.skeleton.computeBoneTexture();
  const releases = { bone: 0, material: 0, geometry: 0, texture: 0 };
  for (const [name, resource] of Object.entries({ bone: firstMesh.skeleton.boneTexture, material: firstMesh.material, geometry: f.source.geometry, texture: f.source.texture })) resource.addEventListener("dispose", () => releases[name]++);
  f.world.remove(a);
  assert.deepEqual(releases, { bone: 1, material: 1, geometry: 0, texture: 0 });
  assert.equal(second.mesh.parent, b.mesh); first.dispose();
  f.models.dispose(); f.assets.dispose(); f.assets.dispose();
  assert.deepEqual(releases, { bone: 1, material: 1, geometry: 1, texture: 1 });
});

test("renderable replacement, component removal and generic parent disposal detach borrowed model resources first", async t => {
  const f = fixture(t);
  let geometryReleases = 0;
  f.source.geometry.addEventListener("dispose", () => geometryReleases++);
  for (const mode of ["replace", "component", "dispose"]) {
    const entity = f.add(), old = entity.mesh, original = old.material;
    const model = await f.models.attachModel(entity, "prop.glb");
    if (mode === "replace") {
      const replacement = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
      entity.mesh = replacement; entity.renderable.mesh = replacement; f.scene.add(replacement); f.frame(0);
    } else if (mode === "component") { f.world.removeComponent(entity, "renderable"); f.frame(0); }
    else { old.removeFromParent(); disposeObject(old); }
    assert.equal(model.mesh.parent, null);
    assert.equal(old.material, original);
    assert.equal(geometryReleases, 0, "parent disposal cannot dispose borrowed buffers");
    assert.throws(() => model.play("move"), /disposed/);
    f.world.remove(entity);
  }
});

test("removal and disposal reject late arrivals without hiding proxies or adding abandoned visuals", async t => {
  const f = fixture(t), first = f.add(), second = f.add();
  const callbacks = [];
  f.assets.gltfLoader.load = (_url, done) => callbacks.push(done);
  const a = f.models.attachModel(first, "late.glb"), b = f.models.attachModel(second, "late.glb");
  f.world.remove(first);
  callbacks[0](f.source);
  await assert.rejects(a, /removed or disposed/);
  const handle = await b;
  assert.equal(handle.mesh.parent, second.mesh);
  assert.equal(first.mesh.children.length, 0);
  const last = f.add(), original = last.mesh.material;
  const pending = f.models.attachModel(last, "later.glb");
  f.models.dispose(); f.assets.dispose();
  const late = asset(); let releases = 0;
  late.geometry.addEventListener("dispose", () => releases++);
  callbacks[1](late);
  await assert.rejects(pending, /after disposal/);
  assert.equal(last.mesh.children.length, 0); assert.equal(last.mesh.material, original); assert.equal(releases, 1);
});

test("cache deduplicates pending loads, fails conflicting keys, permits retry, and retains cleared resources until disposal", async () => {
  const assets = new AssetManager(), callbacks = [];
  assets.gltfLoader.load = (url, done, _progress, fail) => callbacks.push({ url, done, fail });
  const a = assets.loadGLTF("same", "one.glb"), b = assets.loadGLTF("same", "one.glb");
  assert.equal(callbacks.length, 1);
  await assert.rejects(assets.loadGLTF("same", "different.glb"), /different URL/);
  callbacks[0].fail(new Error("network fixture"));
  await assert.rejects(a, /one.glb.*network fixture/); await assert.rejects(b, /network fixture/);
  const retry = assets.loadGLTF("same", "one.glb"), original = asset();
  callbacks[1].done(original); await retry;
  let releases = 0; original.geometry.addEventListener("dispose", () => releases++);
  assets.clearCache(); assert.equal(releases, 0);
  const reload = assets.loadGLTF("same", "two.glb"); callbacks[2].done(asset()); await reload;
  assets.dispose(); assert.equal(releases, 1);
});

test("clips advance independently with no legacy state machine and static/invalid options fail actionably", async t => {
  const f = fixture(t), first = await f.models.attachModel(f.add(), "animated.glb"), second = await f.models.attachModel(f.add(), "animated.glb");
  assert.deepEqual(first.clips, ["move"]);
  first.play("move", { loop: false }); f.models.update(.5);
  near(first.mesh.getObjectByName("model").position.x, 2, "playing instance advances");
  near(second.mesh.getObjectByName("model").position.x, 1, "idle sibling does not animate");
  f.models.update(2); near(first.mesh.getObjectByName("model").position.x, 3, "once clamps to last keyframe");
  assert.throws(() => second.play("walk"), /Available clips: move/);
  for (const options of [{ height: -1 }, { height: 1, maxDimension: 2 }, { anchor: "feet" }, { offset: [0, NaN, 0] }]) {
    await assert.rejects(f.models.attachModel(f.add(), "invalid.glb", options), /Model|attachModel/);
  }
  assert.equal(f.loads(), 1, "invalid options do not start downloads");
  f.source.animations = [];
  const staticModel = await f.models.attachModel(f.add(), "static.glb");
  assert.deepEqual(staticModel.clips, []); assert.throws(() => staticModel.play("walk"), /static model/);
});

// Real GLB parser with a binary triangle under an authored transformed node.
function tinyGLB() {
  const bytes = Buffer.from(new Float32Array([-1, 0, -3, 1, 0, 3, 0, 4, 0]).buffer);
  const json = JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, translation: [5, -2, 3], scale: [2, 3, 1] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], buffers: [{ byteLength: bytes.length }], bufferViews: [{ buffer: 0, byteLength: bytes.length }], accessors: [{ bufferView: 0, componentType: 5126, type: "VEC3", count: 3, min: [-1, 0, -3], max: [1, 4, 3] }] });
  const data = Buffer.from(json.padEnd(Math.ceil(json.length / 4) * 4, " "));
  const glb = Buffer.alloc(12 + 8 + data.length + 8 + bytes.length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(data.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); data.copy(glb, 20);
  glb.writeUInt32LE(bytes.length, 20 + data.length); glb.writeUInt32LE(0x004e4942, 24 + data.length); bytes.copy(glb, 28 + data.length);
  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
}

test("actual GLB parsing and normalization preserve nested authored transforms", async t => {
  const f = fixture(t);
  const loader = f.assets.gltfLoader;
  loader.load = (_url, done, _progress, fail) => loader.parse(tinyGLB(), "", done, fail);
  const handle = await f.models.attachModel(f.add(), "triangle.glb", { height: 2, anchor: "bottom" });
  near(handle.bounds.min.y, 0, "ground anchor"); near(handle.bounds.max.y, 2, "height");
  const scene = handle.mesh.children[0].children[0];
  assert.deepEqual(scene.children[0].position.toArray(), [5, -2, 3]);
  assert.deepEqual(scene.children[0].scale.toArray(), [2, 3, 1]);
});

async function headlessGame(t) {
  const savedDOMRect = globalThis.DOMRect;
  globalThis.DOMRect = class { constructor(x = 0, y = 0, width = 0, height = 0) { Object.assign(this, { x, y, width, height }); } };
  t.after(() => { if (savedDOMRect) globalThis.DOMRect = savedDOMRect; else delete globalThis.DOMRect; });
  const document = new EventTarget(), active = new Set();
  document.defaultView = new EventTarget();
  class Canvas extends EventTarget {
    style = {}; dataset = {}; ownerDocument = document;
    setAttribute() {} removeAttribute() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  }
  const registerCore = GameSystems.prototype._registerCoreSystems;
  t.mock.method(GameSystems.prototype, "_registerCoreSystems", function () {
    registerCore.call(this);
    this.resources.get("renderer").factory = () => {
      const scene = new THREE.Scene();
      return { scene, width: 800, height: 600, getMeshFactory() {}, onResize: () => () => {}, renderer: { domElement: new Canvas(), render() {} }, dispose(released) { disposeObject(scene, released); scene.clear(); } };
    };
    this.resources.get("input").factory = () => ({ getMovementVector: () => ({ x: 0, z: active.has("forward") ? -1 : 0 }), isActionActive: action => active.has(action), setAction(action, enabled) { if (enabled) active.add(action); else active.delete(action); }, reset: () => active.clear() });
  });
  const game = await createGame({ autoStart: false }); t.after(() => game.dispose());
  const source = asset(); game.engine.getResource("assets").gltfLoader.load = (_url, done) => done(source);
  return { game, source };
}

test("public model attachments preserve real player movement/reset, proxy and child ray hits, and game disposal", async t => {
  const { game, source } = await headlessGame(t);
  game.addBox({ size: [30, 1, 30], position: [0, -.5, 0] });
  const player = game.addPlayer({ radius: .4, height: 1.2, position: [0, 1, 0], cameraRelative: false });
  const { mesh, body } = player, collider = player.physicsBody.collider, original = mesh.material;
  const model = await game.attachModel(player, "assets/models/runner.glb", { height: 2, anchor: "bottom", offset: [0, -1, 0] });
  assert.equal(player.body, body); assert.equal(player.mesh, mesh); assert.equal(player.physicsBody.collider, collider);
  assert.equal(collider.radius(), Math.fround(.4)); assert.equal(collider.halfHeight(), Math.fround(.6));
  game.input.setAction("forward", true);
  for (let i = 0; i < 60; i++) game.engine.update(1 / 60);
  game.input.reset(); assert.ok(player.transform.position.z < -4.5); assert.equal(player.player.grounded, true);
  game.teleport(player, [2, 1, 3]);
  const center = model.mesh.getWorldPosition(new THREE.Vector3());
  near(center.x, 2, "attachment follows reset X"); near(center.z, 3, "attachment follows reset Z");
  game.controls.enabled = false;
  game.camera.position.set(2, player.transform.position.y, 10); game.camera.lookAt(2, player.transform.position.y, 3);
  const hit = game.raycast({ entities: [player] }); assert.equal(hit?.entity, player);
  model.mesh.visible = false;
  const proxyHit = game.raycast({ entities: [player] }); assert.equal(proxyHit?.entity, player, "hidden proxy material remains a pickable collider root");
  model.mesh.visible = true;
  const second = await game.attachModel(player, "assets/models/runner.glb", { height: .5, offset: [2, 0, 0] });
  game.camera.position.set(4, player.transform.position.y, 10); game.camera.lookAt(4, player.transform.position.y, 3);
  assert.equal(game.raycast({ entities: [player] })?.entity, player, "offset imported child resolves to the owning entity");
  model.play("move"); game.engine.update(.1);
  assert.ok(model.mesh.getObjectByName("model").position.x > 1, "engine advances clips without a second loop");
  let released = 0; source.texture.addEventListener("dispose", () => released++);
  game.engine.dispose();
  assert.equal(model.mesh.parent, null); assert.equal(second.mesh.parent, null);
  assert.equal(mesh.material, original); assert.equal(released, 1);
  await assert.rejects(game.attachModel(player, "again.glb"), /disposed/);
});

test("separate games own independent caches and near-camera registrations release with attachments", async t => {
  const a = fixture(t), b = fixture(t), entity = a.add(), other = b.add();
  entity.player = {};
  const first = await a.models.attachModel(entity, "shared-name.glb"), second = await a.models.attachModel(entity, "shared-name.glb");
  const independent = await b.models.attachModel(other, "shared-name.glb");
  assert.equal(a.registered.get(entity), 2);
  first.dispose(); assert.equal(a.registered.get(entity), 1);
  a.models.dispose(); a.assets.dispose(); assert.equal(a.registered.get(entity), 0);
  assert.equal(second.mesh.parent, null); assert.equal(independent.mesh.parent, other.mesh);
  assert.notEqual(independent.mesh.getObjectByName("model").geometry, a.source.geometry);
});

test("hidden actor attachments warn once without overriding intentional visibility or proxy-material ownership", async t => {
  const f = fixture(t), hidden = f.add(), visible = f.add(), warnings = [];
  t.mock.method(console, "warn", message => warnings.push(message));
  hidden.mesh.visible = false;
  const first = await f.models.attachModel(hidden, "hidden.glb");
  const second = await f.models.attachModel(hidden, "hidden.glb");
  await f.models.attachModel(visible, "hidden.glb");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /children remain hidden.*Restore entity.mesh.visible=true.*already hides the proxy/);
  assert.equal(hidden.mesh.visible, false); assert.equal(visible.mesh.visible, true);
  first.dispose(); second.dispose(); assert.equal(hidden.mesh.visible, false, "warning is advisory, not an implicit activation");
});

test("first-person and follow-camera owned hiding suppress attachment warnings but caller hiding still warns", async t => {
  const { game } = await headlessGame(t), warnings = [];
  t.mock.method(console, "warn", message => warnings.push(message));
  const player = game.addPlayer({ position: [0, 3, 0] });
  const fps = game.firstPerson(player);
  await game.attachModel(player, "body.glb", { height: 2 });
  assert.equal(player.mesh.visible, false); assert.deepEqual(warnings, []);
  fps.dispose();
  const followed = game.addBox({ size: [2, 2, 2], body: "none" });
  game.followCamera(followed, { offset: [0, 0, .5], lookOffset: [0, 0, 0], mode: "fixed" });
  game.engine.update(0); assert.equal(followed.mesh.visible, false);
  await game.attachModel(followed, "body.glb", { height: 2 });
  assert.deepEqual(warnings, []);
  game.releaseCamera();
  const callerHidden = game.addBox({ body: "none" }); callerHidden.mesh.visible = false;
  await game.attachModel(callerHidden, "body.glb");
  assert.equal(warnings.length, 1); assert.equal(callerHidden.mesh.visible, false);
});

function projectedVertices(object, camera) {
  camera.updateWorldMatrix(true, true);
  const points = [];
  object.traverse(child => {
    if (!child.isMesh) return;
    const positions = child.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld).project(camera));
  });
  return points;
}

test("public camera models remain framed through engine frames, camera movement and compact projection changes", async t => {
  const { game } = await headlessGame(t);
  game.controls.enabled = false;
  const worldSize = [...game.engine.world].length;
  const gun = await game.attachCameraModel("held-tool.glb", { rotation: [.1, Math.PI / 2, 0] });
  assert.equal([...game.engine.world].length, worldSize, "camera prop adds no collision/world entity");
  for (const [aspect, fov, zoom] of [[16/9,75,1], [1,75,1], [.55,60,1.4]]) {
    game.camera.aspect = aspect; game.camera.fov = fov; game.camera.zoom = zoom; game.camera.updateProjectionMatrix();
    game.camera.position.set(13,4,-8); game.camera.rotation.set(.2,.8,0);
    for (let i=0; i<4; i++) game.engine.update(1/60);
    const points = projectedVertices(gun.mesh, game.camera);
    assert.ok(points.length > 0);
    for (const p of points) {
      assert.ok(p.x >= .14 - 1e-6 && p.x <= .9 + 1e-6, `horizontal fit ${p.x}`);
      assert.ok(p.y >= -.87 - 1e-6 && p.y <= -.17 + 1e-6, `vertical fit ${p.y}`);
      assert.ok(p.z > -1 && p.z < 1, `depth fit ${p.z}`);
    }
  }
  gun.mesh.position.z = .04;
  game.engine.update(1/60);
  near(gun.mesh.position.z, .04, "world synchronization preserves model-local recoil");
  gun.mesh.visible = false; game.engine.update(1/60); assert.equal(gun.mesh.visible, false);
  gun.mesh.visible = true; gun.play("move", {loop:false}); game.engine.update(.1);
  assert.ok(gun.mesh.getObjectByName("model").position.x > 1, "clips use the existing frame loop");
});

test("camera model disposal preserves a shared world model and cached resources until game disposal", async t => {
  const { game, source } = await headlessGame(t);
  const actor = game.addBox({body:"none"});
  const worldModel = await game.attachModel(actor, "shared.glb");
  const gun = await game.attachCameraModel("shared.glb");
  const mesh = gun.mesh.getObjectByName("model"), worldMesh = worldModel.mesh.getObjectByName("model");
  assert.equal(mesh.geometry, worldMesh.geometry); assert.notEqual(mesh.material, worldMesh.material);
  const releases = {material:0,geometry:0,texture:0};
  mesh.material.addEventListener("dispose",()=>releases.material++);
  source.geometry.addEventListener("dispose",()=>releases.geometry++);
  source.texture.addEventListener("dispose",()=>releases.texture++);
  const placement = gun.mesh.parent;
  disposeObject(placement); gun.dispose();
  assert.equal(placement.parent,null); assert.equal(gun.mesh.parent,null);
  assert.equal(worldModel.mesh.parent,actor.mesh);
  assert.deepEqual(releases,{material:1,geometry:0,texture:0});
  const remaining = await game.attachCameraModel("shared.glb");
  game.engine.dispose();
  assert.equal(remaining.mesh.parent,null);
  assert.deepEqual(releases,{material:1,geometry:1,texture:1});
  await assert.rejects(game.attachCameraModel("again.glb"),/disposed/);
});

test("camera-model late arrivals reject after disposal, and invalid screen rectangles do not load", async t => {
  const { game, source } = await headlessGame(t);
  const loader = game.engine.getResource("assets").gltfLoader;
  const callbacks=[]; loader.load=(_url,done)=>callbacks.push(done);
  await assert.rejects(game.attachCameraModel("outside.glb", {screenPosition:[.9,-.5]}),/screen rectangle/);
  assert.equal(callbacks.length,0);
  const pending=game.attachCameraModel("late.glb");
  game.dispose(); callbacks[0](source);
  await assert.rejects(pending,/disposal/);
  assert.equal(game.camera.children.length,0);
});

test("declared GLB forward and up align with the live camera regardless of the asset's authored axis", async t => {
  const { game, source } = await headlessGame(t);
  game.controls.enabled = false;
  source.scene.position.set(0, 0, 0); source.scene.rotation.set(0, 0, 0); source.scene.scale.set(1, 1, 1);
  const origin = new THREE.Object3D(), muzzle = new THREE.Object3D(), top = new THREE.Object3D();
  origin.name = "axis-origin"; muzzle.name = "muzzle"; top.name = "asset-up";
  source.scene.add(origin, muzzle, top);
  const axes = [
    { forward: [1, 0, 0], up: [0, 1, 0] },
    { forward: [0, 0, 2], up: [0, 3, 0] },
    { forward: [0, -1, 0], up: [0, 0, 1] },
    { forward: [-.7, 0, .714], up: [0, 1, 0] },
  ];
  for (const [i, axis] of axes.entries()) {
    muzzle.position.fromArray(axis.forward).normalize(); top.position.fromArray(axis.up).normalize();
    const gun = await game.attachCameraModel(`axis-${i}.glb`, { sourceForward: axis.forward, sourceUp: axis.up });
    game.camera.position.set(6, 4, -9); game.camera.rotation.set(.2, .6, -.1);
    game.engine.update(1 / 60);
    const start = gun.mesh.getObjectByName("axis-origin").getWorldPosition(new THREE.Vector3());
    const cameraInverse = game.camera.getWorldQuaternion(new THREE.Quaternion()).invert();
    const direction = name => gun.mesh.getObjectByName(name).getWorldPosition(new THREE.Vector3()).sub(start).normalize().applyQuaternion(cameraInverse);
    near(direction("muzzle").distanceTo(new THREE.Vector3(0, 0, -1)), 0, "muzzle follows camera aim");
    near(direction("asset-up").distanceTo(new THREE.Vector3(0, 1, 0)), 0, "declared up stays upright");
  }
  await assert.rejects(game.attachCameraModel("parallel.glb", { sourceForward: [0, 1, 0] }), /must not be parallel/);
});

test("long-axis camera mounting keeps a diagonal gun aimed through recoil and projection changes", async t => {
  const { game, source } = await headlessGame(t);
  game.controls.enabled = false;
  source.scene.rotation.y = -.77;
  source.mesh.position.set(0, 0, 0);
  source.geometry.dispose(); source.mesh.geometry = new THREE.BoxGeometry(.2, .3, 2);
  const origin = new THREE.Object3D(), muzzle = new THREE.Object3D();
  origin.name = "barrel-start"; muzzle.name = "barrel-end"; muzzle.position.z = 1;
  source.mesh.add(origin, muzzle);
  const gun = await game.attachCameraModel("diagonal.glb", { sourceForward: "long-axis", framing: "held" });
  assert.equal(gun.orientation.mode, "long-axis");
  assert.ok(gun.orientation.elongation > 20);
  for (const aspect of [16 / 9, .6]) {
    game.camera.aspect = aspect; game.camera.updateProjectionMatrix();
    game.camera.rotation.set(.2, .7, -.1); gun.mesh.position.z = .04;
    game.engine.update(1 / 60);
    const start = gun.mesh.getObjectByName("barrel-start").getWorldPosition(new THREE.Vector3());
    const direction = gun.mesh.getObjectByName("barrel-end").getWorldPosition(new THREE.Vector3()).sub(start).normalize();
    const aim = game.camera.getWorldDirection(new THREE.Vector3());
    near(direction.distanceTo(aim), 0, "measured barrel stays aligned with aim");
    near(gun.mesh.position.z, .04, "recoil remains an independent translation");
    assert.ok(projectedVertices(gun.mesh, game.camera).every(p => p.z > -1 && p.z < 1), "recoil stays beyond near plane");
  }
});

test("held framing permits deliberate bottom crop while preserving side margins and depth across aspect changes", async t => {
  const { game } = await headlessGame(t);
  game.controls.enabled = false;
  const gun = await game.attachCameraModel("held-framing.glb", { framing: "held" });
  for (const aspect of [16 / 9, 1]) {
    game.camera.aspect = aspect; game.camera.updateProjectionMatrix(); game.engine.update(1 / 60);
    const points = projectedVertices(gun.mesh, game.camera);
    assert.ok(points.some(p => p.y < -1), "rear/grip can continue below the screen");
    assert.ok(points.some(p => p.y > -1), "held model remains visible");
    for (const p of points) {
      assert.ok(p.x >= .14 - 1e-6 && p.x <= .86 + 1e-6, `held horizontal fit ${p.x}`);
      assert.ok(p.y >= -1.21 - 1e-6 && p.y <= -.31 + 1e-6, `bounded lower crop ${p.y}`);
      assert.ok(p.z > -1 && p.z < 1, `held near/far fit ${p.z}`);
    }
  }
});
