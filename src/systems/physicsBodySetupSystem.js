/**
 * Physics Body Setup System
 *
 * A one-shot ECS system that runs during the setup phase of the engine.
 * It queries for entities that have a component registered in the physics
 * body factory registry, but do not yet have a PhysicsBody component.
 * For each matching entity, it executes the factory to create the
 * appropriate Rapier physics body and collider.
 */

/**
 * A setup system that creates Rapier physics bodies for entities that need them.
 * It's a one-shot system that runs during the engine's setup phase.
 * It queries for entities that have a component registered in the physics body factory registry but do not yet have a PhysicsBody component.
 * For each matching entity, it executes the factory to create the appropriate Rapier physics body and collider, allowing for game-specific definitions of physics bodies (e.g., for players, enemies, or dynamic objects).
 * @param {World} world - The ECS world.
 * @param {Object} context - The engine's resource context.
 * @param {Object} context.physics - The physics resource.
 */
export function physicsBodySetupSystem(world, { physics }) {
  const entitiesToProcess = [];
  for (const entity of world) {
    if (!entity.physicsBody) {
      entitiesToProcess.push(entity);
    }
  }

  for (const entity of entitiesToProcess) {
    // Iterate over all components on the entity to find one
    // that has a registered physics body factory.
    for (const componentName in entity) {
      const factory = physics.getBodyFactory(componentName);

      if (factory) {
        // Execute the factory. Pass the entity and the physics world for context.
        const body = factory(entity, {
          physicsWorld: physics.world,
          RAPIER: physics.RAPIER,
        });

        if (body) {
          // Add the 'physicsBody' component to the entity.
          // The factory is responsible for returning the correct structure.
          world.addComponent(entity, "physicsBody", body);

          // --- COLLISION DETECTION MODIFICATION ---
          // 1. Enable collision events on the collider for this body.
          //    We are interested in both start and end collision events.
          body.collider.setActiveEvents(
            physics.RAPIER.ActiveEvents.COLLISION_EVENTS
          );

          // 2. Store a reference to the ECS entity on the collider itself.
          //    This is the key link from the physics world back to our game world.
          body.collider.userData = { entity };
          // --- END MODIFICATION ---
        }

        // Assume one primary physics component per entity and break
        // after the first one is found and processed.
        break;
      }
    }
  }
}
