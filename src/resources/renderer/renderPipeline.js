/** Own exactly one final render operation, including its resize and teardown. */
export function createRenderPipelineSlot(renderer) {
  let pipeline = null;
  let disposed = false;
  let version = 0;
  let width = 1, height = 1;
  return {
    get version() { return version; },
    get disposed() { return disposed; },
    reserve() { if (disposed) throw new Error("The render pipeline is disposed."); return ++version; },
    set(next) {
      if (disposed) throw new Error("The render pipeline is disposed.");
      if (next !== null && (!next || typeof next.render !== "function" ||
        (next.resize !== undefined && typeof next.resize !== "function") ||
        (next.dispose !== undefined && typeof next.dispose !== "function"))) {
        throw new TypeError("A render pipeline needs render(), with optional resize() and dispose().");
      }
      if (next === pipeline) { version++; return; }
      try { next?.resize?.(width, height, renderer.getPixelRatio()); }
      catch (error) { next?.dispose?.(); throw error; }
      const previous = pipeline;
      pipeline = next;
      version++;
      previous?.dispose?.();
    },
    resize(w, h) {
      width = w; height = h;
      pipeline?.resize?.(w, h, renderer.getPixelRatio());
    },
    render(scene, camera, dt) {
      if (disposed) return;
      if (pipeline) pipeline.render(dt);
      else renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true; version++;
      const previous = pipeline; pipeline = null;
      previous?.dispose?.();
    },
  };
}
