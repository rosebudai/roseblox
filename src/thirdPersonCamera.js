import * as THREE from "three";
import { createPointerControls } from "./fpsInput.js";
import { createRpgControls } from "./rpgInput.js";
import { RPG_CLASSIC_KEYS } from "./rpgProfile.js";

export function thirdPersonOptions(config) {
  const settings = { yaw: 0, pitch: .3, distance: 6, minDistance: 2, maxDistance: 14, sensitivity: .0023, turnSpeed: 2 };
  for (const key of Object.keys(settings)) {
    settings[key] = config[key] ?? settings[key];
    if (!Number.isFinite(settings[key])) throw new Error(`Third-person ${key} must be finite.`);
  }
  if (settings.minDistance <= 0 || settings.maxDistance < settings.minDistance || settings.sensitivity <= 0 || settings.turnSpeed <= 0) throw new Error("Invalid third-person distance or sensitivity.");
  const offset = config.targetOffset ?? [0, .6, 0];
  if (!Array.isArray(offset) || offset.length !== 3 || !offset.every(Number.isFinite)) throw new Error("Third-person targetOffset must contain three finite numbers.");
  if (config.onAttack !== undefined && typeof config.onAttack !== "function") throw new Error("Third-person onAttack must be a function.");
  if (config.onSelect !== undefined && typeof config.onSelect !== "function") throw new Error("Third-person onSelect must be a function.");
  settings.controlMode = config.controlMode ?? "pointer";
  settings.keyboardLayout = config.keyboardLayout ?? "classic";
  if (!["pointer", "mmo"].includes(settings.controlMode)) throw new Error("Third-person controlMode must be pointer or mmo.");
  if (!["classic", "orbit"].includes(settings.keyboardLayout)) throw new Error("Third-person keyboardLayout must be classic or orbit.");
  settings.targetOffset = new THREE.Vector3(...offset);
  settings.facing = config.facing ?? "camera";
  if (!["camera", "movement"].includes(settings.facing)) throw new Error("Third-person facing must be camera or movement.");
  return settings;
}

export function thirdPersonKeyMappings(config) {
  if (config.controlMode !== "mmo") return {};
  return config.keyboardLayout === "orbit"
    ? { KeyQ: "turnLeft", KeyE: "turnRight" }
    : RPG_CLASSIC_KEYS;
}

/** Shared orbit/collision, with distinct captured-mouse and free-cursor input. */
export function createThirdPersonCamera({ entry, config, input, castSegment, castRay, requireLive, release }) {
  const { canvas, camera } = config, doc = canvas.ownerDocument, options = thirdPersonOptions(config);
  const cursor = canvas.style.cursor, savedUp = camera.up.clone();
  const target = new THREE.Vector3(), eye = new THREE.Vector3(), direction = new THREE.Vector3();
  let yaw = options.yaw, pitch = THREE.MathUtils.clamp(options.pitch, -1.3, 1.45);
  let distance = THREE.MathUtils.clamp(options.distance, options.minDistance, options.maxDistance);
  let enabled = false, active = false, suspended = false;
  const mmo = options.controlMode === "mmo";
  const mouseOptions = { canvas, doc, win: doc.defaultView, input,
    getState: () => active ? "playing" : enabled ? "paused" : "ready",
    enter: () => { active = true; canvas.style.cursor = mmo ? "default" : "none"; canvas.focus({ preventScroll: true }); },
    pause: () => { active = false; canvas.style.cursor = cursor; },
    look: (dx, dy) => {
      yaw -= dx * options.sensitivity;
      // Positive elevation looks down at the target; upward mouse motion looks up.
      pitch = THREE.MathUtils.clamp(pitch + dy * options.sensitivity, -1.3, 1.45);
      controller.updateCamera();
    },
    fire: event => { if (active) config.onAttack?.(event); }, release: () => {},
    select: event => {
      if (!config.onSelect) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
      camera.updateMatrixWorld();
      const ray = new THREE.Raycaster(); ray.setFromCamera(pointer, camera);
      const hit = castRay(ray.ray.origin, ray.ray.direction, { maxDistance: camera.far, exclude: entry.handle, collisionGroups: config.collisionGroups });
      config.onSelect({ event, ray: ray.ray, hit });
    },
    resetInput: () => { input.reset(); entry.jumpRequested = false; },
    modeChanged: mode => { canvas.dataset.aimMode = mode; },
  };
  const mouse = mmo ? createRpgControls(mouseOptions) : createPointerControls(mouseOptions);
  const controller = {
    get active() { return active; }, get enabled() { return enabled; },
    get locked() { return doc.pointerLockElement === canvas; },
    get facing() { return options.facing; },
    direction(out) { return out.set(-Math.sin(yaw), 0, -Math.cos(yaw)); },
    movement() {
      const move = input.getMovementVector();
      if (mmo && options.keyboardLayout === "classic" && mouse.turning) move.x += Number(input.isActionActive("turnRight")) - Number(input.isActionActive("turnLeft"));
      if (mmo && mouse.walking) move.z = -1;
      return move;
    },
    start() {
      requireLive();
      if (suspended) return;
      enabled = true; controller.updateCamera(); mouse.start();
    },
    pause() { suspended = true; mouse.cancel(); },
    resume() { suspended = false; controller.start(); },
    stop() { suspended = false; enabled = active = false; mouse.cancel(); canvas.style.cursor = cursor; },
    updateInput(dt) {
      mouse.update(dt);
      if (mmo && active && !(options.keyboardLayout === "classic" && mouse.turning)) {
        yaw += (Number(input.isActionActive("turnLeft")) - Number(input.isActionActive("turnRight"))) * options.turnSpeed * dt;
      }
    },
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
  function resume() { if (enabled && !active && !suspended) controller.start(); }
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
