// Road network graph built from the OpenStreetMap-derived edges: adjacency,
// nearest-node lookup and A* routing (GPS waypoints, police pursuit, races).
import { ROAD_SPEED } from '../config.js';

const CELL = 60;

class MinHeap {
  constructor() { this.a = []; }
  push(k, v) {
    const a = this.a; a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

export class RoadGraph {
  constructor(map) {
    this.map = map;
    const n = map.nodeX.length;
    this.out = Array.from({ length: n }, () => []);     // drivable for traffic (cls<=4), respects one-way
    this.any = Array.from({ length: n }, () => []);     // any drivable incl. service, both directions
    for (const e of map.edges) {
      if (e.cls > 5 || e.a === e.b || e.len < 0.5) continue;
      this.any[e.a].push({ e, dir: 1, to: e.b });
      this.any[e.b].push({ e, dir: -1, to: e.a });
      if (e.cls > 4) continue;
      if (e.oneway >= 0) this.out[e.a].push({ e, dir: 1, to: e.b });
      if (e.oneway <= 0) this.out[e.b].push({ e, dir: -1, to: e.a });
    }
    const { x0, z0, x1, z1 } = map.bounds;
    this.gx0 = x0 - 200; this.gz0 = z0 - 200;
    this.gnx = Math.ceil((x1 - x0 + 400) / CELL);
    this.gnz = Math.ceil((z1 - z0 + 400) / CELL);
    this.grid = new Map();
    for (let i = 0; i < n; i++) {
      if (!this.any[i].length) continue;
      const k = this.cellKey(map.nodeX[i], map.nodeZ[i]);
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(i);
    }
  }

  cellKey(x, z) {
    return Math.floor((z - this.gz0) / CELL) * this.gnx + Math.floor((x - this.gx0) / CELL);
  }

  nearestNode(x, z, maxR = 400, needOut = false) {
    let best = -1, bd = Infinity;
    const cx = Math.floor((x - this.gx0) / CELL), cz = Math.floor((z - this.gz0) / CELL);
    for (let r = 0; r * CELL <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const list = this.grid.get((cz + dz) * this.gnx + (cx + dx));
          if (!list) continue;
          for (const i of list) {
            if (needOut && !this.out[i].length) continue;
            const d = (this.map.nodeX[i] - x) ** 2 + (this.map.nodeZ[i] - z) ** 2;
            if (d < bd) { bd = d; best = i; }
          }
        }
      }
      if (best >= 0 && Math.sqrt(bd) < (r - 0.5) * CELL) break;
    }
    return best;
  }

  // A* over the network. Returns [{e, dir}] or null.
  route(from, to, { traffic = false, maxNodes = 40000 } = {}) {
    if (from < 0 || to < 0) return null;
    if (from === to) return [];
    const adj = traffic ? this.out : this.any;
    const X = this.map.nodeX, Z = this.map.nodeZ;
    const tx = X[to], tz = Z[to];
    const g = new Map([[from, 0]]);
    const prev = new Map();
    const open = new MinHeap();
    const vmax = ROAD_SPEED[0];
    open.push(Math.hypot(X[from] - tx, Z[from] - tz) / vmax, from);
    let visited = 0;
    const closed = new Set();
    while (open.size) {
      const [, u] = open.pop();
      if (closed.has(u)) continue;
      closed.add(u);
      if (u === to) break;
      if (++visited > maxNodes) return null;
      const gu = g.get(u);
      for (const step of adj[u]) {
        const cost = gu + step.e.len / ROAD_SPEED[Math.min(step.e.cls, 5)];
        const v = step.to;
        if (cost < (g.has(v) ? g.get(v) : Infinity)) {
          g.set(v, cost);
          prev.set(v, { from: u, step });
          open.push(cost + Math.hypot(X[v] - tx, Z[v] - tz) / vmax, v);
        }
      }
    }
    if (!prev.has(to)) return null;
    const path = [];
    let cur = to;
    while (cur !== from) {
      const p = prev.get(cur);
      path.push(p.step);
      cur = p.from;
    }
    return path.reverse();
  }

  // Flattened polyline for a route (for minimap drawing).
  routePolyline(path) {
    const out = [];
    for (const { e, dir } of path) {
      const p = e.pts, n = p.length / 2;
      for (let i = 0; i < n; i++) {
        const k = dir > 0 ? i : n - 1 - i;
        out.push(p[k * 2], p[k * 2 + 1]);
      }
    }
    return out;
  }
}

// Position/tangent on an edge at distance s measured in travel direction.
export function edgePoint(e, dir, s, out) {
  const p = e.pts, cum = e.cum, n = cum.length;
  let d = dir > 0 ? s : e.len - s;
  if (d <= 0) d = 0; else if (d >= e.len) d = e.len;
  let i = 1;
  // binary search
  let lo = 1, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < d) lo = mid + 1; else hi = mid; }
  i = lo;
  const seg = Math.max(1e-6, cum[i] - cum[i - 1]);
  const t = (d - cum[i - 1]) / seg;
  const ax = p[i * 2 - 2], az = p[i * 2 - 1], bx = p[i * 2], bz = p[i * 2 + 1];
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  let tx = (bx - ax) / seg, tz = (bz - az) / seg;
  if (dir < 0) { tx = -tx; tz = -tz; }
  out.tx = tx; out.tz = tz;
  return out;
}

// Closest distance along an edge (in travel direction) to point (x,z).
export function projectOnEdge(e, dir, x, z) {
  const p = e.pts, cum = e.cum, n = cum.length;
  let best = 0, bd = Infinity;
  for (let i = 1; i < n; i++) {
    const ax = p[i * 2 - 2], az = p[i * 2 - 1], bx = p[i * 2], bz = p[i * 2 + 1];
    const ex = bx - ax, ez = bz - az;
    const L2 = ex * ex + ez * ez || 1e-6;
    let t = ((x - ax) * ex + (z - az) * ez) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + ex * t - x, qz = az + ez * t - z;
    const d = qx * qx + qz * qz;
    if (d < bd) { bd = d; best = cum[i - 1] + Math.sqrt(L2) * t; }
  }
  return { s: dir > 0 ? best : e.len - best, d: Math.sqrt(bd) };
}
