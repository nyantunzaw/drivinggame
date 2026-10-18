// Instanced rendering for every vehicle in the world: one draw call per model type (with
// a lighter version for distant traffic), plus shared wheels, blob shadows and night-time
// headlight beams.
import * as THREE from 'three';
import { buildVehicleGeometries, wheelGeometry, VEHICLE_TYPES } from './models.js';
import { blobTexture, glowTexture } from '../textures.js';

const CAP = 48;
const NEAR = 45; // metres: full-detail bodies and wheels inside this

function vehicleMaterial(timeUniform, env, pbr) {
  // Physically based on capable devices: paint, glass and chrome pick up the sky.
  const m = pbr
    ? new THREE.MeshStandardMaterial({ vertexColors: true, envMap: env, envMapIntensity: 1, roughness: 0.5, metalness: 0 })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float paint; attribute float lightKind; attribute float surf; attribute vec3 iLights;
        varying float vLightKind; varying vec3 vLights; varying float vSurf;`)
      .replace('#include <color_vertex>', `
        vColor = vec3(1.0);
        vColor *= color;
        #ifdef USE_INSTANCING_COLOR
          vColor = mix(vColor, vColor * instanceColor.rgb, paint);
        #endif
        vLightKind = lightKind; vLights = iLights; vSurf = surf;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; varying float vLightKind; varying vec3 vLights; varying float vSurf;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        // 0 paint, 1 glass, 2 chrome, 3 plastic, 4 lamp, 5 rubber
        if (vSurf < 0.5) { roughnessFactor = 0.3; metalnessFactor = 0.18; }
        else if (vSurf < 1.5) { roughnessFactor = 0.05; metalnessFactor = 0.45; }
        else if (vSurf < 2.5) { roughnessFactor = 0.18; metalnessFactor = 1.0; }
        else if (vSurf < 3.5) { roughnessFactor = 0.62; metalnessFactor = 0.0; }
        else if (vSurf < 4.5) { roughnessFactor = 0.12; metalnessFactor = 0.2; }
        else { roughnessFactor = 0.92; metalnessFactor = 0.0; }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float lk = vLightKind;
        float flash = step(0.5, fract(uTime * 2.6));
        if (lk > 0.5 && lk < 1.5) totalEmissiveRadiance += vec3(1.0, 0.95, 0.8) * (0.15 + vLights.x * 2.8);
        else if (lk > 1.5 && lk < 2.5) totalEmissiveRadiance += vec3(1.0, 0.08, 0.06) * (0.2 + vLights.x * 0.9 + vLights.y * 2.8);
        else if (lk > 2.5 && lk < 3.5) totalEmissiveRadiance += vec3(1.0, 0.1, 0.1) * vLights.z * flash * 5.0;
        else if (lk > 3.5 && lk < 4.5) totalEmissiveRadiance += vec3(0.15, 0.3, 1.0) * vLights.z * (1.0 - flash) * 5.0;
        else if (lk > 4.5) totalEmissiveRadiance += vec3(1.0, 0.75, 0.15) * (0.25 + vLights.x * 1.6);`);
  };
  m.customProgramCacheKey = () => (pbr ? 'vehicle-pbr' : 'vehicle-paint');
  return m;
}

export class VehicleRenderer {
  constructor(scene, quality, env) {
    this.scene = scene;
    this.env = env;
    this.pbr = quality.detail !== false && quality.pbr !== false && !!env;
    this.time = { value: 0 };
    this.night = 0;
    const mat = vehicleMaterial(this.time, env, this.pbr);
    this.mat = mat;
    this.meshes = {};
    this.far = {};
    for (const [set, geos] of [[this.meshes, buildVehicleGeometries()], [this.far, buildVehicleGeometries(1)]]) for (const [k, g] of Object.entries(geos)) {
      const lights = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
      lights.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iLights', lights);
      const mesh = new THREE.InstancedMesh(g, mat, CAP);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = quality.shadows;
      scene.add(mesh);
      set[k] = { mesh, lights, n: 0 };
    }
    this.slots = [...Object.values(this.meshes), ...Object.values(this.far)];
    const wheels = (lod) => {
      const geo = wheelGeometry(lod);
      geo.setAttribute('iLights', new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4 * 3), 3));
      const w = new THREE.InstancedMesh(geo, mat, CAP * 4);
      w.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      w.frustumCulled = false;
      w.count = 0;
      scene.add(w);
      return w;
    };
    this.wheels = wheels(0);
    this.wheelsFar = wheels(1);

    const blob = new THREE.PlaneGeometry(1, 1);
    blob.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(blob, new THREE.MeshBasicMaterial({
      map: blobTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -12,
    }), CAP * 3);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 3;
    this.shadows.count = 0;
    scene.add(this.shadows);

    const beamGeo = new THREE.PlaneGeometry(1, 1);
    beamGeo.rotateX(-Math.PI / 2);
    beamGeo.translate(0, 0, 0.5);
    this.beamMat = new THREE.MeshBasicMaterial({
      map: glowTexture(), color: 0xfff1c8, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -12,
    });
    this.beams = new THREE.InstancedMesh(beamGeo, this.beamMat, CAP);
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 4;
    this.beams.count = 0;
    scene.add(this.beams);

    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
    this._shadowN = 0;
  }

  // Swap between reflective (PBR) paint and the cheaper matte material.
  setPBR(on) {
    on = on && !!this.env;
    if (on === this.pbr) return;
    this.pbr = on;
    const mat = vehicleMaterial(this.time, this.env, on);
    for (const s of this.slots) s.mesh.material = mat;
    this.wheels.material = mat;
    this.wheelsFar.material = mat;
    this.mat.dispose();
    this.mat = mat;
  }

  begin(time, night, daylight = 1) {
    this.time.value = time;
    this.night = night;
    if (this.pbr) this.mat.envMapIntensity = 0.06 + daylight * 0.94;
    for (const s of this.slots) s.n = 0;
    this.wheels.count = 0;
    this.wheelsFar.count = 0;
    this._shadowN = 0;
    this.beams.count = 0;
    this.beamMat.opacity = night * 0.32;
  }

  add(v, camPos) {
    const dx = v.x - camPos.x, dz = v.z - camPos.z;
    const d2 = dx * dx + dz * dz;
    const near = d2 < NEAR * NEAR;
    const slot = (near ? this.meshes : this.far)[v.type];
    if (!slot || slot.n >= CAP) return;
    const i = slot.n++;
    const def = v.def;
    this._e.set(v.pitch, v.heading, v.roll, 'YXZ');
    this._q.setFromEuler(this._e);
    this._p.set(v.x, v.y + v.bob, v.z);
    this._s.set(1, 1, 1);
    this._m.compose(this._p, this._q, this._s);
    slot.mesh.setMatrixAt(i, this._m);
    slot.mesh.setColorAt(i, v.paint);
    const L = slot.lights.array;
    // parked / abandoned cars sit dark
    const lit = !v.wrecked && !!v.driver && this.night > 0.3;
    L[i * 3] = lit ? 1 : 0;
    L[i * 3 + 1] = v.braking ? 1 : 0;
    L[i * 3 + 2] = v.siren ? 1 : 0;

    // wheels (skip far away ones to save fill)
    const W = def.wheels;
    const wm = near ? this.wheels : this.wheelsFar;
    if (d2 < 160 * 160 && wm.count + W.length <= CAP * 4) {
      for (const w of W) {
        // left-hand wheels are the right-hand ones turned around, so hubs face out
        const left = w.x < 0;
        this._p.set(w.x, w.r, w.z);
        this._e.set(left ? -v.wheelSpin : v.wheelSpin, (w.steer ? v.steerAngle : 0) + (left ? Math.PI : 0), 0, 'YXZ');
        this._q2.setFromEuler(this._e);
        this._s.set(w.w, w.r, w.r);
        this._m2.compose(this._p, this._q2, this._s);
        this._m2.premultiply(this._m);
        wm.setMatrixAt(wm.count++, this._m2);
      }
    }
    this.shadow(v.x, v.groundY + 0.13, v.z, def.wid * 1.25, def.len * 1.15, v.heading);
    if (lit && !def.pedal && this.beams.count < CAP) {
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      this._p.set(v.x + fx * def.len * 0.5, v.groundY + 0.14, v.z + fz * def.len * 0.5);
      this._e.set(0, v.heading, 0, 'YXZ');
      this._q2.setFromEuler(this._e);
      this._s.set(def.wid * 2.6, 1, 14);
      this._m2.compose(this._p, this._q2, this._s);
      this.beams.setMatrixAt(this.beams.count++, this._m2);
    }
  }

  shadow(x, y, z, w, l, heading) {
    if (this._shadowN >= CAP * 3) return;
    this._e.set(0, heading, 0, 'YXZ');
    this._q2.setFromEuler(this._e);
    this._p.set(x, y, z);
    this._s.set(w, 1, l);
    this._m2.compose(this._p, this._q2, this._s);
    this.shadows.setMatrixAt(this._shadowN++, this._m2);
  }

  end() {
    for (const s of this.slots) {
      s.mesh.count = s.n;
      s.mesh.instanceMatrix.needsUpdate = true;
      if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
      s.lights.needsUpdate = true;
    }
    this.wheels.instanceMatrix.needsUpdate = true;
    this.wheelsFar.instanceMatrix.needsUpdate = true;
    this.shadows.count = this._shadowN;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.beams.instanceMatrix.needsUpdate = true;
  }
}

export { VEHICLE_TYPES };
