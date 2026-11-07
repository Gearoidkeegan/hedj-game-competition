import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProgress as clientMerge } from '../../js/engine/sim/progress.js';
import { mergeProgress as serverMerge } from '../../backend/lib/progress.mjs';

// Array order may legitimately differ, so compare arrays as sorted sets.
const sorted = p => ({
    ...p,
    unlocked: [...p.unlocked].sort(),
    chairmenMet: [...p.chairmenMet].sort(),
    crisisBadges: [...p.crisisBadges].sort()
});

const cases = [
    ['both empty', {}, {}],
    ['disjoint arrays',
        { runs: 2, best: { simple: 1500, pro: 0 }, unlocked: ['industry:airline', 'industry:tech'], chairmenMet: ['c1'], crisisBadges: [] },
        { runs: 5, best: { simple: 900, pro: 2100 }, unlocked: ['industry:retail', 'mode:pro'], chairmenMet: ['c2'], crisisBadges: ['crisis:gfc'] }],
    ['overlapping arrays',
        { runs: 3, best: { simple: 2000, pro: 100 }, unlocked: ['a', 'b', 'c'], chairmenMet: ['x'], crisisBadges: ['y'] },
        { runs: 3, best: { simple: 2000, pro: 100 }, unlocked: ['c', 'b', 'd'], chairmenMet: ['x', 'z'], crisisBadges: ['y'] }],
    ['one side missing',
        { runs: 4, best: { simple: 700, pro: 0 }, unlocked: ['industry:airline'], chairmenMet: [], crisisBadges: [] },
        undefined],
    ['partial progress', { runs: 1 }, { best: { pro: 50 }, unlocked: ['powerup:options'] }]
];

for (const [name, a, b] of cases) {
    test(`client and server mergeProgress agree: ${name}`, () => {
        const c = clientMerge(a, b);
        const s = serverMerge(a, b);
        assert.equal(c.version, s.version);
        assert.equal(c.runs, s.runs);
        assert.deepEqual(c.best, s.best);
        assert.deepEqual(sorted(c), sorted(s));
    });
}
