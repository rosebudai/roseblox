import * as THREE from "three";

// Clip names from the rigging service first, then common alternatives.
const LOCOMOTION = {
  idle: [/^idle$/i, /idle/i],
  walk: [/^walk$/i, /walk/i],
  run: [/^run$/i, /^sprint/i, /run|sprint/i],
  air: [/^jump_loop$/i, /fall/i, /^jump$/i, /jump/i],
};
const FADE = .2, AIR_DELAY = .15;

/** Resolve `model` as a Three.js object or a loaded glTF, with its animation clips. */
export function modelParts(model, animations) {
  const root = model?.isObject3D ? model : model?.scene;
  return { root, clips: animations ?? (model?.isObject3D ? model.animations : model?.animations) ?? [] };
}

/**
 * Plays idle, walk, run and in-air clips from an actor's speed and grounded state,
 * plus one-off clips on request. Returns null when the model has no usable clips.
 */
export function createLocomotion(root, clips, { speed = 5, runSpeed = 8 } = {}) {
  if (!Array.isArray(clips) || !clips.length) return null;
  const usable = clips.filter(clip => clip?.isAnimationClip || clip instanceof THREE.AnimationClip);
  const find = patterns => {
    for (const pattern of patterns) {
      const clip = usable.find(c => pattern.test(c.name) && !/crouch/i.test(c.name));
      if (clip) return clip;
    }
    return null;
  };
  const mixer = new THREE.AnimationMixer(root), actions = {};
  for (const [state, patterns] of Object.entries(LOCOMOTION)) {
    const clip = find(patterns);
    if (clip) actions[state] = mixer.clipAction(clip);
  }
  actions.walk ??= actions.run; actions.run ??= actions.walk;
  if (!actions.idle && !actions.walk) return null;
  let current = null, state = null, airborne = 0, oneShot = null;
  const fadeTo = (next, name) => {
    state = name;
    if (next === current) return;
    next.reset().setEffectiveWeight(1).fadeIn(FADE).play();
    current?.fadeOut(FADE);
    current = next;
  };
  mixer.addEventListener("finished", event => {
    if (event.action !== oneShot) return;
    oneShot = null; current = null;
    event.action.fadeOut(FADE);
  });
  return {
    mixer,
    get state() { return oneShot ? oneShot.getClip().name : state; },
    setSpeeds(walk, run) { speed = walk; runSpeed = run; },
    /** Play a clip once by name, then return to movement. Returns its duration, or null. */
    play(name, { fade = FADE, loop = false } = {}) {
      const clip = usable.find(c => c.name === name) ?? usable.find(c => c.name.toLowerCase() === String(name).toLowerCase());
      if (!clip) return null;
      const action = mixer.clipAction(clip);
      action.reset().setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      action.clampWhenFinished = !loop;
      action.fadeIn(fade).play();
      if (current && current !== action) current.fadeOut(fade);
      current = action; state = clip.name; oneShot = loop ? null : action;
      return clip.duration;
    },
    update(dt, { horizontalSpeed, grounded }) {
      airborne = grounded ? 0 : airborne + dt;
      if (!oneShot) {
        const walk = horizontalSpeed > .2 && horizontalSpeed <= (speed + runSpeed) / 2;
        const next = airborne > AIR_DELAY && actions.air ? "air"
          : horizontalSpeed <= .2 ? "idle"
          : walk ? "walk" : "run";
        fadeTo(actions[next] ?? actions.walk, next);
        if (next === "walk" || next === "run") {
          // Match stride to speed so feet do not slide.
          const base = next === "walk" ? speed : runSpeed;
          current.timeScale = THREE.MathUtils.clamp(horizontalSpeed / base, .6, 1.4);
        } else current.timeScale = next === "idle" && !actions.idle ? 0 : 1; // no idle clip: hold a walk pose
      }
      mixer.update(dt);
    },
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(root); },
  };
}
