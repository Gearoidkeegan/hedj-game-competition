// A9 (rulings R40-R43): board types, proposing a policy, outcome-based mood and results-based firing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { BALANCE } from '../../js/engine/sim/balance.js';
import { quarterPoints } from '../../js/engine/sim/score.js';
import { applyPowerUp, borrowingBuffer } from '../../js/engine/sim/powerUps.js';
import { createRun, simulateQuarter, POLICY_OPTIONS } from '../../js/engine/sim/SimEngine.js';

marketEngine.loadFromObjects(loadMarketData());
const airline = loadIndustries().find(i => i.id === 'airline');
const content = { events: [] };

// Every underlying moves by its factor (default 1) each quarter from its real 2010 Q1 level (forcedYear 2010).
// Airline: JETNWE up hurts (fuel bought), EURUSD up hurts (USD revenue sold).
function market(factors) {
    return {
        getDataset: u => marketEngine.getDataset(u),
        getRate: (u, y, q) => marketEngine.getRate(u, 2010, 1) * (factors[u] ?? 1) ** ((y - 2010) * 4 + (q - 1))
    };
}

const BAND_LOW = { min: 0.25, max: 0.5 };
const NO_HEDGE = { min: 0, max: 0 };

function runOn(mkt, mandate, extra = {}) {
    const boardType = mandate === null ? 'none' : mandate.max === 0 ? 'noHedge' : 'band';
    const run = createRun({ industry: airline, seed: 12345, startedAt: 1, market: mkt, forcedYear: 2010 });
    return { ...run, mandate, boardType, ...extra };
}

const hedgesAt = (run, h) => Object.fromEntries(run.exposures.map(e => [e.id, h]));
const decide = (hedges, extra = {}) => ({ hedges, buyPowerUp: null, eventChoice: null, ...extra });
const moodChange = (run, summary) => summary.boardMoodAfter - run.boardMood;

test('board types follow the weights over 2,000 seeds (within 3 points)', () => {
    const counts = { band: 0, noHedge: 0, none: 0 };
    const bands = {};
    const N = 2000;
    for (let seed = 1; seed <= N; seed++) {
        const run = createRun({ industry: airline, seed, startedAt: 1, market: marketEngine });
        counts[run.boardType]++;
        if (run.boardType === 'none') assert.equal(run.mandate, null);
        if (run.boardType === 'noHedge') assert.deepEqual(run.mandate, NO_HEDGE);
        if (run.boardType === 'band') {
            const key = `${run.mandate.min}-${run.mandate.max}`;
            bands[key] = (bands[key] || 0) + 1;
        }
    }
    const share = c => c / N;
    for (const b of BALANCE.boards) {
        const observed = b.type === 'band' ? share(bands[`${b.min}-${b.max}`] || 0) : share(counts[b.type]);
        assert.ok(Math.abs(observed - b.weight) <= 0.03, `${b.type} ${b.min}-${b.max}: ${observed} vs ${b.weight}`);
    }
    assert.deepEqual(BALANCE.boards.map(b => b.weight), [0.2, 0.2, 0.2, 0.15, 0.25]);
});

test('the policy options are the three bands and "not to hedge"', () => {
    assert.deepEqual(POLICY_OPTIONS, [{ min: 0.25, max: 0.5 }, { min: 0.5, max: 0.75 }, { min: 0.75, max: 1 }, NO_HEDGE]);
});

test('a proposal is adopted from the next quarter, not this one', () => {
    const mkt = market({ JETNWE: 1.02, EURUSD: 1.02 });
    const run = runOn(mkt, null);
    const proposal = { min: 0.5, max: 0.75 };
    const q1 = simulateQuarter(run, decide(hedgesAt(run, 0), { proposePolicy: proposal }), mkt, content);
    assert.equal(q1.summary.policy, 'none');
    assert.equal(q1.summary.inMandate, null);
    assert.deepEqual(q1.summary.policyAdopted, proposal);
    assert.deepEqual(q1.run.mandate, proposal);
    assert.equal(q1.run.boardType, 'band');
    assert.equal(run.mandate, null, 'input not mutated');

    // Judged on the adopted band from Q2: 0.5 on the hedgeable exposure is in policy, 0 is off.
    const inQ2 = simulateQuarter(q1.run, decide(hedgesAt(q1.run, 0.5)), mkt, content).summary;
    assert.equal(inQ2.policy, 'in');
    assert.equal(inQ2.inMandate, true);
    assert.equal(inQ2.policyAdopted, null);
    const offQ2 = simulateQuarter(q1.run, decide(hedgesAt(q1.run, 0)), mkt, content).summary;
    assert.equal(offQ2.policy, 'off');
});

