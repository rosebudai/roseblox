import * as THREE from "three";
import { setupPhysics } from "./resources/physics/physicsSetup.js";
import { setupInput } from "./resources/inputSetup.js";
import { createFirstPersonCamera, firstPersonOptions } from "./firstPersonCamera.js";
import { moveCharacter, createCapsuleController, capsuleSpawnClearance } from "./characterMotor.js";
import { arcadeVehicleOptions, createArcadeVehicle } from "./arcadeVehicle.js";
import { thirdPersonOptions, thirdPersonKeyMappings, createThirdPersonCamera } from "./thirdPersonCamera.js";
import { staticMeshShape } from "./staticMesh.js";

const cameraOwners = new WeakMap(), canvasOwners = new WeakMap(), visualOwners = new WeakMap();
const up = new THREE.Vector3(0, 1, 0);
function positive(value, name, zero = false) {
  if (!Number.isFinite(value) || (zero ? value < 0 : value <= 0)) throw new Error(`${name} must be ${zero ? "non-negative" : "positive"}.`);
  return value;
}
const RUN_AXIS = .9;
const components = ["x", "y", "z"];
// On the prototype, so clone() and other Vector3 methods that build a new vector keep index access.
class ReadableVector3 extends THREE.Vector3 {}
for (let i = 0; i < 3; i++) Object.defineProperty(ReadableVector3.prototype, i, { get() { return this[components[i]]; }, set(value) { this[components[i]] = value; } });
/** Vectors handed to game code read as `v.x` or `v[0]`, since inputs take `[x, y, z]`. */
export function readable(v) {
  return new ReadableVector3(v.x, v.y, v.z);
}
function vector(value, fallback = [0, 0, 0]) {
  value ??= fallback;
  if (Array.isArray(value) && value.length !== 3) throw new Error("Expected a three-component vector.");
  const v = Array.isArray(value) ? new THREE.Vector3(...value) : new THREE.Vector3(value.x, value.y, value.z);
  if (![v.x, v.y, v.z].every(Number.isFinite)) throw new Error("Expected a finite three-component vector.");
  return v;
}
function rotation(value = [0, 0, 0, 1]) {
  if (Array.isArray(value) && value.length !== 4) throw new Error("Expected a four-component quaternion.");
  const q = Array.isArray(value) ? new THREE.Quaternion(...value) : new THREE.Quaternion(value.x, value.y, value.z, value.w);
  if (![q.x, q.y, q.z, q.w].every(Number.isFinite) || q.lengthSq() < 1e-12) throw new Error("Expected a nonzero finite quaternion.");
  return q.normalize();
}

