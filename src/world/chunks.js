// Streams the city around the player in CHUNK x CHUNK tiles: buildings, roads,
// lane markings, trees and street lamps are merged per tile (few draw calls).
import * as THREE from 'three';
import { CHUNK, ROAD_HALF, SIDEWALK } from '../config.js';
import { heightAt, onHill } from '../terrain.js';
import { hash1, hash2 } from '../util.js';
import { Geo } from './geo.js';
import { TEMPLATES } from './props.js';

const PASTEL = ['#f3d9b1', '#f7c6c7', '#bfe3e0', '#f6e3a1', '#d6c8f0', '#c9dcf5', '#f2b8a0', '#ece6da', '#b5d6b2', '#ffd1e8', '#a8e6f0'];
const MUTED = ['#e9e1d0', '#d8cdb8', '#c9b8a0', '#e0d6c8', '#bcc9b0', '#d9c7b5', '#e8d9c4', '#cfd6d8'];
const MODERN = ['#e8eef2', '#d0dbe4', '#f2f2ee', '#c4d2dc', '#e6e0d8'];
const ROOFS = ['#8a8580', '#7a6f66', '#9a5a45', '#6f7a80', '#a09a90', '#85776a'];
const HOUSE_ROOFS = ['#9c4a35', '#7d3a2c', '#6e7276', '#8f8a7e', '#a35c3c'];
const CIVIC = ['#c0603f', '#e9dcc0', '#d7c49a'];

const tmpColor = new THREE.Color();
function rgb(hex) {
  tmpColor.set(hex);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
}
const cache = new Map();
function col(hex) {
  let c = cache.get(hex);
  if (!c) { c = rgb(hex); cache.set(hex, c); }
  return c;
}

export class ChunkManager {
  constructor(scene, map, mats, quality, core) {
    this.scene = scene;
    this.map = map;
    this.mats = mats;
    this.quality = quality;
    this.core = core; // downtown polygon test fn
    const { x0, z0, x1, z1 } = map.bounds;
    this.gx0 = x0; this.gz0 = z0;
    this.nx = Math.ceil((x1 - x0) / CHUNK);
    this.nz = Math.ceil((z1 - z0) / CHUNK);
    this.cells = Array.from({ length: this.nx * this.nz }, () => ({ b: [], r: [], t: [], n: [] }));
    this.loaded = new Map();
    this.stupaSet = new Set();
    this._index();
  }

  key(cx, cz) { return cz * this.nx + cx; }

