import * as THREE from "three";
import { createMechanics } from "./mechanics.js";

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive.`);
  return value;
}
function feetVector(value = [0, 0, 0]) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error("feet must contain three finite numbers.");
  return new THREE.Vector3(...value);
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
export async function createRpgWorld(options = {}) {
  const mechanics = await createMechanics(options);
  function prepareActor(model, feet, height, radius, modelYaw) {
    positive(height, "height"); positive(radius, "radius");
    if (height < 2 * radius) throw new Error("Actor height must be at least twice its radius.");
    const spawn = feetVector(feet).add(new THREE.Vector3(0, height / 2, 0));
    // Validate/fit before creating a physics or input owner.
    const visual = fitRpgModel(model, { height, yaw: modelYaw });
    return { spawn, visual };
  }
  function attachActor(body, visual, height) {
    const root = new THREE.Group();
    visual.position.y = -height / 2;
    root.add(visual); body.bindObject(root);
    return {
      body, root, visual,
      get position() { return body.position.add(new THREE.Vector3(0, -height / 2, 0)); },
      get grounded() { return body.grounded; },
      jump: () => body.jump(),
      teleport: feet => body.teleport(feetVector(feet).add(new THREE.Vector3(0, height / 2, 0))),
      remove: () => { body.remove(); root.removeFromParent(); },
    };
  }
  async function addPlayer({ model, feet = [0, 0, 0], height = 1.8, radius = .35, modelYaw = 0, ...controls }) {
    const { spawn, visual } = prepareActor(model, feet, height, radius, modelYaw);
    let body;
    try {
      body = await mechanics.addThirdPersonPlayer({
        ...controls, position: spawn.toArray(), radius, height: height - 2 * radius, forwardAxis: "+Z",
        controlMode: controls.controlMode ?? "mmo",
        jumpSpeed: controls.jumpSpeed ?? 7, facing: controls.facing ?? "camera",
        targetOffset: controls.targetOffset ?? [0, height * .3, 0],
      });
    } catch (error) {
      // The caller can recover or replace the same asset after input setup fails.
      model.removeFromParent();
      throw error;
    }
    const actor = attachActor(body, visual, height);
    Object.defineProperties(actor, {
      active: { get: () => body.active },
      locked: { get: () => body.locked },
    });
    return Object.assign(actor, {
      start: () => body.start(), stop: () => body.stop(),
      pause: () => body.pause(), resume: () => body.resume(),
      setAction: (name, down) => body.setAction(name, down),
      setMoveSpeed: (walk, run = walk) => body.setMoveSpeed(walk, run),
    });
  }
  function addNpc({ model, feet = [0, 0, 0], height = 1.8, radius = .35, modelYaw = 0, autoFaceMovement = true, ...config }) {
    const { spawn, visual } = prepareActor(model, feet, height, radius, modelYaw);
    let body;
    try {
      body = mechanics.addCharacter({ ...config, position: spawn.toArray(), radius, height: height - 2 * radius, forwardAxis: "+Z", autoFaceMovement });
    } catch (error) { model.removeFromParent(); throw error; }
    return Object.assign(attachActor(body, visual, height), {
      setVelocity: value => body.setVelocity(value),
      faceDirection: value => body.faceDirection(value),
    });
  }
  return {
    addPlayer, addNpc,
    addBody: mechanics.addBody,
    addCharacter: mechanics.addCharacter,
    addStaticMesh: mechanics.addStaticMesh,
    castRay: mechanics.castRay,
    castSegment: mechanics.castSegment,
    onCollision: mechanics.onCollision,
    advance: mechanics.advance,
    getDiagnostics: mechanics.getDiagnostics,
    dispose: mechanics.dispose,
  };
}
