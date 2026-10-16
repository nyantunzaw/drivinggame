// AI driver: follows the road graph on the right-hand side (Myanmar drives on the
// right), slows for corners and traffic, pursues the player when it's a cop.
import { ROAD_HALF, ROAD_SPEED } from '../config.js';
import { clamp, wrapAngle } from '../util.js';
import { edgePoint, projectOnEdge } from './roadgraph.js';

const P = { x: 0, z: 0, tx: 0, tz: 0 };
const Q = { x: 0, z: 0, tx: 0, tz: 0 };

export class AIDriver {
  constructor(graph, vehicle, e, dir, s, opts = {}) {
    this.graph = graph;
    this.v = vehicle;
    this.route = [{ e, dir }];
    this.s = s;
    this.mode = opts.mode || 'cruise';
    this.speedFactor = opts.speedFactor || 0.85 + Math.random() * 0.25;
    this.laneJitter = (Math.random() - 0.5) * 0.6;
    this.target = null;       // {x,z} or vehicle/human for pursue
    this.stuck = 0;
    this.reverse = 0;
    this.lost = 0;
    this.honk = 0;
    this.repath = 0;
    this.blocked = 0;
    this.finished = false;
    this.aggression = opts.aggression || 0;
    this.fixed = !!opts.fixed;   // follow the given route only (goto/race), don't wander
    vehicle.driver = this;
  }

  get edge() { return this.route[0].e; }

  laneOffset(e) {
    if (e.oneway) return this.laneJitter * ROAD_HALF[e.cls] * 0.4;
    return ROAD_HALF[e.cls] * (e.cls >= 3 ? 0.42 : 0.48) + this.laneJitter * 0.4;
  }

  nodeAhead(step) { return step.dir > 0 ? step.e.b : step.e.a; }

  extend() {
    const last = this.route[this.route.length - 1];
    const node = this.nodeAhead(last);
    let opts = this.graph.out[node].filter((o) => o.e !== last.e);
    if (!opts.length) {
      // dead end: u-turn if allowed
      const back = this.graph.out[node].find((o) => o.e === last.e);
      if (back) { this.route.push(back); return true; }
      this.finished = true;
      return false;
    }
    // prefer bigger roads and going straight-ish
    const ex = edgePoint(last.e, last.dir, last.e.len - 0.01, P);
    let total = 0;
    const w = opts.map((o) => {
      const t = edgePoint(o.e, o.dir, Math.min(5, o.e.len), Q);
      const dot = ex.tx * (t.x - P.x) + ex.tz * (t.z - P.z);
      const straight = dot > 0 ? 1.4 : 0.6;
      const ww = (1 / (o.e.cls + 0.6)) * straight * (o.e.cls <= 3 ? 1.6 : 1);
      total += ww;
      return ww;
    });
    let r = Math.random() * total;
    for (let i = 0; i < opts.length; i++) {
      r -= w[i];
      if (r <= 0) { this.route.push(opts[i]); return true; }
    }
    this.route.push(opts[opts.length - 1]);
    return true;
  }

  // Replace the route with an explicit path (from A*), starting where we are.
  setPath(path) {
    if (!path || !path.length) return;
    const cur = this.route[0];
    const pr = projectOnEdge(path[0].e, path[0].dir, this.v.x, this.v.z);
    if (cur.e === path[0].e && cur.dir === path[0].dir) this.route = path.slice();
    else { this.route = path.slice(); this.s = pr.s; }
    this.s = projectOnEdge(this.route[0].e, this.route[0].dir, this.v.x, this.v.z).s;
  }

  // Point L metres ahead along the route (with lane offset).
  lookahead(L, out) {
    let s = this.s + L, i = 0;
    while (true) {
      const st = this.route[i];
      if (s <= st.e.len) {
        edgePoint(st.e, st.dir, s, out);
        const off = this.laneOffset(st.e);
        out.x += -out.tz * off; out.z += out.tx * off;  // right-hand side
        return i;
      }
      s -= st.e.len;
      i++;
      if (i >= this.route.length && !(this.fixed ? false : this.extend())) {
        const last = this.route[this.route.length - 1];
        edgePoint(last.e, last.dir, last.e.len, out);
        return this.route.length - 1;
      }
    }
  }

