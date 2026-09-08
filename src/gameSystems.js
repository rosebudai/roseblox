import { World } from "miniplex";
import { resetPresentationTransform } from "./presentationTransform.js";

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
import { sceneManagementSystem, setupSceneManagement } from "./systems/sceneManagementSystem.js";
import { animationSetupSystem } from "./systems/animationSetupSystem.js";
import { animationSystem } from "./systems/animationSystem.js";
import { transformSyncSystem } from "./systems/transformSyncSystem.js";
import { cameraUpdateSystem } from "./systems/cameraUpdateSystem.js";
import { physicsBodySetupSystem } from "./systems/physicsBodySetupSystem.js";
import { parentingSystem } from "./systems/parentingSystem.js";
import { debugRenderSystem } from "./systems/debugRenderSystem.js";
import { collisionSystem, setupCollisionTracking } from "./systems/collisionSystem.js";
import { characterControllerCollisionSystem } from "./systems/characterControllerCollisionSystem.js";
import { physicsCameraCollisionSystem } from "./systems/physicsCameraCollisionSystem.js";
import { triggerDetectionSystem, setupTriggerDetection } from "./systems/triggerDetectionSystem.js";

/**
 * A game instance. Resources and ECS state belong to this instance.
 * Existing registerSetup/registerSystem callbacks remain supported.
 */
export class GameSystems {
  constructor(options = {}) {
    this.world = new World();
    this.resources = new Map();
    this.setupSystems = [];
    this.runtimeSystems = [];
    this.eventListeners = new Map();
    this.initialized = false;
    this.initializing = false;
    this.running = false;
    this.disposed = false;
    this.options = options;
    this._resourceOrder = [];
    this._raf = null;
    this._lastTime = null;
    this._accumulator = 0;
    this._diagnostics = { frames: 0, fixedSteps: 0, simulatedSeconds: 0, droppedSeconds: 0, errorCount: 0, errors: [] };
    this._requestFrame = options.requestAnimationFrame ?? ((callback) => globalThis.requestAnimationFrame(callback));
    this._cancelFrame = options.cancelAnimationFrame ?? ((id) => globalThis.cancelAnimationFrame(id));
  }

  _assertRegistrable() {
    if (this.disposed) throw new Error("This engine was disposed. Create a new engine with createEngine().");
    if (this.initialized) throw new Error("Register resources and systems before calling init().");
  }

  /** Factory receives (gameConfig, dependencies, engine). */
  registerResource(name, factory, { dependencies = [] } = {}) {
    this._assertRegistrable();
    if (this.resources.has(name)) throw new Error(`Resource '${name}' is already registered.`);
    if (typeof factory !== "function") throw new TypeError(`Resource '${name}' needs a factory function.`);
    this.resources.set(name, { factory, dependencies, instance: undefined });
    return this;
  }

  /**
   * init receives (world, dependencies, gameConfig, engine).
   * Optional provides documents resources published with engine.addResource().
   * Setups wait until dependencies exist, including resources from later setups.
   */
  registerSetup(name, { init, dependencies = [], provides = [] }) {
    this._assertRegistrable();
    if (this.setupSystems.some((setup) => setup.name === name)) throw new Error(`Setup '${name}' is already registered.`);
    if (typeof init !== "function") throw new TypeError(`Setup '${name}' needs an init function.`);
    this.setupSystems.push({ name, init, dependencies, provides });
    return this;
  }

  /**
   * update receives (world, dependencies, deltaTime, engine).
   * The default fixed phase runs gameplay and physics together at fixedTimeStep.
   * Use phase: "frame" for camera, presentation, and UI work once per render.
   * Lower priority runs first within each phase.
   */
  registerSystem(name, { update, dependencies = [], priority = 0, phase = "fixed" }) {
    this._assertRegistrable();
    if (this.runtimeSystems.some((system) => system.name === name)) throw new Error(`Runtime system '${name}' is already registered.`);
    if (typeof update !== "function") throw new TypeError(`Runtime system '${name}' needs an update function.`);
    if (!["fixed", "frame"].includes(phase)) throw new Error(`System '${name}' phase must be 'fixed' or 'frame'.`);
    if (!Number.isFinite(priority)) throw new Error(`System '${name}' priority must be finite.`);
    this.runtimeSystems.push({ name, update, dependencies, priority, phase });
    this.runtimeSystems.sort((a, b) => a.priority - b.priority);
    return this;
  }

