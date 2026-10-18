// Facade atlas for buildings and the shop-sign atlas (Chinatown & downtown).
// Everything is painted procedurally on canvases at startup.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

// Atlas layout: 3x3 styles, each 4 bays (3.6 m) x 4 rows (3.3 m).
// Row 0 (bottom of a style block) is the ground floor, rows 1-3 repeat upwards.
export const FACADE = { SIZE: 2048, CW: 160, CH: 148, RW: 640, RH: 592, COLS: 3 };
export const STYLE = {
  colonial: 0, apartment: 1, glass: 2, house: 3, chinaA: 4, chinaB: 5, brick: 6, blank: 7, office: 8,
};

const { CW, CH } = FACADE;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const pick = (rnd, a) => a[(rnd() * a.length) | 0];
const LIT = ['#ffd27a', '#ffe7a8', '#fff1d0', '#ffc46b', '#cfe8ff', '#ffb36b', '#f2f7ff'];
const SIGN_BG = ['#b3201c', '#c9302c', '#1d5fa8', '#e8b923', '#2f7d4a', '#f2f2ee', '#7a1f6e', '#d9622b'];
const GOODS = ['#d64545', '#3e7cd6', '#e6c03a', '#f0f0f0', '#7a3fb0', '#2f9a5a', '#f08a5d', '#8a5a3a'];
const LAUNDRY = ['#d64545', '#3e7cd6', '#e6c03a', '#f4f4f4', '#7a3fb0', '#2f9a5a', '#ff7aa8', '#1f1f22'];

// ---------------------------------------------------------------- helpers
function rect(a, x, y, w, h, col) { a.fillStyle = col; a.fillRect(x, y, w, h); }

function lit(e, rnd, x, y, w, h, p, colors = LIT) {
  if (rnd() < p) {
    e.globalAlpha = 0.55 + rnd() * 0.45;
    rect(e, x, y, w, h, pick(rnd, colors));
    e.globalAlpha = 1;
  }
}

function glyphs(a, rnd, x, y, w, h, col, kind = 'han') {
  // Fake text: CJK-like stroke blocks or round Burmese-like loops (legible signs are separate geometry).
  a.strokeStyle = col; a.fillStyle = col;
  a.lineWidth = Math.max(1, h * 0.12);
  const n = Math.max(1, Math.floor(w / (h * 1.05)));
  const gw = w / n;
  for (let i = 0; i < n; i++) {
    const gx = x + i * gw + gw * 0.12, gs = Math.min(gw, h) * 0.76;
    a.beginPath();
    if (kind === 'han') {
      for (let k = 0; k < 3 + ((rnd() * 3) | 0); k++) {
        const horiz = rnd() < 0.5;
        const px = gx + rnd() * gs * 0.7, py = y + h * 0.12 + rnd() * gs * 0.7;
        a.moveTo(px, py);
        a.lineTo(horiz ? px + gs * (0.3 + rnd() * 0.5) : px + (rnd() - 0.5) * 3, horiz ? py + (rnd() - 0.5) * 3 : py + gs * (0.3 + rnd() * 0.5));
      }
      a.stroke();
    } else {
      const r = gs * 0.28;
      a.arc(gx + r + 1, y + h * 0.5, r, 0.3, Math.PI * 2 - 0.3);
      a.stroke();
    }
  }
}

function streaks(a, rnd, x, y, w, h, n, alpha = 0.22) {
  for (let i = 0; i < n; i++) {
    const sx = x + rnd() * w, sy = y + rnd() * h * 0.7;
    const sw = 5 + rnd() * 14, sh = 15 + rnd() * h * 0.5;
    const g = a.createLinearGradient(0, sy, 0, sy + sh);
    g.addColorStop(0, `rgba(48,52,44,${alpha})`);
    g.addColorStop(1, 'rgba(48,52,44,0)');
    a.fillStyle = g;
    a.fillRect(sx, sy, sw, sh);
  }
}

function blotches(a, rnd, x, y, w, h, n) {
  for (let i = 0; i < n; i++) {
    a.fillStyle = rnd() < 0.5 ? `rgba(70,70,60,${0.04 + rnd() * 0.07})` : `rgba(255,255,250,${0.05 + rnd() * 0.08})`;
    a.beginPath();
    a.ellipse(x + rnd() * w, y + rnd() * h, 8 + rnd() * 40, 6 + rnd() * 26, rnd() * 3, 0, Math.PI * 2);
    a.fill();
  }
}

