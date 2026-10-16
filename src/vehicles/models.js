// Procedural vehicle models modelled on what actually fills Yangon's streets:
// Probox taxis, 90s Mark II sedans, Hilux "lain-ka" line-cars, Hiace vans,
// YBS city buses, police sedans and sai-ka trishaws.
//
// Bodies are side profiles (with real wheel arches) extruded across the width with
// rounded edges, plus a narrower glass cabin. Every vertex carries:
//   color, paint (1 = takes the per-instance paint colour),
//   surf  (0 paint, 1 glass, 2 chrome, 3 plastic, 4 lamp, 5 rubber),
//   lightKind (0 none, 1 headlight, 2 tail/brake, 3 red siren, 4 blue siren, 5 sign)
import * as THREE from 'three';

const S = { paint: 0, glass: 1, chrome: 2, plastic: 3, lamp: 4, rubber: 5 };

export const VEHICLE_TYPES = {
  taxi: {
    name: 'Probox Taxi', len: 4.2, wid: 1.69, hgt: 1.5, mass: 1150, power: 8.0, top: 44, grip: 1.0,
    wheelR: 0.3, axles: [1.32, -1.2], colors: ['#f2f2f0', '#e6e7e8', '#c9cccf'], taxi: true, weight: 4,
  },
  sedan: {
    name: 'Mark II', len: 4.76, wid: 1.76, hgt: 1.41, mass: 1350, power: 9.0, top: 52, grip: 1.02,
    wheelR: 0.31, axles: [1.45, -1.33], weight: 4,
    colors: ['#f0f0ee', '#e6e6e4', '#b9bcc0', '#2a2b2e', '#5a1a1f', '#1f3550', '#8d8f93', '#c9b99a', '#3d4a3f'],
  },
  hiace: {
    name: 'Hiace Van', len: 4.7, wid: 1.69, hgt: 1.98, mass: 1650, power: 6.8, top: 40, grip: 0.95,
    wheelR: 0.3, axles: [1.55, -1.05], colors: ['#f2f2f0', '#e8e8e6', '#c9cccf', '#9fa4a8'], weight: 2,
  },
  pickup: {
    name: 'Lain-Ka Pickup', len: 4.9, wid: 1.76, hgt: 2.05, mass: 1600, power: 6.8, top: 38, grip: 0.95,
    wheelR: 0.35, axles: [1.55, -1.45], colors: ['#2f6fb5', '#e8e8e8', '#b8352f', '#3a8a52', '#d9a03a', '#5a5f66'], weight: 2.5,
  },
  bus: {
    name: 'YBS Bus', len: 10.6, wid: 2.5, hgt: 3.15, mass: 9000, power: 4.6, top: 27, grip: 0.9,
    wheelR: 0.5, axles: [3.55, -2.65], colors: ['#c8262b', '#1f5fb8', '#e89a1a', '#2f8a4f', '#7a2f8a'], weight: 1.2,
  },
  sports: {
    name: 'Irrawaddy GT', len: 4.4, wid: 1.9, hgt: 1.2, mass: 1250, power: 14, top: 68, grip: 1.18,
    wheelR: 0.33, axles: [1.35, -1.3], colors: ['#ff3ea5', '#f4f4f4', '#38c8ff', '#ffc400', '#d62828'], weight: 0.35,
  },
  police: {
    name: 'Police Cruiser', len: 4.6, wid: 1.74, hgt: 1.46, mass: 1400, power: 11, top: 58, grip: 1.1,
    wheelR: 0.31, axles: [1.38, -1.28], colors: ['#f4f4f2'], police: true, weight: 0,
  },
  trishaw: {
    name: 'Sai-ka Trishaw', len: 2.0, wid: 1.5, hgt: 1.75, mass: 140, power: 1.5, top: 5.5, grip: 0.85,
    wheelR: 0.33, colors: ['#2f6fb5', '#3a8a52', '#b8352f', '#d9a03a', '#6b4fa0'], weight: 0, pedal: true,
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

// ---------------------------------------------------------------- mesh builder
class Mesh {
  constructor() { this.p = []; this.n = []; this.c = []; this.paint = []; this.surf = []; this.light = []; }

  // Append a non-indexed geometry, classifying each triangle with fn(face) -> {color, paint, surf, light}
  add(geo, fn) {
    const P = geo.attributes.position.array, N = geo.attributes.normal.array;
    for (let i = 0; i < P.length; i += 9) {
      const cx = (P[i] + P[i + 3] + P[i + 6]) / 3, cy = (P[i + 1] + P[i + 4] + P[i + 7]) / 3, cz = (P[i + 2] + P[i + 5] + P[i + 8]) / 3;
      // face normal from geometry
      const ax = P[i + 3] - P[i], ay = P[i + 4] - P[i + 1], az = P[i + 5] - P[i + 2];
      const bx = P[i + 6] - P[i], by = P[i + 7] - P[i + 1], bz = P[i + 8] - P[i + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const a = fn({ cx, cy, cz, nx, ny, nz });
      const col = typeof a.color === 'string' ? lin(a.color) : a.color;
      for (let k = 0; k < 3; k++) {
        this.p.push(P[i + k * 3], P[i + k * 3 + 1], P[i + k * 3 + 2]);
        this.n.push(N[i + k * 3], N[i + k * 3 + 1], N[i + k * 3 + 2]);
        this.c.push(col[0], col[1], col[2]);
        this.paint.push(a.paint || 0);
        this.surf.push(a.surf || 0);
        this.light.push(a.light || 0);
      }
    }
  }

  // Simple part with uniform attributes; geometry is transformed by (x,y,z,rx,ry,rz)
  part(geo, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, color = '#888', paint = 0, surf = S.plastic, light = 0 } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
    this.add(g, () => ({ color, paint, surf, light }));
  }

  box(sx, sy, sz, opts) { this.part(new THREE.BoxGeometry(sx, sy, sz), opts); }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('paint', new THREE.Float32BufferAttribute(this.paint, 1));
    g.setAttribute('surf', new THREE.Float32BufferAttribute(this.surf, 1));
    g.setAttribute('lightKind', new THREE.Float32BufferAttribute(this.light, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// Smooth normals across shallow angles, keep hard edges (non-indexed geometry).
function creaseNormals(geo, deg = 38) {
  const P = geo.attributes.position.array;
  const n = P.length / 3;
  const fn = new Float32Array(n);
  const faceN = [];
  for (let i = 0; i < n; i += 3) {
    const ax = P[i * 3 + 3] - P[i * 3], ay = P[i * 3 + 4] - P[i * 3 + 1], az = P[i * 3 + 5] - P[i * 3 + 2];
    const bx = P[i * 3 + 6] - P[i * 3], by = P[i * 3 + 7] - P[i * 3 + 1], bz = P[i * 3 + 8] - P[i * 3 + 2];
    let x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx;
    const l = Math.hypot(x, y, z) || 1;
    faceN.push(x / l, y / l, z / l);
  }
  void fn;
  const groups = new Map();
  const key = (i) => `${Math.round(P[i * 3] * 1000)},${Math.round(P[i * 3 + 1] * 1000)},${Math.round(P[i * 3 + 2] * 1000)}`;
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let g = groups.get(k);
    if (!g) { g = []; groups.set(k, g); }
    g.push(i);
  }
  const cos = Math.cos((deg * Math.PI) / 180);
  const out = new Float32Array(n * 3);
  for (const g of groups.values()) {
    for (const i of g) {
      const f = Math.floor(i / 3) * 3;
      const ax = faceN[f], ay = faceN[f + 1], az = faceN[f + 2];
      let sx = 0, sy = 0, sz = 0;
      for (const j of g) {
        const h = Math.floor(j / 3) * 3;
        const d = ax * faceN[h] + ay * faceN[h + 1] + az * faceN[h + 2];
        if (d >= cos) { sx += faceN[h]; sy += faceN[h + 1]; sz += faceN[h + 2]; }
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      out[i * 3] = sx / l; out[i * 3 + 1] = sy / l; out[i * 3 + 2] = sz / l;
    }
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return geo;
}

// Side silhouette: `top` runs rear -> front as [s, y]; the bottom edge gets wheel arches.
function sideShape(top, bottomY, arches) {
  const sh = new THREE.Shape();
  sh.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i < top.length; i++) sh.lineTo(top[i][0], top[i][1]);
  const front = top[top.length - 1][0], rear = top[0][0];
  sh.lineTo(front - 0.04, bottomY);
  const arcs = arches.slice().sort((a, b) => b.s - a.s);
  for (const a of arcs) {
    const y0 = Math.max(bottomY, a.cy);
    sh.lineTo(a.s + a.r, y0);
    const steps = 9;
    for (let k = 1; k <= steps; k++) {
      const t = (k / steps) * Math.PI;
      sh.lineTo(a.s + Math.cos(t) * a.r, a.cy + Math.sin(t) * a.r);
    }
    sh.lineTo(a.s - a.r, bottomY);
  }
  sh.lineTo(rear + 0.04, bottomY);
  sh.closePath();
  return sh;
}

// Extrude a side silhouette across the car (x = lateral, z = forward) with rounded edges.
function extrudeSide(shape, width, bevel) {
  const depth = Math.max(0.01, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 6 });
  const geo = g.index ? g.toNonIndexed() : g;
  const P = geo.attributes.position.array;
  for (let i = 0; i < P.length; i += 3) {
    const sx = P[i], y = P[i + 1], z = P[i + 2];
    P[i] = z - depth / 2; P[i + 1] = y; P[i + 2] = sx;
  }
  // axis swap mirrors the mesh: flip winding back
  for (let i = 0; i < P.length; i += 9) {
    for (let k = 0; k < 3; k++) { const t = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = t; }
  }
  geo.attributes.position.needsUpdate = true;
  creaseNormals(geo, 36);
  return geo;
}

const DARK = '#141516', GLASS = '#0c1216', CHROME = '#c9cdd1', TRIM = '#1c1d1f', WHITE = '#ffffff';

function bodyFn(def, opts = {}) {
  const half = def.len / 2;
  return (f) => {
    if (f.ny < -0.45) return { color: DARK, surf: S.rubber };
    // the flat side panels are big fan triangles: always paint them, trim goes on as separate parts
    if (Math.abs(f.nx) > 0.7) return { color: WHITE, paint: 1, surf: S.paint };
    if (opts.plasticBumpers && f.cy < (opts.bumperTop || 0.62) && Math.abs(f.cz) > half - 0.3) return { color: '#2a2b2d', surf: S.plastic };
    return { color: WHITE, paint: 1, surf: S.paint };
  };
}

function cabinFn(opts = {}) {
  return (f) => {
    if (f.ny > (opts.roofNy || 0.72)) return { color: WHITE, paint: 1, surf: S.paint };
    if (f.ny < -0.3) return { color: TRIM, surf: S.plastic };
    return { color: GLASS, surf: S.glass };
  };
}

function lamps(M, def, { y, front = true, rear = true, w = 0.34, h = 0.14, inset = 0.25, tailW = 0.3, tailY } = {}) {
  const half = def.len / 2;
  for (const sx of [-1, 1]) {
    if (front) M.box(w, h, 0.08, { x: sx * (def.wid / 2 - inset), y, z: half - 0.02, color: '#eef2f4', surf: S.lamp, light: 1 });
    if (rear) M.box(tailW, h + 0.04, 0.07, { x: sx * (def.wid / 2 - inset + 0.02), y: tailY ?? y, z: -half + 0.02, color: '#a3141a', surf: S.lamp, light: 2 });
  }
}

function plates(M, def, yF, yR) {
  const half = def.len / 2;
  M.box(0.52, 0.13, 0.03, { y: yF, z: half + 0.01, color: '#f1f1ea', surf: S.plastic });
  M.box(0.52, 0.13, 0.03, { y: yR, z: -half - 0.01, color: '#f1f1ea', surf: S.plastic });
}

function mirrors(M, def, z, y) {
  for (const sx of [-1, 1]) M.box(0.16, 0.12, 0.07, { x: sx * (def.wid / 2 + 0.08), y, z, color: WHITE, paint: 1, surf: S.paint });
}

function handles(M, def, zs, y) {
  for (const sx of [-1, 1]) for (const z of zs) M.box(0.02, 0.03, 0.16, { x: sx * (def.wid / 2 + 0.005), y, z, color: CHROME, surf: S.chrome });
}

function bPillar(M, cabW, z, y0, y1) {
  for (const sx of [-1, 1]) M.box(0.025, y1 - y0, 0.07, { x: sx * (cabW / 2 + 0.003), y: (y0 + y1) / 2, z, color: TRIM, surf: S.plastic });
}

// Black rocker strip between the wheel arches.
function sills(M, def, y = 0.36) {
  const [zf, zr] = def.axles;
  const a = def.wheelR + 0.1;
  const len = zf - zr - a * 2;
  for (const sx of [-1, 1]) M.box(0.03, 0.12, len, { x: sx * (def.wid / 2 + 0.003), y, z: (zf + zr) / 2, color: TRIM, surf: S.plastic });
}

// Wrap-around bumper at both ends.
function bumpers(M, def, { y = 0.45, h = 0.22, color = '#2a2b2d', surf = S.plastic, d = 0.16 } = {}) {
  const half = def.len / 2;
  for (const s of [1, -1]) {
    M.box(def.wid * 1.0, h, d, { y, z: s * (half - d / 2 + 0.05), color, surf });
    for (const sx of [-1, 1]) M.box(0.04, h, 0.42, { x: sx * (def.wid / 2 - 0.0), y, z: s * (half - 0.22), color, surf });
  }
}

function arches(def) {
  return def.axles.map((s) => ({ s, cy: def.wheelR + 0.01, r: def.wheelR + 0.07 }));
}

// ---------------------------------------------------------------- models
function sedan(def, { police = false } = {}) {
  const M = new Mesh();
  const h = def.len / 2;
  const body = sideShape([
    [-h + 0.02, 0.38], [-h, 0.62], [-h + 0.05, 0.86], [-h + 0.22, 0.98], [-1.4, 1.02], [0.95, 0.98], [1.95, 0.87], [h - 0.06, 0.78], [h, 0.56], [h - 0.04, 0.36],
  ], 0.3, arches(def));
  M.add(extrudeSide(body, def.wid, 0.09), bodyFn(def));
  sills(M, def);
  const cab = sideShape([[-1.48, 0.95], [-0.85, 1.36], [0.22, 1.4], [0.98, 0.95]], 0.9, []);
  const cabW = def.wid * 0.86;
  M.add(extrudeSide(cab, cabW, 0.07), cabinFn());
  bPillar(M, cabW, -0.32, 0.98, 1.36);
  lamps(M, def, { y: 0.72, w: 0.36, h: 0.12, inset: 0.24, tailW: 0.5, tailY: 0.8 });
  M.box(def.wid * 0.38, 0.13, 0.05, { y: 0.66, z: h + 0.0, color: police ? DARK : CHROME, surf: police ? S.plastic : S.chrome });
  M.box(def.wid * 0.97, 0.1, 0.1, { y: 0.4, z: h - 0.03, color: TRIM, surf: S.plastic });
  M.box(def.wid * 0.97, 0.1, 0.1, { y: 0.42, z: -h + 0.03, color: TRIM, surf: S.plastic });
  plates(M, def, 0.5, 0.62);
  mirrors(M, def, 0.86, 1.03);
  handles(M, def, [0.25, -0.62], 0.88);
  for (const sx of [-1, 1]) M.box(0.02, 0.03, 2.3, { x: sx * (def.wid / 2 + 0.004), y: 0.97, z: -0.25, color: CHROME, surf: S.chrome });
  if (police) {
    M.box(1.1, 0.12, 0.3, { y: 1.47, z: -0.2, color: '#222', surf: S.plastic });
    M.box(0.5, 0.11, 0.28, { x: -0.28, y: 1.56, z: -0.2, color: '#ff2a2a', surf: S.lamp, light: 3 });
    M.box(0.5, 0.11, 0.28, { x: 0.28, y: 1.56, z: -0.2, color: '#2a4dff', surf: S.lamp, light: 4 });
    for (const sx of [-1, 1]) M.box(0.015, 0.16, def.len * 0.7, { x: sx * (def.wid / 2 + 0.012), y: 0.72, z: -0.05, color: '#1d4fb8', surf: S.paint });
    for (const sx of [-1, 1]) M.box(0.05, 0.3, 0.05, { x: sx * 0.32, y: 0.55, z: h + 0.1, color: DARK, surf: S.plastic });
    M.box(0.75, 0.05, 0.05, { y: 0.66, z: h + 0.1, color: DARK, surf: S.plastic });
  }
  return M.build();
}

function probox(def) {
  const M = new Mesh();
  const h = def.len / 2;
  const body = sideShape([
    [-h + 0.02, 0.38], [-h, 0.62], [-h + 0.03, 0.96], [-h + 0.08, 1.0], [0.78, 0.98], [1.62, 0.89], [h - 0.05, 0.79], [h, 0.56], [h - 0.04, 0.36],
  ], 0.3, arches(def));
  M.add(extrudeSide(body, def.wid, 0.08), bodyFn(def, { plasticBumpers: true, bumperTop: 0.6 }));
  sills(M, def);
  bumpers(M, def, { y: 0.47, h: 0.24 });
  const cab = sideShape([[-h + 0.05, 0.95], [-h + 0.12, 1.47], [0.18, 1.5], [0.82, 0.95]], 0.9, []);
  const cabW = def.wid * 0.88;
  M.add(extrudeSide(cab, cabW, 0.06), cabinFn());
  bPillar(M, cabW, -0.18, 0.98, 1.46);
  bPillar(M, cabW, -1.2, 0.98, 1.47);
  lamps(M, def, { y: 0.74, w: 0.3, h: 0.13, inset: 0.22, tailW: 0.16, tailY: 0.86 });
  M.box(def.wid * 0.34, 0.12, 0.05, { y: 0.66, z: h, color: DARK, surf: S.plastic });
  plates(M, def, 0.48, 0.58);
  mirrors(M, def, 0.7, 1.04);
  handles(M, def, [0.2, -0.75], 0.88);
  // roof rack and illuminated TAXI sign
  for (const sx of [-1, 1]) M.box(0.04, 0.04, 1.6, { x: sx * 0.55, y: 1.53, z: -0.55, color: TRIM, surf: S.plastic });
  M.box(0.62, 0.2, 0.22, { y: 1.62, z: -0.35, color: '#ffd400', surf: S.lamp, light: 5 });
  return M.build();
}

function hiace(def) {
  const M = new Mesh();
  const h = def.len / 2;
  const body = sideShape([
    [-h + 0.02, 0.38], [-h, 0.62], [-h + 0.02, 1.0], [h - 0.55, 1.02], [h - 0.1, 0.92], [h, 0.72], [h, 0.5], [h - 0.05, 0.36],
  ], 0.3, arches(def));
  M.add(extrudeSide(body, def.wid, 0.09), bodyFn(def, { plasticBumpers: true, bumperTop: 0.58 }));
  sills(M, def);
  bumpers(M, def, { y: 0.47, h: 0.24 });
  // one-box upper body: glass band with painted roof & pillars
  const cab = sideShape([[-h + 0.03, 0.98], [-h + 0.06, 1.94], [h - 0.6, 1.97], [h - 0.12, 1.02]], 0.94, []);
  const cabW = def.wid * 0.97;
  M.add(extrudeSide(cab, cabW, 0.1), (f) => {
    if (f.ny > 0.7) return { color: WHITE, paint: 1, surf: S.paint };
    if (f.cy > 1.78) return { color: WHITE, paint: 1, surf: S.paint };
    if (Math.abs(f.nx) > 0.5 && (f.cz < -h + 0.25)) return { color: WHITE, paint: 1, surf: S.paint };
    return { color: GLASS, surf: S.glass };
  });
  for (const z of [-1.4, -0.35, 0.65]) bPillar(M, cabW, z, 1.0, 1.82);
  for (const sx of [-1, 1]) M.box(0.02, 0.7, 0.02, { x: sx * (def.wid / 2 + 0.01), y: 1.36, z: 0.15, color: TRIM, surf: S.plastic });
  lamps(M, def, { y: 0.82, w: 0.3, h: 0.16, inset: 0.22, tailW: 0.14, tailY: 0.9 });
  M.box(def.wid * 0.42, 0.18, 0.05, { y: 0.72, z: h + 0.01, color: CHROME, surf: S.chrome });
  plates(M, def, 0.5, 0.6);
  mirrors(M, def, h - 0.5, 1.15);
  return M.build();
}

function pickup(def) {
  const M = new Mesh();
  const h = def.len / 2;
  const body = sideShape([
    [-h + 0.02, 0.5], [-h, 0.74], [-h + 0.02, 1.04], [-0.45, 1.04], [0.62, 1.06], [1.72, 1.0], [h - 0.06, 0.92], [h, 0.66], [h - 0.05, 0.44],
  ], 0.42, arches(def));
  M.add(extrudeSide(body, def.wid, 0.08), bodyFn(def, { plasticBumpers: true, bumperTop: 0.66 }));
  sills(M, def, 0.48);
  const cab = sideShape([[-0.44, 1.02], [-0.42, 1.76], [0.38, 1.79], [0.98, 1.03]], 0.98, []);
  const cabW = def.wid * 0.92;
  M.add(extrudeSide(cab, cabW, 0.07), cabinFn());
  bPillar(M, cabW, 0.0, 1.05, 1.74);
  lamps(M, def, { y: 0.86, w: 0.34, h: 0.15, inset: 0.22, tailW: 0.14, tailY: 0.9 });
  M.box(def.wid * 0.46, 0.2, 0.05, { y: 0.78, z: h, color: CHROME, surf: S.chrome });
  M.box(def.wid * 1.0, 0.14, 0.14, { y: 0.48, z: -h - 0.04, color: CHROME, surf: S.chrome });
  plates(M, def, 0.55, 0.62);
  mirrors(M, def, 0.92, 1.25);
  // Yangon "lain-ka": benches and a roof canopy over the bed, grab rails, rear step
  const bedL = h - 0.5, bedZ = (-h + -0.45) / 2;
  M.box(def.wid * 0.92, 0.04, bedL + 0.4, { y: 1.06, z: bedZ, color: '#3b3b3b', surf: S.rubber });
  for (const sx of [-1, 1]) {
    M.box(0.32, 0.1, bedL, { x: sx * (def.wid / 2 - 0.25), y: 1.36, z: bedZ, color: '#6b4a2e', surf: S.plastic });
    M.box(0.06, 0.3, bedL, { x: sx * (def.wid / 2 - 0.08), y: 1.5, z: bedZ, color: '#6b4a2e', surf: S.plastic });
    for (const z of [-h + 0.08, bedZ, -0.5]) M.box(0.05, 0.98, 0.05, { x: sx * (def.wid / 2 - 0.05), y: 1.55, z, color: CHROME, surf: S.chrome });
    M.box(0.04, 0.04, bedL + 0.4, { x: sx * (def.wid / 2 - 0.05), y: 1.8, z: bedZ, color: CHROME, surf: S.chrome });
  }
  M.box(def.wid * 1.02, 0.07, bedL + 0.55, { y: 2.06, z: bedZ, color: WHITE, paint: 1, surf: S.paint });
  M.box(def.wid * 0.6, 0.06, 0.32, { y: 0.55, z: -h - 0.2, color: CHROME, surf: S.chrome });
  return M.build();
}

function sports(def) {
  const M = new Mesh();
  const h = def.len / 2;
  const body = sideShape([
    [-h + 0.02, 0.36], [-h, 0.64], [-h + 0.06, 0.9], [-1.45, 0.97], [0.55, 0.85], [1.9, 0.66], [h - 0.03, 0.56], [h - 0.01, 0.34],
  ], 0.26, arches(def));
  M.add(extrudeSide(body, def.wid, 0.12), bodyFn(def));
  sills(M, def, 0.32);
  const cab = sideShape([[-1.55, 0.93], [-0.65, 1.18], [0.05, 1.2], [0.68, 0.84]], 0.82, []);
  M.add(extrudeSide(cab, def.wid * 0.8, 0.1), cabinFn({ roofNy: 0.85 }));
  lamps(M, def, { y: 0.62, w: 0.42, h: 0.08, inset: 0.3, tailW: 0.55, tailY: 0.78 });
  M.box(def.wid * 0.95, 0.05, 0.38, { y: 1.18, z: -h + 0.25, color: TRIM, surf: S.plastic });
  for (const sx of [-1, 1]) {
    M.box(0.06, 0.24, 0.06, { x: sx * 0.6, y: 1.05, z: -h + 0.28, color: TRIM, surf: S.plastic });
    M.box(0.03, 0.14, 0.5, { x: sx * (def.wid / 2 + 0.01), y: 0.62, z: -0.75, color: DARK, surf: S.plastic });
  }
  M.box(def.wid * 0.6, 0.1, 0.06, { y: 0.42, z: h - 0.01, color: DARK, surf: S.plastic });
  plates(M, def, 0.45, 0.6);
  mirrors(M, def, 0.55, 0.95);
  return M.build();
}

function bus(def) {
  const M = new Mesh();
  const h = def.len / 2;
  const body = sideShape([[-h, 0.5], [-h, 2.95], [-h + 0.15, 3.12], [h - 0.15, 3.12], [h, 2.95], [h, 0.5]], 0.42, arches(def));
  M.add(extrudeSide(body, def.wid, 0.13), (f) => {
    if (f.ny < -0.45) return { color: DARK, surf: S.rubber };
    if (f.cy < 0.95 && f.ny < 0.6) return { color: '#f2f2f0', surf: S.paint };      // white skirt
    if (f.ny > 0.8) return { color: '#e6e6e4', surf: S.paint };                      // roof
    return { color: WHITE, paint: 1, surf: S.paint };
  });
  // side window band with pillars, windscreen, doors
  for (const sx of [-1, 1]) {
    M.box(0.03, 1.05, def.len - 1.6, { x: sx * (def.wid / 2 + 0.01), y: 2.15, z: -0.4, color: GLASS, surf: S.glass });
    for (let z = -h + 0.6; z < h - 1.0; z += 1.25) M.box(0.04, 1.05, 0.1, { x: sx * (def.wid / 2 + 0.02), y: 2.15, z, color: TRIM, surf: S.plastic });
    M.box(0.025, 0.12, def.len - 0.3, { x: sx * (def.wid / 2 + 0.01), y: 1.0, z: 0, color: '#f2f2f0', surf: S.paint });
  }
  // doors on the kerb side (right)
  for (const z of [h - 1.35, -0.6]) M.box(0.04, 2.1, 1.0, { x: -(def.wid / 2 + 0.015), y: 1.55, z, color: '#1b2329', surf: S.glass });
  M.box(def.wid * 0.94, 1.45, 0.04, { y: 2.05, z: h + 0.01, color: GLASS, surf: S.glass });
  M.box(def.wid * 0.94, 1.0, 0.04, { y: 2.3, z: -h - 0.01, color: GLASS, surf: S.glass });
  M.box(def.wid * 0.7, 0.26, 0.05, { y: 2.92, z: h + 0.02, color: '#ffb000', surf: S.lamp, light: 5 });
  M.box(def.wid * 1.01, 0.32, 0.12, { y: 0.66, z: h, color: '#2a2b2d', surf: S.plastic });
  M.box(def.wid * 1.01, 0.32, 0.12, { y: 0.66, z: -h, color: '#2a2b2d', surf: S.plastic });
  lamps(M, def, { y: 0.98, w: 0.34, h: 0.16, inset: 0.3, tailW: 0.2, tailY: 1.2 });
  M.box(def.wid * 0.6, 0.3, 0.6, { y: 3.27, z: -1.8, color: '#d4d6d8', surf: S.plastic }); // roof AC
  for (const sx of [-1, 1]) {
    M.box(0.05, 0.05, 0.5, { x: sx * (def.wid / 2 + 0.2), y: 2.6, z: h - 0.15, color: TRIM, surf: S.plastic });
    M.box(0.08, 0.36, 0.2, { x: sx * (def.wid / 2 + 0.44), y: 2.4, z: h + 0.08, color: TRIM, surf: S.plastic });
  }
  plates(M, def, 0.82, 0.9);
  return M.build();
}

function trishaw(def) {
  const M = new Mesh();
  const bx = -0.38; // bicycle line (kerb-side sidecar on the left of the rider)
  const frame = { color: '#2a2b2d', surf: S.plastic };
  M.box(0.05, 0.05, 1.05, { x: bx, y: 0.62, z: 0.06, ...frame });
  M.box(0.05, 0.62, 0.05, { x: bx, y: 0.7, z: -0.18, rx: 0.2, ...frame });
  M.box(0.05, 0.75, 0.05, { x: bx, y: 0.7, z: 0.56, rx: -0.25, ...frame });
  M.box(0.55, 0.04, 0.04, { x: bx, y: 1.08, z: 0.5, color: CHROME, surf: S.chrome });
  M.box(0.18, 0.06, 0.26, { x: bx, y: 1.0, z: -0.22, color: '#1a1a1a', surf: S.rubber });
  // rider (static pedalling pose): longyi, shirt, arms to the bars, head
  M.box(0.36, 0.5, 0.26, { x: bx, y: 1.28, z: -0.12, rx: 0.25, color: '#e8e8e2', surf: S.plastic });
  M.box(0.34, 0.42, 0.3, { x: bx, y: 0.86, z: -0.08, color: '#2c3e66', surf: S.plastic });
  M.box(0.12, 0.42, 0.12, { x: bx - 0.08, y: 0.48, z: 0.0, rx: -0.4, color: '#2c3e66', surf: S.plastic });
  M.box(0.12, 0.42, 0.12, { x: bx + 0.08, y: 0.52, z: 0.08, rx: 0.3, color: '#2c3e66', surf: S.plastic });
  for (const sx of [-1, 1]) M.box(0.08, 0.08, 0.5, { x: bx + sx * 0.2, y: 1.3, z: 0.22, rx: 0.35, color: '#a8744f', surf: S.plastic });
  M.box(0.22, 0.24, 0.22, { x: bx, y: 1.68, z: -0.02, color: '#a8744f', surf: S.plastic });
  M.box(0.24, 0.08, 0.24, { x: bx, y: 1.83, z: -0.04, color: '#141210', surf: S.plastic });
  // sidecar: painted tub with back-to-back seats, small canopy
  const sc = 0.45;
  M.box(0.66, 0.14, 1.15, { x: sc, y: 0.48, z: -0.05, color: WHITE, paint: 1, surf: S.paint });
  M.box(0.66, 0.3, 0.06, { x: sc, y: 0.7, z: 0.5, color: WHITE, paint: 1, surf: S.paint });
  M.box(0.06, 0.28, 1.15, { x: sc + 0.32, y: 0.68, z: -0.05, color: WHITE, paint: 1, surf: S.paint });
  M.box(0.58, 0.12, 0.42, { x: sc, y: 0.62, z: 0.22, color: '#b8352f', surf: S.plastic });
  M.box(0.58, 0.12, 0.42, { x: sc, y: 0.62, z: -0.32, color: '#b8352f', surf: S.plastic });
  M.box(0.58, 0.4, 0.06, { x: sc, y: 0.88, z: -0.05, color: '#b8352f', surf: S.plastic });
  for (const z of [0.45, -0.55]) M.box(0.03, 0.9, 0.03, { x: sc + 0.3, y: 1.1, z, color: CHROME, surf: S.chrome });
  M.box(0.7, 0.04, 1.15, { x: sc + 0.05, y: 1.56, z: -0.05, color: WHITE, paint: 1, surf: S.paint });
  M.box(0.05, 0.05, 0.9, { x: (bx + sc) / 2, y: 0.42, z: -0.05, ...frame });
  M.box(0.08, 0.1, 0.06, { x: bx, y: 0.75, z: 0.92, color: '#eef2f4', surf: S.lamp, light: 1 });
  return M.build();
}

export function buildVehicleGeometries() {
  const T = VEHICLE_TYPES;
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
export function wheelGeometry() {
  const M = new Mesh();
  const prof = [[0.62, -0.5], [0.9, -0.5], [0.99, -0.38], [1.0, -0.2], [1.0, 0.2], [0.99, 0.38], [0.9, 0.5], [0.62, 0.5]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const tyre = new THREE.LatheGeometry(prof, 14);
  tyre.rotateZ(-Math.PI / 2);
  M.part(tyre, { color: '#161616', surf: S.rubber });
  const rim = new THREE.CylinderGeometry(0.62, 0.62, 0.08, 14, 1);
  rim.rotateZ(Math.PI / 2);
  M.part(rim, { x: 0.36, color: '#9ea3a8', surf: S.chrome });
  M.part(new THREE.CylinderGeometry(0.6, 0.6, 0.06, 16).rotateZ(Math.PI / 2), { x: -0.36, color: '#2b2b2b', surf: S.plastic });
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
