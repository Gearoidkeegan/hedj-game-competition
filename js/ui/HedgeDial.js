// HedgeDial: a five-detent hedge-ratio control (0/25/50/75/100%) for the Simple quarter screen.
//
//   const dial = new HedgeDial(el, { value, mandate, max, lockedReason, label, onChange });
//   dial.value            // the current ratio, one of DETENTS
//   dial.conflict         // true when the board's band starts above the cap (R51)
//   dial.setValue(v)      // snaps and clamps; does not call onChange
//   dial.setMax(max)      // a new cap (e.g. facilities bought); pulls the value down and calls onChange if needed
//   dial.setMandate(m)    // a new band to shade ({min,max} or null)
//   dial.setLockedReason(text)
//   dial.destroy()
//
// Each detent is a button of at least 44px (css/v3.css). The track is a single tab stop with role="slider":
// arrow keys move one detent, Home/End jump to 0 and the cap. Steps above `max` are locked (disabled and
// hatched); `lockedReason` explains a dial whose cap is 0. The mandate band is shaded: none for a no-policy board
// (mandate null), the 0 step for a "not to hedge" board ({0,0}), otherwise every step inside {min,max}.

import { h } from './dom.js';

export const DETENTS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);
const EPS = 1e-9;
const pct = v => `${Math.round(v * 100)}%`;
const snap = v => Math.round(Math.min(1, Math.max(0, Number(v) || 0)) * 4) / 4;
const snapDown = v => Math.floor(Math.min(1, Math.max(0, Number(v) || 0)) * 4 + EPS) / 4;

function bandLabel(m) {
    return m.min === m.max ? pct(m.min) : `${Math.round(m.min * 100)}–${pct(m.max)}`;
}

export class HedgeDial {
    constructor(el, { value = 0, mandate = null, max = 1, lockedReason = '', label = 'Hedge ratio', onChange = null } = {}) {
        this.el = el;
        this.onChange = typeof onChange === 'function' ? onChange : null;
        this.max = snapDown(max);
        this.mandate = mandate || null;
        this.lockedReason = lockedReason || '';
        this._value = Math.min(snap(value), this.max);

        this.steps = DETENTS.map(step => h('button', {
            class: 'hd-step', type: 'button', tabindex: '-1', 'data-step': String(step),
            on: { click: () => this._pick(step) }
        }, h('span', { class: 'hd-step-label', text: pct(step) })));
        this.track = h('div', {
            class: 'hd-track', role: 'slider', tabindex: '0', 'aria-label': label,
            'aria-valuemin': '0', 'aria-valuemax': '100'
        }, this.steps);
        this.note = h('p', { class: 'hd-note', hidden: true });
        this.root = h('div', { class: 'hedge-dial' }, this.track, this.note);

        this._onKey = e => this._key(e);
        this.track.addEventListener('keydown', this._onKey);
        el.replaceChildren(this.root);
        this._paint();
    }

    get value() { return this._value; }

    // True when the board's band can't be reached under the current cap (and the dial isn't simply locked).
    get conflict() {
        return !!this.mandate && this.max > 0 && this.mandate.min > this.max + EPS;
    }

    setValue(v) {
        this._value = Math.min(snap(v), this.max);
        this._paint();
    }

    setMax(max) {
        this.max = snapDown(max);
        if (this._value > this.max + EPS) this._set(this.max);
        this._paint();
    }

    setMandate(mandate) {
        this.mandate = mandate || null;
        this._paint();
    }

    setLockedReason(text) {
        this.lockedReason = text || '';
        this._paint();
    }

    destroy() {
        this.track.removeEventListener('keydown', this._onKey);
        this.el.replaceChildren();
    }

    _pick(step) {
        if (step > this.max + EPS) return;
        this._set(step);
    }

    _set(v) {
        const next = Math.min(snap(v), this.max);
        if (next === this._value) return;
        this._value = next;
        this._paint();
        if (this.onChange) this.onChange(next);
    }

    _key(e) {
        const k = e.key;
        let next = null;
        if (k === 'ArrowRight' || k === 'ArrowUp') next = this._value + 0.25;
        else if (k === 'ArrowLeft' || k === 'ArrowDown') next = this._value - 0.25;
        else if (k === 'Home') next = 0;
        else if (k === 'End') next = this.max;
        if (next === null) return;
        e.preventDefault();
        this._set(Math.max(0, Math.min(this.max, next)));
    }

    _inBand(step) {
        const m = this.mandate;
        return !!m && step >= m.min - EPS && step <= m.max + EPS;
    }

    _paint() {
        const v = this._value;
        this.steps.forEach((btn, i) => {
            const step = DETENTS[i];
            const locked = step > this.max + EPS;
            btn.disabled = locked;
            btn.classList.toggle('is-locked', locked);
            btn.classList.toggle('is-on', step === v);
            btn.classList.toggle('is-filled', step <= v + EPS && step > 0);
            btn.classList.toggle('is-band', this._inBand(step));
            btn.setAttribute('aria-pressed', String(step === v));
            btn.setAttribute('aria-label', locked ? `${pct(step)}, locked` : pct(step));
        });
        this.track.setAttribute('aria-valuenow', String(Math.round(v * 100)));
        this.track.setAttribute('aria-valuetext', `${pct(v)} hedged`);
        this.track.setAttribute('aria-disabled', String(this.max === 0));

        const locked = this.max === 0;
        let note = '';
        if (locked) note = this.lockedReason;
        else if (this.conflict) note = `Your board wants ${bandLabel(this.mandate)}; your bank lines cap you at ${pct(this.max)}`;
        this.note.textContent = note;
        this.note.hidden = !note;
        this.root.classList.toggle('is-locked', locked);
        this.root.classList.toggle('has-conflict', !locked && this.conflict);
    }
}
