// Game over (v3), for Simple and Pro. Shows how the run ended, counts the score up with its title, reveals the
// hidden start year with its fact, plays the personal-best cutscene and then the bankrupt or fired one, shows the
// leaderboard rank (or that the score is queued), lists new unlocks, and offers PLAY AGAIN and SHARE.
//
// Mode: app.gameOverMode, set to 'simple' by the result screen and 'pro' by the Pro game loop.
//   Simple: app.runController.run (finished) and its finish() outcome (RunController saved, queued and submits it).
//   Pro (R6): gameState.get().proResult = { mode:'pro', status, score, history }. The headline is keyed on
//   proResult.status, the title comes from scorePro(state, quips.gameOverTitles), and this screen records the
//   run (progress, score queue) and submits it with mode 'pro', once per game.
// No innerHTML: the DOM is built node by node with textContent (R7).

import { gameState } from '../engine/GameState.js';
import { isRunOver } from '../engine/sim/SimEngine.js';
import { scorePro } from '../engine/sim/proAdapter.js';
import { applyRunToProgress } from '../engine/sim/progress.js';
import { CRISES } from '../engine/sim/crises.js';
import { h } from '../ui/dom.js';
import { badgeLabel, unlockLabel } from '../ui/labels.js';
import { playCutscene as realPlayCutscene } from '../ui/pixel/Cutscene.js';
import { soundFX } from '../ui/SoundFX.js';
import { cosmeticRng } from './simple/RunController.js';
import { startRun } from './simple/IndustryScreen.js';
import { createTapGuard } from '../ui/tapGuard.js';
import * as realApi from '../utils/api.js';
import * as realStorage from '../utils/storage.js';

export const COUNT_MS = 1500;           // score count-up
const ENDING_SALT = 30;                 // cosmetic RNG salt for the ending quip (RunController uses 0..9, B2 20..28)
const SHARE_URL = 'https://competition.hedj.eu';

const fmt = n => Math.round(n).toLocaleString('en-GB');
const sameEmail = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const STORAGE_FAILED = "Your score couldn't be saved on this device";

// How the run ended. Bankrupt: out of cash. Fired: the board's confidence collapsed, or one severe off-policy loss.
export function endingFor(status, severe = false) {
    if (status === 'bankrupt') {
        return { headline: 'BANKRUPT', sub: 'Out of cash. The bank has called, and the CFO has been replaced.', cutscene: 'bankrupt' };
    }
    if (status === 'fired') {
        return severe
            ? { headline: 'FIRED', sub: 'One severe off-policy loss, and the board acted at once.', cutscene: 'fired' }
            : { headline: 'FIRED', sub: "The board's confidence in your results collapsed.", cutscene: 'fired' };
    }
    return { headline: 'RUN COMPLETE', sub: 'You made it through all 8 quarters.', cutscene: null };
}

// A bankrupt or fired quip. Quips about a single bet only fit the severe firing.
export function endingQuip(quips, status, severe, rng) {
    const list = status === 'bankrupt' ? quips?.bankrupt : status === 'fired' ? quips?.fired : null;
    if (!Array.isArray(list) || !list.length) return '';
    let pool = list;
    if (status === 'fired') {
        const aboutBet = list.filter(l => /\bbet\b/i.test(l));
        pool = severe ? aboutBet : list.filter(l => !/\bbet\b/i.test(l));
        if (!pool.length) pool = list;
    }
    return rng.pick(pool);
}

// The leaderboard line for a ranked run's outcome: { rank, queued, storageFailed, pending?, notRegistered? }.
export function rankText(o) {
    if (!o) return '';
    const parts = [];
    if (o.pending) parts.push('Submitting your score…');
    else if (Number.isFinite(o.rank)) parts.push(`Rank #${o.rank} on the leaderboard`);
    else if (o.queued) parts.push('Queued, will submit when online');
    else if (o.notRegistered) parts.push('Register to get on the leaderboard');
    else if (!o.storageFailed) parts.push('Score submitted');
    if (o.storageFailed) parts.push(STORAGE_FAILED);
    return parts.join('. ');
}

