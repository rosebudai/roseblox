import * as THREE from "three";

/**
 * @typedef {Object} Transform
 * @property {THREE.Vector3} position - World position vector
 * @property {THREE.Quaternion} rotation - Rotation quaternion
 * @property {THREE.Quaternion} quaternion - Three.js-compatible alias of rotation
 * @property {THREE.Vector3} scale - Scale vector
 */

/**
 * Creates a transform component, which holds the position, rotation, and scale of an entity in 3D space.
 * This is a fundamental component for any entity that exists visually in the world.
 * Physics owns physical entity poses; caller code owns nonphysical entity poses.
 *
 * @param {THREE.Vector3} [position=new THREE.Vector3(0, 0, 0)] - The initial position of the entity.
 * @param {THREE.Quaternion} [rotation=new THREE.Quaternion(0, 0, 0, 1)] - The initial rotation of the entity.
 * @param {THREE.Vector3} [scale=new THREE.Vector3(1, 1, 1)] - The initial scale of the entity.
 * @returns {Transform} A new transform component object.
 * @example
 * const position = new THREE.Vector3(10, 0, 5);
 * const transform = createTransform(position);
 * world.add(entity, { transform });
 */
export function createTransform(
  position = new THREE.Vector3(0, 0, 0),
  rotation = new THREE.Quaternion(0, 0, 0, 1),
  scale = new THREE.Vector3(1, 1, 1)
) {
  return {
    position: position.clone(),
    rotation: rotation.clone(),
    // Match Three.js naming without a second orientation that sync could ignore.
    get quaternion() { return this.rotation; },
    set quaternion(value) { this.rotation.copy(value); },
    scale: scale.clone(),
  };
}
