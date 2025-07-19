/**
 * Camera Input System
 *
 * ECS system that updates camera direction vectors for input-controlled entities.
 * This system calculates forward/right vectors based on camera orientation.
 * Uses dependency injection for camera reference (like physics systems do).
 */

import * as THREE from "three";

/**
 * Camera input system - updates camera direction vectors for input-controlled entities
 * @param {World} world - ECS world instance
 * @param {THREE.Camera} camera - Camera instance
 */
export function cameraInputSystem(world, camera) {
  if (!camera) {
    throw new Error(
      "cameraInputSystem: Camera not provided via dependency injection"
    );
  }

  const query = world.with("isInputControlled", "cameraDirection");
  for (const entity of query) {
    // Calculate camera direction vectors using injected camera
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0; // Remove vertical component for ground-based movement
    forward.normalize();

    const right = new THREE.Vector3();
    // In THREE.js: right = forward × up (cross product)
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0));

    // Update cameraDirection component directly
    entity.cameraDirection.forward.copy(forward);
    entity.cameraDirection.right.copy(right);
  }
}
