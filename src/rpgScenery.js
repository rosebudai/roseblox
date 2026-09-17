import * as THREE from "three";

/** Register authored static scenery without requiring a second, parallel world. */
export function createRpgScenery(scene, physics) {
  const registered = new Map();

  function removeColliders(object) {
    object.traverse(node => {
      for (const body of registered.get(node) ?? []) if (!body.removed) body.remove();
      registered.delete(node);
    });
  }
  function addStaticMesh(mesh, options) {
    const previous = registered.get(mesh);
    if (previous?.length === 1 && !previous[0].removed) return previous[0];
    const body = physics.addStaticMesh(mesh, options);
    registered.set(mesh, [body]);
    return body;
  }
  function registerMesh(mesh) {
    const previous = registered.get(mesh);
    if (previous?.every(body => !body.removed)) return;
    for (const body of previous ?? []) if (!body.removed) body.remove();
    // Static props can be imported skinned/morphed models or instanced scenery.
    // Snapshot their visible pose without mutating or rendering collision proxies.
    mesh.updateWorldMatrix(true, true);
    let geometry = mesh.geometry, ownedGeometry;
    if (mesh.isSkinnedMesh || mesh.morphTargetInfluences?.length) {
      const count = geometry.getAttribute("position").count;
      ownedGeometry = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3), vertex = new THREE.Vector3();
      for (let i = 0; i < count; i++) mesh.getVertexPosition(i, vertex).toArray(positions, i * 3);
      ownedGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      if (geometry.index) ownedGeometry.setIndex(geometry.index.clone());
      geometry = ownedGeometry;
    }
    const bodies = [];
    try {
      if (mesh.isInstancedMesh || ownedGeometry) {
        const proxy = new THREE.Mesh(geometry, mesh.material);
        proxy.matrixAutoUpdate = false;
        for (let i = 0; i < (mesh.isInstancedMesh ? mesh.count : 1); i++) {
          if (mesh.isInstancedMesh) { mesh.getMatrixAt(i, proxy.matrix); proxy.matrix.premultiply(mesh.matrixWorld); }
          else proxy.matrix.copy(mesh.matrixWorld);
          bodies.push(physics.addStaticMesh(proxy));
        }
      } else bodies.push(physics.addStaticMesh(mesh));
      registered.set(mesh, bodies);
    } catch (error) {
      for (const body of bodies) body.remove();
      throw error;
    } finally { ownedGeometry?.dispose(); }
  }
  function register(object) {
    if (object.userData.rpgCollider === false) return;
    if (object.isMesh) registerMesh(object);
    for (const child of object.children) register(child);
  }
  function registerPose(object) {
    object.updateWorldMatrix(true, false);
    // updateMatrixWorld also refreshes skinned-model bind transforms and bones.
    object.updateMatrixWorld(true);
    register(object);
  }
  function addProp(object, options = {}) {
    if (options.collider !== undefined && typeof options.collider !== "boolean") throw new Error("Prop collider must be true or false.");
    if (options.position) object.position.fromArray(options.position);
    if (options.rotation) object.rotation.set(...options.rotation);
    if (options.scale !== undefined) object.scale.setScalar(options.scale);
    object.userData.rpgCollider = options.collider ?? object.userData.rpgCollider ?? true;
    scene.add(object);
    object.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; } });
    removeColliders(object);
    if (object.userData.rpgCollider !== false) registerPose(object);
    return object;
  }
  return {
    addStaticMesh, addProp,
    addDecoration: (object, options = {}) => addProp(object, { ...options, collider: false }),
    addSurface(mesh) { scene.add(mesh); mesh.receiveShadow = true; return addStaticMesh(mesh); },
    removeProp(object) { removeColliders(object); object.removeFromParent(); },
    // Capture direct scene.add calls once, after authored transforms have settled.
    // Actors are created later; particles and lights are not collision meshes.
    finalize: () => registerPose(scene),
  };
}
