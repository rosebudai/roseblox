/**
 * @module Engine
 * @description
 * The central orchestrator of the Rosebud game engine.
 *
 * This class manages the entire lifecycle of the game, including the Entity-Component-System (ECS) world,
 * shared resources (like the renderer and physics engine), and the execution of game logic through setup and runtime systems.
 * It follows a pattern common in modern game engines where the engine's flow is divided into distinct phases:
 *
 * 1.  **Registration**: Game-specific setup and runtime systems are registered with the engine before initialization.
 * 2.  **Initialization (`init`)**: The engine initializes core resources (renderer, physics, etc.), runs all registered setup systems in dependency order, and starts the game loop.
 * 3.  **Update Loop**: On every frame, all runtime systems are executed in a deterministic order based on their registered priority.
 *
 * The `GameSystems` class also provides a simple event bus for decoupled communication between different parts of the engine and game logic.
 *
 * @example
 * // In your main game file:
 * import { engine } from "roseblox-game-engine";
 *
 * // Register a custom system that runs every frame
 * engine.registerSystem("my-game-logic", {
 *   update: (world, dependencies, deltaTime) => {
 *     console.log(`Frame delta: ${deltaTime}`);
 *   },
 *   priority: 50
 * });
 *
 * // Initialize and start the engine
 * await engine.init({ canvas: myCanvasElement });
 */

import { World } from "miniplex";
import * as THREE from "three";

// Core Engine Resource Setups
import { setupRenderer } from "./resources/renderer/rendererSetup.js";
import { setupPhysics } from "./resources/physics/physicsSetup.js";
import { setupAssetManager } from "./resources/assetManager.js";
import { setupInput } from "./resources/inputSetup.js";
import { setupLighting } from "./resources/lightingSetup.js";
import { setupCamera } from "./resources/cameraSetup.js";

// Core Engine Runtime Systems
import { inputSystem } from "./systems/inputSystem.js";
import { cameraInputSystem } from "./systems/cameraInputSystem.js";
import { pointerLockSystem } from "./systems/pointerLockSystem.js";
import { componentMovementSystem } from "./systems/componentMovementSystem.js";
import { stepPhysics } from "./systems/stepPhysicsSystem.js";
import { physicsStateSyncSystem } from "./systems/physicsStateSyncSystem.js";
import { sceneManagementSystem } from "./systems/sceneManagementSystem.js";
import { animationSetupSystem } from "./systems/animationSetupSystem.js";
import { animationSystem } from "./systems/animationSystem.js";
import { transformSyncSystem } from "./systems/transformSyncSystem.js";
import { cameraUpdateSystem } from "./systems/cameraUpdateSystem.js";
import { physicsBodySetupSystem } from "./systems/physicsBodySetupSystem.js";
import { parentingSystem } from "./systems/parentingSystem.js";
import { debugRenderSystem } from "./systems/debugRenderSystem.js";
import { collisionSystem } from "./systems/collisionSystem.js";
import { characterControllerCollisionSystem } from "./systems/characterControllerCollisionSystem.js";
import { physicsCameraCollisionSystem } from "./systems/physicsCameraCollisionSystem.js";
import { triggerDetectionSystem } from "./systems/triggerDetectionSystem.js";

/**
 * @class GameSystems
 * @memberof module:Engine
 * @description The main engine class that orchestrates the game lifecycle.
 */
export class GameSystems {
  constructor() {
    // Single ECS world - all entities live here
    this.world = new World();

    // Shared resources (singletons) - Physics, Renderer, etc.
    this.resources = new Map();

    // Systems that run once during initialization
    this.setupSystems = [];

    // Systems that run every frame in priority order
    this.runtimeSystems = [];

    // Initialization state
    this.initialized = false;

    // Event bus for pub/sub
    this.eventListeners = new Map();

    this.clock = new THREE.Clock();
  }

  /**
   * Register a shared resource (singleton service) that can be injected into systems.
   * @param {string} name - A unique name for the resource (e.g., 'renderer', 'physics').
   * @param {function(object): Promise<object>|object} factory - A function that creates the resource instance. It receives the game config object. Can be async.
   * @throws {Error} If called after the engine has been initialized.
   */
  registerResource(name, factory) {
    if (this.initialized) {
      throw new Error(
        `Cannot register resource '${name}' after initialization`
      );
    }
    this.resources.set(name, { factory, instance: null });
  }

