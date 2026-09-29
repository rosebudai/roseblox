/** Shared capsule motion; input and scene ownership stay with the caller. */
export function moveCharacter({ physics, body, collider, controller, state, velocity, jumpDown = false, jumpSpeed = 0, carry, support }, dt) {
  if (state.grounded && jumpDown && !state.jumpHeld) state.verticalVelocity = jumpSpeed;
  else if (state.grounded && state.verticalVelocity <= 0) state.verticalVelocity = -0.5;
  else state.verticalVelocity += physics.world.gravity.y * dt;
  state.jumpHeld = jumpDown;
  // `carry` is the step of the descending `support` collider under the rider. Pressing into a
  // moving floor stalls Rapier's slide, so a rider moves with the support in one sweep that skips it.
  const ride = carry && support && state.verticalVelocity <= 0 && velocity.y <= 0 ? carry : null;
  controller.computeColliderMovement(collider, {
    x: velocity.x * dt + (ride?.x ?? 0),
    y: ride ? ride.y : (state.verticalVelocity + velocity.y) * dt,
    z: velocity.z * dt + (ride?.z ?? 0),
  }, physics.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, ride ? c => c !== support && c.handle !== support.handle : undefined);
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
  state.grounded = !!ride || controller.computedGrounded();
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
