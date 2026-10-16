// Procedural models of Yangon's landmarks: Shwedagon, Sule, Botataung, Maha Wizaya,
// Karaweik and the Independence Monument, plus golden stupas for small shrines.
import * as THREE from 'three';
import { HILL, heightAt } from '../terrain.js';
import { templateFrom, mergeTemplates, xform } from './geo.js';

const V = (r, y) => new THREE.Vector2(r, y);

function lathe(profile, seg, scale = 1, phase = 0) {
  const pts = profile.map(([r, y]) => V(r * scale, y * scale));
  const g = new THREE.LatheGeometry(pts, seg, phase);
  return g;
}

function vcMesh(templates, material) {
  const t = mergeTemplates(templates);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(t.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(t.n, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(t.c.map((v) => v), 3));
  g.setIndex(t.idx);
  g.computeBoundingSphere();
  return new THREE.Mesh(g, material);
}

function linColor(hex) {
  const c = new THREE.Color(hex);
  return c.getHex();
}

function flat(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  return g;
}

// Tiered Burmese roof (pyatthat) as a template.
function pyatthat(tiers, base, tierH, colRoof = 0x9a2a1f, colTrim = 0xd8a63a) {
  const parts = [];
  let y = 0, r = base;
  for (let i = 0; i < tiers; i++) {
    const roof = templateFrom(flat(new THREE.ConeGeometry(r, tierH, 4, 1, false, Math.PI / 4)), i % 2 ? colRoof : 0xa83a25);
    xform(roof, { y: y + tierH / 2 });
    const trim = templateFrom(flat(new THREE.BoxGeometry(r * 1.05, 0.25, r * 1.05)), colTrim);
    xform(trim, { y: y + 0.1 });
    parts.push(roof, trim);
    const neck = templateFrom(flat(new THREE.BoxGeometry(r * 0.55, tierH * 0.45, r * 0.55)), colTrim);
    xform(neck, { y: y + tierH * 0.75 });
    parts.push(neck);
    y += tierH * 0.72;
    r *= 0.74;
  }
  const spire = templateFrom(flat(new THREE.ConeGeometry(r * 0.6, tierH * 3, 8)), 0xe0b040);
  xform(spire, { y: y + tierH * 1.5 });
  parts.push(spire);
  return mergeTemplates(parts);
}

function hti(scale) {
  const parts = [];
  const rings = [[1.4, 1.2, 0], [1.1, 1.0, 1.3], [0.85, 0.9, 2.5], [0.6, 0.8, 3.6], [0.4, 0.7, 4.6]];
  for (const [r, h, y] of rings) {
    const c = templateFrom(flat(new THREE.ConeGeometry(r, h, 10)), 0xffcf5a);
    xform(c, { y: y + h / 2 });
    parts.push(c);
  }
  const rod = templateFrom(new THREE.CylinderGeometry(0.06, 0.08, 3, 6), 0xffd36a);
  xform(rod, { y: 6.5 });
  const vane = templateFrom(flat(new THREE.BoxGeometry(0.9, 0.5, 0.05)), 0xffe08a);
  xform(vane, { x: 0.45, y: 6.9 });
  const orb = templateFrom(new THREE.IcosahedronGeometry(0.32, 1), 0xffffff);
  xform(orb, { y: 8.2 });
  parts.push(rod, vane, orb);
  const t = mergeTemplates(parts);
  return xform(t, { sx: scale, sy: scale, sz: scale });
}

const SHWEDAGON_TERRACE = [[0, 0], [31, 0], [31, 3.2], [27.5, 3.2], [27.5, 6.2], [24.5, 6.2], [24.5, 9], [22, 9], [0, 9]];
const SHWEDAGON_BELL = [[0, 9], [22, 9], [21.6, 10.5], [21, 13], [20, 16.5], [18.6, 20.5], [16.8, 24.5], [14.6, 28.5],
  [12.2, 32], [10, 35], [8.6, 36.4], [9.3, 37.2], [9.0, 38.2], [7.6, 38.8], [7.9, 39.6], [7.3, 40.3], [6.2, 40.6],
  [6.5, 42], [5.8, 44], [4.6, 45.5], [4.8, 46.3], [3.9, 47], [4.3, 47.8], [3.5, 48.6], [3.8, 49.4], [3.0, 50.3],
  [3.3, 51.1], [2.6, 52], [3.0, 53.2], [2.7, 55.5], [2.2, 58.5], [1.7, 62], [1.2, 65.5], [0.8, 68.5], [0.45, 71], [0, 72]];
const SULE = [[0, 0], [14, 0], [14, 2.5], [12, 2.5], [12, 5], [11, 5], [10.6, 7], [9.8, 10], [8.6, 14], [7, 18], [5.6, 21],
  [5.9, 22], [5, 23], [5.2, 24], [4, 25.5], [3.4, 27], [3.6, 28], [2.8, 29], [3, 30], [2.4, 31], [2.6, 32], [2, 34],
  [1.5, 37], [1, 40], [0.5, 42], [0, 43]];
const BOTATAUNG = [[0, 0], [12, 0], [12, 3], [10, 3], [10, 5], [9.5, 6], [9, 9], [8, 13], [6.6, 17], [5.2, 20], [5.5, 21],
  [4.6, 22], [4.8, 23], [3.6, 24.5], [3.2, 26], [3.4, 27], [2.5, 28.5], [2.7, 29.5], [2, 31], [1.5, 34], [1, 37], [0.5, 39], [0, 40]];
const WIZAYA = [[0, 0], [16, 0], [16, 3], [13, 3], [13, 6], [12.5, 7], [12, 10], [11, 14], [9.5, 18], [7.5, 22], [6, 25],
  [6.3, 26], [5, 27], [5.2, 28], [4, 29.5], [3.4, 31], [3.6, 32], [2.8, 33], [3, 34], [2.2, 35.5], [1.6, 38], [1, 41], [0.5, 43], [0, 44]];
export const SMALL_STUPA = [[0, 0], [1, 0], [1, 0.25], [0.85, 0.25], [0.85, 0.45], [0.8, 0.6], [0.72, 0.95], [0.58, 1.3],
  [0.42, 1.6], [0.45, 1.68], [0.35, 1.78], [0.3, 1.95], [0.33, 2.05], [0.24, 2.2], [0.18, 2.5], [0.12, 2.8], [0.06, 3.05], [0, 3.2]];

export function buildLandmarks(scene, map, mats, collision, chunks) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const L = map.landmarks;
  const vc = mats.landmarkVC;

  // ---------------------------------------------------------- Shwedagon
  {
    const s = 1.25;
    const g = new THREE.Group();
    const y0 = HILL.top;
    g.position.set(L.shwedagon.x, y0, L.shwedagon.z);
    const terrace = new THREE.Mesh(lathe(SHWEDAGON_TERRACE, 8, s, Math.PI / 8), mats.gold);
    const bell = new THREE.Mesh(lathe(SHWEDAGON_BELL, 40, s), mats.gold);
    g.add(terrace, bell);
    const top = vcMesh([xform(hti(1.25 * s), { y: 71.5 * s })], vc);
    g.add(top);
    // marble platform
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(108, 108, 1.2, 8, 1, false, Math.PI / 8), mats.plaza);
    plat.position.y = -0.55;
    g.add(plat);
    // 64 small stupas around the base, 8 larger ones further out
    const small = new THREE.InstancedMesh(lathe(SMALL_STUPA, 12, 1), mats.gold, 72);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    let k = 0;
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      pos.set(Math.cos(a) * 44, 0, Math.sin(a) * 44);
      sc.set(1.7, 2.2, 1.7);
      small.setMatrixAt(k++, m4.compose(pos, q, sc));
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      pos.set(Math.cos(a) * 62, 0, Math.sin(a) * 62);
      sc.set(4.5, 6.5, 4.5);
      small.setMatrixAt(k++, m4.compose(pos, q, sc));
      collision.addCircle(L.shwedagon.x + pos.x, L.shwedagon.z + pos.z, 4.6);
    }
    small.count = k;
    g.add(small);
    // four entrance halls with tiered roofs
    const halls = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const hx = Math.cos(a) * 88, hz = Math.sin(a) * 88;
      const base = templateFrom(flat(new THREE.BoxGeometry(14, 6, 14)), 0xf1e6d0);
      xform(base, { x: hx, y: 3, z: hz });
      const roof = pyatthat(6, 11, 3.2);
      xform(roof, { x: hx, y: 6, z: hz });
      halls.push(base, roof);
      for (const [px, pz] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) {
        const pillar = templateFrom(flat(new THREE.BoxGeometry(0.9, 6.5, 0.9)), 0xb8322a);
        xform(pillar, { x: hx + px, y: 3.25, z: hz + pz });
        halls.push(pillar);
      }
      collision.addBox(L.shwedagon.x + hx, L.shwedagon.z + hz, 7.3, 7.3, 0);
    }
    g.add(vcMesh(halls, vc));
    group.add(g);
    collision.addCircle(L.shwedagon.x, L.shwedagon.z, 31 * s + 0.5);
  }

  // ---------------------------------------------------------- Sule (octagonal)
  {
    const g = new THREE.Group();
    g.position.set(L.sule.x, 0, L.sule.z);
    g.add(new THREE.Mesh(lathe(SULE, 8, 1, Math.PI / 8), mats.gold));
    g.add(vcMesh([xform(hti(0.9), { y: 42.3 })], vc));
    // ring of shops around the base
    const ring = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const shop = templateFrom(flat(new THREE.BoxGeometry(9.5, 4, 4.5)), i % 2 ? 0xf3e2c0 : 0xeed8b0);
      xform(shop, { x: Math.cos(a) * 16, y: 2, z: Math.sin(a) * 16, ry: -a + Math.PI / 2 });
      const roof = templateFrom(flat(new THREE.BoxGeometry(10.5, 0.6, 5.5)), 0x9a2a1f);
      xform(roof, { x: Math.cos(a) * 16, y: 4.3, z: Math.sin(a) * 16, ry: -a + Math.PI / 2 });
      ring.push(shop, roof);
    }
    g.add(vcMesh(ring, vc));
    group.add(g);
    collision.addCircle(L.sule.x, L.sule.z, 18.5);
  }

  // ---------------------------------------------------------- Botataung
  {
    const g = new THREE.Group();
    g.position.set(L.botataung.x, 0, L.botataung.z);
    g.add(new THREE.Mesh(lathe(BOTATAUNG, 28), mats.gold));
    g.add(vcMesh([xform(hti(0.85), { y: 39.4 })], vc));
    group.add(g);
    collision.addCircle(L.botataung.x, L.botataung.z, 12.3);
  }

  // ---------------------------------------------------------- Maha Wizaya
  {
    const g = new THREE.Group();
    const y = heightAt(L.mahawizaya.x, L.mahawizaya.z);
    g.position.set(L.mahawizaya.x, y, L.mahawizaya.z);
    const base = new THREE.Mesh(lathe(WIZAYA.slice(0, 6).concat([[0, 6]]), 8, 1, Math.PI / 8), mats.whiteStone);
    const bell = new THREE.Mesh(lathe(WIZAYA.slice(5), 28), mats.gold);
    g.add(base, bell);
    g.add(vcMesh([xform(hti(0.9), { y: 43.4 })], vc));
    group.add(g);
    collision.addCircle(L.mahawizaya.x, L.mahawizaya.z, 16.3);
  }

  // ---------------------------------------------------------- Independence Monument
  {
    const g = new THREE.Group();
    g.position.set(L.independence.x, 0, L.independence.z);
    const parts = [];
    const base = templateFrom(flat(new THREE.CylinderGeometry(9, 10, 1.4, 8)), 0xe8e2d4);
    xform(base, { y: 0.7 });
    const ob = templateFrom(flat(new THREE.CylinderGeometry(1.0, 2.4, 40, 4, 1, false, Math.PI / 4)), 0xf4f0e6);
    xform(ob, { y: 21.4 });
    const tip = templateFrom(flat(new THREE.ConeGeometry(1.15, 3, 4, 1, false, Math.PI / 4)), 0xf4f0e6);
    xform(tip, { y: 42.9 });
    parts.push(base, ob, tip);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const p = templateFrom(flat(new THREE.CylinderGeometry(0.4, 0.8, 9, 4, 1, false, Math.PI / 4)), 0xf0ebe0);
      xform(p, { x: Math.cos(a) * 6.5, y: 5.9, z: Math.sin(a) * 6.5 });
      parts.push(p);
    }
    g.add(vcMesh(parts, mats.landmarkVC));
    group.add(g);
    collision.addCircle(L.independence.x, L.independence.z, 9.5);
  }

  // ---------------------------------------------------------- Karaweik (royal barge)
  {
    const g = new THREE.Group();
    const k = L.karaweik, lake = L.kandawgyi;
    g.position.set(k.x, 0.05, k.z);
    // bow points into the lake
    const heading = Math.atan2(-(lake.z - k.z), lake.x - k.x);
    g.rotation.y = heading;
    const shape = new THREE.Shape();
    shape.moveTo(-31, 1); shape.lineTo(-30, 5); shape.lineTo(20, 5); shape.quadraticCurveTo(26, 6, 28, 11);
    shape.lineTo(29.5, 17); shape.lineTo(32.5, 17.6); shape.lineTo(34.5, 16.6); shape.lineTo(31.2, 15.6);
    shape.lineTo(30, 11); shape.quadraticCurveTo(28, 3, 22, 0.3); shape.lineTo(-28, -0.6); shape.closePath();
    const hullGeo = new THREE.ExtrudeGeometry(shape, { depth: 6, bevelEnabled: false, curveSegments: 6 });
    for (const zOff of [-11, 5]) {
      const hull = new THREE.Mesh(hullGeo, mats.gold);
      hull.position.z = zOff;
      g.add(hull);
    }
    const parts = [];
    const deck = templateFrom(flat(new THREE.BoxGeometry(46, 6, 20)), 0xb3352a);
    xform(deck, { x: -4, y: 8, z: 0 });
    const trim = templateFrom(flat(new THREE.BoxGeometry(47, 0.6, 21)), 0xe2b44a);
    xform(trim, { x: -4, y: 11.2, z: 0 });
    const roofA = pyatthat(7, 15, 3.6);
    xform(roofA, { x: -6, y: 11.4 });
    const roofB = pyatthat(3, 9, 2.6);
    xform(roofB, { x: -24, y: 11.4 });
    const roofC = pyatthat(3, 8, 2.4);
    xform(roofC, { x: 12, y: 11.4 });
    parts.push(deck, trim, roofA, roofB, roofC);
    g.add(vcMesh(parts, vc));
    group.add(g);
    collision.addBox(k.x, k.z, 34, 12, -heading);
  }

  // ---------------------------------------------------------- small golden stupas
  {
    const list = [...chunks.stupaSet];
    const geo = lathe(SMALL_STUPA, 10, 1);
    const inst = new THREE.InstancedMesh(geo, mats.gold, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
    list.forEach((b, i) => {
      const r = Math.max(1.5, Math.min(7, Math.sqrt(map.bArea[b] / Math.PI) * 0.85));
      const x = map.bCx[b], z = map.bCz[b];
      pos.set(x, heightAt(x, z), z);
      sc.set(r, r * 1.35, r);
      inst.setMatrixAt(i, m4.compose(pos, q, sc));
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    group.add(inst);
  }

  scene.add(group);
  return group;
}
