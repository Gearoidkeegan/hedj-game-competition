// RunController: the hub of Simple mode. It owns the current RunState, autosaves it per player, picks the
// result quip and the board reaction, and finishes the run (progress, score queue, save cleared).
// No DOM here, so it runs under Node tests. Quips and the chairman use a cosmetic SeededRandom derived from
// `run.seed ^ 0xC0FFEE`; the simulation RNG (inside SimEngine) is never touched.

import { createRun, simulateQuarter, isRunOver, activeExposures } from '../../engine/sim/SimEngine.js';
import { maxHedgeRatio, canBuyPowerUp } from '../../engine/sim/powerUps.js';
import { finalScore } from '../../engine/sim/score.js';
import { applyRunToProgress, emptyProgress, mergeProgress, serialiseSave } from '../../engine/sim/progress.js';
import { CRISES } from '../../engine/sim/crises.js';
import { SeededRandom } from '../../utils/random.js';
import { isFinalRejection, rejectionText } from '../../utils/scoreRejection.js';
import { CHAIRMAN_SPRITES, spriteIdForMember } from '../../ui/pixel/sprites.js';

// The chairman speaks instead of a board member in these quarters, and whenever the gap to the benchmark
// this quarter is above CHAIRMAN_DELTA_PCT of starting cash.
export const CHAIRMAN_QUARTERS = Object.freeze([1, 4, 8]);
export const CHAIRMAN_DELTA_PCT = 0.03;
// Board lines the chairman never talks over: the board answering a proposal, and the angry losing-breach line.
export const CHAIRMAN_YIELDS_TO = Object.freeze(['policyAdopted', 'breachLoss']);
// D1 result-quip thresholds, as fractions of starting cash.
export const BIG_MOVE_PCT = 0.02;
export const OVER_HEDGE_FACTOR = 1.15;

const COSMETIC_SALT = 0xC0FFEE;
const PERSONA_SALT = 0;      // the chairman persona: the first draw of SeededRandom(run.seed ^ 0xC0FFEE)
const INTRO_SALT = 9;        // quarters use salts 1..8
const CHAIRMAN_IDS = Object.keys(CHAIRMAN_SPRITES);
const FREE_UNLOCKS = emptyProgress().unlocked;
const PERSONALITIES = ['aggressive', 'cautious', 'operational'];
const ANGRY_KEYS = new Set(['breachLoss', 'noPolicyHedgeLoss', 'redZone', 'moodDown']);
const HAPPY_KEYS = new Set(['policyAdopted', 'moodUp']);

const sum = (lines, field) => (lines || []).reduce((s, l) => s + (Number.isFinite(l[field]) ? l[field] : 0), 0);

// A cosmetic RNG per salt, so the line picked for a quarter is the same after a reload (resume-stable).
export function cosmeticRng(seed, salt = 0) {
    return new SeededRandom((((seed ^ COSMETIC_SALT) >>> 0) + Math.imul(salt, 0x9E3779B1)) >>> 0);
}

function pickLine(rng, lines) {
    return Array.isArray(lines) && lines.length ? rng.pick(lines) : '';
}

// The run's chairman persona (one of CHAIRMAN_SPRITES), fixed by the run seed.
export function chairmanFor(seed) {
    return CHAIRMAN_IDS[Math.floor(cosmeticRng(seed, PERSONA_SALT).next() * CHAIRMAN_IDS.length)];
}

// Board line selection (contract.md, A9). First match wins.
export function boardLineKey(summary, moodBefore) {
    if (summary.policyAdopted) return 'policyAdopted';
    if (summary.policy === 'none') {
        const hedge = sum(summary.lines, 'hedgeImpact');
        return hedge < 0 ? 'noPolicyHedgeLoss' : hedge > 0 ? 'noPolicyHedgeWin' : 'noPolicyNudge';
    }
    if (summary.breach === 'loss') return 'breachLoss';
    if (summary.breach === 'lucky') return 'luckyBreach';
    if (summary.policy === 'in' && summary.marketResult < 0) return 'inPolicyBad';
    if (summary.cashAfter < summary.redLine) return 'redZone';
    return summary.boardMoodAfter >= moodBefore ? 'moodUp' : 'moodDown';
}

