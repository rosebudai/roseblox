import * as THREE from "three";
import { createOwnedMaterial } from "./resources/renderer/ownedMaterial.js";

/** Share downloaded surface images while owning each material's sampling and lifetime. */
export function createSurfaceMaterials({ renderer, loadTexture = url => new THREE.TextureLoader().loadAsync(url) }) {
  const requests = new Map(), sources = new Set(), materials = new Set();
  let disposed = false;

  function source(url) {
    if (!requests.has(url)) {
      const request = Promise.resolve().then(() => loadTexture(url)).then(texture => {
        if (disposed) {
          texture.dispose();
          throw new Error("Surface image finished loading after game disposal.");
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        sources.add(texture);
        return texture;
      }).catch(error => {
        requests.delete(url);
        throw error;
      });
      requests.set(url, request);
    }
    return requests.get(url);
  }

  return {
    async load(url, { repeat = [1, 1], roughness = 0.85, metalness = 0, color = 0xffffff } = {}) {
      if (disposed) throw new Error("Surface materials are disposed.");
      if (typeof url !== "string" || !url.trim()) throw new TypeError("Surface material needs an image URL.");
      if (!Array.isArray(repeat) || repeat.length !== 2 || !repeat.every(value => Number.isFinite(value) && value > 0)) throw new TypeError("Texture repeat needs two positive finite numbers.");
      if (![roughness, metalness].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new TypeError("Roughness and metalness must be between zero and one.");
      // Capture options before awaiting so caller mutations cannot change this request.
      const [u, v] = repeat;
      const tint = new THREE.Color(color);
      const map = await source(url);
      if (disposed) throw new Error("Surface material finished loading after game disposal.");
      const material = createOwnedMaterial({ map, color: tint, roughness, metalness });
      material.map.repeat.set(u, v);
      material.addEventListener("dispose", () => materials.delete(material));
      materials.add(material);
      return material;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of materials) material.dispose();
      for (const texture of sources) texture.dispose();
      materials.clear(); sources.clear(); requests.clear();
    },
  };
}
