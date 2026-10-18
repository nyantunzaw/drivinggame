// Streams the city around the player in CHUNK x CHUNK tiles: buildings, roads,
// lane markings, trees and street lamps are merged per tile (few draw calls).
import * as THREE from 'three';
import { CHUNK, ROAD_HALF, SIDEWALK } from '../config.js';
import { heightAt, onHill } from '../terrain.js';
import { hash1, hash2, pointInPoly } from '../util.js';
import { Geo } from './geo.js';
import { TEMPLATES } from './props.js';
import { STYLE, signUV } from '../facades.js';
import { shopfront } from './shops.js';
import { findMedians } from './medians.js';

// Real-world inspired palettes: faded colonial stucco, Chinatown pastels, concrete.
const DOWNTOWN = ['#efe4cf', '#e9d9b8', '#dfe6dc', '#e8d2c8', '#d8dfe6', '#efe9de', '#e6dcb0', '#d9cbb5', '#f2e8d8', '#cfe0da'];
const CHINA = ['#e8dcc4', '#d9e3d0', '#e6d3c3', '#cfdde3', '#efe6c8', '#e3c9c4', '#d6d0e0', '#f0eee8', '#dfe8c8', '#f2dcc0'];
const MUTED = ['#e9e1d0', '#d8cdb8', '#c9b8a0', '#e0d6c8', '#bcc9b0', '#d9c7b5', '#e8d9c4', '#cfd6d8'];
const MODERN = ['#e8eef2', '#d0dbe4', '#f2f2ee', '#c4d2dc', '#e6e0d8', '#d8d4cc'];
const ROOFS = ['#8c8a84', '#7f7c75', '#96938b', '#77736c', '#a19d94'];
const HOUSE_ROOFS = ['#8f4b35', '#7b7f80', '#9a9890', '#6e3b2c', '#a0603e'];
const TANKS = ['#2a4f86', '#1f1f22', '#e8e6e0', '#3d6b8f', '#2a4f86'];
const AWNINGS = ['#2f6db3', '#b8352f', '#3a8a52', '#e07b2a', '#1d4f8a', '#c9a23a', '#8a8f96'];
const ST = STYLE;

const tmpColor = new THREE.Color();
const colCache = new Map();
function col(hex) {
  let c = colCache.get(hex);
  if (!c) { tmpColor.set(hex); c = [tmpColor.r, tmpColor.g, tmpColor.b]; colCache.set(hex, c); }
  return c;
}
const SHOP_STYLES = new Set([ST.colonial, ST.apartment, ST.chinaA, ST.chinaB, ST.office]);
const MEDIAN = { top: col('#a9a59b'), yellow: col('#e8b923'), black: col('#1f1f1f'), rail: col('#3d8a5a'), mesh: col('#5f9e76') };

export class ChunkManager {
  constructor(scene, map, mats, quality, ctx) {
    this.scene = scene;
    this.map = map;
    this.mats = mats;
    this.quality = quality;
    this.core = ctx.core;         // downtown test fn
    this.china = ctx.china;       // Chinatown (Latha) test fn
    this.collision = ctx.collision;
    this.detail = quality.detail !== false;
    const { x0, z0, x1, z1 } = map.bounds;
    this.gx0 = x0; this.gz0 = z0;
    this.nx = Math.ceil((x1 - x0) / CHUNK);
    this.nz = Math.ceil((z1 - z0) / CHUNK);
    this.cells = Array.from({ length: this.nx * this.nz }, () => ({ b: [], r: [], t: [], n: [], stalls: [], med: [], medLamps: [] }));
    this.loaded = new Map();
    this.stupaSet = new Set();
    this._index();
  }

  key(cx, cz) { return cz * this.nx + cx; }

