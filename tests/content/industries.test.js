// A9 review: policy compliance counts only hedgeable exposures, and FX is the only kind hedgeable from the start.
// Every industry needs an FX exposure from Q1, or a band board would be vacuously "in policy" with nothing hedged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadIndustries } from '../helpers/loadData.js';

test('every industry has an fx exposure active from the first quarter (unlockQuarter 0)', () => {
    const industries = loadIndustries();
    assert.ok(industries.length > 0);
    for (const industry of industries) {
        const q0fx = industry.exposures.filter(e => e.type === 'fx' && (e.unlockQuarter ?? 0) === 0 && e.quarterlyNotional > 0);
        assert.ok(q0fx.length > 0, `${industry.id} has no fx exposure at unlockQuarter 0`);
    }
});
