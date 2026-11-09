// v3.1 Task 3: the board's policy is checked against the size-weighted "risk covered", with a "wrong focus" rule
// (the biggest exposure left open while a much smaller one is hedged). Pro is untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { BALANCE } from '../../js/engine/sim/balance.js';
import { quarterPoints } from '../../js/engine/sim/score.js';
import { exposureValue } from '../../js/engine/sim/exposureMath.js';
import { applyPowerUp } from '../../js/engine/sim/powerUps.js';
import { createRun, simulateQuarter, policyCover, quarterStartRates } from '../../js/engine/sim/SimEngine.js';
import { boardLineKey } from '../../js/screens/simple/RunController.js';

marketEngine.loadFromObjects(loadMarketData());
const airline = loadIndustries().find(i => i.id === 'airline');
const content = { events: [] };
const near = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-12, `${msg} ${a} !== ${b}`);

// ── exposureValue ──────────────────────────────────────────────────────────

test('exposureValue: FX and commodity notionals are already in the reporting currency; size is |notional|', () => {
    assert.equal(exposureValue({ type: 'fx', underlying: 'EURUSD', unit: 'USD' }, 1.1, 300), 300);
    assert.equal(exposureValue({ type: 'commodity', underlying: 'JETNWE', unit: 'USD' }, 700, -120), 120);
});

test('exposureValue: floating debt is one quarter of interest at the start rate', () => {
    near(exposureValue({ type: 'ir', underlying: 'EURIBOR', unit: 'EUR' }, 0.04, 1000), 10);
    near(exposureValue({ type: 'ir', underlying: 'EURIBOR', unit: 'EUR' }, -0.004, 1000), 1, 'negative rates: absolute');
});

// ── policyCover on a hand-built run ────────────────────────────────────────

const fx = (id, n, unlockQuarter = 0) => ({ id, type: 'fx', underlying: `EUR${id}`, direction: 'sell', unit: id, quarterlyNotional: n, unlockQuarter });
function fakeRun(exposures, { owned = ['facilities', 'hedgeAccess'], rates = null, quarter = 0 } = {}) {
    return {
        quarter, exposures, powerUps: { owned, used: [] },
        rates: rates ?? Object.fromEntries(exposures.map(e => [e.underlying, e.type === 'ir' ? 0.04 : 1.2]))
    };
}

test('cover: a known 2-exposure case gives the exact size-weighted value', () => {
    const run = fakeRun([fx('USD', 300), fx('GBP', 100)]);
    const r = policyCover(run, { USD: 0.75, GBP: 1 });
    assert.equal(r.cover, (0.75 * 300 + 1 * 100) / 400);   // 0.8125
    assert.deepEqual(r.values, { USD: 300, GBP: 100 });
    assert.equal(r.wrongFocus, false);
});

test('cover: the notional multiplier (an event) scales this quarter\'s sizes', () => {
    const run = fakeRun([fx('USD', 300), fx('GBP', 100)]);
    const r = policyCover(run, { USD: 0, GBP: 1 }, { USD: 1 / 3 });
    assert.equal(r.cover, 0.5);
    assert.deepEqual(r.values, { USD: 100, GBP: 100 });
});

test('cover uses the clamped ratio: 100% asked before facilities counts as 50%', () => {
    const run = fakeRun([fx('USD', 300), fx('GBP', 100)], { owned: [] });
    assert.equal(policyCover(run, { USD: 1, GBP: 1 }).cover, 0.5);
});

test('wrongFocus: each side of the 2x size boundary', () => {
    // L = 200 is exactly twice S = 100: wrong focus. L = 199 is not.
    assert.equal(policyCover(fakeRun([fx('USD', 200), fx('GBP', 100)]), { USD: 0, GBP: 0.5 }).wrongFocus, true);
    assert.equal(policyCover(fakeRun([fx('USD', 199), fx('GBP', 100)]), { USD: 0, GBP: 0.5 }).wrongFocus, false);
});

test('wrongFocus: each side of the 0.5 hedge-gap boundary', () => {
    const run = fakeRun([fx('USD', 300), fx('GBP', 100)]);
    assert.equal(policyCover(run, { USD: 0.25, GBP: 0.75 }).wrongFocus, true, 'gap exactly 0.5');
    assert.equal(policyCover(run, { USD: 0.5, GBP: 1 }).wrongFocus, true, 'gap exactly 0.5 at the top');
    assert.equal(policyCover(run, { USD: 0.2, GBP: 0.7 }).wrongFocus, true, 'gap 0.5 up to float error');
    assert.equal(policyCover(run, { USD: 0.25, GBP: 0.5 }).wrongFocus, false, 'gap 0.25');
    assert.equal(policyCover(run, { USD: 0.75, GBP: 0.25 }).wrongFocus, false, 'the big one hedged more is fine');
});

