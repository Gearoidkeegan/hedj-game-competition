import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { eligibleStartYears } from '../../js/engine/sim/startYears.js';
import { createRun, simulateQuarter } from '../../js/engine/sim/SimEngine.js';
import {
    emptyProgress, UNLOCK_RULES, applyRunToProgress, mergeProgress, serialiseSave, parseSave
} from '../../js/engine/sim/progress.js';
import { CRISES } from '../../js/engine/sim/crises.js';

marketEngine.loadFromObjects(loadMarketData());
const industries = loadIndustries();
const BACKEND_ID = /^[a-z0-9:_-]{1,40}$/i;

const prog = (over = {}) => ({ ...emptyProgress(), ...over });
const run1 = (p, over = {}) => applyRunToProgress(p, {
    mode: 'simple', score: 1000, chairmenMet: [], crisisId: null, status: 'complete', ...over
});

test('emptyProgress starts with the free unlocks', () => {
    const p = emptyProgress();
    assert.equal(p.version, 3);
    assert.equal(p.runs, 0);
    assert.deepEqual(p.best, { simple: 0, pro: 0 });
    assert.deepEqual(p.unlocked, ['industry:airline', 'industry:agrifoods', 'industry:retail', 'powerup:forecasting']);
});

test('first completed run unlocks mode:pro', () => {
    const r = run1(emptyProgress());
    assert.equal(r.progress.runs, 1);
    assert.ok(r.progress.unlocked.includes('mode:pro'));
    assert.deepEqual(r.newlyUnlocked, ['mode:pro']);
});

test('unlock thresholds are exact', () => {
    // runs counts the run just applied, so prior runs = n gives n + 1.
    const at = (over) => run1(prog(over), { score: 0 }).progress.unlocked;
    assert.ok(!at({ runs: 1 }).includes('industry:pharma'));
    assert.ok(at({ runs: 2 }).includes('industry:pharma'));
    assert.ok(!at({ runs: 4 }).includes('industry:energy'));
    assert.ok(at({ runs: 5 }).includes('industry:energy'));
    assert.ok(!at({ runs: 0 }).includes('powerup:visibility'));
    assert.ok(at({ runs: 1 }).includes('powerup:visibility'));
    assert.ok(!at({ runs: 2 }).includes('crisis:gfc2008'));
    assert.ok(at({ runs: 3 }).includes('crisis:gfc2008'));
    const high = (score) => run1(emptyProgress(), { score }).progress.unlocked;
    assert.ok(!high(1499).includes('industry:construction'));
    assert.ok(high(1500).includes('industry:construction'));
    assert.ok(!high(1999).includes('powerup:options'));
    assert.ok(high(2000).includes('powerup:options'));
    assert.ok(!high(2499).includes('industry:tech'));
    assert.ok(high(2500).includes('industry:tech'));
});

test('personal best detected only when strictly higher', () => {
    const a = run1(emptyProgress(), { score: 1200 });
    assert.equal(a.isPersonalBest, true);
    assert.equal(a.progress.best.simple, 1200);
    const same = run1(a.progress, { score: 1200 });
    assert.equal(same.isPersonalBest, false);
    const lower = run1(a.progress, { score: 900 });
    assert.equal(lower.isPersonalBest, false);
    assert.equal(lower.progress.best.simple, 1200);
    const higher = run1(a.progress, { score: 1201 });
    assert.equal(higher.isPersonalBest, true);
    assert.equal(higher.progress.best.simple, 1201);
});

test('best is tracked per mode', () => {
    const r = run1(emptyProgress(), { mode: 'pro', score: 700 });
    assert.deepEqual(r.progress.best, { simple: 0, pro: 700 });
});

test('applyRunToProgress does not mutate its input', () => {
    const p = emptyProgress();
    const snapshot = JSON.stringify(p);
    run1(p, { chairmenMet: ['musk'] });
    assert.equal(JSON.stringify(p), snapshot);
});

test('chairmen are unioned without duplicates', () => {
    const a = run1(emptyProgress(), { chairmenMet: ['musk', 'jameson'] });
    const b = run1(a.progress, { chairmenMet: ['musk', 'dimon'] });
    assert.deepEqual(b.progress.chairmenMet, ['musk', 'jameson', 'dimon']);
});

test('crisis runs are unranked but earn a badge when completed', () => {
    const p = prog({ runs: 4, best: { simple: 800, pro: 0 } });
    const win = run1(p, { crisisId: 'gfc2008', score: 5000, status: 'complete' });
    assert.equal(win.progress.best.simple, 800);
    assert.equal(win.isPersonalBest, false);
    assert.equal(win.progress.runs, 5);
    assert.deepEqual(win.progress.crisisBadges, ['gfc2008']);
    const fail = run1(p, { crisisId: 'covid2020', score: 5000, status: 'fired' });
    assert.deepEqual(fail.progress.crisisBadges, []);
});

