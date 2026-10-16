// Tiny geometry builder used to merge many procedural parts into one draw call.
import * as THREE from 'three';

export class Geo {
  constructor({ uv = true, color = true, glow = false } = {}) {
    this.p = []; this.n = []; this.idx = [];
    this.u = uv ? [] : null;
    this.c = color ? [] : null;
    this.g = glow ? [] : null;
    this.count = 0;
  }

  v(x, y, z, nx, ny, nz, u = 0, w = 0, r = 1, g = 1, b = 1, glow = 0) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    if (this.u) this.u.push(u, w);
    if (this.c) this.c.push(r, g, b);
    if (this.g) this.g.push(glow);
    return this.count++;
  }

  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }

  // Append a template {p, n, c, idx} transformed by position/rotation/scale.
  addTemplate(t, x, y, z, rotY, s, sy = s, tint = null, glowAttr = null) {
    const cs = Math.cos(rotY), sn = Math.sin(rotY);
    const base = this.count;
    const P = t.p, N = t.n, C = t.c;
    for (let i = 0; i < P.length; i += 3) {
      const px = P[i] * s, py = P[i + 1] * sy, pz = P[i + 2] * s;
      const nx = N[i], ny = N[i + 1], nz = N[i + 2];
      this.p.push(x + px * cs + pz * sn, y + py, z - px * sn + pz * cs);
      this.n.push(nx * cs + nz * sn, ny, -nx * sn + nz * cs);
      if (this.u) this.u.push(0, 0);
      if (this.c) {
        if (tint) this.c.push(C[i] * tint[0], C[i + 1] * tint[1], C[i + 2] * tint[2]);
        else this.c.push(C[i], C[i + 1], C[i + 2]);
      }
      if (this.g) this.g.push(t.g ? t.g[i / 3] : 0);
      this.count++;
    }
    for (let i = 0; i < t.idx.length; i++) this.idx.push(base + t.idx[i]);
  }

  get empty() { return this.count === 0; }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    if (this.u) geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    if (this.c) geo.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.g) geo.setAttribute('glow', new THREE.Float32BufferAttribute(this.g, 1));
    geo.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}

// Convert a THREE geometry (non-indexed or indexed) into a template with flat colour.
export function templateFrom(geometry, color, glow = 0) {
  const g = geometry.index ? geometry : geometry;
  const pos = g.attributes.position.array;
  const nrm = g.attributes.normal.array;
  const c = new THREE.Color(color);
  const t = { p: Array.from(pos), n: Array.from(nrm), c: [], g: [], idx: [] };
  for (let i = 0; i < pos.length / 3; i++) { t.c.push(c.r, c.g, c.b); t.g.push(glow); }
  if (g.index) t.idx = Array.from(g.index.array);
  else for (let i = 0; i < pos.length / 3; i++) t.idx.push(i);
  return t;
}

export function mergeTemplates(list) {
  const out = { p: [], n: [], c: [], g: [], idx: [] };
  for (const t of list) {
    const base = out.p.length / 3;
    out.p.push(...t.p); out.n.push(...t.n); out.c.push(...t.c); out.g.push(...t.g);
    for (const i of t.idx) out.idx.push(base + i);
  }
  return out;
}

// Transform a template in place (translate/rotate around X or Z/scale) before merging.
export function xform(t, { x = 0, y = 0, z = 0, rx = 0, rz = 0, ry = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const v = new THREE.Vector3();
  for (let i = 0; i < t.p.length; i += 3) {
    v.set(t.p[i], t.p[i + 1], t.p[i + 2]).applyMatrix4(m);
    t.p[i] = v.x; t.p[i + 1] = v.y; t.p[i + 2] = v.z;
    v.set(t.n[i], t.n[i + 1], t.n[i + 2]).applyMatrix3(nm).normalize();
    t.n[i] = v.x; t.n[i + 1] = v.y; t.n[i + 2] = v.z;
  }
  return t;
}
