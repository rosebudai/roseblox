/**
 * Input System
 *
 * This system translates the raw input state from the input resource
 * into ECS components that other game systems can react to.
 */

/**
 * Updates entities with input components based on the current input state.
 * @param {World} world - The ECS world.
 * @param {Object} context - The engine's resource context.
 * @param {Object} context.input - The input resource.
 */
export function inputSystem(world, { input }) {
  const query = world.with(
    "isInputControlled",
    "inputMovement",
    "inputActions"
  );

  for (const entity of query) {
    const moveVec = input.getMovementVector();
    entity.inputMovement.x = moveVec.x;
    entity.inputMovement.z = moveVec.z; // Correctly map z to z

    entity.inputActions.jump = input.isActionActive("jump");
    entity.inputActions.run = input.isActionActive("run");
  }
}
