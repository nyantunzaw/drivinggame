// Yangon is flat river delta except for Singuttara Hill, crowned by Shwedagon Pagoda.
// The hill is an analytic bump so every system (roads, cars, buildings) agrees on height.

export const HILL = {
  x: 0, z: 0,          // set from map data (Shwedagon position)
  top: 32,             // platform height above the city (m)
  r0: 110,             // flat platform radius
  r1: 430,             // foot of the hill
  stretch: 0.8,        // ridge runs north-south
};

export function setHillCenter(x, z) {
  HILL.x = x;
  HILL.z = z;
}

function smoother(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function heightAt(x, z) {
  const dx = x - HILL.x;
  const dz = (z - HILL.z) * HILL.stretch;
  const d2 = dx * dx + dz * dz;
  if (d2 >= HILL.r1 * HILL.r1) return 0;
  const d = Math.sqrt(d2);
  if (d <= HILL.r0) return HILL.top;
  const t = (d - HILL.r0) / (HILL.r1 - HILL.r0);
  return HILL.top * (1 - smoother(t));
}

// Surface normal via central differences, written into out {x,y,z}.
export function normalAt(x, z, out) {
  const e = 1.5;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  let nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  out.x = nx / l; out.y = ny / l; out.z = nz / l;
  return out;
}

export function onHill(x, z, margin = 0) {
  const dx = x - HILL.x;
  const dz = (z - HILL.z) * HILL.stretch;
  const r = HILL.r1 + margin;
  return dx * dx + dz * dz < r * r;
}
