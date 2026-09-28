import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = spawn("python3", ["-m", "http.server", "4338", "--bind", "127.0.0.1"], { cwd: root, stdio: "ignore" });
let browser;
try {
  for (let i = 0; i < 40; i++) {
    if (await fetch("http://127.0.0.1:4338/").then(r => r.ok).catch(() => false)) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, executablePath: process.env.CANARY_CHROMIUM_EXECUTABLE, args: ["--no-sandbox"] });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:4338/");
  await page.evaluate(async () => {
    const { bindRpgUI } = await import("/src/rpgUI.js");
    document.body.innerHTML = `<div id="ui"><section data-rpg-show="panel" style="display:grid">
      <h1 data-rpg-text="panel.title"></h1><nav data-rpg-list="panel.actions"><template>
        <button data-rpg-action="action" data-rpg-text="label" data-rpg-disabled="disabled"></button>
      </template></nav></section><meter data-rpg-max="maxHealth" data-rpg-value="health"></meter>
      <aside data-rpg-list="questLog"><template><article><h2 data-rpg-text="title"></h2>
        <div data-rpg-list="objectives"><template><p data-rpg-text="text"></p></template></div>
      </article></template></aside></div>`;
    window.calls = [];
    window.state = { phase: "ready", title: "Test", description: "", health: 75, maxHealth: 100, quests: [], abilities: [], combatTargets: [] };
    window.ui = bindRpgUI({ root: document.querySelector("#ui"),
      actions: { play: () => window.calls.push("play"), chooseDialogue: id => window.calls.push(id), closeDialogue() {} },
      bindAction: (element, callback) => { element.addEventListener("click", callback); return element; }, createControlsLegend: () => document.createElement("dl") });
    window.ui.update(window.state);
  });
  const play = page.getByRole("button", { name: "Play", exact: true });
  await play.focus();
  await page.evaluate(() => { window.originalButton = document.activeElement; for (let i = 0; i < 20; i++) window.ui.update(window.state); });
  assert.equal(await play.evaluate(el => el === window.originalButton && el === document.activeElement), true);
  await play.click(); assert.deepEqual(await page.evaluate(() => window.calls), ["play"]);
  await page.evaluate(() => window.ui.update({ ...window.state, phase: "playing", health: 20, quests: [
    { id: "q", title: "Relics", state: "active", objectives: [{ label: "Collect", count: 2 }], progress: [1] },
  ] }));
  assert.equal(await page.locator("section").isVisible(), false);
  assert.equal(await page.locator("meter").evaluate(el => el.value), 20);
  assert.equal(await page.getByText("Collect · 1/2", { exact: true }).count(), 1);
  await page.evaluate(() => window.ui.update({ ...window.state, phase: "dialogue", dialogue: { title: "Elder", text: "", busy: false, choices: [{ id: "3:1", label: "Accept" }] } }));
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), ["play", "3:1"]);
  await page.evaluate(() => window.ui.update({ ...window.state, phase: "dialogue", dialogue: { title: "Elder", text: "", busy: true, choices: [{ id: "3:1", label: "Accept" }] } }));
  assert.equal(await page.getByRole("button", { name: "Accept", exact: true }).isDisabled(), true);
  assert.equal(await page.locator("section").evaluate(el => getComputedStyle(el).display), "grid");
  await page.evaluate(() => window.ui.dispose());
  assert.equal(await page.locator("#ui > *").count(), 0);
  console.log(JSON.stringify({ stable_focus: true, keyed_actions: true, nested_progress: true, grid_visibility: true, disabled_choices: true, disposal: true }));
} finally { await browser?.close(); server.kill(); }
