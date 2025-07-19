/**
 * The collision processing system.
 * @param {World} world - The Miniplex ECS world.
 * @param {object} resources - A map of the engine's shared resources.
 * @param {object} resources.physics - The physics resource.
 * @param {object} resources.eventBus - The event bus resource.
 */
export function collisionSystem(world, { physics, eventBus }) {
  // Drain the event queue from the physics world.
  // The callback will be invoked for each contact event.
  physics.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
    // Get the colliders from their handles.
    const collider1 = physics.world.getCollider(handle1);
    const collider2 = physics.world.getCollider(handle2);

    // If we can't find the colliders or their user data, we can't proceed.
    if (
      !collider1 ||
      !collider2 ||
      !collider1.userData ||
      !collider2.userData
    ) {
      return;
    }

    // Retrieve the entities from the user data we stored earlier.
    const entityA = collider1.userData.entity;
    const entityB = collider2.userData.entity;

    // Make sure we have valid entities.
    if (!entityA || !entityB) {
      return;
    }

    // Determine the event name based on whether the contact started or ended.
    const eventName = started ? "collision-started" : "collision-ended";

    // Emit the high-level event on the bus with the two entities involved.
    eventBus.emit(eventName, { entityA, entityB });
  });
}