/** Owns mechanics only. The host owns RAF, the renderer, scene and borrowed art. */
export async function createMechanics(options = {}) {
  const fixedTimeStep = positive(options.fixedTimeStep ?? 1 / 60, "fixedTimeStep");
  const maxSubSteps = positive(options.maxSubSteps ?? 8, "maxSubSteps");
  if (!Number.isInteger(maxSubSteps)) throw new Error("maxSubSteps must be an integer.");
  const maxFrameDelta = positive(options.maxFrameDelta ?? 0.25, "maxFrameDelta");
  const maxCcdSubsteps = positive(options.maxCcdSubsteps ?? 4, "maxCcdSubsteps");
  if (!Number.isInteger(maxCcdSubsteps)) throw new Error("maxCcdSubsteps must be an integer.");
  const physics = await setupPhysics({ gravity: vector(options.gravity, [0, -9.81, 0]) });
  const { RAPIER, world, eventQueue } = physics;
  // A single CCD pass discards remaining travel at mesh-road contacts, causing
  // visible slowdown despite a high reported chassis speed. Work stays bounded.
  world.integrationParameters.maxCcdSubsteps = maxCcdSubsteps;
  const entries = new Map(), colliders = new Map(), contacts = new Map(), listeners = new Set(), changedColliders = new Set(), kinematicProps = new Set();
  let nextId = 1, accumulator = 0, disposed = false, paused = false, advancing = false;
  const diagnostics = { frames: 0, fixedSteps: 0, simulatedSeconds: 0, droppedSeconds: 0, negativeDeltaFrames: 0 };
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), desired = new THREE.Vector3(), ride = new THREE.Vector3();
  const heading = new THREE.Quaternion(), parentRotation = new THREE.Quaternion(), turn = new THREE.Quaternion(), nextTurn = new THREE.Quaternion();
  const identity = { x: 0, y: 0, z: 0, w: 1 }, still = { x: 0, y: 0, z: 0 }, down = { x: 0, y: -1, z: 0 }, up = { x: 0, y: 1, z: 0 };
  const faceRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, down);
  const live = () => { if (disposed) throw new Error("Mechanics is disposed."); };
  function requireEntry(handle) {
    live();
    const entry = entries.get(handle);
    if (!entry) throw new Error("Body does not belong to this live mechanics world.");
    return entry;
  }
  function notify(type, pair) {
    for (const fn of [...listeners]) { if (disposed) break; fn({ type, a: pair.a, b: pair.b }); }
  }
  function readPose(entry, reset = false) {
    entry.position.copy(entry.body.translation()); entry.quaternion.copy(entry.body.rotation());
    if (reset) {
      entry.previousPosition.copy(entry.position); entry.previousRotation.copy(entry.quaternion);
      entry.renderPosition.copy(entry.position); entry.renderRotation.copy(entry.quaternion);
    }
  }
  function bind(entry, object) {
    if (!object?.isObject3D) throw new Error("bindObject requires a Three.js Object3D.");
    const owner = visualOwners.get(object);
    if (owner) throw new Error("Release this visual's existing body binding before rebinding it.");
    entry.bindings.add(object); visualOwners.set(object, entry);
    present(entry, 1);
    let released = false;
    return () => { if (released) return; released = true; entry.bindings.delete(object); if (visualOwners.get(object) === entry) visualOwners.delete(object); };
  }
  function present(entry, alpha) {
    entry.renderPosition.lerpVectors(entry.previousPosition, entry.position, alpha);
    entry.renderRotation.copy(entry.previousRotation).slerp(entry.quaternion, alpha);
    for (const object of entry.bindings) {
      object.position.copy(entry.renderPosition); object.quaternion.copy(entry.renderRotation);
      if (object.parent) {
        object.parent.updateWorldMatrix(true, false);
        object.parent.worldToLocal(object.position);
        object.parent.getWorldQuaternion(parentRotation).invert();
        object.quaternion.premultiply(parentRotation);
      }
      object.updateMatrix();
    }
  }
  function remove(handle) {
    const entry = entries.get(handle);
    if (!entry) return;
    entries.delete(handle); colliders.delete(entry.collider.handle); changedColliders.delete(entry.collider); kinematicProps.delete(entry);
    entry.fps?.dispose(); entry.third?.dispose(); entry.vehicle?.dispose(); entry.input?.dispose();
    for (const object of entry.bindings) if (visualOwners.get(object) === entry) visualOwners.delete(object);
    entry.bindings.clear();
    for (const [key, pair] of [...contacts]) {
      if (pair.a === handle || pair.b === handle) { contacts.delete(key); notify("end", pair); }
    }
    for (const [key, pair] of physicalContacts) if (pair.a === handle || pair.b === handle) physicalContacts.delete(key);
    if (!disposed) {
      if (entry.controller) world.removeCharacterController(entry.controller);
      world.removeRigidBody(entry.body);
    }
  }
  function addBody(config = {}, meshDescriptor) {
    live();
    const type = config.type ?? "fixed", shape = config.shape ?? { type: "box", size: [1, 1, 1] };
    const position = vector(config.position), quaternion = rotation(config.quaternion);
    const factory = { fixed: "fixed", dynamic: "dynamic", kinematic: "kinematicPositionBased" }[type];
    if (!factory) throw new Error("Body type must be fixed, dynamic or kinematic.");
    let descriptor = meshDescriptor;
    if (!descriptor) {
      if (shape.type === "box") {
        const size = vector(shape.size, [1, 1, 1]);
        for (const n of size.toArray()) positive(n, "Box size");
        descriptor = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
      } else if (shape.type === "sphere") descriptor = RAPIER.ColliderDesc.ball(positive(shape.radius ?? 0.5, "radius"));
      else if (shape.type === "capsule") descriptor = RAPIER.ColliderDesc.capsule(positive(shape.height ?? 1.1, "height", true) / 2, positive(shape.radius ?? 0.35, "radius"));
      else throw new Error("Shape must be box, sphere or capsule.");
    }
    descriptor.setFriction(positive(config.friction ?? 0.7, "friction", true))
      .setRestitution(positive(config.restitution ?? 0, "restitution", true))
      .setSensor(config.sensor ?? false).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
      .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL);
    if (config.collisionGroups !== undefined) descriptor.setCollisionGroups(config.collisionGroups);
    const body = world.createRigidBody(RAPIER.RigidBodyDesc[factory]().setTranslation(position.x, position.y, position.z).setRotation(quaternion));
    let collider;
    try { collider = world.createCollider(descriptor, body); }
    catch (error) { world.removeRigidBody(body); throw error; }
    const entry = { body, collider, position, quaternion, previousPosition: position.clone(), previousRotation: quaternion.clone(), renderPosition: position.clone(), renderRotation: quaternion.clone(), bindings: new Set(), controller: null, state: null, fps: null, input: null };
    if (type === "kinematic") kinematicProps.add(entry);
    const handle = {
      id: nextId++, data: config.data ?? {},
      get position() { return readable(requireEntry(handle).position.clone()); },
      get quaternion() { return requireEntry(handle).quaternion.clone(); },
      get grounded() { const e = requireEntry(handle); return e.vehicle?.grounded ?? e.state?.grounded ?? false; },
      get removed() { return !entries.has(handle); },
      setVelocity(value) {
        const e = requireEntry(handle), v = vector(value);
        if (e.state) e.velocity.copy(v);
        else if (e.body.isDynamic()) e.body.setLinvel(v, true);
        else throw new Error("setVelocity requires a character or dynamic body; move kinematic props with moveTo.");
      },
      moveTo(value, q) {
        const e = requireEntry(handle), p = vector(value);
        if (!e.body.isKinematic() || e.state) throw new Error("moveTo requires a kinematic prop.");
        e.body.setNextKinematicTranslation(p);
        if (q !== undefined) e.body.setNextKinematicRotation(rotation(q));
      },
      setRotation(value) {
        const e = requireEntry(handle), q = rotation(value);
        e.body.setRotation(q, true);
        if (e.body.isKinematic()) e.body.setNextKinematicRotation(q);
        e.quaternion.copy(q); e.previousRotation.copy(q); changedColliders.add(e.collider);
      },
      teleport(value) {
        const e = requireEntry(handle), p = vector(value);
        p.y += e.spawnClearance ?? 0;
        if (e.body.isKinematic() && !e.state) (e.carry ??= new THREE.Vector3()).add(vector(e.body.translation()).negate().add(p));
        e.body.setTranslation(p, true);
        if (e.body.isKinematic()) e.body.setNextKinematicTranslation(p);
        e.body.setLinvel({ x: 0, y: 0, z: 0 }, true); e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        // Clear motion only: a held key, stick or touch button keeps driving the player.
        if (e.state) { e.state.verticalVelocity = 0; e.state.grounded = false; e.state.jumpHeld = !!e.input?.isActionActive("jump"); e.jumpRequested = false; e.velocity.set(0, 0, 0); e.boost.set(0, 0, 0); e.inputVelocity.set(0, 0, 0); e.jumpPressed = false; }
        changedColliders.add(e.collider);
        e.vehicle?.resetMotion(); readPose(e, true); present(e, 1); e.fps?.update(); e.third?.updateCamera(); e.vehicle?.updateCamera();
      },
      bindObject(object) { return bind(requireEntry(handle), object); },
      remove: () => remove(handle),
    };
    entry.handle = handle; entries.set(handle, entry); colliders.set(collider.handle, handle);
    changedColliders.add(collider);
    return handle;
  }
  function addCharacter(config = {}) {
    const jumpSpeed = positive(config.jumpSpeed ?? 7, "jumpSpeed", true);
    const forwardAxis = config.forwardAxis ?? "+Z";
    if (forwardAxis !== "+Z" && forwardAxis !== "-Z") throw new Error("forwardAxis must be +Z or -Z.");
    const spawnClearance = positive(config.spawnClearance ?? capsuleSpawnClearance(physics, fixedTimeStep), "spawnClearance", true);
    const position = vector(config.position, [0, 2, 0]); position.y += spawnClearance;
    const handle = addBody({ ...config, position, type: "kinematic", shape: { type: "capsule", radius: config.radius ?? 0.35, height: config.height ?? 1.1 } });
    try {
      const entry = entries.get(handle);
      entry.controller = createCapsuleController(physics);
      entry.state = { enabled: true, grounded: false, verticalVelocity: 0, jumpHeld: false }; kinematicProps.delete(entry);
      entry.velocity = vector(config.velocity); entry.spawnClearance = spawnClearance;
      entry.forwardAxis = forwardAxis; entry.autoFaceMovement = config.autoFaceMovement === true;
      entry.jumpSpeed = jumpSpeed; entry.jumpRequested = false; entry.jumpPressed = false;
      entry.boost = new THREE.Vector3(); entry.inputVelocity = new THREE.Vector3();
      Object.defineProperties(handle, {
        /** World velocity from walking, pushes and the vertical speed (0 while standing). */
        velocity: { get: () => { const e = requireEntry(handle); return readable(e.inputVelocity.clone().add(e.boost).setY(e.state.grounded && e.state.verticalVelocity <= 0 ? 0 : e.state.verticalVelocity)); } },
        /** A new jump press this fixed step that the engine did not use for a ground jump. */
        jumpPressed: { get: () => requireEntry(handle).jumpPressed },
        jumpHeld: { get: () => requireEntry(handle).state.jumpHeld },
      });
      /** Set the velocity now; gravity keeps acting and walking input takes the horizontal part back as the push fades. */
      handle.setMotion = value => {
        const e = requireEntry(handle), v = vector(value);
        e.state.verticalVelocity = v.y;
        e.boost.set(v.x - e.inputVelocity.x, 0, v.z - e.inputVelocity.z);
      };
      handle.faceDirection = value => {
        const e = requireEntry(handle), direction = vector(value);
        if (direction.x * direction.x + direction.z * direction.z < 1e-12) return;
        const sign = e.forwardAxis === "+Z" ? 1 : -1;
        handle.setRotation(heading.setFromAxisAngle(up, Math.atan2(sign * direction.x, sign * direction.z)));
      };
      handle.jump = () => {
        const e = requireEntry(handle);
        if (!e.state.grounded || e.state.jumpHeld || e.jumpSpeed === 0) return false;
        e.jumpRequested = true; return true;
      };
      return handle;
    } catch (error) { remove(handle); throw error; }
  }
  async function addThirdPersonPlayer(config = {}) {
    live();
    const { camera, canvas } = config;
    if (!camera?.isPerspectiveCamera || !canvas?.ownerDocument || (camera.parent && !camera.parent.isScene)) throw new Error("Third-person player requires a scene-root perspective camera and the host canvas.");
    if (cameraOwners.has(camera) || canvasOwners.has(canvas)) throw new Error("Release the existing controller before claiming this camera or canvas.");
    thirdPersonOptions(config);
    const speed = positive(config.speed ?? 5, "speed"), runSpeed = positive(config.runSpeed ?? 8, "runSpeed");
    const handle = addCharacter({ ...config, forwardAxis: config.forwardAxis ?? "-Z" }), entry = entries.get(handle);
    cameraOwners.set(camera, entry); canvasOwners.set(canvas, entry);
    const release = () => {
      if (cameraOwners.get(camera) === entry) cameraOwners.delete(camera);
      if (canvasOwners.get(canvas) === entry) canvasOwners.delete(canvas);
    };
    try {
      entry.input = await setupInput({ canvas, inputWindow: canvas.ownerDocument.defaultView, autoFocus: false, keyMappings: thirdPersonKeyMappings(config) });
      if (disposed || !entries.has(handle)) { entry.input.dispose(); throw new Error("Third-person player was removed during input initialization."); }
      entry.speed = speed; entry.runSpeed = runSpeed; entry.camera = camera;
      entry.third = createThirdPersonCamera({ entry, config, input: entry.input, castSegment: api.castSegment, castRay, requireLive: () => requireEntry(handle), release });
      for (const name of ["active", "enabled", "locked"]) Object.defineProperty(handle, name, { get: () => entry.third[name] });
      for (const name of ["start", "stop", "pause", "resume"]) handle[name] = () => entry.third[name]();
      handle.setAction = (action, enabled) => { requireEntry(handle); entry.input.setAction(action, enabled); };
      handle.setAxis = (x, z) => { requireEntry(handle); entry.input.setAxis(x, z); };
      handle.look = (dx, dy) => { requireEntry(handle); entry.third.look(dx, dy); };
      handle.setMoveSpeed = (walk, run = walk) => {
        requireEntry(handle);
        const speed = positive(walk, "speed", true), runSpeed = positive(run, "runSpeed", true);
        entry.speed = speed; entry.runSpeed = runSpeed;
      };
      return handle;
    } catch (error) { release(); remove(handle); throw error; }
  }
  async function addFpsPlayer(config = {}) {
    live();
    const { camera, canvas } = config;
    if (!camera?.isPerspectiveCamera || !canvas?.ownerDocument) throw new Error("FPS player requires the host's perspective camera and canvas.");
    if (cameraOwners.has(camera) || canvasOwners.has(canvas)) throw new Error("Release the existing FPS player before claiming this camera or canvas.");
    const fpsOptions = firstPersonOptions({ ...config, hideBody: false });
    const speed = positive(config.speed ?? 5, "speed"), runSpeed = positive(config.runSpeed ?? 8, "runSpeed"), jumpSpeed = positive(config.jumpSpeed ?? 7, "jumpSpeed", true);
    const handle = addCharacter({ ...config, forwardAxis: "-Z" }), entry = entries.get(handle);
    cameraOwners.set(camera, entry); canvasOwners.set(canvas, entry);
    try {
      entry.input = await setupInput({ canvas, inputWindow: canvas.ownerDocument.defaultView, autoFocus: false });
      if (disposed || !entries.has(handle)) { entry.input.dispose(); throw new Error("FPS player was removed during input initialization."); }
      entry.player = entry.state;
      entry.speed = speed; entry.runSpeed = runSpeed; entry.jumpSpeed = jumpSpeed; entry.camera = camera;
      entry.fps = createFirstPersonCamera({ entity: entry, camera, canvas, controls: { enabled: false }, input: entry.input,
        world: { has: candidate => entries.get(handle) === candidate }, getPosition: () => entry.renderPosition,
        onDispose() { if (cameraOwners.get(camera) === entry) cameraOwners.delete(camera); if (canvasOwners.get(canvas) === entry) canvasOwners.delete(canvas); },
      }, fpsOptions);
      Object.defineProperties(handle, {
        active: { get: () => entry.fps.active }, locked: { get: () => entry.fps.locked }, enabled: { get: () => entry.fps.enabled },
      });
      Object.assign(handle, {
        start: () => { live(); entry.fps.start(); }, stop: () => entry.fps.stop(),
        pause: () => entry.fps.pause(), resume: () => { live(); entry.fps.resume(); },
        setAction: (action, enabled) => { requireEntry(handle); entry.input.setAction(action, enabled); },
        setAxis: (x, z) => { requireEntry(handle); entry.input.setAxis(x, z); },
        look: (dx, dy) => { requireEntry(handle); entry.fps.look(dx, dy); },
        setMoveSpeed: (walk, run = walk) => {
          requireEntry(handle);
          entry.speed = positive(walk, "speed", true); entry.runSpeed = positive(run, "runSpeed", true);
        },
      });
      return handle;
    } catch (error) {
      if (cameraOwners.get(camera) === entry) cameraOwners.delete(camera);
      if (canvasOwners.get(canvas) === entry) canvasOwners.delete(canvas);
      remove(handle); throw error;
    }
  }
  async function addArcadeVehicle(config = {}) {
    live();
    const { camera, canvas } = config;
    if (camera && (!camera.isPerspectiveCamera || (camera.parent && !camera.parent.isScene))) throw new Error("Vehicle camera must be a perspective camera at the scene root.");
    if (canvas && !canvas.ownerDocument) throw new Error("Vehicle input requires the host canvas.");
    if ((camera && cameraOwners.has(camera)) || (canvas && canvasOwners.has(canvas))) throw new Error("Release the existing controller before claiming this camera or canvas.");
    const settings = arcadeVehicleOptions(config), size = vector(config.size, [1.8, .8, 3.6]);
    for (const n of size.toArray()) positive(n, "Vehicle size");
    const handle = addBody({ ...config, type: "dynamic", shape: { type: "box", size }, position: config.position ?? [0, 1, 0], quaternion: new THREE.Quaternion().setFromAxisAngle(up, settings.heading), sensor: false });
    const entry = entries.get(handle);
    if (camera) cameraOwners.set(camera, entry);
    if (canvas) canvasOwners.set(canvas, entry);
    const release = () => {
      if (camera && cameraOwners.get(camera) === entry) cameraOwners.delete(camera);
      if (canvas && canvasOwners.get(canvas) === entry) canvasOwners.delete(canvas);
    };
    try {
      if (canvas) entry.input = await setupInput({ canvas, inputWindow: canvas.ownerDocument.defaultView, autoFocus: false, keyMappings: { Space: "handbrake", KeyR: "reset" } });
      if (disposed || !entries.has(handle)) { entry.input?.dispose(); throw new Error("Vehicle was removed during input initialization."); }
      entry.collider.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
      entry.vehicle = createArcadeVehicle({ entry, config, size, input: entry.input, castRay, castSegment: api.castSegment, requireLive: () => requireEntry(handle), release });
      for (const name of ["active", "enabled", "speed"]) Object.defineProperty(handle, name, { get: () => entry.vehicle[name] });
      for (const name of ["start", "stop", "setControls", "reset"]) handle[name] = (...args) => entry.vehicle[name](...args);
      entry.vehicle.updateCamera();
      return handle;
    } catch (error) { release(); remove(handle); throw error; }
  }
  function contactKey(a, b) { return a.id < b.id ? `${a.id}/${b.id}` : `${b.id}/${a.id}`; }
  const physicalContacts = new Map();
  function processContacts() {
    eventQueue.drainCollisionEvents((a, b, started) => {
      const first = colliders.get(a), second = colliders.get(b);
      if (!first || !second) return;
      const key = contactKey(first, second);
      if (started) physicalContacts.set(key, { a: first, b: second }); else physicalContacts.delete(key);
    });
    const current = new Map();
    for (const [key, pair] of physicalContacts) {
      if (entries.has(pair.a) && entries.has(pair.b)) current.set(key, pair); else physicalContacts.delete(key);
    }
    for (const entry of entries.values()) if (entry.controller) {
      for (let i = 0; i < entry.controller.numComputedCollisions(); i++) {
        const c = entry.controller.computedCollision(i)?.collider, other = c && colliders.get(c.handle);
        if (other && !c.isSensor()) current.set(contactKey(entry.handle, other), { a: entry.handle, b: other });
      }
      // A rider's sweep skips the floor it rides, so report the floor it was settled on instead.
      const floor = entry.riding && entry.standingOn && colliders.get(entry.standingOn.handle);
      if (floor) current.set(contactKey(entry.handle, floor), { a: entry.handle, b: floor });
    }
    for (const [key, pair] of [...contacts]) if (!current.has(key)) { contacts.delete(key); notify("end", pair); }
    for (const [key, pair] of current) if (!contacts.has(key) && entries.has(pair.a) && entries.has(pair.b)) { contacts.set(key, pair); notify("start", pair); }
  }
  function step(dt) {
    for (const e of entries.values()) {
      e.previousPosition.copy(e.position); e.previousRotation.copy(e.quaternion);
      e.vehicle?.step(dt);
      if (!e.state) continue;
      desired.copy(e.velocity);
      let jumpDown = e.jumpRequested;
      e.jumpRequested = false;
      const player = e.fps ?? e.third;
      if (player) {
        const move = player.active ? (e.third ? e.third.movement() : e.input.getMovementVector()) : { x: 0, z: 0 };
        if (e.third) e.third.direction(forward); else e.camera.getWorldDirection(forward);
        forward.y = 0; forward.normalize();
        right.crossVectors(forward, up).normalize();
        desired.copy(right).multiplyScalar(move.x).addScaledVector(forward, -move.z);
        if (desired.lengthSq() > 1) desired.normalize();
        // Pushing the analog stick to its edge runs, so touch players can run without a button.
        desired.multiplyScalar(e.input.isActionActive("run") || e.input.getAxisLength?.() > RUN_AXIS ? e.runSpeed : e.speed);
        const pressed = e.input.consumeActionPress("jump");
        jumpDown = player.active && (jumpDown || e.input.isActionActive("jump") || pressed);
        if (player.active && (e.third?.facing !== "movement" || desired.lengthSq() > 1e-8)) {
          const face = e.third?.facing === "movement" ? desired : forward;
          const sign = e.forwardAxis === "+Z" ? 1 : -1;
          e.body.setNextKinematicRotation(heading.setFromAxisAngle(up, Math.atan2(sign * face.x, sign * face.z)));
        }
      } else if (e.autoFaceMovement && desired.x * desired.x + desired.z * desired.z > 1e-12) {
        const sign = e.forwardAxis === "+Z" ? 1 : -1;
        e.body.setNextKinematicRotation(heading.setFromAxisAngle(up, Math.atan2(sign * desired.x, sign * desired.z)));
      }
      e.inputVelocity.set(desired.x, 0, desired.z);
      desired.add(e.boost);
      let floors;
      if (e.state.grounded) {
        // A platform teleported this step carries its rider the same distance.
        const support = supportUnder(e)?.body, carry = support && entries.get(support)?.carry;
        if (carry && carry.lengthSq() > 0 && carry.lengthSq() < 1) {
          e.body.setTranslation(vector(e.body.translation()).add(carry), true);
          world.propagateModifiedBodyPositionsToColliders();
        }
        // Rapier's controller stalls walking on a kinematic floor, so ride one here instead; a jump of a metre
        // or more in one step is a teleport, which the carry above already handled.
        const under = kinematicProps.size ? kinematicFloorsUnder(e, support) : [];
        // Standing on fixed ground or a character, it still sweeps past kinematic floors under its rim, which would
        // stall it at the seam, but is not carried by them.
        const aside = support && !kinematicProps.has(entries.get(support)) && !entries.get(support)?.body.isDynamic();
        if (under.length && (aside ? ride.set(0, 0, 0) : stepAt(under[0].body, feetOf(e), ride)).lengthSq() < 1) floors = under.map(prop => prop.collider);
      }
      if (floors) { const at = e.body.translation(); (e.carried ??= new THREE.Vector3()).set(at.x + ride.x, at.y + ride.y, at.z + ride.z); }
      const wasHeld = e.state.jumpHeld, wasGrounded = e.state.grounded;
      e.riding = moveCharacter({ physics, body: e.body, collider: e.collider, controller: e.controller, state: e.state, velocity: desired, jumpDown, jumpSpeed: e.jumpSpeed ?? 0, floors, carry: ride }, dt);
      e.floors = e.riding ? floors : null;
      // How far settling reaches: the ride's step, plus any rise past it (a step up, or a push from something touching).
      if (e.riding) e.rideReach = ride.length() + Math.max(0, e.body.nextTranslation().y - e.body.translation().y - ride.y);
      e.jumpPressed = jumpDown && !wasHeld && !(wasGrounded && (e.jumpSpeed ?? 0) > 0);
      e.boost.multiplyScalar(Math.exp(-(e.state.grounded ? 10 : 1.5) * dt));
      if (e.boost.lengthSq() < 1e-6) e.boost.set(0, 0, 0);
    }
    for (const e of entries.values()) e.carry?.set(0, 0, 0);
    world.timestep = dt; world.step(eventQueue);
    let settled = false;
    for (const e of entries.values()) if (e.riding) { settle(e); settled = true; }
    if (settled) world.propagateModifiedBodyPositionsToColliders();
    changedColliders.clear();
    for (const e of entries.values()) readPose(e);
    processContacts();
  }
  function feetOf(e) {
    const t = e.body.translation();
    return { x: t.x, y: t.y - e.collider.halfHeight() - e.collider.radius(), z: t.z };
  }
  /** How far a kinematic body's next pose carries `point` this step, including its turn. */
  function stepAt(body, point, out) {
    const p = body.translation(), q = body.rotation(), n = body.nextRotation();
    turn.set(q.x, q.y, q.z, q.w).invert().premultiply(nextTurn.set(n.x, n.y, n.z, n.w));
    return out.set(point.x - p.x, point.y - p.y, point.z - p.z).applyQuaternion(turn).add(body.nextTranslation()).sub(point);
  }
  /**
   * Walkable kinematic props under a character's feet, the one under its centre first. None when its centre stands
   * on a kinematic prop too steep to walk on.
   */
  function kinematicFloorsUnder(e, centre) {
    const feet = feetOf(e), found = [];
    // A disc just inside the capsule's footprint, from 5 cm above the feet to 15 cm below.
    e.footprint ??= new RAPIER.Cylinder(.1, e.collider.radius() * .95);
    world.intersectionsWithShape({ x: feet.x, y: feet.y - .05, z: feet.z }, identity, e.footprint, collider => {
      const prop = entries.get(colliders.get(collider.handle));
      if (kinematicProps.has(prop) && walkable(e, collider)) found.push(prop);
      return true;
    }, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, e.collider);
    if (centre && kinematicProps.has(entries.get(centre)) && !found.some(prop => prop.handle === centre)) return [];
    return found.sort((a, b) => (b.handle === centre) - (a.handle === centre));
  }
  /** A ball narrower than the capsule, which finds floors without catching walls or characters touching its side. */
  function soleOf(e) {
    const inset = e.collider.radius() * .2;
    e.sole ??= { ball: new RAPIER.Ball(e.collider.radius() - inset), inset };
    return e.sole;
  }
  /** Whether a kinematic collider under a character is ground it can stand on. */
  function walkable(e, collider) {
    const t = e.body.translation(), { ball, inset } = soleOf(e);
    const start = { x: t.x, y: t.y - e.collider.halfHeight() + .1, z: t.z };
    const hit = collider.castShape(still, ball, start, identity, down, 0, .3 + inset, false);
    if (!hit || hit.time_of_impact <= 0) return false;
    const flattest = Math.cos(e.controller.maxSlopeClimbAngle()) - 1e-3;
    return -hit.normal2.y >= flattest || faceAt(e, collider, { x: start.x, y: start.y - hit.time_of_impact, z: start.z }, hit.normal2)?.y >= flattest;
  }
  /**
   * The normal of the face of `collider` that the sole ball, centred at `centre`, touches along its own outward
   * normal `n`. Past an edge the ball meets the edge at a slant, so this reads the face just beyond the touch.
   */
  function faceAt(e, collider, centre, n) {
    const r = soleOf(e).ball.radius, across = Math.hypot(n.x, n.z), nudge = across > 1e-6 ? .02 / across : 0;
    faceRay.origin = { x: centre.x + n.x * (r + nudge), y: centre.y + n.y * r + .05, z: centre.z + n.z * (r + nudge) };
    const face = collider.castRayAndGetNormal(faceRay, .1, true);
    return face && face.timeOfImpact > 0 ? face.normal : null;
  }
  /** After a ride, stands the rider on the floor under it, undoing any sink or gap, or lets it fall past an edge. */
  function settle(e) {
    const t = e.body.translation(), lift = .1 + e.rideReach, { ball, inset } = soleOf(e), r = ball.radius;
    const offset = e.controller.offset(), slope = e.controller.maxSlopeClimbAngle(), flattest = Math.cos(slope) - 1e-3;
    const start = { x: t.x, y: t.y - e.collider.halfHeight() + lift, z: t.z };
    const riding = e.floors, touch = skip => {
      const hit = world.castShape(start, identity, down, ball, 0, 2 * lift + inset, false, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, e.collider, undefined, skip === undefined ? undefined : c => c.handle !== skip);
      const centre = hit && { x: start.x, y: start.y - hit.time_of_impact, z: start.z };
      return { hit, n: hit?.normal2, centre, face: hit && faceAt(e, hit.collider, centre, hit.normal2) };
    };
    let { hit, n, centre, face } = touch();
    // Past a face too steep to stand on that it presses into, besides the floors it rides, to the floor under it.
    if (hit && !riding.some(f => f.handle === hit.collider.handle) && -n.y < flattest && !(face?.y >= flattest)) ({ hit, n, centre, face } = touch(hit.collider.handle));
    // normal2 is the ball's own outward normal at the contact. The rider stands on a climbable face, or on an edge
    // no further out than Rapier's controller grounds a capsule resting its offset away from it.
    const reach = e.collider.radius() + offset, across = hit ? Math.hypot(n.x, n.z) * r : 0;
    const floor = hit && n.y < 0 && across <= reach * Math.sin(slope) + 1e-3 && (-n.y >= flattest || face?.y >= flattest) ? hit : null;
    e.state.grounded = !!floor; e.standingOn = floor?.collider;
    if (!floor) return;
    // On a face the capsule rests the inset plus the offset further out along its normal than the ball touches;
    // on an edge its lower sphere rests the radius plus the offset from the edge.
    const onFace = !face || face.x * -n.x + face.y * -n.y + face.z * -n.z > .999;
    let y = e.collider.halfHeight() + (onFace ? centre.y + (inset + offset) / -n.y : centre.y + n.y * r + Math.sqrt(reach * reach - across * across));
    const dy = y - t.y;
    if (Math.abs(dy) > 1e-4) {
      // Move only as far as anything but the floors it rides allows: a ceiling over a stopping lift, or a short
      // character it stepped onto. A slightly slimmer capsule ignores walls touching its side.
      e.hull ??= new RAPIER.Capsule(e.collider.halfHeight() + .03, e.collider.radius() - .03);
      const room = world.castShape(t, identity, dy > 0 ? up : down, e.hull, 0, Math.abs(dy) + offset, false, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, e.collider, undefined, c => !riding.some(f => f.handle === c.handle));
      const allowed = room ? Math.max(0, room.time_of_impact - offset) : Math.abs(dy);
      // Held up by a face too steep to stand on (one it walked into as it rose with the floor): slide down that face,
      // away from it, if nothing else is in the way; otherwise leave it to fall.
      if (dy < 0 && allowed < -dy - 1e-3 && -room.normal2.y < flattest) {
        const m = room.normal2, rest = -dy - allowed, k = rest * m.y / (m.x * m.x + m.z * m.z);
        const from = { x: t.x, y: t.y - allowed, z: t.z }, path = new THREE.Vector3(k * m.x, -rest, k * m.z), span = path.length();
        const blocked = world.castShape(from, identity, path.divideScalar(span), e.hull, 0, span, false, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, e.collider, undefined, c => !riding.some(f => f.handle === c.handle));
        if (blocked && blocked.time_of_impact < span - 1e-3) { e.state.grounded = false; e.standingOn = null; return; }
        e.body.setTranslation({ x: from.x + k * m.x, y, z: from.z + k * m.z }, true);
        return;
      }
      // Too low to stand up on (a ramp running under a ceiling): stay where the floor alone carried it, as Rapier
      // stops a walk into a gap it cannot fit.
      if (dy > 0 && allowed < dy - 1e-3) { e.body.setTranslation({ x: e.carried.x, y: t.y + allowed, z: e.carried.z }, true); return; }
      y = t.y + Math.sign(dy) * allowed;
    }
    e.body.setTranslation({ x: t.x, y, z: t.z }, true);
  }
  function supportUnder(e) {
    const t = e.body.translation(), feet = e.collider.halfHeight() + e.collider.radius();
    return castRay([t.x, t.y - feet + .05, t.z], [0, -1, 0], { maxDistance: .25, exclude: e.handle });
  }
  function castRay(origin, direction, config = {}) {
    live();
    const o = vector(origin), d = vector(direction);
    if (d.lengthSq() < 1e-12) throw new Error("Ray direction must be nonzero.");
    d.normalize();
    const maxDistance = positive(config.maxDistance ?? 100, "maxDistance");
    const excluded = new Set(config.exclude ? (Array.isArray(config.exclude) ? config.exclude : [config.exclude]) : []);
    const included = config.bodies ? new Set(config.bodies) : null;
    // Rapier refreshes the broad phase on a physics step. Query edited colliders
    // directly until then so spawning/teleporting never requires a hidden step.
    world.propagateModifiedBodyPositionsToColliders();
    const ray = new RAPIER.Ray(o, d);
    const accepts = collider => {
      const body = colliders.get(collider.handle);
      if (!body || excluded.has(body) || (included && !included.has(body)) || (!config.sensors && collider.isSensor())) return false;
      if (config.collisionGroups !== undefined) {
        const groups = collider.collisionGroups(), filter = config.collisionGroups;
        if (!((groups >>> 16) & (filter & 0xffff)) || !((filter >>> 16) & (groups & 0xffff))) return false;
      }
      return true;
    };
    let hit = world.castRayAndGetNormal(ray, maxDistance, true,
      config.sensors ? undefined : RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, config.collisionGroups, undefined, undefined,
      collider => !changedColliders.has(collider) && accepts(collider));
    for (const collider of changedColliders) if (accepts(collider)) {
      const direct = collider.castRayAndGetNormal(ray, hit?.timeOfImpact ?? maxDistance, true);
      if (direct && (!hit || direct.timeOfImpact < hit.timeOfImpact)) hit = { ...direct, collider };
    }
    if (!hit) return null;
    return { body: colliders.get(hit.collider.handle), point: readable(o.addScaledVector(d, hit.timeOfImpact)), normal: readable(hit.normal), distance: hit.timeOfImpact };
  }
  const api = {
    addBody, addCharacter, addFpsPlayer, addThirdPersonPlayer, addArcadeVehicle, castRay,
    addStaticMesh(mesh, config = {}) {
      live();
      return addBody({ friction: config.friction, restitution: config.restitution, sensor: config.sensor, collisionGroups: config.collisionGroups, data: config.data, type: "fixed" }, staticMeshShape(mesh, RAPIER, config));
    },
    castSegment(from, to, config = {}) {
      const origin = vector(from), direction = vector(to).sub(origin), distance = direction.length();
      if (!distance) { live(); return null; }
      return castRay(origin, direction, { ...config, maxDistance: distance });
    },
    onCollision(fn) { live(); if (typeof fn !== "function") throw new Error("Collision listener must be a function."); listeners.add(fn); return () => listeners.delete(fn); },
    advance(dt, { paused: shouldPause = false, beforeStep, afterStep } = {}) {
      live();
      if (!Number.isFinite(dt)) throw new Error("dt must be finite.");
      if (advancing) throw new Error("Mechanics.advance cannot be called recursively.");
      // RAF timestamps can precede a Timer constructed in the same frame.
      // Such a frame has no simulation time; it must not stop the host's RAF.
      if (dt < 0) { diagnostics.negativeDeltaFrames++; dt = 0; }
      advancing = true;
      try {
        if (options.autoPause !== false) for (const e of entries.values()) {
          const controller = e.fps ?? e.third ?? e.vehicle;
          if (e.input && controller?.enabled && !controller.active) shouldPause = true;
        }
        const frameDelta = Math.min(dt, maxFrameDelta);
        diagnostics.frames++;
        if (shouldPause !== paused) {
          accumulator = 0; paused = shouldPause;
          for (const e of entries.values()) { if (paused) { e.input?.reset(); e.vehicle?.clear(); e.jumpRequested = false; } readPose(e, true); }
        }
        for (const e of entries.values()) e.fps?.update();
        for (const e of entries.values()) e.third?.updateInput(paused ? 0 : frameDelta);
        if (paused) { for (const e of entries.values()) { e.third?.updateCamera(); e.vehicle?.updateCamera(); } return; }
        diagnostics.droppedSeconds += dt - frameDelta;
        accumulator += frameDelta;
        let steps = 0;
        while (accumulator + 1e-10 >= fixedTimeStep && steps < maxSubSteps) {
          beforeStep?.(fixedTimeStep);
          if (disposed) return;
          step(fixedTimeStep);
          if (disposed) return;
          accumulator = Math.max(0, accumulator - fixedTimeStep);
          diagnostics.fixedSteps++; diagnostics.simulatedSeconds += fixedTimeStep; steps++;
          afterStep?.(fixedTimeStep);
          if (disposed) return;
        }
        if (accumulator + 1e-10 >= fixedTimeStep) {
          const dropped = Math.floor((accumulator + 1e-10) / fixedTimeStep) * fixedTimeStep;
          accumulator = Math.max(0, accumulator - dropped); diagnostics.droppedSeconds += dropped;
        }
        const alpha = options.interpolate === false ? 1 : Math.min(1, accumulator / fixedTimeStep);
        for (const e of entries.values()) { present(e, alpha); e.fps?.update(); e.third?.updateCamera(); e.vehicle?.updateCamera(); }
      } finally { advancing = false; }
    },
    getDiagnostics: () => ({ ...diagnostics, bodies: entries.size, contacts: contacts.size, disposed }),
    get physics() { live(); return { RAPIER, world }; },
    dispose() {
      if (disposed) return;
      listeners.clear();
      for (const handle of [...entries.keys()]) remove(handle);
      contacts.clear(); physicalContacts.clear(); disposed = true; physics.dispose();
    },
  };
  return api;
}
