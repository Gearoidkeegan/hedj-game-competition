// Shared scoring against the unhedged benchmark. Pure: no I/O, no randomness.

import { BALANCE } from './balance.js';

// Upper bound the backend accepts; finalScore clamps to it.
export const SCORE_MAX = 10000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function quarterPoints(summary, startingCash) {
    const P = BALANCE.points;
    let pts = 0;
    if (summary.breach === 'none') pts += P.inMandate;
    else if (summary.breach === 'lucky') pts += P.luckyBreach;
    else if (summary.breach === 'loss') pts += P.breachLoss;
    if (summary.cashAfter >= summary.redLine) pts += P.aboveRedLine;

    const baseOcf = BALANCE.baseOcfPct * startingCash;
    const spread = Math.max(1, Math.abs(summary.benchmarkDelta - baseOcf));
    const steadiness = clamp(1 - Math.abs(summary.playerDelta - baseOcf) / spread, 0, 1);
    return pts + Math.round(P.stability * steadiness);
}

// gameOverTitles: [{ score, title, line }] ascending by score; the highest entry with score <= total wins.
export function finalScore({ history, status, startingCash, boardMood }, gameOverTitles = []) {
    const P = BALANCE.points;
    const quarters = history.reduce((sum, s) => sum + quarterPoints(s, startingCash), 0);

    const last = history[history.length - 1];
    const lastCash = last ? last.cashAfter : startingCash;
    const lastBenchmark = last ? last.benchmarkCashAfter : startingCash;
    const outperformance = Math.round(P.outperformPerPct * 100 * (lastCash - lastBenchmark) / startingCash);

    const survival = status === 'complete' ? P.survival : 0;
    const moodMultiplier = 0.8 + 0.4 * boardMood / 100;
    const total = clamp(Math.round((quarters + outperformance + survival) * moodMultiplier), 0, SCORE_MAX);

    let title = '';
    for (const t of gameOverTitles) if (t.score <= total) title = t.title;
    return { total, breakdown: { quarters, outperformance, survival, moodMultiplier }, title };
}
