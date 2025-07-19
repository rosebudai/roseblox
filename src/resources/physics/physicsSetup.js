/**
 * Physics Setup
 *
 * Handles initialization of the RAPIER physics world and creates
 * the main "physics" resource for the engine.
 *
 * ⚠️  CRITICAL DATA FLOW - PHYSICS IS THE SINGLE SOURCE OF TRUTH:
 *
 * 1. Input Systems → ECS Components (user input)
 * 2. Movement Systems → Physics Bodies (apply forces/velocities)
 * 3. Physics Simulation Step (authoritative calculation)
 * 4. Physics Bodies → ECS Transform (sync authoritative results)
 * 5. ECS Transform → Visual Meshes (display results)
 *
 * NEVER write directly to ECS Transform - only read from physics!
 * Physics world owns position, rotation, and movement state.
 */

import RAPIER from "@dimforge/rapier3d-compat";

/**
 * Setup the physics system and create the physics resource.
 * @param {Object} [config={}] - Optional configuration for gravity.
 * @returns {Promise<Object>} The physics resource for the engine.
 */
export async function setupPhysics(config = {}) {
  // Initialize Rapier
  await RAPIER.init();

  // Create physics world with gravity
  const gravity = config.gravity || { x: 0.0, y: -9.81, z: 0.0 };
  const world = new RAPIER.World(gravity);

  // Create an event queue for handling collisions and other physics events
  const eventQueue = new RAPIER.EventQueue(true);

  const bodyFactoryRegistry = new Map();

  // The physics resource that will be available to all systems
  const physicsResource = {
    RAPIER, // Expose the RAPIER library for advanced use in game factories
    world,
    eventQueue, // Expose the event queue
    bodyFactoryRegistry,
    registerBodyFactory: (componentName, factory) => {
      bodyFactoryRegistry.set(componentName, factory);
    },
    getBodyFactory: (componentName) => {
      return bodyFactoryRegistry.get(componentName);
    },
    // We can add other physics-related utilities here in the future
  };

  // The engine does not register any default body factories.
  // Physics bodies are entirely game-specific and defined in the game template.

  return physicsResource;
}
