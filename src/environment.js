import * as THREE from "three";

/** Own panorama textures; newer requests and disposal supersede pending loads. */
export function createEnvironment({ scene, renderer, loadTexture = url => new THREE.TextureLoader().loadAsync(url) }) {
  let owned = null, request = 0, disposed = false;
  function release() {
    if (!owned) return;
    const { texture, previous } = owned;
    if (scene.background === texture) {
      scene.background = previous.background;
      scene.backgroundIntensity = previous.backgroundIntensity;
      scene.backgroundRotation.copy(previous.backgroundRotation);
    }
    if (scene.environment === texture) {
      scene.environment = previous.environment;
      scene.environmentIntensity = previous.environmentIntensity;
      scene.environmentRotation.copy(previous.environmentRotation);
    }
    owned = null;
    texture.dispose();
  }
  return {
    async set(url, { background = true, lighting = true, intensity = 1, backgroundIntensity = 1, rotation = 0 } = {}) {
      if (disposed) throw new Error("The environment is disposed.");
      if (typeof url !== "string" || !url.trim()) throw new TypeError("Environment needs an image URL.");
      if (typeof background !== "boolean" || typeof lighting !== "boolean" || (!background && !lighting)) throw new TypeError("Enable environment background or lighting.");
      if (![intensity, backgroundIntensity].every(value => Number.isFinite(value) && value >= 0) || !Number.isFinite(rotation)) throw new TypeError("Environment intensities must be non-negative and rotation finite.");
      const token = ++request;
      const texture = await loadTexture(url);
      if (disposed || token !== request) {
        texture.dispose();
        throw new Error("Environment load was superseded or the game was disposed.");
      }
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      release();
      const previous = {
        background: scene.background, environment: scene.environment,
        backgroundIntensity: scene.backgroundIntensity, environmentIntensity: scene.environmentIntensity,
        backgroundRotation: scene.backgroundRotation.clone(), environmentRotation: scene.environmentRotation.clone(),
      };
      owned = { texture, previous };
      if (background) {
        scene.background = texture; scene.backgroundIntensity = backgroundIntensity;
        scene.backgroundRotation.set(0, rotation, 0);
      }
      if (lighting) {
        scene.environment = texture; scene.environmentIntensity = intensity;
        scene.environmentRotation.set(0, rotation, 0);
      }
      return texture;
    },
    clear() { request++; release(); },
    dispose() { if (!disposed) { disposed = true; request++; release(); } },
  };
}
