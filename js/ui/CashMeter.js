// CashMeter: the cash bar at the top of the Simple quarter and result screens.
//
//   const meter = new CashMeter(el, { currency: 'EUR', env });
//   await meter.set({ cash, startingCash, redLine }, animateMs = 0);   // Promise resolves when the animation ends
//   meter.value      // the target cash of the last set()
//   meter.displayed  // the cash currently shown (mid-animation it lags value)
//   meter.level      // the bar's fill, 0..1 (cash over 1.5 × startingCash)
//   meter.state      // 'ok' | 'danger' (cash below the red line)
//   meter.destroy()
//
// The bar spans 0 to 1.5 × starting cash, with a red-line marker. From the second set() on, the change since the
// previous set() shows as a signed chip ("+€12.0m"). With `deltaFrom` (v3.2, the quarter screen's add-on preview)
// the chip shows the change from that fixed cash instead, and hides when there is none. With animateMs > 0 the number and bar count to the new
// value (ease-out) using requestAnimationFrame; reduced motion, or no rAF, jumps straight there. A new set()
// mid-animation finishes the previous promise and starts from the value on screen.
// `env` lets tests inject requestAnimationFrame, cancelAnimationFrame, now and matchMedia.

import { h } from './dom.js';
import { formatCash } from '../utils/formatters.js';

const SPAN = 1.5;
const clamp01 = v => Math.min(1, Math.max(0, v));
const fin = v => (Number.isFinite(v) ? v : 0);
const pctStyle = v => `${(v * 100).toFixed(1)}%`;

export class CashMeter {
    constructor(el, { currency = 'EUR', env = {} } = {}) {
        const g = globalThis;
        this.el = el;
        this.currency = currency;
        this.raf = env.requestAnimationFrame || (g.requestAnimationFrame ? fn => g.requestAnimationFrame(fn) : null);
        this.caf = env.cancelAnimationFrame || (g.cancelAnimationFrame ? id => g.cancelAnimationFrame(id) : () => {});
        this.now = env.now || (() => (g.performance?.now ? g.performance.now() : Date.now()));
        this.matchMedia = env.matchMedia || (g.matchMedia ? q => g.matchMedia(q) : null);

        this.value = 0;
        this.displayed = 0;
        this.level = 0;
        this.state = 'ok';
        this.data = null;
        this._anim = null;

        this.valueEl = h('span', { class: 'cm-value', text: formatCash(0, currency) });
        this.deltaEl = h('span', { class: 'cm-delta', hidden: true });
        this.fillEl = h('div', { class: 'cm-fill' });
        this.redEl = h('div', { class: 'cm-redline', 'aria-hidden': 'true' });
        this.subEl = h('span', { class: 'cm-sub' });
        this.root = h('div', { class: 'cash-meter', role: 'group', 'aria-label': 'Cash' },
            h('div', { class: 'cm-row' }, h('span', { class: 'cm-label', text: 'Cash' }), this.valueEl, this.deltaEl),
            h('div', { class: 'cm-bar' }, this.fillEl, this.redEl),
            this.subEl);
        el.replaceChildren(this.root);
    }

    set({ cash, startingCash, redLine, deltaFrom } = {}, animateMs = 0) {
        this._finishAnim();
        const prev = this.data ? this.value : null;
        this.data = { cash: fin(cash), startingCash: fin(startingCash), redLine: fin(redLine) };
        this.value = this.data.cash;

        const full = SPAN * this.data.startingCash;
        this.redEl.style.left = pctStyle(full > 0 ? clamp01(this.data.redLine / full) : 0);
        this.redEl.hidden = !(full > 0 && this.data.redLine > 0);
        this.subEl.textContent = this.data.redLine > 0 ? `Red line ${formatCash(this.data.redLine, this.currency)}` : '';
        this.state = this.data.redLine > 0 && this.value < this.data.redLine ? 'danger' : 'ok';
        this.root.classList.toggle('is-danger', this.state === 'danger');

        const base = Number.isFinite(deltaFrom) ? deltaFrom : prev;
        const d = base === null ? 0 : this.value - base;
        if (base === null || (Number.isFinite(deltaFrom) && d === 0)) {
            this.deltaEl.hidden = true;
        } else {
            this.deltaEl.textContent = `${d >= 0 ? '+' : ''}${formatCash(d, this.currency)}`;
            this.deltaEl.classList.toggle('is-up', d >= 0);
            this.deltaEl.classList.toggle('is-down', d < 0);
            this.deltaEl.hidden = false;
        }

        const from = this.displayed;
        const reduced = !!this.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
        if (!(animateMs > 0) || !this.raf || reduced || from === this.value) {
            this._show(this.value);
            return Promise.resolve();
        }
        return new Promise(resolve => {
            const anim = { resolve, handle: null, t0: null };
            this._anim = anim;
            const to = this.value;
            const frame = t => {
                if (this._anim !== anim) return;
                const now = Number.isFinite(t) ? t : this.now();
                if (anim.t0 === null) anim.t0 = now;
                const k = clamp01((now - anim.t0) / animateMs);
                const eased = 1 - (1 - k) ** 3;
                this._show(k >= 1 ? to : from + (to - from) * eased);
                if (k >= 1) {
                    this._anim = null;
                    resolve();
                } else {
                    anim.handle = this.raf(frame);
                }
            };
            anim.handle = this.raf(frame);
        });
    }

    destroy() {
        this._finishAnim();
        this.el.replaceChildren();
    }

    _finishAnim() {
        const a = this._anim;
        if (!a) return;
        this._anim = null;
        if (a.handle !== null) this.caf(a.handle);
        a.resolve();
    }

    _show(cash) {
        this.displayed = cash;
        const full = SPAN * (this.data?.startingCash || 0);
        this.level = full > 0 ? clamp01(cash / full) : 0;
        this.valueEl.textContent = formatCash(cash, this.currency);
        this.fillEl.style.width = pctStyle(this.level);
    }
}
