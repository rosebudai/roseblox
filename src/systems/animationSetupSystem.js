/**
 * Animation Setup System
 *
 * This system adds the AnimationMixer component to entities that have a
 * newly created mesh with animation data.
 */
import { World } from "miniplex";
import { createAnimationMixer } from "../components/animationMixer.js";

/**
 * Adds the AnimationMixer component to entities that have a mesh with
 * animations but do not yet have the mixer component.
 * @param {World} world - The ECS world instance.
 */
export function animationSetupSystem(world) {
  const query = world.with("animationData").where((e) => !e.animationMixer);

  for (const entity of query) {
    const { mixer, animations } = entity.animationData;

    // Add the animation mixer component to the entity.
    world.addComponent(
      entity,
      "animationMixer",
      createAnimationMixer(mixer, animations)
    );

    // Remove the temporary animationData component as it has been processed.
    world.removeComponent(entity, "animationData");
  }
}
