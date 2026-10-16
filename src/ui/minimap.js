// Radar (rotating circular minimap) and the full-screen city map with GPS waypoint.
// Base map image, pre-rendered by tools/build_map.py (drawing 50k footprints on
// a phone at load time takes far too long).
export class MapImage {
  static async load(map, url = 'data/radar.webp') {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const m = new MapImage();
    m.x0 = map.bounds.x0; m.z0 = map.bounds.z0;
    m.canvas = img;
    m.W = img.naturalWidth; m.H = img.naturalHeight;
    m.mpp = 4; // must match render_radar(mpp) in tools/build_map.py
    return m;
  }
}

export function drawBlip(ctx, x, y, kind, size = 1, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  const s = size;
  switch (kind) {
    case 'player':
      ctx.rotate(angle);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * s;
      ctx.beginPath(); ctx.moveTo(0, -8 * s); ctx.lineTo(6 * s, 7 * s); ctx.lineTo(0, 3.5 * s); ctx.lineTo(-6 * s, 7 * s); ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    case 'mission':
      ctx.fillStyle = '#ff3ea5'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 6 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `bold ${8 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('M', 0, 0.5);
      break;
    case 'target':
      ctx.fillStyle = '#ffe14a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -7 * s); ctx.lineTo(7 * s, 0); ctx.lineTo(0, 7 * s); ctx.lineTo(-7 * s, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    case 'enemy':
      ctx.fillStyle = '#ff3b3b'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 5 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    case 'police':
      ctx.fillStyle = (performance.now() / 250) % 2 < 1 ? '#3b6bff' : '#ff3b3b';
      ctx.beginPath(); ctx.arc(0, 0, 4.5 * s, 0, Math.PI * 2); ctx.fill();
      break;
    case 'waypoint':
      ctx.fillStyle = '#c84cff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, 8 * s); ctx.lineTo(-6 * s, -2 * s); ctx.arc(0, -3 * s, 6 * s, Math.PI * 0.85, Math.PI * 0.15, false); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    case 'spray':
      ctx.fillStyle = '#38e8ff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.2;
      ctx.fillRect(-5 * s, -5 * s, 10 * s, 10 * s); ctx.strokeRect(-5 * s, -5 * s, 10 * s, 10 * s);
      ctx.fillStyle = '#000'; ctx.font = `bold ${8 * s}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 0.5);
      break;
    case 'health':
      ctx.fillStyle = '#ff4b6e'; ctx.fillRect(-5 * s, -1.6 * s, 10 * s, 3.2 * s); ctx.fillRect(-1.6 * s, -5 * s, 3.2 * s, 10 * s);
      break;
    case 'save':
      ctx.fillStyle = '#7dff8a'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, -6 * s); ctx.lineTo(6 * s, 0); ctx.lineTo(4 * s, 0); ctx.lineTo(4 * s, 6 * s); ctx.lineTo(-4 * s, 6 * s); ctx.lineTo(-4 * s, 0); ctx.lineTo(-6 * s, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    default:
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, 3 * s, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export class Radar {
  constructor(canvas, img) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.img = img;
    this.range = 170; // metres from centre to edge
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.c.getBoundingClientRect();
    this.size = Math.max(60, r.width);
    this.c.width = this.size * dpr; this.c.height = this.size * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(game, yaw, blips, route) {
    const ctx = this.ctx, S = this.size, R = S / 2;
    const p = game.player;
    const speed = p.vehicle ? p.vehicle.speed : 0;
    const range = this.range + Math.min(120, speed * 3);
    const scale = R / range; // px per metre
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#26303d'; ctx.fillRect(0, 0, S, S);
    ctx.translate(R, R);
    // world -> radar: rotate so the camera's forward direction points up
    const theta = yaw - Math.PI;
    ctx.rotate(theta);
    ctx.scale(scale, scale);
    const img = this.img;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img.canvas, img.x0 - p.x, img.z0 - p.z, img.W * img.mpp, img.H * img.mpp);
    if (route && route.length > 3) {
      ctx.strokeStyle = '#c84cff'; ctx.lineWidth = 5 / scale; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(route[0] - p.x, route[1] - p.z);
      for (let i = 2; i < route.length; i += 2) ctx.lineTo(route[i] - p.x, route[i + 1] - p.z);
      ctx.stroke();
    }
    ctx.restore();
    // blips (screen-space, clamped to the rim)
    const cs = Math.cos(yaw - Math.PI), sn = Math.sin(yaw - Math.PI);
    for (const b of blips) {
      const wx = (b.x - p.x) * scale, wz = (b.z - p.z) * scale;
      let sx = wx * cs - wz * sn, sy = wx * sn + wz * cs;
      const l = Math.hypot(sx, sy);
      const lim = R - 9;
      if (l > lim) { if (!b.edge) continue; sx = (sx / l) * lim; sy = (sy / l) * lim; }
      drawBlip(ctx, R + sx, R + sy, b.kind, b.size || 1);
    }
    // player arrow: heading relative to camera yaw
    const h = p.vehicle ? p.vehicle.heading : p.human.heading;
    drawBlip(ctx, R, R, 'player', 1.1, -(h - yaw));
    // north marker
    const nx = sn, ny = -cs;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
    const ex = R + nx * (R - 9), ey = R + ny * (R - 9);
    ctx.strokeText('N', ex, ey); ctx.fillText('N', ex, ey);
    // rim
    ctx.beginPath(); ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,62,165,0.9)'; ctx.stroke();
  }
}

