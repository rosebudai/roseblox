import * as THREE from "three";

/**
 * @typedef {Object} Renderable
 * @property {THREE.Mesh} [mesh] - THREE.js mesh object (created by scene system)
 * @property {string} type - Type of renderable object
 * @property {boolean} needsMesh - Whether this entity needs a mesh created
 * @property {Object} geometry - Geometry specification
 * @property {Object} material - Material specification
 * @property {Array} [children] - Child mesh specifications
 * @property {boolean} castShadow - Whether object casts shadows
 * @property {boolean} receiveShadow - Whether object receives shadows
 */

/**
 * Creates the metadata for a procedurally generated mesh, such as a sphere or capsule.
 * The `sceneManagementSystem` uses this component to create and add a `THREE.Mesh` to the entity.
 * This component signals that an entity is "renderable" and specifies how to construct its visual representation.
 *
 * @param {string} type - The type of mesh to create. Must match a registered mesh factory (e.g., 'procedural').
 * @param {object} geometry - The description of the mesh's geometry (e.g., `{ type: 'capsule', radius: 0.5, height: 2 }`).
 * @param {object} material - The description of the mesh's material (e.g., `{ type: 'standard', color: 0xff0000 }`).
 * @param {boolean} [castShadow=true] - Whether this mesh should cast shadows.
 * @param {boolean} [receiveShadow=true] - Whether this mesh should receive shadows.
 * @param {Array|null} [children=null] - Optional array of child mesh specifications.
 * @returns {Renderable} A renderable component for a procedural mesh.
 * @example
 * const renderable = createRenderableMetadata('procedural',
 *   { type: 'capsule', radius: 0.5, height: 1 },
 *   { type: 'standard', color: 'red' }
 * );
 * world.add(entity, { renderable });
 */
export function createRenderableMetadata(
  type,
  geometry,
  material,
  castShadow = true,
  receiveShadow = true,
  children = null
) {
  const renderable = {
    type,
    needsMesh: true,
    geometry,
    material,
    castShadow,
    receiveShadow,
  };

  if (children) {
    renderable.children = children;
  }

  return renderable;
}

/**
 * Creates the metadata for a mesh that will be loaded from a GLTF asset.
 * The `sceneManagementSystem` uses this component to clone a pre-loaded GLTF model and attach it to the entity.
 *
 * @param {string} assetKey - The unique key of the GLTF asset, as defined in the `assets` configuration during engine initialization.
 * @param {object} [options={}] - Optional configuration for the GLTF instance.
 * @param {number} [options.scale=1.0] - A uniform scale factor to apply to the model.
 * @param {{x: number, y: number, z: number}} [options.position={x:0,y:0,z:0}] - A local position offset for the model relative to its parent entity.
 * @param {{x: number, y: number, z: number}} [options.rotation={x:0,y:0,z:0}] - A local rotation offset (in radians) for the model.
 * @param {boolean} [options.castShadow=true] - Whether the meshes in the model should cast shadows.
 * @param {boolean} [options.receiveShadow=true] - Whether the meshes in the model should receive shadows.
 * @returns {Renderable} A renderable component for a GLTF asset.
 * @example
 * const gltfRenderable = createGLTFRenderable('player-character', { scale: 2.0 });
 * world.add(entity, { renderable: gltfRenderable });
 */
export function createGLTFRenderable(assetKey, options = {}) {
  const {
    scale = 1.0,
    position = { x: 0, y: 0, z: 0 },
    rotation = { x: 0, y: 0, z: 0 },
    castShadow = true,
    receiveShadow = true,
  } = options;

  return {
    type: "gltf",
    needsMesh: true,
    assetKey,
    scale,
    position,
    rotation,
    castShadow,
    receiveShadow,
  };
}