  /**
   * Registers a setup system.
   * Setup systems run once during engine initialization and are used for creating
   * initial entities, registering component-specific factories, and other one-time setup tasks.
   * They are executed in an order determined by their dependencies.
   *
   * @param {string} name - A unique name for the setup system.
   * @param {object} config - The configuration for the setup system.
   * @param {function(World, object<string, any>, object, GameSystems): Promise<void>|void} config.init - The function to execute.
   *   It receives the ECS `world`, a `dependencies` object containing the requested resource instances, the global `gameConfig` object,
   *   and the `engine` instance itself. This function can be async.
   * @param {string[]} [config.dependencies=[]] - An array of resource names this system needs (e.g., ['renderer', 'physics']). The system will not run until these resources are available.
   * @throws {Error} If called after the engine has been initialized.
   *
   * @example
   * engine.registerSetup("create-player", {
   *   dependencies: ["physics"],
   *   init: (world, { physics }, config, engine) => {
   *     // logic to create the player entity and its physics body
   *     // You can also call engine.addResource() here if needed
   *   }
   * });
   */
  registerSetup(name, { init, dependencies = [] }) {
    if (this.initialized) {
      throw new Error(
        `Cannot register setup system '${name}' after initialization`
      );
    }
    this.setupSystems.push({
      name,
      init,
      dependencies,
    });
  }

