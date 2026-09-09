import * as THREE from "three";
import { registerObjectCleanup } from "./resources/renderer/disposeObject.js";

/** Model appearances beneath stable, collider-owned entity roots. */
export function createModelAttachments({ world, assets, registerCameraVisual, isVisualHiddenByCamera = () => false }) {
  const states = new Map();
  let disposed = false;
  const unsubscribe = world.onEntityRemoved.subscribe(entity => releaseState(states.get(entity)));

  function releaseState(state) {
    if (!state || state.closed) return;
    state.closed = true;
    for (const handle of [...state.handles]) handle.dispose();
    state.unregisterCleanup();
    if (states.get(state.entity) === state) states.delete(state.entity);
  }

  function retireEmpty(state) {
    if (!state.pending && !state.handles.size) releaseState(state);
  }

  function stateFor(entity) {
    if (disposed) throw new Error("Model attachments are disposed.");
    const root = entity?.mesh;
    if (!world.has(entity) || !root?.isObject3D || entity.renderable?.mesh !== root) {
      throw new Error("attachModel requires a live game entity with its original .mesh/renderable root.");
    }
    let state = states.get(entity);
    if (state?.root !== root) { releaseState(state); state = null; }
    if (!state) {
      state = { entity, root, handles: new Set(), pending: 0, hidden: null, closed: false };
      state.unregisterCleanup = registerObjectCleanup(root, () => releaseState(state));
      states.set(entity, state);
    }
    return state;
  }

  function hideProxy(state) {
    if (!state.root.material) return () => {};
    if (!state.hidden) {
      const material = new THREE.MeshBasicMaterial({ visible: false });
      state.hidden = { original: state.root.material, material, users: 0 };
      state.root.material = material;
    }
    const hidden = state.hidden;
    hidden.users++;
    return () => {
      if (--hidden.users) return;
      if (state.root.material === hidden.material) state.root.material = hidden.original;
      hidden.material.dispose();
      state.hidden = null;
    };
  }

  return {
    async attachModel(entity, url, options = {}) {
      if (typeof url !== "string" || !url.trim()) throw new Error("attachModel requires a nonempty GLTF/GLB URL or project asset path.");
      const config = modelOptions(options);
      const state = stateFor(entity);
      state.pending++;
      let instance;
      let showProxy;
      let unregisterCamera;
      try {
        const asset = await assets.loadGLTF(`model:${url}`, url);
        if (disposed || state.closed || !world.has(entity) || entity.mesh !== state.root || entity.renderable?.mesh !== state.root) {
          throw new Error(`Model '${url}' finished loading after its entity/visual was removed or disposed.`);
        }
        instance = makeInstance(assets.cloneGLTF(asset), config);
        state.root.add(instance.mesh);
        if (config.hideProxy) showProxy = hideProxy(state);
        if (config.cameraVisual ?? (Boolean(entity.player) || entity.body?.isKinematic() || entity.body?.isDynamic())) {
          unregisterCamera = registerCameraVisual(entity);
        }
        if (state.root.visible === false && !state.warnedHidden && !isVisualHiddenByCamera(entity)) {
          state.warnedHidden = true;
          console.warn(`[Roseblox attachModel] '${entity.name ?? "entity"}' has entity.mesh.visible=false, so attached model children remain hidden. Restore entity.mesh.visible=true when activating this actor; attachModel already hides the proxy material.`);
        }
        const handle = modelHandle(instance, url, () => {
          state.handles.delete(handle);
          unregisterCamera?.();
          showProxy?.();
          retireEmpty(state);
        });
        state.handles.add(handle);
        return handle;
      } catch (error) {
        unregisterCamera?.();
        instance?.dispose();
        showProxy?.();
        throw error;
      } finally {
        state.pending--;
        retireEmpty(state);
      }
    },
    update(dt) {
      for (const state of states.values()) {
        if (!world.has(state.entity) || state.entity.mesh !== state.root || state.entity.renderable?.mesh !== state.root) {
          releaseState(state);
          continue;
        }
        for (const handle of state.handles) handle.update(dt);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      for (const state of [...states.values()]) releaseState(state);
    },
  };
}

function modelOptions(options) {
  const { height, maxDimension, anchor = "center" } = options;
  if (height !== undefined && maxDimension !== undefined) throw new Error("attachModel accepts height OR maxDimension, not both.");
  for (const [name, value] of Object.entries({ height, maxDimension })) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw new Error(`Model ${name} must be a positive number.`);
  }
  if (!["center", "bottom", false].includes(anchor)) throw new Error("Model anchor must be 'center', 'bottom', or false.");
  const vector = (value, name) => {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`Model ${name} must be three finite numbers.`);
    return value;
  };
  return {
    height, maxDimension, anchor,
    rotation: vector(options.rotation ?? [0, 0, 0], "rotation"),
    offset: vector(options.offset ?? [0, 0, 0], "offset"),
    hideProxy: options.hideProxy ?? true,
    castShadow: options.castShadow ?? true,
    receiveShadow: options.receiveShadow ?? true,
    cameraVisual: options.cameraVisual,
  };
}

