import { setControllerContacts } from "./collisionSystem.js";

/** Collect all character-controller contacts after movement, including helper actors. */
export function characterControllerCollisionSystem(world, { physics }) {
  const contacts = [];
  for (const entity of world.with("physicsBody")) {
    const controller = entity.physicsBody.controller;
    if (!controller) continue;
    for (let i = 0; i < controller.numComputedCollisions(); i++) {
      const other = controller.computedCollision(i)?.collider;
      // Sensors remain owned by Rapier's intersection events.
      if (!other || other.isSensor()) continue;
      const entityB = other.userData?.entity;
      if (entityB && entityB !== entity && world.has(entityB)) {
        contacts.push({ entityA: entity, entityB, controllerCollision: true });
      }
    }
  }
  setControllerContacts(physics, contacts);
}
