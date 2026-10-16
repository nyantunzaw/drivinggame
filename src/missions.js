// Story missions, taxi fares, hidden Golden Hintha statuettes, paint shops, pickups.
import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { Vehicle } from './vehicles/vehicle.js';
import { AIDriver } from './ai/driver.js';
import { edgePoint } from './ai/roadgraph.js';
import { mulberry32, storageGet, storageSet, pick } from './util.js';

const P = { x: 0, z: 0, tx: 0, tz: 0 };

// ------------------------------------------------------------------ markers
function gradientTexture(r, g, b) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const x = c.getContext('2d');
  const grd = x.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, `rgba(${r},${g},${b},0)`);
  grd.addColorStop(0.7, `rgba(${r},${g},${b},0.35)`);
  grd.addColorStop(1, `rgba(${r},${g},${b},0.85)`);
  x.fillStyle = grd; x.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Markers {
  constructor(scene) {
    this.scene = scene;
    this.cyl = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    this.cyl.translate(0, 0.5, 0);
    this.cone = new THREE.ConeGeometry(0.5, 0.9, 4);
    this.cone.rotateX(Math.PI);
    const mk = (r, g, b) => new THREE.MeshBasicMaterial({ map: gradientTexture(r, g, b), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    this.mats = {
      mission: mk(255, 62, 165), target: mk(255, 214, 60), spray: mk(56, 232, 255), save: mk(125, 255, 138), race: mk(255, 214, 60),
    };
    this.arrowMats = {
      mission: new THREE.MeshBasicMaterial({ color: 0xff3ea5 }), target: new THREE.MeshBasicMaterial({ color: 0xffd63c }),
      spray: new THREE.MeshBasicMaterial({ color: 0x38e8ff }), save: new THREE.MeshBasicMaterial({ color: 0x7dff8a }), race: new THREE.MeshBasicMaterial({ color: 0xffd63c }),
    };
    // pickups
    const hintha = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc94a, metalness: 0.8, roughness: 0.25, emissive: 0x6a3a00, emissiveIntensity: 0.6 });
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), gold); body.scale.set(1, 0.8, 1.3);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.55, 6), gold); neck.position.set(0, 0.35, 0.3); neck.rotation.x = -0.4;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), gold); head.position.set(0, 0.62, 0.42);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 5), gold); tail.position.set(0, 0.25, -0.45); tail.rotation.x = -2.2;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.18, 8), gold); base.position.y = -0.36;
    hintha.add(body, neck, head, tail, base);
    this.hinthaProto = hintha;
    const heart = new THREE.Group();
    const red = new THREE.MeshLambertMaterial({ color: 0xff2d55, emissive: 0x801020 });
    const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.26, 0.26), red);
    const h2 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.8, 0.26), red);
    heart.add(h1, h2);
    this.healthProto = heart;
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.25), new THREE.MeshLambertMaterial({ color: 0x3a6bd8, emissive: 0x10204a }));
    this.armorProto = vest;
  }

  create(kind, x, z, radius = 1.6, height = 2.4) {
    const g = new THREE.Group();
    const y = heightAt(x, z);
    g.position.set(x, y, z);
    if (kind === 'hintha' || kind === 'health' || kind === 'armor') {
      const m = (kind === 'hintha' ? this.hinthaProto : kind === 'health' ? this.healthProto : this.armorProto).clone();
      m.position.y = 1.1;
      g.add(m);
      g.userData.spin = m;
    } else {
      const c = new THREE.Mesh(this.cyl, this.mats[kind]);
      c.scale.set(radius, height, radius);
      c.renderOrder = 6;
      const a = new THREE.Mesh(this.cone, this.arrowMats[kind]);
      a.position.y = height + 1.4;
      g.add(c, a);
      g.userData.spin = a;
    }
    g.userData.kind = kind;
    g.userData.x = x; g.userData.z = z; g.userData.r = radius;
    this.scene.add(g);
    return g;
  }

  remove(m) { if (m) this.scene.remove(m); }

  animate(list, t) {
    for (const m of list) {
      if (!m || !m.userData.spin) continue;
      m.userData.spin.rotation.y = t * 2;
      m.userData.spin.position.y = (m.userData.kind === 'hintha' || m.userData.kind === 'health' || m.userData.kind === 'armor' ? 1.1 : m.children[0].scale.y + 1.4) + Math.sin(t * 3) * 0.2;
    }
  }
}