function splash(a, x, y, w) {
  // grime splashed up from the street along the bottom of the ground floor
  const g = a.createLinearGradient(0, y - 34, 0, y);
  g.addColorStop(0, 'rgba(40,38,32,0)');
  g.addColorStop(1, 'rgba(40,38,32,0.45)');
  a.fillStyle = g;
  a.fillRect(x, y - 34, w, 34);
}

function acUnit(a, x, y) {
  rect(a, x, y, 26, 18, '#d7d7d2');
  rect(a, x + 2, y + 2, 15, 14, '#9da1a3');
  a.strokeStyle = 'rgba(0,0,0,0.35)'; a.lineWidth = 1;
  for (let i = 0; i < 4; i++) { a.beginPath(); a.moveTo(x + 3, y + 4 + i * 3); a.lineTo(x + 16, y + 4 + i * 3); a.stroke(); }
  rect(a, x, y + 18, 26, 2, 'rgba(0,0,0,0.3)');
}

function laundry(a, rnd, x, y, w) {
  a.strokeStyle = 'rgba(30,30,30,0.6)'; a.lineWidth = 1;
  a.beginPath(); a.moveTo(x, y); a.lineTo(x + w, y); a.stroke();
  for (let i = 0; i < 3 + (rnd() * 4 | 0); i++) {
    const lx = x + 4 + rnd() * (w - 18);
    rect(a, lx, y, 9 + rnd() * 8, 12 + rnd() * 14, pick(rnd, LAUNDRY));
  }
}

function plants(a, rnd, x, y, w) {
  for (let i = 0; i < 2 + (rnd() * 3 | 0); i++) {
    const px = x + rnd() * (w - 12);
    rect(a, px, y - 6, 10, 7, '#9a5a3a');
    a.fillStyle = rnd() < 0.5 ? '#3f8a3a' : '#5aa34a';
    a.beginPath(); a.arc(px + 5, y - 10, 7, 0, Math.PI * 2); a.fill();
  }
}

function grille(a, x, y, w, h, col, diamond = false) {
  a.strokeStyle = col; a.lineWidth = 2;
  a.beginPath();
  for (let i = 0; i <= w; i += 10) { a.moveTo(x + i, y); a.lineTo(x + i, y + h); }
  if (diamond) {
    for (let i = -h; i < w; i += 14) { a.moveTo(x + i, y + h); a.lineTo(x + i + h, y); }
  } else {
    for (let j = 0; j <= h; j += 16) { a.moveTo(x, y + j); a.lineTo(x + w, y + j); }
  }
  a.stroke();
  a.strokeRect(x, y, w, h);
}

function glass(a, x, y, w, h, rnd) {
  const g = a.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, '#3b4a55');
  g.addColorStop(1, '#1d262d');
  a.fillStyle = g; a.fillRect(x, y, w, h);
  if (rnd() < 0.45) rect(a, x + 2, y + 2, w * (0.3 + rnd() * 0.5), h - 4, pick(rnd, ['#c9b48a', '#8aa0b8', '#b88a8a', '#d8d0c0', '#6f8f6f']));
  a.fillStyle = 'rgba(255,255,255,0.12)'; a.fillRect(x, y, w, 3);
}

