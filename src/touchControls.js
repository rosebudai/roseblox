/** On-screen touch input for one player: left-thumb joystick, right-side look drag, jump and host buttons. */

/** True when the primary pointer is a finger (phones, tablets without a mouse). */
export function touchPreferred(win) {
  return !!win?.matchMedia?.("(pointer: coarse)")?.matches;
}

const DEAD_ZONE = .12;

/**
 * `player` needs `active`, `setAxis(x, z)`, `look(dx, dy)` and `setAction(name, down)`.
 * The overlay covers the canvas at z-index 50 while the player is active; call `sync()` once per frame.
 */
export function createTouchControls({ canvas, player, jump = true, buttons = [], lookScale = 1.5, radius = 52 }) {
  const doc = canvas.ownerDocument;
  const el = (style, parent) => {
    const node = doc.createElement("div");
    Object.assign(node.style, style);
    parent?.append(node);
    return node;
  };
  const root = el({ position: "fixed", zIndex: "50", display: "none", pointerEvents: "none", touchAction: "none", userSelect: "none", webkitUserSelect: "none" });
  root.dataset.rosebloxTouch = "";
  const zone = side => el({ position: "absolute", top: "0", bottom: "0", [side]: "0", width: "50%", pointerEvents: "auto", touchAction: "none" }, root);
  const moveZone = zone("left"), lookZone = zone("right");
  moveZone.dataset.rosebloxTouch = "move"; lookZone.dataset.rosebloxTouch = "look";
  const ring = el({ position: "absolute", display: "none", width: `${radius * 2}px`, height: `${radius * 2}px`, marginLeft: `${-radius}px`, marginTop: `${-radius}px`,
    borderRadius: "50%", border: "2px solid rgba(255,255,255,.45)", background: "rgba(255,255,255,.12)", pointerEvents: "none" }, moveZone);
  const knob = el({ position: "absolute", left: "50%", top: "50%", width: "48px", height: "48px", marginLeft: "-24px", marginTop: "-24px",
    borderRadius: "50%", background: "rgba(255,255,255,.55)" }, ring);
  const column = el({ position: "absolute", right: "20px", bottom: "24px", display: "flex", flexDirection: "column-reverse", alignItems: "center", gap: "14px", pointerEvents: "none" }, root);

  let move = null, look = null, shown = false;
  const capture = (target, event) => { event.preventDefault(); try { target.setPointerCapture?.(event.pointerId); } catch {} };
  const endMove = () => { move = null; ring.style.display = "none"; knob.style.transform = ""; player.setAxis(0, 0); };
  const endLook = () => { look = null; };

  moveZone.addEventListener("pointerdown", event => {
    if (move) return;
    capture(moveZone, event);
    const rect = moveZone.getBoundingClientRect();
    move = { id: event.pointerId, x: event.clientX, y: event.clientY };
    Object.assign(ring.style, { display: "block", left: `${event.clientX - rect.left}px`, top: `${event.clientY - rect.top}px` });
  });
  moveZone.addEventListener("pointermove", event => {
    if (move?.id !== event.pointerId) return;
    event.preventDefault();
    let dx = event.clientX - move.x, dy = event.clientY - move.y;
    const length = Math.hypot(dx, dy);
    if (length > radius) { dx *= radius / length; dy *= radius / length; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // Screen down is backward (+z); the stick's magnitude sets walking speed.
    const x = dx / radius, z = dy / radius;
    if (Math.hypot(x, z) < DEAD_ZONE) player.setAxis(0, 0); else player.setAxis(x, z);
  });
  lookZone.addEventListener("pointerdown", event => {
    if (look) return;
    capture(lookZone, event);
    look = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  lookZone.addEventListener("pointermove", event => {
    if (look?.id !== event.pointerId) return;
    event.preventDefault();
    player.look((event.clientX - look.x) * lookScale, (event.clientY - look.y) * lookScale);
    look.x = event.clientX; look.y = event.clientY;
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    moveZone.addEventListener(type, event => { if (move?.id === event.pointerId) endMove(); });
    lookZone.addEventListener(type, event => { if (look?.id === event.pointerId) endLook(); });
  }

  const held = new Map();
  function addButton({ label, action, onPress, onRelease }) {
    if (!label || (!action && !onPress)) throw new Error("Touch buttons need a label and an action or onPress.");
    const button = el({ width: "64px", height: "64px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
      border: "2px solid rgba(255,255,255,.5)", background: "rgba(255,255,255,.18)", color: "#fff", font: "600 13px system-ui, sans-serif",
      textShadow: "0 1px 2px rgba(0,0,0,.6)", pointerEvents: "auto", touchAction: "none" }, column);
    button.textContent = label;
    button.dataset.rosebloxTouch = "button";
    const release = () => {
      if (!held.has(button)) return;
      held.delete(button); button.style.background = "rgba(255,255,255,.18)";
      if (action) player.setAction(action, false);
      onRelease?.();
    };
    button.addEventListener("pointerdown", event => {
      capture(button, event);
      if (held.has(button)) return;
      held.set(button, release); button.style.background = "rgba(255,255,255,.4)";
      if (action) player.setAction(action, true);
      onPress?.();
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(type, release);
    return button;
  }
  if (jump) addButton({ label: "Jump", action: "jump" });
  for (const config of buttons) addButton(config);

  function releaseAll() { endMove(); endLook(); for (const release of [...held.values()]) release(); }
  doc.body.append(root);
  return {
    element: root,
    get visible() { return shown; },
    /** Follow the canvas and show controls only while the player is active. */
    sync() {
      const on = player.active;
      if (on !== shown) {
        shown = on; root.style.display = on ? "block" : "none";
        if (!on) releaseAll();
      }
      if (!on) return;
      const rect = canvas.getBoundingClientRect();
      Object.assign(root.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    },
    dispose() { releaseAll(); root.remove(); },
  };
}
