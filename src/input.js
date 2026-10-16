// Unified input: virtual joystick + buttons on touch screens, keyboard/mouse on
// desktop, and standard gamepads.
import { clamp } from './util.js';

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'space', ShiftLeft: 'sprint', ShiftRight: 'sprint', KeyF: 'action', Enter: 'action', KeyE: 'punch', KeyH: 'horn',
  KeyR: 'radio', KeyM: 'map', Escape: 'pause', KeyP: 'pause', KeyC: 'cam', KeyT: 'taxi', KeyQ: 'punch',
};

export class Input {
  constructor(root) {
    this.root = root;
    this.keys = new Set();
    this.btn = {};            // held touch buttons
    this.edges = new Set();   // one-shot presses this frame
    this.joy = { x: 0, y: 0, active: false, id: null, ox: 0, oy: 0 };
    this.look = { dx: 0, dy: 0, id: null, lx: 0, ly: 0, active: false, lastMove: 0 };
    this.mouse = { down: false, x: 0, y: 0 };
    this.enabled = true;
    this.state = { moveX: 0, moveY: 0, gas: 0, brake: 0, steer: 0, handbrake: 0, sprint: false };
    this._bindKeyboard();
    this._bindTouch();
    this._bindMouse();
  }

  press(name) { this.edges.add(name); }
  pressed(name) { return this.edges.has(name); }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const k = KEYMAP[e.code];
      if (!k) return;
      if (['up', 'down', 'left', 'right', 'space'].includes(k)) e.preventDefault();
      if (!this.keys.has(k)) this.press(k === 'space' ? 'jump' : k);
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) this.keys.delete(k); });
    window.addEventListener('blur', () => { this.keys.clear(); this.btn = {}; this.joy.active = false; });
  }

  _bindTouch() {
    const joyZone = document.getElementById('joy-zone');
    const base = document.getElementById('joy-base');
    const knob = document.getElementById('joy-knob');
    const R = () => Math.min(70, window.innerHeight * 0.12);
    const showJoy = (x, y) => {
      base.style.display = 'block';
      base.style.left = x + 'px'; base.style.top = y + 'px';
      knob.style.transform = 'translate(-50%,-50%)';
    };
    joyZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      if (this.joy.id !== null) return;
      this.joy.id = t.identifier; this.joy.ox = t.clientX; this.joy.oy = t.clientY; this.joy.active = true;
      this.joy.x = 0; this.joy.y = 0;
      showJoy(t.clientX, t.clientY);
    }, { passive: false });
    const move = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) {
          let dx = t.clientX - this.joy.ox, dy = t.clientY - this.joy.oy;
          const r = R();
          const l = Math.hypot(dx, dy);
          if (l > r) {
            // drag the base along so the stick never "runs out"
            this.joy.ox += (dx / l) * (l - r); this.joy.oy += (dy / l) * (l - r);
            base.style.left = this.joy.ox + 'px'; base.style.top = this.joy.oy + 'px';
            dx = (dx / l) * r; dy = (dy / l) * r;
          }
          this.joy.x = dx / r; this.joy.y = -dy / r;
          knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        } else if (t.identifier === this.look.id) {
          this.look.dx += t.clientX - this.look.lx; this.look.dy += t.clientY - this.look.ly;
          this.look.lx = t.clientX; this.look.ly = t.clientY;
          this.look.lastMove = performance.now();
        }
      }
    };
    const end = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier === this.joy.id) {
          this.joy.id = null; this.joy.active = false; this.joy.x = 0; this.joy.y = 0;
          base.style.display = 'none';
        }
        if (t.identifier === this.look.id) { this.look.id = null; this.look.active = false; }
      }
    };
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);

    const lookZone = document.getElementById('look-zone');
    lookZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      if (this.look.id !== null) return;
      this.look.id = t.identifier; this.look.lx = t.clientX; this.look.ly = t.clientY; this.look.active = true;
    }, { passive: false });

    for (const el of document.querySelectorAll('[data-btn]')) {
      const name = el.dataset.btn;
      const down = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.btn[name] = true;
        this.press(name);
        el.classList.add('down');
        if (navigator.vibrate && name !== 'gas' && name !== 'brake') { try { navigator.vibrate(8); } catch (_) { /* ignore */ } }
      };
      const up = (e) => { e.preventDefault(); this.btn[name] = false; el.classList.remove('down'); };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up, { passive: false });
      el.addEventListener('touchcancel', up, { passive: false });
      el.addEventListener('mousedown', down);
      el.addEventListener('mouseup', up);
      el.addEventListener('mouseleave', (e) => { if (this.btn[name]) up(e); });
    }
  }

  _bindMouse() {
    const canvas = this.root;
    canvas.addEventListener('mousedown', (e) => { this.mouse.down = true; this.mouse.x = e.clientX; this.mouse.y = e.clientY; if (e.button === 2) this.press('punch'); });
    window.addEventListener('mouseup', () => { this.mouse.down = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.mouse.down) return;
      this.look.dx += e.clientX - this.mouse.x; this.look.dy += e.clientY - this.mouse.y;
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      this.look.lastMove = performance.now();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  poll() {
    const k = this.keys, b = this.btn;
    let mx = 0, my = 0;
    if (k.has('left')) mx -= 1;
    if (k.has('right')) mx += 1;
    if (k.has('up')) my += 1;
    if (k.has('down')) my -= 1;
    if (this.joy.active) { mx = this.joy.x; my = this.joy.y; }
    let gas = (k.has('up') ? 1 : 0) + (b.gas ? 1 : 0);
    let brake = (k.has('down') ? 1 : 0) + (b.brake ? 1 : 0);
    let hand = k.has('space') || b.hand ? 1 : 0;
    let sprint = k.has('sprint') || !!b.sprint;
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.15) { mx = ax; my = -ay; }
      const rx = p.axes[2] || 0, ry = p.axes[3] || 0;
      if (Math.abs(rx) > 0.15 || Math.abs(ry) > 0.15) { this.look.dx += rx * 9; this.look.dy += ry * 6; this.look.lastMove = performance.now(); }
      const bt = (i) => p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.3);
      gas += p.buttons[7] ? p.buttons[7].value : 0;
      brake += p.buttons[6] ? p.buttons[6].value : 0;
      if (bt(0)) { hand = 1; }
      if (bt(5)) sprint = true;
      this._padEdge(p, 0, 'jump'); this._padEdge(p, 1, 'action'); this._padEdge(p, 3, 'action');
      this._padEdge(p, 2, 'punch'); this._padEdge(p, 9, 'pause'); this._padEdge(p, 8, 'map'); this._padEdge(p, 4, 'horn');
      this._padEdge(p, 12, 'radio');
    }
    const s = this.state;
    s.moveX = clamp(mx, -1, 1);
    s.moveY = clamp(my, -1, 1);
    s.steer = s.moveX;
    // the joystick also drives: push up = gas, pull down = brake/reverse
    const joyGas = this.joy.active ? clamp((this.joy.y - 0.35) / 0.5, 0, 1) : 0;
    const joyBrake = this.joy.active ? clamp((-this.joy.y - 0.35) / 0.5, 0, 1) : 0;
    s.gas = clamp(gas + joyGas, 0, 1);
    s.brake = clamp(brake + joyBrake, 0, 1);
    s.handbrake = hand;
    s.sprint = sprint;
    s.horn = k.has('horn') || !!b.horn;
    return s;
  }

  _padEdge(p, i, name) {
    this._pad = this._pad || {};
    const key = p.index + ':' + i;
    const on = p.buttons[i] && p.buttons[i].pressed;
    if (on && !this._pad[key]) this.press(name);
    this._pad[key] = on;
  }

  consumeLook() {
    const d = { dx: this.look.dx, dy: this.look.dy };
    this.look.dx = 0; this.look.dy = 0;
    return d;
  }

  endFrame() { this.edges.clear(); }
}
