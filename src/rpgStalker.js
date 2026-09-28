/** Perception and alert rules for stalker enemies; movement, rays and rendering stay with the caller. */

/** What a stalker notices this step. `bearing` is the angle in radians between its facing and the player. */
export function stalkerSenses({ distance, bearing, clear, hidden = false, moving = false, running = false, sneaking = false, mode = "patrol" }, def = {}) {
  const sight = def.sight ?? 14, fov = (def.fov ?? 100) * Math.PI / 180, hearing = (def.hearing ?? 6) * (sneaking ? .5 : running ? 1.5 : 1);
  // A chaser that watched the player duck in close by still finds them.
  const caught = mode === "chase" && distance <= 2;
  const seen = !!clear && (caught || (!hidden && distance <= sight && bearing <= fov / 2));
  const heard = !hidden && moving && distance <= hearing;
  const rate = seen ? (running ? 2 : sneaking ? .5 : 1) * (distance < sight / 3 ? 2 : 1) : heard ? .5 : 0;
  return { seen, heard, rate };
}

/** Seconds a chase survives without contact, so a pillar or doorway does not flip it to a search and back. */
const CHASE_GRACE = .5;

/** Advance patrol → suspicious → chase → search → patrol. Threat is 0–1; reaching 1 starts a chase. */
export function stepStalker({ mode = "patrol", threat = 0, searchLeft = 0, blind = 0 } = {}, { seen = false, heard = false, rate = 0 } = {}, dt, def = {}) {
  const notice = def.notice ?? 1.5, loseAfter = def.loseAfter ?? 6;
  if (mode === "chase") {
    if (seen || heard) return { mode, threat: 1, searchLeft: loseAfter, blind: 0 };
    blind += dt;
    // The search still ends loseAfter seconds after the last contact.
    return blind < CHASE_GRACE ? { mode, threat: 1, searchLeft: loseAfter, blind } : { mode: "search", threat: 1, searchLeft: loseAfter - blind };
  }
  if (rate > 0) {
    threat = Math.min(1, threat + dt * rate / notice);
    return threat >= 1 ? { mode: "chase", threat: 1, searchLeft: loseAfter } : { mode: mode === "search" ? "search" : "suspicious", threat, searchLeft };
  }
  if (mode === "search") return searchLeft - dt > 0 ? { mode, threat, searchLeft: searchLeft - dt } : { mode: "patrol", threat: 0, searchLeft: 0 };
  threat = Math.max(0, threat - dt * .3);
  return { mode: threat > 0 ? "suspicious" : "patrol", threat, searchLeft: 0 };
}
