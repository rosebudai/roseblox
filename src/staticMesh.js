import * as THREE from "three";

/** Snapshot a host-authored collision mesh in world space. Never alter its art. */
export function staticMeshShape(mesh, RAPIER, { surfaceUp } = {}) {
  if (!mesh?.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh || mesh.morphTargetInfluences?.length) throw new Error("addStaticMesh requires a static, non-instanced Three.js Mesh.");
  const geometry = mesh.geometry, positions = geometry?.getAttribute("position"), index = geometry?.getIndex();
  if (!positions || positions.itemSize !== 3 || positions.count < 3) throw new Error("Static mesh needs three-component vertex positions.");
  const count = index?.count ?? positions.count;
  let up;
  if (surfaceUp !== undefined) {
    if (!Array.isArray(surfaceUp) || surfaceUp.length !== 3 || !surfaceUp.every(Number.isFinite)) throw new Error("surfaceUp must contain three finite numbers.");
    up = new THREE.Vector3(...surfaceUp);
    if (up.lengthSq() < 1e-12) throw new Error("surfaceUp must be nonzero.");
    up.normalize();
  }
  if (count < 3 || count % 3) throw new Error("Static mesh indices must describe complete triangles.");
  if (geometry.drawRange.start !== 0 || geometry.drawRange.count < count) throw new Error("Use a complete collision mesh rather than a partial drawRange.");
  mesh.updateWorldMatrix(true, false);
  const determinant = mesh.matrixWorld.determinant();
  if (!mesh.matrixWorld.elements.every(Number.isFinite) || Math.abs(determinant) < 1e-12) throw new Error("Static mesh transform must be finite and invertible.");
  const vertices = new Float32Array(positions.count * 3), indices = new Uint32Array(count), vertex = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
    if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) throw new Error("Static mesh vertices must be finite.");
    vertex.toArray(vertices, i * 3);
  }
  for (let i = 0; i < count; i++) {
    const value = index ? index.getX(i) : i;
    if (!Number.isInteger(value) || value < 0 || value >= positions.count) throw new Error("Static mesh index is out of bounds.");
    indices[i] = value;
  }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    let flip = determinant < 0;
    if (up) {
      a.fromArray(vertices, indices[i] * 3); b.fromArray(vertices, indices[i + 1] * 3); c.fromArray(vertices, indices[i + 2] * 3);
      flip = b.sub(a).cross(c.sub(a)).dot(up) < 0;
    }
    if (flip) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  }
  // Weld shared seams and suppress ghost contacts on internal triangle edges.
  // Rapier's edge correction uses oriented normals. An open, double-sided
  // render surface needs an explicit collision side; never modify its art.
  return RAPIER.ColliderDesc.trimesh(vertices, indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES);
}
