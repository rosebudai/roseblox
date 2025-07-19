/**
 * GAME TEMPLATE - MAIN ENTRY POINT
 *
 * This file is the central hub of the game template. Its primary responsibilities are:
 * 1. Importing the core engine and any game-specific systems or setup modules.
 * 2. Importing the game's configuration file.
 * 3. Registering all game-specific systems and setup functions with the engine.
 * 4. Initializing the engine with the game's configuration, which starts the game.
 */

import { GAME_CONFIG } from "./config.js";
import { engine } from "roseblox-game-engine";

// Import game-specific setup functions. These now handle their own factory registrations.
import { setupGamePlayer } from "./playerSetup.js";
import { setupGameTerrain } from "./terrainSetup.js";
import { setupCollectibles } from "./collectibleSetup.js";
import { setupCollisionTests } from "./collisionTestSetup.js";
import {
  setupDebugCoordinateDisplay,
  debugCoordinateSystem,
} from "./debugCoordinateSystem.js";

// Import game-specific runtime systems
import { playerMovementSystem } from "./playerMovementSystem.js";
import { collectibleSystemSetup } from "./collectibleSystem.js";

async function main(canvas) {
  // Register game-specific setup logic. These functions will register factories
  // and create the initial game entities.
  engine.registerSetup("game-terrain-setup", {
    dependencies: ["physics", "renderer"],
    init: (world, dependencies) => {
      const terrainResource = setupGameTerrain(world, dependencies);
      engine.addResource("terrain", terrainResource);
    },
  });

  engine.registerSetup("game-player-setup", {
    dependencies: ["physics", "renderer", "assets", "terrain"], // Add terrain dependency
    init: (world, deps) => setupGamePlayer(world, deps, GAME_CONFIG),
  });

  engine.registerSetup("game-collectible-setup", {
    dependencies: ["terrain"],
    init: (world, deps) => setupCollectibles(world, deps),
  });

  engine.registerSetup("collision-test-setup", {
    dependencies: ["terrain", "physics"],
    init: (world, deps) => setupCollisionTests(world, deps),
  });

  engine.registerSetup("collectible-system-setup", {
    dependencies: ["eventBus"],
    init: (world, deps) => collectibleSystemSetup(world, deps),
  });

  engine.registerSetup("debug-coordinate-setup", {
    dependencies: [],
    init: (world, deps) => setupDebugCoordinateDisplay(world, GAME_CONFIG),
  });

  // Register game-specific runtime systems with their priorities.
  engine.registerSystem("player-movement", {
    update: (world, _, dt) => playerMovementSystem(world, dt),
    priority: 30, // Same priority as before to ensure correct execution order
  });

  engine.registerSystem("debug-coordinates", {
    dependencies: ["terrain"],
    update: (world, { terrain }) => debugCoordinateSystem(world, terrain),
    priority: 999, // Run last for debug display
  });

  // Initialize the engine with the game's configuration and the canvas.
  await engine.init({ ...GAME_CONFIG, canvas });
}

// Wait for the DOM to be fully loaded before starting the game.
document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("game-canvas");
  if (!canvas) {
    console.error('Fatal: Could not find canvas element with id="game-canvas"');
    return;
  }

  // Pass the canvas element to the engine in the config.
  main(canvas).catch((error) => console.error("Failed to start game:", error));
});
