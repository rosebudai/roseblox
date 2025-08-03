/**
 * SKYBOX SETUP
 * Loads skybox from equirectangular image
 */

import * as THREE from "three";
import { GAME_CONFIG } from "../../core/config.js";

/**
 * Creates skybox from configured image
 */
export function setupSkybox(world, { renderer }) {
  const skyboxConfig = GAME_CONFIG.SKYBOX || {};

  if (!skyboxConfig.path) {
    console.warn("No skybox configured in GAME_CONFIG.SKYBOX.path");
    return {};
  }

  if (!renderer || !renderer.scene) {
    console.error("Renderer resource or scene not available");
    return {};
  }

  setupImageSkybox(renderer, skyboxConfig.path);

  // Add fog for atmosphere
  if (renderer.scene && !renderer.scene.fog) {
    renderer.scene.fog = new THREE.Fog(0xb0c4de, 150, 600);
  }

  return {};
}

/**
 * Setup image as scene background
 */
function setupImageSkybox(rendererResource, imagePath) {
  const scene = rendererResource.scene;
  const renderer = rendererResource.renderer;

  if (!scene) {
    console.error("Scene not available for skybox setup");
    return;
  }

  const loader = new THREE.TextureLoader();

  loader.load(
    imagePath,
    (texture) => {
      // Configure texture for equirectangular projection
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;

      // Set as scene background and environment
      scene.background = texture;
      scene.environment = texture;

      // Reset tone mapping to normal
      if (renderer) {
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.toneMappingExposure = 1.0;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      }
    },
    undefined,
    (error) => {
      console.error("Failed to load skybox image:", error);
    }
  );
}
