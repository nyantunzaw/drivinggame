// Procedural vehicle models modelled on what actually fills Yangon's streets:
// Probox taxis, 90s Mark II sedans, Hilux "lain-ka" line-cars, Hiace vans,
// YBS city buses, police sedans and sai-ka trishaws.
//
// Bodies are lofted: rounded cross-sections swept from nose to tail along the car's
// side profile (hood, roof and boot lines, wheel arches), narrowing in plan at the
// corners and toward the roof, with a curved glass cabin. Every vertex carries:
//   color, paint (1 = takes the per-instance paint colour),
//   surf  (0 paint, 1 glass, 2 chrome, 3 plastic, 4 lamp, 5 rubber),
//   lightKind (0 none, 1 headlight, 2 tail/brake, 3 red siren, 4 blue siren, 5 sign)
import * as THREE from 'three';

const S = { paint: 0, glass: 1, chrome: 2, plastic: 3, lamp: 4, rubber: 5 };

export const VEHICLE_TYPES = {
  taxi: {
    name: 'Probox Taxi', len: 4.2, wid: 1.69, hgt: 1.5, mass: 1150, power: 8.0, top: 44, grip: 1.0,
    wheelR: 0.3, axles: [1.32, -1.2], colors: ['#f2f2f0', '#e6e7e8', '#c9cccf'], taxi: true, weight: 4,
    seat: { x: -0.36, y: 0.55, z: -0.2, recline: 0.22 },
  },
  sedan: {
    name: 'Mark II', len: 4.76, wid: 1.76, hgt: 1.41, mass: 1350, power: 9.0, top: 52, grip: 1.02,
    wheelR: 0.31, axles: [1.45, -1.33], weight: 4,
    seat: { x: -0.38, y: 0.5, z: -0.18, recline: 0.25 },
    colors: ['#f0f0ee', '#e6e6e4', '#b9bcc0', '#2a2b2e', '#5a1a1f', '#1f3550', '#8d8f93', '#c9b99a', '#3d4a3f'],
  },
  hiace: {
    name: 'Hiace Van', len: 4.7, wid: 1.69, hgt: 1.98, mass: 1650, power: 6.8, top: 40, grip: 0.95,
    wheelR: 0.3, axles: [1.55, -1.05], colors: ['#f2f2f0', '#e8e8e6', '#c9cccf', '#9fa4a8'], weight: 2,
    seat: { x: -0.38, y: 0.95, z: 1.3, recline: 0.1 },
  },
  pickup: {
    name: 'Lain-Ka Pickup', len: 4.9, wid: 1.76, hgt: 2.05, mass: 1600, power: 6.8, top: 38, grip: 0.95,
    wheelR: 0.35, axles: [1.55, -1.45], colors: ['#2f6fb5', '#e8e8e8', '#b8352f', '#3a8a52', '#d9a03a', '#5a5f66'], weight: 2.5,
    seat: { x: -0.38, y: 0.85, z: -0.02, recline: 0.15 },
  },
  bus: {
    name: 'YBS Bus', len: 10.6, wid: 2.5, hgt: 3.15, mass: 9000, power: 4.6, top: 27, grip: 0.9,
    wheelR: 0.5, axles: [3.55, -2.65], colors: ['#c8262b', '#1f5fb8', '#e89a1a', '#2f8a4f', '#7a2f8a'], weight: 1.2,
  },
  sports: {
    name: 'Irrawaddy GT', len: 4.4, wid: 1.9, hgt: 1.2, mass: 1250, power: 14, top: 68, grip: 1.18,
    wheelR: 0.33, axles: [1.35, -1.3], colors: ['#ff3ea5', '#f4f4f4', '#38c8ff', '#ffc400', '#d62828'], weight: 0.35,
    seat: { x: -0.4, y: 0.3, z: -0.35, recline: 0.45, feet: [-0.1, 0.8] },
  },
  police: {
    name: 'Police Cruiser', len: 4.6, wid: 1.74, hgt: 1.46, mass: 1400, power: 11, top: 58, grip: 1.1,
    wheelR: 0.31, axles: [1.38, -1.28], colors: ['#f4f4f2'], police: true, weight: 0,
    seat: { x: -0.37, y: 0.5, z: -0.2, recline: 0.25 },
  },
  trishaw: {
    name: 'Sai-ka Trishaw', len: 2.0, wid: 1.5, hgt: 1.75, mass: 140, power: 1.5, top: 5.5, grip: 0.85,
    wheelR: 0.33, colors: ['#2f6fb5', '#3a8a52', '#b8352f', '#d9a03a', '#6b4fa0'], weight: 0, pedal: true,
    // the rider sits on the saddle leaning forward; pedals turn about the crank
    seat: { x: -0.38, y: 1.0, z: -0.24, recline: -0.45, bars: [1.12, 0.46], crank: [0.4, 0.06, 0.15] },
    wheels: [
      { x: -0.38, z: 0.62, r: 0.33, w: 0.05, steer: true },
      { x: -0.38, z: -0.5, r: 0.33, w: 0.05 },
      { x: 0.78, z: -0.08, r: 0.27, w: 0.07 },
    ],
  },
};
for (const d of Object.values(VEHICLE_TYPES)) {
  if (!d.wheels) {
    const x = d.wid / 2 - (d.wid > 2 ? 0.25 : 0.17);
    const w = d.wid > 2 ? 0.3 : 0.21;
    d.wheels = [
      { x, z: d.axles[0], r: d.wheelR, w, steer: true }, { x: -x, z: d.axles[0], r: d.wheelR, w, steer: true },
      { x, z: d.axles[1], r: d.wheelR, w }, { x: -x, z: d.axles[1], r: d.wheelR, w },
    ];
  }
}

