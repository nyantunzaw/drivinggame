// Global tuning knobs and quality presets.

export const CHUNK = 250;              // world chunk size (m)

export const QUALITY = {
  low:    { view: 340, pixelRatio: 1.0, traffic: 12, peds: 14, parked: 10, trees: 0.5, shadows: false, clouds: false, antialias: false, detail: false },
  medium: { view: 520, pixelRatio: 1.5, traffic: 20, peds: 22, parked: 18, trees: 0.8, shadows: false, clouds: true, antialias: false, detail: true },
  high:   { view: 760, pixelRatio: 2.0, traffic: 28, peds: 30, parked: 26, trees: 1.0, shadows: true, clouds: true, antialias: true, detail: true },
};

// Road classes: 0 trunk, 1 primary, 2 secondary, 3 tertiary, 4 residential, 5 service, 6 footway
export const ROAD_HALF = [7.5, 7.0, 5.5, 4.5, 3.5, 2.2, 1.3];
export const ROAD_SPEED = [17, 15, 12.5, 10.5, 7.5, 5, 3];
export const SIDEWALK = [3.0, 3.0, 2.6, 2.2, 1.6, 0, 0];

// One in-game hour lasts this many real seconds (GTA style: 1 minute).
export const SECONDS_PER_HOUR = 60;
export const START_HOUR = 10.5;

export const COLORS = {
  pink: '#ff3ea5',
  cyan: '#38e8ff',
  money: '#7dff8a',
};

export function isTouchDevice() {
  return (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches;
}

// Which GPU will draw the game, read from a throwaway WebGL context.
export function probeGPU() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return { name: 'none', webgl2: false };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return { name, webgl2 };
  } catch (e) {
    return { name: 'unknown', webgl2: false };
  }
}

export function defaultQuality(gpu = { name: '' }) {
  const touch = isTouchDevice();
  const mem = navigator.deviceMemory || 4;
  if (touch) return mem < 4 ? 'low' : 'medium';
  // software rasterisers and basic display drivers: keep it light
  if (/swiftshader|llvmpipe|softpipe|basic render|microsoft basic|warp|software/i.test(gpu.name)) return 'low';
  // integrated laptop GPUs cope better without shadows and 2x resolution
  if (/intel|mali|adreno|powervr|vivante|videocore/i.test(gpu.name)) return 'medium';
  return 'high';
}