// Sprite expression for a board line key. breachLoss is always angry; mixed and mild lines stay neutral.
export function expressionFor(key) {
    if (ANGRY_KEYS.has(key)) return 'angry';
    if (HAPPY_KEYS.has(key)) return 'happy';
    return 'neutral';
}

// Result quip selection (D1 rules, in order). `boom` is a favourable underlying move (Σ exposureImpact) above
// BIG_MOVE_PCT of starting cash that the hedge did not give away.
export function resultQuipKey(summary, startingCash) {
    const big = BIG_MOVE_PCT * startingCash;
    if (sum(summary.lines, 'hedgeImpact') > big) return 'bigSave';
    if (summary.benchmarkDelta - summary.playerDelta > big) return 'bigMiss';
    if ((summary.lines || []).some(l => l.hedgeRatio * l.forecastNotional > OVER_HEDGE_FACTOR * l.realisedNotional)) {
        return 'overHedged';
    }
    if (summary.cashAfter < summary.redLine) return 'nearBankrupt';
    return sum(summary.lines, 'exposureImpact') > big ? 'boom' : 'calm';
}

export function chairmanAppears(summary, startingCash) {
    return CHAIRMAN_QUARTERS.includes(summary.q)
        || Math.abs(summary.playerDelta - summary.benchmarkDelta) > CHAIRMAN_DELTA_PCT * startingCash;
}

// "50–75%", "0%" for the noHedge board, null with no policy.
export function bandText(mandate) {
    if (!mandate) return null;
    const pct = v => `${Math.round(v * 100)}`;
    return mandate.min === mandate.max ? `${pct(mandate.min)}%` : `${pct(mandate.min)}–${pct(mandate.max)}%`;
}

// Client-side only (A9 addendum): pre-A9 progress may lack the free unlocks. merge/normalise stay untouched.
function withFreeUnlocks(progress) {
    return { ...progress, unlocked: [...new Set([...(progress.unlocked || []), ...FREE_UNLOCKS])] };
}

const snapDown = v => Math.floor(v * 4 + 1e-9) / 4;

function policyDefault(run) {
    if (!run.mandate) return 0;
    return Math.round(((run.mandate.min + run.mandate.max) / 2) * 4) / 4;
}


const sameEmail = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

export class RunController {
    // storage: js/utils/storage.js (namespace import); api: js/utils/api.js (or a fake with the same names);
    // market: anything with getRate/getDataset (marketEngine); content: { industries, events, quips, powerups };
    // now: () => ms timestamp.
    //
    // Player identity (R39): the current player is ALWAYS the one in the registration store
    // (storage.getRegistration().email), read at call time. Every public method first checks it; if it no longer
    // matches the player this controller holds, the controller resets itself (run, email, outcome dropped).
    // B2's "Not you?" handler should still call reset() explicitly after clearing the registration.
    constructor({ storage, api = null, market, content, now = () => Date.now() }) {
        if (!storage || !market || !content) throw new Error('RunController needs storage, market and content');
        this.storage = storage;
        this.api = api;
        this.market = market;
        this.content = content;
        this.now = now;
        this.run = null;
        this.email = null;       // the player who owns `run` (always the registered player, or null)
        this.outcome = null;     // the local finish() result, available synchronously once the run ends
        this._finishing = null;
    }

    // Forgets the current run, player and outcome. The player's save stays in storage (they can RESUME later).
    reset() {
        this.run = null;
        this.email = null;
        this.outcome = null;
        this._finishing = null;
    }

    // The registered player's email, or null.
    currentPlayer() {
        return this.storage.getRegistration()?.email || null;
    }

    // ── Run lifecycle ────────────────────────────────────────────────────

