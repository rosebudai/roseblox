# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add `game.loadMaterial` for repeating sRGB surface textures, shared image downloads, independent material sampling and game-owned asynchronous cleanup; document generated wall/floor tiles and scale.
- Add standalone themed `createHud` with named readouts, optional crosshair and game-owned DOM cleanup, preserving the voxel HUD delegate.
- Add input-independent `game.addCharacter` with world-space velocity, capsule collision and reset lifecycle; add `game.raycastBetween` for camera-independent sight and projectile segments.
- Add scoped `game.firstPerson` eye-follow, pointer look and lock/session handling with ownership restoration; support `jumpSpeed:0` for grounded no-jump games.

- Add `game.attachModel` for cached GLTF/GLB appearances with explicit fit/anchor/orientation, independent materials and existing-clip playback, safe attachment lifecycle, and unchanged primitive colliders.

- Independent `createEngine()` instances and a compact `createGame()` API for browser game code.
- Optional `createVoxelKit()` native presentation: themed layered terrain, instanced scenery, walking avatars, pickups, pooled effects and a compact customizable HUD, with independent resource ownership.
- Fixed-step gameplay/physics, disposable lifecycle, scoped input, dependency resolution and named diagnostics.
- Versioned browser bundle/API guide packaging for Playground's 3D reusable components.
- Real browser movement, collision, raycast, restart and legacy-example regression checks.
- Paired creation/edit scenario manifests, browser evidence capture, explicit visual review and separate success/unknown/regression metrics.

### Changed

- Preserve the type of Three.js materials supplied to shape helpers and give each shape independently disposable material/texture wrappers.
- Pin tested dependencies and share Playground's Three.js 0.184.0 instance; load Rapier 0.20.0 as a separate pinned browser module.
- Keep original singleton and ECS entry points; build the legacy filename for existing template symlinks.
- Scope graphics/physics cleanup to each engine and remove entities safely before their first frame.
- Preserve shared GLTF buffers across renderable removal/replacement and transfer animation ownership without stopping the replacement or retaining stale mixer components.
- Enable mouse orbit/zoom while following by default, preserve the chosen view during movement, and retain explicit fixed mode with controls restored on release/removal.
- Keep followed players visible through fixed-shape and voxel-tree camera obstacles, with borrowed-geometry ownership, legacy terrain updates and distance recovery after removal.
- Apply a one-time player spawn/reset clearance so floor-touching capsules remain movable after idle time; preserve exact non-player teleport coordinates.
- Render camera-attached first-person models as part of the game scene and its disposal lifecycle.
- Report a positive scenery request that places no objects, and document ground coverage, exclusions and safe player placement.
- Give standalone `createGame()` cameras to caller code when controls are disabled; preserve fixed follow and low-level engine camera updates. Scripted automatic transitions keep controls enabled with input bindings disabled.
- Temporarily hide followed and explicitly registered actor visuals when camera collision brings the view too close, then restore prior visibility when clear or following ends. Voxel avatars own and release their registrations.
- Expose `transform.quaternion` as an alias of the existing owned rotation so direct aiming survives transform synchronization.
- Bias decorative ground materials behind coplanar solid floors to prevent depth fighting while preserving geometry, scenery heights and physics.
- Update examples to the supported browser dependencies and document instance lifecycle/input focus.

These changes are under evaluation. Engine tests are not model-generation success measurements.

## [0.0.1] - 2025-01-19

### Added

- Initial release of Roseblox game engine
- Core ECS (Entity-Component-System) architecture using Miniplex
- Physics integration with Rapier3D
- Rendering system with Three.js
- Camera controls system
- Input management system
- Resource management with dependency injection
- System orchestration with priority-based execution
- Character controller with collision detection
- Animation system with state management
- Trigger detection system
- Scene management capabilities
- Debug rendering tools
- Adventure game example template
- Build system with esbuild
- JSDoc documentation generation

### Technical Details

- Buildless architecture using ES modules
- Peer dependencies for Three.js, Rapier, Miniplex, and camera-controls
- Deterministic system execution order
- Resource-Setup-Runtime pattern for game initialization

[0.0.1]: https://github.com/rosebudai/roseblox/releases/tag/v0.0.1
