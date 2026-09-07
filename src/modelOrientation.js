import * as THREE from "three";

/** Find an elongated model's horizontal axis; a direction hint chooses its end. */
export function estimateModelForward(scene, up, hint) {
  const x = new THREE.Vector3().crossVectors(up, Math.abs(up.z) < .9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
  const z = new THREE.Vector3().crossVectors(x, up).normalize();
  const projectedHint = hint.clone().addScaledVector(up, -hint.dot(up));
  if (projectedHint.lengthSq() < 1e-8) throw new Error("Camera model forwardHint must not be parallel to sourceUp.");
  projectedHint.normalize();
  scene.updateWorldMatrix(true, true);
  const origin = new THREE.Box3().setFromObject(scene, true).getCenter(new THREE.Vector3());
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  let weight = 0, mx = 0, mz = 0, xx = 0, xz = 0, zz = 0;
  scene.traverseVisible(mesh => {
    if (!mesh.isMesh || !mesh.geometry.attributes.position) return;
    const geometry = mesh.geometry, index = geometry.index;
    const count = index?.count ?? geometry.attributes.position.count;
    const end = Math.min(count, geometry.drawRange.start + geometry.drawRange.count);
    for (let i = geometry.drawRange.start; i + 2 < end; i += 3) {
      mesh.getVertexPosition(index ? index.getX(i) : i, a).applyMatrix4(mesh.matrixWorld).sub(origin);
      mesh.getVertexPosition(index ? index.getX(i + 1) : i + 1, b).applyMatrix4(mesh.matrixWorld).sub(origin);
      mesh.getVertexPosition(index ? index.getX(i + 2) : i + 2, c).applyMatrix4(mesh.matrixWorld).sub(origin);
      const area = ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() / 2;
      if (!Number.isFinite(area) || area <= 0) continue;
      const ax = a.dot(x), bx = b.dot(x), cx = c.dot(x), az = a.dot(z), bz = b.dot(z), cz = c.dot(z);
      const sx = ax + bx + cx, sz = az + bz + cz;
      // Integrate each triangle's surface instead of counting vertices: dense
      // topology on a grip or sight must not pull the axis away from the barrel.
      weight += area;
      mx += area * sx / 3; mz += area * sz / 3;
      xx += area * (sx * sx + ax * ax + bx * bx + cx * cx) / 12;
      xz += area * (sx * sz + ax * az + bx * bz + cx * cz) / 12;
      zz += area * (sz * sz + az * az + bz * bz + cz * cz) / 12;
    }
  });
  if (!weight) throw new Error("Camera model long-axis alignment requires a triangle surface.");
  xx = xx / weight - (mx / weight) ** 2;
  xz = xz / weight - mx * mz / (weight * weight);
  zz = zz / weight - (mz / weight) ** 2;
  const difference = Math.hypot(xx - zz, 2 * xz), major = (xx + zz + difference) / 2, minor = Math.max(0, (xx + zz - difference) / 2);
  const elongation = major / Math.max(minor, major * 1e-12);
  if (!Number.isFinite(elongation) || elongation < 2) throw new Error("Camera model has no clear long axis; provide an explicit sourceForward vector.");
  const angle = Math.atan2(2 * xz, xx - zz) / 2;
  const forward = x.multiplyScalar(Math.cos(angle)).addScaledVector(z, Math.sin(angle)).normalize();
  const agreement = forward.dot(projectedHint);
  if (agreement < 0) forward.negate();
  return { mode: "long-axis", sourceForward: forward.toArray(), sourceUp: up.toArray(), elongation, directionConfidence: Math.abs(agreement) };
}
