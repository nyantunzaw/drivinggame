// Real Chinatown shops: every named place between Lanmadaw Road and Latha Road from the
// Overture Maps places theme (tools/build_shops.py). Each is snapped to the street-facing
// wall of the building it belongs to, gets its real name on the signboard, and a shopfront
// dressed the way that trade looks on Yangon's streets.
import * as THREE from 'three';
import { pointInPoly } from '../util.js';
import { HAN_FONT, MY_FONT, LAT_FONT, fontFor, makeCanvas, tex } from '../facades.js';
import { gbox, gcyl, awning } from './chunks.js';

export async function loadShops(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return json.shops.map(([x, z, kind, l1, l2, up]) => ({ x, z, kind, l1, l2, up: !!up }));
  } catch (e) {
    return [];
  }
}

// Frontage width (m) a business of each kind takes up
const WIDTH = { hotel: 6, bank: 5, gold: 4.2, food: 4.6, bar: 4.4, grocery: 4.2, tea: 4.6 };

// Find, for every shop, the street-facing wall it sits behind.
// Returns Map<building index, [{ k, t0, t1, shop }]> (t along the wall in metres).
export function assignShops(shops, map, collision, cellAt) {
  const byBuilding = new Map();
  const ringCache = new Map();
  const ringOf = (b) => { let r = ringCache.get(b); if (!r) { r = map.buildingRing(b); ringCache.set(b, r); } return r; };
  const frontCache = new Map();
  const isFront = (b, k, ax, az, nx, nz) => {
    const key = b * 64 + k;
    let f = frontCache.get(key);
    if (f === undefined) {
      const mx = ax, mz = az; // caller passes the wall midpoint
      f = false;
      for (const d of [2.5, 6, 10]) if (collision.roadAt(mx + nx * d, mz + nz * d)) { f = true; break; }
      frontCache.set(key, f);
    }
    return f;
  };
  const edges = new Map(); // "b:k" -> list
  for (const shop of shops) {
    const cand = new Set();
    for (const [ox, oz] of [[-40, -40], [40, -40], [-40, 40], [40, 40], [0, 0]]) {
      const c = cellAt(shop.x + ox, shop.z + oz);
      if (c) for (const b of c.b) cand.add(b);
    }
    let best = null;
    for (const b of cand) {
      if (Math.abs(map.bCx[b] - shop.x) > 70 || Math.abs(map.bCz[b] - shop.z) > 70) continue;
      const ring = ringOf(b);
      const n = ring.length / 2;
      const inside = pointInPoly(ring, shop.x, shop.z);
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
        const dx = bx - ax, dz = bz - az;
        const L = Math.hypot(dx, dz);
        if (L < 2.6) continue;
        const nx = -dz / L, nz = dx / L;
        if (!isFront(b, k, (ax + bx) / 2, (az + bz) / 2, nx, nz)) continue;
        const t = Math.max(0, Math.min(L, ((shop.x - ax) * dx + (shop.z - az) * dz) / L));
        const d = Math.hypot(ax + (dx * t) / L - shop.x, az + (dz * t) / L - shop.z);
        const score = d - (inside ? 6 : 0);
        if (d < (inside ? 45 : 24) && (!best || score < best.score)) best = { b, k, t, L, score };
      }
    }
    if (!best) continue;
    const key = `${best.b}:${best.k}:${shop.up ? 1 : 0}`;
    let list = edges.get(key);
    if (!list) { list = []; edges.set(key, list); }
    list.push({ shop, t: best.t, L: best.L, b: best.b, k: best.k });
  }
  // share each wall out without overlaps, in order along the wall
  let placed = 0;
  for (const list of edges.values()) {
    list.sort((p, q) => p.t - q.t);
    const L = list[0].L;
    const want = list.map((e) => Math.min(e.shop.up ? 4.2 : WIDTH[e.shop.kind] || 3.8, L - 0.4));
    const total = want.reduce((a, w) => a + w + 0.15, 0);
    const scale = total > L - 0.4 ? (L - 0.4) / total : 1;
    let cursor = 0.2;
    const out = [];
    for (let q = 0; q < list.length; q++) {
      const w = want[q] * scale;
      if (w < 2.2) continue;
      // centred on the real position where there is room, pushed along otherwise
      let t0 = Math.max(cursor, list[q].t - w / 2);
      const rest = want.slice(q + 1).reduce((a, x) => a + x * scale + 0.15, 0);
      t0 = Math.min(t0, L - 0.2 - rest - w);
      t0 = Math.max(t0, cursor);
      if (t0 + w > L - 0.2 + 1e-6) continue;
      out.push({ k: list[q].k, t0, t1: t0 + w, shop: list[q].shop });
      cursor = t0 + w + 0.15;
    }
    if (!out.length) continue;
    const b = list[0].b;
    let arr = byBuilding.get(b);
    if (!arr) { arr = []; byBuilding.set(b, arr); }
    arr.push(...out);
    placed += out.length;
  }
  return { byBuilding, placed };
}