// Ground-floor shop: signboard, roll-up shutter, goods inside.
function shop(a, e, rnd, x, y, w, h, opt = {}) {
  // roll-up shutter housing above the opening (real signs are separate 3D boards)
  const housing = pick(rnd, ['#8d9296', '#7f858a', '#9aa0a4', '#6f7478']);
  rect(a, x + 6, y + 10, w - 12, 24, housing);
  rect(a, x + 6, y + 10, w - 12, 3, 'rgba(255,255,255,0.22)');
  rect(a, x + 6, y + 31, w - 12, 4, 'rgba(0,0,0,0.35)');
  const top = y + 38, bh = h - 38;
  const open = rnd() < 0.8;
  const closed = open ? bh * (0.12 + rnd() * 0.25) : bh;
  // interior
  rect(a, x + 8, top, w - 16, bh, '#2a2420');
  if (open) {
    const goods = [];
    for (let i = 0; i < 9; i++) {
      const g = [x + 10 + rnd() * (w - 30), top + closed + rnd() * (bh - closed - 14), 8 + rnd() * 14, 6 + rnd() * 12];
      goods.push(g);
      rect(a, g[0], g[1], g[2], g[3], pick(rnd, GOODS));
    }
    rect(a, x + 10, top + bh - 16, w - 20, 4, '#5a4a3a'); // counter
    if (rnd() < 0.85) {
      // lit interior at night: a tube light under the shutter, falling off toward the floor,
      // with the goods and counter standing out as silhouettes
      const iy = top + closed, ih = bh - closed;
      const gr = e.createLinearGradient(0, iy, 0, iy + ih);
      const warm = rnd() < 0.6;
      gr.addColorStop(0, warm ? 'rgba(255,214,140,0.95)' : 'rgba(236,250,255,0.95)');
      gr.addColorStop(1, warm ? 'rgba(120,80,40,0.55)' : 'rgba(90,110,120,0.5)');
      e.fillStyle = gr;
      e.fillRect(x + 8, iy, w - 16, ih);
      rect(e, x + 12, iy + 1, w - 24, 2, warm ? '#fff3d0' : '#ffffff');
      for (const g of goods) rect(e, g[0], g[1], g[2], g[3], 'rgba(20,14,10,0.6)');
      rect(e, x + 10, top + bh - 16, w - 20, 16, 'rgba(20,14,10,0.55)');
    }
  }
  // shutter
  rect(a, x + 8, top, w - 16, closed, '#8d9296');
  a.strokeStyle = 'rgba(0,0,0,0.25)'; a.lineWidth = 1;
  for (let j = top + 3; j < top + closed; j += 4) { a.beginPath(); a.moveTo(x + 8, j); a.lineTo(x + w - 8, j); a.stroke(); }
  // pillars
  rect(a, x, top - 2, 8, bh + 2, 'rgba(0,0,0,0.06)');
  rect(a, x + w - 8, top - 2, 8, bh + 2, 'rgba(0,0,0,0.06)');
}

function cornice(a, x, y, w) {
  rect(a, x, y, w, 9, 'rgba(255,255,255,0.35)');
  rect(a, x, y + 9, w, 3, 'rgba(0,0,0,0.22)');
}

function brickWall(a, rnd, x, y, w, h) {
  rect(a, x, y, w, h, '#9c4632');
  for (let j = 0; j < h; j += 7) {
    const off = (j / 7) % 2 ? 0 : 8;
    for (let i = -off; i < w; i += 16) {
      const t = rnd();
      a.fillStyle = t < 0.33 ? '#a9513a' : t < 0.66 ? '#923f2c' : '#b25a40';
      a.fillRect(x + i + 1, y + j + 1, 14, 5);
    }
  }
}

