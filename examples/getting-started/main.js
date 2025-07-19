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