    // Starts a new run for the registered player and autosaves it. `seed` is for tests and replays.
    start(industryId, { crisisId = null, seed = null } = {}) {
        this._checkPlayer();
        const email = this.currentPlayer();
        if (!email) throw new Error('RunController.start: no registered player');
        let forcedYear = null;
        if (crisisId) {
            const crisis = CRISES.find(c => c.id === crisisId);
            if (!crisis) throw new Error(`Unknown crisis: ${crisisId}`);
            if (crisis.industryId !== industryId) {
                throw new Error(`Crisis ${crisisId} is played with the ${crisis.industryId} industry, not ${industryId}`);
            }
            forcedYear = crisis.forcedYear;
        }
        const industry = this._industry(industryId);
        const startedAt = this.now();
        const runSeed = Number.isInteger(seed) ? seed >>> 0 : (Math.floor(Math.random() * 0x100000000) ^ startedAt) >>> 0;
        const run = createRun({ industry, seed: runSeed, startedAt, market: this.market, crisisId, forcedYear });
        this.reset();
        this.run = run;
        this.email = email;
        this._save();
        // The admin PLAYS counter (M4): one play per new run, as Pro sends at its start. Fire-and-forget.
        try {
            if (typeof this.api?.trackEvent === 'function') this.api.trackEvent('play');
        } catch {
            // analytics never blocks a run
        }
        return this.run;
    }

    // The registered player's saved run in progress, or null (not registered, no save, a bad save, or a finished
    // one). `email` is optional; when given it must be the registered player, otherwise the result is null.
    // Whenever it returns null the controller is reset, so nothing of an earlier player's run stays reachable.
    resume(email = undefined) {
        this._checkPlayer();
        const current = this.currentPlayer();
        if (!current || (email !== undefined && !sameEmail(email, current))) {
            this.reset();
            return null;
        }
        const run = this.storage.loadRun(current);
        if (!run || isRunOver(run)) {
            if (run) this.storage.clearRun(current);
            this.reset();
            return null;
        }
        this.reset();
        this.run = run;
        this.email = current;
        return run;
    }

    // Dials for the coming quarter. Q1 (and the quarter after a policy is adopted): the band midpoint rounded to
    // a 0.25 step, 0 with no policy or a noHedge policy. Otherwise the previous quarter's applied dials.
    // Always capped by maxHedgeRatio (the 50% line before facilities, 0 for ir/commodity before hedgeAccess).
    currentDecisionsDefaults() {
        const run = this._requireRun();
        const last = run.history[run.history.length - 1];
        const previous = last && !last.policyAdopted
            ? Object.fromEntries(last.lines.map(l => [l.exposureId, l.hedgeRatio]))
            : {};
        const hedges = {};
        for (const exp of activeExposures(run)) {
            const wanted = Object.hasOwn(previous, exp.id) ? previous[exp.id] : policyDefault(run);
            hedges[exp.id] = snapDown(Math.min(wanted, maxHedgeRatio(run, exp)));
        }
        return { hedges, buyPowerUp: null, eventChoice: null, proposePolicy: null };
    }

    // Plays one quarter. Autosaves while the run continues; on the last quarter calls finish() and returns its
    // promise as `finished` (null otherwise). If finish() throws, the quarter's result is still returned, with
    // `finished: null` and the error in `finishError`.
    playQuarter(decisions) {
        const run = this._requireRun();
        if (isRunOver(run)) throw new Error(`Run is over (${run.status})`);
        const buy = decisions?.buyPowerUp;
        if (buy && !this.canBuy(buy)) throw new Error(`Cannot buy power-up ${buy}`);

        const { run: next, summary } = simulateQuarter(run, decisions, this.market, { events: this.content.events || [] });
        const rng = cosmeticRng(run.seed, summary.q);
        const quipKey = resultQuipKey(summary, run.startingCash);
        const quip = { key: quipKey, text: pickLine(rng, this.content.quips?.result?.[quipKey]) };
        const boardReaction = this._boardReaction(next, summary, run.boardMood, rng);
        if (boardReaction.chairmanId && !next.chairmenMet.includes(boardReaction.chairmanId)) {
            next.chairmenMet = [...next.chairmenMet, boardReaction.chairmanId];
        }

        this.run = next;
        const over = isRunOver(next);
        if (!over) this._save();
        const pendingEvent = next.pendingEvent
            ? (this.content.events || []).find(e => e.id === next.pendingEvent) ?? null
            : null;
        const result = { run: next, summary, quip, boardReaction, pendingEvent, finished: null };
        if (over) {
            try {
                result.finished = this.finish();
            } catch (err) {
                console.error('RunController.finish failed:', err);
                result.finishError = err;
            }
        }
        return result;
    }

