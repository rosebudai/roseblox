import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.argv[2] ?? "http://127.0.0.1:8893";
const output = process.argv[3] ?? "/tmp/roseblox-camera-evidence";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/local/bin/chromium", headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errors = [];
const checks = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
const sample = () => page.evaluate(() => window.cameraTest.sample());
const distance = (a, b) => Math.hypot(...a.map((value, index) => value - b[index]));
const drag = async (button = "left") => {
  await page.mouse.move(610, 430);
  await page.mouse.down({ button });
  await page.mouse.move(810, 455, { steps: 15 });
  await page.mouse.up({ button });
  await page.waitForTimeout(700);
};
try {
  await page.goto(`${base}/examples/modern/`);
  await page.waitForFunction(() => window.exampleGame?.game.getDiagnostics().frames > 2, { timeout: 60000 });
  await page.evaluate(async () => {
    const { createGame } = await import("/build/roseblox.js");
    const THREE = await import("three");
    window.exampleGame.game.dispose();
    document.querySelector("aside").remove();
    const game = await createGame({ canvas: document.querySelector("canvas"), CAMERA: { MAX_DISTANCE: 24 } });
    game.addBox({ size: [100, 1, 100], position: [0, -0.5, 0], color: "#6a9970" });
    for (const [x, z, color] of [[-8, -8, "#ff6655"], [8, -8, "#5566ff"], [8, 8, "#ffcc44"]]) {
      game.addBox({ size: [2, 3, 2], position: [x, 1.5, z], color });
    }
    const player = game.addPlayer({ position: [0, 1.1, 0], cameraRelative: true });
    game.followCamera(player);
    const sample = () => {
      const spherical = game.controls.getSpherical(undefined, false);
      return {
        position: game.camera.position.toArray(),
        target: game.controls.getTarget(new THREE.Vector3(), false).toArray(),
        player: player.transform.position.toArray(),
        direction: game.camera.getWorldDirection(new THREE.Vector3()).toArray(),
        theta: spherical.theta, phi: spherical.phi, radius: spherical.radius,
        controlsEnabled: game.controls.enabled,
      };
    };
    window.cameraTest = { game, player, sample };
  });
  await page.waitForFunction(() => window.cameraTest.player.player.grounded);
  await page.waitForTimeout(400);

  const initial = await sample();
  await drag();
  const orbited = await sample();
  assert.ok(Math.abs(orbited.theta - initial.theta) > 0.3, "Real left drag must change orbit angle");
  assert.ok(distance(orbited.position, initial.position) > 2, "Real drag must move the rendered camera");
  assert.ok(distance(orbited.target, orbited.player.map((value, index) => value + (index === 1 ? 0.5 : 0))) < 0.001);
  checks.push({ name: "real left drag orbits the followed player", status: "pass", initial, orbited });

  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(800);
  const zoomed = await sample();
  assert.ok(zoomed.radius < orbited.radius - 0.2, "Real wheel must change camera distance during follow");
  checks.push({ name: "real wheel zooms during follow", status: "pass", radiusBefore: orbited.radius, radiusAfter: zoomed.radius });
  await page.screenshot({ path: `${output}/orbited-and-zoomed.png` });

  await page.locator("canvas").focus();
  const beforeWalk = await sample();
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(750);
  await page.keyboard.up("KeyW");
  const afterWalk = await sample();
  const movement = [afterWalk.player[0] - beforeWalk.player[0], afterWalk.player[2] - beforeWalk.player[2]];
  const forward = [beforeWalk.direction[0], beforeWalk.direction[2]];
  const alignment = (movement[0] * forward[0] + movement[1] * forward[1]) / (Math.hypot(...movement) * Math.hypot(...forward));
  assert.ok(Math.hypot(...movement) > 1.5, "Real keyboard input must move the player");
  assert.ok(alignment > 0.98, `Walking must follow the orbited camera direction; alignment=${alignment}`);
  assert.ok(Math.abs(afterWalk.theta - beforeWalk.theta) < 0.02, "Following movement must preserve orbit angle");
  assert.ok(Math.abs(afterWalk.radius - beforeWalk.radius) < 0.02, "Following movement must preserve zoom");
  assert.ok(distance(afterWalk.target, afterWalk.player.map((value, index) => value + (index === 1 ? 0.5 : 0))) < 0.001);
  checks.push({ name: "camera-relative walking tracks player and preserves chosen view", status: "pass", alignment, beforeWalk, afterWalk });

  await page.evaluate(() => window.cameraTest.game.teleport(window.cameraTest.player, [12, 1.1, -7]));
  await page.waitForTimeout(300);
  const respawned = await sample();
  assert.ok(distance(respawned.target, respawned.player.map((value, index) => value + (index === 1 ? 0.5 : 0))) < 0.001);
  assert.ok(Math.abs(respawned.theta - afterWalk.theta) < 0.02);
  assert.ok(Math.abs(respawned.radius - afterWalk.radius) < 0.02);
  checks.push({ name: "respawn retains orbit and zoom while following the new position", status: "pass" });

  await drag("right");
  const rightDragged = await sample();
  assert.ok(Math.abs(rightDragged.theta - respawned.theta) > 0.3, "Real right drag must orbit rather than pan");
  assert.ok(distance(rightDragged.target, rightDragged.player.map((value, index) => value + (index === 1 ? 0.5 : 0))) < 0.001);
  checks.push({ name: "real right drag orbits without panning the follow target", status: "pass" });

  const singleUpdate = await page.evaluate(() => {
    const { game, player } = window.cameraTest;
    game.stop();
    game.followCamera(player, { offset: [0, 5, 8] });
    // Generated games sometimes assign a camera position just after following.
    game.camera.position.set(99, 99, 99);
    game.camera.lookAt(0, 0, 0);
    const update = game.controls.update;
    let calls = 0;
    game.controls.update = function (dt) { calls++; return update.call(this, dt); };
    try { game.engine.update(1 / 60); }
    finally { game.controls.update = update; }
    const offset = game.camera.position.clone().sub(player.transform.position).toArray();
    game.start();
    return { calls, offset };
  });
  assert.equal(singleUpdate.calls, 1, "Follow must use the core's one camera-controls update per frame");
  assert.ok(distance(singleUpdate.offset, [0, 5, 8]) < 0.001, "First follow update must honor its configured offset");
  checks.push({ name: "one camera update per frame and configured initial offset", status: "pass", ...singleUpdate });

  await page.evaluate(() => window.cameraTest.game.followCamera(window.cameraTest.player, { mode: "fixed", offset: [0, 5, 8] }));
  await page.waitForTimeout(200);
  const fixedBefore = await sample();
  await drag();
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(300);
  const fixedAfter = await sample();
  assert.equal(fixedAfter.controlsEnabled, false);
  assert.ok(distance(fixedAfter.position, fixedBefore.position) < 0.01, "Fixed mode must ignore drag and wheel");
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(350);
  await page.keyboard.up("KeyW");
  const fixedMoved = await sample();
  assert.ok(distance(fixedMoved.player, fixedAfter.player) > 0.5);
  assert.ok(distance(fixedMoved.position.map((value, index) => value - fixedMoved.player[index]), [0, 5, 8]) < 0.001);
  checks.push({ name: "explicit fixed mode ignores mouse input and retains its moving offset", status: "pass" });

  const restoration = await page.evaluate(() => {
    const { game, player } = window.cameraTest;
    game.releaseCamera();
    const { ACTION } = game.controls.constructor;
    const config = () => ({ enabled: game.controls.enabled, mouseButtons: { ...game.controls.mouseButtons }, touches: { ...game.controls.touches }, dollyToCursor: game.controls.dollyToCursor, infinityDolly: game.controls.infinityDolly });
    game.controls.enabled = false;
    game.controls.mouseButtons.left = ACTION.NONE;
    game.controls.mouseButtons.right = ACTION.TRUCK;
    game.controls.mouseButtons.wheel = ACTION.ZOOM;
    game.controls.touches.one = ACTION.NONE;
    game.controls.dollyToCursor = true;
    game.controls.infinityDolly = true;
    const expected = config();
    game.followCamera(player);
    game.releaseCamera();
    const released = config();
    game.followCamera(player);
    const other = game.addBox({ body: "none" });
    game.followCamera(other, { mode: "fixed" });
    game.stop();
    game.world.remove(other);
    const removedWhilePaused = config();
    game.releaseCamera();
    const releasedAgain = config();
    let invalidModeRejected = false;
    try { game.followCamera(player, { mode: "typo" }); }
    catch (error) { invalidModeRejected = /orbit.*fixed/.test(error.message); }
    game.dispose();
    game.dispose();
    return { expected, released, removedWhilePaused, releasedAgain, invalidModeRejected, disposed: game.engine.disposed };
  });
  assert.deepEqual(restoration.released, restoration.expected);
  assert.deepEqual(restoration.removedWhilePaused, restoration.expected);
  assert.deepEqual(restoration.releasedAgain, restoration.expected);
  assert.equal(restoration.invalidModeRejected, true);
  assert.equal(restoration.disposed, true);
  checks.push({ name: "release, switching modes, paused removal and disposal preserve control configuration", status: "pass", ...restoration });
  assert.deepEqual(errors, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ status: "pass", checks, errors }, null, 2));
  console.log(JSON.stringify({ status: "pass", checks: checks.map(({ name, status }) => ({ name, status })), errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/result.json`, JSON.stringify({ status: "fail", error: String(error), checks, errors }, null, 2));
  throw error;
} finally {
  await browser.close();
}
