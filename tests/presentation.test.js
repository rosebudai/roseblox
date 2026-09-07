import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createEnvironment } from "../src/environment.js";
import { createRenderPipelineSlot } from "../src/resources/renderer/renderPipeline.js";
import { setupLighting } from "../src/resources/lightingSetup.js";
import { GameSystems } from "../src/gameSystems.js";

function texture() {
  const value = new THREE.Texture(); value.releases = 0;
  value.addEventListener("dispose", () => value.releases++);
  return value;
}
const fakeRenderer = () => ({ capabilities: { getMaxAnisotropy: () => 8 }, getPixelRatio: () => 1.5 });

test("environment maps own replacement, restore original scene, and dispose once", async () => {
  const scene = new THREE.Scene(), original = new THREE.Color("black"), first = texture(), second = texture();
  scene.background = original;
  const manager = createEnvironment({ scene, renderer: fakeRenderer(), loadTexture: async url => url === "first" ? first : second });
  await manager.set("first", { intensity: 0.6, rotation: 0.5 });
  assert.equal(scene.background, first); assert.equal(scene.environment, first);
  assert.equal(first.mapping, THREE.EquirectangularReflectionMapping);
  assert.equal(first.colorSpace, THREE.SRGBColorSpace); assert.equal(first.anisotropy, 8);
  await manager.set("second", { background: false });
  assert.equal(first.releases, 1); assert.equal(scene.background, original); assert.equal(scene.environment, second);
  manager.dispose(); manager.dispose();
  assert.equal(second.releases, 1); assert.equal(scene.environment, null);
  assert.equal(scene.environmentIntensity, 1); assert.equal(scene.environmentRotation.y, 0);
});

test("stale and disposed panorama loads cannot change the scene or retain textures", async () => {
  const scene = new THREE.Scene(), pending = new Map();
  const manager = createEnvironment({ scene, renderer: fakeRenderer(), loadTexture: url => new Promise(resolve => pending.set(url, resolve)) });
  const stale = manager.set("old"), current = manager.set("new");
  const old = texture(), newer = texture(); pending.get("new")(newer); await current;
  const rejected = assert.rejects(stale, /superseded/); pending.get("old")(old); await rejected;
  assert.equal(scene.environment, newer); assert.equal(old.releases, 1);
  const later = manager.set("later"); manager.dispose();
  const last = texture(); const disposed = assert.rejects(later, /disposed/); pending.get("later")(last); await disposed;
  assert.equal(last.releases, 1); assert.equal(newer.releases, 1); assert.equal(scene.environment, null);
});

test("failed loads retain the current environment and caller replacements survive clear", async () => {
  const scene = new THREE.Scene(), first = texture(), caller = texture();
  const manager = createEnvironment({ scene, renderer: fakeRenderer(), loadTexture: async url => { if (url === "bad") throw new Error("download failed"); return first; } });
  await manager.set("first"); await assert.rejects(manager.set("bad"), /download failed/);
  assert.equal(scene.environment, first); scene.background = caller;
  manager.clear(); assert.equal(scene.background, caller); assert.equal(first.releases, 1); assert.equal(caller.releases, 0);
  await assert.rejects(manager.set("", {}), /URL/);
});

test("custom pipeline renders exactly once after frame callbacks, resizes, replaces and disposes", async () => {
  const calls = [], renderer = { ...fakeRenderer(), render: () => calls.push("default") };
  const slot = createRenderPipelineSlot(renderer);
  const engine = new GameSystems({ coreSystems: false });
  engine.registerResource("renderer", () => ({ renderer, scene: {}, pipeline: slot, dispose: () => slot.dispose() }));
  engine.registerResource("camera", () => ({ camera: {} }));
  engine.registerSystem("frame", { phase: "frame", update: () => calls.push("frame") });
  await engine.init({ autoStart: false });
  slot.resize(900, 600);
  let releases = 0;
  slot.set({ render: dt => calls.push(["custom", dt]), resize: (...size) => calls.push(size), dispose: () => releases++ });
  assert.deepEqual(calls.pop(), [900, 600, 1.5]);
  engine.update(1/60); assert.deepEqual(calls.splice(0), ["frame", ["custom", 1/60]]);
  const version = slot.reserve(); slot.set(null); assert.notEqual(slot.version, version);
  engine.update(1/60); assert.deepEqual(calls.splice(0), ["frame", "default"]); assert.equal(releases, 1);
  let failedReleases = 0;
  assert.throws(() => slot.set({ render() {}, resize() { throw new Error("bad resize"); }, dispose() { failedReleases++; } }), /bad resize/);
  assert.equal(failedReleases, 1);
  engine.dispose(); engine.dispose(); assert.equal(releases, 1); assert.equal(slot.disposed, true);
});

test("custom lighting skips both default lights while legacy defaults remain", async () => {
  const scene = new THREE.Scene();
  const none = await setupLighting(null, { renderer: { scene } }, { lighting: false });
  assert.equal(scene.children.length, 0); assert.equal(none.directionalLight, null);
  const defaults = await setupLighting(null, { renderer: { scene } }, { LIGHTING: { AMBIENT_COLOR: 0, DIRECTIONAL_INTENSITY: 0 } });
  assert.equal(scene.children.length, 2); assert.equal(defaults.ambientLight.color.getHex(), 0);
  assert.equal(defaults.directionalLight.intensity, 0);
});
