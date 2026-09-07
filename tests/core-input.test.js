import test from "node:test";
import assert from "node:assert/strict";
import { setupInput } from "../src/resources/inputSetup.js";

function fixture() {
  const window = new EventTarget();
  const document = new EventTarget();
  class Canvas extends EventTarget {
    tabIndex = -1;
    focus() { if (document.activeElement === this) return; document.activeElement?.dispatchEvent(new Event("blur")); document.activeElement = this; }
    contains(element) { return element === this; }
    getAttribute() { return null; }
    removeAttribute() { this.tabIndex = -1; }
  }
  const send = (target, name, properties = {}) => {
    const event = new Event(name, { cancelable: true });
    for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value });
    target.dispatchEvent(event);
    return event;
  };
  return { window, document, Canvas, send };
}

test("keyboard input is scoped, aliases release independently, blur clears held keys", async () => {
  const { window, document, Canvas, send } = fixture();
  const firstCanvas = new Canvas();
  const secondCanvas = new Canvas();
  const first = await setupInput({ canvas: firstCanvas, inputWindow: window, inputDocument: document });
  const second = await setupInput({ canvas: secondCanvas, inputWindow: window, inputDocument: document });
  send(window, "keydown", { code: "KeyW" });
  send(window, "keydown", { code: "ArrowUp" });
  assert.equal(first.isActionActive("forward"), false);
  assert.equal(second.isActionActive("forward"), true);
  send(window, "keyup", { code: "KeyW" });
  assert.equal(second.isActionActive("forward"), true);
  send(window, "blur");
  assert.equal(second.isActionActive("forward"), false);
  send(firstCanvas, "mousedown", { button: 0 });
  send(window, "keydown", { code: "KeyD" });
  assert.equal(first.isKeyDown("KeyD"), true);
  assert.deepEqual(first.getMovementVector(), { x: 1, z: 0 });
  assert.equal(second.isKeyDown("KeyD"), false);
  first.dispose();
  second.dispose();
});

test("disposal removes listeners, restores canvas focusability and clears virtual input", async () => {
  const { window, document, Canvas, send } = fixture();
  const canvas = new Canvas();
  const input = await setupInput({ canvas, inputWindow: window, inputDocument: document });
  input.setAction("jump", true);
  send(canvas, "mousedown", { button: 0 });
  assert.equal(input.isMouseDown(), true);
  assert.equal(input.isActionActive("jump"), true);
  input.dispose();
  input.dispose();
  send(window, "keydown", { code: "KeyW" });
  send(canvas, "mousedown", { button: 0 });
  input.setAction("jump", true);
  assert.equal(input.isActionActive("forward"), false);
  assert.equal(input.isActionActive("jump"), false);
  assert.equal(input.isMouseDown(), false);
  assert.equal(canvas.tabIndex, -1);
});

test("typing and browser shortcuts are not consumed", async () => {
  const { window, document, Canvas, send } = fixture();
  const input = await setupInput({ canvas: new Canvas(), inputWindow: window, inputDocument: document });
  const shortcut = send(window, "keydown", { code: "KeyW", metaKey: true });
  const typing = send(window, "keydown", { code: "Space", target: { tagName: "INPUT" } });
  assert.equal(shortcut.defaultPrevented, false);
  assert.equal(typing.defaultPrevented, false);
  assert.equal(input.isActionActive("forward"), false);
  assert.equal(input.isActionActive("jump"), false);
  input.dispose();
});
