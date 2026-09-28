import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { disposeObject } from "./resources/renderer/disposeObject.js";

const lightingOwners = new WeakMap();

/** A bounded room's key and fill stay below its ceiling; no render loop is added. */
export function createInteriorLighting(game, {
  center = [0, 3, 0], size = [20, 6, 24], intensity = 1,
  keyColor = "#e5efff", fillColor = "#b9cee6", groundColor = "#736f66", shadows = true,
} = {}) {
  live(game);
  const origin = triplet(center, "center");
  const dimensions = triplet(size, "size", true);
  if (!Number.isFinite(intensity) || intensity < 0) throw new Error("Light intensity must be finite and nonnegative.");
  const [width, height, depth] = dimensions;
  const root = new THREE.Group();
  root.name = "Interior lighting";
  root.position.fromArray(origin);
  const distance = Math.hypot(...dimensions) * 2;
  // Three's point/spot intensity falls with distance squared. Uniformly scaling
  // a room must not make the same preset go dark or blow out its floor.
  const power = intensity * (height / 6) ** 2;
  const ambient = new THREE.HemisphereLight(fillColor, groundColor, intensity * 1.35);
  const key = new THREE.SpotLight(keyColor, power * 230, distance, 1.23, 0.65, 2);
  key.position.set(-width * 0.23, height * 0.32, depth * 0.18);
  key.target.position.set(0, -height * 0.42, -depth * 0.12);
  key.castShadow = shadows;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = Math.max(0.01, height * 0.02);
  key.shadow.camera.far = distance;
  key.shadow.bias = -0.0001;
  key.shadow.normalBias = height * 0.005;
  const fill = new THREE.PointLight(fillColor, power * 95, distance, 2);
  fill.position.set(width * 0.28, height * 0.15, -depth * 0.22);
  root.add(ambient, key, key.target, fill);

  let owners = lightingOwners.get(game);
  if (!owners) {
    owners = new Set();
    game.engine.addResource("interiorLighting", { dispose(released) { for (const owner of [...owners]) owner.dispose(released); } });
    lightingOwners.set(game, owners);
  }
  const handle = {
    root, ambient, key, fill,
    dispose(released) {
      if (!owners.delete(handle)) return;
      root.removeFromParent();
      disposeObject(root, released);
    },
  };
  owners.add(handle);
  game.scene.add(root);
  return handle;
}

/** One box collider with a beveled inset body and visible, instanced framing. */
export function createFramedBox(game, {
  size = [2.4, 1.8, 1.8], frameWidth, color = "#506b79", frameColor = "#a5adb0",
  accent = "#d6aa55", label = "", ...config
} = {}) {
  live(game);
  const [width, height, depth] = triplet(size, "size", true);
  const minimum = Math.min(width, height, depth);
  const beam = frameWidth ?? minimum * 0.085;
  if (!Number.isFinite(beam) || beam <= 0 || beam >= minimum / 3) {
    throw new Error("frameWidth must be positive and smaller than one third of the shortest side.");
  }
  if (typeof label !== "string" || label.length > 32) throw new Error("Prop label must be at most 32 characters.");
  const body = new RoundedBoxGeometry(width - beam * 1.4, height - beam * 1.4, depth - beam * 1.4, 2, beam * 0.28);
  const frame = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.48, metalness: 0.25 }), 12);
  const details = new THREE.Group();
  details.name = "Framed box details";
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  let index = 0;
  const bar = (position, scale) => {
    matrix.compose(new THREE.Vector3(...position), rotation, new THREE.Vector3(...scale));
    frame.setMatrixAt(index++, matrix);
  };
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    bar([x * (width - beam) / 2, 0, z * (depth - beam) / 2], [beam, height, beam]);
  }
  for (const y of [-1, 1]) {
    for (const z of [-1, 1]) bar([0, y * (height - beam) / 2, z * (depth - beam) / 2], [width - 2 * beam, beam, beam]);
    for (const x of [-1, 1]) bar([x * (width - beam) / 2, y * (height - beam) / 2, 0], [beam, beam, depth - 2 * beam]);
  }
  frame.instanceMatrix.needsUpdate = true;
  frame.name = "Exposed structural frame";
  frame.castShadow = config.castShadow ?? true;
  frame.receiveShadow = config.receiveShadow ?? true;
  frame.computeBoundingBox();
  frame.computeBoundingSphere();
  details.add(frame);
  const latchGeometry = new THREE.BoxGeometry(beam * 1.2, height * 0.18, beam * 0.3);
  const latchMaterial = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.57, metalness: 0.1 });
  for (const x of [-1, 1]) {
    const latch = new THREE.Mesh(latchGeometry, latchMaterial);
    latch.position.set(x * width * 0.3, 0, depth / 2 - beam * 0.45);
    details.add(latch);
  }
  let entity;
  try {
    if (label) details.add(labelPanel(game, label, width * 0.48, height * 0.23, depth / 2 - beam * 0.55));
    entity = game.addBox({
      ...config, size: [width, height, depth], color,
      material: config.material ?? { color, roughness: 0.68, metalness: 0.12 },
    });
    entity.mesh.geometry.dispose();
    entity.mesh.geometry = body;
    entity.mesh.add(details);
    return entity;
  } catch (error) {
    body.dispose();
    disposeObject(details);
    if (entity) game.remove(entity);
    throw error;
  }
}

function labelPanel(game, label, width, height, z) {
  const canvas = game.renderer.domElement.ownerDocument.createElement("canvas");
  canvas.width = 640; canvas.height = 192;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Prop labels require a 2D canvas context.");
  context.fillStyle = "#182329"; context.fillRect(0, 0, 640, 192);
  context.fillStyle = "#b9c7cc";
  context.fillRect(20, 20, 600, 4);
  context.font = "bold 66px monospace";
  context.textAlign = "center"; context.textBaseline = "middle";
  context.fillText(label.toUpperCase(), 320, 94, 570);
  context.fillStyle = "#a98a50";
  for (let x = 22; x < 200; x += 12) context.fillRect(x, 151, x % 5 ? 4 : 8, 21);
  context.fillStyle = "#8c9da4";
  for (const x of [12, 628]) for (const y of [12, 180]) context.fillRect(x - 3, y - 3, 6, 6);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(4, game.renderer.capabilities?.getMaxAnisotropy?.() ?? 1);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }));
  panel.position.z = z;
  panel.name = "Cargo label";
  return panel;
}

function live(game) {
  if (!game?.engine?.initialized || game.engine.disposed) throw new Error("Presentation helpers need a live, initialized game.");
}

function triplet(value, name, positive = false) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(number => Number.isFinite(number) && (!positive || number > 0))) {
    throw new Error(`${name} must contain three ${positive ? "positive " : ""}finite numbers.`);
  }
  return value;
}
