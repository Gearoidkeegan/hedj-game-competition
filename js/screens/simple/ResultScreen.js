// ResultScreen: what happened in the quarter just played (Simple mode). It reads app.lastQuarter (the
// RunController.playQuarter result):
//   - the cash meter counts from last quarter's cash to the new figure;
//   - the scene strip plays in the mood of this quarter's result;
//   - one line per exposure, "Dollar +6%. Your hedge saved €1.2m", revealed one by one;
//   - one board member (or the chairman) with the expression and line RunController picked, plus the result quip;
//   - the player's character (v3.1) beside the meter: the face from before the quarter, then, once everything is
//     revealed, the face from after it, so it reacts to the quarter.
// A tap on the screen skips the reveal; once everything is shown, a tap moves on. NEXT always moves on. The screen
// never moves on by itself (R53), and taps in the first TAP_GUARD_MS after mount are ignored, so the second tap of
// a double tap on RUN can't land on NEXT. After the last quarter it goes to the Simple game over.
// No innerHTML: the DOM is built node by node with textContent (R7).

import { h } from '../../ui/dom.js';
import { CashMeter } from '../../ui/CashMeter.js';
import { SceneLoop } from '../../ui/pixel/Scene.js';
import { drawSprite, CHAIRMAN_SPRITES } from '../../ui/pixel/sprites.js';
import { isRunOver } from '../../engine/sim/SimEngine.js';
import { BALANCE } from '../../engine/sim/balance.js';
import { moveLabel } from '../../ui/labels.js';
import { formatCash } from '../../utils/formatters.js';
import { createTapGuard } from '../../ui/tapGuard.js';
import { sceneStateFor, LOW_MOOD, withAvatar } from './QuarterScreen.js';
import { avatarMood } from '../../engine/sim/avatarMood.js';
import { paintAvatar } from './AvatarPicker.js';

export const METER_MS = 1200;       // cash count-up
const LINE_START_MS = 900;          // first exposure line
const LINE_STEP_MS = 450;           // between lines
const BOARD_AFTER_MS = 500;         // board card after the last line
const SPRITE_SCALE = 2;             // 32px sprites drawn at 64px
const NOISE = 0.5;                  // money below half a unit is no impact

// The move of the exposure's foreign currency (or price, or rate) as the player feels it. FX rates are quoted
// base/quote: when the exposure's currency is the quote (EURUSD for dollars), a rising rate is a weaker dollar.
export function unitMovePct(exposure, movePct) {
    const m = Number.isFinite(movePct) ? movePct : 0;
    if (exposure?.type === 'fx' && typeof exposure.underlying === 'string' && typeof exposure.unit === 'string'
        && exposure.underlying.endsWith(exposure.unit) && m > -100) {
        return 100 / (1 + m / 100) - 100;
    }
    return m;
}

// "Dollar +6%", "Jet fuel -0.4%", "Interest rates +0.25pp", "Dollar flat".
export function moveText(exposure, movePct) {
    const subject = moveLabel(exposure);
    const m = unitMovePct(exposure, movePct);
    const sign = m > 0 ? '+' : '-';
    const a = Math.abs(m);
    if (exposure?.type === 'ir') {
        return a < 0.005 ? `${subject} unchanged` : `${subject} ${sign}${a.toFixed(2)}pp`;
    }
    if (a < 0.05) return `${subject} flat`;
    return `${subject} ${sign}${a >= 1 ? Math.round(a) : a.toFixed(1)}%`;
}

// "Your hedge saved €1.2m", "Your hedge cost €2.0m", "Unhedged, it cost you €9.0m", "No impact".
export function impactText(line, currency) {
    const money = v => formatCash(Math.abs(v), currency);
    const hedge = Number.isFinite(line?.hedgeImpact) ? line.hedgeImpact : 0;
    const exposure = Number.isFinite(line?.exposureImpact) ? line.exposureImpact : 0;
    if (hedge >= NOISE) return `Your hedge saved ${money(hedge)}`;
    if (hedge <= -NOISE) return `Your hedge cost ${money(hedge)}`;
    if (exposure <= -NOISE) return `Unhedged, it cost you ${money(exposure)}`;
    if (exposure >= NOISE) return `Unhedged, it made you ${money(exposure)}`;
    return 'No impact';
}