const tmp = new THREE.Color();
const lin = (hex) => { tmp.set(hex); return [tmp.r, tmp.g, tmp.b]; };
let LOD = 0; // 1 while building the lighter versions drawn for distant traffic

// ---------------------------------------------------------------- mesh builder
const buf = () => ({ p: [], n: [], c: [], paint: [], surf: [], light: [] });

class Mesh {
  // two buffers: the opaque body, and see-through glass (drawn with a transparent material)
  constructor() { this.bufs = [buf(), buf()]; }

  // Append a non-indexed geometry, classifying each triangle with fn(face) -> {color, paint, surf, light, clear}
  add(geo, fn) {
    const P = geo.attributes.position.array, N = geo.attributes.normal.array;
    for (let i = 0; i < P.length; i += 9) {
      const cx = (P[i] + P[i + 3] + P[i + 6]) / 3, cy = (P[i + 1] + P[i + 4] + P[i + 7]) / 3, cz = (P[i + 2] + P[i + 5] + P[i + 8]) / 3;
      const ax = P[i + 3] - P[i], ay = P[i + 4] - P[i + 1], az = P[i + 5] - P[i + 2];
      const bx = P[i + 6] - P[i], by = P[i + 7] - P[i + 1], bz = P[i + 8] - P[i + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const a = fn({ cx, cy, cz, nx, ny, nz, i: i / 9 });
      const col = typeof a.color === 'string' ? lin(a.color) : a.color;
      const B = this.bufs[a.clear ? 1 : 0];
      for (let k = 0; k < 3; k++) {
        B.p.push(P[i + k * 3], P[i + k * 3 + 1], P[i + k * 3 + 2]);
        B.n.push(N[i + k * 3], N[i + k * 3 + 1], N[i + k * 3 + 2]);
        B.c.push(col[0], col[1], col[2]);
        B.paint.push(a.paint || 0);
        B.surf.push(a.surf || 0);
        B.light.push(a.light || 0);
      }
    }
  }

  // Part with uniform attributes, transformed by position / rotation / scale
  part(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, color = '#888', paint = 0, surf = S.plastic, light = 0, smooth = false } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (!smooth) g.computeVertexNormals();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
    this.add(g, () => ({ color, paint, surf, light }));
  }

  box(sx, sy, sz, opts) { this.part(new THREE.BoxGeometry(sx, sy, sz), opts); }

  // smooth ellipsoid (lamp lenses, mirrors, heads)
  ell(rx, ry, rz, opts, seg = 12) {
    if (LOD) seg = Math.max(6, seg >> 1);
    const g = new THREE.SphereGeometry(1, seg, Math.max(4, seg >> 1));
    this.part(g, { ...opts, sx: rx, sy: ry, sz: rz, smooth: true });
  }

  // rounded bar along x (bumpers, rails)
  bar(len, r, opts, seg = 8) {
    const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 2), LOD ? 1 : 3, LOD ? 5 : seg);
    g.rotateZ(Math.PI / 2);
    this.part(g, { ...opts, smooth: true });
  }

  // the body geometry; see-through glass, if any, rides along as userData.glass
  build() {
    const geo = (B) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
      g.setAttribute('paint', new THREE.Float32BufferAttribute(B.paint, 1));
      g.setAttribute('surf', new THREE.Float32BufferAttribute(B.surf, 1));
      g.setAttribute('lightKind', new THREE.Float32BufferAttribute(B.light, 1));
      g.computeBoundingSphere();
      return g;
    };
    const g = geo(this.bufs[0]);
    if (this.bufs[1].p.length) g.userData.glass = geo(this.bufs[1]);
    return g;
  }
}

// ---------------------------------------------------------------- lofting
const smoothstep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// Smooth (Catmull-Rom) curve through [z, y] keys, z ascending
function spline(keys) {
  const n = keys.length;
  return (z) => {
    if (z <= keys[0][0]) return keys[0][1];
    if (z >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 1;
    while (keys[i][0] < z) i++;
    const p0 = keys[Math.max(0, i - 2)], p1 = keys[i - 1], p2 = keys[i], p3 = keys[Math.min(n - 1, i + 1)];
    const dz = p2[0] - p1[0], t = (z - p1[0]) / dz;
    const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0] || 1)) * dz;
    const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0] || 1)) * dz;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
  };
}

// Superellipse cross-section (CCW seen from the front); taper(t) narrows it with height t in 0..1
function ring(hw, yb, yt, n, e, taper) {
  const pts = [];
  const yc = (yb + yt) / 2, hh = Math.max(0.002, (yt - yb) / 2);
  for (let k = 0; k < n; k++) {
    const th = (k / n) * Math.PI * 2;
    const c = Math.cos(th), s = Math.sin(th);
    const ux = Math.sign(c) * Math.pow(Math.abs(c), 2 / e);
    const uy = Math.sign(s) * Math.pow(Math.abs(s), 2 / e);
    pts.push([ux * hw * taper((uy + 1) / 2), yc + uy * hh]);
  }
  return pts;
}