  update(dt, game) {
    const v = this.v;
    if (v.wrecked || v.sinking > 0) { v.input.throttle = 0; v.input.brake = 1; v.input.steer = 0; return; }
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
    const vf = v.forwardSpeed;

    // progress along route
    const cur = this.route[0];
    const pr = projectOnEdge(cur.e, cur.dir, v.x, v.z);
    if (pr.s > this.s - 3) this.s = pr.s;
    this.lost = pr.d > 18 ? this.lost + dt : 0;
    while (this.s >= this.route[0].e.len - 0.3) {
      if (this.route.length < 2 && !(!this.fixed && this.extend())) { this.finished = this.fixed; break; }
      this.s -= this.route[0].e.len;
      this.route.shift();
    }
    while (this.route.length < 3 && !this.fixed && this.extend());

    const e = this.route[0].e;
    let vTarget = ROAD_SPEED[Math.min(e.cls, 5)] * this.speedFactor;
    if (this.mode === 'flee') vTarget *= 1.5;
    if (this.mode === 'race') vTarget = Math.max(vTarget * 1.7, 30) * this.speedFactor;
    if (this.hold) vTarget = 0;
    vTarget = Math.min(vTarget, v.def.top * 0.9);

    // corner speed: look at the heading change ~20-35 m ahead
    const near = Math.max(6, 4 + Math.abs(vf) * 0.55);
    this.lookahead(near, P);
    this.lookahead(near + 18 + Math.abs(vf) * 0.6, Q);
    const a1 = Math.atan2(P.x - v.x, P.z - v.z);
    const a2 = Math.atan2(Q.x - P.x, Q.z - P.z);
    const turn = Math.abs(wrapAngle(a2 - a1));
    const vCorner = 5 + 22 * Math.pow(Math.max(0, 1 - turn / 1.6), 2);
    vTarget = Math.min(vTarget, Math.max(vCorner, this.mode === 'race' ? 9 : 5));

    let tx = P.x, tz = P.z;
    // pursuit: aim straight at the target when close
    if ((this.mode === 'pursue') && this.target) {
      const t = this.target;
      const dx = t.x - v.x, dz = t.z - v.z;
      const d = Math.hypot(dx, dz);
      const tvx = t.vx || 0, tvz = t.vz || 0;
      if (d < 70) {
        const lead = Math.min(1.2, d / 25);
        tx = t.x + tvx * lead; tz = t.z + tvz * lead;
        vTarget = Math.max(12, Math.min(v.def.top * 0.9, d * 0.9 + Math.hypot(tvx, tvz)));
        if (d < 9 && Math.hypot(tvx, tvz) < 2) vTarget = 2;
      } else {
        vTarget = Math.max(vTarget * 1.9, 22);
      }
      this.repath -= dt;
      if (this.repath <= 0 && d >= 70) {
        this.repath = 2.5;
        const from = this.nodeAhead(this.route[0]);
        const to = this.graph.nearestNode(t.x, t.z, 300);
        const path = this.graph.route(from, to, { traffic: false, maxNodes: 6000 });
        if (path && path.length) this.route = [this.route[0], ...path];
      }
    }

    // obstacles ahead (other vehicles, people)
    let gap = Infinity;
    const halfW = v.def.wid / 2;
    for (const o of game.vehicles) {
      if (o === v) continue;
      const dx = o.x - v.x, dz = o.z - v.z;
      if (dx * dx + dz * dz > 1600) continue;
      const df = dx * fx + dz * fz, dl = dx * lx + dz * lz;
      if (df <= 0) continue;
      if (Math.abs(dl) < halfW + o.def.wid / 2 + (o.parked ? 0.05 : 0.4)) {
        const g = df - (v.def.len + o.def.len) / 2;
        if (g < gap) { gap = g; }
      }
    }
    const pl = game.player;
    if (pl && !pl.vehicle && this.mode !== 'pursue') {
      const dx = pl.human.x - v.x, dz = pl.human.z - v.z;
      const df = dx * fx + dz * fz, dl = dx * lx + dz * lz;
      if (df > 0 && df < 25 && Math.abs(dl) < halfW + 1.2) gap = Math.min(gap, df - v.def.len / 2 - 1.5);
    }
    for (const h of game.peds.list) {
      const dx = h.x - v.x, dz = h.z - v.z;
      if (dx * dx + dz * dz > 400) continue;
      const df = dx * fx + dz * fz, dl = dx * lx + dz * lz;
      if (df > 0 && Math.abs(dl) < halfW + 0.9 && h.state !== 'dead') gap = Math.min(gap, df - v.def.len / 2 - 1.5);
    }
    if (this.mode !== 'pursue' && this.mode !== 'flee') {
      const allowed = Math.sqrt(2 * 6.5 * Math.max(0, gap - 2.5));
      vTarget = Math.min(vTarget, allowed);
    }
    if (gap < 4 && vf < 1) {
      this.blocked += dt;
      if (this.blocked > 2.5 && pl && !pl.vehicle) { this.honk = 1; this.blocked = 0; }
    } else this.blocked = 0;

    // steering
    const dx = tx - v.x, dz = tz - v.z;
    const ang = Math.atan2(dx * lx + dz * lz, dx * fx + dz * fz); // + = left
    let steer = clamp(-ang * 2.2, -1, 1);
    let throttle = 0, brake = 0;
    const err = vTarget - vf;
    if (err > 0) throttle = clamp(err * 0.45 + 0.1, 0, 1);
    else brake = clamp(-err * 0.3, 0, 1);
    if (vTarget < 0.5 && vf < 0.6) { throttle = 0; brake = 0.3; }

    // stuck recovery
    if (this.reverse > 0) {
      this.reverse -= dt;
      throttle = 0; brake = 1; steer = -steer;
    } else if (throttle > 0.5 && Math.abs(vf) < 0.7 && gap > 6) {
      this.stuck += dt;
      if (this.stuck > 1.8) { this.reverse = 1.4; this.stuck = 0; }
    } else this.stuck = Math.max(0, this.stuck - dt);

    v.input.throttle = throttle;
    v.input.brake = brake;
    v.input.steer = steer;
    v.input.handbrake = 0;
    v.siren = this.mode === 'pursue';
  }
}
