// Borrowed visual subtrees must detach before their owned parent's traversal.
const objectCleanups = new WeakMap();

export function registerObjectCleanup(object, cleanup) {
  if (!objectCleanups.has(object)) objectCleanups.set(object, new Set());
  const callbacks = objectCleanups.get(object);
  callbacks.add(cleanup);
  return () => {
    callbacks.delete(cleanup);
    if (!callbacks.size) objectCleanups.delete(object);
  };
}

/** Dispose an owned object graph once, including nested materials and textures. */
export function disposeObject(object, disposed = new Set()) {
  const cleanups = [];
  const collect = child => {
    const callbacks = objectCleanups.get(child);
    if (callbacks) { cleanups.push(...callbacks); objectCleanups.delete(child); }
  };
  if (object.traverse) object.traverse(collect); else collect(object);
  for (const cleanup of cleanups) cleanup();
  const release = (resource) => {
    if (!resource?.dispose || disposed.has(resource)) return;
    disposed.add(resource);
    resource.dispose();
  };
  const visit = (child) => {
    if (child.isInstancedMesh) release(child);
    release(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (!material) continue;
      for (const value of Object.values(material)) if (value?.isTexture) release(value);
      release(material);
    }
    child.skeleton?.dispose?.();
    child.shadow?.dispose?.();
  };
  if (object.traverse) object.traverse(visit); else visit(object);
}