// Tube through rings [{ z, pts }] (z ascending), capped, with smooth normals.
function loft(rings) {
  const n = rings[0].pts.length;
  const pos = [], idx = [];
  for (const r of rings) for (const [x, y] of r.pts) pos.push(x, y, r.z);
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let k = 0; k < n; k++) {
      const a = i * n + k, b = i * n + ((k + 1) % n), c = (i + 1) * n + ((k + 1) % n), d = (i + 1) * n + k;
      idx.push(a, b, c, a, c, d);
    }
  }
  const cap = (ri, front) => {
    let cx = 0, cy = 0;
    for (const [x, y] of rings[ri].pts) { cx += x; cy += y; }
    const c = pos.length / 3;
    pos.push(cx / n, cy / n, rings[ri].z);
    for (let k = 0; k < n; k++) {
      const a = ri * n + k, b = ri * n + ((k + 1) % n);
      if (front) idx.push(c, a, b); else idx.push(c, b, a);
    }
  };
  cap(rings.length - 1, true);
  cap(0, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

const DARK = '#141516', GLASS = '#0c1216', CHROME = '#c9cdd1', TRIM = '#1c1d1f', WHITE = '#ffffff';
const PAINT = { color: WHITE, paint: 1, surf: S.paint };
const GLASSF = { color: GLASS, surf: S.glass };
const CLEARF = { color: '#1c2a30', surf: S.glass, clear: 1 };  // tinted, see-through
const CABIN = '#36322e', SEATS = '#6e665d';  // dark dash and floor, grey-beige fabric seats
const INSIDE = { color: CABIN, surf: S.plastic };
const TRIMF = { color: TRIM, surf: S.plastic };

// A car body lofted from its profile: o.top = side-view keys of the shoulder / hood / boot line,
// o.gh = glasshouse (windscreen base zA, roof front zB, roof rear zC, rear-glass base zD).
function carBody(M, def, o) {
  const L = def.len, W = def.wid, h = L / 2;
  const R = def.wheelR + 0.065;
  const top = spline(o.top);
  const hw = (z) => {
    const e = h - Math.abs(z), rc = z > 0 ? o.cornerF : o.cornerR, nw = z > 0 ? o.noseW : o.tailW;
    const t = Math.min(1, Math.max(0, e / rc));
    return (W / 2) * (nw + (1 - nw) * Math.sqrt(1 - (1 - t) * (1 - t)));
  };
  const bot = (z) => {
    let y = o.clear + o.endLift * smoothstep((Math.abs(z) - (h - 0.6)) / 0.6);
    for (const a of def.axles) {
      const d = Math.abs(z - a);
      if (d < R) y = Math.max(y, def.wheelR + Math.sqrt(R * R - d * d) + 0.01);
    }
    return y;
  };
  const zs = [];
  for (let z = -h; z < h; z += LOD ? 0.32 : 0.11) zs.push(z);
  zs.push(h);
  const AK = LOD ? 3 : 8;
  for (const a of def.axles) for (let k = -AK; k <= AK; k++) zs.push(a + (k / AK) * R * 0.999);
  for (const e of LOD ? [0.04] : [0.015, 0.05, 0.1]) { zs.push(h - e, -h + e); }
  zs.sort((p, q) => p - q);
  const Z = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 0.012);
  const tum = o.tumble ?? 0.07;
  const taper = (t) => (t > 0.55 ? 1 - tum * ((t - 0.55) / 0.45) ** 2 : 1 - 0.05 * ((0.55 - t) / 0.55) ** 2);
  const RN = LOD ? 2 * Math.round((o.ring || 18) / 3) : o.ring || 18;
  const rings = Z.map((z) => ({ z, pts: ring(hw(z), bot(z), top(z), RN, o.ex || 4.2, taper) }));
  const g = o.gh;
  const bodyFn = o.bodyFn || ((f) => (f.ny < -0.55 ? { color: DARK, surf: S.rubber } : PAINT));
  // seen through the glass, the top of the body under the glasshouse is the cabin
  const cabin = (f) => g && !LOD && f.ny > 0.5 && f.cz > g.zD + 0.04 && f.cz < g.zA - 0.04 && Math.abs(f.cx) < 0.66 * hw(f.cz);
  M.add(loft(rings), (f) => (cabin(f) ? INSIDE : bodyFn(f)));

  const shape = { top, hw, bot, h };
  if (!g) return shape;
  const roof = spline([
    [g.zD, top(g.zD) - 0.03], [g.zD + (g.zC - g.zD) * 0.5, g.roofY - g.dropR * 0.55 - (g.roofY - top(g.zD)) * 0.35], [g.zC, g.roofY - g.dropR],
    [(g.zB + g.zC) / 2, g.roofY], [g.zB, g.roofY - g.dropF], [g.zB + (g.zA - g.zB) * 0.5, top(g.zA) + (g.roofY - top(g.zA)) * 0.52], [g.zA, top(g.zA) - 0.03],
  ]);
  const GN = LOD ? 12 : 24;
  const gz = [];
  for (let z = g.zD; z < g.zA; z += LOD ? 0.12 : 0.07) gz.push(z);
  gz.push(g.zA);
  const grings = gz.map((z) => {
    const yb = top(z) - 0.07, yt = Math.max(yb + 0.02, roof(z));
    const w0 = hw(z) * (1 - tum) * 0.99;
    return { z, pts: ring(w0, yb, yt, GN, g.ex || 3.2, (t) => 1 - (1 - g.topW) * t) };
  });
  shape.roof = roof;
  shape.ghW = (z, t) => hw(z) * (1 - tum) * 0.99 * (1 - (1 - g.topW) * t);
  // Faces are classified by where they sit around the cross-section: the sides are side
  // windows (with pillars as bands), the corner strip is the A / rear pillars, the top strip
  // is windscreen, roof and rear glass. Following whole mesh strips keeps the edges clean.
  const sideTris = (grings.length - 1) * GN * 2;
  const CLEAR = LOD ? GLASSF : CLEARF;
  M.add(loft(grings), (f) => {
    if (f.i >= sideTris) return TRIMF;
    const k = Math.floor(f.i / 2) % GN;
    const sn = Math.sin(((k + 0.5) / GN) * Math.PI * 2);
    if (sn < -0.5) return TRIMF; // below the beltline, inside the body
    const yb = top(f.cz) - 0.07, yt = Math.max(yb + 0.02, roof(f.cz));
    const t = Math.min(1, Math.max(0, (f.cy - yb) / (yt - yb)));
    if (Math.abs(sn) < 0.5) {
      if (t < 0.07) return TRIMF; // rubber window seal along the beltline
      for (const [z0, z1, kind] of g.bands || []) if (f.cz > z0 && f.cz < z1) return kind === 'paint' ? PAINT : TRIMF;
      return CLEAR;
    }
    if (f.ny > 0.78) return f.cy > g.roofY - 0.14 ? PAINT : TRIMF; // roof, or the cowl at the glass base
    if (sn < 0.72) return f.nz > 0 ? (g.aPillar === 'trim' ? TRIMF : PAINT) : (g.rearCorner === 'glass' ? CLEAR : PAINT);
    return CLEAR;
  });
  if (def.seat && !LOD) cabinFit(M, def, shape, g);
  return shape;
}