// ---------------------------------------------------------------- styles
function drawStyle(style, a, e, ox, oy, rnd) {
  const rowY = (r) => oy + (3 - r) * CH;
  const W = FACADE.RW, H = FACADE.RH;
  const base = {
    0: '#efe9dc', 1: '#ebe8e1', 2: '#8fa3b3', 3: '#ece5d6', 4: '#ece7de', 5: '#e8e4d9', 6: '#9c4632', 7: '#e3dfd6', 8: '#dedcd5',
  }[style];
  rect(a, ox, oy, W, H, base);
  if (style !== 2 && style !== 6) blotches(a, rnd, ox, oy, W, H, 40);
  if (style === 6) brickWall(a, rnd, ox, oy, W, H);

  for (let r = 0; r < 4; r++) {
    const y = rowY(r);
    for (let b = 0; b < 4; b++) {
      const x = ox + b * CW;
      switch (style) {
        case 0: { // colonial: arched shuttered windows, cornices, pilasters, arcade shops
          if (r === 0) { shop(a, e, rnd, x, y, CW, CH, { han: 0.2 }); break; }
          rect(a, x, y, 10, CH, 'rgba(0,0,0,0.05)');
          rect(a, x + CW - 10, y, 10, CH, 'rgba(255,255,255,0.08)');
          cornice(a, x, y, CW);
          const wx = x + 46, wy = y + 30, ww = 68, wh = 96;
          a.fillStyle = 'rgba(255,255,255,0.45)';
          a.beginPath(); a.moveTo(wx - 7, wy + wh + 4); a.lineTo(wx - 7, wy + 30); a.arc(wx + ww / 2, wy + 30, ww / 2 + 7, Math.PI, 0); a.lineTo(wx + ww + 7, wy + wh + 4); a.fill();
          const closed = rnd() < 0.4;
          a.fillStyle = closed ? pick(rnd, ['#3f6f5e', '#4b6a7d', '#6b7f4a']) : '#26313a';
          a.beginPath(); a.moveTo(wx, wy + wh); a.lineTo(wx, wy + 30); a.arc(wx + ww / 2, wy + 30, ww / 2, Math.PI, 0); a.lineTo(wx + ww, wy + wh); a.fill();
          if (closed) { a.strokeStyle = 'rgba(0,0,0,0.3)'; a.lineWidth = 1; for (let k = wy + 34; k < wy + wh; k += 5) { a.beginPath(); a.moveTo(wx + 2, k); a.lineTo(wx + ww - 2, k); a.stroke(); } a.beginPath(); a.moveTo(wx + ww / 2, wy + 10); a.lineTo(wx + ww / 2, wy + wh); a.stroke(); } else lit(e, rnd, wx + 3, wy + 10, ww - 6, wh - 12, 0.35);
          rect(a, wx - 9, wy + wh + 2, ww + 18, 7, 'rgba(255,255,255,0.5)');
          if (r === 1) { // cast-iron balcony
            rect(a, x + 4, y + CH - 30, CW - 8, 4, '#2b2b2b');
            a.strokeStyle = '#2b2b2b'; a.lineWidth = 1.5;
            for (let k = x + 6; k < x + CW - 6; k += 6) { a.beginPath(); a.moveTo(k, y + CH - 28); a.lineTo(k, y + CH - 6); a.stroke(); }
            rect(a, x + 4, y + CH - 8, CW - 8, 4, '#3a3a3a');
          }
          break;
        }
        case 1: { // concrete walk-up flats: grilled windows, cage balconies, AC, laundry
          if (r === 0) { shop(a, e, rnd, x, y, CW, CH, { han: 0.35 }); break; }
          rect(a, x, y + CH - 14, CW, 14, 'rgba(0,0,0,0.08)');
          glass(a, x + 26, y + 26, 108, 74, rnd);
          lit(e, rnd, x + 28, y + 28, 104, 70, 0.42);
          grille(a, x + 26, y + 26, 108, 74, rnd() < 0.5 ? '#e8e8e2' : '#5f8a6a', rnd() < 0.3);
          if (rnd() < 0.55) { rect(a, x + 6, y + CH - 40, CW - 12, 26, 'rgba(0,0,0,0.12)'); grille(a, x + 6, y + CH - 40, CW - 12, 26, '#e0e0d8'); }
          if (rnd() < 0.5) laundry(a, rnd, x + 10, y + 108, CW - 20);
          if (rnd() < 0.55) acUnit(a, x + (rnd() < 0.5 ? 2 : CW - 30), y + 60);
          if (rnd() < 0.3) plants(a, rnd, x + 10, y + CH - 40, CW - 20);
          break;
        }
        case 2: { // glass curtain wall
          const g = a.createLinearGradient(x, y, x + CW, y + CH);
          g.addColorStop(0, '#6f97ba'); g.addColorStop(0.5, '#3f6487'); g.addColorStop(1, '#294866');
          a.fillStyle = g; a.fillRect(x + 3, y + 8, CW - 6, CH - 20);
          rect(a, x + 3, y + CH - 12, CW - 6, 12, '#b9c3c9');
          rect(a, x + CW / 2 - 2, y + 8, 4, CH - 20, '#c7d0d6');
          a.fillStyle = 'rgba(255,255,255,0.15)'; a.fillRect(x + 3, y + 8, CW - 6, 8);
          if (r === 0) { rect(a, x + 3, y + 8, CW - 6, CH - 8, '#2f3c45'); rect(a, x + 40, y + 60, 80, CH - 60, '#1b2329'); lit(e, rnd, x + 4, y + 10, CW - 8, CH - 12, 0.9, ['#fff1d0', '#e8f2ff']); }
          else lit(e, rnd, x + 5, y + 10, CW - 10, CH - 24, 0.5, ['#e8f2ff', '#fff1d0', '#cfe8ff']);
          break;
        }
        case 3: { // low house / shophouse with timber shutters
          if (r === 0 && (b === 1 || b === 3)) {
            rect(a, x + 50, y + 34, 60, CH - 34, '#5d3b24');
            rect(a, x + 54, y + 38, 24, CH - 38, '#6e4a2e'); rect(a, x + 82, y + 38, 24, CH - 38, '#6e4a2e');
            lit(e, rnd, x + 54, y + 40, 52, CH - 44, 0.2);
            break;
          }
          const ww = 74, wh = 64, wx = x + 43, wy = y + 32;
          rect(a, wx - 4, wy - 4, ww + 8, wh + 8, 'rgba(0,0,0,0.12)');
          if (rnd() < 0.5) {
            rect(a, wx, wy, ww, wh, '#7a5235');
            a.strokeStyle = 'rgba(0,0,0,0.3)'; a.lineWidth = 1;
            for (let k = wy + 4; k < wy + wh; k += 6) { a.beginPath(); a.moveTo(wx, k); a.lineTo(wx + ww, k); a.stroke(); }
            rect(a, wx + ww / 2 - 1, wy, 2, wh, 'rgba(0,0,0,0.4)');
          } else { glass(a, wx, wy, ww, wh, rnd); grille(a, wx, wy, ww, wh, '#4a4a4a'); lit(e, rnd, wx + 2, wy + 2, ww - 4, wh - 4, 0.4); }
          if (r === 0) splash(a, x, y + CH, CW);
          break;
        }
        case 4: { // Chinatown shophouse A: red signboards, green grilles, couplets, lanterns
          if (r === 0) { shop(a, e, rnd, x, y, CW, CH, { han: 0.85, sign: pick(rnd, ['#b3201c', '#c9302c', '#e8b923', '#b3201c', '#1d5fa8']) }); break; }
          rect(a, x, y + CH - 16, CW, 16, 'rgba(0,0,0,0.1)');
          glass(a, x + 30, y + 24, 100, 80, rnd);
          lit(e, rnd, x + 32, y + 26, 96, 76, 0.45, ['#ffd27a', '#ffc46b', '#ff9f80', '#fff1d0']);
          grille(a, x + 30, y + 24, 100, 80, pick(rnd, ['#4f8a6a', '#3d6e8a', '#e8e8e2', '#8a3a3a']), rnd() < 0.5);
          if (rnd() < 0.5) { // red couplets
            rect(a, x + 14, y + 22, 10, 74, '#c0261f'); rect(a, x + 136, y + 22, 10, 74, '#c0261f');
            glyphs(a, rnd, x + 15, y + 26, 8, 8, '#f2c94c'); glyphs(a, rnd, x + 137, y + 26, 8, 8, '#f2c94c');
            rect(a, x + 40, y + 12, 80, 9, '#c0261f');
          }
          if (rnd() < 0.5) plants(a, rnd, x + 22, y + CH - 16, CW - 44);
          if (rnd() < 0.45) laundry(a, rnd, x + 14, y + 110, CW - 28);
          if (rnd() < 0.4) acUnit(a, x + CW - 30, y + 70);
          if (rnd() < 0.18) { a.fillStyle = '#d42a1f'; a.beginPath(); a.ellipse(x + 20, y + 40, 8, 10, 0, 0, Math.PI * 2); a.fill(); lit(e, () => 0, x + 13, y + 31, 14, 18, 1, ['#ff4a3a']); }
          break;
        }
        case 5: { // Chinatown shophouse B: louvred timber windows, painted railings, tiles
          if (r === 0) { shop(a, e, rnd, x, y, CW, CH, { han: 0.75 }); break; }
          rect(a, x, y, CW, 6, 'rgba(0,0,0,0.08)');
          const tint = pick(rnd, ['#6f9fb0', '#7fa88a', '#d9c27a', '#b07f7f', '#c9c9c0']);
          rect(a, x + 18, y + 20, 124, 86, 'rgba(0,0,0,0.15)');
          for (const [wx, ww] of [[x + 22, 56], [x + 82, 56]]) {
            if (rnd() < 0.5) {
              rect(a, wx, y + 24, ww, 78, tint);
              a.strokeStyle = 'rgba(0,0,0,0.25)'; a.lineWidth = 1;
              for (let k = y + 28; k < y + 100; k += 5) { a.beginPath(); a.moveTo(wx, k); a.lineTo(wx + ww, k); a.stroke(); }
            } else { glass(a, wx, y + 24, ww, 78, rnd); lit(e, rnd, wx + 2, y + 26, ww - 4, 74, 0.45); }
          }
          rect(a, x + 10, y + 106, CW - 20, 4, '#3a3a3a');
          a.strokeStyle = tint; a.lineWidth = 2;
          for (let k = x + 14; k < x + CW - 12; k += 8) { a.beginPath(); a.moveTo(k, y + 110); a.lineTo(k, y + 132); a.stroke(); }
          rect(a, x + 10, y + 130, CW - 20, 4, tint);
          if (rnd() < 0.4) laundry(a, rnd, x + 14, y + 112, CW - 28);
          if (rnd() < 0.3) acUnit(a, x + 4, y + 30);
          break;
        }
        case 6: { // red brick colonial with white stone trim
          rect(a, x, y, CW, 8, '#efe6d2');
          rect(a, x, y + 8, CW, 2, 'rgba(0,0,0,0.25)');
          rect(a, x, y, 10, CH, 'rgba(255,255,255,0.1)');
          const ww = r === 0 ? 92 : 62, wh = r === 0 ? 112 : 92, wx = x + (CW - ww) / 2, wy = y + CH - wh - (r === 0 ? 0 : 14);
          a.fillStyle = '#efe6d2';
          a.beginPath(); a.moveTo(wx - 7, wy + wh); a.lineTo(wx - 7, wy + ww / 2); a.arc(wx + ww / 2, wy + ww / 2, ww / 2 + 7, Math.PI, 0); a.lineTo(wx + ww + 7, wy + wh); a.fill();
          a.fillStyle = r === 0 ? '#2d2622' : '#28333b';
          a.beginPath(); a.moveTo(wx, wy + wh); a.lineTo(wx, wy + ww / 2); a.arc(wx + ww / 2, wy + ww / 2, ww / 2, Math.PI, 0); a.lineTo(wx + ww, wy + wh); a.fill();
          if (r > 0) { a.strokeStyle = '#efe6d2'; a.lineWidth = 2; a.beginPath(); a.moveTo(wx + ww / 2, wy + 6); a.lineTo(wx + ww / 2, wy + wh); a.moveTo(wx, wy + wh * 0.62); a.lineTo(wx + ww, wy + wh * 0.62); a.stroke(); rect(a, wx - 10, wy + wh, ww + 20, 6, '#efe6d2'); }
          rect(a, x + CW / 2 - 6, wy - 9, 12, 12, '#f4ecdc');
          lit(e, rnd, wx + 4, wy + 10, ww - 8, wh - 12, r === 0 ? 0.6 : 0.3);
          break;
        }
        case 7: { // blank party wall: concrete, mould, vents, pipes
          if (rnd() < 0.18 && r > 0) { rect(a, x + 60, y + 50, 26, 30, '#3a3f42'); grille(a, x + 60, y + 50, 26, 30, '#8a8a85'); }
          if (b === 2) { rect(a, x + 120, y, 6, CH, '#5f6366'); rect(a, x + 118, y + 20, 10, 4, '#4a4e50'); }
          if (r === 0 && b === 0 && rnd() < 0.6) { rect(a, x + 30, y + 46, 70, CH - 46, '#7d8287'); a.strokeStyle = 'rgba(0,0,0,0.25)'; for (let j = y + 50; j < y + CH; j += 4) { a.beginPath(); a.moveTo(x + 30, j); a.lineTo(x + 100, j); a.stroke(); } }
          break;
        }
        case 8: { // concrete office / hotel: ribbon windows
          rect(a, x, y + 26, CW, 82, '#2e3f4c');
          a.fillStyle = 'rgba(255,255,255,0.12)'; a.fillRect(x, y + 26, CW, 6);
          rect(a, x + CW - 6, y + 26, 6, 82, '#bfc3c4');
          if (r === 0) { rect(a, x, y + 20, CW, CH - 20, '#26323a'); rect(a, x + 8, y + 4, CW - 16, 14, pick(rnd, ['#1d5fa8', '#b3201c', '#2f7d4a'])); glyphs(a, rnd, x + 14, y + 6, CW - 28, 10, '#fff', 'han'); lit(e, rnd, x + 2, y + 22, CW - 4, CH - 24, 0.9, ['#fff1d0', '#e8f2ff']); }
          else lit(e, rnd, x + 2, y + 28, CW - 8, 78, 0.5, ['#e8f2ff', '#fff1d0', '#cfe8ff']);
          if (r > 0 && rnd() < 0.25) acUnit(a, x + 10, y + 112);
          break;
        }
        default: break;
      }
    }
    if (r === 0 && style !== 2) splash(a, ox, rowY(0) + CH, W);
  }
  if (style !== 2) streaks(a, rnd, ox, oy, W, H, style === 7 ? 24 : 18, style === 6 ? 0.14 : 0.2);
}

