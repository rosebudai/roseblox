/**
 * COLLECTIBLE SETUP
 *
 * This module defines the collectible entities, their components, and the factory
 * for creating their physics bodies.
 */
import * as THREE from "three";
import { CoreComponents } from "roseblox-game-engine";
import { GAME_CONFIG } from "./config.js";

const { createTransform, createRenderableMetadata, createTriggerZone } =
  CoreComponents;

// Note: Collectibles now use trigger zones instead of physics bodies
// for simpler and more reliable trigger detection

/**
 * Creates and places collectible entities in the world.
 * @param {World} world - ECS world instance.
 * @param {Object} dependencies - Required dependencies from the engine.
 */
export function setupCollectibles(world, { terrain }) {
  // Note: No physics factory needed - using trigger zones instead

  // Simple demo: Create 3 collectibles near player spawn
  const collectiblePositions = [
    { x: -20, z: -6 },
    { x: -24, z: -2 },
    { x: -28, z: -6 },
  ];

  collectiblePositions.forEach((pos, index) => {
    // Calculate terrain height at this position
    const terrainHeight = terrain
      ? terrain.getTerrainHeightAt(pos.x, pos.z)
      : 0;
    const spawnY = Math.max(
      terrainHeight + GAME_CONFIG.COLLECTIBLES.HEIGHT_OFFSET,
      1.0
    );

    world.add({
      // --- TAG ---
      isCollectible: true,

      // --- DATA ---
      transform: createTransform(new THREE.Vector3(pos.x, spawnY, pos.z)),
      triggerZone: createTriggerZone("collectible", 1.0), // 1 unit trigger radius
      renderable: createRenderableMetadata(
        "procedural",
        {
          type: "sphere",
          radius: 0.5,
          segments: 16,
        },
        {
          type: "standard",
          color: 0xffff00, // Yellow
          emissive: 0xffff00,
          emissiveIntensity: 0.3,
        }
      ),
    });
  });

  console.log("✅ Created 3 demo collectibles");
}
