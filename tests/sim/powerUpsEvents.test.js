import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { SeededRandom } from '../../js/utils/random.js';
import { createRun, simulateQuarter, isRunOver } from '../../js/engine/sim/SimEngine.js';
import { POWER_UPS, canBuyPowerUp, applyPowerUp } from '../../js/engine/sim/powerUps.js';
import { rollEvent, applyEventChoice } from '../../js/engine/sim/events.js';

marketEngine.loadFromObjects(loadMarketData());
const airline = loadIndustries().find(i => i.id === 'airline');
const content = JSON.parse(readFileSync(new URL('../fixtures/simple-events.json', import.meta.url), 'utf8'));
const [supplier, conference] = content.events;
const ALL = Object.keys(POWER_UPS);

const newRun = (seed = 12345) => createRun({ industry: airline, seed, startedAt: 1, market: marketEngine, forcedYear: 2010 });
const noHedges = run => Object.fromEntries(run.exposures.map(e => [e.id, 0]));
const decide = (run, extra = {}) => ({ hedges: noHedges(run), useOptions: false, buyPowerUp: null, eventChoice: null, ...extra });
const fuelLine = summary => summary.lines.find(l => l.exposureId === 'fuel');

test('cannot buy twice', () => {
    for (const id of ALL) {
        const run = applyPowerUp(newRun(), id);
        assert.equal(canBuyPowerUp(run, id, ALL), false, id);
        assert.throws(() => applyPowerUp(run, id));
    }
});

test('cannot buy when cash < cost, or when not unlocked', () => {
    const poor = { ...newRun(), cash: 1 };
    assert.equal(canBuyPowerUp(poor, 'forecasting', ALL), false);
    assert.throws(() => applyPowerUp(poor, 'forecasting'));
    assert.throws(() => simulateQuarter(poor, decide(poor, { buyPowerUp: 'forecasting' }), marketEngine, content));
    assert.equal(canBuyPowerUp(newRun(), 'options', ['forecasting']), false);
    assert.equal(canBuyPowerUp(newRun(), 'options', ALL), true);
    assert.equal(canBuyPowerUp(newRun(), 'nonsense', ALL), false);
});

test('costs are fractions of starting cash and options unlocks useOptions', () => {
    const run = newRun();
    assert.equal(applyPowerUp(run, 'forecasting').cash, run.cash - 0.01 * run.startingCash);
    assert.equal(applyPowerUp(run, 'options').cash, run.cash - 0.005 * run.startingCash);
    assert.deepEqual(applyPowerUp(run, 'options').powerUps.owned, ['options']);
    const bought = simulateQuarter(run, decide(run, { buyPowerUp: 'options', useOptions: true }), marketEngine, content);
    assert.equal(bought.summary.powerUp, 'options');
    assert.deepEqual(bought.run.powerUps.owned, ['options']);
});

test('visibility adds 3% to the player only (benchmark unchanged)', () => {
    const run = newRun();
    const after = applyPowerUp(run, 'visibility');
    assert.equal(after.cash, run.cash - 0.005 * run.startingCash + 0.03 * run.startingCash);
    assert.equal(after.benchmarkCash, run.benchmarkCash);
    assert.deepEqual(after.powerUps.used, ['visibility']);
    assert.equal(run.cash, newRun().cash, 'input not mutated');
});

function spread(buy) {
    const misses = [];
    for (let seed = 1; seed <= 200; seed++) {
        const run = newRun(seed);
        const { summary } = simulateQuarter(run, decide(run, { buyPowerUp: buy }), marketEngine, content);
        const fuel = fuelLine(summary);
        misses.push(fuel.realisedNotional / fuel.forecastNotional - 1);
    }
    const mean = misses.reduce((a, b) => a + b, 0) / misses.length;
    return Math.sqrt(misses.reduce((a, b) => a + (b - mean) ** 2, 0) / misses.length);
}

test('forecasting halves variance', () => {
    const ratio = spread('forecasting') / spread(null);
    assert.ok(ratio > 0.4 && ratio < 0.6, `ratio ${ratio}`);
    assert.equal(applyPowerUp(newRun(), 'forecasting').varianceMultiplier, 0.5);
});

test('forecasting variance stays permanent across quarters', () => {
    const run = newRun();
    // Hedge inside the mandate: unhedged, 2010 Q1 is a severe losing breach (A8) and the run would end.
    const inBand = Object.fromEntries(run.exposures.map(e => [e.id, run.mandate.min]));
    const q1 = simulateQuarter(run, decide(run, { hedges: inBand, buyPowerUp: 'forecasting' }), marketEngine, content);
    assert.equal(q1.run.status, 'playing');
    const q2 = simulateQuarter({ ...q1.run, pendingEvent: null }, decide(q1.run, { hedges: inBand }), marketEngine, content);
    assert.equal(q2.run.varianceMultiplier, 0.5);
});

test('event cashPct hits both sides equally', () => {
    const run = newRun();
    const { run: after } = applyEventChoice(run, supplier, 'pay');
    assert.equal(after.cash - run.cash, -0.02 * run.startingCash);
    assert.equal(after.benchmarkCash - run.benchmarkCash, -0.02 * run.startingCash);
    assert.equal(after.boardMood, run.boardMood + 5);
});

