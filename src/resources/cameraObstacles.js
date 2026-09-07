import * as THREE from "three";

/** Camera-only proxies borrow geometry; render/physics ownership stays elsewhere. */
export function createCameraObstacles(world, controls) {
  const entries = new Set();
  const legacy = new Map();
  const terrain = world.with("isTerrain");
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  let target = null;
  let disposed = false;

  function detach(entry) {
    const index = controls.colliderMeshes.indexOf(entry.proxy);
    if (index !== -1) controls.colliderMeshes.splice(index, 1);
  }
  function remove(entry) {
    if (!entries.delete(entry)) return;
    detach(entry);
    entry.proxy.dispose?.();
  }
  function register(source, { owner = null, followOnly = true, primitive = false } = {}) {
    if (disposed) throw new Error("Camera obstacles are disposed.");
    if (!source?.isMesh || !source.geometry) throw new TypeError("Camera obstacles require a Mesh or InstancedMesh.");
    const proxy = source.isInstancedMesh ? new THREE.InstancedMesh(source.geometry, material, source.count)
      : new THREE.Mesh(source.geometry, material);
    const entry = { source, proxy, owner, followOnly, primitive };
    entries.add(entry);
    syncEntry(entry);
    return () => remove(entry);
  }
  function syncEntry(entry) {
    const { owner, proxy } = entry;
    if (owner && !world.has(owner)) { remove(entry); return; }
    if (entry.primitive && owner.renderable?.mesh !== entry.source) { remove(entry); return; }
    const body = owner?.physicsBody;
    const eligible = !entry.primitive || (body?.rigidBody?.isValid() && body.rigidBody.isFixed() && !body.collider.isSensor());
    const enabled = eligible && owner !== target && (!entry.followOnly || target !== null);
    if (!enabled) { detach(entry); return; }
    const source = entry.source;
    if (owner?.transform && entry.primitive) {
      proxy.matrixWorld.compose(owner.transform.position, owner.transform.rotation, source.scale);
    } else {
      source.updateWorldMatrix(true, false);
      proxy.matrixWorld.copy(source.matrixWorld);
    }
    if (source.isInstancedMesh) {
      proxy.count = source.count;
      proxy.instanceMatrix = source.instanceMatrix;
      proxy.boundingSphere = source.boundingSphere;
      proxy.boundingBox = source.boundingBox;
    }
    if (!controls.colliderMeshes.includes(proxy)) controls.colliderMeshes.push(proxy);
  }
  function trackLegacy(entity) {
    const geometry = entity.isTerrain?.collisionGeometry;
    const previous = legacy.get(entity);
    if (previous?.geometry === geometry) return;
    previous?.release();
    legacy.delete(entity);
    if (!geometry) return;
    // Legacy terrain geometry is already in world coordinates, as before.
    const release = register(new THREE.Mesh(geometry, material), { owner: entity, followOnly: false });
    legacy.set(entity, { geometry, release });
  }
  const unsubscribeAdded = terrain.onEntityAdded.subscribe(trackLegacy);
  const unsubscribeTerrainRemoved = terrain.onEntityRemoved.subscribe(entity => {
    legacy.get(entity)?.release();
    legacy.delete(entity);
  });
  const unsubscribeRemoved = world.onEntityRemoved.subscribe(entity => {
    for (const entry of entries) if (entry.owner === entity) remove(entry);
    legacy.delete(entity);
    if (target === entity) target = null;
  });
  for (const entity of terrain) trackLegacy(entity);

  return {
    register,
    setFollowTarget(entity) { target = entity; this.sync(); },
    sync() {
      if (disposed) return;
      // Only the indexed legacy terrain subset can gain/replace geometry late.
      for (const entity of terrain) trackLegacy(entity);
      for (const entry of entries) syncEntry(entry);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeAdded(); unsubscribeTerrainRemoved(); unsubscribeRemoved();
      for (const entry of entries) remove(entry);
      legacy.clear(); target = null;
      material.dispose();
    },
  };
}