// Dashboard, steering wheel and seats, seen through the glass (right-hand drive).
function cabinFit(M, def, sh, g) {
  const st = def.seat;
  const belt = sh.top(st.z);
  const zDash = Math.min(g.zA - 0.12, st.z + 0.78);
  M.box(sh.hw(zDash) * 1.7, 0.2, 0.42, { y: sh.top(zDash) - 0.04, z: zDash, color: CABIN, surf: S.plastic });
  const wheel = new THREE.TorusGeometry(0.18, 0.02, 5, 16);
  M.part(wheel, { x: st.x, y: st.y + 0.42, z: st.z + 0.5, rx: 0.45, color: '#1a1918', surf: S.plastic });
  M.box(0.05, 0.05, 0.3, { x: st.x, y: st.y + 0.36, z: st.z + 0.64, rx: 0.45, color: '#1a1918', surf: S.plastic });
  for (const x of [st.x, -st.x]) {
    // seat back and headrest, reclined like the driver
    M.box(0.48, 0.62, 0.11, { x, y: st.y + 0.3, z: st.z - 0.17 - Math.sin(st.recline) * 0.3, rx: -st.recline, color: SEATS, surf: S.plastic });
    M.box(0.26, 0.17, 0.09, { x, y: st.y + 0.7 * Math.cos(st.recline), z: st.z - 0.15 - Math.sin(st.recline) * 0.7, rx: -st.recline, color: SEATS, surf: S.plastic });
  }
  // a rear bench where the glasshouse reaches back over it
  const zr = st.z - 0.95, rt = st.y + 0.5;
  if (zr > g.zD + 0.3 && rt < g.roofY - 0.3) {
    M.box(sh.hw(zr) * 1.55, Math.max(0.2, rt - belt + 0.2), 0.12, { y: (belt + rt) / 2 - 0.1, z: zr - 0.15, rx: -0.2, color: SEATS, surf: S.plastic });
  }
}

// Rounded lamp lenses at both ends; front = headlights, rear = tail/brake lights.
function lights(M, def, sh, { y, x, w, hh, rearY = y, rearX = x, rearW = w, rearH = hh }) {
  for (const sd of [-1, 1]) {
    M.ell(w / 2, hh / 2, 0.06, { x: sd * x, y, z: sh.h - 0.03, color: '#eef3f6', surf: S.lamp, light: 1 });
    M.ell(rearW / 2, rearH / 2, 0.05, { x: sd * rearX, y: rearY, z: -sh.h + 0.03, color: '#a3141a', surf: S.lamp, light: 2 });
  }
}

function plates(M, def, sh, yF, yR) {
  M.box(0.52, 0.13, 0.03, { y: yF, z: sh.h + 0.0, color: '#f1f1ea', surf: S.plastic });
  M.box(0.52, 0.13, 0.03, { y: yR, z: -sh.h - 0.0, color: '#f1f1ea', surf: S.plastic });
}

function bumpers(M, def, sh, { y, r = 0.1, color = '#2a2b2d', surf = S.plastic, paint = 0, rear = true, wF = 0.97 }) {
  M.bar(def.wid * wF, r, { y, z: sh.h - r * 0.55, color, surf, paint });
  if (rear) M.bar(def.wid * wF, r, { y, z: -sh.h + r * 0.55, color, surf, paint });
}

function mirrors(M, def, sh, z, y) {
  for (const sd of [-1, 1]) {
    const x = sd * (sh.hw(z) + 0.06);
    M.box(0.12, 0.03, 0.05, { x: sd * (sh.hw(z) - 0.0), y: y - 0.03, z, color: TRIM, surf: S.plastic });
    M.ell(0.075, 0.06, 0.045, { x, y, z, ...PAINT }, 10);
  }
}

