/**
 * COLLECTIBLE SYSTEM
 *
 * This system handles the logic for collecting items. It listens for collision
 * events and, if a collision involves the player and a collectible, it
 * removes the collectible and updates the score.
 */
import {
  updateDebugCollisionStarted,
  updateDebugCollisionEnded,
} from "./debugCoordinateSystem.js";

/**
 * The main system function. It subscribes to the event bus and does not need
 * to be called every frame, so we will register it as a setup system that just
 * runs once.
 * @param {World} world - The ECS world.
 * @param {Object} dependencies - The engine resources.
 */
export function collectibleSystemSetup(world, { eventBus }) {
  // Listen for trigger events from the trigger detection system
  eventBus.on("trigger-entered", ({ triggerable, trigger, triggerType }) => {
    // Check if this is a collectible trigger
    if (
      triggerType === "collectible" &&
      trigger.isCollectible &&
      triggerable.isPlayer
    ) {
      // Remove the collectible from the world.
      // The engine's scene management system will automatically clean up
      // the mesh on the next frame
      world.remove(trigger);

      // Update player score
      if (triggerable.score) {
        triggerable.score.value += 1;
        console.log(`Score: ${triggerable.score.value}`);
      }
    }
  });

  // COLLISION SYSTEM TESTING - Listen for collision events from the collision system
  eventBus.on("collision-started", ({ entityA, entityB }) => {
    // Update debug info
    updateDebugCollisionStarted(entityA, entityB);

    // Visual feedback - flash the screen briefly
    if (document.body) {
      const originalBg = document.body.style.backgroundColor;
      document.body.style.backgroundColor = "rgba(255, 0, 0, 0.1)";
      setTimeout(() => {
        document.body.style.backgroundColor = originalBg;
      }, 100);
    }
  });

  eventBus.on("collision-ended", ({ entityA, entityB }) => {
    // Update debug info
    updateDebugCollisionEnded(entityA, entityB);

    // Visual feedback - flash the screen briefly with green
    if (document.body) {
      const originalBg = document.body.style.backgroundColor;
      document.body.style.backgroundColor = "rgba(0, 255, 0, 0.1)";
      setTimeout(() => {
        document.body.style.backgroundColor = originalBg;
      }, 100);
    }
  });
}
