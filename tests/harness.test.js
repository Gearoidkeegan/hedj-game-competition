import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadIndustries, loadMarketData } from './helpers/loadData.js';

test('harness loads 7 industries and EURUSD monthly data', () => {
    assert.equal(loadIndustries().length, 7);
    assert.ok('2008-01-01' in loadMarketData().fx.EURUSD);
});