// ---------------------------------------------------------------- signboards
const STYLES = {
  gold: [['#b3121b', '#ffd34d'], ['#7a0c12', '#ffcc33'], ['#c8171e', '#fff1a8']],
  food: [['#c8171e', '#ffe14d'], ['#f4d03f', '#b3121b'], ['#ffffff', '#c0161e'], ['#1d6b3a', '#ffffff'], ['#e86a17', '#ffffff']],
  tea: [['#1c5aa6', '#ffffff'], ['#2e7d32', '#fff8e1'], ['#f5f0e1', '#8b1a1a']],
  icecream: [['#ffd1e1', '#c2185b'], ['#ffffff', '#e91e63'], ['#8fd3f4', '#1a3a6b']],
  bar: [['#111111', '#39e5ff'], ['#141018', '#ff4fb0'], ['#0d0d0d', '#ffd23f']],
  phone: [['#1f5fbf', '#ffffff'], ['#e53935', '#ffffff'], ['#00a651', '#ffffff'], ['#111111', '#ffffff']],
  pharmacy: [['#ffffff', '#1b8a3c']],
  clinic: [['#ffffff', '#1b4fa0'], ['#e8f3ff', '#c62828']],
  hotel: [['#2b1d4e', '#f5d48a'], ['#5a1020', '#f6e0a0'], ['#0f3d2e', '#f2e2b0']],
  bank: [['#123a7a', '#ffffff'], ['#0b6b3a', '#ffffff'], ['#f2f2f2', '#123a7a']],
  beauty: [['#e0218a', '#ffffff'], ['#ffffff', '#c2185b'], ['#2b2b2b', '#f8bbd0']],
  grocery: [['#ffd400', '#c8171e'], ['#2e7d32', '#ffeb3b']],
  clothes: [['#5b2a86', '#ffffff'], ['#00838f', '#ffffff'], ['#f4f1e6', '#5b2a86']],
  school: [['#ffffff', '#0d47a1'], ['#0d47a1', '#ffffff'], ['#fff3c4', '#b71c1c']],
  gym: [['#111111', '#ff7a00'], ['#1b1b1b', '#e53935']],
  office: [['#eceff1', '#263238'], ['#37474f', '#ffffff']],
  shop: [['#f4f1e6', '#b3121b'], ['#1f5fbf', '#ffffff'], ['#ffd400', '#111111'], ['#c8171e', '#ffffff'], ['#2f7d4a', '#ffffff']],
};

const hashStr = (s) => { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };

function fit(c, text, x, y, maxW, size, weight = 700) {
  let s = size;
  const fam = fontFor(text);
  do { c.font = `${weight} ${s}px ${fam}`; s -= 1; } while (c.measureText(text).width > maxW && s > 7);
  c.fillText(text, x, y);
}

function drawIcon(c, kind, x, y, s, fg) {
  c.save();
  if (kind === 'pharmacy' || kind === 'clinic') {
    c.fillStyle = kind === 'pharmacy' ? '#1b8a3c' : '#d32f2f';
    const a = s * 0.3;
    c.fillRect(x - a / 2, y - s / 2, a, s);
    c.fillRect(x - s / 2, y - a / 2, s, a);
  } else if (kind === 'hotel') {
    c.fillStyle = fg;
    c.font = `${s}px ${LAT_FONT}`;
    c.textAlign = 'center';
    c.fillText('★', x, y + s * 0.35);
  } else if (kind === 'gold') {
    c.fillStyle = '#ffd34d';
    c.beginPath();
    c.moveTo(x, y - s / 2); c.lineTo(x + s / 2, y); c.lineTo(x, y + s / 2); c.lineTo(x - s / 2, y); c.closePath();
    c.fill();
  } else if (kind === 'phone') {
    c.strokeStyle = fg; c.lineWidth = Math.max(1, s * 0.1);
    c.strokeRect(x - s * 0.25, y - s * 0.45, s * 0.5, s * 0.9);
  }
  c.restore();
}

