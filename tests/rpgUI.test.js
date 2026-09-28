import test from "node:test";
import assert from "node:assert/strict";
import { createRpgView } from "../src/rpgUI.js";

test("shared UI view exposes real lifecycle actions, progress and cooldown state", async () => {
  const called = [], actions = Object.fromEntries(["play", "restart", "respawn", "closeDialogue", "chooseDialogue"].map(name => [name, id => called.push([name, id])]));
  const state = { phase: "ready", title: "Adventure", description: "Explore", health: 24.4, maxHealth: 50, currency: 3,
    quests: [{ id: "q", title: "Quest", state: "active", objectives: [{ label: "Find relics", count: 2 }], progress: [1] }],
    abilities: [{ slot: 0, key: "1", name: "Strike", remaining: .35, activate: () => called.push(["strike"]) }], combatTargets: [], interaction: null };
  let view = createRpgView(state, actions, { play: "Set out" });
  assert.equal(view.panel.actions[0].label, "Set out");
  await view.panel.actions[0].action();
  assert.equal(view.healthText, "25 / 50");
  assert.equal(view.questLog[0].objectives[0].text, "Find relics · 1/2");
  assert.equal(view.abilities[0].disabled, true);
  view = createRpgView({ ...state, phase: "playing", abilities: [{ ...state.abilities[0], remaining: 0 }], interaction: { name: "Elder", action: "Talk to" } }, actions);
  assert.equal(view.panel, null); assert.equal(view.interactionText, "F · Talk to Elder");
  assert.equal(view.abilities[0].disabled, false); await view.abilities[0].action();
  view = createRpgView({ ...state, phase: "dialogue", dialogue: { title: "Elder", text: "Welcome", busy: true, choices: [{ id: "7:0", label: "Accept" }] } }, actions);
  assert.equal(view.panel.actions[0].disabled, true); await view.panel.actions[0].action(); await view.panel.actions[1].action();
  assert.deepEqual(called, [["play", undefined], ["strike"], ["chooseDialogue", "7:0"], ["closeDialogue", undefined]]);
  for (const [phase, ids] of [["loading", []], ["error", ["retry"]], ["paused", ["play", "restart"]], ["dead", ["respawn", "restart"]]]) {
    assert.deepEqual(createRpgView({ ...state, phase }, actions).panel.actions.map(a => a.id), ids);
  }
});
