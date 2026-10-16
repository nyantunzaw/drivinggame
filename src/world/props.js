// Low-poly prop templates: palms, rain trees, street lamps.
import * as THREE from 'three';
import { templateFrom, mergeTemplates, xform } from './geo.js';

function flat(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  return g;
}

function palm() {
  const parts = [];
  // gently curved trunk from stacked segments
  let x = 0, y = 0;
  for (let i = 0; i < 5; i++) {
    const seg = flat(new THREE.CylinderGeometry(0.17 - i * 0.015, 0.2 - i * 0.015, 1.9, 6));
    const t = templateFrom(seg, i % 2 ? 0x8a6a48 : 0x7a5c3e);
    xform(t, { x, y: y + 0.95, rz: -0.05 * i });
    parts.push(t);
    y += 1.85;
    x += 0.09 * i;
  }
  const top = { x, y };
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    const leaf = new THREE.BufferGeometry();
    // drooping frond: two triangles strip
    const L = 3.2;
    const v = new Float32Array([
      0, 0, 0, L * 0.5, 0.45, 0.35, L * 0.5, 0.45, -0.35,
      L * 0.5, 0.45, 0.35, L, -0.6, 0, L * 0.5, 0.45, -0.35,
    ]);
    leaf.setAttribute('position', new THREE.BufferAttribute(v, 3));
    leaf.computeVertexNormals();
    const t = templateFrom(leaf, k % 2 ? 0x3f8a3a : 0x4f9e42);
    xform(t, { x: top.x, y: top.y, ry: a, rz: -0.15 });
    // make both faces visible by duplicating reversed
    const back = JSON.parse(JSON.stringify(t));
    for (let i = 0; i < back.idx.length; i += 3) { const tmp = back.idx[i]; back.idx[i] = back.idx[i + 1]; back.idx[i + 1] = tmp; }
    for (let i = 0; i < back.n.length; i++) back.n[i] = -back.n[i];
    parts.push(t, back);
  }
  const nut = templateFrom(flat(new THREE.IcosahedronGeometry(0.35, 0)), 0x5a4a2a);
  xform(nut, { x: top.x, y: top.y - 0.2 });
  parts.push(nut);
  return mergeTemplates(parts);
}

function rainTree() {
  const parts = [];
  const trunk = templateFrom(flat(new THREE.CylinderGeometry(0.28, 0.42, 3.6, 6)), 0x6b5440);
  xform(trunk, { y: 1.8 });
  parts.push(trunk);
  const cols = [0x3c7a35, 0x4b8a3c, 0x356d2f];
  const blobs = [[0, 5.0, 0, 3.4], [1.9, 4.6, 0.8, 2.4], [-1.7, 4.7, -0.9, 2.5], [0.4, 5.6, -1.6, 2.2]];
  blobs.forEach(([x, y, z, r], i) => {
    const t = templateFrom(flat(new THREE.IcosahedronGeometry(r, 0)), cols[i % 3]);
    xform(t, { x, y, z, sy: 0.62 });
    parts.push(t);
  });
  return mergeTemplates(parts);
}

function lamp() {
  const parts = [];
  const pole = templateFrom(flat(new THREE.CylinderGeometry(0.07, 0.11, 7.5, 6)), 0x5d6168);
  xform(pole, { y: 3.75 });
  const arm = templateFrom(flat(new THREE.BoxGeometry(1.8, 0.1, 0.1)), 0x5d6168);
  xform(arm, { x: 0.85, y: 7.4 });
  const head = templateFrom(flat(new THREE.BoxGeometry(0.7, 0.18, 0.32)), 0xfff2c8, 1);
  xform(head, { x: 1.6, y: 7.28 });
  parts.push(pole, arm, head);
  return mergeTemplates(parts);
}

export const TEMPLATES = {};
export function initProps() {
  TEMPLATES.palm = palm();
  TEMPLATES.rain = rainTree();
  TEMPLATES.lamp = lamp();
}
