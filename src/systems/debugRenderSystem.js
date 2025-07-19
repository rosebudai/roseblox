import * as THREE from "three";

let debugLines = null;

/**
 * A self-contained system that renders physics debug wireframes.
 * It manages its own state, creating the wireframe object on its first
 * run and updating it on every subsequent frame.
 * @param {World} world - The ECS world.
 * @param {object} dependencies - The required engine resources.
 * @param {object} dependencies.renderer - The renderer resource.
 * @param {object} dependencies.physics - The physics resource.
 */
export function debugRenderSystem(world, { renderer, physics }) {
  if (!renderer || !physics) {
    return;
  }

  // On the first run, create the debug lines object and add it to the scene
  if (!debugLines) {
    const buffers = physics.world.debugRender();
    const material = new THREE.LineBasicMaterial({ vertexColors: true });
    const geometry = new THREE.BufferGeometry();
    debugLines = new THREE.LineSegments(geometry, material);
    debugLines.geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(buffers.vertices, 3)
    );
    debugLines.geometry.setAttribute(
      "color",
      new THREE.BufferAttribute(buffers.colors, 4)
    );
    renderer.scene.add(debugLines);
  }

  // On every subsequent run, just update the geometry buffers
  const buffers = physics.world.debugRender();
  debugLines.geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(buffers.vertices, 3)
  );
  debugLines.geometry.setAttribute(
    "color",
    new THREE.BufferAttribute(buffers.colors, 4)
  );
}
