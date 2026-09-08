// Contact sources overlap for dynamic bodies. Merge them before emitting transitions.
const states = new WeakMap();
function stateFor(physics) {
  if (!states.has(physics)) states.set(physics, { controllers: [], colliders: new Map(), active: new Map() });
  return states.get(physics);
}

export function setControllerContacts(physics, contacts) {
  stateFor(physics).controllers = contacts;
}

export function setupCollisionTracking(physics) {
  return { dispose() { states.delete(physics); } };
}

function getPair(pairs, a, b) { return pairs.get(a)?.get(b) ?? pairs.get(b)?.get(a); }
function* entries(pairs) { for (const others of pairs.values()) yield* others.values(); }

/** Emit one start/end per entity pair while any physics or controller contact exists. */
export function collisionSystem(world, { physics, eventBus }) {
  const state = stateFor(physics);
  physics.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
    const key = handle1 < handle2 ? `${handle1}/${handle2}` : `${handle2}/${handle1}`;
    if (!started) { state.colliders.delete(key); return; }
    const entityA = physics.world.getCollider(handle1)?.userData?.entity;
    const entityB = physics.world.getCollider(handle2)?.userData?.entity;
    if (entityA && entityB && entityA !== entityB) state.colliders.set(key, { entityA, entityB });
  });
  for (const [key, pair] of state.colliders) {
    if (!world.has(pair.entityA) || !world.has(pair.entityB) || !pair.entityA.physicsBody || !pair.entityB.physicsBody) state.colliders.delete(key);
  }
  const next = new Map();
  for (const pair of [...state.controllers, ...state.colliders.values()]) {
    const { entityA: a, entityB: b } = pair;
    if (!world.has(a) || !world.has(b)) continue;
    if (getPair(next, a, b)) continue;
    if (!next.has(a)) next.set(a, new Map());
    next.get(a).set(b, pair);
  }
  const previous = state.active;
  state.active = next;
  state.controllers = [];
  for (const pair of entries(previous)) {
    if (!getPair(next, pair.entityA, pair.entityB)) eventBus.emit("collision-ended", pair);
  }
  for (const pair of entries(next)) {
    if (!getPair(previous, pair.entityA, pair.entityB) && world.has(pair.entityA) && world.has(pair.entityB)) eventBus.emit("collision-started", pair);
  }
}
