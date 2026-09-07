/**
 * ASSET MANAGER
 *
 * A simple asset manager for preloading and caching game assets.
 * Currently supports GLTF models and textures.
 */

import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { disposeObject } from "./renderer/disposeObject.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export class AssetManager {
  constructor(config = {}) {
    this.config = config.ASSETS || {};
    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();
    this.cache = new Map();
    this.pending = new Map();
    this.urls = new Map();
    // Retain shared resources for the game's lifetime, including after a cache
    // lookup reset: legacy clones do not carry reference-counted leases.
    this.loaded = new Set();
    this.disposed = false;
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
    if (this.disposed) throw new Error("AssetManager is disposed.");
    if (this.urls.has(key) && this.urls.get(key) !== url) throw new Error(`Asset key '${key}' already refers to a different URL. Use a distinct key.`);
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.pending.has(key)) return this.pending.get(key);
    this.urls.set(key, url);
    const promise = new Promise((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          if (this.disposed) {
            const released = new Set();
            for (const scene of gltf.scenes ?? [gltf.scene]) if (scene) disposeObject(scene, released);
            reject(new Error(`Asset '${key}' finished loading after disposal.`));
            return;
          }
          const scalingConfig = this.config.SCALING?.[key];
          if (scalingConfig) {
            gltf.userData ??= {};
            gltf.userData.scaling = scalingConfig;
          }
          this.cache.set(key, gltf);
          this.loaded.add(gltf);
          resolve(gltf);
        },
        undefined, // onProgress callback (optional)
        (error) => {
          reject(new Error(`Failed to load GLTF '${key}' from ${url}: ${error?.message ?? error}`, { cause: error }));
        }
      );
    }).catch(error => {
      this.urls.delete(key);
      throw error;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  cloneGLTF(gltf) {
    const clonedScene = SkeletonUtils.clone(gltf.scene);
    return {
      scene: clonedScene,
      animations: [...(gltf.animations ?? [])],
    };
  }

  /**
   * Clear lookup entries. Shared resources stay alive until manager disposal,
   * so existing legacy/model instances remain valid.
   */
  clearCache() {
    for (const key of this.cache.keys()) this.urls.delete(key);
    this.cache.clear();
  }

  dispose(disposedResources = new Set()) {
    if (this.disposed) return;
    this.disposed = true;
    for (const asset of this.loaded) {
      for (const scene of asset.scenes ?? [asset.scene]) if (scene) disposeObject(scene, disposedResources);
    }
    this.cache.clear();
    this.loaded.clear();
    this.urls.clear();
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
    try { await assetManager.preload(assetsToLoad); }
    catch (error) { assetManager.dispose(); throw error; }
  }
  return assetManager;
}