test('mergeProgress is commutative on values and idempotent', () => {
    const a = prog({ runs: 3, best: { simple: 900, pro: 0 }, unlocked: ['industry:airline', 'mode:pro'], chairmenMet: ['musk'], crisisBadges: ['gfc2008'] });
    const b = prog({ runs: 5, best: { simple: 400, pro: 600 }, unlocked: ['industry:retail', 'mode:pro', 'industry:pharma'], chairmenMet: ['dimon'], crisisBadges: [] });
    const norm = (p) => ({ ...p, unlocked: [...p.unlocked].sort(), chairmenMet: [...p.chairmenMet].sort(), crisisBadges: [...p.crisisBadges].sort() });
    assert.deepEqual(norm(mergeProgress(a, b)), norm(mergeProgress(b, a)));
    const m = mergeProgress(a, b);
    assert.deepEqual(mergeProgress(m, m), m);
    assert.deepEqual(mergeProgress(m, a), m);
    assert.equal(m.runs, 5);
    assert.deepEqual(m.best, { simple: 900, pro: 600 });
});

test('mergeProgress orders a first, then b, de-duplicated, without mutating', () => {
    const a = prog({ unlocked: ['x:1', 'x:2'], chairmenMet: ['musk'] });
    const b = prog({ unlocked: ['x:3', 'x:1'], chairmenMet: ['dimon', 'musk'] });
    const before = JSON.stringify([a, b]);
    const m = mergeProgress(a, b);
    assert.deepEqual(m.unlocked, ['x:1', 'x:2', 'x:3']);
    assert.deepEqual(m.chairmenMet, ['musk', 'dimon']);
    assert.equal(JSON.stringify([a, b]), before);
});

test('every progress id matches the backend sync pattern', () => {
    const ids = [
        ...emptyProgress().unlocked,
        ...UNLOCK_RULES.map(r => r.id),
        ...CRISES.map(c => c.id),
        ...CRISES.map(c => `crisis:${c.id}`),
        'jameson', 'musk', 'oleary', 'dimon', 'buffett', 'jobs', 'dorsey', 'ackman'
    ];
    for (const id of ids) assert.match(id, BACKEND_ID, id);
});

test('crisis unlock rules exist for every crisis', () => {
    for (const c of CRISES) assert.ok(UNLOCK_RULES.some(r => r.id === `crisis:${c.id}`), c.id);
});

test('every CRISES forcedYear is eligible for its industry', () => {
    assert.deepEqual(CRISES.map(c => c.id), ['gfc2008', 'brexit2016', 'covid2020', 'energy2022']);
    for (const c of CRISES) {
        const ind = industries.find(i => i.id === c.industryId);
        assert.ok(ind, c.industryId);
        const years = eligibleStartYears(marketEngine, ind.exposures, 8);
        assert.ok(years.includes(c.forcedYear), `${c.id} ${c.forcedYear}`);
        assert.ok(c.label.length > 0);
    }
});

// --- save format ---
function realRun() {
    const airline = industries.find(i => i.id === 'airline');
    let run = createRun({ industry: airline, seed: 7, startedAt: 1000, market: marketEngine });
    const hedges = Object.fromEntries(run.exposures.map(e => [e.id, 0.5]));
    for (let i = 0; i < 3; i++) {
        ({ run } = simulateQuarter(run, { hedges, useOptions: false, buyPowerUp: null, eventChoice: null }, marketEngine, { events: [] }));
    }
    return run;
}

test('serialiseSave / parseSave round-trip a real run', () => {
    const run = realRun();
    assert.equal(run.history.length, 3);
    const str = serialiseSave(run);
    assert.equal(typeof str, 'string');
    assert.deepEqual(parseSave(str), run);
});

test('parseSave returns null on garbage and wrong shapes, never throws', () => {
    const run = realRun();
    assert.equal(parseSave('garbage'), null);
    assert.equal(parseSave(''), null);
    assert.equal(parseSave(null), null);
    assert.equal(parseSave(undefined), null);
    assert.equal(parseSave(42), null);
    assert.equal(parseSave('null'), null);
    assert.equal(parseSave('42'), null);
    assert.equal(parseSave('[]'), null);
    assert.equal(parseSave('"str"'), null);
    assert.equal(parseSave(JSON.stringify({ ...run, version: 2 })), null);
    assert.equal(parseSave(JSON.stringify({ ...run, version: undefined })), null);
    const noHistory = { ...run }; delete noHistory.history;
    assert.equal(parseSave(JSON.stringify(noHistory)), null);
    assert.equal(parseSave(JSON.stringify({ ...run, history: 'x' })), null);
});
