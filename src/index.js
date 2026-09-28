import { GameSystems } from "./gameSystems.js";
import * as CoreComponents from "./components/index.js";

/** Create an isolated game engine; call dispose() when its preview is removed. */
export function createEngine(options = {}) {
  return new GameSystems(options);
}

// Compatibility with existing templates importing the singleton.
export const engine = createEngine();
export { GameSystems, CoreComponents };
export { createGame } from "./game.js";
export { createVoxelKit } from "./voxelKit.js";
export { createHud } from "./hud.js";
export { createInteriorLighting, createFramedBox } from "./presentation.js";
