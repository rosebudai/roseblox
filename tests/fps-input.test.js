import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Test the shipped controller without loading WebGL or rewriting its source.
const source = await readFile(new URL('../src/fpsInput.js', import.meta.url), 'utf8');
const { createPointerControls } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

class FakeTarget {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, fields = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...fields };
    for (const callback of [...(this.listeners.get(type) ?? [])]) callback(event);
    return event;
  }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(t, { request, timeoutMs = 40, surface } = {}) {
  const canvas = surface?.canvas ?? new FakeTarget();
  const doc = surface?.doc ?? new FakeTarget();
  const win = surface?.win ?? new FakeTarget();
  const record = { state: 'ready', enters: [], pauses: 0, fires: 0, held: false,
    moves: [], fireEvents: [], modes: [], pending: [], resetInputs: 0, exits: 0, captures: [],
    gameplay: { hp: 100, ammo: 12, position: 0 }, resets: 0 };
  let requests = 0;
  canvas.dataset = {};
  canvas.getBoundingClientRect = () => ({ left: 100, top: 50, width: 1000, height: 600, right: 1100, bottom: 650 });
  doc.pointerLockElement = null;
  doc.hidden = false;
  // exitPointerLock signals its change asynchronously in a browser. Tests emit
  // that event explicitly, controlling its order relative to pause/cancel.
  doc.exitPointerLock = () => { record.exits++; doc.pointerLockElement = null; };
  canvas.setPointerCapture = id => record.captures.push(id);
  if (request) canvas.requestPointerLock = () => { requests++; return request({ canvas, doc }); };
  const controls = createPointerControls({ canvas, doc, win, timeoutMs,
    getState: () => record.state,
    enter: mode => {
      record.enters.push({ mode, before: record.state });
      // The application owns reset. Match its policy so we can verify that the
      // controller calls enter with paused state intact and never enters twice.
      if (record.state !== 'paused') {
        record.resets++;
        record.gameplay = { hp: 100, ammo: 12, position: 0 };
      }
      record.state = 'playing';
    },
    pause: () => { record.pauses++; record.state = 'paused'; },
    look: (dx, dy) => record.moves.push([dx, dy]),
    fire: event => { record.fires++; record.fireEvents.push(event); record.held = true; },
    release: () => { record.held = false; },
    resetInput: () => { record.resetInputs++; record.held = false; },
    modeChanged: mode => record.modes.push(mode),
    pendingChanged: pending => record.pending.push(pending),
  });
  t.after(() => controls.dispose());
  const acquire = () => { doc.pointerLockElement = canvas; doc.emit('pointerlockchange'); };
  return { canvas, doc, win, record, controls, acquire, get requests() { return requests; } };
}

test('missing pointer lock API enters playable fallback without a retry click', t => {
  const f = fixture(t);
  f.controls.start();
  assert.equal(f.record.state, 'playing');
  assert.equal(f.controls.mode, 'free');
  assert.equal(f.record.enters.length, 1);
  assert.deepEqual(f.record.pending, [true, false]);
  assert.equal(f.record.fires, 0);
});

test('synchronous pointer lock denial enters fallback', t => {
  const f = fixture(t, { request: () => { throw new Error('denied'); } });
  assert.doesNotThrow(() => f.controls.start());
  assert.equal(f.record.state, 'playing');
  assert.equal(f.controls.mode, 'free');
  assert.equal(f.requests, 1);
});

test('rejected request promise enters fallback without an unhandled rejection', async t => {
  const f = fixture(t, { request: () => Promise.reject(new Error('denied')) });
  f.controls.start();
  await Promise.resolve();
  assert.equal(f.record.state, 'playing');
  assert.equal(f.controls.mode, 'free');
  assert.equal(f.record.enters.length, 1);
});

test('event-only pointerlockerror enters fallback once', t => {
  const f = fixture(t, { request: () => undefined });
  f.controls.start();
  assert.equal(f.record.state, 'ready');
  f.doc.emit('pointerlockerror');
  f.doc.emit('pointerlockerror');
  assert.equal(f.record.state, 'playing');
  assert.equal(f.controls.mode, 'free');
  assert.equal(f.record.enters.length, 1);
});

