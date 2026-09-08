import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { GameSystems } from "../src/gameSystems.js";
import { createGame } from "../src/game.js";
import { createVoxelKit } from "../src/voxelKit.js";
import { createInteriorLighting, createFramedBox } from "../src/presentation.js";
import { disposeObject } from "../src/resources/renderer/disposeObject.js";
import { gltfMeshFactory } from "../src/resources/renderer/meshFactories.js";
import { createTransform } from "../src/components/transform.js";

// Run the complete core and helper systems with real Rapier and camera-controls.
// Only the WebGL renderer and keyboard source are substituted for Node.
async function headlessGame(t, options = {}) {
  const savedDOMRect = globalThis.DOMRect;
  globalThis.DOMRect = class { constructor(x=0,y=0,width=0,height=0) { Object.assign(this,{x,y,width,height}); } };
  t.after(() => { if (savedDOMRect) globalThis.DOMRect = savedDOMRect; else delete globalThis.DOMRect; });
  const document = new EventTarget();
  document.defaultView = new EventTarget();
  class Canvas extends EventTarget {
    style = {}; dataset = {}; ownerDocument = document;
    setAttribute() {} removeAttribute() {}
    getBoundingClientRect() { return {left:0,top:0,width:800,height:600}; }
  }
  const active = new Set();
  const registerCore = GameSystems.prototype._registerCoreSystems;
  t.mock.method(GameSystems.prototype, "_registerCoreSystems", function () {
    registerCore.call(this);
    this.resources.get("renderer").factory = () => {
      const scene = new THREE.Scene();
      return { scene, width:800, height:600, getMeshFactory() {}, onResize:()=>()=>{},
        renderer:{domElement:new Canvas(),render() {}},
        dispose(released) { disposeObject(scene,released); scene.clear(); },
      };
    };
    this.resources.get("input").factory = () => ({
      getMovementVector:()=>({x:Number(active.has("right"))-Number(active.has("left")),z:Number(active.has("backward"))-Number(active.has("forward"))}),
      isActionActive:action=>active.has(action),
      setAction(action,enabled) { if(enabled)active.add(action);else active.delete(action); },
      reset:()=>active.clear(),
    });
  });
  const game = await createGame({autoStart:false,...options});
  t.after(()=>game.dispose());
  return game;
}

test("interior key has a clear path below a solid roof and its owned lights release with the game", async t => {
  const game = await headlessGame(t, { lighting: false });
  const roof = game.addBox({ size: [20, 0.4, 24], position: [0, 6.2, 0] });
  const rig = createInteriorLighting(game);
  const start = rig.key.getWorldPosition(new THREE.Vector3());
  const finish = rig.key.target.getWorldPosition(new THREE.Vector3());
  assert.equal(game.raycastBetween(start, finish, { entities: [roof] }), null, "the roof cannot occlude the interior key");
  assert.equal(game.raycastBetween([0, 20, 0], [0, 0, 0], { entities: [roof] }).entity, roof, "the same roof occludes an exterior key");
  for (const light of [rig.key, rig.fill]) {
    const p = light.getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(p.x) < 10 && p.y > 0 && p.y < 6 && Math.abs(p.z) < 12);
  }
  const caller = new THREE.PointLight(); game.scene.add(caller);
  let releases = 0;
  rig.key.shadow.map = { dispose() { releases++; } };
  rig.dispose(); rig.dispose();
  assert.equal(releases, 1); assert.equal(rig.root.parent, null); assert.equal(caller.parent, game.scene);
  const second = createInteriorLighting(game, { center: [4, 6, -2], size: [40, 12, 48] });
  assert.equal(second.key.intensity / rig.key.intensity, 4, "uniform room scaling preserves illuminance");
  game.dispose(); assert.equal(second.root.parent, null); assert.equal(releases, 1);
});

test("framed props keep one full-size collider while framing remains exposed and owned", async t => {
  const game = await headlessGame(t);
  for (const size of [[3, 2, 2], [1, 4, 1.5]]) {
    const entity = createFramedBox(game, { size, position: [0, 0, 0] });
    const half = entity.physicsBody.collider.halfExtents();
    assert.deepEqual([half.x, half.y, half.z], size.map(n => n / 2));
    const beam = Math.min(...size) * 0.085;
    const x = (size[0] - beam) / 2;
    const edge = game.raycastBetween([x, 0, size[2] + 2], [x, 0, 0], { entities: [entity] });
    assert.equal(edge.entity, entity); assert.equal(edge.object.isInstancedMesh, true, "ray reaches the visible frame before the inset body");
    const body = game.raycastBetween([0, 0, size[2] + 2], [0, 0, 0], { entities: [entity] });
    assert.equal(body.object, entity.mesh);
    const bounds = new THREE.Box3().setFromObject(entity.mesh).getSize(new THREE.Vector3());
    bounds.toArray().forEach((n, i) => assert.ok(Math.abs(n - size[i]) < 1e-6, "visual silhouette fits the collider"));
    const resources = new Map();
    entity.mesh.traverse(node => {
      for (const resource of [node.isInstancedMesh ? node : null, node.geometry, node.material]) if (resource && !resources.has(resource)) {
        resources.set(resource, 0); resource.addEventListener("dispose", () => resources.set(resource, resources.get(resource) + 1));
      }
    });
    game.remove(entity); game.remove(entity);
    assert.ok([...resources.values()].every(n => n === 1));
  }
});

test("invalid presentation dimensions reject before adding entities or scene lights", async t => {
  const game = await headlessGame(t, { lighting: false });
  const before = game.scene.children.length;
  assert.throws(() => createInteriorLighting(game, { size: [10, 0, 10] }), /positive/);
  assert.throws(() => createFramedBox(game, { size: [2, 2, 2], frameWidth: 0.8 }), /frameWidth/);
  assert.equal(game.scene.children.length, before); assert.equal(game.world.entities.length, 0);
});

function advance(game, seconds, check = () => {}) {
  const dt = game.engine.fixedTimeStep;
  for(let i=0;i<Math.round(seconds/dt);i++) { game.engine.update(dt); check(); }
}
function floorAndPlayer(game, config={}) {
  game.addBox({size:[32,.5,32],position:[0,-.75,0]});
  const floor=game.addBox({size:[20,1,20],position:[0,-.5,0]});
  const player=game.addPlayer({position:[0,1,0],radius:.42,height:1.16,speed:4,jumpSpeed:6.2,...config});
  game.followCamera(player,{offset:[0,5.5,8],lookOffset:[0,.7,0]});
  return {floor,player};
}

