import test from "node:test";
import assert from "node:assert/strict";
import { createRpgSession, createRpgProgress } from "../src/rpgSession.js";

test("dialogue suspension composes with pause, focus loss and disposal", () => {
  let active = false;
  const session = createRpgSession({ suspend: () => { active = false; }, resume: () => { active = true; } });
  session.release("ready"); assert.equal(active, true);
  session.hold("dialogue"); session.hold("focus"); session.release("dialogue"); assert.equal(active, false);
  session.release("focus"); assert.equal(active, true);
  session.hold("dialogue"); session.hold("pause"); session.release("dialogue"); assert.equal(active, false);
  session.release("pause"); assert.equal(active, true);
  session.dispose(); session.release("pause"); assert.equal(active, false);
});

test("accept, gather, return, deliver and claim advances once without combat", () => {
  const progress = createRpgProgress([{ id: "botany", giver: "gardener", ordered: true, objectives: [
    { type: "collect", item: "flower", count: 2 }, { type: "deliver", target: "gardener", item: "flower", count: 2 },
  ], reward: { currency: 9, items: { medal: 1 } } }]);
  assert.equal(progress.accept("botany"), true); assert.equal(progress.accept("botany"), false);
  progress.collect("flower"); progress.deliver("gardener"); assert.equal(progress.count("flower"), 1);
  progress.collect("flower"); progress.deliver("gardener");
  assert.equal(progress.quests[0].state, "completed"); assert.equal(progress.count("flower"), 0);
  assert.equal(progress.claim("botany"), true); assert.equal(progress.claim("botany"), false);
  assert.equal(progress.currency, 9); assert.equal(progress.count("medal"), 1);
});

test("quest prerequisites, counts and independent event targets do not award early", () => {
  const progress = createRpgProgress([
    { id: "scout", objectives: [{ type: "visit", target: "ridge" }, { type: "defeat", target: "guard", count: 2 }] },
    { id: "next", requires: ["scout"], objectives: [{ type: "talk", target: "friend" }] },
  ]);
  assert.equal(progress.accept("next"), false); progress.accept("scout");
  progress.event("visit", "other"); progress.event("defeat", "guard");
  assert.equal(progress.claim("scout"), false);
  progress.event("visit", "ridge"); progress.event("defeat", "guard"); progress.claim("scout");
  assert.equal(progress.accept("next"), true);
  assert.throws(() => progress.collect("x", -1));
});
