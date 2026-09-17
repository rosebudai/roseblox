import * as THREE from "three";
import { createRpgWorld } from "../../build/rpg.js";

const $ = id => document.getElementById(id), canvas = $("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xa8c8c5); scene.fog = new THREE.Fog(0xa8c8c5, 35, 80);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .1, 100);
const world = await createRpgWorld();
scene.add(new THREE.HemisphereLight(0xe7f4f0, 0x465230, 2.5));
const sun = new THREE.DirectionalLight(0xffe6b1, 3); sun.position.set(-10, 20, 9); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20 }); scene.add(sun);
const material = color => new THREE.MeshStandardMaterial({ color, roughness: .9 });
function box(size, pos, color, parent = scene) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color)); mesh.position.set(...pos); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
const ground = box([70, 1, 70], [0, -.5, 0], 0x738653); world.addStaticMesh(ground);
box([9, .025, 20], [0, .013, -4], 0xc4b990);
function label(text, position) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 96;
  const ctx = c.getContext("2d"); ctx.font = "bold 40px Georgia"; ctx.textAlign = "center"; ctx.fillStyle = "#18291b"; ctx.fillRect(0, 0, 512, 96); ctx.fillStyle = "#ffe8ac"; ctx.fillText(text, 256, 62);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: true })); sprite.position.set(...position); sprite.scale.set(2.8, .525, 1); scene.add(sprite); return sprite;
}
function actor(color) {
  const root = new THREE.Group();
  box([.62, .85, .38], [0, 1.05, 0], color, root); box([.43, .43, .43], [0, 1.71, 0], 0xd8b385, root);
  for (const x of [-.19, .19]) box([.22, .63, .26], [x, .36, 0], 0x363e3b, root);
  for (const x of [-.42, .42]) box([.19, .65, .23], [x, 1.05, 0], color, root);
  for (const x of [-.1, .1]) box([.065, .07, .025], [x, 1.75, .225], 0x182529, root);
  box([.72, 1.05, .06], [0, 1.05, -.23], 0x193b38, root);
  return root;
}
const elder = world.addNpc({ model: actor(0x785f9c), feet: [-2.5, 0, -4], data: { name: "Elder Rowan", kind: "elder" } }); scene.add(elder.root); label("Elder Rowan", [-2.5, 2.65, -4]);
const chestMesh = box([1.2, .8, .8], [2.5, .4, -3], 0x9b643b);
box([.12, .6, .83], [2.5, .45, -3], 0xc4a752);
const chest = world.addBody({ position: [2.5, .4, -3], shape: { type: "box", size: [1.2, .8, .8] }, data: { name: "Supply chest", kind: "chest" } }); label("Supply chest", [2.5, 1.6, -3]);
const dummyMesh = box([.75, 1.7, .6], [0, .85, -8], 0x9e7757);
box([1.8, .18, .2], [0, 1.25, -8], 0x72543f);
const dummy = world.addBody({ position: [0, .85, -8], shape: { type: "box", size: [.75, 1.7, .6] }, data: { name: "Training dummy", kind: "dummy" } }); label("Training dummy", [0, 2.6, -8]);
for (const x of [-9, 9]) for (let z = -18; z < 9; z += 7) {
  const trunk = box([.7, 4, .7], [x, 2, z], 0x65533b); world.addStaticMesh(trunk);
  const crown = new THREE.Mesh(new THREE.ConeGeometry(2.6, 6, 7), material(0x3f6848)); crown.position.set(x, 5.3, z); crown.castShadow = true; scene.add(crown);
}
const wall = box([6, 2.7, .7], [0, 1.35, 10], 0x7f8b7c); world.addStaticMesh(wall); label("Camera collision wall", [0, 3.3, 10]);
const targets = [elder.body, chest, dummy];
let selected = null, player, opened = false, hits = 0;
const ring = new THREE.Mesh(new THREE.RingGeometry(.65, .8, 40), new THREE.MeshBasicMaterial({ color: 0xf6d46a, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
function selectTarget({ hit }) {
  selected = hit && targets.includes(hit.body) ? hit.body : null; ring.visible = !!selected;
  $("name").textContent = selected?.data.name ?? "No target selected";
  $("description").textContent = selected ? "Approach, then press F to interact or 1 to attack the dummy." : "Left click the elder, chest, or training dummy.";
  if (selected) ring.position.set(selected.position.x, .04, selected.position.z);
}
function act(attack = false) {
  if (!player.active || !selected) return;
  const delta = selected.position.sub(player.body.position); delta.y = 0;
  if (delta.length() > 3) { $("description").textContent = "Move closer to your selected target."; return; }
  if (selected === elder.body) $("description").textContent = "Rowan: Welcome, traveler. Practice on the dummy, then take supplies from the chest.";
  else if (selected === chest) { opened = !opened; chestMesh.material.color.setHex(opened ? 0xc8a352 : 0x9b643b); $("description").textContent = opened ? "Supplies collected. The chest is open." : "Chest closed."; }
  else if (attack) { hits++; dummyMesh.material.color.setHex(hits % 2 ? 0xcb8357 : 0x9e7757); $("description").textContent = `Training hits: ${hits}. Camera dragging never attacks.`; }
  else $("description").textContent = "Press 1 or click Attack to strike the dummy.";
}
async function makePlayer() {
  const feet = player?.position.toArray() ?? [0, 0, 2]; player?.remove();
  player = await world.addPlayer({ camera, canvas, model: actor(0x467e89), feet, keyboardLayout: $("layout").value, distance: 8, pitch: .4, onSelect: selectTarget }); scene.add(player.root);
  $("help").textContent = `${$("layout").value === "classic" ? "W/S move · A/D turn · Q/E strafe · RMB+A/D strafe" : "WASD move · Q/E turn"} · Right-drag camera · Left click select · Wheel zoom · Space jump · Shift run · F interact · 1 attack · Esc pause`;
}
await makePlayer();
$("start").onclick = () => { player.start(); $("menu").hidden = true; };
$("layout").onchange = async () => { await makePlayer(); $("menu-title").textContent = "Keyboard layout changed"; $("start").textContent = "Resume"; $("menu").hidden = false; };
$("interact").onclick = () => act(); $("attack").onclick = () => act(true);
window.addEventListener("keydown", e => { if (document.activeElement !== canvas || e.repeat) return; if (e.code === "KeyF") act(); if (e.code === "Digit1") act(true); });
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
window.addEventListener("resize", resize); resize();
const timer = new THREE.Timer();
renderer.setAnimationLoop(time => {
  timer.update(time); world.advance(Math.max(0, timer.getDelta()));
  if (!player.active && $("menu").hidden) { $("menu-title").textContent = "Paused"; $("start").textContent = "Resume"; $("menu").hidden = false; }
  const p = player.position; $("status").textContent = `feet ${p.x.toFixed(1)}, ${p.y.toFixed(2)}, ${p.z.toFixed(1)} · ${player.grounded ? "grounded" : "airborne"} · ${player.locked ? "locked" : "free cursor"}`;
  renderer.render(scene, camera);
});
