/**
 * NATURAL TERRAIN SYSTEM SETUP
 * Handles terrain mesh generation with texture blending.
 */

import * as THREE from "three";
import { NaturalTerrainData } from "./naturalTerrainData.js";
import { NaturalTerrainGenerator } from "./naturalTerrainGenerator.js";
import { GAME_CONFIG } from "../../core/config.js";

// Helper to create base terrain geometry with heights applied
function createTerrainGeometry(terrainData) {
  const { width, depth, scale, heightScale } = terrainData.getDimensions();

  const geometry = new THREE.PlaneGeometry(
    (width - 1) * scale,
    (depth - 1) * scale,
    width - 1,
    depth - 1
  );

  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position.array;

  // Apply heights
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];

    const gridX = Math.round(x / scale + (width - 1) / 2);
    const gridZ = Math.round(z / scale + (depth - 1) / 2);

    positions[i + 1] = terrainData.getHeight(gridX, gridZ) * heightScale;
  }

  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals();

  return geometry;
}

// Helper to load texture set
function loadTextureSet(loader, config) {
  const textures = {
    color: loader.load(config.COLOR),
    normal: loader.load(config.NORMAL),
    roughness: loader.load(config.ROUGHNESS),
  };

  Object.values(textures).forEach((texture) => {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(config.REPEAT, config.REPEAT);
  });

  return textures;
}

