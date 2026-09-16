/** Suspension reasons compose: closing a dialogue cannot clear focus/death/pause. */
export function createRpgSession({ suspend, resume, changed = () => {} }) {
  const reasons = new Set(["ready"]);
  let disposed = false;
  function sync() {
    if (disposed || reasons.size) suspend(); else resume();
    changed();
  }
  return {
    get playing() { return !disposed && reasons.size === 0; },
    get reasons() { return [...reasons]; },
    hold(reason) { if (!disposed) { reasons.add(reason); sync(); } },
    release(reason) { reasons.delete(reason); sync(); },
    dispose() { disposed = true; sync(); },
  };
}

/** Small event-driven quest ledger. Rewards are claimed once, delivery consumes items. */
export function createRpgProgress(definitions = [], { changed = () => {} } = {}) {
  const quests = new Map(), inventory = new Map();
  let currency = 0;
  for (const def of definitions) {
    if (!def.id || quests.has(def.id)) throw new Error("Quest IDs must be present and unique.");
    if (!def.objectives?.length) throw new Error(`Quest ${def.id} needs objectives.`);
    for (const objective of def.objectives) {
      if (!["talk", "visit", "collect", "defeat", "deliver", "custom"].includes(objective.type)) throw new Error(`Unsupported objective ${objective.type}.`);
      if (!Number.isInteger(objective.count ?? 1) || (objective.count ?? 1) <= 0) throw new Error("Objective counts must be positive integers.");
    }
    quests.set(def.id, { ...def, state: "available", progress: def.objectives.map(() => 0) });
  }
  for (const q of quests.values()) for (const id of q.requires ?? []) if (!quests.has(id)) throw new Error(`Unknown prerequisite ${id}.`);
  function get(id) { const q = quests.get(id); if (!q) throw new Error(`Unknown quest ${id}.`); return q; }
  function complete(q) {
    if (q.objectives.every((o, i) => q.progress[i] >= (o.count ?? 1))) q.state = "completed";
  }
  function event(type, target, count = 1) {
    if (!Number.isInteger(count) || count <= 0) throw new Error("Event count must be positive.");
    for (const q of quests.values()) {
      if (q.state !== "active") continue;
      q.objectives.forEach((o, i) => {
        if (o.type !== type || (o.target ?? o.item) !== target) return;
        if (q.ordered && q.objectives.some((before, j) => j < i && q.progress[j] < (before.count ?? 1))) return;
        q.progress[i] = Math.min(o.count ?? 1, q.progress[i] + count);
      });
      complete(q);
    }
    changed();
  }
  const api = {
    get currency() { return currency; },
    get quests() { return [...quests.values()].map(q => ({ ...q, progress: [...q.progress] })); },
    count: id => inventory.get(id) ?? 0,
    accept(id) {
      const q = get(id);
      if (q.state !== "available" || (q.requires ?? []).some(id => get(id).state !== "claimed")) return false;
      q.state = "active"; changed(); return true;
    },
    event,
    collect(id, count = 1) {
      if (!Number.isInteger(count) || count <= 0) throw new Error("Item count must be positive.");
      inventory.set(id, api.count(id) + count); event("collect", id, count);
    },
    deliver(target) {
      for (const q of quests.values()) {
        if (q.state !== "active") continue;
        q.objectives.forEach((o, i) => {
          if (o.type !== "deliver" || o.target !== target) return;
          if (q.ordered && q.objectives.some((before, j) => j < i && q.progress[j] < (before.count ?? 1))) return;
          const amount = Math.min((o.count ?? 1) - q.progress[i], api.count(o.item));
          inventory.set(o.item, api.count(o.item) - amount); q.progress[i] += amount;
        });
        complete(q);
      }
      changed();
    },
    claim(id) {
      const q = get(id); if (q.state !== "completed") return false;
      q.state = "claimed"; currency += q.reward?.currency ?? 0;
      for (const [item, count] of Object.entries(q.reward?.items ?? {})) api.collect(item, count);
      changed(); return true;
    },
  };
  return api;
}
