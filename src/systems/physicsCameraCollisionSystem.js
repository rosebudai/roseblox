/**
 * Physics-Based Camera Collision System
 *
 * This system creates collision meshes from physics data and provides them to 
 * camera-controls for its built-in collision handling. This way we get the smooth
 * behavior of camera-controls with physics-based collision detection.
 */

import * as THREE from "three";

let hasInitializedCollision = false;

/**
 * Physics-based camera collision system
 * @param {World} world - ECS world instance
 * @param {Object} camera - Camera resource with controls and camera
 */
export function physicsCameraCollisionSystem(world, camera) {
  if (!camera || hasInitializedCollision) {
    return;
  }

  // Find terrain entities and extract their collision geometry
  for (const entity of world) {
    if (entity.isTerrain && entity.isTerrain.collisionGeometry) {
      const collisionGeometry = entity.isTerrain.collisionGeometry;
      
      // Create a mesh from the collision geometry for camera-controls
      const collisionMesh = new THREE.Mesh(collisionGeometry);
      
      // Add this mesh to camera-controls' collision system
      camera.controls.colliderMeshes.push(collisionMesh);
      
      hasInitializedCollision = true;
      break;
    }
  }
}