export function resultLine(exposure, line, currency) {
    return `${moveText(exposure, line?.movePct)}. ${impactText(line, currency)}`;
}

function speakerName(reaction) {
    if (reaction?.speaker === 'chairman') {
        return `${CHAIRMAN_SPRITES[reaction.chairmanId]?.label || 'The Chairman'}, Chairman`;
    }
    const m = reaction?.member;
    if (!m) return 'The board';
    return m.title ? `${m.name}, ${m.title}` : m.name;
}

export class ResultScreen {
    // env (tests): setTimeout, clearTimeout, now (also the tap guard's clock), plus
    // requestAnimationFrame/cancelAnimationFrame/matchMedia for the cash meter and the scene.
    constructor(app, env = {}) {
        this.app = app;
        this.env = env;
        this.tapGuard = createTapGuard({ now: env.now });
        this.el = null;
        this.timers = [];
        this.meter = null;
        this.scene = null;
        this.done = false;
        this.revealed = false;
    }

    get rc() { return this.app.runController; }

    render() {
        this._teardown();
        this.done = false;
        this.revealed = false;
        this.el = h('div', { class: 'screen active v3 result-screen' });
        const lq = this.app.lastQuarter;
        if (!lq?.run || !lq?.summary) {
            this.data = null;
            this.el.append(h('div', { class: 'v3-empty' },
                h('p', { text: 'No quarter result to show.' }),
                h('button', { class: 'btn btn-gold q-back', type: 'button', text: 'BACK TO TITLE',
                    on: { click: () => this.app.showScreen('title') } })));
            return this.el;
        }
        const { run, summary, quip, boardReaction } = lq;
        this.data = lq;
        const prev = run.history.length > 1 ? run.history[run.history.length - 2] : null;
        const moodBefore = prev ? prev.boardMoodAfter : BALANCE.startMood;
        const moodDelta = Math.round(run.boardMood) - Math.round(moodBefore);
        this.cashBefore = prev ? prev.cashAfter : run.startingCash;

        this.meterHost = h('div', { class: 'q-cash' });
        this.moodBefore = avatarMood({ cash: this.cashBefore, redLine: run.redLine, startingCash: run.startingCash,
            boardMood: moodBefore, status: 'active' });
        this.moodAfter = avatarMood(run);
        const cashArea = withAvatar(this.meterHost, this.moodBefore);
        this.avatarEl = cashArea === this.meterHost ? null : cashArea.querySelector('.av-face');
        const head = h('header', { class: 'q-head' },
            h('div', { class: 'q-head-row' },
                h('h1', { class: 'q-quarter', text: `Quarter ${summary.q} results` }),
                h('span', { class: `q-mood r-mood${run.boardMood < LOW_MOOD ? ' is-low' : ''}`,
                    text: `Board mood ${Math.round(run.boardMood)} (${moodDelta >= 0 ? '+' : ''}${moodDelta})` })),
            cashArea);

        this.sceneCanvas = h('canvas', { class: 'q-scene-canvas', 'aria-hidden': 'true' });
        this.lineEls = (summary.lines || []).map(l => {
            const exposure = run.exposures.find(e => e.id === l.exposureId);
            // The tone follows the net effect of the line (exposure plus hedge), not the hedge alone.
            const net = (Number.isFinite(l.exposureImpact) ? l.exposureImpact : 0) + (Number.isFinite(l.hedgeImpact) ? l.hedgeImpact : 0);
            const tone = net >= NOISE ? 'is-up' : net <= -NOISE ? 'is-down' : '';
            return h('li', { class: `r-line ${tone}`.trim(), 'data-exposure': l.exposureId, hidden: true,
                text: resultLine(exposure, l, run.baseCurrency) });
        });

        const reaction = boardReaction || {};
        const expression = reaction.expression || 'neutral';
        this.spriteId = reaction.spriteId || null;
        this.expression = expression;
        this.spriteCanvas = h('canvas', { class: 'q-board-sprite r-board-sprite', width: '64', height: '64',
            'aria-hidden': 'true', 'data-expression': expression });
        this.boardEl = h('section', { class: `q-board r-board is-${expression}`, 'data-key': reaction.key || '',
            'aria-label': 'Board reaction', hidden: true },
        this.spriteCanvas,
        h('div', { class: 'q-board-text' },
            h('p', { class: 'q-board-name r-board-name', text: speakerName(reaction) }),
            reaction.line ? h('p', { class: 'q-board-line r-board-line', text: reaction.line }) : null));

        this.body = h('div', { class: 'q-body r-body', on: { click: this.tapGuard.wrap((e) => this._onTap(e)) } },
            h('div', { class: 'q-scene r-scene' }, this.sceneCanvas),
            quip?.text ? h('p', { class: 'r-quip', text: quip.text }) : null,
            h('ul', { class: 'r-lines', 'aria-live': 'polite' }, this.lineEls),
            this.boardEl);

        this.nextBtn = h('button', { class: 'btn btn-gold q-run r-next', type: 'button', text: 'NEXT',
            on: { click: this.tapGuard.wrap(() => this._advance()) } });
        this.el.append(head, this.body, h('footer', { class: 'q-footer' }, this.nextBtn));
        return this.el;
    }

