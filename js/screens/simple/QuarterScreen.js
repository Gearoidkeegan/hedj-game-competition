// QuarterScreen: one Simple-mode quarter. The player sets a hedge dial per exposure, answers any pending event,
// optionally proposes a policy (no-policy board) and buys a power-up, then taps RUN THE QUARTER.
// Everything goes through app.runController (B1); the result goes to app.lastQuarter and the 'result' route.
// No innerHTML: the DOM is built node by node with textContent.

import { h } from '../../ui/dom.js';
import { CashMeter } from '../../ui/CashMeter.js';
import { HedgeDial } from '../../ui/HedgeDial.js';
import { SceneLoop } from '../../ui/pixel/Scene.js';
import { drawSprite, CHAIRMAN_SPRITES, spriteIdForMember } from '../../ui/pixel/sprites.js';
import { activeExposures, isRunOver, POLICY_OPTIONS } from '../../engine/sim/SimEngine.js';
import {
    applyPowerUp, forecastAccuracy, hedgeCap, isHedgeable, maxHedgeRatio, powerUpCost, POWER_UP_IDS
} from '../../engine/sim/powerUps.js';
import { bandText, chairmanFor, cosmeticRng } from './RunController.js';
import { exposureTitle, exposureCopy, exposureRisk, lockedReason } from '../../ui/labels.js';
import { formatCash } from '../../utils/formatters.js';
import { createTapGuard } from '../../ui/tapGuard.js';

export const OFF_POLICY_PROMPT = "Outside the board's policy — run anyway?";
const EVENT_FIRST = 'Choose how to respond to the event first';
const NUDGE_SALT = 20;   // RunController uses cosmetic salts 0..9
const SPRITE_SCALE = 2;  // 32px sprites drawn at 64px
const PERSONALITIES = ['aggressive', 'cautious', 'operational'];
// Board mood below this shows in red (quarter and result screens).
export const LOW_MOOD = 30;

const pct = v => `${Math.round(v * 100)}%`;
const clamp01 = v => Math.min(1, Math.max(0, v));

// The run as the engine will see it this quarter: a power-up bought now applies to this quarter's hedges.
export function previewRun(run, buyPowerUp) {
    if (!buyPowerUp) return run;
    try {
        return applyPowerUp(run, buyPowerUp);
    } catch {
        return run;
    }
}

// Active exposures whose hedge would be outside the board's band, judged the way SimEngine judges it:
// the ratio after clamping to the cap, only hedgeable exposures with a non-zero notional (after the chosen event
// response), and nothing at all on a no-policy board.
export function offPolicyExposures(run, decisions, events = []) {
    if (!run?.mandate) return [];
    const preview = previewRun(run, decisions.buyPowerUp);
    const event = run.pendingEvent ? events.find(e => e.id === run.pendingEvent) : null;
    const mult = event?.choices?.find(c => c.id === decisions.eventChoice)?.effects?.notionalMult || {};
    const { min, max } = run.mandate;
    return activeExposures(run).filter(e => {
        const forecast = e.quarterlyNotional * (mult[e.id] ?? 1);
        if (forecast === 0 || !isHedgeable(preview, e)) return false;
        const ratio = Math.min(decisions.hedges?.[e.id] ?? 0, maxHedgeRatio(preview, e));
        return ratio < min || ratio > max;
    });
}

// SceneState for the strip: the mood of last quarter's market result, cash, and the underlying that moved most.
export function sceneStateFor(run) {
    const last = run.history[run.history.length - 1];
    const big = 0.02 * run.startingCash;
    const mood = !last ? 'calm' : last.marketResult < -big ? 'storm' : last.marketResult > big ? 'boom' : 'calm';
    let highlight = null;
    let most = 0;
    for (const l of last?.lines || []) {
        if (Math.abs(l.movePct) > most) {
            most = Math.abs(l.movePct);
            highlight = run.exposures.find(e => e.id === l.exposureId)?.underlying ?? null;
        }
    }
    return { mood, cashLevel: clamp01(run.cash / (1.5 * run.startingCash)), highlight };
}

function policyText(run) {
    if (run.boardType === 'none' || !run.mandate) return 'No hedging policy yet';
    if (run.boardType === 'noHedge') return 'Board policy: no hedging (0%)';
    return `Board policy: hedge ${bandText(run.mandate)} of each exposure`;
}

