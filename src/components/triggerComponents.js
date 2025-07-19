/**
 * Trigger Components
 *
 * Components for the trigger detection system that handles game logic
 * triggers separate from physics collisions.
 */

/**
 * Creates a trigger detector component for entities that can activate triggers
 * @param {number} radius - Detection radius around the entity
 * @returns {Object} triggerDetector component
 */
export function createTriggerDetector(radius = 1.0) {
  return {
    radius
  };
}

/**
 * Creates a trigger zone component for entities that act as triggers
 * @param {string} type - Type of trigger (collectible, damage, checkpoint, etc.)
 * @param {number} radius - Trigger activation radius
 * @returns {Object} triggerZone component
 */
export function createTriggerZone(type = "generic", radius = 1.0) {
  return {
    type,
    radius,
    currentlyInside: new Set() // Track entity IDs currently inside this trigger zone
  };
}