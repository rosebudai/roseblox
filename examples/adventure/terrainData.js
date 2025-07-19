/**
 * TERRAIN DATA MANAGEMENT
 *
 * Pure data layer for voxel terrain following industry-standard patterns.
 * Treats terrain as "world infrastructure" rather than individual entities.
 * No rendering, physics, or generation logic - pure data access.
 */

import { GAME_CONFIG } from "./config.js";

// Voxel terrain constants from config
const BLOCK_SIZE = GAME_CONFIG.TERRAIN.BLOCK_SIZE;
const TERRAIN_WIDTH = GAME_CONFIG.TERRAIN.WIDTH;
const TERRAIN_DEPTH = GAME_CONFIG.TERRAIN.DEPTH;
const TERRAIN_MAX_HEIGHT = GAME_CONFIG.TERRAIN.MAX_HEIGHT;

// Block types from config
const BLOCK_TYPES = GAME_CONFIG.TERRAIN.BLOCK_TYPES;

/**
 * TerrainData class for managing voxel world data
 * Pure data structure with no side effects
 */
export class TerrainData {
  constructor(
    width = TERRAIN_WIDTH,
    height = TERRAIN_MAX_HEIGHT,
    depth = TERRAIN_DEPTH
  ) {
    this.width = width;
    this.height = height;
    this.depth = depth;

    // Initialize empty terrain data
    this.data = new Uint8Array(width * height * depth).fill(BLOCK_TYPES.AIR);
  }

  /**
   * Convert 3D coordinates to 1D array index
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number}
   */
  _getIndex(x, y, z) {
    return y * this.width * this.depth + z * this.width + x;
  }

  /**
   * Set block type at coordinates
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {number} blockType
   */
  setBlock(x, y, z, blockType) {
    if (
      x < 0 ||
      x >= this.width ||
      y < 0 ||
      y >= this.height ||
      z < 0 ||
      z >= this.depth
    ) {
      throw new Error(
        `setBlock: coordinates (${x}, ${y}, ${z}) out of bounds. ` +
          `Valid range: 0-${this.width - 1}, 0-${this.height - 1}, 0-${
            this.depth - 1
          }`
      );
    }
    this.data[this._getIndex(x, y, z)] = blockType;
  }

  /**
   * Get block type at coordinates
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number} Block type or AIR if out of bounds
   */
  getBlock(x, y, z) {
    if (
      x < 0 ||
      x >= this.width ||
      y < 0 ||
      y >= this.height ||
      z < 0 ||
      z >= this.depth
    ) {
      return BLOCK_TYPES.AIR;
    }
    return this.data[this._getIndex(x, y, z)];
  }

  /**
   * Get all solid block positions for bulk operations
   * @returns {Array<{x, y, z, blockType}>} Array of solid block data
   */
  getSolidBlocks() {
    const blocks = [];

    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        for (let z = 0; z < this.depth; z++) {
          const blockType = this.getBlock(x, y, z);
          if (blockType !== BLOCK_TYPES.AIR) {
            blocks.push({ x, y, z, blockType });
          }
        }
      }
    }

    return blocks;
  }

  /**
   * Get blocks organized by type for efficient rendering
   * @returns {Object} Object with blockType as key, array of positions as value
   */
  getBlocksByType() {
    const blocksByType = {};

    // Initialize arrays for each block type
    Object.values(BLOCK_TYPES).forEach((blockType) => {
      if (blockType !== BLOCK_TYPES.AIR) {
        blocksByType[blockType] = [];
      }
    });

    // Collect blocks by type
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        for (let z = 0; z < this.depth; z++) {
          const blockType = this.getBlock(x, y, z);
          if (blockType !== BLOCK_TYPES.AIR) {
            blocksByType[blockType].push({ x, y, z });
          }
        }
      }
    }

    return blocksByType;
  }

  /**
   * Clear all terrain data
   */
  clear() {
    this.data.fill(BLOCK_TYPES.AIR);
  }

  /**
   * Get terrain dimensions
   */
  getDimensions() {
    return {
      width: this.width,
      height: this.height,
      depth: this.depth,
      blockSize: BLOCK_SIZE,
    };
  }
}

/**
 * Terrain utilities for world coordinate conversion
 */
export class TerrainUtils {
  /**
   * Get terrain height at world position (for player spawning)
   * @param {TerrainData} terrainData
   * @param {number} worldX
   * @param {number} worldZ
   * @returns {number} World height of highest solid block
   */
  static getTerrainHeightAt(terrainData, worldX, worldZ) {
    // Convert world coordinates to voxel coordinates
    const voxelX = Math.floor(worldX / BLOCK_SIZE + terrainData.width / 2);
    const voxelZ = Math.floor(worldZ / BLOCK_SIZE + terrainData.depth / 2);

    // Find highest non-air block
    for (let y = terrainData.height - 1; y >= 0; y--) {
      if (terrainData.getBlock(voxelX, y, voxelZ) !== BLOCK_TYPES.AIR) {
        return (y + 1) * BLOCK_SIZE; // Return top of block
      }
    }

    return 0; // No terrain found
  }

  /**
   * Convert grid coordinates to world coordinates
   * @param {number} gridX
   * @param {number} gridY
   * @param {number} gridZ
   * @param {TerrainData} terrainData
   * @returns {{x: number, y: number, z: number}}
   */
  static gridToWorld(gridX, gridY, gridZ, terrainData) {
    return {
      x: (gridX - terrainData.width / 2) * BLOCK_SIZE,
      y: gridY * BLOCK_SIZE,
      z: (gridZ - terrainData.depth / 2) * BLOCK_SIZE,
    };
  }

  /**
   * Convert world coordinates to grid coordinates
   * @param {number} worldX
   * @param {number} worldY
   * @param {number} worldZ
   * @param {TerrainData} terrainData
   * @returns {{x: number, y: number, z: number}}
   */
  static worldToGrid(worldX, worldY, worldZ, terrainData) {
    return {
      x: Math.floor(worldX / BLOCK_SIZE + terrainData.width / 2),
      y: Math.floor(worldY / BLOCK_SIZE),
      z: Math.floor(worldZ / BLOCK_SIZE + terrainData.depth / 2),
    };
  }
}
