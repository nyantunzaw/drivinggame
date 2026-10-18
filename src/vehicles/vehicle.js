// Arcade vehicle physics: bicycle model with tyre saturation, handbrake drifts,
// collision against buildings/landmarks, sinking in water, damage and fire.
import * as THREE from 'three';
import { VEHICLE_TYPES } from './models.js';
import { heightAt } from '../terrain.js';
import { clamp, damp, pick } from '../util.js';

let NEXT_ID = 1;
const res = { x: 0, z: 0, nx: 0, nz: 0, hit: false, depth: 0 };

export class Vehicle {
  constructor(type, x, z, heading, color) {
    this.id = NEXT_ID++;
    this.type = type;
    this.def = VEHICLE_TYPES[type];
    this.x = x; this.z = z;
    this.heading = heading;
    this.vx = 0; this.vz = 0;
    this.yawRate = 0;
    this.groundY = heightAt(x, z);
    this.y = this.groundY;
    this.bob = 0;
    this.pitch = 0; this.roll = 0;
    this._pitchV = 0; this._rollV = 0; this._accF = 0; this._accL = 0;
    this.steerAngle = 0;
    this.wheelSpin = 0;
    this.paint = new THREE.Color(color || pick(this.def.colors));
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
    this.driver = null;          // 'player' | ai controller object | null
    this.health = 1000;
    this.fire = 0;               // seconds burning
    this.wrecked = false;
    this.sinking = 0;
    this.siren = false;
    this.braking = false;
    this.slip = 0;               // tyre squeal amount 0..1
    this.lastImpact = 0;
    this.impactCooldown = 0;
    this.circleR = this.def.wid * 0.5;
    const n = Math.max(2, Math.round(this.def.len / (this.def.wid * 0.9)));
    this.circleOffsets = [];
    for (let i = 0; i < n; i++) this.circleOffsets.push(((i / (n - 1)) - 0.5) * (this.def.len - this.def.wid));
    this.mass = this.def.mass;
    this.inertia = this.mass * (this.def.len * this.def.len + this.def.wid * this.def.wid) / 12;
    this.persistent = false;     // mission vehicles aren't recycled
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get forwardSpeed() { return this.vx * Math.sin(this.heading) + this.vz * Math.cos(this.heading); }

  step(dt, world) {
    if (this.sleeping) {
      // parked cars cost nothing until something touches them
      if (this.driver || this.fire > 0 || this.vx * this.vx + this.vz * this.vz > 0.01 || Math.abs(this.yawRate) > 0.01) this.sleeping = false;
      else return;
    }
    const d = this.def;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const lx = Math.cos(this.heading), lz = -Math.sin(this.heading); // left
    let vf = this.vx * fx + this.vz * fz;
    let vl = this.vx * lx + this.vz * lz;
    const inp = this.wrecked ? { throttle: 0, brake: 0.6, steer: 0, handbrake: 1 } : this.input;
    const sinking = this.sinking > 0;

    // steering: full lock at parking speeds, tapering with speed so that full input asks
    // for a turn the tyres can actually hold (~1.2 g) instead of a slide
    const wb = d.len * 0.64;
    const maxSteer = Math.min(0.6, Math.atan((12 * wb) / (vf * vf + 1)));
    const target = -inp.steer * maxSteer;
    this.steerAngle = damp(this.steerAngle, target, 9, dt);
    const delta = this.steerAngle;

    // longitudinal
    let Fx = 0;
    const m = this.mass;
    this.braking = false;
    if (!sinking) {
      if (inp.throttle > 0) {
        const t = clamp(vf / d.top, -1, 1);
        Fx += inp.throttle * m * d.power * Math.max(0, 1 - t * t * t) * (vf < 0 ? 1.6 : 1);
      }
      if (inp.brake > 0) {
        if (vf > 0.8) { Fx -= inp.brake * m * 13; this.braking = true; }
        else if (vf > -d.top * 0.3) Fx -= inp.brake * m * d.power * 0.6;
      }
    }
    // rolling resistance + aero drag
    Fx -= clamp(vf * 4, -1, 1) * m * 0.25 + vf * Math.abs(vf) * 0.42 * (m / 1300);
    if (inp.handbrake > 0) { Fx -= clamp(vf * 2, -1, 1) * m * 5.5 * inp.handbrake; this.braking = true; }
    if (!this.driver && !this.wrecked && Math.abs(vf) < 3) Fx -= vf * m * 1.5; // parked friction

    // lateral (tyres)
    const a = d.len * 0.32, b = d.len * 0.32, L = a + b;
    const g = 9.81;
    const mu = 1.55 * d.grip;
    // rear tyres hold a little more than the fronts (mild understeer, like a road car);
    // the handbrake takes that away so you can still throw it into a drift
    const muR = mu * (inp.handbrake > 0 ? 0.42 : 1.12);
    const C = m * g * 7.5;
    let Fyf = 0, Fyr = 0;
    const speedAbs = Math.abs(vf);
    const dyn = clamp((speedAbs - 4) / 4, 0, 1); // 0 = kinematic, 1 = dynamic
    if (dyn > 0 && vf > 0) {
      const af = Math.atan2(vl + this.yawRate * a, speedAbs) - delta;
      const ar = Math.atan2(vl - this.yawRate * b, speedAbs);
      Fyf = clamp(-C * af, -mu * m * g * 0.5, mu * m * g * 0.5);
      Fyr = clamp(-C * (inp.handbrake > 0 ? 0.45 : 1.3) * ar, -muR * m * g * 0.5, muR * m * g * 0.5);
      this.slip = clamp((Math.abs(ar) - 0.12) * 2.5 + (inp.handbrake > 0 && speedAbs > 8 ? 0.6 : 0), 0, 1);
    } else {
      this.slip = 0;
    }
    if (sinking) { Fyf *= 0.1; Fyr *= 0.1; }

    const Fy = Fyr + Fyf * Math.cos(delta);
    const torque = a * Fyf * Math.cos(delta) - b * Fyr;
    // integrate in world frame
    const ax = (fx * (Fx - Fyf * Math.sin(delta)) + lx * Fy) / m;
    const az = (fz * (Fx - Fyf * Math.sin(delta)) + lz * Fy) / m;
    this.vx += ax * dt;
    this.vz += az * dt;
    if (dyn > 0 && vf > 0) this.yawRate += (torque / this.inertia) * dt * dyn;
    // kinematic blend at low speed / reverse
    const kin = vf * Math.tan(delta) / L;
    if (dyn < 1 || vf <= 0) {
      const w = vf <= 0 ? 1 : 1 - dyn;
      this.yawRate = this.yawRate + (kin - this.yawRate) * Math.min(1, 12 * dt) * w;
      // kill sideways sliding at low speed
      vf = this.vx * fx + this.vz * fz;
      vl = this.vx * lx + this.vz * lz;
      vl *= Math.exp(-8 * w * dt);
      this.vx = fx * vf + lx * vl;
      this.vz = fz * vf + lz * vl;
    }
    // stability assist (off on the handbrake): settle the yaw toward what the steering asks
    // for and bleed off sideways sliding, so the car goes where it is pointed
    if (dyn > 0 && vf > 0 && !(inp.handbrake > 0) && !sinking) {
      this.yawRate += (kin - this.yawRate) * Math.min(1, 2.4 * dt) * dyn;
      vf = this.vx * fx + this.vz * fz;
      vl = this.vx * lx + this.vz * lz;
      vl *= Math.exp(-1.2 * dyn * dt);
      this.vx = fx * vf + lx * vl;
      this.vz = fz * vf + lz * vl;
    }
    this.yawRate *= Math.exp(-0.6 * dt);
    this.heading += this.yawRate * dt;
    this._accF = damp(this._accF, Fx / m, 6, dt);
    this._accL = damp(this._accL, Fy / m, 6, dt);

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.wheelSpin += (vf / d.wheelR) * dt;

    // static collisions
    if (world) this.collideStatic(world);
  }

  collideStatic(world) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    let hitN = null, depth = 0, hx = 0, hz = 0;
    for (const off of this.circleOffsets) {
      const cx = this.x + fx * off, cz = this.z + fz * off;
      world.collision.resolveCircle(cx, cz, this.circleR, res);
      if (res.hit) {
        const dx = res.x - cx, dz = res.z - cz;
        this.x += dx; this.z += dz;
        if (res.depth > depth) { depth = res.depth; hitN = [res.nx, res.nz]; hx = cx; hz = cz; }
      }
    }
    if (hitN) {
      const [nx, nz] = hitN;
      const vn = this.vx * nx + this.vz * nz;
      if (vn < 0) {
        const e = -vn > 2 ? 0.25 : 0;
        this.vx -= (1 + e) * vn * nx;
        this.vz -= (1 + e) * vn * nz;
        // Coulomb scrape friction: tangential loss bounded by the normal impulse
        const tx = -nz, tz = nx;
        const vt = this.vx * tx + this.vz * tz;
        const dvt = Math.min(Math.abs(vt), 0.35 * (1 + e) * -vn) * Math.sign(vt);
        this.vx -= dvt * tx;
        this.vz -= dvt * tz;
        // spin from off-centre impact
        if (-vn > 1.5) {
          const rx = hx - this.x, rz = hz - this.z;
          const cross = rx * nz - rz * nx;
          this.yawRate += cross * -vn * 0.05;
        }
        this.impact(-vn, world);
      }
    }
  }

