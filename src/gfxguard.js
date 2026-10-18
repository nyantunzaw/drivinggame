// Keeps the picture alive on GPUs and drivers that choke on some of the newer effects.
// For the first minute of play it samples a few rows of the frame; if the image is one
// flat colour (a white or black screen) it turns the riskier features off one at a time
// until the city shows up again, and remembers what it had to switch off.

export const GFX_STEPS = [
  { id: 'facade', label: 'detailed building textures' },
  { id: 'pbr', label: 'reflective car paint' },
  { id: 'shadows', label: 'shadows' },
  { id: 'detail', label: 'signs, cables and light pools' },
  { id: 'lowres', label: 'high resolution' },
];

export class GfxGuard {
  constructor(game) {
    this.game = game;
    this.t = 0;          // seconds of play watched
    this.clock = 0;
    this.flatN = 0;
    this.okN = 0;
    this.trying = null;  // step applied and waiting to see if it helped
    this.done = false;
    this.buf = null;
  }

  // Call right after the frame is drawn (the drawing buffer is only readable until the next task).
  afterRender(dt) {
    if (this.done) return;
    this.t += dt;
    this.clock += dt;
    if (this.t > 60 && !this.trying) { this.done = true; return; }
    if (this.clock < 1) return;
    this.clock = 0;
    const flat = this.isFlat();
    if (flat === null) return;
    if (flat) { this.flatN++; this.okN = 0; } else { this.okN++; this.flatN = 0; }
    if (this.trying && this.okN >= 2) {
      const g = this.game;
      g.hud.help(`Switched off ${this.trying.label} because the 3D view wasn't drawing on this device. You can undo this in Settings.`, 9000);
      this.trying = null;
      this.done = true;
      return;
    }
    if (this.flatN >= 3) {
      this.flatN = 0;
      this.next();
    }
  }

  next() {
    const g = this.game;
    const off = new Set(g.settings.gfxOff || []);
    const step = GFX_STEPS.find((s) => !off.has(s.id));
    if (!step) {
      this.done = true;
      this.trying = null;
      g.showError(`The 3D view isn't drawing on this GPU (${g.gpu.name}). Try Settings → Graphics quality → Low, or another browser.`);
      return;
    }
    off.add(step.id);
    g.settings.gfxOff = [...off];
    g.saveSettings();
    g.applyGfxOff(step.id);
    this.trying = step;
    this.t = Math.min(this.t, 50); // give the change time to show
  }

  isFlat() {
    const gl = this.game.renderer.getContext();
    if (gl.isContextLost()) return null;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (w < 8 || h < 8) return null;
    if (!this.buf || this.buf.length < w * 4) this.buf = new Uint8Array(w * 4);
    const mn = [255, 255, 255], mx = [0, 0, 0];
    for (const fy of [0.2, 0.5, 0.8]) {
      gl.readPixels(0, Math.floor(h * fy), w, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.buf);
      for (let x = 0; x < w; x += 5) {
        for (let c = 0; c < 3; c++) {
          const v = this.buf[x * 4 + c];
          if (v < mn[c]) mn[c] = v;
          if (v > mx[c]) mx[c] = v;
        }
      }
    }
    return mx[0] - mn[0] < 10 && mx[1] - mn[1] < 10 && mx[2] - mn[2] < 10;
  }
}
