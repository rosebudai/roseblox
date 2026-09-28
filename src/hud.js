const lifetimes = new WeakMap();
const mounts = new WeakMap();
const identifier = /^[A-Za-z][\w-]*$/;
const neutral = {
  font: "system-ui,sans-serif", text: "#eef6ff", accent: "#8edcff", panel: "#111c2be8",
  border: "#648297", borderWidth: "1px", radius: "3px", shadow: "0 2px 12px #0006",
  buttonBackground: "#234256", buttonText: "#eef6ff", buttonBorder: "#8edcff",
  buttonShadow: "0 2px 8px #0004", textShadow: "0 1px 3px #0008", titleShadow: "0 2px 8px #0008",
};
const voxel = {
  font: "ui-monospace,monospace", text: "#fff5d6", accent: "#ffda73", panel: "#253a2be8",
  border: "#bbaa73", borderWidth: "3px", radius: "0px", shadow: "4px 4px #253429",
  buttonBackground: "#dcb65a", buttonText: "#26392b", buttonBorder: "#fff0a1",
  buttonShadow: "4px 4px #563c29", textShadow: "2px 2px #26362a", titleShadow: "4px 4px #26362a",
};
const minimal = {
  font: "ui-monospace,monospace", text: "#e8e4d8", accent: "#efc877", panel: "transparent",
  borderWidth: "0px", radius: "0px", shadow: "none", buttonBackground: "#192127e6",
  buttonText: "#efc877", buttonShadow: "none", textShadow: "0 1px 3px #000,0 0 5px #0009",
  titleShadow: "0 2px 5px #000b",
};
const css = `
.rb-hud{position:absolute;inset:0;pointer-events:none;color:var(--rb-text);font:700 14px var(--rb-font);text-shadow:var(--rb-text-shadow);z-index:5}
.rb-hud .rb-bar{position:absolute;top:18px;left:18px;border:var(--rb-border-width) solid var(--rb-border);border-radius:var(--rb-radius);box-shadow:var(--rb-shadow);background:var(--rb-panel);padding:9px 13px;max-width:56%;box-sizing:border-box;overflow-wrap:anywhere}
.rb-hud .rb-score{font-size:20px;color:var(--rb-accent)}.rb-hud .rb-stat{font-size:14px;line-height:1.5;color:var(--rb-accent)}.rb-hud .rb-objective{font-size:11px;line-height:1.5;margin-top:4px}
.rb-hud .rb-menu{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);text-align:center;width:min(88%,460px)}
.rb-hud .rb-feedback{position:absolute;right:18px;top:18px;text-align:right;max-width:32%;overflow-wrap:anywhere}.rb-hud .rb-feedback button{padding:7px 12px;font-size:11px}.rb-hud .rb-feedback .rb-status{margin:0 0 10px}
.rb-hud h1{font-size:clamp(25px,5vw,45px);line-height:1.05;letter-spacing:3px;text-shadow:var(--rb-title-shadow);margin:0 0 16px}.rb-hud .rb-status{margin:10px;font-size:17px}
.rb-hud button{pointer-events:auto;cursor:pointer;border:var(--rb-border-width) solid var(--rb-button-border);border-radius:var(--rb-radius);box-shadow:var(--rb-button-shadow);background:var(--rb-button-background);color:var(--rb-button-text);padding:11px 24px;font:700 14px var(--rb-font);text-transform:uppercase}
.rb-hud button:focus-visible{outline:3px solid white;outline-offset:4px}.rb-hud .rb-keys{position:absolute;bottom:14px;left:12px;right:12px;text-align:center;font-size:11px}
.rb-hud[data-state=playing] .rb-menu{display:none}.rb-hud[data-state=ready] .rb-restart{display:none}.rb-hud[data-state=won] .rb-start,.rb-hud[data-state=lost] .rb-start{display:none}
.rb-hud .rb-crosshair{position:absolute;left:50%;top:50%;width:18px;height:18px;transform:translate(-50%,-50%);color:var(--rb-accent);display:none}
.rb-hud .rb-crosshair:before,.rb-hud .rb-crosshair:after{content:"";position:absolute;background:currentColor;box-shadow:0 0 2px #000}
.rb-hud .rb-crosshair:before{width:18px;height:2px;top:8px}.rb-hud .rb-crosshair:after{height:18px;width:2px;left:8px}.rb-hud[data-state=playing] .rb-crosshair{display:block}
.rb-hud .rb-bottom-left,.rb-hud .rb-bottom-right{position:absolute;bottom:44px;max-width:44%;overflow-wrap:anywhere;padding:8px 12px;background:var(--rb-panel);border-left:var(--rb-border-width) solid var(--rb-accent)}
.rb-hud .rb-bottom-left{left:18px}.rb-hud .rb-bottom-right{right:18px;text-align:right;border-left:0;border-right:var(--rb-border-width) solid var(--rb-accent)}
.rb-hud .rb-bottom-left .rb-stat,.rb-hud .rb-bottom-right .rb-stat{font-size:clamp(16px,3vw,28px);line-height:1.25}
.rb-hud .rb-message{font-size:12px;line-height:1.5}.rb-hud .rb-message:empty{display:none}
.rb-hud.rb-minimal-hud .rb-bar,.rb-hud.rb-minimal-hud .rb-bottom-left,.rb-hud.rb-minimal-hud .rb-bottom-right{padding:0}
.rb-hud.rb-minimal-hud .rb-bottom-left,.rb-hud.rb-minimal-hud .rb-bottom-right{bottom:20px}
.rb-hud.rb-minimal-hud .rb-objective{opacity:.85}
.rb-hud.rb-minimal-hud[data-state=playing] .rb-keys,.rb-hud.rb-minimal-hud[data-state=playing] .rb-restart{display:none}
`;