// Crisis runs are unranked (R31): a badge line only, plus the storage warning if the progress didn't save.
function crisisText(view) {
    const label = badgeLabel(view.crisisId);
    const badge = view.status === 'complete'
        ? `Crisis badge earned: ${label}`
        : `Crisis runs aren't ranked. Survive all 8 quarters of ${label} to earn its badge`;
    return view.outcome?.storageFailed ? `${badge}. ${STORAGE_FAILED}` : badge;
}

export class GameOverScreen {
    // deps (tests): playCutscene, sound, fetch, clipboard, api, storage, env (requestAnimationFrame,
    // cancelAnimationFrame, now, matchMedia for the count-up).
    constructor(app, deps = {}) {
        this.app = app;
        this.deps = deps;
        this.el = null;
        this.view = null;
        this.yearFacts = null;
        this.proRecords = new Map();   // gameId -> record: a Pro run is recorded and submitted once
        this.token = null;
        this.countHandle = null;
        this.busy = false;        // PLAY AGAIN is starting a run
        this.navigated = false;   // PLAY AGAIN or TITLE has been chosen; the other is then ignored
        this.tapGuard = createTapGuard({ now: this.env.now });
    }

    get api() { return this.deps.api || realApi; }
    get storage() { return this.deps.storage || realStorage; }
    get env() { return this.deps.env || {}; }

    // Loads data/year-facts.json once.
    async loadYearFacts() {
        if (this.yearFacts) return;
        try {
            const resp = await (this.deps.fetch || globalThis.fetch)('data/year-facts.json');
            const data = await resp.json();
            this.yearFacts = data.yearFacts || {};
        } catch (e) {
            console.warn('Could not load year facts:', e);
            this.yearFacts = {};
        }
    }

    render() {
        this._stop();
        this.busy = false;
        this.navigated = false;
        this.view = this._buildView();
        this.el = h('div', { class: 'screen active v3 go-screen' });
        if (!this.view) {
            this.el.append(h('div', { class: 'v3-empty' },
                h('p', { text: 'No finished run to show.' }),
                h('button', { class: 'btn btn-gold q-back', type: 'button', text: 'BACK TO TITLE',
                    on: { click: () => this.app.showScreen('title') } })));
            return this.el;
        }
        const v = this.view;
        const ending = endingFor(v.status, v.severe);
        const quip = endingQuip(this.app.content?.quips, v.status, v.severe, cosmeticRng(v.seed || 0, ENDING_SALT));
        const titleLine = (this.app.content?.quips?.gameOverTitles || []).find(t => t.title === v.title)?.line || '';
        const crisis = v.crisisId ? CRISES.find(c => c.id === v.crisisId) : null;
        const unlocks = (v.newlyUnlocked || []).map(id => unlockLabel(id, this.app.content || {}));

        this.cutsceneEl = h('div', { class: 'go-cutscene', hidden: true });
        this.scoreEl = h('p', { class: 'go-score', text: '0' });
        this.rankEl = h('p', { class: 'go-rank', 'aria-live': 'polite' });
        this.yearHeadlineEl = h('p', { class: 'go-year-headline' });
        this.yearFactEl = h('p', { class: 'go-year-fact' });
        this.yearNoteEl = h('p', { class: 'go-year-note' });
        this.yearEl = h('section', { class: 'go-year', hidden: true },
            h('h2', { class: 'go-year-title', text: `Your hidden year was ${v.startYear}` }),
            this.yearHeadlineEl, this.yearFactEl, this.yearNoteEl);

        const body = h('div', { class: 'v3-body go-body' },
            h('section', { class: `go-ending is-${v.status}` },
                h('h1', { class: 'go-headline', text: ending.headline }),
                h('p', { class: 'go-sub', text: ending.sub }),
                quip ? h('p', { class: 'go-quip', text: quip }) : null),
            h('section', { class: 'go-scorebox', 'aria-label': 'Score' },
                h('p', { class: 'go-company', text: [v.industryName, crisis?.label].filter(Boolean).join(' · ') }),
                this.scoreEl,
                h('p', { class: 'go-title', text: v.title || '' }),
                titleLine ? h('p', { class: 'go-title-line', text: titleLine }) : null),
            h('p', { class: 'go-pb', text: 'New personal best!', hidden: !v.isPersonalBest }),
            this.rankEl,
            h('section', { class: 'go-unlocks', hidden: unlocks.length === 0 },
                h('h2', { text: 'Unlocked' }),
                h('ul', {}, unlocks.map(label => h('li', { text: label })))),
            this.yearEl,
            v.status !== 'complete'
                ? h('p', { class: 'go-hedj' }, 'Lucky this was a simulation. ',
                    h('a', { href: 'https://www.hedj.eu', target: '_blank', rel: 'noopener', text: 'See how Hedj can help' }))
                : null);

        this.againBtn = h('button', { class: 'btn btn-gold q-run go-again', type: 'button', text: 'PLAY AGAIN',
            on: { click: this.tapGuard.wrap(() => this._playAgain()) } });
        const footer = h('footer', { class: 'q-footer go-footer' },
            this.againBtn,
            h('div', { class: 'go-row' },
                h('button', { class: 'btn go-share', type: 'button', text: 'SHARE', on: { click: this.tapGuard.wrap(() => this._share()) } }),
                h('button', { class: 'btn go-home', type: 'button', text: 'TITLE', on: { click: this.tapGuard.wrap(() => this._home()) } })));

        this.el.append(this.cutsceneEl, body, footer);
        this._paintRank();
        return this.el;
    }