test('adopting "not to hedge" gives a noHedge board', () => {
    const run = runOn(marketEngine, null);
    const { run: after } = simulateQuarter(run, decide(hedgesAt(run, 0), { proposePolicy: NO_HEDGE }), marketEngine, content);
    assert.deepEqual(after.mandate, NO_HEDGE);
    assert.equal(after.boardType, 'noHedge');
});

test('adopting a policy gives a one-off mood boost and one-off points', () => {
    const mkt = market({ JETNWE: 1.02, EURUSD: 1.02 });
    const run = runOn(mkt, null);
    const without = simulateQuarter(run, decide(hedgesAt(run, 0)), mkt, content).summary;
    const withP = simulateQuarter(run, decide(hedgesAt(run, 0), { proposePolicy: BAND_LOW }), mkt, content).summary;
    assert.equal(withP.boardMoodAfter - without.boardMoodAfter, BALANCE.mood.policyAdopted);
    assert.equal(quarterPoints(withP, run.startingCash) - quarterPoints(without, run.startingCash), BALANCE.points.policyAdopted);
    assert.equal(without.policyAdopted, null);
});

test('a proposal is rejected when a policy already exists or is not one of the four options', () => {
    const banded = runOn(marketEngine, BAND_LOW);
    assert.throws(() => simulateQuarter(banded, decide(hedgesAt(banded, 0.25), { proposePolicy: BAND_LOW }), marketEngine, content),
        /policy/i);
    const noHedge = runOn(marketEngine, NO_HEDGE);
    assert.throws(() => simulateQuarter(noHedge, decide(hedgesAt(noHedge, 0), { proposePolicy: BAND_LOW }), marketEngine, content),
        /policy/i);
    const none = runOn(marketEngine, null);
    for (const bad of [{ min: 0.3, max: 0.6 }, { min: 0, max: 1 }, { min: 0.25 }, 'band', 7, {}]) {
        assert.throws(() => simulateQuarter(none, decide(hedgesAt(none, 0), { proposePolicy: bad }), marketEngine, content),
            /policy/i, JSON.stringify(bad));
    }
    // null or absent means no proposal.
    assert.doesNotThrow(() => simulateQuarter(none, decide(hedgesAt(none, 0), { proposePolicy: null }), marketEngine, content));
});

test('a proposal in the final quarter is rejected (it could never apply); the quarter before is fine', () => {
    const none = runOn(marketEngine, null);
    const last = { ...none, quarter: none.maxQuarters - 1 };
    assert.throws(() => simulateQuarter(last, decide(hedgesAt(last, 0), { proposePolicy: BAND_LOW }), marketEngine, content),
        /final quarter/);
    const before = { ...none, quarter: none.maxQuarters - 2 };
    const { run: after } = simulateQuarter(before, decide(hedgesAt(before, 0), { proposePolicy: BAND_LOW }), marketEngine, content);
    assert.deepEqual(after.mandate, BAND_LOW);
});

test('POLICY_OPTIONS and its entries are frozen', () => {
    assert.ok(Object.isFrozen(POLICY_OPTIONS));
    assert.ok(POLICY_OPTIONS.every(o => Object.isFrozen(o)));
    assert.throws(() => { POLICY_OPTIONS.push({ min: 0, max: 1 }); });
    assert.throws(() => { POLICY_OPTIONS[0].min = 0; });
});

// R49: the no-policy board loses patience every quarter it still has no policy, the proposal quarter included.
test('the patience drift applies every no-policy quarter and stops once a policy is adopted', () => {
    const mkt = market({});
    let run = runOn(mkt, null);
    const q1 = simulateQuarter(run, decide(hedgesAt(run, 0)), mkt, content);
    assert.equal(moodChange(run, q1.summary), BALANCE.mood.noPolicyDrift);
    run = { ...q1.run, pendingEvent: null };
    const q2 = simulateQuarter(run, decide(hedgesAt(run, 0), { proposePolicy: NO_HEDGE }), mkt, content);
    assert.equal(q2.summary.policy, 'none');
    assert.equal(moodChange(run, q2.summary), BALANCE.mood.noPolicyDrift + BALANCE.mood.policyAdopted);
    run = { ...q2.run, pendingEvent: null };
    const q3 = simulateQuarter(run, decide(hedgesAt(run, 0)), mkt, content);
    assert.equal(q3.summary.policy, 'in');
    // A flat market: in policy and good (marketResult 0), a tie with the benchmark, no drift.
    assert.equal(q3.summary.marketResult, 0);
    assert.equal(moodChange(run, q3.summary), BALANCE.mood.inPolicyGood);
});