export class BigMap {
  constructor(canvas, img, map, onWaypoint) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.img = img;
    this.map = map;
    this.onWaypoint = onWaypoint;
    this.zoom = 0.35;  // px per metre
    this.cx = 0; this.cz = 0;
    this.pointers = new Map();
    this._bind();
  }

  open(x, z) {
    this.cx = x; this.cz = z;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.c.getBoundingClientRect();
    this.w = r.width; this.h = r.height;
    this.c.width = r.width * dpr; this.c.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _bind() {
    const c = this.c;
    let moved = 0, startDist = 0, startZoom = 1;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        startDist = Math.hypot(a.x - b.x, a.y - b.y); startZoom = this.zoom;
      }
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.pointers.size === 1) {
        this.cx -= dx / this.zoom; this.cz -= dy / this.zoom;
        moved += Math.abs(dx) + Math.abs(dy);
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom = Math.max(0.08, Math.min(3, startZoom * (d / (startDist || 1))));
        moved += 20;
      }
    });
    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (p && moved < 8 && this.pointers.size === 0) {
        const r = c.getBoundingClientRect();
        const x = this.cx + (e.clientX - r.left - this.w / 2) / this.zoom;
        const z = this.cz + (e.clientY - r.top - this.h / 2) / this.zoom;
        this.onWaypoint(x, z);
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom = Math.max(0.08, Math.min(3, this.zoom * (e.deltaY > 0 ? 0.88 : 1.14)));
    }, { passive: false });
  }

  zoomBy(f) { this.zoom = Math.max(0.08, Math.min(3, this.zoom * f)); }

  draw(game, blips, route) {
    const ctx = this.ctx, W = this.w, H = this.h, z = this.zoom;
    const img = this.img;
    ctx.fillStyle = '#1b222c'; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(z, z);
    ctx.translate(-this.cx, -this.cz);
    ctx.imageSmoothingEnabled = z < 0.3;
    ctx.drawImage(img.canvas, img.x0, img.z0, img.W * img.mpp, img.H * img.mpp);
    if (route && route.length > 3) {
      ctx.strokeStyle = '#c84cff'; ctx.lineWidth = 6 / z; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(route[0], route[1]);
      for (let i = 2; i < route.length; i += 2) ctx.lineTo(route[i], route[i + 1]);
      ctx.stroke();
    }
    ctx.restore();
    const sx = (x) => W / 2 + (x - this.cx) * z, sy = (zz) => H / 2 + (zz - this.cz) * z;
    // district names
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (z < 0.6) {
      ctx.font = '600 13px "Rajdhani", sans-serif';
      for (const d of this.map.districts) {
        const x = (d.x0 + d.x1) / 2, y = (d.z0 + d.z1) / 2;
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.fillText(d.name.toUpperCase(), sx(x), sy(y));
      }
    }
    // landmark labels
    ctx.font = '600 12px "Rajdhani", sans-serif';
    for (const lm of Object.values(this.map.landmarks)) {
      const x = sx(lm.x), y = sy(lm.z);
      if (x < -50 || y < -20 || x > W + 50 || y > H + 20) continue;
      ctx.fillStyle = '#ffd36a';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = 3;
      ctx.strokeText(lm.name, x, y - 11); ctx.fillStyle = '#fff'; ctx.fillText(lm.name, x, y - 11);
    }
    for (const b of blips) drawBlip(ctx, sx(b.x), sy(b.z), b.kind, 1.3);
    const p = game.player;
    drawBlip(ctx, sx(p.x), sy(p.z), 'player', 1.3, Math.PI - (p.vehicle ? p.vehicle.heading : p.human.heading));
  }
}
