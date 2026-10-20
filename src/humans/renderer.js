// Instanced people with smooth, properly proportioned bodies: a body mesh per outfit
// (torso, hips, neck, head with face and hair, longyi or robe) plus jointed limbs
// (upper arm, forearm + hand, thigh, shin + foot) so elbows and knees bend as they walk.
// Each part has a near and a far (lighter) version; everyone animates with about
// twenty draw calls in total.
//
// Vertex attribute `paint` picks the per-person colour: 1 shirt, 2 lower (longyi /
// trousers / robe), 3 skin; 0 keeps the vertex colour (hair, eyes, sandals...).
import * as THREE from 'three';
import { blobTexture } from '../textures.js';
import { NEAR as CAR_NEAR } from '../vehicles/renderer.js';

const CAP = 96;
const NEAR = 28;           // metres: full detail (faces) inside this
const tmp = new THREE.Color();
const lin = (hex) => { tmp.set(hex); return [tmp.r, tmp.g, tmp.b]; };
const WHITE = '#ffffff';
const HAIR = '#16120f';

class B {
  constructor(lod) { this.lod = lod; this.p = []; this.n = []; this.c = []; this.paint = []; this.idx = []; this.keep = []; }

  // Surface of revolution around the y axis; prof = [[radius, y, paint, color], ...] from the
  // bottom up. A repeated y starts a crisp seam (new paint); radius 0 is a pole. sx / sz
  // squash the cross-section; open ends are capped.
  lathe(prof, { seg = 14, sx = 1, sz = 1, x = 0, z = 0, y = 0 } = {}) {
    if (this.lod) seg = Math.max(6, Math.round(seg * 0.6));
    const P = [];
    const f = prof[0], l = prof[prof.length - 1];
    if (f[0] > 1e-4) P.push([0, f[1], f[2], f[3]], f.slice(), f.slice());
    P.push(...prof);
    if (l[0] > 1e-4) P.push(l.slice(), l.slice(), [0, l[1], l[2], l[3]]);
    const rows = [];
    for (const [r, py, paint = 0, color = WHITE] of P) {
      const c = lin(color);
      const start = this.p.length / 3;
      const n = r < 1e-4 ? 1 : seg;
      for (let k = 0; k < n; k++) {
        const a = (k / seg) * Math.PI * 2;
        this.p.push(x + Math.sin(a) * r * sx, y + py, z + Math.cos(a) * r * sz);
        this.n.push(0, 0, 0);
        this.c.push(...c);
        this.paint.push(paint);
      }
      rows.push({ start, pole: n === 1, y: py });
    }
    for (let i = 0; i + 1 < rows.length; i++) {
      const A = rows[i], C = rows[i + 1];
      if (A.pole && C.pole) continue;
      if (!A.pole && !C.pole && A.y === C.y) continue; // seam
      for (let k = 0; k < seg; k++) {
        const k1 = (k + 1) % seg;
        if (A.pole) this.idx.push(A.start, C.start + k1, C.start + k);
        else if (C.pole) this.idx.push(A.start + k, A.start + k1, C.start);
        else {
          const a = A.start + k, b = A.start + k1, c = C.start + k1, d = C.start + k;
          this.idx.push(a, b, c, a, c, d);
        }
      }
    }
  }

  // Ellipsoid (keeps its own analytic normals)
  ell(x, y, z, rx, ry, rz, paint = 0, color = WHITE, seg = 10, rot = null) {
    if (this.lod) seg = Math.max(6, Math.round(seg * 0.6));
    const g = new THREE.SphereGeometry(1, seg, Math.max(4, seg >> 1));
    const q = rot ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)) : new THREE.Quaternion();
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(rx, ry, rz)));
    const base = this.p.length / 3;
    const Pa = g.attributes.position.array, Na = g.attributes.normal.array;
    const c = lin(color);
    for (let i = 0; i < Pa.length; i += 3) {
      this.p.push(Pa[i], Pa[i + 1], Pa[i + 2]); this.n.push(Na[i], Na[i + 1], Na[i + 2]); this.c.push(...c); this.paint.push(paint);
    }
    for (const i of g.index.array) this.idx.push(base + i);
    this.keep.push([base, Pa.length / 3]);
  }

  // small details only up close
  detail(fn) { if (!this.lod) fn(); }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('paint', new THREE.Float32BufferAttribute(this.paint, 1));
    g.setIndex(this.idx);
    const keep = this.keep.map(([a, n]) => [a, this.n.slice(a * 3, (a + n) * 3)]);
    g.computeVertexNormals();
    const N = g.attributes.normal.array;
    for (const [a, n] of keep) N.set(n, a * 3);
    g.computeBoundingSphere();
    return g;
  }
}

