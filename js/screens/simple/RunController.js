// RunController: the hub of Simple mode. It owns the current RunState, autosaves it per player, picks the
// result quip and the board reaction, and finishes the run (progress, score queue, save cleared).
// No DOM here, so it runs under Node tests. Quips and the chairman use a cosmetic SeededRandom derived from
// `run.seed ^ 0xC0FFEE`; the simulation RNG (inside SimEngine) is never touched.

import { BALANCE } from '../../engine/sim/balance.js';
import { createRun, simulateQuarter, isRunOver, activeExposures } from '../../engine/sim/SimEngine.js';
import { maxHedgeRatio, canBuyPowerUp } from '../../engine/sim/powerUps.js';
import { finalScore } from '../../engine/sim/score.js';
import { applyRunToProgress, emptyProgress, mergeProgress, serialiseSave } from '../../engine/sim/progress.js';
import { CRISES } from '../../engine/sim/crises.js';
import { SeededRandom } from '../../utils/random.js';
import { isFinalRejection, rejectionText } from '../../utils/scoreRejection.js';
import { GUEST_PLAYER } from '../../utils/storage.js';
import { CHAIRMAN_SPRITES, spriteIdForMember } from '../../ui/pixel/sprites.js';

// The chairman speaks instead of a board member in these quarters, and whenever the gap to the benchmark
// this quarter is above CHAIRMAN_DELTA_PCT of starting cash.
export const CHAIRMAN_QUARTERS = Object.freeze([1, 4, 8]);
export const CHAIRMAN_DELTA_PCT = 0.03;
// Board lines the chairman never talks over: the board answering a proposal, the wrong-focus line (it explains why
// the quarter was off policy) and the losing breaches (v3.2: split by direction; breachLoss is Pro's direction-free
// one). On a breach whose market result held up he speaks only an off-policy line that names the breach.
export const CHAIRMAN_YIELDS_TO = Object.freeze(['policyAdopted', 'wrongFocus', 'overLoss', 'underLoss', 'breachLoss']);
// v3.2 outcome thresholds, as fractions of starting cash: a market result (exposures plus hedges) smaller than
// QUARTER_FLAT_PCT is a flat quarter, and a hedge result smaller than HEDGE_RESULT_PCT is no hedge result.
export const QUARTER_FLAT_PCT = 0.005;
export const HEDGE_RESULT_PCT = 0.005;
export const OVER_HEDGE_FACTOR = 1.15;

const COSMETIC_SALT = 0xC0FFEE;
const PERSONA_SALT = 0;      // the chairman persona: the first draw of SeededRandom(run.seed ^ 0xC0FFEE)
const INTRO_SALT = 9;        // quarters use salts 1..8
const CHAIRMAN_IDS = Object.keys(CHAIRMAN_SPRITES);
const FREE_UNLOCKS = emptyProgress().unlocked;
const PERSONALITIES = ['aggressive', 'cautious', 'operational'];
const ANGRY_KEYS = new Set(['breachLoss', 'overLoss', 'underLoss', 'noPolicyHedgeLoss', 'redZone', 'moodDown']);
const HAPPY_KEYS = new Set(['policyAdopted', 'moodUp']);
// Breaches whose market result held up: the chairman may speak, but only an off-policy line.
const OFF_POLICY_KEYS = new Set(['overLucky', 'underLucky', 'luckyBreach']);
// On a flat quarter the chairman frowns at these board keys and approves of the rest.
const FLAT_NEGATIVE_KEYS = new Set(['inPolicyBad', 'noPolicyHedgeLoss', 'redZone', 'moodDown']);
const TONE_EXPRESSION = Object.freeze({ positive: 'happy', negative: 'angry', offPolicy: 'neutral' });

const sum = (lines, field) => (lines || []).reduce((s, l) => s + (Number.isFinite(l[field]) ? l[field] : 0), 0);

// A cosmetic RNG per salt, so the line picked for a quarter is the same after a reload (resume-stable).
export function cosmeticRng(seed, salt = 0) {
    return new SeededRandom((((seed ^ COSMETIC_SALT) >>> 0) + Math.imul(salt, 0x9E3779B1)) >>> 0);
}

function pickLine(rng, lines) {
    return Array.isArray(lines) && lines.length ? rng.pick(lines) : '';
}

// FNV-1a: a stable 32-bit hash of a pool id.
function strHash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