  impact(speed, world) {
    if (speed < 2.5 || this.impactCooldown > 0) return;
    this.impactCooldown = 0.25;
    const dmg = Math.max(0, speed - 4) ** 2 * 0.9 * (this.type === 'bus' ? 0.4 : 1);
    this.damage(dmg);
    this.lastImpact = speed;
    if (world && world.onImpact) world.onImpact(this, speed);
  }

  damage(n) {
    if (this.wrecked) return;
    this.health -= n;
    if (this.health <= 0 && this.fire === 0) this.fire = 0.001;
  }

  // Non-physics per-frame bookkeeping: terrain following, suspension feel, sinking, fire.
  post(dt, world) {
    this.impactCooldown = Math.max(0, this.impactCooldown - dt);
    const d = this.def;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const hf = heightAt(this.x + fx * d.len * 0.4, this.z + fz * d.len * 0.4);
    const hr = heightAt(this.x - fx * d.len * 0.4, this.z - fz * d.len * 0.4);
    const lx = Math.cos(this.heading), lz = -Math.sin(this.heading);
    const hl = heightAt(this.x + lx * d.wid * 0.4, this.z + lz * d.wid * 0.4);
    const hrt = heightAt(this.x - lx * d.wid * 0.4, this.z - lz * d.wid * 0.4);
    this.groundY = (hf + hr) / 2;
    const terrainPitch = -Math.atan2(hf - hr, d.len * 0.8);
    const terrainRoll = Math.atan2(hl - hrt, d.wid * 0.8);
    // spring-damper body motion driven by acceleration
    const tp = clamp(this._accF * 0.012, -0.08, 0.08);
    const tr = clamp(this._accL * 0.01, -0.06, 0.06);
    this._pitchV = damp(this._pitchV, tp, 7, dt);
    this._rollV = damp(this._rollV, tr, 7, dt);
    this.pitch = terrainPitch + this._pitchV;
    this.roll = terrainRoll + this._rollV;

    if (world && world.collision.isWater(this.x, this.z)) {
      this.sinking += dt;
      this.vx *= Math.exp(-1.6 * dt);
      this.vz *= Math.exp(-1.6 * dt);
    } else if (this.sinking > 0 && this.sinking < 1) {
      this.sinking = 0;
    }
    this.y = this.groundY - Math.min(3.5, this.sinking * 1.1);
    this.bob = Math.sin(performance.now() * 0.02) * 0.004 * Math.min(1, this.speed / 5);

    if (this.fire > 0 && !this.wrecked) {
      this.fire += dt;
      if (this.fire > 4.5) this.explode(world);
    }
  }

  explode(world) {
    if (this.wrecked) return;
    this.wrecked = true;
    this.health = 0;
    this.paint.setRGB(0.035, 0.032, 0.03);
    this.vx *= 0.3; this.vz *= 0.3;
    this.yawRate += (Math.random() - 0.5) * 2;
    if (world && world.onExplode) world.onExplode(this);
  }

  get smoking() { return !this.wrecked && this.health < 350; }
  get burning() { return this.fire > 0 && !this.wrecked; }

  // world-space position of a local point (x = left, z = forward)
  local(lx, lz, out) {
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    out.x = this.x + fx * lz + Math.cos(this.heading) * lx;
    out.z = this.z + fz * lz - Math.sin(this.heading) * lx;
    return out;
  }
}
