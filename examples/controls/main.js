// Engineering fixture for the character-controls package: a floor, a wall and a ledge. Not a generated game.
import * as THREE from "three";
import { createWorld } from "../../build/controls.js";

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight); document.body.append(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, .1, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 2.5));
const box = (size, position, color) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color }));
  mesh.position.fromArray(position); scene.add(mesh); return mesh;
};
const world = await createWorld();
for (const mesh of [box([40, 1, 40], [0, -.5, 0], "#6f8f52"), box([8, 3, 1], [0, 1.5, -6], "#a08060"), box([3, 1, 3], [6, .5, 0], "#8a9296")]) world.addStaticMesh(mesh);
const hero = new THREE.Group();
hero.add(box([.6, 1.8, .4], [0, .9, 0], "#d2553c"), box([.3, .3, .3], [0, 1.5, .3], "#222"));
hero.removeFromParent();
const presses = [];
const player = await world.addPlayer({
  camera, canvas: renderer.domElement, model: hero, feet: [0, 0, 0],
  view: params.get("view") ?? "third", touch: params.has("touch") ? params.get("touch") === "1" : "auto",
  touchButtons: [{ label: "Use", onPress: () => presses.push("use") }],
});
scene.add(player.root);
const menu = document.getElementById("menu");
document.getElementById("play").onclick = () => { menu.hidden = true; player.start(); };
addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
const timer = new THREE.Timer();
renderer.setAnimationLoop(time => {
  timer.update(time);
  world.advance(Math.max(0, timer.getDelta()), { paused: !player.active });
  menu.hidden = player.active;
  renderer.render(scene, camera);
});
window.fixture = { world, player, camera, presses };
