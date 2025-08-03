/**
 * NATURAL TERRAIN DATA MANAGEMENT
 * Simplified heightmap-based terrain data structure.
 */

import { GAME_CONFIG } from "../../core/config.js";

const TERRAIN_CONFIG = GAME_CONFIG.NATURAL_TERRAIN;

export class NaturalTerrainData {
  constructor(
    width = TERRAIN_CONFIG.WIDTH,
    depth = TERRAIN_CONFIG.DEPTH,
    scale = TERRAIN_CONFIG.SCALE
  ) {
    this.width = width;
    this.depth = depth;
    this.scale = scale;
    this.heightScale = TERRAIN_CONFIG.HEIGHT_SCALE;

    // Height data only
    this.heights = new Float32Array(width * depth).fill(0);

    // Simple material data: 0 = grass, 1 = dirt, 2 = rock (single value per vertex)
    this.materials = new Uint8Array(width * depth).fill(0);
  }

  _getIndex(x, z) {
    return z * this.width + x;
  }

  _isInBounds(x, z) {
    return x >= 0 && x < this.width && z >= 0 && z < this.depth;
  }

  setHeight(x, z, height) {
    if (this._isInBounds(x, z)) {
      this.heights[this._getIndex(x, z)] = height;
    }
  }

  getHeight(x, z) {
    return this._isInBounds(x, z) ? this.heights[this._getIndex(x, z)] : 0;
  }

  setMaterial(x, z, material) {
    if (this._isInBounds(x, z)) {
      this.materials[this._getIndex(x, z)] = material;
    }
  }

  getMaterial(x, z) {
    return this._isInBounds(x, z) ? this.materials[this._getIndex(x, z)] : 0;
  }

  getHeightAtWorld(worldX, worldZ) {
    // Convert world to grid coordinates
    const gridX = worldX / this.scale + this.width / 2;
    const gridZ = worldZ / this.scale + this.depth / 2;

    // Get integer and fractional parts
    const x0 = Math.floor(gridX);
    const z0 = Math.floor(gridZ);
    const fx = gridX - x0;
    const fz = gridZ - z0;

    // Bilinear interpolation
    const h0 =
      this.getHeight(x0, z0) * (1 - fx) + this.getHeight(x0 + 1, z0) * fx;
    const h1 =
      this.getHeight(x0, z0 + 1) * (1 - fx) +
      this.getHeight(x0 + 1, z0 + 1) * fx;

    return (h0 * (1 - fz) + h1 * fz) * this.heightScale;
  }

  getSlope(x, z) {
    const centerHeight = this.getHeight(x, z);
    const rightHeight = this.getHeight(x + 1, z);
    const topHeight = this.getHeight(x, z + 1);

    const dx = (rightHeight - centerHeight) / this.scale;
    const dz = (topHeight - centerHeight) / this.scale;

    return Math.atan(Math.sqrt(dx * dx + dz * dz));
  }

  clear() {
    this.heights.fill(0);
    this.materials.fill(0);
  }

  getDimensions() {
    return {
      width: this.width,
      depth: this.depth,
      scale: this.scale,
      heightScale: this.heightScale,
      worldWidth: this.width * this.scale,
      worldDepth: this.depth * this.scale,
    };
  }
}
