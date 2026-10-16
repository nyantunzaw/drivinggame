// Procedurally painted canvas textures (no image downloads needed).
import * as THREE from 'three';
import { mulberry32 } from './util.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Tileable value noise in [0,1].
function makeNoise(size, cells, seed) {
  const rnd = mulberry32(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, fy = (y / size) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[(y0 % cells) * cells + (x0 % cells)];
      const b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = g[((y0 + 1) % cells) * cells + (x0 % cells)];
      const d = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

function fbm(size, seed, octaves = 4, base = 4) {
  const out = new Float32Array(size * size);
  let amp = 0.5, total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = makeNoise(size, base << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function toTexture(c, { repeat = true, srgb = true, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = mips;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  return t;
}

function noiseTexture(size, seed, colorA, colorB, { octaves = 4, base = 4, speckle = 0 } = {}) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = fbm(size, seed, octaves, base);
  const rnd = mulberry32(seed * 7 + 3);
  for (let i = 0; i < size * size; i++) {
    let t = n[i];
    if (speckle) t += (rnd() - 0.5) * speckle;
    t = Math.min(1, Math.max(0, t));
    img.data[i * 4] = colorA[0] + (colorB[0] - colorA[0]) * t;
    img.data[i * 4 + 1] = colorA[1] + (colorB[1] - colorA[1]) * t;
    img.data[i * 4 + 2] = colorA[2] + (colorB[2] - colorA[2]) * t;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function asphaltTexture() {
  const c = noiseTexture(256, 11, [62, 62, 66], [96, 94, 96], { speckle: 0.35, base: 8 });
  const ctx = c.getContext('2d');
  const rnd = mulberry32(5);
  // patches and cracks
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = `rgba(${rnd() < 0.5 ? '40,40,44' : '110,108,104'},${0.12 + rnd() * 0.12})`;
    const x = rnd() * 256, y = rnd() * 256, w = 20 + rnd() * 60, h = 10 + rnd() * 50;
    ctx.fillRect(x, y, w, h);
    ctx.fillRect(x - 256, y, w, h);
    ctx.fillRect(x, y - 256, w, h);
  }
  ctx.strokeStyle = 'rgba(25,25,28,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 10; i++) {
    let x = rnd() * 256, y = rnd() * 256;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (rnd() - 0.5) * 30;
      y += (rnd() - 0.5) * 30;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return toTexture(c);
}

export function sidewalkTexture() {
  const c = noiseTexture(256, 21, [150, 146, 138], [190, 186, 176], { speckle: 0.25, base: 8 });
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(90,86,80,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * 64, 0); ctx.lineTo(i * 64, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 64); ctx.lineTo(256, i * 64); ctx.stroke();
  }
  return toTexture(c);
}

export function groundTexture() {
  const c = noiseTexture(256, 31, [104, 118, 72], [150, 152, 102], { speckle: 0.3, base: 4, octaves: 5 });
  return toTexture(c);
}

export function grassTexture() {
  const c = noiseTexture(256, 41, [64, 112, 48], [118, 160, 70], { speckle: 0.45, base: 4, octaves: 5 });
  return toTexture(c);
}

export function plazaTexture() {
  const c = noiseTexture(256, 51, [196, 184, 160], [222, 212, 190], { speckle: 0.2, base: 8 });
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(140,120,100,0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, 256); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 32); ctx.lineTo(256, i * 32); ctx.stroke();
  }
  return toTexture(c);
}

// Tileable normal map for animated water ripples.
export function waterNormalTexture() {
  const size = 256;
  const h = fbm(size, 61, 4, 4);
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const hx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
      const hy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
      let nx = -hx * 6, ny = -hy * 6, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      img.data[i * 4] = (nx / l * 0.5 + 0.5) * 255;
      img.data[i * 4 + 1] = (ny / l * 0.5 + 0.5) * 255;
      img.data[i * 4 + 2] = (nz / l * 0.5 + 0.5) * 255;
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });
}

// Dashed lane-marking alpha strip (v runs along the road).
export function markingTexture() {
  const c = canvas(8, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 8, 32);
  const t = toTexture(c, { srgb: true });
  return t;
}

export function glowTexture() {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c, { repeat: false });
}

export function blobTexture() {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.4)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return toTexture(c, { repeat: false });
}

