# Roseblox: A Three.js Game Engine

[![npm version](https://img.shields.io/npm/v/roseblox-game-engine.svg)](https://www.npmjs.com/package/roseblox-game-engine)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Roseblox is a lightweight, modern, and extensible game engine for creating 3D experiences on the web. Built on top of industry-leading libraries like **Three.js**, **Rapier**, and **Miniplex**, it's designed with a "buildless" philosophy that enables rapid prototyping and iteration.

## Why Roseblox?

The primary motivation for Roseblox is to create an **AI-friendly game engine** that excels at AI-assisted 3D game development. Traditional game engines often have complex abstractions and implicit conventions that make them challenging for AI code generation. Roseblox addresses this with:

- **Clear, Predictable Patterns** - Consistent ECS architecture that AI can easily understand and extend
- **Explicit Dependencies** - All system dependencies are clearly defined, making it easy for AI to understand data flow
- **Self-Documenting Code** - Structure encourages descriptive system names and clear component definitions
- **Minimal Magic** - No hidden behaviors or implicit conventions that could confuse AI-generated code
- **Composable Systems** - Small, focused systems that AI can combine to create complex behaviors
- **Human-Readable Builds** - The build process preserves readable code without minification, making debugging and AI analysis straightforward

## Features

- 🎮 **ECS Architecture** - Entity-Component-System pattern with Miniplex
- 🌐 **Physics Integration** - Built-in Rapier3D physics engine
- 🎨 **Three.js Rendering** - Full access to Three.js capabilities
- 📷 **Camera Controls** - Smooth camera system with collision detection
- 🎯 **Input Management** - Keyboard, mouse, and pointer lock support
- 🔧 **Modular Systems** - Priority-based system execution
- 🚀 **Zero Build Step** - Uses native ES modules via importmaps

## Installation

Include the game engine in your importmap. It uses peer dependencies so also include those. For example:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Getting Started</title>
    <script type="importmap">
      {
        "imports": {
          "three": "https://esm.sh/three@0.163.0",
          "three/": "https://esm.sh/three@0.163.0/",
          "@dimforge/rapier3d-compat": "https://esm.sh/@dimforge/rapier3d-compat@0.17.3",
          "miniplex": "https://esm.sh/miniplex@2.0.0",
          "camera-controls": "https://esm.sh/camera-controls@2.10.1?external=three",
          "roseblox-game-engine": "https://esm.sh/roseblox-game-engine@0.0.1?external=three,miniplex,camera-controls,@dimforge/rapier3d-compat"
        }
      }
    </script>
    <style>
      body {
        margin: 0;
        padding: 0;
        overflow: hidden;
        background: #1a1a1a;
        font-family: "Arial", sans-serif;
      }
      canvas {
        display: block;
      }
      #game-canvas {
        width: 100vw;
        height: 100vh;
      }
    </style>
  </head>
  <body>
    <canvas id="game-canvas"></canvas>
    <!-- Engine entrypoint -->
    <script type="module" src="main.js"></script>
  </body>
</html>
```

Then in main.js:

```js
import { engine, CoreComponents } from "roseblox-game-engine";
import * as THREE from "three";

const { createTransform, createRenderableMetadata } = CoreComponents;

// Register a setup system to create our scene
engine.registerSetup("create-scene", {
  dependencies: ["renderer"],
  init: (world, dependencies) => {
    // Create a ground plane
    world.add({
      transform: createTransform(new THREE.Vector3(0, -0.5, 0)),
      renderable: createRenderableMetadata(
        "procedural",
        { type: "box", width: 20, height: 1, depth: 20 },
        { type: "standard", color: 0x606060 }
      ),
    });

    // Create a few colorful cubes
    const cubePositions = [
      { x: -2, z: 0, color: 0xff0000 }, // Red
      { x: 0, z: 0, color: 0x00ff00 }, // Green
      { x: 2, z: 0, color: 0x0000ff }, // Blue
    ];

    for (const pos of cubePositions) {
      world.add({
        transform: createTransform(new THREE.Vector3(pos.x, 1.5, pos.z)),
        renderable: createRenderableMetadata(
          "procedural",
          { type: "box", width: 0.8, height: 0.8, depth: 0.8 },
          {
            type: "standard",
            color: pos.color,
            roughness: 0.5,
          }
        ),
      });
    }
  },
});

// Camera positioning must be done in a runtime system, not a setup system
// This is because the camera resource is created by the engine's internal setup systems
let cameraPositioned = false;
engine.registerSystem("position-camera-once", {
  dependencies: ["camera"],
  update: (world, dependencies, deltaTime) => {
    if (!cameraPositioned) {
      const { controls } = dependencies.camera;
      controls.setLookAt(5, 5, 5, 0, 0, 0);
      cameraPositioned = true;
    }
  },
  priority: 80, // Run after camera system
});

// Register a runtime system to rotate cubes
engine.registerSystem("rotate-cubes", {
  dependencies: [],
  update: (world, dependencies, deltaTime) => {
    // Rotate all cubes (not the ground)
    for (const entity of world.with("renderable", "transform")) {
      if (entity.renderable.mesh && entity.transform.position.y > 0) {
        entity.renderable.mesh.rotation.y += deltaTime;
      }
    }
  },
  priority: 50,
});

// Initialize the engine
await engine.init({
  canvas: document.getElementById("game-canvas"),
});
```

## Example

The getting started example is in [examples/getting-started](examples/getting-started/)

Check out the included adventure game example for a more advanced example:

```bash
cd examples/adventure
python3 -m http.server 8001
# Navigate to http://localhost:8001
```

## Engine Scope

Rosebud is a **lightweight glue framework** that integrates Rapier (physics), Miniplex (ECS), Three.js (rendering), and camera-controls. It provides:

- **Integration patterns** for connecting these libraries seamlessly
- **Resource management** with dependency injection
- **System orchestration** with priority-based execution
- **Common game patterns** (character controllers, collision detection)

**Key Principle**: Use engine abstractions for common patterns, access raw library instances for advanced features via `dependencies.physics.world`, `dependencies.renderer.scene`, etc.

## Core Architecture

The engine follows four key architectural principles that define how code should be structured:

### 1. Engine vs. Game Template Separation

- **Engine:** Stable library providing core systems (rendering, physics, ECS, input). Consumed as dependency, never modified directly.
- **Game Template:** Your game-specific code (entities, behaviors, systems, assets).

### 2. Resource-Setup-Runtime Pattern

The `GameSystems` manager orchestrates three distinct phases:

- **Resources:** Singleton services shared across the game (`renderer`, `physics`, `assetManager`, `input`).
- **Setup Systems:** Run once during initialization. Create initial entities, register factories, establish world state.
- **Runtime Systems:** Run every frame in priority order. Process entities and execute game logic.

### 3. Entity-Component-System with Miniplex

Built on **Miniplex** ECS library:

- **Entities:** Plain JavaScript objects with component properties
- **Components:** Data structures defining entity capabilities
- **Systems:** Functions that query and process entities with specific components

### 4. Deterministic System Execution

Runtime systems execute in priority order (lower numbers first):

- Input systems: 10-20
- Movement systems: 30-40
- Physics systems: 40-45
- Animation systems: 50-65
- Camera systems: 70-75
- Debug systems: 999

## Technology Stack

Built on `peerDependencies` provided via `importmap`:

- **Three.js**: Rendering, materials, geometries, math
- **Miniplex**: ECS with `world.with()` queries
- **Rapier**: Physics with registered body factories
- **camera-controls**: Camera system via resource dependency

## Browser Requirements

Roseblox requires a modern browser with ES modules support:

- Chrome 61+
- Firefox 60+
- Safari 11+
- Edge 79+

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT © 2025 mike.liu.dev@gmail.com

See [LICENSE](LICENSE) for details.
