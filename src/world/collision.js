// Static collision: building footprints (edge grid), landmark colliders, water mask.
import { pointInPoly } from '../util.js';

const CELL = 16;
const WCELL = 4; // water mask resolution (m)

export class CollisionWorld {
  constructor(map) {
    this.map = map;
    const { x0, z0, x1, z1 } = map.bounds;
    this.x0 = x0 - 64; this.z0 = z0 - 64;
    this.nx = Math.ceil((x1 - x0 + 128) / CELL);
    this.nz = Math.ceil((z1 - z0 + 128) / CELL);
    this.circles = [];      // {x,z,r} (all, for debugging)
    this.circleGrid = new Map(); // cell -> circles (street furniture, landmarks)
    this.boxes = [];        // oriented boxes {x,z,hx,hz,c,s}
    this._buildEdges();
    this._buildWater();
    this._stamp = 1;
  }

  cellOf(x, z) {
    const cx = Math.floor((x - this.x0) / CELL), cz = Math.floor((z - this.z0) / CELL);
    if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) return -1;
    return cz * this.nx + cx;
  }

  _buildEdges() {
    const m = this.map;
    let ne = 0;
    for (let b = 0; b < m.buildingCount; b++) ne += (m.bStart[b + 1] - m.bStart[b]) / 2;
    const E = new Float32Array(ne * 4);
    const EB = new Uint32Array(ne);
    let k = 0;
    for (let b = 0; b < m.buildingCount; b++) {
      const r = m.buildingRing(b);
      const n = r.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        E[k * 4] = r[i * 2]; E[k * 4 + 1] = r[i * 2 + 1];
        E[k * 4 + 2] = r[j * 2]; E[k * 4 + 3] = r[j * 2 + 1];
        EB[k] = b;
        k++;
      }
    }
    this.edges = E;
    this.edgeBuilding = EB;
    this.edgeStamp = new Uint32Array(ne);
    const cells = this.nx * this.nz;
    const count = new Uint32Array(cells + 1);
    const visit = (i, fn) => {
      const ax = E[i * 4], az = E[i * 4 + 1], bx = E[i * 4 + 2], bz = E[i * 4 + 3];
      const cx0 = Math.max(0, Math.floor((Math.min(ax, bx) - this.x0) / CELL));
      const cx1 = Math.min(this.nx - 1, Math.floor((Math.max(ax, bx) - this.x0) / CELL));
      const cz0 = Math.max(0, Math.floor((Math.min(az, bz) - this.z0) / CELL));
      const cz1 = Math.min(this.nz - 1, Math.floor((Math.max(az, bz) - this.z0) / CELL));
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) fn(cz * this.nx + cx);
    };
    for (let i = 0; i < ne; i++) visit(i, (c) => count[c + 1]++);
    for (let c = 0; c < cells; c++) count[c + 1] += count[c];
    const fill = count.slice();
    const list = new Uint32Array(count[cells]);
    for (let i = 0; i < ne; i++) visit(i, (c) => { list[fill[c]++] = i; });
    this.cellStart = count;
    this.cellList = list;

    // building index per cell (by bbox) for point-inside queries
    const bcount = new Uint32Array(cells + 1);
    const bvisit = (b, fn) => {
      const r = m.buildingRing(b);
      let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
      for (let i = 0; i < r.length; i += 2) {
        if (r[i] < minx) minx = r[i]; if (r[i] > maxx) maxx = r[i];
        if (r[i + 1] < minz) minz = r[i + 1]; if (r[i + 1] > maxz) maxz = r[i + 1];
      }
      const cx0 = Math.max(0, Math.floor((minx - this.x0) / CELL));
      const cx1 = Math.min(this.nx - 1, Math.floor((maxx - this.x0) / CELL));
      const cz0 = Math.max(0, Math.floor((minz - this.z0) / CELL));
      const cz1 = Math.min(this.nz - 1, Math.floor((maxz - this.z0) / CELL));
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) fn(cz * this.nx + cx);
    };
    for (let b = 0; b < m.buildingCount; b++) bvisit(b, (c) => bcount[c + 1]++);
    for (let c = 0; c < cells; c++) bcount[c + 1] += bcount[c];
    const bfill = bcount.slice();
    const blist = new Uint32Array(bcount[cells]);
    for (let b = 0; b < m.buildingCount; b++) bvisit(b, (c) => { blist[bfill[c]++] = b; });
    this.bCellStart = bcount;
    this.bCellList = blist;
  }

  _buildWater() {
    const { x0, z0, x1, z1 } = this.map.bounds;
    this.wx0 = x0; this.wz0 = z0;
    this.wnx = Math.ceil((x1 - x0) / WCELL);
    this.wnz = Math.ceil((z1 - z0) / WCELL);
    const mask = new Uint8Array(this.wnx * this.wnz);
    const xs = [];
    for (const rings of this.map.water) {
      let minz = Infinity, maxz = -Infinity;
      for (const r of rings) for (let i = 1; i < r.length; i += 2) { minz = Math.min(minz, r[i]); maxz = Math.max(maxz, r[i]); }
      const rz0 = Math.max(0, Math.floor((minz - z0) / WCELL));
      const rz1 = Math.min(this.wnz - 1, Math.ceil((maxz - z0) / WCELL));
      for (let row = rz0; row <= rz1; row++) {
        const z = z0 + (row + 0.5) * WCELL;
        xs.length = 0;
        for (const r of rings) {
          const n = r.length / 2;
          for (let i = 0, j = n - 1; i < n; j = i++) {
            const zi = r[i * 2 + 1], zj = r[j * 2 + 1];
            if ((zi > z) !== (zj > z)) {
              const xi = r[i * 2], xj = r[j * 2];
              xs.push(xi + ((z - zi) / (zj - zi)) * (xj - xi));
            }
          }
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const c0 = Math.max(0, Math.ceil((xs[k] - x0) / WCELL - 0.5));
          const c1 = Math.min(this.wnx - 1, Math.floor((xs[k + 1] - x0) / WCELL - 0.5));
          for (let c = c0; c <= c1; c++) mask[row * this.wnx + c] = 1;
        }
      }
    }
    // Roads and bridges are dry land.
    for (const e of this.map.edges) {
      if (e.cls > 5) continue;
      const hw = e.cls <= 1 ? 6 : e.cls <= 3 ? 4.5 : 3;
      const p = e.pts;
      for (let i = 0; i + 2 < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
        const len = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(1, Math.ceil(len / 2));
        for (let s = 0; s <= steps; s++) {
          const x = ax + ((bx - ax) * s) / steps, z = az + ((bz - az) * s) / steps;
          const cx = Math.floor((x - x0) / WCELL), cz = Math.floor((z - z0) / WCELL);
          if (cx < 1 || cz < 1 || cx >= this.wnx - 1 || cz >= this.wnz - 1) continue;
          if (!mask[cz * this.wnx + cx] && !mask[cz * this.wnx + cx + 1] && !mask[(cz + 1) * this.wnx + cx]) continue;
          const rr = Math.ceil(hw / WCELL);
          for (let dz = -rr; dz <= rr; dz++) {
            for (let dx = -rr; dx <= rr; dx++) {
              const qx = cx + dx, qz = cz + dz;
              if (qx < 0 || qz < 0 || qx >= this.wnx || qz >= this.wnz) continue;
              if ((dx * dx + dz * dz) * WCELL * WCELL <= hw * hw + 4) mask[qz * this.wnx + qx] = 0;
            }
          }
        }
      }
    }
    this.water = mask;

    // Road mask (smallest road class + 1 per 4 m cell): used to find street-facing walls.
    const road = new Uint8Array(this.wnx * this.wnz);
    const HW = [7.5, 7, 5.5, 4.5, 3.5, 2.2];
    for (const e of this.map.edges) {
      if (e.cls > 5) continue;
      const hw = HW[e.cls] + 1;
      const rr = Math.ceil(hw / WCELL);
      const p = e.pts;
      for (let i = 0; i + 2 < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3];
        const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 3));
        for (let s = 0; s <= steps; s++) {
          const x = ax + ((bx - ax) * s) / steps, z = az + ((bz - az) * s) / steps;
          const cx = Math.floor((x - x0) / WCELL), cz = Math.floor((z - z0) / WCELL);
          for (let dz = -rr; dz <= rr; dz++) {
            for (let dx = -rr; dx <= rr; dx++) {
              const qx = cx + dx, qz = cz + dz;
              if (qx < 0 || qz < 0 || qx >= this.wnx || qz >= this.wnz) continue;
              if ((dx * dx + dz * dz) * WCELL * WCELL > hw * hw + 8) continue;
              const k = qz * this.wnx + qx;
              if (!road[k] || road[k] > e.cls + 1) road[k] = e.cls + 1;
            }
          }
        }
      }
    }
    this.road = road;
  }

  // 0 = no road, otherwise road class + 1 (1 = trunk ... 6 = service)
  roadAt(x, z) {
    const cx = Math.floor((x - this.wx0) / WCELL), cz = Math.floor((z - this.wz0) / WCELL);
    if (cx < 0 || cz < 0 || cx >= this.wnx || cz >= this.wnz) return 0;
    return this.road[cz * this.wnx + cx];
  }

  isWater(x, z) {
    const cx = Math.floor((x - this.wx0) / WCELL), cz = Math.floor((z - this.wz0) / WCELL);
    if (cx < 0 || cz < 0 || cx >= this.wnx || cz >= this.wnz) return false;
    return this.water[cz * this.wnx + cx] === 1;
  }

  addCircle(x, z, r) {
    const c = { x, z, r, s: 0 };
    this.circles.push(c);
    const cx0 = Math.floor((x - r - this.x0) / CELL), cx1 = Math.floor((x + r - this.x0) / CELL);
    const cz0 = Math.floor((z - r - this.z0) / CELL), cz1 = Math.floor((z + r - this.z0) / CELL);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const k = cz * this.nx + cx;
        let list = this.circleGrid.get(k);
        if (!list) { list = []; this.circleGrid.set(k, list); }
        list.push(c);
      }
    }
    return c;
  }

  // Oriented box collider (angle in radians around Y).
  addBox(x, z, hx, hz, angle = 0) {
    this.boxes.push({ x, z, hx, hz, c: Math.cos(angle), s: Math.sin(angle) });
  }

  // Index of building containing point, or -1.
  buildingAt(x, z) {
    const c = this.cellOf(x, z);
    if (c < 0) return -1;
    for (let k = this.bCellStart[c]; k < this.bCellStart[c + 1]; k++) {
      const b = this.bCellList[k];
      if (pointInPoly(this.map.buildingRing(b), x, z)) return b;
    }
    return -1;
  }

  // Resolve a circle against static geometry. Writes the corrected position and
  // the accumulated contact normal into out = {x, z, nx, nz, hit, depth}.
  resolveCircle(x, z, r, out) {
    out.hit = false; out.nx = 0; out.nz = 0; out.depth = 0;
    const stamp = ++this._stamp;
    const E = this.edges;
    const cx0 = Math.max(0, Math.floor((x - r - this.x0) / CELL));
    const cx1 = Math.min(this.nx - 1, Math.floor((x + r - this.x0) / CELL));
    const cz0 = Math.max(0, Math.floor((z - r - this.z0) / CELL));
    const cz1 = Math.min(this.nz - 1, Math.floor((z + r - this.z0) / CELL));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const c = cz * this.nx + cx;
        for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
          const i = this.cellList[k];
          if (this.edgeStamp[i] === stamp) continue;
          this.edgeStamp[i] = stamp;
          const ax = E[i * 4], az = E[i * 4 + 1], bx = E[i * 4 + 2], bz = E[i * 4 + 3];
          const ex = bx - ax, ez = bz - az;
          const L2 = ex * ex + ez * ez;
          let t = L2 > 0 ? ((x - ax) * ex + (z - az) * ez) / L2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + ex * t, pz = az + ez * t;
          let dx = x - px, dz = z - pz;
          const d2 = dx * dx + dz * dz;
          if (d2 < r * r) {
            let d = Math.sqrt(d2);
            if (d < 1e-4) {
              // on the edge: push along the outward normal (rings have negative area)
              const L = Math.sqrt(L2) || 1;
              dx = -ez / L; dz = ex / L; d = 0;
            } else {
              dx /= d; dz /= d;
            }
            // outward side check: if centre is inside polygon side, flip
            const side = (x - ax) * -ez + (z - az) * ex; // >0 outside for negative-area rings
            if (t > 0 && t < 1 && side < 0) { dx = -dx; dz = -dz; d = -d; }
            const pen = r - d;
            x += dx * pen; z += dz * pen;
            out.nx += dx; out.nz += dz;
            out.depth = Math.max(out.depth, pen);
            out.hit = true;
          }
        }
      }
    }
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.circleGrid.get(cz * this.nx + cx);
        if (!list) continue;
        for (const ci of list) {
          if (ci.s === stamp) continue;
          ci.s = stamp;
          const dx = x - ci.x, dz = z - ci.z;
          const rr = ci.r + r;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr * rr) {
            const d = Math.sqrt(d2) || 1e-4;
            const nx = dx / d, nz = dz / d;
            x = ci.x + nx * rr; z = ci.z + nz * rr;
            out.nx += nx; out.nz += nz; out.depth = Math.max(out.depth, rr - d); out.hit = true;
          }
        }
      }
    }
    for (const b of this.boxes) {
      // to box local space
      const lx = (x - b.x) * b.c + (z - b.z) * b.s;
      const lz = -(x - b.x) * b.s + (z - b.z) * b.c;
      const qx = Math.max(-b.hx, Math.min(b.hx, lx));
      const qz = Math.max(-b.hz, Math.min(b.hz, lz));
      let dx = lx - qx, dz = lz - qz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        let nx, nz, pen;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = dx / d; nz = dz / d; pen = r - d;
        } else {
          // centre inside the box: exit along the shallowest axis
          const ox = b.hx - Math.abs(lx), oz = b.hz - Math.abs(lz);
          if (ox < oz) { nx = Math.sign(lx) || 1; nz = 0; pen = ox + r; } else { nx = 0; nz = Math.sign(lz) || 1; pen = oz + r; }
        }
        const wx = nx * b.c - nz * b.s, wz = nx * b.s + nz * b.c;
        x += wx * pen; z += wz * pen;
        out.nx += wx; out.nz += wz; out.depth = Math.max(out.depth, pen); out.hit = true;
      }
    }
    if (out.hit) {
      const l = Math.hypot(out.nx, out.nz) || 1;
      out.nx /= l; out.nz /= l;
    }
    out.x = x; out.z = z;
    return out;
  }

  // 2D segment cast against building edges; returns hit fraction (1 = clear).
  raycast(ax, az, bx, bz) {
    let best = 1;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / CELL));
    const stamp = ++this._stamp;
    const E = this.edges;
    for (let s = 0; s <= steps; s++) {
      const c = this.cellOf(ax + (dx * s) / steps, az + (dz * s) / steps);
      if (c < 0) continue;
      for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
        const i = this.cellList[k];
        if (this.edgeStamp[i] === stamp) continue;
        this.edgeStamp[i] = stamp;
        const ex = E[i * 4 + 2] - E[i * 4], ez = E[i * 4 + 3] - E[i * 4 + 1];
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const qx = E[i * 4] - ax, qz = E[i * 4 + 1] - az;
        const t = (qx * ez - qz * ex) / den;
        const u = (qx * dz - qz * dx) / den;
        if (t >= 0 && t <= best && u >= 0 && u <= 1) best = t;
      }
    }
    return best;
  }
}