    // Applies progress, clears the save and (unless a crisis run) queues the score, all synchronously; then
    // tries to submit it. Resolves to { score, title, breakdown, newlyUnlocked, isPersonalBest, rank, queued,
    // ranked, storageFailed }. Never rejects on network errors. Idempotent: later calls return the same promise.
    finish() {
        const run = this._requireRun();
        if (this._finishing) return this._finishing;
        if (!isRunOver(run)) throw new Error('Run is still in progress');
        const email = this.email;

        const s = finalScore(
            { history: run.history, status: run.status, startingCash: run.startingCash, boardMood: run.boardMood },
            this.content.quips?.gameOverTitles || []
        );
        const { progress, newlyUnlocked, isPersonalBest } = applyRunToProgress(this.progress(), {
            mode: 'simple', score: s.total, chairmenMet: run.chairmenMet, crisisId: run.crisisId, status: run.status
        });
        let storageFailed = false;
        if (this.storage.saveProgress(email, progress) === false) {
            console.warn('RunController: progress could not be saved');
            storageFailed = true;
        }
        this.storage.clearRun(email);

        const ranked = !run.crisisId;
        let payload = null;
        let queued = false;
        if (ranked) {
            const reg = this.storage.getRegistration();
            payload = {
                gameId: run.gameId, email, mode: 'simple', score: s.total, quartersPlayed: run.history.length,
                startedAt: run.startedAt, industryId: run.industryId
            };
            if (reg?.playerName && sameEmail(reg.email, email)) payload.playerName = reg.playerName;
            queued = this.storage.queueScore(payload) !== false;
            if (!queued) {
                console.warn('RunController: score could not be queued');
                storageFailed = true;
            }
        }
        this.outcome = {
            score: s.total, title: s.title, breakdown: s.breakdown, newlyUnlocked, isPersonalBest,
            rank: null, queued, ranked, storageFailed
        };
        this._finishing = this._submit({ ...this.outcome }, payload, progress, { email, gameId: run.gameId });
        return this._finishing;
    }

    // ── Progress and power-ups ───────────────────────────────────────────

    // The registered player's local progress, with the free unlocks. Free unlocks only when nobody is registered.
    progress() {
        this._checkPlayer();
        const email = this.currentPlayer();
        return withFreeUnlocks(email ? this.storage.getProgress(email) : emptyProgress());
    }

    // Merges the server's progress into the registered player's local progress and saves it under that player.
    // Reads, merges and writes only for the player registered when it started; if the player changes while the
    // request is in flight, nothing is written. Falls back to the local progress when offline or not registered.
    async syncProgress() {
        const local = this.progress();
        const email = this.currentPlayer();
        if (!email || typeof this.api?.getRemoteProgress !== 'function') return local;
        let remote;
        try {
            remote = await this.api.getRemoteProgress();
        } catch {
            return local;
        }
        if (!sameEmail(this.currentPlayer(), email)) return this.progress();
        if (!remote) return local;
        const merged = withFreeUnlocks(mergeProgress(this.storage.getProgress(email), remote));
        this.storage.saveProgress(email, merged);
        return merged;
    }

    // Power-up ids the player has unlocked ('powerup:facilities' -> 'facilities').
    unlockedPowerUps() {
        return this.progress().unlocked.filter(id => id.startsWith('powerup:')).map(id => id.slice('powerup:'.length));
    }

    // The run in progress for the registered player, or null (R39: goes through the player check, never reads
    // `run` raw). A pending event that is not in the content is dropped (and the drop saved) ONLY when the events
    // loaded successfully (`content.eventsLoaded`), e.g. a resumed save after events.json changed. If the events
    // never loaded the run is left untouched; see `eventMissing()`.
    currentRun() {
        this._checkPlayer();
        if (this.run?.pendingEvent && this.content.eventsLoaded && !this._hasEvent(this.run.pendingEvent)) {
            console.warn(`RunController: dropping unknown pending event ${this.run.pendingEvent}`);
            this.run = { ...this.run, pendingEvent: null };
            this._save();
        }
        return this.run;
    }

    _hasEvent(id) {
        return (this.content.events || []).some(e => e.id === id);
    }