test('silent or indefinitely pending request has bounded fallback', async t => {
  const f = fixture(t, { request: () => new Promise(() => {}), timeoutMs: 5 });
  f.controls.start();
  assert.equal(f.record.state, 'ready');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.record.state, 'playing');
  assert.equal(f.controls.mode, 'free');
  assert.equal(f.record.enters.length, 1);
});

test('event-only asynchronous acquisition enters instead of leaving the menu open', t => {
  const f = fixture(t, { request: () => undefined });
  f.controls.start();
  assert.equal(f.record.state, 'ready');
  f.acquire();
  assert.equal(f.record.state, 'playing');
  assert.equal(f.controls.mode, 'locked');
  assert.equal(f.record.enters.length, 1);
  assert.equal(f.record.fires, 0);
});

test('success event followed by promise resolution enters and resets only once', async t => {
  const d = deferred();
  const f = fixture(t, { request: () => d.promise });
  f.controls.start();
  f.acquire();
  d.resolve();
  await Promise.resolve();
  f.doc.emit('pointerlockchange');
  assert.equal(f.record.enters.length, 1);
  assert.equal(f.record.resets, 1);
  assert.equal(f.controls.mode, 'locked');
});

test('promise resolution with acquired ownership works before a later success event', async t => {
  const d = deferred();
  const f = fixture(t, { request: () => d.promise });
  f.controls.start();
  f.doc.pointerLockElement = f.canvas;
  d.resolve();
  await Promise.resolve();
  assert.equal(f.record.state, 'playing');
  f.doc.emit('pointerlockchange');
  assert.equal(f.record.enters.length, 1);
});

test('repeated start while pending or already playing does not reset or rerequest', t => {
  const f = fixture(t, { request: () => undefined });
  f.controls.start();
  f.controls.start();
  f.controls.start();
  assert.equal(f.requests, 1);
  assert.equal(f.record.resets, 0);
  f.acquire();
  f.controls.start();
  assert.equal(f.requests, 1);
  assert.equal(f.record.resets, 1);
});

test('cancel ignores a late promise and relinquishes a late native acquisition', async t => {
  const d = deferred();
  const f = fixture(t, { request: () => d.promise });
  f.controls.start();
  f.controls.cancel();
  f.acquire();
  d.resolve();
  await Promise.resolve();
  assert.equal(f.record.state, 'ready');
  assert.equal(f.record.enters.length, 0);
  assert.equal(f.doc.pointerLockElement, null);
  assert.equal(f.record.exits, 1);
});

test('a stale rejected attempt does not activate a newer pending attempt', async t => {
  const old = deferred(), current = deferred();
  let count = 0;
  const f = fixture(t, { request: () => (++count === 1 ? old.promise : current.promise) });
  f.controls.start();
  f.controls.cancel();
  f.controls.start();
  old.reject(new Error('old denial'));
  await Promise.resolve();
  assert.equal(f.record.state, 'ready');
  assert.equal(f.record.enters.length, 0);
  f.acquire();
  current.resolve();
  await Promise.resolve();
  assert.equal(f.record.enters.length, 1);
});

test('delayed capture after fallback upgrades aim without restarting gameplay', t => {
  const f = fixture(t, { request: () => undefined });
  f.controls.start();
  f.doc.emit('pointerlockerror');
  f.record.gameplay = { hp: 74, ammo: 6, position: 19 };
  f.acquire();
  assert.equal(f.controls.mode, 'locked');
  assert.equal(f.record.enters.length, 1);
  assert.deepEqual(f.record.gameplay, { hp: 74, ammo: 6, position: 19 });
});

