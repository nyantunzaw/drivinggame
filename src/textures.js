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

// Golden surface with subtle mosaic for pagodas.
export function goldTexture() {
  const c = noiseTexture(128, 91, [222, 168, 64], [255, 210, 108], { speckle: 0.22, base: 32, octaves: 2 });
  return toTexture(c);
}
