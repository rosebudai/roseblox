/**
 * PLAYER SETUP
 * Defines the player entity and physics.
 */
import * as THREE from "three";
import { CoreComponents } from "roseblox-game-engine";
import { GAME_CONFIG } from "../../core/config.js";

const {
  createCameraDirection,
  createTransform,
  createMovementState,
  createGLTFRenderable,
  createStateMachine,
  createRenderableMetadata,
  createTriggerDetector,
} = CoreComponents;

// Player state machine
const playerStateMachineDefinition = {
  initial: "idle",
  states: {
    idle: {
      animation: "Idle",
      transitions: [
        {
          to: "airborne",
          when: { property: "grounded", is: "===", than: false },
        },
        { to: "run", when: { property: "speed", is: ">", than: 4.0 } },
        { to: "walk", when: { property: "speed", is: ">", than: 0.5 } },
      ],
    },
    walk: {
      animation: "Walk",
      transitions: [
        {
          to: "airborne",
          when: { property: "grounded", is: "===", than: false },
        },
        { to: "run", when: { property: "speed", is: ">", than: 4.0 } },
        { to: "idle", when: { property: "speed", is: "<", than: 0.5 } },
      ],
    },
    run: {
      animation: "Run",
      transitions: [
        {
          to: "airborne",
          when: { property: "grounded", is: "===", than: false },
        },
        { to: "walk", when: { property: "speed", is: "<", than: 4.0 } },
      ],
    },
    airborne: {
      animation: "Idle",
      transitions: [
        { to: "idle", when: { property: "grounded", is: "===", than: true } },
      ],
    },
  },
};

// Player physics factory
function gamePlayerBodyFactory(entity, { physicsWorld, RAPIER }) {
  const { position } = entity.transform;
  const cfg = GAME_CONFIG;

  const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
    position.x,
    position.y,
    position.z
  );
  const rigidBody = physicsWorld.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.capsule(
    cfg.PLAYER.CAPSULE_HEIGHT / 2,
    cfg.PLAYER.CAPSULE_RADIUS
  ).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  const collider = physicsWorld.createCollider(colliderDesc, rigidBody);

  const controller = physicsWorld.createCharacterController(
    cfg.PHYSICS.CHARACTER_CONTROLLER_OFFSET
  );
  controller.enableAutostep(
    cfg.PHYSICS.AUTO_STEP_HEIGHT,
    cfg.PHYSICS.AUTO_STEP_MIN_WIDTH,
    true
  );
  controller.enableSnapToGround(cfg.PHYSICS.SNAP_TO_GROUND_DISTANCE);
  controller.setMaxSlopeClimbAngle(
    (cfg.PHYSICS.MAX_SLOPE_CLIMB_ANGLE * Math.PI) / 180
  );
  controller.setMinSlopeSlideAngle(
    (cfg.PHYSICS.MIN_SLOPE_SLIDE_ANGLE * Math.PI) / 180
  );
  controller.setApplyImpulsesToDynamicBodies(true);

  return { rigidBody, collider, controller };
}

export function setupGamePlayer(world, { physics, terrain }) {
  physics.registerBodyFactory("isPlayer", gamePlayerBodyFactory);

  const spawnPos = GAME_CONFIG.PLAYER.SPAWN_POSITION;
  const terrainHeight =
    terrain?.getTerrainHeightAt(spawnPos.x, spawnPos.z) || 0;
  const spawnY =
    terrainHeight +
    GAME_CONFIG.PLAYER.CAPSULE_HEIGHT +
    GAME_CONFIG.PLAYER.SPAWN_HEIGHT_OFFSET;

  const playerEntity = world.add({
    // Tags
    isPlayer: true,
    isInputControlled: true,
    isCameraFollowTarget: { offset: { x: 0, y: 1, z: 0 } },

    // Components
    score: { value: 0 },
    transform: createTransform(
      new THREE.Vector3(spawnPos.x, spawnY, spawnPos.z)
    ),
    triggerDetector: createTriggerDetector(
      GAME_CONFIG.PLAYER.CAPSULE_RADIUS + 0.5
    ),
    renderable: createGLTFRenderable(GAME_CONFIG.PLAYER.CHARACTER_MODEL, {
      type: "gltf",
      scale:
        GAME_CONFIG.ASSETS.SCALING[GAME_CONFIG.PLAYER.CHARACTER_MODEL].scale,
      position: {
        x: 0,
        y: GAME_CONFIG.ASSETS.SCALING[GAME_CONFIG.PLAYER.CHARACTER_MODEL]
          .offsetY,
        z: 0,
      },
      rotation: { x: 0, y: 0, z: 0 },
      castShadow: true,
      receiveShadow: true,
    }),
    characterController: {
      speed: GAME_CONFIG.PLAYER.WALK_SPEED,
      runSpeed: GAME_CONFIG.PLAYER.RUN_SPEED,
      jumpStrength: GAME_CONFIG.PLAYER.JUMP_STRENGTH,
    },
    inputMovement: { x: 0, z: 0 },
    inputActions: { jump: false, run: false },
    cameraDirection: createCameraDirection(
      new THREE.Vector3(0.707, 0, 0.707).normalize(),
      new THREE.Vector3(0.707, 0, -0.707).normalize()
    ),
    movementState: createMovementState(),
    stateMachine: createStateMachine(playerStateMachineDefinition),
  });

  // Create player aura - commented out but kept as example
  // world.add({
  //   isAura: true,
  //   parent: playerEntity,
  //   transform: createTransform(),
  //   renderable: createRenderableMetadata(
  //     "procedural",
  //     { type: "sphere", radius: 1.5, segments: 16 }, // A sphere geometry
  //     {
  //       type: "standard",
  //       color: 0x00ffff, // cyan
  //       transparent: true,
  //       opacity: 0.2,
  //       emissive: 0x00ffff, // Emissive color for glow
  //       emissiveIntensity: 2.5,
  //       depthWrite: false, // Important for transparency
  //     }
  //   ),
  // });
}
