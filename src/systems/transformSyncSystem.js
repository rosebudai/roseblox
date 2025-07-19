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
export function transformSyncSystem(world) {
  const query = world
    .with("renderable", "transform")
    .where((e) => e.renderable.mesh);

  for (const entity of query) {
    // SYNC: ECS Transform → Visual Container (simple, clean)
    // Container moves, children automatically follow with their offsets
    entity.renderable.mesh.position.copy(entity.transform.position);
    entity.renderable.mesh.quaternion.copy(entity.transform.rotation);
  }
}
