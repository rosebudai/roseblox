/**
 * DEBUG COORDINATE SYSTEM
 * Displays real-time player coordinates and debug info.
 */

let debugCollisionStatus = "No collisions";
let debugLastCollision = "";

export function setupDebugCoordinateDisplay(world, config) {
  if (!config.DEBUG) return;

  const debugContainer = document.createElement("div");
  debugContainer.id = "debug-coordinates";
  debugContainer.style.cssText = `position:fixed;top:10px;left:10px;background:rgba(0,0,0,0.8);color:#0f0;padding:15px;border-radius:8px;font-family:monospace;font-size:14px;z-index:1000;border:1px solid #0f0;min-width:250px`;
  debugContainer.innerHTML = `
    <div style="color:#ff0;font-weight:bold;margin-bottom:10px">🐛 DEBUG</div>
    <div id="player-coords">Player: (0, 0, 0)</div>
    <div id="terrain-height">Terrain: 0</div>
    <div id="movement-state">State: idle</div>
    <div id="grounded-state">Grounded: false</div>
    <div id="velocity-info">Velocity: (0, 0, 0)</div>
    <div id="collision-status" style="margin-top:8px;color:#9f9;font-size:12px">Status: No collisions</div>
  `;
  document.body.appendChild(debugContainer);
}

function updateDebugCoordinateDisplay(world, terrain) {
  const debugContainer = document.getElementById("debug-coordinates");
  if (!debugContainer) return;

  const player = world.with("isPlayer", "transform", "movementState").first;
  if (!player) return;

  const pos = player.transform.position;
  const movement = player.movementState;
  const v = movement.velocity;
  const terrainHeight = terrain?.getTerrainHeightAt?.(pos.x, pos.z) || 0;
  const state = player.stateMachine?.currentState || "unknown";
  const grounded = movement.grounded || false;
  const speed = Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
  const heightDiff = pos.y - terrainHeight;

  const els = {
    coords: document.getElementById("player-coords"),
    height: document.getElementById("terrain-height"),
    state: document.getElementById("movement-state"),
    ground: document.getElementById("grounded-state"),
    vel: document.getElementById("velocity-info"),
    collision: document.getElementById("collision-status"),
  };

  if (els.coords)
    els.coords.textContent = `Player: (${pos.x.toFixed(1)}, ${pos.y.toFixed(
      1
    )}, ${pos.z.toFixed(1)})`;
  if (els.height)
    els.height.innerHTML = `Terrain: ${terrainHeight.toFixed(
      1
    )} <span style="color:${
      heightDiff > 1 ? "#f66" : "#6f6"
    }">(+${heightDiff.toFixed(1)})</span>`;
  if (els.state) els.state.textContent = `State: ${state}`;
  if (els.ground)
    els.ground.innerHTML = `Grounded: <span style="color:${
      grounded ? "#6f6" : "#f66"
    }">${grounded}</span>`;
  if (els.vel)
    els.vel.textContent = `Velocity: (${v.x.toFixed(1)}, ${v.y.toFixed(
      1
    )}, ${v.z.toFixed(1)}) Speed: ${speed.toFixed(1)}`;
  if (els.collision) {
    els.collision.innerHTML = debugLastCollision
      ? `Status: ${debugCollisionStatus}<br><span style="color:#ff9;font-size:11px">${debugLastCollision}</span>`
      : `Status: ${debugCollisionStatus}`;
  }
}

export function updateDebugCollisionStarted(entityA, entityB) {
  if (!(entityA.isPlayer || entityB.isPlayer)) return;
  debugCollisionStatus = "Collision active";
  debugLastCollision = `${getEntityName(entityA)} ↔ ${getEntityName(entityB)}`;
}

export function updateDebugCollisionEnded(entityA, entityB) {
  if (!(entityA?.isPlayer || entityB?.isPlayer)) return;
  debugCollisionStatus = "Collision ended";
  setTimeout(() => {
    if (debugCollisionStatus === "Collision ended") {
      debugCollisionStatus = "No collisions";
      debugLastCollision = "";
    }
  }, 2000);
}

function getEntityName(entity) {
  return (
    entity.testId ||
    (entity.isPlayer && "Player") ||
    (entity.isTerrain && "Terrain") ||
    (entity.isCollectible && "Collectible") ||
    (entity.isTestCollisionObject &&
      `Test ${entity.isTestCollisionObject.shape}`) ||
    (entity.isCharacterController && "Character Controller") ||
    "Unknown"
  );
}

export function debugCoordinateSystem(world, terrain) {
  updateDebugCoordinateDisplay(world, terrain);
}
