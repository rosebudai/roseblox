/**
 * Camera Setup
 *
 * Handles initialization of camera controls and camera-related resources.
 * Integrates camera-controls library directly, following the same pattern
 * as rendererSetup (Three.js) and physicsSetup (Rapier).
 */

import * as THREE from "three";
import CameraControls from "camera-controls";

// Install camera controls (like how physicsSetup calls RAPIER.init())
CameraControls.install({ THREE });

/**
 * Setup the camera system
 * @param {World} world - ECS world instance
 * @param {Object} dependencies - Required dependencies
 * @param {Object} dependencies.renderer - Renderer resources
 * @returns {Object} Camera resources for other systems
 */
export async function setupCamera(world, { renderer }, config = {}) {
  const cameraConfig = config.CAMERA || {};

  // Create camera controls (direct integration like renderer/physics)
  const camera = new THREE.PerspectiveCamera(
    cameraConfig.FOV || 75,
    window.innerWidth / window.innerHeight,
    cameraConfig.NEAR || 0.1,
    cameraConfig.FAR || 2000
  );

  const controls = new CameraControls(camera, renderer.renderer.domElement);

  // Configure controls with game settings
  controls.minDistance = cameraConfig.MIN_DISTANCE ?? 1;
  controls.maxDistance = cameraConfig.MAX_DISTANCE ?? 15;
  controls.smoothTime = cameraConfig.SMOOTH_TIME ?? 0;

  // Configure mouse sensitivity
  const mouseSensitivity = cameraConfig.MOUSE_SENSITIVITY || {};
  const lookSensitivity = mouseSensitivity.LOOK ?? 1.0;
  const zoomSensitivity = mouseSensitivity.ZOOM ?? 1.0;

  controls.azimuthRotateSpeed = lookSensitivity;
  controls.polarRotateSpeed = lookSensitivity;
  controls.dollySpeed = zoomSensitivity;

  // Set initial position by iterating through the world to find the follow target.
  for (const entity of world) {
    if (entity.isCameraFollowTarget && entity.transform) {
      const pos = entity.transform.position;
      const initialOffset = cameraConfig.INITIAL_OFFSET || { x: 0, y: 5, z: 8 };
      const lookOffset = cameraConfig.LOOK_OFFSET || { x: 0, y: 1, z: 0 };

      controls.setLookAt(
        pos.x + initialOffset.x,
        pos.y + initialOffset.y,
        pos.z + initialOffset.z,
        pos.x + lookOffset.x,
        pos.y + lookOffset.y,
        pos.z + lookOffset.z,
        false
      );
      break;
    }
  }

  // Return camera resources
  const cameraResources = {
    camera,
    controls,
  };

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  return cameraResources;
}