test('wrongFocus compares against the largest exposure only', () => {
    // L = USD 400 hedged 50%; CHF 200 (not small enough vs L? 400 >= 400: yes) at 100% -> wrong focus.
    const run = fakeRun([fx('USD', 400), fx('CHF', 200), fx('GBP', 300)]);
    assert.equal(policyCover(run, { USD: 0.5, CHF: 1, GBP: 0 }).wrongFocus, true);
    // GBP 300 at 0 vs CHF 200 at 1 is not about the largest exposure: no wrong focus.
    assert.equal(policyCover(run, { USD: 1, CHF: 1, GBP: 0 }).wrongFocus, false);
});

test('locked (not hedgeable) exposures are excluded from cover and wrongFocus, but keep a size', () => {
    const run = fakeRun([fx('USD', 100), { id: 'fuel', type: 'commodity', underlying: 'JETNWE', direction: 'buy', unit: 'USD', quarterlyNotional: 900, unlockQuarter: 0 }],
        { owned: ['facilities'] });
    const r = policyCover(run, { USD: 1, fuel: 0 });
    assert.equal(r.cover, 1);
    assert.equal(r.wrongFocus, false, 'the big fuel book is locked, so it is not "left open"');
    assert.deepEqual(r.values, { USD: 100, fuel: 900 });
});

test('exposures not active yet are left out entirely', () => {
    const run = fakeRun([fx('USD', 100), fx('GBP', 900, 4)]);
    const r = policyCover(run, { USD: 1, GBP: 0 });
    assert.equal(r.cover, 1);
    assert.deepEqual(r.values, { USD: 100 });
});

test('zero notional this quarter is excluded; all excluded gives cover null and no wrong focus', () => {
    const run = fakeRun([fx('USD', 300), fx('GBP', 100)]);
    const r = policyCover(run, { USD: 0, GBP: 1 }, { USD: 0 });
    assert.equal(r.cover, 1);
    assert.equal(r.wrongFocus, false);
    assert.equal(r.values.USD, 0);
    const none = policyCover(run, { USD: 1, GBP: 1 }, { USD: 0, GBP: 0 });
    assert.equal(none.cover, null);
    assert.equal(none.wrongFocus, false);
    const locked = policyCover(fakeRun([fx('USD', 300)], { owned: [] }), {}, { USD: 0 });
    assert.equal(locked.cover, null);
});

test('an exposure without a usable start rate is excluded and has no size', () => {
    const run = fakeRun([fx('USD', 300), fx('GBP', 100)], { rates: { EURUSD: 1.1 } });
    const r = policyCover(run, { USD: 0.5, GBP: 1 });
    assert.equal(r.cover, 0.5);
    assert.deepEqual(r.values, { USD: 300 });
});

test('an interest-rate book at a zero rate weighs nothing, and cover is null when nothing weighs anything', () => {
    const debt = { id: 'debt', type: 'ir', underlying: 'EURIBOR', direction: 'pay', unit: 'EUR', quarterlyNotional: 1e9, unlockQuarter: 0 };
    const r = policyCover(fakeRun([debt], { rates: { EURIBOR: 0 } }), { debt: 1 });
    assert.equal(r.cover, null);
    assert.equal(r.wrongFocus, false);
    assert.deepEqual(r.values, { debt: 0 });
});

test('quarterStartRates seeds a missing rate from this quarter, like simulateQuarter, without mutating the run', () => {
    const run = createRun({ industry: airline, seed: 1, startedAt: 1, market: marketEngine, forcedYear: 2010 });
    const missing = { ...run, rates: { ...run.rates } };
    delete missing.rates.EURUSD;
    const rates = quarterStartRates(missing, marketEngine);
    assert.equal(rates.EURUSD, marketEngine.getRate('EURUSD', 2010, 1));
    assert.equal(missing.rates.EURUSD, undefined);
});

// ── simulateQuarter: the policy check uses cover ───────────────────────────

function market(factors) {
    return {
        getDataset: u => marketEngine.getDataset(u),
        getRate: (u, y, q) => marketEngine.getRate(u, 2010, 1) * (factors[u] ?? 1) ** ((y - 2010) * 4 + (q - 1))
    };
}
const mkt = market({ JETNWE: 1.02, EURUSD: 1.02 });
// Airline Q1: fuel (commodity, 120m x 5 = 600m) and usd-revenue (fx, 150m x 5 = 750m).
function runOn(mandate, { powerUps = [], fuel = null } = {}) {
    let run = createRun({ industry: airline, seed: 12345, startedAt: 1, market: mkt, forcedYear: 2010 });
    run = { ...run, mandate, boardType: mandate === null ? 'none' : mandate.max === 0 ? 'noHedge' : 'band' };
    for (const id of powerUps) run = applyPowerUp(run, id);
    if (fuel !== null) run.exposures = run.exposures.map(e => (e.id === 'fuel' ? { ...e, quarterlyNotional: fuel } : e));
    return run;
}
const decide = (hedges, extra = {}) => ({ hedges, buyPowerUp: null, eventChoice: null, ...extra });
const moodChange = (run, summary) => summary.boardMoodAfter - run.boardMood;

