/**
 * DEBUG COORDINATE SYSTEM
 *
 * Displays real-time player coordinates and other useful debug information
 * for understanding terrain layout and positioning.
 */

/**
 * Creates and manages the debug coordinate display UI.
 * @param {World} world - ECS world instance.
 * @param {Object} config - Game configuration.
 */
// Global collision tracking for debug display
let debugCollisionStatus = "No collisions";
let debugLastCollision = "";

export function setupDebugCoordinateDisplay(world, config) {
  // Only create debug display if DEBUG is enabled
  if (!config.DEBUG) {
    return;
  }

  console.log("🐛 Setting up debug coordinate display...");

  // Create debug UI container
  const debugContainer = document.createElement("div");
  debugContainer.id = "debug-coordinates";
  debugContainer.style.cssText = `
    position: fixed;
    top: 10px;
    left: 10px;
    background: rgba(0, 0, 0, 0.8);
    color: #00ff00;
    padding: 15px;
    border-radius: 8px;
    font-family: 'Courier New', monospace;
    font-size: 14px;
    line-height: 1.4;
    z-index: 1000;
    border: 1px solid #00ff00;
    min-width: 250px;
  `;

  // Add initial content
  debugContainer.innerHTML = `
    <div style="color: #ffff00; font-weight: bold; margin-bottom: 10px;">🐛 DEBUG INFO</div>
    <div id="player-coords">Player: (0.0, 0.0, 0.0)</div>
    <div id="terrain-height">Terrain Height: 0.0</div>
    <div id="movement-state">State: idle</div>
    <div id="grounded-state">Grounded: false</div>
    <div id="velocity-info">Velocity: (0.0, 0.0, 0.0)</div>
    <div id="collision-status" style="margin-top: 8px; color: #99ff99; font-size: 12px;">Status: No collisions</div>
    <div style="margin-top: 10px; color: #888; font-size: 12px;">
      Terrain: 50x50 blocks<br>
      Bounds: X[-25,25] Z[-25,25]
    </div>
  `;

  // Append to body
  document.body.appendChild(debugContainer);

  console.log("✅ Debug coordinate display created!");
}

/**
 * Updates the debug coordinate display with current player information.
 * This should be called every frame from a runtime system.
 * @param {World} world - ECS world instance.
 * @param {Object} terrain - Terrain resource for height queries.
 */
export function updateDebugCoordinateDisplay(world, terrain) {
  const debugContainer = document.getElementById("debug-coordinates");
  if (!debugContainer) {
    return; // Debug display not created or DEBUG is disabled
  }

  // Find the player entity
  const playerQuery = world.with("isPlayer", "transform", "movementState");
  const player = playerQuery.first;

  if (!player) {
    return; // No player found
  }

  const pos = player.transform.position;
  const movement = player.movementState;
  const velocity = movement.velocity;

  // Get terrain height at player position
  let terrainHeight = 0;
  if (terrain && terrain.getTerrainHeightAt) {
    terrainHeight = terrain.getTerrainHeightAt(pos.x, pos.z);
  }

  // Get player state
  const state = player.stateMachine
    ? player.stateMachine.currentState
    : "unknown";
  const grounded = movement.grounded !== undefined ? movement.grounded : false;

  // Update display elements
  const coordsEl = document.getElementById("player-coords");
  const heightEl = document.getElementById("terrain-height");
  const stateEl = document.getElementById("movement-state");
  const groundedEl = document.getElementById("grounded-state");
  const velocityEl = document.getElementById("velocity-info");
  const collisionStatusEl = document.getElementById("collision-status");

  if (coordsEl) {
    coordsEl.textContent = `Player: (${pos.x.toFixed(1)}, ${pos.y.toFixed(
      1
    )}, ${pos.z.toFixed(1)})`;
  }

  if (heightEl) {
    const heightDiff = pos.y - terrainHeight;
    heightEl.innerHTML = `Terrain Height: ${terrainHeight.toFixed(
      1
    )} <span style="color: ${
      heightDiff > 1 ? "#ff6666" : "#66ff66"
    }">(+${heightDiff.toFixed(1)})</span>`;
  }

  if (stateEl) {
    stateEl.textContent = `State: ${state}`;
  }

  if (groundedEl) {
    groundedEl.innerHTML = `Grounded: <span style="color: ${
      grounded ? "#66ff66" : "#ff6666"
    }">${grounded}</span>`;
  }

  if (velocityEl) {
    const speed = Math.sqrt(
      velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2
    );
    velocityEl.textContent = `Velocity: (${velocity.x.toFixed(
      1
    )}, ${velocity.y.toFixed(1)}, ${velocity.z.toFixed(
      1
    )}) Speed: ${speed.toFixed(1)}`;
  }

  // Update collision info
  if (collisionStatusEl) {
    collisionStatusEl.textContent = `Status: ${debugCollisionStatus}`;
    if (debugLastCollision) {
      collisionStatusEl.innerHTML = `Status: ${debugCollisionStatus}<br><span style="color: #ffff99; font-size: 11px;">${debugLastCollision}</span>`;
    }
  }
}

/**
 * Updates collision debug info when a collision starts.
 * @param {Object} entityA - First entity in collision.
 * @param {Object} entityB - Second entity in collision.
 */
export function updateDebugCollisionStarted(entityA, entityB) {
  if (!(entityA.isPlayer || entityB.isPlayer)) return;

  debugCollisionStatus = "Collision active";
  const aType = getEntityDisplayName(entityA);
  const bType = getEntityDisplayName(entityB);
  debugLastCollision = `${aType} ↔ ${bType}`;
}

/**
 * Gets a display name for an entity in collision debug info.
 * @param {Object} entity - The entity to get a display name for.
 * @returns {string} The display name for the entity.
 */
function getEntityDisplayName(entity) {
  if (entity.testId) return entity.testId;
  if (entity.isPlayer) return "Player";
  if (entity.isTerrain) return "Terrain";
  if (entity.isCollectible) return "Collectible";
  if (entity.isTestCollisionObject) return `Test ${entity.isTestCollisionObject.shape}`;
  if (entity.isCharacterController) return "Character Controller";
  return "Unknown Entity";
}

/**
 * Updates collision debug info when a collision ends.
 * @param {Object} entityA - First entity in collision.
 * @param {Object} entityB - Second entity in collision.
 */
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

/**
 * Debug coordinate update system - updates the coordinate display every frame.
 * @param {World} world - ECS world instance.
 * @param {Object} terrain - Terrain resource.
 */
export function debugCoordinateSystem(world, terrain) {
  updateDebugCoordinateDisplay(world, terrain);
}