function handles(M, def, sh, zs, y) {
  if (LOD) return;
  for (const sd of [-1, 1]) for (const z of zs) M.box(0.02, 0.03, 0.15, { x: sd * (sh.hw(z) + 0.002), y, z, color: CHROME, surf: S.chrome });
}

// Black sill strip between the wheel arches and a door seam per door edge.
function sides(M, def, sh, seams, y = 0.42) {
  const [zf, zr] = def.axles;
  const R = def.wheelR + 0.07;
  for (const sd of [-1, 1]) {
    M.box(0.03, 0.1, zf - zr - R * 2, { x: sd * (sh.hw(0) * 0.96 + 0.01), y, z: (zf + zr) / 2, color: TRIM, surf: S.plastic });
    if (!LOD) for (const z of seams) M.box(0.006, sh.top(z) - y - 0.12, 0.012, { x: sd * (sh.hw(z) + 0.004), y: (sh.top(z) + y) / 2 - 0.02, z, color: '#2a2a2a', surf: S.plastic });
  }
}

// ---------------------------------------------------------------- models
function sedan(def, { police = false } = {}) {
  const M = new Mesh();
  const h = def.len / 2;
  const sh = carBody(M, def, {
    top: [[-h, 0.62], [-h + 0.06, 0.84], [-h + 0.3, 0.97], [-1.5, 1.0], [-0.6, 0.99], [0.6, 0.96], [1.5, 0.89], [2.05, 0.82], [h - 0.08, 0.72], [h, 0.56]],
    clear: 0.27, endLift: 0.1, cornerF: 0.5, cornerR: 0.42, noseW: 0.64, tailW: 0.74, tumble: 0.06,
    gh: { zA: 0.98, zB: 0.2, zC: -0.9, zD: -1.52, roofY: 1.4, dropF: 0.03, dropR: 0.05, topW: 0.8, bands: [[-0.38, -0.27, 'trim'], [-1.6, -1.02, 'paint']] },
  });
  lights(M, def, sh, { y: 0.74, x: def.wid / 2 - 0.27, w: 0.4, hh: 0.13, rearY: 0.82, rearX: def.wid / 2 - 0.3, rearW: 0.5, rearH: 0.14 });
  M.box(def.wid * 0.38, 0.13, 0.04, { y: 0.68, z: h - 0.01, color: police ? DARK : CHROME, surf: police ? S.plastic : S.chrome });
  bumpers(M, def, sh, { y: 0.44, r: 0.09, color: police ? '#222' : WHITE, paint: police ? 0 : 1, surf: police ? S.plastic : S.paint });
  plates(M, def, sh, 0.52, 0.6);
  mirrors(M, def, sh, 0.85, 1.04);
  handles(M, def, sh, [0.22, -0.68], 0.9);
  sides(M, def, sh, [0.82, -0.3, -1.18]);
  for (const sd of [-1, 1]) M.box(0.012, 0.025, 2.4, { x: sd * (sh.hw(0) + 0.006), y: 0.98, z: -0.25, color: CHROME, surf: S.chrome });
  if (police) {
    M.box(1.12, 0.1, 0.3, { y: 1.44, z: -0.25, color: '#222', surf: S.plastic });
    M.ell(0.27, 0.07, 0.13, { x: -0.28, y: 1.52, z: -0.25, color: '#ff2a2a', surf: S.lamp, light: 3 });
    M.ell(0.27, 0.07, 0.13, { x: 0.28, y: 1.52, z: -0.25, color: '#2a4dff', surf: S.lamp, light: 4 });
    for (const sd of [-1, 1]) M.box(0.01, 0.15, def.len * 0.62, { x: sd * (sh.hw(0) + 0.007), y: 0.72, z: -0.1, color: '#1d4fb8', surf: S.paint });
    for (const sd of [-1, 1]) M.box(0.05, 0.28, 0.05, { x: sd * 0.32, y: 0.55, z: h + 0.1, color: DARK, surf: S.plastic });
    M.bar(0.75, 0.03, { y: 0.68, z: h + 0.1, color: DARK, surf: S.plastic });
  }
  return M.build();
}

function probox(def) {
  const M = new Mesh();
  const h = def.len / 2;
  const sh = carBody(M, def, {
    top: [[-h, 0.6], [-h + 0.03, 0.86], [-h + 0.12, 0.99], [-1.2, 1.0], [0.0, 0.99], [0.75, 0.97], [1.5, 0.9], [h - 0.1, 0.8], [h, 0.58]],
    clear: 0.27, endLift: 0.08, cornerF: 0.42, cornerR: 0.3, noseW: 0.66, tailW: 0.82, tumble: 0.05,
    gh: { zA: 0.82, zB: 0.12, zC: -1.82, zD: -h + 0.06, roofY: 1.48, dropF: 0.02, dropR: 0.03, topW: 0.86, rearCorner: 'paint',
      bands: [[-0.24, -0.14, 'trim'], [-1.3, -1.2, 'trim'], [-h, -1.92, 'paint']] },
  });
  lights(M, def, sh, { y: 0.76, x: def.wid / 2 - 0.25, w: 0.34, hh: 0.14, rearY: 0.88, rearX: def.wid / 2 - 0.12, rearW: 0.14, rearH: 0.3 });
  M.box(def.wid * 0.34, 0.12, 0.04, { y: 0.68, z: h - 0.01, color: DARK, surf: S.plastic });
  bumpers(M, def, sh, { y: 0.45, r: 0.11 });
  plates(M, def, sh, 0.5, 0.6);
  mirrors(M, def, sh, 0.7, 1.05);
  handles(M, def, sh, [0.18, -0.78], 0.9);
  sides(M, def, sh, [0.7, -0.2, -1.25]);
  // roof rails and the illuminated TAXI sign
  for (const sd of [-1, 1]) M.bar(1.7, 0.025, { x: sd * 0.56, y: 1.51, z: -0.6, ry: Math.PI / 2, color: TRIM, surf: S.plastic });
  M.box(0.6, 0.2, 0.22, { y: 1.6, z: -0.35, color: '#ffd400', surf: S.lamp, light: 5 });
  return M.build();
}

