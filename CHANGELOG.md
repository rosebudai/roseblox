# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
