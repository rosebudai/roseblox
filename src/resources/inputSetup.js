/**
 * Input Setup
 *
 * Handles initialization of the input system.
 * Self-contained setup that returns resources needed by other systems.
 * Includes mobile controls support for touch devices.
 */

import { MobileControls } from './mobileControls.js';

// Raw input state management - hardware agnostic
const rawInputState = {
  // Movement keys
  forward: false, // W
  backward: false, // S
  left: false, // A
  right: false, // D

  // Action keys
  jump: false, // Space
  run: false, // Shift
  escape: false, // ESC

  // Mouse
  mouseX: 0,
  mouseY: 0,
  mouseDown: false,
};

// Key mappings for keyboard
const keyMappings = {
  KeyW: "forward",
  ArrowUp: "forward",

  KeyS: "backward",
  ArrowDown: "backward",

  KeyA: "left",
  ArrowLeft: "left",

  KeyD: "right",
  ArrowRight: "right",

  Space: "jump",
  ShiftLeft: "run",
  ShiftRight: "run",
  Escape: "escape",
};

/**
 * Setup the input system
 * @returns {Object} Input resource for other systems
 */
export async function setupInput() {
  // Initialize raw input listeners
  // Keyboard events
  window.addEventListener("keydown", (event) => {
    const action = keyMappings[event.code];
    if (action) {
      rawInputState[action] = true;
      event.preventDefault(); // Prevent browser shortcuts
    }
  });

  window.addEventListener("keyup", (event) => {
    const action = keyMappings[event.code];
    if (action) {
      rawInputState[action] = false;
      event.preventDefault();
    }
  });

  // Mouse events (for future camera control)
  window.addEventListener("mousemove", (event) => {
    rawInputState.mouseX = event.clientX;
    rawInputState.mouseY = event.clientY;
  });

  window.addEventListener("mousedown", () => {
    rawInputState.mouseDown = true;
  });

  window.addEventListener("mouseup", () => {
    rawInputState.mouseDown = false;
  });

  // Mobile controls setup
  let mobileControls = null;
  try {
    mobileControls = new MobileControls();
    if (!mobileControls.init()) {
      mobileControls = null;
    }
  } catch (error) {
    console.warn('Failed to initialize mobile controls:', error);
    mobileControls = null;
  }

  // The new input resource object
  const inputResource = {
    isActionActive: (action) => rawInputState[action] || false,
    getMousePosition: () => ({
      x: rawInputState.mouseX,
      y: rawInputState.mouseY,
    }),
    isMouseDown: () => rawInputState.mouseDown,
    getMovementVector: () => {
      // Update from mobile controls if active
      if (mobileControls?.enabled) {
        mobileControls.updateInput(rawInputState);
      }
      
      return {
        x: (rawInputState.right ? 1 : 0) - (rawInputState.left ? 1 : 0),
        // Original polarity: forward should be -Z.
        z: (rawInputState.backward ? 1 : 0) - (rawInputState.forward ? 1 : 0),
      };
    },
    
    // Expose mobile controls for camera system
    getMobileControls: () => mobileControls,
  };

  return inputResource;
}

// --- The RAW INPUT QUERY API is now part of the returned resource object ---