  /**
   * Initialize once. autoStart:false supports deterministic tests/manual update(dt).
   * fixedTimeStep is seconds; maxSubSteps bounds work after a stalled frame.
   * onError receives diagnostic records. Errors stop the loop by default;
   * errorMode:"continue" disables the failing system and continues the game.
   */
  async init(gameConfig = {}) {
    this._assertRegistrable();
    if (this.initializing) throw new Error("Engine initialization is already in progress.");
    this.gameConfig = gameConfig;
    this.fixedTimeStep = gameConfig.fixedTimeStep ?? 1 / 60;
    this.maxSubSteps = gameConfig.maxSubSteps ?? 8;
    this.maxFrameDelta = gameConfig.maxFrameDelta ?? 0.25;
    if (!Number.isFinite(this.fixedTimeStep) || this.fixedTimeStep <= 0) throw new Error("fixedTimeStep must be a positive number of seconds.");
    if (!Number.isInteger(this.maxSubSteps) || this.maxSubSteps < 1) throw new Error("maxSubSteps must be a positive integer.");
    if (!Number.isFinite(this.maxFrameDelta) || this.maxFrameDelta <= 0) throw new Error("maxFrameDelta must be positive.");
    this.initializing = true;
    try {
      this.addResource("eventBus", this);
      if (this.options.coreSystems !== false) this._registerCoreSystems();
      if (gameConfig.DEBUG && this.options.coreSystems !== false) {
        this.registerSystem("debug-renderer", { update: debugRenderSystem, dependencies: ["physics", "renderer"], phase: "frame", priority: 999 });
      }
      await this._initializeResourcesAndSetups();
      if (this.disposed) throw new Error("Engine was disposed during initialization.");
      // Missing runtime dependencies are initialization errors, not per-frame spam.
      for (const system of this.runtimeSystems) {
        try { this._getDependencies(system.dependencies); }
        catch (error) { throw new Error(`Runtime system '${system.name}': ${error.message}`, { cause: error }); }
      }
      this.initialized = true;
      if (gameConfig.autoStart !== false) this.start();
      return this;
    } catch (error) {
      this._reportError("initialization", "init", error);
      this.dispose();
      throw error;
    } finally {
      this.initializing = false;
    }
  }

  async _initializeResourcesAndSetups() {
    const pending = [
      ...[...this.resources].filter(([, resource]) => resource.factory).map(([name, resource]) => ({ name, resource, dependencies: resource.dependencies })),
      ...this.setupSystems.map((setup) => ({ ...setup, setup: true })),
    ];
    while (pending.length) {
      let progressed = false;
      for (let i = 0; i < pending.length;) {
        const task = pending[i];
        if (!task.dependencies.every((name) => this._hasResource(name))) { i++; continue; }
        const dependencies = this._getDependencies(task.dependencies);
        try {
          if (task.setup) {
            await task.init(this.world, dependencies, this.gameConfig, this);
            for (const name of task.provides) {
              if (!this._hasResource(name)) throw new Error(`Declared resource '${name}' was not provided. Call engine.addResource('${name}', value).`);
            }
          } else {
            const instance = await task.resource.factory(this.gameConfig, dependencies, this);
            if (this.disposed) { instance?.dispose?.(); throw new Error("Engine was disposed during initialization."); }
            if (instance == null) throw new Error("Resource factory must return a value.");
            task.resource.instance = instance;
            this._resourceOrder.push(task.name);
          }
          if (this.disposed) throw new Error("Engine was disposed during initialization.");
        } catch (error) {
          throw new Error(`${task.setup ? "Setup" : "Resource"} '${task.name}' failed: ${error.message}`, { cause: error });
        }
        pending.splice(i, 1);
        progressed = true;
      }
      if (!progressed) {
        const missing = pending.map((task) => `'${task.name}' needs [${task.dependencies.filter((name) => !this._hasResource(name)).join(", ")}]`).join("; ");
        throw new Error(`Unresolved setup/resource dependencies: ${missing}. Register the missing resources or break the dependency cycle.`);
      }
    }
  }

  /** Idempotent resume; no elapsed paused time is added to the simulation. */
  start() {
    if (!this.initialized || this.disposed) throw new Error("Call init() on a live engine before start().");
    if (this.running) return this;
    this.running = true;
    this._lastTime = null;
    const animate = (time) => {
      this._raf = null;
      if (!this.running || this.disposed) return;
      const deltaTime = this._lastTime == null ? 0 : Math.max(0, (time - this._lastTime) / 1000);
      this._lastTime = time;
      try { this.update(deltaTime); }
      catch { this.stop(); return; } // update already reported a named diagnostic.
      if (this.running && !this.disposed) this._raf = this._requestFrame(animate);
    };
    try { this._raf = this._requestFrame(animate); }
    catch (error) { this.running = false; throw error; }
    return this;
  }

  stop() {
    this.running = false;
    if (this._raf != null) this._cancelFrame(this._raf);
    this._raf = null;
    this._lastTime = null;
    this._accumulator = 0;
    this.resources.get("input")?.instance?.reset?.();
    for (const entity of this.world) resetPresentationTransform(entity);
    return this;
  }

