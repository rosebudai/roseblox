/**
 * Renderer Setup
 *
 * Handles initialization of the THREE.js renderer and scene.
 * Creates the main "renderer" resource for the engine.
 */
import * as THREE from "three";
import { gltfMeshFactory, proceduralMeshFactory } from "./meshFactories.js";

/**
 * Setup the renderer system and create the renderer resource.
 * @param {Object} [config={}] - Optional configuration.
 * @returns {Object} The renderer resource for the engine.
 */
export async function setupRenderer(config = {}) {
  const scene = new THREE.Scene();
  const sceneConfig = config.SCENE || {};
  scene.background = new THREE.Color(sceneConfig.BACKGROUND_COLOR || 0x000000);

  const renderer = new THREE.WebGLRenderer({
    antialias: config.RENDERER?.ANTIALIAS ?? true,
    canvas: config.canvas,
  });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = config.shadows ?? true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(scene.background);

  const meshFactoryRegistry = new Map();

  // The renderer resource that will be available to all systems
  const rendererResource = {
    renderer,
    scene,
    meshFactoryRegistry,
    registerMeshFactory: (componentName, factory) => {
      meshFactoryRegistry.set(componentName, factory);
    },
    getMeshFactory: (componentName) => {
      return meshFactoryRegistry.get(componentName);
    },
  };

  // Register the engine's default mesh factories
  rendererResource.registerMeshFactory("procedural", proceduralMeshFactory);
  rendererResource.registerMeshFactory("gltf", gltfMeshFactory);

  // Handle window resize
  window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return rendererResource;
}
