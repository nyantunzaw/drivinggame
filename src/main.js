// Yangon Vice — entry point. Wires the world, simulation, UI and audio together.
import * as THREE from 'three';
import { QUALITY, defaultQuality, probeGPU, START_HOUR, SECONDS_PER_HOUR, ROAD_HALF, isTouchDevice } from './config.js';
import { GfxGuard, GFX_STEPS } from './gfxguard.js';
import { loadMap } from './data.js';
import { setHillCenter } from './terrain.js';
import { CollisionWorld } from './world/collision.js';
import { createMaterials } from './world/materials.js';
import { initProps } from './world/props.js';
import { ChunkManager } from './world/chunks.js';
import { buildStatic } from './world/static.js';
import { buildLandmarks } from './world/landmarks.js';
import { Sky } from './world/sky.js';
import { RoadGraph, edgePoint } from './ai/roadgraph.js';
import { VehicleRenderer } from './vehicles/renderer.js';
import { HumanRenderer } from './humans/renderer.js';
import { Vehicle } from './vehicles/vehicle.js';
import { Traffic } from './ai/traffic.js';
import { Parked } from './ai/parked.js';
import { loadShops, buildShopFronts } from './world/shops.js';
import { Peds } from './ai/peds.js';
import { Police } from './ai/police.js';
import { AIDriver } from './ai/driver.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { HUD } from './ui/hud.js';
import { MapImage, Radar, BigMap } from './ui/minimap.js';
import { Audio, STATIONS } from './audio.js';
import { FX } from './fx.js';
import { Missions } from './missions.js';
import { pointInPoly, storageGet, storageSet, clamp } from './util.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

class Game {
  constructor() {
    this.gpu = probeGPU();
    this.settings = Object.assign({ quality: defaultQuality(this.gpu), music: 0.55, sfx: 0.8, sensitivity: 1, fps: false, gfxOff: [] }, storageGet('yv-settings', {}));
    if (!QUALITY[this.settings.quality]) this.settings.quality = 'medium';
    // a copy: compatibility fixes below adjust it per device
    this.quality = { ...QUALITY[this.settings.quality] };
    const off = new Set(this.settings.gfxOff || []);
    if (off.has('shadows')) this.quality.shadows = false;
    if (off.has('pbr')) this.quality.pbr = false;
    if (off.has('lowres')) { this.quality.pixelRatio = 1; this.quality.antialias = false; }
    this.time = 0;
    this.paused = true;
    this.vehicles = [];
    this.focus = { x: 0, z: 0 };
    this.camFwd = new THREE.Vector3(0, 0, 1);
    this.gps = null; this.waypoint = null; this.route = null; this.routeTimer = 0;
    this.districtTimer = 0; this.district = null;
    this.frameTimes = [];
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
  }

  progress(p, text) {
    $('load-fill').style.width = Math.round(p * 100) + '%';
    if (text) $('load-text').textContent = text;
  }

