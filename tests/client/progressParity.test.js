import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProgress as clientMerge } from '../../js/engine/sim/progress.js';
import { mergeProgress as serverMerge } from '../../backend/lib/progress.mjs';
import { SeededRandom } from '../../js/utils/random.js';

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

// Normalisation parity: the backend is authoritative, so the client must produce exactly the same output
// (deep-equal, array order included) for invalid, oversized and malformed input.
const many = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

const edgeCases = [
    ['ids failing the id regex',
        { unlocked: ['ok:id', 'has space', 'bad!', '', 'x'.repeat(41), 'UPPER_ok', 'a.b', 5, null, {}], chairmenMet: ['<script>'], crisisBadges: ['fine-1'] },
        { unlocked: ['ok:id', 'ünï'] }],
    ['more than 50 items in one array', { unlocked: many('u', 70), chairmenMet: many('c', 50) }, { unlocked: many('v', 10), chairmenMet: many('d', 5) }],
    ['more than 50 items after the union', { unlocked: many('a', 40) }, { unlocked: many('b', 40) }],
    ['scores above 10000', { best: { simple: 99999, pro: 10001 } }, { best: { simple: 5, pro: 10000 } }],
    ['negative scores and runs', { runs: -3, best: { simple: -50, pro: -1 } }, { runs: -1, best: { simple: -2 } }],
    ['fractional scores and runs', { runs: 2.7, best: { simple: 1500.5, pro: 99.4 } }, { runs: 3.2 }],
    ['huge runs', { runs: 5_000_000 }, { runs: 1 }],
    ['NaN', { runs: NaN, best: { simple: NaN, pro: 10 } }, { runs: 2, best: { simple: 7, pro: NaN } }],
    ['Infinity', { runs: Infinity, best: { simple: Infinity, pro: -Infinity } }, { runs: -Infinity, best: { simple: 3 } }],
    ['numeric strings', { runs: '4', best: { simple: '900', pro: '1' } }, { runs: '2' }],
    ['non-array fields', { unlocked: 'industry:tech', chairmenMet: { 0: 'a' }, crisisBadges: 7 }, { unlocked: null, chairmenMet: 'x', crisisBadges: true }],
    ['non-object best', { best: 5 }, { best: [1, 2] }],
    ['missing fields', { version: 3 }, {}],
    ['duplicate ids', { unlocked: ['a', 'a', 'b', 'a'], chairmenMet: ['c', 'c'] }, { unlocked: ['b', 'b', 'a'], chairmenMet: ['c'] }],
    ['null and empty', null, {}],
    ['both null', null, null],
    ['arrays instead of objects', [], [1, 2, 3]],
    ['strings and numbers instead of objects', 'progress', 42]
];

for (const [name, a, b] of edgeCases) {
    test(`normalisation parity: ${name}`, () => {
        assert.deepEqual(clientMerge(a, b), serverMerge(a, b));
        assert.deepEqual(clientMerge(b, a), serverMerge(b, a));
    });
}

test('seeded random parity over 300 mixed valid and invalid merges', () => {
    const rng = new SeededRandom(20261107);
    const idPool = ['industry:tech', 'industry:pharma', 'mode:pro', 'crisis:gfc', 'a', 'b', 'c', 'UP:ID', 'bad id', 'x!', '', 'y'.repeat(41), 7, null];
    const badNumbers = [NaN, Infinity, -Infinity, -5, 0.5, 10001, 123456789, '12', null, undefined, {}];
    const num = () => (rng.next() < 0.3 ? rng.pick(badNumbers) : rng.intRange(0, 11000));
    const list = () => {
        const r = rng.next();
        if (r < 0.1) return rng.pick([undefined, null, 'str', 5, {}]);
        const n = rng.next() < 0.2 ? rng.intRange(45, 120) : rng.intRange(0, 8);
        return Array.from({ length: n }, () => (rng.next() < 0.3 ? `g${rng.intRange(0, 200)}` : rng.pick(idPool)));
    };
    const progress = () => {
        const r = rng.next();
        if (r < 0.05) return rng.pick([null, undefined, [], 'x', 3]);
        const p = {};
        if (rng.next() < 0.9) p.version = rng.pick([3, 2, undefined]);
        if (rng.next() < 0.9) p.runs = num();
        if (rng.next() < 0.9) p.best = rng.next() < 0.1 ? rng.pick([5, null, []]) : { simple: num(), pro: num() };
        for (const k of ['unlocked', 'chairmenMet', 'crisisBadges']) if (rng.next() < 0.9) p[k] = list();
        return p;
    };
    for (let i = 0; i < 300; i++) {
        const a = progress();
        const b = progress();
        assert.deepEqual(clientMerge(a, b), serverMerge(a, b), `iteration ${i}: ${JSON.stringify([a, b])}`);
    }
});
