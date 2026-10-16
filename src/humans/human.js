// A person in the world (player on foot, pedestrian, police officer).
import * as THREE from 'three';
import { heightAt } from '../terrain.js';
import { damp, dampAngle, pick } from '../util.js';

const SHIRTS = ['#e8e8e8', '#f4f1e6', '#3a6fb0', '#c43b3b', '#2f8f6a', '#e3b23c', '#7b4fa0', '#f08a5d', '#ff6fae', '#4fc3e0', '#1f1f22', '#8fbf5a'];
const LONGYI = ['#2c3e66', '#4a3a6e', '#2f5a3a', '#6b2c34', '#3d3d55', '#5b4a2e', '#1f4f5f', '#7a4b6b', '#40556a'];
const PANTS = ['#2b3346', '#1c1c20', '#5a5148', '#33415c', '#6b6b6b', '#a8916a'];
const ROBE = '#8a2a1e';

const res = { x: 0, z: 0, nx: 0, nz: 0, hit: false, depth: 0 };

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
    this.legSwing = 0; this.armSwing = 0;
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
    const lin = (h) => new THREE.Color(h);
    if (kind === 'monk') {
      this.variant = 'monk';
      this.shirt = lin(ROBE);
      this.lower = lin(ROBE);
    } else if (kind === 'cop') {
      this.variant = 'pants';
      this.shirt = lin('#c9b48a');   // khaki police uniform
      this.lower = lin('#3b3a33');
    } else if (kind === 'player') {
      this.variant = 'longyi';
      this.shirt = lin('#ff4fa3');   // loud Vice-City-pink shirt
      this.lower = lin('#2b3f73');
    } else {
      this.variant = Math.random() < 0.6 ? 'longyi' : 'pants';
      this.shirt = lin(pick(SHIRTS));
      this.lower = lin(this.variant === 'longyi' ? pick(LONGYI) : pick(PANTS));
    }
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
      this.legSwing = 0; this.armSwing = 0;
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
    // walk cycle
    this.phase += dt * (2.2 + sp * 1.55);
    const amp = sp < 0.2 ? 0 : sp < 3 ? 0.45 : 0.85;
    const target = Math.sin(this.phase) * amp;
    this.legSwing = damp(this.legSwing, this.onGround ? target : 0.5, 18, dt);
    this.armSwing = damp(this.armSwing, this.onGround ? target * 0.8 : -0.6, 18, dt);
    this.bobY = this.onGround ? Math.abs(Math.cos(this.phase)) * amp * 0.06 : 0;
    this.tiltX = damp(this.tiltX, sp > 4 ? 0.18 : 0, 8, dt);
    this.tiltZ = 0;
    if (this.punch > 0) this.punch = Math.max(0, this.punch - dt * 3.2);
    this.state = sp < 0.2 ? 'idle' : sp < 3 ? 'walk' : 'run';
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