    mount() {
        this.tapGuard.arm();
        if (!this.view) return;
        const v = this.view;
        const token = this.token = {};
        const sound = this.deps.sound || soundFX;
        try {
            if (v.status === 'fired') sound.fired();
            else sound.gameOver();
        } catch { /* sound is cosmetic */ }

        if (v.pending) {
            v.pending.then((o) => {
                if (this.token !== token || !o) return;
                v.outcome = { ...o, pending: false };
                this._paintRank();
            }, () => {});
        }

        const scenes = [];
        if (v.isPersonalBest) scenes.push('personalBest');
        const ending = endingFor(v.status, v.severe).cutscene;
        if (ending) scenes.push(ending);
        this._playCutscenes(scenes, token).then(() => {
            if (this.token !== token) return;
            this._countUp(v.total, token);
            this._revealYear(token);
        });
    }

    unmount() {
        this._stop();
    }

    // ── Views ─────────────────────────────────────────────────────────────

    _buildView() {
        const mode = this.app.gameOverMode;
        const rc = this.app.runController;
        const simpleReady = !!rc?.run && isRunOver(rc.run);
        const proReady = gameState.get()?.proResult?.mode === 'pro';
        if (mode === 'pro' || (!mode && !simpleReady)) return proReady ? this._proView() : null;
        return simpleReady ? this._simpleView(rc) : null;
    }

    _simpleView(rc) {
        const run = rc.run;
        let pending = null;
        try {
            pending = rc.finish();
        } catch (err) {
            console.error('GameOverScreen: finish failed', err);
        }
        const o = rc.outcome;
        if (!o) return null;
        const industry = (this.app.content?.industries || []).find(i => i.id === run.industryId);
        return {
            mode: 'simple', status: run.status, severe: !!run.history.at(-1)?.severe, seed: run.seed,
            total: o.score, title: o.title, industryId: run.industryId, industryName: industry?.name || '',
            crisisId: run.crisisId || null, startYear: run.startYear,
            isPersonalBest: !!o.isPersonalBest, newlyUnlocked: o.newlyUnlocked || [], ranked: o.ranked !== false,
            outcome: { ...o, pending: !!pending }, pending
        };
    }

    _proView() {
        const state = gameState.get();
        const pr = state.proResult;
        const scored = scorePro(state, this.app.content?.quips?.gameOverTitles || []);
        const total = Number.isFinite(pr.score?.total) ? pr.score.total : scored.total;
        const record = this._recordPro(state, pr, total);
        return {
            mode: 'pro', status: pr.status, severe: !!(pr.history || []).at(-1)?.severe, seed: state.seed,
            total, title: scored.title, industryId: state.industryId, industryName: state.industry?.name || '',
            crisisId: null, startYear: state.startYear,
            isPersonalBest: record.isPersonalBest, newlyUnlocked: record.newlyUnlocked, ranked: true,
            outcome: { ...record.outcome, pending: !!record.pending && !record.settled },
            pending: record.settled ? null : record.pending
        };
    }

