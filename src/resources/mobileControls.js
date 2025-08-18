/**
 * Mobile Controls System
 * 
 * Provides virtual joystick, buttons, and camera touch controls for mobile devices.
 * Includes built-in styles and integrates with the existing input system.
 */

import { isMobileDevice, isLandscape } from './mobileDetection.js';

export class MobileControls {
  constructor(rawInputState) {
    this.enabled = false;
    this.container = null;
    this.rawInputState = rawInputState;
    
    // Control elements
    this.joystickBase = null;
    this.joystickStick = null;
    this.buttons = new Map();
    
    // Input state
    this.joystick = { x: 0, z: 0 };
    this.buttonStates = new Map();
    
    // Touch tracking
    this.touches = new Map();
    this.joystickTouch = null;
    
    // Configuration
    this.joystickDeadZone = 0.2;
    
    // Bind methods
    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchMove = this.handleTouchMove.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
    this.handleOrientationChange = this.handleOrientationChange.bind(this);
  }

  init() {
    if (!isMobileDevice()) {
      return false;
    }

    this.injectStyles();
    this.createContainer();
    this.createJoystick();
    this.createButton('jump', 'Jump', 'jump');
    this.createButton('run', 'Run', 'run');
    this.setupEventListeners();
    
    this.enabled = true;
    return true;
  }