export class QuarterScreen {
    // env (tests): now, the clock for the tap guard (R53).
    constructor(app, env = {}) {
        this.app = app;
        this.tapGuard = createTapGuard({ now: env.now });
        this.el = null;
        this.scene = null;
        this.meter = null;
        this.dials = new Map();
        this.decisions = null;
        this.confirming = false;
        this.busy = false;
    }

    get rc() { return this.app.runController; }

    render() {
        this._teardown();
        this.el = h('div', { class: 'screen active v3 quarter-screen' });
        const run = this.rc?.currentRun?.();
        if (!run || isRunOver(run)) {
            this.run = null;
            this.el.append(h('div', { class: 'v3-empty' },
                h('p', { text: 'No quarter to play right now.' }),
                h('button', { class: 'btn btn-gold q-back', type: 'button', text: 'BACK TO TITLE',
                    on: { click: () => this.app.showScreen('title') } })));
            return this.el;
        }
        this.run = run;
        this.industry = (this.app.content?.industries || []).find(i => i.id === run.industryId) || null;
        const defaults = this.rc.currentDecisionsDefaults();
        this.decisions = { hedges: { ...defaults.hedges }, buyPowerUp: null, eventChoice: null, proposePolicy: null };
        this.confirming = false;
        this.busy = false;
        this.eventBlocked = false;
        this.event = run.pendingEvent
            ? (this.app.content?.events || []).find(e => e.id === run.pendingEvent) || null
            : null;
        this.canPropose = run.mandate === null && run.quarter < run.maxQuarters - 1;
        // R51: the band starts above what the bank lines allow, so facilities goes first.
        this.capConflict = !!run.mandate && run.mandate.min > hedgeCap(run);

        this.meterHost = h('div', { class: 'q-cash' });
        const head = h('header', { class: 'q-head' },
            h('div', { class: 'q-head-row' },
                h('h1', { class: 'q-quarter', text: `Quarter ${run.quarter + 1} of ${run.maxQuarters}` }),
                h('span', { class: `q-mood${run.boardMood < LOW_MOOD ? ' is-low' : ''}`, text: `Board mood ${Math.round(run.boardMood)}` })),
            this.industry ? h('p', { class: 'q-company', text: this.industry.name }) : null,
            this.meterHost);

        this.sceneCanvas = h('canvas', { class: 'q-scene-canvas', 'aria-hidden': 'true' });
        const body = h('div', { class: 'q-body' },
            h('div', { class: 'q-scene' }, this.sceneCanvas),
            this._boardCard(run),
            h('p', { class: 'q-policy', text: policyText(run) }),
            this.event ? this._eventCard(this.event) : this.rc.eventMissing() ? this._eventErrorCard() : null,
            this.canPropose ? this._proposeCard() : null,
            h('div', { class: 'q-exposures' }, activeExposures(run).map(e => this._exposureCard(run, e))),
            this._powerUpSlot(run));

        this.statusEl = h('p', { class: 'q-status', 'aria-live': 'polite' });
        this.runBtn = h('button', { class: 'btn btn-gold q-run', type: 'button', text: 'RUN THE QUARTER',
            on: { click: this.tapGuard.wrap(() => this._onRun()) } });
        this.confirmEl = h('div', { class: 'q-confirm', role: 'alertdialog', 'aria-label': 'Off policy', hidden: true },
            h('p', { text: OFF_POLICY_PROMPT }),
            h('div', { class: 'q-confirm-row' },
                h('button', { class: 'btn q-adjust', type: 'button', text: 'ADJUST', on: { click: this.tapGuard.wrap(() => this._cancelConfirm()) } }),
                h('button', { class: 'btn btn-gold q-run-anyway', type: 'button', text: 'RUN ANYWAY',
                    on: { click: this.tapGuard.wrap(() => this._play()) } })));
        const footer = h('footer', { class: 'q-footer' }, this.statusEl, this.confirmEl, this.runBtn);

        this.el.append(head, body, footer);
        this._refresh();
        return this.el;
    }