    // Pro: apply progress, queue the score and submit it, once per game. The pending promise never rejects.
    // The run is credited to its owner (state.contactEmail, set at Pro setup), and only while that owner is the
    // registered player, so a run is never recorded or submitted under someone else's registration.
    _recordPro(state, pr, total) {
        const key = state.gameId || `pro-${state.startedAt}`;
        if (this.proRecords.has(key)) return this.proRecords.get(key);
        const storage = this.storage;
        const api = this.api;
        const reg = storage.getRegistration();
        const email = sameEmail(state.contactEmail, reg?.email) ? reg.email : null;
        const record = { isPersonalBest: false, newlyUnlocked: [], outcome: null, pending: null, settled: false };
        this.proRecords.set(key, record);
        if (!email) {
            record.outcome = { ranked: true, rank: null, queued: false, storageFailed: false, notRegistered: true };
            return record;
        }

        let storageFailed = false;
        const { progress, newlyUnlocked, isPersonalBest } = applyRunToProgress(storage.getProgress(email), {
            mode: 'pro', score: total, chairmenMet: [], crisisId: null, status: pr.status
        });
        if (storage.saveProgress(email, progress) === false) storageFailed = true;
        record.isPersonalBest = isPersonalBest;
        record.newlyUnlocked = newlyUnlocked;

        const payload = {
            gameId: key, email, mode: 'pro', score: total,
            quartersPlayed: Math.min(8, Math.max(1, (pr.history || []).length)),
            startedAt: state.startedAt, industryId: state.industryId
        };
        if (reg.playerName) payload.playerName = reg.playerName;
        const queued = storage.queueScore(payload) !== false;
        if (!queued) storageFailed = true;
        record.outcome = { ranked: true, rank: null, queued, storageFailed };

        record.pending = (async () => {
            const result = { ...record.outcome };
            try {
                const res = await api.submitScore(payload);
                storage.removeQueuedScore(payload.gameId);
                result.queued = false;
                if (res && !res.duplicate && Number.isFinite(res.rank)) result.rank = res.rank;
            } catch {
                // Offline or rejected: it stays queued and flushScoreQueue retries it.
            }
            Promise.resolve().then(() => api.flushScoreQueue?.()).catch(() => {});
            // Only while the same player is registered, so the progress is never sent with someone else's token.
            if (sameEmail(storage.getRegistration()?.email, email)) {
                Promise.resolve().then(() => api.putRemoteProgress?.(progress)).catch(() => {});
            }
            record.outcome = result;
            record.settled = true;
            return result;
        })();
        return record;
    }

    // ── Sequence ──────────────────────────────────────────────────────────

    // Plays the cutscenes one after another in the overlay (sized by CSS), then hides it.
    async _playCutscenes(ids, token) {
        if (!ids.length) return;
        const play = this.deps.playCutscene || realPlayCutscene;
        this.cutsceneEl.hidden = false;
        for (const id of ids) {
            if (this.token !== token) return;
            try {
                await play(this.cutsceneEl, id, { industryId: this.view.industryId });
            } catch { /* cosmetic */ }
        }
        if (this.token === token && this.cutsceneEl) this.cutsceneEl.hidden = true;
    }

    _countUp(total, token) {
        const env = this.env;
        const raf = env.requestAnimationFrame || globalThis.requestAnimationFrame;
        const now = env.now || (() => (globalThis.performance?.now ? globalThis.performance.now() : Date.now()));
        const mm = env.matchMedia || (typeof globalThis.matchMedia === 'function' ? q => globalThis.matchMedia(q) : null);
        let reduced = false;
        try { reduced = !!mm?.('(prefers-reduced-motion: reduce)')?.matches; } catch { /* default motion */ }
        const show = n => { if (this.scoreEl) this.scoreEl.textContent = fmt(n); };
        if (!raf || reduced || !(total > 0)) {
            show(total || 0);
            return;
        }
        const t0 = now();
        const frame = () => {
            this.countHandle = null;
            if (this.token !== token) return;
            const p = Math.min(1, (now() - t0) / COUNT_MS);
            show(total * (1 - (1 - p) ** 3));
            if (p < 1) this.countHandle = raf(frame);
        };
        this.countHandle = raf(frame);
    }

