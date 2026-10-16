// Third-person camera: smooth chase cam for driving, orbit cam on foot,
// building-aware so it never ends up inside a wall.
import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { clamp, damp, dampAngle, wrapAngle } from './util.js';

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.pitch = 0.22;
    this.dist = 7;
    this.userYaw = 0;       // offset from auto yaw while dragging (vehicle)
    this.lastDrag = -10;
    this.target = new THREE.Vector3();
    this.shake = 0;
    this.zoom = 0;          // 0 normal, 1 far, 2 close
    this.fovBase = 62;
    this._look = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, 1);
  }

  cycle() { this.zoom = (this.zoom + 1) % 3; }

  snap(x, y, z, yaw) {
    this.target.set(x, y, z);
    this.yaw = yaw;
    this.userYaw = 0;
    this._snap = true;
  }

  update(dt, game, look) {
    const p = game.player;
    const now = game.time;
    if (look.dx || look.dy) this.lastDrag = now;
    const sens = game.settings.sensitivity || 1;
    const dragging = now - this.lastDrag < 1.4;
    let tx, ty, tz, dist, pitchTarget;
    if (p.vehicle) {
      const v = p.vehicle;
      const sp = v.speed;
      const fwd = v.forwardSpeed;
      let auto = v.heading;
      if (sp > 4 && fwd > 0) auto = Math.atan2(v.vx, v.vz);
      this.userYaw = wrapAngle(this.userYaw - look.dx * 0.006 * sens);
      if (!dragging) this.userYaw = damp(this.userYaw, 0, 2.5, dt);
      const desired = auto + this.userYaw;
      this.yaw = this._snap ? desired : dampAngle(this.yaw, desired, dragging ? 30 : 4.2, dt);
      const big = v.type === 'bus' ? 1.8 : 1;
      const zoomD = [1, 1.45, 0.72][this.zoom];
      dist = (6.4 + Math.min(sp, 45) * 0.055) * big * zoomD;
      pitchTarget = (0.2 + (this.zoom === 1 ? 0.12 : 0)) + clamp(this.pitch - 0.2, -0.15, 0.6) * (dragging ? 1 : 0);
      if (dragging) this.pitch = clamp(this.pitch + look.dy * 0.004 * sens, -0.05, 0.9);
      else this.pitch = damp(this.pitch, 0.2, 2, dt);
      tx = v.x; ty = v.y + 1.5 * big; tz = v.z;
      this.camera.fov = damp(this.camera.fov, this.fovBase + Math.min(14, sp * 0.28), 3, dt);
    } else {
      const h = p.human;
      this.yaw = wrapAngle(this.yaw - look.dx * 0.006 * sens);
      this.pitch = clamp(this.pitch + look.dy * 0.004 * sens, -0.25, 1.1);
      if (!dragging && h.speed > 1.5) this.yaw = dampAngle(this.yaw, h.heading, 1.6, dt);
      dist = [4.6, 6.5, 3.2][this.zoom];
      pitchTarget = this.pitch;
      tx = h.x; ty = h.y + 1.55; tz = h.z;
      this.camera.fov = damp(this.camera.fov, this.fovBase, 3, dt);
    }
    if (this._snap) { this.target.set(tx, ty, tz); this._snap = false; }
    else {
      this.target.x = damp(this.target.x, tx, 18, dt);
      this.target.y = damp(this.target.y, ty, 10, dt);
      this.target.z = damp(this.target.z, tz, 18, dt);
    }
    const pitch = p.vehicle ? (dragging ? this.pitch : pitchTarget) : this.pitch;
    const fx = Math.sin(this.yaw) * Math.cos(pitch);
    const fz = Math.cos(this.yaw) * Math.cos(pitch);
    const fy = -Math.sin(pitch);
    // keep the camera out of buildings
    const wantX = this.target.x - fx * dist, wantZ = this.target.z - fz * dist;
    const hit = game.collision.raycast(this.target.x, this.target.z, wantX, wantZ);
    const d = hit < 1 ? Math.max(1.2, dist * hit - 0.6) : dist;
    this.dist = hit < 1 ? Math.min(this.dist, d) : damp(this.dist, d, 3, dt);
    const cx = this.target.x - fx * this.dist, cz = this.target.z - fz * this.dist;
    let cy = this.target.y - fy * this.dist;
    cy = Math.max(cy, heightAt(cx, cz) + 0.6);
    this.camera.position.set(cx, cy, cz);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      const s = this.shake * 0.35;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
    }
    this._look.set(this.target.x + fx * 4, this.target.y + fy * 4 + 0.3, this.target.z + fz * 4);
    this.camera.lookAt(this._look);
    this.camera.updateProjectionMatrix();
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
}
