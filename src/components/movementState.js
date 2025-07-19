import * as THREE from "three";

/**
 * @typedef {Object} MovementState
 * @property {THREE.Vector3} velocity - Current velocity vector
 * @property {THREE.Vector3} direction - Intended movement direction (for physics rotation)
 * @property {boolean} grounded - Whether entity is on ground
 * @property {number} verticalVelocity - Vertical velocity component
 * @property {number} speed - The character's raw horizontal speed.
 */

/**
 * Creates a component that tracks the dynamic movement state of an entity.
 * This component is typically used by movement systems to apply forces and by animation systems
 * to determine which animation to play (e.g., idle, run, jump).
 *
 * @param {THREE.Vector3} [velocity=new THREE.Vector3(0,0,0)] - The current velocity of the entity in 3D space.
 * @param {THREE.Vector3} [direction=new THREE.Vector3(0,0,0)] - The intended direction of movement, often derived from input.
 * @param {boolean} [grounded=false] - Whether the entity is currently on the ground. This is typically updated by the physics engine.
 * @param {number} [verticalVelocity=0] - The entity's velocity along the Y-axis.
 * @param {number} [speed=0] - The magnitude of the entity's horizontal velocity.
 * @returns {MovementState} A new movement state component.
 * @example
 * const movement = createMovementState();
 * world.add(entity, { movementState: movement });
 */
export function createMovementState(
  velocity = new THREE.Vector3(0, 0, 0),
  direction = new THREE.Vector3(0, 0, 0),
  grounded = false,
  verticalVelocity = 0,
  speed = 0
) {
  return {
    velocity: velocity.clone(),
    direction: direction.clone(),
    grounded,
    verticalVelocity,
    speed,
  };
}
