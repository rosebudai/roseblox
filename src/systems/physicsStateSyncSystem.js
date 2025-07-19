/**
 * Physics State Sync System
 *
 * ECS system that syncs authoritative physics data to ECS components.
 * ⚠️ CRITICAL: PHYSICS IS THE SINGLE SOURCE OF TRUTH FOR TRANSFORM DATA
 * This system runs AFTER physics simulation to sync physics data to ECS.
 */

/**
 * Physics state sync system - syncs physics world data to ECS components
 * @param {World} world - ECS world instance
 * @param {Object} physicsWorld - Rapier physics world
 */
export function physicsStateSyncSystem(world, physicsWorld) {
  if (!physicsWorld) {
    throw new Error("physicsStateSyncSystem: Physics world is required");
  }

  const query = world.with("physicsBody", "transform");

  for (const entity of query) {
    const body = entity.physicsBody.rigidBody;

    // AUTHORITY: Physics World → ECS Transform (ONE-WAY SYNC)
    const pos = body.translation();
    entity.transform.position.set(pos.x, pos.y, pos.z);

    const rot = body.rotation();
    entity.transform.rotation.set(rot.x, rot.y, rot.z, rot.w);

    // If the entity also has a character controller, sync its state.
    if (entity.physicsBody.controller && entity.movementState) {
      entity.movementState.grounded =
        entity.physicsBody.controller.computedGrounded();
    }
  }
}