  /**
   * Registers a runtime system.
   * Runtime systems are executed every frame in a specific order defined by their priority.
   * They contain the core game logic that reads and writes component data.
   *
   * @param {string} name - A unique name for the runtime system.
   * @param {object} config - The configuration for the runtime system.
   * @param {function(World, object<string, any>, number): void} config.update - The function to execute every frame.
   *   It receives the ECS `world`, a `dependencies` object containing requested resource instances, and the `deltaTime` since the last frame.
   * @param {string[]} [config.dependencies=[]] - An array of resource names this system needs. These resources will be passed in the `dependencies` object.
   * @param {number} [config.priority=0] - The execution priority. Lower numbers run first.
   * @throws {Error} If called after the engine has been initialized.
   *
   * @example
   * engine.registerSystem("player-input", {
   *   dependencies: ["input"],
   *   update: (world, { input }, deltaTime) => {
   *     // logic to read input and update player components
   *   },
   *   priority: 10
   * });
   */
  registerSystem(name, { update, dependencies = [], priority = 0 }) {
    if (this.initialized) {
      throw new Error(
        `Cannot register runtime system '${name}' after initialization`
      );
    }
    this.runtimeSystems.push({
      name,
      update,
      dependencies,
      priority,
    });

    // Keep runtime systems sorted by priority
    this.runtimeSystems.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Initializes all core resources, runs all registered setup systems, and starts the game loop.
   * This method must be called after all game-specific systems have been registered.
   *
   * @param {object} [gameConfig={}] - A configuration object that is passed to all resource factories and setup systems.
   * @param {HTMLCanvasElement} gameConfig.canvas - The canvas element for rendering.
   * @param {boolean} [gameConfig.DEBUG=false] - If true, enables debug features like the physics wireframe renderer.
   * @returns {Promise<void>} A promise that resolves when initialization is complete and the game loop has started.
   * @throws {Error} If the engine is already initialized or if any part of the setup fails.
   */
  async init(gameConfig = {}) {
    if (this.initialized) {
      throw new Error("GameSystems already initialized");
    }
    this.gameConfig = gameConfig;

    // This is the key change: The engine now registers its own core systems.
    this._registerCoreSystems();

    // Conditionally register optional, built-in systems based on config
    if (gameConfig.DEBUG) {
      this.registerSystem("debug-renderer", {
        update: debugRenderSystem,
        dependencies: ["physics", "renderer"],
        priority: 999, // Run last
      });
    }

    try {
      // Phase 1: Initialize all resources, passing the game config to their factories
      for (const [name, resource] of this.resources) {
        if (resource.factory) {
          resource.instance = await resource.factory(gameConfig);
        }
      }

      // Phase 2: Run setup systems in dependency order
      const completed = new Set();
      const inProgress = new Set();

      for (const setup of this.setupSystems) {
        await this._runSetupSystem(setup, completed, inProgress, gameConfig);
      }

      this.initialized = true;
      this.start(); // Start the animation loop
    } catch (error) {
      console.error("❌ GameSystems initialization failed:", error);
      throw error;
    }
  }

  /**
   * Kicks off and maintains the game loop.
   * @private
   * @internal
   */
  start() {
    const animate = () => {
      const deltaTime = this.clock.getDelta();
      this.update(deltaTime);
      requestAnimationFrame(animate);
    };
    animate();
  }

  /**
   * Run setup system with dependency resolution
   * @private
   * @internal
   */
  async _runSetupSystem(setup, completed, inProgress, gameConfig) {
    if (completed.has(setup.name)) {
      return;
    }

    if (inProgress.has(setup.name)) {
      throw new Error(
        `Circular dependency detected in setup system: ${setup.name}`
      );
    }

    // Check if dependencies are satisfied
    for (const depName of setup.dependencies) {
      if (!this.resources.has(depName)) {
        throw new Error(
          `Setup system '${setup.name}' requires unknown resource: ${depName}`
        );
      }
    }

    inProgress.add(setup.name);

    try {
      // Gather dependencies
      const deps = this._getDependencies(setup.dependencies);

      // Run setup system, passing the game config and engine instance
      await setup.init(this.world, deps, gameConfig, this);

      completed.add(setup.name);
      inProgress.delete(setup.name);
    } catch (error) {
      inProgress.delete(setup.name);
      throw new Error(`Setup system '${setup.name}' failed: ${error.message}`);
    }
  }

  /**
   * Update all runtime systems (call every frame)
   * @param {number} deltaTime - Frame delta time in seconds
   */
  update(deltaTime) {
    if (!this.initialized) {
      throw new Error("GameSystems not initialized. Call init() first.");
    }

    // Run all runtime systems in priority order
    for (const system of this.runtimeSystems) {
      try {
        // Gather dependencies for this system
        const deps = this._getDependencies(system.dependencies);

        // Run system update
        system.update(this.world, deps, deltaTime);
      } catch (error) {
        console.error(`Runtime system '${system.name}' failed:`, error);
        // Continue with other systems rather than crashing
      }
    }

    // After all systems have run, perform the final render
    this.render();
  }

  /**
   * Performs the final render of the scene.
   * @private
   * @internal
   */
  render() {
    const renderer = this.getResource("renderer");
    const camera = this.getResource("camera");
    if (renderer && camera) {
      renderer.renderer.render(renderer.scene, camera.camera);
    }
  }

  /**
   * Retrieves an initialized shared resource instance by name.
   * This is the primary way for systems or external game logic to access shared engine services like the renderer, physics world, or input manager.
   *
   * @param {string} name - The name of the resource to retrieve (e.g., 'renderer', 'physics', 'eventBus').
   * @returns {object} The resource instance.
   * @throws {Error} If the resource is not found or has not been initialized yet.
   *
   * @example
   * const physicsWorld = engine.getResource("physics").world;
   * const scene = engine.getResource("renderer").scene;
   */
  getResource(name) {
    const resource = this.resources.get(name);
    if (!resource || !resource.instance) {
      throw new Error(`Resource '${name}' not available`);
    }
    return resource.instance;
  }

  /**
   * Returns the central Miniplex ECS world instance.
   * @returns {World} The ECS world.
   */
  getWorld() {
    return this.world;
  }

  /**
   * Check if the system manager is initialized
   * @returns {boolean}
   */
  isInitialized() {
    return this.initialized;
  }

  /**
   * Manually adds a resource to the engine.
   * This is typically used by setup systems to register new resources that other systems can then depend on.
   * For example, a `terrainSetup` system could generate a terrain data map and register it as a 'terrain' resource.
   *
   * @param {string} name - The name of the resource.
   * @param {object} instance - The resource instance to add.
   * @throws {Error} If a resource with the same name already exists.
   *
   * @example
   * // Inside a setup system's init function:
   * init: (world, deps, config, engine) => {
   *   const terrainData = generateTerrain();
   *   engine.addResource("terrain", terrainData);
   * }
   *
   * // Another system can now depend on it:
   * engine.registerSystem("terrain-logic", {
   *   dependencies: ["terrain"],
   *   update: (world, { terrain }) => {
   *     // access terrain data
   *   }
   * });
   */
  addResource(name, instance) {
    if (this.resources.has(name) && this.resources.get(name).instance) {
      // Allow overriding the placeholder set in _registerCoreSystems
      if (name !== "eventBus") {
        throw new Error(`Resource '${name}' already exists.`);
      }
    }
    this.resources.set(name, { factory: null, instance });
  }

  /**
   * Registers the engine's built-in resources and runtime systems.
   * @private
   * @internal
   */
  _registerCoreSystems() {
    // === REGISTER CORE RESOURCES ===
    // These are the foundational services of the engine.
    this.addResource("eventBus", this);

    this.registerResource(
      "renderer",
      async (config) => await setupRenderer(config)
    );
    this.registerResource(
      "physics",
      async (config) => await setupPhysics(config)
    );
    this.registerResource("input", async (config) => await setupInput(config));
    this.registerResource(
      "assets",
      async (config) => await setupAssetManager(config)
    );

    // === CORE SETUP SYSTEMS (Run Once During Init) ===
    this.registerSetup("lighting", {
      dependencies: ["renderer"],
      init: async (world, dependencies, config) => {
        const lightingResources = await setupLighting(
          world,
          dependencies,
          config
        );
        this.addResource("lighting", lightingResources);
      },
    });

    this.registerSetup("physicsBodyCreation", {
      dependencies: ["physics"],
      init: (world, dependencies) =>
        physicsBodySetupSystem(world, dependencies),
    });

    // The game template will be responsible for player and terrain setup
    // so those are NOT registered here.

    this.registerSetup("camera", {
      dependencies: ["renderer"],
      init: async (world, dependencies, config) => {
        const cameraResources = await setupCamera(world, dependencies, config);
        this.addResource("camera", cameraResources);
      },
    });

    // === CORE RUNTIME SYSTEMS (Run Every Frame) ===
    this.registerSystem("inputInterpretation", {
      dependencies: ["input"],
      update: (world, dependencies) => inputSystem(world, dependencies),
      priority: 10,
    });

    this.registerSystem("cameraInput", {
      dependencies: ["camera"],
      update: (world, { camera }) => cameraInputSystem(world, camera.camera),
      priority: 20,
    });
    this.registerSystem("pointerLock", {
      dependencies: ["camera", "input"],
      update: (world, { camera, input }, deltaTime) => {
        pointerLockSystem(camera.controls, input, this.gameConfig);
      },
      priority: 21, // Run after camera input
    });

    // Game-specific playerMovementSystem runs at priority 30

    this.registerSystem("componentMovement", {
      dependencies: ["physics"],
      update: (world, { physics }) =>
        componentMovementSystem(world, physics.world),
      priority: 35,
    });

    this.registerSystem("physicsStep", {
      dependencies: ["physics"],
      update: (world, { physics }) =>
        stepPhysics(physics.world, physics.eventQueue),
      priority: 40,
    });

    this.registerSystem("characterControllerCollisionProcessing", {
      dependencies: ["physics", "eventBus"],
      update: (world, dependencies) =>
        characterControllerCollisionSystem(world, dependencies),
      priority: 41, // Run after physics step, before regular collision processing
    });

    this.registerSystem("collisionProcessing", {
      dependencies: ["physics", "eventBus"],
      update: (world, dependencies) => collisionSystem(world, dependencies),
      priority: 42, // Run right after character controller collision processing
    });

    this.registerSystem("triggerDetection", {
      dependencies: ["eventBus"],
      update: (world, { eventBus }) => triggerDetectionSystem(world, eventBus),
      priority: 43, // Run after physics but before rendering
    });

    this.registerSystem("physicsStateSync", {
      dependencies: ["physics"],
      update: (world, { physics }) =>
        physicsStateSyncSystem(world, physics.world),
      priority: 45, // CRITICAL: Run AFTER physics step
    });

    this.registerSystem("sceneManagement", {
      dependencies: ["assets", "renderer", "physics"],
      update: (world, dependencies) =>
        sceneManagementSystem(world, dependencies),
      priority: 50,
    });

    this.registerSystem("animationSetup", {
      update: (world, _) => animationSetupSystem(world),
      priority: 52,
    });

    this.registerSystem("animation", {
      update: (world, deps, deltaTime) => animationSystem(world, deltaTime),
      priority: 55,
    });

    this.registerSystem("parenting", {
      update: (world) => parentingSystem(world),
      priority: 60, // Run after parent positions are updated, before visuals are synced
    });

    this.registerSystem("transformSync", {
      update: (world) => transformSyncSystem(world),
      priority: 65,
    });

    this.registerSystem("camera-collision", {
      dependencies: ["camera"],
      update: (world, { camera }) =>
        physicsCameraCollisionSystem(world, camera),
      priority: 74, // Run just before camera update
    });

    this.registerSystem("cameraUpdate", {
      dependencies: ["camera", "input"],
      update: (world, dependencies, deltaTime) =>
        cameraUpdateSystem(world, dependencies, deltaTime),
      priority: 75,
    });
  }

  /**
   * Subscribes to an engine event.
   * The event bus is used for decoupled communication between systems. The engine instance itself serves as the main event bus.
   * For example, the collision system emits 'collision-enter' events,
   * and game logic can listen for these events without having a direct reference to the collision system.
   *
   * @param {string} eventName - The name of the event to listen for (e.g., 'collision-enter', 'score-updated').
   * @param {function(any): void} callback - The function to call when the event is emitted. It will receive the event data as its only argument.
   *
   * @example
   * engine.on("player-death", (eventData) => {
   *   console.log(`Player died because: ${eventData.reason}`);
   *   // Show game over screen
   * });
   */
  on(eventName, callback) {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    this.eventListeners.get(eventName).push(callback);
  }

  /**
   * Unsubscribes from an engine event.
   * It is good practice to unsubscribe listeners when they are no longer needed to prevent memory leaks,
   * for example, when a UI element that was listening for an event is destroyed.
   *
   * @param {string} eventName - The name of the event.
   * @param {function(any): void} callback - The specific callback function instance to remove.
   *
   * @example
   * const handleResize = () => { /.../ };
   * engine.on('resize', handleResize);
   * // later...
   * engine.off('resize', handleResize);
   */
  off(eventName, callback) {
    if (this.eventListeners.has(eventName)) {
      const listeners = this.eventListeners.get(eventName);
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Emits an engine event, calling all subscribed listeners with the provided data.
   *
   * @param {string} eventName - The name of the event to emit.
   * @param {any} [data] - The data payload to pass to the event listeners. This can be any type of data (object, string, number, etc.).
   *
   * @example
   * // Inside a system that has 'eventBus' as a dependency:
   * engine.registerSystem("scoring", {
   *   dependencies: ["eventBus"],
   *   update: (world, { eventBus }, deltaTime) => {
   *     world.with("isPlayer", "score").forEach(player => {
   *       player.score.value += 10;
   *       eventBus.emit("score-updated", { newScore: player.score.value });
   *     });
   *   }
   * });
   */
  emit(eventName, data) {
    if (this.eventListeners.has(eventName)) {
      // Create a copy of the listeners array in case a listener modifies the original array (e.g., by unsubscribing)
      const listeners = [...this.eventListeners.get(eventName)];
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in event listener for '${eventName}':`, error);
        }
      }
    }
  }

  /**
   * Get dependency objects for a system
   * @private
   * @internal
   */
  _getDependencies(dependencyNames) {
    const deps = {};

    for (const name of dependencyNames) {
      const resource = this.resources.get(name);
      if (!resource || !resource.instance) {
        throw new Error(`Resource '${name}' not available`);
      }
      deps[name] = resource.instance;
    }

    return deps;
  }
}
