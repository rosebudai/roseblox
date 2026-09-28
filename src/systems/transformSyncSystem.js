import { getPresentationTransform } from "../presentationTransform.js";

/**
 * Transform Sync System
 *
 * ECS system that syncs transform data from ECS components to visual meshes.
 * Copies position and rotation from ECS transform to THREE.js mesh objects.
 * Works with Unity-style hierarchy: moves containers, children follow automatically.
 * DATA FLOW: Physics World → ECS Transform → Visual Container → Children
 */

/**
 * Transform sync system - copies ECS transform data to visual containers
 * @param {World} world - ECS world instance
 */
export function transformSyncSystem(world, alpha = 1) {
  const query = world.with("renderable", "transform");

  for (const entity of query) {
    if (!entity.renderable.mesh) continue;
    // SYNC: ECS Transform → Visual Container (simple, clean)
    // Container moves, children automatically follow with their offsets
    const pose = getPresentationTransform(entity, alpha);
    entity.renderable.mesh.position.copy(pose.position);
    entity.renderable.mesh.quaternion.copy(pose.rotation);
  }
}