test("core queries and owned resources remain bounded across movement and spawn/remove cycles", async t => {
  const game = await headlessGame(t, { lighting: false });
  floorAndPlayer(game);
  advance(game, 1);
  const before = game.engine.getDiagnostics();
  game.input.setAction("forward", true);
  for (let i = 0; i < 1440; i++) {
    if (i % 12 === 0) {
      const actor = game.addCharacter({ position: [5, 2, 0] });
      game.engine.update(1 / 144);
      game.remove(actor);
    } else game.engine.update(1 / 144);
  }
  game.engine.update(0);
  const after = game.engine.getDiagnostics();
  assert.equal(after.queries, before.queries);
  assert.deepEqual(after.resources, before.resources);
  assert.equal(after.entities, before.entities);
  assert.equal(after.errorCount, 0);
  game.dispose();
  assert.equal(game.engine.getDiagnostics().resources.controllers, 0);
});

for (const helper of ["addPlayer", "addCharacter"]) {
test(`${helper} emits one contact start/end for solid walls and sensors`, async t => {
  const game = await headlessGame(t, { lighting: false });
  game.addBox({ size: [30, 1, 30], position: [0, -.5, 0] });
  const wall = game.addBox({ size: [10, 3, .5], position: [0, 1.5, -3] });
  const sensor = game.addBox({ size: [2, 3, .2], position: [0, 1.5, -1], sensor: true });
  const actor = game[helper]({ position: [0, 1, 2], cameraRelative: false, speed: 3, velocity: [0, 0, -3] });
  const events = [];
  for (const type of ["collision-started", "collision-ended"]) game.engine.on(type, pair => {
    if ([pair.entityA, pair.entityB].includes(actor)) events.push({ type, other: pair.entityA === actor ? pair.entityB : pair.entityA });
  });
  game.input.setAction("forward", true);
  advance(game, 2);
  assert.ok(actor.transform.position.z > -2.4, "wall blocks the helper capsule");
  assert.equal(events.filter(e => e.type === "collision-started" && e.other === wall).length, 1);
  assert.equal(events.filter(e => e.type === "collision-started" && e.other === sensor).length, 1);
  game.input.reset(); game.input.setAction("backward", true);
  if (actor.character) actor.character.velocity.z = 3;
  advance(game, 2);
  assert.equal(events.filter(e => e.type === "collision-ended" && e.other === wall).length, 1);
  assert.equal(game.engine.getDiagnostics().errorCount, 0);
});
}

for (const cameraMode of ["follow", "firstPerson"]) {
test(`${cameraMode} interpolates 144 Hz presentation while physics and teleports stay authoritative`, async t => {
  const game = await headlessGame(t, { lighting: false, gravity: { x: 0, y: 0, z: 0 } });
  const actor = game.addCharacter({ position: [0, 2, 10], velocity: [0, 0, -3] });
  if (cameraMode === "follow") game.followCamera(actor, { mode: "fixed", offset: [0, 4, 6] });
  else game.firstPerson(actor);
  advance(game, 1);
  const positions = [];
  for (let i = 0; i < 144; i++) {
    game.engine.update(1 / 144);
    positions.push(game.camera.position.z);
    assert.ok(Math.abs(actor.transform.position.z - actor.body.translation().z) < 1e-7);
    assert.ok(actor.mesh.position.z >= actor.transform.position.z - 1e-7);
    assert.ok(actor.mesh.position.z - actor.transform.position.z <= 3 / 60 + 1e-6);
  }
  assert.equal(new Set(positions).size, 144);
  const displayed = actor.mesh.position.clone();
  game.raycastBetween([0, 2, 20], [0, 2, -20], { entities: [actor] });
  assert.deepEqual(actor.mesh.position, displayed, "authoritative queries restore the interpolated mesh pose");
  game.teleport(actor, [8, 2, 0]);
  game.engine.update(0);
  assert.equal(actor.mesh.position.x, 8);
  assert.equal(game.camera.position.x, 8);
  assert.equal(actor.body.translation().x, 8);
});
}

for (const removal of ["entity", "game"]) {
test(`legacy skinned GLTF releases its clone-owned bone texture on ${removal} removal`, async t => {
  const game = await headlessGame(t, { lighting: false });
  const assets = game.engine.getResource("assets");
  const source = new THREE.SkinnedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const bone = new THREE.Bone(); source.add(bone); source.bind(new THREE.Skeleton([bone]));
  const root = new THREE.Group(); root.add(source);
  assets.gltfLoader.load = (_url, done) => done({ scene: root, scenes: [root], animations: [] });
  await assets.loadGLTF("skin", "fixture.glb");
  const entity = { transform: createTransform(), renderable: { type: "gltf", assetKey: "skin", scale: 1, position: new THREE.Vector3(), rotation: new THREE.Euler() } };
  const mesh = gltfMeshFactory(entity, { assets }); entity.renderable.mesh = mesh;
  game.scene.add(mesh); game.world.add(entity);
  let skeleton;
  mesh.traverse(node => { if (node.isSkinnedMesh) skeleton = node.skeleton; });
  assert.notEqual(skeleton, source.skeleton);
  skeleton.computeBoneTexture();
  let releases = 0, sharedReleases = 0;
  skeleton.boneTexture.addEventListener("dispose", () => releases++);
  source.geometry.addEventListener("dispose", () => sharedReleases++);
  if (removal === "entity") {
    game.remove(entity);
    assert.equal(releases, 1);
    assert.equal(sharedReleases, 0);
  }
  game.dispose(); game.dispose();
  assert.equal(releases, 1);
  assert.equal(sharedReleases, 1);
  assert.equal(mesh.parent, null);
});
}

test("shape helpers preserve supplied material shader type and isolate shared texture disposal", async t => {
  const game = await headlessGame(t);
  const texture = new THREE.DataTexture(new Uint8Array([255, 90, 30, 255]), 1, 1);
  const original = new THREE.MeshBasicMaterial({ color: 0xffeecc, map: texture });
  let originalReleases = 0, textureReleases = 0;
  original.addEventListener("dispose", () => originalReleases++);
  texture.addEventListener("dispose", () => textureReleases++);
  const a = game.addBox({ material: original });
  const b = game.addSphere({ position: [3, 0, 0], material: original });
  for (const entity of [a, b]) {
    assert.equal(entity.mesh.material.type, "MeshBasicMaterial");
    assert.equal(entity.mesh.material.isMeshBasicMaterial, true);
    assert.notEqual(entity.mesh.material.isMeshStandardMaterial, true);
    assert.notEqual(entity.mesh.material, original);
    assert.notEqual(entity.mesh.material.map, texture);
    assert.equal(entity.mesh.material.map.source, texture.source);
  }
  let bTextureReleases = 0;
  b.mesh.material.map.addEventListener("dispose", () => bTextureReleases++);
  game.remove(a);
  assert.equal(originalReleases, 0);
  assert.equal(textureReleases, 0);
  assert.equal(bTextureReleases, 0);
  assert.equal(game.addBox({ material: { color: 0x112233, roughness: .4 } }).mesh.material.type, "MeshStandardMaterial");
  game.dispose();
  assert.equal(bTextureReleases, 1);
  assert.equal(originalReleases, 0);
  assert.equal(textureReleases, 0);
  original.dispose(); texture.dispose();
});