// v3.2: the line for the `uses`-th use of a pool in this run (counting from 0). Each pool has its own seeded
// permutation from the run seed and the pool id, so the first pool.length uses are all different lines, and the
// same run, pool and count always give the same line (resume-stable). Cosmetic only: never the simulation RNG.
export function linePick(seed, poolId, pool, uses) {
    if (!Array.isArray(pool) || !pool.length) return '';
    const order = cosmeticRng(seed, strHash(String(poolId))).shuffle(pool.map((_, i) => i));
    const n = Number.isInteger(uses) && uses > 0 ? uses : 0;
    return pool[order[n % pool.length]];
}

// The run's chairman persona (one of CHAIRMAN_SPRITES), fixed by the run seed.
export function chairmanFor(seed) {
    return CHAIRMAN_IDS[Math.floor(cosmeticRng(seed, PERSONA_SALT).next() * CHAIRMAN_IDS.length)];
}

// 'over' or 'under' for an off-policy quarter: the cover above the band's max, or below it. null when the cover or
// the band is unknown (Pro summaries carry no riskCover, and Pro passes no band).
function breachDirection(summary, mandate) {
    if (summary.policy !== 'off' || !mandate || !Number.isFinite(summary.riskCover)) return null;
    return summary.riskCover > mandate.max ? 'over' : 'under';
}

// v3.2: what actually happened in a quarter, for the feedback lines. `mandate` is the band the quarter was judged
// on (run.mandate: it only ever changes from none to an adopted band, so every in or off quarter has today's band).
//   policyState: 'adopted' (a proposal this quarter) | 'wrongFocus' | 'none' (no policy) | 'in' | 'over' | 'under'
//                (cover above or below the band), or 'off' when the direction is unknown (Pro, or no band given).
//   quarter:     'good' | 'bad' | 'flat': the market result (exposures plus hedges) against QUARTER_FLAT_PCT.
//   hedge:       'won' | 'lost' | 'none': Σ hedgeImpact against HEDGE_RESULT_PCT.
export function outcomeFor(summary, startingCash, mandate = null) {
    const market = Number.isFinite(summary.marketResult)
        ? summary.marketResult
        : sum(summary.lines, 'exposureImpact') + sum(summary.lines, 'hedgeImpact');
    const flat = QUARTER_FLAT_PCT * startingCash;
    const quarter = market >= flat ? 'good' : market <= -flat ? 'bad' : 'flat';
    const hedgeResult = sum(summary.lines, 'hedgeImpact');
    const notable = HEDGE_RESULT_PCT * startingCash;
    const hedge = hedgeResult >= notable ? 'won' : hedgeResult <= -notable ? 'lost' : 'none';
    let policyState;
    if (summary.policyAdopted) policyState = 'adopted';
    else if (summary.wrongFocus === true) policyState = 'wrongFocus';
    else if (summary.policy === 'none') policyState = 'none';
    else if (summary.policy === 'in') policyState = 'in';
    else policyState = breachDirection(summary, mandate) ?? 'off';
    return { policyState, quarter, hedge };
}

// Board line selection (contract.md). First match wins. v3.1: a wrong-focus quarter (the big exposure under-hedged
// while a small one was hedged) gets its own line on any board; summaries without the flag never match. v3.2: given
// the band (`mandate`), a breach is named by its direction (overLucky, underLucky, overLoss, underLoss). Pro passes
// no band and keeps the direction-free luckyBreach and breachLoss.
export function boardLineKey(summary, moodBefore, mandate = null) {
    if (summary.policyAdopted) return 'policyAdopted';
    if (summary.wrongFocus === true) return 'wrongFocus';
    if (summary.policy === 'none') {
        const hedge = sum(summary.lines, 'hedgeImpact');
        return hedge < 0 ? 'noPolicyHedgeLoss' : hedge > 0 ? 'noPolicyHedgeWin' : 'noPolicyNudge';
    }
    if (summary.breach === 'loss' || summary.breach === 'lucky') {
        const dir = breachDirection(summary, mandate);
        if (dir) return `${dir}${summary.breach === 'loss' ? 'Loss' : 'Lucky'}`;
        return summary.breach === 'loss' ? 'breachLoss' : 'luckyBreach';
    }
    if (summary.policy === 'in' && summary.marketResult < 0) return 'inPolicyBad';
    if (summary.cashAfter < summary.redLine) return 'redZone';
    return summary.boardMoodAfter >= moodBefore ? 'moodUp' : 'moodDown';
}

