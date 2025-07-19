// Game configuration constants
export const GAME_CONFIG = {
  DEBUG: true,
  // Player movement settings
  PLAYER: {
    WALK_SPEED: 5.0,
    RUN_SPEED: 8.0,
    JUMP_STRENGTH: 7.0,
    CAPSULE_RADIUS: 0.5,
    CAPSULE_HEIGHT: 1.5,
    SPAWN_POSITION: { x: -24, y: 4, z: -6 },
    SPAWN_HEIGHT_OFFSET: 5.0,
  },

  // Collectible settings
  COLLECTIBLES: {
    RADIUS: 0.5,
    HEIGHT_OFFSET: 1.0,
  },

  // Camera settings
  CAMERA: {
    MIN_DISTANCE: 1,
    MAX_DISTANCE: 15,
    INITIAL_DISTANCE: 8,
    INITIAL_HEIGHT: 5,
    DAMPING_FACTOR: 0.05,
    LOOK_HEIGHT_OFFSET: 1, // How high above player to look
    SMOOTH_TIME: 0,
    INITIAL_OFFSET: { x: 0, y: 5, z: 8 },
    LOOK_OFFSET: { x: 0, y: 1, z: 0 },
    POINTER_LOCK: {
      ENABLED: true,
      TRIGGER: "click", // "click" | "keydown" | "manual"
      RELEASE: "esc", // "esc" | "keyup" | "manual"
    },
    MOUSE_SENSITIVITY: {
      LOOK: 1.0, // Mouse look sensitivity (rotation)
      ZOOM: 1.0, // Mouse-wheel zoom sensitivity
    },
  },

  // Physics settings
  PHYSICS: {
    GRAVITY: { x: 0.0, y: -9.81, z: 0.0 },
    CHARACTER_CONTROLLER_OFFSET: 0.1,
    AUTO_STEP_HEIGHT: 0.5,
    AUTO_STEP_MIN_WIDTH: 0.1,
    SNAP_TO_GROUND_DISTANCE: 0.5,
    MAX_SLOPE_CLIMB_ANGLE: 45, // degrees
    MIN_SLOPE_SLIDE_ANGLE: 30, // degrees
  },

  // Terrain settings
  TERRAIN: {
    // Voxel world dimensions
    BLOCK_SIZE: 2,
    WIDTH: 50,
    DEPTH: 50,
    MAX_HEIGHT: 8,
    // Block types and visual properties
    BLOCK_TYPES: {
      AIR: 0,
      DIRT: 1,
      GRASS: 2,
      STONE: 3,
      SAND: 4,
      GRAVEL: 5,
      WATER: 6,
    },
    BLOCK_COLORS: {
      1: 0x8b4513, // Brown - dirt
      2: 0x4ecdc4, // Green - grass
      3: 0x696969, // Gray - stone
      4: 0xc2b280, // Sandy brown - sand
      5: 0x778899, // Light slate gray - gravel
      6: 0x1e90ff, // Dodger blue - water
    },
    ROUGHNESS: 0.8,
    METALNESS: 0.1,
    // Procedural generation parameters
    HEIGHT_SCALE: 0.3,
    NOISE_SCALE: 0.05,
    NOISE_OCTAVES: 3,
    NOISE_PERSISTENCE: 0.3,
    NOISE_LACUNARITY: 1.8,
    NOISE_SEED: 12345,
    NOISE_AMPLITUDE: 0.8,
    WATER_LEVEL: 1,
  },

  // Rendering settings
  RENDERER: {
    ANTIALIAS: true,
  },

  // Lighting settings
  LIGHTING: {
    AMBIENT_COLOR: 0xffffff,
    AMBIENT_INTENSITY: 0.4,
    DIRECTIONAL_COLOR: 0xffffff,
    DIRECTIONAL_INTENSITY: 0.8,
    DIRECTIONAL_POSITION: { x: 50, y: 100, z: 50 },
  },

  // Shadow settings (shared between renderer and lighting)
  SHADOWS: {
    ENABLED: true,
    MAP_SIZE: 2048,
    CAMERA_SIZE: 100,
    CAMERA_NEAR: 0.5,
    CAMERA_FAR: 500,
    SOFT_SHADOWS: true,
  },

  // Scene settings
  SCENE: {
    BACKGROUND_COLOR: 0x87ceeb,
    FOV: 75,
    NEAR: 0.1,
    FAR: 2000,
  },

  // Asset management
  assets: [{ key: "characters/male-farmer", url: "assets/male-farmer.gltf" }],

  // Preload these assets on startup
  // PRELOAD: ["characters/male-farmer"],

  // Asset scaling configuration (Unity/Unreal-style import settings)
  ASSETS: {
    SCALING: {
      // Character assets - manual configuration like Unity import settings
      "characters/male-farmer": {
        scale: 1.5, // Manual scale multiplier (like Unity's Scale Factor)
        offsetY: -1.3, // Manual Y offset to align feet (like Unity's position offset)
        importNotes: "Farmer model - adjust scale/offsetY if needed",
      },
    },
  },
};

export default GAME_CONFIG;
