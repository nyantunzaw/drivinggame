// Central dividers on divided roads. OpenStreetMap draws a divided road as two parallel
// one-way carriageways with the same name (Maha Bandula Road through Chinatown is two
// eastbound carriageways; Strand Road one each way). The kerbed island goes halfway
// between them, broken where side streets cross.
import { ROAD_HALF } from '../config.js';

const STEP = 3;          // sample spacing along a carriageway (m)
const MIN_SEP = 6.2, MAX_SEP = 18; // narrower than that and the island would sit in the traffic lanes
const LAMP_EVERY = 40;

export function findMedians(map, deg) {
  // roads meeting at each node (name, half width): the gap only needs to clear the side street
  const meet = new Map();
  for (const e of map.edges) {
    if (e.cls > 5) continue;
    for (const n of [e.a, e.b]) { let l = meet.get(n); if (!l) { l = []; meet.set(n, l); } l.push([e.name || '', ROAD_HALF[e.cls]]); }
  }
  // junction nodes in a coarse grid, for the gaps
  const JC = 40;
  const jgrid = new Map();
  for (let n = 0; n < map.nodeX.length; n++) {
    if (deg[n] < 3) continue;
    const k = `${Math.floor(map.nodeX[n] / JC)},${Math.floor(map.nodeZ[n] / JC)}`;
    let l = jgrid.get(k); if (!l) { l = []; jgrid.set(k, l); } l.push(n);
  }
  const nearJunction = (x, z, lateral, name) => {
    const cx = Math.floor(x / JC), cz = Math.floor(z / JC);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = jgrid.get(`${cx + a},${cz + b}`);
      if (!l) continue;
      for (const n of l) {
        let hw = 0;
        for (const [nm, h] of meet.get(n)) if (nm !== name) hw = Math.max(hw, h);
        if (!hw) continue;
        const r = hw + 4.5; // room for turning traffic
        const d2 = (map.nodeX[n] - x) ** 2 + (map.nodeZ[n] - z) ** 2;
        if (d2 < r * r + lateral * lateral) return true;
      }
    }
    return false;
  };

  // carriageways grouped by road name, with their segments bucketed for lookup
  const groups = new Map();
  for (const e of map.edges) {
    if (!e.oneway || e.cls > 2 || !e.name || e.bridge) continue;
    let g = groups.get(e.name); if (!g) { g = []; groups.set(e.name, g); } g.push(e);
  }
  const segs = [];           // straight pieces [x0, z0, x1, z1, width]
  const lamps = [];          // [x, z, tx, tz] double-arm lamp posts on the island
  for (const es of groups.values()) {
    if (es.length < 2) continue;
    const B = 30, bucket = new Map();
    for (const e of es) {
      for (let i = 0; i + 3 < e.pts.length; i += 2) {
        const ax = e.pts[i], az = e.pts[i + 1], bx = e.pts[i + 2], bz = e.pts[i + 3];
        const k0 = Math.floor(Math.min(ax, bx) / B) - 1, k1 = Math.floor(Math.max(ax, bx) / B) + 1;
        const m0 = Math.floor(Math.min(az, bz) / B) - 1, m1 = Math.floor(Math.max(az, bz) / B) + 1;
        for (let p = k0; p <= k1; p++) for (let q = m0; q <= m1; q++) {
          const key = p * 100003 + q;
          let l = bucket.get(key); if (!l) { l = []; bucket.set(key, l); } l.push([e, ax, az, bx, bz]);
        }
      }
    }
    for (const e of es) {
      const sideVotes = [];
      let run = [];
      let along = 0, nextLamp = LAMP_EVERY / 2;
      // merge the samples into straight pieces (up to 30 m) so the island is cheap to draw
      const flush = () => {
        let i0 = 0;
        for (let i = 1; i < run.length; i++) {
          const [ax, az] = run[i0], [bx, bz] = run[i];
          const L = Math.hypot(bx - ax, bz - az);
          const next = run[i + 1];
          let straight = !!next && L < 30;
          if (straight) {
            const [cx, cz] = next;
            const t1x = (bx - ax) / (L || 1), t1z = (bz - az) / (L || 1);
            const l2 = Math.hypot(cx - bx, cz - bz) || 1;
            straight = ((cx - bx) * t1x + (cz - bz) * t1z) / l2 > 0.9997 && Math.abs(run[i][2] - run[i0][2]) < 0.01;
          }
          if (!straight) { segs.push([ax, az, bx, bz, run[i0][2]]); i0 = i; }
        }
        for (let i = 0; i + 1 < run.length; i++) {
          if (!run[i][3]) continue;
          const [ax, az] = run[i], [bx, bz] = run[i + 1];
          const L = Math.hypot(bx - ax, bz - az) || 1;
          lamps.push([ax, az, (bx - ax) / L, (bz - az) / L]);
        }
        run = [];
      };
      for (let i = 0; i + 3 < e.pts.length; i += 2) {
        const ax = e.pts[i], az = e.pts[i + 1], bx = e.pts[i + 2], bz = e.pts[i + 3];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.5) continue;
        const tx = (bx - ax) / L, tz = (bz - az) / L;
        const nx = -tz, nz = tx;
        const nS = Math.max(1, Math.round(L / STEP));
        for (let s = 0; s <= nS; s++) {
          if (s === 0 && i > 0) continue;
          const px = ax + tx * (L * s / nS), pz = az + tz * (L * s / nS);
          // look straight across the road (perpendicular to travel) for the nearest parallel
          // carriageway of the same road; collinear pieces of this one can never match
          let best = null, bd = MAX_SEP;
          const key = Math.floor(px / B) * 100003 + Math.floor(pz / B);
          for (const [f, cx, cz, dx2, dz2] of bucket.get(key) || []) {
            if (f === e) continue;
            const ux = dx2 - cx, uz = dz2 - cz, ul = Math.hypot(ux, uz);
            if (ul < 0.5) continue;
            const dot = (ux * tx + uz * tz) / ul;
            if (Math.abs(dot) < 0.8) continue;
            const den = nx * uz - nz * ux;
            if (Math.abs(den) < 1e-6) continue;
            const wx = cx - px, wz = cz - pz;
            const lam = (wx * uz - wz * ux) / den;   // distance across, signed along the normal
            const mu = (wx * nz - wz * nx) / den;    // position on the other segment
            if (mu < 0 || mu > 1) continue;
            const d = Math.abs(lam);
            if (d >= MIN_SEP && d < bd) { bd = d; best = { qx: px + nx * lam, qz: pz + nz * lam, d, same: dot > 0 }; }
          }
          let ok = false;
          if (best && best.d >= MIN_SEP) {
            const side = Math.sign((best.qx - px) * nx + (best.qz - pz) * nz);
            sideVotes.push([side, best.d]);
            // draw each island once: from the carriageway that has the other one on its
            // left (same direction), or from the eastbound / southbound one (opposite)
            const owner = best.same ? side > 0 : (Math.abs(tx) > 0.3 ? tx > 0 : tz > 0);
            if (owner) {
              const mx = (px + best.qx) / 2, mz = (pz + best.qz) / 2;
              if (!nearJunction(mx, mz, best.d / 2, e.name)) {
                ok = true;
                along += STEP;
                let lamp = 0;
                if (along >= nextLamp) { lamp = 1; nextLamp = along + LAMP_EVERY; }
                run.push([mx, mz, best.d < 7 ? 1.0 : 1.3, lamp]);
              }
            }
          }
          if (!ok) flush();
        }
      }
      flush();
      // per-carriageway info for lane markings and kerbside lamps
      if (sideVotes.length > 2) {
        let sum = 0; for (const [s] of sideVotes) sum += s;
        const ds = sideVotes.map((v) => v[1]).sort((a, b) => a - b);
        e.median = { side: sum >= 0 ? 1 : -1, dist: Math.min(ds[ds.length >> 1] / 2, ROAD_HALF[e.cls]) };
      }
    }
  }
  return { segs, lamps };
}
