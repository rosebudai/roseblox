/**
 * GAME-SPECIFIC COMPONENT TYPE DEFINITIONS
 *
 * This file contains JSDoc type definitions for components unique to this game.
 * The actual component creation is handled by the engine's CoreComponents.
 */

/**
 * @typedef {Object} InputMovement
 * @property {number} x - Horizontal movement input (-1 to 1)
 * @property {number} z - Forward/backward movement input (-1 to 1)
 */

/**
 * @typedef {Object} InputActions
 * @property {boolean} jump - Jump action state
 * @property {boolean} run - Run/sprint action state
 */

/**
 * @typedef {Object} CharacterController
 * @property {Object} controller - Rapier character controller instance
 * @property {number} speed - The character's base movement speed
 * @property {number} runSpeed - The character's running speed
 * @property {number} jumpStrength - The force applied for jumping
 */