// Sprite expression for a board line key. Losing breaches are always angry; mixed and mild lines stay neutral.
// wrongFocus follows the quarter: angry when it was also a losing breach (the angry sprite always wins) or, on a
// no-policy board, a hedge loss (the line it pre-empts is angry too); otherwise neutral.
export function expressionFor(key, summary = null) {
    if (key === 'wrongFocus') {
        const hedgeLoss = summary?.policy === 'none' && sum(summary.lines, 'hedgeImpact') < 0;
        return summary?.breach === 'loss' || hedgeLoss ? 'angry' : 'neutral';
    }
    if (ANGRY_KEYS.has(key)) return 'angry';
    if (HAPPY_KEYS.has(key)) return 'happy';
    return 'neutral';
}

// Result quip selection (v3.2, in order). The quip speaks about the market and the hedge only (the board line
// covers the policy), so it can't contradict the facts line: the red line, then a real volume over-hedge, then the
// hedge's result, then the quarter's. `calm` only for a flat quarter with no hedge result worth naming.
export function resultQuipKey(summary, startingCash) {
    if (summary.cashAfter < summary.redLine) return 'nearBankrupt';
    if ((summary.lines || []).some(l => l.hedgeRatio * l.forecastNotional > OVER_HEDGE_FACTOR * l.realisedNotional)) {
        return 'overHedged';
    }
    const { quarter, hedge } = outcomeFor(summary, startingCash);
    if (hedge === 'won') return 'bigSave';
    if (hedge === 'lost') return 'bigMiss';
    return quarter === 'good' ? 'boom' : quarter === 'bad' ? 'storm' : 'calm';
}

// The chairman's tone: null when he yields to the board line, 'offPolicy' on a breach whose market result held up,
// otherwise 'positive' or 'negative' by the quarter (a flat quarter goes by the board key).
export function chairmanTone(key, outcome) {
    if (CHAIRMAN_YIELDS_TO.includes(key)) return null;
    if (OFF_POLICY_KEYS.has(key)) return 'offPolicy';
    if (outcome.quarter === 'good') return 'positive';
    if (outcome.quarter === 'bad') return 'negative';
    return FLAT_NEGATIVE_KEYS.has(key) ? 'negative' : 'positive';
}

// The chairman's pool for a tone and board key: { id, lines }, or null. Off-policy lines follow the breach's
// direction; Pro's direction-free luckyBreach has none, so there he yields.
function chairmanPool(quips, chairmanId, tone, key) {
    const pools = quips?.chairman?.[chairmanId];
    if (!pools || !tone) return null;
    if (tone !== 'offPolicy') return { id: `chairman.${chairmanId}.${tone}`, lines: pools[tone] };
    const dir = key.startsWith('over') ? 'over' : key.startsWith('under') ? 'under' : null;
    return dir ? { id: `chairman.${chairmanId}.offPolicy.${dir}`, lines: pools.offPolicy?.[dir] } : null;
}

// One quarter's quip and board reaction, and the pool ids they used. `uses` maps pool id -> earlier uses this run.
// The chairman only speaks while his pool still has an unused line, so he never repeats himself in a run.
function feedbackStep(ctx, summary, moodBefore, uses) {
    const { seed, startingCash, mandate, members, quips } = ctx;
    const count = id => uses.get(id) || 0;
    const quipKey = resultQuipKey(summary, startingCash);
    const quipPool = `result.${quipKey}`;
    const quip = { key: quipKey, text: linePick(seed, quipPool, quips?.result?.[quipKey], count(quipPool)) };

    const key = boardLineKey(summary, moodBefore, mandate);
    const rng = cosmeticRng(seed, summary.q);
    const index = members.length ? Math.floor(rng.next() * members.length) : -1;
    const member = index >= 0 ? members[index] : null;
    const personality = PERSONALITIES.includes(member?.personality) ? member.personality : 'operational';

    if (chairmanAppears(summary, startingCash)) {
        const chairmanId = chairmanFor(seed);
        const tone = chairmanTone(key, outcomeFor(summary, startingCash, mandate));
        const pool = chairmanPool(quips, chairmanId, tone, key);
        if (pool && Array.isArray(pool.lines) && count(pool.id) < pool.lines.length) {
            return {
                quip, pools: [quipPool, pool.id],
                boardReaction: {
                    speaker: 'chairman', key, tone, expression: TONE_EXPRESSION[tone],
                    line: linePick(seed, pool.id, pool.lines, count(pool.id)),
                    chairmanId, spriteId: chairmanId, member: null
                }
            };
        }
    }
    const boardPool = `board.${personality}.${key}`;
    return {
        quip, pools: [quipPool, boardPool],
        boardReaction: {
            speaker: 'board', key, expression: expressionFor(key, summary),
            line: linePick(seed, boardPool, quips?.board?.[personality]?.[key], count(boardPool)),
            chairmanId: null,
            spriteId: member ? spriteIdForMember(member, index) : null,
            member: member
                ? { index, name: member.name, role: member.role, title: member.title, personality }
                : null
        }
    };
}