  get interpolationAlpha() {
    return this.gameConfig?.interpolate === false ? 1 : Math.min(1, this._accumulator / this.fixedTimeStep);
  }

  /**
   * Advance elapsed seconds: fixed gameplay/physics steps, then one visual frame.
   * This keeps movement and collision behavior independent of display refresh rate.
   */
  update(deltaTime) {
    if (!this.initialized || this.disposed) throw new Error("GameSystems not initialized. Call init() first.");
    if (!Number.isFinite(deltaTime) || deltaTime < 0) throw new Error("update(deltaTime) requires finite, non-negative seconds.");
    const frameDelta = Math.min(deltaTime, this.maxFrameDelta);
    this._diagnostics.droppedSeconds += deltaTime - frameDelta;
    this._accumulator += frameDelta;
    let steps = 0;
    while (this._accumulator + 1e-10 >= this.fixedTimeStep && steps < this.maxSubSteps) {
      this._runSystems("fixed", this.fixedTimeStep);
      if (this.disposed) return;
      this._accumulator = Math.max(0, this._accumulator - this.fixedTimeStep);
      this._diagnostics.fixedSteps++;
      this._diagnostics.simulatedSeconds += this.fixedTimeStep;
      steps++;
    }
    if (this._accumulator + 1e-10 >= this.fixedTimeStep) {
      const dropped = Math.floor((this._accumulator + 1e-10) / this.fixedTimeStep) * this.fixedTimeStep;
      this._diagnostics.droppedSeconds += dropped;
      this._accumulator = Math.max(0, this._accumulator - dropped);
    }
    this._runSystems("frame", frameDelta);
    if (this.disposed) return;
    try { this.render(frameDelta); }
    catch (error) { this._reportError("render", "renderer", error); this.stop(); throw error; }
    this._diagnostics.frames++;
  }

  _runSystems(phase, deltaTime) {
    for (const system of this.runtimeSystems) {
      if (this.disposed) return;
      if (system.phase !== phase || system.disabled) continue;
      try { system.update(this.world, this._getDependencies(system.dependencies), deltaTime, this); }
      catch (error) {
        const failure = new Error(`Runtime system '${system.name}' failed: ${error.message}`, { cause: error });
        this._reportError(phase, system.name, failure);
        if (this.gameConfig.errorMode === "continue") system.disabled = true;
        else { this.stop(); throw failure; }
      }
    }
  }

  render(dt = 0) {
    if (this.options.coreSystems === false && !this._hasResource("renderer")) return;
    const renderer = this.getResource("renderer");
    const camera = this.getResource("camera");
    if (renderer.pipeline) renderer.pipeline.render(renderer.scene, camera.camera, dt);
    else renderer.renderer.render(renderer.scene, camera.camera);
  }

  _hasResource(name) { return this.resources.get(name)?.instance != null; }

  getResource(name) {
    if (!this._hasResource(name)) throw new Error(`Resource '${name}' not available. Register it or declare it as a setup dependency.`);
    return this.resources.get(name).instance;
  }

  getWorld() { return this.world; }
  isInitialized() { return this.initialized; }

  addResource(name, instance) {
    if (this.disposed) throw new Error("Cannot add a resource to a disposed engine.");
    if (this._hasResource(name)) throw new Error(`Resource '${name}' already exists.`);
    if (instance == null) throw new Error(`Resource '${name}' must have a value.`);
    this.resources.set(name, { factory: null, dependencies: [], instance });
    this._resourceOrder.push(name);
    return this;
  }

  /** Release browser listeners, GPU/physics resources and the ECS world once. */
  dispose() {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.initialized = false;
    const released = new Set();
    for (const name of [...this._resourceOrder].reverse()) {
      const instance = this.resources.get(name)?.instance;
      if (instance && instance !== this && !released.has(instance)) {
        released.add(instance);
        try { instance.dispose?.(released); }
        catch (error) { this._reportError("dispose", name, error); }
      }
    }
    for (const entity of [...this.world]) this.world.remove(entity);
    this.resources.clear();
    this._resourceOrder.length = 0;
    this.setupSystems.length = 0;
    this.runtimeSystems.length = 0;
    this.eventListeners.clear();
  }

  /** Records remain readable after disposal; errors are bounded to the last 100. */
  getDiagnostics() {
    const scene = this.resources.get("sceneLifecycle")?.instance;
    const physics = this.resources.get("physics")?.instance;
    const renderer = this.resources.get("renderer")?.instance?.renderer;
    return {
      ...this._diagnostics, errors: this._diagnostics.errors.map((error) => ({ ...error })),
      initialized: this.initialized, running: this.running, disposed: this.disposed,
      entities: this.world.entities.length, queries: this.world.queries.size,
      resources: {
        meshes: scene?.meshes.size ?? 0,
        bodies: scene?.bodies.size ?? 0,
        controllers: scene ? [...scene.bodies.keys()].filter(body => body.controller).length : 0,
        physicsBodies: physics?.world.bodies?.len() ?? null,
        physicsColliders: physics?.world.colliders?.len() ?? null,
      },
      rendererMemory: renderer?.info?.memory ? { ...renderer.info.memory } : null,
    };
  }

