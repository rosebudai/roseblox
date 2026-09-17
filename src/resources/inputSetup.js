const defaultKeyMappings = {
  KeyW: "forward", ArrowUp: "forward",
  KeyS: "backward", ArrowDown: "backward",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
  Space: "jump", ShiftLeft: "run", ShiftRight: "run", Escape: "escape",
};

/**
 * Input belongs to one canvas. Click/focus the canvas to receive keyboard input.
 * The existing action API is retained; isKeyDown also accepts KeyboardEvent.code.
 * setAction supports touch/gamepad adapters without synthesizing DOM events.
 */
export async function setupInput(config = {}) {
  const eventWindow = config.inputWindow ?? globalThis.window;
  const document = config.inputDocument ?? config.canvas?.ownerDocument ?? globalThis.document;
  const target = config.inputTarget ?? config.canvas ?? eventWindow;
  if (!eventWindow || !target) throw new Error("Input requires a browser window and a canvas/inputTarget.");
  const keyMappings = { ...defaultKeyMappings, ...config.keyMappings };
  const keys = new Set();
  const actions = new Set();
  const pressedActions = new Set();
  const buttons = new Set();
  let mouseX = 0;
  let mouseY = 0;
  let disposed = false;
  const listeners = [];
  const listen = (object, type, listener) => {
    object?.addEventListener(type, listener);
    listeners.push(() => object?.removeEventListener(type, listener));
  };
  const reset = () => { keys.clear(); actions.clear(); pressedActions.clear(); buttons.clear(); };
  const editable = (element) => element?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element?.tagName ?? "");
  const focused = () => target === eventWindow || document?.pointerLockElement === target || document?.activeElement === target || target.contains?.(document?.activeElement);
  const active = (action) => actions.has(action) || [...keys].some((key) => keyMappings[key] === action);
  const originalTabIndex = target.getAttribute?.("tabindex");
  if (target !== eventWindow && target.tabIndex < 0) target.tabIndex = 0;

  listen(eventWindow, "keydown", (event) => {
    if (!focused() || editable(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
    const action = keyMappings[event.code];
    if (action && !event.repeat && !active(action)) pressedActions.add(action);
    keys.add(event.code);
    if (keyMappings[event.code]) event.preventDefault();
  });
  listen(eventWindow, "keyup", (event) => {
    const wasDown = keys.delete(event.code);
    if (wasDown && keyMappings[event.code] && !editable(event.target)) event.preventDefault();
  });
  listen(target, "mousedown", (event) => {
    if (editable(event.target)) return;
    target.focus?.({ preventScroll: true });
    buttons.add(event.button ?? 0);
  });
  listen(eventWindow, "mouseup", (event) => buttons.delete(event.button ?? 0));
  listen(eventWindow, "mousemove", (event) => {
    if (!focused() && event.target !== target) return;
    mouseX = event.clientX;
    mouseY = event.clientY;
  });
  listen(eventWindow, "blur", reset);
  listen(target, "blur", reset);
  listen(document, "visibilitychange", () => { if (document.hidden) reset(); });
  if (config.autoFocus !== false) target.focus?.({ preventScroll: true });

  return {
    isActionActive: active,
    consumeActionPress: action => pressedActions.delete(action),
    isKeyDown: (code) => keys.has(code),
    setAction(action, enabled) {
      if (disposed) return;
      if (enabled) { if (!active(action)) pressedActions.add(action); actions.add(action); } else actions.delete(action);
    },
    getMousePosition: () => ({ x: mouseX, y: mouseY }),
    isMouseDown: (button = 0) => buttons.has(button),
    getMovementVector: () => ({
      x: Number(active("right")) - Number(active("left")),
      z: Number(active("backward")) - Number(active("forward")),
    }),
    reset,
    dispose() {
      if (disposed) return;
      disposed = true;
      reset();
      for (const remove of listeners) remove();
      if (target !== eventWindow) {
        if (originalTabIndex == null) target.removeAttribute?.("tabindex");
        else target.setAttribute?.("tabindex", originalTabIndex);
      }
    },
  };
}
