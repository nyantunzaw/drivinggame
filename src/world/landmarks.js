// Procedural models of Yangon's landmarks: Shwedagon, Sule, Botataung, Maha Wizaya,
// Karaweik and the Independence Monument, plus golden stupas for small shrines.
import * as THREE from 'three';
import { HILL, heightAt } from '../terrain.js';
import { templateFrom, mergeTemplates, xform, Geo } from './geo.js';
import { wallQuad } from './chunks.js';
import { STYLE } from '../facades.js';

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
function pyatthat(tiers, base, tierH, colRoof = 0x9a2a1f, colTrim = 0xd8a63a, colRoof2 = 0xa83a25) {
  const parts = [];
  let y = 0, r = base;
  for (let i = 0; i < tiers; i++) {
    const roof = templateFrom(flat(new THREE.ConeGeometry(r, tierH, 4, 1, false, Math.PI / 4)), i % 2 ? colRoof : colRoof2);
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


// ---------------------------------------------------------------- helpers for
// Chinese temples and colonial heritage details

// Raw triangles -> template (flat shaded, optionally double sided).
function triTemplate(tris, color, double = false) {
  const pos = [];
  for (const t of tris) {
    pos.push(...t[0], ...t[1], ...t[2]);
    if (double) pos.push(...t[0], ...t[2], ...t[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return templateFrom(g, color);
}

// Chinese hip-and-gable roof with upswept eave corners and ridge ornaments.
function chineseRoof(w, d, h, tile = 0x2e7d4f, ridgeCol = 0xd9a63a) {
  const oh = 1.2;                 // eave overhang
  const W = w / 2 + oh, D = d / 2 + oh, rw = w * 0.32;
  const up = 0.55;                // corner sweep
  const e = [[-W, up, D], [W, up, D], [W, up, -D], [-W, up, -D]];
  const mid = [[-W * 0.55, 0, D], [W * 0.55, 0, D], [W * 0.55, 0, -D], [-W * 0.55, 0, -D]];
  const r0 = [-rw, h, 0], r1 = [rw, h, 0];
  const tris = [
    // front slope (with sagging middle of the eave)
    [e[0], mid[0], r0], [mid[0], mid[1], r0], [mid[1], r1, r0], [mid[1], e[1], r1],
    // back slope
    [e[3], r0, mid[3]], [mid[3], r0, mid[2]], [mid[2], r0, r1], [mid[2], r1, e[2]],
    // hips
    [e[0], r0, e[3]], [e[1], e[2], r1],
  ];
  const parts = [triTemplate(tris, tile, true)];
  const ridge = templateFrom(new THREE.BoxGeometry(rw * 2 + 0.6, 0.45, 0.45), ridgeCol);
  xform(ridge, { y: h + 0.2 });
  parts.push(ridge);
  // stylised dragons along the ridge facing a flaming pearl
  for (const sgn of [-1, 1]) {
    for (let k = 0; k < 7; k++) {
      const t = k / 6;
      const seg = templateFrom(new THREE.BoxGeometry(0.42, 0.32, 0.32), k % 2 ? 0x3aa36a : 0xe0b040);
      xform(seg, { x: sgn * (rw * 0.25 + t * rw * 0.7), y: h + 0.55 + Math.sin(t * Math.PI * 2) * 0.35, rz: Math.cos(t * Math.PI * 2) * 0.6 * sgn });
      parts.push(seg);
    }
    const curl = templateFrom(new THREE.BoxGeometry(0.4, 1.1, 0.4), ridgeCol);
    xform(curl, { x: sgn * (rw + 0.1), y: h + 0.6, rz: -sgn * 0.35 });
    parts.push(curl);
  }
  const pearl = templateFrom(new THREE.IcosahedronGeometry(0.42, 1), 0xd23a2a);
  xform(pearl, { y: h + 0.95 });
  parts.push(pearl);
  // upswept corner tips
  for (const c of e) {
    const tip = templateFrom(new THREE.ConeGeometry(0.22, 1.1, 5), ridgeCol);
    xform(tip, { x: c[0] * 1.02, y: c[1] + 0.35, z: c[2] * 1.02, rx: c[2] > 0 ? 0.6 : -0.6, rz: c[0] > 0 ? -0.6 : 0.6 });
    parts.push(tip);
  }
  return mergeTemplates(parts);
}

function plaqueMaterial(text, sub) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const a = c.getContext('2d');
  a.fillStyle = '#16120f'; a.fillRect(0, 0, 512, 160);
  a.strokeStyle = '#d9a63a'; a.lineWidth = 10; a.strokeRect(8, 8, 496, 144);
  a.fillStyle = '#f2c94c'; a.textAlign = 'center'; a.textBaseline = 'middle';
  a.font = "700 84px 'Noto Serif SC','Noto Sans SC','PingFang SC','Microsoft YaHei','WenQuanYi Zen Hei',serif";
  a.fillText(text, 256, 72);
  a.font = "600 22px 'Rajdhani',Arial,sans-serif";
  a.fillText(sub, 256, 134);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshLambertMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.25 });
}

// Pick the side of a footprint rectangle that faces the most important nearby road.
function frontOf(rect, collision) {
  const ca = Math.cos(rect.ang), sa = Math.sin(rect.ang);
  const axes = [[ca, sa, rect.len / 2, rect.wid], [-ca, -sa, rect.len / 2, rect.wid], [-sa, ca, rect.wid / 2, rect.len], [sa, -ca, rect.wid / 2, rect.len]];
  let best = axes[2], bc = 99;
  for (const ax of axes) {
    for (const d of [4, 9, 14]) {
      const c = collision.roadAt(rect.x + ax[0] * (ax[2] + d), rect.z + ax[1] * (ax[2] + d));
      if (c && c < bc) { bc = c; best = ax; }
    }
  }
  // returns front direction, width (across the front) and depth
  return { fx: best[0], fz: best[1], width: best[3], depth: best[2] * 2 };
}

function chineseTemple(group, rect, mats, collision, name, sub, scale = 1) {
  const f = frontOf(rect, collision);
  const g = new THREE.Group();
  g.position.set(rect.x, heightAt(rect.x, rect.z), rect.z);
  g.rotation.y = Math.atan2(f.fx, f.fz);   // local +z faces the street
  const W = f.width * 0.92, D = f.depth * 0.92;
  const parts = [];
  const RED = 0xa8231c, STONE = 0xb9b4a8, GOLD = 0xd9a63a;
  const base = templateFrom(new THREE.BoxGeometry(W, 0.6, D), STONE);
  xform(base, { y: 0.3 });
  parts.push(base);
  // front gate hall
  const gd = Math.min(7, D * 0.25), gz = D / 2 - gd / 2;
  const gate = templateFrom(new THREE.BoxGeometry(W * 0.86, 5.2, gd), RED);
  xform(gate, { y: 0.6 + 2.6, z: gz - 0.6 });
  parts.push(gate);
  parts.push(xform(chineseRoof(W * 0.86, gd, 2.6 * scale, 0x2e7d4f), { y: 5.8, z: gz - 0.6 }));
  const door = templateFrom(new THREE.BoxGeometry(3.2, 3.6, 0.2), 0x5a1410);
  xform(door, { y: 0.6 + 1.8, z: gz - 0.6 + gd / 2 + 0.05 });
  parts.push(door);
  for (const sx of [-1, 1]) {
    for (const px of [0.18, 0.4]) {
      const col = templateFrom(new THREE.CylinderGeometry(0.28, 0.32, 5.2, 10), RED);
      xform(col, { x: sx * W * px, y: 0.6 + 2.6, z: gz - 0.6 + gd / 2 + 0.6 });
      parts.push(col);
    }
    // guardian lions
    const lion = templateFrom(new THREE.BoxGeometry(0.9, 1.1, 1.3), 0x9d9a92);
    xform(lion, { x: sx * 2.6, y: 0.6 + 0.55, z: D / 2 + 0.2 });
    const head = templateFrom(new THREE.IcosahedronGeometry(0.5, 0), 0x9d9a92);
    xform(head, { x: sx * 2.6, y: 0.6 + 1.45, z: D / 2 + 0.45 });
    parts.push(lion, head);
  }
  // main hall (two-tier roof)
  const hd = D * 0.45, hz = -D / 2 + hd / 2 + 1;
  const hall = templateFrom(new THREE.BoxGeometry(W * 0.8, 7, hd), RED);
  xform(hall, { y: 0.6 + 3.5, z: hz });
  parts.push(hall);
  parts.push(xform(chineseRoof(W * 0.8, hd, 3.4 * scale, 0x2e7d4f), { y: 7.6, z: hz }));
  const upper = templateFrom(new THREE.BoxGeometry(W * 0.4, 2.6, hd * 0.5), RED);
  xform(upper, { y: 10.6, z: hz });
  parts.push(upper);
  parts.push(xform(chineseRoof(W * 0.4, hd * 0.5, 2.2 * scale, 0xd9a03a), { y: 11.9, z: hz }));
  for (let k = -3; k <= 3; k++) {
    const col = templateFrom(new THREE.CylinderGeometry(0.3, 0.34, 7, 10), RED);
    xform(col, { x: (k / 3) * W * 0.38, y: 0.6 + 3.5, z: hz + hd / 2 + 0.7 });
    parts.push(col);
  }
  // courtyard: bronze incense cauldron
  const pot = templateFrom(new THREE.CylinderGeometry(0.9, 0.7, 1.2, 12), 0x5b4a2e);
  xform(pot, { y: 0.6 + 1.1, z: (gz - gd / 2 + hz + hd / 2) / 2 });
  parts.push(pot);
  const mesh = vcMesh(parts, mats.landmarkVC);
  g.add(mesh);
  // glowing red lanterns under the eaves
  const lanterns = [];
  for (const [lx, lz, ly] of [[-W * 0.3, gz + gd / 2 + 0.2, 4.6], [W * 0.3, gz + gd / 2 + 0.2, 4.6], [-W * 0.2, hz + hd / 2 + 0.9, 6.4], [W * 0.2, hz + hd / 2 + 0.9, 6.4], [0, hz + hd / 2 + 0.9, 6.4]]) {
    const lt = templateFrom(new THREE.CylinderGeometry(0.45, 0.45, 0.7, 10), 0xe0291c, 1);
    xform(lt, { x: lx, y: ly, z: lz });
    lanterns.push(lt);
  }
  const lg = mergeTemplates(lanterns);
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.Float32BufferAttribute(lg.p, 3));
  lgeo.setAttribute('normal', new THREE.Float32BufferAttribute(lg.n, 3));
  lgeo.setAttribute('color', new THREE.Float32BufferAttribute(lg.c, 3));
  lgeo.setAttribute('glow', new THREE.Float32BufferAttribute(lg.g, 1));
  lgeo.setIndex(lg.idx);
  g.add(new THREE.Mesh(lgeo, mats.props));
  // name plaque over the gate
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.12), plaqueMaterial(name, sub));
  plaque.position.set(0, 4.8, gz - 0.6 + gd / 2 + 0.12);
  g.add(plaque);
  group.add(g);
  // colliders: gate, hall, base
  const ang = -Math.atan2(f.fx, f.fz);
  const toW = (lx, lz) => [rect.x + lx * Math.cos(-ang) + lz * Math.sin(-ang), rect.z - lx * Math.sin(-ang) + lz * Math.cos(-ang)];
  for (const [lz, dd] of [[gz - 0.6, gd], [hz, hd]]) {
    const [x, z] = toW(0, lz);
    collision.addBox(x, z, W * 0.45, dd / 2 + 0.3, ang - Math.PI / 2 * 0);
  }
}

