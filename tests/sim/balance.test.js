// A7 balance criteria (as restated by ruling R34, unhedged bankruptcy floor 0.015 per R37) at 300 seeded runs per strategy across all 7 industries.
// Deterministic: fixed seeds. The 1000-run table lives at the top of js/engine/sim/balance.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../../js/engine/sim/balance.js';
import { runAll, mean, quantile, shareAbove } from '../../tools/simulate.js';

const N = 300;
const SEED = 1;
const res = runAll(N, SEED);
const median = xs => quantile(xs, 0.5);
const inRange = (x, lo, hi, msg) => assert.ok(x >= lo && x <= hi, `${msg}: ${x} not in [${lo}, ${hi}]`);

test('following the mandate clearly beats doing nothing', () => {
    assert.ok(mean(res.mandate.scores) > 1.3 * mean(res.unhedged.scores),
        `mean(mandate) ${mean(res.mandate.scores)} vs 1.3 x mean(unhedged) ${1.3 * mean(res.unhedged.scores)}`);
    assert.ok(quantile(res.mandate.scores, 0.25) > median(res.unhedged.scores),
        `p25(mandate) ${quantile(res.mandate.scores, 0.25)} vs median(unhedged) ${median(res.unhedged.scores)}`);
});

// Unhedged play is the benchmark itself (it scores no outperformance), so luck is measured on full and random.
test('luck still matters', () => {
    const bar = median(res.mandate.scores);
    inRange(shareAbove(res.full.scores, bar), 0.08, 0.30, 'share of full above median(mandate)');
    const random = shareAbove(res.random.scores, bar);
    assert.ok(random >= 0.02, `share of random above median(mandate): ${random} < 0.02`);
});

test('unhedged players sometimes go bankrupt; mandate players rarely do', () => {
    inRange(res.unhedged.bankruptRate, 0.015, 0.30, 'bankruptRate(unhedged)');
    assert.ok(res.mandate.bankruptRate < 0.05, `bankruptRate(mandate) ${res.mandate.bankruptRate}`);
});

test('losing breaches get you fired; the mandate keeps you employed', () => {
    // Every mandate band excludes 0, so an unhedged run breaches every quarter.
    assert.ok(BALANCE.mandates.every(m => m.min > 0));
    assert.ok(res.unhedged.firedRate >= 0.15, `firedRate(unhedged) ${res.unhedged.firedRate}`);
    assert.ok(res.mandate.firedRate < 0.05, `firedRate(mandate) ${res.mandate.firedRate}`);
});

// R35: only an off-mandate loss can be severe. Mandate never breaches, and full (100% forward) is never
// hurt badly enough.
test('a severe losing breach fires unhedged players, never mandate or full ones', () => {
    assert.equal(res.mandate.severeFiredRate, 0);
    assert.equal(res.full.severeFiredRate, 0);
    assert.ok(res.unhedged.severeFiredRate > 0, `severeFiredRate(unhedged) ${res.unhedged.severeFiredRate}`);
});

test('a run lasts at most 8 quarters', () => {
    assert.equal(Math.max(...Object.values(res).map(r => r.maxQuarters)), 8);
});

test('scores stay well under the clamp', () => {
    const max = Math.max(...Object.values(res).flatMap(r => r.scores));
    assert.ok(max < 9000, `max score ${max}`);
});
