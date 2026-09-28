// Optional presentation helpers. This entry never creates a game or physics world.
import { AssetManager } from "./resources/assetManager.js";
import { createCameraModels } from "./cameraModels.js";

export function createViewModels({ camera }) {
  const assets = new AssetManager();
  const models = createCameraModels({ camera, assets });
  let disposed = false;
  return {
    attach: (url, options) => models.attach(url, options),
    update: dt => models.update(dt),
    dispose() { if (disposed) return; disposed = true; models.dispose(); assets.dispose(); },
  };
}
export { createEnvironment } from "./environment.js";
export { createSurfaceMaterials } from "./surfaceMaterials.js";
export { AssetManager } from "./resources/assetManager.js";
export { makeInstance, modelHandle } from "./modelAttachments.js";
export { createHud } from "./hud.js";
