/**
 * Skybox Setup
 *
 * Handles initialization of the skybox background and environment.
 */

import * as THREE from "three";

/**
 * Setup the skybox system
 * @param {World} _world - ECS world instance (unused)
 * @param {Object} dependencies - Other systems
 * @param {Object} config - The game's configuration object.
 * @returns {Object} Skybox resources
 */
export async function setupSkybox(_world, { renderer }, config = {}) {
  const skyboxConfig = config.SKYBOX || {};

  // If no skybox path is configured, return empty resource
  if (!skyboxConfig.path) {
    if (config.DEBUG) console.log("No skybox configured");
    return {};
  }

  // Load and apply skybox texture
  const loader = new THREE.TextureLoader();

  if (config.DEBUG) console.log("🖼️ Loading skybox image:", skyboxConfig.path);

  return new Promise((resolve) => {
    loader.load(
      skyboxConfig.path,
      (texture) => {
        if (config.DEBUG) console.log("✅ Skybox texture loaded successfully");

        // Configure texture for equirectangular projection
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;

        // Apply skybox to scene
        if (renderer && renderer.scene) {
          if (config.DEBUG) console.log("🎨 Applying skybox to scene");
          renderer.scene.background = texture;
          renderer.scene.environment = texture;
        }

        // Return skybox resource
        resolve({
          texture,
          loaded: true,
        });
      },
      undefined,
      (error) => {
        console.error("❌ Failed to load skybox image:", error);
        resolve({
          texture: null,
          loaded: false,
          error: error.message,
        });
      }
    );
  });
}
