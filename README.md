# Roseblox: A Three.js Game Engine

[![npm version](https://img.shields.io/npm/v/roseblox-game-engine.svg)](https://www.npmjs.com/package/roseblox-game-engine)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Roseblox is a lightweight, modern, and extensible game engine for creating 3D experiences on the web. It powers the 3D game templates on [Rosebud.ai](https://rosebud.ai), enabling AI-assisted game creation at scale. Built on top of industry-leading libraries like **Three.js**, **Rapier**, and **Miniplex**, it's designed with a "buildless" philosophy that enables rapid prototyping and iteration.

## Why Roseblox?

The primary motivation for Roseblox is to create an **AI-friendly game engine** that excels at AI-assisted 3D game development. Traditional game engines often have complex abstractions and implicit conventions that make them challenging for AI code generation. Roseblox addresses this with:

- **Clear, Predictable Patterns** - Consistent ECS architecture that AI can easily understand and extend
- **Explicit Dependencies** - All system dependencies are clearly defined, making it easy for AI to understand data flow
- **Self-Documenting Code** - Structure encourages descriptive system names and clear component definitions
- **Minimal Magic** - No hidden behaviors or implicit conventions that could confuse AI-generated code
- **Composable Systems** - Small, focused systems that AI can combine to create complex behaviors
- **Human-Readable Builds** - The build process preserves readable code without minification, making debugging and AI analysis straightforward

## Key Features

- 🎮 **ECS Architecture** - Clean Entity-Component-System pattern
- 🌐 **Physics** - Rapier3D integration with collision detection
- 🎨 **Rendering** - Full Three.js capabilities
- 📷 **Camera** - Smooth controls with physics-aware collision
- 🎯 **Input** - Keyboard, mouse, and pointer lock support
- 🔧 **Modular** - Priority-based system execution
- 🚀 **Buildless** - Native ES modules, no bundling required

## Installation

### Including Engine Source for AI Development

For optimal AI-assisted development, include the Roseblox source directly in your project:

```bash
# Copy the engine source to your project
cp roseblox-game-engine.js ./your-project/

# This allows AI assistants to read and understand the engine internals
```

The engine is designed to be readable by AI tools - keeping the source accessible enables better code generation and debugging.

## Quick Start

Add Roseblox to your HTML via importmap:

```html
<script type="importmap">
  {
    "imports": {
      "three": "https://esm.sh/three@0.163.0",
      "three/": "https://esm.sh/three@0.163.0/",
      "@dimforge/rapier3d-compat": "https://esm.sh/@dimforge/rapier3d-compat@0.17.3",
      "miniplex": "https://esm.sh/miniplex@2.0.0",
      "camera-controls": "https://esm.sh/camera-controls@2.10.1?external=three",
      "roseblox-game-engine": "./roseblox-game-engine.js"
    }
  }
</script>
```

Create your game in `main.js`:

```js
import { engine, CoreComponents } from "roseblox-game-engine";
import * as THREE from "three";

// Create a simple scene with rotating cubes
engine.registerSetup("create-scene", {
  dependencies: ["renderer"],
  init: (world, dependencies) => {
    // Add entities with transform and renderable components
    world.add({
      transform: CoreComponents.createTransform(new THREE.Vector3(0, 0, 0)),
      renderable: CoreComponents.createRenderableMetadata(
        "procedural",
        { type: "box", width: 1, height: 1, depth: 1 },
        { type: "standard", color: 0x00ff00 }
      ),
    });
  },
});

// Initialize and run
await engine.init({ canvas: document.getElementById("game-canvas") });
```

## Examples

- **Getting Started**: [examples/getting-started](examples/getting-started/) - Basic scene setup
- **Adventure Game**: [examples/adventure](examples/adventure/) - Full game with character controller, physics, and interactions

Run examples with any local server:
```bash
python3 -m http.server 8001
```

## Architecture

Roseblox integrates best-in-class libraries with a clean, AI-friendly architecture:

- **Libraries**: Three.js (rendering), Rapier (physics), Miniplex (ECS), camera-controls
- **Pattern**: Resource → Setup → Runtime system execution
- **Philosophy**: Use engine patterns for common tasks, access raw libraries for advanced features

### System Execution Order

Systems run in priority order (lower = earlier):

- **10-20**: Input handling
- **30-40**: Movement and character control
- **40-45**: Physics simulation
- **50-65**: Animation and effects
- **70-75**: Camera updates
- **999**: Debug overlays

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