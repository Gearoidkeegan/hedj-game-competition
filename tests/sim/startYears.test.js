import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine, fillShortGaps } from '../../js/engine/MarketEngine.js';
import { SeededRandom } from '../../js/utils/random.js';
import { eligibleStartYears, pickStartYear, hasExactRate } from '../../js/engine/sim/startYears.js';

marketEngine.loadFromObjects(loadMarketData());
const industries = loadIndustries();
const byId = (id) => industries.find(i => i.id === id);
const airline = byId('airline');
const agrifoods = byId('agrifoods');

test('eligible years for airline exclude 2006 (no JETNWE)', () => {
    const years = eligibleStartYears(marketEngine, airline.exposures);
    assert.ok(!years.includes(2006));
    assert.ok(years.includes(2010));
});

test('agrifoods requires DAIRY from Q6', () => {
    const years = eligibleStartYears(marketEngine, agrifoods.exposures);
    assert.ok(years.length > 0);
    assert.ok(years.every(y => y >= 2005));
});

test('no industry uses SOFR or SONIA', () => {
    for (const ind of industries) {
        for (const e of ind.exposures) {
            assert.ok(!['SOFR', 'SONIA'].includes(e.underlying), `${ind.id}/${e.id}`);
        }
    }
});

test('pickStartYear is deterministic per seed', () => {
    const a = pickStartYear(marketEngine, airline.exposures, new SeededRandom(42), {});
    const b = pickStartYear(marketEngine, airline.exposures, new SeededRandom(42), {});
    assert.deepEqual(a, b);
    assert.equal(a.quarter, 1);
    assert.ok(eligibleStartYears(marketEngine, airline.exposures).includes(a.year));
});

test('forcedYear outside eligibility throws; inside is returned', () => {
    assert.throws(() => pickStartYear(marketEngine, airline.exposures, new SeededRandom(1), { forcedYear: 1995 }));
    assert.deepEqual(pickStartYear(marketEngine, airline.exposures, new SeededRandom(1), { forcedYear: 2010 }), { year: 2010, quarter: 1 });
});

test('hasExactRate ignores the nearest-date fallback', () => {
    assert.equal(hasExactRate(marketEngine, 'BRENT', 2007, 1), false);
    assert.equal(hasExactRate(marketEngine, 'BRENT', 2008, 1), true);
});

test('fillShortGaps fills a 2-month gap linearly', () => {
    const out = fillShortGaps({ '2020-01-01': 3, '2020-04-01': 6 });
    assert.equal(out['2020-02-01'], 4);
    assert.equal(out['2020-03-01'], 5);
});

test('fillShortGaps leaves a 3-month gap', () => {
    const out = fillShortGaps({ '2020-01-01': 3, '2020-05-01': 7 });
    assert.deepEqual(Object.keys(out), ['2020-01-01', '2020-05-01']);
});

test('fillShortGaps does not mutate input', () => {
    const input = { '2020-01-01': 3, '2020-03-01': 5 };
    const out = fillShortGaps(input);
    assert.deepEqual(Object.keys(input), ['2020-01-01', '2020-03-01']);
    assert.equal(out['2020-02-01'], 4);
});
