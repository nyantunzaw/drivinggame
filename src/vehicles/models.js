// Procedural low-poly vehicle meshes. Each vertex carries:
//   color  - base colour, paint - 1 where the per-instance paint colour applies,
//   lightKind - 0 none, 1 headlight, 2 tail/brake light, 3 red siren, 4 blue siren, 5 taxi sign
import * as THREE from 'three';

export const VEHICLE_TYPES = {
  taxi: {
    name: 'Probox Taxi', len: 4.25, wid: 1.72, hgt: 1.52, mass: 1150, power: 8.0, top: 46, grip: 1.0,
    wheelR: 0.31, colors: ['#f4f4f2', '#e8e8e6', '#dcdcda'], taxi: true, weight: 4,
  },
  sedan: {
    name: 'Mark II', len: 4.7, wid: 1.76, hgt: 1.4, mass: 1350, power: 9.0, top: 52, grip: 1.02,
    wheelR: 0.32, colors: ['#e9e9e9', '#2b2b2f', '#8a1c1c', '#1f3d6b', '#b9b9be', '#6a6f3a', '#d9c39a', '#7a2e5c'], weight: 5,
  },
  pickup: {
    name: 'Lain-Ka Pickup', len: 4.6, wid: 1.75, hgt: 1.95, mass: 1500, power: 6.8, top: 38, grip: 0.95,
    wheelR: 0.34, colors: ['#2f6fb5', '#e8e8e8', '#c94b3a', '#3a8a52', '#e0b33a'], weight: 3,
  },
  bus: {
    name: 'YBS Bus', len: 10.6, wid: 2.5, hgt: 3.1, mass: 9000, power: 4.6, top: 27, grip: 0.9,
    wheelR: 0.5, colors: ['#d8322e', '#2a6fd0', '#e8a21a', '#2f9a5a'], weight: 1.4,
  },
  sports: {
    name: 'Irrawaddy GT', len: 4.4, wid: 1.92, hgt: 1.15, mass: 1250, power: 14, top: 68, grip: 1.18,
    wheelR: 0.34, colors: ['#ff3ea5', '#ffffff', '#38e8ff', '#ffd400', '#ff6a2a'], weight: 0.6,
  },
  police: {
    name: 'Police Cruiser', len: 4.85, wid: 1.8, hgt: 1.5, mass: 1450, power: 11, top: 58, grip: 1.1,
    wheelR: 0.33, colors: ['#f5f5f5'], police: true, weight: 0,
  },
};

const tmp = new THREE.Color();
function lin(hex) {
  tmp.set(hex);
  return [tmp.r, tmp.g, tmp.b];
}

class Builder {
  constructor() { this.p = []; this.n = []; this.c = []; this.paint = []; this.light = []; this.idx = []; }

  // Cuboid with optional top inset (tapered cabins). Faces are flat-shaded.
  box(cx, cy, cz, sx, sy, sz, color, { paint = 0, light = 0, topX = 1, topZ = 1, topOffZ = 0, skipBottom = true } = {}) {
    const hx = sx / 2, hz = sz / 2;
    const bx = hx, bz = hz, tx = hx * topX, tz = hz * topZ;
    const v = [
      [cx - bx, cy, cz - bz], [cx + bx, cy, cz - bz], [cx + bx, cy, cz + bz], [cx - bx, cy, cz + bz],
      [cx - tx, cy + sy, cz - tz + topOffZ], [cx + tx, cy + sy, cz - tz + topOffZ], [cx + tx, cy + sy, cz + tz + topOffZ], [cx - tx, cy + sy, cz + tz + topOffZ],
    ];
    const faces = [[4, 7, 6, 5], [0, 1, 2, 3], [3, 2, 6, 7], [1, 0, 4, 5], [2, 1, 5, 6], [0, 3, 7, 4]];
    const c = lin(color);
    faces.forEach((f, fi) => {
      if (fi === 1 && skipBottom) return;
      this.face(f.map((i) => v[i]), c, paint, light);
    });
  }