// Terrain collider factory
function naturalTerrainColliderFactory(entity, { physicsWorld, RAPIER }) {
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

// Terrain mesh factory
function naturalTerrainMeshFactory(entity) {
  const { terrainData } = entity.renderable;
  return createTerrainMesh(terrainData);
}

// Create terrain mesh with textures
function createTerrainMesh(terrainData) {
  const geometry = createTerrainGeometry(terrainData);

  // Load textures
  const textureLoader = new THREE.TextureLoader();
  const texConfig = GAME_CONFIG.NATURAL_TERRAIN.TEXTURES;
  const groundTextures = loadTextureSet(textureLoader, texConfig.GROUND);
  const rockTextures = loadTextureSet(textureLoader, texConfig.ROCK);

  // Process vertices: colors and blend factors in one pass
  const positions = geometry.attributes.position.array;
  const normals = geometry.attributes.normal.array;
  const colors = new Float32Array(positions.length);
  const blendFactors = new Float32Array(positions.length / 3);

  // Base colors that will be blended based on texture and slope
  const grassColor = [0.1, 0.3, 0.1]; // Green for flat grass areas
  const brownColor = [0.3, 0.2, 0.1]; // Brown for sloped grass areas
  const rockColor = [0.4, 0.4, 0.45]; // Light gray for rock areas

  for (let i = 0, j = 0; i < positions.length; i += 3, j++) {
    const height = positions[i + 1];
    const slope = 1.0 - Math.abs(normals[i + 1]); // 0=flat, 1=vertical

    // Calculate blend factor based on height (same as texture blending)
    const heightBlendFactor = Math.max(0, Math.min(1, (height - 50.0) / 50.0));
    blendFactors[j] = heightBlendFactor;

    // Calculate slope factor for grass color variation (brown on slopes)
    const slopeFactor = Math.min(1, slope * 2); // 0-0.5 slope maps to 0-1

    // Determine final color based on height and slope
    let finalColor;
    if (heightBlendFactor < 0.5) {
      // In grass/transition zone - blend green to brown based on slope
      const grassToBrown = [
        grassColor[0] * (1 - slopeFactor) + brownColor[0] * slopeFactor,
        grassColor[1] * (1 - slopeFactor) + brownColor[1] * slopeFactor,
        grassColor[2] * (1 - slopeFactor) + brownColor[2] * slopeFactor
      ];
      // Then blend with rock based on height
      finalColor = [
        grassToBrown[0] * (1 - heightBlendFactor * 2) + rockColor[0] * (heightBlendFactor * 2),
        grassToBrown[1] * (1 - heightBlendFactor * 2) + rockColor[1] * (heightBlendFactor * 2),
        grassToBrown[2] * (1 - heightBlendFactor * 2) + rockColor[2] * (heightBlendFactor * 2)
      ];
    } else {
      // Mostly rock zone
      finalColor = rockColor;
    }

    colors[i] = finalColor[0];
    colors[i + 1] = finalColor[1];
    colors[i + 2] = finalColor[2];
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute(
    "blendFactor",
    new THREE.BufferAttribute(blendFactors, 1)
  );

  // Create material with texture blending
  const material = new THREE.MeshStandardMaterial({
    map: groundTextures.color,
    normalMap: groundTextures.normal,
    roughnessMap: groundTextures.roughness,
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0.0,
    onBeforeCompile: (shader) => {
      // Add rock texture uniforms
      Object.assign(shader.uniforms, {
        rockMap: { value: rockTextures.color },
        rockNormalMap: { value: rockTextures.normal },
        rockRoughnessMap: { value: rockTextures.roughness },
      });

      // Modify shaders for texture blending
      const shaderMods = [
        // Vertex shader modifications
        {
          shader: "vertexShader",
          replacements: [
            [
              "#include <common>",
              "#include <common>\nattribute float blendFactor;\nvarying float vBlendFactor;",
            ],
            [
              "#include <worldpos_vertex>",
              "#include <worldpos_vertex>\nvBlendFactor = blendFactor;",
            ],
          ],
        },
        // Fragment shader modifications
        {
          shader: "fragmentShader",
          replacements: [
            [
              "#include <common>",
              "#include <common>\nuniform sampler2D rockMap;\nuniform sampler2D rockNormalMap;\nuniform sampler2D rockRoughnessMap;\nvarying float vBlendFactor;",
            ],
            [
              "#include <map_fragment>",
              `#ifdef USE_MAP
  vec4 groundColor = texture2D(map, vMapUv);
  vec4 rockColor = texture2D(rockMap, vMapUv);
  vec4 sampledDiffuseColor = mix(groundColor, rockColor, vBlendFactor);
  diffuseColor *= sampledDiffuseColor;
#endif`,
            ],
            [
              "#include <normal_fragment_maps>",
              `#ifdef USE_NORMALMAP
  vec3 groundNormal = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
  vec3 rockNormalColor = texture2D(rockNormalMap, vNormalMapUv).xyz * 2.0 - 1.0;
  vec3 blendedNormal = mix(groundNormal, rockNormalColor, vBlendFactor);
  blendedNormal.xy *= normalScale;
  normal = normalize(tbn * blendedNormal);
#endif`,
            ],
            [
              "vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );",
              `vec4 groundRoughness = texture2D(roughnessMap, vRoughnessMapUv);
vec4 rockRoughnessColor = texture2D(rockRoughnessMap, vRoughnessMapUv);
vec4 texelRoughness = mix(groundRoughness, rockRoughnessColor, vBlendFactor);`,
            ],
          ],
        },
      ];

      // Apply all shader modifications
      shaderMods.forEach(({ shader: shaderType, replacements }) => {
        replacements.forEach(([search, replace]) => {
          shader[shaderType] = shader[shaderType].replace(search, replace);
        });
      });
    },
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = "terrain-mesh";

  return mesh;
}

// Create collision geometry
function createCollisionGeometry(terrainData) {
  const geometry = createTerrainGeometry(terrainData);
  geometry.computeBoundingBox();
  return geometry;
}

// Main setup function
export function setupNaturalTerrain(world, { physics, renderer }) {
  // Register factories
  physics.registerBodyFactory("isTerrain", naturalTerrainColliderFactory);
  renderer.registerMeshFactory("naturalTerrain", naturalTerrainMeshFactory);

  // Generate terrain
  const terrainData = new NaturalTerrainData();
  NaturalTerrainGenerator.generate(terrainData, {});

  // Create collision geometry
  const collisionGeometry = createCollisionGeometry(terrainData);

  // Create terrain entity
  world.add({
    isTerrain: { terrainData, collisionGeometry },
    renderable: {
      type: "naturalTerrain",
      needsMesh: true,
      terrainData: terrainData,
    },
  });

  // Return terrain resource
  return {
    terrainData,
    getTerrainHeightAt: (worldX, worldZ) =>
      terrainData.getHeightAtWorld(worldX, worldZ),
  };
}
