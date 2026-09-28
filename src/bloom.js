import * as THREE from "three";

/** Load optional passes only when requested; one pipeline remains the render owner. */
export async function setBloom(resource, camera, { strength = 0.24, radius = 0.45, threshold = 1.4, exposure = 1.15 } = {}) {
  if (![strength, radius, threshold, exposure].every(value => Number.isFinite(value) && value >= 0)) throw new TypeError("Bloom settings must be finite non-negative numbers.");
  if (resource.pipeline.disposed) throw new Error("The render pipeline is disposed.");
  const version = resource.pipeline.reserve();
  const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
    import("three/addons/postprocessing/EffectComposer.js"),
    import("three/addons/postprocessing/RenderPass.js"),
    import("three/addons/postprocessing/UnrealBloomPass.js"),
    import("three/addons/postprocessing/OutputPass.js"),
  ]);
  if (resource.pipeline.disposed || resource.pipeline.version !== version) throw new Error("Bloom setup was superseded or the game was disposed.");
  const composer = new EffectComposer(resource.renderer);
  const passes = [new RenderPass(resource.scene, camera), new UnrealBloomPass(new THREE.Vector2(resource.width, resource.height), strength, radius, threshold), new OutputPass()];
  for (const pass of passes) composer.addPass(pass);
  resource.pipeline.set({
    render: dt => composer.render(dt),
    resize(width, height, pixelRatio) { composer.setPixelRatio(pixelRatio); composer.setSize(width, height); },
    dispose() { for (const pass of passes) pass.dispose?.(); composer.dispose(); },
  });
  resource.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  resource.renderer.toneMappingExposure = exposure;
}
