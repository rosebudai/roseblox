/**
 * @typedef {Object} StateMachine
 * @property {string} initial - The name of the initial state.
 * @property {Object} states - A map of state names to their definitions.
 * @property {string} currentState - The entity's current state in the machine.
 * @property {number} stateTime - The time elapsed since entering the current state.
 */

/**
 * Creates a generic, data-driven state machine component.
 * The animation system uses this to control character animations based on `movementState` and other data.
 * The machine is defined by a graph of states and the conditions that trigger transitions between them.
 *
 * @param {object} definition - The state machine definition object.
 * @param {string} definition.initial - The key of the state to start in.
 * @param {object} definition.states - A map where keys are state names and values are state definitions.
 * @returns {StateMachine} A new state machine component, ready to be processed by a system.
 * @example
 * const playerFSM = createStateMachine({
 *   initial: 'idle',
 *   states: {
 *     idle: {
 *       animation: 'Idle',
 *       transitions: [
 *         { to: 'run', when: { property: 'speed', is: '>', than: 0.1 } }
 *       ]
 *     },
 *     run: {
 *       animation: 'Run',
 *       transitions: [
 *         { to: 'idle', when: { property: 'speed', is: '<', than: 0.1 } }
 *       ]
 *     }
 *   }
 * });
 * world.add(entity, { stateMachine: playerFSM });
 */
export function createStateMachine(definition) {
  if (!definition.initial || !definition.states[definition.initial]) {
    throw new Error(
      "State machine definition must have a valid initial state."
    );
  }

  return {
    ...definition,
    currentState: definition.initial,
    stateTime: 0,
  };
}
