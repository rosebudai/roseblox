import * as THREE from "three";
import { createPointerControls } from "./fpsInput.js";

const canvasOwners = new WeakMap();
export function firstPersonOptions(options = {}) {
  const { eyeOffset = [0, 0.55, 0], sensitivity = 23e-4, yaw = 0, pitch = 0, hideBody = true, onFire } = options;
  if (!Array.isArray(eyeOffset) || eyeOffset.length !== 3 || !eyeOffset.every(Number.isFinite)) throw new Error("First-person eyeOffset must contain three finite numbers.");
  if (!Number.isFinite(sensitivity) || sensitivity <= 0) throw new Error("First-person sensitivity must be positive.");
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) throw new Error("First-person yaw/pitch must be finite radians.");
  if (onFire !== void 0 && typeof onFire !== "function") throw new Error("First-person onFire must be a function.");
  return { eyeOffset: new THREE.Vector3(...eyeOffset), sensitivity, yaw, pitch, hideBody, onFire };
}
export function createFirstPersonCamera({ entity, camera, controls, canvas, input, world, onDispose, getPosition = () => entity.transform.position }, options) {
  const document2 = canvas.ownerDocument;
  const saved = { controlsEnabled: controls.enabled, playerEnabled: entity.player?.enabled, rotationOrder: camera.rotation.order, cursor: canvas.style.cursor };
  const pitchLimit = Math.PI / 2 - 0.05;
  const clampPitch = (value) => Math.max(-pitchLimit, Math.min(pitchLimit, value));
  let yaw = options.yaw, pitch = clampPitch(options.pitch);
  let enabled = false, playing = false, disposed = false, hidden = null, lastUpdate = performance.now();
  const active = () => !disposed && enabled && playing;
  const syncInput = () => {
    if (entity.player) entity.player.enabled = active();
  };
  function restoreBody() {
    if (hidden) {
      hidden.mesh.visible = hidden.visible;
      hidden = null;
    }
  }
  function applyCamera() {
    camera.position.copy(getPosition()).add(options.eyeOffset);
    camera.rotation.set(pitch, yaw, 0, "YXZ");
  }
  const mouse = createPointerControls({
    canvas,
    doc: document2,
    win: document2.defaultView,
    getState: () => active() ? "playing" : enabled ? "paused" : "ready",
    enter: () => {
      playing = true;
      canvas.style.cursor = "none";
      canvas.focus?.({ preventScroll: true });
      lastUpdate = performance.now();
      syncInput();
    },
    pause: () => {
      playing = false;
      canvas.style.cursor = saved.cursor;
      syncInput();
    },
    look: (dx, dy) => {
      yaw -= dx * options.sensitivity;
      pitch = clampPitch(pitch - dy * options.sensitivity);
      applyCamera();
    },
    fire: (event) => {
      if (active()) {
        applyCamera();
        options.onFire?.(event);
      }
    },
    release: () => {
    },
    resetInput: () => input.reset(),
    modeChanged: (mode) => {
      canvas.dataset.aimMode = mode;
    }
  });
  const controller = {
    entity,
    get enabled() {
      return !disposed && enabled;
    },
    get locked() {
      return !disposed && document2.pointerLockElement === canvas;
    },
    get active() {
      return active();
    },
    get error() {
      return null;
    },
    ownsHiddenVisual(owner) {
      return !disposed && owner === entity && hidden?.mesh === owner.mesh;
    },
    start() {
      if (disposed) throw new Error("This first-person camera is disposed. Create a new controller.");
      if (!world.has(entity)) throw new Error("The first-person entity is no longer in this game.");
      // Resume and repeated starts retain aim, held input and pending capture.
      // Only a stopped round starts again from its configured orientation.
      if (enabled) {
        mouse.start();
        return;
      }
      yaw = options.yaw;
      pitch = clampPitch(options.pitch);
      mouse.cancel();
      enabled = true;
      playing = false;
      controller.update();
      mouse.start();
    },
    stop() {
      if (disposed) return;
      enabled = playing = false;
      mouse.cancel();
      canvas.style.cursor = saved.cursor;
      syncInput();
    },
    update() {
      if (disposed) return;
      if (!world.has(entity)) {
        controller.dispose();
        return;
      }
      const now = performance.now();
      mouse.update((now - lastUpdate) / 1e3);
      lastUpdate = now;
      syncInput();
      const mesh = entity.renderable?.mesh ?? entity.mesh;
      if (hidden?.mesh !== mesh) restoreBody();
      if (options.hideBody && mesh && !hidden) {
        hidden = { mesh, visible: mesh.visible };
        mesh.visible = false;
      }
      applyCamera();
    },
    dispose() {
      if (disposed) return;
      controller.stop();
      disposed = true;
      mouse.dispose();
      canvas.removeEventListener("click", resume);
      if (canvasOwners.get(canvas) === controller) canvasOwners.delete(canvas);
      restoreBody();
      controls.enabled = saved.controlsEnabled;
      camera.rotation.reorder(saved.rotationOrder);
      if (entity.player) entity.player.enabled = saved.playerEnabled;
      onDispose(controller);
    }
  };
  function resume() {
    if (enabled && !disposed && !playing) mouse.start();
  }
  canvas.addEventListener("click", resume);
  canvasOwners.set(canvas, controller);
  controls.enabled = false;
  controller.update();
  return controller;
}
