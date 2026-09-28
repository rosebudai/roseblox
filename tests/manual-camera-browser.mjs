import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.argv[2] ?? "http://127.0.0.1:8893";
const output = process.argv[3] ?? "/tmp/roseblox-manual-camera-evidence";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/local/bin/chromium", headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [], checks = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
const sample = () => page.evaluate(() => window.manualCameraTest.sample());
try {
  await page.goto(`${base}/examples/modern/`);
  await page.waitForFunction(() => window.exampleGame?.game.getDiagnostics().frames > 2, { timeout: 60000 });
  await page.evaluate(async () => {
    const { createGame, createEngine } = await import("/build/roseblox.js");
    const THREE = await import("three");
    window.exampleGame.game.dispose();
    document.querySelector("aside").remove();
    const canvas = document.querySelector("canvas");
    const game = await createGame({ canvas });
    game.addBox({ size: [30, 1, 60], position: [0, -.5, -12], color: "#709056" });
    const target = game.addBox({ body: "none", size: [4, 4, 1], position: [0, 4, -25], color: "#ffcc44" });
    game.controls.enabled = false;
    game.camera.position.set(0, 4, 7);
    game.camera.rotation.set(0, 0, 0, "YXZ");
    let yaw = 0, pitch = 0, hits = 0, moves = 0, acquisitions = 0;
    const onMove = event => {
      if (document.pointerLockElement !== canvas) return;
      yaw -= event.movementX * .002;
      pitch = Math.max(-1, Math.min(1, pitch - event.movementY * .002));
      game.camera.rotation.set(pitch, yaw, 0, "YXZ");
      moves++;
    };
    const onClick = () => {
      if (document.pointerLockElement !== canvas) { acquisitions++; canvas.requestPointerLock(); return; }
      if (game.raycast({ entities: [target] })) hits++;
    };
    document.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onClick);
    const sample = () => ({ position: game.camera.position.toArray(), rotation: game.camera.quaternion.toArray(), direction: game.camera.getWorldDirection(new THREE.Vector3()).toArray(), frames: game.getDiagnostics().frames, locked: document.pointerLockElement === canvas, hits, moves, acquisitions, rayHit: game.raycast({ entities: [target] })?.entity === target });
    window.manualCameraTest = { game, target, sample, createEngine, THREE, cleanInput() { document.removeEventListener("mousemove", onMove); canvas.removeEventListener("mousedown", onClick); } };
  });
  await page.waitForTimeout(350);
  const initial = await sample();
  assert.ok(initial.frames > 3);
  assert.ok(distance(initial.position, [0, 4, 7]) < 1e-8, "Core frames must not overwrite the directly assigned FPS eye");
  assert.equal(initial.rayHit, true, "The actual center ray must hit the initially visible target");
  await page.screenshot({ path: `${output}/manual-initial.png` });
  checks.push({ name: "manual camera pose persists through actual frames and center ray hits", status: "pass", initial });

  await page.mouse.move(500, 350);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => document.pointerLockElement !== null);
  assert.equal((await sample()).hits, 0, "Lock acquisition must not count as a shot in this fixture");
  await page.mouse.down(); await page.mouse.up();
  const hit = await sample(); assert.equal(hit.hits, 1);
  await page.mouse.move(740, 350, { steps: 8 });
  await page.waitForTimeout(250);
  const aimed = await sample();
  assert.ok(aimed.moves > 0 && distance(aimed.direction, initial.direction) > .2, "Actual pointer-lock deltas change camera direction");
  assert.equal(aimed.rayHit, false, "Off-target aim must miss the real target mesh");
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(250);
  const missed = await sample(); assert.equal(missed.hits, 1);
  assert.ok(distance(aimed.direction, missed.direction) < 1e-8, "No later controls frame may reset mouse aim");
  await page.screenshot({ path: `${output}/manual-aimed.png` });
  checks.push({ name: "real pointer-lock aim persists and separates hit from miss", status: "pass", hit, aimed, missed });

  // Programmatic lock release calibrates resumability; it does not claim native Escape coverage.
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForFunction(() => document.pointerLockElement === null);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForFunction(() => document.pointerLockElement !== null);
  const resumed = await sample(); assert.equal(resumed.hits, 1); assert.equal(resumed.acquisitions, 2);
  checks.push({ name: "fixture resumes after lock release without shooting or resetting", status: "pass", nativeEscape: "ungraded", resumed });
  await page.evaluate(() => { document.exitPointerLock(); window.manualCameraTest.cleanInput(); });
  await page.waitForFunction(() => document.pointerLockElement === null);

  const fixed = await page.evaluate(() => {
    const { game } = window.manualCameraTest;
    game.stop();
    const actor = game.addBox({ body: "none", position: [2, 3, -2] });
    game.followCamera(actor, { mode: "fixed", offset: [0, 5, 8] });
    game.teleport(actor, [4, 3, -5]);
    const original = game.controls.update; let calls = 0;
    game.controls.update = function (dt) { calls++; return original.call(this, dt); };
    try { game.engine.update(1 / 60); } finally { game.controls.update = original; }
    const result = { calls, enabled: game.controls.enabled, position: game.camera.position.toArray() };
    game.releaseCamera();
    game.camera.position.set(8, 7, 6); game.camera.lookAt(0, 1, 0);
    result.expectedRotation = game.camera.quaternion.toArray();
    game.start(); return result;
  });
  assert.equal(fixed.calls, 1); assert.equal(fixed.enabled, false);
  assert.ok(distance(fixed.position, [4, 8, 3]) < 1e-6);
  await page.waitForTimeout(250);
  const released = await sample();
  assert.ok(distance(released.position, [8, 7, 6]) < 1e-8);
  assert.ok(distance(released.rotation, fixed.expectedRotation) < 1e-8);
  checks.push({ name: "fixed follow still updates once; release returns disabled standalone camera ownership", status: "pass", fixed, released });

  await page.evaluate(() => {
    const { game } = window.manualCameraTest;
    game.controls.enabled = true;
    const none = game.controls.constructor.ACTION.NONE;
    for (const key of Object.keys(game.controls.mouseButtons)) game.controls.mouseButtons[key] = none;
    for (const key of Object.keys(game.controls.touches)) game.controls.touches[key] = none;
    game.controls.setLookAt(0, 4, 7, 0, 4, -25, false);
    window.manualCameraTest.transitionComplete = false;
    game.controls.setLookAt(5, 6, 9, 0, 2, -10, true).then(() => window.manualCameraTest.transitionComplete = true);
  });
  await page.mouse.move(400, 300); await page.mouse.down();
  await page.mouse.move(760, 390, { steps: 12 }); await page.mouse.up();
  await page.waitForFunction(() => window.manualCameraTest.transitionComplete, { timeout: 10000 });
  await page.waitForTimeout(400);
  const cutscene = await sample();
  assert.ok(distance(cutscene.position, [5, 6, 9]) < .02, "Enabled ACTION.NONE controls must finish scripted transition despite real drag");
  checks.push({ name: "documented input-free cutscene advances and resolves while real drag is ignored", status: "pass", cutscene });

  await page.evaluate(async () => {
    const { game, createEngine, THREE } = window.manualCameraTest;
    game.dispose();
    const engine = createEngine();
    await engine.init({ canvas: document.querySelector("canvas") });
    const { controls, camera } = engine.getResource("camera");
    controls.enabled = false;
    controls.setLookAt(0, 4, 7, 0, 2, -10, false);
    window.rawCameraTest = { engine, controls, camera, complete: false, THREE };
    controls.setLookAt(6, 7, 10, 0, 2, -10, true).then(() => window.rawCameraTest.complete = true);
  });
  await page.waitForFunction(() => window.rawCameraTest.complete, { timeout: 10000 });
  await page.waitForTimeout(400);
  const legacy = await page.evaluate(() => ({ position: window.rawCameraTest.camera.position.toArray(), enabled: window.rawCameraTest.controls.enabled, errors: window.rawCameraTest.engine.getDiagnostics().errorCount }));
  assert.ok(distance(legacy.position, [6, 7, 10]) < .02); assert.equal(legacy.enabled, false); assert.equal(legacy.errors, 0);
  checks.push({ name: "raw GameSystems preserves disabled-input scripted camera transitions", status: "pass", legacy });
  await page.evaluate(() => window.rawCameraTest.engine.dispose());
  assert.deepEqual(errors, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ status: "pass", purpose: "Assistant-authored engine contract calibration, not a Rosie generation sample", checks, errors }, null, 2));
  console.log(JSON.stringify({ status: "pass", checks: checks.map(({ name, status }) => ({ name, status })), errors }));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/result.json`, JSON.stringify({ status: "fail", error: String(error), checks, errors }, null, 2));
  throw error;
} finally { await browser.close(); }
