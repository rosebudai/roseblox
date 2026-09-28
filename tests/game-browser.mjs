import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Without a URL argument, serve the repository like the scripts/check-*.mjs checks.
const server = process.argv[2] ? null : spawn("python3", ["-m", "http.server", "4351", "--bind", "127.0.0.1"], { cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "ignore" });
process.on("exit", () => server?.kill());
for (let i = 0; server && i < 40 && !(await fetch("http://127.0.0.1:4351/").then(r => r.ok, () => false)); i++) await new Promise(r => setTimeout(r, 100));
const url = process.argv[2] ?? "http://127.0.0.1:4351/examples/modern/";
const output = process.argv[3] ?? "/tmp/roseblox-browser-evidence";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CANARY_CHROMIUM_EXECUTABLE ?? process.env.CHROMIUM_PATH ?? "/usr/local/bin/chromium", headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
try {
  await page.goto(url);
  await page.waitForFunction(() => window.exampleGame?.game.getDiagnostics().frames > 4, { timeout: 60000 });
  await page.waitForTimeout(900);
  const start = await page.evaluate(() => ({ position: window.exampleGame.player.transform.position.toArray(), diagnostics: window.exampleGame.game.getDiagnostics() }));
  assert.ok(Math.abs(start.position[1] - 1.02) < 0.2, `Player must settle on floor: ${start.position}`);
  await page.screenshot({ path: `${output}/start.png` });
  await page.locator("canvas").focus();
  // Poll with deadlines instead of fixed sleeps; software rendering varies in speed.
  await page.keyboard.down("KeyW");
  await page.waitForFunction(() => document.querySelector("#score").textContent === "5", null, { timeout: 20000 }).catch(() => {});
  await page.keyboard.up("KeyW");
  const score = Number(await page.locator("#score").innerText());
  assert.equal(score, 5, "Real keyboard movement must collect every coin");
  assert.match(await page.locator("#status").innerText(), /You win/);
  await page.screenshot({ path: `${output}/won.png` });
  await page.getByRole("button", { name: "Restart" }).click();
  assert.equal(await page.locator("#score").innerText(), "0");
  const reset = await page.evaluate(() => window.exampleGame.player.transform.position.toArray());
  assert.ok(Math.abs(reset[2] - 4) < 0.2, "Restart restores position");
  // Restart lifts the player by its spawn clearance; wait until it has landed again.
  const restartStep = await page.evaluate(() => window.exampleGame.game.getDiagnostics().fixedSteps);
  await page.waitForFunction(at => {
    const { game, player } = window.exampleGame;
    return game.getDiagnostics().fixedSteps > at + 10 && player.player.grounded;
  }, restartStep, { timeout: 10000 });
  await page.keyboard.down("Space");
  await page.waitForFunction(() => window.exampleGame.player.transform.position.y > 1.5, null, { timeout: 5000 }).catch(() => {});
  const jumpY = await page.evaluate(() => window.exampleGame.player.transform.position.y);
  await page.keyboard.up("Space");
  assert.ok(jumpY > 1.5, `Jump must leave ground: ${jumpY}`);
  const timing = await page.evaluate(() => {
    const { game } = window.exampleGame;
    game.stop();
    const before = game.getDiagnostics();
    for (let i = 0; i < 144; i++) game.engine.update(1 / 144);
    const after = game.getDiagnostics();
    game.dispose();
    return { before, after, disposed: game.engine.disposed };
  });
  assert.equal(timing.after.fixedSteps - timing.before.fixedSteps, 60);
  assert.equal(timing.disposed, true);
  assert.deepEqual(errors, []);
  const result = { status: "pass", url, score, start, reset, jumpY, timing, errors };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  await writeFile(`${output}/result.json`, JSON.stringify({ status: "fail", error: String(error), errors }, null, 2));
  throw error;
} finally {
  await browser.close();
  server?.kill();
}