// Two-bone reach in the side (y, z) plane from a joint to a target offset (dy, dz), bones
// a then b. Returns the swing of the first bone (0 hanging down, negative forward) and the
// bend of the second: knees bend backward, elbows (elbow = true) forward.
function reach(dy, dz, a, b, elbow) {
  const d = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, Math.hypot(dy, dz)));
  const th = Math.atan2(-dz, -dy);
  const al = Math.acos(Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
  const bend = Math.PI - Math.acos(Math.max(-1, Math.min(1, (a * a + b * b - d * d) / (2 * a * b))));
  return [elbow ? th + al : th - al, bend];
}

// Body proportions (metres, standing on y = 0, facing +z, right hand side at -x)
export const HIP_Y = 0.88, HIP_X = 0.09;
const SH_Y = 1.37, SH_X = 0.195;
export const UPPER = 0.29, FORE = 0.25, THIGH = 0.42, SHIN = 0.41;

function head(b, { hair = 'short', thanaka = false, cap = false } = {}) {
  b.lathe([[0.05, 1.42, 3], [0.049, 1.5, 3]], { seg: 10 });                         // neck
  b.lathe([[0, 1.47, 3], [0.055, 1.482, 3], [0.08, 1.515, 3], [0.093, 1.56, 3], [0.098, 1.605, 3],
    [0.096, 1.65, 3], [0.08, 1.69, 3], [0.046, 1.719, 3], [0, 1.728, 3]], { seg: 16, sx: 0.94, sz: 1.08, z: 0.012 });
  b.ell(0, 1.585, 0.11, 0.015, 0.026, 0.02, 3, WHITE, 8);                         // nose
  for (const sd of [-1, 1]) b.ell(sd * 0.093, 1.6, 0.0, 0.013, 0.027, 0.02, 3, WHITE, 6); // ears
  b.detail(() => {
    for (const sd of [-1, 1]) {
      b.ell(sd * 0.034, 1.61, 0.104, 0.017, 0.0105, 0.008, 0, '#ece6dc', 8);       // eyes
      b.ell(sd * 0.034, 1.61, 0.11, 0.0085, 0.0085, 0.004, 0, '#1a120d', 6);       // irises
      b.ell(sd * 0.036, 1.632, 0.106, 0.021, 0.0055, 0.007, 0, HAIR, 6);          // brows
      if (thanaka) b.ell(sd * 0.054, 1.574, 0.088, 0.032, 0.028, 0.012, 0, '#e2cf9a', 10); // thanaka on the cheeks
    }
    b.ell(0, 1.546, 0.104, 0.021, 0.0065, 0.007, 0, '#7a4038', 6);                  // mouth
  });
  if (hair === 'short') {
    b.lathe([[0.101, 1.652, 0, HAIR], [0.088, 1.698, 0, HAIR], [0.053, 1.731, 0, HAIR], [0, 1.742, 0, HAIR]],
      { seg: 16, sx: 0.95, sz: 1.08, z: 0.006 });
    b.ell(0, 1.625, -0.026, 0.094, 0.082, 0.088, 0, HAIR);
  } else if (hair === 'long') {
    b.lathe([[0.102, 1.65, 0, HAIR], [0.089, 1.7, 0, HAIR], [0.054, 1.732, 0, HAIR], [0, 1.744, 0, HAIR]],
      { seg: 16, sx: 0.95, sz: 1.08, z: 0.006 });
    b.ell(0, 1.6, -0.03, 0.098, 0.1, 0.088, 0, HAIR);
    b.ell(0, 1.655, -0.118, 0.05, 0.048, 0.045, 0, HAIR, 8);                        // bun
    b.ell(-0.045, 1.68, -0.1, 0.016, 0.016, 0.016, 0, '#e85d9a', 6);                // a flower in the hair
  } else if (hair === 'shaved') {
    b.lathe([[0.096, 1.62, 0, '#3a2f28'], [0.096, 1.652, 0, '#3a2f28'], [0.081, 1.692, 0, '#3a2f28'], [0.047, 1.721, 0, '#3a2f28'], [0, 1.73, 0, '#3a2f28']],
      { seg: 16, sx: 0.95, sz: 1.08, z: 0.012 });
  }
  if (cap) {
    const C = '#4a4536';
    b.lathe([[0.106, 1.66, 0, C], [0.108, 1.715, 0, C], [0.118, 1.76, 0, C], [0, 1.775, 0, C]], { seg: 14, sx: 0.95, sz: 1.08, z: 0.008 });
    b.ell(0, 1.665, 0.1, 0.085, 0.008, 0.06, 0, '#141414', 8);                    // visor
    b.ell(0, 1.71, 0.112, 0.016, 0.016, 0.006, 0, '#d9b84a', 6);                  // badge
  }
}

