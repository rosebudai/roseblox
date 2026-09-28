/** Free cursor selection, left orbit and right-button turning without pointer lock. */
export function createRpgControls({ canvas, enter, pause, look, turn, select, resetInput }) {
  const doc = canvas.ownerDocument, win = doc.defaultView;
  const buttons = new Set(), listeners = [];
  let active = false, pointer = null, x = 0, y = 0, click = null;
  const listen = (target, name, fn) => {
    target.addEventListener(name, fn); listeners.push(() => target.removeEventListener(name, fn));
  };
  function releaseCapture() {
    const id = pointer; pointer = null;
    if (id !== null && canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
  }
  function reset() { buttons.clear(); click = null; releaseCapture(); resetInput(); }
  function stop() { active = false; reset(); pause(); }
  function down(event) {
    if (!active || (event.pointerType && event.pointerType !== "mouse") || ![0, 2].includes(event.button)) return;
    if (pointer !== null && pointer !== event.pointerId) return;
    canvas.focus({ preventScroll: true });
    pointer = event.pointerId; x = event.clientX; y = event.clientY;
    buttons.add(event.button);
    click = event.button === 0 && !buttons.has(2) ? { x, y } : null;
    if (buttons.has(2)) { turn(); canvas.setPointerCapture?.(pointer); event.preventDefault(); }
  }
  function move(event) {
    if (!active || pointer !== event.pointerId) return;
    let dx = event.clientX - x, dy = event.clientY - y;
    if (click) {
      if (Math.hypot(event.clientX - click.x, event.clientY - click.y) <= 5) return;
      dx = event.clientX - click.x; dy = event.clientY - click.y;
      click = null; canvas.setPointerCapture?.(pointer);
    }
    x = event.clientX; y = event.clientY;
    if (buttons.size && Number.isFinite(dx) && Number.isFinite(dy)) look(dx, dy, buttons.has(2));
  }
  function up(event) {
    if (!active || pointer !== event.pointerId) return;
    const rect = canvas.getBoundingClientRect();
    const selected = event.button === 0 && click && !buttons.has(2)
      && Math.hypot(event.clientX - click.x, event.clientY - click.y) <= 5
      && event.clientX >= rect.left && event.clientX <= rect.left + rect.width
      && event.clientY >= rect.top && event.clientY <= rect.top + rect.height;
    buttons.delete(event.button); click = null;
    if (!buttons.size) releaseCapture();
    if (selected) select(event);
  }
  listen(canvas, "pointerdown", down);
  // A mouse emits pointerdown/up only for its first/last button. Chord changes
  // arrive as pointermove; reconcile them to support LMB+RMB without stuck input.
  listen(doc, "pointermove", event => {
    if (pointer !== event.pointerId) return;
    if (typeof event.buttons === "number") {
      if (event.buttons & 2) {
        if (!buttons.has(2)) { x = event.clientX; y = event.clientY; click = null; turn(); canvas.setPointerCapture?.(pointer); }
        buttons.add(2);
      } else buttons.delete(2);
      if (event.buttons & 1) buttons.add(0); else buttons.delete(0);
      if (!buttons.size) { reset(); return; }
    }
    move(event);
  });
  listen(doc, "pointerup", up);
  listen(canvas, "pointercancel", reset);
  listen(canvas, "lostpointercapture", () => { if (pointer !== null) reset(); });
  listen(canvas, "blur", reset);
  listen(canvas, "contextmenu", event => { if (active) event.preventDefault(); });
  listen(win, "keydown", event => { if (active && event.code === "Escape") stop(); });
  listen(win, "blur", stop);
  listen(doc, "visibilitychange", () => { if (doc.hidden) stop(); });
  return {
    get turning() { return active && buttons.has(2); },
    get orbiting() { return active && buttons.has(0) && !buttons.has(2); },
    get walking() { return active && buttons.has(0) && buttons.has(2); },
    start() { reset(); active = true; enter(); },
    cancel: stop,
    update() {},
    dispose() { stop(); for (const remove of listeners) remove(); },
  };
}