    mount() {
        this.tapGuard.arm();
        if (!this.run) return;
        this.meter = new CashMeter(this.meterHost, { currency: this.run.baseCurrency });
        this.meter.set({ cash: this.run.cash, startingCash: this.run.startingCash, redLine: this.run.redLine });
        const industryId = this.run.industryId;
        const sceneState = sceneStateFor(this.run);
        try {
            this.scene = new SceneLoop(this.sceneCanvas, () => ({ industryId, sceneState }));
            this.scene.start();
        } catch (err) {
            console.warn('QuarterScreen: scene unavailable', err);
            this.scene = null;
        }
        this._drawSprite();
    }

    unmount() {
        this._teardown();
    }

    // The decisions RUN would send now (a copy).
    currentDecisions() {
        const d = this.decisions;
        return {
            hedges: { ...d.hedges },
            buyPowerUp: d.buyPowerUp,
            eventChoice: d.eventChoice,
            proposePolicy: this.canPropose && d.proposePolicy ? { ...d.proposePolicy } : null
        };
    }

    // ── Sections ──────────────────────────────────────────────────────────

    // Q1: the chairman introduces the board's policy. While there is no policy, the board nudges for one.
    _boardCard(run) {
        const quips = this.app.content?.quips || {};
        const members = this.industry?.boardMembers || [];
        const rng = cosmeticRng(run.seed, NUDGE_SALT + run.quarter);
        const index = members.length ? Math.floor(rng.next() * members.length) : -1;
        const member = index >= 0 ? members[index] : null;
        const lines = [];
        let speaker = null;
        if (run.quarter === 0) {
            const id = chairmanFor(run.seed);
            speaker = { spriteId: id, name: CHAIRMAN_SPRITES[id]?.label || 'The Chairman', role: 'Chairman' };
            lines.push(this.rc.boardIntro().line);
        }
        if (run.mandate === null && this.canPropose) {   // no nudge where the proposal can't be made (Q8)
            if (!speaker && member) {
                speaker = { spriteId: spriteIdForMember(member, index), name: member.name, role: member.title };
            }
            const personality = PERSONALITIES.includes(member?.personality) ? member.personality : 'operational';
            const pool = quips.board?.[personality]?.noPolicyNudge || [];
            if (pool.length) lines.push(rng.pick(pool));
        }
        const said = lines.filter(Boolean);
        if (!said.length) return null;
        this.spriteId = speaker?.spriteId || null;
        this.spriteCanvas = h('canvas', { class: 'q-board-sprite', width: '64', height: '64', 'aria-hidden': 'true' });
        return h('section', { class: 'q-board', 'aria-label': 'The board' },
            this.spriteCanvas,
            h('div', { class: 'q-board-text' },
                speaker ? h('p', { class: 'q-board-name', text: `${speaker.name}, ${speaker.role}` }) : null,
                said.map(line => h('p', { class: 'q-board-line', text: line }))));
    }

    _eventCard(event) {
        this.choiceBtns = (event.choices || []).map(c => h('button', {
            class: 'btn q-choice', type: 'button', 'data-choice': c.id, 'aria-pressed': 'false', text: c.label,
            on: { click: () => this._update(d => { d.eventChoice = c.id; }) }
        }));
        return h('section', { class: 'q-event', role: 'group', 'aria-label': 'Event' },
            h('h2', { text: event.title }),
            h('p', { class: 'q-event-text', text: event.text }),
            h('div', { class: 'q-choices' }, this.choiceBtns));
    }

    // The content didn't load, so the pending event can't be shown. Never lock the run: offer a retry.
    _eventErrorCard() {
        this.eventBlocked = true;
        return h('section', { class: 'q-event q-event-error', role: 'group', 'aria-label': 'Event' },
            h('h2', { text: 'Event' }),
            h('p', { class: 'q-event-text', text: "Couldn't load this event. Check your connection." }),
            h('button', { class: 'btn q-retry', type: 'button', text: 'RETRY', on: { click: () => this._retryEvents() } }));
    }

    async _retryEvents() {
        let ok = false;
        try { ok = !!(await this.app.reloadEvents?.()); } catch { ok = false; }
        if (ok) this.app.showScreen('quarter');   // rebuilds the screen with the event
        else this.app.showToast?.("Still can't load the event. Try again.", 'error');
    }

