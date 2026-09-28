import * as THREE from './vendor/three.module.js';

const config = await (await fetch('./config.json')).json();
const canvas = document.querySelector('#game-canvas');
const score = document.querySelector('#score');
const status = document.querySelector('#status');
const start = document.querySelector('#start');
const restart = document.querySelector('#restart');
document.querySelector('#controls').textContent = `Hit ${config.targetCount} targets · Mouse to aim · Click to fire · Escape to release mouse`;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#192638');
scene.fog = new THREE.Fog('#192638', 16, 36);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 80);
camera.position.set(0, 1.6, 0);
camera.rotation.order = 'YXZ';
scene.add(new THREE.HemisphereLight('#e7f3ff', '#313647', 2));
const light = new THREE.DirectionalLight('#ffffff', 3);
light.position.set(-4, 7, 2);
light.castShadow = true;
scene.add(light);

function box(size, position, color) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: 0.78 }));
  mesh.position.set(...position);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

box([18, 0.2, 26], [0, -0.1, -8], '#6d7787');
box([18, 8, 0.3], [0, 4, -19], '#31516f');
box([0.3, 8, 26], [-9, 4, -8], '#263e56');
box([0.3, 8, 26], [9, 4, -8], '#263e56');
for (const x of [-7, -4, 4, 7]) box([0.15, 6, 0.2], [x, 3, -18.7], '#769dc0');
const grid = new THREE.GridHelper(24, 24, '#adb5c4', '#87919f');
grid.position.set(0, 0.011, -7);
scene.add(grid);
box([2.8, 0.3, 1], [0, 0.25, -10], '#1c2e43');
box([0.12, 1.4, 0.12], [0, 0.9, -10.1], '#c0c9d2');

let active = false;
let hits = 0;
let target = null;
let targetTimer = null;
let yaw = 0;
let pitch = 0;
const raycaster = new THREE.Raycaster();
const center = new THREE.Vector2(0, 0);

function spawnTarget() {
  target = new THREE.Mesh(new THREE.SphereGeometry(0.8, 40, 24), new THREE.MeshStandardMaterial({ color: '#ee4657', metalness: 0.22, roughness: 0.3 }));
  target.position.set(0, 1.6, -10);
  target.castShadow = true;
  scene.add(target);
}

function removeTarget() {
  if (!target) return;
  scene.remove(target);
  target.geometry.dispose();
  target.material.dispose();
  target = null;
}

function resetRound() {
  clearTimeout(targetTimer);
  removeTarget();
  hits = 0;
  yaw = 0;
  pitch = 0;
  camera.rotation.set(0, 0, 0);
  camera.updateMatrixWorld();
  score.textContent = 'Hits: 0';
  status.textContent = 'Aim at the red target';
  restart.hidden = true;
  spawnTarget();
  active = true;
}

function lockPointer() {
  canvas.requestPointerLock().catch((error) => {
    status.textContent = `Pointer lock unavailable: ${error.message}`;
  });
}

start.addEventListener('click', () => {
  resetRound();
  start.hidden = true;
  lockPointer();
});

restart.addEventListener('click', () => {
  resetRound();
  lockPointer();
});

document.addEventListener('mousemove', (event) => {
  if (!active || document.pointerLockElement !== canvas) return;
  yaw -= event.movementX * 0.002;
  pitch = THREE.MathUtils.clamp(pitch - event.movementY * 0.002, -1.2, 1.2);
  camera.rotation.set(pitch, yaw, 0);
});

canvas.addEventListener('click', () => {
  if (!active || document.pointerLockElement !== canvas || !target) return;
  camera.updateMatrixWorld();
  target.updateMatrixWorld();
  raycaster.setFromCamera(center, camera);
  if (!raycaster.intersectObject(target).length) {
    status.textContent = 'Miss — adjust your aim';
    return;
  }
  removeTarget();
  hits += 1;
  score.textContent = `Hits: ${hits}`;
  if (hits === config.targetCount) {
    active = false;
    status.textContent = 'You won';
    restart.hidden = !config.restart;
    document.exitPointerLock();
  } else {
    status.textContent = 'Target hit';
    targetTimer = setTimeout(spawnTarget, 80);
  }
});

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}

addEventListener('resize', resize);
resize();
spawnTarget();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
