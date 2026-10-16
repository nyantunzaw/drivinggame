// Wanted level, police pursuit and arrests.
import { Human } from '../humans/human.js';
import { AIDriver } from './driver.js';

const THRESH = [0.6, 3, 7, 12, 18];
const CRIMES = { hitPed: 1, killPed: 1.6, carjack: 0.9, punch: 0.4, hitCop: 3, hitPoliceCar: 2.2, explode: 2.5, stealCop: 4 };

export class Police {
  constructor(game) {
    this.game = game;
    this.heat = 0;
    this.stars = 0;
    this.evade = 0;          // seconds unseen
    this.cops = [];          // on-foot officers {h, car}
    this.spawnTimer = 0;
    this.bustTimer = 0;
    this.flash = false;
    this.grace = 0;          // seconds before evasion can start (cops still arriving)
  }

  get cars() { return this.game.vehicles.filter((v) => v.type === 'police' && v.driver instanceof AIDriver); }

  near(x, z, r) {
    for (const v of this.game.vehicles) if (v.type === 'police' && !v.wrecked && (v.x - x) ** 2 + (v.z - z) ** 2 < r * r) return true;
    for (const c of this.cops) if ((c.h.x - x) ** 2 + (c.h.z - z) ** 2 < r * r) return true;
    return false;
  }

  crime(type, x, z) {
    const base = CRIMES[type] || 0.5;
    const witnessed = this.near(x, z, 70);
    let add = witnessed ? base : Math.random() < 0.55 ? base * 0.75 : 0;
    if (this.game.missions && this.game.missions.noPolice) add = 0;
    if (add <= 0) return;
    this.heat = Math.min(26, this.heat + add);
    this.evade = 0;
    const s = THRESH.filter((t) => this.heat >= t).length;
    if (s > this.stars) this.setStars(s);
  }

  setStars(s) {
    if (s > this.stars) this.grace = 14;
    this.stars = Math.max(0, Math.min(5, s));
    this.heat = this.stars ? Math.max(this.heat, THRESH[this.stars - 1]) : 0;
    this.game.hud.setStars(this.stars, false);
  }

  clear() {
    this.heat = 0;
    this.setStars(0);
    for (const v of this.cars) { v.driver.mode = 'cruise'; v.siren = false; }
    for (const c of this.cops) this.game.removeHuman(c.h);
    this.cops = [];
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const target = p.vehicle || p.human;
    // police AI targets
    for (const v of this.cars) {
      const d = v.driver;
      if (this.stars > 0 && !v.wrecked) {
        if (d.mode !== 'pursue') { d.mode = 'pursue'; d.repath = 0; }
        d.target = target;
      } else if (d.mode === 'pursue') { d.mode = 'cruise'; v.siren = false; }
    }
    if (this.stars <= 0 || p.dead) { this.bustTimer = 0; return; }

    // spawn pursuers
    const want = Math.min([0, 1, 2, 3, 4, 5][this.stars], g.quality.traffic > 15 ? 5 : 3);
    const active = this.cars.filter((v) => !v.wrecked).length;
    this.spawnTimer -= dt;
    if (active < want && this.spawnTimer <= 0) {
      this.spawnTimer = 2.2;
      const spot = g.traffic.findSpot(target.x, target.z, 120, 240, 5, true);
      if (spot) {
        const { v, d } = g.traffic.spawn('police', spot, 'pursue');
        d.target = target;
        d.aggression = this.stars;
        v.siren = true;
      }
    }

    // evasion: lose the cops by staying out of sight
    this.grace = Math.max(0, this.grace - dt);
    const seen = this.grace > 0 || this.cars.some((v) => !v.wrecked && Math.hypot(v.x - target.x, v.z - target.z) < 120 &&
      g.collision.raycast(v.x, v.z, target.x, target.z) > 0.98) ||
      this.cops.some((c) => Math.hypot(c.h.x - target.x, c.h.z - target.z) < 40);
    if (seen) this.evade = 0; else this.evade += dt;
    const need = 7 + this.stars * 3.5;
    this.flash = this.evade > 2;
    g.hud.setStars(this.stars, this.flash);
    if (this.evade > need) {
      this.evade = 0;
      this.setStars(this.stars - 1);
      if (this.stars === 0) { this.clear(); g.hud.flashMessage('Lost the cops'); }
    }

    // arrests
    let closeCops = 0;
    if (p.vehicle) {
      const pv = p.vehicle;
      if (pv.speed < 1.6) for (const v of this.cars) if (Math.hypot(v.x - pv.x, v.z - pv.z) < 8 && !v.wrecked) closeCops++;
      this.bustTimer = closeCops ? this.bustTimer + dt : Math.max(0, this.bustTimer - dt * 2);
      if (this.bustTimer > 2.6) { this.bustTimer = 0; g.busted(); return; }
    } else {
      // officers get out and chase on foot
      for (const v of this.cars) {
        if (v.wrecked || v.speed > 3 || this.cops.length >= 4) continue;
        const d = Math.hypot(v.x - p.human.x, v.z - p.human.z);
        if (d < 26 && !this.cops.some((c) => c.car === v)) {
          const h = new Human('cop', v.x + Math.cos(v.heading) * 1.6, v.z - Math.sin(v.heading) * 1.6);
          g.addHuman(h);
          this.cops.push({ h, car: v, hold: 0 });
        }
      }
    }
    for (const c of this.cops.slice()) {
      const h = c.h;
      if (h.state === 'flying' || h.state === 'down' || h.state === 'dead') {
        h.step(dt, g, true);
        if (h.state === 'dead') { c.dead = (c.dead || 0) + dt; if (c.dead > 15) { g.removeHuman(h); this.cops.splice(this.cops.indexOf(c), 1); } }
        continue;
      }
      const t = p.vehicle ? (c.car || p.vehicle) : p.human;
      const dx = t.x - h.x, dz = t.z - h.z;
      const d = Math.hypot(dx, dz) || 1;
      const sp = d > 1.1 ? 5.6 : 0;
      h.vx += ((dx / d) * sp - h.vx) * Math.min(1, dt * 8);
      h.vz += ((dz / d) * sp - h.vz) * Math.min(1, dt * 8);
      h.step(dt, g, true);
      if (!p.vehicle && d < 1.4 && p.human.state !== 'flying') {
        c.hold += dt;
        h.armsUp = false;
        if (c.hold > 1.1) { g.busted(); return; }
      } else c.hold = Math.max(0, c.hold - dt);
      if (p.vehicle && d < 2 && c.car) {
        // got back to the car
        g.removeHuman(h);
        this.cops.splice(this.cops.indexOf(c), 1);
      }
    }
  }
}
