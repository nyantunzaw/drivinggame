// Decodes data/yangon.json (see tools/build_map.py) into typed arrays.
import { polyArea } from './util.js';

function decode(arr, start, unit) {
  const n = (arr.length - start) / 2;
  const out = new Float32Array(n * 2);
  let x = 0, z = 0;
  for (let i = 0; i < n; i++) {
    if (i === 0) { x = arr[start]; z = arr[start + 1]; }
    else { x += arr[start + i * 2]; z += arr[start + i * 2 + 1]; }
    out[i * 2] = x * unit;
    out[i * 2 + 1] = z * unit;
  }
  return out;
}

// Ensure ring has negative signed area (see chunks.js wall winding).
function orient(pts) {
  if (polyArea(pts) > 0) {
    const n = pts.length / 2;
    const r = new Float32Array(pts.length);
    for (let i = 0; i < n; i++) {
      r[i * 2] = pts[(n - 1 - i) * 2];
      r[i * 2 + 1] = pts[(n - 1 - i) * 2 + 1];
    }
    return r;
  }
  return pts;
}

export class MapData {
  constructor(json) {
    this.raw = json;
    this.attribution = json.attribution;
    const [x0, z0, x1, z1] = json.bounds;
    this.bounds = { x0, z0, x1, z1 };
    this.names = json.names;

    // ---- road graph
    const nn = json.nodes.length / 2;
    this.nodeX = new Float32Array(nn);
    this.nodeZ = new Float32Array(nn);
    for (let i = 0; i < nn; i++) {
      this.nodeX[i] = json.nodes[i * 2] / 10;
      this.nodeZ[i] = json.nodes[i * 2 + 1] / 10;
    }
    this.edges = json.edges.map((e, idx) => {
      const pts = decode(e, 6, 0.1);
      const n = pts.length / 2;
      const cum = new Float32Array(n);
      for (let i = 1; i < n; i++) {
        cum[i] = cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
      }
      return {
        id: idx, a: e[0], b: e[1], cls: e[2], name: e[3] >= 0 ? json.names[e[3]] : null,
        oneway: e[4], bridge: e[5], pts, cum, len: cum[n - 1],
      };
    });

    this.rail = json.rail.map((r) => decode(r, 0, 0.1));

    // ---- buildings (flat storage)
    const nb = json.buildings.length;
    this.bType = new Uint8Array(nb);
    this.bHeight = new Float32Array(nb);
    this.bStart = new Uint32Array(nb + 1);
    this.bCx = new Float32Array(nb);
    this.bCz = new Float32Array(nb);
    this.bArea = new Float32Array(nb);
    const rings = [];
    let total = 0;
    for (let i = 0; i < nb; i++) {
      const b = json.buildings[i];
      const ring = orient(decode(b, 2, 0.5));
      rings.push(ring);
      this.bType[i] = b[0];
      this.bHeight[i] = b[1] / 2;
      this.bStart[i] = total;
      total += ring.length;
    }
    this.bStart[nb] = total;
    this.bPts = new Float32Array(total);
    for (let i = 0; i < nb; i++) {
      const r = rings[i];
      this.bPts.set(r, this.bStart[i]);
      let cx = 0, cz = 0;
      const n = r.length / 2;
      for (let k = 0; k < n; k++) { cx += r[k * 2]; cz += r[k * 2 + 1]; }
      this.bCx[i] = cx / n;
      this.bCz[i] = cz / n;
      this.bArea[i] = Math.abs(polyArea(r));
    }
    this.buildingCount = nb;

    this.water = json.water.map((rings) => rings.map((r) => decode(r, 0, 0.5)));
    this.green = json.green.map(([t, r]) => ({ type: t, pts: decode(r, 0, 0.5) }));
    this.trees = new Float32Array(json.trees);
    this.districts = json.districts.map(([n, my, r]) => {
      const pts = decode(r, 0, 1.0);
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
        z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]);
      }
      return { name: json.names[n], my: my >= 0 ? json.names[my] : '', pts, x0, z0, x1, z1 };
    });
    this.landmarks = {};
    for (const [k, v] of Object.entries(json.landmarks)) {
      this.landmarks[k] = { id: k, x: v[0], z: v[1], name: v[2], my: v[3] };
      // optional footprint rectangle: centre, long side, short side, angle of long side
      if (v.length >= 9) this.landmarks[k].rect = { x: v[4], z: v[5], len: v[6], wid: v[7], ang: v[8] };
    }
  }

  // WGS84 -> world metres (same projection as tools/build_map.py)
  fromLatLon(lat, lon) {
    const [lat0, lon0] = this.raw.origin;
    const [mlat, mlon] = this.raw.scale;
    return { x: (lon - lon0) * mlon, z: -(lat - lat0) * mlat };
  }

  buildingRing(i) {
    return this.bPts.subarray(this.bStart[i], this.bStart[i + 1]);
  }
}

export async function loadMap(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load map data: ' + res.status);
  const total = Number(res.headers.get('content-length')) || 0;
  let json;
  if (res.body && total && onProgress) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(Math.min(1, got / total));
    }
    const buf = new Uint8Array(got);
    let o = 0;
    for (const c of chunks) { buf.set(c, o); o += c.length; }
    json = JSON.parse(new TextDecoder().decode(buf));
  } else {
    json = await res.json();
  }
  return new MapData(json);
}
