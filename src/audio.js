// All sound is synthesised with WebAudio: engine, tyres, horns, sirens, impacts and
// three procedurally generated radio stations with an 80s Vice City flavour.
import { clamp, mulberry32 } from './util.js';

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

export const STATIONS = [
  { name: 'GOLDEN LAND FM 88.8', tag: 'synthwave', bpm: 104, root: 57, scale: [0, 2, 3, 5, 7, 8, 10], prog: [0, 5, 2, 6], seed: 3 },
  { name: 'THINGYAN BEATS 96.1', tag: 'electro', bpm: 122, root: 60, scale: [0, 2, 4, 5, 7, 9, 11], prog: [0, 4, 5, 3], seed: 11 },
  { name: 'IRRAWADDY CHILL 101.5', tag: 'chill', bpm: 84, root: 62, scale: [0, 2, 4, 7, 9], prog: [0, 3, 1, 4], seed: 29 },
  { name: 'RADIO OFF', tag: 'off' },
];

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.station = 0;
    this.musicVol = 0.55;
    this.sfxVol = 0.8;
    this.inVehicle = false;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.sfxVol; this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0; this.musicBus.connect(this.master);
    // radio "speaker" colouring
    this.radioFilter = ctx.createBiquadFilter();
    this.radioFilter.type = 'lowpass'; this.radioFilter.frequency.value = 9000;
    this.radioFilter.connect(this.musicBus);
    this.noiseBuf = this._noise(2);

    // engine
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 600; this.engFilter.Q.value = 3;
    this.eng1 = ctx.createOscillator(); this.eng1.type = 'sawtooth';
    this.eng2 = ctx.createOscillator(); this.eng2.type = 'square';
    const g2 = ctx.createGain(); g2.gain.value = 0.5;
    this.eng1.connect(this.engFilter); this.eng2.connect(g2).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.sfxBus);
    this.eng1.start(); this.eng2.start();
    // tyres
    const tn = ctx.createBufferSource(); tn.buffer = this.noiseBuf; tn.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2100; bp.Q.value = 6;
    this.tyreGain = ctx.createGain(); this.tyreGain.gain.value = 0;
    tn.connect(bp).connect(this.tyreGain).connect(this.sfxBus); tn.start();
    // city ambience
    const an = ctx.createBufferSource(); an.buffer = this.noiseBuf; an.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    this.ambGain = ctx.createGain(); this.ambGain.gain.value = 0.05;
    an.connect(lp).connect(this.ambGain).connect(this.sfxBus); an.start();
    // siren
    this.sirenOsc = ctx.createOscillator(); this.sirenOsc.type = 'triangle';
    this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain).connect(this.sfxBus); this.sirenOsc.start();
    // horn
    this.hornGain = ctx.createGain(); this.hornGain.gain.value = 0;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1600;
    for (const f of [392, 494]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(hf); o.start(); }
    hf.connect(this.hornGain).connect(this.sfxBus);

    this.enabled = true;
    this.nextNote = ctx.currentTime + 0.1;
    this.step = 0;
    this.bar = 0;
    this._timer = setInterval(() => this._schedule(), 40);
  }

  _noise(sec) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  setVolumes(music, sfx) {
    this.musicVol = music; this.sfxVol = sfx;
    if (this.sfxBus) this.sfxBus.gain.value = sfx;
    this._musicLevel();
  }

  _musicLevel() {
    if (!this.musicBus) return;
    const on = this.inVehicle && STATIONS[this.station].tag !== 'off';
    this.musicBus.gain.setTargetAtTime(on ? this.musicVol * 0.5 : 0, this.ctx.currentTime, 0.25);
  }

  enterVehicle(v) {
    this.inVehicle = true;
    if (v.type === 'police') this.station = 3;
    this._musicLevel();
  }

  exitVehicle() {
    this.inVehicle = false;
    this._musicLevel();
    if (this.engGain) this.engGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    if (this.tyreGain) this.tyreGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
  }

  nextStation() {
    this.station = (this.station + 1) % STATIONS.length;
    this.bar = 0; this.step = 0;
    this._musicLevel();
    if (this.ctx) this.sfx('tune');
    return STATIONS[this.station].name;
  }

  // per-frame continuous sounds
  update(dt, game) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const v = game.player.vehicle;
    if (v) {
      const sp = Math.abs(v.forwardSpeed);
      const top = v.def.top;
      const gears = 5;
      const band = top / gears;
      const gear = Math.min(gears - 1, Math.floor(sp / band));
      const rpm = clamp((sp - gear * band) / band, 0, 1) * 0.75 + (gear > 0 ? 0.25 : 0.05) + v.input.throttle * 0.08;
      const base = v.type === 'bus' ? 28 : v.type === 'sports' ? 48 : 38;
      const f = base + rpm * base * 2.2;
      this.eng1.frequency.setTargetAtTime(f, t, 0.05);
      this.eng2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
      this.engFilter.frequency.setTargetAtTime(300 + rpm * 1400 + v.input.throttle * 600, t, 0.08);
      // pedal-powered trishaws have no engine, only the tyres on the road
      this.engGain.gain.setTargetAtTime(v.wrecked || v.def.pedal ? 0 : 0.07 + v.input.throttle * 0.07, t, 0.08);
      this.tyreGain.gain.setTargetAtTime(v.slip * 0.22 * clamp(sp / 10, 0, 1), t, 0.05);
    }
    // horn (player)
    const horn = game.input.state.horn && v;
    this.hornGain.gain.setTargetAtTime(horn ? 0.12 : 0, t, 0.02);
    // nearest siren
    let sd = Infinity;
    for (const o of game.vehicles) if (o.siren) sd = Math.min(sd, Math.hypot(o.x - game.player.x, o.z - game.player.z));
    if (sd < 260) {
      const wob = (Math.sin(t * 5.5) + 1) / 2;
      this.sirenOsc.frequency.setTargetAtTime(640 + wob * 380, t, 0.02);
      this.sirenGain.gain.setTargetAtTime(0.12 * clamp(1 - sd / 260, 0, 1), t, 0.1);
    } else this.sirenGain.gain.setTargetAtTime(0, t, 0.2);
    this.ambGain.gain.setTargetAtTime(v ? 0.02 : 0.06, t, 0.5);
  }

  // positional one-shot horn honk from AI traffic
  honk(dist) {
    if (!this.enabled || dist > 120) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09 * (1 - dist / 120), t + 0.01);
    g.gain.setValueAtTime(0.09 * (1 - dist / 120), t + 0.28);
    g.gain.linearRampToValueAtTime(0, t + 0.33);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    for (const hz of [349 + Math.random() * 80, 440 + Math.random() * 60]) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = hz;
      o.connect(f); o.start(t); o.stop(t + 0.35);
    }
    f.connect(g).connect(this.sfxBus);
  }

  sfx(name, vol = 1) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain();
    out.connect(this.sfxBus);
    const noise = (dur, type, freq, q = 1) => {
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      s.connect(f).connect(out); s.start(t, Math.random()); s.stop(t + dur);
      return f;
    };
    const tone = (type, f0, f1, dur, start = 0, gain = 1) => {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t + start);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + start + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, t + start); g.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
      o.connect(g).connect(out); o.start(t + start); o.stop(t + start + dur + 0.02);
    };
    switch (name) {
      case 'crash': {
        out.gain.setValueAtTime(0.5 * vol, t); out.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        noise(0.5, 'lowpass', 900); tone('square', 120, 40, 0.25, 0, 0.4);
        break;
      }
      case 'punch':
        out.gain.value = 0.5; tone('sine', 140, 50, 0.15, 0, 1); noise(0.06, 'lowpass', 1200); break;
      case 'whoosh': {
        out.gain.setValueAtTime(0.15, t); out.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
        const f = noise(0.2, 'bandpass', 800, 2); f.frequency.exponentialRampToValueAtTime(3000, t + 0.18); break;
      }
      case 'door':
        out.gain.value = 0.35; tone('square', 180, 60, 0.08, 0, 0.6); noise(0.05, 'lowpass', 2000); break;
      case 'explosion': {
        out.gain.setValueAtTime(0.9 * vol, t); out.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
        noise(1.6, 'lowpass', 500); tone('sine', 90, 25, 1.2, 0, 1); break;
      }
      case 'checkpoint':
        out.gain.value = 0.25; tone('square', 880, 880, 0.08); tone('square', 1320, 1320, 0.12, 0.08); break;
      case 'cash':
        out.gain.value = 0.25; [988, 1319, 1568, 1976].forEach((f, i) => tone('triangle', f, f, 0.18, i * 0.06)); break;
      case 'pickup':
        out.gain.value = 0.3; [1047, 1319, 1568, 2093].forEach((f, i) => tone('sine', f, f, 0.25, i * 0.07)); break;
      case 'pass':
        out.gain.value = 0.3; [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone('square', f, f, 0.22, i * 0.12, 0.5)); break;
      case 'fail':
        out.gain.value = 0.3; [392, 370, 349, 262].forEach((f, i) => tone('square', f, f, 0.3, i * 0.22, 0.5)); break;
      case 'wasted':
        out.gain.value = 0.35; tone('sawtooth', 300, 60, 1.6, 0, 0.6); break;
      case 'tune': {
        out.gain.setValueAtTime(0.08, t); out.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        noise(0.35, 'bandpass', 1800, 1); break;
      }
      case 'splash': {
        out.gain.setValueAtTime(0.5, t); out.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
        noise(0.9, 'lowpass', 1500); break;
      }
      default: break;
    }
  }

  // ---------------------------------------------------------------- radio
  _schedule() {
    if (!this.enabled || !this.inVehicle) { if (this.ctx) this.nextNote = this.ctx.currentTime + 0.05; return; }
    const st = STATIONS[this.station];
    if (st.tag === 'off') { this.nextNote = this.ctx.currentTime + 0.05; return; }
    const spb = 60 / st.bpm / 4; // 16th notes
    while (this.nextNote < this.ctx.currentTime + 0.15) {
      this._playStep(st, this.step, this.nextNote, spb);
      this.nextNote += spb;
      this.step++;
      if (this.step % 16 === 0) this.bar++;
    }
  }

  _playStep(st, step, t, spb) {
    const ctx = this.ctx;
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const chordDeg = st.prog[bar % st.prog.length];
    const sc = st.scale;
    const deg = (d) => st.root + sc[((d % sc.length) + sc.length) % sc.length] + 12 * Math.floor(d / sc.length);
    const out = this.radioFilter;
    const env = (node, a, d, peak) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
      node.connect(g).connect(out);
      return g;
    };
    const osc = (type, f, a, d, peak, filt) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      let n = o;
      if (filt) { const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = filt; o.connect(fl); n = fl; }
      env(n, a, d, peak);
      o.start(t); o.stop(t + a + d + 0.05);
    };
    const drum = (kind) => {
      if (kind === 'kick') {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        env(o, 0.002, 0.22, 0.9); o.start(t); o.stop(t + 0.3);
      } else {
        const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
        const f = ctx.createBiquadFilter();
        f.type = kind === 'hat' ? 'highpass' : 'bandpass';
        f.frequency.value = kind === 'hat' ? 7000 : 1800;
        s.connect(f);
        env(f, 0.001, kind === 'hat' ? 0.04 : 0.16, kind === 'hat' ? 0.12 : 0.45);
        s.start(t, Math.random()); s.stop(t + 0.25);
      }
    };
    const rnd = mulberry32(st.seed * 1000 + (bar % 8) * 17 + s16);
    if (st.tag === 'synthwave') {
      if (s16 % 8 === 0) drum('kick');
      if (s16 === 4 || s16 === 12) drum('snare');
      if (s16 % 2 === 0) drum('hat');
      if (s16 % 2 === 0) osc('sawtooth', NOTE(deg(chordDeg) - 24 + (s16 % 4 === 2 ? 12 : 0)), 0.005, spb * 1.6, 0.16, 700);
      const arp = [0, 2, 4, 7][(s16 >> 1) % 4];
      if (s16 % 2 === 1) osc('square', NOTE(deg(chordDeg + arp) + 12), 0.003, spb * 1.4, 0.05, 2600);
      if (s16 === 0) for (const k of [0, 2, 4]) osc('sawtooth', NOTE(deg(chordDeg + k)), 0.4, spb * 15, 0.035, 1500);
      if (bar % 4 >= 2 && rnd() < 0.3) osc('triangle', NOTE(deg(chordDeg + Math.floor(rnd() * 7)) + 12), 0.01, spb * 3, 0.1, 4000);
    } else if (st.tag === 'electro') {
      if (s16 % 4 === 0) drum('kick');
      if (s16 === 4 || s16 === 12) drum('snare');
      if (s16 % 4 === 2) drum('hat');
      if ([0, 3, 6, 10, 13].includes(s16)) osc('square', NOTE(deg(chordDeg) - 24), 0.004, spb * 1.8, 0.14, 900);
      if (s16 % 4 === 2) for (const k of [0, 2, 4]) osc('sawtooth', NOTE(deg(chordDeg + k) + 12), 0.003, spb * 0.9, 0.035, 3000);
      if (rnd() < 0.22) osc('square', NOTE(deg(chordDeg + Math.floor(rnd() * 8)) + 24), 0.002, spb * 1.2, 0.045, 5000);
    } else if (st.tag === 'chill') {
      if (s16 === 0 || s16 === 10) drum('kick');
      if (s16 === 8) drum('snare');
      if (s16 % 4 === 2) drum('hat');
      if (s16 === 0) osc('sine', NOTE(deg(chordDeg) - 24), 0.02, spb * 14, 0.22);
      if (s16 === 0 || s16 === 8) for (const k of [0, 2, 3]) osc('triangle', NOTE(deg(chordDeg + k)), 0.15, spb * 7, 0.04, 1800);
      // pat-waing style bell melody on a pentatonic scale
      if (s16 % 2 === 0 && rnd() < 0.45) {
        const n = NOTE(deg(chordDeg + Math.floor(rnd() * 6)) + 12);
        osc('sine', n, 0.002, spb * 4, 0.09); osc('sine', n * 2.01, 0.002, spb * 1.5, 0.03);
      }
    }
  }
}