test('Escape pauses and resume keeps gameplay state and the initial reset count', t => {
  const f = fixture(t);
  f.controls.start();
  f.record.gameplay = { hp: 61, ammo: 4, position: 7 };
  f.canvas.emit('mousedown', { button: 0, pointerId: 1 });
  const event = f.doc.emit('keydown', { code: 'Escape' });
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.record.state, 'paused');
  assert.equal(f.record.held, false);
  f.controls.start();
  assert.equal(f.record.state, 'playing');
  assert.deepEqual(f.record.gameplay, { hp: 61, ammo: 4, position: 7 });
  assert.equal(f.record.resets, 1);
  assert.equal(f.record.enters[1].before, 'paused');
});

test('native capture loss pauses once and clears input', t => {
  const f = fixture(t, { request: () => undefined });
  f.controls.start();
  f.acquire();
  f.canvas.emit('mousedown', { button: 0, pointerId: 1 });
  f.doc.pointerLockElement = null;
  f.doc.emit('pointerlockchange');
  f.doc.emit('pointerlockchange');
  assert.equal(f.record.state, 'paused');
  assert.equal(f.record.pauses, 1);
  assert.equal(f.record.held, false);
});

test('blur and hidden document pause; pending blur cancels entry', t => {
  const f = fixture(t);
  f.controls.start();
  f.win.emit('blur');
  assert.equal(f.record.state, 'paused');
  f.controls.start();
  f.doc.hidden = true;
  f.doc.emit('visibilitychange');
  assert.equal(f.record.state, 'paused');
  const pending = fixture(t, { request: () => undefined });
  pending.controls.start();
  pending.win.emit('blur');
  pending.acquire();
  assert.equal(pending.record.enters.length, 0);
  assert.equal(pending.doc.pointerLockElement, null);
});

test('free look needs no mouse button and suppresses the initial coordinate sample', t => {
  const f = fixture(t);
  f.controls.start();
  f.doc.emit('mousemove', { target: f.canvas, buttons: 0, clientX: 500, clientY: 300 });
  assert.deepEqual(f.record.moves, []);
  f.doc.emit('mousemove', { target: f.canvas, buttons: 0, clientX: 515, clientY: 294 });
  f.doc.emit('mousemove', { target: f.canvas, buttons: 0, clientX: 512, clientY: 297 });
  assert.deepEqual(f.record.moves, [[15, -6], [-3, 3]]);
  assert.equal(f.record.fires, 0);
});

test('free look ignores unrelated document targets', t => {
  const f = fixture(t);
  f.controls.start();
  f.doc.emit('mousemove', { buttons: 0, clientX: 1000, clientY: 900 });
  f.doc.emit('mousemove', { target: f.canvas, buttons: 0, clientX: 500, clientY: 300 });
  assert.deepEqual(f.record.moves, []);
  f.doc.emit('mousemove', { buttons: 0, clientX: 50, clientY: 40 });
  f.doc.emit('mousemove', { target: f.canvas, buttons: 0, clientX: 505, clientY: 307 });
  assert.deepEqual(f.record.moves, [[5, 7]]);
});

test('free look and left firing work together; release and cancellation clear firing', t => {
  const f = fixture(t);
  f.canvas.emit('mousedown', { button: 0 });
  assert.equal(f.record.fires, 0);
  f.controls.start();
  f.doc.emit('mousemove', { target: f.canvas, buttons: 0, clientX: 500, clientY: 300 });
  f.canvas.emit('mousedown', { button: 0, buttons: 1 });
  assert.equal(f.record.fires, 1);
  assert.equal(f.record.held, true);
  f.doc.emit('mousemove', { target: f.canvas, buttons: 1, clientX: 512, clientY: 293 });
  assert.deepEqual(f.record.moves, [[12, -7]]);
  f.doc.emit('mouseup', { button: 0, buttons: 0 });
  assert.equal(f.record.held, false);
  f.doc.emit('mousemove', { target: f.canvas, buttons: 0, clientX: 514, clientY: 298 });
  assert.deepEqual(f.record.moves, [[12, -7], [2, 5]]);
  f.canvas.emit('mousedown', { button: 0 });
  f.doc.emit('pointercancel');
  assert.equal(f.record.held, false);
  f.doc.emit('mousemove', { target: f.canvas, clientX: 800, clientY: 500 });
  assert.equal(f.record.moves.length, 2);
});