    async _revealYear(token) {
        await this.loadYearFacts();
        if (this.token !== token || !this.yearEl) return;
        const fact = this.yearFacts[String(this.view.startYear)];
        this.yearHeadlineEl.textContent = fact?.headline || 'A year in the markets';
        this.yearFactEl.textContent = fact?.fact || `Your run started in ${this.view.startYear}. The markets told their own story.`;
        this.yearNoteEl.textContent = fact?.market_note || '';
        this.yearNoteEl.hidden = !fact?.market_note;
        this.yearEl.hidden = false;
    }

    _paintRank() {
        if (!this.rankEl || !this.view) return;
        const v = this.view;
        this.rankEl.textContent = v.crisisId || !v.ranked ? crisisText(v) : rankText(v.outcome);
    }

    // ── Actions ───────────────────────────────────────────────────────────

    _shareText() {
        const v = this.view;
        const as = v.title ? ` as ${v.title}` : '';
        const where = v.industryName ? ` at ${v.industryName}` : '';
        return `I scored ${fmt(v.total)}${as}${where} in Hedj's treasury game. Can you beat it? ${SHARE_URL}`;
    }

    _share() {
        if (!this.view) return;
        const text = this._shareText();
        const clipboard = this.deps.clipboard || globalThis.navigator?.clipboard;
        const fail = () => this.app.showToast?.("Couldn't copy. Try a screenshot instead", 'info');
        if (!clipboard?.writeText) {
            fail();
            return;
        }
        Promise.resolve()
            .then(() => clipboard.writeText(text))
            .then(() => this.app.showToast?.('Score copied. Paste it anywhere', 'success'), fail);
    }

    // Simple: a new run of the same industry (the same crisis for a crisis run), straight to its first quarter.
    // An expired or missing token goes through showScreen('industry'), whose gate sends the player to register.
    // Pro: back to the Pro setup (showScreen applies the same gate).
    _playAgain() {
        if (this.busy || this.navigated || !this.view) return;
        const v = this.view;
        if (v.mode === 'pro') {
            this.navigated = true;
            gameState.reset();
            this.app.showScreen('setup');
            return;
        }
        const reg = this.storage.getRegistration();
        if (!reg || reg.gameTokenExpiry < Date.now()) {   // the same test as main.js showScreen's gate
            this.navigated = true;
            this.app.showScreen('industry');
            return;
        }
        this.busy = true;
        this.againBtn.disabled = true;
        const token = this.token;
        Promise.resolve()
            .then(() => startRun(this.app, v.industryId, v.crisisId ? { crisisId: v.crisisId } : {}))
            .then(() => {
                // TITLE chosen, or the screen left, while the run was starting: don't pull the player back.
                if (this.navigated || this.token !== token) return;
                this.navigated = true;
                this.app.showScreen('quarter');
            })
            .catch((err) => {
                console.error('GameOverScreen: could not start a new run', err);
                this.busy = false;
                if (this.againBtn) this.againBtn.disabled = false;
                if (!this.navigated && this.token === token) {
                    this.app.showToast?.("Couldn't start a new run. Try again", 'error');
                }
            });
    }

    _home() {
        if (this.navigated) return;
        this.navigated = true;
        if (this.view?.mode === 'pro') gameState.reset();
        this.app.showScreen('title');
    }

    _stop() {
        this.token = null;
        if (this.countHandle !== null && this.countHandle !== undefined) {
            const caf = this.env.cancelAnimationFrame || globalThis.cancelAnimationFrame;
            try { caf?.(this.countHandle); } catch { /* ignore */ }
        }
        this.countHandle = null;
    }
}