test('a tie with the benchmark is not a beat on any board', () => {
    const mkt = market({ JETNWE: 1.05, EURUSD: 1.05 });
    for (const mandate of [BAND_LOW, NO_HEDGE, null]) {
        const run = runOn(mkt, mandate);
        const { summary } = simulateQuarter(run, decide(hedgesAt(run, 0)), mkt, content);
        assert.equal(summary.playerDelta, summary.benchmarkDelta);
        const term = mandate === null ? BALANCE.mood.noPolicyDrift
            : mandate.max === 0 ? BALANCE.mood.inPolicyBad : BALANCE.mood.breachLoss;
        assert.equal(moodChange(run, summary), term, JSON.stringify(mandate));
    }
});

test('no-policy board: a hedge loss drops mood by noPolicyHedgeLoss even when the business gained', () => {
    // Everything falls: fuel is cheaper and USD revenue is worth more, so the USD hedge loses.
    const mkt = market({ JETNWE: 0.9, EURUSD: 0.9 });
    const run = runOn(mkt, null);
    const { summary } = simulateQuarter(run, decide(hedgesAt(run, 0.5)), mkt, content);
    const hedge = summary.lines.reduce((s, l) => s + l.hedgeImpact, 0);
    assert.ok(hedge < 0, `hedge ${hedge}`);
    assert.ok(summary.playerDelta > 0, `playerDelta ${summary.playerDelta}`);
    assert.ok(summary.playerDelta < summary.benchmarkDelta);
    assert.equal(moodChange(run, summary), BALANCE.mood.noPolicyHedgeLoss + BALANCE.mood.noPolicyDrift);
    assert.ok(BALANCE.mood.noPolicyHedgeLoss < BALANCE.mood.inPolicyBad);
});

test('no-policy board: a hedge win earns noPolicyHedgeWin, and no hedge earns only the patience drift', () => {
    const mkt = market({ JETNWE: 1.02, EURUSD: 1.05 });
    const run = runOn(mkt, null);
    const win = simulateQuarter(run, decide(hedgesAt(run, 0.5)), mkt, content).summary;
    assert.ok(win.lines.reduce((s, l) => s + l.hedgeImpact, 0) > 0);
    assert.ok(win.playerDelta >= win.benchmarkDelta);
    assert.ok(win.cashAfter >= win.redLine);
    assert.ok(win.playerDelta > win.benchmarkDelta);
    assert.equal(moodChange(run, win), BALANCE.mood.noPolicyHedgeWin + BALANCE.mood.noPolicyDrift + BALANCE.mood.beatBenchmark);
    assert.ok(BALANCE.mood.noPolicyHedgeWin < BALANCE.mood.inPolicyGood, 'the hardest board to please');

    // R49: no hedge ties the benchmark (no beat) and the board still loses patience.
    const flat = simulateQuarter(run, decide(hedgesAt(run, 0)), mkt, content).summary;
    assert.equal(flat.playerDelta, flat.benchmarkDelta);
    assert.equal(moodChange(run, flat), BALANCE.mood.noPolicyDrift);
    assert.ok(BALANCE.mood.noPolicyDrift < 0);
});

test('no-policy board: no policy or breach points, never severe', () => {
    // A severe-sized loss on a no-policy board is not a breach: there is no policy to breach.
    const mkt = market({ JETNWE: 1.2, EURUSD: 1.2 });
    const run = runOn(mkt, null);
    const { run: after, summary } = simulateQuarter(run, decide(hedgesAt(run, 0)), mkt, content);
    assert.ok(summary.marketResult <= -BALANCE.severeBreachLossPct * run.startingCash, `marketResult ${summary.marketResult}`);
    assert.equal(summary.policy, 'none');
    assert.equal(summary.inMandate, null);
    assert.equal(summary.breach, 'none');
    assert.equal(summary.severe, false);
    assert.equal(after.status, 'playing');
    // The same quarter judged in policy would earn the policy points on top.
    assert.equal(quarterPoints(summary, run.startingCash),
        quarterPoints({ ...summary, policy: 'in', inMandate: true }, run.startingCash) - BALANCE.points.inMandate);
});