  cellAt(x, z) {
    const cx = Math.floor((x - this.gx0) / CHUNK), cz = Math.floor((z - this.gz0) / CHUNK);
    if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) return null;
    return this.cells[this.key(cx, cz)];
  }

  _index() {
    const m = this.map;
    for (let i = 0; i < m.buildingCount; i++) {
      // small religious buildings become golden stupas (see landmarks.js)
      if (m.bType[i] === 3 && m.bArea[i] < 260) { this.stupaSet.add(i); continue; }
      const c = this.cellAt(m.bCx[i], m.bCz[i]);
      if (c) c.b.push(i);
    }
    // node degree (drivable roads only)
    this.deg = new Uint8Array(m.nodeX.length);
    this.nodeHw = new Float32Array(m.nodeX.length);
    this.nodeSw = new Float32Array(m.nodeX.length);
    for (const e of m.edges) {
      if (e.cls > 5) continue;
      for (const n of [e.a, e.b]) {
        this.deg[n]++;
        this.nodeHw[n] = Math.max(this.nodeHw[n], ROAD_HALF[e.cls]);
        this.nodeSw[n] = Math.max(this.nodeSw[n], SIDEWALK[e.cls]);
      }
    }
    for (const e of m.edges) {
      const pieces = Math.max(1, Math.ceil(e.len / 60));
      for (let k = 0; k < pieces; k++) {
        const s0 = (e.len * k) / pieces, s1 = (e.len * (k + 1)) / pieces;
        const mid = this.pointAt(e, (s0 + s1) / 2);
        const c = this.cellAt(mid[0], mid[1]);
        if (c) c.r.push([e, s0, s1]);
      }
    }
    for (let i = 0; i < m.nodeX.length; i++) {
      if (this.deg[i] < 2) continue;
      const c = this.cellAt(m.nodeX[i], m.nodeZ[i]);
      if (c) c.n.push(i);
    }
    const keep = this.quality.trees;
    for (let i = 0; i < m.trees.length; i += 2) {
      if (hash1(i) > keep) continue;
      const c = this.cellAt(m.trees[i], m.trees[i + 1]);
      if (c) c.t.push(i);
    }
  }

  pointAt(e, s) {
    const p = e.pts, cum = e.cum;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return [p[i * 2 - 2] + (p[i * 2] - p[i * 2 - 2]) * t, p[i * 2 - 1] + (p[i * 2 + 1] - p[i * 2 - 1]) * t];
  }

  // Polyline of edge between s0 and s1, subdivided on the hill so it hugs terrain.
  slice(e, s0, s1) {
    const out = [];
    const p = e.pts, cum = e.cum;
    const push = (x, z) => {
      if (out.length) {
        const lx = out[out.length - 2], lz = out[out.length - 1];
        const d = Math.hypot(x - lx, z - lz);
        if (d < 0.05) return;
        if (onHill(x, z, 20) || onHill(lx, lz, 20)) {
          const n = Math.floor(d / 6);
          for (let k = 1; k <= n; k++) {
            const t = k / (n + 1);
            out.push(lx + (x - lx) * t, lz + (z - lz) * t);
          }
        }
      }
      out.push(x, z);
    };
    const a = this.pointAt(e, s0);
    push(a[0], a[1]);
    for (let i = 1; i < cum.length - 1; i++) {
      if (cum[i] > s0 && cum[i] < s1) push(p[i * 2], p[i * 2 + 1]);
    }
    const b = this.pointAt(e, s1);
    push(b[0], b[1]);
    return out;
  }

  // Streams tiles in/out. Tile construction is time-sliced (generators) so a dense
  // downtown tile never blows the frame budget on a phone.
  update(px, pz, view, budgetMs = 4) {
    const R = view + CHUNK * 0.75;
    const t0 = performance.now();
    for (const [k, ch] of this.loaded) {
      const d = Math.hypot(ch.x - px, ch.z - pz);
      if (d > R + CHUNK * 0.8) {
        this.scene.remove(ch.group);
        ch.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        this.loaded.delete(k);
      }
    }
    if (this.pending && Math.hypot(this.pending.x - px, this.pending.z - pz) > R + CHUNK) this.pending = null;
    let remaining = 0;
    for (;;) {
      if (!this.pending) {
        const next = this._nextWanted(px, pz, R);
        remaining = next.count;
        if (!next.best) break;
        const [, cx, cz, k, x, z] = next.best;
        this.pending = { k, x, z, gen: this.buildGen(this.cells[k], cx, cz) };
      }
      const r = this.pending.gen.next();
      if (r.done) {
        this.scene.add(r.value);
        this.loaded.set(this.pending.k, { group: r.value, x: this.pending.x, z: this.pending.z });
        this.pending = null;
      }
      if (performance.now() - t0 > budgetMs) break;
    }
    return remaining + (this.pending ? 1 : 0);
  }

  _nextWanted(px, pz, R) {
    let best = null, count = 0;
    const c0x = Math.max(0, Math.floor((px - R - this.gx0) / CHUNK));
    const c1x = Math.min(this.nx - 1, Math.floor((px + R - this.gx0) / CHUNK));
    const c0z = Math.max(0, Math.floor((pz - R - this.gz0) / CHUNK));
    const c1z = Math.min(this.nz - 1, Math.floor((pz + R - this.gz0) / CHUNK));
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const k = this.key(cx, cz);
        if (this.loaded.has(k)) continue;
        const x = this.gx0 + (cx + 0.5) * CHUNK, z = this.gz0 + (cz + 0.5) * CHUNK;
        const d = Math.hypot(x - px, z - pz);
        if (d < R) { count++; if (!best || d < best[0]) best = [d, cx, cz, k, x, z]; }
      }
    }
    return { best, count };
  }

  *buildGen(cell, cx, cz) {
    const group = new THREE.Group();
    group.name = `chunk-${cx}-${cz}`;
    const bGeo = new Geo();
    let n = 0;
    for (const i of cell.b) { this.building(bGeo, i); if (++n % 40 === 0) yield; }
    if (!bGeo.empty) {
      const mesh = new THREE.Mesh(bGeo.build(), this.mats.building);
      mesh.castShadow = this.quality.shadows;
      mesh.receiveShadow = this.quality.shadows;
      group.add(mesh);
    }
    yield;
    const rGeo = new Geo();
    const mGeo = new Geo();
    const pGeo = new Geo({ uv: false, glow: true });
    const poolGeo = new Geo({ color: false });
    n = 0;
    for (const [e, s0, s1] of cell.r) { this.road(rGeo, mGeo, pGeo, poolGeo, e, s0, s1); if (++n % 30 === 0) yield; }
    for (const nd of cell.n) this.nodeDisc(rGeo, nd);
    yield;
    n = 0;
    for (const i of cell.t) { this.tree(pGeo, i); if (++n % 60 === 0) yield; }
    const recv = this.quality.shadows;
    if (!rGeo.empty) {
      const m = new THREE.Mesh(rGeo.build(), this.mats.road);
      m.receiveShadow = recv;
      group.add(m);
    }
    if (!mGeo.empty) group.add(new THREE.Mesh(mGeo.build(), this.mats.marking));
    yield;
    if (!pGeo.empty) {
      const m = new THREE.Mesh(pGeo.build(), this.mats.props);
      m.castShadow = this.quality.shadows;
      group.add(m);
    }
    if (!poolGeo.empty) {
      const m = new THREE.Mesh(poolGeo.build(), this.mats.pool);
      m.renderOrder = 2;
      group.add(m);
    }
    return group;
  }

  building(G, i) {
    const m = this.map;
    const ring = m.buildingRing(i);
    const n = ring.length / 2;
    const type = m.bType[i];
    const h = m.bHeight[i];
    const area = m.bArea[i];
    const cx = m.bCx[i], cz = m.bCz[i];
    const r = hash1(i * 7 + 1);
    const hilly = onHill(cx, cz, 30);
    let ground = 0, minG = 0;
    if (hilly) {
      ground = heightAt(cx, cz);
      minG = ground;
      for (let k = 0; k < n; k++) minG = Math.min(minG, heightAt(ring[k * 2], ring[k * 2 + 1]));
    }
    const yb = minG - (hilly ? 1.5 : 0.3);
    const yt = ground + h;
    const inCore = this.core(cx, cz);

    // style & colour
    let style, wall;
    if (h > 28 && (type === 2 || type === 0 || type === 1)) { style = 2; wall = MODERN[(r * MODERN.length) | 0]; }
    else if (type === 1 && h < 8) { style = 3; wall = MUTED[(r * MUTED.length) | 0]; }
    else if (type === 4) { style = 0; wall = CIVIC[(r * CIVIC.length) | 0]; }
    else if (type === 3) { style = 3; wall = '#f4efe2'; }
    else if (type === 6) { style = 1; wall = '#b9bec4'; }
    else if (inCore) { style = r < 0.75 ? 0 : 1; wall = PASTEL[(hash1(i * 13) * PASTEL.length) | 0]; }
    else if (h < 7) { style = 3; wall = r < 0.4 ? PASTEL[(hash1(i * 13) * PASTEL.length) | 0] : MUTED[(r * MUTED.length) | 0]; }
    else { style = 1; wall = r < 0.55 ? PASTEL[(hash1(i * 13) * PASTEL.length) | 0] : MUTED[(r * MUTED.length) | 0]; }
    const wc = col(wall);
    const shade = 0.88 + hash1(i * 3) * 0.12;
    const su = style * 1000;

    let per = 0;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const dx = bx - ax, dz = bz - az;
      const L = Math.hypot(dx, dz);
      if (L < 0.01) continue;
      const nx = -dz / L, nz = dx / L;
      // a touch of directional shading so facades read well even under flat light
      const f = shade * (0.9 + 0.1 * nx);
      const u0 = su + per / 14.4, u1 = su + (per + L) / 14.4;
      const v0 = (yb - ground) / 13.2, v1 = h / 13.2;
      const a = G.v(ax, yb, az, nx, 0, nz, u0, v0, wc[0] * f, wc[1] * f, wc[2] * f);
      G.v(bx, yb, bz, nx, 0, nz, u1, v0, wc[0] * f, wc[1] * f, wc[2] * f);
      G.v(bx, yt, bz, nx, 0, nz, u1, v1, wc[0] * f, wc[1] * f, wc[2] * f);
      G.v(ax, yt, az, nx, 0, nz, u0, v1, wc[0] * f, wc[1] * f, wc[2] * f);
      G.quad(a, a + 1, a + 2, a + 3);
      per += L;
    }

    // roof
    const pitched = (type === 1 || type === 3 || (h < 7.5 && !inCore)) && area < 260 && n <= 8;
    if (pitched) {
      const rc = col(type === 3 ? '#c99a3a' : HOUSE_ROOFS[(hash1(i * 5) * HOUSE_ROOFS.length) | 0]);
      const ay = yt + Math.min(3.2, 0.32 * Math.sqrt(area));
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
        // face normal
        const ux = bx - ax, uz = bz - az;
        const vx = cx - ax, vy = ay - yt, vz = cz - az;
        let nx = 0 * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - 0 * vx;
        let flip = false;
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; flip = true; }
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        const s = 0.85 + 0.15 * ny;
        const v0 = G.v(ax, yt, az, nx, ny, nz, 0, -1, rc[0] * s, rc[1] * s, rc[2] * s);
        const v1 = G.v(bx, yt, bz, nx, ny, nz, 0, -1, rc[0] * s, rc[1] * s, rc[2] * s);
        const v2 = G.v(cx, ay, cz, nx, ny, nz, 0, -1, rc[0] * s, rc[1] * s, rc[2] * s);
        if (flip) G.tri(v0, v2, v1); else G.tri(v0, v1, v2);
      }
    } else {
      const rc = col(ROOFS[(hash1(i * 5) * ROOFS.length) | 0]);
      const base = G.count;
      for (let k = 0; k < n; k++) G.v(ring[k * 2], yt, ring[k * 2 + 1], 0, 1, 0, 0, -1, rc[0], rc[1], rc[2]);
      const tris = triangulate(ring);
      for (let k = 0; k < tris.length; k += 3) {
        const a = tris[k], b = tris[k + 1], c = tris[k + 2];
        // ensure upward facing
        const ax = ring[a * 2], az = ring[a * 2 + 1];
        const cr = (ring[b * 2 + 1] - az) * (ring[c * 2] - ax) - (ring[b * 2] - ax) * (ring[c * 2 + 1] - az);
        if (cr >= 0) G.tri(base + a, base + b, base + c); else G.tri(base + a, base + c, base + b);
      }
      // rooftop details on taller buildings: water tank / AC box
      if (h > 9 && area > 120 && hash1(i * 11) < 0.6) {
        box(G, cx + (hash1(i) - 0.5) * 4, yt, cz + (hash1(i + 9) - 0.5) * 4, 1.4, 1.6, 1.4, col('#9aa0a6'));
      }
    }
  }

  road(R, M, P, POOL, e, s0, s1) {
    const pts = this.slice(e, s0, s1);
    if (pts.length < 4) return;
    const cls = e.cls;
    const hw = ROAD_HALF[cls];
    const sw = SIDEWALK[cls];
    const asphaltTint = cls <= 1 ? 1.0 : cls <= 3 ? 0.97 : cls === 4 ? 0.94 : 1.05;
    if (cls >= 6) {
      ribbon(R, pts, hw, 0.07, 0, 0, [1.9, 1.75, 1.5], true);
      return;
    }
    if (sw > 0) ribbon(R, pts, hw + sw, 0.06, 0, 0, [2.05, 2.0, 1.9], true);
    ribbon(R, pts, hw, 0.09, 0, 0, [asphaltTint, asphaltTint, asphaltTint], true);

    // lane markings, trimmed near junctions
    if (cls <= 3) {
      const trimA = this.deg[e.a] >= 3 ? this.nodeHw[e.a] + 4 : 0;
      const trimB = this.deg[e.b] >= 3 ? this.nodeHw[e.b] + 4 : 0;
      const m0 = Math.max(s0, trimA), m1 = Math.min(s1, e.len - trimB);
      if (m1 - m0 > 3) {
        const mp = this.slice(e, m0, m1);
        const yellow = [0.95, 0.7, 0.08], white = [0.95, 0.95, 0.95];
        if (cls <= 1 && !e.oneway) {
          markLine(M, mp, 0.2, 0.08, yellow, m0, false);
          markLine(M, mp, -0.2, 0.08, yellow, m0, false);
          markLine(M, mp, hw - 0.5, 0.09, white, m0, false);
          markLine(M, mp, -hw + 0.5, 0.09, white, m0, false);
        } else {
          markLine(M, mp, 0, 0.09, white, m0, true);
          if (cls <= 1) {
            markLine(M, mp, hw - 0.5, 0.09, white, m0, false);
            markLine(M, mp, -hw + 0.5, 0.09, white, m0, false);
          }
        }
      }
    }

    // street lamps along the main roads
    if (cls <= 2 && e.len > 30) {
      const spacing = 38;
      const first = Math.ceil((s0 + 12) / spacing) * spacing;
      for (let s = first; s < s1 && s < e.len - 12; s += spacing) {
        const p = this.pointAt(e, s), q = this.pointAt(e, Math.min(e.len, s + 1));
        const dx = q[0] - p[0], dz = q[1] - p[1];
        const L = Math.hypot(dx, dz) || 1;
        const side = (Math.round(s / spacing) % 2) ? 1 : -1;
        const nx = (-dz / L) * side, nz = (dx / L) * side;
        const off = hw + Math.max(0.6, sw * 0.4);
        const x = p[0] + nx * off, z = p[1] + nz * off;
        const y = heightAt(x, z);
        // arm template points along +x; rotate to face the road
        const rot = Math.atan2(nz, -nx);
        P.addTemplate(TEMPLATES.lamp, x, y, z, rot, 1);
        const lx = x - nx * 2.6, lz = z - nz * 2.6;
        const S = 5.5, yy = heightAt(lx, lz) + 0.14;
        const b = POOL.count;
        POOL.v(lx - S, yy, lz - S, 0, 1, 0, 0, 0);
        POOL.v(lx + S, yy, lz - S, 0, 1, 0, 1, 0);
        POOL.v(lx + S, yy, lz + S, 0, 1, 0, 1, 1);
        POOL.v(lx - S, yy, lz + S, 0, 1, 0, 0, 1);
        POOL.tri(b, b + 2, b + 1); POOL.tri(b, b + 3, b + 2);
      }
    }
  }

  nodeDisc(R, n) {
    const x = this.map.nodeX[n], z = this.map.nodeZ[n];
    const hw = this.nodeHw[n], sw = this.nodeSw[n];
    if (hw <= 0) return;
    if (sw > 0) disc(R, x, z, hw + sw, 0.06, [2.05, 2.0, 1.9]);
    disc(R, x, z, hw, 0.09, [1, 1, 1]);
  }

  tree(P, i) {
    const x = this.map.trees[i], z = this.map.trees[i + 1];
    const h = hash2(x | 0, z | 0);
    const palm = h < 0.42;
    const y = heightAt(x, z);
    const s = 0.8 + hash1(i) * 0.5;
    P.addTemplate(palm ? TEMPLATES.palm : TEMPLATES.rain, x, y, z, h * 40, s);
  }
}

