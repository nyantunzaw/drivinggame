// Global (non-streamed) layers: ground, Singuttara hill, water, parks, railways.
import * as THREE from 'three';
import { HILL, heightAt, normalAt, onHill } from '../terrain.js';
import { Geo } from './geo.js';
import { ribbon } from './chunks.js';

function triangulateRings(rings) {
  const contour = [];
  const holes = [];
  const outer = rings[0];
  for (let i = 0; i < outer.length; i += 2) contour.push(new THREE.Vector2(outer[i], outer[i + 1]));
  for (let h = 1; h < rings.length; h++) {
    const hole = [];
    for (let i = 0; i < rings[h].length; i += 2) hole.push(new THREE.Vector2(rings[h][i], rings[h][i + 1]));
    holes.push(hole);
  }
  const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
  const pts = contour.concat(...holes);
  return { pts, faces };
}

// Emit triangles at terrain height; split large triangles on the hill so they hug it.
function emitTri(G, a, b, c, lift, depth = 0) {
  const hill = onHill(a.x, a.y, 30) || onHill(b.x, b.y, 30) || onHill(c.x, c.y, 30);
  if (hill && depth < 14) {
    const ab = a.distanceToSquared(b), bc = b.distanceToSquared(c), ca = c.distanceToSquared(a);
    const m = Math.max(ab, bc, ca);
    if (m > 144) {
      if (m === ab) { const p = a.clone().lerp(b, 0.5); emitTri(G, a, p, c, lift, depth + 1); emitTri(G, p, b, c, lift, depth + 1); }
      else if (m === bc) { const p = b.clone().lerp(c, 0.5); emitTri(G, a, b, p, lift, depth + 1); emitTri(G, a, p, c, lift, depth + 1); }
      else { const p = c.clone().lerp(a, 0.5); emitTri(G, a, b, p, lift, depth + 1); emitTri(G, p, b, c, lift, depth + 1); }
      return;
    }
  }
  const v = [a, b, c].map((p) => G.v(p.x, heightAt(p.x, p.y) + lift, p.y, 0, 1, 0, p.x / 20, p.y / 20));
  const cr = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y);
  if (cr >= 0) G.tri(v[0], v[1], v[2]); else G.tri(v[0], v[2], v[1]);
}

function polygonsMesh(list, lift, material) {
  const G = new Geo({ color: false });
  for (const rings of list) {
    const { pts, faces } = triangulateRings(rings);
    for (const f of faces) emitTri(G, pts[f[0]], pts[f[1]], pts[f[2]], lift);
  }
  if (G.empty) return null;
  return new THREE.Mesh(G.build(), material);
}