  async init() {
    const gfxOff = new Set(this.settings.gfxOff || []);
    const touch = isTouchDevice();
    document.body.classList.toggle('touch', touch);
    const canvas = $('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality.antialias, powerPreference: 'high-performance' });
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.onContextLost(); });
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; });
    this.renderer.debug.onShaderError = (gl, program, vs, fs) => {
      const log = (gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || gl.getProgramInfoLog(program) || '').trim();
      console.error('Shader error:', log);
      this.showError(`A shader failed to compile on this GPU: ${log.split('\n')[0].slice(0, 160)}`);
      // the custom effects are the likely cause: fall back to the plain versions, also next time
      const off = new Set(this.settings.gfxOff || []);
      for (const id of ['facade', 'pbr']) { off.add(id); this.applyGfxOff(id); }
      this.settings.gfxOff = [...off];
      this.saveSettings();
    };
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 6000);

    this.progress(0.02, 'Downloading map of Yangon…');
    this.map = await loadMap('data/yangon.json', (p) => this.progress(0.02 + p * 0.38));
    const L = this.map.landmarks;
    setHillCenter(L.shwedagon.x, L.shwedagon.z);
    this.progress(0.42, 'Laying out streets…'); await nextFrame();
    this.collision = new CollisionWorld(this.map);
    this.graph = new RoadGraph(this.map);
    this.progress(0.52, 'Painting buildings…'); await nextFrame();
    this.mats = await createMaterials(this.renderer, this.settings.quality, { simpleFacade: gfxOff.has('facade') });
    if (gfxOff.has('detail')) this.applyGfxOff('detail');
    initProps();
    const ll = (lat, lon) => this.map.fromLatLon(lat, lon);
    const core = [ll(16.7675, 96.140), ll(16.7665, 96.176), ll(16.784, 96.176), ll(16.785, 96.140)].flatMap((p) => [p.x, p.z]);
    const latha = this.map.districts.find((d) => d.name === 'Latha');
    const china = latha ? (x, z) => x >= latha.x0 && x <= latha.x1 && z >= latha.z0 && z <= latha.z1 && pointInPoly(latha.pts, x, z) : () => false;
    this.inChinatown = china;
    this.inCore = (x, z) => pointInPoly(core, x, z);
    this.chunks = new ChunkManager(this.scene, this.map, this.mats, this.quality, {
      core: this.inCore, china, collision: this.collision,
    });
    // real Chinatown shops (Overture Maps places) on their own frontages
    const shops = await loadShops('data/shops.json');
    if (shops.length) {
      const fronts = await buildShopFronts(shops, this.map, this.collision, (x, z) => this.chunks.cellAt(x, z), this.mats, this.quality);
      this.chunks.setShops(fronts);
      if (gfxOff.has('detail')) this.mats.shopSigns.visible = false;
      if (/debug/.test(location.search)) console.log('shops placed', fronts.placed, 'of', shops.length);
    }
    this.progress(0.6, 'Filling the lakes…'); await nextFrame();
    this.static = buildStatic(this.scene, this.map, this.mats, this.quality, { core });
    this.progress(0.68, 'Gilding the pagodas…'); await nextFrame();
    buildLandmarks(this.scene, this.map, this.mats, this.collision, this.chunks);
    this.sky = new Sky(this.scene, this.quality);
    this.sky.setView(this.quality.view);
    this.vrender = new VehicleRenderer(this.scene, this.quality, this.mats.env);
    this.guard = new GfxGuard(this);
    this.hrender = new HumanRenderer(this.scene);
    this.fx = new FX(this.scene);

    this.input = new Input(canvas);
    this.hud = new HUD();
    this.audio = new Audio();
    this.audio.setVolumes(this.settings.music, this.settings.sfx);
    this.camRig = new CameraRig(this.camera);

    // the player starts at The Strand Hotel, just like a certain hotel in 1986 Vice City
    const st = L.strand;
    const n = this.graph.nearestNode(st.x, st.z + 25, 400, true);
    const nx = this.map.nodeX[n], nz = this.map.nodeZ[n];
    const dx = st.x - nx, dz = st.z - nz, dl = Math.hypot(dx, dz) || 1;
    // stand on the pavement in front of the hotel, never inside its footprint
    let off = 9, sx = nx, sz = nz;
    for (; off > 0; off -= 1) {
      sx = nx + (dx / dl) * off; sz = nz + (dz / dl) * off;
      if (this.collision.buildingAt(sx, sz) < 0 && this.collision.buildingAt(sx + (dx / dl) * 1.5, sz + (dz / dl) * 1.5) < 0) break;
    }
    this.player = new Player(this, sx, sz);
    this.player.human.heading = Math.atan2(-dx, -dz);
    this.focus.x = sx; this.focus.z = sz;
    this.traffic = new Traffic(this);
    this.parked = new Parked(this);
    this.peds = new Peds(this);
    this.police = new Police(this);
    this.missions = new Missions(this);
    this.player.money = this.missions.save.money || 0;
    this.hud.setMoney(this.player.money);
    this.hud.shownMoney = this.player.money;
    // parked cars near the hotel (on the road edge, clear of walls)
    const o = this.graph.out[n][0] || this.graph.any[n][0];
    if (o) {
      const P = { x: 0, z: 0, tx: 0, tz: 0 };
      const types = [['sedan', '#ff3ea5'], ['taxi', null], ['sports', '#38e8ff']];
      let placed = 0;
      for (let s = 6; s < o.e.len - 4 && placed < types.length; s += 13) {
        edgePoint(o.e, o.dir, s, P);
        for (const side of [1, -1]) {
          const half = ROAD_HALF[o.e.cls] - 1.3;
          const x = P.x - P.tz * half * side, z = P.z + P.tx * half * side;
          const v = new Vehicle(types[placed][0], x, z, Math.atan2(P.tx, P.tz), types[placed][1]);
          const clear = v.circleOffsets.every((off) => !this.collision.resolveCircle(x + P.tx * off, z + P.tz * off, v.circleR + 0.3, {}).hit);
          if (clear && !this.collision.isWater(x, z)) { v.sleeping = true; this.addVehicle(v); placed++; break; }
        }
      }
    }
    this.camRig.snap(sx, this.player.human.y + 1.5, sz, this.player.human.heading);
    this.camRig.yaw = this.player.human.heading;

    this.progress(0.74, 'Building downtown…'); await nextFrame();
    const dbg = /debug/.test(location.search);
    let t0 = performance.now();
    let pending = 1;
    while (pending > 0) {
      pending = this.chunks.update(sx, sz, this.quality.view, 60);
      this.progress(0.74 + 0.22 * (1 - Math.min(1, pending / 30)), 'Building downtown…');
      await nextFrame();
    }
    this.parked.fill(sx, sz);
    if (dbg) console.log('chunks', (performance.now() - t0).toFixed(0)); t0 = performance.now();
    // radar & map
    this.mapImage = await MapImage.load(this.map);
    if (dbg) console.log('mapimage', (performance.now() - t0).toFixed(0)); t0 = performance.now();
    this.radar = new Radar($('radar'), this.mapImage);
    this.bigMap = new BigMap($('bigmap'), this.mapImage, this.map, (x, z) => this.setWaypoint(x, z));
    this.progress(1, 'Ready');
    this.renderer.compile(this.scene, this.camera);
    if (dbg) console.log('compile', (performance.now() - t0).toFixed(0));
    this.bindUI();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    $('start-btn').classList.add('ready');
    $('start-btn').textContent = 'TAP TO START';
    this.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ UI
  bindUI() {
    const start = () => {
      if (!this.paused || this.started) return;
      this.started = true;
      this.audio.init();
      this.audio.setVolumes(this.settings.music, this.settings.sfx);
      $('loading').classList.add('hidden');
      this.paused = false;
      if (document.body.classList.contains('touch')) {
        const el = document.documentElement;
        try { (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el)?.catch?.(() => {}); } catch (e) { /* ignore */ }
        try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch (e) { /* ignore */ }
      }
      this.hud.area('Kyauktada', 'ကျောက်တံတား');
      setTimeout(() => this.hud.help(document.body.classList.contains('touch')
        ? 'Move with the <b>left stick</b>. Drag the right side to look around. Walk to a car and tap <b>CAR</b> to drive.<br>Pink <b>M</b> markers start missions.'
        : '<b>WASD</b> move/drive · <b>Mouse drag</b> look · <b>F</b> enter/exit car · <b>Space</b> jump/handbrake · <b>E</b> punch · <b>Shift</b> sprint · <b>R</b> radio · <b>M</b> map · <b>Esc</b> pause<br>Pink <b>M</b> markers start missions.', 11000), 1500);
    };
    $('start-btn').addEventListener('click', start);
    $('start-btn').addEventListener('touchend', (e) => { e.preventDefault(); start(); });

    $('btn-pause').addEventListener('click', () => this.togglePause());
    $('btn-map').addEventListener('click', () => this.openMap());
    $('menu-resume').addEventListener('click', () => this.togglePause(false));
    $('menu-map').addEventListener('click', () => { this.togglePause(false); this.openMap(); });
    $('menu-settings').addEventListener('click', () => this.showPanel('settings'));
    $('menu-help').addEventListener('click', () => this.showPanel('help'));
    $('menu-credits').addEventListener('click', () => this.showPanel('credits'));
    $('menu-abort').addEventListener('click', () => { this.missions.abort(); this.togglePause(false); });
    for (const b of document.querySelectorAll('.panel-back')) b.addEventListener('click', () => this.showPanel('main'));
    $('map-close').addEventListener('click', () => this.closeMap());
    $('map-clear').addEventListener('click', () => { this.waypoint = null; this.route = null; });
    $('map-zin').addEventListener('click', () => this.bigMap.zoomBy(1.4));
    $('map-zout').addEventListener('click', () => this.bigMap.zoomBy(1 / 1.4));

    const q = $('set-quality');
    q.value = this.settings.quality;
    q.addEventListener('change', () => { this.settings.quality = q.value; this.saveSettings(); $('quality-note').style.display = 'block'; });
    $('quality-reload').addEventListener('click', () => location.reload());
    const gfxInfo = () => {
      const off = (this.settings.gfxOff || []).map((id) => GFX_STEPS.find((s) => s.id === id)?.label).filter(Boolean);
      const gl2 = this.renderer.capabilities.isWebGL2 ? 'WebGL 2' : 'WebGL 1';
      $('gfx-info').textContent = `GPU: ${this.gpu.name} · ${gl2}` + (off.length ? ` · Switched off for this device: ${off.join(', ')}.` : '');
      $('gfx-reset').style.display = off.length ? '' : 'none';
    };
    gfxInfo();
    $('menu-settings').addEventListener('click', gfxInfo);
    $('gfx-reset').addEventListener('click', () => { this.settings.gfxOff = []; this.saveSettings(); location.reload(); });
    const bindRange = (id, key, fn) => {
      const el = $(id); el.value = this.settings[key];
      el.addEventListener('input', () => { this.settings[key] = Number(el.value); fn && fn(); this.saveSettings(); });
    };
    bindRange('set-music', 'music', () => this.audio.setVolumes(this.settings.music, this.settings.sfx));
    bindRange('set-sfx', 'sfx', () => this.audio.setVolumes(this.settings.music, this.settings.sfx));
    bindRange('set-sens', 'sensitivity');
    const fps = $('set-fps');
    fps.checked = !!this.settings.fps;
    fps.addEventListener('change', () => { this.settings.fps = fps.checked; this.saveSettings(); if (!fps.checked) this.hud.fps(0); });
    // two-tap confirmation (dialogs like confirm() are blocked in some embeds)
    const reset = $('reset-save');
    let armed = 0;
    reset.addEventListener('click', () => {
      if (performance.now() - armed < 4000) {
        storageSet('yv-save', { done: [], money: 0, hintha: [] });
        location.reload();
        return;
      }
      armed = performance.now();
      reset.textContent = 'Tap again to erase missions, money and Golden Hinthas';
      setTimeout(() => { reset.textContent = 'Reset saved progress'; }, 4000);
    });
    $('attribution').textContent = this.map.attribution;
    document.addEventListener('visibilitychange', () => { if (document.hidden && !this.paused) this.togglePause(true); });
  }

  saveSettings() { storageSet('yv-settings', this.settings); }

  // Turn off one of the heavier graphics features (see gfxguard.js) while running.
  applyGfxOff(id) {
    const M = this.mats;
    if (id === 'facade' && M) M.useSimpleFacade();
    if (id === 'pbr' && this.vrender) this.vrender.setPBR(false);
    if (id === 'detail' && M) { M.signs.visible = false; M.wires.visible = false; M.pool.visible = false; if (M.shopSigns) M.shopSigns.visible = false; }
    if (id === 'shadows' && this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.enabled = false;
      this.quality.shadows = false;
      this.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true; });
    }
    if (id === 'lowres') {
      this.quality.pixelRatio = 1;
      this.pixelRatio = 1;
      this.renderer.setPixelRatio(1);
      this.resize();
    }
  }

  // Visible error line, so a broken screen tells you why instead of just going blank.
  showError(msg) {
    const el = $('err-banner');
    if (!el || el.dataset.shown === msg) return;
    el.dataset.shown = msg;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._errTimer);
    this._errTimer = setTimeout(() => el.classList.remove('show'), 20000);
  }

  onContextLost() {
    this.contextLost = true;
    console.warn('WebGL context lost');
    // A reset while the game is on screen usually means the driver gave up on something we
    // drew: come back with the lighter settings (once; never loop).
    if (document.visibilityState !== 'visible' || !this.started) return;
    const all = GFX_STEPS.map((s) => s.id);
    const already = all.every((id) => (this.settings.gfxOff || []).includes(id));
    if (already) {
      this.showError(`The graphics driver keeps resetting on this device (${this.gpu.name}). Try Settings → Graphics quality → Low.`);
      return;
    }
    this.settings.gfxOff = all;
    this.saveSettings();
    this.showError('The graphics driver reset. Reloading with lighter graphics…');
    setTimeout(() => location.reload(), 1800);
  }

  showPanel(name) {
    for (const p of document.querySelectorAll('.menu-panel')) p.classList.toggle('active', p.dataset.panel === name);
  }

  togglePause(force) {
    if (!this.started) return;
    const want = force === undefined ? !this.paused : force;
    if (this.mapOpen) this.closeMap();
    this.paused = want;
    $('menu').classList.toggle('hidden', !want);
    this.showPanel('main');
    if (this.audio.ctx) { if (want) this.audio.ctx.suspend(); else this.audio.ctx.resume(); }
  }

  openMap() {
    if (!this.started) return;
    this.mapOpen = true;
    this.paused = true;
    $('map-screen').classList.remove('hidden');
    this.bigMap.open(this.player.x, this.player.z);
  }

  closeMap() {
    this.mapOpen = false;
    this.paused = false;
    $('map-screen').classList.add('hidden');
  }

  setWaypoint(x, z) {
    const n = this.graph.nearestNode(x, z, 400);
    if (n < 0) return;
    this.waypoint = { x: this.map.nodeX[n], z: this.map.nodeZ[n] };
    this.routeTimer = 0;
    this.hud.flashMessage('Waypoint set');
  }

  setGPS(target) { this.gps = target; this.routeTimer = 0; if (!target) this.route = null; }

  routeLength(ax, az, bx, bz) {
    const a = this.graph.nearestNode(ax, az, 400), b = this.graph.nearestNode(bx, bz, 400);
    const path = this.graph.route(a, b);
    if (!path) return Math.hypot(ax - bx, az - bz) * 1.4;
    return path.reduce((s, st) => s + st.e.len, 0);
  }

  raceRoute(v, points) {
    let from = this.graph.nearestNode(v.x, v.z, 300, true);
    const path = [];
    for (const p of points) {
      const seg = this.graph.route(from, p.node);
      if (seg) path.push(...seg);
      from = p.node;
    }
    return path;
  }

  addMoney(n) {
    this.player.money = Math.max(0, this.player.money + n);
    this.hud.setMoney(this.player.money);
    if (this.missions) this.missions.persist();
  }

  addVehicle(v) { this.vehicles.push(v); }
  removeVehicle(v) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
  }
  addHuman() { /* humans are owned by their managers */ }
  removeHuman() { /* idem */ }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.radar) this.radar.resize();
    if (this.mapOpen) this.bigMap.resize();
    document.body.classList.toggle('portrait', h > w);
  }

  // ------------------------------------------------------------------ events
  onImpact(v, speed) {
    const p = this.player;
    const d = Math.hypot(v.x - p.x, v.z - p.z);
    if (d < 80) this.audio.sfx('crash', clamp(speed / 18, 0.2, 1) * (1 - d / 80));
    if (v === p.vehicle) {
      this.camRig.shake = Math.min(1, speed / 14);
      if (speed > 14) p.hurt((speed - 14) * 0.9);
      if (navigator.vibrate && speed > 6) { try { navigator.vibrate(Math.min(80, speed * 3)); } catch (e) { /* ignore */ } }
    }
    if (speed > 5 && d < 150) this.fx.sparks(v.x, v.y + 0.5, v.z, Math.min(16, speed));
    if (speed > 9) this.peds.panic(v.x, v.z, 18);
  }

  onExplode(v) {
    this.fx.explosion(v.x, v.y, v.z);
    const p = this.player;
    const d = Math.hypot(v.x - p.x, v.z - p.z);
    this.audio.sfx('explosion', clamp(1 - d / 200, 0.1, 1));
    if (d < 60) this.camRig.shake = Math.max(this.camRig.shake, 1 - d / 60);
    for (const o of this.vehicles) {
      if (o === v) continue;
      const dd = Math.hypot(o.x - v.x, o.z - v.z);
      if (dd < 12) { o.damage(500 * (1 - dd / 12)); const k = (12 - dd) * 0.8; o.vx += ((o.x - v.x) / (dd || 1)) * k; o.vz += ((o.z - v.z) / (dd || 1)) * k; }
    }
    for (const h of this.humans()) {
      const dd = Math.hypot(h.x - v.x, h.z - v.z);
      if (dd < 10 && h.visible) {
        const k = (10 - dd) * 1.4;
        h.knock(((h.x - v.x) / (dd || 1)) * k, ((h.z - v.z) / (dd || 1)) * k, 6, 120 * (1 - dd / 10));
        if (h === p.human) p.hurt(80 * (1 - dd / 10));
      }
    }
    if (v === p.vehicle) { p.exit(); p.hurt(100); }
    if (v.lastHitByPlayer) this.police.crime('explode', v.x, v.z);
    this.peds.panic(v.x, v.z, 40);
  }

  wasted(reason) {
    const p = this.player;
    if (p.dead) return;
    p.dead = true;
    this.audio.sfx('wasted');
    this.hud.big('WASTED', reason === 'drowned' ? 'You can\'t swim, remember?' : '', '#ff3b3b', 4200);
    $('fade').classList.add('red');
    this.missions.abort();
    setTimeout(() => this.respawn(this.missions.hospitals, 'Yangon General Hospital', 100), 3600);
  }

  busted() {
    const p = this.player;
    if (p.dead) return;
    p.dead = true;
    this.audio.sfx('fail');
    this.hud.big('BUSTED', '', '#4b8bff', 4200);
    $('fade').classList.add('blue');
    this.missions.abort();
    setTimeout(() => this.respawn(this.missions.policeStations, 'Police Station', 100 + this.police.stars * 100), 3600);
  }

  respawn(spots, label, fine) {
    const p = this.player;
    $('fade').classList.add('black');
    setTimeout(() => {
      if (p.vehicle) { const v = p.vehicle; p.exit(); v.driver = null; }
      let best = spots[0], bd = Infinity;
      for (const s of spots) { const d = Math.hypot(s.x - p.x, s.z - p.z); if (d < bd) { bd = d; best = s; } }
      const h = p.human;
      h.x = best.x; h.z = best.z; h.vx = h.vz = 0; h.state = 'idle'; h.tiltX = 0; h.visible = true; h.health = 100;
      h.onGround = true;
      p.health = 100; p.dead = false; p.drown = 0; p.invuln = 3;
      this.addMoney(-Math.min(p.money, fine));
      this.police.clear();
      for (const v of this.vehicles.slice()) if (!v.persistent && Math.hypot(v.x - h.x, v.z - h.z) < 12) this.removeVehicle(v);
      this.camRig.snap(h.x, h.y + 1.5, h.z, this.camRig.yaw);
      // stream the new neighbourhood while the screen is still black
      this.chunks.update(h.x, h.z, this.quality.view, 250);
      this.parked.fill(h.x, h.z);
      $('fade').classList.remove('red', 'blue', 'black');
      this.hud.flashMessage(`${label}  -$${fine}`);
    }, 700);
  }

  onEnterVehicle(v) {
    document.body.classList.add('in-car');
    $('btn-taxi').style.display = v.type === 'taxi' ? '' : 'none';
    if (STATIONS[this.audio.station].tag !== 'off') setTimeout(() => this.hud.radio(STATIONS[this.audio.station].name), 900);
    if (v.type === 'taxi' && !this.missions.active && !this._taxiHint) {
      this._taxiHint = true;
      this.hud.help('This is a taxi. Press <b>TAXI</b> (or <b>T</b>) to start picking up fares.', 6000);
    }
  }

  onExitVehicle() { document.body.classList.remove('in-car'); }

  humans() {
    const list = [this.player.human, ...this.peds.list];
    for (const c of this.police.cops) list.push(c.h);
    return list;
  }

  // ------------------------------------------------------------------ simulation
  collideVehicles(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z;
    const R = (a.def.len + b.def.len) / 2;
    if (dx * dx + dz * dz > R * R) return;
    const fa = { x: Math.sin(a.heading), z: Math.cos(a.heading) }, fb = { x: Math.sin(b.heading), z: Math.cos(b.heading) };
    let best = null;
    for (const oa of a.circleOffsets) {
      const ax = a.x + fa.x * oa, az = a.z + fa.z * oa;
      for (const ob of b.circleOffsets) {
        const bx = b.x + fb.x * ob, bz = b.z + fb.z * ob;
        const ddx = bx - ax, ddz = bz - az;
        const d = Math.hypot(ddx, ddz);
        const rr = a.circleR + b.circleR;
        if (d < rr && (!best || rr - d > best.pen)) best = { pen: rr - d, nx: d > 1e-4 ? ddx / d : 1, nz: d > 1e-4 ? ddz / d : 0, ax, az, bx, bz };
      }
    }
    if (!best) return;
    const { pen, nx, nz } = best;
    const ma = a.wrecked ? a.mass * 2 : a.mass, mb = b.wrecked ? b.mass * 2 : b.mass;
    const wa = mb / (ma + mb), wb = ma / (ma + mb);
    a.x -= nx * pen * wa; a.z -= nz * pen * wa;
    b.x += nx * pen * wb; b.z += nz * pen * wb;
    const vrel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
    if (vrel < 0) {
      const e = 0.3;
      const j = (-(1 + e) * vrel) / (1 / ma + 1 / mb);
      a.vx -= (j / ma) * nx; a.vz -= (j / ma) * nz;
      b.vx += (j / mb) * nx; b.vz += (j / mb) * nz;
      const ra = (best.ax - a.x) * nz - (best.az - a.z) * nx;
      const rb = (best.bx - b.x) * nz - (best.bz - b.z) * nx;
      a.yawRate -= (ra * j) / a.inertia * 0.5;
      b.yawRate += (rb * j) / b.inertia * 0.5;
      const sp = -vrel;
      // car-on-car crashes spread the energy over two crumple zones
      a.impact(sp * 0.82, this); b.impact(sp * 0.82, this);
      const pv = this.player.vehicle;
      if ((a === pv || b === pv) && sp > 3) {
        const other = a === pv ? b : a;
        // only the aggressor commits a crime: being rammed by the cops isn't one
        const aggressor = pv.speed > 6 && pv.speed > other.speed + 1;
        if (aggressor) other.lastHitByPlayer = true;
        if (other.type === 'police' && aggressor) this.police.crime('hitPoliceCar', other.x, other.z);
        if (other.driver instanceof AIDriver && other.driver.mode === 'cruise' && Math.random() < 0.3) other.driver.honk = 1;
      }
    }
  }

  collideHumans() {
    const humans = this.humans();
    const p = this.player;
    for (const v of this.vehicles) {
      const sp = v.speed;
      if (sp < 0.6) continue;
      const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
      const lx = Math.cos(v.heading), lz = -Math.sin(v.heading);
      const hl = v.def.len / 2 + 0.3, hw = v.def.wid / 2 + 0.3;
      for (const h of humans) {
        if (!h.visible || h.state === 'flying') continue;
        const dx = h.x - v.x, dz = h.z - v.z;
        if (dx * dx + dz * dz > (hl + 1) * (hl + 1)) continue;
        const df = dx * fx + dz * fz, dl = dx * lx + dz * lz;
        if (Math.abs(df) > hl || Math.abs(dl) > hw) continue;
        if (h === p.human && p.invuln > 0) continue;
        if (sp > 4.5 && h.state !== 'dead' && h.state !== 'down') {
          h.knock(v.vx * 0.9 + lx * Math.sign(dl) * 2, v.vz * 0.9 + lz * Math.sign(dl) * 2, 3 + sp * 0.18, sp * 6);
          this.audio.sfx('punch');
          this.peds.panic(h.x, h.z, 20);
          v.vx *= 0.97; v.vz *= 0.97;
          if (h === p.human) p.hurt(sp * 2.4);
          if (v === p.vehicle) this.police.crime(h.kind === 'cop' ? 'hitCop' : h.health <= 0 ? 'killPed' : 'hitPed', h.x, h.z);
        } else if (h.state !== 'dead' && h.state !== 'down') {
          // nudge aside
          const push = hw - Math.abs(dl);
          h.x += lx * Math.sign(dl || 1) * push; h.z += lz * Math.sign(dl || 1) * push;
        }
      }
    }
  }

  update(dt) {
    this.time += dt;
    const p = this.player;
    const input = this.input;
    input.poll();
    if (input.pressed('pause')) { input.endFrame(); this.togglePause(); return; }
    if (input.pressed('map')) { input.endFrame(); this.openMap(); return; }
    if (input.pressed('cam')) this.camRig.cycle();
    if (input.pressed('radio') && p.vehicle) this.hud.radio(this.audio.nextStation());

    p.update(dt, input, this.camRig.yaw);
    if (p.vehicle && p.vehicle.frozen) { p.vehicle.input.throttle = 0; p.vehicle.input.brake = 1; p.vehicle.input.handbrake = 1; }
    this.focus.x = p.x; this.focus.z = p.z;

    // AI
    for (const v of this.vehicles) {
      if (v.driver instanceof AIDriver) {
        v.driver.update(dt, this);
        if (v.driver.honk) { v.driver.honk = 0; this.audio.honk(Math.hypot(v.x - p.x, v.z - p.z)); }
      } else if (v.driver !== 'player') {
        v.input.throttle = 0; v.input.steer = 0; v.input.brake = 0.4; v.input.handbrake = v.speed < 1 ? 1 : 0;
      }
    }
    // physics substeps
    const steps = Math.min(6, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    const near = [];
    for (const v of this.vehicles) near.push((v.x - p.x) ** 2 + (v.z - p.z) ** 2 < 300 * 300);
    for (let s = 0; s < steps; s++) {
      for (let i = 0; i < this.vehicles.length; i++) this.vehicles[i].step(h, near[i] ? this : null);
      for (let i = 0; i < this.vehicles.length; i++) {
        if (!near[i]) continue;
        for (let j = i + 1; j < this.vehicles.length; j++) if (near[j]) this.collideVehicles(this.vehicles[i], this.vehicles[j]);
      }
    }
    for (const v of this.vehicles) {
      v.post(dt, this);
      const b = this.map.bounds;
      if (v.x < b.x0 + 3 || v.x > b.x1 - 3) { v.x = clamp(v.x, b.x0 + 3, b.x1 - 3); v.vx *= -0.3; }
      if (v.z < b.z0 + 3 || v.z > b.z1 - 3) { v.z = clamp(v.z, b.z0 + 3, b.z1 - 3); v.vz *= -0.3; }
      if (v.sinking > 0 && !v._splashed) { v._splashed = true; this.fx.splash(v.x, 0, v.z); if (Math.hypot(v.x - p.x, v.z - p.z) < 60) this.audio.sfx('splash'); }
      if (v.sinking === 0) v._splashed = false;
    }
    this.collideHumans();

    this.traffic.update(dt);
    this.parked.update(dt);
    this.peds.update(dt);
    this.police.update(dt);
    this.missions.update(dt);
    this.fx.update(dt, this);

    // world streaming & time of day
    this.chunks.update(this.focus.x, this.focus.z, this.quality.view, 3);
    const hour = (START_HOUR + this.time / SECONDS_PER_HOUR) % 24;
    this.hour = hour;
    this.sky.update(hour, this.camera.position, this.time);
    this.mats.setNight(this.sky.night, this.sky.daylight);
    this.mats.waterNormal.offset.set(this.time * 0.012, this.time * 0.008);

    this.camRig.update(dt, this, input.consumeLook());
    if (this.debugCam) {
      const c = this.debugCam;
      this.camera.position.set(c.x, c.y, c.z);
      this.camera.lookAt(c.lx, c.ly, c.lz);
    }
    this.camFwd.copy(this.camRig.forward);

    // HUD
    this.hud.setClock(hour);
    this.hud.setHealth(p.health, p.armor);
    this.hud.tick(dt);
    this.hud.speedo(p.vehicle ? Math.abs(p.vehicle.forwardSpeed) * 3.6 : null);
    this.districtTimer -= dt;
    if (this.districtTimer <= 0) { this.districtTimer = 0.5; this.updateLocation(); }
    this.updateRoute(dt);
    this.audio.update(dt, this);
    input.endFrame();
  }

  updateLocation() {
    const p = this.player;
    let found = null;
    for (const d of this.map.districts) {
      if (p.x < d.x0 || p.x > d.x1 || p.z < d.z0 || p.z > d.z1) continue;
      if (pointInPoly(d.pts, p.x, p.z)) { found = d; break; }
    }
    if (found && found !== this.district) {
      this.district = found;
      if (this.time > 2) this.hud.area(found.name, found.my);
    }
    // street name: nearest named road piece
    const cell = this.chunks.cellAt(p.x, p.z);
    let best = null, bd = 16 * 16;
    if (cell) {
      for (const [e] of cell.r) {
        if (!e.name || e.cls > 5) continue;
        const pts = e.pts;
        for (let i = 0; i + 3 < pts.length; i += 2) {
          const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
          const ex = bx - ax, ez = bz - az;
          const L2 = ex * ex + ez * ez || 1;
          const t = clamp(((p.x - ax) * ex + (p.z - az) * ez) / L2, 0, 1);
          const d2 = (ax + ex * t - p.x) ** 2 + (az + ez * t - p.z) ** 2;
          if (d2 < bd) { bd = d2; best = e.name; }
        }
      }
    }
    this.hud.street(best);
  }

  updateRoute(dt) {
    const target = this.gps || this.waypoint;
    if (!target) { this.route = null; return; }
    const p = this.player;
    if (this.waypoint && !this.gps && Math.hypot(this.waypoint.x - p.x, this.waypoint.z - p.z) < 25) {
      this.waypoint = null; this.route = null; this.hud.flashMessage('You have arrived'); return;
    }
    this.routeTimer -= dt;
    if (this.routeTimer > 0) return;
    this.routeTimer = 1.2;
    const a = this.graph.nearestNode(p.x, p.z, 400), b = this.graph.nearestNode(target.x, target.z, 400);
    const path = this.graph.route(a, b, { maxNodes: 30000 });
    if (path) this.route = [p.x, p.z, ...this.graph.routePolyline(path), target.x, target.z];
  }

  blips() {
    const out = this.missions.blips();
    for (const v of this.vehicles) if (v.type === 'police' && v.siren) out.push({ x: v.x, z: v.z, kind: 'police' });
    if (this.waypoint) out.push({ x: this.waypoint.x, z: this.waypoint.z, kind: 'waypoint', edge: true });
    return out;
  }

  // ------------------------------------------------------------------ render
  render() {
    const vr = this.vrender, hr = this.hrender;
    vr.begin(this.time, this.sky.night, this.sky.daylight);
    for (const v of this.vehicles) vr.add(v, this.camera.position);
    vr.end();
    hr.begin();
    for (const h of this.humans()) hr.add(h);
    hr.end();
    this.renderer.render(this.scene, this.camera);
  }

  safeRender() {
    try {
      this.render();
    } catch (e) {
      if (!this._renderErr) { this._renderErr = true; console.error(e); this.showError(`Drawing failed: ${e.message}`); }
    }
  }

  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    const now = t / 1000;
    const dt = Math.min(0.05, Math.max(0.001, now - (this.last || now)));
    this.last = now;
    if (!this.paused) {
      // resize (if needed) before drawing: resizing clears the canvas
      this.adaptResolution(dt);
      const a = performance.now();
      this.update(dt);
      const b = performance.now();
      this.safeRender();
      if (this.guard) this.guard.afterRender(dt);
      this.perf = { update: b - a, render: performance.now() - b };
      const yaw = this.camRig.yaw;
      this.radar.draw(this, yaw, this.blips(), this.route);
    } else if (this.mapOpen) {
      this.bigMap.draw(this, this.blips(), this.route);
      if (this.input.pressed('map') || this.input.pressed('pause')) this.closeMap();
      this.input.endFrame();
    } else if (!this.started) {
      // idle orbit behind the loading screen
      this.time += dt;
      this.sky.update(START_HOUR, this.camera.position, this.time);
      this.mats.setNight(this.sky.night, this.sky.daylight);
      const L = this.map.landmarks.sule;
      const a = this.time * 0.05;
      this.camera.position.set(L.x + Math.sin(a) * 160, 70, L.z + Math.cos(a) * 160);
      this.camera.lookAt(L.x, 20, L.z);
      this.safeRender();
    } else {
      if (this.input.pressed('pause')) this.togglePause(false);
      this.input.endFrame();
    }
  }

  adaptResolution(dt) {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 45) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const fps = Math.round(1 / avg);
    if (this.settings.fps && this.perf) this.hud.fps(`${fps} FPS · cpu ${this.perf.update.toFixed(1)}ms · draw ${this.renderer.info.render.calls}`);
    // Some phones cap at 30 fps in power-saving mode: aim relative to the best rate seen.
    this.bestFps = Math.max(Math.min(60, fps), (this.bestFps || 30) * 0.995);
    const target = Math.min(60, this.bestFps);
    const cap = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio);
    let pr = this.pixelRatio;
    if (fps < target * 0.78) pr = Math.max(0.6, pr - 0.15);
    else if (fps > target * 0.95) pr = Math.min(cap, pr + 0.05);
    if (Math.abs(pr - this.pixelRatio) > 0.01) {
      this.pixelRatio = pr;
      this.renderer.setPixelRatio(pr);
    }
  }
}

const game = new Game();
window.__game = game;
game.init().catch((e) => {
  console.error(e);
  $('load-text').textContent = 'Failed to start: ' + e.message;
});
window.addEventListener('error', (e) => game.showError(`Error: ${e.message}`));
window.addEventListener('unhandledrejection', (e) => game.showError(`Error: ${e.reason && e.reason.message ? e.reason.message : e.reason}`));

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