function box(G, x, y, z, sx, sy, sz, c) {
  const hx = sx / 2, hz = sz / 2;
  const faces = [
    [[1, 0, 0], [[hx, 0, -hz], [hx, 0, hz], [hx, sy, hz], [hx, sy, -hz]]],
    [[-1, 0, 0], [[-hx, 0, hz], [-hx, 0, -hz], [-hx, sy, -hz], [-hx, sy, hz]]],
    [[0, 0, 1], [[hx, 0, hz], [-hx, 0, hz], [-hx, sy, hz], [hx, sy, hz]]],
    [[0, 0, -1], [[-hx, 0, -hz], [hx, 0, -hz], [hx, sy, -hz], [-hx, sy, -hz]]],
    [[0, 1, 0], [[-hx, sy, -hz], [hx, sy, -hz], [hx, sy, hz], [-hx, sy, hz]]],
  ];
  for (const [nrm, vs] of faces) {
    const b = G.count;
    for (const v of vs) G.v(x + v[0], y + v[1], z + v[2], nrm[0], nrm[1], nrm[2], 0, -1, c[0], c[1], c[2]);
    // orientation: verify outward via cross product
    const a = vs[0], bb = vs[1], cc = vs[2];
    const ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2];
    const vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
    const cxp = uy * vz - uz * vy, cyp = uz * vx - ux * vz, czp = ux * vy - uy * vx;
    if (cxp * nrm[0] + cyp * nrm[1] + czp * nrm[2] >= 0) G.quad(b, b + 1, b + 2, b + 3);
    else G.quad(b, b + 3, b + 2, b + 1);
  }
}

