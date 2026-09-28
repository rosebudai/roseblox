import test from "node:test";
import assert from "node:assert/strict";
import { createHud, createVoxelHud } from "../src/hud.js";

// Minimal DOM boundary for presentation state/lifetime contracts, not layout.
// Browser coverage must separately verify computed styling and real interaction.
class Node extends EventTarget {
  constructor(tag, document) {
    super(); this.tagName = tag; this.ownerDocument = document; this.children = [];
    this.style = { position: "", setProperty(name, value) { this[name] = value; } };
    this.dataset = {}; this.attributes = {}; this.className = ""; this.id = ""; this._text = "";
  }
  set innerHTML(_) { throw new Error("HUD must build text-safe DOM, not parse HTML"); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(""); }
  setAttribute(name, value) { this.attributes[name] = value; }
  appendChild(node) { node.parentElement = this; this.children.push(node); return node; }
  append(...nodes) { for (const node of nodes) this.appendChild(node); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
  focus() { this.ownerDocument.activeElement = this; }
}
function documentFixture() {
  const document = { defaultView: { getComputedStyle: node => ({ position: node.style.position || "static" }) } };
  document.createElement = tag => new Node(tag, document);
  document.body = document.createElement("body");
  document.getElementById = id => walk(document.body).find(node => node.id === id) ?? null;
  return document;
}
function walk(node) { return [node, ...node.children.flatMap(walk)]; }
function fixture(document = documentFixture(), parent = document.body) {
  const canvas = document.createElement("canvas"); parent.appendChild(canvas);
  const resources = new Map();
  const game = {
    renderer: { domElement: canvas }, starts: 0,
    engine: { initialized: true, disposed: false, addResource(name, value) { assert.equal(resources.has(name), false); resources.set(name, value); } },
    start() { this.starts++; },
    dispose() { this.engine.disposed = true; for (const resource of [...resources.values()].reverse()) resource.dispose(); },
  };
  return { game, document, canvas, parent, resources };
}
const ids = prefix => ({ score: `${prefix}-score`, status: `${prefix}-status`, start: `${prefix}-start`, restart: `${prefix}-restart` });

test("FPS readouts retain IDs and messages cannot change terminal state", () => {
  const { game } = fixture();
  const hud = createHud(game, { stats: { health: { value: 100, position: "bottom-left" }, ammo: { value: 8, position: "bottom-right" } } });
  assert.equal(hud.elements.stats.health.parentElement, hud.elements.slots["bottom-left"]);
  assert.equal(hud.elements.stats.ammo.parentElement, hud.elements.slots["bottom-right"]);
  hud.setState("won", "Complete"); hud.setMessage("Sound off");
  assert.equal(hud.elements.root.dataset.state, "won"); assert.equal(hud.elements.status.textContent, "Complete");
  assert.equal(hud.elements.message.textContent, "Sound off");
  hud.setState("playing"); assert.equal(hud.elements.message.textContent, "");
  game.dispose();
});

test("standalone named readouts and messages remain literal text, with scoped visual tokens", () => {
  const { game, document } = fixture();
  const hostile = '<img src=x onerror="throw 1">';
  const hud = createHud(game, {
    title: hostile, objective: hostile, controls: hostile, crosshair: true,
    stats: { health: { label: "Hull", value: 100 }, ammo: { label: hostile, value: "8 / 32", id: "ammo-count" } },
    theme: { font: "serif", accent: "#ff0000", radius: "0px" },
  });
  hud.setStat("health", 0); hud.setStat("ammo", hostile); hud.setState("playing", hostile);
  assert.equal(hud.elements.stats.health.textContent, "Hull: 0");
  assert.equal(hud.elements.stats.ammo.textContent, `${hostile}: ${hostile}`);
  assert.equal(hud.elements.status.textContent, hostile);
  assert.equal(document.getElementById("ammo-count"), hud.elements.stats.ammo);
  assert.equal(walk(hud.elements.root).some(node => node.tagName === "img"), false);
  assert.equal(hud.elements.root.style["--rb-font"], "serif");
  assert.equal(hud.elements.root.style["--rb-accent"], "#ff0000");
  assert.equal(hud.elements.crosshair.attributes["aria-hidden"], "true");
  assert.equal(hud.elements.root.dataset.state, "playing");
  assert.throws(() => hud.setStat("missing", 1), /Unknown HUD stat/);
  assert.throws(() => hud.setStat("health", NaN), /finite/);
  assert.throws(() => hud.setStat("ammo", {}), /strings or finite/);
  game.dispose(); assert.equal(document.getElementById("ammo-count"), null);
});

test("voxel delegate preserves score, defaults and synchronous Start/Restart callbacks", () => {
  const { game, canvas } = fixture(); const seen = [];
  const hud = createVoxelHud(game, { scoreLabel: "Crystals", onStart: () => seen.push("start"), onRestart: () => seen.push("restart") });
  assert.match(hud.elements.root.className, /rb-voxel-hud/);
  assert.equal(walk(hud.elements.root).find(node => node.tagName === "h1").textContent, "VOXEL QUEST");
  assert.equal(hud.elements.root.style["--rb-font"], "ui-monospace,monospace");
  assert.equal(hud.elements.root.style["--rb-border-width"], "3px");
  assert.equal(hud.elements.root.style["--rb-shadow"], "4px 4px #253429");
  assert.equal(hud.elements.root.style["--rb-button-shadow"], "4px 4px #563c29");
  assert.equal(hud.elements.start.textContent, "Enter world");
  assert.equal(hud.elements.score.textContent, "Crystals: 0");
  assert.equal(hud.elements.score.id, "score");
  hud.setScore(2, 3); assert.equal(hud.elements.score.textContent, "Crystals: 2 / 3");
  hud.elements.start.dispatchEvent(new Event("click"));
  assert.deepEqual(seen, ["start"]); assert.equal(game.starts, 1);
  assert.equal(hud.elements.root.dataset.state, "playing");
  assert.equal(canvas.ownerDocument.activeElement, canvas);
  hud.setState("won", "You won"); assert.equal(hud.elements.status.textContent, "You won");
  hud.elements.restart.dispatchEvent(new Event("click"));
  assert.deepEqual(seen, ["start", "restart"]); assert.equal(game.starts, 2);
  hud.dispose(); hud.dispose();
  hud.elements.start.dispatchEvent(new Event("click"));
  hud.elements.restart.dispatchEvent(new Event("click"));
  assert.equal(game.starts, 2, "disposed controls cannot invoke callbacks or restart a game");
});

test("two games sharing a mount retain independent HUD ownership and restore the mount after the last disposal", () => {
  const document = documentFixture();
  const one = fixture(document), two = fixture(document);
  const first = createHud(one.game, { ids: ids("one"), theme: { accent: "red" } });
  const second = createHud(two.game, { ids: ids("two"), theme: { accent: "blue" } });
  assert.equal(document.body.style.position, "relative");
  one.game.dispose();
  assert.equal(document.getElementById("one-score"), null);
  assert.equal(document.getElementById("two-score"), second.elements.score);
  assert.equal(document.body.style.position, "relative", "first disposal must not break remaining HUD positioning");
  assert.equal(second.elements.root.style["--rb-accent"], "blue");
  second.setScore(7); assert.equal(second.elements.score.textContent, "Score: 7");
  first.setScore(99); assert.equal(first.elements.score.textContent, "Score: 0");
  two.game.dispose(); assert.equal(document.body.style.position, "");
  const third = fixture(document);
  const hud = createHud(third.game); document.body.style.position = "absolute";
  hud.dispose(); assert.equal(document.body.style.position, "absolute", "caller replacement mount style must be preserved");
});

test("invalid IDs, readouts and themes reject before changing DOM or mount state", () => {
  const { game, parent } = fixture();
  for (const options of [
    { ids: { status: "start" } }, { ids: { score: "not valid" } },
    { stats: { start: { value: 2 } } }, { stats: { health: { value: Infinity } } },
    { theme: { unknown: "red" } }, { theme: { accent: {} } }, { onStart: true },
  ]) assert.throws(() => createHud(game, options));
  assert.equal(parent.children.length, 1); assert.equal(parent.style.position, "");
  const hud = createHud(game);
  assert.throws(() => createHud(game), /unused #/);
  assert.equal(parent.children.length, 2);
  hud.dispose(); const replacement = createHud(game); replacement.dispose();
  game.dispose(); assert.throws(() => createHud(game), /live, initialized/);
});

test("minimal HUD leaves play status quiet while retaining explicit feedback, outcomes and theme overrides", () => {
  const { game } = fixture();
  const hud = createHud(game, { preset: "minimal", theme: { accent: "white" } });
  hud.elements.start.dispatchEvent(new Event("click"));
  assert.equal(hud.elements.status.textContent, "");
  assert.equal(hud.elements.root.style["--rb-accent"], "white");
  hud.setMessage("Reloading"); assert.equal(hud.elements.message.textContent, "Reloading");
  hud.setState("lost", "Out of health");
  assert.equal(hud.elements.status.textContent, "Out of health");
  assert.equal(hud.elements.message.textContent, "");
  hud.dispose();
  const classic = createHud(game); classic.setState("playing");
  assert.equal(classic.elements.status.textContent, "Go!");
  game.dispose();
});