// Burmese tiered roof (pyatthat) in heritage colours placed on a building roof.
function addPyatthat(group, mats, x, y, z, tiers, base, tierH, roof, trim) {
  const t = pyatthat(tiers, base, tierH, roof, trim, roof);
  const m = vcMesh([t], mats.landmarkVC);
  m.position.set(x, y, z);
  group.add(m);
}

function heritage(group, map, mats, collision) {
  const L = map.landmarks;
  const local = (rect, lx, lz) => {
    const ca = Math.cos(rect.ang), sa = Math.sin(rect.ang);
    return [rect.x + ca * lx - sa * lz, rect.z + sa * lx + ca * lz];
  };
  const roofY = (x, z, fallback) => {
    // height of the building under (x,z) from the map data
    let best = fallback;
    for (let i = 0; i < map.buildingCount; i++) {
      if (Math.abs(map.bCx[i] - x) > 80 || Math.abs(map.bCz[i] - z) > 80) continue;
      if (map.bType[i] >= 7) best = Math.max(best === fallback ? 0 : best, map.bHeight[i]);
    }
    return best;
  };
  // City Hall: Burmese tiered towers in jade green over the front and corners
  if (L.cityhall && L.cityhall.rect) {
    const r = L.cityhall.rect;
    const f = frontOf(r, collision);
    const y = roofY(r.x, r.z, 22);
    const cxp = r.x + f.fx * (f.depth / 2 - 8), czp = r.z + f.fz * (f.depth / 2 - 8);
    addPyatthat(group, mats, cxp, y, czp, 5, 12, 3.2, 0x3f7f6f, 0xd9a63a);
    const sx = -f.fz, sz = f.fx;
    for (const s of [-1, 1]) addPyatthat(group, mats, cxp + sx * s * (f.width / 2 - 7), y, czp + sz * s * (f.width / 2 - 7), 3, 7, 2.4, 0x3f7f6f, 0xd9a63a);
  }
  // Central Station: a row of multi-tiered roofs
  if (L.station && L.station.rect) {
    const r = L.station.rect;
    const y = roofY(r.x, r.z, 18);
    for (const t of [-0.32, 0, 0.32]) {
      const [x, z] = local(r, t * r.len, 0);
      addPyatthat(group, mats, x, y, z, t === 0 ? 5 : 4, t === 0 ? 16 : 11, 3, 0x8a2f24, 0xd9a63a);
    }
  }
  // High Court: red-brick clock tower
  if (L.highcourt && L.highcourt.rect) {
    const r = L.highcourt.rect;
    const f = frontOf(r, collision);
    const x = r.x + f.fx * (f.depth / 2 - 5), z = r.z + f.fz * (f.depth / 2 - 5);
    const parts = [];
    const shaft = templateFrom(new THREE.BoxGeometry(8, 44, 8), 0x9c4632);
    xform(shaft, { y: 22 });
    parts.push(shaft);
    for (const y of [14, 27, 40]) { const band = templateFrom(new THREE.BoxGeometry(8.6, 0.8, 8.6), 0xefe6d2); xform(band, { y }); parts.push(band); }
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      const face = templateFrom(new THREE.CylinderGeometry(2.3, 2.3, 0.3, 20), 0xf4efe4);
      xform(face, { x: Math.sin(a) * 4.1, y: 36, z: Math.cos(a) * 4.1, rx: Math.PI / 2, ry: a });
      const hand = templateFrom(new THREE.BoxGeometry(0.25, 1.9, 0.2), 0x1a1a1a);
      xform(hand, { x: Math.sin(a) * 4.3, y: 36.7, z: Math.cos(a) * 4.3, ry: a });
      parts.push(face, hand);
    }
    const dome = templateFrom(new THREE.SphereGeometry(4.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x6f8f86);
    xform(dome, { y: 44 });
    const spire = templateFrom(new THREE.ConeGeometry(0.5, 4, 8), 0xd9a63a);
    xform(spire, { y: 50 });
    parts.push(dome, spire);
    const m = vcMesh(parts, mats.landmarkVC);
    m.position.set(x, 0, z);
    m.rotation.y = Math.atan2(f.fx, f.fz);
    group.add(m);
    collision.addCircle(x, z, 5.5);
  }
  // The Secretariat: four red-brick wings around a courtyard, domed corner towers
  if (L.secretariat && L.secretariat.rect) {
    const r = L.secretariat.rect;
    const G = new Geo();
    const wingD = 20, h = 17;
    const hl = r.len / 2, hw = r.wid / 2;
    const wings = [
      [-hl, -hw, hl, -hw + wingD], [-hl, hw - wingD, hl, hw],
      [-hl, -hw + wingD, -hl + wingD, hw - wingD], [hl - wingD, -hw + wingD, hl, hw - wingD],
    ];
    const brick = [0.96, 0.94, 0.92];
    for (const [x0, z0, x1, z1] of wings) {
      // ring in local coords, negative signed area (see data.js)
      const loc = [[x0, z0], [x0, z1], [x1, z1], [x1, z0]].map(([lx, lz]) => local(r, lx, lz));
      const ring = loc.flat();
      let area = 0;
      for (let i = 0, j = 3; i < 4; j = i++) area += ring[j * 2] * ring[i * 2 + 1] - ring[i * 2] * ring[j * 2 + 1];
      if (area > 0) { loc.reverse(); }
      const rr = loc.flat();
      let per = 0;
      for (let k = 0; k < 4; k++) {
        const j = (k + 1) % 4;
        const ax = rr[k * 2], az = rr[k * 2 + 1], bx = rr[j * 2], bz = rr[j * 2 + 1];
        const Lk = Math.hypot(bx - ax, bz - az);
        const nx = -(bz - az) / Lk, nz = (bx - ax) / Lk;
        const su = STYLE.brick * 1000;
        wallQuad(G, ax, az, bx, bz, -0.3, 3.3, nx, nz, su + per / 14.4, su + (per + Lk) / 14.4, -0.09, 1, brick, 0.72, 0.95);
        wallQuad(G, ax, az, bx, bz, 3.3, h, nx, nz, su + per / 14.4, su + (per + Lk) / 14.4, 1, h / 3.3, brick, 0.95, 1);
        wallQuad(G, ax, az, bx, bz, h, h + 1.2, nx, nz, 0, 0, -1, -1, [0.94, 0.9, 0.82], 0.9, 0.95);
        per += Lk;
      }
      const base = G.count;
      for (let k = 0; k < 4; k++) G.v(rr[k * 2], h, rr[k * 2 + 1], 0, 1, 0, 0, -1, 0.42, 0.25, 0.2);
      for (const t of [[0, 1, 2], [0, 2, 3]]) {
        const a = t[0], b = t[1], c = t[2];
        const cr = (rr[b * 2 + 1] - rr[a * 2 + 1]) * (rr[c * 2] - rr[a * 2]) - (rr[b * 2] - rr[a * 2]) * (rr[c * 2 + 1] - rr[a * 2 + 1]);
        if (cr >= 0) G.tri(base + a, base + b, base + c); else G.tri(base + a, base + c, base + b);
      }
      const [cx, cz] = local(r, (x0 + x1) / 2, (z0 + z1) / 2);
      collision.addBox(cx, cz, Math.abs(x1 - x0) / 2, Math.abs(z1 - z0) / 2, r.ang);
    }
    group.add(new THREE.Mesh(G.build(), mats.building));
    for (const [lx, lz] of [[-hl + 6, -hw + 6], [hl - 6, -hw + 6], [-hl + 6, hw - 6], [hl - 6, hw - 6]]) {
      const [x, z] = local(r, lx, lz);
      const parts = [];
      const drum = templateFrom(new THREE.CylinderGeometry(4.2, 4.2, 4, 12), 0x9c4632);
      xform(drum, { y: h + 2 });
      const dome = templateFrom(new THREE.SphereGeometry(4.4, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x7f8f88);
      xform(dome, { y: h + 4 });
      const fin = templateFrom(new THREE.ConeGeometry(0.4, 3, 8), 0xd9a63a);
      xform(fin, { y: h + 9.5 });
      parts.push(drum, dome, fin);
      const m = vcMesh(parts, mats.landmarkVC);
      m.position.set(x, 0, z);
      group.add(m);
    }
  }
}

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

  // ---------------------------------------------------------- Chinatown temples & heritage
  if (L.khenghockkeong && L.khenghockkeong.rect) chineseTemple(group, L.khenghockkeong.rect, mats, collision, '慶福宮', 'KHENG HOCK KEONG', 1.15);
  if (L.guanyin && L.guanyin.rect) chineseTemple(group, L.guanyin.rect, mats, collision, '觀音古廟', 'KWAN YIN TEMPLE', 1);
  heritage(group, map, mats, collision);

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
