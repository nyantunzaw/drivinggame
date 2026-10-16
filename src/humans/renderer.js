// Instanced low-poly people: torso/head, arms and legs are separate instanced meshes
// so every pedestrian animates with only a handful of draw calls.
import * as THREE from 'three';
import { blobTexture } from '../textures.js';

const CAP = 64;
const tmp = new THREE.Color();
const lin = (hex) => { tmp.set(hex); return [tmp.r, tmp.g, tmp.b]; };

class B {
  constructor() { this.p = []; this.n = []; this.c = []; this.paint = []; this.idx = []; }
  box(cx, y0, cz, sx, sy, sz, color, paint = 0, topScale = 1) {
    const hx = sx / 2, hz = sz / 2, tx = hx * topScale, tz = hz * topScale;
    const v = [[cx - hx, y0, cz - hz], [cx + hx, y0, cz - hz], [cx + hx, y0, cz + hz], [cx - hx, y0, cz + hz],
      [cx - tx, y0 + sy, cz - tz], [cx + tx, y0 + sy, cz - tz], [cx + tx, y0 + sy, cz + tz], [cx - tx, y0 + sy, cz + tz]];
    const faces = [[4, 7, 6, 5], [0, 1, 2, 3], [3, 2, 6, 7], [1, 0, 4, 5], [2, 1, 5, 6], [0, 3, 7, 4]];
    const c = lin(color);
    for (const f of faces) {
      const vs = f.map((i) => v[i]);
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < 4; i++) {
        const a = vs[i], b = vs[(i + 1) % 4];
        nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      const base = this.p.length / 3;
      for (const p of vs) { this.p.push(...p); this.n.push(nx / l, ny / l, nz / l); this.c.push(...c); this.paint.push(paint); }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('paint', new THREE.Float32BufferAttribute(this.paint, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

const SKIN = '#a8744f';
function torso(variant) {
  const b = new B();
  const skin = variant === 'monk' ? '#b07a52' : SKIN;
  b.box(0, 0.86, 0, 0.42, 0.56, 0.24, '#ffffff', 1, 0.95);      // shirt / robe
  b.box(0, 1.42, 0, 0.12, 0.06, 0.12, skin);                     // neck
  b.box(0, 1.47, 0.01, 0.24, 0.27, 0.25, skin);                  // head
  b.box(0.06, 1.6, 0.13, 0.04, 0.03, 0.01, '#111');              // eyes
  b.box(-0.06, 1.6, 0.13, 0.04, 0.03, 0.01, '#111');
  if (variant !== 'monk') b.box(0, 1.66, -0.01, 0.26, 0.1, 0.27, '#141210'); // hair
  if (variant === 'longyi' || variant === 'monk') {
    b.box(0, 0.26, 0, 0.36, 0.62, 0.26, '#ffffff', 2, 1.08);     // longyi / robe skirt
  } else {
    b.box(0, 0.8, 0, 0.42, 0.1, 0.25, '#ffffff', 2);              // belt line
  }
  if (variant === 'monk') b.box(0.12, 0.9, 0, 0.24, 0.5, 0.26, '#ffffff', 1); // draped robe
  return b.build();
}
function arm() {
  const b = new B();
  b.box(0, -0.42, 0, 0.11, 0.42, 0.12, '#ffffff', 1);
  b.box(0, -0.58, 0, 0.1, 0.16, 0.1, SKIN);
  return b.build();
}
function leg() {
  const b = new B();
  b.box(0, -0.8, 0, 0.15, 0.74, 0.16, '#ffffff', 2);
  b.box(0, -0.86, 0.04, 0.14, 0.07, 0.24, '#2a2420');           // sandal/shoe
  return b.build();
}

function humanMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float paint; attribute vec3 iColor2;')
      .replace('#include <color_vertex>', `
        vColor = vec3(1.0);
        vColor *= color;
        #ifdef USE_INSTANCING_COLOR
          float p1 = step(0.5, paint) * step(paint, 1.5);
          float p2 = step(1.5, paint);
          vColor = mix(vColor, vColor * instanceColor.rgb, p1);
          vColor = mix(vColor, vColor * iColor2, p2);
        #endif`);
  };
  m.customProgramCacheKey = () => 'human-paint';
  return m;
}

export class HumanRenderer {
  constructor(scene) {
    const mat = humanMaterial();
    const mk = (geo, cap) => {
      const c2 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      c2.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iColor2', c2);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color());
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      return { mesh, c2, n: 0 };
    };
    this.torso = { pants: mk(torso('pants'), CAP), longyi: mk(torso('longyi'), CAP), monk: mk(torso('monk'), CAP) };
    this.arms = mk(arm(), CAP * 2);
    this.legs = mk(leg(), CAP * 2);
    const blob = new THREE.PlaneGeometry(1, 1);
    blob.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(blob, new THREE.MeshBasicMaterial({
      map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -12,
    }), CAP);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 3;
    this.shadows.count = 0;
    scene.add(this.shadows);
    this._base = new THREE.Matrix4();
    this._m = new THREE.Matrix4();
    this._l = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  begin() {
    for (const k in this.torso) this.torso[k].n = 0;
    this.arms.n = 0;
    this.legs.n = 0;
    this.shadows.count = 0;
  }

  add(h) {
    if (!h.visible) return;
    const slot = this.torso[h.variant];
    if (slot.n >= CAP || this.arms.n + 2 > CAP * 2) return;
    // base transform
    this._e.set(h.tiltX || 0, h.heading, h.tiltZ || 0, 'YXZ');
    this._q.setFromEuler(this._e);
    this._p.set(h.x, h.y + (h.bobY || 0), h.z);
    this._s.set(h.scale || 1, h.scale || 1, h.scale || 1);
    this._base.compose(this._p, this._q, this._s);

    const i = slot.n++;
    slot.mesh.setMatrixAt(i, this._base);
    slot.mesh.setColorAt(i, h.shirt);
    slot.c2.array[i * 3] = h.lower.r; slot.c2.array[i * 3 + 1] = h.lower.g; slot.c2.array[i * 3 + 2] = h.lower.b;

    const legA = h.legSwing || 0, armA = h.armSwing || 0;
    for (const side of [-1, 1]) {
      // arms
      let ax = -armA * side;
      if (side === 1 && h.punch > 0) ax = -1.5 * Math.sin(Math.min(1, h.punch) * Math.PI);
      if (h.armsUp) ax = -2.6;
      this._e.set(ax, 0, side * (h.armsUp ? 0.2 : 0.06), 'XYZ');
      this._q.setFromEuler(this._e);
      this._p.set(side * 0.27, 1.4, 0);
      this._s.set(1, 1, 1);
      this._l.compose(this._p, this._q, this._s);
      this._m.multiplyMatrices(this._base, this._l);
      const ai = this.arms.n++;
      this.arms.mesh.setMatrixAt(ai, this._m);
      this.arms.mesh.setColorAt(ai, h.shirt);
      this.arms.c2.array[ai * 3] = h.lower.r; this.arms.c2.array[ai * 3 + 1] = h.lower.g; this.arms.c2.array[ai * 3 + 2] = h.lower.b;
      // legs
      this._e.set(legA * side, 0, 0, 'XYZ');
      this._q.setFromEuler(this._e);
      this._p.set(side * 0.1, 0.88, 0);
      this._l.compose(this._p, this._q, this._s);
      this._m.multiplyMatrices(this._base, this._l);
      const li = this.legs.n++;
      this.legs.mesh.setMatrixAt(li, this._m);
      this.legs.mesh.setColorAt(li, h.shirt);
      this.legs.c2.array[li * 3] = h.lower.r; this.legs.c2.array[li * 3 + 1] = h.lower.g; this.legs.c2.array[li * 3 + 2] = h.lower.b;
    }
    if (this.shadows.count < CAP) {
      this._q.identity();
      this._p.set(h.x, h.groundY + 0.13, h.z);
      this._s.set(0.9, 1, 0.9);
      this._m.compose(this._p, this._q, this._s);
      this.shadows.setMatrixAt(this.shadows.count++, this._m);
    }
  }

  end() {
    const fin = (s) => {
      s.mesh.count = s.n;
      s.mesh.instanceMatrix.needsUpdate = true;
      if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
      s.c2.needsUpdate = true;
    };
    for (const k in this.torso) fin(this.torso[k]);
    fin(this.arms);
    fin(this.legs);
    this.shadows.instanceMatrix.needsUpdate = true;
  }
}