function hiace(def) {
  const M = new Mesh();
  const h = def.len / 2;
  const sh = carBody(M, def, {
    top: [[-h, 0.58], [-h + 0.03, 0.9], [-h + 0.12, 1.0], [1.6, 1.02], [h - 0.25, 0.97], [h - 0.06, 0.84], [h, 0.6]],
    clear: 0.27, endLift: 0.06, cornerF: 0.36, cornerR: 0.25, noseW: 0.72, tailW: 0.85, tumble: 0.03,
    gh: { zA: h - 0.18, zB: h - 0.75, zC: -h + 0.12, zD: -h + 0.04, roofY: 1.97, dropF: 0.03, dropR: 0.02, topW: 0.92, ex: 4, rearCorner: 'paint', aPillar: 'paint',
      bands: [[1.05, 1.18, 'paint'], [0.12, 0.24, 'paint'], [-0.95, -0.83, 'paint'], [-1.95, -1.82, 'paint'], [-h, -2.25, 'paint']] },
  });
  lights(M, def, sh, { y: 0.86, x: def.wid / 2 - 0.25, w: 0.32, hh: 0.17, rearY: 0.95, rearX: def.wid / 2 - 0.1, rearW: 0.13, rearH: 0.32 });
  M.box(def.wid * 0.44, 0.17, 0.04, { y: 0.74, z: h - 0.01, color: CHROME, surf: S.chrome });
  bumpers(M, def, sh, { y: 0.45, r: 0.11 });
  plates(M, def, sh, 0.52, 0.6);
  mirrors(M, def, sh, h - 0.45, 1.18);
  for (const sd of [-1, 1]) M.box(0.012, 0.03, 0.9, { x: sd * (sh.hw(0) + 0.01), y: 1.02, z: -0.4, color: TRIM, surf: S.plastic }); // sliding door rail
  sides(M, def, sh, [1.1, 0.2, -0.85]);
  return M.build();
}

function pickup(def) {
  const M = new Mesh();
  const h = def.len / 2;
  const sh = carBody(M, def, {
    top: [[-h, 0.74], [-h + 0.03, 1.02], [-h + 0.12, 1.07], [-0.5, 1.08], [0.6, 1.1], [1.6, 1.05], [h - 0.15, 0.97], [h, 0.66]],
    clear: 0.42, endLift: 0.05, cornerF: 0.4, cornerR: 0.15, noseW: 0.7, tailW: 0.95, tumble: 0.04,
    gh: { zA: 0.92, zB: 0.42, zC: -0.32, zD: -0.44, roofY: 1.8, dropF: 0.02, dropR: 0.01, topW: 0.86, rearCorner: 'paint', bands: [[0.0, 0.1, 'trim']] },
  });
  lights(M, def, sh, { y: 0.88, x: def.wid / 2 - 0.26, w: 0.38, hh: 0.16, rearY: 0.92, rearX: def.wid / 2 - 0.09, rearW: 0.12, rearH: 0.3 });
  M.box(def.wid * 0.48, 0.2, 0.04, { y: 0.8, z: h - 0.01, color: CHROME, surf: S.chrome });
  M.bar(def.wid * 0.98, 0.1, { y: 0.55, z: h - 0.05, color: '#2a2b2d', surf: S.plastic });
  M.bar(def.wid * 1.0, 0.08, { y: 0.5, z: -h - 0.02, color: CHROME, surf: S.chrome });
  plates(M, def, sh, 0.62, 0.66);
  mirrors(M, def, sh, 0.9, 1.25);
  handles(M, def, sh, [0.2], 1.0);
  sides(M, def, sh, [0.9, -0.42], 0.55);
  // Yangon "lain-ka": benches and a roof canopy over the bed, grab rails, rear step
  const bedL = h - 0.5, bedZ = (-h + -0.45) / 2;
  M.box(def.wid * 0.9, 0.03, bedL + 0.4, { y: 1.09, z: bedZ, color: '#3b3b3b', surf: S.rubber });
  for (const sd of [-1, 1]) {
    M.box(0.32, 0.08, bedL, { x: sd * (def.wid / 2 - 0.25), y: 1.38, z: bedZ, color: '#6b4a2e', surf: S.plastic });
    M.box(0.05, 0.3, bedL, { x: sd * (def.wid / 2 - 0.08), y: 1.52, z: bedZ, color: '#6b4a2e', surf: S.plastic });
    for (const z of [-h + 0.08, bedZ, -0.52]) M.part(new THREE.CylinderGeometry(0.025, 0.025, 0.98, 8), { x: sd * (def.wid / 2 - 0.05), y: 1.57, z, color: CHROME, surf: S.chrome });
    M.bar(bedL + 0.4, 0.022, { x: sd * (def.wid / 2 - 0.05), y: 1.82, z: bedZ, ry: Math.PI / 2, color: CHROME, surf: S.chrome });
  }
  M.box(def.wid * 1.02, 0.06, bedL + 0.55, { y: 2.07, z: bedZ, ...PAINT });
  M.box(def.wid * 0.6, 0.05, 0.32, { y: 0.56, z: -h - 0.2, color: CHROME, surf: S.chrome });
  return M.build();
}

