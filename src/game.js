import * as THREE from "three";
import CameraControls from "camera-controls";
import { createCameraModels } from "./cameraModels.js";
import { GameSystems } from "./gameSystems.js";
import { moveCharacter, createCapsuleController, capsuleSpawnClearance } from "./characterMotor.js";
import { createTransform } from "./components/transform.js";
import { createModelAttachments } from "./modelAttachments.js";
import { createFirstPersonCamera, firstPersonOptions } from "./firstPersonCamera.js";
import { createOwnedMaterial } from "./resources/renderer/ownedMaterial.js";
import { createEnvironment } from "./environment.js";
import { createSurfaceMaterials } from "./surfaceMaterials.js";
import { setBloom } from "./bloom.js";
import { getPresentationTransform, resetPresentationTransform } from "./presentationTransform.js";

/**
 * Create an independent browser game with rendering, fixed-step physics and input.
 * Distances are metres, time is seconds, +Y is up, and forward is -Z.
 * The returned entities expose their Three.js mesh and Rapier body for custom games.
 */
export async function createGame(options = {}) {
  const engine = new GameSystems();
  const updates = new Set();
  const frames = new Set();
  const players = new Set();
  const characters = new Set();
  const cameraVisuals = new Map();
  const followBounds = new THREE.Box3();
  const followSize = new THREE.Vector3();
  const followEye = new THREE.Vector3();
  const playerForward = new THREE.Vector3();
  const playerRight = new THREE.Vector3();
  const playerDirection = new THREE.Vector3();
  const playerRotation = new THREE.Quaternion();
  const worldUp = new THREE.Vector3(0, 1, 0);
  let follow = null;
  let firstPerson = null;
  let game;
  let models;
  let cameraModels;

  engine.registerSystem("game-player-controls", {
    dependencies: ["input", "physics", "camera"],
    priority: 30,
    update: (_world, { input, physics, camera }, dt) => {
      if (!players.size) return;
      camera.camera.getWorldDirection(playerForward);
      playerForward.y = 0;
      const hasCameraHeading = playerForward.lengthSq() >= 0.0001;
      if (!hasCameraHeading) playerForward.set(0, 0, -1);
      playerForward.normalize();
      playerRight.crossVectors(playerForward, camera.camera.up).normalize();
      for (const player of players) {
        if (!engine.world.has(player) || !player.player || !player.physicsBody?.controller) {
          players.delete(player);
          continue;
        }
        const control = player.player;
        const body = player.physicsBody.rigidBody;
        const collider = player.physicsBody.collider;
        const controller = player.physicsBody.controller;
        const movement = control.enabled ? input.getMovementVector() : { x: 0, z: 0 };
        const direction = playerDirection.set(movement.x, 0, movement.z);
        if (direction.lengthSq() > 1) direction.normalize();
        if (control.cameraRelative) {
          direction.copy(playerRight).multiplyScalar(movement.x).addScaledVector(playerForward, -movement.z);
          if (direction.lengthSq() > 1) direction.normalize();
        }
        const heading = control.facing === "camera" && hasCameraHeading ? playerForward
          : control.facing === "movement" && direction.lengthSq() > 0.0001 ? direction : null;
        if (control.enabled && heading) {
          // Physics owns the root pose. Rotate it so attached visuals inherit yaw
          // without losing their authored local model-orientation correction.
          playerRotation.setFromAxisAngle(worldUp, Math.atan2(-heading.x, -heading.z));
          body.setNextKinematicRotation(playerRotation);
        }
        const jumpDown = control.enabled && control.jumpSpeed > 0 && input.isActionActive("jump");
        const speed = control.enabled && input.isActionActive("run") ? control.runSpeed : control.speed;
        direction.multiplyScalar(speed);
        moveCharacter({ physics, body, collider, controller, state: control, velocity: direction, jumpDown, jumpSpeed: control.jumpSpeed }, dt);
      }
    },
  });
  engine.registerSystem("game-update", {
    priority: 48,
    update: (_world, _resources, dt) => {
      for (const callback of [...updates]) callback(dt, game);
    },
  });
  engine.registerSystem("game-scripted-characters", {
    dependencies: ["physics"],
    priority: 31,
    update: (_world, { physics }, dt) => {
      for (const entity of characters) {
        if (!engine.world.has(entity) || !entity.character || !entity.physicsBody?.controller) {
          characters.delete(entity);
          continue;
        }
        const motion = entity.character;
        const desired = motion.velocity;
        if (![desired.x, desired.y, desired.z].every(Number.isFinite)) {
          throw new Error("Character velocity must contain three finite numbers");
        }
        const { rigidBody: body, collider, controller } = entity.physicsBody;
        playerDirection.copy(desired).multiplyScalar(motion.enabled ? 1 : 0);
        moveCharacter({ physics, body, collider, controller, state: motion, velocity: playerDirection }, dt);
      }
    },
  });
  engine.registerSystem("game-camera-follow", {
    dependencies: ["camera"],
    phase: "frame",
    // Move the orbit center before the core's single camera-controls update.
    priority: 73,
    update: (_world, { camera }) => {
      if (!follow) return;
      if (!engine.world.has(follow.entity)) {
        releaseFollow();
        return;
      }
      const position = getPresentationTransform(follow.entity, engine.interpolationAlpha).position;
      const target = position.clone().add(follow.lookOffset);
      if (follow.mode === "fixed") {
        const eye = position.clone().add(follow.offset);
        camera.controls.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, false);
      } else {
        // Translation preserves the user's orbit angles and dolly distance.
        camera.controls.moveTo(target.x, target.y, target.z, false);
      }
    },
  });
  engine.registerSystem("game-frame", {
    phase: "frame",
    priority: 90,
    update: (_world, _resources, dt) => {
      for (const callback of [...frames]) callback(dt, game);
    },
  });
  engine.registerSystem("game-first-person-camera", {
    phase: "frame",
    priority: 85,
    update: () => firstPerson?.update(),
  });
  engine.registerSystem("game-model-animation", {
    phase: "frame",
    priority: 58,
    update: (_world, _resources, dt) => { models?.update(dt); cameraModels?.update(dt); },
  });
  engine.registerSystem("game-follow-visibility", {
    phase: "frame",
    // Test the actual collision-adjusted camera and the final animated visual.
    priority: 95,
    update: () => updateFollowVisibility(),
  });

  await engine.init({ ...options, autoStart: false });
  const rendererResource = engine.getResource("renderer");
  const { scene, renderer } = rendererResource;
  const environment = createEnvironment({ scene, renderer });
  engine.addResource("gameEnvironment", environment);
  const surfaceMaterials = createSurfaceMaterials({ renderer });
  engine.addResource("gameSurfaceMaterials", surfaceMaterials);
  const cameraResource = engine.getResource("camera");
  const { camera, controls, obstacles } = cameraResource;
  // Standalone disabled controls hand the pose to caller-owned FPS/cutscene
  // code. Follow still updates controls, including its mouse-disabled fixed mode.
  cameraResource.shouldUpdateControls = () => !firstPerson && (follow !== null || controls.enabled !== false);
  cameraResource.shouldUpdatePointerLock = () => !firstPerson;
  const physics = engine.getResource("physics");
  const input = engine.getResource("input");
  models = createModelAttachments({
    world: engine.world,
    assets: engine.getResource("assets"),
    registerCameraVisual: entity => game.registerCameraVisual(entity),
    isVisualHiddenByCamera: entity => firstPerson?.ownsHiddenVisual(entity) || cameraVisuals.get(entity)?.hiddenVisual?.mesh === entity.mesh,
  });
  engine.addResource("modelAttachments", models);
  cameraModels = createCameraModels({ camera, assets: engine.getResource("assets") });
  engine.addResource("cameraModels", cameraModels);
  engine.addResource("firstPersonCamera", { dispose: () => releaseFirstPerson() });

  function assertLive() {
    if (engine.disposed) throw new Error("This game is disposed. Create a new game before adding work.");
  }

  function assertEntity(entity) {
    assertLive();
    if (!engine.world.has(entity)) throw new Error("The entity is no longer in this game.");
  }

  function restoreCameraVisibility(entry) {
    if (!entry?.hiddenVisual) return;
    const { mesh, visible } = entry.hiddenVisual;
    mesh.visible = visible;
    entry.hiddenVisual = null;
  }

  function cameraVisualEntry(entity) {
    if (!cameraVisuals.has(entity)) cameraVisuals.set(entity, { entity, registrations: 0, hiddenVisual: null });
    return cameraVisuals.get(entity);
  }

  function updateFollowVisibility() {
    if (!follow) return;
    camera.getWorldPosition(followEye);
    for (const entry of cameraVisuals.values()) updateCameraVisual(entry);
  }

  function updateCameraVisual(entry) {
    const mesh = entry.entity.renderable?.mesh;
    if (entry.hiddenVisual?.mesh !== mesh) restoreCameraVisibility(entry);
    // A visual already hidden by its owner must stay hidden on release.
    if (!mesh || (!mesh.visible && !entry.hiddenVisual)) return;
    mesh.updateWorldMatrix(true, false);
    followBounds.setFromObject(mesh);
    if (followBounds.isEmpty()) { restoreCameraVisibility(entry); return; }
    followBounds.getSize(followSize);
    const margin = Math.max(camera.near * 2, Math.min(0.35, Math.min(followSize.x, followSize.y, followSize.z) * 0.25));
    // Collision is allowed to put the camera below its dolly minimum. Hide
    // only this visual, rather than moving the camera through the blocking wall.
    // A wider release threshold avoids flicker at the edge of the visual.
    const threshold = margin + (entry.hiddenVisual ? Math.max(0.05, margin * 0.5) : 0);
    if (followBounds.distanceToPoint(followEye) < threshold) {
      entry.hiddenVisual ??= { mesh, visible: mesh.visible };
      mesh.visible = false;
    } else restoreCameraVisibility(entry);
  }

  function releaseFollow() {
    if (!follow) return;
    for (const [entity, entry] of cameraVisuals) {
      restoreCameraVisibility(entry);
      if (!entry.registrations) cameraVisuals.delete(entity);
    }
    const { previousControls } = follow;
    controls.enabled = previousControls.enabled;
    controls.dollyToCursor = previousControls.dollyToCursor;
    controls.infinityDolly = previousControls.infinityDolly;
    Object.assign(controls.mouseButtons, previousControls.mouseButtons);
    Object.assign(controls.touches, previousControls.touches);
    follow = null;
    obstacles.setFollowTarget(null);
  }

  function releaseFirstPerson() {
    const previous = firstPerson;
    firstPerson = null;
    previous?.dispose();
  }

  const unsubscribeFollowRemoval = engine.world.onEntityRemoved.subscribe((entity) => {
    players.delete(entity);
    characters.delete(entity);
    restoreCameraVisibility(cameraVisuals.get(entity));
    cameraVisuals.delete(entity);
    if (follow?.entity === entity) releaseFollow();
    if (firstPerson?.entity === entity) releaseFirstPerson();
  });

  function controlledCapsule(config) {
    const spawnClearance = nonNegative(config.spawnClearance ??
      capsuleSpawnClearance(physics, engine.fixedTimeStep), "spawnClearance");
    const position = vector(config.position ?? [0, 2, 0]);
    position.y += spawnClearance;
    const entity = addShape("capsule", { ...config, position, body: "kinematic" });
    try {
      entity.physicsBody.controller = createCapsuleController(physics);
      return { entity, spawnClearance };
    } catch (error) {
      engine.world.remove(entity);
      throw error;
    }
  }

  function intersectEntities(ray, entities) {
    // Synchronize before queries between rendered frames or after teleports.
    const candidates = [...entities].filter(entity => engine.world.has(entity) && entity.mesh);
    const displayed = candidates.map(entity => ({ mesh: entity.mesh, position: entity.mesh.position.clone(), rotation: entity.mesh.quaternion.clone() }));
    let hit;
    try {
      for (const entity of candidates) {
        if (entity.transform) {
          entity.mesh.position.copy(entity.transform.position);
          entity.mesh.quaternion.copy(entity.transform.rotation);
        }
        entity.mesh.updateWorldMatrix(true, true);
      }
      hit = ray.intersectObjects(candidates.filter(entity => entity.mesh.visible).map(entity => entity.mesh), true)[0];
    } finally {
      for (const { mesh, position, rotation } of displayed) {
        mesh.position.copy(position); mesh.quaternion.copy(rotation);
        mesh.updateWorldMatrix(true, true);
      }
    }
    if (!hit) return null;
    const entity = candidates.find(candidate => {
      for (let object = hit.object; object; object = object.parent) {
        if (candidate.mesh === object) return true;
      }
      return false;
    });
    return { ...hit, entity };
  }

  function addShape(kind, config = {}) {
    assertLive();
    const size = vector(config.size ?? [1, 1, 1]);
    const position = vector(config.position ?? [0, 0, 0]);
    const radius = positive(config.radius ?? 0.5, "radius");
    const height = positive(config.height ?? 1, "height");
    const bodyType = config.body ?? "fixed";
    const friction = nonNegative(config.friction ?? 0.7, "friction");
    const restitution = nonNegative(config.restitution ?? 0, "restitution");
    if (!["fixed", "dynamic", "kinematic", "none"].includes(bodyType)) throw new Error(`Unknown body type: ${bodyType}`);
    if (kind === "box" && [size.x, size.y, size.z].some(value => !Number.isFinite(value) || value <= 0)) {
      throw new Error("Box size must contain three positive numbers");
    }
    let geometry;
    let material;
    let mesh;
    let entity;
    let rigidBody;
    try {
      geometry = kind === "box" ? new THREE.BoxGeometry(size.x, size.y, size.z)
        : kind === "sphere" ? new THREE.SphereGeometry(radius, 24, 16)
        : new THREE.CapsuleGeometry(radius, height, 4, 12);
      material = createOwnedMaterial(config.material, { color: config.color ?? 0x68b8ff, roughness: 0.7 });
      mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = config.castShadow ?? true;
      mesh.receiveShadow = config.receiveShadow ?? true;
      mesh.position.copy(position);
      entity = {
        name: config.name ?? kind,
        transform: createTransform(position),
        renderable: { mesh, needsMesh: false },
        mesh,
        data: config.data ?? {},
      };
      if (bodyType !== "none") {
        const { RAPIER, world } = physics;
        const description = bodyType === "dynamic" ? RAPIER.RigidBodyDesc.dynamic()
          : bodyType === "kinematic" ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed();
        description.setTranslation(position.x, position.y, position.z);
        rigidBody = world.createRigidBody(description);
        const shape = kind === "box" ? RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2)
          : kind === "sphere" ? RAPIER.ColliderDesc.ball(radius) : RAPIER.ColliderDesc.capsule(height / 2, radius);
        shape.setFriction(friction).setRestitution(restitution);
        if (config.sensor) shape.setSensor(true);
        shape.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
        if (config.sensor) shape.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED | RAPIER.ActiveCollisionTypes.KINEMATIC_KINEMATIC);
        const collider = world.createCollider(shape, rigidBody);
        collider.userData = { entity };
        entity.physicsBody = { rigidBody, collider };
        entity.body = rigidBody;
      }
      scene.add(mesh);
      engine.world.add(entity);
      if (bodyType === "fixed" && !config.sensor && config.cameraCollision !== false) {
        obstacles.register(mesh, { owner: entity, primitive: true });
      }
      return entity;
    } catch (error) {
      // Roll back partial creation, including failures after allocating a body.
      if (entity && engine.world.has(entity)) engine.world.remove(entity);
      else {
        mesh?.removeFromParent();
        geometry?.dispose();
        material?.dispose();
        if (rigidBody?.isValid()) physics.world.removeRigidBody(rigidBody);
      }
      throw error;
    }
  }

  game = {
    engine, scene, renderer, camera, controls, physics, input,
    defaultLights: engine.getResource("lighting"),
    world: engine.world,
    addBox: config => addShape("box", config),
    addSphere: config => addShape("sphere", config),
    /** Add a disposable model appearance without changing this entity's collider. */
    attachModel: (entity, url, config) => models.attachModel(entity, url, config),
    attachCameraModel: (url, config) => cameraModels.attach(url, config),
    addPlayer(config = {}) {
      assertLive();
      const speed = positive(config.speed ?? 5, "speed");
      const runSpeed = positive(config.runSpeed ?? 8, "runSpeed");
      const jumpSpeed = nonNegative(config.jumpSpeed ?? 7, "jumpSpeed");
      const facing = config.facing ?? "camera";
      if (!["camera", "movement", "manual"].includes(facing)) throw new Error("Player facing must be 'camera', 'movement', or 'manual'.");
      const { entity, spawnClearance } = controlledCapsule(config);
      entity.player = {
        speed, runSpeed, jumpSpeed, spawnClearance, facing,
        cameraRelative: config.cameraRelative ?? true,
        enabled: true, grounded: false, verticalVelocity: 0, jumpHeld: false,
      };
      players.add(entity);
      return entity;
    },
    /** Input-free scripted capsule. Set world-space velocity (metres/second); gravity and walls remain engine-owned. */
    addCharacter(config = {}) {
      assertLive();
      const velocity = vector(config.velocity ?? [0, 0, 0]);
      const { entity, spawnClearance } = controlledCapsule(config);
      entity.character = { velocity, spawnClearance, enabled: true, grounded: false, verticalVelocity: 0 };
      characters.add(entity);
      return entity;
    },
    /** Follow with mouse orbit/zoom; mode:"fixed" locks the configured world offset. */
    followCamera(entity, { offset = [0, 6, 9], lookOffset = [0, 0.5, 0], mode = "orbit" } = {}) {
      assertEntity(entity);
      if (mode !== "orbit" && mode !== "fixed") throw new Error("Camera follow mode must be 'orbit' or 'fixed'.");
      const next = { entity, offset: vector(offset), lookOffset: vector(lookOffset), mode };
      // Switching targets/modes restores the original configuration before
      // capturing it again, so a later release never restores follow bindings.
      releaseFollow();
      releaseFirstPerson();
      next.previousControls = {
        enabled: controls.enabled,
        dollyToCursor: controls.dollyToCursor,
        infinityDolly: controls.infinityDolly,
        mouseButtons: { ...controls.mouseButtons },
        touches: { ...controls.touches },
      };
      follow = next;
      cameraVisualEntry(entity);
      obstacles.setFollowTarget(entity);
      controls.enabled = mode === "orbit";
      if (mode === "orbit") {
        const { ACTION } = CameraControls;
        Object.assign(controls.mouseButtons, { left: ACTION.ROTATE, middle: ACTION.DOLLY, right: ACTION.ROTATE, wheel: ACTION.DOLLY });
        Object.assign(controls.touches, { one: ACTION.TOUCH_ROTATE, two: ACTION.TOUCH_DOLLY_ROTATE, three: ACTION.TOUCH_ROTATE });
        // Follow owns the target. Zoom must not pan it away from the player.
        controls.dollyToCursor = false;
        controls.infinityDolly = false;
      }
      const position = entity.transform.position;
      const eye = position.clone().add(next.offset);
      const target = position.clone().add(next.lookOffset);
      controls.setLookAt(eye.x, eye.y, eye.z, target.x, target.y, target.z, false);
      controls.update(0);
    },
    releaseCamera() {
      assertLive();
      releaseFollow();
      releaseFirstPerson();
    },
    /** Scoped first-person eye/look/lock; gate game rules on the returned .active. */
    firstPerson(entity, options = {}) {
      assertEntity(entity);
      const config = firstPersonOptions(options);
      releaseFollow();
      releaseFirstPerson();
      firstPerson = createFirstPersonCamera({
        entity, camera, controls, canvas: renderer.domElement, input, world: engine.world,
        getPosition: () => getPresentationTransform(entity, engine.interpolationAlpha).position,
        onDispose(controller) { if (firstPerson === controller) firstPerson = null; },
      }, config);
      return firstPerson;
    },
    /** Camera-only static scenery. Returns an idempotent unregister callback. */
    addCameraObstacle(mesh) {
      assertLive();
      return obstacles.register(mesh);
    },
    /** Opt an actor visual into near-camera hiding during follow. Returns unregister. */
    registerCameraVisual(entity) {
      assertEntity(entity);
      const entry = cameraVisualEntry(entity);
      entry.registrations++;
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        if (cameraVisuals.get(entity) !== entry) return;
        if (--entry.registrations) return;
        restoreCameraVisibility(entry);
        if (follow?.entity !== entity) cameraVisuals.delete(entity);
      };
    },
    /** Register fixed-step gameplay after physics. Returns an unsubscribe callback. */
    onUpdate(callback) {
      assertLive();
      if (typeof callback !== "function") throw new TypeError("onUpdate requires a function");
      updates.add(callback);
      return () => updates.delete(callback);
    },
    /** Presentation after built-in camera updates; suitable for a custom FPS camera. */
    onFrame(callback) {
      assertLive();
      if (typeof callback !== "function") throw new TypeError("onFrame requires a function");
      frames.add(callback);
      return () => frames.delete(callback);
    },
    /** Move through Rapier so the next simulation cannot overwrite the requested position. */
    teleport(entity, position) {
      assertEntity(entity);
      const next = vector(position);
      const motion = entity.player ?? entity.character;
      if (motion) next.y += motion.spawnClearance;
      if (entity.body) {
        entity.body.setTranslation(next, true);
        if (entity.body.isKinematic()) entity.body.setNextKinematicTranslation(next);
        entity.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      }
      entity.transform.position.copy(next);
      resetPresentationTransform(entity);
      entity.mesh.position.copy(next);
      if (motion) {
        motion.verticalVelocity = 0;
        motion.grounded = false;
        if (entity.character) motion.velocity.set(0, 0, 0);
      }
    },
    remove(entity) {
      assertLive();
      players.delete(entity);
      if (follow?.entity === entity) game.releaseCamera();
      engine.world.remove(entity);
    },
    /** Raycast visible entities from normalized screen coordinates (-1..1); center defaults to the crosshair. */
    raycast({ x = 0, y = 0, entities = [...engine.world], maxDistance = Infinity } = {}) {
      assertLive();
      if (!Number.isFinite(x) || !Number.isFinite(y) || !(maxDistance > 0)) throw new Error("Raycast requires finite screen coordinates and a positive maxDistance.");
      camera.updateWorldMatrix(true, false);
      const ray = new THREE.Raycaster();
      ray.far = maxDistance;
      ray.setFromCamera(new THREE.Vector2(x, y), camera);
      return intersectEntities(ray, entities);
    },
    /** World-space segment query independent of the camera; choose blockers explicitly for line of sight. */
    raycastBetween(from, to, { entities = [...engine.world] } = {}) {
      assertLive();
      const origin = vector(from), direction = vector(to).sub(origin);
      const distance = direction.length();
      if (distance === 0) return null;
      return intersectEntities(new THREE.Raycaster(origin, direction.divideScalar(distance), 0, distance), entities);
    },
    start: () => engine.start(),
    stop: () => engine.stop(),
    /** Replaces owned panorama art and optional environment lighting. */
    setEnvironment(url, options) { assertLive(); return environment.set(url, options); },
    clearEnvironment() { assertLive(); environment.clear(); },
    /** Load an owned, repeating base-color material for walls, floors and other surfaces. */
    loadMaterial(url, options) { assertLive(); return surfaceMaterials.load(url, options); },
    /** One final render owner; set null to restore direct rendering. */
    setRenderPipeline(pipeline) { assertLive(); rendererResource.pipeline.set(pipeline); },
    /** Optional bloom and ACES tone mapping; no second animation loop. */
    setBloom(options) { assertLive(); return setBloom(rendererResource, camera, options); },
    dispose() {
      updates.clear();
      frames.clear();
      players.clear();
      characters.clear();
      releaseFollow();
      releaseFirstPerson();
      cameraVisuals.clear();
      unsubscribeFollowRemoval();
      engine.dispose();
    },
    getDiagnostics: () => engine.getDiagnostics(),
  };
  if (options.autoStart !== false) {
    try { engine.start(); }
    catch (error) { game.dispose(); throw error; }
  }
  return game;
}

function vector(value) {
  const result = Array.isArray(value) ? new THREE.Vector3(...value) : new THREE.Vector3(value.x, value.y, value.z);
  if (![result.x, result.y, result.z].every(Number.isFinite)) throw new Error("Position/vector must contain three finite numbers");
  return result;
}

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

function nonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}
