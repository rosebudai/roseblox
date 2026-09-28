import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url)), output = process.env.RPG_WORLD_EVIDENCE ?? "/tmp/roseblox-rpg-world-evidence";
await mkdir(output, { recursive: true });
const server = spawn("python3", ["-m", "http.server", "4339", "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
let browser;
try {
  for (let i = 0; i < 40; i++) {
    if (await fetch("http://127.0.0.1:4339/").then(r => r.ok).catch(() => false)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.CANARY_CHROMIUM_EXECUTABLE,
    args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://127.0.0.1:4339/examples/rpg-world/");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const diagnostics = await page.evaluate(() => {
    const g = window.fixture, cast = (origin, direction, maxDistance) => g.world.castRay(origin, direction, { maxDistance, exclude: g.player.body })?.distance ?? null;
    return { ambient: g.scene.children.find(n => n.isHemisphereLight).intensity,
      tree: cast([0, 1, 2], [0, 0, -1], 4), crown: cast([0, 4, 3], [0, 0, -1], 6),
      rock: cast([-5, 2, 0], [0, -1, 0], 3), wall: cast([3, 1, 2], [0, 0, -1], 4),
      doorway: cast([5, 1, 2], [0, 0, -1], 4), decoration: cast([-8, 1, 2], [0, 0, -1], 4),
      bodies: g.world.getDiagnostics().bodies };
  });
  assert.equal(diagnostics.ambient, 1.5);
  assert.equal(diagnostics.tree, 1.5); assert.equal(diagnostics.rock, 1); assert.equal(diagnostics.wall, 1.5);
  assert.equal(diagnostics.crown, null); assert.equal(diagnostics.doorway, null); assert.equal(diagnostics.decoration, null);
  assert.equal(diagnostics.bodies, 7);
  await page.keyboard.down("KeyW");
  await page.waitForFunction(() => window.fixture.player.position.z < 1);
  const blockedAt = await page.evaluate(() => window.fixture.world.getDiagnostics().fixedSteps);
  await page.waitForFunction(at => window.fixture.world.getDiagnostics().fixedSteps > at + 60, blockedAt);
  await page.keyboard.up("KeyW");
  assert.ok(await page.evaluate(() => window.fixture.player.position.z > .8));
  await page.evaluate(() => window.fixture.player.teleport([5, .1, 2]));
  await page.keyboard.down("KeyW");
  await page.waitForFunction(() => window.fixture.player.position.z < -1);
  await page.keyboard.up("KeyW");
  await page.evaluate(() => window.fixture.player.teleport([-5, 1.1, 0]));
  await page.waitForFunction(() => window.fixture.player.grounded);
  assert.ok(await page.evaluate(() => Math.abs(window.fixture.player.position.y - 1) < .08));
  await page.screenshot({ path: output + "/world.png" });
  assert.deepEqual(errors, []);
  await writeFile(output + "/checks.json", JSON.stringify({ passed: true, diagnostics, trunkBlocksMovement: true, doorwayPassable: true, rockSupportsPlayer: true, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, diagnostics }));
} finally { await browser?.close(); server.kill(); }