test('in policy and good: inPolicyGood', () => {
    // Fuel cheaper (unhedgeable, a gain), USD revenue hurt; the hedge gains, so the board also sees a beat.
    const mkt = market({ JETNWE: 0.95, EURUSD: 1.02 });
    const run = runOn(mkt, BAND_LOW);
    const { summary } = simulateQuarter(run, decide(hedgesAt(run, 0.5)), mkt, content);
    assert.equal(summary.policy, 'in');
    assert.ok(summary.marketResult >= 0);
    assert.ok(summary.playerDelta >= summary.benchmarkDelta);
    assert.equal(moodChange(run, summary), BALANCE.mood.inPolicyGood + BALANCE.mood.beatBenchmark);
    assert.ok(BALANCE.mood.inPolicyGood > 0);
});

test('an in-policy losing quarter lowers mood by inPolicyBad only', () => {
    // Fuel (unhedgeable) up 10%; USD revenue gains, so the in-band USD hedge loses: no benchmark beat.
    const mkt = market({ JETNWE: 1.1, EURUSD: 0.95 });
    const run = runOn(mkt, BAND_LOW);
    const { run: after, summary } = simulateQuarter(run, decide(hedgesAt(run, 0.5)), mkt, content);
    assert.equal(summary.policy, 'in');
    assert.equal(summary.breach, 'none');
    assert.ok(summary.marketResult < 0);
    assert.ok(summary.playerDelta < summary.benchmarkDelta);
    assert.ok(summary.cashAfter >= summary.redLine);
    assert.equal(moodChange(run, summary), BALANCE.mood.inPolicyBad);
    assert.ok(BALANCE.mood.inPolicyBad < 0 && BALANCE.mood.inPolicyBad > BALANCE.mood.breachLoss / 2, 'falls only slightly');
    assert.equal(after.status, 'playing');
});

test('noHedge board: hedging nothing is in policy, judged on the outcome', () => {
    const mkt = market({ JETNWE: 1.1, EURUSD: 1.1 });
    const run = runOn(mkt, NO_HEDGE);
    const { summary } = simulateQuarter(run, decide(hedgesAt(run, 0)), mkt, content);
    assert.equal(summary.policy, 'in');
    assert.ok(summary.marketResult < 0);
    // R49: unhedged ties the benchmark, and a tie is not a beat.
    assert.equal(summary.playerDelta, summary.benchmarkDelta);
    assert.equal(moodChange(run, summary), BALANCE.mood.inPolicyBad);
    const off = simulateQuarter(run, decide(hedgesAt(run, 0.25)), mkt, content).summary;
    assert.equal(off.policy, 'off');
});

test('off policy: lucky is mixed (about 0), a loss is the heaviest criticism', () => {
    const up = market({ JETNWE: 1.05, EURUSD: 1.05 });
    const down = market({ JETNWE: 0.95, EURUSD: 0.95 });
    const runUp = runOn(up, BAND_LOW);
    const runDown = runOn(down, BAND_LOW);
    const loss = simulateQuarter(runUp, decide(hedgesAt(runUp, 0)), up, content).summary;
    const lucky = simulateQuarter(runDown, decide(hedgesAt(runDown, 0)), down, content).summary;
    assert.equal(loss.policy, 'off');
    assert.equal(loss.breach, 'loss');
    assert.equal(lucky.breach, 'lucky');
    // Unhedged ties the benchmark: no beat (R49).
    assert.equal(moodChange(runUp, loss), BALANCE.mood.breachLoss);
    assert.equal(moodChange(runDown, lucky), BALANCE.mood.luckyBreach);
    assert.ok(Math.abs(BALANCE.mood.luckyBreach) <= 2);
    assert.ok(BALANCE.mood.breachLoss < BALANCE.mood.inPolicyBad);
});

