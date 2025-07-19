/**
 * PHYSICS MOVEMENT SYSTEM
 *
 * This system is the bridge between desired movement and the physics engine.
 * It reads the `movementState.velocity` and applies it to the Rapier
 * character controller, which calculates collisions.
 *
 * The corrected, collision-aware movement is then applied to the rigid body,
 * making physics the final authority on position.
 */

import * as THREE from "three";

/**
 * Component movement system - handles character controller movement
 * @param {World} world - ECS world instance
 * @param {Object} physicsWorld - Rapier physics world
 */
export function componentMovementSystem(world, physicsWorld) {
  if (!physicsWorld) {
    throw new Error("componentMovementSystem: Physics world is required");
  }

  const query = world
    .with("physicsBody", "movementState")
    .where((e) => e.physicsBody.controller);

  for (const entity of query) {
    const body = entity.physicsBody.rigidBody;
    const ctrl = entity.physicsBody.controller;
    const velocity = entity.movementState.velocity;
    const direction = entity.movementState.direction;

    // Handle rotation if there's a movement direction
    if (direction.lengthSq() > 0) {
      // Calculate rotation angle from movement direction
      const angle = Math.atan2(direction.x, direction.z);

      // Create quaternion for Y-axis rotation
      const quat = new THREE.Quaternion();
      quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);

      // Apply rotation to physics body (making physics authoritative)
      body.setRotation({
        x: quat.x,
        y: quat.y,
        z: quat.z,
        w: quat.w,
      });
    }

    // Handle movement if there's actual velocity
    if (velocity.lengthSq() === 0) {
      continue;
    }

    // Use character controller to compute movement with collision
    const collider = body.collider(0);
    const moveVec = {
      x: velocity.x,
      y: velocity.y,
      z: velocity.z,
    };

    ctrl.computeColliderMovement(collider, moveVec);

    // Get the corrected movement (after collision resolution)
    const corrected = ctrl.computedMovement();

    // Apply the movement to the rigid body
    const currentPos = body.translation();
    body.setNextKinematicTranslation({
      x: currentPos.x + corrected.x,
      y: currentPos.y + corrected.y,
      z: currentPos.z + corrected.z,
    });
  }
}
