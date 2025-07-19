/**
 * PLAYER MOVEMENT CALCULATION SYSTEM
 *
 * This system reads player input components and calculates a final, desired
 * velocity for the frame. It considers camera direction, walking/running speed,
 * and jumping to produce a velocity vector.
 *
 * This system does NOT directly move the entity. It only populates the
 * `movementState.velocity` component. The actual movement is applied later
 * by the physics systems.
 */

import * as THREE from "three";
import { GAME_CONFIG } from "./config.js";


/**
 * Player movement system - processes input and updates movement state
 * @param {World} world
 * @param {number} deltaTime
 */
export function playerMovementSystem(world, deltaTime) {
  const query = world.with(
    "isInputControlled",
    "inputMovement",
    "inputActions",
    "cameraDirection",
    "movementState",
    "characterController",
    "transform"
  );

  for (const entity of query) {
    const movement = entity.inputMovement;
    const actions = entity.inputActions;
    const camDir = entity.cameraDirection;

    const speed = actions.run
      ? entity.characterController.runSpeed
      : entity.characterController.speed;

    // Store the raw speed in the movement state for other systems (like animation) to use.
    entity.movementState.speed = 0;

    const moveVector = new THREE.Vector3(0, 0, 0);

    if (movement.x !== 0 || movement.z !== 0) {
      const forward = camDir.forward;
      const right = camDir.right;

      const dir = new THREE.Vector3();
      dir.addScaledVector(forward, -movement.z);
      dir.addScaledVector(right, movement.x);
      dir.normalize();

      moveVector.x = dir.x * speed;
      moveVector.z = dir.z * speed;

      entity.movementState.direction.copy(dir);
      entity.movementState.speed = speed; // Update speed when moving
    } else {
      entity.movementState.direction.set(0, 0, 0);
    }

    const grounded = entity.movementState.grounded;

    if (grounded) {
      entity.movementState.verticalVelocity = 0;

      if (actions.jump) {
        entity.movementState.verticalVelocity =
          entity.characterController.jumpStrength;
      }
    } else {
      entity.movementState.verticalVelocity +=
        GAME_CONFIG.PHYSICS.GRAVITY.y * deltaTime;
    }

    moveVector.y = entity.movementState.verticalVelocity;
    entity.movementState.velocity.copy(moveVector).multiplyScalar(deltaTime);
  }
}