test("world segment hits are independent of camera aim, bounded by endpoints and attributed to entities", async t => {
  const game = await headlessGame(t);
  const wall = game.addBox({ size: [3, 3, 1], position: [0, 1.5, -4] });
  game.controls.enabled = false;
  game.camera.position.set(20, 20, 20);
  game.camera.lookAt(30, 20, 20);
  assert.equal(game.raycast({ entities: [wall] }), null);
  const from = new THREE.Vector3(0, 1, 0), to = new THREE.Vector3(0, 1, -8);
  const hit = game.raycastBetween(from, to, { entities: [wall] });
  assert.equal(hit.entity, wall);
  assert.ok(Math.abs(hit.distance - 3.5) < 1e-6);
  assert.deepEqual(from.toArray(), [0, 1, 0]);
  assert.deepEqual(to.toArray(), [0, 1, -8]);
  game.camera.lookAt(-30, 0, 0);
  assert.equal(game.raycastBetween(from, to, { entities: [wall] }).entity, wall);
  assert.equal(game.raycastBetween(from, [0, 1, -3], { entities: [wall] }), null);
  assert.equal(game.raycastBetween([5, 1, 0], [5, 1, -8], { entities: [wall] }), null);
  assert.equal(game.raycastBetween(from, from), null);
  assert.throws(() => game.raycastBetween([NaN, 0, 0], to), /finite/);
  game.teleport(wall, [6, 1.5, -4]);
  assert.equal(game.raycastBetween(from, to, { entities: [wall] }), null, "queries synchronize a moved blocker before rendering");
  const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  child.position.set(-6, -.5, 0);
  wall.mesh.add(child);
  assert.equal(game.raycastBetween(from, to, { entities: [wall] }).entity, wall, "child visuals map back to their owning entity");
  game.remove(wall);
  assert.equal(game.raycastBetween(from, to, { entities: [wall] }), null);
});

test("scripted characters use velocity once per physics step, ignore player keys and stop or slide against walls", async t => {
  const game = await headlessGame(t);
  game.addBox({ size: [40, 1, 40], position: [0, -.5, 0] });
  const actor = game.addCharacter({ position: [0, 1, 0], radius: .42, height: 1.16 });
  const player = game.addPlayer({ position: [-8, 1, 0], radius: .42, height: 1.16, cameraRelative: false, speed: 3 });
  assert.equal(actor.player, undefined, "scripted actor has no input-owned player controller");
  advance(game, 2);
  const settled = actor.body.translation();
  assert.equal(actor.character.grounded, true);
  assert.ok(Math.abs(settled.y - 1.02) < .025);
  game.input.setAction("right", true);
  advance(game, 1);
  game.input.reset();
  assert.ok(player.body.translation().x > -5.2);
  assert.ok(Math.abs(actor.body.translation().x) < .01, "player input never moves the scripted actor");
  actor.character.velocity.set(3, 0, 0);
  advance(game, 1);
  assert.ok(Math.abs(actor.body.translation().x - 3) < .15, `velocity is metres/second, not an extra dt or per-frame displacement: ${actor.body.translation().x}`);
  game.addBox({ size: [30, 3, .5], position: [0, 1.5, -3] });
  actor.character.velocity.set(2, 0, -4);
  advance(game, 2);
  assert.ok(actor.body.translation().z > -2.36 && actor.body.translation().z < -2.1, "solid wall stops the actor");
  assert.ok(actor.body.translation().x > 6, `tangential movement slides along the wall: ${actor.body.translation().x}`);
  actor.character.enabled = false;
  const paused = { ...actor.body.translation() };
  advance(game, 1);
  assert.ok(Math.abs(actor.body.translation().x - paused.x) < .01);
  assert.ok(Math.abs(actor.body.translation().z - paused.z) < .01);
  assert.equal(game.getDiagnostics().errorCount, 0);
});

test("scripted character teleport resets gravity and desired motion, and removal disposes its controller once", async t => {
  const game = await headlessGame(t);
  game.addBox({ size: [30, 1, 30], position: [0, -.5, 0] });
  const actor = game.addCharacter({ position: [0, 4, 0], radius: .42, height: 1.16, velocity: [1, 0, 0] });
  actor.character.enabled = false;
  advance(game, 2);
  assert.ok(Math.abs(actor.body.translation().y - 1.02) < .03, "gravity continues when scripted motion is disabled");
  assert.ok(Math.abs(actor.body.translation().x) < .01);
  actor.character.enabled = true;
  advance(game, .4);
  assert.ok(actor.body.translation().x > .35);
  game.teleport(actor, [2, 1, 3]);
  assert.deepEqual(actor.character.velocity.toArray(), [0, 0, 0]);
  assert.equal(actor.character.verticalVelocity, 0);
  assert.equal(actor.character.grounded, false);
  advance(game, 2);
  assert.ok(Math.abs(actor.body.translation().x - 2) < .01);
  assert.ok(Math.abs(actor.body.translation().z - 3) < .01);
  assert.ok(Math.abs(actor.body.translation().y - 1.02) < .03);
  let releases = 0;
  const release = game.physics.world.removeCharacterController.bind(game.physics.world);
  t.mock.method(game.physics.world, "removeCharacterController", controller => { releases++; release(controller); });
  game.remove(actor);
  advance(game, .1);
  assert.equal(releases, 1);
  assert.equal(actor.body.isValid(), false);
  game.dispose();
  assert.equal(releases, 1);
});

test("decorative ground depth bias preserves geometry, physics and independent material ownership", async t => {
  const game=await headlessGame(t);
  const kit=createVoxelKit(game,{lighting:false});
  const apron=kit.ground({size:[46,1,46],position:[0,-.5,0],body:"none"});
  const floor=kit.ground({size:[20,1,20],position:[0,-.5,0]});
  const raised=kit.ground({size:[4,1,4],position:[0,1.5,0],body:"none"});
  const visual=entity=>entity.mesh.children[0];
  const apronMaterial=visual(apron).material, floorMaterial=visual(floor).material;
  assert.equal(apron.body,undefined);assert.equal(apron.physicsBody,undefined);
  assert.equal(floor.body.isFixed(),true);
  assert.deepEqual({...floor.physicsBody.collider.halfExtents()},{x:10,y:.5,z:10});
  assert.deepEqual({...floor.body.translation()},{x:0,y:-.5,z:0});
  assert.equal(apronMaterial.polygonOffset,true);
  assert.equal(apronMaterial.polygonOffsetFactor,1);assert.equal(apronMaterial.polygonOffsetUnits,1);
  assert.equal(floorMaterial.polygonOffset,false);assert.equal(apron.mesh.material.polygonOffset,false);
  assert.notEqual(apronMaterial,floorMaterial);assert.notEqual(apronMaterial,visual(raised).material);
  for(const [entity,top] of [[apron,0],[floor,0],[raised,2]]) {
    entity.mesh.updateWorldMatrix(true,true);
    assert.ok(Math.abs(new THREE.Box3().setFromObject(visual(entity)).max.y-top)<1e-6,"depth bias cannot alter visible vertex heights");
  }
  let apronReleases=0,floorReleases=0;
  apronMaterial.addEventListener("dispose",()=>apronReleases++);
  floorMaterial.addEventListener("dispose",()=>floorReleases++);
  game.remove(apron);assert.equal(apronReleases,1);assert.equal(floorReleases,0);
  assert.equal(game.world.has(floor),true);assert.equal(floorMaterial.polygonOffset,false);
  kit.dispose();assert.equal(apronReleases,1);assert.equal(floorReleases,1);
});

