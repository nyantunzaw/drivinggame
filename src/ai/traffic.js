// Keeps a living stream of traffic around the player: spawns cars on nearby
// roads out of sight, recycles them when they fall behind.
import { Vehicle } from '../vehicles/vehicle.js';
import { VEHICLE_TYPES } from '../vehicles/models.js';
import { AIDriver } from './driver.js';
import { edgePoint } from './roadgraph.js';
import { ROAD_HALF } from '../config.js';

const P = { x: 0, z: 0, tx: 0, tz: 0 };

function pickType(cls) {
  const entries = Object.entries(VEHICLE_TYPES).filter(([k, d]) => d.weight > 0 && (k !== 'bus' || cls <= 2));
  let total = 0;
  for (const [, d] of entries) total += d.weight;
  let r = Math.random() * total;
  for (const [k, d] of entries) { r -= d.weight; if (r <= 0) return k; }
  return 'sedan';
}

export class Traffic {
  constructor(game) {
    this.game = game;
    this.target = game.quality.traffic;
    this.spawnTimer = 0;
  }

  get ai() { return this.game.vehicles.filter((v) => v.driver instanceof AIDriver && v.driver.mode !== 'pursue'); }

  inView(x, z) {
    const cam = this.game.camera;
    const dx = x - cam.position.x, dz = z - cam.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 30) return true;
    const f = this.game.camFwd;
    return (dx * f.x + dz * f.z) / d > 0.45 && d < this.game.quality.view * 0.9;
  }

  // Find a spawn spot on a road in a ring around (cx,cz).
  findSpot(cx, cz, rMin, rMax, maxCls = 4, avoidView = true) {
    const chunks = this.game.chunks;
    for (let attempt = 0; attempt < 14; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const r = rMin + Math.random() * (rMax - rMin);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const cell = chunks.cellAt(x, z);
      if (!cell || !cell.r.length) continue;
      const pieces = cell.r.filter(([e]) => e.cls <= maxCls && this.game.graph.out[e.a].length + this.game.graph.out[e.b].length > 0);
      if (!pieces.length) continue;
      // bias toward bigger roads
      const piece = pieces[Math.floor(Math.pow(Math.random(), 1.6) * pieces.length)];
      const sorted = pieces.sort((p, q) => p[0].cls - q[0].cls);
      const [e, s0, s1] = Math.random() < 0.6 ? sorted[0] : piece;
      const s = s0 + Math.random() * (s1 - s0);
      let dir = Math.random() < 0.5 ? 1 : -1;
      if (e.oneway) dir = e.oneway;
      edgePoint(e, dir, dir > 0 ? s : e.len - s, P);
      const off = e.oneway ? 0 : ROAD_HALF[e.cls] * 0.48;
      const px = P.x - P.tz * off, pz = P.z + P.tx * off;
      const d = Math.hypot(px - cx, pz - cz);
      if (d < rMin * 0.8 || d > rMax * 1.25) continue;
      if (avoidView && this.inView(px, pz) && d < 220) continue;
      if (this.game.collision.isWater(px, pz)) continue;
      let clear = true;
      for (const v of this.game.vehicles) {
        if ((v.x - px) ** 2 + (v.z - pz) ** 2 < 18 * 18) { clear = false; break; }
      }
      if (!clear) continue;
      return { e, dir, s: dir > 0 ? s : e.len - s, x: px, z: pz, heading: Math.atan2(P.tx, P.tz) };
    }
    return null;
  }

  spawn(type, spot, mode = 'cruise') {
    const v = new Vehicle(type || pickType(spot.e.cls), spot.x, spot.z, spot.heading);
    const d = new AIDriver(this.game.graph, v, spot.e, spot.dir, spot.s, { mode });
    const f = 7 + Math.random() * 4;
    v.vx = Math.sin(v.heading) * f; v.vz = Math.cos(v.heading) * f;
    this.game.addVehicle(v);
    return { v, d };
  }

  update(dt) {
    const g = this.game;
    const c = g.focus;
    const keepR = g.quality.view + 120;
    // recycle
    for (const v of g.vehicles.slice()) {
      if (v.persistent || v === g.player.vehicle) continue;
      const d = Math.hypot(v.x - c.x, v.z - c.z);
      const ai = v.driver instanceof AIDriver ? v.driver : null;
      const stale = ai && (ai.finished || ai.lost > 4);
      if (d > keepR || (stale && !this.inView(v.x, v.z)) || (v.wrecked && d > 150) || (v.sinking > 6)) {
        if (!this.inView(v.x, v.z) || d > keepR) g.removeVehicle(v);
      }
    }
    // spawn
    this.spawnTimer -= dt;
    const n = g.vehicles.filter((v) => !v.persistent && v !== g.player.vehicle && !(v.driver && v.driver.mode === 'pursue')).length;
    if (n < this.target && this.spawnTimer <= 0) {
      this.spawnTimer = g.time < 3 ? 0 : 0.25;
      const early = g.time < 3;
      const spot = this.findSpot(c.x, c.z, early ? 25 : 110, Math.min(300, g.quality.view + 40), 4, !early);
      if (spot) this.spawn(null, spot);
    }
  }
}