// ---------------------------------------------------------------- facades
// 2x2 atlas of building facade styles, each style 4 bays x 4 floors.
// Returns { map, emissive } sharing the same layout.
export function facadeTextures() {
  const S = 1024, Q = 512, C = 128;
  const col = canvas(S, S), emi = canvas(S, S);
  const a = col.getContext('2d'), e = emi.getContext('2d');
  const rnd = mulberry32(77);
  a.fillStyle = '#f2efe8';
  a.fillRect(0, 0, S, S);
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);

  const litColors = ['#ffd27a', '#ffe7a8', '#fff1d0', '#ffc46b', '#bfe4ff', '#ffb36b'];
  function lit(x, y, w, h, p = 0.38) {
    if (rnd() < p) {
      e.fillStyle = litColors[(rnd() * litColors.length) | 0];
      e.globalAlpha = 0.65 + rnd() * 0.35;
      e.fillRect(x, y, w, h);
      e.globalAlpha = 1;
    }
  }
  function stains(ox, oy) {
    // monsoon streaks typical of Yangon facades
    for (let i = 0; i < 26; i++) {
      const x = ox + rnd() * Q, y = oy + rnd() * Q;
      const w = 3 + rnd() * 10, h = 20 + rnd() * 90;
      const g = a.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, 'rgba(60,60,55,0.28)');
      g.addColorStop(1, 'rgba(60,60,55,0)');
      a.fillStyle = g;
      a.fillRect(x, y, w, h);
    }
  }

  // Style 0: colonial shuttered windows (top-left)
  for (let fy = 0; fy < 4; fy++) {
    for (let bx = 0; bx < 4; bx++) {
      const x = bx * C, y = fy * C;
      a.fillStyle = 'rgba(0,0,0,0.10)';
      a.fillRect(x, y + C - 10, C, 6); // cornice
      a.fillStyle = '#d9d2c4';
      a.fillRect(x + 34, y + 20, 60, 84);
      a.fillStyle = '#2b3a45';
      a.beginPath();
      a.moveTo(x + 40, y + 100);
      a.lineTo(x + 40, y + 42);
      a.quadraticCurveTo(x + 64, y + 14, x + 88, y + 42);
      a.lineTo(x + 88, y + 100);
      a.fill();
      a.fillStyle = '#3f7d6a';
      a.fillRect(x + 22, y + 34, 16, 68);
      a.fillRect(x + 90, y + 34, 16, 68);
      a.fillStyle = 'rgba(0,0,0,0.25)';
      for (let k = 0; k < 8; k++) {
        a.fillRect(x + 22, y + 38 + k * 8, 16, 2);
        a.fillRect(x + 90, y + 38 + k * 8, 16, 2);
      }
      lit(x + 42, y + 40, 44, 58);
    }
  }
  stains(0, 0);

  // Style 1: apartment walk-up with balconies and AC units (top-right)
  for (let fy = 0; fy < 4; fy++) {
    for (let bx = 0; bx < 4; bx++) {
      const x = Q + bx * C, y = fy * C;
      a.fillStyle = '#e8e2d6';
      a.fillRect(x + 6, y + 82, C - 12, 30);
      a.fillStyle = '#5a6670';
      a.fillRect(x + 22, y + 26, 84, 52);
      a.fillStyle = 'rgba(255,255,255,0.25)';
      for (let k = 0; k < 6; k++) a.fillRect(x + 22 + k * 14, y + 26, 2, 52);
      a.fillStyle = 'rgba(0,0,0,0.22)';
      for (let k = 0; k < 10; k++) a.fillRect(x + 8 + k * 11.5, y + 84, 3, 26);
      if (rnd() < 0.5) {
        a.fillStyle = '#d8d8d8';
        a.fillRect(x + 92, y + 58, 26, 18);
        a.fillStyle = '#999';
        a.fillRect(x + 96, y + 62, 18, 10);
      }
      if (rnd() < 0.4) { // laundry on the balcony
        const cs = ['#d64545', '#3e7cd6', '#e6c03a', '#f0f0f0', '#7a3fb0'];
        for (let k = 0; k < 4; k++) {
          a.fillStyle = cs[(rnd() * cs.length) | 0];
          a.fillRect(x + 16 + k * 22, y + 86, 14, 18);
        }
      }
      lit(x + 24, y + 28, 80, 48, 0.45);
    }
  }
  stains(Q, 0);

  // Style 2: modern glass tower (bottom-left)
  a.fillStyle = '#9fb7c9';
  a.fillRect(0, Q, Q, Q);
  for (let fy = 0; fy < 4; fy++) {
    for (let bx = 0; bx < 4; bx++) {
      const x = bx * C, y = Q + fy * C;
      const g = a.createLinearGradient(x, y, x + C, y + C);
      g.addColorStop(0, '#5f8fb8');
      g.addColorStop(1, '#2d4f72');
      a.fillStyle = g;
      a.fillRect(x + 4, y + 10, C - 8, C - 22);
      a.fillStyle = 'rgba(255,255,255,0.18)';
      a.fillRect(x + 4, y + 10, C - 8, 6);
      a.fillStyle = '#c9d4dc';
      a.fillRect(x + C / 2 - 2, y + 10, 4, C - 22);
      lit(x + 6, y + 12, C - 12, C - 26, 0.5);
    }
  }

  // Style 3: low shophouse / house with wooden shutters (bottom-right)
  for (let fy = 0; fy < 4; fy++) {
    for (let bx = 0; bx < 4; bx++) {
      const x = Q + bx * C, y = Q + fy * C;
      if ((bx + fy) % 2 === 0) {
        a.fillStyle = '#7a5235';
        a.fillRect(x + 30, y + 30, 68, 72);
        a.fillStyle = 'rgba(0,0,0,0.3)';
        a.fillRect(x + 63, y + 30, 2, 72);
        for (let k = 0; k < 7; k++) a.fillRect(x + 30, y + 36 + k * 10, 68, 2);
        lit(x + 32, y + 32, 64, 68, 0.3);
      } else {
        a.fillStyle = '#34424c';
        a.fillRect(x + 40, y + 36, 48, 52);
        a.fillStyle = '#bbb';
        for (let k = 0; k < 5; k++) a.fillRect(x + 40 + k * 11, y + 36, 2, 52);
        lit(x + 42, y + 38, 44, 48, 0.35);
      }
    }
  }
  stains(Q, Q);

  const map = toTexture(col);
  const emissive = toTexture(emi);
  return { map, emissive };
}

// Golden surface with subtle mosaic for pagodas.
export function goldTexture() {
  const c = noiseTexture(128, 91, [222, 168, 64], [255, 210, 108], { speckle: 0.22, base: 32, octaves: 2 });
  return toTexture(c);
}
