import * as THREE from "three";
import { createMechanics, readable } from "./mechanics.js";
import { RPG_MOVEMENT_DEFAULTS } from "./rpgProfile.js";
import { createLocomotion, modelParts } from "./actorAnimation.js";
import { createTouchControls, finePointer, touchAvailable } from "./touchControls.js";
export { queryMeleeTargets, queryRangedTarget } from "./rpgCombat.js";

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive.`);
  return value;
}
function feetVector(value = [0, 0, 0]) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error("feet must contain three finite numbers.");
  return new THREE.Vector3(...value);
}

let standInGeometry, standInMaterial;
/** A plain capsule for an actor created without a model, e.g. when its asset failed to load. */
function standIn() {
  standInGeometry ??= new THREE.CapsuleGeometry(.2, .6, 4, 12);
  standInMaterial ??= new THREE.MeshStandardMaterial({ color: 0x9aa4b2, roughness: .7 });
  return new THREE.Mesh(standInGeometry, standInMaterial);
}

/** Normalize a detached model into a unit-scale, feet-origin attachment frame. */
export function fitRpgModel(model, { height = 1.8, yaw = 0 } = {}) {
  positive(height, "height");
  if (!model?.isObject3D || model.parent) throw new Error("Pass a detached Three.js model instance.");
  if (!Number.isFinite(yaw)) throw new Error("yaw must be finite.");
  model.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || !Number.isFinite(size.y) || size.y <= 0) throw new Error("Model needs nonempty, finite bounds.");
  const center = bounds.getCenter(new THREE.Vector3());
  const root = new THREE.Group(), correction = new THREE.Group(), scaled = new THREE.Group();
  root.add(correction); correction.add(scaled); scaled.add(model);
  model.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  scaled.scale.setScalar(height / size.y);
  correction.rotation.y = yaw;
  return root;
}

/** RPG-specific surface over the shared physics motor; no rendering or game rules. */
export async function createRpgWorld({ playerDefaults = {}, ...options } = {}) {
  const mechanics = await createMechanics({ ...options, gravity: options.gravity ?? [0, RPG_MOVEMENT_DEFAULTS.gravity, 0] });
  const overlays = new Set(), animated = new Map();
  function prepareActor(model, feet, height, radius, modelYaw) {
    positive(height, "height"); positive(radius, "radius");
    if (height < 2 * radius) throw new Error("Actor height must be at least twice its radius.");
    const spawn = feetVector(feet).add(new THREE.Vector3(0, height / 2, 0));
    // Validate/fit before creating a physics or input owner.
    const visual = fitRpgModel(model, { height, yaw: modelYaw });
    return { spawn, visual };
  }
  /** Adds automatic movement animation, `mixer`, `animation`, `playAnimation` and `stopAnimation` to an actor. */
  function animateActor(actor, body, parts, enabled, speeds) {
    const locomotion = enabled ? createLocomotion(parts.root, parts.clips, speeds) : null;
    if (locomotion) animated.set(actor, { locomotion, body });
    const remove = actor.remove;
    Object.defineProperties(actor, {
      mixer: { get: () => locomotion?.mixer ?? null },
      animation: { get: () => locomotion?.state ?? null },
    });
    return Object.assign(actor, {
      playAnimation: (name, options) => locomotion?.play(name, options) ?? null,
      stopAnimation: () => locomotion?.stop(),
      remove: () => { if (animated.delete(actor)) locomotion.dispose(); remove(); },
    });
  }
  function attachActor(body, visual, height, forwardAxis = "+Z") {
    const root = new THREE.Group(), axis = new THREE.Vector3(0, 0, forwardAxis === "+Z" ? 1 : -1);
    visual.position.y = -height / 2;
    root.add(visual); body.bindObject(root);
    return {
      body, root, visual,
      get position() { return readable(body.position.add(new THREE.Vector3(0, -height / 2, 0))); },
      /** Horizontal facing, independent of each controller's body axis. */
      get forward() { const v = axis.clone().applyQuaternion(body.quaternion); v.y = 0; return readable(v.lengthSq() ? v.normalize() : new THREE.Vector3(0, 0, -1)); },
      get grounded() { return body.grounded; },
      jump: () => body.jump(),
      teleport: feet => body.teleport(feetVector(feet).add(new THREE.Vector3(0, height / 2, 0))),
      remove: () => { body.remove(); root.removeFromParent(); },
    };
  }
  async function addPlayer(config) {
    const { model: source, animations, animate = true, feet = [0, 0, 0], height = 1.8, radius = .35, modelYaw = 0, view = "third", touch = "auto", touchButtons = [], ...controls } = { ...playerDefaults, ...config };
    const parts = modelParts(source, animations), model = source == null ? standIn() : parts.root;
    if (!["third", "first"].includes(view)) throw new Error("view must be third or first.");
    if (!["auto", true, false].includes(touch)) throw new Error("touch must be auto, true or false.");
    if (!Array.isArray(touchButtons)) throw new Error("touchButtons must be an array.");
    // Touchscreens get an overlay driving the same player. Pointer lock is still requested when a
    // mouse is present (touch laptops); phones skip it rather than wait for the request to fail.
    const win = controls.canvas?.ownerDocument?.defaultView;
    const useTouch = touch === "auto" ? touchAvailable(win) : touch;
    const lockPointer = !useTouch || finePointer(win);
    const jumpSpeed = controls.jumpSpeed ?? RPG_MOVEMENT_DEFAULTS.jumpSpeed;
    const { spawn, visual } = prepareActor(model, feet, height, radius, modelYaw);
    let body;
    try {
      // First person keeps the fitted body for its collider/pose but never draws it over the camera.
      if (view === "first") body = await mechanics.addFpsPlayer({
        camera: controls.camera, canvas: controls.canvas, position: spawn.toArray(), radius, height: height - 2 * radius,
        speed: controls.speed, runSpeed: controls.runSpeed, jumpSpeed, lockPointer,
        eyeOffset: [0, height * .42, 0], yaw: controls.yaw ?? 0, pitch: controls.pitch ?? 0, sensitivity: controls.sensitivity, onFire: controls.onAttack,
      });
      else body = await mechanics.addThirdPersonPlayer({
        ...controls, position: spawn.toArray(), radius, height: height - 2 * radius, forwardAxis: "+Z",
        controlMode: controls.controlMode ?? "mmo", lockPointer,
        jumpSpeed, facing: controls.facing ?? "camera",
        targetOffset: controls.targetOffset ?? [0, height * .3, 0],
      });
    } catch (error) {
      // The caller can recover or replace the same asset after input setup fails.
      model.removeFromParent();
      throw error;
    }
    const actor = attachActor(body, visual, height, view === "first" ? "-Z" : "+Z");
    if (view === "first") visual.visible = false;
    let overlay = null;
    try {
      if (useTouch) overlay = createTouchControls({ canvas: controls.canvas, player: body, jump: jumpSpeed > 0, buttons: touchButtons });
    } catch (error) { actor.remove(); throw error; }
    if (overlay) overlays.add(overlay);
    const remove = actor.remove;
    Object.defineProperties(actor, {
      velocity: { get: () => body.velocity },
      jumpPressed: { get: () => body.jumpPressed },
      jumpHeld: { get: () => body.jumpHeld },
      active: { get: () => body.active },
      locked: { get: () => body.locked },
      touch: { value: !!overlay },
    });
    const speeds = { speed: controls.speed ?? 5, runSpeed: controls.runSpeed ?? 8 };
    animateActor(actor, body, parts, animate && view !== "first", speeds);
    const removeAnimated = actor.remove;
    return Object.assign(actor, {
      remove: () => { if (overlay) { overlays.delete(overlay); overlay.dispose(); overlay = null; } removeAnimated(); },
      look: (dx, dy) => body.look(dx, dy),
      setAxis: (x, z) => body.setAxis(x, z),
      start: () => body.start(), stop: () => body.stop(),
      pause: () => body.pause(), resume: () => body.resume(),
      setAction: (name, down) => body.setAction(name, down),
      setMoveSpeed: (walk, run = walk) => { body.setMoveSpeed(walk, run); animated.get(actor)?.locomotion.setSpeeds(walk, run); },
      setVelocity: value => body.setMotion(value),
    });
  }
  function addNpc({ model: source, animations, animate = true, speed = 2.5, runSpeed = 5, feet = [0, 0, 0], height = 1.8, radius = .35, modelYaw = 0, autoFaceMovement = true, ...config }) {
    const parts = modelParts(source, animations), model = source == null ? standIn() : parts.root;
    const { spawn, visual } = prepareActor(model, feet, height, radius, modelYaw);
    let body;
    try {
      body = mechanics.addCharacter({ ...config, position: spawn.toArray(), radius, height: height - 2 * radius, forwardAxis: "+Z", autoFaceMovement });
    } catch (error) { model.removeFromParent(); throw error; }
    const npc = Object.assign(attachActor(body, visual, height), {
      setVelocity: value => body.setVelocity(value),
      faceDirection: value => body.faceDirection(value),
    });
    return animateActor(npc, body, parts, animate, { speed, runSpeed });
  }
  return {
    addPlayer, addNpc,
    addBody: mechanics.addBody,
    addCharacter: mechanics.addCharacter,
    addStaticMesh: mechanics.addStaticMesh,
    castRay: mechanics.castRay,
    castSegment: mechanics.castSegment,
    onCollision: mechanics.onCollision,
    advance(dt, config) {
      const result = mechanics.advance(dt, config);
      for (const overlay of overlays) overlay.sync();
      if (!config?.paused && dt > 0) for (const [actor, { locomotion, body }] of animated) {
        // A body removed through its own handle (a ray or collision hit) stops animating.
        if (body.removed) { animated.delete(actor); locomotion.dispose(); continue; }
        const v = body.velocity;
        locomotion.update(Math.min(dt, .1), { horizontalSpeed: Math.hypot(v.x, v.z), grounded: body.grounded });
      }
      return result;
    },
    getDiagnostics: mechanics.getDiagnostics,
    dispose() {
      for (const overlay of overlays) overlay.dispose();
      overlays.clear();
      for (const { locomotion } of animated.values()) locomotion.dispose();
      animated.clear();
      mechanics.dispose();
    },
  };
}
