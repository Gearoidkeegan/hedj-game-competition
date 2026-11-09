// Server-side copy of mergeProgress (client: js/engine/sim/progress.js). Rules: max of runs and each best, union of arrays.
const SCORE_MAX = 10000;
const ARRAY_KEYS = ['unlocked', 'chairmenMet', 'crisisBadges'];
const MAX_ARRAY_LEN = 50;
const ID_RE = /^[a-z0-9:_-]{1,40}$/i;

const count = v => (Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), 1_000_000) : 0);
const bestScore = v => (Number.isFinite(v) && v > 0 ? Math.min(Math.round(v), SCORE_MAX) : 0);
const ids = v => (Array.isArray(v)
    ? v.filter(x => typeof x === 'string' && ID_RE.test(x))
    : []);

export function normaliseProgress(p) {
    const src = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    const best = src.best && typeof src.best === 'object' ? src.best : {};
    const out = { version: 3, runs: count(src.runs), best: { simple: bestScore(best.simple), pro: bestScore(best.pro) } };
    for (const k of ARRAY_KEYS) out[k] = [...new Set(ids(src[k]))].slice(0, MAX_ARRAY_LEN);
    return out;
}

export function mergeProgress(a, b) {
    const x = normaliseProgress(a);
    const y = normaliseProgress(b);
    const out = {
        version: 3,
        runs: Math.max(x.runs, y.runs),
        best: { simple: Math.max(x.best.simple, y.best.simple), pro: Math.max(x.best.pro, y.best.pro) }
    };
    for (const k of ARRAY_KEYS) out[k] = [...new Set([...x[k], ...y[k]])].slice(0, MAX_ARRAY_LEN);
    return out;
}