test('unknown choice throws', () => {
    assert.throws(() => applyEventChoice(newRun(), supplier, 'nope'), /Unknown choice/);
    assert.throws(() => applyEventChoice(newRun(), supplier, undefined));
});

test('rollEvent never repeats an id within a run, and returns null when exhausted', () => {
    const rng = new SeededRandom(7);
    let run = newRun();
    const seen = [];
    for (let i = 0; i < 2; i++) {
        const id = rollEvent(run, content.events, rng);
        assert.ok(id);
        assert.ok(!seen.includes(id));
        seen.push(id);
        run = { ...run, history: [...run.history, { event: { id, choice: 'x' } }] };
    }
    assert.equal(rollEvent(run, content.events, rng), null);
    assert.equal(rollEvent(newRun(), [], rng), null);
});

test('rollEvent is weighted and skips the pending event', () => {
    const counts = { [supplier.id]: 0, [conference.id]: 0 };
    const rng = new SeededRandom(99);
    for (let i = 0; i < 3000; i++) counts[rollEvent(newRun(), content.events, rng)]++;
    assert.ok(counts[supplier.id] > counts[conference.id] * 1.6, JSON.stringify(counts));
    assert.equal(rollEvent({ ...newRun(), pendingEvent: supplier.id }, content.events, rng), conference.id);
});

test('notionalMult and varianceMult last one quarter only; unknown exposure ignored', () => {
    const base = { ...newRun(), pendingEvent: supplier.id };
    const q1 = simulateQuarter(base, decide(base, { eventChoice: 'refuse' }), marketEngine, content);
    const fuelExp = base.exposures.find(e => e.id === 'fuel');
    assert.equal(fuelLine(q1.summary).forecastNotional, fuelExp.quarterlyNotional * 1.5);
    assert.equal(q1.summary.event.choice, 'refuse');
    assert.equal(q1.run.varianceMultiplier, 1, 'variance effect is not stored on the run');

    // Same quarter RNG without the event: the variance of 2 doubles the realised miss.
    const plain = simulateQuarter(newRun(), decide(newRun()), marketEngine, content);
    const miss = s => Math.abs(fuelLine(s).realisedNotional / fuelLine(s).forecastNotional - 1);
    assert.ok(miss(plain.summary) > 0);
    assert.ok(Math.abs(miss(q1.summary) - 2 * miss(plain.summary)) < 1e-9);

    // The following quarter is back to normal: no notional multiplier, normal variance.
    const q2 = simulateQuarter({ ...q1.run, pendingEvent: null }, decide(q1.run), marketEngine, content);
    assert.equal(fuelLine(q2.summary).forecastNotional, fuelExp.quarterlyNotional);
    const control = simulateQuarter({ ...q1.run, pendingEvent: null, varianceMultiplier: 1 }, decide(q1.run), marketEngine, content);
    assert.deepEqual(q2.summary.lines, control.summary.lines);
});

test('a full run with events resolves each once and never repeats one', () => {
    let run = createRun({ industry: airline, seed: 5, startedAt: 1, market: marketEngine });
    const ids = [];
    while (!isRunOver(run)) {
        const hedges = Object.fromEntries(run.exposures.map(e => [e.id, run.mandate.min]));
        const ev = run.pendingEvent ? content.events.find(e => e.id === run.pendingEvent) : null;
        run = simulateQuarter(run, decide(run, { hedges, eventChoice: ev ? ev.choices[0].id : null }), marketEngine, content).run;
        const last = run.history.at(-1).event;
        if (last) ids.push(last.id);
    }
    assert.equal(new Set(ids).size, ids.length);
});

test('simulateQuarter requires an eventChoice while an event is pending', () => {
    const run = { ...newRun(), pendingEvent: supplier.id };
    assert.throws(() => simulateQuarter(run, decide(run), marketEngine, content), /eventChoice required while an event is pending/);
});

function playWithEvents(seed) {
    let run = createRun({ industry: airline, seed, startedAt: 1, market: marketEngine });
    while (!isRunOver(run)) {
        const hedges = Object.fromEntries(run.exposures.map(e => [e.id, run.mandate.min]));
        const ev = run.pendingEvent ? content.events.find(e => e.id === run.pendingEvent) : null;
        run = simulateQuarter(run, decide(run, { hedges, eventChoice: ev ? ev.choices[0].id : null }), marketEngine, content).run;
    }
    return run;
}

test('engine runs with events are deterministic per seed and differ across seeds', () => {
    const eventIds = r => r.history.map(s => s.event && s.event.id);
    const seeds = [];
    for (let s = 1; s <= 40 && seeds.length < 2; s++) {
        const r = playWithEvents(s);
        if (r.history.length === 8 && eventIds(r).some(Boolean)) seeds.push(s);
    }
    assert.equal(seeds.length, 2, 'found two complete seeds with at least one resolved event');
    const [a, b] = seeds;
    const first = playWithEvents(a);
    assert.deepEqual(playWithEvents(a).history, first.history);
    assert.deepEqual(eventIds(playWithEvents(a)), eventIds(first));
    assert.notDeepEqual(playWithEvents(b).history, first.history);
});
