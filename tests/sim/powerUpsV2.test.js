// A9 (ruling R44): tiered forecasting, bank facilities, IR and commodity hedge access; options removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { BALANCE } from '../../js/engine/sim/balance.js';
import {
    POWER_UPS, POWER_UP_IDS, canBuyPowerUp, applyPowerUp, powerUpCost,
    forecastAccuracy, forecastVariance, hedgeCap, borrowingBuffer, isHedgeable
} from '../../js/engine/sim/powerUps.js';
import { createRun, simulateQuarter } from '../../js/engine/sim/SimEngine.js';

marketEngine.loadFromObjects(loadMarketData());
const industries = loadIndustries();
const airline = industries.find(i => i.id === 'airline');
const retail = industries.find(i => i.id === 'retail');
const content = { events: [] };

const newRun = (industry = airline, seed = 12345) =>
    ({ ...createRun({ industry, seed, startedAt: 1, market: marketEngine, forcedYear: 2010 }), mandate: { min: 0.25, max: 0.5 }, boardType: 'band' });
const hedgesAt = (run, h) => Object.fromEntries(run.exposures.map(e => [e.id, h]));
const decide = (hedges, extra = {}) => ({ hedges, buyPowerUp: null, eventChoice: null, ...extra });
const line = (summary, id) => summary.lines.find(l => l.exposureId === id);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} ${a} !== ${b}`);
const buy = (run, ...ids) => ids.reduce((r, id) => applyPowerUp(r, id), run);

test('the power-ups are forecasting, visibility, facilities and hedgeAccess; options is gone', () => {
    assert.deepEqual(Object.keys(POWER_UPS), ['forecasting', 'visibility', 'facilities', 'hedgeAccess']);
    assert.deepEqual(POWER_UP_IDS, Object.keys(POWER_UPS));
    const run = newRun();
    assert.equal(canBuyPowerUp(run, 'options', [...POWER_UP_IDS, 'options']), false);
    assert.throws(() => applyPowerUp(run, 'options'), /Unknown power-up/);
    assert.throws(() => simulateQuarter(run, decide(hedgesAt(run, 0.25), { buyPowerUp: 'options' }), marketEngine, content));
    assert.equal(run.varianceMultiplier, undefined);
    assert.equal(run.forecastLevel, 0);
});

test('forecasting levels: accuracy 40/60/80/100%, variance 0.40/0.267/0.133/0', () => {
    let run = newRun();
    const expected = [[0.4, 0.4], [0.6, 0.4 * 0.4 / 0.6], [0.8, 0.4 * 0.2 / 0.6], [1, 0]];
    for (let level = 0; level <= 3; level++) {
        assert.equal(run.forecastLevel, level);
        near(forecastAccuracy(run), expected[level][0], `accuracy L${level}`);
        near(forecastVariance(run), expected[level][1], `variance L${level}`);
        assert.ok(forecastVariance(run) >= 0);
        if (level < 3) run = applyPowerUp(run, 'forecasting');
    }
    assert.equal(BALANCE.forecast.baseVariance, 0.4);
    assert.deepEqual(run.powerUps.owned, ['forecasting']);
});

test('forecasting costs rise per level and a 4th purchase is rejected', () => {
    let run = newRun();
    const costs = BALANCE.powerUpCosts.forecasting;
    assert.equal(costs.length, 3);
    for (let level = 0; level < 3; level++) {
        assert.equal(powerUpCost(run, 'forecasting'), costs[level] * run.startingCash);
        if (level > 0) assert.ok(costs[level] > costs[level - 1]);
        const before = run.cash;
        run = applyPowerUp(run, 'forecasting');
        near(run.cash, before - costs[level] * run.startingCash);
    }
    assert.equal(canBuyPowerUp(run, 'forecasting', POWER_UP_IDS), false);
    assert.throws(() => applyPowerUp(run, 'forecasting'));
    assert.throws(() => simulateQuarter(run, decide(hedgesAt(run, 0.25), { buyPowerUp: 'forecasting' }), marketEngine, content));
});

test('forecast variance drives the realised volume miss (fx and commodity), and level 3 is exact', () => {
    const run = newRun();
    const miss = (r) => {
        const s = simulateQuarter(r, decide(hedgesAt(r, 0.25)), marketEngine, content).summary;
        return line(s, 'fuel').realisedNotional / line(s, 'fuel').forecastNotional - 1;
    };
    const m0 = miss(run);
    assert.ok(Math.abs(m0) > 0 && Math.abs(m0) <= 0.4);
    const l1 = buy(run, 'forecasting');
    near(miss(l1), m0 * (2 / 3), 'level 1');
    near(miss(buy(run, 'forecasting', 'forecasting', 'forecasting')), 0, 'level 3');
});

test('event variance multipliers still apply on top of the forecast variance', () => {
    const event = { id: 'e', pool: 'business', weight: 1, title: 't', text: 't',
        choices: [{ id: 'a', label: 'a', quip: 'q', effects: { varianceMult: 1.5 } }] };
    const ev = { events: [event] };
    const base = buy(newRun(), 'forecasting');
    const plain = simulateQuarter(base, decide(hedgesAt(base, 0.25)), marketEngine, ev).summary;
    const withEv = simulateQuarter({ ...base, pendingEvent: 'e' }, decide(hedgesAt(base, 0.25), { eventChoice: 'a' }), marketEngine, ev).summary;
    const m = s => line(s, 'fuel').realisedNotional / line(s, 'fuel').forecastNotional - 1;
    near(m(withEv), 1.5 * m(plain));
});

test('hedge ratio is clamped to 0.5 without facilities and to 0 on commodity without hedgeAccess', () => {
    const run = newRun();
    assert.equal(hedgeCap(run), BALANCE.facilities.baseHedgeCap);
    assert.equal(hedgeCap(run), 0.5);
    const { summary } = simulateQuarter(run, decide(hedgesAt(run, 1)), marketEngine, content);
    assert.equal(line(summary, 'usd-revenue').hedgeRatio, 0.5);
    assert.equal(line(summary, 'usd-revenue').clamped, true);
    assert.equal(line(summary, 'fuel').hedgeRatio, 0);
    assert.equal(line(summary, 'fuel').hedgeImpact, 0);
    assert.equal(line(summary, 'fuel').clamped, true);

    const atCap = simulateQuarter(run, decide(hedgesAt(run, 0.5)), marketEngine, content).summary;
    assert.equal(line(atCap, 'usd-revenue').clamped, false);
    const zero = simulateQuarter(run, decide(hedgesAt(run, 0)), marketEngine, content).summary;
    assert.equal(line(zero, 'fuel').clamped, false, 'a request inside the limit is not clamped');

    // Clamped exactly as if the allowed ratio had been asked for.
    assert.deepEqual(
        summary.lines.map(l => l.hedgeImpact),
        simulateQuarter(run, decide({ fuel: 0, 'usd-revenue': 0.5 }), marketEngine, content).summary.lines.map(l => l.hedgeImpact));

    // Out-of-range values still throw (a UI bug, not a cap).
    assert.throws(() => simulateQuarter(run, decide({ fuel: 1.5 }), marketEngine, content));
});

test('facilities lift the cap to 100% and give a 10% borrowing buffer; bought this quarter, it applies now', () => {
    const run = newRun();
    assert.equal(borrowingBuffer(run), 0);
    const fac = applyPowerUp(run, 'facilities');
    near(fac.cash, run.cash - BALANCE.powerUpCosts.facilities * run.startingCash);
    assert.equal(hedgeCap(fac), 1);
    assert.equal(borrowingBuffer(fac), 0.1 * run.startingCash);
    assert.equal(BALANCE.facilities.borrowPct, 0.1);
    assert.equal(canBuyPowerUp(fac, 'facilities', POWER_UP_IDS), false);

    const { summary } = simulateQuarter(run, decide(hedgesAt(run, 1), { buyPowerUp: 'facilities' }), marketEngine, content);
    assert.equal(line(summary, 'usd-revenue').hedgeRatio, 1);
    assert.equal(line(summary, 'usd-revenue').clamped, false);
    assert.equal(line(summary, 'fuel').hedgeRatio, 0, 'commodity still needs hedgeAccess');
});

test('hedgeAccess makes commodity and IR exposures hedgeable', () => {
    const run = newRun();
    const fuel = run.exposures.find(e => e.id === 'fuel');
    const debt = run.exposures.find(e => e.id === 'floating-debt');
    const usd = run.exposures.find(e => e.id === 'usd-revenue');
    assert.equal(isHedgeable(run, fuel), false);
    assert.equal(isHedgeable(run, debt), false);
    assert.equal(isHedgeable(run, usd), true);
    const access = applyPowerUp(run, 'hedgeAccess');
    near(access.cash, run.cash - BALANCE.powerUpCosts.hedgeAccess * run.startingCash);
    assert.equal(isHedgeable(access, fuel), true);
    assert.equal(isHedgeable(access, debt), true);
    const { summary } = simulateQuarter(access, decide(hedgesAt(access, 0.5)), marketEngine, content);
    assert.equal(line(summary, 'fuel').hedgeRatio, 0.5);
    assert.notEqual(line(summary, 'fuel').hedgeImpact, 0);
    assert.equal(canBuyPowerUp(access, 'hedgeAccess', POWER_UP_IDS), false);
});

test('hedgeAccess is not buyable for an FX-only industry', () => {
    const run = newRun(retail);
    assert.ok(run.exposures.every(e => e.type === 'fx'));
    assert.equal(canBuyPowerUp(run, 'hedgeAccess', POWER_UP_IDS), false);
    assert.throws(() => applyPowerUp(run, 'hedgeAccess'));
    assert.equal(canBuyPowerUp(newRun(), 'hedgeAccess', POWER_UP_IDS), true);
});

test('compliance ignores unhedgeable exposures but uses the real band even when the cap makes it unreachable', () => {
    const run = newRun();
    // Fuel at 0 is below the 25-50 band, but fuel cannot be hedged yet.
    const s = simulateQuarter(run, decide({ fuel: 0, 'usd-revenue': 0.5 }), marketEngine, content).summary;
    assert.equal(s.policy, 'in');
    // With hedgeAccess, fuel counts toward the size-weighted cover (v3.1): usd 750m at 50% alone covers
    // 375/1350 = 28% of the risk (inside 25-50); at 25% it covers 14% (off).
    const access = applyPowerUp(run, 'hedgeAccess');
    const half = simulateQuarter(access, decide({ fuel: 0, 'usd-revenue': 0.5 }), marketEngine, content).summary;
    assert.ok(Math.abs(half.riskCover - 375 / 1350) < 1e-12, `${half.riskCover}`);
    assert.equal(half.policy, 'in');
    assert.equal(simulateQuarter(access, decide({ fuel: 0, 'usd-revenue': 0.25 }), marketEngine, content).summary.policy, 'off');
    // A 75-100 band without facilities: 0.75 is clamped to 0.5, which is off policy.
    const high = { ...run, mandate: { min: 0.75, max: 1 } };
    const capped = simulateQuarter(high, decide(hedgesAt(high, 0.75)), marketEngine, content).summary;
    assert.equal(line(capped, 'usd-revenue').clamped, true);
    assert.equal(capped.policy, 'off');
    const lifted = applyPowerUp(high, 'facilities');
    assert.equal(simulateQuarter(lifted, decide(hedgesAt(lifted, 0.75)), marketEngine, content).summary.policy, 'in');
});

test('visibility is unchanged: 0.5% cost, 3% back to the player only, single use', () => {
    const run = newRun();
    const after = applyPowerUp(run, 'visibility');
    near(after.cash, run.cash - 0.005 * run.startingCash + 0.03 * run.startingCash);
    assert.equal(after.benchmarkCash, run.benchmarkCash);
    assert.deepEqual(after.powerUps.used, ['visibility']);
    assert.equal(canBuyPowerUp(after, 'visibility', POWER_UP_IDS), false);
});