    _proposeCard() {
        this.policyBtns = POLICY_OPTIONS.map(opt => h('button', {
            class: 'btn q-policy-opt', type: 'button', 'aria-pressed': 'false',
            'data-policy': `${opt.min}-${opt.max}`,
            text: opt.max === 0 ? "Don't hedge" : bandText(opt),
            on: { click: () => this._update(d => {
                const same = d.proposePolicy && d.proposePolicy.min === opt.min && d.proposePolicy.max === opt.max;
                d.proposePolicy = same ? null : { min: opt.min, max: opt.max };
            }) }
        }));
        return h('section', { class: 'q-propose', role: 'group', 'aria-label': 'Propose a hedging policy' },
            h('h2', { text: 'Propose a hedging policy' }),
            h('p', { text: 'Until there is a policy, the board judges every hedge on its own profit. Yours starts next quarter.' }),
            h('div', { class: 'q-policy-opts' }, this.policyBtns));
    }

    _exposureCard(run, exp) {
        const dialHost = h('div', { class: 'exp-dial' });
        const forecastEl = h('span', { class: 'exp-forecast' });
        const card = h('section', { class: 'exp-card', 'data-exposure': exp.id },
            h('div', { class: 'exp-head' },
                h('h2', { class: 'exp-title', text: exposureTitle(exp) }),
                forecastEl),
            h('p', { class: 'exp-copy', text: exposureCopy(exp, run.baseCurrency) }),
            h('p', { class: 'exp-risk', text: exposureRisk(exp) }),
            dialHost);
        const dial = new HedgeDial(dialHost, {
            value: this.decisions.hedges[exp.id] ?? 0,
            mandate: run.mandate,
            max: maxHedgeRatio(run, exp),
            lockedReason: lockedReason(exp),
            label: `${exposureTitle(exp)}: share hedged`,
            onChange: v => this._update(d => { d.hedges[exp.id] = v; })
        });
        this.dials.set(exp.id, { dial, exp, forecastEl });
        return card;
    }

    _powerUpSlot(run) {
        const info = this.app.content?.powerups || {};
        let ids = POWER_UP_IDS.filter(id => this.rc.canBuy(id));
        if (this.capConflict && ids.includes('facilities')) ids = ['facilities', ...ids.filter(id => id !== 'facilities')];
        // R51: facilities is the fix but can't be afforded: show it greyed out, with the reason.
        const poor = this.capConflict && !ids.includes('facilities') && this._facilitiesUnaffordable(run);
        if (poor) ids = ['facilities', ...ids];
        if (!ids.length) return null;
        this.powerBtns = ids.map(id => {
            const card = info[id] || {};
            const blurb = id === 'forecasting' && Array.isArray(card.levels)
                ? card.levels[run.forecastLevel] ?? card.blurb
                : card.blurb;
            const urgent = this.capConflict && id === 'facilities';
            const cantAfford = poor && id === 'facilities';
            return h('button', {
                class: `pu-card${urgent ? ' is-urgent' : ''}${cantAfford ? ' is-unaffordable' : ''}`, type: 'button',
                'data-powerup': id, 'aria-pressed': 'false', 'aria-disabled': cantAfford ? 'true' : null,
                on: { click: () => cantAfford || this._update(d => { d.buyPowerUp = d.buyPowerUp === id ? null : id; }) }
            },
            h('span', { class: 'pu-head' },
                h('span', { class: 'pu-name', text: card.name || id }),
                h('span', { class: 'pu-cost', text: formatCash(powerUpCost(run, id), run.baseCurrency) })),
            urgent ? h('span', { class: 'pu-urgent', text: "Your board's policy needs this" }) : null,
            cantAfford ? h('span', { class: 'pu-reason', text: `Can't afford it yet: you have ${formatCash(run.cash, run.baseCurrency)}` }) : null,
            blurb ? h('span', { class: 'pu-blurb', text: blurb }) : null,
            card.hedjLine ? h('span', { class: 'pu-hedj', text: card.hedjLine }) : null);
        });
        return h('section', { class: 'q-powerups', 'aria-label': 'Power-ups' },
            h('h2', { text: 'Power-up (one per quarter)' }),
            this.powerBtns);
    }

