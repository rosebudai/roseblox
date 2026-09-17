/** Nearest-first candidates inside a forward swing, with caller-owned occlusion. */
export function queryMeleeTargets(origin, forward, candidates, { range = 3, arc = Math.PI * 2 / 3, visible = () => true } = {}) {
  if (!Number.isFinite(range) || range <= 0 || !Number.isFinite(arc) || arc <= 0 || arc > Math.PI * 2) throw new Error("Melee range must be positive and arc must be in (0, 2π].");
  const length = Math.hypot(forward.x, forward.z);
  if (length < 1e-8) return [];
  const threshold = Math.cos(arc / 2), hits = [];
  for (const candidate of candidates) {
    const dx = candidate.position.x - origin.x, dy = candidate.position.y - origin.y, dz = candidate.position.z - origin.z;
    const distance = Math.hypot(dx, dy, dz), horizontal = Math.hypot(dx, dz);
    if (distance > range || (horizontal > 1e-8 && (dx * forward.x + dz * forward.z) / (horizontal * length) < threshold)) continue;
    if (visible(candidate)) hits.push({ candidate, distance });
  }
  return hits.sort((a, b) => a.distance - b.distance).map(hit => hit.candidate);
}
