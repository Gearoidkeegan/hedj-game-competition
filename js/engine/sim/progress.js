// Player progress (unlocks, bests, badges) and the run save format. Pure: no storage or I/O.
// Every id here must match the backend sync pattern /^[a-z0-9:_-]{1,40}$/i.

import { CRISES } from './crises.js';

const FREE_UNLOCKS = ['industry:airline', 'industry:agrifoods', 'industry:retail', 'powerup:forecasting'];
const CRISIS_RUNS_REQUIRED = 4;

export const UNLOCK_RULES = [
    { id: 'mode:pro', test: p => p.runs >= 1 },
    { id: 'industry:construction', test: p => p.best.simple >= 1500 },
    { id: 'industry:pharma', test: p => p.runs >= 3 },
    { id: 'industry:tech', test: p => p.best.simple >= 2500 },
    { id: 'industry:energy', test: p => p.runs >= 6 },
    { id: 'powerup:visibility', test: p => p.runs >= 2 },
    { id: 'powerup:options', test: p => p.best.simple >= 2000 },
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

export function applyRunToProgress(progress, { mode, score, chairmenMet, crisisId, status }) {
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
        if (!next.unlocked.includes(rule.id) && rule.test(next)) {
            next.unlocked.push(rule.id);
            newlyUnlocked.push(rule.id);
        }
    }
    return { progress: next, newlyUnlocked, isPersonalBest };
}

// Mirrors the backend merge: max of runs and each best, ordered union of arrays.
export function mergeProgress(a, b) {
    return {
        version: 3,
        runs: Math.max(num(a.runs), num(b.runs)),
        best: {
            simple: Math.max(num(a.best?.simple), num(b.best?.simple)),
            pro: Math.max(num(a.best?.pro), num(b.best?.pro))
        },
        unlocked: union(a.unlocked, b.unlocked),
        chairmenMet: union(a.chairmenMet, b.chairmenMet),
        crisisBadges: union(a.crisisBadges, b.crisisBadges)
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
