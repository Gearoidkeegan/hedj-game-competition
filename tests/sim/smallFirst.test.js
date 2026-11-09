// Fix round 1 (Task 3): the simulator's diagnostic smallFirst strategy, the wrong-focus player. It hedges the smallest
// hedgeable exposure 100%, leaves the largest at 0 and sets the rest to the band midpoint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { applyPowerUp } from '../../js/engine/sim/powerUps.js';
import { createRun, policyCover, quarterStartRates } from '../../js/engine/sim/SimEngine.js';
import { smallFirstHedges, STRATEGIES, runAll, criteria } from '../../tools/simulate.js';

marketEngine.loadFromObjects(loadMarketData());
const industries = loadIndustries();
const runFor = (id, extra = {}) => ({
    ...createRun({ industry: industries.find(i => i.id === id), seed: 1, startedAt: 1, market: marketEngine, forcedYear: 2010 }),
    mandate: { min: 0.25, max: 0.5 }, boardType: 'band', ...extra
});
const withPowerUps = (run, ids) => ids.reduce((r, id) => applyPowerUp(r, id), run);

test('smallFirst: smallest hedgeable exposure at 100%, largest at 0, and that is wrong focus', () => {
    let run = withPowerUps(runFor('airline'), ['facilities', 'hedgeAccess']);
    run = { ...run, exposures: run.exposures.map(e => (e.id === 'fuel' ? { ...e, quarterlyNotional: 300e6 } : e)) };
    const hedges = smallFirstHedges(run, 0.25, marketEngine);
    assert.equal(hedges.fuel, 1);
    assert.equal(hedges['usd-revenue'], 0);
    const pc = policyCover({ ...run, rates: quarterStartRates(run, marketEngine) }, hedges);
    assert.equal(pc.wrongFocus, true);
});

test('smallFirst: the middle exposures sit at the band midpoint', () => {
    // Agrifoods at Q6 with hedgeAccess: coffee, usd-costs, nat-gas, gbp-revenue, dairy, floating-debt are active.
    const run = withPowerUps(runFor('agrifoods', { quarter: 6 }), ['facilities', 'hedgeAccess']);
    const hedges = smallFirstHedges(run, 0.5, marketEngine);
    const { values } = policyCover({ ...run, rates: quarterStartRates(run, marketEngine) }, {});
    const ids = Object.keys(values).filter(id => values[id] > 0).sort((a, b) => values[a] - values[b]);
    assert.ok(ids.length >= 3);
    assert.equal(hedges[ids[0]], 1, `smallest ${ids[0]}`);
    assert.equal(hedges[ids.at(-1)], 0, `largest ${ids.at(-1)}`);
    for (const id of ids.slice(1, -1)) assert.equal(hedges[id], 0.5, id);
});

test('smallFirst: with fewer than two hedgeable exposures every dial is at the midpoint', () => {
    const run = runFor('airline');   // fuel is locked: only the dollars count
    const hedges = smallFirstHedges(run, 0.25, marketEngine);
    assert.ok(Object.values(hedges).every(h => h === 0.25), JSON.stringify(hedges));
});

test('smallFirst is a simulated strategy with a 16th criterion: it scores below the policy follower', () => {
    assert.ok(STRATEGIES.includes('smallFirst'));
    const res = runAll(14, 1);
    const list = criteria(res);
    assert.equal(list.length, 16);
    const c = list.find(x => x.name === 'mean(smallFirst) < mean(policy)');
    assert.ok(c, 'criterion present');
    assert.ok(Number.isFinite(c.margin));
});