// Road ribbon with mitred joins. World-space UVs so overlapping roads blend seamlessly.
export function ribbon(G, pts, hw, lift, _u, _v, color, worldUV) {
  const n = pts.length / 2;
  let prevL = -1, prevR = -1;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1];
    let tx, tz;
    if (i === 0) { tx = pts[2] - x; tz = pts[3] - z; }
    else if (i === n - 1) { tx = x - pts[i * 2 - 2]; tz = z - pts[i * 2 - 1]; }
    else {
      let ax = x - pts[i * 2 - 2], az = z - pts[i * 2 - 1];
      let bx = pts[i * 2 + 2] - x, bz = pts[i * 2 + 3] - z;
      const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
      ax /= la; az /= la; bx /= lb; bz /= lb;
      tx = ax + bx; tz = az + bz;
      if (Math.hypot(tx, tz) < 1e-3) { tx = ax; tz = az; }
    }
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    let nx = -tz, nz = tx;
    let w = hw;
    if (i > 0 && i < n - 1) {
      const sx = pts[i * 2 + 2] - x, sz = pts[i * 2 + 3] - z;
      const sl = Math.hypot(sx, sz) || 1;
      const cosHalf = Math.abs((sx / sl) * tx + (sz / sl) * tz);
      w = hw / Math.max(0.5, cosHalf);
    }
    const lx = x + nx * w, lz = z + nz * w, rx = x - nx * w, rz = z - nz * w;
    const ly = heightAt(lx, lz) + lift, ry = heightAt(rx, rz) + lift;
    const L = G.v(lx, ly, lz, 0, 1, 0, lx / 7, lz / 7, color[0], color[1], color[2]);
    const Rr = G.v(rx, ry, rz, 0, 1, 0, rx / 7, rz / 7, color[0], color[1], color[2]);
    if (prevL >= 0) {
      G.tri(prevL, L, prevR);
      G.tri(prevR, L, Rr);
    }
    prevL = L; prevR = Rr;
  }
}