export function buildStatic(scene, map, mats, quality, opts = {}) {
  const group = new THREE.Group();
  const { x0, z0, x1, z1 } = map.bounds;

  // Big flat ground (extends past the map so the horizon is never empty).
  // Tessellated: GPUs interpolate depth badly across a couple of kilometre-sized
  // triangles, which let the ground poke through the roads at high resolutions.
  const pad = 4000;
  const G = new Geo({ color: false });
  const gx0 = x0 - pad, gz0 = z0 - pad;
  const tnx = Math.ceil((x1 + pad - gx0) / 300), tnz = Math.ceil((z1 + pad - gz0) / 300);
  const tsx = (x1 + pad - gx0) / tnx, tsz = (z1 + pad - gz0) / tnz;
  for (let j = 0; j <= tnz; j++) {
    for (let i = 0; i <= tnx; i++) {
      const x = gx0 + i * tsx, z = gz0 + j * tsz;
      G.v(x, 0, z, 0, 1, 0, x / 20, z / 20);
    }
  }
  for (let j = 0; j < tnz; j++) {
    for (let i = 0; i < tnx; i++) {
      const a = j * (tnx + 1) + i, b = a + 1, c = a + tnx + 1, d = c + 1;
      G.tri(a, c, b); G.tri(b, c, d);
    }
  }
  const ground = new THREE.Mesh(G.build(), mats.ground);
  ground.receiveShadow = quality.shadows;
  group.add(ground);

  // Singuttara hill grid
  const H = new Geo({ color: false });
  const rx = HILL.r1 + 30, rz = (HILL.r1 + 30) / HILL.stretch;
  const step = 10;
  const nx = Math.ceil((rx * 2) / step), nz = Math.ceil((rz * 2) / step);
  const nrm = { x: 0, y: 1, z: 0 };
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = HILL.x - rx + i * step, z = HILL.z - rz + j * step;
      normalAt(x, z, nrm);
      H.v(x, heightAt(x, z), z, nrm.x, nrm.y, nrm.z, x / 20, z / 20);
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * (nx + 1) + i;
      H.tri(k, k + nx + 1, k + 1);
      H.tri(k + 1, k + nx + 1, k + nx + 2);
    }
  }
  const hillMat = mats.ground.clone();
  hillMat.polygonOffset = true;
  hillMat.polygonOffsetFactor = -0.5;
  hillMat.polygonOffsetUnits = -1;
  const hill = new THREE.Mesh(H.build(), hillMat);
  hill.receiveShadow = quality.shadows;
  group.add(hill);

  // Downtown: paved ground between the streets and the shopfronts (no grass verges).
  // South edge follows Strand Road so the riverbank stays open.
  if (opts.core) {
    const c = opts.core;
    const xs = [], zs = [];
    for (let i = 0; i < c.length; i += 2) { xs.push(c[i]); zs.push(c[i + 1]); }
    const cx0 = Math.min(...xs), cx1 = Math.max(...xs), zN = Math.min(...zs), zS = Math.max(...zs);
    const strand = new Map();
    for (const e of map.edges) {
      if (e.name !== 'Strand Road') continue;
      for (let i = 0; i < e.pts.length; i += 2) {
        const x = e.pts[i], z = e.pts[i + 1];
        if (x < cx0 - 40 || x > cx1 + 40) continue;
        const b = Math.round(x / 25);
        strand.set(b, Math.min(strand.get(b) ?? Infinity, z));
      }
    }
    const south = [...strand.entries()].sort((p, q) => q[0] - p[0]).map(([b, z]) => [b * 25, Math.min(z, zS)]);
    if (south.length > 4) {
      const ring = [cx0, zN, cx1, zN];
      for (const [x, z] of south) if (x > cx0 && x < cx1) ring.push(x, z);
      const m = polygonsMesh([[ring]], 0.015, mats.pavement);
      if (m) { m.receiveShadow = quality.shadows; group.add(m); }
    }
  }

  // Parks, pitches, forests, plazas
  const byType = [[], [], [], []];
  for (const g of map.green) byType[g.type].push([g.pts]);
  const greenMats = [mats.grass, mats.pitch, mats.forest, mats.plaza];
  byType.forEach((list, t) => {
    const m = polygonsMesh(list, 0.03 + t * 0.004, greenMats[t]);
    if (m) { m.receiveShadow = quality.shadows; group.add(m); }
  });

  // Water
  const water = polygonsMesh(map.water, 0.05, mats.water);
  if (water) { water.renderOrder = 1; group.add(water); }

  // Railways (Yangon Circular Railway)
  const ballast = new Geo();
  const rails = new Geo({ uv: false });
  for (const line of map.rail) {
    const pts = Array.from(line);
    ribbon(ballast, pts, 1.8, 0.08, 0, 0, [1, 1, 1]);
    for (const off of [-0.72, 0.72]) {
      const shifted = offsetLine(pts, off);
      ribbon(rails, shifted, 0.06, 0.2, 0, 0, [1, 1, 1]);
    }
  }
  if (!ballast.empty) group.add(new THREE.Mesh(ballast.build(), mats.rail));
  if (!rails.empty) group.add(new THREE.Mesh(rails.build(), mats.steel));

  scene.add(group);
  return { group, water };
}

function offsetLine(pts, off) {
  const out = [];
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = Math.min(n - 1, i + 1), k = Math.max(0, i - 1);
    const tx = pts[j * 2] - pts[k * 2], tz = pts[j * 2 + 1] - pts[k * 2 + 1];
    const l = Math.hypot(tx, tz) || 1;
    out.push(pts[i * 2] - (tz / l) * off, pts[i * 2 + 1] + (tx / l) * off);
  }
  return out;
}
