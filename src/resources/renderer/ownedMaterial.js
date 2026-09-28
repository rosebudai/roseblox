import * as THREE from "three";

/** Clone a material's GPU wrappers; caller material/textures and CPU images stay owned by the caller. */
export function createOwnedMaterial(input, defaults = {}) {
  const source = input ?? {};
  const instance = source.isMaterial === true;
  if (!instance && (typeof source !== "object" || Array.isArray(source))) throw new Error("material must be a THREE.Material or a MeshStandardMaterial parameter object.");
  if (instance && typeof source.clone !== "function") throw new Error("A supplied THREE.Material must support clone().");
  const borrowed = renderingTextures(instance ? source : { ...defaults, ...source });
  if ([...borrowed].some(texture => texture.isRenderTargetTexture)) throw new Error("Shape materials cannot clone live render-target textures. Use a caller-owned custom mesh for render-target rendering.");
  let material;
  const textures = new Map();
  const allocated = new Set();
  const copyTexture = texture => {
    if (!textures.has(texture)) {
      const copy = texture.clone();
      textures.set(texture, copy); allocated.add(copy);
    }
    return textures.get(texture);
  };
  const cloneUniform = (value, seen = new Map()) => {
    if (!value || typeof value !== "object") return value;
    if (value.isTexture) return copyTexture(value);
    if (seen.has(value)) return seen.get(value);
    if (ArrayBuffer.isView(value)) return value.slice();
    if (Array.isArray(value)) {
      const copy = []; seen.set(value, copy);
      for (const item of value) copy.push(cloneUniform(item, seen));
      return copy;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null || value instanceof THREE.Uniform) {
      const copy = Object.create(prototype); seen.set(value, copy);
      for (const [key, item] of Object.entries(value)) copy[key] = cloneUniform(item, seen);
      return copy;
    }
    // Three's vector/color/matrix classes own their numeric state.
    if (typeof value.clone === "function") return value.clone();
    throw new Error("Shader uniform objects must be plain structs, arrays, textures, or cloneable Three.js values.");
  };
  const intermediate = new Set();
  try {
    // Three's uniform copier only shallow-copies structs and assumes homogeneous
    // arrays. Copy the material type/settings, then own its uniform graph below.
    const template = instance && source.isShaderMaterial ? Object.create(source) : source;
    if (template !== source) template.uniforms = {};
    material = instance ? source.clone.call(template) : new THREE.MeshStandardMaterial({ ...defaults, ...source });
    // ShaderMaterial.clone() eagerly clones some uniform textures. Replace those
    // with our consistently owned graph, then release the unused temporary copies.
    for (const texture of renderingTextures(material)) if (!borrowed.has(texture)) intermediate.add(texture);
    for (const [name, value] of Object.entries(material)) if (value?.isTexture) material[name] = copyTexture(value);
    if (instance && source.uniforms) material.uniforms = cloneUniform(source.uniforms);
    for (const group of material.uniformsGroups ?? []) {
      for (const uniform of group.uniforms) uniform.value = cloneUniform(uniform.value);
    }
    if (instance) {
      material.onBeforeCompile = source.onBeforeCompile;
      material.customProgramCacheKey = source.customProgramCacheKey;
    }
    for (const texture of intermediate) texture.dispose();
    intermediate.clear();
    // Existing scene disposal also visits top-level texture slots. Guard only our
    // private wrappers, so both that path and direct material.dispose are safe.
    for (const texture of allocated) makeIdempotent(texture);
    const dispose = material.dispose.bind(material);
    let disposed = false;
    material.dispose = () => {
      if (disposed) return;
      disposed = true;
      for (const texture of allocated) texture.dispose();
      for (const group of material.uniformsGroups ?? []) group.dispose();
      dispose();
    };
    return material;
  } catch (error) {
    for (const texture of new Set([...allocated, ...intermediate])) texture.dispose();
    for (const group of material?.uniformsGroups ?? []) group.dispose();
    material?.dispose();
    throw error;
  }
}

function makeIdempotent(resource) {
  const dispose = resource.dispose.bind(resource);
  let disposed = false;
  resource.dispose = () => { if (!disposed) { disposed = true; dispose(); } };
}

function renderingTextures(material) {
  const textures = new Set(), visited = new Set();
  const visit = value => {
    if (!value || typeof value !== "object" || visited.has(value) || ArrayBuffer.isView(value)) return;
    visited.add(value);
    if (value.isTexture) { textures.add(value); return; }
    for (const child of Object.values(value)) visit(child);
  };
  for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
  visit(material.uniforms); visit(material.uniformsGroups);
  return textures;
}
