// HUD overlay (DOM): clock, health/armour, money, wanted stars, messages.
import { formatMoney } from '../util.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      clock: $('clock'), health: $('health-fill'), armor: $('armor-fill'), armorBar: $('armor-bar'), money: $('money'),
      stars: $('stars'), msg: $('mission-text'), big: $('big-text'), bigSub: $('big-sub'), area: $('area-name'),
      areaMy: $('area-my'), veh: $('vehicle-name'), radio: $('radio-name'), timer: $('mission-timer'), speedo: $('speedo'),
      street: $('street-name'), help: $('help-box'), fps: $('fps'), counter: $('mission-counter'), toast: $('toast'),
    };
    this.shownMoney = 0;
    this.money = 0;
    this.timers = {};
    this._stars = -1;
    this._flash = false;
    this.el.stars.innerHTML = '<span>★</span>'.repeat(5);
  }

  _timed(key, el, ms, cls = 'show') {
    clearTimeout(this.timers[key]);
    el.classList.add(cls);
    if (ms > 0) this.timers[key] = setTimeout(() => el.classList.remove(cls), ms);
  }

  setClock(hour) {
    const h = Math.floor(hour) % 24, m = Math.floor((hour % 1) * 60);
    const s = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    if (this.el.clock.textContent !== s) this.el.clock.textContent = s;
  }

  setHealth(h, armor) {
    this.el.health.style.width = Math.max(0, h) + '%';
    this.el.armor.style.width = Math.max(0, armor) + '%';
    this.el.armorBar.style.display = armor > 0 ? 'block' : 'none';
  }

  pulseHealth() { this._timed('hp', this.el.health.parentElement, 300, 'hit'); }

  setMoney(n) { this.money = n; }

  tick(dt) {
    if (this.shownMoney !== this.money) {
      const d = this.money - this.shownMoney;
      const step = Math.sign(d) * Math.max(1, Math.ceil(Math.abs(d) * Math.min(1, dt * 6)));
      this.shownMoney = Math.abs(step) >= Math.abs(d) ? this.money : this.shownMoney + step;
      this.el.money.textContent = formatMoney(this.shownMoney);
    }
  }

  setStars(n, flash) {
    if (n === this._stars && flash === this._flash) return;
    this._stars = n; this._flash = flash;
    const spans = this.el.stars.children;
    for (let i = 0; i < 5; i++) spans[i].className = i < n ? 'on' : '';
    this.el.stars.classList.toggle('flash', !!flash && n > 0);
  }

  message(text, ms = 4500) {
    this.el.msg.innerHTML = text;
    this._timed('msg', this.el.msg, ms);
  }

  clearMessage() { this.el.msg.classList.remove('show'); }

  help(text, ms = 6000) {
    this.el.help.innerHTML = text;
    this._timed('help', this.el.help, ms);
  }

  big(text, sub = '', color = '', ms = 3500) {
    this.el.big.textContent = text;
    this.el.big.style.color = color;
    this.el.bigSub.textContent = sub;
    this._timed('big', this.el.big.parentElement, ms);
  }

  area(name, my) {
    this.el.area.textContent = name;
    this.el.areaMy.textContent = my || '';
    this._timed('area', this.el.area.parentElement, 4200);
  }

  vehicleName(name) {
    this.el.veh.textContent = name;
    this._timed('veh', this.el.veh, 2600);
  }

  radio(name) {
    this.el.radio.textContent = name;
    this._timed('radio', this.el.radio, 2600);
  }

  flashMessage(text) {
    this.el.toast.textContent = text;
    this._timed('toast', this.el.toast, 2600);
  }

  timer(sec) {
    if (sec == null) { this.el.timer.classList.remove('show'); return; }
    const s = Math.max(0, Math.ceil(sec));
    this.el.timer.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    this.el.timer.classList.add('show');
    this.el.timer.classList.toggle('low', s <= 10);
  }

  counter(text) {
    if (!text) { this.el.counter.classList.remove('show'); return; }
    this.el.counter.innerHTML = text;
    this.el.counter.classList.add('show');
  }

  speedo(kmh) {
    if (kmh == null) { this.el.speedo.classList.remove('show'); return; }
    this.el.speedo.classList.add('show');
    const t = Math.round(kmh) + '<small>KM/H</small>';
    if (this._sp !== t) { this._sp = t; this.el.speedo.innerHTML = t; }
  }

  street(name) {
    if (this._street === name) return;
    this._street = name;
    this.el.street.textContent = name || '';
    this.el.street.classList.toggle('show', !!name);
  }

  fps(text) { this.el.fps.textContent = text || ''; }
}
