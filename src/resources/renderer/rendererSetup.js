import * as THREE from "three";
import { gltfMeshFactory, proceduralMeshFactory } from "./meshFactories.js";
import { disposeObject } from "./disposeObject.js";
import { createRenderPipelineSlot } from "./renderPipeline.js";

/** Creates a renderer sized to its container; all resources are owned by the game. */
export async function setupRenderer(config = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(config.SCENE?.BACKGROUND_COLOR ?? 0x000000);
  const renderer = new THREE.WebGLRenderer({
    antialias: config.RENDERER?.ANTIALIAS ?? true,
    canvas: config.canvas,
  });
  renderer.setPixelRatio(Math.min(config.pixelRatio ?? globalThis.devicePixelRatio ?? 1, config.maxPixelRatio ?? 2));
  renderer.shadowMap.enabled = config.shadows ?? true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(scene.background);
  const container = config.container ?? renderer.domElement.parentElement;
  const document = renderer.domElement.ownerDocument;
  // A body with no explicit height initially measures the canvas default (150px).
  // Legacy full-page games should retain viewport sizing; embedded games use
  // their actual container bounds or an explicitly supplied container.
  const usesViewport = !config.container && (!container || container === document.body || container === document.documentElement);
  const meshFactoryRegistry = new Map();
  const resizeListeners = new Set();
  let disposed = false;
  const resource = {
    renderer, scene, meshFactoryRegistry,
    pipeline: createRenderPipelineSlot(renderer),
    width: 1, height: 1,
    registerMeshFactory: (name, factory) => meshFactoryRegistry.set(name, factory),
    getMeshFactory: (name) => meshFactoryRegistry.get(name),
    onResize(callback) { resizeListeners.add(callback); return () => resizeListeners.delete(callback); },
    resize() {
      resource.width = Math.max(1, config.width ?? ((!usesViewport && container?.clientWidth) || globalThis.innerWidth || 1));
      resource.height = Math.max(1, config.height ?? ((!usesViewport && container?.clientHeight) || globalThis.innerHeight || 1));
      renderer.setSize(resource.width, resource.height);
      resource.pipeline.resize(resource.width, resource.height);
      for (const callback of resizeListeners) callback(resource.width, resource.height);
    },
    dispose(disposedResources = new Set()) {
      if (disposed) return;
      disposed = true;
      globalThis.window?.removeEventListener("resize", resource.resize);
      observer?.disconnect();
      resizeListeners.clear();
      resource.pipeline.dispose();
      disposeObject(scene, disposedResources);
      if (scene.background?.isTexture) scene.background.dispose();
      if (scene.environment?.isTexture && scene.environment !== scene.background) scene.environment.dispose();
      scene.clear();
      meshFactoryRegistry.clear();
      renderer.dispose();
    },
  };
  resource.registerMeshFactory("procedural", proceduralMeshFactory);
  resource.registerMeshFactory("gltf", gltfMeshFactory);
  resource.resize();
  globalThis.window?.addEventListener("resize", resource.resize);
  const observer = typeof ResizeObserver !== "undefined" && container && !usesViewport ? new ResizeObserver(resource.resize) : null;
  observer?.observe(container);
  return resource;
}