    _facilitiesUnaffordable(run) {
        const owned = run.powerUps.owned.includes('facilities') || run.powerUps.used.includes('facilities');
        return !owned && this.rc.unlockedPowerUps().includes('facilities') && run.cash < powerUpCost(run, 'facilities');
    }

    // ── State ─────────────────────────────────────────────────────────────

    _update(mutate) {
        if (this.busy) return;
        mutate(this.decisions);
        this.confirming = false;
        this._refresh();
    }

    _cancelConfirm() {
        this.confirming = false;
        this._refresh();
    }

    // Repaints everything that depends on the decisions.
    _refresh() {
        const run = this.run;
        const d = this.decisions;
        const preview = previewRun(run, d.buyPowerUp);
        for (const { dial, exp, forecastEl } of this.dials.values()) {
            dial.setMax(maxHedgeRatio(preview, exp));   // may pull the value down via onChange -> _update
            forecastEl.textContent = exp.type === 'ir' ? 'Amount known exactly' : this._forecastText(run, preview);
        }
        for (const b of this.choiceBtns || []) b.setAttribute('aria-pressed', String(b.getAttribute('data-choice') === d.eventChoice));
        for (const b of this.policyBtns || []) {
            const p = d.proposePolicy;
            b.setAttribute('aria-pressed', String(!!p && b.getAttribute('data-policy') === `${p.min}-${p.max}`));
        }
        for (const b of this.powerBtns || []) b.setAttribute('aria-pressed', String(b.getAttribute('data-powerup') === d.buyPowerUp));

        const needsChoice = !!this.event && !d.eventChoice;
        const blocked = this.eventBlocked;
        const off = offPolicyExposures(run, d, this.app.content?.events || []);
        this.runBtn.disabled = needsChoice || blocked || this.busy;
        this.runBtn.hidden = this.confirming;
        this.confirmEl.hidden = !this.confirming;
        let status = '';
        if (blocked) status = "Couldn't load this event";
        else if (needsChoice) status = EVENT_FIRST;
        else if (off.length) status = `Off policy: ${off.map(exposureTitle).join(', ')}`;
        else if (run.mandate) status = "Inside the board's policy";
        this.statusEl.textContent = status;
        this.statusEl.classList.toggle('is-warning', !needsChoice && off.length > 0);
    }

    _forecastText(run, preview) {
        const now = pct(forecastAccuracy(run));
        const next = pct(forecastAccuracy(preview));
        return now === next ? `Forecast accuracy ${now}` : `Forecast accuracy ${now} → ${next}`;
    }

    _onRun() {
        if (this.busy || this.eventBlocked || (this.event && !this.decisions.eventChoice)) return;
        const off = offPolicyExposures(this.run, this.decisions, this.app.content?.events || []);
        if (off.length && !this.confirming) {
            this.confirming = true;
            // RUN ANYWAY appears in RUN's footer slot: re-arm so a double tap can't confirm the off-policy quarter.
            this.tapGuard.arm();
            this._refresh();
            return;
        }
        this._play();
    }

    _play() {
        if (this.busy) return;
        this.busy = true;
        this.confirming = false;
        this._refresh();
        let result;
        try {
            result = this.rc.playQuarter(this.currentDecisions());
        } catch (err) {
            console.error('QuarterScreen: playQuarter failed', err);
            this.busy = false;
            this._refresh();
            this.app.showToast?.(`Couldn't run the quarter: ${err.message}`, 'error');
            return;
        }
        this.app.lastQuarter = result;
        this.app.showScreen('result');
    }

    _drawSprite() {
        if (!this.spriteCanvas || !this.spriteId) return;
        try {
            const ctx = this.spriteCanvas.getContext('2d');
            if (!ctx) return;
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, 64, 64);
            drawSprite(ctx, this.spriteId, 'neutral', 0, 0, SPRITE_SCALE);
        } catch (err) {
            console.warn('QuarterScreen: sprite unavailable', err);
        }
    }

    _teardown() {
        if (this.scene) this.scene.stop();
        this.scene = null;
        if (this.meter) this.meter.destroy();
        this.meter = null;
        for (const { dial } of this.dials.values()) dial.destroy();
        this.dials = new Map();
        this.choiceBtns = null;
        this.policyBtns = null;
        this.powerBtns = null;
        this.spriteCanvas = null;
        this.spriteId = null;
    }
}