// ------------------------------------------------------------------ missions
export class Missions {
  constructor(game) {
    this.game = game;
    this.markers = new Markers(game.scene);
    this.save = storageGet('yv-save', { done: [], money: 0, hintha: [] });
    this.active = null;
    this.taxi = null;
    this.noPolice = false;
    this.giverMarkers = [];
    this.objective = null;   // {x, z} for GPS
    this.L = game.map.landmarks;
    this._setupStatic();
    this.refreshGivers();
  }

  spot(x, z) {
    const n = this.game.graph.nearestNode(x, z, 500, true);
    if (n < 0) return { x, z };
    return { x: this.game.map.nodeX[n], z: this.game.map.nodeZ[n], node: n };
  }

  // A point on the sidewalk of the nearest road to (x,z)
  curb(x, z) {
    const g = this.game;
    const n = g.graph.nearestNode(x, z, 500, true);
    if (n < 0) return { x, z };
    const o = g.graph.out[n][0] || g.graph.any[n][0];
    edgePoint(o.e, o.dir, Math.min(8, o.e.len / 2), P);
    return { x: P.x, z: P.z, heading: Math.atan2(P.tx, P.tz), tx: P.tx, tz: P.tz };
  }

  _setupStatic() {
    const g = this.game, map = g.map;
    const ll = (lat, lon) => map.fromLatLon(lat, lon);
    // Paint & spray shops (at fuel stations)
    this.sprays = [ll(16.77771, 96.142), ll(16.82241, 96.16062), ll(16.7978, 96.13038), ll(16.77179, 96.17277)]
      .map((p) => { const s = this.spot(p.x, p.z); return { x: s.x, z: s.z, m: this.markers.create('spray', s.x, s.z, 3.5, 2.6), cool: 0 }; });
    // hospitals and police stations (respawn points, pickups)
    this.hospitals = [ll(16.77839, 96.15051), ll(16.77151, 96.17436), ll(16.81256, 96.15097), ll(16.82032, 96.15366)].map((p) => this.curb(p.x, p.z));
    this.policeStations = [ll(16.77617, 96.16871), ll(16.80342, 96.15536), ll(16.80259, 96.13943)].map((p) => this.curb(p.x, p.z));
    this.pickups = [];
    for (const h of this.hospitals) this.pickups.push({ kind: 'health', x: h.x, z: h.z, m: this.markers.create('health', h.x, h.z), t: 0 });
    for (const h of this.policeStations.slice(0, 2)) this.pickups.push({ kind: 'armor', x: h.x, z: h.z, m: this.markers.create('armor', h.x, h.z), t: 0 });
    // Golden Hintha collectibles: deterministic spots spread over the city
    const rnd = mulberry32(1986);
    const chosen = [];
    let tries = 0;
    while (chosen.length < 20 && tries++ < 5000) {
      const n = Math.floor(rnd() * map.nodeX.length);
      const x = map.nodeX[n], z = map.nodeZ[n];
      if (!g.graph.any[n].length || g.collision.isWater(x, z)) continue;
      const b = map.bounds;
      if (x < b.x0 + 300 || x > b.x1 - 300 || z < b.z0 + 300 || z > b.z1 - 600) continue;
      if (chosen.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < 550 * 550)) continue;
      chosen.push({ x, z });
    }
    this.hinthas = chosen.map((c, i) => ({ ...c, i, m: this.save.hintha.includes(i) ? null : this.markers.create('hintha', c.x, c.z) }));
    // safehouse
    const st = this.curb(this.L.strand.x, this.L.strand.z);
    this.safehouse = st;
  }

  defs() {
    const L = this.L;
    return [
      { id: 'welcome', title: 'Welcome to Yangon', at: L.strand, reward: 1000, requires: [] },
      { id: 'mohinga', title: 'Mohinga Express', at: L.chinatown, reward: 1500, requires: ['welcome'] },
      { id: 'bell', title: 'The Golden Bell', at: L.botataung, reward: 2500, requires: ['welcome'] },
      { id: 'race', title: 'Thingyan Street Race', at: L.karaweik, reward: 3000, requires: ['welcome'] },
      { id: 'heat', title: 'Heat Wave', at: L.hledan, reward: 2000, requires: ['welcome'] },
    ];
  }

  refreshGivers() {
    for (const gm of this.giverMarkers) this.markers.remove(gm.m);
    this.giverMarkers = [];
    if (this.active) return;
    for (const d of this.defs()) {
      if (this.save.done.includes(d.id)) continue;
      if (!d.requires.every((r) => this.save.done.includes(r))) continue;
      const s = this.curb(d.at.x, d.at.z);
      this.giverMarkers.push({ def: d, x: s.x, z: s.z, m: this.markers.create('mission', s.x, s.z, 1.5, 2.6) });
    }
  }

  persist() {
    this.save.money = this.game.player.money;
    storageSet('yv-save', this.save);
  }

  blips() {
    const out = [];
    for (const gm of this.giverMarkers) out.push({ x: gm.x, z: gm.z, kind: 'mission', edge: true });
    for (const s of this.sprays) out.push({ x: s.x, z: s.z, kind: 'spray' });
    for (const p of this.pickups) if (p.kind === 'health') out.push({ x: p.x, z: p.z, kind: 'health' });
    out.push({ x: this.safehouse.x, z: this.safehouse.z, kind: 'save' });
    if (this.objective) out.push({ x: this.objective.x, z: this.objective.z, kind: this.objective.kind || 'target', edge: true });
    if (this.active && this.active.blips) out.push(...this.active.blips());
    if (this.taxi && this.taxi.target) out.push({ x: this.taxi.target.x, z: this.taxi.target.z, kind: 'target', edge: true });
    return out;
  }

  // ------------------------------------------------------------ runtime
  update(dt) {
    const g = this.game, p = g.player;
    const px = p.x, pz = p.z;
    this.markers.animate([...this.giverMarkers.map((m) => m.m), ...this.sprays.map((s) => s.m), ...this.hinthas.map((h) => h.m),
      ...this.pickups.map((q) => q.m), ...(this.active ? this.active.markers : []), this.taxi && this.taxi.marker], g.time);

    // start missions
    if (!this.active && !p.dead) {
      for (const gm of this.giverMarkers) {
        if ((gm.x - px) ** 2 + (gm.z - pz) ** 2 < (p.vehicle ? 16 : 5)) { this.start(gm.def); break; }
      }
    }
    // collectibles
    for (const h of this.hinthas) {
      if (h.m && (h.x - px) ** 2 + (h.z - pz) ** 2 < 6) {
        this.markers.remove(h.m); h.m = null;
        this.save.hintha.push(h.i);
        const n = this.save.hintha.length;
        g.addMoney(100);
        g.audio.sfx('pickup');
        g.hud.big('GOLDEN HINTHA', `${n} of 20 found  +$100`, '#ffd36a', 3000);
        if (n === 20) { g.addMoney(10000); g.hud.message('All 20 Golden Hinthas found! <b>$10,000</b> bonus!', 6000); }
        this.persist();
      }
    }
    // pickups
    for (const q of this.pickups) {
      q.t = Math.max(0, q.t - dt);
      q.m.visible = q.t === 0;
      if (q.t === 0 && !p.vehicle && (q.x - px) ** 2 + (q.z - pz) ** 2 < 4) {
        if (q.kind === 'health' && p.health < 100) { p.health = 100; q.t = 60; g.audio.sfx('pickup'); g.hud.flashMessage('Health restored'); }
        if (q.kind === 'armor' && p.armor < 100) { p.armor = 100; q.t = 90; g.audio.sfx('pickup'); g.hud.flashMessage('Body armour'); }
      }
    }
    // paint shops
    for (const s of this.sprays) {
      s.cool = Math.max(0, s.cool - dt);
      if (p.vehicle && s.cool === 0 && (s.x - px) ** 2 + (s.z - pz) ** 2 < 16 && p.vehicle.speed < 6) {
        s.cool = 12;
        if (p.money < 100) { g.hud.flashMessage('Shwe Spray: $100 needed'); continue; }
        g.addMoney(-100);
        const v = p.vehicle;
        v.paint.set(pick(v.def.colors.length > 1 ? v.def.colors : ['#ff3ea5', '#38e8ff', '#ffd400', '#7dff8a']));
        v.health = 1000; v.fire = 0;
        const hadStars = g.police.stars > 0;
        g.police.clear();
        g.audio.sfx('cash');
        g.hud.big('SHWE SPRAY', hadStars ? 'New paint job — the cops lost track of you!' : 'Fresh paint & repairs  -$100', '#38e8ff', 3000);
      }
    }
    // taxi side-mission
    if (this.taxi) this.updateTaxi(dt);
    else if (g.input.pressed('taxi') && p.vehicle && p.vehicle.type === 'taxi' && !this.active) this.startTaxi();

    if (this.active) {
      const m = this.active;
      if (m.timeLeft != null) {
        m.timeLeft -= dt;
        g.hud.timer(m.timeLeft);
        if (m.timeLeft <= 0) { this.fail(m.timeoutText || 'Out of time!'); return; }
      }
      const r = m.step(dt);
      if (r === 'pass') this.pass();
      else if (typeof r === 'string' && r.startsWith('fail')) this.fail(r.slice(5));
    }
  }

  start(def) {
    const g = this.game;
    this.active = this.build(def);
    this.refreshGivers();
    g.hud.big(def.title.toUpperCase(), '', '#ff3ea5', 3000);
    g.audio.sfx('checkpoint');
  }

  end() {
    const m = this.active;
    if (!m) return;
    for (const mk of m.markers) this.markers.remove(mk);
    if (m.cleanup) m.cleanup();
    for (const v of m.vehicles || []) { v.persistent = false; if (v.driver instanceof AIDriver && v.driver.fixed) v.driver.fixed = false; }
    this.active = null;
    this.objective = null;
    this.noPolice = false;
    this.game.hud.timer(null);
    this.game.hud.counter(null);
    this.game.setGPS(null);
    this.refreshGivers();
  }

  pass() {
    const g = this.game, m = this.active;
    const def = m.def;
    if (!this.save.done.includes(def.id)) this.save.done.push(def.id);
    g.addMoney(def.reward);
    g.audio.sfx('pass');
    g.hud.big('MISSION PASSED!', `$${def.reward.toLocaleString()}`, '#ffd36a', 4500);
    this.end();
    this.persist();
    if (this.save.done.length === this.defs().length) {
      setTimeout(() => g.hud.message('<b>Uncle Ba Tin:</b> You did it, kid. Yangon is yours now. Enjoy the ride!', 7000), 4800);
    }
  }

  fail(reason) {
    const g = this.game;
    g.audio.sfx('fail');
    g.hud.big('MISSION FAILED!', reason || '', '#ff4b4b', 4000);
    this.end();
  }

  abort() { if (this.active) this.fail(''); if (this.taxi) this.endTaxi(''); }

  // Utility for mission scripts: sequence of steps
  build(def) {
    const g = this.game, L = this.L, self = this;
    const m = { def, markers: [], vehicles: [], timeLeft: null, idx: 0, t: 0 };
    const dialog = (lines) => {
      let i = 0, t = 0;
      return () => {
        if (t <= 0) {
          if (i >= lines.length) return true;
          g.hud.message(lines[i++], 4200); t = 4.2;
        }
        t -= m.dt;
        return i >= lines.length && t < 1.2;
      };
    };
    const destination = (to, { text, radius = 5, vehicle = true, stop = true, timeFactor = 0, kind = 'target', mustVehicle = null, damageFail = 0 }) => {
      let mk = null;
      return () => {
        if (!mk) {
          mk = self.markers.create('target', to.x, to.z, radius * 0.8, 2.6);
          m.markers.push(mk);
          self.objective = { x: to.x, z: to.z, kind };
          g.setGPS(to);
          g.hud.message(text, 5000);
          if (timeFactor) {
            const len = g.routeLength(g.player.x, g.player.z, to.x, to.z);
            m.timeLeft = Math.round(len / timeFactor + 25);
          }
        }
        const p = g.player;
        if (mustVehicle && p.vehicle !== mustVehicle) {
          if (mustVehicle.wrecked) return 'fail:The vehicle was destroyed!';
          if (!m._warn) { g.hud.message('Get back in the <b>vehicle</b>!', 3000); m._warn = true; }
          return false;
        }
        m._warn = false;
        if (damageFail && mustVehicle && mustVehicle.health < damageFail) return 'fail:' + (m.damageText || 'Too much damage!');
        if (vehicle && !p.vehicle) return false;
        const d2 = (p.x - to.x) ** 2 + (p.z - to.z) ** 2;
        if (d2 < radius * radius && (!stop || !p.vehicle || p.vehicle.speed < 4)) {
          self.markers.remove(mk); m.markers.splice(m.markers.indexOf(mk), 1);
          self.objective = null; g.setGPS(null); m.timeLeft = null; g.hud.timer(null);
          g.audio.sfx('checkpoint');
          return true;
        }
        return false;
      };
    };
    const enterVehicle = (text, ref) => () => {
      const p = g.player;
      const v = typeof ref === 'function' ? ref() : null;
      if (v && v.wrecked) return 'fail:The vehicle was destroyed!';
      if (p.vehicle && (!v || p.vehicle === v)) return true;
      if (!m._entered) { g.hud.message(text, 5000); m._entered = true; if (v) self.objective = { x: v.x, z: v.z, kind: 'target' }; }
      if (v) self.objective = { x: v.x, z: v.z, kind: 'target' };
      return false;
    };
    const action = (fn) => () => { fn(); return true; };
    const spawnCar = (type, near, color, offset = 10) => {
      const c = self.curb(near.x + offset, near.z + offset * 0.5);
      const v = new Vehicle(type, c.x - c.tz * 3, c.z + c.tx * 3, c.heading, color);
      v.persistent = true;
      g.addVehicle(v);
      m.vehicles.push(v);
      return v;
    };

    let steps = [];
    if (def.id === 'welcome') {
      const bog = this.curb(L.bogyoke.x, L.bogyoke.z + 60);
      const shw = this.curb(L.shwedagon.x + 10, L.shwedagon.z + 330);
      steps = [
        dialog(['<b>Uncle Ba Tin:</b> Mingalaba, nephew! Welcome back to Yangon.', 'My cousin <b>Ko Zaw</b> is waiting at <b>Bogyoke Aung San Market</b>. Any car will do — just grab one.']),
        enterVehicle('Get in a <b>car</b>. Walk up to one and press <b>CAR</b> / <b>F</b>.'),
        destination(bog, { text: 'Pick up <b>Ko Zaw</b> at <b>Bogyoke Aung San Market</b>.', radius: 7 }),
        dialog(['<b>Ko Zaw:</b> Took you long enough! Get me to <b>Shwedagon Pagoda</b> — evening prayers start soon!']),
        destination(shw, { text: 'Drive Ko Zaw to <b>Shwedagon Pagoda</b>.', radius: 8, timeFactor: 11 }),
        dialog(['<b>Ko Zaw:</b> Just in time. The pagoda glows like gold at dusk... Uncle has more work for you.']),
      ];
    } else if (def.id === 'mohinga') {
      let van = null;
      const plaza = this.curb(L.myanmarplaza.x, L.myanmarplaza.z);
      m.damageText = 'The soup spilled everywhere!';
      steps = [
        dialog(['<b>Daw Khin:</b> My mohinga is the best in Yangon! Myanmar Plaza ordered forty bowls.', 'Take my pickup and get it there hot. And don\'t you dare spill the soup!']),
        action(() => { van = spawnCar('pickup', g.player, '#e0b33a', 8); }),
        enterVehicle('Get in the <b>Lain-Ka Pickup</b>.', () => van),
        () => destination(plaza, { text: 'Deliver the mohinga to <b>Myanmar Plaza</b> before it gets cold!', radius: 8, timeFactor: 15, mustVehicle: van, damageFail: 450 }),
      ];
      // late-bound step (needs van)
      const lazy = steps[3];
      let inner = null;
      steps[3] = () => { if (!inner) inner = lazy(); return inner(); };
    } else if (def.id === 'bell') {
      let thief = null, ride = null, wreckAt = null;
      const pagoda = this.curb(L.botataung.x, L.botataung.z);
      steps = [
        dialog(['<b>U Pyinnya:</b> A thief has stolen the golden donation bell from Botataung!', 'He fled in a white <b>Mark II</b>. Stop him, my child!']),
        action(() => {
          if (!g.player.vehicle) ride = spawnCar('taxi', g.player, null, 6);
          const spot = g.traffic.findSpot(g.player.x, g.player.z, 70, 130, 3, false);
          if (spot) {
            const { v, d } = g.traffic.spawn('sedan', spot, 'flee');
            v.paint.set('#f4f4f4');
            v.persistent = true;
            d.speedFactor = 1.05;
            thief = v; m.vehicles.push(v);
          }
        }),
        () => {
          if (!thief) return 'fail:The thief got away!';
          if (!m._msg) { g.hud.message('Wreck the <b>thief\'s car</b>!', 5000); m._msg = true; m.timeLeft = 210; m.timeoutText = 'The thief got away!'; }
          self.objective = { x: thief.x, z: thief.z, kind: 'enemy' };
          const d = Math.hypot(thief.x - g.player.x, thief.z - g.player.z);
          if (d > 480) return 'fail:The thief got away!';
          if (thief.wrecked || thief.fire > 0 || thief.health < 120) {
            wreckAt = { x: thief.x, z: thief.z };
            if (thief.driver instanceof AIDriver) thief.driver = null;
            m.timeLeft = null; g.hud.timer(null);
            return true;
          }
          return false;
        },
        () => {
          if (!m._grab) m._grab = destination(wreckAt, { text: 'Grab the <b>golden bell</b> from the wreck.', radius: 6, vehicle: false, stop: false });
          return m._grab();
        },
        action(() => { g.audio.sfx('pickup'); g.hud.flashMessage('Got the golden bell!'); }),
        destination(pagoda, { text: 'Return the bell to <b>Botataung Pagoda</b>.', radius: 8, vehicle: false }),
      ];
      m.cleanup = () => { if (ride) ride.persistent = false; };
    } else if (def.id === 'race') {
      const cps = this.raceCheckpoints();
      let car = null;
      const racers = [];
      let cpIndex = 0, countdown = -1, finished = [];
      m.blips = () => racers.map((r) => ({ x: r.x, z: r.z, kind: 'enemy' }));
      steps = [
        dialog(['<b>Nilar:</b> Thingyan is coming — and so is the Kandawgyi street race!', 'Beat my crew around the lake and downtown. Winner takes <b>$3,000</b>.']),
        action(() => {
          if (g.player.vehicle) g.player.exit();
          car = spawnCar('sports', cps.start, '#ff3ea5', 0);
          for (let i = 0; i < 3; i++) {
            const c = self.curb(cps.start.x, cps.start.z);
            const bx = c.x - c.tx * (8 + i * 8), bz = c.z - c.tz * (8 + i * 8);
            const v = new Vehicle('sports', bx + c.tz * (i % 2 ? 2 : -2), bz - c.tx * (i % 2 ? 2 : -2), c.heading, ['#38e8ff', '#ffd400', '#ffffff'][i]);
            v.persistent = true;
            g.addVehicle(v);
            m.vehicles.push(v);
            racers.push(v);
          }
          car.x = cps.start.x; car.z = cps.start.z; car.heading = cps.start.heading;
        }),
        enterVehicle('Get in your <b>Irrawaddy GT</b>.', () => car),
        () => {
          // build racer routes and count down
          if (countdown < 0) {
            countdown = 3.99;
            for (const r of racers) {
              const path = g.raceRoute(r, cps.points);
              const d = new AIDriver(g.graph, r, path[0].e, path[0].dir, 0, { mode: 'race', fixed: true, speedFactor: 0.9 + Math.random() * 0.12 });
              d.setPath(path);
              d.hold = true;
            }
            g.player.vehicle.frozen = true;
          }
          countdown -= m.dt;
          const n = Math.ceil(countdown);
          if (n !== m._cd && n > 0) { m._cd = n; g.hud.big(String(n), '', '#ffd36a', 900); g.audio.sfx('checkpoint'); }
          if (countdown <= 0) {
            g.hud.big('GO!', '', '#7dff8a', 1200);
            for (const r of racers) if (r.driver instanceof AIDriver) r.driver.hold = false;
            if (g.player.vehicle) g.player.vehicle.frozen = false;
            return true;
          }
          return false;
        },
        () => {
          const p = g.player;
          const cp = cps.points[cpIndex];
          if (!m._cpm) {
            m._cpm = self.markers.create('race', cp.x, cp.z, 6, 3.2);
            m.markers.push(m._cpm);
            self.objective = { x: cp.x, z: cp.z, kind: 'target' };
            g.setGPS(cp);
          }
          // racer progress through the checkpoints
          for (const r of racers) {
            if (r._cp === undefined) r._cp = 0;
            const rc = cps.points[r._cp];
            if (rc && (r.x - rc.x) ** 2 + (r.z - rc.z) ** 2 < 22 * 22) r._cp++;
            if (r._cp >= cps.points.length && !finished.includes(r)) finished.push(r);
          }
          const myD = (p.x - cp.x) ** 2 + (p.z - cp.z) ** 2;
          const ahead = racers.filter((r) => r._cp > cpIndex || (r._cp === cpIndex && (r.x - cp.x) ** 2 + (r.z - cp.z) ** 2 < myD)).length;
          const pos = 1 + ahead;
          g.hud.counter(`CHECKPOINT <b>${cpIndex + 1}/${cps.points.length}</b> &nbsp; POS <b>${Math.min(4, pos)}/4</b>`);
          if (!p.vehicle && car.wrecked) return 'fail:Your car was wrecked!';
          if ((p.x - cp.x) ** 2 + (p.z - cp.z) ** 2 < 14 * 14) {
            self.markers.remove(m._cpm); m.markers.splice(m.markers.indexOf(m._cpm), 1); m._cpm = null;
            g.audio.sfx('checkpoint');
            cpIndex++;
            if (cpIndex >= cps.points.length) {
              if (finished.length > 0) return 'fail:You finished in position ' + (finished.length + 1) + '.';
              return true;
            }
          }
          return false;
        },
      ];
      m.cleanup = () => { for (const r of racers) if (r.driver instanceof AIDriver) { r.driver.fixed = false; r.driver.mode = 'cruise'; } };
    } else if (def.id === 'heat') {
      steps = [
        dialog(['<b>Ko Zaw:</b> Bad news — the cops ran the plates on the car you drove for me!', 'Lose them. Outrun them, or get a fresh paint job at a <b>Shwe Spray</b> shop ($).']),
        action(() => { if (!g.player.vehicle) spawnCar('sedan', g.player, '#8a1c1c', 6); g.police.heat = 7; g.police.setStars(3); }),
        () => {
          if (!m._msg) { g.hud.message('Lose your <b>wanted level</b>.', 5000); m._msg = true; }
          return g.police.stars === 0;
        },
        dialog(['<b>Ko Zaw:</b> Smooth! Drinks are on me at the tea shop.']),
      ];
    }
    m.step = (dt) => {
      m.dt = dt;
      if (m.idx >= steps.length) return 'pass';
      const r = steps[m.idx]();
      if (typeof r === 'string') return r;
      if (r === true) { m.idx++; m._entered = false; m._msg = false; }
      return m.idx >= steps.length ? 'pass' : null;
    };
    return m;
  }

  raceCheckpoints() {
    // one lap of the roads around Kandawgyi Lake, starting by Karaweik
    const L = this.L;
    const k = L.kandawgyi;
    const start = this.curb(L.karaweik.x + 60, L.karaweik.z + 40);
    const pts = [
      [k.x + 250, k.z - 560],
      [k.x - 450, k.z - 500],
      [k.x - 920, k.z + 40],
      [k.x - 420, k.z + 520],
      [k.x + 320, k.z + 540],
      [start.x, start.z],
    ].map(([x, z]) => { const s = this.spot(x, z); return { x: s.x, z: s.z, node: s.node }; });
    return { start, points: pts };
  }

  // ------------------------------------------------------------ taxi
  startTaxi() {
    this.taxi = { fares: 0, stage: 'find', target: null, marker: null, time: 0 };
    this.game.hud.big('TAXI DRIVER', 'Pick up fares around Yangon', '#ffd400', 2500);
    this.nextFare();
  }

  endTaxi(reason) {
    const t = this.taxi;
    if (!t) return;
    if (t.marker) this.markers.remove(t.marker);
    this.taxi = null;
    this.game.hud.timer(null);
    this.game.hud.counter(null);
    this.game.setGPS(null);
    if (reason) this.game.hud.big('TAXI MISSION ENDED', reason, '#ffd400', 3000);
  }

  nextFare() {
    const g = this.game, t = this.taxi;
    const spot = g.traffic.findSpot(g.player.x, g.player.z, 140, 420, 4, false);
    if (!spot) { t.stage = 'find'; return; }
    t.stage = 'pickup';
    t.target = { x: spot.x, z: spot.z };
    t.marker = this.markers.create('target', spot.x, spot.z, 3.2, 2.2);
    t.time = 60;
    g.setGPS(t.target);
    g.hud.message('Pick up the <b>passenger</b>.', 3500);
  }

  updateTaxi(dt) {
    const g = this.game, t = this.taxi, p = g.player;
    if (!p.vehicle || p.vehicle.type !== 'taxi') { this.endTaxi('You left the taxi.'); return; }
    if (g.input.pressed('taxi')) { this.endTaxi('Off duty.'); return; }
    g.hud.counter(`FARES <b>${t.fares}</b>`);
    if (t.stage === 'find') { this.nextFare(); return; }
    t.time -= dt;
    g.hud.timer(t.time);
    if (t.time <= 0) { this.endTaxi('The passenger got tired of waiting.'); return; }
    const d2 = (p.x - t.target.x) ** 2 + (p.z - t.target.z) ** 2;
    if (d2 < 49 && p.vehicle.speed < 3) {
      this.markers.remove(t.marker);
      if (t.stage === 'pickup') {
        const lms = Object.values(this.L).filter((l) => Math.hypot(l.x - p.x, l.z - p.z) > 500);
        const dest = pick(lms);
        const c = this.curb(dest.x, dest.z);
        t.stage = 'drop';
        t.dest = dest;
        t.target = { x: c.x, z: c.z };
        t.marker = this.markers.create('target', c.x, c.z, 3.2, 2.2);
        const len = g.routeLength(p.x, p.z, c.x, c.z);
        t.time = Math.round(len / 11 + 20);
        t.len = len;
        g.setGPS(t.target);
        g.audio.sfx('door');
        g.hud.message(`"Take me to <b>${dest.name}</b>, please."`, 4000);
      } else {
        t.fares++;
        const pay = Math.round(20 + t.len * 0.05 + t.time * 1.5);
        g.addMoney(pay);
        g.audio.sfx('cash');
        g.hud.big('FARE COMPLETE', `+$${pay}`, '#ffd400', 2200);
        if (t.fares % 5 === 0) { g.addMoney(500); g.hud.message(`${t.fares} fares in a row! <b>$500</b> bonus.`, 4000); }
        this.nextFare();
      }
    }
  }
}
