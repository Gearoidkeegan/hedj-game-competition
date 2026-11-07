import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { exposureCashImpact } from '../../js/engine/sim/exposureMath.js';
import { BALANCE } from '../../js/engine/sim/balance.js';
import { createRun, simulateQuarter, activeExposures, isRunOver } from '../../js/engine/sim/SimEngine.js';

marketEngine.loadFromObjects(loadMarketData());
const airline = loadIndustries().find(i => i.id === 'airline');
const content = { events: [] };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg || ''} ${a} !== ${b}`);

// Every underlying moves by `factor` each quarter from its real 2010 Q1 level (use forcedYear 2010).
// For the airline, factor > 1 hurts unhedged (fuel up, EURUSD up), factor < 1 helps.
function trendMarket(factor) {
    return {
        getDataset: (u) => marketEngine.getDataset(u),
        getRate: (u, y, q) => marketEngine.getRate(u, 2010, 1) * factor ** ((y - 2010) * 4 + (q - 1))
    };
}

function newRun(market = marketEngine, extra = {}) {
    return createRun({ industry: airline, seed: 12345, startedAt: 1700000000000, market, ...extra });
}

function hedgesAt(run, h) {
    return Object.fromEntries(run.exposures.map(e => [e.id, h]));
}

function decide(hedges, extra = {}) {
    return { hedges, useOptions: false, buyPowerUp: null, eventChoice: null, ...extra };
}

function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const v of Object.values(o)) deepFreeze(v);
    }
    return o;
}

test('createRun is deterministic', () => {
    const a = newRun();
    const b = newRun();
    assert.deepEqual(a, b);
    assert.equal(a.version, 3);
    assert.equal(a.status, 'playing');
    assert.equal(a.quarter, 0);
    assert.equal(a.boardMood, BALANCE.startMood);
    assert.equal(a.cash, airline.startingCash);
    assert.equal(a.benchmarkCash, airline.startingCash);
    assert.equal(a.redLine, BALANCE.redLinePct * airline.startingCash);
    assert.ok(BALANCE.mandates.some(m => m.min === a.mandate.min && m.max === a.mandate.max));
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
    const run = newRun();
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
    assert.ok(loss.marketResult < 0);
    assert.equal(loss.breach, 'loss');

    const lucky = simulateQuarter(runDown, decide(hedgesAt(runDown, 0)), down, content).summary;
    assert.equal(lucky.inMandate, false);
    assert.ok(lucky.marketResult >= 0);
    assert.equal(lucky.breach, 'lucky');

    for (const [run, market] of [[runUp, up], [runDown, down]]) {
        const s = simulateQuarter(run, decide(hedgesAt(run, run.mandate.min)), market, content).summary;
        assert.equal(s.inMandate, true);
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
    assert.equal(lossChange, BALANCE.mood.breachLoss + BALANCE.mood.beatBenchmark);
    assert.equal(luckyChange, BALANCE.mood.luckyBreach + BALANCE.mood.beatBenchmark);
});

test('in-mandate quarter that beats the benchmark gains inMandate + beatBenchmark mood', () => {
    const down = trendMarket(0.9);
    const up = trendMarket(1.1);
    const run = newRun(up, { forcedYear: 2010 });
    const s = simulateQuarter(run, decide(hedgesAt(run, run.mandate.max)), up, content).summary;
    assert.equal(s.breach, 'none');
    assert.ok(s.playerDelta >= s.benchmarkDelta);
    assert.equal(s.boardMoodAfter - run.boardMood, BALANCE.mood.inMandate + BALANCE.mood.beatBenchmark);
    const runD = newRun(down, { forcedYear: 2010 });
    const sd = simulateQuarter(runD, decide(hedgesAt(runD, runD.mandate.max)), down, content).summary;
    assert.ok(sd.playerDelta < sd.benchmarkDelta);
    assert.equal(sd.boardMoodAfter - runD.boardMood, BALANCE.mood.inMandate);
});

test('two losing breaches -> fired', () => {
    const up = trendMarket(1.1);
    let run = newRun(up, { forcedYear: 2010 });
    const first = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content);
    assert.equal(first.summary.breach, 'loss');
    assert.equal(first.run.status, 'playing');
    run = first.run;
    const second = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content);
    assert.equal(second.summary.breach, 'loss');
    assert.ok(second.run.boardMood > BALANCE.fireThreshold, `mood ${second.run.boardMood}`);
    assert.equal(second.run.status, 'fired');
    assert.equal(isRunOver(second.run), true);
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

test('status precedence: bankrupt beats a 2nd losing breach in the same quarter', () => {
    const up = trendMarket(1.1);
    let run = newRun(up, { forcedYear: 2010 });
    run = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content).run;
    run = { ...run, cash: 1 };
    const { run: after, summary } = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content);
    assert.equal(summary.breach, 'loss');
    assert.equal(after.history.filter(s => s.breach === 'loss').length, BALANCE.breachLossesToFire);
    assert.equal(after.status, 'bankrupt');
    assert.equal(after.history.length, 2);
});

test('status precedence: a 2nd losing breach fires even with a happy board', () => {
    const up = trendMarket(1.1);
    let run = newRun(up, { forcedYear: 2010 });
    run = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content).run;
    run = { ...run, boardMood: 100 };
    const { run: after } = simulateQuarter(run, decide(hedgesAt(run, 0)), up, content);
    assert.ok(after.cash > 0);
    assert.ok(after.boardMood > BALANCE.fireThreshold, `mood ${after.boardMood}`);
    assert.equal(after.status, 'fired');
});

function playFull(seed) {
    let run = createRun({ industry: airline, seed, startedAt: 1, market: marketEngine });
    while (!isRunOver(run)) {
        run = simulateQuarter(run, decide(hedgesAt(run, run.mandate.min)), marketEngine, content).run;
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
    const high = { ...newRun(up, { forcedYear: 2010 }), boardMood: 99 };
    const r2 = simulateQuarter(high, decide(hedgesAt(high, high.mandate.max)), up, content).run;
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
        let run = createRun({ industry: airline, seed, startedAt: 1, market: marketEngine });
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

test('a zero or missing start rate is treated as no move', () => {
    const base = newRun();
    for (const bad of [0, null]) {
        const run = { ...base, rates: { ...base.rates, JETNWE: bad } };
        const { summary } = simulateQuarter(run, decide(hedgesAt(run, 0.5)), marketEngine, content);
        const fuel = summary.lines.find(l => l.exposureId === 'fuel');
        assert.equal(fuel.movePct, 0);
        assert.equal(fuel.exposureImpact, 0);
        assert.equal(fuel.hedgeImpact, 0);
        assert.ok(Number.isFinite(summary.playerDelta));
    }
});

test('out-of-range hedge ratio throws', () => {
    const run = newRun();
    assert.throws(() => simulateQuarter(run, decide({ fuel: 1.5 }), marketEngine, content));
});
