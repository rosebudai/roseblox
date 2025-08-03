export const GAME_CONFIG = {
  DEBUG: false,

  PLAYER: {
    WALK_SPEED: 5.0,
    RUN_SPEED: 8.0,
    JUMP_STRENGTH: 7.0,
    CAPSULE_RADIUS: 0.5,
    CAPSULE_HEIGHT: 1.5,
    SPAWN_POSITION: { x: -24, y: 4, z: -6 },
    SPAWN_HEIGHT_OFFSET: 5.0,
    CHARACTER_MODEL: "characters/female-adventurer", // Player character model key
  },

  COLLECTIBLES: {
    RADIUS: 0.5,
    HEIGHT_OFFSET: 1.0,
  },

  CAMERA: {
    MIN_DISTANCE: 1,
    MAX_DISTANCE: 20,
    INITIAL_DISTANCE: 6,
    INITIAL_HEIGHT: 5,
    DAMPING_FACTOR: 0.05,
    LOOK_HEIGHT_OFFSET: 1,
    SMOOTH_TIME: 0,
    INITIAL_OFFSET: { x: -3, y: 0.5, z: -3 }, // Low angle for dramatic shot
    LOOK_OFFSET: { x: 0, y: 2.5, z: 0 },
    POINTER_LOCK: {
      ENABLED: true,
      TRIGGER: "click",
      RELEASE: "esc",
    },
    MOUSE_SENSITIVITY: {
      LOOK: 1.0,
      ZOOM: 1.0,
    },
  },

  PHYSICS: {
    GRAVITY: { x: 0.0, y: -9.81, z: 0.0 },
    CHARACTER_CONTROLLER_OFFSET: 0.05,
    AUTO_STEP_HEIGHT: 0.5,
    AUTO_STEP_MIN_WIDTH: 0.1,
    SNAP_TO_GROUND_DISTANCE: 0.8,
    MAX_SLOPE_CLIMB_ANGLE: 45, // degrees
    MIN_SLOPE_SLIDE_ANGLE: 30, // degrees
  },

  NATURAL_TERRAIN: {
    WIDTH: 200,
    DEPTH: 200,
    SCALE: 2.5,
    HEIGHT_SCALE: 12.0,
    // Noise
    NOISE_SCALE: 0.015,
    NOISE_OCTAVES: 3,
    HEIGHT_VARIATION: 0.4,
    // Mountains
    MOUNTAIN_COUNT: 3,
    MOUNTAIN_HEIGHT: 20,
    MOUNTAIN_RADIUS: 35,
    MOUNTAIN_JAGGEDNESS: 0.5,
    // Textures
    TEXTURES: {
      GROUND: {
        COLOR: "assets/ground-color.jpg",
        NORMAL: "assets/ground-normal.jpg",
        ROUGHNESS: "assets/ground-roughness.jpg",
        REPEAT: 45,
      },
      ROCK: {
        COLOR: "assets/rock-color.jpg",
        NORMAL: "assets/rock-normal.jpg",
        ROUGHNESS: "assets/rock-roughness.jpg",
        REPEAT: 22,
      },
    },
  },

  RENDERER: {
    ANTIALIAS: true,
  },

  LIGHTING: {
    AMBIENT_COLOR: 0x4466aa, // Night blue
    AMBIENT_INTENSITY: 0.15,
    DIRECTIONAL_COLOR: 0x6688ff, // Moonlight
    DIRECTIONAL_INTENSITY: 0.3,
    DIRECTIONAL_POSITION: { x: 50, y: 100, z: 50 },
  },

  SHADOWS: {
    ENABLED: true,
    MAP_SIZE: 2048,
    CAMERA_SIZE: 100,
    CAMERA_NEAR: 0.5,
    CAMERA_FAR: 500,
    SOFT_SHADOWS: true,
  },

  SCENE: {
    BACKGROUND_COLOR: 0x87ceeb,
    FOV: 75,
    NEAR: 0.1,
    FAR: 2000,
  },

  SKYBOX: {
    path: "assets/sky-night.jpg",
  },

  assets: [
    {
      key: "characters/female-adventurer",
      url: "assets/female-adventurer.gltf",
    },
  ],
  PRELOAD: ["characters/female-adventurer"],

  ASSETS: {
    SCALING: {
      "characters/female-adventurer": {
        scale: 1.5,
        offsetY: -1.3,
      },
    },
  },
};

export default GAME_CONFIG;
