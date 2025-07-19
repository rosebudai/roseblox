import * as THREE from "three";

/**
 * @typedef {Object} CameraDirection
 * @property {THREE.Vector3} forward - Camera forward direction vector
 * @property {THREE.Vector3} right - Camera right direction vector
 */

/**
 * Creates a component that stores the camera's current orientation in world space.
 * This is used by the player movement system to make controls camera-relative.
 * The `cameraInputSystem` updates this component every frame.
 *
 * @param {THREE.Vector3} [forward=new THREE.Vector3(0, 0, -1)] - The camera's forward-facing vector (normalized).
 * @param {THREE.Vector3} [right=new THREE.Vector3(1, 0, 0)] - The camera's right-facing vector (normalized).
 * @returns {CameraDirection} A new camera direction component.
 * @example
 * // This component is typically added to the player entity.
 * const camDirection = createCameraDirection();
 * world.add(playerEntity, { cameraDirection: camDirection });
 */
export function createCameraDirection(
  forward = new THREE.Vector3(0, 0, -1),
  right = new THREE.Vector3(1, 0, 0)
) {
  return {
    forward: forward.clone(),
    right: right.clone(),
  };
}
