import { disposeObject } from "../resources/renderer/disposeObject.js";

// A renderer owns its scene. Separate engine instances never share tracking maps.
const sceneStates = new WeakMap();

function trackMesh(state, entity) {
  const mesh = entity.renderable?.mesh;
  if (mesh && !state.meshes.has(mesh)) {
    // Ownership belongs to the registered mesh, even if its component is later
    // removed or replaced with a different renderable type.
    state.meshes.set(mesh, {
      entity,
      ownsResources: entity.renderable.type !== "gltf",
      // New factory data takes precedence over a previous mesh's component.
      mixer: entity.animationData?.mixer ?? entity.animationMixer?.mixer,
    });
  }
}

/** Establish cleanup before user setup, including add/remove before the first frame. */
export function setupSceneManagement(world, { renderer, physics }) {
  let state = sceneStates.get(renderer);
  if (state) return state;
  state = { meshes: new Map(), bodies: new Map() };
  const track = (entity) => {
    trackMesh(state, entity);
    if (entity.physicsBody) state.bodies.set(entity.physicsBody, entity);
  };
  const unsubscribeAdded = world.onEntityAdded.subscribe(track);
  const unsubscribeRemoved = world.onEntityRemoved.subscribe((entity) => {
    // Components may have been attached since the most recent frame.
    track(entity);
    for (const [mesh, ownership] of state.meshes) if (ownership.entity === entity) releaseMesh(state, mesh, ownership, world);
    for (const [body, owner] of state.bodies) if (owner === entity) releaseBody(state, body, physics);
  });
  state.dispose = () => {
    unsubscribeAdded();
    unsubscribeRemoved();
    for (const [mesh, ownership] of state.meshes) releaseMesh(state, mesh, ownership, world);
    for (const body of state.bodies.keys()) releaseBody(state, body, physics);
    sceneStates.delete(renderer);
  };
  sceneStates.set(renderer, state);
  for (const entity of world) track(entity);
  return state;
}

function releaseMesh(state, mesh, { entity, ownsResources, mixer }, world) {
  mesh.removeFromParent();
  mixer?.stopAllAction();
  if (mixer && world.has(entity)) {
    // Retire only the old mesh's animation components. A replacement factory
    // may already have attached new animationData for the next setup phase.
    if (entity.animationMixer?.mixer === mixer) world.removeComponent(entity, "animationMixer");
    if (entity.animationData?.mixer === mixer) world.removeComponent(entity, "animationData");
  }
  // GLTF clones share buffers/materials owned by AssetManager.
  if (ownsResources) disposeObject(mesh);
  else {
    // SkeletonUtils clones own their skeletons and renderer-created bone textures.
    const skeletons = new Set();
    mesh.traverse(child => { if (child.skeleton) skeletons.add(child.skeleton); });
    for (const skeleton of skeletons) skeleton.dispose();
  }
  state.meshes.delete(mesh);
}

function releaseBody(state, body, physics) {
  if (body.controller) physics.world.removeCharacterController?.(body.controller);
  if (body.rigidBody && (body.rigidBody.isValid?.() ?? true)) physics.world.removeRigidBody(body.rigidBody);
  else if (body.collider && (body.collider.isValid?.() ?? true)) physics.world.removeCollider(body.collider, true);
  state.bodies.delete(body);
}

/** Create missing meshes and clean up entities/components removed from this world. */
export function sceneManagementSystem(world, { renderer, assets, physics }) {
  const state = setupSceneManagement(world, { renderer, physics });
  for (const entity of world) {
    const renderable = entity.renderable;
    if (renderable?.needsMesh && !renderable.mesh) {
      const factoryKey = Object.keys(entity).find((key) => renderer.getMeshFactory(key)) ?? renderable.type;
      const factory = renderer.getMeshFactory(factoryKey);
      renderable.needsMesh = false;
      if (!factory) throw new Error(`No mesh factory registered for '${factoryKey}'. Register one or use procedural/gltf renderable metadata.`);
      try {
        const mesh = factory(entity, { assets });
        if (!mesh?.isObject3D) throw new Error("Mesh factory must synchronously return a Three.js Object3D.");
        renderable.mesh = mesh;
        renderer.scene.add(mesh);
        // A GLTF factory may attach animation data while constructing its mesh.
        // Reindex that new component for Miniplex queries.
        if (entity.animationData) {
          const animationData = entity.animationData;
          delete entity.animationData;
          world.addComponent(entity, "animationData", animationData);
        }
      } catch (error) {
        throw new Error(`Mesh factory '${factoryKey}' failed: ${error.message}`, { cause: error });
      }
    }
    // Also track meshes and bodies supplied directly by game helpers.
    trackMesh(state, entity);
    if (entity.physicsBody) state.bodies.set(entity.physicsBody, entity);
  }

  const entities = new Set(world);
  for (const [mesh, ownership] of state.meshes) {
    const { entity } = ownership;
    if (entities.has(entity) && entity.renderable?.mesh === mesh) continue;
    releaseMesh(state, mesh, ownership, world);
  }
  for (const [body, entity] of state.bodies) {
    if (entities.has(entity) && entity.physicsBody === body) continue;
    releaseBody(state, body, physics);
  }
}
