// Balance criteria (A9; R34 luck bounds; R37 unhedged bankruptcy floor) at 300 seeded runs per strategy across
// all 7 industries. The criteria are defined once, in tools/simulate.js `criteria()`, and shared with its report.
// Deterministic: fixed seeds. The 1000-run table lives at the top of js/engine/sim/balance.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAll, criteria, BOARD_TYPES, STRATEGIES } from '../../tools/simulate.js';

const N = 300;
const SEED = 1;
const res = runAll(N, SEED);

for (const c of criteria(res)) {
    test(`balance: ${c.name}`, () => {
        assert.ok(c.pass, `${c.name}: ${c.value}`);
    });
}

test('every strategy meets every board type', () => {
    for (const s of STRATEGIES) {
        for (const b of BOARD_TYPES) assert.ok(res[s].byBoard[b].n > 0, `${s} on ${b}`);
    }
});

// R35: only an off-policy loss can be severe. The policy strategy stays in policy (and the no-policy board
// has nothing to breach), so it is never fired at once; unhedged play on a band board sometimes is.
test('a severe losing breach fires off-policy players, never policy ones', () => {
    assert.equal(res.policy.severeFiredRate, 0);
    assert.ok(res.unhedged.severeFiredRate > 0, `severeFiredRate(unhedged) ${res.unhedged.severeFiredRate}`);
});

test('scores stay well under the clamp', () => {
    const max = Math.max(...Object.values(res).flatMap(r => r.scores));
    assert.ok(max < 9000, `max score ${max}`);
});

// v3.1 fix round 1: wrong-focus play (smallFirst) must trail the policy follower by a clear margin, not a hair.
test('smallFirst scores at least 10% below the policy follower', () => {
    const c = criteria(res).find(x => x.name === 'mean(smallFirst) < mean(policy)');
    assert.ok(c && c.pass && c.margin >= 0.1, `${c?.value}; margin ${c?.margin}`);
});
