// A person in the world (player on foot, pedestrian, police officer).
import * as THREE from 'three';
import { heightAt } from '../terrain.js';
import { damp, dampAngle, pick } from '../util.js';
import { THIGH, SHIN } from './renderer.js';

const SHIRTS = ['#e8e8e8', '#f4f1e6', '#3a6fb0', '#c43b3b', '#2f8f6a', '#e3b23c', '#7b4fa0', '#2a9d8f', '#ff6fae', '#4fc3e0', '#1f1f22', '#8fbf5a'];
const LONGYI = ['#2c3e66', '#4a3a6e', '#2f5a3a', '#6b2c34', '#3d3d55', '#5b4a2e', '#1f4f5f', '#7a4b6b', '#40556a'];
const PANTS = ['#2b3346', '#1c1c20', '#5a5148', '#33415c', '#6b6b6b', '#a8916a'];
const HTAMEIN = ['#8a2448', '#5b2a6e', '#b0475a', '#2f5a6e', '#c27a2c', '#6b2c34', '#3f6b4a', '#9c3f7a', '#274060'];
const BLOUSE = ['#f4f1e6', '#ffffff', '#f2d8e0', '#e9e1c8', '#bfe0e8', '#f3c9a8', '#d8c9ef', '#e8e8e8', '#f6e7a8'];
const ROBE = '#8a2a1e';
// Burmese skin tones, light to dark
const SKINS = ['#d9a77c', '#cd9a6e', '#c68c60', '#b97d52', '#ab6f48', '#9c6440', '#8a5636'];
const LEG = THIGH + SHIN;

const res = { x: 0, z: 0, nx: 0, nz: 0, hit: false, depth: 0 };

// Clothes, skin and height for a kind of person: 'ped', 'monk', 'cop', 'player', or
// 'driver' (behind a wheel: men in longyi or trousers).
export function randomLook(kind) {
  const lin = (h) => new THREE.Color(h);
  const L = { skin: lin(pick(SKINS)), scale: 0.95 + Math.random() * 0.09 };
  if (kind === 'monk') {
    L.variant = 'monk';
    L.shirt = lin(ROBE);
    L.lower = lin('#7a2419');
  } else if (kind === 'cop') {
    L.variant = 'cop';
    L.shirt = lin('#c9b48a');   // khaki police uniform
    L.lower = lin('#3b3a33');
  } else if (kind === 'player') {
    L.variant = 'longyi';
    L.shirt = lin('#ff4fa3');   // loud Vice-City-pink shirt
    L.lower = lin('#2b3f73');
    L.skin = lin('#c08a5f');
    L.scale = 1;
  } else {
    const r = kind === 'driver' ? 0.4 + Math.random() * 0.6 : Math.random();
    if (r < 0.4) {
      L.variant = 'htamein';
      L.shirt = lin(pick(BLOUSE));
      L.lower = lin(pick(HTAMEIN));
      L.scale *= 0.94;
    } else {
      L.variant = r < 0.78 ? 'longyi' : 'pants';
      L.shirt = lin(pick(SHIRTS));
      L.lower = lin(L.variant === 'longyi' ? pick(LONGYI) : pick(PANTS));
    }
  }
  return L;
}

export class Human {
  constructor(kind = 'ped', x = 0, z = 0) {
    this.kind = kind;
    this.x = x; this.z = z;
    this.groundY = heightAt(x, z);
    this.y = this.groundY;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.heading = 0;
    this.onGround = true;
    this.visible = true;
    this.health = 100;
    this.state = 'idle';     // idle | walk | run | down | flying | dead
    this.phase = Math.random() * 6;
    this.amp = 0; this.runF = 0;
    // joint angles, [right, left]: shoulder/hip swing forward when negative, elbows bend
    // forward and knees backward when positive, roll lifts the arms out to the side
    this.pose = { shoulder: [0, 0], roll: [0.07, 0.07], elbow: [0.15, 0.15], hip: [0, 0], knee: [0.04, 0.04] };
    this.bobY = 0; this.tiltX = 0; this.tiltZ = 0;
    this.punch = 0;
    this.armsUp = false;
    this.downTimer = 0;
    this.spinX = 0; this.spinZ = 0;
    this.radius = 0.32;
    this.scale = 1;
    this.setLook(kind);
  }

