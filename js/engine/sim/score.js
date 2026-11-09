// Shared scoring against the unhedged benchmark. Pure: no I/O, no randomness.

import { BALANCE } from './balance.js';

// Upper bound the backend accepts; finalScore clamps to it.
export const SCORE_MAX = 10000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function quarterPoints(summary, startingCash) {
    const P = BALANCE.points;
    let pts = 0;
    // A9 (R43): the policy points are keyed on being in policy, not on breach === 'none', so a no-policy
    // quarter (policy 'none', inMandate null, breach 'none', Simple or Pro) earns no policy or breach points.
    // Summaries without a `policy` field fall back to inMandate === true.
    const inPolicy = summary.policy !== undefined ? summary.policy === 'in' : summary.inMandate === true;
    if (inPolicy) pts += P.inMandate;
    else if (summary.breach === 'lucky') pts += P.luckyBreach;
    else if (summary.breach === 'loss') pts += P.breachLoss;
    if (summary.cashAfter >= summary.redLine) pts += P.aboveRedLine;
    if (summary.policyAdopted) pts += P.policyAdopted;

    const baseOcf = BALANCE.baseOcfPct * startingCash;
    const spread = Math.max(1, Math.abs(summary.benchmarkDelta - baseOcf));
    const steadiness = clamp(1 - Math.abs(summary.playerDelta - baseOcf) / spread, 0, 1);
    return pts + Math.round(P.stability * steadiness);
}

// gameOverTitles: [{ min, title, line }] ascending by min; the highest entry with min <= total wins.
export function finalScore({ history, status, startingCash, boardMood }, gameOverTitles = []) {
    const P = BALANCE.points;
    const quarters = history.reduce((sum, s) => sum + quarterPoints(s, startingCash), 0);

    const last = history[history.length - 1];
    const lastCash = last ? last.cashAfter : startingCash;
    const lastBenchmark = last ? last.benchmarkCashAfter : startingCash;
    const outperformance = Math.round(P.outperformPerPct * 100 * (lastCash - lastBenchmark) / startingCash);

    const survival = status === 'complete' ? P.survival : 0;
    const mood = clamp(Number.isFinite(boardMood) ? boardMood : BALANCE.startMood, 0, 100);
    const moodMultiplier = 0.8 + 0.4 * mood / 100;
    const total = clamp(Math.round((quarters + outperformance + survival) * moodMultiplier), 0, SCORE_MAX);

    let title = '';
    for (const t of gameOverTitles) if (t.min <= total) title = t.title;
    return { total, breakdown: { quarters, outperformance, survival, moodMultiplier }, title };
}
