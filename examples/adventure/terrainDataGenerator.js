/**
 * TERRAIN DATA GENERATOR
 *
 * Pure procedural generation algorithms for terrain data.
 * No side effects, no rendering, no physics - just algorithms.
 * Operates on TerrainData instances using dependency injection.
 */

import { GAME_CONFIG } from "./config.js";
import { createNoise2D } from "simplex-noise";

// Block types from config
const BLOCK_TYPES = GAME_CONFIG.TERRAIN.BLOCK_TYPES;

/**
 * TerrainDataGenerator - Pure algorithmic terrain generation
 */
export class TerrainDataGenerator {
  /**
   * Generate terrain using simplex noise with multiple octaves
   * @param {TerrainData} terrainData - Target terrain data instance
   * @param {Object} config - Generation configuration
   */
  static generateTerrain(terrainData, config = {}) {
    // Use config values or defaults
    const {
      heightScale = GAME_CONFIG.TERRAIN.HEIGHT_SCALE,
      noiseScale = GAME_CONFIG.TERRAIN.NOISE_SCALE,
      octaves = GAME_CONFIG.TERRAIN.NOISE_OCTAVES,
      persistence = GAME_CONFIG.TERRAIN.NOISE_PERSISTENCE,
      lacunarity = GAME_CONFIG.TERRAIN.NOISE_LACUNARITY,
      seed = GAME_CONFIG.TERRAIN.NOISE_SEED,
      noiseAmplitude = GAME_CONFIG.TERRAIN.NOISE_AMPLITUDE,
    } = config;

    const { width, height, depth } = terrainData.getDimensions();

    // Create noise function with seed
    const noise2D = createNoise2D(() => seed);

    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        // Generate height using multi-octave simplex noise
        let noiseValue = 0;
        let amplitude = 1;
        let frequency = noiseScale;
        let maxValue = 0;

        // Add multiple octaves for detail
        for (let i = 0; i < octaves; i++) {
          const sampleX = (x - width / 2) * frequency;
          const sampleZ = (z - depth / 2) * frequency;

          noiseValue += noise2D(sampleX, sampleZ) * amplitude;
          maxValue += amplitude;

          amplitude *= persistence;
          frequency *= lacunarity;
        }

        // Normalize and scale noise value more conservatively
        noiseValue /= maxValue;

        // Create gentler terrain with base height and controlled variation
        const baseHeight = Math.floor(height * heightScale);
        const variation = Math.floor(
          noiseValue * height * noiseAmplitude * 0.5
        );
        const terrainHeight = Math.max(1, baseHeight + variation);

        // Fill blocks up to height with varied block types
        for (let y = 0; y < terrainHeight && y < height; y++) {
          const blockType = this.selectBlockType(
            x,
            y,
            z,
            terrainHeight,
            noise2D
          );
          terrainData.setBlock(x, y, z, blockType);
        }
      }
    }
  }

  /**
   * Select appropriate block type based on position and terrain characteristics
   * @param {number} x - Grid X coordinate
   * @param {number} y - Grid Y coordinate
   * @param {number} z - Grid Z coordinate
   * @param {number} terrainHeight - Height of terrain column at this position
   * @param {Function} noise2D - Noise function for additional variation
   * @returns {number} Block type ID
   */
  static selectBlockType(x, y, z, terrainHeight, noise2D) {
    // Get height ratio (0 = bottom, 1 = top)
    const heightRatio = y / terrainHeight;

    // Use larger-scale noise for material zones (creates coherent areas)
    const materialZoneNoise = noise2D(x * 0.02, z * 0.02);
    const detailNoise = noise2D(x * 0.08, z * 0.08) * 0.3;
    const combinedNoise = materialZoneNoise + detailNoise;

    // Surface layer - consistent based on material zones
    if (y === terrainHeight - 1) {
      // Create coherent material zones on the surface
      if (combinedNoise > 0.4) return BLOCK_TYPES.SAND; // Sand areas
      if (combinedNoise > 0.1) return BLOCK_TYPES.GRAVEL; // Gravel areas
      return BLOCK_TYPES.GRASS; // Default grass areas
    }

    // Subsurface layers - natural geological layering
    if (heightRatio > 0.7) {
      // Shallow subsurface - mostly dirt with some stone
      if (combinedNoise > 0.5) return BLOCK_TYPES.STONE;
      return BLOCK_TYPES.DIRT;
    }

    if (heightRatio > 0.4) {
      // Middle depth - transition to more stone
      if (combinedNoise > 0.2) return BLOCK_TYPES.STONE;
      if (combinedNoise > -0.1) return BLOCK_TYPES.GRAVEL;
      return BLOCK_TYPES.DIRT;
    }

    // Deep layers - predominantly stone
    if (combinedNoise > -0.3) return BLOCK_TYPES.STONE;
    return BLOCK_TYPES.DIRT;
  }

  /**
   * Clear terrain data
   * @param {TerrainData} terrainData
   */
  static clearTerrain(terrainData) {
    terrainData.clear();
  }

  /**
   * Fill low areas with water up to the water level
   * @param {TerrainData} terrainData - Target terrain data instance
   * @param {Object} config - Generation configuration
   */
  static generateWater(terrainData, config = {}) {
    const waterLevel = config.waterLevel || GAME_CONFIG.TERRAIN.WATER_LEVEL;
    const { width, height, depth } = terrainData.getDimensions();

    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        // Find the top solid block in this column
        let topSolidY = -1;
        for (let y = height - 1; y >= 0; y--) {
          if (terrainData.getBlock(x, y, z) !== BLOCK_TYPES.AIR) {
            topSolidY = y;
            break;
          }
        }

        // Only add water if the terrain surface is below the water level
        // This prevents water from appearing on elevated areas
        if (topSolidY >= 0 && topSolidY < waterLevel) {
          // Fill with water from top solid block + 1 up to water level
          for (let y = topSolidY + 1; y <= waterLevel && y < height; y++) {
            if (terrainData.getBlock(x, y, z) === BLOCK_TYPES.AIR) {
              terrainData.setBlock(x, y, z, BLOCK_TYPES.WATER);
            }
          }
        }
      }
    }
  }

  /**
   * Generate complete terrain with noise-based landscape and water features.
   * This is the primary generation method for the template.
   * @param {TerrainData} terrainData
   * @param {Object} config - Additional configuration for generation.
   */
  static generate(terrainData, config = {}) {
    // Clear existing terrain first
    this.clearTerrain(terrainData);

    // Generate the terrain shape with simplex noise
    this.generateTerrain(terrainData, config);

    // Add water to low areas
    this.generateWater(terrainData, config);
  }
}
