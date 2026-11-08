// How to Play (v3): three swipe cards. 1) the dial and the board's policy, 2) the cash meter and power-ups,
// 3) beating "doing nothing". The cards sit in a scroll-snap strip (swipe on a phone); NEXT/BACK and the dots do
// the same on a desktop. No innerHTML: all copy is static and built with h(). Shown on first PLAY, and from the title.

import { markGuideSeen } from '../utils/storage.js';
import { soundFX } from '../ui/SoundFX.js';
import { h } from '../ui/dom.js';

const mockRow = (label, value, cls = '') => h('div', { class: 'gd-row' },
    h('span', { text: label }), h('span', { class: cls, text: value }));

const dialMock = () => h('div', { class: 'gd-mock', 'aria-hidden': 'true' },
    h('div', { class: 'gd-dial' }, ['0%', '25%', '50%', '75%', '100%'].map((p, i) =>
        h('span', { class: `gd-step${i === 2 || i === 3 ? ' is-band' : ''}${i === 2 ? ' is-on' : ''}${i === 4 ? ' is-locked' : ''}`, text: p }))),
    h('p', { class: 'gd-mock-note', text: 'Board policy: hedge 50–75%. Bank lines cap you at 50%.' }));

const cashMock = () => h('div', { class: 'gd-mock', 'aria-hidden': 'true' },
    h('div', { class: 'gd-meter' }, h('span', { class: 'gd-meter-fill' }), h('span', { class: 'gd-meter-red' })),
    mockRow('Cash', '$4.2M', 'gd-ok'),
    mockRow('Red line', '$1.5M', 'gd-bad'));

const beatMock = () => h('div', { class: 'gd-mock', 'aria-hidden': 'true' },
    mockRow('You', '+$180k', 'gd-ok'),
    mockRow('Doing nothing', '-$240k', 'gd-bad'),
    mockRow('Verdict', 'You beat it', 'gd-gold'));

export const CARDS = [
    {
        title: 'THE DIAL',
        mock: dialMock,
        points: [
            'Each exposure has a dial: how much of it to hedge, from 0% to 100%.',
            'Your board may have a hedging policy, a band like 50–75%. Stay inside it and the board stays happy.',
            'Some boards say their policy is not to hedge. Others have no policy yet: your first move is to propose one.',
            'Until a policy exists, the board judges every hedge on its own profit. That is the hardest board to please.',
            'Bank lines cap you at 50%. Bigger Bank Facilities lifts the cap and adds a borrowing cushion.'
        ]
    },
    {
        title: 'THE CASH METER',
        mock: cashMock,
        points: [
            'Your cash is the score you can watch. Markets and events move it every quarter.',
            'Fall below the red line and the bank calls, or the board replaces you.',
            'One power-up a quarter: Cash Forecasting for better forecasts, Cash Visibility for a one-off cash find, Rate & Commodity Hedging to hedge more than currency.',
            'An event may ask for a response before you can run the quarter.'
        ]
    },
    {
        title: 'BEAT DOING NOTHING',
        mock: beatMock,
        points: [
            'Every quarter we also play out what would have happened if you had hedged nothing.',
            'Beat that, and the board notices. Fall behind it, and board mood drops.',
            'A run is 8 quarters, about 3 minutes. Hedge too little and you are exposed. Hedge off-policy and the board will say so.',
            'Good luck, Treasurer.'
        ]
    }
];

export class HowToPlayScreen {
    constructor(app) {
        this.app = app;
        this.el = null;
        this.currentStep = 0;
        this.fromAutoShow = false;
        this.returnScreen = 'title';
    }

    render() {
        this.currentStep = 0;
        this.cardEls = CARDS.map((c, i) => h('section', {
            class: 'gd-card', 'aria-label': `Card ${i + 1} of ${CARDS.length}: ${c.title}`
        },
        h('h2', { text: c.title }),
        c.mock(),
        h('ul', { class: 'gd-points' }, c.points.map(p => h('li', { text: p })))));
        this.track = h('div', { class: 'gd-track', tabindex: '0', 'aria-label': 'How to play, swipe for the next card' }, this.cardEls);
        this.dots = CARDS.map((_, i) => h('span', { class: 'gd-dot' + (i === 0 ? ' is-active' : '') }));
        this.backBtn = h('button', { class: 'btn gd-back', type: 'button', text: 'BACK', on: { click: () => this._go(this.currentStep - 1, true) } });
        this.nextBtn = h('button', { class: 'btn btn-gold gd-next', type: 'button', on: { click: () => this._next() } });
        this.el = h('div', { class: 'screen active v3 howtoplay-screen' },
            h('header', { class: 'v3-head' },
                h('h1', { text: 'How to play' }),
                h('button', { class: 'btn gd-skip', type: 'button', text: 'SKIP', on: { click: () => { soundFX.click(); this.finish(true); } } })),
            this.track,
            h('footer', { class: 'gd-foot' }, this.backBtn, h('div', { class: 'gd-dots', 'aria-hidden': 'true' }, this.dots), this.nextBtn));
        this.track.addEventListener('scroll', () => this._onScroll());
        this._paint();
        return this.el;
    }

    mount() {}

    unmount() {
        this.fromAutoShow = false;
        this.returnScreen = 'title';
        this.currentStep = 0;
    }

    _next() {
        soundFX.click();
        if (this.currentStep < CARDS.length - 1) this._go(this.currentStep + 1, true);
        else this.finish();
    }

    // Moves to card `i`. `scroll` also slides the strip (a swipe has already moved it).
    _go(i, scroll) {
        const next = Math.max(0, Math.min(CARDS.length - 1, i));
        if (next === this.currentStep) return;
        this.currentStep = next;
        if (scroll) {
            const left = next * (this.track.clientWidth || 0);
            this.track.scrollTo?.({ left, behavior: 'smooth' });
        }
        this._paint();
    }

    _onScroll() {
        const w = this.track.clientWidth;
        if (w > 0) this._go(Math.round(this.track.scrollLeft / w), false);
    }

    _paint() {
        const last = this.currentStep === CARDS.length - 1;
        this.dots.forEach((d, i) => d.classList.toggle('is-active', i === this.currentStep));
        this.backBtn.disabled = this.currentStep === 0;
        this.nextBtn.textContent = last ? 'START GAME' : 'NEXT';
    }

    finish(skipped = false) {
        markGuideSeen();
        if (skipped && this.fromAutoShow) {
            this.app.showToast?.('Guide skipped. Find it on the title screen', 'info', 2500);
        }
        this.app.showScreen(this.returnScreen);
    }
}
