export const RPG_MOVEMENT_DEFAULTS = Object.freeze({ gravity: -20, jumpSpeed: 6.25 });

export const RPG_BINDINGS = Object.freeze([
  { label: "W/S", description: "Forward / backward" },
  { label: "A/D", description: "Turn (strafe while RMB held)" },
  { label: "Q/E", description: "Strafe" },
  { label: "RMB drag", description: "Camera and character" },
  { label: "LMB click / drag", description: "Select / orbit view" },
  { label: "Wheel", description: "Zoom" },
  { label: "Space", description: "Jump" },
  { label: "Shift", description: "Run" },
  { label: "F", description: "Interact nearby", code: "KeyF" },
  { label: "1", description: "First ability", code: "Digit1", slot: 0 },
  { label: "2", description: "Second ability", code: "Digit2", slot: 1 },
  { label: "3", description: "Third ability", code: "Digit3", slot: 2 },
  { label: "Escape", description: "Close dialogue / pause" },
]);

const SHARED_BINDINGS = [
  { label: "Space", description: "Jump" },
  { label: "Shift", description: "Run" },
  { label: "F", description: "Interact nearby", code: "KeyF" },
  { label: "1", description: "First ability", code: "Digit1", slot: 0 },
  { label: "2", description: "Second ability", code: "Digit2", slot: 1 },
  { label: "3", description: "Third ability", code: "Digit3", slot: 2 },
];

/** Captured-mouse schemes: first-person, and third-person when aiming matters. */
export const RPG_POINTER_BINDINGS = Object.freeze({
  first: Object.freeze([
    { label: "WASD", description: "Move" },
    { label: "Mouse", description: "Look" },
    { label: "LMB", description: "First ability", slot: 0 },
    ...SHARED_BINDINGS,
    { label: "Escape", description: "Close dialogue / pause; click to resume" },
  ]),
  pointer: Object.freeze([
    { label: "WASD", description: "Move" },
    { label: "Mouse", description: "Camera and facing" },
    { label: "Wheel", description: "Zoom" },
    { label: "LMB", description: "First ability", slot: 0 },
    ...SHARED_BINDINGS,
    { label: "Escape", description: "Close dialogue / pause; click to resume" },
  ]),
});

/** Third-person melee keeps the tested MMO scheme; first-person and ranged play capture the mouse. */
export function rpgControlScheme(config = {}) {
  const view = config.player?.view ?? "third";
  if (!["third", "first"].includes(view)) throw new Error("player.view must be third or first.");
  if (view === "first") return "first";
  const attacks = config.attacks ?? config.abilities ?? [];
  return attacks.some(attack => attack?.kind === "ranged") ? "pointer" : "mmo";
}

export function rpgBindings(scheme) {
  return scheme === "mmo" ? RPG_BINDINGS : RPG_POINTER_BINDINGS[scheme];
}

export const RPG_CLASSIC_KEYS = Object.freeze({
  KeyA: "turnLeft", KeyD: "turnRight", ArrowLeft: "turnLeft", ArrowRight: "turnRight", KeyQ: "left", KeyE: "right",
});
