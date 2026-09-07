import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { GameSystems } from "../src/gameSystems.js";
import { setupCamera } from "../src/resources/cameraSetup.js";
import { disposeObject } from "../src/resources/renderer/disposeObject.js";

test("camera-attached view models join their scene and release through engine disposal", async (t) => {
  const previousDOMRect = globalThis.DOMRect;
  globalThis.DOMRect = class DOMRect {
    constructor(x = 0, y = 0, width = 0, height = 0) { Object.assign(this, { x, y, width, height }); }
  };
  t.after(() => { if (previousDOMRect) globalThis.DOMRect = previousDOMRect; else delete globalThis.DOMRect; });
  const document = new EventTarget();
  class Canvas extends EventTarget {
    style = {};
    ownerDocument = document;
    setAttribute() {}
    removeAttribute() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  }
  const scene = new THREE.Scene();
  let resizeUnsubscribed = 0;
  const engine = new GameSystems({ coreSystems: false });
  engine.registerResource("renderer", () => ({
    scene, width: 800, height: 600, renderer: { domElement: new Canvas() },
    onResize: () => () => resizeUnsubscribed++,
    dispose(released) { disposeObject(scene, released); scene.clear(); },
  }));
  engine.registerResource("camera", (config, dependencies) => setupCamera(engine.world, dependencies, config), { dependencies: ["renderer"] });
  await engine.init({ autoStart: false });
  const { camera } = engine.getResource("camera");
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const bow = new THREE.Group();
  bow.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  camera.add(bow);
  assert.equal(camera.parent, scene);
  assert.equal(scene.getObjectById(bow.id), bow, "Rendering traverses the scene, so its camera's view model must be reachable");
  const releases = { geometry: 0, material: 0, texture: 0 };
  for (const [name, resource] of Object.entries({ geometry, material, texture })) resource.addEventListener("dispose", () => releases[name]++);
  engine.dispose(); engine.dispose();
  assert.deepEqual(releases, { geometry: 1, material: 1, texture: 1 });
  assert.equal(resizeUnsubscribed, 1);
  assert.equal(scene.children.length, 0);
  assert.equal(engine.getDiagnostics().errorCount, 0);
});