// One atlas with every matched shop's real sign (and a vertical blade sign where the
// shop would have one), lit at night through the emissive map.
export async function shopSignAtlas(entries, small) {
  try {
    if (document.fonts && document.fonts.load) {
      await Promise.race([
        Promise.all([document.fonts.load('700 30px Padauk'), document.fonts.load('700 30px Rajdhani')]),
        new Promise((r) => setTimeout(r, 1500)),
      ]);
    }
  } catch (e) { /* fonts optional */ }
  const s = small ? 0.5 : 1;
  const CW = 256 * s, CH = 64 * s, VW = 48 * s, VH = 256 * s;
  const cols = 8, vcols = Math.floor((cols * CW) / VW);
  const blades = entries.filter((e) => e.blade);
  const rows = Math.ceil(entries.length / cols);
  const vrows = Math.ceil(blades.length / vcols);
  const W = cols * CW, H = Math.max(CH, rows * CH + vrows * VH);
  const c = makeCanvas(W, H);
  const a = c.getContext('2d');
  a.textBaseline = 'middle';
  entries.forEach((e, i) => {
    const { shop } = e;
    const pal = STYLES[shop.kind] || STYLES.shop;
    const [bg, fg] = pal[Math.floor(hashStr(shop.l1) * pal.length)];
    const x = (i % cols) * CW, y = Math.floor(i / cols) * CH;
    a.fillStyle = bg; a.fillRect(x, y, CW, CH);
    // sheen, frame and a slim accent stripe like a printed vinyl board
    const g = a.createLinearGradient(0, y, 0, y + CH);
    g.addColorStop(0, 'rgba(255,255,255,0.16)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
    a.fillStyle = g; a.fillRect(x, y, CW, CH);
    a.strokeStyle = shop.kind === 'gold' ? '#ffd34d' : fg; a.globalAlpha = 0.85; a.lineWidth = 2 * s;
    a.strokeRect(x + 3 * s, y + 3 * s, CW - 6 * s, CH - 6 * s);
    a.globalAlpha = 1;
    const icon = ['pharmacy', 'clinic', 'hotel', 'gold', 'phone'].includes(shop.kind);
    const left = x + (icon ? 30 : 10) * s, maxW = CW - (icon ? 40 : 20) * s;
    if (icon) drawIcon(a, shop.kind, x + 17 * s, y + CH / 2, 18 * s, fg);
    a.fillStyle = fg; a.textAlign = 'center';
    const cx = left + maxW / 2;
    if (shop.l2) {
      fit(a, shop.l1, cx, y + 24 * s, maxW, 28 * s);
      a.globalAlpha = 0.9;
      fit(a, shop.l2, cx, y + 49 * s, maxW, 15 * s, 600);
      a.globalAlpha = 1;
    } else {
      fit(a, shop.l1, cx, y + 34 * s, maxW, 34 * s);
    }
    e.uv = [x / W, 1 - (y + CH) / H, (x + CW) / W, 1 - y / H];
  });
  const vy0 = rows * CH;
  blades.forEach((e, i) => {
    const { shop } = e;
    const pal = STYLES[shop.kind] || STYLES.shop;
    const [bg, fg] = pal[Math.floor(hashStr(shop.l1 + 'v') * pal.length)];
    const x = (i % vcols) * VW, y = vy0 + Math.floor(i / vcols) * VH;
    a.fillStyle = bg; a.fillRect(x, y, VW, VH);
    a.strokeStyle = fg; a.lineWidth = 2 * s; a.strokeRect(x + 3 * s, y + 3 * s, VW - 6 * s, VH - 6 * s);
    a.fillStyle = fg; a.textAlign = 'center';
    const chars = [...e.bladeText].slice(0, 6);
    const step = (VH - 20 * s) / chars.length;
    const cjk = /[㐀-鿿]/.test(e.bladeText);
    a.font = `700 ${Math.min(34 * s, step * 0.82)}px ${cjk ? HAN_FONT : LAT_FONT}`;
    chars.forEach((ch, k) => a.fillText(ch, x + VW / 2, y + 10 * s + step * (k + 0.5)));
    e.vuv = [x / W, 1 - (y + VH) / H, (x + VW) / W, 1 - y / H];
  });
  const t = tex(c);
  return t;
}

// What goes on the blade sign: the Chinese name if there is one, else a short word.
function bladeText(shop) {
  const zh = ((shop.l1 + shop.l2).match(/[㐀-鿿]/g) || []).join('');
  if (zh.length >= 2) return zh;
  if (shop.kind === 'hotel') return 'HOTEL';
  if (shop.kind === 'gold') return 'GOLD';
  return '';
}

export async function buildShopFronts(shops, map, collision, cellAt, mats, quality) {
  const { byBuilding, placed } = assignShops(shops, map, collision, cellAt);
  const entries = [];
  for (const list of byBuilding.values()) {
    for (const f of list) {
      const bt = bladeText(f.shop);
      f.blade = !!bt && !f.shop.up;
      f.bladeText = bt;
      entries.push(f);
    }
  }
  const atlas = await shopSignAtlas(entries, quality.detail === false);
  mats.shopSigns = new THREE.MeshLambertMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0.08, side: THREE.DoubleSide });
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of shops) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
  const strip = (x, z) => x > x0 - 12 && x < x1 + 12 && z > z0 - 12 && z < z1 + 12;
  return { byBuilding, strip, placed };
}

