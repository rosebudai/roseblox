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
  async function addPlayer({ model, feet = [0, 0, 0], height = 1.8, radius = .35, modelYaw = 0, ...controls }) {
    positive(height, "height"); positive(radius, "radius");
    if (height < 2 * radius) throw new Error("Player height must be at least twice its radius.");
    const spawn = feetVector(feet).add(new THREE.Vector3(0, height / 2, 0));
    // Validate/fit before creating a physics or input owner.
    const visual = fitRpgModel(model, { height, yaw: modelYaw });
    let body;
    try {
      body = await mechanics.addThirdPersonPlayer({
        ...controls, position: spawn.toArray(), radius, height: height - 2 * radius,
        jumpSpeed: controls.jumpSpeed ?? 7, facing: controls.facing ?? "camera",
        targetOffset: controls.targetOffset ?? [0, height * .3, 0],
      });
    } catch (error) {
      // The caller can recover or replace the same asset after input setup fails.
      model.removeFromParent();
      throw error;
    }
    const root = new THREE.Group();
    visual.position.y = -height / 2;
    root.add(visual); body.bindObject(root);
    return {
      body, root, visual,
      get position() { return body.position.add(new THREE.Vector3(0, -height / 2, 0)); },
      get active() { return body.active; },
      get grounded() { return body.grounded; },
      get locked() { return body.locked; },
      start: () => body.start(), stop: () => body.stop(), jump: () => body.jump(),
      setAction: (name, down) => body.setAction(name, down),
      setMoveSpeed: (walk, run = walk) => body.setMoveSpeed(walk, run),
      teleport: nextFeet => body.teleport(feetVector(nextFeet).add(new THREE.Vector3(0, height / 2, 0))),
      remove: () => { body.remove(); root.removeFromParent(); },
    };
  }
  return {
    addPlayer,
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