function sports(def) {
  const M = new Mesh();
  const h = def.len / 2;
  const sh = carBody(M, def, {
    top: [[-h, 0.58], [-h + 0.05, 0.82], [-h + 0.3, 0.93], [-1.3, 0.95], [-0.3, 0.88], [0.6, 0.79], [1.5, 0.66], [h - 0.12, 0.56], [h, 0.42]],
    clear: 0.22, endLift: 0.06, cornerF: 0.55, cornerR: 0.45, noseW: 0.58, tailW: 0.7, tumble: 0.1, ex: 3.8,
    gh: { zA: 0.72, zB: -0.05, zC: -0.7, zD: -1.55, roofY: 1.18, dropF: 0.03, dropR: 0.06, topW: 0.72, ex: 2.8, bands: [[-1.6, -1.0, 'paint']] },
  });
  lights(M, def, sh, { y: 0.6, x: def.wid / 2 - 0.32, w: 0.46, hh: 0.08, rearY: 0.8, rearX: def.wid / 2 - 0.35, rearW: 0.58, rearH: 0.08 });
  M.box(def.wid * 0.92, 0.04, 0.32, { y: 1.08, z: -h + 0.22, color: TRIM, surf: S.plastic });
  for (const sd of [-1, 1]) {
    M.box(0.05, 0.16, 0.05, { x: sd * 0.6, y: 0.98, z: -h + 0.25, color: TRIM, surf: S.plastic });
    M.box(0.02, 0.12, 0.45, { x: sd * (sh.hw(-0.75) + 0.005), y: 0.62, z: -0.75, color: DARK, surf: S.plastic }); // side intake
  }
  M.box(def.wid * 0.6, 0.1, 0.05, { y: 0.4, z: h - 0.03, color: DARK, surf: S.plastic });
  plates(M, def, sh, 0.42, 0.6);
  mirrors(M, def, sh, 0.55, 0.95);
  sides(M, def, sh, [0.6, -0.65], 0.34);
  return M.build();
}

function bus(def) {
  const M = new Mesh();
  const h = def.len / 2;
  const sh = carBody(M, def, {
    top: [[-h, 2.95], [-h + 0.12, 3.1], [h - 0.12, 3.1], [h, 2.95]],
    clear: 0.42, endLift: 0.04, cornerF: 0.28, cornerR: 0.22, noseW: 0.86, tailW: 0.88, tumble: 0.02, ex: 9, ring: 22,
    bodyFn: (f) => {
      if (f.ny < -0.55) return { color: DARK, surf: S.rubber };
      if (f.ny > 0.8) return { color: '#e6e6e4', surf: S.paint };
      if (f.cy < 0.9) return { color: '#f2f2f0', surf: S.paint };
      return PAINT;
    },
  });
  const W2 = sh.hw(0);
  for (const sd of [-1, 1]) {
    M.box(0.02, 1.05, def.len - 1.7, { x: sd * (W2 + 0.006), y: 2.15, z: -0.4, color: GLASS, surf: S.glass });
    for (let z = -h + 0.6; z < h - 1.0; z += 1.25) M.box(0.03, 1.05, 0.09, { x: sd * (W2 + 0.012), y: 2.15, z, color: TRIM, surf: S.plastic });
    M.box(0.015, 0.1, def.len - 0.4, { x: sd * (W2 + 0.006), y: 1.0, z: 0, color: '#f2f2f0', surf: S.paint });
  }
  for (const z of [h - 1.35, -0.6]) M.box(0.03, 2.05, 1.0, { x: -(W2 + 0.01), y: 1.55, z, color: '#1b2329', surf: S.glass });
  M.box(def.wid * 0.86, 1.45, 0.03, { y: 2.05, z: h + 0.0, color: GLASS, surf: S.glass });
  M.box(def.wid * 0.86, 0.95, 0.03, { y: 2.3, z: -h - 0.0, color: GLASS, surf: S.glass });
  M.box(def.wid * 0.66, 0.25, 0.04, { y: 2.92, z: h + 0.01, color: '#ffb000', surf: S.lamp, light: 5 });
  M.bar(def.wid * 0.98, 0.15, { y: 0.62, z: h - 0.05, color: '#2a2b2d', surf: S.plastic });
  M.bar(def.wid * 0.98, 0.15, { y: 0.62, z: -h + 0.05, color: '#2a2b2d', surf: S.plastic });
  lights(M, def, sh, { y: 1.0, x: def.wid / 2 - 0.32, w: 0.34, hh: 0.17, rearY: 1.25, rearX: def.wid / 2 - 0.2, rearW: 0.18, rearH: 0.4 });
  M.box(def.wid * 0.6, 0.28, 0.6, { y: 3.24, z: -1.8, color: '#d4d6d8', surf: S.plastic }); // roof AC
  for (const sd of [-1, 1]) {
    M.box(0.05, 0.05, 0.5, { x: sd * (def.wid / 2 + 0.2), y: 2.6, z: h - 0.15, color: TRIM, surf: S.plastic });
    M.ell(0.05, 0.18, 0.1, { x: sd * (def.wid / 2 + 0.44), y: 2.4, z: h + 0.08, color: TRIM, surf: S.plastic });
  }
  plates(M, def, sh, 0.85, 0.92);
  return M.build();
}

