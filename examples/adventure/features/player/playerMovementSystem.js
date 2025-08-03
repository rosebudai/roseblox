/**
 * PLAYER MOVEMENT SYSTEM
 * Calculates movement velocity from input and camera direction.
 */
import * as THREE from "three";
import { GAME_CONFIG } from "../../core/config.js";
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

    entity.movementState.speed = 0;
    const moveVector = new THREE.Vector3(0, 0, 0);

    if (movement.x !== 0 || movement.z !== 0) {
      const dir = new THREE.Vector3()
        .addScaledVector(camDir.forward, -movement.z)
        .addScaledVector(camDir.right, movement.x)
        .normalize();

      moveVector.x = dir.x * speed;
      moveVector.z = dir.z * speed;
      entity.movementState.direction.copy(dir);
      entity.movementState.speed = speed;
    } else {
      entity.movementState.direction.set(0, 0, 0);
    }

    const grounded = entity.movementState.grounded;
    
    if (grounded) {
      entity.movementState.verticalVelocity = actions.jump 
        ? entity.characterController.jumpStrength 
        : -2.0; // Small downward force to maintain ground contact
    } else {
      entity.movementState.verticalVelocity += GAME_CONFIG.PHYSICS.GRAVITY.y * deltaTime;
    }

    moveVector.y = entity.movementState.verticalVelocity;
    entity.movementState.velocity.copy(moveVector).multiplyScalar(deltaTime);
  }
}
