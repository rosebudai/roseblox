/** Shared capsule motion; input and scene ownership stay with the caller. */
/**
 * Moves a capsule character for one step and reports whether it rode `floors`.
 * `floors` are kinematic floor colliders under the character and `carry` their motion at its feet this step.
 * Rapier's controller replaces any motion into a kinematic floor with the floor's own velocity, which stalls
 * walking on it, so a rider sweeps its walk plus `carry` past those floors; the caller then settles it on one.
 */
export function moveCharacter({ physics, body, collider, controller, state, velocity, jumpDown = false, jumpSpeed = 0, floors, carry }, dt) {
  if (state.grounded && jumpDown && !state.jumpHeld) state.verticalVelocity = jumpSpeed;
  else if (state.grounded && state.verticalVelocity <= 0) state.verticalVelocity = -0.5;
  else state.verticalVelocity += physics.world.gravity.y * dt;
  state.jumpHeld = jumpDown;
  const riding = !!floors?.length && state.verticalVelocity + velocity.y <= 0;
  controller.computeColliderMovement(collider, riding
    ? { x: velocity.x * dt + carry.x, y: carry.y, z: velocity.z * dt + carry.z }
    : { x: velocity.x * dt, y: (state.verticalVelocity + velocity.y) * dt, z: velocity.z * dt },
  physics.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, riding ? c => !floors.some(f => f === c || f.handle === c.handle) : undefined);
  const delta = controller.computedMovement();
  if (state.verticalVelocity > 0) {
    for (let i = 0; i < controller.numComputedCollisions(); i++) {
      // A wall permits upward sliding; only an underside stops the jump.
      if (controller.computedCollision(i)?.normal1.y < -0.01) {
        state.verticalVelocity = 0;
        break;
      }
    }
  }
  const position = body.translation();
  body.setNextKinematicTranslation({ x: position.x + delta.x, y: position.y + delta.y, z: position.z + delta.z });
  state.grounded = riding || controller.computedGrounded();
  return riding;
}

export function createCapsuleController(physics) {
  const controller = physics.world.createCharacterController(0.02);
  controller.enableAutostep(0.3, 0.2, false);
  // Preserve the floor-contact fix: snap-to-ground embedded capsules in flat floors.
  controller.disableSnapToGround();
  controller.setApplyImpulsesToDynamicBodies(true);
  return controller;
}

export function capsuleSpawnClearance(physics, fixedTimeStep) {
  return 0.02 + Math.max(0, -physics.world.gravity.y) * fixedTimeStep ** 2 + 0.01;
}
