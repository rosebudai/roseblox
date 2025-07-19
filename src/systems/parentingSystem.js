/**
 * Parenting System
 *
 * This system updates the transform of any entity that has a `parent` component
 * to match the position of its parent entity.
 */

/**
 * Updates the transform of any entity that has a `parent` component to match the position of its parent entity. This is useful for making one entity follow another.
 * @param {World} world - The ECS world.
 */
export function parentingSystem(world) {
  const query = world.with("parent", "transform");

  for (const entity of query) {
    const parentEntity = entity.parent;
    if (parentEntity && parentEntity.transform) {
      entity.transform.position.copy(parentEntity.transform.position);
    }
  }
}
