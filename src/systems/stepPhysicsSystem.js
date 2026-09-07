/**
 * Step Physics System
 *
 * ECS system that steps the physics simulation forward each frame.
 * This system advances the physics world by one time step.
 */

/**
 * Step physics system - advances the physics simulation
 * @param {Object} physicsWorld - Rapier physics world
 * @param {Object} eventQueue - Rapier event queue
 */
export function stepPhysics(physicsWorld, eventQueue, deltaTime = 1 / 60) {
  if (!physicsWorld) {
    throw new Error("stepPhysics: Physics world is required");
  }
  if (!eventQueue) {
    throw new Error("stepPhysics: Event queue is required");
  }
  physicsWorld.timestep = deltaTime;
  physicsWorld.step(eventQueue);
}
