/**
 * COLLISION TEST SETUP
 *
 * Simple demo showing collision detection with physics bodies.
 * Creates 2 entities (box and sphere) that will trigger collision events
 * when the player character controller touches them.
 */
import * as THREE from "three";
import { CoreComponents } from "roseblox-game-engine";

const { createTransform, createRenderableMetadata } = CoreComponents;

/**
 * Creates basic collision test entities for demo purposes.
 * @param {World} world - ECS world instance.
 * @param {Object} dependencies - Required dependencies from the engine.
 */
export function setupCollisionTests(world, { terrain, physics }) {
  // Register physics body factories for test entities
  registerCollisionTestFactories(physics);

  // Create test collision entities positioned on terrain
  createCollisionTestEntities(world, terrain);
}

/**
 * Registers physics body factories for collision test entities.
 * @param {Object} physics - The physics resource from the engine.
 */
function registerCollisionTestFactories(physics) {
  // Single factory for all test collision objects
  physics.registerBodyFactory(
    "isTestCollisionObject",
    (entity, { physicsWorld, RAPIER }) => {
      const { position } = entity.transform;
      const { shape } = entity.isTestCollisionObject;

      const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(
        position.x,
        position.y,
        position.z
      );
      const rigidBody = physicsWorld.createRigidBody(rigidBodyDesc);

      // Create appropriate collider based on shape
      const colliderDesc =
        shape === "box"
          ? RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
          : RAPIER.ColliderDesc.ball(0.7);

      colliderDesc
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        .setRestitution(0.4)
        .setFriction(0.6);

      const collider = physicsWorld.createCollider(colliderDesc, rigidBody);
      return { rigidBody, collider };
    }
  );
}

/**
 * Creates the actual test collision entities positioned properly on terrain.
 * @param {World} world - ECS world instance.
 * @param {Object} terrain - The terrain resource for height calculation.
 */
function createCollisionTestEntities(world, terrain) {
  const testObjects = [
    { x: -21, z: -6, color: 0xff0000, shape: "box" },
    { x: -27, z: -6, color: 0x00ff00, shape: "sphere" },
  ];

  testObjects.forEach((obj) => {
    const terrainHeight = terrain?.getTerrainHeightAt(obj.x, obj.z) || 0;
    const spawnY = Math.max(terrainHeight + 3.0, 3.0);

    world.add({
      isTestCollisionObject: { shape: obj.shape },
      transform: createTransform(new THREE.Vector3(obj.x, spawnY, obj.z)),
      renderable: createRenderableMetadata(
        "procedural",
        obj.shape === "box"
          ? { type: "box", width: 1, height: 1, depth: 1 }
          : { type: "sphere", radius: 0.7, segments: 16 },
        {
          type: "standard",
          color: obj.color,
          roughness: 0.4,
          metalness: 0.15,
        }
      ),
    });
  });

  console.log("✅ Created 2 collision test entities");
}