test("fresh player and repeated teleports stay grounded through idle before delayed two-axis movement", async t => {
  const game=await headlessGame(t);
  const {floor,player}=floorAndPlayer(game);
  for(let cycle=0;cycle<3;cycle++) {
    if(cycle)game.teleport(player,[0,1,0]);
    const spawn=player.body.translation();
    assert.ok(spawn.y>1.02&&spawn.y<1.05,"spawn leaves a small one-time skin clearance");
    assert.equal(spawn.x,0);assert.equal(spawn.z,0);
    player.player.enabled=false;game.input.reset();
    advance(game,3,()=>assert.ok(player.body.translation().y>=1.005,"idle capsule must not sink through floor"));
    assert.equal(player.player.grounded,true);
    assert.ok(Math.abs(player.body.translation().y-1.02)<.015);
    const gap=player.physicsBody.collider.contactCollider(floor.physicsBody.collider,.1)?.distance;
    assert.ok(gap>=0&&gap<.04,"grounding preserves positive controller clearance");
    player.player.enabled=true;
    game.input.setAction("left",true);advance(game,1);game.input.reset();
    assert.ok(player.body.translation().x<-3.4,"delayed left movement is not rejected by the floor");
    game.input.setAction("forward",true);advance(game,1);game.input.reset();
    assert.ok(player.body.translation().z<-3.4,"turning to a second axis remains free");
  }
  assert.equal(game.getDiagnostics().errorCount,0);
});

for (const cameraMode of ["follow", "firstPerson"]) {
test(`default ${cameraMode} player jumps, lands and respects a solid wall`, async t => {
  const game=await headlessGame(t);
  const {player}=floorAndPlayer(game,{jumpSpeed:undefined});
  if(cameraMode==="firstPerson") {
    pointerFixture(game);
    game.firstPerson(player).start();
    await Promise.resolve();
  }
  game.addBox({size:[20,3,.5],position:[0,1.5,-3]});
  advance(game,2);
  const groundY=player.body.translation().y;
  let peak=groundY,airborne=false;
  game.input.setAction("jump",true);advance(game,.15,()=>{peak=Math.max(peak,player.body.translation().y);airborne||=!player.player.grounded;});
  game.input.reset();advance(game,2,()=>{peak=Math.max(peak,player.body.translation().y);airborne||=!player.player.grounded;});
  assert.ok(airborne&&peak>groundY+1,"jump launches under normal gravity");
  assert.equal(player.player.grounded,true);
  assert.ok(Math.abs(player.body.translation().y-groundY)<.03,"landing returns to the same floor without repeated lift");
  game.input.setAction("forward",true);advance(game,2);game.input.reset();
  assert.ok(player.body.translation().z>-2.36&&player.body.translation().z<-2.1,"solid wall blocks the capsule");
});
}

test("default player and corrected model face camera yaw while idle, strafing and backing up", async t => {
  const game = await headlessGame(t);
  const { player } = floorAndPlayer(game);
  const art = new THREE.Group();
  art.rotation.y = Math.PI; // Imported art authored with +Z forward.
  player.mesh.add(art);
  advance(game, 1);
  const start = player.transform.position.clone();
  const facing = () => new THREE.Vector3(0, 0, -1).applyQuaternion(player.transform.rotation);
  const cameraHeading = () => { const v = game.camera.getWorldDirection(new THREE.Vector3()); v.y = 0; return v.normalize(); };
  const check = () => {
    assert.ok(facing().dot(cameraHeading()) > .999, "physics root follows horizontal camera aim");
    const visual = new THREE.Vector3(0, 0, 1).applyQuaternion(art.getWorldQuaternion(new THREE.Quaternion()));
    assert.ok(visual.dot(cameraHeading()) > .999, "corrected child visual inherits one heading");
    assert.ok(Math.abs(facing().y) < 1e-7, "pitch never tilts the model");
    assert.equal(art.rotation.y, Math.PI, "authored local axis correction is preserved");
  };
  game.controls.setLookAt(8, 6, 0, 0, 1, 0, false);
  advance(game, .1); check();
  assert.ok(player.transform.position.distanceTo(start) < .01, "orbiting alone does not move the character");
  const heading = cameraHeading();
  for (const action of ["right", "backward"]) {
    const before = player.transform.position.clone();
    game.input.setAction(action, true); advance(game, .5); game.input.reset();
    check();
    const delta = player.transform.position.clone().sub(before);
    assert.ok(delta.length() > 1.8, "directional movement remains responsive");
    assert.ok(action === "backward" ? delta.dot(heading) < -1.8 : Math.abs(delta.dot(heading)) < .01,
      "backpedal and strafe preserve camera-relative movement");
  }
  const p = player.transform.position;
  game.controls.setLookAt(p.x + 8, p.y + 60, p.z, p.x, p.y, p.z, false);
  advance(game, .1); check();
  assert.ok(cameraHeading().dot(heading) > .999, "model turning never changes camera yaw");
});

test("player facing supports movement/manual ownership and preserves heading when disabled or looking vertically", async t => {
  const game = await headlessGame(t);
  const { player } = floorAndPlayer(game, { facing: "movement", cameraRelative: false });
  advance(game, 1);
  game.input.setAction("right", true); advance(game, .4); game.input.reset();
  const east = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
  assert.ok(player.transform.rotation.angleTo(east) < .001, "movement mode faces world-space travel");
  advance(game, .5);
  assert.ok(player.transform.rotation.angleTo(east) < .001, "idle movement mode keeps its last heading");
  player.player.facing = "manual";
  const custom = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .4);
  player.body.setNextKinematicRotation(custom);
  game.input.setAction("backward", true); advance(game, .4); game.input.reset();
  assert.ok(player.transform.rotation.angleTo(custom) < .001, "manual ownership survives walking and physics sync");
  player.player.facing = "camera";
  player.player.enabled = false;
  game.controls.setLookAt(-8, 6, 0, 0, 1, 0, false); advance(game, .2);
  assert.ok(player.transform.rotation.angleTo(custom) < .001, "disabled players do not turn in menus");
  game.releaseCamera(); game.controls.enabled = false;
  game.camera.rotation.set(-Math.PI / 2, 0, 0); game.camera.updateMatrixWorld();
  player.player.enabled = true; advance(game, .2);
  assert.ok(player.transform.rotation.angleTo(custom) < .001, "vertical camera keeps the previous yaw");
  const count = game.world.entities.length;
  assert.throws(() => game.addPlayer({ facing: "invalid" }), /facing/);
  assert.equal(game.world.entities.length, count, "invalid facing allocates no actor");
});