test('two off-policy losing quarters that are not severe and keep mood above the threshold do not fire', () => {
    const up = market({ JETNWE: 1.05, EURUSD: 1.05 });
    let run = runOn(up, BAND_LOW, { boardMood: 100 });
    for (let i = 0; i < 2; i++) {
        const r = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content);
        assert.equal(r.summary.breach, 'loss');
        assert.equal(r.summary.severe, false);
        run = r.run;
    }
    assert.ok(run.boardMood > BALANCE.fireThreshold);
    assert.equal(run.status, 'playing');
    assert.equal(BALANCE.breachLossesToFire, undefined);
});

test('a severe off-policy loss still fires at once', () => {
    const up = market({ JETNWE: 1.2, EURUSD: 1.2 });
    const run = runOn(up, BAND_LOW, { boardMood: 100 });
    const { run: after, summary } = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content);
    assert.equal(summary.severe, true);
    assert.ok(after.cash > 0);
    assert.equal(after.status, 'fired');
});

test('a low board mood fires', () => {
    const up = market({ JETNWE: 1.05, EURUSD: 1.05 });
    const run = runOn(up, BAND_LOW, { boardMood: BALANCE.fireThreshold + 1 });
    const { run: after } = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content);
    assert.ok(after.boardMood <= BALANCE.fireThreshold);
    assert.equal(after.status, 'fired');
});

// Cash just below zero: inside the facilities borrowing buffer it survives, without facilities it is bankrupt.
test('cash below 0 but above -buffer survives with facilities and is bankrupt without', () => {
    const mkt = market({ JETNWE: 1.05, EURUSD: 1.05 });
    const base = runOn(mkt, NO_HEDGE);
    const withFac = applyPowerUp(base, 'facilities');
    const buffer = borrowingBuffer(withFac);
    assert.equal(borrowingBuffer(base), 0);
    assert.equal(buffer, BALANCE.facilities.borrowPct * base.startingCash);

    const probe = simulateQuarter(base, decide(hedgesAt(base, 0)), mkt, content).summary.playerDelta;
    const target = -buffer / 2;
    const setCash = run => ({ ...run, cash: target - probe });

    const saved = simulateQuarter(setCash(withFac), decide(hedgesAt(base, 0)), mkt, content);
    assert.ok(saved.summary.cashAfter < 0 && saved.summary.cashAfter > -buffer, `cash ${saved.summary.cashAfter}`);
    assert.equal(saved.run.status, 'playing');

    const bust = simulateQuarter(setCash(base), decide(hedgesAt(base, 0)), mkt, content);
    assert.ok(Math.abs(bust.summary.cashAfter - target) < 1, `cash ${bust.summary.cashAfter}`);
    assert.equal(bust.run.status, 'bankrupt');

    const deep = simulateQuarter({ ...setCash(withFac), cash: -1.5 * buffer - probe }, decide(hedgesAt(base, 0)), mkt, content);
    assert.equal(deep.run.status, 'bankrupt');
});

// Bankruptcy is cash < -buffer: exactly -buffer survives, exactly 0 without facilities survives.
// A flat market and no hedging make the quarter's cash change exactly the base operating cash flow.
test('bankruptcy boundaries: exactly -buffer survives with facilities; exactly 0 survives and just below 0 is bankrupt without', () => {
    const flat = market({});
    const base = runOn(flat, NO_HEDGE);
    const ocf = BALANCE.baseOcfPct * base.startingCash;
    const play = (run, cash) => simulateQuarter({ ...run, cash: cash - ocf }, decide(hedgesAt(run, 0)), flat, content);

    const withFac = applyPowerUp(base, 'facilities');
    const buffer = borrowingBuffer(withFac);
    const atBuffer = play(withFac, -buffer);
    assert.equal(atBuffer.summary.cashAfter, -buffer);
    assert.equal(atBuffer.run.status, 'playing');
    const pastBuffer = play(withFac, -buffer - 1);
    assert.equal(pastBuffer.run.status, 'bankrupt');

    const atZero = play(base, 0);
    assert.equal(atZero.summary.cashAfter, 0);
    assert.equal(atZero.run.status, 'playing');
    const belowZero = play(base, -1);
    assert.equal(belowZero.summary.cashAfter, -1);
    assert.equal(belowZero.run.status, 'bankrupt');
});

test('status precedence: bankrupt beats a severe loss in the same quarter', () => {
    const up = market({ JETNWE: 1.2, EURUSD: 1.2 });
    const run = runOn(up, BAND_LOW, { cash: 1 });
    const { run: after, summary } = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content);
    assert.equal(summary.severe, true);
    assert.equal(after.status, 'bankrupt');
});