test('the summary carries riskCover, wrongFocus and exposureValues', () => {
    const run = runOn({ min: 0.5, max: 0.75 }, { powerUps: ['facilities', 'hedgeAccess'] });
    const { summary } = simulateQuarter(run, decide({ fuel: 0.25, 'usd-revenue': 1 }), mkt, content);
    assert.deepEqual(summary.exposureValues, { fuel: 600e6, 'usd-revenue': 750e6 });
    near(summary.riskCover, (0.25 * 600e6 + 750e6) / 1350e6);
    assert.equal(summary.wrongFocus, false);
    const again = policyCover(run, { fuel: 0.25, 'usd-revenue': 1 });
    assert.equal(summary.riskCover, again.cover, 'the engine and the shared helper agree exactly');
});

test('in policy is judged on cover: one dial outside the band is fine when the total is inside', () => {
    const run = runOn({ min: 0.5, max: 0.75 }, { powerUps: ['facilities', 'hedgeAccess'] });
    // fuel 25% (outside 50–75) + usd 100% (outside) -> cover 0.667, inside. Not wrong focus (750 < 2 x 600).
    const inside = simulateQuarter(run, decide({ fuel: 0.25, 'usd-revenue': 1 }), mkt, content).summary;
    assert.equal(inside.policy, 'in');
    assert.equal(inside.inMandate, true);
    // Cover below or above the band is off policy; exactly on the minimum is in.
    const below = simulateQuarter(run, decide({ fuel: 0.25, 'usd-revenue': 0.25 }), mkt, content).summary;
    assert.equal(below.policy, 'off');
    const above = simulateQuarter(run, decide({ fuel: 1, 'usd-revenue': 1 }), mkt, content).summary;
    assert.equal(above.policy, 'off');
    const edge = simulateQuarter(run, decide({ fuel: 0.5, 'usd-revenue': 0.5 }), mkt, content).summary;
    assert.equal(edge.policy, 'in', 'exactly the band minimum');
});

test('wrong focus is off policy even with cover inside the band, and earns no in-policy points', () => {
    // fuel shrunk to 300m: usd 750m >= 2 x 300m. usd 25%, fuel 100%: cover 0.464, inside 25–50, but wrong focus.
    const run = runOn({ min: 0.25, max: 0.5 }, { powerUps: ['facilities', 'hedgeAccess'], fuel: 300e6 });
    const { summary } = simulateQuarter(run, decide({ fuel: 1, 'usd-revenue': 0.25 }), mkt, content);
    near(summary.riskCover, (300e6 + 0.25 * 750e6) / 1050e6);
    assert.ok(summary.riskCover >= 0.25 && summary.riskCover <= 0.5);
    assert.equal(summary.wrongFocus, true);
    assert.equal(summary.policy, 'off');
    assert.notEqual(summary.breach, 'none');
    const inPolicy = { ...summary, policy: 'in', inMandate: true, breach: 'none' };
    assert.ok(quarterPoints(summary, run.startingCash) < quarterPoints(inPolicy, run.startingCash));
    const fair = simulateQuarter(run, decide({ fuel: 0.5, 'usd-revenue': 0.5 }), mkt, content).summary;
    assert.equal(fair.policy, 'in');
    assert.equal(fair.wrongFocus, false);
});

test('locked exposures are excluded from the check: an unhedgeable fuel book at 0 does not drag cover down', () => {
    const run = runOn({ min: 0.25, max: 0.5 });
    const { summary } = simulateQuarter(run, decide({ fuel: 1, 'usd-revenue': 0.5 }), mkt, content);
    assert.equal(summary.riskCover, 0.5);
    assert.equal(summary.policy, 'in');
    assert.equal(summary.exposureValues.fuel, 600e6, 'still sized for the card');
});

test('zero notional is excluded from the check', () => {
    const run = runOn({ min: 0.25, max: 0.5 }, { powerUps: ['hedgeAccess'], fuel: 0 });
    const { summary } = simulateQuarter(run, decide({ fuel: 0, 'usd-revenue': 0.5 }), mkt, content);
    assert.equal(summary.riskCover, 0.5);
    assert.equal(summary.policy, 'in');
    const vacuous = runOn({ min: 0.25, max: 0.5 });
    vacuous.exposures = vacuous.exposures.map(e => ({ ...e, quarterlyNotional: 0 }));
    const v = simulateQuarter(vacuous, decide({ fuel: 0, 'usd-revenue': 0 }), mkt, content).summary;
    assert.equal(v.riskCover, null);
    assert.equal(v.wrongFocus, false);
    assert.equal(v.policy, 'in', 'nothing to hedge is vacuously in policy');
});

