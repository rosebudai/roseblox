/**
 * Trigger Detection System
 *
 * Handles overlap detection between entities and trigger zones (sensors).
 * This system is separate from physics collision detection and focuses on
 * game logic triggers like collectibles, damage zones, checkpoints, etc.
 *
 * Uses direct spatial queries for reliable trigger detection without
 * depending on complex physics engine event integration.
 */

/**
 * Trigger detection system - detects overlaps between entities and triggers
 * @param {World} world - ECS world instance
 * @param {Object} eventBus - Event bus for emitting trigger events
 */
export function triggerDetectionSystem(world, eventBus) {
  // Get all entities that can trigger (usually players, projectiles, etc.)
  const triggerableEntities = world.with("transform", "triggerDetector");
  
  // Get all trigger zones (collectibles, damage zones, etc.)
  const triggerZones = world.with("transform", "triggerZone");
  
  for (const triggerable of triggerableEntities) {
    const triggerablePos = triggerable.transform.position;
    const triggerableRadius = triggerable.triggerDetector.radius || 1.0;
    
    for (const triggerZone of triggerZones) {
      const triggerPos = triggerZone.transform.position;
      const triggerRadius = triggerZone.triggerZone.radius || 1.0;
      
      // Calculate distance between centers
      const dx = triggerablePos.x - triggerPos.x;
      const dy = triggerablePos.y - triggerPos.y;
      const dz = triggerablePos.z - triggerPos.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      // Check if currently overlapping
      const combinedRadius = triggerableRadius + triggerRadius;
      const isInside = distance < combinedRadius;
      
      // Initialize tracking set if needed
      if (!triggerZone.triggerZone.currentlyInside) {
        triggerZone.triggerZone.currentlyInside = new Set();
      }
      
      // Check previous state
      const wasInside = triggerZone.triggerZone.currentlyInside.has(triggerable.id);
      
      if (isInside && !wasInside) {
        // Entity entered trigger zone
        triggerZone.triggerZone.currentlyInside.add(triggerable.id);
        
        eventBus.emit("trigger-entered", {
          triggerable,
          trigger: triggerZone,
          triggerType: triggerZone.triggerZone.type || "generic"
        });
        
      } else if (!isInside && wasInside) {
        // Entity exited trigger zone
        triggerZone.triggerZone.currentlyInside.delete(triggerable.id);
        
        eventBus.emit("trigger-exited", {
          triggerable,
          trigger: triggerZone,
          triggerType: triggerZone.triggerZone.type || "generic"
        });
      }
    }
  }
}