/** On-screen touch input for one player: left-thumb joystick, right-side look drag, jump and host buttons. Mouse input passes through to the game. */

/** True on any touchscreen, including touch laptops, matching the controls Rosie shipped before. */
export function touchAvailable(win) {
  return !!win && ("ontouchstart" in win || win.navigator?.maxTouchPoints > 0);
}

/** True when a mouse or trackpad is also present, so pointer lock is worth requesting. */
export function finePointer(win) {
  return !!win?.matchMedia?.("(any-pointer: fine)")?.matches;
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
  // The overlay only draws. Touch and pen input is read at the document so a HUD layered over the
  // canvas cannot swallow it, and mouse input always reaches the game's own desktop controls.
  const root = el({ position: "fixed", zIndex: "50", display: "none", pointerEvents: "none", userSelect: "none", webkitUserSelect: "none" });
  root.dataset.rosebloxTouch = "";
  const ring = el({ position: "absolute", display: "none", width: `${radius * 2}px`, height: `${radius * 2}px`, marginLeft: `${-radius}px`, marginTop: `${-radius}px`,
    borderRadius: "50%", border: "2px solid rgba(255,255,255,.45)", background: "rgba(255,255,255,.12)", pointerEvents: "none" }, root);
  ring.dataset.rosebloxTouch = "stick";
  const knob = el({ position: "absolute", left: "50%", top: "50%", width: "48px", height: "48px", marginLeft: "-24px", marginTop: "-24px",
    borderRadius: "50%", background: "rgba(255,255,255,.55)" }, ring);
  const column = el({ position: "absolute", right: "20px", bottom: "24px", display: "flex", flexDirection: "column-reverse", alignItems: "center", gap: "14px", pointerEvents: "none" }, root);

  let move = null, look = null, shown = false, bodyTouchAction = null, disposed = false;
  const endMove = () => { move = null; ring.style.display = "none"; knob.style.transform = ""; player.setAxis(0, 0); };
  const endLook = () => { look = null; };
  const interactive = target => target?.closest?.("button, a, input, select, textarea, label, [role=button], [contenteditable=true], [data-roseblox-touch=button]");
  const stickDrag = event => event.pointerType === "touch" || event.pointerType === "pen";

  function down(event) {
    if (!shown || !stickDrag(event) || interactive(event.target)) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
    const left = x < rect.width / 2;
    if (left ? move : look) return;
    // Consumed: no compatibility mouse events, and no canvas handlers acting on the same touch.
    event.preventDefault(); event.stopPropagation();
    if (left) {
      move = { id: event.pointerId, x: event.clientX, y: event.clientY };
      Object.assign(ring.style, { display: "block", left: `${x}px`, top: `${y}px` });
    } else look = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function drag(event) {
    if (move?.id === event.pointerId) {
      event.preventDefault();
      let dx = event.clientX - move.x, dy = event.clientY - move.y;
      const length = Math.hypot(dx, dy);
      if (length > radius) { dx *= radius / length; dy *= radius / length; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // Screen down is backward (+z); the stick's magnitude sets walking speed.
      const x = dx / radius, z = dy / radius;
      if (Math.hypot(x, z) < DEAD_ZONE) player.setAxis(0, 0); else player.setAxis(x, z);
    } else if (look?.id === event.pointerId) {
      event.preventDefault();
      player.look((event.clientX - look.x) * lookScale, (event.clientY - look.y) * lookScale);
      look.x = event.clientX; look.y = event.clientY;
    }
  }
  function up(event) {
    if (move?.id === event.pointerId) endMove();
    if (look?.id === event.pointerId) endLook();
  }
  const listeners = [["pointerdown", down], ["pointermove", drag], ["pointerup", up], ["pointercancel", up]];
  for (const [type, handler] of listeners) doc.addEventListener(type, handler, { capture: true, passive: false });

  const held = new Map();
  function addButton({ label, action, onPress, onRelease }) {
    if (!label || (!action && !onPress)) throw new Error("Touch buttons need a label and an action or onPress.");
    const button = el({ width: "64px", height: "64px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
      border: "2px solid rgba(255,255,255,.5)", background: "rgba(255,255,255,.18)", color: "#fff", font: "600 13px system-ui, sans-serif",
      textShadow: "0 1px 2px rgba(0,0,0,.6)", pointerEvents: "auto", touchAction: "none", cursor: "pointer" }, column);
    button.textContent = label;
    button.dataset.rosebloxTouch = "button";
    const release = () => {
      if (!held.has(button)) return;
      held.delete(button); button.style.background = "rgba(255,255,255,.18)";
      if (action) player.setAction(action, false);
      onRelease?.();
    };
    button.addEventListener("pointerdown", event => {
      event.preventDefault(); event.stopPropagation();
      try { button.setPointerCapture?.(event.pointerId); } catch {}
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
        // Stop the browser panning or zooming under a thumb, only while the controls are live.
        if (on) { bodyTouchAction = doc.body.style.touchAction; doc.body.style.touchAction = "none"; }
        else { doc.body.style.touchAction = bodyTouchAction ?? ""; releaseAll(); }
      }
      if (!on) return;
      const rect = canvas.getBoundingClientRect();
      Object.assign(root.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    },
    // Safe to call twice, as world.dispose() and player.remove() both do in either order.
    dispose() {
      if (disposed) return;
      disposed = true;
      releaseAll();
      for (const [type, handler] of listeners) doc.removeEventListener(type, handler, { capture: true });
      if (shown) doc.body.style.touchAction = bodyTouchAction ?? "";
      root.remove();
    },
  };
}