test('noHedge board unchanged: 0 everywhere is in policy, any hedge on a hedgeable exposure is off', () => {
    const run = runOn({ min: 0, max: 0 });
    assert.equal(simulateQuarter(run, decide({ fuel: 0, 'usd-revenue': 0 }), mkt, content).summary.policy, 'in');
    assert.equal(simulateQuarter(run, decide({ fuel: 0, 'usd-revenue': 0.25 }), mkt, content).summary.policy, 'off');
    assert.equal(simulateQuarter(run, decide({ fuel: 1, 'usd-revenue': 0 }), mkt, content).summary.policy, 'in',
        'fuel clamps to 0 before hedgeAccess');
});

test('no-policy board: wrong focus is flagged for the board line but changes nothing in the mood', () => {
    const run = runOn(null, { powerUps: ['facilities', 'hedgeAccess'], fuel: 300e6 });
    const wrong = simulateQuarter(run, decide({ fuel: 1, 'usd-revenue': 0 }), mkt, content).summary;
    assert.equal(wrong.wrongFocus, true);
    assert.equal(wrong.policy, 'none');
    assert.equal(wrong.inMandate, null);
    assert.equal(wrong.breach, 'none');
    const M = BALANCE.mood;
    const hedge = wrong.lines.reduce((s, l) => s + l.hedgeImpact, 0);
    let expected = M.noPolicyDrift + (hedge < 0 ? M.noPolicyHedgeLoss : hedge > 0 ? M.noPolicyHedgeWin : 0);
    if (wrong.playerDelta > wrong.benchmarkDelta) expected += M.beatBenchmark;
    if (wrong.cashAfter < wrong.redLine) expected += M.redZone;
    near(moodChange(run, wrong), expected);
});

test('determinism: the same seed and decisions give the same result', () => {
    const run = runOn({ min: 0.25, max: 0.5 }, { powerUps: ['facilities', 'hedgeAccess'], fuel: 300e6 });
    const d = decide({ fuel: 1, 'usd-revenue': 0.25 });
    const a = simulateQuarter(run, d, mkt, content);
    const b = simulateQuarter(structuredClone(run), structuredClone(d), mkt, content);
    assert.deepEqual(a, b);
    assert.deepEqual(JSON.parse(JSON.stringify(a.summary)), a.summary, 'JSON round-trippable');
});

// ── Fix round 1 ────────────────────────────────────────────────────────────

test('fix 1: a noHedge board never reports wrong focus (any hedge is the breach); a band board still does', () => {
    const exps = [fx('USD', 300), fx('GBP', 100)];
    const band = policyCover({ ...fakeRun(exps), mandate: { min: 0.25, max: 0.5 } }, { USD: 0, GBP: 1 });
    assert.equal(band.wrongFocus, true);
    const noHedge = policyCover({ ...fakeRun(exps), mandate: { min: 0, max: 0 } }, { USD: 0, GBP: 1 });
    assert.equal(noHedge.wrongFocus, false);
    assert.equal(noHedge.cover, 0.25, 'cover is still reported');
    const none = policyCover({ ...fakeRun(exps), mandate: null }, { USD: 0, GBP: 1 });
    assert.equal(none.wrongFocus, true, 'the no-policy board still gets the line');
});

test('fix 1: on a noHedge board the engine summary has no wrong focus and the quarter is off on cover alone', () => {
    const run = runOn({ min: 0, max: 0 }, { powerUps: ['facilities', 'hedgeAccess'], fuel: 300e6 });
    const { summary } = simulateQuarter(run, decide({ fuel: 1, 'usd-revenue': 0 }), mkt, content);
    assert.equal(summary.wrongFocus, false);
    assert.equal(summary.policy, 'off');
    assert.ok(summary.riskCover > 0);
    assert.notEqual(boardLineKey(summary, run.boardMood), 'wrongFocus');
});

test('fix 1 (minor 5): a weightless exposure (debt at a 0% rate) is left out, so it can never be the "small one"', () => {
    const debt = { id: 'debt', type: 'ir', underlying: 'EURIBOR', direction: 'pay', unit: 'EUR', quarterlyNotional: 1e9, unlockQuarter: 0 };
    const run = fakeRun([fx('USD', 300), debt], { rates: { EURUSD: 1.2, EURIBOR: 0 } });
    const r = policyCover(run, { USD: 0, debt: 1 });
    assert.equal(r.wrongFocus, false);
    assert.equal(r.cover, 0);
    assert.deepEqual(r.values, { USD: 300, debt: 0 });
});