test("voxel avatars inherit player heading once without cancelling limb animation", async t => {
  const game = await headlessGame(t);
  const { player } = floorAndPlayer(game);
  createVoxelKit(game, { lighting: false }).avatar(player);
  const art = player.mesh.children.find(child => child.isGroup);
  game.controls.setLookAt(8, 6, 8, 0, 1, 0, false); advance(game, 1);
  game.input.setAction("right", true); advance(game, .3); game.input.reset();
  assert.ok(art.getWorldQuaternion(new THREE.Quaternion()).angleTo(player.mesh.quaternion) < .001,
    "strafing does not add a second movement-facing rotation");
  assert.ok(art.children.some(child => Math.abs(child.rotation.x) > .01), "limbs still animate while moving");
  player.player.facing = "manual";
  player.body.setNextKinematicRotation(new THREE.Quaternion());
  game.input.setAction("backward", true); advance(game, .3); game.input.reset();
  assert.ok(art.getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion()) < .001,
    "voxel presentation also respects custom player rotation");
});

test("player clearance adapts to fixed step and gravity; exact opt-out and other teleports remain exact", async t => {
  const game=await headlessGame(t,{fixedTimeStep:1/30,gravity:{x:0,y:-30,z:0}});
  const {player}=floorAndPlayer(game);
  player.player.enabled=false;advance(game,3,()=>assert.ok(player.body.translation().y>=1.005));
  assert.equal(player.player.grounded,true);
  game.teleport(player,[2,1,0]);advance(game,2);
  assert.ok(Math.abs(player.body.translation().y-1.02)<.025);
  const exact=game.addPlayer({position:[3,4,5],spawnClearance:0});
  assert.deepEqual({...exact.body.translation()},{x:3,y:4,z:5});
  game.teleport(exact,[6,7,8]);assert.deepEqual({...exact.body.translation()},{x:6,y:7,z:8});
  for(const body of ["fixed","dynamic","kinematic","none"]) {
    const box=game.addBox({position:[0,4,0],body});
    game.teleport(box,[2,3,4]);
    assert.deepEqual(box.transform.position.toArray(),[2,3,4]);
    assert.deepEqual(box.mesh.position.toArray(),[2,3,4]);
    if(box.body)assert.deepEqual({...box.body.translation()},{x:2,y:3,z:4});
  }
  assert.throws(()=>game.addPlayer({spawnClearance:-1}),/spawnClearance/);
});

test("reset plus delayed evasion remains playable against a real chasing kinematic collider", async t => {
  const game=await headlessGame(t);
  const {player}=floorAndPlayer(game);
  const golem=game.addBox({size:[1.15,2,1.15],position:[0,1,-4],body:"kinematic"});
  for(const [size,position] of [[[20.8,2.4,.7],[0,1.2,-10.25]],[[20.8,2.4,.7],[0,1.2,10.25]],[[.7,2.4,19.8],[-10.25,1.2,0]],[[.7,2.4,19.8],[10.25,1.2,0]]])game.addBox({size,position});
  player.player.enabled=false;advance(game,3);
  game.teleport(player,[0,1,0]);game.teleport(golem,[0,1,-4]);
  player.player.enabled=true;
  let elapsed=0,health=3,cooldown=0;
  game.onUpdate(dt=>{
    elapsed+=dt;cooldown=Math.max(0,cooldown-dt);
    const from=golem.body.translation(),to=player.body.translation();
    const dx=to.x-from.x,dz=to.z-from.z,distance=Math.hypot(dx,dz);
    if(distance>.001){const step=Math.min(1.5*dt,distance);golem.body.setNextKinematicTranslation({x:from.x+dx/distance*step,y:1,z:from.z+dz/distance*step});}
    if(cooldown<=0&&player.physicsBody.collider.contactCollider(golem.physicsBody.collider,.08)){health--;cooldown=1;}
  });
  for(let i=0;i<600;i++) {
    game.input.reset();
    const action=elapsed<1.8?null:elapsed<3.2?"left":elapsed<4.6?"forward":elapsed<5.25?null:elapsed<7.9?"right":"backward";
    if(action)game.input.setAction(action,true);
    game.engine.update(1/60);
    assert.ok(player.body.translation().y>=1.005,"evasion cannot depend on recovering from floor penetration");
  }
  assert.ok(health>0,"delayed evasion escapes after the initial close encounter");
  assert.ok(player.body.translation().x>3&&player.body.translation().z>1,"both directional legs advanced through the arena");
});

test("manual camera poses survive frames while fixed follow, scripted controls and default core ownership still update", async t => {
  const game=await headlessGame(t,{gravity:{x:0,y:0,z:0}});
  game.controls.enabled=false;
  game.camera.position.set(7,9,11);game.camera.lookAt(3,4,0);
  const rotation=game.camera.quaternion.clone();
  advance(game,.2);
  assert.deepEqual(game.camera.position.toArray(),[7,9,11]);
  assert.ok(game.camera.quaternion.angleTo(rotation)<1e-7,"disabled standalone controls must not reset mouse aim");
  const target=game.addBox({position:[2,3,4],body:"none"});
  game.followCamera(target,{mode:"fixed",offset:[0,5,8]});
  game.teleport(target,[4,3,2]);advance(game,.1);
  assert.equal(game.controls.enabled,false);
  assert.ok(game.camera.position.distanceTo(new THREE.Vector3(4,8,10))<1e-7,"fixed follow still owns its camera despite disabled mouse input");
  game.releaseCamera();
  game.camera.position.set(1,2,3);advance(game,.1);
  assert.deepEqual(game.camera.position.toArray(),[1,2,3]);
  game.controls.enabled=true;
  const none=game.controls.constructor.ACTION.NONE;
  for(const key of Object.keys(game.controls.mouseButtons))game.controls.mouseButtons[key]=none;
  for(const key of Object.keys(game.controls.touches))game.controls.touches[key]=none;
  game.controls.setLookAt(5,6,7,0,0,0,false);advance(game,.1);
  assert.ok(game.camera.position.distanceTo(new THREE.Vector3(5,6,7))<1e-7,"input-free scripted controls still update");
  delete game.engine.getResource("camera").shouldUpdateControls;
  game.controls.enabled=false;
  game.controls.setLookAt(8,9,10,0,0,0,false);advance(game,.1);
  assert.ok(game.camera.position.distanceTo(new THREE.Vector3(8,9,10))<1e-7,"core camera update remains unconditional without the helper ownership predicate");
});

