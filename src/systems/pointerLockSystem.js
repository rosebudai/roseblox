/**
 * Pointer Lock System
 *
 * Handles configurable pointer lock behavior for camera controls.
 * Supports different trigger/release modes based on configuration.
 */

/**
 * Pointer lock system - handles configurable pointer lock behavior
 * @param {Object} cameraControls - Camera controls instance
 * @param {Object} input - Input resource
 * @param {Object} config - Game configuration
 */
export function pointerLockSystem(cameraControls, input, config) {
  if (!cameraControls || !input) {
    return; // Skip if dependencies not available
  }

  const pointerLockConfig = config.CAMERA?.POINTER_LOCK;
  if (!pointerLockConfig?.ENABLED) {
    return; // Skip if pointer lock is disabled
  }

  const { TRIGGER, RELEASE } = pointerLockConfig;

  // Handle pointer lock trigger
  switch (TRIGGER) {
    case "click":
      if (input.isMouseDown()) {
        cameraControls.lockPointer();
      }
      break;
    case "keydown":
      // Could add specific key handling here
      break;
    case "manual":
      // Do nothing - let game code handle it manually
      break;
  }

  // Handle pointer lock release
  switch (RELEASE) {
    case "esc":
      if (input.isActionActive("escape")) {
        cameraControls.unlockPointer();
      }
      break;
    case "keyup":
      // Could add specific key handling here
      break;
    case "manual":
      // Do nothing - let game code handle it manually
      break;
  }
}