// v3.2: the quip and board reaction for `summary`, the quarter played from `run` (the run BEFORE that quarter: its
// seed, startingCash, mandate and history). Each pool's earlier uses are recomputed from run.history, so the lines
// depend only on the saved run and the summary: a resumed run shows the same lines. No line repeats in a run while
// its pool has unused lines (the Simple pools hold at least 8, one per quarter).
export function quarterFeedback(run, summary, { quips, members = [] }) {
    const ctx = { seed: run.seed, startingCash: run.startingCash, mandate: run.mandate ?? null, members, quips };
    const uses = new Map();
    let moodBefore = BALANCE.startMood;
    for (const earlier of run.history || []) {
        for (const id of feedbackStep(ctx, earlier, moodBefore, uses).pools) uses.set(id, (uses.get(id) || 0) + 1);
        moodBefore = earlier.boardMoodAfter;
    }
    const { quip, boardReaction } = feedbackStep(ctx, summary, moodBefore, uses);
    return { quip, boardReaction };
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

// The midpoint of a policy band, rounded to a 0.25 step (0 for "not to hedge").
function bandMidpoint(policy) {
    return Math.round(((policy.min + policy.max) / 2) * 4) / 4;
}


const sameEmail = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const isGuest = email => email === GUEST_PLAYER;

export class RunController {
    // storage: js/utils/storage.js (namespace import); api: js/utils/api.js (or a fake with the same names);
    // market: anything with getRate/getDataset (marketEngine); content: { industries, events, quips, powerups };
    // now: () => ms timestamp.
    //
    // Player identity (R39): the current player is ALWAYS the one in the registration store
    // (storage.getRegistration().email), read at call time; in free play (storage.isFreePlay(), R66) it is the local
    // guest (GUEST_PLAYER), whose runs are never submitted, queued or synced. Every public method first checks it; if it no longer
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

    // The registered player's email, the guest in free play, or null.
    currentPlayer() {
        if (this.storage.isFreePlay?.()) return GUEST_PLAYER;
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

    // Dials for the coming quarter (R65). Q1: every dial at 0, whatever the board. Later quarters: the ratio the
    // player applied last quarter; an exposure that has just become active starts at 0. The quarter after the
    // board adopts a policy the player proposed: that policy's midpoint, rounded to a 0.25 step.
    // Always capped by maxHedgeRatio (the 50% line before facilities, 0 for ir/commodity before hedgeAccess).
    currentDecisionsDefaults() {
        const run = this._requireRun();
        const last = run.history[run.history.length - 1];
        const adopted = last?.policyAdopted ? bandMidpoint(last.policyAdopted) : null;
        const previous = last ? Object.fromEntries(last.lines.map(l => [l.exposureId, l.hedgeRatio])) : {};
        const hedges = {};
        for (const exp of activeExposures(run)) {
            const wanted = adopted ?? (Object.hasOwn(previous, exp.id) ? previous[exp.id] : 0);
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
        const { quip, boardReaction } = quarterFeedback(run, summary, {
            quips: this.content.quips, members: this._industry(run.industryId).boardMembers || []
        });
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

        const practice = isGuest(email);   // free play (R66): no submission, no queue
        const ranked = !run.crisisId && !practice;
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
        if (practice) this.outcome.practice = true;
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
        if (!email || isGuest(email) || typeof this.api?.getRemoteProgress !== 'function') return local;
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
        if (typeof this.api?.putRemoteProgress === 'function' && !isGuest(owner.email) && sameEmail(this.currentPlayer(), owner.email)) {
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
