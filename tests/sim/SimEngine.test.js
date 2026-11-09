import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { exposureCashImpact } from '../../js/engine/sim/exposureMath.js';
import { BALANCE } from '../../js/engine/sim/balance.js';
import { applyPowerUp } from '../../js/engine/sim/powerUps.js';
import { createRun, simulateQuarter, activeExposures, isRunOver, classifyBreach } from '../../js/engine/sim/SimEngine.js';

marketEngine.loadFromObjects(loadMarketData());
const airline = loadIndustries().find(i => i.id === 'airline');
const content = { events: [] };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ''} ${a} !== ${b}`);

// Every underlying moves by `factor` each quarter from its real 2010 Q1 level (use forcedYear 2010).
// For the airline, factor > 1 hurts unhedged (fuel up, EURUSD up), factor < 1 helps.
// Unhedged airline Q1 loss as a share of starting cash: 1.05 -> about 15% (mild), 1.2 -> about 58% (severe).
function trendMarket(factor) {
    return {
        getDataset: (u) => marketEngine.getDataset(u),
        getRate: (u, y, q) => marketEngine.getRate(u, 2010, 1) * factor ** ((y - 2010) * 4 + (q - 1))
    };
}

// A 25-50% band board, so the tests do not depend on the board the seed draws (A9: it may have no policy).
const BAND_LOW = { min: 0.25, max: 0.5 };
function newRun(market = marketEngine, extra = {}) {
    const run = createRun({ industry: airline, seed: 12345, startedAt: 1700000000000, market, ...extra });
    return { ...run, mandate: BAND_LOW, boardType: 'band' };
}

// An in-policy hedge for whatever board the seed drew (0 on a no-policy or noHedge board).
const policyHedge = run => (run.mandate ? run.mandate.min : 0);

function hedgesAt(run, h) {
    return Object.fromEntries(run.exposures.map(e => [e.id, h]));
}

function decide(hedges, extra = {}) {
    return { hedges, buyPowerUp: null, eventChoice: null, ...extra };
}

function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
    }
    return o;
}

test('createRun is deterministic', () => {
    const make = () => createRun({ industry: airline, seed: 12345, startedAt: 1700000000000, market: marketEngine });
    const a = make();
    const b = make();
    assert.deepEqual(a, b);
    assert.equal(a.version, 3);
    assert.equal(a.status, 'playing');
    assert.equal(a.quarter, 0);
    assert.equal(a.boardMood, BALANCE.startMood);
    assert.equal(a.cash, airline.startingCash);
    assert.equal(a.benchmarkCash, airline.startingCash);
    assert.equal(a.redLine, BALANCE.redLinePct * airline.startingCash);
    assert.ok(BALANCE.boards.some(m => m.type === a.boardType
        && (a.mandate === null ? m.type === 'none' : m.min === a.mandate.min && m.max === a.mandate.max)));
    assert.equal(a.forecastLevel, 0);
    assert.equal(a.rates.JETNWE, marketEngine.getRate('JETNWE', a.startYear, 1));
});

test('run is JSON round-trippable', () => {
    const run = newRun();
    assert.deepEqual(JSON.parse(JSON.stringify(run)), run);
    const { run: after } = simulateQuarter(run, decide(hedgesAt(run, run.mandate.min)), marketEngine, content);
    assert.deepEqual(JSON.parse(JSON.stringify(after)), after);
});

test('all-zero hedges: playerDelta === benchmarkDelta', () => {
    const run = newRun();
    const { summary } = simulateQuarter(run, decide(hedgesAt(run, 0)), marketEngine, content);
    assert.equal(summary.playerDelta, summary.benchmarkDelta);
    assert.notEqual(summary.playerDelta, 0);
});

// The benchmark is unhedged, so the 100%-forward identity is checked on the player side (ruling R14):
//   marketResult = Σ exposureImpact(realised − forecast)      (only the over- or under-hedge remains)
//   |playerDelta − baseOcf| = |that residual|
//   playerDelta − benchmarkDelta = Σ hedgeImpact
test('100% forward: marketResult = Σ exposure impact on (realised − forecast); player − benchmark = Σ hedgeImpact', () => {
    // 100% on every exposure needs facilities (cap) and hedgeAccess (fuel).
    const run = applyPowerUp(applyPowerUp(newRun(), 'facilities'), 'hedgeAccess');
    const { run: after, summary } = simulateQuarter(run, decide(hedgesAt(run, 1)), marketEngine, content);
    const byId = Object.fromEntries(run.exposures.map(e => [e.id, e]));
    let residual = 0;
    let hedgeSum = 0;
    for (const l of summary.lines) {
        const e = byId[l.exposureId];
        residual += exposureCashImpact(e, run.rates[e.underlying], after.rates[e.underlying],
            l.realisedNotional - l.forecastNotional);
        hedgeSum += l.hedgeImpact;
    }
    const ocf = BALANCE.baseOcfPct * run.startingCash;
    near(summary.marketResult, residual, 'marketResult');
    near(Math.abs(summary.playerDelta - ocf), Math.abs(residual), 'player');
    // The unhedged benchmark keeps the full move; the gap is exactly the hedge P&L.
    near(summary.playerDelta - summary.benchmarkDelta, hedgeSum, 'gap');
    assert.notEqual(hedgeSum, 0);
});

test('simulateQuarter does not mutate its input', () => {
    const run = deepFreeze(newRun());
    const decisions = deepFreeze(decide(hedgesAt(run, 0.5)));
    const result = simulateQuarter(run, decisions, marketEngine, deepFreeze({ events: [] }));
    assert.equal(run.quarter, 0);
    assert.equal(run.history.length, 0);
    assert.equal(result.run.quarter, 1);
    assert.notEqual(result.run, run);
});

test('breach classification', () => {
    const up = trendMarket(1.1);
    const down = trendMarket(0.9);
    const runUp = newRun(up, { forcedYear: 2010 });
    const runDown = newRun(down, { forcedYear: 2010 });

    const loss = simulateQuarter(runUp, decide(hedgesAt(runUp, 0)), up, content).summary;
    assert.equal(loss.inMandate, false);
    assert.equal(loss.policy, 'off');
    assert.ok(loss.marketResult < 0);
    assert.equal(loss.breach, 'loss');

    const lucky = simulateQuarter(runDown, decide(hedgesAt(runDown, 0)), down, content).summary;
    assert.equal(lucky.inMandate, false);
    assert.ok(lucky.marketResult >= 0);
    assert.equal(lucky.breach, 'lucky');

    for (const [run, market] of [[runUp, up], [runDown, down]]) {
        const s = simulateQuarter(run, decide(hedgesAt(run, run.mandate.min)), market, content).summary;
        assert.equal(s.inMandate, true);
        assert.equal(s.policy, 'in');
        assert.equal(s.breach, 'none');
    }
});

test('lucky breach is criticised less than a losing breach', () => {
    const up = trendMarket(1.1);
    const down = trendMarket(0.9);
    const runUp = newRun(up, { forcedYear: 2010 });
    const runDown = newRun(down, { forcedYear: 2010 });
    const loss = simulateQuarter(runUp, decide(hedgesAt(runUp, 0)), up, content).summary;
    const lucky = simulateQuarter(runDown, decide(hedgesAt(runDown, 0)), down, content).summary;
    assert.equal(loss.breach, 'loss');
    assert.equal(lucky.breach, 'lucky');
    const lossChange = loss.boardMoodAfter - runUp.boardMood;
    const luckyChange = lucky.boardMoodAfter - runDown.boardMood;
    assert.ok(luckyChange > lossChange, `${luckyChange} > ${lossChange}`);
    // Unhedged ties the benchmark, which is not a beat (R49).
    assert.equal(lossChange, BALANCE.mood.breachLoss);
    assert.equal(luckyChange, BALANCE.mood.luckyBreach);
});

// A9 (R41): in policy, the board judges the outcome. The fuel exposure is not hedgeable yet.
test('in-policy quarter: a loss that beats the benchmark gets inPolicyBad + beatBenchmark; a gain that lags gets inPolicyGood', () => {
    const down = trendMarket(0.9);
    const up = trendMarket(1.1);
    const run = newRun(up, { forcedYear: 2010 });
    const s = simulateQuarter(run, decide(hedgesAt(run, run.mandate.max)), up, content).summary;
    assert.equal(s.breach, 'none');
    assert.ok(s.marketResult < 0);
    assert.ok(s.playerDelta >= s.benchmarkDelta);
    assert.equal(s.boardMoodAfter - run.boardMood, BALANCE.mood.inPolicyBad + BALANCE.mood.beatBenchmark);
    const runD = newRun(down, { forcedYear: 2010 });
    const sd = simulateQuarter(runD, decide(hedgesAt(runD, runD.mandate.max)), down, content).summary;
    assert.ok(sd.marketResult >= 0);
    assert.ok(sd.playerDelta < sd.benchmarkDelta);
    assert.equal(sd.boardMoodAfter - runD.boardMood, BALANCE.mood.inPolicyGood);
});

test('bankruptcy', () => {
    const up = trendMarket(1.1);
    const run = { ...newRun(up, { forcedYear: 2010 }), cash: 1 };
    const { run: after, summary } = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content);
    assert.ok(summary.cashAfter <= 0);
    assert.equal(after.status, 'bankrupt');
    assert.equal(after.history.length, 1);
    assert.deepEqual(after.history[0], summary);
});

test('status precedence: bankrupt beats a low board mood in the same quarter', () => {
    const up = trendMarket(1.1);
    const run = { ...newRun(up, { forcedYear: 2010 }), cash: 1, boardMood: 1 };
    const { run: after, summary } = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content);
    assert.equal(summary.breach, 'loss');
    assert.ok(after.boardMood <= BALANCE.fireThreshold);
    assert.equal(after.status, 'bankrupt');
});

// R40: the two-strike rule is gone; a second (non-severe) losing breach on a happy board keeps the job.
test('a 2nd losing breach no longer fires a happy board', () => {
    const up = trendMarket(1.05);
    let run = newRun(up, { forcedYear: 2010 });
    run = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content).run;
    run = { ...run, boardMood: 100 };
    const { run: after, summary } = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content);
    assert.equal(summary.breach, 'loss');
    assert.equal(summary.severe, false);
    assert.equal(after.history.filter(s => s.breach === 'loss').length, 2);
    assert.equal(after.status, 'playing');
});

test('classifyBreach: in band -> none, not severe', () => {
    for (const marketResult of [500, 0, -999]) {
        assert.deepEqual(classifyBreach({ inMandate: true, marketResult, startingCash: 1000 }), { breach: 'none', severe: false });
    }
});

test('classifyBreach: off band with a gain -> lucky, not severe', () => {
    for (const marketResult of [0, 1, 5000]) {
        assert.deepEqual(classifyBreach({ inMandate: false, marketResult, startingCash: 1000 }), { breach: 'lucky', severe: false });
    }
});

test('classifyBreach: off band with a small loss -> loss, not severe', () => {
    const startingCash = 1000;
    const edge = BALANCE.severeBreachLossPct * startingCash;
    for (const marketResult of [-1, -edge / 2, -edge + 0.001]) {
        assert.deepEqual(classifyBreach({ inMandate: false, marketResult, startingCash }), { breach: 'loss', severe: false });
    }
});

test('classifyBreach: off band with a loss at or beyond the threshold -> loss and severe', () => {
    const startingCash = 1000;
    const edge = BALANCE.severeBreachLossPct * startingCash;
    for (const marketResult of [-edge, -edge - 1, -10 * startingCash]) {
        assert.deepEqual(classifyBreach({ inMandate: false, marketResult, startingCash }), { breach: 'loss', severe: true });
    }
});

test('classifyBreach: a loss of exactly the threshold is severe', () => {
    const startingCash = 2e8;
    const marketResult = -BALANCE.severeBreachLossPct * startingCash;
    assert.deepEqual(classifyBreach({ inMandate: false, marketResult, startingCash }), { breach: 'loss', severe: true });
});

// R38: bad startingCash never makes a breach severe (running out of cash is bankruptcy's job).
test('classifyBreach: startingCash 0, negative or not finite -> never severe, breach still loss', () => {
    for (const startingCash of [0, -1, NaN, Infinity, undefined]) {
        assert.deepEqual(classifyBreach({ inMandate: false, marketResult: -1e9, startingCash }), { breach: 'loss', severe: false },
            `startingCash ${startingCash}`);
    }
});

// R38: a non-finite marketResult is classified as 0 (off mandate: lucky; in mandate: none).
test('classifyBreach: marketResult not finite is classified as 0', () => {
    for (const marketResult of [NaN, -Infinity, Infinity, undefined]) {
        assert.deepEqual(classifyBreach({ inMandate: false, marketResult, startingCash: 1000 }),
            classifyBreach({ inMandate: false, marketResult: 0, startingCash: 1000 }), `marketResult ${marketResult}`);
        assert.deepEqual(classifyBreach({ inMandate: false, marketResult, startingCash: 1000 }), { breach: 'lucky', severe: false });
        assert.deepEqual(classifyBreach({ inMandate: true, marketResult, startingCash: 1000 }), { breach: 'none', severe: false });
    }
});

test('a severe losing breach in Q1 fires at once, even with the board above the threshold', () => {
    const up = trendMarket(1.2);
    const run = newRun(up, { forcedYear: 2010 });
    const { run: after, summary } = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content);
    assert.equal(summary.breach, 'loss');
    assert.ok(summary.marketResult <= -BALANCE.severeBreachLossPct * run.startingCash, `marketResult ${summary.marketResult}`);
    assert.equal(summary.severe, true);
    assert.ok(after.cash > 0);
    assert.ok(after.boardMood > BALANCE.fireThreshold, `mood ${after.boardMood}`);
    assert.equal(after.history.filter(s => s.breach === 'loss').length, 1);
    assert.equal(after.status, 'fired');
    assert.equal(after.pendingEvent, null);
});

test('a mild losing breach in Q1 keeps the player in the job', () => {
    const up = trendMarket(1.05);
    const run = newRun(up, { forcedYear: 2010 });
    const { run: after, summary } = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content);
    assert.equal(summary.breach, 'loss');
    assert.equal(summary.severe, false);
    assert.equal(after.status, 'playing');
});

test('status precedence: bankrupt beats a severe losing breach in the same quarter', () => {
    const up = trendMarket(1.2);
    const run = { ...newRun(up, { forcedYear: 2010 }), cash: 1 };
    const { run: after, summary } = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content);
    assert.equal(summary.severe, true);
    assert.ok(summary.cashAfter <= 0);
    assert.equal(after.status, 'bankrupt');
});

function playFull(seed) {
    let run = createRun({ industry: airline, seed, startedAt: 1, market: marketEngine });
    while (!isRunOver(run)) {
        // hedgeAccess in Q1, so the fuel exposure is hedged in policy too.
        const buyPowerUp = run.quarter === 0 ? 'hedgeAccess' : null;
        run = simulateQuarter(run, decide(hedgesAt(run, policyHedge(run)), { buyPowerUp }), marketEngine, content).run;
    }
    return run;
}

test('full runs are deterministic per seed and differ across seeds', () => {
    const a = playFull(4242);
    assert.deepEqual(playFull(4242), a);
    assert.equal(a.history.length, 8);
    assert.notDeepEqual(playFull(4243).history, a.history);
});

test('a 1 pp EURIBOR rise on EUR 2bn floating debt costs about EUR 5m a quarter', () => {
    const debt = airline.exposures.find(e => e.id === 'floating-debt');
    assert.equal(debt.quarterlyNotional, 2e9);
    const impact = exposureCashImpact(debt, 0.03, 0.04, debt.quarterlyNotional);
    near(impact, -5e6, 'impact');
});

test('mood is clamped to 0..100 and a low mood fires', () => {
    const up = trendMarket(1.1);
    const run = { ...newRun(up, { forcedYear: 2010 }), boardMood: 5 };
    const { run: after } = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content);
    assert.equal(after.boardMood, 0);
    assert.equal(after.status, 'fired');
    const down = trendMarket(0.9);
    const high = { ...newRun(down, { forcedYear: 2010 }), boardMood: 99 };
    const r2 = simulateQuarter(high, decide(hedgesAt(high, high.mandate.max)), down, content).run;
    assert.equal(r2.boardMood, 100);
});

test('complete after 8', () => {
    let run = newRun();
    for (let i = 0; i < 8; i++) {
        assert.equal(isRunOver(run), false);
        run = simulateQuarter(run, decide(hedgesAt(run, run.mandate.min)), marketEngine, content).run;
    }
    assert.equal(run.status, 'complete');
    assert.equal(run.quarter, 8);
    assert.equal(run.history.length, 8);
    assert.deepEqual(run.history.map(h => h.q), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok(run.history.every(h => h.breach === 'none'));
    assert.throws(() => simulateQuarter(run, decide(hedgesAt(run, 0.5)), marketEngine, content));
});

test('IR realised notional equals forecast at q>=6 regardless of seed', () => {
    for (const seed of [1, 7, 12345, 999999, 0xDEADBEEF]) {
        let run = { ...createRun({ industry: airline, seed, startedAt: 1, market: marketEngine }), mandate: BAND_LOW, boardType: 'band' };
        while (run.quarter < 8) {
            const before = run.quarter;
            const startRates = run.rates;
            const r = simulateQuarter(run, decide(hedgesAt(run, run.mandate.min)), marketEngine, content);
            run = r.run;
            if (before >= 6) {
                const debt = r.summary.lines.find(l => l.exposureId === 'floating-debt');
                assert.ok(debt, `seed ${seed}: floating-debt active from quarter index 6`);
                assert.equal(debt.realisedNotional, debt.forecastNotional);
                near(debt.movePct, (run.rates.EURIBOR - startRates.EURIBOR) * 100, 'ir movePct (pp)');
                const fuel = r.summary.lines.find(l => l.exposureId === 'fuel');
                assert.notEqual(fuel.realisedNotional, fuel.forecastNotional);
            }
        }
        assert.equal(run.status, 'complete');
    }
});

test('GBP exposure unlocks at Q4', () => {
    const run = newRun();
    assert.ok(!activeExposures({ ...run, quarter: 3 }).some(e => e.id === 'gbp-revenue'));
    assert.ok(activeExposures({ ...run, quarter: 4 }).some(e => e.id === 'gbp-revenue'));
});

test('a zero start rate, or a missing one with no data this quarter, is treated as no move', () => {
    const base = newRun();
    const start = { year: base.startYear, quarter: 1 };
    // No JETNWE data at the run's first quarter, so the missing rate can't be seeded (I4).
    const gappy = {
        getDataset: u => marketEngine.getDataset(u),
        getRate: (u, y, q) => (u === 'JETNWE' && y === start.year && q === start.quarter ? null : marketEngine.getRate(u, y, q))
    };
    for (const [bad, market] of [[0, marketEngine], [null, gappy]]) {
        const run = { ...base, rates: { ...base.rates, JETNWE: bad } };
        const { summary } = simulateQuarter(run, decide(hedgesAt(run, 0.5)), market, content);
        const fuel = summary.lines.find(l => l.exposureId === 'fuel');
        assert.equal(fuel.movePct, 0);
        assert.equal(fuel.exposureImpact, 0);
        assert.equal(fuel.hedgeImpact, 0);
        assert.ok(Number.isFinite(summary.playerDelta));
    }
});

test('a missing start rate is seeded from this quarter when the data exists (I4)', () => {
    const base = newRun();
    const { JETNWE: _dropped, ...rest } = base.rates;
    const run = { ...base, rates: rest };
    const { summary } = simulateQuarter(run, decide(hedgesAt(run, 0.5)), marketEngine, content);
    const ref = simulateQuarter(base, decide(hedgesAt(base, 0.5)), marketEngine, content).summary;
    assert.deepEqual(summary, ref, 'same result as a run whose rate was set at creation');
});

test('out-of-range hedge ratio throws', () => {
    const run = newRun();
    assert.throws(() => simulateQuarter(run, decide({ fuel: 1.5 }), marketEngine, content));
});

// I4: an exposure that unlocks mid-run on an underlying with no data at the start year's Q1 (DAIRY starts 2006,
// COPPER after 2000 Q1) used to show a 0.00% move every quarter. Its rate is now seeded when it becomes active.
for (const [industryId, year, exposureId] of [['agrifoods', 2005, 'dairy'], ['tech', 2000, 'copper']]) {
    test(`${industryId} ${year}: ${exposureId} moves after it unlocks mid-run`, () => {
        const industry = loadIndustries().find(i => i.id === industryId);
        const exp = industry.exposures.find(e => e.id === exposureId);
        assert.ok(exp.unlockQuarter > 0);
        assert.equal(marketEngine.getRate(exp.underlying, year, 1), null, 'the case under test: no data at Q1');
        let run = createRun({ industry, seed: 777, startedAt: 1700000000000, market: marketEngine, forcedYear: year });
        assert.equal(run.startYear, year);
        run = { ...run, mandate: { min: 0, max: 1 }, boardType: 'band' };
        const moves = [];
        while (!isRunOver(run)) {
            // Keep the run alive so every quarter is played; only the market lines matter here.
            run = { ...run, boardMood: 100, cash: run.startingCash, pendingEvent: null };
            const { run: next, summary } = simulateQuarter(run, decide(hedgesAt(run, 0)), marketEngine, content);
            const line = summary.lines.find(l => l.exposureId === exposureId);
            if (line) moves.push(line);
            run = next;
        }
        assert.equal(run.history.length, 8);
        assert.equal(moves.length, 8 - exp.unlockQuarter, 'one line per active quarter');
        assert.ok(moves.some(l => l.movePct !== 0 && l.exposureImpact !== 0), JSON.stringify(moves.map(l => l.movePct)));
    });
}

test('seeding a late rate draws no random numbers: the same seed replays identically', () => {
    const industry = loadIndustries().find(i => i.id === 'agrifoods');
    const play = () => {
        let run = createRun({ industry, seed: 4242, startedAt: 1700000000000, market: marketEngine, forcedYear: 2005 });
        run = { ...run, mandate: { min: 0, max: 1 }, boardType: 'band' };
        while (!isRunOver(run)) {
            run = { ...run, boardMood: 100, cash: run.startingCash, pendingEvent: null };
            run = simulateQuarter(run, decide(hedgesAt(run, 0.3)), marketEngine, content).run;
        }
        return run;
    };
    assert.deepEqual(play(), play());
});