// Torso from the hips to the shoulders, elliptical in section; below the waist it takes
// the lower colour (trousers), above it the shirt
function torso(b, { female = false, belt = false } = {}) {
  const r = female
    ? [0.17, 0.168, 0.135, 0.14, 0.158, 0.16, 0.152, 0.118, 0.06]
    : [0.165, 0.17, 0.15, 0.152, 0.163, 0.17, 0.168, 0.13, 0.064];
  const W = 1.0;
  b.lathe([
    [r[0], 0.84, 2], [r[1], 0.93, 2], [r[2], W, 2], [r[2], W, 1], [r[3], 1.1, 1], [r[4], 1.22, 1],
    [r[5], 1.3, 1], [r[6], 1.355, 1], [r[7], 1.405, 1], [r[8], 1.44, 1],
  ], { seg: 16, sz: female ? 0.66 : 0.62 });
  // shoulders: rounded caps joining the collar to the arms
  for (const sd of [-1, 1]) b.ell(sd * 0.165, 1.36, 0, 0.065, 0.045, 0.06, 1, WHITE, 10);
  if (belt) b.lathe([[0.154, W - 0.025, 0, '#1b1b1b'], [0.154, W + 0.02, 0, '#1b1b1b']], { seg: 16, sz: 0.64 });
}

function bodyGeo(variant, lod) {
  const b = new B(lod);
  if (variant === 'pants') {
    torso(b, { belt: true });
    head(b, { hair: 'short' });
  } else if (variant === 'longyi') {
    torso(b);
    // men's longyi: a loose tube of cloth from the waist to the ankles, knotted at the front
    b.lathe([[0.2, 0.09, 2], [0.198, 0.4, 2], [0.185, 0.7, 2], [0.165, 0.92, 2], [0.152, 1.03, 2]], { seg: 16, sz: 0.9 });
    b.ell(0, 0.985, 0.135, 0.05, 0.045, 0.035, 2, WHITE, 8);
    head(b, { hair: 'short' });
  } else if (variant === 'htamein') {
    torso(b, { female: true });
    // women's htamein: slimmer wrap skirt with a contrasting woven hem
    b.lathe([[0.185, 0.07, 0, '#2a1f2a'], [0.184, 0.17, 0, '#2a1f2a'], [0.184, 0.17, 2], [0.18, 0.45, 2],
      [0.168, 0.75, 2], [0.15, 0.93, 2], [0.137, 1.03, 2]], { seg: 16, sz: 0.86 });
    head(b, { hair: 'long', thanaka: true });
  } else if (variant === 'monk') {
    torso(b);
    b.lathe([[0.215, 0.07, 2], [0.212, 0.4, 2], [0.195, 0.75, 2], [0.17, 0.95, 2], [0.155, 1.04, 2]], { seg: 16, sz: 0.88 });
    // the outer robe wraps the body and drapes over the left shoulder, leaving the right bare
    b.ell(0.035, 1.17, 0.0, 0.135, 0.29, 0.125, 1, '#b8b8b8', 12, [0, 0, -0.5]);
    head(b, { hair: 'shaved' });
  } else if (variant === 'cop') {
    torso(b, { belt: true });
    b.detail(() => {
      for (const sd of [-1, 1]) b.ell(sd * 0.07, 1.26, 0.094, 0.034, 0.03, 0.006, 1, '#d0d0d0', 6);  // breast pockets
      b.ell(0.07, 1.3, 0.1, 0.01, 0.012, 0.004, 0, '#d9b84a', 6);                                    // badge
      for (const sd of [-1, 1]) b.ell(sd * 0.15, 1.38, 0.0, 0.035, 0.01, 0.03, 1, '#9a9a9a', 6);     // epaulettes
    });
    head(b, { hair: 'short', cap: true });
  }
  return b.build();
}