// ---------------------------------------------------------------- shopfront geometry
const C = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const STOOLS = ['#d9312b', '#2b6fd1', '#e8b923', '#2f9a5a'].map(C);
const GOODS = ['#d64545', '#3e7cd6', '#e6c03a', '#f0f0f0', '#7a3fb0', '#2f9a5a', '#f08a5d', '#8a5a3a'].map(C);
const AWN = { food: '#c8171e', tea: '#1c5aa6', grocery: '#2e7d32', clothes: '#5b2a86', shop: '#d9622b', icecream: '#e91e63', pharmacy: '#1b8a3c' };

// Signboard as a solid board with the real sign on its face.
function signBoard(G, R, ox, oz, rx, rz, nx, nz, w, y0, hgt, uv) {
  const ang = Math.atan2(nx, nz);
  gbox(G, ox + nx * 0.08, y0, oz + nz * 0.08, w + 0.08, hgt + 0.08, 0.14, ang, C('#2a2a2c'), 0, -1);
  const fx = ox + nx * 0.156, fz = oz + nz * 0.156;
  const [u0, v0, u1, v1] = uv;
  const a = R.v(fx - rx * w / 2, y0 + 0.04, fz - rz * w / 2, nx, 0, nz, u0, v0);
  R.v(fx + rx * w / 2, y0 + 0.04, fz + rz * w / 2, nx, 0, nz, u1, v0);
  R.v(fx + rx * w / 2, y0 + 0.04 + hgt, fz + rz * w / 2, nx, 0, nz, u1, v1);
  R.v(fx - rx * w / 2, y0 + 0.04 + hgt, fz - rz * w / 2, nx, 0, nz, u0, v1);
  R.quad(a, a + 1, a + 2, a + 3);
}

// Vertical blade sign sticking out from the wall, readable from both directions.
function blade(G, R, px, pz, tx, tz, nx, nz, y0, uv) {
  const w = 0.62, hgt = 2.6, inner = 0.2;
  gbox(G, px + nx * (inner + w / 2), y0 - 0.04, pz + nz * (inner + w / 2), 0.08, hgt + 0.08, w + 0.06, Math.atan2(nx, nz), C('#2a2a2c'), 0, -1);
  const [u0, v0, u1, v1] = uv;
  for (const sgn of [1, -1]) {
    const fx = tx * sgn, fz = tz * sgn;
    const ox = px + fx * 0.045, oz = pz + fz * 0.045;
    const wallEnd = [ox + nx * inner, oz + nz * inner], outEnd = [ox + nx * (inner + w), oz + nz * (inner + w)];
    const rightIsWall = (fz * nx - fx * nz) < 0;
    const L0 = rightIsWall ? outEnd : wallEnd, R0 = rightIsWall ? wallEnd : outEnd;
    const a = R.v(L0[0], y0, L0[1], fx, 0, fz, u0, v0);
    R.v(R0[0], y0, R0[1], fx, 0, fz, u1, v0);
    R.v(R0[0], y0 + hgt, R0[1], fx, 0, fz, u1, v1);
    R.v(L0[0], y0 + hgt, L0[1], fx, 0, fz, u0, v1);
    R.quad(a, a + 1, a + 2, a + 3);
  }
}