export function makeInstance(clone, options) {
  const { scene, animations } = clone;
  const mesh = new THREE.Group();
  mesh.name = "Roseblox model attachment";
  const pivot = new THREE.Group();
  pivot.rotation.set(...options.rotation);
  pivot.add(scene);
  mesh.add(pivot);
  const materials = new Map();
  const skeletons = new Set();
  const instance = {
    mesh, scene, animations, mixer: null,
    dispose() {
      mesh.removeFromParent();
      instance.mixer?.stopAllAction();
      instance.mixer?.uncacheRoot(scene);
      // Geometry/textures belong to AssetManager, materials and cloned skeletons
      // belong to this instance. Never dispose the entire borrowed subtree.
      for (const skeleton of skeletons) skeleton.dispose();
      for (const material of materials.values()) material.dispose();
      skeletons.clear(); materials.clear();
    },
  };
  try {
    scene.traverse(child => {
      if (child.skeleton) skeletons.add(child.skeleton);
      if (!child.isMesh) return;
      child.castShadow = options.castShadow;
      child.receiveShadow = options.receiveShadow;
      const cloneMaterial = original => {
        if (!original) return original;
        if (!materials.has(original)) materials.set(original, original.clone());
        return materials.get(original);
      };
      child.material = Array.isArray(child.material) ? child.material.map(cloneMaterial) : cloneMaterial(child.material);
    });
    mesh.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(mesh, true);
    const size = bounds.getSize(new THREE.Vector3());
    if (bounds.isEmpty() || ![...bounds.min, ...bounds.max].every(Number.isFinite)) throw new Error("Loaded model has no finite renderable bounds; check the GLTF scene.");
    const dimension = options.height !== undefined ? size.y : Math.max(size.x, size.y, size.z);
    const target = options.height ?? options.maxDimension;
    if (target !== undefined) {
      if (dimension <= 0) throw new Error("Cannot fit a model with zero size along the requested dimension.");
      pivot.scale.setScalar(target / dimension);
      mesh.updateWorldMatrix(true, true);
      bounds.setFromObject(mesh, true);
    }
    if (options.anchor !== false) {
      const center = bounds.getCenter(new THREE.Vector3());
      pivot.position.set(-center.x, options.anchor === "bottom" ? -bounds.min.y : -center.y, -center.z);
    }
    mesh.position.set(...options.offset);
    mesh.updateWorldMatrix(true, true);
    instance.bounds = new THREE.Box3().setFromObject(mesh, true);
    return instance;
  } catch (error) { instance.dispose(); throw error; }
}

/** Shared animation and ownership contract for world and camera appearances. */
export function modelHandle(instance, url, onDispose) {
  let released = false;
  const handle = {
    mesh: instance.mesh,
    bounds: instance.bounds,
    clips: instance.animations.map(clip => clip.name),
    play(name, { loop = true } = {}) {
      if (released) throw new Error("This model attachment is disposed.");
      const clip = instance.animations.find(clip => clip.name === name);
      if (!clip) throw new Error(`Model '${url}' has no clip '${name}'. Available clips: ${handle.clips.join(", ") || "none (static model)"}.`);
      instance.mixer ??= new THREE.AnimationMixer(instance.scene);
      instance.mixer.stopAllAction();
      const action = instance.mixer.clipAction(clip).reset();
      action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      action.clampWhenFinished = !loop;
      action.play();
      return action;
    },
    stop() { instance.mixer?.stopAllAction(); },
    dispose() {
      if (released) return;
      released = true;
      instance.dispose();
      onDispose();
    },
    update(dt) { if (!released) instance.mixer?.update(dt); },
  };
  return handle;
}
