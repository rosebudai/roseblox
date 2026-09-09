import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createSurfaceMaterials } from "../src/surfaceMaterials.js";
import { createOwnedMaterial } from "../src/resources/renderer/ownedMaterial.js";

const renderer = { capabilities: { getMaxAnisotropy: () => 8 } };
function releases(resource) {
  let count = 0;
  resource.addEventListener("dispose", () => count++);
  return () => count;
}

test("surface image is fetched once with independent tiling, color and owned shape copies", async () => {
  const image = { width: 1024, height: 1024 }, source = new THREE.Texture(image);
  const sourceReleases = releases(source);
  let downloads = 0;
  const surfaces = createSurfaceMaterials({ renderer, loadTexture: async () => { downloads++; return source; } });
  const [floor, wall] = await Promise.all([
    surfaces.load("panel.webp", { repeat: [12, 16], metalness: 0.15 }),
    surfaces.load("panel.webp", { repeat: [16, 3.5], color: "#b8c6ce" }),
  ]);
  assert.equal(downloads, 1);
  assert.equal(floor.map.image, wall.map.image);
  assert.notEqual(floor.map, wall.map);
  assert.deepEqual(floor.map.repeat.toArray(), [12, 16]);
  assert.deepEqual(wall.map.repeat.toArray(), [16, 3.5]);
  assert.equal(floor.map.colorSpace, THREE.SRGBColorSpace);
  assert.equal(floor.map.wrapS, THREE.RepeatWrapping);
  assert.equal(floor.map.wrapT, THREE.RepeatWrapping);
  assert.equal(floor.map.anisotropy, 8);
  assert.equal(floor.roughness, 0.85);
  assert.equal(floor.metalness, 0.15);
  assert.equal(floor.color.getHex(), 0xffffff);
  assert.equal(wall.color.getHexString(), "b8c6ce");
  const shape = createOwnedMaterial(floor), shapeReleases = releases(shape.map);
  const floorReleases = releases(floor.map), wallReleases = releases(wall.map);
  shape.map.repeat.set(2, 2);
  floor.dispose(); floor.dispose();
  assert.equal(floorReleases(), 1);
  assert.equal(shapeReleases(), 0);
  assert.deepEqual(wall.map.repeat.toArray(), [16, 3.5]);
  surfaces.dispose(); surfaces.dispose();
  assert.equal(sourceReleases(), 1);
  assert.equal(wallReleases(), 1);
  assert.equal(shape.map.image, image);
  shape.dispose();
  assert.equal(shapeReleases(), 1);
});

test("pending surface loads release late textures and reject after game disposal", async () => {
  let resolve;
  const surfaces = createSurfaceMaterials({ renderer, loadTexture: () => new Promise(done => { resolve = done; }) });
  const pending = surfaces.load("late.webp");
  await Promise.resolve();
  surfaces.dispose();
  const source = new THREE.Texture(), sourceReleases = releases(source);
  const rejected = assert.rejects(pending, /disposal/);
  resolve(source);
  await rejected;
  assert.equal(sourceReleases(), 1);
  await assert.rejects(surfaces.load("late.webp"), /disposed/);
});

test("a failed image request can be retried without poisoning the shared cache", async () => {
  let attempts = 0;
  const surfaces = createSurfaceMaterials({ renderer, loadTexture: async () => {
    if (++attempts === 1) throw new Error("download failed");
    return new THREE.Texture();
  } });
  await assert.rejects(surfaces.load("retry.webp"), /download failed/);
  const retry = await surfaces.load("retry.webp", { repeat: [4, 6] });
  assert.equal(attempts, 2);
  assert.deepEqual(retry.map.repeat.toArray(), [4, 6]);
  surfaces.dispose();
});
