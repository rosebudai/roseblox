const states = new WeakMap();

/** Release membership when either ECS query loses an entity or component. */
export function setupTriggerDetection(world, eventBus) {
  if (states.has(world)) return states.get(world);
  const actors = world.with("transform", "triggerDetector");
  const zones = world.with("transform", "triggerZone");
  const components = new Map();
  function exit(trigger, component, triggerable) {
    if (component.currentlyInside.delete(triggerable)) {
      eventBus.emit("trigger-exited", { triggerable, trigger, triggerType: component.type ?? "generic" });
    }
  }
  function track(zone) {
    zone.triggerZone.currentlyInside ??= new Set();
    components.set(zone, zone.triggerZone);
  }
  const unsubscribeAdded = zones.onEntityAdded.subscribe(track);
  const unsubscribeZone = zones.onEntityRemoved.subscribe(zone => {
    const component = components.get(zone);
    components.delete(zone);
    if (component) for (const actor of [...component.currentlyInside]) exit(zone, component, actor);
  });
  const unsubscribeActor = actors.onEntityRemoved.subscribe(actor => {
    for (const [zone, component] of [...components]) exit(zone, component, actor);
  });
  for (const zone of zones) track(zone);
  const state = {
    actors, zones, components, exit,
    dispose() {
      unsubscribeAdded(); unsubscribeZone(); unsubscribeActor();
      for (const component of components.values()) component.currentlyInside.clear();
      components.clear();
      states.delete(world);
    },
  };
  states.set(world, state);
  return state;
}

/** Sphere-overlap triggers use authoritative transforms, independent of physics events. */
export function triggerDetectionSystem(world, eventBus) {
  const { actors, zones, components, exit } = setupTriggerDetection(world, eventBus);
  for (const zone of zones) {
    const component = components.get(zone);
    for (const actor of [...component.currentlyInside]) {
      if (!actors.has(actor)) exit(zone, component, actor);
    }
    for (const actor of actors) {
      // Event callbacks may remove the current zone or actor.
      if (!zones.has(zone)) break;
      const radius = (actor.triggerDetector.radius ?? 1) + (component.radius ?? 1);
      const a = actor.transform.position, b = zone.transform.position;
      const inside = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2 < radius * radius;
      if (inside && !component.currentlyInside.has(actor)) {
        component.currentlyInside.add(actor);
        eventBus.emit("trigger-entered", { triggerable: actor, trigger: zone, triggerType: component.type ?? "generic" });
      } else if (!inside) exit(zone, component, actor);
    }
  }
}