  setLook(kind) {
    Object.assign(this, randomLook(kind));
  }

  get alive() { return this.state !== 'dead'; }
  get speed() { return Math.hypot(this.vx, this.vz); }

  // Desired planar velocity is applied by controllers; this integrates and animates.
  step(dt, world, collide = true) {
    if (this.state === 'flying') {
      this.vy -= 22 * dt;
      this.x += this.vx * dt; this.z += this.vz * dt; this.y += this.vy * dt;
      this.tiltX += this.spinX * dt;
      this.tiltZ += this.spinZ * dt;
      this.phase += dt * 9;
      this.animate(dt, 'flying');
      if (collide && world) this.collide(world);
      this.groundY = heightAt(this.x, this.z);
      if (this.y <= this.groundY && this.vy < 0) {
        this.y = this.groundY;
        this.vx *= 0.3; this.vz *= 0.3;
        this.state = this.health <= 0 ? 'dead' : 'down';
        this.downTimer = 2.5 + Math.random() * 2;
        this.tiltX = -Math.PI / 2; this.tiltZ = 0;
      }
      return;
    }
    if (this.state === 'down' || this.state === 'dead') {
      this.vx *= Math.exp(-6 * dt); this.vz *= Math.exp(-6 * dt);
      this.x += this.vx * dt; this.z += this.vz * dt;
      this.groundY = heightAt(this.x, this.z);
      this.y = this.groundY + 0.15;
      this.tiltX = damp(this.tiltX, -Math.PI / 2, 10, dt);
      this.animate(dt, 'down');
      if (this.state === 'down') {
        this.downTimer -= dt;
        if (this.downTimer <= 0) { this.state = 'idle'; this.tiltX = 0; }
      }
      return;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (collide && world) this.collide(world);
    this.groundY = heightAt(this.x, this.z);
    if (!this.onGround) {
      this.vy -= 22 * dt;
      this.y += this.vy * dt;
      if (this.y <= this.groundY) { this.y = this.groundY; this.vy = 0; this.onGround = true; }
    } else {
      this.y = this.groundY;
    }
    // face movement
    const sp = this.speed;
    if (sp > 0.3) this.heading = dampAngle(this.heading, Math.atan2(this.vx, this.vz), 12, dt);
    // walk cycle: about one stride (two steps) per 1.5 m walking, longer strides running
    const skirt = this.variant !== 'pants' && this.variant !== 'cop';
    this.phase += dt * Math.min(12, 1.5 + Math.min(sp, 2) * (skirt ? 4 : 3.2) + Math.max(0, sp - 2) * 1.1);
    this.amp = damp(this.amp, sp < 0.2 ? 0 : 1, 6, dt);
    this.runF = damp(this.runF, sp > 3.2 ? 1 : 0, 5, dt);
    this.animate(dt, this.onGround ? 'move' : 'air', skirt);
    this.tiltX = damp(this.tiltX, sp > 4 ? 0.18 : 0, 8, dt);
    this.tiltZ = 0;
    if (this.punch > 0) this.punch = Math.max(0, this.punch - dt * 3.2);
    this.state = sp < 0.2 ? 'idle' : sp < 3 ? 'walk' : 'run';
  }

  // Joint angles for the current motion; the body is lowered so the standing foot stays
  // on the ground (which also gives the natural rise and fall of a walk).
  animate(dt, mode, skirt = false) {
    const P = this.pose, ph = this.phase;
    const sn = Math.sin(ph);
    if (mode === 'down') {
      for (let i = 0; i < 2; i++) {
        P.shoulder[i] = damp(P.shoulder[i], -0.25, 8, dt); P.roll[i] = damp(P.roll[i], 0.55, 8, dt);
        P.elbow[i] = damp(P.elbow[i], 0.35, 8, dt); P.hip[i] = damp(P.hip[i], i ? -0.15 : 0.05, 8, dt);
        P.knee[i] = damp(P.knee[i], i ? 0.45 : 0.1, 8, dt);
      }
      this.bobY = 0;
      return;
    }
    if (mode === 'flying') {
      for (let i = 0; i < 2; i++) {
        const w = Math.sin(ph + i * 2.1);
        P.shoulder[i] = -1.4 + w * 0.8; P.roll[i] = 0.6 + w * 0.3; P.elbow[i] = 0.6 + w * 0.3;
        P.hip[i] = -0.5 + Math.sin(ph * 0.8 + i * 2.6) * 0.4; P.knee[i] = 0.7 + w * 0.3;
      }
      this.bobY = 0;
      return;
    }
    const a = this.amp, r = this.runF;
    // stride and knee lift: a longyi or htamein keeps steps short
    const A = a * ((skirt ? 0.32 : 0.42) * (1 - r) + (skirt ? 0.5 : 0.72) * r);
    const K = a * (0.85 * (1 - r) + 1.55 * r);
    for (let i = 0; i < 2; i++) {
      const s = i ? -sn : sn;                 // right leg forward while sin > 0
      const c = Math.cos(ph + 0.35 + i * Math.PI);
      P.hip[i] = -A * s - r * a * 0.12;
      P.knee[i] = 0.05 + 0.08 * a + K * Math.max(0, c) ** 1.5 + (r * a * 0.3) * Math.max(0, s);
      P.shoulder[i] = (0.55 * A + 0.3 * a * r) * s + 0.04 - 0.12 * a * r;
      P.elbow[i] = 0.12 + a * (0.18 + 0.25 * Math.max(0, -s)) * (1 - r) + r * (1.15 + 0.35 * Math.max(0, -s));
      P.roll[i] = 0.07 + r * 0.05;
    }
    if (mode === 'air') {
      P.hip[0] = -0.55; P.hip[1] = 0.1; P.knee[0] = 0.9; P.knee[1] = 0.5;
    }
    if (this.armsUp) {
      for (let i = 0; i < 2; i++) { P.shoulder[i] = -2.85; P.roll[i] = 0.3; P.elbow[i] = 0.45; }
    } else if (this.punch > 0) {
      // jab with the right, guard up with the left
      const e = Math.sin((1 - this.punch) * Math.PI);
      P.shoulder[0] = -0.5 - 1.05 * e; P.elbow[0] = 1.9 * (1 - e) + 0.1; P.roll[0] = 0.12;
      P.shoulder[1] = -0.65; P.elbow[1] = 2.0; P.roll[1] = 0.15;
    }
    // keep the lower foot on the ground
    let h = 0;
    for (let i = 0; i < 2; i++) h = Math.max(h, THIGH * Math.cos(P.hip[i]) + SHIN * Math.cos(P.hip[i] + P.knee[i]));
    this.bobY = mode === 'air' ? 0 : (h - LEG) * (this.scale || 1) + r * a * 0.05 * Math.abs(Math.cos(ph));
  }

  collide(world) {
    world.collision.resolveCircle(this.x, this.z, this.radius, res);
    if (res.hit) {
      this.x = res.x; this.z = res.z;
      const vn = this.vx * res.nx + this.vz * res.nz;
      if (vn < 0) { this.vx -= vn * res.nx; this.vz -= vn * res.nz; }
    }
  }

  // Thrown by a car or explosion.
  knock(vx, vz, up, damage) {
    if (this.state === 'dead') return;
    this.health -= damage;
    this.state = 'flying';
    this.vx = vx; this.vz = vz; this.vy = up;
    this.y += 0.1;
    this.onGround = false;
    this.spinX = (Math.random() - 0.5) * 14;
    this.spinZ = (Math.random() - 0.5) * 10;
  }
}
