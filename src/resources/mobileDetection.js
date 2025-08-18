/**
 * Mobile Detection Utility
 * 
 * Simple utility for detecting mobile devices and touch capabilities.
 * Used to determine when to show mobile controls.
 */

/**
 * Detects if the device has touch capabilities
 * @returns {boolean} True if device supports touch
 */
export function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

/**
 * Detects if device is likely mobile based on screen size and user agent
 * @returns {boolean} True if device appears to be mobile
 */
export function isMobileDevice() {
  // Check for touch capability first
  if (!isTouchDevice()) {
    return false;
  }
  
  // Check screen size (mobile/tablet threshold)
  const screenWidth = Math.min(window.screen.width, window.screen.height);
  const isMobileSize = screenWidth <= 768;
  
  // Check user agent for mobile indicators
  const userAgent = navigator.userAgent.toLowerCase();
  const mobileKeywords = ['mobile', 'android', 'iphone', 'ipad', 'ipod', 'blackberry', 'windows phone'];
  const hasMobileUA = mobileKeywords.some(keyword => userAgent.includes(keyword));
  
  return isMobileSize || hasMobileUA;
}

/**
 * Detects if device is in landscape orientation
 * @returns {boolean} True if in landscape mode
 */
export function isLandscape() {
  return window.innerWidth > window.innerHeight;
}

/**
 * Gets viewport dimensions
 * @returns {Object} Object with width and height properties
 */
export function getViewportSize() {
  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}