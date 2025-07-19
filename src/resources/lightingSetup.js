/**
 * Lighting Setup
 *
 * Handles initialization of the THREE.js lights.
 */

import * as THREE from "three";

/**
 * Setup the lighting system
 * @param {World} world - ECS world instance
 * @param {Object} dependencies - Other systems
 * @param {Object} config - The game's configuration object.
 * @returns {Object} Lighting resources
 */
export async function setupLighting(world, { renderer }, config = {}) {
  const lightingConfig = config.LIGHTING || {};
  const shadowConfig = config.SHADOWS || {};

  const ambientLight = new THREE.AmbientLight(
    lightingConfig.AMBIENT_COLOR || 0xffffff,
    lightingConfig.AMBIENT_INTENSITY || 0.4
  );

  const directionalLight = new THREE.DirectionalLight(
    lightingConfig.DIRECTIONAL_COLOR || 0xffffff,
    lightingConfig.DIRECTIONAL_INTENSITY || 0.8
  );

  const dirPos = lightingConfig.DIRECTIONAL_POSITION || {
    x: 50,
    y: 100,
    z: 50,
  };
  directionalLight.position.set(dirPos.x, dirPos.y, dirPos.z);

  if (shadowConfig.ENABLED !== false) {
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = shadowConfig.MAP_SIZE || 2048;
    directionalLight.shadow.mapSize.height = shadowConfig.MAP_SIZE || 2048;
    directionalLight.shadow.camera.near = shadowConfig.CAMERA_NEAR || 0.5;
    directionalLight.shadow.camera.far = shadowConfig.CAMERA_FAR || 500;
    directionalLight.shadow.camera.left = -(shadowConfig.CAMERA_SIZE || 100);
    directionalLight.shadow.camera.right = shadowConfig.CAMERA_SIZE || 100;
    directionalLight.shadow.camera.top = shadowConfig.CAMERA_SIZE || 100;
    directionalLight.shadow.camera.bottom = -(shadowConfig.CAMERA_SIZE || 100);
  }

  renderer.scene.add(ambientLight);
  renderer.scene.add(directionalLight);

  return {
    ambientLight,
    directionalLight,
  };
}
