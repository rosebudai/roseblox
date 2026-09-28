import * as THREE from "three";
import { createGame, createHud, createInteriorLighting, createFramedBox } from "../../build/roseblox.js";

const baseline = new URLSearchParams(location.search).has("baseline");
const game = await createGame({ canvas: document.querySelector("canvas"), lighting: baseline, maxPixelRatio: 1.5 });
game.scene.background = new THREE.Color("#121e29");
game.scene.fog = new THREE.Fog("#121e29", 22, 55);
const floor = { color: "#485965", roughness: 0.82, metalness: 0.12 };
const wall = { color: "#647781", roughness: 0.85, metalness: 0.06 };
game.addBox({ size: [20, 0.6, 26], position: [0, -0.3, -3], material: floor });
game.addBox({ size: [20, 0.3, 26], position: [0, 6.15, -3], material: wall });
game.addBox({ size: [0.5, 6, 26], position: [-10.25, 3, -3], material: wall });
game.addBox({ size: [0.5, 6, 26], position: [10.25, 3, -3], material: wall });
game.addBox({ size: [20, 6, 0.5], position: [0, 3, -16.25], material: wall });

const lines = new THREE.Group();
const lineMaterial = new THREE.MeshStandardMaterial({ color: "#253b47", roughness: 0.9 });
const lineGeometry = new THREE.BoxGeometry(0.025, 0.012, 26);
for (let x = -8; x <= 8; x += 2) {
  const line = new THREE.Mesh(lineGeometry, lineMaterial); line.position.set(x, 0.008, -3); lines.add(line);
}
for (let z = -15; z <= 9; z += 2) {
  const line = new THREE.Mesh(new THREE.BoxGeometry(20, 0.012, 0.025), lineMaterial); line.position.set(0, 0.008, z); lines.add(line);
}
game.scene.add(lines);

const crates = [
  { size: [3.2, 2.2, 2.1], position: [-3.4, 1.1, -1], color: "#536c79", label: "SUPPLY 07" },
  { size: [2.4, 1.7, 1.9], position: [3.2, 0.85, -4.5], color: "#8c7762", label: "TOOLS 04" },
  { size: [3.6, 1.9, 2.2], position: [-4, 0.95, -8.5], color: "#53685c", label: "MEDICAL" },
  { size: [2.2, 1.7, 1.8], position: [-4, 2.75, -8.5], color: "#9a876b", label: "02" },
  { size: [2.4, 2.6, 2.4], position: [4.4, 1.3, -11.8], color: "#536c79", label: "POWER" },
];
for (const config of crates) {
  if (baseline) game.addBox({ ...config, material: { color: config.color, metalness: 0.5, roughness: 0.6 } });
  else createFramedBox(game, config);
}
for (const z of [-10, -2, 6]) {
  game.addBox({ size: [5, 0.08, 0.2], position: [0, 5.92, z], body: "none", material: { color: "#e5e6df", emissive: "#bdd5e3", emissiveIntensity: 1.3 }, castShadow: false });
}
game.addBox({ size: [3.5, 3.4, 0.1], position: [1, 1.7, -15.93], body: "none", material: { color: "#273d4b", roughness: 0.6 } });
game.addBox({ size: [3.6, 0.05, 0.1], position: [1, 3.5, -15.85], body: "none", material: { color: "#e8bc6b", emissive: "#d79536", emissiveIntensity: 1.2 }, castShadow: false });
if (!baseline) createInteriorLighting(game, { center: [0, 3, -3], size: [20, 6, 26] });
await game.setBloom({ strength: 0.16, threshold: 1.4, exposure: 1.05 });
game.controls.setLookAt(0, 1.7, 8.4, -0.25, 1.6, -5, false);
const hud = createHud(game, {
  preset: baseline ? "default" : "minimal", title: "INTERIOR PRESENTATION", objective: "Engine module fixture",
  controls: "Drag to inspect · Scroll to zoom", stats: { health: { label: "HEALTH", value: 100, position: "bottom-left" }, ammo: { label: "AMMO", value: "12 / 48", position: "bottom-right" } },
  crosshair: true,
});
if (!new URLSearchParams(location.search).has("menu")) hud.setState("playing", "");
window.addEventListener("pagehide", () => game.dispose(), { once: true });
