/** Resolve intensity units before passing user-authored configuration to Three.js. */
export function resolveRpgLighting(visuals = {}, warn = console.warn) {
  visuals ??= {};
  function intensity(name, value, fallback, maximum = 100) {
    if (value === undefined) return fallback;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum) return value;
    warn(`[RPG] visuals.${name} must be a number from 0 to ${maximum}; using ${fallback}. Use skyColor/groundColor/sunColor for colors.`);
    return fallback;
  }
  const ambientName = visuals.ambientIntensity !== undefined ? "ambientIntensity" : "ambient";
  return {
    ambientIntensity: intensity(ambientName, visuals[ambientName], 1.5),
    sunIntensity: intensity("sunIntensity", visuals.sunIntensity, 2.5),
    exposure: intensity("exposure", visuals.exposure, 1, 10),
  };
}
