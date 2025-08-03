/**
 * NATURAL TERRAIN GENERATOR
 * Simplified noise-based terrain generation.
 */

import { GAME_CONFIG } from "../../core/config.js";
import { createNoise2D } from "simplex-noise";

const TERRAIN_CONFIG = GAME_CONFIG.NATURAL_TERRAIN;

export class NaturalTerrainGenerator {
  // Constants
  static SLOPE_GRASS_THRESHOLD = Math.PI / 6;  // 30 degrees
  static SLOPE_ROCK_THRESHOLD = Math.PI / 4;   // 45 degrees
  static MOUNTAIN_ROCK_HEIGHT = 0.3;           // 30% of mountain height
  static MOUNTAIN_NOISE_SCALE = 0.05;
  static MOUNTAIN_CIRCLE_RADIUS = 0.45;
  static EDGE_FALLOFF_POWER = 1.5;
  static TRIANGLE_COS_30 = 0.866;
  static TRIANGLE_SIN_30 = 0.5;
  
  static generate(terrainData, config = {}) {
    const {
      noiseScale = TERRAIN_CONFIG.NOISE_SCALE,
      octaves = TERRAIN_CONFIG.NOISE_OCTAVES,
      heightVariation = TERRAIN_CONFIG.HEIGHT_VARIATION,
      seed = Date.now(),
    } = config;

    const { width, depth, scale } = terrainData.getDimensions();
    const noise2D = createNoise2D(() => seed);
    
    // Generate heights and materials in a single pass
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        // Multi-octave noise for height
        let noiseValue = 0;
        let amplitude = 1;
        let frequency = noiseScale;
        let maxValue = 0;

        for (let i = 0; i < octaves; i++) {
          const sampleX = (x - width / 2) * frequency * scale;
          const sampleZ = (z - depth / 2) * frequency * scale;
          noiseValue += noise2D(sampleX, sampleZ) * amplitude;
          maxValue += amplitude;
          amplitude *= 0.5;
          frequency *= 2;
        }

        // Normalize and scale
        noiseValue /= maxValue;
        const height = 0.5 + (noiseValue * heightVariation);
        
        // Edge falloff
        const dx = x - width / 2;
        const dz = z - depth / 2;
        const distanceFromCenter = Math.sqrt(dx * dx + dz * dz);
        const maxDistance = Math.sqrt(width * width + depth * depth) / 2;
        const edgeFalloff = 1 - Math.pow(distanceFromCenter / maxDistance, this.EDGE_FALLOFF_POWER);
        
        const finalHeight = Math.max(0, height * Math.max(0.1, edgeFalloff));
        terrainData.setHeight(x, z, finalHeight);
        
        // Simple material assignment: grass on low slopes, dirt on steep slopes
        const slope = terrainData.getSlope(x, z);
        const material = slope > this.SLOPE_GRASS_THRESHOLD ? 1 : 0;
        terrainData.setMaterial(x, z, material);
      }
    }
    
    // Add mountains before smoothing
    this.addMountains(terrainData);
    
    // Simple smoothing pass
    this.smoothTerrain(terrainData);
  }

  static addMountains(terrainData) {
    const { width, depth, scale } = terrainData.getDimensions();
    const { MOUNTAIN_COUNT, MOUNTAIN_HEIGHT, MOUNTAIN_RADIUS, MOUNTAIN_JAGGEDNESS } = TERRAIN_CONFIG;
    
    if (MOUNTAIN_COUNT === 0) return;
    
    // Create noise for jagged peaks
    const mountainNoise = createNoise2D(() => Date.now() + 1000);
    
    // Generate mountain positions
    const mountains = [];
    if (MOUNTAIN_COUNT === 1) {
      mountains.push({ x: width * 0.5, z: depth * 0.5 });
    } else if (MOUNTAIN_COUNT === 3) {
      // Group of 3 mountains on one side of the map
      const center = { x: width * 0.5, z: depth * 0.5 };
      const groupDistance = Math.min(width, depth) * this.MOUNTAIN_CIRCLE_RADIUS;
      const groupAngle = Math.PI * 0.25; // Place group in northeast direction
      
      // Center of the mountain group
      const groupCenterX = center.x + Math.cos(groupAngle) * groupDistance;
      const groupCenterZ = center.z + Math.sin(groupAngle) * groupDistance;
      
      // Place 3 mountains in a triangular formation
      const spacing = MOUNTAIN_RADIUS * 0.8;
      mountains.push(
        { x: groupCenterX, z: groupCenterZ - spacing },
        { x: groupCenterX - spacing * this.TRIANGLE_COS_30, z: groupCenterZ + spacing * this.TRIANGLE_SIN_30 },
        { x: groupCenterX + spacing * this.TRIANGLE_COS_30, z: groupCenterZ + spacing * this.TRIANGLE_SIN_30 }
      );
    } else {
      // Circle pattern for other counts
      const center = { x: width * 0.5, z: depth * 0.5 };
      const radius = Math.min(width, depth) * this.MOUNTAIN_CIRCLE_RADIUS;
      
      for (let i = 0; i < MOUNTAIN_COUNT; i++) {
        const angle = (i / MOUNTAIN_COUNT) * Math.PI * 2;
        const r = radius * (1 + (Math.random() - 0.5) * 0.1);
        const a = angle + (Math.random() - 0.5) * 0.3;
        mountains.push({
          x: center.x + Math.cos(a) * r,
          z: center.z + Math.sin(a) * r
        });
      }
    }
    
    // Apply each mountain
    for (const mountain of mountains) {
      for (let x = 0; x < width; x++) {
        for (let z = 0; z < depth; z++) {
          const dist = Math.sqrt(Math.pow(x - mountain.x, 2) + Math.pow(z - mountain.z, 2));
          
          if (dist < MOUNTAIN_RADIUS) {
            // Gaussian mountain shape with jagged noise
            const norm = dist / MOUNTAIN_RADIUS;
            const baseShape = (1 - norm) * Math.exp(-norm * norm * 2);
            const noise = mountainNoise(x * this.MOUNTAIN_NOISE_SCALE * scale, z * this.MOUNTAIN_NOISE_SCALE * scale);
            const height = MOUNTAIN_HEIGHT * baseShape * (1 + noise * MOUNTAIN_JAGGEDNESS * baseShape);
            
            // Update height and material
            terrainData.setHeight(x, z, terrainData.getHeight(x, z) + height);
            
            // Set material based on height and slope
            if (height > MOUNTAIN_HEIGHT * this.MOUNTAIN_ROCK_HEIGHT) {
              terrainData.setMaterial(x, z, 2); // Rock
            } else {
              const slope = terrainData.getSlope(x, z);
              terrainData.setMaterial(x, z, 
                slope > this.SLOPE_ROCK_THRESHOLD ? 2 : 
                slope > this.SLOPE_GRASS_THRESHOLD ? 1 : 0
              );
            }
          }
        }
      }
    }
  }

  static smoothTerrain(terrainData) {
    const { width, depth } = terrainData.getDimensions();
    const smoothedHeights = new Float32Array(width * depth);
    const kernel = 1; // 3x3 kernel
    
    // Smooth in one pass
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        let totalHeight = 0;
        let count = 0;
        
        // Sample neighbors
        const minX = Math.max(0, x - kernel);
        const maxX = Math.min(width - 1, x + kernel);
        const minZ = Math.max(0, z - kernel);
        const maxZ = Math.min(depth - 1, z + kernel);
        
        for (let sx = minX; sx <= maxX; sx++) {
          for (let sz = minZ; sz <= maxZ; sz++) {
            totalHeight += terrainData.getHeight(sx, sz);
            count++;
          }
        }
        
        smoothedHeights[z * width + x] = totalHeight / count;
      }
    }
    
    // Apply smoothed heights
    for (let i = 0; i < smoothedHeights.length; i++) {
      const x = i % width;
      const z = Math.floor(i / width);
      terrainData.setHeight(x, z, smoothedHeights[i]);
    }
  }
}