// ax,az + t * (tx,tz) runs along the wall; (nx,nz) points out to the street.
export function shopfront(G, P, R, ax, az, tx, tz, nx, nz, f, ground, bHeight, detail, rnd) {
  const { shop } = f;
  const w = f.t1 - f.t0;
  const tm = (f.t0 + f.t1) / 2;
  const ox = ax + tx * tm, oz = az + tz * tm;            // middle of the frontage on the wall
  const rx = nz, rz = -nx;                                 // viewer's right (= +t direction)
  const ang = Math.atan2(nx, nz);
  const at = (u, v) => [ox + rx * u + nx * v, oz + rz * u + nz * v];
  const box = (Gm, u, v, y, sx, sy, sz, c, glow = 0) => { const [x, z] = at(u, v); gbox(Gm, x, ground + y, z, sx, sy, sz, ang, c, glow, -1); };

  if (shop.up && bHeight > 6.5) {
    // upstairs business: a big banner across the first floor, no shopfront
    signBoard(G, R, ox, oz, rx, rz, nx, nz, w - 0.3, ground + 4.1, Math.min(1.2, w * 0.24), f.uv);
    return;
  }
  const signH = shop.kind === 'hotel' ? 0.95 : 0.8;
  signBoard(G, R, ox, oz, rx, rz, nx, nz, w - 0.25, ground + 3.12, signH, f.uv);
  if (f.blade && f.vuv && bHeight > 7) {
    const end = rnd() < 0.5 ? -1 : 1;
    const [px, pz] = at(end * (w / 2 - 0.35), 0);
    blade(G, R, px, pz, tx, tz, nx, nz, ground + 4.2, f.vuv);
  }
  if (!detail) return;
  const a0 = [ax + tx * f.t0, az + tz * f.t0], a1 = [ax + tx * f.t1, az + tz * f.t1];
  if (AWN[shop.kind] && rnd() < 0.8) awning(G, a0[0], a0[1], a1[0], a1[1], nx, nz, ground, C(AWN[shop.kind]));
  const lit = (c, g, inset = 0.35) => box(P, 0, 0.04, 0.3, w - inset * 2, 2.45, 0.06, C(c), g);

  switch (shop.kind) {
    case 'food': case 'tea': {
      // the whole front opens onto the pavement: low tables and plastic stools outside
      lit(shop.kind === 'tea' ? '#ffe9b8' : '#ffd9a0', 0.35);
      const low = shop.kind === 'tea';
      const tables = Math.max(1, Math.floor((w - 0.6) / 1.6));
      for (let q = 0; q < tables; q++) {
        const u = -w / 2 + 0.9 + q * ((w - 1.8) / Math.max(1, tables - 1 || 1));
        const tu = tables === 1 ? 0 : u;
        box(P, tu, 1.05, 0, low ? 0.55 : 0.7, low ? 0.42 : 0.68, low ? 0.55 : 0.7, C(low ? '#e9e4d8' : '#d8d8d8'));
        for (const [du, dv] of [[-0.48, 0], [0.48, 0], [0, 0.45]]) {
          box(P, tu + du, 1.05 + dv, 0, 0.3, low ? 0.24 : 0.42, 0.3, STOOLS[(q + Math.round(du * 4) + 9) % 4]);
        }
      }
      if (!low) box(P, w / 2 - 0.65, 0.42, 0, 0.9, 1.3, 0.5, C('#cfd8dc'), 0.3); // glass food cabinet
      else { const [x, z] = at(w / 2 - 0.5, 0.45); gcyl(P, x, ground, z, 0.2, 0.75, 8, C('#b0b5b8')); } // tea urn
      break;
    }
    case 'bar': {
      box(P, 0, 0.04, 0.3, w - 0.7, 2.45, 0.06, C('#2a1830'), 0.15);
      box(P, 0, 0.04, 2.55, w - 0.5, 0.06, 0.07, C(rnd() < 0.5 ? '#39e5ff' : '#ff4fb0'), 1.2); // neon strip
      for (let q = 0; q < 3; q++) box(P, -w / 2 + 0.5, 0.45, q * 0.3, 0.45, 0.3, 0.32, C(q % 2 ? '#2f7d32' : '#1f5fbf'));
      box(P, w / 2 - 0.6, 0.8, 0, 0.55, 1.05, 0.55, C('#3a3a3a'));
      break;
    }
    case 'gold':
      // mirrored, brightly lit counters: gold shops glow from the street day and night
      lit('#ffd27a', 0.9, 0.3);
      box(P, 0, 0.25, 0, w - 0.9, 1.0, 0.35, C('#fff3c4'), 0.7); // display counter
      break;
    case 'phone':
      lit('#eef6ff', 0.6);
      for (let q = 0; q < 3; q++) box(P, -w / 2 + 0.6 + q * (w - 1.2) / 2, 0.1, 1.2, 0.7, 0.9, 0.04, GOODS[(q * 3 + 1) % GOODS.length], 0.5); // posters
      box(P, 0, 0.45, 0, 1.0, 0.95, 0.45, C('#dfe6ea'), 0.35); // display stand outside
      break;
    case 'pharmacy': case 'clinic': {
      lit('#eafff2', 0.4);
      // illuminated cross sticking out from the wall
      const [x, z] = at(w / 2 - 0.3, 0.55);
      const cc = C(shop.kind === 'pharmacy' ? '#1b8a3c' : '#d32f2f'), ca = Math.atan2(rx, rz);
      gbox(P, x, ground + 2.5, z, 0.2, 0.62, 0.12, ca, cc, 1.0, -1);
      gbox(P, x, ground + 2.71, z, 0.62, 0.2, 0.12, ca, cc, 1.0, -1);
      break;
    }
    case 'hotel': {
      lit('#ffe2b0', 0.55);
      // entrance canopy on two posts
      box(G, 0, 0.85, 2.75, Math.min(3.4, w - 0.6), 0.16, 1.7, C('#3a2a1e'));
      for (const s of [-1, 1]) box(G, s * (Math.min(3.4, w - 0.6) / 2 - 0.12), 0, 1.6, 0.1, 2.75, 0.1, C('#c9b27c'));
      box(P, 0, 0.9, 0.0, 1.6, 0.03, 1.4, C('#7a1f2b')); // red carpet
      break;
    }
    case 'bank':
      box(P, 0, 0.04, 0.3, w - 0.7, 2.45, 0.06, C('#7fb0d8'), 0.25);
      box(P, w / 2 - 0.55, 0.25, 0.0, 0.7, 1.75, 0.45, C('#c9ced2'));
      box(P, w / 2 - 0.55, 0.49, 1.05, 0.5, 0.35, 0.04, C('#9fe3ff'), 0.9); // ATM screen
      break;
    case 'beauty':
      lit('#ffd6ea', 0.5);
      box(P, -w / 2 + 0.6, 0.9, 0, 0.55, 0.9, 0.08, C('#ffffff')); // sandwich board
      break;
    case 'icecream':
      lit('#fff4f8', 0.5);
      box(P, -w / 2 + 0.8, 0.4, 0, 1.1, 0.85, 0.6, C('#f4f8ff'), 0.25); // chest freezer
      break;
    case 'grocery': case 'shop': {
      lit('#fff0cf', 0.25);
      // goods spill onto the pavement: sacks, crates and stacked boxes
      const n = 3 + Math.floor(rnd() * 4);
      for (let q = 0; q < n; q++) {
        const u = -w / 2 + 0.5 + rnd() * (w - 1), v = 0.15 + rnd() * 0.65;
        if (shop.kind === 'grocery' && q % 2) { const [x, z] = at(u, v); gcyl(P, x, ground, z, 0.26, 0.55, 6, C('#d9c9a3')); }
        else box(P, u, v, 0, 0.45 + rnd() * 0.3, 0.3 + rnd() * 0.45, 0.4, GOODS[Math.floor(rnd() * GOODS.length)]);
      }
      break;
    }
    case 'clothes': {
      lit('#fff6ea', 0.3);
      // a rail of hanging garments on the pavement
      const rw = Math.min(2.6, w - 0.8);
      for (const s of [-1, 1]) box(P, s * rw / 2, 0.75, 0, 0.05, 1.75, 0.05, C('#9e9e9e'));
      box(P, 0, 0.75, 1.7, rw, 0.04, 0.04, C('#9e9e9e'));
      for (let q = 0; q < 7; q++) box(P, -rw / 2 + 0.2 + q * (rw - 0.4) / 6, 0.75, 0.85, 0.36, 0.85, 0.05, GOODS[(q * 5) % GOODS.length]);
      break;
    }
    default:
      lit('#fff0cf', 0.25);
  }
}