    // True when the run waits on an event whose definition isn't available (content failed to load): retry the load.
    eventMissing() {
        const id = this.run?.pendingEvent;
        return !!id && !this._hasEvent(id);
    }

    // Whether the current run may buy `id` now: unlocked, not owned or used up, offered, affordable.
    canBuy(id) {
        return canBuyPowerUp(this._requireRun(), id, this.unlockedPowerUps());
    }

    // The board's introduction at run start: { boardType, band, line } with {band} filled in.
    boardIntro() {
        const run = this._requireRun();
        const band = bandText(run.mandate);
        const line = pickLine(cosmeticRng(run.seed, INTRO_SALT), this.content.quips?.boardIntro?.[run.boardType]);
        return { boardType: run.boardType, band, line: line.replaceAll('{band}', band ?? '') };
    }

    // ── Internals ────────────────────────────────────────────────────────

    _boardReaction(run, summary, moodBefore, rng) {
        const key = boardLineKey(summary, moodBefore);
        const expression = expressionFor(key);
        const quips = this.content.quips || {};
        const members = this._industry(run.industryId).boardMembers || [];
        const index = members.length ? Math.floor(rng.next() * members.length) : -1;
        const member = index >= 0 ? members[index] : null;
        const personality = PERSONALITIES.includes(member?.personality) ? member.personality : 'operational';

        const chairmanId = chairmanFor(run.seed);
        if (chairmanAppears(summary, run.startingCash) && !CHAIRMAN_YIELDS_TO.includes(key)) {
            return {
                speaker: 'chairman', key, expression, line: pickLine(rng, quips.chairman?.[chairmanId]),
                chairmanId, spriteId: chairmanId, member: null
            };
        }
        return {
            speaker: 'board', key, expression, line: pickLine(rng, quips.board?.[personality]?.[key]),
            chairmanId: null,
            spriteId: member ? spriteIdForMember(member, index) : null,
            member: member
                ? { index, name: member.name, role: member.role, title: member.title, personality }
                : null
        };
    }

    // The network half of finish(). `owner` is the run's player and gameId: the server progress is only written
    // while that player is still the registered one (api.putRemoteProgress uses the current token), and the
    // outcome is only updated while that run is still the controller's run.
    async _submit(result, payload, progress, owner) {
        if (payload && typeof this.api?.submitScore === 'function') {
            try {
                const res = await this.api.submitScore(payload);
                this.storage.removeQueuedScore(payload.gameId);
                result.queued = false;
                if (res && !res.duplicate && Number.isFinite(res.rank)) result.rank = res.rank;
            } catch (err) {
                // Refused for good (R63): drop it and say why. Otherwise (offline, 401, 408, 429, 5xx) it stays
                // queued, and flushScoreQueue retries it.
                if (isFinalRejection(err)) {
                    this.storage.removeQueuedScore(payload.gameId);
                    result.queued = false;
                    result.rejected = true;
                    result.rejectedReason = rejectionText(err.message);
                }
            }
            if (typeof this.api.flushScoreQueue === 'function') {
                Promise.resolve().then(() => this.api.flushScoreQueue()).catch(() => {});
            }
        }
        // Checked and called in the same synchronous step, so the token used is the run owner's.
        if (typeof this.api?.putRemoteProgress === 'function' && sameEmail(this.currentPlayer(), owner.email)) {
            try {
                Promise.resolve(this.api.putRemoteProgress(progress)).catch(() => {});
            } catch {
                // best effort
            }
        }
        if (this.run?.gameId === owner.gameId && sameEmail(this.email, owner.email)) this.outcome = result;
        return result;
    }

    // Resets the controller when the registered player is no longer the player it holds (R39).
    _checkPlayer() {
        if (this.email && !sameEmail(this.currentPlayer(), this.email)) this.reset();
    }

    _save() {
        this.storage.saveRun(this.email, serialiseSave(this.run));
    }

    _industry(id) {
        const industry = (this.content.industries || []).find(i => i.id === id);
        if (!industry) throw new Error(`Unknown industry: ${id}`);
        return industry;
    }

    _requireRun() {
        this._checkPlayer();
        if (!this.run) throw new Error('No run in progress');
        return this.run;
    }
}