function disc(G, x, z, r, lift, color) {
  const seg = 12;
  const y = heightAt(x, z) + lift;
  const c = G.v(x, y, z, 0, 1, 0, x / 7, z / 7, color[0], color[1], color[2]);
  for (let k = 0; k < seg; k++) {
    const a = (k / seg) * Math.PI * 2;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    G.v(px, heightAt(px, pz) + lift, pz, 0, 1, 0, px / 7, pz / 7, color[0], color[1], color[2]);
  }
  for (let k = 0; k < seg; k++) G.tri(c, c + 1 + ((k + 1) % seg), c + 1 + k);
}

function markLine(G, pts, offset, halfW, color, sStart, dashed) {
  const n = pts.length / 2;
  let s = sStart;
  let pl = -1, pr = -1;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2], z = pts[i * 2 + 1];
    if (i > 0) s += Math.hypot(x - pts[i * 2 - 2], z - pts[i * 2 - 1]);
    let tx, tz;
    if (i < n - 1) { tx = pts[i * 2 + 2] - x; tz = pts[i * 2 + 3] - z; } else { tx = x - pts[i * 2 - 2]; tz = z - pts[i * 2 - 1]; }
    const tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl;
    const cx = x + nx * offset, cz = z + nz * offset;
    const v = dashed ? s / 9 : 0.25;
    const lx = cx + nx * halfW, lz = cz + nz * halfW, rx = cx - nx * halfW, rz = cz - nz * halfW;
    const L = G.v(lx, heightAt(lx, lz) + 0.11, lz, 0, 1, 0, 0, v, color[0], color[1], color[2]);
    const R = G.v(rx, heightAt(rx, rz) + 0.11, rz, 0, 1, 0, 1, v, color[0], color[1], color[2]);
    if (pl >= 0) { G.tri(pl, L, pr); G.tri(pr, L, R); }
    pl = L; pr = R;
  }
}