export function facadeTextures(quality = 'high') {
  const S = FACADE.SIZE;
  const col = makeCanvas(S, S), emi = makeCanvas(S, S);
  const a = col.getContext('2d'), e = emi.getContext('2d');
  rect(a, 0, 0, S, S, '#e8e4dc');
  rect(e, 0, 0, S, S, '#000');
  for (let s = 0; s < 9; s++) {
    const ox = (s % 3) * FACADE.RW, oy = Math.floor(s / 3) * FACADE.RH;
    drawStyle(s, a, e, ox, oy, mulberry32(101 + s * 977));
  }
  // emissive at half resolution is plenty
  const half = makeCanvas(S / 2, S / 2);
  half.getContext('2d').drawImage(emi, 0, 0, S / 2, S / 2);
  let colorCanvas = col;
  if (quality === 'low') {
    colorCanvas = makeCanvas(S / 2, S / 2);
    colorCanvas.getContext('2d').drawImage(col, 0, 0, S / 2, S / 2);
  }
  return { map: tex(colorCanvas), emissive: tex(half) };
}

// ---------------------------------------------------------------- shop signs
// 1024x1024: 16 horizontal signs (512x64, 2 columns x 8 rows) on top,
// 16 vertical signs (64x512) along the bottom half.
const H_SIGNS = [
  ['金龍酒家', 'GOLDEN DRAGON RESTAURANT', '#b3201c', '#ffd34d'],
  ['福建茶室', 'လက်ဖက်ရည်ဆိုင်  TEA SHOP', '#f2f2ee', '#b3201c'],
  ['ရွှေဆိုင်', 'GOLD SHOP  金行', '#c9302c', '#ffe08a'],
  ['大藥房', 'PHARMACY  ဆေးဆိုင်', '#2f7d4a', '#ffffff'],
  ['ဖုန်းဆိုင်', 'MOBILE & ELECTRONICS', '#1d5fa8', '#ffffff'],
  ['點心', 'DIM SUM  早茶', '#e8b923', '#7a1010'],
  ['華興五金', 'HARDWARE', '#f2f2ee', '#1d5fa8'],
  ['မုန့်ဟင်းခါး', 'MOHINGA', '#d9622b', '#ffffff'],
  ['長春藥材', 'CHINESE MEDICINE', '#7a1f6e', '#ffd34d'],
  ['燒烤', 'BBQ  အကင်', '#1f1f22', '#ff5a3a'],
  ['布莊', 'FABRICS  ပိတ်စ', '#b3201c', '#ffffff'],
  ['涼茶', 'HERBAL TEA', '#2f7d4a', '#ffe08a'],
  ['旅館', 'GUEST HOUSE  တည်းခိုခန်း', '#1d5fa8', '#ffe08a'],
  ['眼鏡', 'OPTICAL', '#f2f2ee', '#1f1f22'],
  ['မုန့်တိုက်', 'BAKERY  麵包西餅', '#e8b923', '#7a1010'],
  ['錶行', 'WATCHES  နာရီ', '#1f1f22', '#38e8ff'],
];
const V_SIGNS = [
  ['金行', '#b3201c', '#ffd34d'], ['藥材', '#2f7d4a', '#ffffff'], ['茶樓', '#f2f2ee', '#b3201c'], ['酒家', '#b3201c', '#ffffff'],
  ['旅館', '#1d5fa8', '#ffe08a'], ['錶行', '#1f1f22', '#ff4fa3'], ['布行', '#e8b923', '#7a1010'], ['海味', '#c9302c', '#ffe08a'],
  ['麵館', '#f2f2ee', '#1d5fa8'], ['飯店', '#7a1f6e', '#ffd34d'], ['珠寶', '#1f1f22', '#ffd34d'], ['雜貨', '#2f7d4a', '#ffe08a'],
  ['牙醫', '#f2f2ee', '#2f7d4a'], ['照相', '#1d5fa8', '#ffffff'], ['米行', '#d9622b', '#ffffff'], ['燒臘', '#b3201c', '#ffffff'],
];
const HAN_FONT = "'Noto Sans SC','Noto Sans CJK SC','PingFang SC','Hiragino Sans GB','Microsoft YaHei','WenQuanYi Zen Hei',sans-serif";
const MY_FONT = "'Padauk','Noto Sans Myanmar','Myanmar Text','Myanmar Sangam MN',sans-serif";
const LAT_FONT = "'Rajdhani','Arial Narrow',Arial,sans-serif";

