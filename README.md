# Rosebud: A Three.js Game Engine

Rosebud is a lightweight, modern, and extensible game engine for creating 3D experiences on the web. It is built on top of industry-leading libraries like **Three.js**, **Rapier**, and **Miniplex**, and designed with a "buildless" philosophy that enables rapid prototyping and iteration.

Its core architecture is heavily influenced by professional game development patterns, but with a focus on simplicity and extensibility, making it an ideal foundation for both beginners and experienced developers. A primary design goal is to provide a clean, logical structure that is easy for AI-assisted development workflows to understand and extend.

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

## Tutorials & Examples

See [Examples](examples/) directory.
