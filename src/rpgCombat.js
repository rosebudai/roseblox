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

/** The visible candidate closest to the aim ray from the eye, within range of and in front of the shooter. */
export function queryRangedTarget(eye, direction, from, candidates, { range = 40, cone = .44, visible = () => true } = {}) {
  if (!Number.isFinite(range) || range <= 0 || !Number.isFinite(cone) || cone < 0 || cone > Math.PI) throw new Error("Ranged range must be positive and cone must be in [0, π].");
  const length = Math.hypot(direction.x, direction.y, direction.z), flat = Math.hypot(direction.x, direction.z);
  if (length < 1e-8) return null;
  const aimed = [];
  for (const candidate of candidates) {
    const p = candidate.position, distance = Math.hypot(p.x - from.x, p.y - from.y, p.z - from.z);
    // A third-person camera sits behind the shooter; enemies between them are behind the shot.
    if (distance > range || (flat > 1e-8 && (p.x - from.x) * direction.x + (p.z - from.z) * direction.z <= 0)) continue;
    const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z, span = Math.hypot(dx, dy, dz);
    const angle = span < 1e-8 ? 0 : Math.acos(Math.max(-1, Math.min(1, (dx * direction.x + dy * direction.y + dz * direction.z) / (span * length))));
    if (angle <= cone) aimed.push({ candidate, angle, distance });
  }
  aimed.sort((a, b) => a.angle - b.angle || a.distance - b.distance);
  return aimed.find(({ candidate }) => visible(candidate))?.candidate ?? null;
}
