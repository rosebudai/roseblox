import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = process.argv[2] ?? "http://127.0.0.1:8893";
const output = process.argv[3] ?? "/tmp/roseblox-legacy-evidence";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/local/bin/chromium", headless: true, args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
try {
  for (const example of ["getting-started", "adventure"]) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
    try {
      await page.goto(`${base}/examples/${example}/`);
      await page.evaluate(async () => { window.legacyEngine = (await import(new URL("./roseblox-game-engine.js", location.href))).engine; });
      await page.waitForFunction(() => window.legacyEngine?.getDiagnostics().frames > 10, { timeout: 60000 });
      const before = await page.evaluate(() => ({ diagnostics: window.legacyEngine.getDiagnostics(), players: [...window.legacyEngine.world].filter(entity => entity.isInputControlled).map(entity => entity.transform.position.toArray()) }));
      await page.locator("canvas").focus();
      await page.keyboard.down("KeyW");
      await page.waitForTimeout(700);
      await page.keyboard.up("KeyW");
      const after = await page.evaluate(() => ({ diagnostics: window.legacyEngine.getDiagnostics(), players: [...window.legacyEngine.world].filter(entity => entity.isInputControlled).map(entity => entity.transform.position.toArray()) }));
      await page.screenshot({ path: `${output}/${example}.png` });
      const viewport = await page.evaluate(() => ({ height: innerHeight, canvasHeight: document.querySelector("canvas").getBoundingClientRect().height }));
      assert.ok(viewport.canvasHeight >= viewport.height * 0.9, `Legacy canvas should fill viewport: ${JSON.stringify(viewport)}`);
      assert.equal(after.diagnostics.errorCount, 0);
      assert.deepEqual(errors, []);
      if (example === "adventure") {
        assert.ok(before.players.length > 0, "Adventure player must exist");
        assert.ok(Math.hypot(after.players[0][0] - before.players[0][0], after.players[0][2] - before.players[0][2]) > 0.5, "Adventure player must respond to W");
      }
      results.push({ example, status: "pass", before, after, errors });
    } catch (error) {
      await page.screenshot({ path: `${output}/${example}-failure.png` }).catch(() => {});
      results.push({ example, status: "fail", error: String(error), errors });
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
await writeFile(`${output}/result.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
assert.ok(results.every(result => result.status === "pass"));
