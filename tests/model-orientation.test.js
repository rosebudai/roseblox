import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { estimateModelForward } from "../src/modelOrientation.js";

test("surface orientation survives quantized positions, nested transforms and uneven tessellation", () => {
  const expected = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), -.77);
  for (const segments of [1, 17]) {
    const scene = new THREE.Group(), authored = new THREE.Group();
    const geometry = new THREE.BoxGeometry(.12, .2, 2, segments, 1, 3);
    const p = geometry.attributes.position;
    geometry.setAttribute("position", new THREE.Int16BufferAttribute(Int16Array.from(p.array, value => Math.round(value * 32767)), 3, true));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    authored.rotation.y = -.77; authored.scale.set(2, 3, 4); authored.position.set(7, -3, 2);
    authored.add(mesh); scene.add(authored); scene.position.set(200, 0, -50);
    const pose = estimateModelForward(scene, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1));
    assert.ok(new THREE.Vector3(...pose.sourceForward).distanceTo(expected) < 1e-6);
    assert.ok(pose.elongation > 20);
    geometry.dispose(); mesh.material.dispose();
  }
});

test("the direction hint chooses the semantic end, while symmetric props require an explicit axis", () => {
  const scene = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(.2, .3, 3), new THREE.MeshBasicMaterial());
  mesh.rotation.y = .35; scene.add(mesh);
  const up = new THREE.Vector3(0, 1, 0), hint = new THREE.Vector3(0, 0, -1);
  const result = estimateModelForward(scene, up, hint);
  const expected = hint.clone().applyAxisAngle(up, .35);
  assert.ok(new THREE.Vector3(...result.sourceForward).distanceTo(expected) < 1e-6);
  mesh.geometry.dispose(); mesh.geometry = new THREE.BoxGeometry(1, 1, 1);
  assert.throws(() => estimateModelForward(scene, up, hint), /no clear long axis/);
  mesh.geometry.dispose(); mesh.material.dispose();
});