test("follow camera collision hides a too-close avatar and restores it when the wall clears", async t => {
  const game=await headlessGame(t,{gravity:{x:0,y:0,z:0}});
  const kit=createVoxelKit(game,{lighting:false});
  const hero=kit.avatar(game.addPlayer({position:[0,1,0]}));
  hero.player.enabled=false;
  game.followCamera(hero,{offset:[0,5.5,8],lookOffset:[0,.6,0]});
  advance(game,.1);
  const clearDistance=game.controls.getSpherical(undefined,false).radius;
  const wall=game.addBox({size:[8,8,1],position:[0,4,1.05]});
  advance(game,.1);
  const radius=game.controls.getSpherical(undefined,false).radius;
  const bounds=new THREE.Box3().setFromObject(hero.mesh);
  t.diagnostic(JSON.stringify({radius,minDistance:game.controls.minDistance,visualDistance:bounds.distanceToPoint(game.camera.position),visible:hero.mesh.visible}));
  assert.ok(radius<game.controls.minDistance,"collision can legitimately shorten the camera below its dolly minimum");
  assert.ok(bounds.distanceToPoint(game.camera.position)<.25,"the actual camera is inside or close to the followed visual");
  assert.equal(hero.mesh.visible,false,"the near avatar must not fill the camera view");
  game.remove(wall);advance(game,.1);
  assert.ok(Math.abs(game.controls.getSpherical(undefined,false).radius-clearDistance)<.01);
  assert.equal(hero.mesh.visible,true,"the avatar returns when the desired view is unobstructed");
});

test("near-follow visibility preserves hidden owners and shared materials across follow lifecycle changes", async t => {
  const game=await headlessGame(t,{gravity:{x:0,y:0,z:0}});
  const hero=game.addBox({size:[2,2,2],body:"none"});
  const sibling=game.addBox({position:[5,0,0],body:"none"});
  sibling.mesh.material.dispose();sibling.mesh.material=hero.mesh.material;
  const shared=hero.mesh.material;
  const close=entity=>{game.followCamera(entity,{offset:[0,0,.5],lookOffset:[0,0,0],mode:"fixed"});advance(game,.02);};
  hero.mesh.visible=false;close(hero);game.releaseCamera();
  assert.equal(hero.mesh.visible,false,"a caller-hidden target stays hidden after release");
  hero.mesh.visible=true;close(hero);
  assert.equal(hero.mesh.visible,false);
  assert.equal(shared.visible,true);assert.equal(sibling.mesh.visible,true,"a shared-material sibling remains visible");
  game.releaseCamera();assert.equal(hero.mesh.visible,true);

  close(hero);
  const oldMesh=hero.mesh;
  const replacement=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),new THREE.MeshBasicMaterial());
  hero.mesh=replacement;hero.renderable.mesh=replacement;
  advance(game,.02);
  assert.equal(oldMesh.visible,true,"replaced renderables release their previous visibility ownership");
  assert.equal(replacement.visible,false,"replacement visual is assessed independently");
  game.world.removeComponent(hero,"renderable");advance(game,.02);
  assert.equal(replacement.visible,true,"removing the component restores its visual immediately on the next frame");

  const target=game.addBox({size:[2,2,2],body:"none"});close(target);
  game.followCamera(sibling,{offset:[0,3,8]});
  assert.equal(target.mesh.visible,true,"switching followed entities restores the previous target");
  close(target);game.world.remove(target);
  assert.equal(target.mesh.visible,true,"direct world removal releases hidden visibility synchronously");

  const final=game.addBox({size:[2,2,2],body:"none"});close(final);
  const other=await createGame({autoStart:false,gravity:{x:0,y:0,z:0}});t.after(()=>other.dispose());
  const otherTarget=other.addBox({size:[2,2,2],body:"none"});
  other.followCamera(otherTarget,{offset:[0,0,.5],lookOffset:[0,0,0],mode:"fixed"});advance(other,.02);
  assert.equal(otherTarget.mesh.visible,false);
  game.dispose();assert.equal(final.mesh.visible,true,"game disposal restores its hidden target");
  assert.equal(otherTarget.mesh.visible,false,"disposing one game cannot reveal the other game's target");
  other.releaseCamera();assert.equal(otherTarget.mesh.visible,true);
});

test("near-follow visibility uses animated scaled child bounds and hysteresis", async t => {
  const game=await headlessGame(t,{gravity:{x:0,y:0,z:0}});
  const hero=game.addBox({size:[.1,.1,.1],body:"none"});
  const child=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());
  child.scale.set(2,2,2);child.position.set(0,0,4);hero.mesh.add(child);
  game.followCamera(hero,{offset:[0,0,5.1],lookOffset:[0,0,4],mode:"fixed"});
  advance(game,.02);
  assert.equal(hero.mesh.visible,false,"child geometry near the camera matters even far from the entity origin");
  game.onFrame(()=>child.position.z=0);
  advance(game,.02);
  assert.equal(hero.mesh.visible,true,"final presentation transforms are measured before rendering");
  game.followCamera(hero,{offset:[0,0,1.3],lookOffset:[0,0,0],mode:"orbit"});
  advance(game,.02);assert.equal(hero.mesh.visible,false);
  game.controls.dollyTo(1.4,false);advance(game,.02);
  assert.equal(hero.mesh.visible,false,"a small outward oscillation must not reveal the avatar");
  game.controls.dollyTo(1.6,false);advance(game,.02);
  assert.equal(hero.mesh.visible,true,"moving past the release margin restores the avatar");
});

test("overlapping kit actors share near-camera protection without hiding unregistered geometry", async t => {
  const game=await headlessGame(t,{gravity:{x:0,y:0,z:0}});
  const kit=createVoxelKit(game,{lighting:false});
  const hero=kit.avatar(game.addPlayer({position:[0,1,0]}));hero.player.enabled=false;
  const golem=kit.avatar(game.addBox({size:[1.15,2,1.15],position:[0,1,0],body:"kinematic"}));
  const unregistered=game.addBox({size:[1.15,2,1.15],position:[0,1,0],body:"none"});
  const wall=game.addBox({size:[8,8,1],position:[0,4,1.05]});
  game.followCamera(hero,{offset:[0,5.5,8],lookOffset:[0,.6,0]});
  advance(game,.1);
  // Match the observed post-loss overlap after the last kinematic move. Render
  // that frozen state without asking physics to separate the actors first.
  game.teleport(golem,hero.transform.position);
  game.teleport(unregistered,hero.transform.position);
  game.engine.update(0);
  const positions=[hero.body.translation(),golem.body.translation()].map(p=>({...p}));
  t.diagnostic(JSON.stringify({camera:game.camera.position.toArray(),positions,distances:[hero,golem].map(e=>new THREE.Box3().setFromObject(e.mesh).distanceToPoint(game.camera.position)),visible:[hero.mesh.visible,golem.mesh.visible]}));
  assert.equal(hero.mesh.visible,false);
  assert.equal(golem.mesh.visible,false,"an overlapping registered enemy must not fill the camera after the hero hides");
  assert.equal(unregistered.mesh.visible,true,"ordinary unregistered geometry is outside this visibility policy");
  assert.equal(wall.mesh.visible,true,"camera blockers must stay visible");
  assert.equal(golem.mesh.children[0].children[0].material.visible,true,"shared avatar materials are untouched");
  game.engine.update(0);
  assert.deepEqual([hero.body.translation(),golem.body.translation()].map(p=>({...p})),positions,"visibility cannot change actor physics poses");
  kit.avatar(golem,{color:"#f08030"});game.engine.update(0);
  assert.equal(golem.mesh.visible,false,"redecoration retires its old registration and protects the new visual");
  kit.dispose();
  assert.equal(golem.mesh.visible,true,"kit disposal releases nonfollowed avatar registration immediately");
  game.engine.update(0);
  assert.equal(golem.mesh.visible,true,"former kit actors are no longer implicitly hidden");
  assert.equal(hero.mesh.visible,false,"the plain followed proxy still has default protection");
  game.releaseCamera();assert.equal(hero.mesh.visible,true);
});

