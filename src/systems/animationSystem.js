const evaluators = {
  ">": (a, b) => a > b,
  "<": (a, b) => a < b,
  "===": (a, b) => a === b,
  "!==": (a, b) => a !== b,
};

function evaluateCondition(entity, condition) {
  const { property, is, than } = condition;
  const sourceComponent = entity.movementState;
  if (!sourceComponent || sourceComponent[property] === undefined) {
    return false;
  }
  return evaluators[is]?.(sourceComponent[property], than) ?? false;
}

function transitionToAnimation(animationMixer, targetAnimationName) {
  const { actions, transitionDuration } = animationMixer;
  const currentAnimationName = animationMixer.currentAnimation;

  // Avoid transitioning to the same animation
  if (currentAnimationName === targetAnimationName) {
    return;
  }

  const targetAction = actions.get(targetAnimationName);
  if (!targetAction) {
    console.warn(`Animation "${targetAnimationName}" not found in mixer.`);
    return;
  }

  // Fade in the new animation
  targetAction.reset().fadeIn(transitionDuration).play();

  // Fade out the previous animation if there was one
  if (currentAnimationName) {
    const currentAction = actions.get(currentAnimationName);
    if (currentAction) {
      currentAction.fadeOut(transitionDuration);
    }
  }

  animationMixer.currentAnimation = targetAnimationName;
}

/**
 * Animation System
 *
 * This system orchestrates all animation-related logic for entities.
 * It combines state evaluation, animation playback, and timeline updates
 * into a single, efficient pass.
 *
 * The system performs the following steps in order:
 * 1. Evaluates state machine transitions based on the entity's movementState.
 * 2. If the state changes, it triggers a cross-fade to the new animation clip.
 * 3. Advances the animation mixer's timeline (deltaTime).
 *
 * @param {World} world The ECS world.
 * @param {number} deltaTime The time elapsed since the last frame.
 */
export function animationSystem(world, deltaTime) {
  const query = world.with("animationMixer", "stateMachine", "movementState");

  for (const entity of query) {
    const { stateMachine, animationMixer } = entity;
    const currentStateNode = stateMachine.states[stateMachine.currentState];
    if (!currentStateNode) continue;

    // 1. Evaluate state machine transitions
    stateMachine.stateTime += deltaTime;
    for (const transition of currentStateNode.transitions) {
      if (evaluateCondition(entity, transition.when)) {
        stateMachine.currentState = transition.to;
        stateMachine.stateTime = 0;
        break; // Exit after first successful transition
      }
    }

    // 2. Map current state to animation and handle transitions
    const newCurrentStateNode = stateMachine.states[stateMachine.currentState];
    if (newCurrentStateNode?.animation) {
      const targetAnimationName = newCurrentStateNode.animation;
      transitionToAnimation(animationMixer, targetAnimationName);
    }

    // 3. Update the animation mixer timeline
    animationMixer.mixer.update(deltaTime);
  }
}
