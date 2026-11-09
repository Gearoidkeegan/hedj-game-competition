// RiskMeter (v3.1): the RISK COVERED bar under the cash meter on the Simple quarter screen.
//
//   const meter = new RiskMeter(host);
//   meter.set({ cover, mandate, wrongFocus, warn });
//
// `cover` is policyCover(...).cover from the engine (0..1, or null when nothing can be hedged); this class only draws
// it, so the meter and the engine's policy check can never disagree. `mandate` ({ min, max } or null) is shaded as the
// board's band; a noHedge board ({0, 0}) is a marker at 0. `warn` (amber) is set by the caller when the policy check
// would fail; `wrongFocus` adds the "Big exposure left open" line. No innerHTML; widths are set through the style
// object (CSP-safe).

import { h } from './dom.js';

export const WRONG_FOCUS_NOTE = 'Big exposure left open';
export const NOTHING_TO_HEDGE_NOTE = 'Nothing you can hedge yet';

const clamp01 = v => Math.min(1, Math.max(0, v));
const pctStyle = v => `${(clamp01(v) * 100).toFixed(1)}%`;

export class RiskMeter {
    constructor(host) {
        this.host = host;
        this.cover = null;
        this.valueEl = h('span', { class: 'rk-value', text: '—' });
        this.bandEl = h('div', { class: 'rk-band', hidden: true, 'aria-hidden': 'true' });
        this.fillEl = h('div', { class: 'rk-fill' });
        this.noteEl = h('p', { class: 'rk-note', hidden: true });
        this.root = h('div', {
            class: 'risk-meter', role: 'meter', 'aria-label': 'Risk covered', 'aria-valuemin': '0', 'aria-valuemax': '100'
        },
        h('div', { class: 'rk-row' }, h('span', { class: 'rk-label', text: 'RISK COVERED' }), this.valueEl),
        h('div', { class: 'rk-bar' }, this.bandEl, this.fillEl),
        this.noteEl);
        host.replaceChildren(this.root);
    }

    set({ cover = null, mandate = null, wrongFocus = false, warn = false } = {}) {
        const usable = typeof cover === 'number' && Number.isFinite(cover);
        this.cover = usable ? cover : null;
        const pct = usable ? Math.round(clamp01(cover) * 100) : null;
        this.valueEl.textContent = usable ? `${pct}%` : '—';
        this.fillEl.style.width = pctStyle(usable ? cover : 0);
        if (usable) {
            this.root.setAttribute('aria-valuenow', String(pct));
            this.root.setAttribute('aria-valuetext', `${pct}% of risk covered`);
        } else {
            this.root.removeAttribute('aria-valuenow');
            this.root.setAttribute('aria-valuetext', NOTHING_TO_HEDGE_NOTE);
        }

        const band = mandate && Number.isFinite(mandate.min) && Number.isFinite(mandate.max) ? mandate : null;
        this.bandEl.hidden = !band;
        if (band) {
            this.bandEl.style.left = pctStyle(band.min);
            this.bandEl.style.width = pctStyle(band.max - band.min);
            this.bandEl.classList.toggle('is-point', band.max <= band.min);
        }

        this.root.classList.toggle('is-warn', !!warn);
        const note = wrongFocus ? WRONG_FOCUS_NOTE : usable ? '' : NOTHING_TO_HEDGE_NOTE;
        this.noteEl.textContent = note;
        this.noteEl.hidden = !note;
        this.noteEl.classList.toggle('is-warn', !!wrongFocus);
    }
}
