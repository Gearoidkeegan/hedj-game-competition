import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../../js/engine/sim/balance.js';
import { quarterPoints, finalScore, SCORE_MAX } from '../../js/engine/sim/score.js';

const START = 1000;
const BASE_OCF = BALANCE.baseOcfPct * START;

// A QuarterSummary with sensible defaults; stability is 0 unless playerDelta is overridden.
function summary(over = {}) {
    return {
        q: 1, inMandate: true, playerDelta: -100, benchmarkDelta: 0, marketResult: 0, breach: 'none',
        cashAfter: 900, benchmarkCashAfter: 900, redLine: 200, boardMoodAfter: 60,
        lines: [], event: null, powerUp: null, ...over
    };
}

// 8 quarters ending at the given player and benchmark cash.
function history(lastCash, lastBench, over = {}) {
    return Array.from({ length: 8 }, (_, i) => summary({
        q: i + 1, ...over,
        ...(i === 7 ? { cashAfter: lastCash, benchmarkCashAfter: lastBench } : {})
    }));
}

const input = (h, extra = {}) => ({ history: h, status: 'complete', startingCash: START, boardMood: 60, ...extra });

test('gains are not penalised', () => {
    const up = finalScore(input(history(1200, 1000))).total;
    const flat = finalScore(input(history(1000, 1000))).total;
    assert.ok(up > flat);
});

test('bankrupt gets no survival bonus', () => {
    const done = finalScore(input(history(900, 900), { status: 'complete' }));
    const bust = finalScore(input(history(900, 900), { status: 'bankrupt' }));
    assert.equal(done.breakdown.survival, BALANCE.points.survival);
    assert.equal(bust.breakdown.survival, 0);
    assert.ok(done.total > bust.total);
});

test('total never negative', () => {
    const h = history(0, 1000, { breach: 'loss', cashAfter: 0 });
    h[7].cashAfter = 0;
    const r = finalScore(input(h, { status: 'bankrupt', boardMood: 0 }));
    assert.ok(r.breakdown.outperformance < 0);
    assert.equal(r.total, 0);
});

test('a perfect 8-quarter run is <= SCORE_MAX', () => {
    const h = history(1500, 1000, { playerDelta: BASE_OCF, benchmarkDelta: -100 });
    const r = finalScore(input(h, { boardMood: 100 }));
    assert.ok(r.total <= SCORE_MAX, String(r.total));
    assert.ok(r.total > 0);
});

test('huge outperformance is clamped to exactly SCORE_MAX', () => {
    const r = finalScore(input(history(100000, 1000), { boardMood: 100 }));
    assert.ok(r.breakdown.outperformance > SCORE_MAX);
    assert.equal(r.total, SCORE_MAX);
});

test('score is an integer', () => {
    const r = finalScore(input(history(1033, 987), { boardMood: 37 }));
    assert.ok(Number.isInteger(r.total));
    assert.ok(Number.isInteger(r.breakdown.outperformance));
});

test('lucky breach scores less than in-mandate, more than losing breach', () => {
    const none = quarterPoints(summary({ breach: 'none' }), START);
    const lucky = quarterPoints(summary({ breach: 'lucky' }), START);
    const loss = quarterPoints(summary({ breach: 'loss' }), START);
    assert.ok(none > lucky && lucky > loss);
});

test('a losing breach costs more than an in-mandate quarter earns', () => {
    // playerDelta far from baseOcf with benchmark at baseOcf-ish: stability 0 (|-100 - baseOcf| = 70 exceeds the spread of 30), below red line
    const loss = quarterPoints(summary({ breach: 'loss', cashAfter: 100 }), START);
    assert.ok(loss < 0);
    assert.equal(loss, BALANCE.points.breachLoss);
});

test('quarterPoints components: red line and stability', () => {
    const base = summary({ cashAfter: 100 });
    assert.equal(quarterPoints(base, START), BALANCE.points.inMandate);
    assert.equal(quarterPoints({ ...base, cashAfter: 200 }, START), BALANCE.points.inMandate + BALANCE.points.aboveRedLine);
    // player exactly on baseOcf: full stability
    assert.equal(quarterPoints({ ...base, playerDelta: BASE_OCF, benchmarkDelta: BASE_OCF - 50 }, START),
        BALANCE.points.inMandate + BALANCE.points.stability);
    // half way: |p-base|=25, |b-base|=50
    assert.equal(quarterPoints({ ...base, playerDelta: BASE_OCF + 25, benchmarkDelta: BASE_OCF - 50 }, START),
        BALANCE.points.inMandate + 50);
    // benchmark == baseOcf: denominator floors at 1, no division blow-up
    assert.equal(quarterPoints({ ...base, playerDelta: BASE_OCF, benchmarkDelta: BASE_OCF }, START),
        BALANCE.points.inMandate + BALANCE.points.stability);
});

test('breakdown and mood multiplier', () => {
    const r = finalScore(input(history(1100, 1000), { boardMood: 100 }));
    assert.ok(Math.abs(r.breakdown.moodMultiplier - 1.2) < 1e-9);
    assert.equal(r.breakdown.outperformance, Math.round(BALANCE.points.outperformPerPct * 100 * 100 / START));
    assert.equal(r.breakdown.quarters, 8 * (BALANCE.points.inMandate + BALANCE.points.aboveRedLine));
    assert.ok(Math.abs(finalScore(input(history(1000, 1000), { boardMood: 0 })).breakdown.moodMultiplier - 0.8) < 1e-9);
});

test('empty history has zero outperformance', () => {
    const r = finalScore(input([], { status: 'bankrupt' }));
    assert.equal(r.breakdown.outperformance, 0);
    assert.equal(r.total, 0);
});

test('title picks the highest entry with score <= total; empty when none given', () => {
    const titles = [
        { min: 0, title: 'Intern', line: 'a' },
        { min: 1000, title: 'Manager', line: 'b' },
        { min: 5000, title: 'CFO', line: 'c' }
    ];
    const h = history(1000, 1000);
    const total = finalScore(input(h)).total;
    assert.ok(total >= 1000 && total < 5000);
    assert.equal(finalScore(input(h), titles).title, 'Manager');
    assert.equal(finalScore(input(h)).title, '');
    assert.equal(finalScore(input(h), []).title, '');
    assert.equal(finalScore(input(history(100000, 1000), { boardMood: 100 }), titles).title, 'CFO');
    assert.equal(finalScore(input([], { status: 'bankrupt' }), titles).title, 'Intern');
    assert.equal(finalScore(input([], { status: 'bankrupt' }), [{ min: 10, title: 'X', line: '' }]).title, '');
});

test('missing or non-finite boardMood defaults to startMood and is clamped, so the total is never NaN', () => {
    const h = history(1000, 1000);
    const base = finalScore(input(h, { boardMood: BALANCE.startMood }));
    for (const bad of [undefined, null, NaN, Infinity, 'x']) {
        const r = finalScore(input(h, { boardMood: bad }));
        assert.ok(Number.isFinite(r.total), String(bad));
        assert.equal(r.total, base.total);
        assert.equal(r.breakdown.moodMultiplier, base.breakdown.moodMultiplier);
    }
    assert.ok(Math.abs(finalScore(input(h, { boardMood: 500 })).breakdown.moodMultiplier - 1.2) < 1e-9);
    assert.ok(Math.abs(finalScore(input(h, { boardMood: -50 })).breakdown.moodMultiplier - 0.8) < 1e-9);
});