  face(vs, c, paint, light) {
    // newell normal
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i], b = vs[(i + 1) % vs.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const base = this.p.length / 3;
    for (const p of vs) {
      this.p.push(p[0], p[1], p[2]);
      this.n.push(nx, ny, nz);
      this.c.push(c[0], c[1], c[2]);
      this.paint.push(paint);
      this.light.push(light);
    }
    for (let i = 1; i < vs.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('paint', new THREE.Float32BufferAttribute(this.paint, 1));
    g.setAttribute('lightKind', new THREE.Float32BufferAttribute(this.light, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const GLASS = '#1d2a36';
const TRIM = '#2a2a2c';
const CHROME = '#b8bcc2';

function lightsFrontRear(B, len, wid, y, h = 0.16) {
  const zf = len / 2, zr = -len / 2;
  for (const s of [-1, 1]) {
    B.box(s * (wid / 2 - 0.28), y, zf - 0.02, 0.34, h, 0.06, '#fffbe8', { light: 1, skipBottom: false });
    B.box(s * (wid / 2 - 0.25), y, zr + 0.02, 0.32, h, 0.06, '#b0151a', { light: 2, skipBottom: false });
  }
}

function car(def, kind) {
  const B = new Builder();
  const { len, wid, hgt, wheelR } = def;
  const floor = wheelR * 0.75;
  const bodyH = hgt * 0.42;
  // lower body
  B.box(0, floor, 0, wid, bodyH, len, '#ffffff', { paint: 1, topZ: 0.985 });
  // bumpers
  B.box(0, floor - 0.05, len / 2 - 0.08, wid * 1.01, 0.26, 0.2, TRIM);
  B.box(0, floor - 0.05, -len / 2 + 0.08, wid * 1.01, 0.26, 0.2, TRIM);
  const top = floor + bodyH;
  if (kind === 'sports') {
    B.box(0, top, -0.25, wid * 0.86, hgt - bodyH - floor, len * 0.42, GLASS, { topX: 0.82, topZ: 0.55, topOffZ: -0.25 });
    B.box(0, top + (hgt - bodyH - floor) - 0.02, -0.38, wid * 0.7, 0.05, len * 0.22, '#ffffff', { paint: 1 });
    B.box(0, top, -len / 2 + 0.25, wid * 0.9, 0.2, 0.35, '#ffffff', { paint: 1 }); // spoiler base
    B.box(0, top + 0.25, -len / 2 + 0.25, wid * 0.92, 0.06, 0.4, TRIM);
    lightsFrontRear(B, len, wid, floor + bodyH * 0.55, 0.1);
    return B.build();
  }
  if (kind === 'pickup') {
    const cabLen = len * 0.36;
    const cabZ = len / 2 - cabLen / 2 - 0.55;
    B.box(0, top, cabZ, wid * 0.94, hgt * 0.36, cabLen, GLASS, { topX: 0.92, topZ: 0.82, topOffZ: -0.08 });
    B.box(0, top + hgt * 0.36 - 0.03, cabZ - 0.08, wid * 0.86, 0.06, cabLen * 0.82, '#ffffff', { paint: 1 });
    // covered passenger bed with benches (Yangon "lain-ka")
    const bedLen = len - cabLen - 0.8;
    const bedZ = -len / 2 + bedLen / 2 + 0.05;
    B.box(0, top, bedZ, wid, 0.12, bedLen, '#444');
    for (const s of [-1, 1]) {
      for (const zz of [bedZ - bedLen / 2 + 0.1, bedZ + bedLen / 2 - 0.1]) B.box(s * (wid / 2 - 0.05), top, zz, 0.07, hgt * 0.42, 0.07, CHROME);
      B.box(s * (wid / 2 - 0.25), top + 0.1, bedZ, 0.3, 0.35, bedLen * 0.9, '#6b4a2e');
    }
    B.box(0, top + hgt * 0.42, bedZ, wid * 1.02, 0.08, bedLen * 1.02, '#ffffff', { paint: 1 });
    lightsFrontRear(B, len, wid, floor + bodyH * 0.6);
    return B.build();
  }
  if (kind === 'bus') {
    const H = hgt - floor;
    B.box(0, floor, 0, wid, H, len, '#ffffff', { paint: 1, topX: 0.98, topZ: 0.995 });
    // window band
    B.box(0, floor + H * 0.45, 0.2, wid * 1.012, H * 0.38, len * 0.92, GLASS);
    B.box(0, floor + H * 0.45, len / 2 - 0.05, wid * 0.9, H * 0.42, 0.12, GLASS);
    B.box(0, floor + 0.1, 0, wid * 1.02, 0.3, len * 1.005, '#f2f2f2');
    B.box(0, floor + H, 0, wid * 0.6, 0.18, len * 0.4, '#d8d8d8');
    // destination sign
    B.box(0, floor + H * 0.87, len / 2 + 0.01, wid * 0.7, 0.28, 0.06, '#ffb000', { light: 5, skipBottom: false });
    lightsFrontRear(B, len, wid, floor + 0.35, 0.22);
    return B.build();
  }
  // sedan, taxi, police
  const cabH = hgt - bodyH - floor;
  const cabLen = kind === 'taxi' ? len * 0.58 : len * 0.47;
  const cabZ = kind === 'taxi' ? -len * 0.08 : -len * 0.05;
  B.box(0, top, cabZ, wid * 0.92, cabH, cabLen, GLASS, { topX: 0.9, topZ: kind === 'taxi' ? 0.86 : 0.7, topOffZ: kind === 'taxi' ? -0.15 : -0.1 });
  B.box(0, top + cabH - 0.02, cabZ - 0.1, wid * 0.83, 0.05, cabLen * (kind === 'taxi' ? 0.78 : 0.62), '#ffffff', { paint: 1 });
  // grille
  B.box(0, floor + bodyH * 0.25, len / 2 + 0.005, wid * 0.42, bodyH * 0.45, 0.04, kind === 'police' ? '#111' : CHROME, { skipBottom: false });
  if (kind === 'taxi') {
    B.box(0, top + cabH + 0.03, cabZ - 0.1, 0.55, 0.2, 0.22, '#ffd400', { light: 5, skipBottom: false });
  }
  if (kind === 'police') {
    B.box(0, floor + bodyH * 0.35, 0, wid * 1.012, 0.16, len * 0.62, '#1d4fb8');
    B.box(-0.32, top + cabH + 0.03, cabZ - 0.1, 0.55, 0.14, 0.26, '#ff2020', { light: 3, skipBottom: false });
    B.box(0.32, top + cabH + 0.03, cabZ - 0.1, 0.55, 0.14, 0.26, '#2040ff', { light: 4, skipBottom: false });
  }
  lightsFrontRear(B, len, wid, floor + bodyH * 0.62);
  return B.build();
}

export function buildVehicleGeometries() {
  const out = {};
  for (const [k, def] of Object.entries(VEHICLE_TYPES)) out[k] = car(def, k);
  return out;
}

export function wheelGeometry() {
  // unit wheel (radius 1, width 1) along x axis, flat-shaded with a hubcap
  const tire = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
  tire.rotateZ(Math.PI / 2);
  const g = tire.toNonIndexed();
  g.computeVertexNormals();
  const pos = g.attributes.position;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const x = Math.abs(pos.getX(i)), r = Math.hypot(pos.getY(i), pos.getZ(i));
    const nx = Math.abs(g.attributes.normal.getX(i));
    const hub = nx > 0.9 && r < 0.62 && x > 0.45;
    const c = hub ? lin('#c4c8cc') : lin('#1c1c1e');
    colors.push(c[0], c[1], c[2]);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}