// Limb segments hang from their joint at the origin down the -y axis.
function upperArmGeo(lod, bare) {
  const b = new B(lod);
  const s = bare ? 3 : 1;
  b.lathe([[0.039, -UPPER, 3], [0.043, -0.16, 3], [0.043, -0.16, s], [0.05, -0.15, s], [0.052, -0.06, s], [0.047, 0.0, s], [0, 0.03, s]], { seg: 10, sx: 0.95 });
  return b.build();
}
function forearmGeo(lod) {
  const b = new B(lod);
  b.lathe([[0, -FORE - 0.004, 3], [0.027, -FORE + 0.006, 3], [0.031, -0.16, 3], [0.039, -0.05, 3], [0.037, 0.0, 3], [0, 0.03, 3]], { seg: 10, sz: 0.88 });
  b.ell(0, -FORE - 0.058, 0.004, 0.023, 0.062, 0.042, 3, WHITE, 8);   // hand
  b.ell(0, -FORE - 0.03, 0.036, 0.011, 0.03, 0.011, 3, WHITE, 6);     // thumb
  return b.build();
}
function thighGeo(lod) {
  const b = new B(lod);
  b.lathe([[0.056, -THIGH, 2], [0.064, -0.3, 2], [0.078, -0.12, 2], [0.082, -0.02, 2], [0, 0.05, 2]], { seg: 12, sz: 0.98 });
  return b.build();
}
function shinGeo(lod, bare) {
  const b = new B(lod);
  const p = bare ? 3 : 2;
  b.lathe([[0.034, -SHIN + 0.04, p], [0.04, -0.3, p], [0.05, -0.15, p], [0.053, -0.03, p], [0, 0.04, p]], { seg: 12, sz: 0.95 });
  if (bare) {
    // flip-flops (hnyat-phanat) under bare feet
    b.ell(0, -SHIN - 0.005, 0.045, 0.043, 0.027, 0.1, 3, WHITE, 8);
    b.ell(0, -SHIN - 0.03, 0.05, 0.048, 0.007, 0.125, 0, '#5e4128', 8);
  } else {
    b.ell(0, -SHIN, 0.045, 0.05, 0.04, 0.12, 0, '#1f1c1a', 8);
  }
  return b.build();
}

function humanMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float paint; attribute vec3 iColor2; attribute vec3 iSkin;')
      .replace('#include <color_vertex>', `
        vColor = vec3(1.0);
        vColor *= color;
        #ifdef USE_INSTANCING_COLOR
          float p1 = step(0.5, paint) * step(paint, 1.5);
          float p2 = step(1.5, paint) * step(paint, 2.5);
          float p3 = step(2.5, paint);
          vColor = mix(vColor, vColor * instanceColor.rgb, p1);
          vColor = mix(vColor, vColor * iColor2, p2);
          vColor = mix(vColor, vColor * iSkin, p3);
        #endif`);
  };
  m.customProgramCacheKey = () => 'human-paint-v2';
  return m;
}

export const VARIANTS = ['pants', 'longyi', 'htamein', 'monk', 'cop'];
const SKIRT = { longyi: true, htamein: true, monk: true };

