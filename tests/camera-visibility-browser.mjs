import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.argv[2] ?? "http://127.0.0.1:8893";
const output = process.argv[3] ?? "/tmp/roseblox-camera-visibility";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/local/bin/chromium", headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const checks = [], errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
const sample = () => page.evaluate(() => window.visibilityTest.sample());
try {
  await page.goto(`${base}/examples/modern/`);
  await page.waitForFunction(() => window.exampleGame?.game.getDiagnostics().frames > 2);
  await page.evaluate(async () => {
    const { createGame, createVoxelKit } = await import("/build/roseblox.js");
    const THREE = await import("three");
    window.exampleGame.game.dispose(); document.querySelector("aside").remove();
    const game = await createGame({ canvas: document.querySelector("canvas"), gravity: { x: 0, y: 0, z: 0 } });
    const kit = createVoxelKit(game, { seed: 23 });
    kit.ground({ size: [30, 1, 30], position: [0, -.5, 0] });
    kit.scatter("trees", { count: 20, bounds: [-14, 14, -14, 14], exclude: [-5, 5, -8, 8] });
    const hero = kit.avatar(game.addPlayer({ position: [0, 1, 0], color: "#e3ae45" }));
    hero.player.enabled = false;
    const golem = kit.avatar(game.addBox({ size: [1.25, 2, 1.25], position: [0, 1, -4], body: "kinematic" }), { color: "#7b8179" });
    let heroDraws = 0, golemDraws = 0;
    hero.mesh.traverse(object => { if (object.isMesh) object.onBeforeRender = () => heroDraws++; });
    golem.mesh.traverse(object => { if (object.isMesh) object.onBeforeRender = () => golemDraws++; });
    const look = () => game.followCamera(hero, { offset: [0, 5.5, 8], lookOffset: [0, .6, 0] });
    const sample = () => {
      const spherical = game.controls.getSpherical(undefined, false);
      return { radius: spherical.radius, theta: spherical.theta, visible: hero.mesh.visible, golemVisible: golem.mesh.visible, heroDraws, golemDraws,
        camera: game.camera.position.toArray(), target: game.controls.getTarget(new THREE.Vector3()).toArray(), visualDistance: new THREE.Box3().setFromObject(hero.mesh).distanceToPoint(game.camera.position) };
    };
    const resetDraws = () => { heroDraws = 0; golemDraws = 0; };
    look(); window.visibilityTest = { game, kit, hero, golem, look, sample, resetDraws, THREE, createGame };
  });
  await page.waitForTimeout(150);
  const clear = await sample(); assert.equal(clear.visible, true); assert.ok(clear.heroDraws > 0);
  await page.screenshot({ path: `${output}/clear.png` });
  await page.evaluate(() => { const t = window.visibilityTest; t.wall = t.game.addBox({ size: [8, 8, 1], position: [0, 4, 1.05], color: "#56645c" }); });
  await page.waitForFunction(() => !window.visibilityTest.hero.mesh.visible);
  await page.evaluate(() => window.visibilityTest.resetDraws()); await page.waitForTimeout(120);
  const blocked = await sample();
  assert.ok(blocked.radius < 1 && blocked.visualDistance < .25);
  assert.equal(blocked.heroDraws, 0, "hidden avatar descendants must not be submitted to the actual camera renderer");
  assert.ok(blocked.golemVisible && blocked.golemDraws > 0, "the other actor remains rendered");
  await page.screenshot({ path: `${output}/near-wall.png` });
  checks.push({ name: "actual wall collision below dolly minimum hides only the followed visual", status: "pass", clear, blocked });

  await page.mouse.move(500, 350); await page.mouse.down();
  await page.mouse.move(850, 365, { steps: 15 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const orbited = await sample();
  assert.ok(Math.abs(orbited.theta - blocked.theta) > .5 && orbited.radius > 2);
  assert.equal(orbited.visible, true); assert.ok(orbited.heroDraws > 0);
  await page.screenshot({ path: `${output}/orbit-restored.png` });
  checks.push({ name: "real mouse orbit clears the wall and restores the followed avatar", status: "pass", orbited });

  await page.evaluate(() => { const t = window.visibilityTest; t.game.remove(t.wall); t.game.controls.minDistance = .1; t.look(); });
  await page.mouse.wheel(0, -3000);
  await page.waitForFunction(() => window.visibilityTest.sample().radius < .3, null, { timeout: 3000 });
  const zoomed = await sample(); assert.ok(zoomed.radius < .3, JSON.stringify(zoomed)); assert.equal(zoomed.visible, false);
  await page.mouse.wheel(0, 3000);
  await page.waitForFunction(() => window.visibilityTest.sample().radius > 3, null, { timeout: 3000 });
  const unzoomed = await sample(); assert.ok(unzoomed.radius > 3, JSON.stringify(unzoomed)); assert.equal(unzoomed.visible, true);
  checks.push({ name: "real wheel close-up and outward zoom hide and restore with a caller-configured close dolly limit", status: "pass", zoomed, unzoomed });

  // The paid arena diagnosis found the enemy overlapping the hero after loss.
  // Freeze physics for that fixture state, then run the normal frame systems
  // to process real orbit input without character depenetration.
  await page.evaluate(() => {
    const t = window.visibilityTest;
    t.game.stop(); t.game.teleport(t.golem, t.hero.transform.position);
    t.wall = t.game.addBox({ size: [8, 8, 1], position: [0, 4, 1.05], color: "#56645c" });
    t.look(); t.game.engine.update(0); t.resetDraws(); t.game.engine.update(0);
  });
  const overlap = await sample();
  assert.equal(overlap.visible, false); assert.equal(overlap.golemVisible, false);
  assert.equal(overlap.heroDraws, 0); assert.equal(overlap.golemDraws, 0);
  await page.screenshot({ path: `${output}/overlapping-actors-hidden.png` });
  await page.mouse.move(500, 350); await page.mouse.down();
  // camera-controls consumes at most one pointer delta per presentation frame.
  for (let step = 1; step <= 15; step++) {
    await page.mouse.move(500 + 350 * step / 15, 350 + step);
    await page.evaluate(() => { const engine = window.visibilityTest.game.engine; engine._runSystems("frame", 1 / 60); engine.render(); });
  }
  await page.mouse.up();
  await page.evaluate(() => { const engine = window.visibilityTest.game.engine; engine._runSystems("frame", 1 / 60); engine.render(); });
  const overlapClear = await sample();
  assert.ok(overlapClear.visible && overlapClear.golemVisible, JSON.stringify(overlapClear));
  assert.ok(overlapClear.heroDraws > 0 && overlapClear.golemDraws > 0);
  await page.screenshot({ path: `${output}/overlapping-actors-restored.png` });
  checks.push({ name: "actual wall-clamped overlapping hero and enemy both stop rendering and real orbit restores both", status: "pass", overlap, overlapClear });

  const lifecycle = await page.evaluate(async () => {
    const t = window.visibilityTest, { game, hero } = t;
    game.stop();
    game.followCamera(hero, { offset: [0, .6, .2], lookOffset: [0, .6, 0], mode: "fixed" }); game.engine.update(1 / 60);
    const fixedHidden = !hero.mesh.visible;
    game.releaseCamera(); const released = hero.mesh.visible;
    hero.mesh.visible = false;
    game.followCamera(hero, { offset: [0, .6, .2], lookOffset: [0, .6, 0], mode: "fixed" }); game.engine.update(1 / 60);
    game.releaseCamera(); const ownerHiddenPreserved = !hero.mesh.visible;
    hero.mesh.visible = true;
    game.followCamera(hero, { offset: [0, .6, .2], lookOffset: [0, .6, 0], mode: "fixed" }); game.engine.update(1 / 60);
    const canvas = document.createElement("canvas"); document.body.append(canvas);
    const other = await t.createGame({ canvas, autoStart: false });
    const otherTarget = other.addBox({ size: [2, 2, 2], body: "none" });
    other.followCamera(otherTarget, { offset: [0, 0, .2], lookOffset: [0, 0, 0], mode: "fixed" }); other.engine.update(1 / 60);
    const otherHiddenBefore = !otherTarget.mesh.visible;
    game.dispose(); const disposedRestored = hero.mesh.visible, isolated = !otherTarget.mesh.visible;
    other.remove(otherTarget); const removalRestored = otherTarget.mesh.visible; other.dispose(); canvas.remove();
    return { fixedHidden, released, ownerHiddenPreserved, otherHiddenBefore, disposedRestored, isolated, removalRestored };
  });
  assert.ok(Object.values(lifecycle).every(Boolean), JSON.stringify(lifecycle));
  checks.push({ name: "fixed-follow, release, caller-hidden, removal, disposal and two-game ownership", status: "pass", ...lifecycle });
  assert.deepEqual(errors, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ status: "pass", evidenceKind: "Assistant-authored current-engine regression, not a Rosie generation sample", checks, errors }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "pass", checks: checks.map(check => check.name), errors }));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/result.json`, JSON.stringify({ status: "fail", error: String(error), checks, errors }, null, 2) + "\n");
  throw error;
} finally { await browser.close(); }