test("explicit camera visual registrations retain independent leases and restore across removal and disposal", async t => {
  const game=await headlessGame(t,{gravity:{x:0,y:0,z:0}});
  const target=game.addBox({position:[0,0,-3],body:"none"});
  const actor=game.addBox({size:[2,2,2],body:"none"});
  const close=()=>{game.followCamera(target,{offset:[0,0,3.2],lookOffset:[0,0,0],mode:"fixed"});game.engine.update(0);};
  const release1=game.registerCameraVisual(actor),release2=game.registerCameraVisual(actor);
  game.controls.enabled=false;game.camera.position.set(0,0,.2);game.engine.update(0);
  assert.equal(actor.mesh.visible,true,"registered actors stay visible when no follow camera is active");
  close();assert.equal(actor.mesh.visible,false);
  release1();release1();assert.equal(actor.mesh.visible,false,"one released lease cannot reveal an actor with another owner");
  release2();assert.equal(actor.mesh.visible,true);
  game.engine.update(0);assert.equal(actor.mesh.visible,true);
  actor.mesh.visible=false;const releaseHidden=game.registerCameraVisual(actor);
  close();releaseHidden();assert.equal(actor.mesh.visible,false,"an explicitly hidden registered actor remains hidden");
  actor.mesh.visible=true;game.registerCameraVisual(actor);close();
  game.world.remove(actor);assert.equal(actor.mesh.visible,true,"direct removal restores registered nonfollowed actors synchronously");
  const last=game.addBox({size:[2,2,2],body:"none"});const releaseLast=game.registerCameraVisual(last);close();
  const other=await createGame({autoStart:false});t.after(()=>other.dispose());
  const otherTarget=other.addBox({position:[0,0,-3],body:"none"}),otherActor=other.addBox({size:[2,2,2],body:"none"});
  other.registerCameraVisual(otherActor);other.followCamera(otherTarget,{offset:[0,0,3.2],lookOffset:[0,0,0],mode:"fixed"});other.engine.update(0);
  assert.equal(otherActor.mesh.visible,false);
  assert.equal(last.mesh.visible,false);game.dispose();assert.equal(last.mesh.visible,true);releaseLast();
  assert.equal(otherActor.mesh.visible,false,"disposing another game cannot reveal registered actors here");
  other.releaseCamera();assert.equal(otherActor.mesh.visible,true);
});

test("jumpSpeed zero disables held/repeated jump input without changing grounded walking or positive jumps", async t => {
  const game = await headlessGame(t);
  const { player } = floorAndPlayer(game, { jumpSpeed: 0, cameraRelative: false });
  advance(game, 1);
  const standingY = player.body.translation().y;
  for (let i = 0; i < 90; i++) {
    game.input.setAction("jump", i < 60 || i % 2 === 0);
    game.input.setAction("forward", true);
    game.engine.update(1 / 60);
    assert.equal(player.player.grounded, true);
    assert.ok(Math.abs(player.body.translation().y - standingY) < .02, "zero jump never launches or sinks the capsule");
  }
  assert.ok(player.body.translation().z < -4.5, "zero jump does not disable normal walking");
  game.input.reset();
  player.player.jumpSpeed = 6;
  game.input.setAction("jump", true); advance(game, .2);
  assert.ok(player.body.translation().y > standingY + .5, "enabling a positive jump still launches normally");
  for (const jumpSpeed of [-1, NaN, Infinity]) assert.throws(() => game.addPlayer({ jumpSpeed }), /jumpSpeed/);
});

function pointerFixture(game) {
  const canvas = game.renderer.domElement, document = canvas.ownerDocument;
  let requests = 0, exits = 0;
  canvas.focus = () => { document.activeElement = canvas; };
  canvas.requestPointerLock = () => {
    requests++;
    document.pointerLockElement = canvas;
    document.dispatchEvent(new Event("pointerlockchange"));
    return Promise.resolve();
  };
  document.exitPointerLock = () => {
    exits++;
    document.pointerLockElement = null;
    document.dispatchEvent(new Event("pointerlockchange"));
  };
  return { canvas, document, requests: () => requests, exits: () => exits,
    move(x, y) { document.dispatchEvent(Object.assign(new Event("mousemove"), { movementX: x, movementY: y })); },
    click() { canvas.dispatchEvent(Object.assign(new Event("mousedown"), { button: 0 })); document.dispatchEvent(Object.assign(new Event("mouseup"), { button: 0 })); canvas.dispatchEvent(new Event("click")); },
  };
}

test("firstPerson defaults forward -Z, tracks the eye through movement/reset and gates input/fire on pointer lock", async t => {
  const game = await headlessGame(t), { player } = floorAndPlayer(game, { jumpSpeed: 0 });
  const pointer = pointerFixture(game);
  let shots = 0, activeSeconds = 0;
  const visible = player.mesh.visible, previousEnabled = player.player.enabled;
  const fps = game.firstPerson(player, { eyeOffset: [0, .6, 0], onFire: () => shots++ });
  assert.equal(fps.enabled, false); assert.equal(fps.active, false);
  assert.equal(player.player.enabled, false); assert.equal(player.mesh.visible, false);
  assert.ok(game.camera.getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-7);
  game.onUpdate(dt => { if (fps.active) activeSeconds += dt; });
  advance(game, .2); assert.equal(activeSeconds, 0);
  fps.start(); await Promise.resolve();
  assert.equal(pointer.requests(), 1); assert.equal(fps.active, true); assert.equal(player.player.enabled, true);
  assert.equal(game.controls.enabled, false);
  game.input.setAction("forward", true); advance(game, .5); game.input.reset();
  assert.ok(player.transform.position.z < -1.5, "W moves toward the visible -Z arena by default");
  assert.ok(Math.abs(game.camera.position.y - player.mesh.position.y - .6) < 1e-7);
  pointer.move(180, -70);
  const aim = game.camera.quaternion.clone();
  assert.ok(aim.angleTo(new THREE.Quaternion()) > .2);
  pointer.click(); assert.equal(shots, 1);
  pointer.document.dispatchEvent(Object.assign(new Event("keydown"), { code: "Escape" }));
  assert.equal(fps.enabled, true); assert.equal(fps.active, false); assert.equal(player.player.enabled, false);
  const before = activeSeconds, position = player.transform.position.clone();
  game.input.setAction("forward", true); advance(game, .5);
  assert.equal(activeSeconds, before); assert.ok(Math.abs(player.transform.position.z - position.z) < .01);
  pointer.click(); await Promise.resolve();
  assert.equal(fps.active, true); assert.equal(shots, 1, "reacquiring click never shoots, even with synchronous lock acquisition");
  assert.ok(game.camera.quaternion.angleTo(aim) < 1e-7, "resume preserves aim");
  pointer.click(); assert.equal(shots, 2);
  game.teleport(player, [3, 1, 4]); game.engine.update(0);
  assert.ok(Math.abs(game.camera.position.x - 3) < 1e-7); assert.ok(Math.abs(game.camera.position.z - 4) < 1e-7);
  fps.stop(); pointer.click(); assert.equal(pointer.requests(), 2, "stopped sessions do not reacquire on canvas clicks");
  fps.start(); await Promise.resolve();
  assert.ok(game.camera.getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(0, 0, -1)) < 1e-7, "new round resets configured aim");
  fps.dispose(); fps.dispose();
  assert.equal(player.mesh.visible, visible); assert.equal(player.player.enabled, previousEnabled);
  assert.equal(fps.active, false); assert.equal(game.controls.enabled, true);
  assert.throws(() => fps.start(), /disposed/);
});

