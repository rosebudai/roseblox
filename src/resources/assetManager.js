/**
 * ASSET MANAGER
 *
 * A simple asset manager for preloading and caching game assets.
 * Currently supports GLTF models and textures.
 */

import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export class AssetManager {
  constructor(config = {}) {
    this.config = config.ASSETS || {};
    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();
    this.cache = new Map();
  }

  async preload(assets) {
    const promises = assets.map(async (asset) => {
      try {
        if (asset.url.includes(".gltf") || asset.url.includes(".glb")) {
          const result = await this.loadGLTF(asset.key, asset.url);
          return result;
        }
        // Add other asset types here later (e.g., textures)
        console.warn(
          `⚠️ Unknown asset type for ${asset.key}, skipping preload`
        );
        return null;
      } catch (error) {
        console.error(
          `❌ Failed to preload asset ${asset.key} from ${asset.url}:`,
          error
        );
        throw error; // Re-throw to fail the entire preload process
      }
    });

    try {
      const results = await Promise.all(promises);
      const loadedCount = results.filter((r) => r !== null).length;

      if (loadedCount === 0 && assets.length > 0) {
        console.error(
          `❌ No assets were loaded! Check asset URLs and network connectivity.`
        );
      }

      return results;
    } catch (error) {
      console.error(`❌ Preload failed:`, error);
      throw error;
    }
  }

  async loadGLTF(key, url) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          const scalingConfig = this.config.SCALING?.[key];
          if (scalingConfig) {
            gltf.userData.scaling = scalingConfig;
          }
          this.cache.set(key, gltf);
          resolve(gltf);
        },
        undefined, // onProgress callback (optional)
        (error) => {
          console.error(`Failed to load GLTF asset ${key} from ${url}:`, error);
          reject(error);
        }
      );
    });
  }

  cloneGLTF(gltf) {
    const clonedScene = SkeletonUtils.clone(gltf.scene);
    return {
      scene: clonedScene,
      animations: [...gltf.animations],
    };
  }

  /**
   * Clear asset cache (for memory management)
   */
  clearCache() {
    this.cache.clear();
  }
}

/**
 * Setup the AssetManager resource.
 * @param {Object} [config={}] - The game's configuration object.
 * @returns {Promise<AssetManager>}
 */
export async function setupAssetManager(config = {}) {
  const assetManager = new AssetManager(config);
  const assetsToLoad = config.assets || [];
  if (assetsToLoad.length > 0) {
    await assetManager.preload(assetsToLoad);
  }
  return assetManager;
}
