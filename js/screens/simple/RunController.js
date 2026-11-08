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

export class RunController {
    // storage: js/utils/storage.js (namespace import); api: js/utils/api.js (or a fake with the same names);
    // market: anything with getRate/getDataset (marketEngine); content: { industries, events, quips, powerups };
    // now: () => ms timestamp.
    constructor({ storage, api = null, market, content, now = () => Date.now() }) {
        if (!storage || !market || !content) throw new Error('RunController needs storage, market and content');
        this.storage = storage;
        this.api = api;
        this.market = market;
        this.content = content;
        this.now = now;
        this.run = null;
        this.email = null;
        this.outcome = null;     // the local finish() result, available synchronously once the run ends
        this._finishing = null;
    }

    // ── Run lifecycle ────────────────────────────────────────────────────

    // Starts a new run for the registered player and autosaves it. `seed` is for tests and replays.
    start(industryId, { crisisId = null, seed = null } = {}) {
        const email = this.storage.getRegistration()?.email;
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
        this.run = createRun({ industry, seed: runSeed, startedAt, market: this.market, crisisId, forcedYear });
        this.email = email;
        this.outcome = null;
        this._finishing = null;
        this._save();
        return this.run;
    }

    // The player's saved run in progress, or null (no save, a bad save, or a finished one).
    resume(email) {
        const run = this.storage.loadRun(email);
        if (!run) return null;
        if (isRunOver(run)) {
            this.storage.clearRun(email);
            return null;
        }
        this.run = run;
        this.email = email;
        this.outcome = null;
        this._finishing = null;
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
    // promise as `finished` (null otherwise).
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
        return { run: next, summary, quip, boardReaction, pendingEvent, finished: over ? this.finish() : null };
    }

    // Applies progress, clears the save and (unless a crisis run) queues the score, all synchronously; then
    // tries to submit it. Resolves to { score, title, breakdown, newlyUnlocked, isPersonalBest, rank, queued,
    // ranked }. Never rejects on network errors. Idempotent: later calls return the same promise.
    finish() {
        if (this._finishing) return this._finishing;
        const run = this._requireRun();
        if (!isRunOver(run)) throw new Error('Run is still in progress');
        const email = this.email;

        const s = finalScore(
            { history: run.history, status: run.status, startingCash: run.startingCash, boardMood: run.boardMood },
            this.content.quips?.gameOverTitles || []
        );
        const { progress, newlyUnlocked, isPersonalBest } = applyRunToProgress(this.progress(), {
            mode: 'simple', score: s.total, chairmenMet: run.chairmenMet, crisisId: run.crisisId, status: run.status
        });
        this.storage.saveProgress(email, progress);
        this.storage.clearRun(email);

        const ranked = !run.crisisId;
        let payload = null;
        if (ranked) {
            const reg = this.storage.getRegistration();
            payload = {
                gameId: run.gameId, email, mode: 'simple', score: s.total, quartersPlayed: run.history.length,
                startedAt: run.startedAt, industryId: run.industryId
            };
            if (reg?.playerName && String(reg.email).toLowerCase() === String(email).toLowerCase()) {
                payload.playerName = reg.playerName;
            }
            this.storage.queueScore(payload);
        }
        this.outcome = {
            score: s.total, title: s.title, breakdown: s.breakdown, newlyUnlocked, isPersonalBest,
            rank: null, queued: ranked, ranked
        };
        this._finishing = this._submit({ ...this.outcome }, payload, progress);
        return this._finishing;
    }

    // ── Progress and power-ups ───────────────────────────────────────────

    // Local progress for the current player (or the registered one), with the free unlocks.
    progress() {
        const email = this._email();
        return withFreeUnlocks(email ? this.storage.getProgress(email) : emptyProgress());
    }

    // Merges the server's progress into the local one (registered player only) and saves it locally.
    // Falls back to the local progress when offline or not registered.
    async syncProgress() {
        const local = this.progress();
        const email = this.storage.getRegistration()?.email;
        if (!email || typeof this.api?.getRemoteProgress !== 'function') return local;
        try {
            const remote = await this.api.getRemoteProgress();
            if (!remote) return local;
            const merged = withFreeUnlocks(mergeProgress(local, remote));
            this.storage.saveProgress(email, merged);
            return merged;
        } catch {
            return local;
        }
    }

    // Power-up ids the player has unlocked ('powerup:facilities' -> 'facilities').
    unlockedPowerUps() {
        return this.progress().unlocked.filter(id => id.startsWith('powerup:')).map(id => id.slice('powerup:'.length));
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

    async _submit(result, payload, progress) {
        if (payload && typeof this.api?.submitScore === 'function') {
            try {
                const res = await this.api.submitScore(payload);
                this.storage.removeQueuedScore(payload.gameId);
                result.queued = false;
                if (res && !res.duplicate && Number.isFinite(res.rank)) result.rank = res.rank;
            } catch {
                // Offline or rejected: it stays queued, and flushScoreQueue retries it (or drops a bad one).
            }
            if (typeof this.api.flushScoreQueue === 'function') {
                Promise.resolve().then(() => this.api.flushScoreQueue()).catch(() => {});
            }
        }
        if (typeof this.api?.putRemoteProgress === 'function') {
            Promise.resolve().then(() => this.api.putRemoteProgress(progress)).catch(() => {});
        }
        this.outcome = result;
        return result;
    }

    _save() {
        this.storage.saveRun(this.email, serialiseSave(this.run));
    }

    _email() {
        return this.email || this.storage.getRegistration()?.email || null;
    }

    _industry(id) {
        const industry = (this.content.industries || []).find(i => i.id === id);
        if (!industry) throw new Error(`Unknown industry: ${id}`);
        return industry;
    }

    _requireRun() {
        if (!this.run) throw new Error('No run in progress');
        return this.run;
    }
}