test("firstPerson denial stays playable through fallback and late lock cannot revive a removed owner", async t => {
  const game = await headlessGame(t), player = game.addPlayer({ position: [0, 5, 0] });
  const pointer = pointerFixture(game), fps = game.firstPerson(player);
  pointer.canvas.requestPointerLock = () => Promise.reject(new Error("denied fixture"));
  fps.start(); await Promise.resolve(); await Promise.resolve();
  assert.equal(fps.active, true); assert.equal(player.player.enabled, true); assert.equal(fps.locked, false);
  assert.match(pointer.canvas.dataset.pointerLockFailure, /denied fixture/);
  fps.stop();
  let complete;
  pointer.canvas.requestPointerLock = () => new Promise(resolve => { complete = resolve; });
  fps.start();
  game.remove(player); assert.equal(fps.enabled, false);
  pointer.document.pointerLockElement = pointer.canvas;
  complete(); await Promise.resolve();
  assert.equal(pointer.document.pointerLockElement, null, "late promise releases an abandoned canvas lock");
  assert.equal(game.controls.enabled, true);
});

test("firstPerson restores hidden roots and controls across follow/manual/replacement ownership and disposal", async t => {
  const game = await headlessGame(t), player = game.addPlayer({ position: [0, 5, 0] });
  const pointer = pointerFixture(game);
  player.mesh.visible = false; player.player.enabled = false;
  game.controls.enabled = false;
  const hidden = game.firstPerson(player, { yaw: Math.PI / 2 });
  hidden.start(); await Promise.resolve();
  assert.ok(game.camera.getWorldDirection(new THREE.Vector3()).x < -.99);
  game.releaseCamera(); assert.equal(player.mesh.visible, false); assert.equal(player.player.enabled, false); assert.equal(game.controls.enabled, false);
  game.camera.position.set(2, 3, 4); advance(game, .1); assert.deepEqual(game.camera.position.toArray(), [2, 3, 4]);
  player.mesh.visible = true; game.controls.enabled = true;
  const first = game.firstPerson(player);
  assert.throws(() => game.firstPerson(player, { sensitivity: 0 }), /sensitivity/);
  assert.equal(first.enabled, false); assert.equal(player.mesh.visible, false, "invalid replacement retains the previous owner");
  const second = game.firstPerson(player, { hideBody: false });
  assert.equal(player.mesh.visible, true); assert.throws(() => first.start(), /disposed/);
  second.start(); await Promise.resolve();
  game.followCamera(player, { mode: "fixed", offset: [0, 4, 6] });
  assert.equal(second.enabled, false); assert.equal(player.mesh.visible, true);
  game.engine.update(0);
  assert.ok(Math.abs(game.camera.position.z - player.transform.position.z - 6) < .001);
  const fps = game.firstPerson(player);
  const oldRoot = player.mesh;
  const replacement = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  player.mesh = replacement; player.renderable.mesh = replacement; game.scene.add(replacement); game.engine.update(0);
  assert.equal(oldRoot.visible, true); assert.equal(replacement.visible, false);
  game.engine.dispose(); assert.equal(fps.enabled, false); assert.equal(replacement.visible, true);
  const pose = game.camera.quaternion.clone(); pointer.move(100, 50); pointer.click();
  assert.ok(game.camera.quaternion.equals(pose), "disposed listeners cannot move a camera");
});

test("two first-person games share a document without firing, looking or releasing one another's lock", async t => {
  const a = await headlessGame(t), b = await createGame({ autoStart: false }); t.after(() => b.dispose());
  const pa = pointerFixture(a), pb = pointerFixture(b);
  assert.equal(pa.document, pb.document);
  let shotsA = 0, shotsB = 0;
  const fa = a.firstPerson(a.addPlayer(), { onFire: () => shotsA++ });
  const fb = b.firstPerson(b.addPlayer(), { onFire: () => shotsB++ });
  fa.start(); await Promise.resolve(); assert.equal(fa.active, true); assert.equal(fb.active, false);
  const bAim = b.camera.quaternion.clone(); pa.move(100, 20); pa.click();
  assert.equal(shotsA, 1); assert.equal(shotsB, 0); assert.ok(b.camera.quaternion.equals(bAim));
  fb.start(); await Promise.resolve(); assert.equal(fa.active, false); assert.equal(fb.active, true);
  const aAim = a.camera.quaternion.clone(); pb.move(-100, 20); pb.click();
  assert.equal(shotsA, 1); assert.equal(shotsB, 1); assert.ok(a.camera.quaternion.equals(aAim));
  fa.dispose(); assert.equal(pa.document.pointerLockElement, pb.canvas); assert.equal(fb.active, true);
  b.dispose(); assert.equal(pa.document.pointerLockElement, null);
});

test("firstPerson suppresses competing legacy pointer lock only while it owns the camera", async t => {
  const game = await headlessGame(t), player = game.addPlayer();
  game.engine.gameConfig.CAMERA = { POINTER_LOCK: { ENABLED: true, TRIGGER: "click", RELEASE: "manual" } };
  game.input.isMouseDown = () => true;
  let legacyRequests = 0;
  t.mock.method(game.controls, "lockPointer", () => legacyRequests++);
  const fps = game.firstPerson(player);
  advance(game, .1); assert.equal(legacyRequests, 0);
  fps.dispose(); game.engine.update(1 / 60); assert.equal(legacyRequests, 1);
  delete game.engine.getResource("camera").shouldUpdatePointerLock;
  game.engine.update(1 / 60); assert.equal(legacyRequests, 2, "raw-core behavior remains unchanged without an ownership predicate");
});
