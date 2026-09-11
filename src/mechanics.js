import * as THREE from "three";
import { setupPhysics } from "./resources/physics/physicsSetup.js";
import { setupInput } from "./resources/inputSetup.js";
import { createFirstPersonCamera, firstPersonOptions } from "./firstPersonCamera.js";
import { moveCharacter, createCapsuleController, capsuleSpawnClearance } from "./characterMotor.js";
import { arcadeVehicleOptions, createArcadeVehicle } from "./arcadeVehicle.js";
import { thirdPersonOptions, createThirdPersonCamera } from "./thirdPersonCamera.js";
import { staticMeshShape } from "./staticMesh.js";

const cameraOwners = new WeakMap(), canvasOwners = new WeakMap(), visualOwners = new WeakMap();
const up = new THREE.Vector3(0, 1, 0);
function positive(value, name, zero = false) {
  if (!Number.isFinite(value) || (zero ? value < 0 : value <= 0)) throw new Error(`${name} must be ${zero ? "non-negative" : "positive"}.`);
  return value;
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
  const entries = new Map(), colliders = new Map(), contacts = new Map(), listeners = new Set(), changedColliders = new Set();
  let nextId = 1, accumulator = 0, disposed = false, paused = false, advancing = false;
  const diagnostics = { frames: 0, fixedSteps: 0, simulatedSeconds: 0, droppedSeconds: 0 };
  const forward = new THREE.Vector3(), right = new THREE.Vector3(), desired = new THREE.Vector3();
  const heading = new THREE.Quaternion(), parentRotation = new THREE.Quaternion();
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
    entries.delete(handle); colliders.delete(entry.collider.handle); changedColliders.delete(entry.collider);
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
    const handle = {
      id: nextId++, data: config.data ?? {},
      get position() { return requireEntry(handle).position.clone(); },
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
        e.body.setTranslation(p, true);
        if (e.body.isKinematic()) e.body.setNextKinematicTranslation(p);
        e.body.setLinvel({ x: 0, y: 0, z: 0 }, true); e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        if (e.state) { e.state.verticalVelocity = 0; e.state.grounded = false; e.state.jumpHeld = false; e.jumpRequested = false; e.velocity.set(0, 0, 0); }
        changedColliders.add(e.collider);
        e.input?.reset(); e.vehicle?.resetMotion(); readPose(e, true); present(e, 1); e.fps?.update(); e.third?.updateCamera(); e.vehicle?.updateCamera();
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
    const spawnClearance = positive(config.spawnClearance ?? capsuleSpawnClearance(physics, fixedTimeStep), "spawnClearance", true);
    const position = vector(config.position, [0, 2, 0]); position.y += spawnClearance;
    const handle = addBody({ ...config, position, type: "kinematic", shape: { type: "capsule", radius: config.radius ?? 0.35, height: config.height ?? 1.1 } });
    try {
      const entry = entries.get(handle);
      entry.controller = createCapsuleController(physics);
      entry.state = { enabled: true, grounded: false, verticalVelocity: 0, jumpHeld: false };
      entry.velocity = vector(config.velocity); entry.spawnClearance = spawnClearance;
      entry.jumpSpeed = jumpSpeed; entry.jumpRequested = false;
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
    const handle = addCharacter(config), entry = entries.get(handle);
    cameraOwners.set(camera, entry); canvasOwners.set(canvas, entry);
    const release = () => {
      if (cameraOwners.get(camera) === entry) cameraOwners.delete(camera);
      if (canvasOwners.get(canvas) === entry) canvasOwners.delete(canvas);
    };
    try {
      entry.input = await setupInput({ canvas, inputWindow: canvas.ownerDocument.defaultView, autoFocus: false });
      if (disposed || !entries.has(handle)) { entry.input.dispose(); throw new Error("Third-person player was removed during input initialization."); }
      entry.speed = speed; entry.runSpeed = runSpeed; entry.camera = camera;
      entry.third = createThirdPersonCamera({ entry, config, input: entry.input, castSegment: api.castSegment, requireLive: () => requireEntry(handle), release });
      for (const name of ["active", "enabled", "locked"]) Object.defineProperty(handle, name, { get: () => entry.third[name] });
      for (const name of ["start", "stop"]) handle[name] = () => entry.third[name]();
      handle.setAction = (action, enabled) => { requireEntry(handle); entry.input.setAction(action, enabled); };
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
    const handle = addCharacter(config), entry = entries.get(handle);
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
      Object.assign(handle, { start: () => { live(); entry.fps.start(); }, stop: () => entry.fps.stop(), setAction: (action, enabled) => { requireEntry(handle); entry.input.setAction(action, enabled); } });
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
        const move = player.active ? e.input.getMovementVector() : { x: 0, z: 0 };
        if (e.third) e.third.direction(forward); else e.camera.getWorldDirection(forward);
        forward.y = 0; forward.normalize();
        right.crossVectors(forward, up).normalize();
        desired.copy(right).multiplyScalar(move.x).addScaledVector(forward, -move.z);
        if (desired.lengthSq() > 1) desired.normalize();
        desired.multiplyScalar(e.input.isActionActive("run") ? e.runSpeed : e.speed);
        const pressed = e.input.consumeActionPress("jump");
        jumpDown = player.active && (jumpDown || e.input.isActionActive("jump") || pressed);
        if (player.active && (e.third?.facing !== "movement" || desired.lengthSq() > 1e-8)) {
          const face = e.third?.facing === "movement" ? desired : forward;
          e.body.setNextKinematicRotation(heading.setFromAxisAngle(up, Math.atan2(-face.x, -face.z)));
        }
      }
      moveCharacter({ physics, body: e.body, collider: e.collider, controller: e.controller, state: e.state, velocity: desired, jumpDown, jumpSpeed: e.jumpSpeed ?? 0 }, dt);
    }
    world.timestep = dt; world.step(eventQueue);
    changedColliders.clear();
    for (const e of entries.values()) readPose(e);
    processContacts();
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
    return { body: colliders.get(hit.collider.handle), point: o.addScaledVector(d, hit.timeOfImpact), normal: vector(hit.normal), distance: hit.timeOfImpact };
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
      live(); positive(dt, "dt", true);
      if (advancing) throw new Error("Mechanics.advance cannot be called recursively.");
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