  // Real shopfronts (see shops.js): per-building frontage list and the street strip they cover.
  setShops(data) {
    this.shopFronts = data.byBuilding;
    this.shopStrip = data.strip;
  }

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
    // central dividers on divided roads (Maha Bandula, Strand, Pyay Road...), solid to cars
    this.medianCount = 0;
    const medians = findMedians(m, this.deg);
    for (const lp of medians.lamps) { const c = this.cellAt(lp[0], lp[1]); if (c) c.medLamps.push(lp); }
    for (const sg of medians.segs) {
      const mx = (sg[0] + sg[2]) / 2, mz = (sg[1] + sg[3]) / 2;
      const L = Math.hypot(sg[2] - sg[0], sg[3] - sg[1]);
      if (L < 0.2) continue;
      const c = this.cellAt(mx, mz);
      if (c) c.med.push(sg);
      if (this.collision) this.collision.addBox(mx, mz, L / 2 + 0.05, sg[4] / 2, Math.atan2(sg[3] - sg[1], sg[2] - sg[0]));
      this.medianCount++;
    }
    this._stalls();
    const keep = this.quality.trees;
    for (let i = 0; i < m.trees.length; i += 2) {
      if (hash1(i) > keep) continue;
      if (this.china(m.trees[i], m.trees[i + 1]) && hash1(i + 7) > 0.3) continue; // few trees in Chinatown's streets
      const c = this.cellAt(m.trees[i], m.trees[i + 1]);
      if (c) c.t.push(i);
    }
  }

  // Evening BBQ stalls along 19th Street (Chinatown), with colliders.
  _stalls() {
    const P = [];
    for (const e of this.map.edges) {
      if (!e.name || !/^19th Street$/.test(e.name) || e.cls > 5) continue;
      const mid = this.pointAt(e, e.len / 2);
      if (!this.china(mid[0], mid[1])) continue;
      for (let s = 6; s < e.len - 6; s += 5.5) {
        const p = this.pointAt(e, s), q = this.pointAt(e, Math.min(e.len, s + 1));
        const dx = q[0] - p[0], dz = q[1] - p[1];
        const L = Math.hypot(dx, dz) || 1;
        for (const side of [-1, 1]) {
          const nx = (-dz / L) * side, nz = (dx / L) * side;
          const off = ROAD_HALF[e.cls] - 0.6;
          const x = p[0] + nx * off, z = p[1] + nz * off;
          if (this.collision.buildingAt(x, z) >= 0) continue;
          P.push({ x, z, rot: Math.atan2(dx, dz), seed: hash2(x | 0, z | 0), grill: ((s / 5.5) | 0) % 3 === 0 });
        }
      }
    }
    for (const st of P) {
      const c = this.cellAt(st.x, st.z);
      if (c) c.stalls.push(st);
      this.collision.addCircle(st.x, st.z, 0.9);
    }
    this.stallCount = P.length;
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
    const sGeo = new Geo({ color: false });
    const pGeo = new Geo({ uv: false, glow: true });
    const shopGeo = new Geo({ color: false });
    let n = 0;
    for (const i of cell.b) { this.building(bGeo, sGeo, i, pGeo, shopGeo); if (++n % 30 === 0) yield; }
    if (!bGeo.empty) {
      const mesh = new THREE.Mesh(bGeo.build(), this.mats.building);
      mesh.castShadow = this.quality.shadows;
      mesh.receiveShadow = this.quality.shadows;
      group.add(mesh);
    }
    if (!sGeo.empty) group.add(new THREE.Mesh(sGeo.build(), this.mats.signs));
    if (!shopGeo.empty && this.mats.shopSigns) group.add(new THREE.Mesh(shopGeo.build(), this.mats.shopSigns));
    yield;
    this._wires = [];
    const rGeo = new Geo();
    const mGeo = new Geo();
    const poolGeo = new Geo({ color: false });
    n = 0;
    for (const [e, s0, s1] of cell.r) { this.road(rGeo, mGeo, pGeo, poolGeo, e, s0, s1); if (++n % 30 === 0) yield; }
    for (const nd of cell.n) this.nodeDisc(rGeo, nd);
    for (const sg of cell.med) this.median(pGeo, sg);
    if (this.detail) for (const lp of cell.medLamps) this.medianLamp(pGeo, poolGeo, lp);
    yield;
    n = 0;
    for (const i of cell.t) { this.tree(pGeo, i); if (++n % 60 === 0) yield; }
    for (const st of cell.stalls) this.stall(pGeo, st);
    if (this._wires.length) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(this._wires, 3));
      group.add(new THREE.LineSegments(wg, this.mats.wires));
    }
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

  building(G, S, i, P, R) {
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
    const china = this.china(cx, cz);
    const core = china || this.core(cx, cz);
    const heritage = type === 7 || type === 8;

    // facade style & palette
    let style, pal;
    if (type === 7) { style = ST.brick; pal = ['#f6f0ea']; }
    else if (type === 8) { style = ST.colonial; pal = ['#f2ead6', '#efe6cf', '#f6f1e6']; }
    else if (h > 30) { style = r < 0.55 ? ST.glass : ST.office; pal = MODERN; }
    else if (china) { style = r < 0.5 ? ST.chinaA : ST.chinaB; pal = CHINA; }
    else if (type === 6) { style = ST.blank; pal = ['#b9bec4', '#a9aeb2', '#c4c0b6']; }
    else if (core) { style = h > 16 && r < 0.18 ? ST.office : r < 0.62 ? ST.colonial : ST.apartment; pal = DOWNTOWN; }
    else if (type === 4) { style = ST.colonial; pal = ['#efe4cf', '#e9dcc0', '#f2ead6']; }
    else if (type === 3) { style = ST.house; pal = ['#f4efe2', '#efe8d8']; }
    else if ((type === 1 && h < 8) || h < 7) { style = ST.house; pal = r < 0.4 ? DOWNTOWN : MUTED; }
    else { style = ST.apartment; pal = r < 0.5 ? DOWNTOWN : MUTED; }
    const baseCol = col(pal[(hash1(i * 13) * pal.length) | 0]);
    const shade = 0.9 + hash1(i * 3) * 0.1;
    const gTop = Math.min(yt, ground + 3.3);
    const pitched = (type === 1 || type === 3 || (h < 7.5 && !core)) && area < 260 && n <= 8;
    const parapet = !pitched && h > 5 && style !== ST.glass;
    const detail = this.detail;
    // real shops on this building (Chinatown strip) replace the made-up signs there
    const fronts = this.shopFronts ? this.shopFronts.get(i) : null;
    const strip = this.shopStrip ? this.shopStrip(cx, cz) : false;

    let per = 0, longest = 0, ang = 0;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const dx = bx - ax, dz = bz - az;
      const L = Math.hypot(dx, dz);
      if (L < 0.01) continue;
      if (L > longest) { longest = L; ang = Math.atan2(dx, dz); }
      const nx = -dz / L, nz = dx / L;
      // does this wall face a street? (otherwise it is a blank party/back wall in town)
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      let rc = 0;
      for (const d of [2.5, 6, 10]) { rc = this.collision.roadAt(mx + nx * d, mz + nz * d); if (rc) break; }
      const front = rc > 0;
      let wStyle = style;
      if (!front && core && !heritage && style !== ST.glass && style !== ST.office) wStyle = ST.blank;

      const real = front && fronts ? fronts.filter((f) => f.k === k) : null;
      if (real && real.length) {
        let seed = i * 977 + k * 31;
        const rnd = () => hash1(seed++);
        for (const f of real) shopfront(G, P, R, ax, az, dx / L, dz / L, nx, nz, f, ground, h, detail, rnd);
      }
      const taken = (t0, t1) => real && real.some((f) => !f.shop.up && f.t0 < t1 * L && f.t1 > t0 * L);

      // town frontages are split into individual shophouses with their own paint
      let segs = 1;
      if (front && core && !heritage && L > 8 && wStyle !== ST.glass) segs = Math.max(2, Math.round(L / (4.5 + hash1(i * 31 + k) * 2.5)));
      for (let q = 0; q < segs; q++) {
        const t0 = q / segs, t1 = (q + 1) / segs;
        const sx0 = ax + dx * t0, sz0 = az + dz * t0, sx1 = ax + dx * t1, sz1 = az + dz * t1;
        const segLen = L * (t1 - t0);
        let c = baseCol, sStyle = wStyle;
        const hs = hash1(i * 101 + k * 13 + q);
        if (segs > 1) {
          c = col(pal[(hs * pal.length) | 0]);
          if (wStyle === ST.chinaA || wStyle === ST.chinaB) sStyle = hs < 0.5 ? ST.chinaA : ST.chinaB;
          else if (wStyle === ST.colonial || wStyle === ST.apartment) sStyle = hs < 0.6 ? ST.colonial : ST.apartment;
        }
        const f = shade * (0.9 + 0.1 * nx);
        const su = sStyle * 1000;
        const u0 = su + (per + L * t0) / 14.4, u1 = su + (per + L * t1) / 14.4;
        // ground floor darker at the bottom (street grime, ambient occlusion)
        wallQuad(G, sx0, sz0, sx1, sz1, yb, gTop, nx, nz, u0, u1, (yb - ground) / 3.3, (gTop - ground) / 3.3, c, f * 0.68, f * 0.95);
        if (yt > gTop + 0.01) wallQuad(G, sx0, sz0, sx1, sz1, gTop, yt, nx, nz, u0, u1, (gTop - ground) / 3.3, h / 3.3, c, f * 0.95, f);
        if (parapet) {
          const ph = 0.6 + hash1(i * 17 + q) * 0.6;
          wallQuad(G, sx0, sz0, sx1, sz1, yt, yt + ph, nx, nz, 0, 0, -1, -1, c, f * 0.86, f * 0.9);
          wallQuad(G, sx1, sz1, sx0, sz0, yt, yt + ph, -nx, -nz, 0, 0, -1, -1, c, 0.55, 0.6);
        }
        if (detail && front && SHOP_STYLES.has(sStyle) && (core || rc <= 3) && h >= 4) {
          const own = taken(t0, t1);
          if (!own && hash1(i * 57 + k * 7 + q) < (china ? 0.55 : core ? 0.35 : 0.12) && segLen > 2.2) {
            awning(G, sx0, sz0, sx1, sz1, nx, nz, ground, col(AWNINGS[(hash1(i * 5 + q) * AWNINGS.length) | 0]));
          }
          if (!strip && hash1(i * 73 + k * 5 + q) < (china ? 0.85 : core ? 0.4 : 0.15) && segLen > 2.4 && h > 4.5) {
            hSign(S, sx0, sz0, sx1, sz1, nx, nz, ground, (hash1(i * 37 + q) * 16) | 0);
          }
          if (!strip && hash1(i * 91 + k * 3 + q) < (china ? 0.5 : core ? 0.12 : 0) && h > 7) {
            vSign(S, sx0, sz0, sx1, sz1, nx, nz, ground, (hash1(i * 43 + q) * 16) | 0, hash1(i + q) < 0.5);
          }
        }
      }
      per += L;
    }

    // roof
    if (pitched) {
      const rc = col(type === 3 ? '#c99a3a' : HOUSE_ROOFS[(hash1(i * 5) * HOUSE_ROOFS.length) | 0]);
      const ay = yt + Math.min(3.2, 0.32 * Math.sqrt(area));
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
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
      return;
    }
    const rc = col(ROOFS[(hash1(i * 5) * ROOFS.length) | 0]);
    const base = G.count;
    for (let k = 0; k < n; k++) G.v(ring[k * 2], yt, ring[k * 2 + 1], 0, 1, 0, 0, -1, rc[0], rc[1], rc[2]);
    const tris = triangulate(ring);
    for (let k = 0; k < tris.length; k += 3) {
      const a = tris[k], b = tris[k + 1], c = tris[k + 2];
      const ax = ring[a * 2], az = ring[a * 2 + 1];
      const cr = (ring[b * 2 + 1] - az) * (ring[c * 2] - ax) - (ring[b * 2] - ax) * (ring[c * 2 + 1] - az);
      if (cr >= 0) G.tri(base + a, base + b, base + c); else G.tri(base + a, base + c, base + b);
    }
    if (!detail || h < 6 || style === ST.glass) return;
    // rooftop clutter: water tanks, a stair house, satellite dish, AC condensers
    const spot = (seed) => {
      const rr = Math.sqrt(area) * 0.32;
      for (let t = 0; t < 6; t++) {
        const x = cx + (hash1(seed + t * 3) - 0.5) * 2 * rr, z = cz + (hash1(seed + t * 3 + 1) - 0.5) * 2 * rr;
        if (pointInPoly(ring, x, z)) return [x, z];
      }
      return null;
    };
    const tanks = area < 60 ? 0 : area < 160 ? (hash1(i * 19) < 0.6 ? 1 : 0) : 1 + ((hash1(i * 19) * 2.2) | 0);
    for (let t = 0; t < tanks; t++) {
      const p = spot(i * 211 + t * 17);
      if (!p) continue;
      const tr = 0.55 + hash1(i + t) * 0.35;
      gbox(G, p[0], yt, p[1], tr * 1.6, 0.45, tr * 1.6, ang, col('#5b5e60'), 0, -1);
      gcyl(G, p[0], yt + 0.45, p[1], tr, 1.1 + hash1(i * 3 + t) * 0.8, 6, col(TANKS[(hash1(i * 7 + t) * TANKS.length) | 0]), 0, -1);
    }
    if (h > 14 && area > 160 && hash1(i * 23) < 0.6) {
      const p = spot(i * 307);
      if (p) gbox(G, p[0], yt, p[1], 2.6, 2.5, 2.8, ang, [baseCol[0] * 0.85, baseCol[1] * 0.85, baseCol[2] * 0.85], 0, -1);
    }
    if (hash1(i * 29) < 0.4) {
      const p = spot(i * 401);
      if (p) {
        gbox(G, p[0], yt, p[1], 0.08, 1.1, 0.08, 0, col('#777'), 0, -1);
        gbox(G, p[0], yt + 0.9, p[1], 0.9, 0.9, 0.1, 0.6, col('#e9e9e4'), 0, -1);
      }
    }
    for (let t = 0; t < ((hash1(i * 31) * 3) | 0); t++) {
      const p = spot(i * 503 + t * 11);
      if (p) gbox(G, p[0], yt, p[1], 0.85, 0.6, 0.45, ang, col('#c9c9c4'), 0, -1);
    }
  }

  stall(P, st) {
    const { x, z, rot, seed } = st;
    const y = heightAt(x, z);
    const fx = Math.sin(rot), fz = Math.cos(rot), lx = Math.cos(rot), lz = -Math.sin(rot);
    gbox(P, x, y, z, 0.75, 0.74, 1.5, rot, col(seed < 0.5 ? '#e8e8e0' : '#7fb3d5'));
    const stools = ['#d9312b', '#2b6fd1', '#d9312b', '#e8b923'];
    for (let k = 0; k < 4; k++) {
      const a = (k < 2 ? -0.62 : 0.62), b = (k % 2 ? -0.45 : 0.45);
      gbox(P, x + lx * a + fx * b, y, z + lz * a + fz * b, 0.32, 0.42, 0.32, rot, col(stools[(k + ((seed * 4) | 0)) % 4]));
    }
    gcyl(P, x, y, z, 0.03, 2.25, 4, col('#cfcfcf'));
    gcone(P, x, y + 1.85, z, 1.35, 0.5, 6, col(['#d9534f', '#2f6db3', '#f2f2ee', '#e8b923'][(seed * 4) | 0]));
    if (st.grill) {
      const gx = x + fx * 1.25, gz = z + fz * 1.25;
      gbox(P, gx, y, gz, 0.6, 0.85, 1.2, rot, col('#3a3a3a'));
      gbox(P, gx, y + 0.85, gz, 0.45, 0.06, 1.0, rot, col('#ff6a2a'), 1);
      gbox(P, gx, y + 2.1, gz, 0.12, 0.12, 0.12, rot, col('#fff2c8'), 1);
    }
  }

  // Concrete poles and the famous tangle of overhead cables along downtown streets.
  powerLines(P, e, s0, s1, hw, sw) {
    const side = e.id % 2 ? 1 : -1;
    const off = hw + Math.max(0.5, sw * 0.75);
    const spacing = 30;
    const poles = [];
    for (let s = Math.ceil((s0 + 4) / spacing) * spacing; s < s1 - 1 && s < e.len - 4; s += spacing) {
      const p = this.pointAt(e, s), q = this.pointAt(e, Math.min(e.len, s + 1));
      const dx = q[0] - p[0], dz = q[1] - p[1];
      const L = Math.hypot(dx, dz) || 1;
      const nx = (-dz / L) * side, nz = (dx / L) * side;
      const x = p[0] + nx * off, z = p[1] + nz * off;
      const y = heightAt(x, z);
      const ang = Math.atan2(dx, dz);
      gbox(P, x, y, z, 0.24, 9.2, 0.24, ang, col('#9a9a94'));
      gbox(P, x, y + 8.7, z, 1.9, 0.12, 0.12, ang, col('#6f6f6a'));
      if (((s / spacing) | 0) % 3 === 0) gbox(P, x + nx * 0.35, y + 6.2, z + nz * 0.35, 0.55, 0.9, 0.5, ang, col('#55595c'));
      poles.push({ x, z, y, nx, nz });
      // service drops to the buildings
      for (let k = 0; k < 2; k++) {
        if (hash1(e.id * 13 + s + k) < 0.5) continue;
        const along = (hash1(e.id + s * 3 + k) - 0.5) * 16;
        const tx = x + nx * (sw + 1.4) + (dx / L) * along, tz = z + nz * (sw + 1.4) + (dz / L) * along;
        sag(this._wires, x, y + 7.9, z, tx, y + 5.6 + hash1(s + k) * 1.5, tz, 0.3);
      }
    }
    for (let k = 1; k < poles.length; k++) {
      const a = poles[k - 1], b = poles[k];
      for (const o of [-0.85, 0, 0.85]) {
        const ox = -a.nz * o, oz = a.nx * o;
        sag(this._wires, a.x + ox, a.y + 8.78, a.z + oz, b.x + ox, b.y + 8.78, b.z + oz, 0.45);
      }
      sag(this._wires, a.x, a.y + 6.1, a.z, b.x, b.y + 6.1, b.z, 0.9);
      sag(this._wires, a.x, a.y + 6.5, a.z, b.x, b.y + 6.5, b.z, 1.1);
    }
  }

  // Red lanterns strung across Chinatown's streets.
  lanterns(P, e, s0, s1, hw, sw) {
    const red = col('#d2231c'), gold = col('#e8b923');
    for (let s = Math.ceil((s0 + 3) / 12) * 12; s < s1 && s < e.len - 6; s += 12) {
      const p = this.pointAt(e, s), q = this.pointAt(e, Math.min(e.len, s + 1));
      const dx = q[0] - p[0], dz = q[1] - p[1];
      const L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L, nz = dx / L;
      const w = hw + sw - 0.3;
      const y = heightAt(p[0], p[1]) + 7.2;
      const ax = p[0] - nx * w, az = p[1] - nz * w, bx = p[0] + nx * w, bz = p[1] + nz * w;
      sag(this._wires, ax, y, az, bx, y, bz, 0.45);
      const count = 3 + ((hash1(e.id + s) * 3) | 0);
      for (let k = 1; k <= count; k++) {
        const t = k / (count + 1);
        const lx = ax + (bx - ax) * t, lz = az + (bz - az) * t;
        const ly = y - 0.45 * 4 * t * (1 - t) - 0.55;
        gcyl(P, lx, ly - 0.02, lz, 0.25, 0.38, 6, red, 0.9);
        gbox(P, lx, ly - 0.1, lz, 0.26, 0.08, 0.26, 0, gold);
        gbox(P, lx, ly - 0.42, lz, 0.05, 0.32, 0.05, 0, gold);
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
        if (e.median && cls <= 2) {
          // divided road: lane line, white edge on the kerb side, yellow edge along the island
          const md = e.median;
          markLine(M, mp, 0, 0.09, white, m0, true);
          markLine(M, mp, -md.side * (hw - 0.5), 0.09, white, m0, false);
          if (md.dist > 1.6) markLine(M, mp, md.side * (md.dist - 0.95), 0.08, yellow, m0, false);
        } else if (cls <= 1 && !e.oneway) {
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
        const side = e.median ? -e.median.side : (Math.round(s / spacing) % 2) ? 1 : -1;
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

    // downtown street furniture
    if (this.detail && cls >= 2 && cls <= 4) {
      const mid = this.pointAt(e, (s0 + s1) / 2);
      const china = this.china(mid[0], mid[1]);
      if (china || this.core(mid[0], mid[1])) this.powerLines(P, e, s0, s1, hw, sw);
      if (china && cls >= 3) this.lanterns(P, e, s0, s1, hw, sw);
    }
  }

  // Kerbed central island: concrete top, black-and-yellow painted kerb faces and a steel
  // railing with mesh panels. Pieces are straight runs of up to 30 m.
  median(P, sg) {
    const [x0, z0, x1, z1, w] = sg;
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    if (L < 0.2) return;
    const tx = dx / L, tz = dz / L, nx = -tz, nz = tx;
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const y = heightAt(mx, mz) + 0.09, H = 0.22;
    const ang = Math.atan2(-tz, tx); // gbox local x runs along the island
    gbox(P, mx, y, mz, L + 0.04, H, w, ang, MEDIAN.top);
    // kerb faces painted in 1.2 m bands (continuous along the road, so pieces line up)
    const s0 = x0 * tx + z0 * tz;
    const k0 = Math.floor(s0 / 1.2), k1 = Math.ceil((s0 + L) / 1.2);
    for (const sd of [-1, 1]) {
      const ox = nx * sd * (w / 2 + 0.006), oz = nz * sd * (w / 2 + 0.006);
      const fnx = nx * sd, fnz = nz * sd;
      for (let k = k0; k < k1; k++) {
        const a = Math.max(0, k * 1.2 - s0), b = Math.min(L, (k + 1) * 1.2 - s0);
        if (b - a < 0.02) continue;
        const c = (k & 1) ? MEDIAN.yellow : MEDIAN.black;
        const ax = x0 + tx * a + ox, az = z0 + tz * a + oz, bx = x0 + tx * b + ox, bz = z0 + tz * b + oz;
        const v = P.v(ax, y, az, fnx, 0, fnz, 0, 0, c[0], c[1], c[2], 0);
        P.v(bx, y, bz, fnx, 0, fnz, 0, 0, c[0], c[1], c[2], 0);
        P.v(bx, y + H, bz, fnx, 0, fnz, 0, 0, c[0], c[1], c[2], 0);
        P.v(ax, y + H, az, fnx, 0, fnz, 0, 0, c[0], c[1], c[2], 0);
        // face outward: (b - a) x up must point along the face normal
        if ((bx - ax) * -fnz + (bz - az) * fnx > 0) P.quad(v, v + 3, v + 2, v + 1); else P.quad(v, v + 1, v + 2, v + 3);
      }
    }
    if (!this.detail) return;
    const posts = Math.max(1, Math.round(L / 3));
    for (let q = 0; q <= posts; q++) {
      const a = (q / posts) * L;
      gbox(P, x0 + tx * a, y + H, z0 + tz * a, 0.07, 1.05, 0.07, ang, MEDIAN.rail);
    }
    gbox(P, mx, y + H + 0.98, mz, L, 0.07, 0.06, ang, MEDIAN.rail);
    gbox(P, mx, y + H + 0.15, mz, L, 0.8, 0.02, ang, MEDIAN.mesh); // wire mesh panels
  }

  // Double-arm lamp post on the island, lighting both carriageways.
  medianLamp(P, POOL, lp) {
    const [x, z, tx, tz] = lp;
    const nx = -tz, nz = tx;
    const g0 = heightAt(x, z);
    for (const sd of [-1, 1]) {
      const ax = nx * sd, az = nz * sd; // arm reaches out over each carriageway
      P.addTemplate(TEMPLATES.lamp, x, g0 + 0.3, z, Math.atan2(-az, ax), 1);
      const lx = x + ax * 2.6, lz = z + az * 2.6;
      const S = 5.5, yy = heightAt(lx, lz) + 0.14;
      const b = POOL.count;
      POOL.v(lx - S, yy, lz - S, 0, 1, 0, 0, 0);
      POOL.v(lx + S, yy, lz - S, 0, 1, 0, 1, 0);
      POOL.v(lx + S, yy, lz + S, 0, 1, 0, 1, 1);
      POOL.v(lx - S, yy, lz + S, 0, 1, 0, 0, 1);
      POOL.tri(b, b + 2, b + 1); POOL.tri(b, b + 3, b + 2);
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

// Wall quad with a vertical colour gradient (f0 at y0, f1 at y1). uv.y < -0.5 = untextured.
function wallQuad(G, ax, az, bx, bz, y0, y1, nx, nz, u0, u1, v0, v1, c, f0, f1) {
  const a = G.v(ax, y0, az, nx, 0, nz, u0, v0, c[0] * f0, c[1] * f0, c[2] * f0);
  G.v(bx, y0, bz, nx, 0, nz, u1, v0, c[0] * f0, c[1] * f0, c[2] * f0);
  G.v(bx, y1, bz, nx, 0, nz, u1, v1, c[0] * f1, c[1] * f1, c[2] * f1);
  G.v(ax, y1, az, nx, 0, nz, u0, v1, c[0] * f1, c[1] * f1, c[2] * f1);
  G.quad(a, a + 1, a + 2, a + 3);
}

// Shop awning / tarp sloping out over the pavement.
function awning(G, ax, az, bx, bz, nx, nz, ground, c) {
  const L = Math.hypot(bx - ax, bz - az);
  const tx = (bx - ax) / L, tz = (bz - az) / L;
  const i0 = 0.2, i1 = L - 0.2;
  const p0x = ax + tx * i0, p0z = az + tz * i0, p1x = ax + tx * i1, p1z = az + tz * i1;
  const out = 1.4, yIn = ground + 3.05, yOut = ground + 2.65;
  const ny = 0.95, sx = nx * 0.3, sz = nz * 0.3;
  let a = G.v(p0x, yIn, p0z, sx, ny, sz, 0, -1, c[0], c[1], c[2]);
  G.v(p0x + nx * out, yOut, p0z + nz * out, sx, ny, sz, 0, -1, c[0], c[1], c[2]);
  G.v(p1x + nx * out, yOut, p1z + nz * out, sx, ny, sz, 0, -1, c[0], c[1], c[2]);
  G.v(p1x, yIn, p1z, sx, ny, sz, 0, -1, c[0], c[1], c[2]);
  // orientation: (v1 - v0) x (v3 - v0) must point up
  const ux = nx * out, uy = yOut - yIn, uz = nz * out, wx = p1x - p0x, wz = p1z - p0z;
  const cy = uz * wx - ux * wz;
  if (cy >= 0) G.quad(a, a + 1, a + 2, a + 3); else G.quad(a, a + 3, a + 2, a + 1);
  const d = 0.78;
  a = G.v(p0x, yIn - 0.02, p0z, -sx, -ny, -sz, 0, -1, c[0] * d, c[1] * d, c[2] * d);
  G.v(p0x + nx * out, yOut - 0.02, p0z + nz * out, -sx, -ny, -sz, 0, -1, c[0] * d, c[1] * d, c[2] * d);
  G.v(p1x + nx * out, yOut - 0.02, p1z + nz * out, -sx, -ny, -sz, 0, -1, c[0] * d, c[1] * d, c[2] * d);
  G.v(p1x, yIn - 0.02, p1z, -sx, -ny, -sz, 0, -1, c[0] * d, c[1] * d, c[2] * d);
  if (cy >= 0) G.quad(a, a + 3, a + 2, a + 1); else G.quad(a, a + 1, a + 2, a + 3);
  // front valance
  wallQuad(G, p0x + nx * out, p0z + nz * out, p1x + nx * out, p1z + nz * out, yOut - 0.28, yOut, nx, nz, 0, 0, -1, -1, c, 0.85, 0.9);
}

// Horizontal shop sign above the ground floor (texture from the sign atlas).
function hSign(S, ax, az, bx, bz, nx, nz, ground, idx) {
  const L = Math.hypot(bx - ax, bz - az);
  const w = Math.min(L * 0.86, 7.2), hgt = Math.max(0.5, Math.min(0.95, w / 8));
  const mx = (ax + bx) / 2 + nx * 0.07, mz = (az + bz) / 2 + nz * 0.07;
  // viewer's right when facing the wall is (nz, -nx)
  const rx = nz, rz = -nx;
  const [u0, v0, u1, v1] = signUV('h', idx);
  const y0 = ground + 3.35, y1 = y0 + hgt;
  const a = S.v(mx - rx * w / 2, y0, mz - rz * w / 2, nx, 0, nz, u0, v0);
  S.v(mx + rx * w / 2, y0, mz + rz * w / 2, nx, 0, nz, u1, v0);
  S.v(mx + rx * w / 2, y1, mz + rz * w / 2, nx, 0, nz, u1, v1);
  S.v(mx - rx * w / 2, y1, mz - rz * w / 2, nx, 0, nz, u0, v1);
  S.quad(a, a + 1, a + 2, a + 3);
}

// Vertical blade sign sticking out from the facade (Chinatown style).
function vSign(S, ax, az, bx, bz, nx, nz, ground, idx, atEnd) {
  const L = Math.hypot(bx - ax, bz - az);
  const tx = (bx - ax) / L, tz = (bz - az) / L;
  const t = atEnd ? L - 0.45 : 0.45;
  const px = ax + tx * t, pz = az + tz * t;
  const w = 0.55, hgt = 3.4, inner = 0.18;
  const y0 = ground + 3.9 + (idx % 3) * 0.4, y1 = y0 + hgt;
  const [u0, v0, u1, v1] = signUV('v', idx);
  for (const sgn of [1, -1]) {
    // face normal = sgn * tangent; text reads correctly from that side
    const fx = tx * sgn, fz = tz * sgn;
    const ox = px + fx * 0.03, oz = pz + fz * 0.03;
    const wallEnd = [ox + nx * inner, oz + nz * inner], outEnd = [ox + nx * (inner + w), oz + nz * (inner + w)];
    // viewer's right for this face is (fz, -fx); pick which end is left
    const rightIsWall = (fz * nx - fx * nz) < 0;
    const L0 = rightIsWall ? outEnd : wallEnd, R0 = rightIsWall ? wallEnd : outEnd;
    const a = S.v(L0[0], y0, L0[1], fx, 0, fz, u0, v0);
    S.v(R0[0], y0, R0[1], fx, 0, fz, u1, v0);
    S.v(R0[0], y1, R0[1], fx, 0, fz, u1, v1);
    S.v(L0[0], y1, L0[1], fx, 0, fz, u0, v1);
    S.quad(a, a + 1, a + 2, a + 3);
  }
}

// Sagging cable as line segments (catenary approximated by a parabola).
function sag(out, ax, ay, az, bx, by, bz, depth) {
  const N = 5;
  let px = ax, py = ay, pz = az;
  for (let k = 1; k <= N; k++) {
    const t = k / N;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
    const y = ay + (by - ay) * t - depth * 4 * t * (1 - t);
    out.push(px, py, pz, x, y, z);
    px = x; py = y; pz = z;
  }
}

// Oriented box (rotation ang about Y). Works for both building (uv) and prop (glow) geometry.
function gbox(G, x, y, z, sx, sy, sz, ang, c, glow = 0, uvY = -1) {
  const cs = Math.cos(ang), sn = Math.sin(ang);
  const hx = sx / 2, hz = sz / 2;
  const P = (lx, ly, lz) => [x + lx * cs + lz * sn, y + ly, z - lx * sn + lz * cs];
  const N = (lx, lz) => [lx * cs + lz * sn, -lx * sn + lz * cs];
  const faces = [
    [[1, 0], [[hx, 0, -hz], [hx, 0, hz], [hx, sy, hz], [hx, sy, -hz]]],
    [[-1, 0], [[-hx, 0, hz], [-hx, 0, -hz], [-hx, sy, -hz], [-hx, sy, hz]]],
    [[0, 1], [[hx, 0, hz], [-hx, 0, hz], [-hx, sy, hz], [hx, sy, hz]]],
    [[0, -1], [[-hx, 0, -hz], [hx, 0, -hz], [hx, sy, -hz], [-hx, sy, -hz]]],
  ];
  for (const [[lnx, lnz], vs] of faces) {
    const [wx, wz] = N(lnx, lnz);
    const sh = 0.86 + 0.14 * wx;
    const b = G.count;
    for (const v of vs) { const p = P(v[0], v[1], v[2]); G.v(p[0], p[1], p[2], wx, 0, wz, 0, uvY, c[0] * sh, c[1] * sh, c[2] * sh, glow); }
    G.quad(b, b + 3, b + 2, b + 1);
  }
  const b = G.count;
  for (const v of [[-hx, sy, -hz], [hx, sy, -hz], [hx, sy, hz], [-hx, sy, hz]]) { const p = P(v[0], v[1], v[2]); G.v(p[0], p[1], p[2], 0, 1, 0, 0, uvY, c[0], c[1], c[2], glow); }
  G.quad(b, b + 3, b + 2, b + 1);
}

function gcyl(G, x, y, z, r, h, seg, c, glow = 0, uvY = -1) {
  const base = G.count;
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const sh = 0.82 + 0.18 * ca;
    G.v(x + ca * r, y, z + sa * r, ca, 0, sa, 0, uvY, c[0] * sh, c[1] * sh, c[2] * sh, glow);
    G.v(x + ca * r, y + h, z + sa * r, ca, 0, sa, 0, uvY, c[0] * sh, c[1] * sh, c[2] * sh, glow);
  }
  for (let k = 0; k < seg; k++) { const i = base + k * 2; G.quad(i, i + 1, i + 3, i + 2); }
  const top = G.v(x, y + h, z, 0, 1, 0, 0, uvY, c[0], c[1], c[2], glow);
  for (let k = 0; k <= seg; k++) { const a = (k / seg) * Math.PI * 2; G.v(x + Math.cos(a) * r, y + h, z + Math.sin(a) * r, 0, 1, 0, 0, uvY, c[0], c[1], c[2], glow); }
  for (let k = 0; k < seg; k++) G.tri(top, top + 2 + k, top + 1 + k);
}

function gcone(G, x, y, z, r, h, seg, c, glow = 0, uvY = -1) {
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const nyy = r / Math.hypot(r, h), nr = h / Math.hypot(r, h);
    const nx = Math.cos(am) * nr, nz = Math.sin(am) * nr;
    const b = G.v(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, nx, nyy, nz, 0, uvY, c[0], c[1], c[2], glow);
    G.v(x + Math.cos(a1) * r, y, z + Math.sin(a1) * r, nx, nyy, nz, 0, uvY, c[0], c[1], c[2], glow);
    G.v(x, y + h, z, nx, nyy, nz, 0, uvY, c[0], c[1], c[2], glow);
    G.tri(b, b + 2, b + 1);
    const d = 0.6;
    const u = G.v(x + Math.cos(a0) * r, y - 0.01, z + Math.sin(a0) * r, 0, -1, 0, 0, uvY, c[0] * d, c[1] * d, c[2] * d, glow);
    G.v(x + Math.cos(a1) * r, y - 0.01, z + Math.sin(a1) * r, 0, -1, 0, 0, uvY, c[0] * d, c[1] * d, c[2] * d, glow);
    G.v(x, y - 0.01, z, 0, -1, 0, 0, uvY, c[0] * d, c[1] * d, c[2] * d, glow);
    G.tri(u, u + 1, u + 2);
  }
}

export { gbox, gcyl, gcone, wallQuad, awning };

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
