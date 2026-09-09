// A delayed native grant can arrive after a controller is disposed. One weak
// document guard releases only retired canvases, never a replacement owner.
const pointerOwners = new WeakMap(), retiredCanvases = new WeakSet(), guardedDocuments = new WeakSet();
function releaseRetiredLock(doc) {
  const target = doc.pointerLockElement;
  if (target && retiredCanvases.has(target) && !pointerOwners.has(target)) {
    try { doc.exitPointerLock?.(); } catch {}
  }
}
// Mouse capture is an enhancement, never a prerequisite for entering the game.
export function createPointerControls({canvas, getState, enter, pause, look,
  fire, release, resetInput, modeChanged, pendingChanged = () => {},
  doc = document, win = window, timeoutMs = 700}) {
  const owner = {};
  pointerOwners.set(canvas, owner); retiredCanvases.delete(canvas);
  if (!guardedDocuments.has(doc)) {
    guardedDocuments.add(doc);
    doc.addEventListener('pointerlockchange', () => releaseRetiredLock(doc));
  }
  let disposed = false, mode = 'free', pending = false, wantsLock = false, epoch = 0, timer;
  let lastX = null, lastY = null, edgeX = 0;
  const removers = [];
  const listen = (target, name, handler) => {
    target.addEventListener(name, handler);
    removers.push(() => target.removeEventListener(name, handler));
  };
  const locked = () => doc.pointerLockElement === canvas;
  const clearPending = () => {
    clearTimeout(timer); timer = undefined;
    pending = false; pendingChanged(false);
  };
  const clearInput = () => { lastX = lastY = null; edgeX = 0; resetInput(); };
  function setMode(next) {
    if (mode !== next) clearInput();
    mode = next; modeChanged(mode);
  }
  function activate(next, token) {
    if (token !== epoch || !wantsLock) return;
    const wasPending = pending;
    clearPending(); setMode(next);
    if (wasPending) { clearInput(); enter(next); }
  }
  function fallback(token) {
    if (token === epoch && pending) activate('free', token);
  }
  function cancel() {
    if (disposed) return;
    ++epoch; wantsLock = false; clearPending(); clearInput();
    if (locked() && pointerOwners.get(canvas) === owner) { try { doc.exitPointerLock?.(); } catch {} }
  }
  function requestPause() {
    const wasPlaying = getState() === 'playing';
    cancel();
    if (wasPlaying) pause();
  }
  function start() {
    if (disposed || pending || getState() === 'playing') return;
    const token = ++epoch;
    wantsLock = true; pending = true; pendingChanged(true); clearInput();
    if (locked()) { activate('locked', token); return; }
    if (typeof canvas.requestPointerLock !== 'function') { fallback(token); return; }
    timer = setTimeout(() => fallback(token), timeoutMs);
    try {
      // Keep this call inside the original trusted click gesture. Older engines
      // return undefined and signal success only through pointerlockchange.
      const result = canvas.requestPointerLock();
      if (locked()) activate('locked', token);
      if (result?.then) result.then(() => {
        if (token === epoch && locked()) activate('locked', token);
        else releaseRetiredLock(doc);
      }, error => { if (canvas.dataset) canvas.dataset.pointerLockFailure = `${error?.name}: ${error?.message}`; fallback(token); });
    } catch (error) { if (canvas.dataset) canvas.dataset.pointerLockFailure = `${error?.name}: ${error?.message}`; fallback(token); }
  }
  listen(doc, 'pointerlockchange', () => {
    if (locked()) {
      if (wantsLock && (pending || getState() === 'playing')) activate('locked', epoch);
      else { try { doc.exitPointerLock?.(); } catch {} }
    } else if (mode === 'locked') {
      setMode('free'); requestPause();
    }
  });
  listen(doc, 'pointerlockerror', () => fallback(epoch));
  listen(doc, 'mousemove', event => {
    if (getState() !== 'playing') return;
    if (mode === 'locked' && locked()) {
      look(event.movementX || 0, event.movementY || 0);
    } else if (mode === 'free' && event.target === canvas) {
      // A resumed round starts with a fresh origin, never a camera jump.
      if (lastX !== null) look(event.clientX - lastX, event.clientY - lastY);
      lastX = event.clientX; lastY = event.clientY;
      const rect = canvas.getBoundingClientRect();
      const band = Math.min(36, rect.width * .08);
      const x = event.clientX - rect.left;
      edgeX = x < band ? -(1 - x / band) : x > rect.width - band ? (x - rect.width + band) / band : 0;
      edgeX = Math.max(-1, Math.min(1, edgeX));
    }
  });
  listen(canvas, 'mousedown', event => {
    if (getState() === 'playing' && event.button === 0) fire(event);
  });
  listen(doc, 'mouseup', event => { if (event.button === 0) release(); });
  listen(canvas, 'mouseleave', () => { if (mode === 'free') requestPause(); });
  listen(doc, 'pointercancel', () => { clearInput(); });
  listen(canvas, 'contextmenu', event => event.preventDefault());
  listen(doc, 'keydown', event => {
    if (event.code === 'Escape') { event.preventDefault(); requestPause(); }
  });
  listen(win, 'blur', requestPause);
  listen(doc, 'visibilitychange', () => { if (doc.hidden) requestPause(); });
  modeChanged(mode);
  return {start, cancel, update(dt) {
    if (getState() === 'playing' && mode === 'free' && edgeX) look(edgeX * 900 * Math.min(Math.max(dt, 0), .05), 0);
  }, get mode() { return mode; },
    dispose() {
      if (disposed) return;
      cancel(); disposed = true; removers.forEach(remove => remove());
      if (pointerOwners.get(canvas) === owner) { pointerOwners.delete(canvas); retiredCanvases.add(canvas); }
      releaseRetiredLock(doc);
    }};
}
