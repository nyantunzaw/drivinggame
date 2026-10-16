// Pedestrians strolling the sidewalks (including saffron-and-maroon-robed monks).
import { ROAD_HALF, SIDEWALK } from '../config.js';
import { Human } from '../humans/human.js';
import { edgePoint } from './roadgraph.js';

const P = { x: 0, z: 0, tx: 0, tz: 0 };

class PedBrain {
  constructor(h, e, dir, s, side) {
    this.h = h; this.e = e; this.dir = dir; this.s = s; this.side = side;
    this.speed = 1.05 + Math.random() * 0.55;
    this.mode = 'walk';
    this.timer = 0;
    this.threat = null;
    this.idle = Math.random() < 0.15 ? 2 + Math.random() * 6 : 0;
  }
}

export class Peds {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.brains = new Map();
    this.target = game.quality.peds;
    this.spawnTimer = 0;
  }

  offset(e) {
    return ROAD_HALF[e.cls] + (SIDEWALK[e.cls] > 0 ? SIDEWALK[e.cls] * 0.5 : 1.2);
  }

  spawnAt(e, dir, s, side, kind) {
    edgePoint(e, dir, s, P);
    const off = this.offset(e) * side;
    const x = P.x - P.tz * off, z = P.z + P.tx * off;
    const g = this.game;
    if (g.collision.isWater(x, z) || g.collision.buildingAt(x, z) >= 0) return null;
    const h = new Human(kind || (Math.random() < 0.1 ? 'monk' : 'ped'), x, z);
    h.heading = Math.atan2(P.tx, P.tz);
    this.list.push(h);
    this.brains.set(h, new PedBrain(h, e, dir, s, side));
    return h;
  }

  // A person who runs from (tx,tz), e.g. a carjacked driver.
  addFleeing(x, z, kind, tx, tz) {
    const n = this.game.graph.nearestNode(x, z, 300);
    const o = n >= 0 ? this.game.graph.any[n][0] : null;
    if (!o) return null;
    const h = new Human(kind, x, z);
    this.list.push(h);
    const b = new PedBrain(h, o.e, o.dir, 0, 1);
    b.mode = 'flee'; b.timer = 6; b.threat = { x: tx, z: tz };
    this.brains.set(h, b);
    return h;
  }

  remove(h) {
    const i = this.list.indexOf(h);
    if (i >= 0) this.list.splice(i, 1);
    this.brains.delete(h);
  }

  // Make everyone near (x,z) run away (crashes, explosions, punches).
  panic(x, z, r = 25) {
    for (const h of this.list) {
      if ((h.x - x) ** 2 + (h.z - z) ** 2 < r * r) {
        const b = this.brains.get(h);
        if (b && h.state !== 'dead') { b.mode = 'flee'; b.timer = 5 + Math.random() * 3; b.threat = { x, z }; }
      }
    }
  }

  next(b) {
    const node = b.dir > 0 ? b.e.b : b.e.a;
    const g = this.game.graph;
    let opts = g.any[node].filter((o) => o.e !== b.e && o.e.cls <= 5);
    if (!opts.length) opts = g.any[node];
    if (!opts.length) return false;
    const o = opts[(Math.random() * opts.length) | 0];
    b.e = o.e; b.dir = o.dir; b.s = 0;
    return true;
  }

  update(dt) {
    const g = this.game;
    const c = g.focus;
    // recycle
    for (const h of this.list.slice()) {
      const d = Math.hypot(h.x - c.x, h.z - c.z);
      if (d > 190 || (h.state === 'dead' && d > 60) || (h.deadTime && h.deadTime > 25)) this.remove(h);
    }
    // spawn
    this.spawnTimer -= dt;
    if (this.list.length < this.target && this.spawnTimer <= 0) {
      this.spawnTimer = g.time < 3 ? 0 : 0.2;
      const cell = g.chunks.cellAt(c.x + (Math.random() - 0.5) * 260, c.z + (Math.random() - 0.5) * 260);
      if (cell && cell.r.length) {
        const [e, s0, s1] = cell.r[(Math.random() * cell.r.length) | 0];
        if (e.cls <= 4) {
          const s = s0 + Math.random() * (s1 - s0);
          edgePoint(e, 1, s, P);
          const d = Math.hypot(P.x - c.x, P.z - c.z);
          const early = g.time < 3;
          if (d > (early ? 15 : 45) && d < 170 && (early || !g.traffic.inView(P.x, P.z) || d > 110)) {
            this.spawnAt(e, Math.random() < 0.5 ? 1 : -1, s, Math.random() < 0.5 ? 1 : -1);
          }
        }
      }
    }
    for (const h of this.list) {
      const b = this.brains.get(h);
      if (h.state === 'dead') { h.deadTime = (h.deadTime || 0) + dt; h.step(dt, g, false); continue; }
      if (h.state === 'flying' || h.state === 'down') {
        h.step(dt, g, true);
        if (h.state === 'idle') { b.mode = 'flee'; b.timer = 6; b.threat = b.threat || { x: h.x + 1, z: h.z }; }
        continue;
      }
      let tx, tz, sp;
      if (b.mode === 'flee') {
        b.timer -= dt;
        const dx = h.x - b.threat.x, dz = h.z - b.threat.z;
        const l = Math.hypot(dx, dz) || 1;
        tx = h.x + (dx / l) * 5; tz = h.z + (dz / l) * 5;
        sp = 5.2;
        if (b.timer <= 0) {
          // rejoin the sidewalk network
          const n = g.graph.nearestNode(h.x, h.z, 200);
          const o = n >= 0 && g.graph.any[n][0];
          if (o) { b.e = o.e; b.dir = o.dir; b.s = 0; b.mode = 'walk'; } else b.timer = 2;
        }
      } else if (b.idle > 0) {
        b.idle -= dt;
        h.vx *= 0.8; h.vz *= 0.8;
        h.step(dt, g, true);
        continue;
      } else {
        b.s += b.speed * dt;
        if (b.s >= b.e.len) {
          b.s -= b.e.len;
          if (!this.next(b)) { b.dir = -b.dir; b.s = 0; }
          if (Math.random() < 0.06) b.idle = 2 + Math.random() * 5;
        }
        edgePoint(b.e, b.dir, Math.min(b.e.len, b.s + 1.2), P);
        const off = this.offset(b.e) * b.side;
        tx = P.x - P.tz * off; tz = P.z + P.tx * off;
        sp = b.speed;
      }
      const dx = tx - h.x, dz = tz - h.z;
      const l = Math.hypot(dx, dz) || 1;
      const want = Math.min(sp, l * 3);
      h.vx += ((dx / l) * want - h.vx) * Math.min(1, dt * 6);
      h.vz += ((dz / l) * want - h.vz) * Math.min(1, dt * 6);
      h.step(dt, g, true);
    }
  }
}
