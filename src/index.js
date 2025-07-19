import { GameSystems } from "./gameSystems.js";
import * as CoreComponents from "./components/index.js";

// The singleton engine instance that all game templates will interact with.
// It is instantiated here, within the engine's private scope.
const engine = new GameSystems();

// Export a curated public API.
export { engine, CoreComponents };
