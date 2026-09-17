export const RPG_BINDINGS = Object.freeze([
  { label: "W/S", description: "Forward / backward" },
  { label: "A/D", description: "Turn (strafe while RMB held)" },
  { label: "Q/E", description: "Strafe" },
  { label: "RMB drag", description: "Camera and character" },
  { label: "LMB click / drag", description: "Select / orbit view" },
  { label: "Wheel", description: "Zoom" },
  { label: "Space", description: "Jump" },
  { label: "Shift", description: "Run" },
  { label: "F", description: "Interact", code: "KeyF" },
  { label: "1", description: "First ability", code: "Digit1", slot: 0 },
  { label: "2", description: "Second ability", code: "Digit2", slot: 1 },
  { label: "3", description: "Third ability", code: "Digit3", slot: 2 },
  { label: "Escape", description: "Close dialogue / pause" },
]);

export const RPG_CLASSIC_KEYS = Object.freeze({
  KeyA: "turnLeft", KeyD: "turnRight", ArrowLeft: "turnLeft", ArrowRight: "turnRight", KeyQ: "left", KeyE: "right",
});
