/**
 * Character Controller Collision System
 *
 * Handles collision event processing for character controllers (like the player).
 * This system processes collision events that occur during character controller
 * movement computation and emits them to the event bus in the same format as
 * regular physics collision events.
 *
 * This system runs after the componentMovementSystem has computed movement
 * and collision data, maintaining separation of responsibilities:
 * - componentMovementSystem: handles movement and physics integration
 * - characterControllerCollisionSystem: handles collision event processing
 */

/**
 * Character controller collision system - processes collision events from character controllers
 * @param {World} world - The Miniplex ECS world
 * @param {Object} resources - The engine's shared resources
 * @param {Object} resources.physics - The physics resource
 * @param {Object} resources.eventBus - The event bus resource
 */
export function characterControllerCollisionSystem(
  world,
  { physics, eventBus }
) {
  // Query entities that have character controllers
  const query = world
    .with("physicsBody", "movementState")
    .where((e) => e.physicsBody.controller);

  for (const entity of query) {
    const ctrl = entity.physicsBody.controller;

    // Initialize collision tracking on the entity if it doesn't exist
    if (!entity.characterControllerCollisions) {
      entity.characterControllerCollisions = {
        currentCollisions: new Map(), // Track which entities we're currently colliding with (entity ID -> entity reference)
        lastFrameCollisions: new Map(), // Track previous frame's collisions (entity ID -> entity reference)
      };
    }

    const collisionTracker = entity.characterControllerCollisions;

    // Move current collisions to last frame and reset current
    collisionTracker.lastFrameCollisions = new Map(
      collisionTracker.currentCollisions
    );
    collisionTracker.currentCollisions.clear();

    // Process collision events from the character controller's previous movement computation
    const numCollisions = ctrl.numComputedCollisions();

    if (numCollisions > 0) {
      for (let i = 0; i < numCollisions; i++) {
        const collision = ctrl.computedCollision(i);

        // The collision object already contains the collider directly
        const otherCollider = collision.collider;

        // Check if the other collider has entity data (set by physicsBodySetupSystem)
        if (
          otherCollider &&
          otherCollider.userData &&
          otherCollider.userData.entity
        ) {
          const otherEntity = otherCollider.userData.entity;
          const otherEntityId =
            otherEntity.id || otherEntity.testId || "unknown";

          // Track this collision (store both ID and entity reference)
          collisionTracker.currentCollisions.set(otherEntityId, otherEntity);

          // Only emit collision-started if this is a NEW collision
          if (!collisionTracker.lastFrameCollisions.has(otherEntityId)) {
            eventBus.emit("collision-started", {
              entityA: entity, // The character controller entity (usually player)
              entityB: otherEntity, // The entity we collided with
              controllerCollision: true, // Flag to indicate this came from character controller
            });
          }
        }
      }
    }

    // Check for collision-ended events (entities that were colliding last frame but not this frame)
    for (const [
      otherEntityId,
      otherEntity,
    ] of collisionTracker.lastFrameCollisions) {
      if (!collisionTracker.currentCollisions.has(otherEntityId)) {
        // Use the cached entity reference instead of searching through all entities
        eventBus.emit("collision-ended", {
          entityA: entity,
          entityB: otherEntity, // Use the cached entity reference
          controllerCollision: true,
        });
      }
    }
  }
}