function fontFor(text) {
  if (/[က-႟]/.test(text)) return MY_FONT;
  if (/[㐀-鿿]/.test(text)) return HAN_FONT;
  return LAT_FONT;
}

function fitText(c, text, x, y, maxW, size, weight = 700) {
  let s = size;
  do {
    c.font = `${weight} ${s}px ${fontFor(text)}`;
    s -= 2;
  } while (c.measureText(text).width > maxW && s > 10);
  c.fillText(text, x, y);
}

export async function signTexture() {
  try {
    if (document.fonts && document.fonts.load) {
      await Promise.race([
        Promise.all([document.fonts.load(`700 30px Padauk`), document.fonts.load(`700 30px Rajdhani`)]),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    }
  } catch (err) { /* fonts optional */ }
  const c = makeCanvas(1024, 1024);
  const a = c.getContext('2d');
  a.textBaseline = 'middle';
  H_SIGNS.forEach(([main, sub, bg, fg], i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 64;
    rect(a, x, y, 512, 64, bg);
    rect(a, x + 3, y + 3, 506, 58, 'rgba(255,255,255,0.08)');
    a.strokeStyle = fg; a.lineWidth = 3; a.strokeRect(x + 6, y + 6, 500, 52);
    a.fillStyle = fg;
    a.textAlign = 'left';
    fitText(a, main, x + 16, y + 33, 190, 42);
    a.textAlign = 'right';
    fitText(a, sub, x + 498, y + 34, 290, 26);
  });
  V_SIGNS.forEach(([text, bg, fg], i) => {
    const x = i * 64, y = 512;
    rect(a, x, y, 64, 512, bg);
    a.strokeStyle = fg; a.lineWidth = 3; a.strokeRect(x + 5, y + 5, 54, 502);
    a.fillStyle = fg; a.textAlign = 'center';
    const chars = [...text];
    const step = 470 / (chars.length + 1);
    a.font = `700 50px ${HAN_FONT}`;
    chars.forEach((ch, k) => a.fillText(ch, x + 32, y + 20 + step * (k + 1)));
    a.font = `700 16px ${LAT_FONT}`;
    a.fillText('★', x + 32, y + 490);
  });
  const t = tex(c);
  return t;
}

// UV rectangle (u0, v0, u1, v1) of a sign in the atlas
export function signUV(kind, i) {
  if (kind === 'h') {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 64;
    return [x / 1024, 1 - (y + 64) / 1024, (x + 512) / 1024, 1 - y / 1024];
  }
  const x = i * 64, y = 512;
  return [x / 1024, 1 - (y + 512) / 1024, (x + 64) / 1024, 1 - y / 1024];
}

export { makeCanvas, tex, HAN_FONT, MY_FONT, LAT_FONT, fontFor };