export class HumanRenderer {
  constructor(scene) {
    const mat = humanMaterial();
    const mk = (geo, cap) => {
      const c2 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      const sk = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      c2.setUsage(THREE.DynamicDrawUsage);
      sk.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iColor2', c2);
      geo.setAttribute('iSkin', sk);
      const mesh = new THREE.InstancedMesh(geo, mat, cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color());
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      return { mesh, c2, sk, n: 0 };
    };
    this.sets = [false, true].map((lod) => {
      const bodies = {};
      for (const v of VARIANTS) bodies[v] = mk(bodyGeo(v, lod), CAP);
      return {
        bodies,
        upper: mk(upperArmGeo(lod, false), CAP * 2),
        upperBare: mk(upperArmGeo(lod, true), CAP),
        fore: mk(forearmGeo(lod), CAP * 2),
        thigh: mk(thighGeo(lod), CAP * 2),
        shinShod: mk(shinGeo(lod, false), CAP * 2),
        shinBare: mk(shinGeo(lod, true), CAP * 2),
      };
    });
    this.slots = [];
    for (const s of this.sets) {
      for (const k in s.bodies) this.slots.push(s.bodies[k]);
      for (const k of ['upper', 'upperBare', 'fore', 'thigh', 'shinShod', 'shinBare']) this.slots.push(s[k]);
    }
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
    this._j = new THREE.Matrix4();
    this._m = new THREE.Matrix4();
    this._l = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._one = new THREE.Vector3(1, 1, 1);
    this._hip = new THREE.Matrix4().makeTranslation(0, -HIP_Y, 0);
    this._seat = { shoulder: [0, 0], roll: [0.1, 0.1], elbow: [0, 0], hip: [0, 0], knee: [0, 0] };
    this._frustum = new THREE.Frustum();
    this._pv = new THREE.Matrix4();
    this._sphere = new THREE.Sphere(new THREE.Vector3(), 1.3);
    this._cam = null;
  }

