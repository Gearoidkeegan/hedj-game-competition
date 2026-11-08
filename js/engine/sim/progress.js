// Player progress (unlocks, bests, badges) and the run save format. Pure: no storage or I/O.
// Every id here must match the backend sync pattern /^[a-z0-9:_-]{1,40}$/i.

import { CRISES } from './crises.js';

// A9 (R44): facilities and hedgeAccess gate core play, so they are free from run 1.
const FREE_UNLOCKS = [
    'industry:airline', 'industry:agrifoods', 'industry:retail',
    'powerup:forecasting', 'powerup:facilities', 'powerup:hedgeAccess'
];
const CRISIS_RUNS_REQUIRED = 4;

// Run status rules (R32): every finished run (complete, bankrupt or fired) counts toward `runs`,
// and every non-crisis run may set best[mode] whatever its status. Each rule's test receives the
// progress after the run is applied, plus the run itself; only mode:pro looks at the run, because
// Pro unlocks after the first COMPLETED run (progress.runs alone cannot tell completed from not).
export const UNLOCK_RULES = [
    { id: 'mode:pro', test: (p, run) => run?.status === 'complete' },
    { id: 'industry:construction', test: p => p.best.simple >= 1500 },
    { id: 'industry:pharma', test: p => p.runs >= 3 },
    { id: 'industry:tech', test: p => p.best.simple >= 2250 },
    { id: 'industry:energy', test: p => p.runs >= 6 },
    { id: 'powerup:visibility', test: p => p.runs >= 2 },
    // `crisis:*` in the design: one unlock per crisis.
    ...CRISES.map(c => ({ id: `crisis:${c.id}`, test: p => p.runs >= CRISIS_RUNS_REQUIRED }))
];

export function emptyProgress() {
    return {
        version: 3,
        runs: 0,
        best: { simple: 0, pro: 0 },
        unlocked: [...FREE_UNLOCKS],
        chairmenMet: [],
        crisisBadges: []
    };
}

// a's items first, then b's new ones, de-duplicated.
function union(a, b) {
    return [...new Set([...(a || []), ...(b || [])])];
}

const num = v => (Number.isFinite(v) ? v : 0);

// Normalisation mirrors backend/lib/progress.mjs (the authority): ids must match the sync pattern,
// arrays are de-duplicated and capped at 50, runs is a floored count, bests are rounded and clamped to 0..10000.
const SCORE_MAX = 10000;
const MAX_ARRAY_LEN = 50;
const MAX_RUNS = 1_000_000;
const ID_RE = /^[a-z0-9:_-]{1,40}$/i;
const count = v => (Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), MAX_RUNS) : 0);
const bestScore = v => (Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), SCORE_MAX) : 0);
const ids = v => (Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && ID_RE.test(x)))].slice(0, MAX_ARRAY_LEN) : []);

// Tolerates missing, partial or malformed stored progress. The result is always version 3.
function normalise(p) {
    const src = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    const best = src.best && typeof src.best === 'object' ? src.best : {};
    return {
        version: 3,
        runs: count(src.runs),
        best: { simple: bestScore(best.simple), pro: bestScore(best.pro) },
        unlocked: ids(src.unlocked),
        chairmenMet: ids(src.chairmenMet),
        crisisBadges: ids(src.crisisBadges)
    };
}

export function applyRunToProgress(rawProgress, { mode, score, chairmenMet, crisisId, status }) {
    const progress = normalise(rawProgress);
    const key = mode === 'pro' ? 'pro' : 'simple';
    const points = num(score);
    const isCrisis = !!crisisId;
    const isPersonalBest = !isCrisis && points > progress.best[key];

    const next = {
        ...progress,
        runs: progress.runs + 1,
        best: { ...progress.best, [key]: isPersonalBest ? points : progress.best[key] },
        chairmenMet: union(progress.chairmenMet, chairmenMet),
        crisisBadges: isCrisis && status === 'complete'
            ? union(progress.crisisBadges, [crisisId])
            : [...progress.crisisBadges],
        unlocked: [...progress.unlocked]
    };

    const newlyUnlocked = [];
    for (const rule of UNLOCK_RULES) {
        if (!next.unlocked.includes(rule.id) && rule.test(next, { status })) {
            next.unlocked.push(rule.id);
            newlyUnlocked.push(rule.id);
        }
    }
    return { progress: next, newlyUnlocked, isPersonalBest };
}

// Mirrors the backend merge: max of runs and each best, ordered union of arrays.
// Tolerates a missing or partial a or b; the output is always version 3.
export function mergeProgress(a, b) {
    const x = normalise(a);
    const y = normalise(b);
    return {
        version: 3,
        runs: Math.max(x.runs, y.runs),
        best: { simple: Math.max(x.best.simple, y.best.simple), pro: Math.max(x.best.pro, y.best.pro) },
        unlocked: union(x.unlocked, y.unlocked).slice(0, MAX_ARRAY_LEN),
        chairmenMet: union(x.chairmenMet, y.chairmenMet).slice(0, MAX_ARRAY_LEN),
        crisisBadges: union(x.crisisBadges, y.crisisBadges).slice(0, MAX_ARRAY_LEN)
    };
}

export function serialiseSave(run) {
    return JSON.stringify(run);
}

// Returns the RunState, or null for anything that is not a version 3 save. Never throws.
export function parseSave(str) {
    if (typeof str !== 'string') return null;
    let data;
    try {
        data = JSON.parse(str);
    } catch {
        return null;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    if (data.version !== 3) return null;
    if (!Array.isArray(data.history)) return null;
    return data;
}
