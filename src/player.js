// The player: walking, sprinting, punching, carjacking and driving.
import { Human } from './humans/human.js';
import { AIDriver } from './ai/driver.js';
import { heightAt } from './terrain.js';
import { clamp } from './util.js';

export class Player {
  constructor(game, x, z) {
    this.game = game;
    this.human = new Human('player', x, z);
    this.vehicle = null;
    this.health = 100;
    this.armor = 0;
    this.money = 0;
    this.drown = 0;
    this.entering = null;     // {v, t}
    this.dead = false;
    this.invuln = 0;
  }

  get x() { return this.vehicle ? this.vehicle.x : this.human.x; }
  get z() { return this.vehicle ? this.vehicle.z : this.human.z; }
  get y() { return this.vehicle ? this.vehicle.y : this.human.y; }

  hurt(n) {
    if (this.dead || this.invuln > 0) return;
    if (this.armor > 0) {
      const a = Math.min(this.armor, n * 0.7);
      this.armor -= a; n -= a;
    }
    this.health = Math.max(0, this.health - n);
    this.game.hud.pulseHealth();
    if (this.health <= 0) this.game.wasted();
  }

  nearestVehicle(maxD = 4.5) {
    let best = null, bd = maxD * maxD;
    const h = this.human;
    for (const v of this.game.vehicles) {
      if (v.wrecked || v.sinking > 0.5) continue;
      const d = (v.x - h.x) ** 2 + (v.z - h.z) ** 2 - (v.def.len * v.def.len) / 16;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  enter(v) {
    const g = this.game;
    if (v.driver instanceof AIDriver) {
      // carjack! the driver is thrown out and runs away
      const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
      const d = g.peds.addFleeing(v.x - lx * 1.8, v.z - lz * 1.8, v.type === 'police' ? 'cop' : 'ped', v.x, v.z);
      if (d) d.knock(-lx * 3, -lz * 3, 3, 0);
      g.peds.panic(v.x, v.z, 8);
      g.police.crime(v.type === 'police' ? 'stealCop' : 'carjack', v.x, v.z);
      g.audio.sfx('door');
    } else {
      g.audio.sfx('door');
    }
    v.driver = 'player';
    v.persistent = false;
    v.siren = false;
    this.vehicle = v;
    this.human.visible = false;
    g.hud.vehicleName(v.def.name);
    g.audio.enterVehicle(v);
    g.onEnterVehicle(v);
  }

  exit() {
    const v = this.vehicle;
    if (!v) return;
    const g = this.game;
    const h = this.human;
    // Yangon cars are mostly right-hand drive: hop out on the right
    const side = -1;
    const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
    h.x = v.x + lx * side * (v.def.wid / 2 + 0.6);
    h.z = v.z + lz * side * (v.def.wid / 2 + 0.6);
    h.groundY = heightAt(h.x, h.z);
    h.y = h.groundY;
    h.heading = v.heading;
    h.visible = true;
    h.state = 'idle';
    h.tiltX = 0;
    const sp = v.speed;
    if (sp > 9) {
      // bail out of a moving car
      h.knock(v.vx * 0.6 + lx * side * 2, v.vz * 0.6 + lz * side * 2, 3, 0);
      this.hurt(Math.min(25, sp * 0.6));
    } else {
      h.vx = v.vx * 0.3; h.vz = v.vz * 0.3;
    }
    v.driver = null;
    v.input.throttle = 0; v.input.steer = 0; v.input.brake = 0; v.input.handbrake = 0;
    this.vehicle = null;
    g.audio.exitVehicle();
    g.audio.sfx('door');
    g.onExitVehicle(v);
  }

  update(dt, input, camYaw) {
    const g = this.game;
    this.invuln = Math.max(0, this.invuln - dt);
    if (this.dead) return;
    const s = input.state;
    if (this.vehicle) {
      const v = this.vehicle;
      v.input.throttle = s.gas;
      v.input.brake = s.brake;
      v.input.steer = s.steer;
      v.input.handbrake = s.handbrake;
      if (input.pressed('action') && !v.sinking) this.exit();
      else if (input.pressed('action') && v.sinking) this.exit();
      if (v.sinking > 2.8) { this.drown += dt; if (this.drown > 0.6) g.wasted('drowned'); }
      if (v.wrecked && v.health <= 0 && v.fire > 0) { this.exit(); this.hurt(60); }
      return;
    }
    const h = this.human;
    if (h.state === 'flying' || h.state === 'down') {
      h.step(dt, g, true);
      if (h.state === 'dead') g.wasted();
      return;
    }
    // movement relative to the camera
    const mag = Math.min(1, Math.hypot(s.moveX, s.moveY));
    let vx = 0, vz = 0;
    if (mag > 0.08) {
      const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
      const rx = -fz, rz = fx; // camera right
      const dx = fx * s.moveY + rx * s.moveX, dz = fz * s.moveY + rz * s.moveX;
      const l = Math.hypot(dx, dz) || 1;
      const speed = (s.sprint ? 7.4 : mag > 0.75 ? 5.2 : 2.4 * (mag / 0.75) + 0.6);
      vx = (dx / l) * speed; vz = (dz / l) * speed;
    }
    const acc = h.onGround ? 14 : 3;
    h.vx += (vx - h.vx) * Math.min(1, acc * dt);
    h.vz += (vz - h.vz) * Math.min(1, acc * dt);
    if (input.pressed('jump') && h.onGround) { h.vy = 6.2; h.onGround = false; }
    if (input.pressed('punch')) this.punch();
    if (input.pressed('action')) {
      const v = this.nearestVehicle();
      if (v) this.enter(v);
    }
    h.step(dt, g, true);
    // water
    if (g.collision.isWater(h.x, h.z)) {
      this.drown += dt;
      h.y = h.groundY - Math.min(1.4, this.drown * 1.5);
      if (this.drown > 1.6) g.wasted('drowned');
    } else this.drown = 0;
    // world bounds
    const b = g.map.bounds;
    h.x = clamp(h.x, b.x0 + 5, b.x1 - 5);
    h.z = clamp(h.z, b.z0 + 5, b.z1 - 5);
  }

  punch() {
    const g = this.game, h = this.human;
    if (h.punch > 0.2) return;
    h.punch = 1;
    g.audio.sfx('whoosh');
    const fx = Math.sin(h.heading), fz = Math.cos(h.heading);
    const targets = [...g.peds.list, ...g.police.cops.map((c) => c.h)];
    for (const t of targets) {
      if (t.state === 'dead' || t.state === 'flying') continue;
      const dx = t.x - h.x, dz = t.z - h.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.5 && (dx * fx + dz * fz) / (d || 1) > 0.3) {
        t.knock(fx * 4, fz * 4, 2.5, 34);
        g.audio.sfx('punch');
        const cop = t.kind === 'cop';
        g.police.crime(cop ? 'hitCop' : 'punch', t.x, t.z);
        g.peds.panic(t.x, t.z, 14);
        break;
      }
    }
  }
}
