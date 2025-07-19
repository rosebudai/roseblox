import * as THREE from "three";

/**
 * @typedef {Object} AnimationMixer
 * @property {THREE.AnimationMixer} mixer - THREE.js animation mixer instance
 * @property {Map<string, THREE.AnimationAction>} actions - Map of animation name to action
 * @property {string} currentAnimation - Currently playing animation name
 * @property {string} targetAnimation - Animation to transition to
 * @property {boolean} transitioning - Whether currently transitioning between animations
 * @property {number} transitionDuration - Duration of animation transitions
 */

/**
 * Creates a component that manages the playback of animations for a GLTF model.
 * This is created by the `animationSetupSystem` when an entity with a `gltf` renderable
 * and animation data is added to the world. A game developer typically does not create this directly.
 *
 * @param {THREE.AnimationMixer} mixer - The `THREE.AnimationMixer` instance bound to the model's skeleton.
 * @param {THREE.AnimationClip[]} [animations=[]] - An array of `THREE.AnimationClip` objects available for this model.
 * @param {number} [transitionDuration=0.3] - The default time in seconds for fading between animations.
 * @returns {AnimationMixer} An animation mixer component.
 */
export function createAnimationMixer(
  mixer,
  animations = [],
  transitionDuration = 0.3
) {
  const actions = new Map();

  // Create actions for all available animations
  animations.forEach((clip) => {
    const action = mixer.clipAction(clip);
    action.loop = THREE.LoopRepeat;
    actions.set(clip.name, action);
  });

  return {
    mixer,
    actions,
    currentAnimation: null,
    targetAnimation: null,
    transitioning: false,
    transitionDuration,
  };
}