/** Responsive, game-owned DOM presentation. Values are text, never HTML. */
export function createHud(game, options = {}) { return makeHud(game, options, false); }

/** Compatibility delegate; the optional voxel kit retains its original appearance. */
export function createVoxelHud(game, options = {}) { return makeHud(game, options, true); }

function makeHud(game, {
  title, objective = "Explore the world", scoreLabel = "Score", controls,
  ids = {}, stats, theme = {}, preset = "default", crosshair = false, onStart, onRestart,
} = {}, isVoxel) {
  if (!game?.engine?.initialized || game.engine.disposed) throw new Error("createHud needs a live, initialized game.");
  if (!["default", "minimal"].includes(preset)) throw new Error("HUD preset must be default or minimal.");
  for (const callback of [onStart, onRestart]) if (callback !== undefined && typeof callback !== "function") throw new Error("HUD callbacks must be functions.");
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) throw new Error("HUD theme must be a visual-token object.");
  for (const [key, value] of Object.entries(theme)) {
    if (!Object.hasOwn(neutral, key)) throw new Error(`Unknown HUD theme token '${key}'.`);
    if (typeof value !== "string" || !value.trim()) throw new Error(`HUD theme token '${key}' must be a CSS value string.`);
  }
  const descriptors = stats === undefined ? { score: { label: scoreLabel, value: 0 } } : stats;
  if (!descriptors || typeof descriptors !== "object" || Array.isArray(descriptors)) throw new Error("HUD stats must be a named readout object.");
  const readouts = new Map();
  const elementIds = { status: "status", start: "start", restart: "restart", ...ids };
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (!identifier.test(name) || !descriptor || typeof descriptor !== "object") throw new Error("HUD stats need valid names and {label,value,id?} descriptors.");
    if (["status", "start", "restart"].includes(name)) throw new Error(`HUD stat name '${name}' is reserved for a control.`);
    const value = descriptor.value ?? 0;
    checkValue(value);
    const position = descriptor.position ?? "panel";
    if (!["panel", "bottom-left", "bottom-right"].includes(position)) throw new Error("HUD stat position must be panel, bottom-left or bottom-right.");
    readouts.set(name, { label: String(descriptor.label ?? name), value, position });
    elementIds[name] = descriptor.id ?? ids[name] ?? name;
  }
  const usedIds = Object.values(elementIds);
  const canvas = game.renderer.domElement;
  const document = canvas.ownerDocument;
  if (new Set(usedIds).size !== usedIds.length) throw new Error("HUD element IDs must be unique.");
  for (const id of usedIds) {
    if (typeof id !== "string" || !identifier.test(id)) throw new Error("HUD IDs must start with a letter and contain only letters, digits, hyphens or underscores.");
    if (document.getElementById(id)) throw new Error(`HUD needs an unused #${id}. Supply unique ids or use your existing UI.`);
  }
  const parent = canvas.parentElement;
  if (!parent) throw new Error("Attach the canvas before creating its HUD.");
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const root = element("div", `rb-hud${isVoxel ? " rb-voxel-hud" : ""}${preset === "minimal" ? " rb-minimal-hud" : ""}`);
  root.dataset.state = "ready";
  for (const [key, value] of Object.entries({ ...(isVoxel ? voxel : neutral), ...(preset === "minimal" ? minimal : {}), ...theme })) {
    root.style.setProperty(`--rb-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value);
  }
  const style = element("style", null, css);
  const bar = element("div", "rb-bar");
  const objectiveNode = element("div", "rb-objective", objective);
  const menu = element("div", "rb-menu");
  const heading = element("h1", null, title ?? (isVoxel ? "VOXEL QUEST" : "Game"));
  const startButton = element("button", "rb-start", isVoxel ? "Enter world" : "Start");
  const feedback = element("div", "rb-feedback");
  const status = element("div", "rb-status", "Ready?");
  const message = element("div", "rb-message", "");
  const restartButton = element("button", "rb-restart", "Restart");
  startButton.type = restartButton.type = "button";
  const keys = element("div", "rb-keys", controls ?? (isVoxel ? "WASD move · Space jump · Drag look · Scroll zoom" : ""));
  const slots = { panel: bar };
  const elements = { root, bar, objective: objectiveNode, controls: keys, status, message, start: startButton, restart: restartButton, stats: Object.create(null), slots };
  for (const name of ["status", "start", "restart"]) elements[name].id = elementIds[name];
  for (const [name, descriptor] of readouts) {
    const node = element("div", name === "score" ? "rb-score" : "rb-stat", `${descriptor.label}: ${descriptor.value}`);
    node.id = elementIds[name]; node.setAttribute("aria-live", "polite");
    elements.stats[name] = node;
    if (name === "score") elements.score = node;
    if (!slots[descriptor.position]) slots[descriptor.position] = element("div", `rb-${descriptor.position}`);
    slots[descriptor.position].appendChild(node);
  }
  bar.appendChild(objectiveNode); menu.append(heading, startButton); feedback.append(status, message, restartButton);
  root.append(style, bar, menu, feedback, keys);
  for (const [name, slot] of Object.entries(slots)) if (name !== "panel") root.appendChild(slot);
  if (crosshair) {
    elements.crosshair = element("div", "rb-crosshair");
    elements.crosshair.setAttribute("aria-hidden", "true");
    root.appendChild(elements.crosshair);
  }
  let lifetime = lifetimes.get(game);
  if (!lifetime) {
    lifetime = new Set();
    game.engine.addResource("hudPresentation", { dispose() { for (const hud of [...lifetime]) hud.dispose(); } });
    lifetimes.set(game, lifetime);
  }
  let mount = mounts.get(parent);
  if (!mount) {
    mount = { count: 0, original: parent.style.position, changed: document.defaultView.getComputedStyle(parent).position === "static" };
    if (mount.changed) parent.style.position = "relative";
    mounts.set(parent, mount);
  }
  mount.count++;
  parent.appendChild(root);
  let disposed = false;
  const api = {
    elements,
    setStat(name, value) {
      if (disposed) return;
      if (!readouts.has(name)) throw new Error(`Unknown HUD stat '${name}'. Define it in stats first.`);
      checkValue(value);
      elements.stats[name].textContent = `${readouts.get(name).label}: ${value}`;
    },
    setScore(value, total) {
      if (disposed) return;
      if (!Number.isFinite(value) || (total !== undefined && !Number.isFinite(total))) throw new Error("HUD score and total must be finite numbers.");
      api.setStat("score", `${value}${total === undefined ? "" : ` / ${total}`}`);
    },
    setState(state, message) {
      if (disposed) return;
      if (!["ready", "playing", "won", "lost"].includes(state)) throw new Error("HUD state must be ready, playing, won, or lost.");
      root.dataset.state = state;
      elements.message.textContent = "";
      status.textContent = String(message ?? ({ ready: "Ready?", playing: preset === "minimal" ? "" : "Go!", won: "You won", lost: "Try again" })[state]);
    },
    /** Transient feedback never changes the round presentation or hides its controls. */
    setMessage(text) { if (!disposed) elements.message.textContent = String(text ?? ""); },
    dispose() {
      if (disposed) return;
      disposed = true;
      startButton.removeEventListener("click", start);
      restartButton.removeEventListener("click", restart);
      root.remove(); lifetime.delete(api);
      if (--mount.count === 0) {
        if (mount.changed && parent.style.position === "relative") parent.style.position = mount.original;
        mounts.delete(parent);
      }
    },
  };
  const play = callback => { if (disposed) return; api.setState("playing"); callback?.(); game.start(); canvas.focus(); };
  const start = () => play(onStart), restart = () => play(onRestart);
  startButton.addEventListener("click", start); restartButton.addEventListener("click", restart);
  lifetime.add(api);
  return api;
}

function checkValue(value) {
  if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) throw new Error("HUD values must be strings or finite numbers.");
}