    mount() {
        this.tapGuard.arm();
        if (!this.data) return;
        const { run } = this.data;
        const env = this.env;
        this.meter = new CashMeter(this.meterHost, { currency: run.baseCurrency, env });
        const shape = { startingCash: run.startingCash, redLine: run.redLine };
        this.meter.set({ cash: this.cashBefore, ...shape });
        this.meter.set({ cash: run.cash, ...shape }, METER_MS);

        const industryId = run.industryId;
        const sceneState = sceneStateFor(run);
        try {
            this.scene = new SceneLoop(this.sceneCanvas, () => ({ industryId, sceneState }), env);
            this.scene.start();
        } catch (err) {
            console.warn('ResultScreen: scene unavailable', err);
            this.scene = null;
        }
        this._drawSprite();

        this.lineEls.forEach((el, i) => this._after(LINE_START_MS + i * LINE_STEP_MS, () => { el.hidden = false; }));
        const boardAt = LINE_START_MS + Math.max(0, this.lineEls.length - 1) * LINE_STEP_MS + BOARD_AFTER_MS;
        this._after(boardAt, () => this._revealAll());
    }

    unmount() {
        this._teardown();
    }

    // ── Internals ─────────────────────────────────────────────────────────

    _onTap(e) {
        if (e?.target?.closest?.('.r-next')) return;
        if (!this.revealed) this._revealAll();
        else this._advance();
    }

    _revealAll() {
        if (this.revealed || !this.el) return;
        this.revealed = true;
        for (const el of this.lineEls) el.hidden = false;
        this.boardEl.hidden = false;
        if (this.avatarEl) paintAvatar(this.avatarEl, this.avatarEl.getAttribute('data-avatar'), this.moodAfter);
    }

    _advance() {
        if (this.done || !this.data) return;
        this.done = true;
        this._clearTimers();
        if (isRunOver(this.data.run)) {
            this.app.gameOverMode = 'simple';
            this.app.showScreen('gameover');
        } else {
            this.app.showScreen('quarter');
        }
    }

    _after(ms, fn) {
        const set = this.env.setTimeout || ((f, t) => globalThis.setTimeout(f, t));
        this.timers.push(set(() => { if (!this.done) fn(); }, ms));
    }

    _clearTimers() {
        const clear = this.env.clearTimeout || (id => globalThis.clearTimeout(id));
        for (const id of this.timers) clear(id);
        this.timers = [];
    }

    _drawSprite() {
        if (!this.spriteCanvas || !this.spriteId) return;
        try {
            const ctx = this.spriteCanvas.getContext('2d');
            if (!ctx) return;
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, 64, 64);
            drawSprite(ctx, this.spriteId, this.expression, 0, 0, SPRITE_SCALE);
        } catch (err) {
            console.warn('ResultScreen: sprite unavailable', err);
        }
    }

    _teardown() {
        this._clearTimers();
        if (this.scene) this.scene.stop();
        this.scene = null;
        if (this.meter) this.meter.destroy();
        this.meter = null;
        this.spriteCanvas = null;
        this.avatarEl = null;
    }
}