  injectStyles() {
    if (document.getElementById('roseblox-mobile-styles')) {
      return; // Already injected
    }

    const style = document.createElement('style');
    style.id = 'roseblox-mobile-styles';
    style.textContent = `
      .roseblox-mobile-controls {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1000;
        font-family: system-ui, -apple-system, sans-serif;
      }
      
      .roseblox-joystick-base {
        position: absolute;
        bottom: 30px;
        left: 30px;
        width: 120px;
        height: 120px;
        background: radial-gradient(circle, rgba(255,255,255,0.25), rgba(255,255,255,0.1));
        border: 3px solid rgba(255,255,255,0.4);
        border-radius: 50%;
        pointer-events: auto;
        touch-action: none;
        user-select: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      }
      
      .roseblox-joystick-stick {
        position: absolute;
        width: 50px;
        height: 50px;
        background: rgba(255,255,255,0.7);
        border: 2px solid rgba(255,255,255,0.9);
        border-radius: 50%;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        transition: all 0.1s ease;
      }
      
      .roseblox-button {
        position: absolute;
        width: 70px;
        height: 70px;
        background: rgba(255,255,255,0.25);
        border: 3px solid rgba(255,255,255,0.5);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 14px;
        font-weight: bold;
        pointer-events: auto;
        touch-action: none;
        user-select: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        transition: all 0.15s ease;
      }
      
      .roseblox-button.pressed {
        background: rgba(255,255,255,0.5);
        transform: scale(0.9);
        box-shadow: 0 2px 6px rgba(0,0,0,0.4);
      }
      
      .roseblox-button-jump {
        bottom: 120px;
        right: 30px;
      }
      
      .roseblox-button-run {
        bottom: 30px;
        right: 120px;
      }
      
      /* Responsive adjustments */
      @media (max-width: 600px) {
        .roseblox-joystick-base {
          width: 100px;
          height: 100px;
          bottom: 20px;
          left: 20px;
        }
        
        .roseblox-joystick-stick {
          width: 42px;
          height: 42px;
        }
        
        .roseblox-button {
          width: 60px;
          height: 60px;
          font-size: 12px;
        }
        
        .roseblox-button-jump {
          bottom: 100px;
          right: 20px;
        }
        
        .roseblox-button-run {
          bottom: 20px;
          right: 100px;
        }
      }
      
      @media (orientation: landscape) and (max-height: 500px) {
        .roseblox-joystick-base {
          width: 80px;
          height: 80px;
          bottom: 15px;
          left: 15px;
        }
        
        .roseblox-button {
          width: 50px;
          height: 50px;
          font-size: 11px;
        }
        
        .roseblox-button-jump {
          bottom: 80px;
          right: 15px;
        }
        
        .roseblox-button-run {
          bottom: 15px;
          right: 80px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  createContainer() {
    this.container = document.createElement('div');
    this.container.className = 'roseblox-mobile-controls';
    document.body.appendChild(this.container);
  }

  createJoystick() {
    this.joystickBase = document.createElement('div');
    this.joystickBase.className = 'roseblox-joystick-base';
    
    this.joystickStick = document.createElement('div');
    this.joystickStick.className = 'roseblox-joystick-stick';
    
    this.joystickBase.appendChild(this.joystickStick);
    this.container.appendChild(this.joystickBase);
  }

  createButton(action, label, className) {
    const button = document.createElement('div');
    button.className = `roseblox-button roseblox-button-${className}`;
    button.textContent = label;
    button.dataset.action = action;
    
    this.buttons.set(action, button);
    this.buttonStates.set(action, false);
    this.container.appendChild(button);
  }

  setupEventListeners() {
    // Touch events
    document.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    document.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    document.addEventListener('touchend', this.handleTouchEnd, { passive: false });
    document.addEventListener('touchcancel', this.handleTouchEnd, { passive: false });
    
    // Orientation change
    window.addEventListener('orientationchange', this.handleOrientationChange);
    window.addEventListener('resize', this.handleOrientationChange);
  }

  handleTouchStart(event) {
    // Only prevent default for our control elements
    for (const touch of event.changedTouches) {
      const element = document.elementFromPoint(touch.clientX, touch.clientY);
      
      if (element && element.closest('.roseblox-joystick-base')) {
        event.preventDefault();
        this.joystickTouch = touch.identifier;
        this.updateJoystick(touch);
      } else if (element && element.closest('.roseblox-button')) {
        event.preventDefault();
        const button = element.closest('.roseblox-button');
        const action = button.dataset.action;
        this.setButtonState(action, true);
        this.touches.set(touch.identifier, { type: 'button', action });
      }
    }
  }

  handleTouchMove(event) {
    for (const touch of event.changedTouches) {
      if (touch.identifier === this.joystickTouch) {
        event.preventDefault();
        this.updateJoystick(touch);
      }
    }
  }

  handleTouchEnd(event) {
    for (const touch of event.changedTouches) {
      const touchData = this.touches.get(touch.identifier);
      
      if (touch.identifier === this.joystickTouch) {
        this.resetJoystick();
        this.joystickTouch = null;
      } else if (touchData && touchData.type === 'button') {
        this.setButtonState(touchData.action, false);
      }
      
      this.touches.delete(touch.identifier);
    }
  }

  updateJoystick(touch) {
    const rect = this.joystickBase.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    const dx = touch.clientX - centerX;
    const dy = touch.clientY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxDistance = rect.width / 2 - 10; // Account for stick size
    
    // Clamp to circle
    const clampedDistance = Math.min(distance, maxDistance);
    const angle = Math.atan2(dy, dx);
    
    const clampedX = Math.cos(angle) * clampedDistance;
    const clampedY = Math.sin(angle) * clampedDistance;
    
    // Update visual position
    this.joystickStick.style.transform = 
      `translate(calc(-50% + ${clampedX}px), calc(-50% + ${clampedY}px))`;
    
    // Update input values (-1 to 1 range)
    const normalizedX = clampedX / maxDistance;
    const normalizedY = clampedY / maxDistance;
    
    // Apply dead zone and update input state directly
    const magnitude = Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY);
    if (magnitude < this.joystickDeadZone) {
      this.joystick.x = 0;
      this.joystick.z = 0;
      // Clear movement state when in dead zone
      this.rawInputState.left = false;
      this.rawInputState.right = false;
      this.rawInputState.forward = false;
      this.rawInputState.backward = false;
    } else {
      this.joystick.x = normalizedX;
      this.joystick.z = normalizedY; // Forward/backward
      
      // Update rawInputState immediately (like keyboard does)
      const threshold = 0.3;
      this.rawInputState.left = this.joystick.x < -threshold;
      this.rawInputState.right = this.joystick.x > threshold;
      this.rawInputState.forward = this.joystick.z < -threshold;
      this.rawInputState.backward = this.joystick.z > threshold;
    }
  }

  resetJoystick() {
    this.joystick.x = 0;
    this.joystick.z = 0;
    this.joystickStick.style.transform = 'translate(-50%, -50%)';
    
    // Clear movement state immediately (like keyboard does)
    this.rawInputState.left = false;
    this.rawInputState.right = false;
    this.rawInputState.forward = false;
    this.rawInputState.backward = false;
  }

  setButtonState(action, pressed) {
    this.buttonStates.set(action, pressed);
    // Update rawInputState immediately (like keyboard does)
    this.rawInputState[action] = pressed;
    
    const button = this.buttons.get(action);
    if (button) {
      button.classList.toggle('pressed', pressed);
    }
  }

  handleOrientationChange() {
    // Small delay to ensure dimensions are updated
    setTimeout(() => {
      // Could add orientation-specific adjustments here if needed
    }, 100);
  }



  destroy() {
    if (!this.enabled) return;

    // Remove event listeners
    document.removeEventListener('touchstart', this.handleTouchStart);
    document.removeEventListener('touchmove', this.handleTouchMove);
    document.removeEventListener('touchend', this.handleTouchEnd);
    document.removeEventListener('touchcancel', this.handleTouchEnd);
    window.removeEventListener('orientationchange', this.handleOrientationChange);
    window.removeEventListener('resize', this.handleOrientationChange);

    // Remove DOM elements
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }

    const styleElement = document.getElementById('roseblox-mobile-styles');
    if (styleElement && styleElement.parentNode) {
      styleElement.parentNode.removeChild(styleElement);
    }

    this.enabled = false;
  }
}