// Rider for the trishaw: smooth limbs (same proportions as the pedestrians)
function trishaw(def) {
  const M = new Mesh();
  const bx = -0.38; // bicycle line (sidecar on the rider's right)
  const frame = { color: '#2a2b2d', surf: S.plastic };
  const tube = (x, y, z, L, rx, r = 0.022) => M.part(new THREE.CylinderGeometry(r, r, L, 8), { x, y, z, rx, ...frame });
  tube(bx, 0.62, 0.06, 1.05, Math.PI / 2);
  tube(bx, 0.64, -0.2, 0.5, 0.2);
  tube(bx, 0.7, 0.56, 0.75, -0.25);
  M.bar(0.55, 0.018, { x: bx, y: 1.12, z: 0.46, color: CHROME, surf: S.chrome });
  M.ell(0.1, 0.04, 0.14, { x: bx, y: 0.92, z: -0.24, color: '#1a1a1a', surf: S.rubber });   // saddle
  // chainring and pedal cranks (the rider is a person, drawn with the pedestrians)
  M.part(new THREE.CylinderGeometry(0.1, 0.1, 0.012, 14).rotateZ(Math.PI / 2), { x: bx + 0.05, y: 0.4, z: 0.06, color: '#3a3b3d', surf: S.chrome });
  M.box(0.2, 0.025, 0.025, { x: bx, y: 0.4, z: 0.06, color: '#2a2b2d', surf: S.plastic });
  // sidecar: painted tub with back-to-back seats and a canopy
  const sc = 0.45;
  M.box(0.66, 0.14, 1.15, { x: sc, y: 0.48, z: -0.05, ...PAINT });
  M.box(0.66, 0.3, 0.05, { x: sc, y: 0.7, z: 0.5, ...PAINT });
  M.box(0.05, 0.28, 1.15, { x: sc + 0.32, y: 0.68, z: -0.05, ...PAINT });
  M.box(0.58, 0.1, 0.42, { x: sc, y: 0.62, z: 0.22, color: '#b8352f', surf: S.plastic });
  M.box(0.58, 0.1, 0.42, { x: sc, y: 0.62, z: -0.32, color: '#b8352f', surf: S.plastic });
  M.box(0.58, 0.4, 0.05, { x: sc, y: 0.88, z: -0.05, color: '#b8352f', surf: S.plastic });
  for (const z of [0.45, -0.55]) M.part(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), { x: sc + 0.3, y: 1.1, z, color: CHROME, surf: S.chrome });
  M.box(0.7, 0.04, 1.15, { x: sc + 0.05, y: 1.56, z: -0.05, ...PAINT });
  tube((bx + sc) / 2, 0.42, -0.05, 0.9, Math.PI / 2, 0.025);
  M.ell(0.05, 0.05, 0.04, { x: bx, y: 0.75, z: 0.92, color: '#eef2f4', surf: S.lamp, light: 1 });
  return M.build();
}

export function buildVehicleGeometries(lod = 0) {
  const T = VEHICLE_TYPES;
  LOD = lod ? 1 : 0;
  try {
    return build(T);
  } finally {
    LOD = 0;
  }
}
function build(T) {
  return {
    taxi: probox(T.taxi),
    sedan: sedan(T.sedan),
    hiace: hiace(T.hiace),
    pickup: pickup(T.pickup),
    bus: bus(T.bus),
    sports: sports(T.sports),
    police: sedan(T.police, { police: true }),
    trishaw: trishaw(T.trishaw),
  };
}

// Unit wheel (radius 1, width 1) along x: rounded tyre with a 5-spoke alloy facing +x.
export function wheelGeometry(lod = 0) {
  const M = new Mesh();
  const sg = lod ? 8 : 14;
  const prof = [[0.62, -0.5], [0.9, -0.5], [0.99, -0.38], [1.0, -0.2], [1.0, 0.2], [0.99, 0.38], [0.9, 0.5], [0.62, 0.5]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const tyre = new THREE.LatheGeometry(lod ? [prof[0], prof[1], prof[3], prof[4], prof[6], prof[7]] : prof, sg);
  tyre.rotateZ(-Math.PI / 2);
  M.part(tyre, { color: '#161616', surf: S.rubber });
  const rim = new THREE.CylinderGeometry(0.62, 0.62, 0.08, sg, 1);
  rim.rotateZ(Math.PI / 2);
  M.part(rim, { x: 0.36, color: '#9ea3a8', surf: S.chrome });
  M.part(new THREE.CylinderGeometry(0.6, 0.6, 0.06, sg).rotateZ(Math.PI / 2), { x: -0.36, color: '#2b2b2b', surf: S.plastic });
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const sp = new THREE.BoxGeometry(0.06, 0.5, 0.13);
    sp.translate(0, 0.3, 0);
    sp.rotateX(a);
    M.part(sp, { x: 0.42, color: '#c4c8cc', surf: S.chrome });
  }
  M.part(new THREE.CylinderGeometry(0.16, 0.16, 0.1, 10).rotateZ(Math.PI / 2), { x: 0.44, color: '#d4d8dc', surf: S.chrome });
  return M.build();
}
