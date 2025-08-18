/**
 * Camera Update System
 *
 * This system is responsible for updating the camera's position and target
 * each frame, typically to follow a player entity.
 * Supports both desktop and mobile camera controls.
 */

/**
 * Updates the camera's target and processes its controls.
 * @param {World} world - The ECS world instance.
 * @param {Object} context - The dependency context.
 * @param {Object} context.camera - The camera resources.
 * @param {Object} context.input - The input resources.
 * @param {number} deltaTime - The time elapsed since the last frame.
 */
export function cameraUpdateSystem(world, { camera, input }, deltaTime) {
  const cameraControls = camera?.controls;
  
  if (!cameraControls) {
    throw new Error(
      "cameraUpdateSystem: Camera controls not provided via dependency injection"
    );
  }

  // 1. Handle mobile camera touch input
  const mobileControls = input?.getMobileControls?.();
  if (mobileControls?.enabled) {
    const cameraDelta = mobileControls.getCameraDelta();
    if (cameraDelta) {
      const sensitivity = 0.003;
      
      // Apply rotation using camera-controls
      cameraControls.azimuthAngle -= cameraDelta.x * sensitivity;
      cameraControls.polarAngle = Math.max(
        0.1, 
        Math.min(Math.PI * 0.9, cameraControls.polarAngle - cameraDelta.y * sensitivity)
      );
    }
  }

  // 2. Update the camera's "look-at" target to the player's position.
  for (const entity of world) {
    if (entity.isCameraFollowTarget && entity.transform) {
      const pos = entity.transform.position;
      const offset = entity.isCameraFollowTarget.offset || { x: 0, y: 0, z: 0 };
      cameraControls.moveTo(
        pos.x + offset.x,
        pos.y + offset.y,
        pos.z + offset.z,
        true
      );
      break;
    }
  }

  // 3. Update the camera controls library to process input and transitions.
  cameraControls.update(deltaTime);
}
