import * as THREE from "three";
import { disposeObject } from "./resources/renderer/disposeObject.js";
import { createVoxelHud } from "./hud.js";

const lifetimes = new WeakMap();
const themes = {
  woodland: { sky: "#c5d9c6", ground: "#819b4b", earth: "#93633f", stone: "#76766a", leaf: "#5c8241", trunk: "#755039", flower: "#efd47e", shirt: "#cd6842" },
  desert: { sky: "#e4ceb0", ground: "#d8b778", earth: "#b97e50", stone: "#b68b6b", leaf: "#6d8c65", trunk: "#6d8c65", flower: "#d77960", shirt: "#427b83" },
  snow: { sky: "#cbdde4", ground: "#e1e9e1", earth: "#96948a", stone: "#81919b", leaf: "#608277", trunk: "#6f6454", flower: "#a5cad5", shirt: "#bb664c" },
};

/** Optional native-geometry presentation. Game rules remain in the caller. */
export function createVoxelKit(game, { theme = "woodland", seed = 1, lighting = true } = {}) {
  if (!game?.engine?.initialized || game.engine.disposed) throw new Error("createVoxelKit needs a live, initialized game.");
  if (!themes[theme]) throw new Error("Voxel theme must be woodland, desert, or snow.");
  if (!Number.isFinite(seed)) throw new Error("Voxel seed must be a finite number.");
  let lifetime = lifetimes.get(game);
  if (!lifetime) {
    lifetime = { current: null, dispose(released) { this.current?.dispose(released); } };
    game.engine.addResource("voxelPresentation", lifetime);
    lifetimes.set(game, lifetime);
  }
  if (lifetime.current) throw new Error("This game already has a voxel kit. Dispose it before changing themes.");

  const palette = themes[theme];
  const random = seeded(seed);
  const root = new THREE.Group();
  root.name = "Roseblox voxel scenery";
  game.scene.add(root);
  const geometry = new THREE.BoxGeometry();
  const pixel = pixelTexture(random);
  const material = new THREE.MeshStandardMaterial({ map: pixel, roughness: 1 });
  const cloudMaterial = new THREE.MeshBasicMaterial({ fog: true });
  const particleMaterial = new THREE.MeshBasicMaterial({ color: "#ffdc80" });
  const particlesMesh = new THREE.InstancedMesh(geometry, particleMaterial, 80);
  particlesMesh.frustumCulled = false;
  particlesMesh.count = 0;
  root.add(particlesMesh);
  const particles = [];
  const particleMatrix = new THREE.Matrix4();
  const particleRotation = new THREE.Quaternion();
  const particleScale = new THREE.Vector3();
  const ownedEntities = new Set();
  const grounds = new Map();
  const avatars = new Map();
  const pickups = new Map();
  const batches = new Set();
  let hud = null;
  let disposed = false;
  let elapsed = 0;
  const savedScene = { background: game.scene.background, fog: game.scene.fog, toneMapping: game.renderer.toneMapping, exposure: game.renderer.toneMappingExposure };
  const hiddenLights = [];
  const background = new THREE.Color(palette.sky);
  const fog = new THREE.Fog(palette.sky, 35, 100);
  if (lighting) {
    for (const light of game.scene.children) if (light.isLight) {
      hiddenLights.push({ light, visible: light.visible });
      light.visible = false;
    }
    game.scene.background = background;
    game.scene.fog = fog;
    game.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    game.renderer.toneMappingExposure = 1.12;
    root.add(new THREE.HemisphereLight("#e6efd9", palette.earth, 2));
    const sun = new THREE.DirectionalLight("#ffdfa7", 3.1);
    sun.position.set(-16, 24, 12);
    sun.target.position.set(0, 0, -10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 28, bottom: -28, near: 1, far: 90 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.03;
    root.add(sun, sun.target);
  }

  function live() { if (disposed || game.engine.disposed) throw new Error("This voxel kit is disposed."); }
  function belongs(entity) { live(); if (!game.world.has(entity) || !entity.mesh) throw new Error("Voxel visuals require an entity in this game."); }
  function heightAt(x, z) {
    let height = -Infinity;
    for (const [entity, size] of grounds) {
      const p = entity.transform.position;
      if (Math.abs(x - p.x) <= size[0] / 2 && Math.abs(z - p.z) <= size[2] / 2) height = Math.max(height, p.y + size[1] / 2);
    }
    return height;
  }
  function scenicBatch(blocks, shadows = false, unlit = false, cameraCollision = false) {
    const mesh = instanced(blocks, geometry, unlit ? cloudMaterial : material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = !unlit;
    root.add(mesh);
    const unregisterCamera = cameraCollision ? game.addCameraObstacle(mesh) : null;
    const handle = { object: mesh, dispose() { if (!batches.delete(handle)) return; unregisterCamera?.(); mesh.removeFromParent(); mesh.dispose(); } };
    batches.add(handle);
    return handle;
  }
  function restoreAvatar(entity, entry, released) {
    entry.unregisterCameraVisual();
    entry.root.removeFromParent();
    if (game.world.has(entity)) {
      entity.mesh.material = entry.material;
      entry.materialOwner.material = undefined;
      entry.hiddenMaterial.dispose();
      entity.mesh.castShadow = entry.castShadow;
      disposeObject(entry.root, released);
    }
    avatars.delete(entity);
  }
  const unsubscribeRemoval = game.world.onEntityRemoved.subscribe(entity => {
    // The engine's scene lifecycle already disposes descendants on removal.
    avatars.get(entity)?.unregisterCameraVisual();
    avatars.delete(entity);
    pickups.delete(entity);
    grounds.delete(entity);
    ownedEntities.delete(entity);
  });
  const unsubscribeFrame = game.onFrame(dt => {
    elapsed += dt;
    for (const [entity, avatar] of avatars) {
      const dx = entity.transform.position.x - avatar.previous.x;
      const dz = entity.transform.position.z - avatar.previous.z;
      const distance = Math.hypot(dx, dz);
      const moving = distance > 0.001 && distance < 2;
      const playerOwnsFacing = entity.player?.facing !== undefined;
      if (playerOwnsFacing) avatar.root.rotation.y = 0;
      if (moving) {
        avatar.stride += distance * 9;
        if (!playerOwnsFacing) {
          const angle = Math.atan2(-dx, -dz) - avatar.root.rotation.y;
          avatar.root.rotation.y += Math.atan2(Math.sin(angle), Math.cos(angle)) * Math.min(1, dt * 14);
        }
      }
      for (const { leg, arm, side } of avatar.limbs) {
        const swing = moving ? Math.sin(avatar.stride) * 0.58 * side : 0;
        leg.rotation.x += (swing - leg.rotation.x) * Math.min(1, dt * 16);
        arm.rotation.x += (-swing * 0.8 - arm.rotation.x) * Math.min(1, dt * 16);
      }
      avatar.root.position.y = avatar.baseY + (moving ? Math.abs(Math.sin(avatar.stride)) * 0.025 : Math.sin(elapsed * 2) * 0.006);
      avatar.previous.copy(entity.transform.position);
    }
    for (const entry of pickups.values()) {
      entry.visual.rotation.y = elapsed * 1.6 + entry.phase;
      entry.visual.position.y = Math.sin(elapsed * 2.2 + entry.phase) * 0.1;
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      p.velocity.y -= dt * 4.5;
      p.position.addScaledVector(p.velocity, dt);
      if (p.life <= 0) particles.splice(i, 1);
    }
    particles.forEach((p, i) => {
      particleMatrix.compose(p.position, particleRotation, particleScale.setScalar(Math.max(0.01, p.life * 0.15)));
      particlesMesh.setMatrixAt(i, particleMatrix);
    });
    particlesMesh.count = particles.length;
    if (particles.length) particlesMesh.instanceMatrix.needsUpdate = true;
  });

  const kit = {
    /** Layered solid terrain/platform. Its rendered top equals its collider top. */
    ground({ size = [40, 2, 50], position = [0, -1, -10], color = palette.ground, ...options } = {}) {
      live();
      size = xyz(size, "ground size", true);
      position = xyz(position, "ground position");
      const blocks = [];
      const cap = Math.min(0.22, size[1] * 0.15);
      const stone = size[1] * 0.25;
      blocks.push([0, -size[1] / 2 + stone / 2, 0, size[0], stone, size[2], palette.stone]);
      blocks.push([0, (stone - cap) / 2, 0, size[0], size[1] - stone - cap, size[2], palette.earth]);
      const cell = Math.max(2, Math.sqrt(size[0] * size[2] / 400));
      const nx = Math.ceil(size[0] / cell), nz = Math.ceil(size[2] / cell);
      for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) {
        const shade = new THREE.Color(color).multiplyScalar(0.93 + random() * 0.14);
        blocks.push([(x + 0.5) * size[0] / nx - size[0] / 2, size[1] / 2 - cap / 2, (z + 0.5) * size[2] / nz - size[2] / 2, size[0] / nx, cap, size[2] / nz, shade]);
      }
      const visual = instanced(blocks, new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({
        map: pixelTexture(random), roughness: 1,
        // A visual apron may share its top with a solid play surface. Bias only
        // its depth fragments, preserving all geometry and sampling heights.
        polygonOffset: options.body === "none", polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      }));
      visual.receiveShadow = true;
      let entity;
      try {
        entity = game.addBox({ ...options, size, position, color, body: options.body ?? "fixed", name: options.name ?? "voxel ground" });
        entity.mesh.material.visible = false;
        entity.mesh.castShadow = false;
        entity.mesh.add(visual);
        ownedEntities.add(entity);
        grounds.set(entity, size);
        return entity;
      } catch (error) { disposeObject(visual); throw error; }
    },
    /** Decorative instanced trees/rocks/flowers/clouds; no invisible collisions. */
    scatter(kind, { count = 24, bounds = [-18, 18, -30, 10], exclude = null, cameraCollision = kind === "trees" } = {}) {
      live();
      if (!["trees", "rocks", "flowers", "clouds"].includes(kind)) throw new Error("Scatter kind must be trees, rocks, flowers, or clouds.");
      if (!Number.isInteger(count) || count < 0 || count > 200) throw new Error("Scatter count must be an integer from 0 to 200.");
      bounds = rectangle(bounds);
      if (exclude) exclude = rectangle(exclude);
      const blocks = [];
      let placed = 0;
      for (let attempt = 0; placed < count && attempt < Math.max(1, count * 30); attempt++) {
        const x = bounds[0] + random() * (bounds[1] - bounds[0]);
        const z = bounds[2] + random() * (bounds[3] - bounds[2]);
        if (exclude && x >= exclude[0] && x <= exclude[1] && z >= exclude[2] && z <= exclude[3]) continue;
        const y = kind === "clouds" ? 15 + random() * 6 : heightAt(x, z);
        if (!Number.isFinite(y)) continue;
        placed++;
        if (kind === "trees") {
          const h = 2.5 + random() * 1.4;
          if (theme === "desert") {
            blocks.push([x, y + h / 2, z, 0.65, h, 0.65, palette.leaf], [x + 0.7, y + h * 0.6, z, 1.2, 0.4, 0.5, palette.leaf], [x + 1.05, y + h * 0.7, z, 0.4, h * 0.3, 0.5, palette.leaf]);
          } else {
            blocks.push([x, y + h / 2, z, 0.6, h, 0.6, palette.trunk], [x, y + h + 0.3, z, 3.3, 1.5, 3.0, palette.leaf], [x - 0.2, y + h + 1.3, z, 2.4, 0.8, 2.5, theme === "snow" ? palette.ground : new THREE.Color(palette.leaf).multiplyScalar(1.12)]);
          }
        } else if (kind === "rocks") {
          const s = 0.35 + random() * 0.6;
          blocks.push([x, y + s * 0.35, z, s, s * 0.7, s * 0.8, palette.stone]);
        } else if (kind === "flowers") {
          const h = 0.2 + random() * 0.2;
          blocks.push([x, y + h / 2, z, 0.07, h, 0.07, palette.leaf], [x, y + h, z, 0.24, 0.08, 0.12, palette.flower], [x, y + h, z, 0.12, 0.08, 0.24, palette.flower]);
        } else {
          blocks.push([x, y, z, 5 + random() * 3, 1.1, 2.6, "#fff4df"], [x + 1, y + 0.7, z, 3.5, 0.8, 2.2, "#fff8e9"]);
        }
      }
      if (count > 0 && placed === 0) {
        const coverage = kind === "clouds" ? "bounds and exclude" : "kit.ground coverage, bounds and exclude";
        console.warn(`[Roseblox scatter] ${kind}: placed 0/${count}; no supported placements found after bounds/exclude sampling. Check ${coverage} and the returned count.`);
      }
      const handle = scenicBatch(blocks, kind === "trees", kind === "clouds", cameraCollision);
      handle.count = placed;
      return handle;
    },
    /** Custom decorative blocks, batched without extra entity/physics overhead. */
    blocks(items, { shadows = false, cameraCollision = false } = {}) {
      live();
      if (!Array.isArray(items) || items.length > 2000) throw new Error("blocks expects at most 2000 block descriptions.");
      return scenicBatch(items.map(item => [...xyz(item.position ?? [0, 0, 0], "block position"), ...xyz(item.size ?? [1, 1, 1], "block size", true), item.color ?? palette.stone]), shadows, false, cameraCollision);
    },
    /** Decorate an existing entity. Its movement/physics remain caller-owned. */
    avatar(entity, { color = palette.shirt } = {}) {
      belongs(entity);
      if (avatars.has(entity)) restoreAvatar(entity, avatars.get(entity), new Set());
      const model = new THREE.Group();
      const box = new THREE.BoxGeometry();
      const skin = new THREE.MeshStandardMaterial({ roughness: 1 });
      const parts = [
        [0, 0.08, 0, 0.58, 0.62, 0.35, color], [0, -0.22, 0, 0.6, 0.12, 0.37, "#644635"],
        [0, 0.62, 0, 0.52, 0.5, 0.49, "#d5a56e"], [0, 0.88, 0.015, 0.58, 0.12, 0.55, "#425b4a"],
        [0, 0.83, -0.27, 0.61, 0.075, 0.19, "#425b4a"], [-0.13, 0.65, -0.251, 0.085, 0.075, 0.025, "#3c3029"],
        [0.13, 0.65, -0.251, 0.085, 0.075, 0.025, "#3c3029"], [0, 0.13, 0.25, 0.43, 0.48, 0.22, "#997342"],
      ];
      model.add(instanced(parts, box, skin));
      const limbs = [];
      for (const side of [-1, 1]) {
        const leg = new THREE.Group(); leg.position.set(side * 0.16, -0.28, 0);
        leg.add(instanced([[0, -0.21, 0, 0.245, 0.43, 0.29, "#345d59"], [0, -0.48, -0.035, 0.27, 0.15, 0.37, "#493c32"]], box, skin));
        const arm = new THREE.Group(); arm.position.set(side * 0.4, 0.29, 0);
        arm.add(instanced([[0, -0.14, 0, 0.2, 0.31, 0.27, color], [0, -0.36, 0, 0.18, 0.17, 0.24, "#d5a56e"]], box, skin));
        model.add(leg, arm);
        limbs.push({ leg, arm, side });
      }
      entity.mesh.geometry.computeBoundingBox();
      const height = entity.mesh.geometry.boundingBox.getSize(new THREE.Vector3()).y;
      model.scale.setScalar(height / 1.775);
      const baseY = -0.0525 * height / 1.775;
      model.position.y = baseY;
      model.traverse(object => { if (object.isMesh) object.castShadow = true; });
      const originalMaterial = entity.mesh.material;
      const hiddenMaterial = new THREE.MeshBasicMaterial({ visible: false });
      // Retain original ownership in the traversed graph without changing a
      // potentially shared material's visibility. Removal releases it normally.
      const materialOwner = new THREE.Mesh(new THREE.BufferGeometry(), originalMaterial);
      materialOwner.visible = false;
      model.add(materialOwner);
      const castShadow = entity.mesh.castShadow;
      entity.mesh.material = hiddenMaterial;
      entity.mesh.castShadow = false;
      entity.mesh.add(model);
      const unregisterCameraVisual = game.registerCameraVisual(entity);
      avatars.set(entity, { root: model, limbs, material: originalMaterial, materialOwner, hiddenMaterial, castShadow, baseY, previous: entity.transform.position.clone(), stride: 0, unregisterCameraVisual });
      return entity;
    },
    /** Animated visual only; use your distance/raycast rules and game.remove. */
    pickup({ position = [0, 1, 0], style = "coin", color = style === "crystal" ? "#80d9dc" : "#edb338", ...options } = {}) {
      live();
      if (!["coin", "crystal"].includes(style)) throw new Error("Pickup style must be coin or crystal.");
      position = xyz(position, "pickup position");
      const parts = style === "coin" ? [[0, 0, 0, 0.82, 1.22, 0.25, color], [0, 0, 0, 1.22, 0.82, 0.25, color], [0, 0, 0, 0.6, 0.7, 0.3, "#ffe39b"], [0, 0, 0, 0.16, 0.5, 0.35, "#a87627"]]
        : [[0, 0, 0, 0.55, 1.2, 0.55, color], [0, 0.65, 0, 0.3, 0.25, 0.3, "#daffff"], [0, -0.65, 0, 0.3, 0.25, 0.3, color], [0.32, -0.1, 0, 0.2, 0.6, 0.2, "#d5f5ee"]];
      const visual = instanced(parts, new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.15 }));
      visual.castShadow = true;
      let entity;
      try {
        entity = game.addBox({ ...options, size: [1.2, 1.4, 0.6], position, body: "none", name: options.name ?? style });
        entity.mesh.material.visible = false;
        entity.mesh.castShadow = false;
        entity.mesh.add(visual);
        ownedEntities.add(entity);
        pickups.set(entity, { visual, phase: random() * 6.28 });
        return entity;
      } catch (error) { disposeObject(visual); throw error; }
    },
    burst(position) {
      live();
      const start = new THREE.Vector3(...xyz(position, "burst position"));
      for (let i = 0; i < 14 && particles.length < 80; i++) {
        const angle = i / 14 * Math.PI * 2;
        particles.push({ position: start.clone(), velocity: new THREE.Vector3(Math.cos(angle) * (1.2 + random()), 1.5 + random() * 1.7, Math.sin(angle) * (1.2 + random())), life: 0.8 });
      }
    },
    hud(options = {}) { live(); hud?.dispose(); hud = createVoxelHud(game, options); return hud; },
    dispose(released = new Set()) {
      if (disposed) return;
      disposed = true;
      unsubscribeFrame();
      unsubscribeRemoval();
      hud?.dispose();
      for (const [entity, entry] of avatars) restoreAvatar(entity, entry, released);
      // The engine calls this resource before releasing physics/scene resources.
      for (const entity of ownedEntities) if (game.world.has(entity)) game.world.remove(entity);
      ownedEntities.clear(); grounds.clear(); pickups.clear(); particles.length = 0;
      for (const handle of [...batches]) handle.dispose();
      root.removeFromParent();
      disposeObject(root, released);
      disposeObject({ geometry, material: [material, cloudMaterial, particleMaterial] }, released);
      root.clear();
      if (lighting) {
        for (const saved of hiddenLights) saved.light.visible = saved.visible;
        if (game.scene.background === background) game.scene.background = savedScene.background;
        if (game.scene.fog === fog) game.scene.fog = savedScene.fog;
        if (game.renderer.toneMapping === THREE.ACESFilmicToneMapping) game.renderer.toneMapping = savedScene.toneMapping;
        if (game.renderer.toneMappingExposure === 1.12) game.renderer.toneMappingExposure = savedScene.exposure;
      }
      lifetime.current = null;
    },
  };
  lifetime.current = kit;
  return kit;
}

