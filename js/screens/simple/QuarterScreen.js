// QuarterScreen: one Simple-mode quarter. The player sets a hedge dial per exposure, answers any pending event,
// optionally proposes a policy (no-policy board) and buys a power-up, then taps RUN THE QUARTER.
// Everything goes through app.runController (B1); the result goes to app.lastQuarter and the 'result' route.
// No innerHTML: the DOM is built node by node with textContent.

import { h } from '../../ui/dom.js';
import { CashMeter } from '../../ui/CashMeter.js';
import { HedgeDial } from '../../ui/HedgeDial.js';
import { SceneLoop } from '../../ui/pixel/Scene.js';
import { drawSprite, CHAIRMAN_SPRITES, spriteIdForMember } from '../../ui/pixel/sprites.js';
import {
    activeExposures, coverInPolicy, isRunOver, policyCover, POLICY_OPTIONS, quarterStartRates
} from '../../engine/sim/SimEngine.js';
import {
    applyPowerUp, forecastVariance, hedgeCap, isHedgeable, maxHedgeRatio, powerUpCost, POWER_UP_IDS
} from '../../engine/sim/powerUps.js';
import { bandText, chairmanFor, cosmeticRng } from './RunController.js';
import {
    exposureTitle, exposureCopy, exposureRisk, exposureSizeText, forecastRangeText, lockedReason
} from '../../ui/labels.js';
import { RiskMeter, coverPercent } from '../../ui/RiskMeter.js';
import { formatCash } from '../../utils/formatters.js';
import { createTapGuard } from '../../ui/tapGuard.js';
import { chartSeries, chartInverted, mountPriceChart } from '../../ui/PriceChart.js';
import { avatarMood } from '../../engine/sim/avatarMood.js';
import { avatarCanvas, moodLabel, storedAvatar } from './AvatarPicker.js';

export const OFF_POLICY_PROMPT = "Outside the board's policy. Run anyway?";
const EVENT_FIRST = 'Choose how to respond to the event first';
const NUDGE_SALT = 20;   // RunController uses cosmetic salts 0..9
const SPRITE_SCALE = 2;  // 32px sprites drawn at 64px
export const AVATAR_PX = 48;   // the player's character beside the cash meter (v3.1)
const PERSONALITIES = ['aggressive', 'cautious', 'operational'];
// Board mood below this shows in red (quarter and result screens).
export const LOW_MOOD = 30;
// v3.2: the cash meter's slide to the cash after a picked add-on (and back when it is dropped).
export const PREVIEW_MS = 400;

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

// The board's policy check for these decisions, judged exactly as SimEngine will (v3.1): the engine's own
// policyCover on the run as it will be this quarter (a power-up bought now, the chosen event response's volumes, and
// the start rates with the engine's seeding). { cover, wrongFocus, values, inPolicy }; inPolicy is always true on a
// no-policy board.
export function policyCheck(run, decisions, events = [], market = null) {
    const preview = previewRun(run, decisions.buyPowerUp);
    const event = run.pendingEvent ? events.find(e => e.id === run.pendingEvent) : null;
    const mult = event?.choices?.find(c => c.id === decisions.eventChoice)?.effects?.notionalMult || {};
    let rates = preview.rates;
    if (market?.getRate) {
        try {
            rates = quarterStartRates(preview, market);
        } catch (err) {
            console.warn('QuarterScreen: start rates unavailable', err);
        }
    }
    const coverage = policyCover({ ...preview, rates }, decisions.hedges || {}, mult);
    return { ...coverage, inPolicy: coverInPolicy(run.mandate, coverage), notionalMult: mult };
}

