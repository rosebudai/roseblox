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

### Via NPM

```bash
npm install roseblox-game-engine
```

### Via CDN

```html
<script type="importmap">
  {
    "imports": {
      "three": "https://esm.sh/three@0.163.0",
      "three/": "https://esm.sh/three@0.163.0/",
      "@dimforge/rapier3d-compat": "https://esm.sh/@dimforge/rapier3d-compat@0.17.3",
      "miniplex": "https://esm.sh/miniplex@2.0.0",
      "camera-controls": "https://esm.sh/camera-controls@2.10.1?external=three",
      "roseblox-game-engine": "https://esm.sh/roseblox-game-engine@0.0.1"
    }
  }
</script>
```

## Quick Start

```javascript
import { engine } from "roseblox-game-engine";

// Register a simple rotating cube system
engine.registerSystem("rotate-cube", {
  setup: (world, dependencies) => {
    // Create a cube entity
    const { factory } = dependencies.renderer;
    const cube = world.add({
      transform: { position: { x: 0, y: 1, z: 0 } },
      renderable: {
        object3D: factory.createBox({
          width: 1,
          height: 1,
          depth: 1,
          color: 0x00ff00,
        }),
      },
    });
  },
  update: (world, dependencies, deltaTime) => {
    // Rotate all renderables
    for (const entity of world.with("renderable", "transform")) {
      entity.renderable.object3D.rotation.y += deltaTime;
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

Check out the included adventure game example:

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