function xyz(value, name, positive = false) {
  const result = Array.isArray(value) ? [...value] : [value?.x, value?.y, value?.z];
  if (result.length !== 3 || !result.every(x => Number.isFinite(x) && (!positive || x > 0))) throw new Error(`${name} needs three ${positive ? "positive " : ""}finite coordinates.`);
  return result;
}
function rectangle(value) {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite) || value[1] <= value[0] || value[3] <= value[2]) throw new Error("Bounds need [minX,maxX,minZ,maxZ] with increasing limits.");
  return value;
}
function seeded(seed) { let state = seed >>> 0; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }; }
function pixelTexture(random) {
  const bytes = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 256; i++) { const v = random() < 0.17 ? 190 : random() < 0.4 ? 220 : 246; bytes.set([v, v, v, 255], i * 4); }
  const texture = new THREE.DataTexture(bytes, 16, 16, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}
function instanced(blocks, geometry, material) {
  const mesh = new THREE.InstancedMesh(geometry, material, blocks.length);
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3(), scale = new THREE.Vector3(), color = new THREE.Color();
  blocks.forEach(([x, y, z, sx, sy, sz, shade], i) => {
    matrix.compose(position.set(x, y, z), quaternion, scale.set(sx, sy, sz));
    mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, color.set(shade));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}
