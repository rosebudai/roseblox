import test from "node:test";
import assert from "node:assert/strict";
import { resolveRpgLighting } from "../src/rpgLighting.js";

test("RPG lighting preserves authored intensity, darkness and valid legacy values", () => {
  assert.deepEqual(resolveRpgLighting({ ambientIntensity: 0, ambient: 3, sunIntensity: 8, exposure: .4 }),
    { ambientIntensity: 0, sunIntensity: 8, exposure: .4 });
  assert.equal(resolveRpgLighting({ ambient: 1.1 }).ambientIntensity, 1.1);
  assert.deepEqual(resolveRpgLighting(null), { ambientIntensity: 1.5, sunIntensity: 2.5, exposure: 1 });
});

test("a color supplied as lighting intensity produces a visible scene and diagnostic", () => {
  const warnings = [], visuals = { ambient: 0x9ecf95, skyColor: 0xbfe5ff, exposure: 1.15 };
  const resolved = resolveRpgLighting(visuals, warning => warnings.push(warning));
  assert.equal(resolved.ambientIntensity, 1.5);
  assert.equal(resolved.exposure, 1.15);
  assert.equal(visuals.skyColor, 0xbfe5ff);
  assert.equal(warnings.length, 1);
  assert.equal(resolveRpgLighting({ ambientIntensity: "#9ecf95" }, () => {}).ambientIntensity, 1.5);
});