// Triangulate a simple polygon ring (flat [x,z,...]); fan for convex rings.
const _v2 = [];
export function triangulate(ring) {
  const n = ring.length / 2;
  if (n === 3) return [0, 1, 2];
  let convex = true, sign = 0;
  for (let i = 0; i < n && convex; i++) {
    const a = i, b = (i + 1) % n, c = (i + 2) % n;
    const cr = (ring[b * 2] - ring[a * 2]) * (ring[c * 2 + 1] - ring[b * 2 + 1]) - (ring[b * 2 + 1] - ring[a * 2 + 1]) * (ring[c * 2] - ring[b * 2]);
    if (Math.abs(cr) < 1e-6) continue;
    const s = Math.sign(cr);
    if (sign === 0) sign = s; else if (s !== sign) convex = false;
  }
  if (convex) {
    const out = [];
    for (let i = 1; i < n - 1; i++) out.push(0, i, i + 1);
    return out;
  }
  _v2.length = 0;
  for (let i = 0; i < n; i++) _v2.push(new THREE.Vector2(ring[i * 2], ring[i * 2 + 1]));
  const faces = THREE.ShapeUtils.triangulateShape(_v2, []);
  const out = [];
  for (const f of faces) out.push(f[0], f[1], f[2]);
  return out;
}