test('locked aim uses relative motion; fallback ignores unrelated mouse movement', t => {
  const f = fixture(t, { request: () => undefined });
  f.controls.start();
  f.acquire();
  f.doc.emit('mousemove', { movementX: 14, movementY: -3 });
  assert.deepEqual(f.record.moves, [[14, -3]]);
  f.doc.pointerLockElement = null;
  f.doc.emit('pointerlockchange');
  f.doc.emit('mousemove', { movementX: 300, movementY: 300 });
  assert.equal(f.record.moves.length, 1);
});

test('leaving the canvas pauses free look, clears firing, and resume reanchors the mouse', t => {
  const f = fixture(t);
  f.controls.start();
  f.doc.emit('mousemove', { target: f.canvas, clientX: 400, clientY: 200 });
  f.doc.emit('mousemove', { target: f.canvas, clientX: 420, clientY: 210 });
  f.canvas.emit('mousedown', { button: 0 });
  f.canvas.emit('mouseleave');
  assert.equal(f.record.state, 'paused');
  assert.equal(f.record.held, false);
  f.doc.emit('mousemove', { target: f.canvas, clientX: 900, clientY: 500 });
  assert.equal(f.record.moves.length, 1);
  f.controls.start();
  f.doc.emit('mousemove', { target: f.canvas, clientX: 600, clientY: 300 });
  assert.equal(f.record.moves.length, 1);
  f.doc.emit('mousemove', { target: f.canvas, clientX: 610, clientY: 295 });
  assert.deepEqual(f.record.moves, [[20, 10], [10, -5]]);
  assert.equal(f.record.resets, 1);
});

test('canvas leave does not interrupt genuine native capture', t => {
  const f = fixture(t, { request: () => undefined });
  f.controls.start();
  f.acquire();
  f.canvas.emit('mouseleave');
  f.doc.emit('mousemove', { movementX: 20, movementY: -4 });
  f.controls.update(.05);
  assert.equal(f.record.state, 'playing');
  assert.equal(f.record.pauses, 0);
  assert.deepEqual(f.record.moves, [[20, -4]]);
});

test('free edge turning continues without new motion and respects left/right sign', t => {
  const left = fixture(t), right = fixture(t);
  left.controls.start(); right.controls.start();
  left.doc.emit('mousemove', { target: left.canvas, clientX: 100, clientY: 300 });
  right.doc.emit('mousemove', { target: right.canvas, clientX: 1100, clientY: 300 });
  left.controls.update(1 / 60);
  left.controls.update(1 / 60);
  right.controls.update(1 / 60);
  assert.deepEqual(left.record.moves, [[-15, 0], [-15, 0]]);
  assert.deepEqual(right.record.moves, [[15, 0]]);
  assert.equal(left.record.fires, 0);
  assert.equal(right.record.fires, 0);
});

test('edge turning is time-scaled, capped after a stall, and half-strength within the band', t => {
  const f = fixture(t);
  f.controls.start();
  f.doc.emit('mousemove', { target: f.canvas, clientX: 1082, clientY: 300 });
  f.controls.update(.02);
  f.controls.update(.5);
  assert.deepEqual(f.record.moves, [[9, 0], [22.5, 0]]);
  f.controls.update(-1);
  assert.deepEqual(f.record.moves.at(-1), [0, 0]);
});

test('edge turning stops at center, when paused, and after cancellation/resume', t => {
  const f = fixture(t);
  f.controls.start();
  f.doc.emit('mousemove', { target: f.canvas, clientX: 1100, clientY: 300 });
  f.controls.update(.02);
  f.doc.emit('mousemove', { target: f.canvas, clientX: 600, clientY: 300 });
  const centeredCount = f.record.moves.length;
  f.controls.update(.02);
  assert.equal(f.record.moves.length, centeredCount);
  f.doc.emit('mousemove', { target: f.canvas, clientX: 1100, clientY: 300 });
  f.canvas.emit('mouseleave');
  const pausedCount = f.record.moves.length;
  f.controls.update(.05);
  assert.equal(f.record.moves.length, pausedCount);
  f.controls.start();
  f.controls.update(.05);
  assert.equal(f.record.moves.length, pausedCount);
  assert.equal(f.record.state, 'playing');
});

