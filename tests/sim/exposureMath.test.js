import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exposureCashImpact, hedgeCashImpact, optionPremium } from '../../js/engine/sim/exposureMath.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);

const cases = {
    fuel: { exp: { type: 'commodity', underlying: 'JETNWE', direction: 'buy', unit: 'mT' }, start: 100, end: 110, n: 100, want: -10 },
    eurUsdRevenueEurFirm: { exp: { type: 'fx', underlying: 'EURUSD', direction: 'sell', unit: 'USD' }, start: 100, end: 110, n: 100, want: -10 },
    eurRevenueUsdFirm: { exp: { type: 'fx', underlying: 'EURUSD', direction: 'sell', unit: 'EUR' }, start: 100, end: 110, n: 100, want: 10 },
    ir: { exp: { type: 'ir', underlying: 'EURIBOR', direction: 'buy', unit: 'EUR' }, start: 0.03, end: 0.04, n: 400, want: -1 },
};

for (const [name, c] of Object.entries(cases)) {
    test(`exposure impact: ${name}`, () => {
        near(exposureCashImpact(c.exp, c.start, c.end, c.n), c.want);
    });
    test(`100% forward hedge nets to zero: ${name}`, () => {
        const e = exposureCashImpact(c.exp, c.start, c.end, c.n);
        const h = hedgeCashImpact(c.exp, c.start, c.end, c.n, 'forward');
        assert.equal(e + h, 0);
    });
}

test('option pays only adverse moves', () => {
    const c = cases.fuel;
    assert.equal(hedgeCashImpact(c.exp, 100, 90, 100, 'option'), 0);
    near(hedgeCashImpact(c.exp, 100, 110, 100, 'option'), 10);
});

test('option premium is 1.5% of hedged notional', () => {
    near(optionPremium(200), 3);
});
