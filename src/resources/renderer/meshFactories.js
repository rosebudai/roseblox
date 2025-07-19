/**
 * Default Mesh Factory Functions
 *
 * This file contains the engine's built-in factory functions for creating
 * THREE.js objects from component data. These are registered with the
 * renderer resource during engine initialization.
 */
import * as THREE from "three";

/**
 * Creates a mesh from procedural geometry and material data.
 * This factory is registered for the `renderable` component by default.
 * @param {Object} entity - The entity to create the mesh for.
 * @param {Object} context - The context containing engine resources.
 * @returns {THREE.Mesh}
 */
export function proceduralMeshFactory(entity) {
  const { geometry: geomData, material: matData } = entity.renderable;

  let geometry;
  switch (geomData.type) {
    case "capsule":
      geometry = new THREE.CapsuleGeometry(
        geomData.radius,
        geomData.height,
        geomData.radialSegments,
        geomData.heightSegments
      );
      break;
    case "sphere":
      geometry = new THREE.SphereGeometry(
        geomData.radius,
        geomData.segments,
        geomData.segments
      );
      break;
    case "box":
      geometry = new THREE.BoxGeometry(
        geomData.width,
        geomData.height,
        geomData.depth
      );
      break;
    default:
      throw new Error(`Unknown geometry type: ${geomData.type}`);
  }

  let material;
  const { type, ...materialProps } = matData;
  switch (type) {
    case "standard":
      material = new THREE.MeshStandardMaterial({
        roughness: 0.5,
        metalness: 0.0,
        ...materialProps,
      });
      break;
    case "basic":
      material = new THREE.MeshBasicMaterial(materialProps);
      break;
    default:
      throw new Error(`Unknown material type: ${matData.type}`);
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = entity.renderable.castShadow ?? true;
  mesh.receiveShadow = entity.renderable.receiveShadow ?? true;

  return mesh;
}

/**
 * Creates a GLTF mesh and its container.
 * This factory is registered for the `gltf` component type.
 * It correctly sets up the parent container for physics and visual offsets.
 * @param {Object} entity - The entity to create the mesh for.
 * @param {Object} context - The context containing engine resources.
 * @param {Object} context.assets - The AssetManager instance.
 * @returns {THREE.Group} - The parent container group.
 */
export function gltfMeshFactory(entity, { assets }) {
  const { assetKey, scale, position, rotation, castShadow, receiveShadow } =
    entity.renderable;

  const cached = assets.cache.get(assetKey);
  if (!cached) {
    console.error(`GLTF asset not preloaded: ${assetKey}`);
    // Return a visible error mesh
    const errorGeom = new THREE.BoxGeometry(1, 1, 1);
    const errorMat = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      wireframe: true,
    });
    return new THREE.Mesh(errorGeom, errorMat);
  }

  const gltfClone = assets.cloneGLTF(cached);
  const gltfModel = gltfClone.scene;

  gltfModel.scale.setScalar(scale);
  gltfModel.rotation.set(rotation.x, rotation.y, rotation.z);

  gltfModel.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = castShadow;
      child.receiveShadow = receiveShadow;
    }
  });

  const container = new THREE.Group();
  container.name = `${assetKey}-container`;
  gltfModel.position.set(position.x, position.y, position.z);
  gltfModel.name = `${assetKey}-model`;
  container.add(gltfModel);

  // Attach animation data to the entity for the animation system to find
  if (gltfClone.animations && gltfClone.animations.length > 0) {
    entity.animationData = {
      mixer: new THREE.AnimationMixer(gltfModel),
      animations: gltfClone.animations,
    };
  }

  return container;
}