test('edge band scales down for a narrow canvas without turning its center', t => {
  const f = fixture(t);
  f.canvas.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 100 });
  f.controls.start();
  f.doc.emit('mousemove', { target: f.canvas, clientX: 192, clientY: 50 });
  f.controls.update(.02);
  assert.deepEqual(f.record.moves, [[9, 0]]);
  f.doc.emit('mousemove', { target: f.canvas, clientX: 100, clientY: 50 });
  const before = f.record.moves.length;
  f.controls.update(.02);
  assert.equal(f.record.moves.length, before);
});

test('dispose detaches input and prevents late acquisition from starting a game', t => {
  const f = fixture(t, { request: () => undefined });
  f.controls.start();
  f.controls.dispose();
  f.doc.emit('pointerlockchange');
  f.canvas.emit('mousedown', { button: 0, pointerId: 1 });
  assert.equal(f.record.enters.length, 0);
  assert.equal(f.record.fires, 0);
  assert.equal([...f.canvas.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
  assert.equal([...f.doc.listeners.values()].reduce((n, set) => n + set.size, 0), 1);
  assert.equal(f.doc.listeners.get('pointerlockchange').size, 1); // Retired-lock document guard.
});

test('disposed event-only request relinquishes a delayed native grant', t => {
  const f = fixture(t, { request: () => undefined });
  f.controls.start();
  f.controls.dispose();
  f.acquire();
  assert.equal(f.doc.pointerLockElement, null);
  assert.equal(f.record.exits, 1);
  assert.equal(f.record.enters.length, 0);
  assert.equal(f.record.state, 'ready');
});

test('disposed promise request relinquishes a grant even before its change event', async t => {
  const d = deferred();
  const f = fixture(t, { request: () => d.promise });
  f.controls.start();
  f.controls.dispose();
  f.doc.pointerLockElement = f.canvas;
  d.resolve();
  await Promise.resolve();
  assert.equal(f.doc.pointerLockElement, null);
  assert.equal(f.record.exits, 1);
  assert.equal(f.record.enters.length, 0);
});

test('retired controller late promise and document guard leave a replacement owner locked', async t => {
  const oldRequest = deferred(), newRequest = deferred();
  const old = fixture(t, { request: () => oldRequest.promise });
  old.controls.start();
  old.controls.dispose();
  const replacement = fixture(t, { surface: old, request: () => newRequest.promise });
  replacement.controls.start();
  replacement.acquire();
  oldRequest.resolve();
  newRequest.resolve();
  await Promise.resolve();
  replacement.doc.emit('pointerlockchange');
  assert.equal(replacement.doc.pointerLockElement, replacement.canvas);
  assert.equal(replacement.record.state, 'playing');
  assert.equal(replacement.record.enters.length, 1);
  assert.equal(replacement.record.exits, 0);
  assert.equal(old.record.enters.length, 0);
  // One permanent guard plus the replacement's live acquisition listener.
  assert.equal(replacement.doc.listeners.get('pointerlockchange').size, 2);
});

test('disposing a retired controller again does not release its replacement owner', t => {
  const old = fixture(t, { request: () => undefined });
  old.controls.start();
  old.controls.dispose();
  const replacement = fixture(t, { surface: old, request: () => undefined });
  replacement.controls.start();
  replacement.acquire();
  old.controls.dispose();
  assert.equal(replacement.doc.pointerLockElement, replacement.canvas);
  assert.equal(replacement.record.state, 'playing');
  assert.equal(replacement.record.exits, 0);
});

test('fire callback receives the original mouse event for compatible consumers', t => {
  const f = fixture(t);
  f.controls.start();
  const event = f.canvas.emit('mousedown', { button: 0, buttons: 1, clientX: 500, clientY: 300 });
  assert.equal(f.record.fireEvents.length, 1);
  assert.equal(f.record.fireEvents[0], event);
  assert.equal(f.record.fireEvents[0].target, f.canvas);
});
