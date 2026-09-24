/** Character controls for any 3D game: physics, collision, player movement, cameras, pointer lock and touch. */
import { createRpgWorld, fitRpgModel } from "./rpg.js";

/** A physics world whose players default to standard action controls: WASD, captured mouse look and movement facing. */
export function createWorld({ playerDefaults, ...options } = {}) {
  return createRpgWorld({ ...options, playerDefaults: { controlMode: "pointer", facing: "movement", ...playerDefaults } });
}

export { fitRpgModel as fitModel };