// The status line for the policy check: why it is off, "Inside the board's policy", or nothing without a policy.
// A noHedge board's only rule is "no hedging", so any cover is simply off (the engine reports no wrong focus there).
function policyStatus(run, check) {
    if (!run.mandate) return '';
    if (check.inPolicy) return "Inside the board's policy";
    if (run.mandate.max === 0) return 'Off policy: board wants 0%';
    if (check.wrongFocus) return 'Off policy: big exposure under-hedged';
    return `Off policy: ${coverPercent(check.cover, run.mandate)}% of risk covered, board wants ${bandText(run.mandate)}`;
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

// The cash meter's host with the player's character beside it (v3.1), or the host alone when no character is
// stored (a run saved before characters existed). `mood` is avatarMood() of the state to show.
export function withAvatar(meterHost, mood) {
    const id = storedAvatar();
    if (!id) return meterHost;
    return h('div', { class: 'q-cash-row' }, avatarCanvas(id, mood, AVATAR_PX, 'av-face', moodLabel(mood)), meterHost);
}

function policyText(run) {
    if (run.boardType === 'none' || !run.mandate) return 'No hedging policy yet';
    if (run.boardType === 'noHedge') return 'Board policy: no hedging (0%)';
    return `Board policy: cover ${bandText(run.mandate)} of your risk`;
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
        this.sparks = [];
        this.charts = [];
        this.env = env;
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
        // v3.1: RISK COVERED, full width directly under the cash row; _refresh keeps it in step with the dials.
        this.riskHost = h('div', { class: 'q-risk' });
        this.riskMeter = new RiskMeter(this.riskHost);
        const head = h('header', { class: 'q-head' },
            h('div', { class: 'q-head-row' },
                h('h1', { class: 'q-quarter', text: `Quarter ${run.quarter + 1} of ${run.maxQuarters}` }),
                h('span', { class: `q-mood${run.boardMood < LOW_MOOD ? ' is-low' : ''}`, text: `Board mood ${Math.round(run.boardMood)}` })),
            this.industry ? h('p', { class: 'q-company', text: this.industry.name }) : null,
            withAvatar(this.meterHost, avatarMood(run)),
            this.riskHost);

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
        this.meter = new CashMeter(this.meterHost, { currency: this.run.baseCurrency, env: this.env });
        this.meter.set({ cash: this.run.cash, startingCash: this.run.startingCash, redLine: this.run.redLine });
        this._previewCash(previewRun(this.run, this.decisions.buyPowerUp));
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
        // Sparklines need the card's laid-out width, so they mount here rather than in render().
        for (const { host, series } of this.sparks) {
            try {
                this.charts.push(mountPriceChart(host, { ...series, variant: 'spark', tone: 'neutral', env: this.env }));
            } catch (err) {
                console.warn('QuarterScreen: sparkline unavailable', err);
            }
        }
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

    // A small static trend line of the year up to this quarter's start. Nothing after the start, no labels.
    // v3.2: weekly closes once they have loaded (chart only), otherwise monthly.
    _sparkRow(run, exp) {
        const market = this.rc?.market;
        if (!market?.getDataset) return null;
        let series = null;
        try {
            series = chartSeries(market.getDataset(exp.underlying), run.startYear, run.quarter,
                { upTo: 'start', invert: chartInverted(exp), weekly: market.getWeekly?.(exp.underlying) ?? null });
        } catch (err) {
            console.warn('QuarterScreen: sparkline unavailable', err);
        }
        if (!series) return null;
        const host = h('div', { class: 'exp-spark', 'aria-hidden': 'true' });
        this.sparks.push({ host, series, exposureId: exp.id });
        return host;
    }

    _exposureCard(run, exp) {
        const dialHost = h('div', { class: 'exp-dial' });
        const forecastEl = h('span', { class: 'exp-forecast' });
        // v3.1: the size this quarter (filled in by _refresh, so an event response updates it), above the copy and
        // well clear of the sparkline.
        const sizeEl = h('p', { class: 'exp-size' });
        const card = h('section', { class: 'exp-card', 'data-exposure': exp.id },
            h('div', { class: 'exp-head' },
                h('h2', { class: 'exp-title', text: exposureTitle(exp) }),
                forecastEl),
            sizeEl,
            h('p', { class: 'exp-copy', text: exposureCopy(exp, run.baseCurrency) }),
            h('p', { class: 'exp-risk', text: exposureRisk(exp) }),
            this._sparkRow(run, exp),
            dialHost);
        const dial = new HedgeDial(dialHost, {
            value: this.decisions.hedges[exp.id] ?? 0,
            mandate: run.mandate,
            max: maxHedgeRatio(run, exp),
            lockedReason: lockedReason(exp),
            label: `${exposureTitle(exp)}: share hedged`,
            onChange: v => this._update(d => { d.hedges[exp.id] = v; })
        });
        this.dials.set(exp.id, { dial, exp, forecastEl, sizeEl });
        return card;
    }

    _powerUpSlot(run) {
        const info = this.app.content?.powerups || {};
        let ids = POWER_UP_IDS.filter(id => this.rc.canBuy(id));
        if (this.capConflict && ids.includes('facilities')) ids = ['facilities', ...ids.filter(id => id !== 'facilities')];
        // R51: facilities is the fix but can't be afforded: show it greyed out, with the reason.
        const poor = this.capConflict && !ids.includes('facilities') && this._facilitiesUnaffordable(run);
        if (poor) ids = ['facilities', ...ids];
        // R57: the industry's biggest risk is a commodity book the bank can't hedge yet, so Rate & Commodity
        // Hedging goes first, ahead of R51's facilities, with the industry's one-line hint.
        const riskHint = this._commodityRiskHint(run, ids);
        if (riskHint) ids = ['hedgeAccess', ...ids.filter(id => id !== 'hedgeAccess')];
        if (!ids.length) return null;
        this.powerBtns = ids.map(id => {
            const card = info[id] || {};
            const blurb = id === 'forecasting' && Array.isArray(card.levels)
                ? card.levels[run.forecastLevel] ?? card.blurb
                : card.blurb;
            const hinted = riskHint && id === 'hedgeAccess';
            const urgent = (this.capConflict && id === 'facilities') || hinted;
            const cantAfford = poor && id === 'facilities';
            return h('button', {
                class: `pu-card${urgent ? ' is-urgent' : ''}${cantAfford ? ' is-unaffordable' : ''}`, type: 'button',
                'data-powerup': id, 'aria-pressed': 'false', 'aria-disabled': cantAfford ? 'true' : null,
                on: { click: () => cantAfford || this._update(d => { d.buyPowerUp = d.buyPowerUp === id ? null : id; }) }
            },
            h('span', { class: 'pu-head' },
                h('span', { class: 'pu-name', text: card.name || id }),
                h('span', { class: 'pu-cost', text: formatCash(powerUpCost(run, id), run.baseCurrency) })),
            urgent ? h('span', { class: 'pu-urgent', text: hinted ? riskHint : "Your board's policy needs this" }) : null,
            cantAfford ? h('span', { class: 'pu-reason', text: `Can't afford it yet: you have ${formatCash(run.cash, run.baseCurrency)}` }) : null,
            blurb ? h('span', { class: 'pu-blurb', text: blurb }) : null,
            card.hedjLine ? h('span', { class: 'pu-hedj', text: card.hedjLine }) : null);
        });
        return h('section', { class: 'q-powerups', 'aria-label': 'Power-ups' },
            h('h2', { text: 'Power-up (one per quarter)' }),
            this.powerBtns);
    }

    // The industry's commodityRiskHint (data/industries.json: airline and energy, whose fuel and oil books are their
    // biggest risk) while a commodity exposure is active and Rate & Commodity Hedging is on offer; null otherwise.
    // Once bought, hedgeAccess is no longer offered, so the hint goes away.
    _commodityRiskHint(run, offered) {
        const hint = this.industry?.commodityRiskHint;
        if (!hint || !offered.includes('hedgeAccess')) return null;
        return activeExposures(run).some(e => e.type === 'commodity') ? hint : null;
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
        this._previewCash(preview);

        // v3.1: one policy check drives the sizes, the RISK COVERED meter, the status and the confirm prompt.
        const check = this._check();
        this.coverage = check;
        for (const { exp, sizeEl } of this.dials.values()) {
            // Floating debt shows its principal: the interest weight would reveal the rate level, and so the era.
            const size = exp.type === 'ir'
                ? exp.quarterlyNotional * (check.notionalMult[exp.id] ?? 1)
                : check.values[exp.id];
            sizeEl.textContent = exposureSizeText(exp, size, run.baseCurrency);
            sizeEl.hidden = !sizeEl.textContent;
            sizeEl.classList.toggle('is-locked', !isHedgeable(preview, exp));
        }
        this.riskMeter?.set({
            cover: check.cover, mandate: run.mandate, wrongFocus: check.wrongFocus, warn: check.wrongFocus || !check.inPolicy
        });

        const needsChoice = !!this.event && !d.eventChoice;
        const blocked = this.eventBlocked;
        const off = !check.inPolicy;
        this.runBtn.disabled = needsChoice || blocked || this.busy;
        this.runBtn.hidden = this.confirming;
        this.confirmEl.hidden = !this.confirming;
        let status = '';
        if (blocked) status = "Couldn't load this event";
        else if (needsChoice) status = EVENT_FIRST;
        else status = policyStatus(run, check);
        this.statusEl.textContent = status;
        this.statusEl.classList.toggle('is-warning', !needsChoice && !blocked && off);
    }

    _check() {
        return policyCheck(this.run, this.decisions, this.app.content?.events || [], this.rc?.market);
    }

    // v3.2: how far this quarter's volume may miss its forecast, as the engine draws it: forecastVariance, times the
    // chosen event response's varianceMult. A Cash Forecasting module picked now shows as "±40% → ±27%".
    _forecastText(run, preview) {
        const mult = this.event?.choices?.find(c => c.id === this.decisions.eventChoice)?.effects?.varianceMult ?? 1;
        const now = forecastRangeText(forecastVariance(run) * mult);
        const next = forecastRangeText(forecastVariance(preview) * mult);
        return now === next ? `Forecast ${now}` : `Forecast ${now} → ${next}`;
    }

    // v3.2: the meter shows the cash after a picked add-on (Cash Visibility's cash included), with the change as a
    // tag, and slides back when the pick is dropped. Nothing happens until it is mounted or when the cash is unchanged.
    _previewCash(preview) {
        const run = this.run;
        if (!this.meter || !run || this.meter.value === preview.cash) return;
        this.meter.set({ cash: preview.cash, startingCash: run.startingCash, redLine: run.redLine, deltaFrom: run.cash },
            PREVIEW_MS);
    }

    _onRun() {
        if (this.busy || this.eventBlocked || (this.event && !this.decisions.eventChoice)) return;
        const off = !this._check().inPolicy;
        if (off && !this.confirming) {
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
        for (const c of this.charts || []) c.destroy();
        this.charts = [];
        this.sparks = [];
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
        this.riskMeter = null;
        this.coverage = null;
    }
}
