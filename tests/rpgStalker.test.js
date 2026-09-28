import test from "node:test";
import assert from "node:assert/strict";
import { stalkerSenses, stepStalker } from "../src/rpgStalker.js";

const run = (state, senses, seconds, def, hz = 60) => { for (let i = 0; i < Math.round(seconds * hz); i++) state = stepStalker(state, senses, 1 / hz, def); return state; };

test("stalker senses need a clear sight cone; hiding and sneaking reduce detection", () => {
  const seen = input => stalkerSenses({ distance: 8, bearing: .3, clear: true, ...input }).seen;
  assert.equal(seen({}), true);
  assert.equal(seen({ bearing: 1.2 }), false, "outside the 100° cone");
  assert.equal(seen({ clear: false }), false, "a wall blocks sight");
  assert.equal(seen({ distance: 20 }), false, "beyond sight range");
  assert.equal(seen({ hidden: true }), false);
  assert.equal(seen({ hidden: true, mode: "chase", distance: 1.5 }), true, "a close chaser sees the player hide");
  const heard = input => stalkerSenses({ distance: 5, bearing: Math.PI, clear: true, moving: true, ...input }).heard;
  assert.equal(heard({}), true); assert.equal(heard({ sneaking: true }), false); assert.equal(heard({ moving: false }), false);
  assert.equal(heard({ distance: 8, running: true }), true, "running carries farther");
  const rate = input => stalkerSenses({ distance: 8, bearing: 0, clear: true, ...input }).rate;
  assert.ok(rate({ running: true }) > rate({}) && rate({}) > rate({ sneaking: true }));
});

test("stalker threat builds to a chase, a lost chase searches, then it returns to patrol", () => {
  const def = { notice: 1.5, loseAfter: 2 }, walking = { seen: true, heard: false, rate: 1 }, nothing = {};
  let state = run(undefined, walking, .5, def);
  assert.equal(state.mode, "suspicious"); assert.ok(state.threat > .3 && state.threat < .4);
  state = run(state, nothing, .5, def);
  assert.equal(state.mode, "suspicious", "threat decays gradually"); assert.ok(state.threat < .3);
  state = run(state, nothing, 2, def); assert.deepEqual(state, { mode: "patrol", threat: 0, searchLeft: 0 });
  state = run(state, walking, 1.6, def); assert.equal(state.mode, "chase");
  state = run(state, { heard: true }, 3, def); assert.equal(state.mode, "chase", "hearing keeps a chase going");
  state = run(state, nothing, 1, def); assert.equal(state.mode, "search");
  assert.equal(run(state, { seen: true, rate: .5 }, 1 / 60, def).mode, "chase", "being seen while searched for restarts the chase at once");
  state = run(state, nothing, 1.1, def); assert.deepEqual(state, { mode: "patrol", threat: 0, searchLeft: 0 });
});

test("a chase rides out a moment without contact instead of flapping through a search", () => {
  const def = { loseAfter: 2 }, seen = { seen: true, rate: 1 };
  let state = run(undefined, seen, 2, def), modes = new Set();
  assert.equal(state.mode, "chase");
  for (let i = 0; i < 60; i++) { state = stepStalker(state, i % 2 ? seen : {}, 1 / 60, def); modes.add(state.mode); }
  assert.deepEqual([...modes], ["chase"], "alternating contact keeps one chase");
  state = run(state, {}, .3, def); assert.equal(state.mode, "chase", "a short occlusion is not a lost chase");
  state = run(state, seen, 1 / 60, def); state = run(state, {}, .6, def);
  assert.equal(state.mode, "search");
  state = run(state, {}, 1.3, def); assert.equal(state.mode, "search");
  state = run(state, {}, .2, def); assert.equal(state.mode, "patrol", "the search ends loseAfter after the last contact");
});
