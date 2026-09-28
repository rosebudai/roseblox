import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const url = process.argv[2] ?? "http://127.0.0.1:8893/examples/modern/";
const output = process.argv[3] ?? "/tmp/roseblox-browser-evidence";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/local/bin/chromium", headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
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
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(4200);
  await page.keyboard.up("KeyW");
  const score = Number(await page.locator("#score").innerText());
  assert.equal(score, 5, "Real keyboard movement must collect every coin");
  assert.match(await page.locator("#status").innerText(), /You win/);
  await page.screenshot({ path: `${output}/won.png` });
  await page.getByRole("button", { name: "Restart" }).click();
  assert.equal(await page.locator("#score").innerText(), "0");
  const reset = await page.evaluate(() => window.exampleGame.player.transform.position.toArray());
  assert.ok(Math.abs(reset[2] - 4) < 0.2, "Restart restores position");
  await page.waitForFunction(() => window.exampleGame.player.player.grounded);
  await page.keyboard.down("Space");
  await page.waitForTimeout(250);
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
}