  begin(camera) {
    for (const s of this.slots) s.n = 0;
    this.shadows.count = 0;
    this._cam = camera || null;
    if (camera) {
      camera.updateMatrixWorld();
      this._pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._pv);
    }
  }

  _put(slot, m, h) {
    const i = slot.n++;
    slot.mesh.setMatrixAt(i, m);
    slot.mesh.setColorAt(i, h.shirt);
    const a = slot.c2.array, s = slot.sk.array;
    a[i * 3] = h.lower.r; a[i * 3 + 1] = h.lower.g; a[i * 3 + 2] = h.lower.b;
    s[i * 3] = h.skin.r; s[i * 3 + 1] = h.skin.g; s[i * 3 + 2] = h.skin.b;
  }

  // out = parent * T(x, y, z) * R(rx, 0, rz)
  _joint(out, parent, x, y, z, rx, rz = 0) {
    this._e.set(rx, 0, rz, 'XYZ');
    this._q.setFromEuler(this._e);
    this._p.set(x, y, z);
    this._l.compose(this._p, this._q, this._one);
    out.multiplyMatrices(parent, this._l);
    return out;
  }

  add(h) {
    if (!h.visible) return;
    let far = false;
    if (this._cam) {
      this._sphere.center.set(h.x, h.y + 0.9, h.z);
      if (!this._frustum.intersectsSphere(this._sphere)) return;
      const c = this._cam.position;
      far = (h.x - c.x) ** 2 + (h.z - c.z) ** 2 > NEAR * NEAR;
    }
    const set = this.sets[far ? 1 : 0];
    const body = set.bodies[h.variant] || set.bodies.pants;
    if (body.n >= CAP || set.fore.n + 2 > CAP * 2) return;
    this._e.set(h.tiltX || 0, h.heading, h.tiltZ || 0, 'YXZ');
    this._q.setFromEuler(this._e);
    this._p.set(h.x, h.y + (h.bobY || 0), h.z);
    const sc = h.scale || 1;
    this._s.set(sc, sc, sc);
    this._base.compose(this._p, this._q, this._s);
    const skirt = SKIRT[h.variant];
    this._draw(set, body, h.pose, h, skirt, skirt, h.variant === 'monk');
    if (this.shadows.count < CAP) {
      this._q.identity();
      this._p.set(h.x, h.groundY + 0.13, h.z);
      this._s.set(0.9, 1, 0.9);
      this._m.compose(this._p, this._q, this._s);
      this.shadows.setMatrixAt(this.shadows.count++, this._m);
    }
  }

  // Body and limbs about this._base
  _draw(set, body, pose, look, hideThighs, bare, monk) {
    this._put(body, this._base, look);
    const shin = bare ? set.shinBare : set.shinShod;
    const jm = this._j, lm = this._m;
    for (let i = 0; i < 2; i++) {
      const sd = i === 0 ? -1 : 1;   // 0 = right (-x), 1 = left
      // arm: shoulder swing plus a little outward roll, then the elbow bends forward
      this._joint(jm, this._base, sd * SH_X, SH_Y, 0, pose.shoulder[i], sd * pose.roll[i]);
      // a monk's right shoulder is bare
      this._put(monk && i === 0 ? set.upperBare : set.upper, jm, look);
      this._joint(lm, jm, 0, -UPPER, 0, -pose.elbow[i]);
      this._put(set.fore, lm, look);
      // leg: hip swing, then the knee bends back; thighs are hidden inside skirts
      this._joint(jm, this._base, sd * HIP_X, HIP_Y, 0, pose.hip[i], sd * 0.025);
      if (!hideThighs) this._put(set.thigh, jm, look);
      this._joint(lm, jm, 0, -THIGH, 0, pose.knee[i]);
      this._put(shin, lm, look);
    }
  }

  // A driver behind the wheel, or a trishaw rider pedalling: hips on the vehicle's seat,
  // hands and feet reaching for the wheel / handlebars and pedals.
  addRider(v, look) {
    const def = v.def, st = def.seat;
    if (!st || !look) return;
    let far = false;
    if (this._cam) {
      this._sphere.center.set(v.x, v.y + 1, v.z);
      if (!this._frustum.intersectsSphere(this._sphere)) return;
      const c = this._cam.position;
      const d2 = (v.x - c.x) ** 2 + (v.z - c.z) ** 2;
      if (!def.pedal && d2 > CAR_NEAR * CAR_NEAR) return; // distant cars have opaque glass
      far = d2 > NEAR * NEAR;
    }
    const set = this.sets[far ? 1 : 0];
    const body = set.bodies[look.variant === 'cop' ? 'cop' : 'pants'];
    if (body.n >= CAP || set.fore.n + 2 > CAP * 2) return;
    const sc = look.scale || 1, lean = -st.recline;
    this._e.set(v.pitch, v.heading, v.roll, 'YXZ');
    this._q.setFromEuler(this._e);
    this._p.set(v.x, v.y + v.bob, v.z);
    this._m.compose(this._p, this._q, this._one);
    this._e.set(lean, 0, 0, 'XYZ');
    this._q.setFromEuler(this._e);
    this._p.set(st.x, st.y, st.z);
    this._s.set(sc, sc, sc);
    this._l.compose(this._p, this._q, this._s);
    this._base.multiplyMatrices(this._m, this._l).multiply(this._hip);

    const P = this._seat;
    const shY = (SH_Y - HIP_Y) * sc;
    const sy = shY * Math.cos(lean), sz = shY * Math.sin(lean);   // shoulders from the hips
    const turn = Math.max(-1.1, Math.min(1.1, (v.steerAngle || 0) * 3));
    for (let i = 0; i < 2; i++) {
      let hy, hz, fy, fz;
      if (st.bars) {
        hy = st.bars[0] - st.y; hz = st.bars[1] - st.z;
        const a = v.wheelSpin * 0.45 + i * Math.PI;
        fy = st.crank[0] - st.y + Math.cos(a) * st.crank[2];
        fz = st.crank[1] - st.z + Math.sin(a) * st.crank[2];
      } else {
        // hands at ten to two on the rim, turning with the steering
        hy = 0.42 + 0.18 * Math.sin(0.52 + (i === 0 ? turn : -turn)); hz = 0.47;
        [fy, fz] = st.feet || [-0.3, 0.72];
      }
      const [sh, el] = reach(hy - sy, hz - sz, UPPER * sc, (FORE + 0.06) * sc, true);
      P.shoulder[i] = sh - lean; P.elbow[i] = el;
      const [hp, kn] = reach(fy, fz, THIGH * sc, SHIN * sc, false);
      P.hip[i] = hp - lean; P.knee[i] = kn;
    }
    this._draw(set, body, P, look, false, SKIRT[look.variant], false);
  }

  end() {
    for (const s of this.slots) {
      s.mesh.count = s.n;
      if (!s.n) continue;
      s.mesh.instanceMatrix.needsUpdate = true;
      if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
      s.c2.needsUpdate = true;
      s.sk.needsUpdate = true;
    }
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  // triangles drawn this frame
  stats() {
    let tris = 0;
    for (const s of this.slots) tris += s.n * (s.mesh.geometry.index.count / 3);
    return tris;
  }
}
