import * as THREE from "three";

/**
 * @typedef {Object} Transform
 * @property {THREE.Vector3} position - World position vector
 * @property {THREE.Quaternion} rotation - Rotation quaternion
 * @property {THREE.Vector3} scale - Scale vector
 */

/**
 * Creates a transform component, which holds the position, rotation, and scale of an entity in 3D space.
 * This is a fundamental component for any entity that exists visually in the world.
 * The physics simulation is the source of truth for this component's data; do not modify it directly.
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
    scale: scale.clone(),
  };
}
