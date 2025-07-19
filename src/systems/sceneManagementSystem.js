/**
 * Scene Management System
 *
 * ECS system that handles mesh lifecycle and scene graph management.
 * Uses the renderer's factory registry to create meshes for entities.
 * Also handles automatic cleanup of meshes and physics bodies when entities are removed.
 */

// Track meshes and physics bodies to detect orphaned resources
const trackedMeshes = new Map(); // mesh -> entity mapping
const trackedPhysicsBodies = new Map(); // physicsBody -> entity mapping

/**
 * Scene management system - handles mesh creation, cleanup, and scene graph updates.
 * @param {World} world - ECS world instance.
 * @param {Object} context - The engine's resource context.
 * @param {Object} context.renderer - The renderer resource.
 * @param {Object} context.assets - The asset manager resource.
 * @param {Object} context.physics - The physics resource.
 */
export function sceneManagementSystem(world, { renderer, assets, physics }) {
  // Handle mesh creation (existing logic)
  handleMeshCreation(world, renderer, assets);

  // Handle automatic cleanup of orphaned resources
  handleResourceCleanup(world, renderer, physics);
}

/**
 * Handles mesh creation for entities that need meshes
 * @param {World} world - ECS world instance
 * @param {Object} renderer - The renderer resource
 * @param {Object} assets - The asset manager resource
 */
function handleMeshCreation(world, renderer, assets) {
  for (const entity of world) {
    if (
      !entity.renderable ||
      !entity.renderable.needsMesh ||
      entity.renderable.mesh
    ) {
      continue;
    }

    // A factory can be specified by the component name (e.g., isParticleEmitter)
    // or by the renderable's type property (e.g., type: 'gltf').
    let factory;
    let factoryKey;

    // First, check for a component name that is a registered factory
    for (const componentName in entity) {
      if (renderer.getMeshFactory(componentName)) {
        factoryKey = componentName;
        break;
      }
    }

    // If no component factory is found, fall back to the renderable type
    if (factoryKey) {
      factory = renderer.getMeshFactory(factoryKey);
    } else if (entity.renderable && entity.renderable.type) {
      factory = renderer.getMeshFactory(entity.renderable.type);
    }

    if (factory) {
      try {
        // Pass the entity and any necessary resources to the factory.
        const mesh = factory(entity, { assets });

        // The rest of the logic remains the same.
        entity.renderable.mesh = mesh;
        renderer.scene.add(mesh);

        // Track this mesh for cleanup detection
        trackedMeshes.set(mesh, entity);
      } catch (error) {
        console.error(
          `Mesh factory for entity failed [type: ${
            factoryKey || entity.renderable.type
          }]:`,
          error
        );
      } finally {
        // CRITICAL: Always mark as processed to prevent infinite loops on error.
        entity.renderable.needsMesh = false;
      }
    } else {
      console.warn(`No mesh factory found for type: ${entity.renderable.type}`);
      // Mark as processed to avoid re-checking every frame
      entity.renderable.needsMesh = false;
    }
  }

  // Track physics bodies for cleanup detection
  for (const entity of world) {
    if (entity.physicsBody && !trackedPhysicsBodies.has(entity.physicsBody)) {
      trackedPhysicsBodies.set(entity.physicsBody, entity);
    }
  }
}

/**
 * Handles cleanup of orphaned meshes and physics bodies
 * @param {World} world - ECS world instance
 * @param {Object} renderer - The renderer resource
 * @param {Object} physics - The physics resource
 */
function handleResourceCleanup(world, renderer, physics) {
  // Get all current entities for quick lookup
  const currentEntities = new Set(world);

  // Check for orphaned meshes
  for (const [mesh, entity] of trackedMeshes) {
    if (!currentEntities.has(entity)) {
      // Remove from Three.js scene
      renderer.scene.remove(mesh);

      // Dispose of geometry and materials to free memory
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((mat) => mat.dispose());
        } else {
          mesh.material.dispose();
        }
      }

      // Remove from tracking
      trackedMeshes.delete(mesh);
    }
  }

  // Check for orphaned physics bodies
  for (const [physicsBody, entity] of trackedPhysicsBodies) {
    if (!currentEntities.has(entity)) {
      // Remove from physics world
      if (physicsBody.collider) {
        physics.world.removeCollider(physicsBody.collider, true);
      }
      if (physicsBody.rigidBody) {
        physics.world.removeRigidBody(physicsBody.rigidBody);
      }

      // Remove from tracking
      trackedPhysicsBodies.delete(physicsBody);
    }
  }
}
