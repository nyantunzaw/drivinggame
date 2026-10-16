// Sky dome, sun/moon lighting and the day-night cycle (Vice City sunsets included).
import * as THREE from 'three';
import { clamp, smoothstep } from '../util.js';

const KEYS = [
  // hour, zenith, horizon, sun color, sun intensity, hemi sky, hemi ground, hemi intensity
  [0, '#0a0e2e', '#2a2058', '#9aa4ff', 0.55, '#4a5aa8', '#2a2034', 1.25],
  [4.6, '#0e1338', '#3d2c64', '#9aa4ff', 0.5, '#4a58a4', '#2a2034', 1.2],
  [5.6, '#2a2f6a', '#e07a86', '#ff9a7a', 0.7, '#7070b0', '#3a2a30', 1.0],
  [6.6, '#3f74c8', '#ffb98a', '#ffc08a', 1.6, '#9cc0ee', '#6a5a48', 0.95],
  [9.0, '#2a7ee6', '#a8d8f4', '#fff2dc', 2.6, '#c2e2ff', '#857560', 1.05],
  [15.0, '#2a7ce4', '#acd8f2', '#fff0d6', 2.6, '#c2e2ff', '#857560', 1.05],
  [17.2, '#3a68c8', '#ffc98e', '#ffc77a', 2.2, '#b0c8ee', '#7a6450', 1.0],
  [18.2, '#33308c', '#ff74a2', '#ff8a66', 1.4, '#9a88d0', '#5a3a48', 0.95],
  [19.0, '#221d62', '#c4508e', '#ff6a7a', 0.7, '#6a5cb0', '#2c1c2c', 1.0],
  [20.0, '#0e1442', '#4a2c74', '#9aa4ff', 0.55, '#4a5aa8', '#2a2034', 1.2],
  [24, '#0a0e2e', '#2a2058', '#9aa4ff', 0.55, '#4a5aa8', '#2a2034', 1.25],
];
const parsed = KEYS.map((k) => ({
  h: k[0], zen: new THREE.Color(k[1]), hor: new THREE.Color(k[2]), sun: new THREE.Color(k[3]),
  si: k[4], hs: new THREE.Color(k[5]), hg: new THREE.Color(k[6]), hi: k[7],
}));

const vert = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w * 0.99999;
}`;

const frag = /* glsl */`
uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor;
uniform float night; uniform float time; uniform float clouds;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(horizon, zenith, pow(h, 0.55));
  if (d.y < 0.0) col = mix(horizon, horizon * 0.55, clamp(-d.y * 4.0, 0.0, 1.0));
  float sd = max(dot(d, sunDir), 0.0);
  float sunUp = smoothstep(-0.12, 0.05, sunDir.y);
  col += sunColor * (pow(sd, 6.0) * 0.35 + pow(sd, 64.0) * 0.6) * sunUp;
  col += sunColor * smoothstep(0.9993, 0.9997, sd) * 3.0 * sunUp;
  // moon
  vec3 moonDir = normalize(vec3(-sunDir.x, abs(sunDir.y) + 0.25, -sunDir.z));
  float md = max(dot(d, moonDir), 0.0);
  col += vec3(0.85, 0.88, 1.0) * smoothstep(0.9990, 0.9994, md) * night * 1.4;
  col += vec3(0.4, 0.45, 0.8) * pow(md, 40.0) * night * 0.25;
  // stars
  if (night > 0.01 && d.y > 0.02) {
    vec2 sp = d.xz / (d.y + 0.3) * 160.0;
    float s = hash(floor(sp));
    float tw = 0.6 + 0.4 * sin(time * 3.0 + s * 50.0);
    col += vec3(step(0.9965, s) * night * tw * smoothstep(0.02, 0.25, d.y));
  }
  // clouds
  if (clouds > 0.5 && d.y > 0.0) {
    vec2 cp = d.xz / (d.y + 0.08) * 1.6 + vec2(time * 0.004, time * 0.002);
    float n = noise(cp) * 0.5 + noise(cp * 2.1) * 0.3 + noise(cp * 4.3) * 0.2;
    float c = smoothstep(0.6, 0.88, n) * smoothstep(0.0, 0.25, d.y);
    vec3 cloudCol = mix(horizon * 1.1, vec3(1.0), 0.45 * (1.0 - night)) + sunColor * pow(sd, 3.0) * 0.4;
    col = mix(col, cloudCol * (1.0 - night * 0.6), c * 0.75);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(scene, quality) {
    this.scene = scene;
    this.uniforms = {
      zenith: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunColor: { value: new THREE.Color() },
      night: { value: 0 },
      time: { value: 0 },
      clouds: { value: quality.clouds ? 1 : 0 },
    };
    const geo = new THREE.SphereGeometry(1000, 24, 12);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.position.set(100, 200, 50);
    scene.add(this.sun);
    scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);

    this.fog = new THREE.Fog(0xffffff, 100, quality.view);
    scene.fog = this.fog;

    this.night = 0;       // 0 day .. 1 full night
    this.daylight = 1;
    this.sunDir = new THREE.Vector3();
    this._c = new THREE.Color();
    this.setShadows(quality.shadows);
  }

  setShadows(on) {
    this.sun.castShadow = on;
    if (on) {
      const s = this.sun.shadow;
      s.mapSize.set(2048, 2048);
      s.camera.near = 10;
      s.camera.far = 600;
      s.camera.left = -90; s.camera.right = 90;
      s.camera.top = 90; s.camera.bottom = -90;
      s.bias = -0.0006;
      s.normalBias = 0.5;
    }
  }

  setView(view) {
    this.fog.near = view * 0.3;
    this.fog.far = view;
  }

  update(hour, center, elapsed) {
    let i = 0;
    while (i < parsed.length - 2 && parsed[i + 1].h <= hour) i++;
    const A = parsed[i], B = parsed[i + 1];
    const t = clamp((hour - A.h) / (B.h - A.h), 0, 1);
    const u = this.uniforms;
    u.zenith.value.copy(A.zen).lerp(B.zen, t);
    u.horizon.value.copy(A.hor).lerp(B.hor, t);
    u.sunColor.value.copy(A.sun).lerp(B.sun, t);
    u.time.value = elapsed;

    // Sun path: rises in the east (+x), sets in the west.
    const ang = ((hour - 6) / 12) * Math.PI;
    const elev = Math.sin(ang);
    this.sunDir.set(Math.cos(ang), elev * 0.95, 0.35).normalize();
    u.sunDir.value.copy(this.sunDir);
    this.night = 1 - smoothstep(-0.18, 0.12, elev);
    this.daylight = smoothstep(-0.1, 0.35, elev);
    u.night.value = this.night;

    // Directional light: sun by day, moon by night.
    const lightDir = this.sunDir.y > -0.05 ? this.sunDir : this._moon || (this._moon = new THREE.Vector3(-0.4, 0.8, -0.3).normalize());
    const ly = Math.max(lightDir.y, 0.18);
    this.sun.position.set(center.x + lightDir.x * 250, ly * 250, center.z + lightDir.z * 250);
    this.sun.target.position.set(center.x, 0, center.z);
    this.sun.color.copy(u.sunColor.value);
    this.sun.intensity = A.si + (B.si - A.si) * t;
    this.hemi.color.copy(A.hs).lerp(B.hs, t);
    this.hemi.groundColor.copy(A.hg).lerp(B.hg, t);
    this.hemi.intensity = A.hi + (B.hi - A.hi) * t;

    this.fog.color.copy(u.horizon.value).lerp(u.zenith.value, 0.25);
    this.mesh.position.copy(center);
  }
}
