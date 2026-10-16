// Cars parked along the kerbs near the player, the way Yangon's downtown streets
// are lined bumper to bumper. They sleep (no physics) until hit or stolen.
import { Vehicle } from '../vehicles/vehicle.js';
import { edgePoint } from './roadgraph.js';
import { ROAD_HALF } from '../config.js';
import { heightAt } from '../terrain.js';

const P = { x: 0, z: 0, tx: 0, tz: 0 };
const TYPES = [['sedan', 4], ['taxi', 3.2], ['hiace', 1.8], ['pickup', 1.2], ['sports', 0.15]];
const TOTAL = TYPES.reduce((a, [, w]) => a + w, 0);

function pickParked() {
  let r = Math.random() * TOTAL;
  for (const [k, w] of TYPES) { r -= w; if (r <= 0) return k; }
  return 'sedan';
}

export class Parked {
  constructor(game) {
    this.game = game;
    this.target = game.quality.parked || 0;
    this.timer = 0;
  }

  get list() { return this.game.vehicles.filter((v) => v.parked); }

  // Kerb position for a car of width `wid` on a road of class `cls` (distance from the centreline).
  static kerb(cls, wid) {
    // wide streets: fully on the carriageway; narrower ones: two wheels up on the pavement
    return cls <= 2 ? ROAD_HALF[cls] - wid / 2 - 0.05 : ROAD_HALF[cls] - wid / 2 + 0.25;
  }

  trySpot(cx, cz, rMin, rMax, avoidView) {
    const g = this.game;
    for (let attempt = 0; attempt < 10; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = rMin + Math.random() * (rMax - rMin);
      const cell = g.chunks.cellAt(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
      if (!cell || !cell.r.length) continue;
      // one-way streets keep traffic in the middle, so even narrow ones have room at the kerb
      const pieces = cell.r.filter(([e]) => (e.cls === 2 || e.cls === 3 || (e.cls === 4 && e.oneway)) && e.len > 22 && !e.bridge);
      if (!pieces.length) continue;
      const [e, s0, s1] = pieces[Math.floor(Math.random() * pieces.length)];
      const lo = Math.max(s0, 9), hi = Math.min(s1, e.len - 9);
      if (hi <= lo) continue;
      const type = pickParked();
      const s = lo + Math.random() * (hi - lo);
      edgePoint(e, 1, s, P);
      const side = Math.random() < 0.5 ? 1 : -1;
      const v = new Vehicle(type, 0, 0, 0);
      const off = Parked.kerb(e.cls, v.def.wid) * side;
      const x = P.x - P.tz * off, z = P.z + P.tx * off;
      const d = Math.hypot(x - cx, z - cz);
      if (d < rMin * 0.7 || d > rMax * 1.2) continue;
      if (avoidView && d > 35 && g.traffic.inView(x, z)) continue;
      if (g.collision.isWater(x, z)) continue;
      // traffic drives on the right, so cars on the left kerb face the other way
      const heading = Math.atan2(P.tx, P.tz) + (side < 0 && !e.oneway ? Math.PI : 0);
      const fx = Math.sin(heading), fz = Math.cos(heading);
      const clearR = v.circleR + 0.15;
      const res = {};
      let ok = true;
      for (const o of v.circleOffsets) {
        if (g.collision.resolveCircle(x + fx * o, z + fz * o, clearR, res).hit) { ok = false; break; }
      }
      if (!ok) continue;
      const gap = v.def.len + 1.2;
      for (const o of g.vehicles) {
        const lim = o.parked ? (gap + o.def.len) / 2 + 0.4 : 12;
        if ((o.x - x) ** 2 + (o.z - z) ** 2 < lim * lim) { ok = false; break; }
      }
      if (!ok) continue;
      v.x = x; v.z = z; v.heading = heading;
      v.groundY = heightAt(x, z);
      v.y = v.groundY;
      v.parked = true;
      v.sleeping = true;
      v.input.handbrake = 1;
      return v;
    }
    return null;
  }

  // Fill the surrounding streets immediately (start / respawn).
  fill(cx, cz) {
    let tries = 0;
    while (this.list.length < this.target && tries++ < this.target * 4) {
      const v = this.trySpot(cx, cz, 8, 150, false);
      if (v) this.game.addVehicle(v);
    }
  }

  update(dt) {
    const g = this.game;
    const c = g.focus;
    const list = this.list;
    for (const v of list) {
      if (v.driver || v.wrecked || v.fire > 0) { v.parked = false; continue; }
      const d = Math.hypot(v.x - c.x, v.z - c.z);
      if (d > 240 && !g.traffic.inView(v.x, v.z)) g.removeVehicle(v);
      else if (d > 400) g.removeVehicle(v);
    }
    this.timer -= dt;
    if (this.timer > 0 || list.length >= this.target) return;
    this.timer = 0.3;
    const v = this.trySpot(c.x, c.z, 60, 190, true);
    if (v) g.addVehicle(v);
  }
}
