import * as THREE from "three";
import { createPointerControls } from "./fpsInput.js";

export function thirdPersonOptions(config) {
  const settings = { yaw: 0, pitch: .3, distance: 6, minDistance: 2, maxDistance: 14, sensitivity: .0023 };
  for (const key of Object.keys(settings)) {
    settings[key] = config[key] ?? settings[key];
    if (!Number.isFinite(settings[key])) throw new Error(`Third-person ${key} must be finite.`);
  }
  if (settings.minDistance <= 0 || settings.maxDistance < settings.minDistance || settings.sensitivity <= 0) throw new Error("Invalid third-person distance or sensitivity.");
  const offset = config.targetOffset ?? [0, .6, 0];
  if (!Array.isArray(offset) || offset.length !== 3 || !offset.every(Number.isFinite)) throw new Error("Third-person targetOffset must contain three finite numbers.");
  if (config.onAttack !== undefined && typeof config.onAttack !== "function") throw new Error("Third-person onAttack must be a function.");
  settings.targetOffset = new THREE.Vector3(...offset);
  settings.facing = config.facing ?? "camera";
  if (!["camera", "movement"].includes(settings.facing)) throw new Error("Third-person facing must be camera or movement.");
  return settings;
}

/** Mouse orbit shares the FPS capture/fallback lifecycle, without owning any art. */
export function createThirdPersonCamera({ entry, config, input, castSegment, requireLive, release }) {
  const { canvas, camera } = config, doc = canvas.ownerDocument, options = thirdPersonOptions(config);
  const cursor = canvas.style.cursor, savedUp = camera.up.clone();
  const target = new THREE.Vector3(), eye = new THREE.Vector3(), direction = new THREE.Vector3();
  let yaw = options.yaw, pitch = THREE.MathUtils.clamp(options.pitch, -1.3, 1.45);
  let distance = THREE.MathUtils.clamp(options.distance, options.minDistance, options.maxDistance);
  let enabled = false, active = false;
  const mouse = createPointerControls({ canvas, doc, win: doc.defaultView,
    getState: () => active ? "playing" : enabled ? "paused" : "ready",
    enter: () => { active = true; canvas.style.cursor = "none"; canvas.focus({ preventScroll: true }); },
    pause: () => { active = false; canvas.style.cursor = cursor; },
    look: (dx, dy) => {
      yaw -= dx * options.sensitivity;
      // Positive elevation looks down at the target; upward mouse motion looks up.
      pitch = THREE.MathUtils.clamp(pitch + dy * options.sensitivity, -1.3, 1.45);
      controller.updateCamera();
    },
    fire: event => { if (active) config.onAttack?.(event); }, release: () => {},
    resetInput: () => { input.reset(); entry.jumpRequested = false; },
    modeChanged: mode => { canvas.dataset.aimMode = mode; },
  });
  const controller = {
    get active() { return active; }, get enabled() { return enabled; },
    get locked() { return doc.pointerLockElement === canvas; },
    get facing() { return options.facing; },
    direction(out) { return out.set(-Math.sin(yaw), 0, -Math.cos(yaw)); },
    start() {
      requireLive();
      if (!enabled) { yaw = options.yaw; pitch = THREE.MathUtils.clamp(options.pitch, -1.3, 1.45); }
      enabled = true; controller.updateCamera(); mouse.start();
    },
    stop() { enabled = active = false; mouse.cancel(); canvas.style.cursor = cursor; },
    updateInput(dt) { mouse.update(dt); },
    updateCamera() {
      target.copy(entry.renderPosition).add(options.targetOffset);
      direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      eye.copy(target).addScaledVector(direction, distance);
      const hit = castSegment(target, eye, { exclude: entry.handle, collisionGroups: config.collisionGroups });
      if (hit) eye.copy(target).addScaledVector(direction, Math.max(.05, hit.distance - Math.max(.25, camera.near * 2)));
      camera.position.copy(eye); camera.up.set(0, 1, 0); camera.lookAt(target); camera.updateMatrixWorld();
    },
    dispose() {
      controller.stop(); mouse.dispose(); canvas.removeEventListener("click", resume); canvas.removeEventListener("wheel", zoom);
      camera.up.copy(savedUp); release();
    },
  };
  function resume() { if (enabled && !active) controller.start(); }
  function zoom(event) {
    if (!active) return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight || 720 : 1);
    distance = THREE.MathUtils.clamp(distance * Math.exp(THREE.MathUtils.clamp(pixels * .001, -1, 1)), options.minDistance, options.maxDistance);
    controller.updateCamera();
  }
  canvas.addEventListener("click", resume); canvas.addEventListener("wheel", zoom, { passive: false });
  controller.updateCamera();
  return controller;
}
