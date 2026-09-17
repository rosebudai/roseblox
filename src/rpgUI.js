/** Project shared lifecycle data into presentation values without choosing a layout. */
export function createRpgView(state, actions, labels = {}) {
  const label = (key, fallback) => labels[key] ?? fallback;
  const button = (id, text, action, disabled = false) => ({ id, label: text, action, disabled });
  let panel = null;
  switch (state.phase) {
    case "loading": panel = { title: label("loading", "Loading…"), body: "", actions: [] }; break;
    case "error": panel = { title: label("error", "Unable to load"), body: state.error,
      actions: [button("retry", label("retry", "Retry"), actions.restart)] }; break;
    case "ready": case "paused": panel = { title: state.title, body: state.description,
      actions: [button("play", label(state.phase === "ready" ? "play" : "resume", state.phase === "ready" ? "Play" : "Resume"), actions.play),
        ...(state.phase === "paused" ? [button("restart", label("restart", "Restart"), actions.restart)] : [])] }; break;
    case "dead": panel = { title: label("dead", "Defeated"), body: state.deathText,
      actions: [button("respawn", label("respawn", "Respawn"), actions.respawn), button("restart", label("restart", "Restart"), actions.restart)] }; break;
    case "dialogue": panel = { title: state.dialogue.title, body: state.dialogue.text,
      actions: [...state.dialogue.choices.map(choice => button(choice.id, choice.label, () => actions.chooseDialogue(choice.id), state.dialogue.busy)),
        button("close", label("close", "Close"), actions.closeDialogue)] }; break;
  }
  return {
    ...state, actions, panel, playing: state.phase === "playing", menu: ["ready", "paused"].includes(state.phase),
    healthText: `${Math.ceil(state.health)} / ${state.maxHealth}`,
    healthFraction: state.maxHealth > 0 ? Math.max(0, Math.min(1, state.health / state.maxHealth)) : 0,
    interactionText: state.interaction ? `F · ${state.interaction.action} ${state.interaction.name}` : "",
    questLog: state.quests.filter(q => ["active", "completed"].includes(q.state)).map(q => ({
      ...q, completed: q.state === "completed", objectives: q.objectives.map((objective, index) => {
        const goal = objective.count ?? 1, progress = Math.min(q.progress[index] ?? 0, goal);
        return { ...objective, id: index, goal, progress, completed: progress >= goal,
          text: `${objective.label ?? objective.target ?? objective.item ?? "Objective"} · ${progress}/${goal}` };
      }),
    })),
    abilities: state.abilities.map(a => ({ ...a, id: a.slot ?? a.key, action: a.activate,
      disabled: state.phase !== "playing" || a.remaining > 0, cooldownText: a.remaining > 0 ? `${a.remaining.toFixed(1)}s` : "" })),
  };
}

function valueAt(value, path) {
  for (const key of path.split(".")) {
    if (value == null || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

/** Bind authored DOM to RPG state; repeated items retain their elements and focus. */
export function bindRpgUI({ root, actions, bindAction, createControlsLegend }, { labels = {}, extend } = {}) {
  let disposed = false;
  function compile(element) {
    const bindings = [];
    let current;
    for (const name of ["text", "show", "value", "max", "disabled", "fill"]) {
      const path = element.getAttribute(`data-rpg-${name}`);
      if (path === null) continue;
      const display = element.style.getPropertyValue("display"), priority = element.style.getPropertyPriority("display");
      let previous = Symbol();
      bindings.push(state => {
        const value = valueAt(state, path);
        if (value === previous) return;
        previous = value;
        if (name === "text") element.textContent = value == null ? "" : String(value);
        else if (name === "show") {
          element.hidden = !value;
          if (!value) element.style.setProperty("display", "none", "important");
          else if (display) element.style.setProperty("display", display, priority);
          else element.style.removeProperty("display");
        } else if (name === "fill") element.style.width = `${Math.max(0, Math.min(1, Number(value) || 0)) * 100}%`;
        else if (name === "disabled") element.disabled = !!value;
        else element[name] = Number(value) || 0;
      });
    }
    const action = element.getAttribute("data-rpg-action");
    if (action !== null) bindAction(element, event => {
      const callback = valueAt(current, action);
      if (!disposed && typeof callback === "function") return callback(event);
    });
    if (element.hasAttribute("data-rpg-controls")) element.append(createControlsLegend());
    const list = element.getAttribute("data-rpg-list");
    const children = [...element.children].filter(child => child.tagName !== "TEMPLATE").map(compile);
    const items = new Map();
    let template;
    if (list !== null) {
      template = [...element.children].find(child => child.tagName === "TEMPLATE");
      if (!template || template.content.children.length !== 1) throw new Error(`UI list ${list} needs a template with one root element.`);
    }
    return state => {
      current = state;
      for (const binding of bindings) binding(state);
      for (const child of children) child(state);
      if (list === null) return;
      const values = valueAt(state, list) ?? [], keys = new Set();
      // Insert only when order changes: moving the focused node every tick loses focus.
      let previous = template;
      for (const [index, item] of values.entries()) {
        const key = item.id ?? index;
        if (keys.has(key)) throw new Error(`Duplicate UI key in ${list}: ${key}`);
        keys.add(key);
        let entry = items.get(key);
        if (!entry) {
          const node = template.content.firstElementChild.cloneNode(true);
          entry = { node, update: compile(node) }; items.set(key, entry);
        }
        if (previous.nextElementSibling !== entry.node) previous.after(entry.node);
        entry.update(item); previous = entry.node;
      }
      for (const [key, entry] of items) if (!keys.has(key)) { entry.node.remove(); items.delete(key); }
    };
  }
  const update = compile(root);
  return {
    update(state) {
      if (disposed) return;
      const view = createRpgView(state, actions, labels);
      update(extend ? { ...view, ...extend(state, view) } : view);
    },
    dispose() { disposed = true; root.replaceChildren(); },
  };
}
