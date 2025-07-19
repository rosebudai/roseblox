/**
 * TERRAIN SYSTEM SETUP
 *
 * This file orchestrates the creation of the terrain, turning the raw data
 * from the generator into renderable visuals and physical colliders.
 */

import * as THREE from "three";
import { GAME_CONFIG } from "./config.js";
import { TerrainData, TerrainUtils } from "./terrainData.js";
import { TerrainDataGenerator } from "./terrainDataGenerator.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

// Block types and colors from config
const BLOCK_TYPES = GAME_CONFIG.TERRAIN.BLOCK_TYPES;
const BLOCK_COLORS = GAME_CONFIG.TERRAIN.BLOCK_COLORS;
const BLOCK_SIZE = GAME_CONFIG.TERRAIN.BLOCK_SIZE;

// --- Terrain Factories ---

/**
 * Creates a single, efficient trimesh collider for the entire terrain.
 * @param {Object} entity - The entity to create the body for.
 * @param {Object} context - Engine context.
 * @param {RAPIER.World} context.physicsWorld - The Rapier world.
 * @param {RAPIER} context.RAPIER - The Rapier library instance.
 * @returns {Object} A physicsBody component structure.
 */
function gameTerrainColliderFactory(entity, { physicsWorld, RAPIER }) {
  const { collisionGeometry } = entity.isTerrain;
  if (!collisionGeometry) return null;

  const vertices = collisionGeometry.attributes.position.array;
  const indices = collisionGeometry.index.array;

  const bodyDesc = RAPIER.RigidBodyDesc.fixed();
  const rigidBody = physicsWorld.createRigidBody(bodyDesc);
  const colliderDesc = RAPIER.ColliderDesc.trimesh(vertices, indices);
  const collider = physicsWorld.createCollider(colliderDesc, rigidBody);

  return { rigidBody, collider };
}

/**
 * Creates and manages the instanced visual meshes for the terrain.
 * @param {Object} entity - The entity to create the mesh for.
 * @returns {THREE.Group} A group containing all the instanced meshes.
 */
function gameInstancedMeshFactory(entity) {
  const { terrainData } = entity.renderable;
  const geometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
  const container = new THREE.Group();
  container.name = "terrain-visuals";

  const meshes = {};
  Object.values(BLOCK_TYPES).forEach((blockType) => {
    if (blockType === BLOCK_TYPES.AIR) return;

    // Special material properties for water blocks
    const isWater = blockType === BLOCK_TYPES.WATER;
    const material = new THREE.MeshStandardMaterial({
      color: BLOCK_COLORS[blockType],
      roughness: isWater ? 0.1 : GAME_CONFIG.TERRAIN.ROUGHNESS,
      metalness: isWater ? 0.0 : GAME_CONFIG.TERRAIN.METALNESS,
      transparent: isWater,
      opacity: isWater ? 0.8 : 1.0,
    });
    const maxInstances =
      terrainData.getDimensions().width *
      terrainData.getDimensions().height *
      terrainData.getDimensions().depth;
    const instancedMesh = new THREE.InstancedMesh(
      geometry,
      material,
      maxInstances
    );
    instancedMesh.count = 0;
    instancedMesh.receiveShadow = true;
    instancedMesh.castShadow = !isWater; // Water doesn't cast shadows
    meshes[blockType] = instancedMesh;
    container.add(instancedMesh);
  });

  const matrix = new THREE.Matrix4();
  const blocksByType = terrainData.getBlocksByType();

  Object.entries(blocksByType).forEach(([blockType, blocks]) => {
    const mesh = meshes[blockType];
    if (!mesh) return;
    blocks.forEach((block, index) => {
      const worldPos = TerrainUtils.gridToWorld(
        block.x,
        block.y,
        block.z,
        terrainData
      );
      matrix.setPosition(worldPos.x, worldPos.y, worldPos.z);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.count = blocks.length;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return container;
}

/**
 * Creates the merged geometry for the terrain collider.
 * This is separated so the geometry can be shared between the physics factory
 * and the camera collision setup.
 * @param {TerrainData} terrainData
 * @returns {THREE.BufferGeometry | null}
 */
function createCollisionGeometry(terrainData) {
  const solidBlocks = terrainData.getSolidBlocks();
  if (solidBlocks.length === 0) return null;

  const geometries = [];
  const tempGeometry = new THREE.BoxGeometry(
    BLOCK_SIZE,
    BLOCK_SIZE,
    BLOCK_SIZE
  );

  solidBlocks.forEach((block) => {
    const worldPos = TerrainUtils.gridToWorld(
      block.x,
      block.y,
      block.z,
      terrainData
    );
    const blockGeometry = tempGeometry.clone();
    blockGeometry.translate(worldPos.x, worldPos.y, worldPos.z);
    geometries.push(blockGeometry);
  });

  return BufferGeometryUtils.mergeGeometries(geometries);
}

/**
 * Standardized terrain setup function. This now returns a resource object.
 * @param {World} world - ECS world instance
 * @param {Object} dependencies - Required dependencies
 * @returns {Object} The terrain resource to be registered with the engine.
 */
export function setupGameTerrain(world, { physics, renderer }) {
  // 1. Register the custom factories
  physics.registerBodyFactory("isTerrain", gameTerrainColliderFactory);
  renderer.registerMeshFactory("instancedTerrain", gameInstancedMeshFactory);

  // 2. Generate the core terrain data
  const terrainData = new TerrainData();
  TerrainDataGenerator.generate(terrainData, {});

  // 3. Create the collision geometry
  const collisionGeometry = createCollisionGeometry(terrainData);

  // 4. Create a single terrain entity
  world.add({
    isTerrain: { terrainData, collisionGeometry }, // Pass geometry to the factory
    renderable: {
      type: "instancedTerrain",
      needsMesh: true,
      terrainData: terrainData,
    },
  });

  // 5. Return the terrain resource object for other systems to use
  return {
    terrainData,
    getTerrainHeightAt: (worldX, worldZ) =>
      TerrainUtils.getTerrainHeightAt(terrainData, worldX, worldZ),
  };
}
