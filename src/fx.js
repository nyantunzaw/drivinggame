// GPU point-sprite particles: smoke, fire, sparks, splashes, tyre smoke.
import * as THREE from 'three';

const vert = /* glsl */`
attribute float size; attribute vec4 pcolor;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vColor = pcolor;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (420.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const frag = /* glsl */`
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.1, d) * vColor.a;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <fog_fragment>
}`;

class System {
  constructor(scene, n, additive) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.grow = new Float32Array(n);
    this.base = new Float32Array(n * 4);
    this.grav = new Float32Array(n);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('pcolor', this.aCol);
    g.setAttribute('size', this.aSize);
    const m = new THREE.ShaderMaterial({
      vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, size, grow, r, g, b, a, grav = 0) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size; this.grow[i] = grow; this.grav[i] = grav;
    this.base[i * 4] = r; this.base[i * 4 + 1] = g; this.base[i * 4 + 2] = b; this.base[i * 4 + 3] = a;
  }

  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.col[i * 4] = this.base[i * 4];
      this.col[i * 4 + 1] = this.base[i * 4 + 1];
      this.col[i * 4 + 2] = this.base[i * 4 + 2];
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * t;
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }
}

export class FX {
  constructor(scene) {
    this.smoke = new System(scene, 420, false);
    this.fire = new System(scene, 360, true);
    this.flash = new THREE.PointLight(0xffa040, 0, 60, 1.6);
    scene.add(this.flash);
    this.flashT = 0;
    this.acc = 0;
  }

  explosion(x, y, z) {
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 9;
      this.fire.emit(x, y + 1, z, Math.cos(a) * s, 2 + Math.random() * 9, Math.sin(a) * s, 0.5 + Math.random() * 0.6, 2.5 + Math.random() * 3, 4, 1, 0.55 + Math.random() * 0.3, 0.15, 1, 6);
    }
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 4;
      this.smoke.emit(x, y + 1.5, z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 2.5 + Math.random() * 2, 3, 3.5, 0.12, 0.11, 0.1, 0.8, -0.5);
    }
    this.flash.position.set(x, y + 3, z);
    this.flashT = 0.6;
  }

  sparks(x, y, z, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 6;
      this.fire.emit(x, y, z, Math.cos(a) * s, 1 + Math.random() * 4, Math.sin(a) * s, 0.25 + Math.random() * 0.3, 0.35, -0.5, 1, 0.8, 0.3, 1, 14);
    }
  }

  splash(x, y, z) {
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 4;
      this.smoke.emit(x, y + 0.3, z, Math.cos(a) * s, 3 + Math.random() * 5, Math.sin(a) * s, 0.9, 1.2, 1.5, 0.85, 0.92, 0.95, 0.8, 12);
    }
  }

  update(dt, game) {
    this.acc += dt;
    const emit = this.acc > 0.05;
    if (emit) {
      this.acc = 0;
      const night = game.sky.night;
      for (const v of game.vehicles) {
        const d2 = (v.x - game.camera.position.x) ** 2 + (v.z - game.camera.position.z) ** 2;
        if (d2 > 200 * 200) continue;
        const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
        const ex = v.x + fx * v.def.len * 0.4, ez = v.z + fz * v.def.len * 0.4;
        if (v.smoking || v.wrecked) {
          const k = v.wrecked ? 0.08 : 0.3 + (1 - Math.max(0, v.health) / 350) * 0.4;
          this.smoke.emit(ex, v.y + 1.2, ez, (Math.random() - 0.5), 2.2 + Math.random(), (Math.random() - 0.5), 2.2, 1.2, 2.4, k, k, k, 0.6, -0.4);
        }
        if (v.burning || (v.wrecked && Math.random() < 0.3)) {
          this.fire.emit(ex + (Math.random() - 0.5), v.y + 1.1, ez + (Math.random() - 0.5), 0, 3 + Math.random() * 2, 0, 0.5, 1.6, 1.2, 1, 0.5, 0.12, 1, 0);
        }
        if (v.slip > 0.35 && v.speed > 8 && v.sinking === 0) {
          const rx = v.x - fx * v.def.len * 0.35, rz = v.z - fz * v.def.len * 0.35;
          const c = 0.75 + night * -0.4;
          this.smoke.emit(rx, v.groundY + 0.4, rz, -v.vx * 0.05, 0.6, -v.vz * 0.05, 1.2, 1.2, 2.2, c, c, c, 0.45 * v.slip, -0.2);
        }
        if (v.sinking > 0 && v.sinking < 2.5) {
          this.smoke.emit(v.x + (Math.random() - 0.5) * 2, 0.4, v.z + (Math.random() - 0.5) * 2, 0, 2, 0, 0.6, 1.0, 1.5, 0.85, 0.92, 0.95, 0.7, 6);
        }
      }
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.intensity = Math.max(0, this.flashT) * 400;
    } else this.flash.intensity = 0;
    this.smoke.update(dt);
    this.fire.update(dt);
  }
}