  _reportError(phase, system, error) {
    const diagnostic = { phase, system, message: error?.message ?? String(error), stack: error?.stack ?? null };
    this._diagnostics.errorCount++;
    this._diagnostics.errors.push(diagnostic);
    if (this._diagnostics.errors.length > 100) this._diagnostics.errors.shift();
    console.error(`[Roseblox ${phase}: ${system}]`, error);
    try { this.gameConfig?.onError?.(diagnostic); }
    catch (callbackError) { console.error("Roseblox onError callback failed:", callbackError); }
    if (phase !== "event") this.emit("engine-error", diagnostic);
  }

  on(eventName, callback) {
    if (this.disposed) throw new Error("Cannot subscribe to a disposed engine.");
    if (!this.eventListeners.has(eventName)) this.eventListeners.set(eventName, new Set());
    this.eventListeners.get(eventName).add(callback);
    return () => this.off(eventName, callback);
  }

  off(eventName, callback) { this.eventListeners.get(eventName)?.delete(callback); }

  emit(eventName, data) {
    for (const callback of [...(this.eventListeners.get(eventName) ?? [])]) {
      try { callback(data); }
      catch (error) { this._reportError("event", eventName, error); }
    }
  }

  _getDependencies(names) { return Object.fromEntries(names.map((name) => [name, this.getResource(name)])); }

  _registerCoreSystems() {
    // === REGISTER CORE RESOURCES ===
    // These are the foundational services of the engine.
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

    this.registerResource("sceneLifecycle", (_config, dependencies) =>
      setupSceneManagement(this.world, dependencies),
      { dependencies: ["renderer", "physics", "assets"] }
    );

    // === CORE SETUP SYSTEMS (Run Once During Init) ===
    this.registerResource("triggerLifecycle", (_config, { eventBus }) =>
      setupTriggerDetection(this.world, eventBus), { dependencies: ["eventBus"] });
    this.registerResource("collisionLifecycle", (_config, { physics }) =>
      setupCollisionTracking(physics), { dependencies: ["physics"] });

    this.registerSetup("lighting", {
      provides: ["lighting"],
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
      provides: ["camera"],
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
        if (camera.shouldUpdatePointerLock?.() !== false) pointerLockSystem(camera.controls, input, this.gameConfig);
      },
      priority: 21, // Run after camera input
    });

    // Factories also support entities spawned after initialization.
    this.registerSystem("physicsBodyCreation", {
      dependencies: ["physics"],
      update: physicsBodySetupSystem,
      priority: 32,
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
      update: (world, { physics }, deltaTime) =>
        stepPhysics(physics.world, physics.eventQueue, deltaTime),
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
      priority: 46, // Use transforms synchronized from the current physics step
    });

    this.registerSystem("physicsStateSync", {
      dependencies: ["physics"],
      update: (world, { physics }) =>
        physicsStateSyncSystem(world, physics.world),
      priority: 45, // CRITICAL: Run AFTER physics step
    });

    this.registerSystem("sceneManagement", {
      phase: "frame",
      dependencies: ["assets", "renderer", "physics"],
      update: (world, dependencies) =>
        sceneManagementSystem(world, dependencies),
      priority: 50,
    });

    this.registerSystem("animationSetup", {
      phase: "frame",
      update: (world, _) => animationSetupSystem(world),
      priority: 52,
    });

    this.registerSystem("animation", {
      phase: "frame",
      update: (world, deps, deltaTime) => animationSystem(world, deltaTime),
      priority: 55,
    });

    this.registerSystem("parenting", {
      update: (world) => parentingSystem(world),
      priority: 60, // Run after parent positions are updated, before visuals are synced
    });

    this.registerSystem("transformSync", {
      phase: "frame",
      update: (world) => transformSyncSystem(world, this.interpolationAlpha),
      priority: 65,
    });

    this.registerSystem("camera-collision", {
      phase: "frame",
      dependencies: ["camera"],
      update: (world, { camera }) =>
        physicsCameraCollisionSystem(world, camera),
      priority: 74, // Run just before camera update
    });

    this.registerSystem("cameraUpdate", {
      phase: "frame",
      dependencies: ["camera"],
      update: (world, { camera }, deltaTime) =>
        camera.shouldUpdateControls?.() !== false &&
        cameraUpdateSystem(world, camera.controls, deltaTime, this.interpolationAlpha),
      priority: 75,
    });
  }

}
