// v3.2 Task 3: feedback that matches the result. Pure selection rules (outcomeFor, the result quip, the board line,
// the chairman's tone), the no-repeat line picker, and the two playtest cases reported by the user.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadJson, loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { isRunOver } from '../../js/engine/sim/SimEngine.js';
import * as storage from '../../js/utils/storage.js';
import {
    RunController, outcomeFor, resultQuipKey, boardLineKey, chairmanTone, chairmanFor, expressionFor,
    quarterFeedback, linePick, CHAIRMAN_YIELDS_TO
} from '../../js/screens/simple/RunController.js';

marketEngine.loadFromObjects(loadMarketData());

const quips = loadJson('data/quips.json');
const industries = loadIndustries();
const members = industries.find(i => i.id === 'airline').boardMembers;
const content = { industries, events: loadJson('data/simple-events.json').events, quips, powerups: loadJson('data/powerups.json') };

const S = 1_000_000_000;   // starting cash
const BAND = { min: 0.5, max: 0.75 };
const NO_HEDGE = { min: 0, max: 0 };

const line = (o = {}) => ({ exposureId: 'usd', exposureImpact: 0, hedgeImpact: 0, hedgeRatio: 0,
    forecastNotional: 100, realisedNotional: 100, movePct: 0, ...o });

// A Simple summary: in policy, a flat quarter, no hedge result, cash well above the red line.
function summary(o = {}) {
    const lines = o.lines || [line()];
    const exposureTotal = lines.reduce((s, l) => s + l.exposureImpact, 0);
    const hedgeTotal = lines.reduce((s, l) => s + l.hedgeImpact, 0);
    return {
        q: 2, policy: 'in', inMandate: true, breach: 'none', severe: false,
        marketResult: exposureTotal + hedgeTotal, playerDelta: exposureTotal + hedgeTotal, benchmarkDelta: exposureTotal,
        cashAfter: S, redLine: 0.2 * S, boardMoodAfter: 64, policyAdopted: null, riskCover: 0.6, wrongFocus: false,
        lines, exposureTotal, hedgeTotal, ...o
    };
}

const run = (o = {}) => ({ seed: 1234, startingCash: S, mandate: BAND, industryId: 'airline', history: [], ...o });
const feedback = (r, s) => quarterFeedback(r, s, { quips, members });

// ── outcomeFor ──────────────────────────────────────────────────────────

test('outcomeFor: every policy state', () => {
    const state = (s, mandate = BAND) => outcomeFor(summary(s), S, mandate).policyState;
    assert.equal(state({ policy: 'none', policyAdopted: { min: 0.5, max: 0.75 } }, null), 'adopted');
    assert.equal(state({ policy: 'off', breach: 'loss', wrongFocus: true, riskCover: 0.6 }), 'wrongFocus');
    assert.equal(state({ policy: 'off', breach: 'lucky', riskCover: 1 }), 'over');
    assert.equal(state({ policy: 'off', breach: 'lucky', riskCover: 0 }), 'under');
    assert.equal(state({ policy: 'off', breach: 'loss', riskCover: 0.25 }), 'under');
    assert.equal(state({ policy: 'off', breach: 'lucky', riskCover: 0.5 }, NO_HEDGE), 'over', 'any hedge on a no-hedge board');
    assert.equal(state({}), 'in');
    assert.equal(state({ policy: 'none' }, null), 'none');
    assert.equal(state({ policy: 'none', wrongFocus: true }, null), 'wrongFocus', 'the no-policy board says it too');
});

test('outcomeFor: the quarter is the market result (exposures plus hedges) against 0.5% of starting cash', () => {
    const quarter = v => outcomeFor(summary({ lines: [line({ exposureImpact: v })] }), S).quarter;
    assert.equal(quarter(0.02 * S), 'good');
    assert.equal(quarter(0.005 * S), 'good');
    assert.equal(quarter(0.0049 * S), 'flat');
    assert.equal(quarter(0), 'flat');
    assert.equal(quarter(-0.0049 * S), 'flat');
    assert.equal(quarter(-0.005 * S), 'bad');
    assert.equal(quarter(-0.02 * S), 'bad');
    // Exposures and hedges together: a 3% hit fully hedged is a flat quarter.
    assert.equal(outcomeFor(summary({ lines: [line({ exposureImpact: -0.03 * S, hedgeImpact: 0.03 * S })] }), S).quarter, 'flat');
});

test('outcomeFor: the hedge won, lost or made no result worth naming (0.5% of starting cash)', () => {
    const hedge = v => outcomeFor(summary({ lines: [line({ hedgeImpact: v })] }), S).hedge;
    assert.equal(hedge(0.006 * S), 'won');
    assert.equal(hedge(-0.006 * S), 'lost');
    assert.equal(hedge(0.004 * S), 'none');
    assert.equal(hedge(0), 'none');
});

test('outcomeFor: a summary without a known direction (Pro, or no mandate given) is plain "off"', () => {
    assert.equal(outcomeFor(summary({ policy: 'off', breach: 'lucky' }), S).policyState, 'off');
    assert.equal(outcomeFor(summary({ policy: 'off', breach: 'lucky', riskCover: undefined }), S, BAND).policyState, 'off');
});

// ── The result quip ─────────────────────────────────────────────────────

test('result quip: calm only for a flat quarter with no hedge result over 0.5%', () => {
    const key = s => resultQuipKey(summary(s), S);
    assert.equal(key({}), 'calm');
    assert.equal(key({ lines: [line({ exposureImpact: 0.004 * S })] }), 'calm');
    assert.equal(key({ lines: [line({ exposureImpact: 0.02 * S })] }), 'boom');
    assert.equal(key({ lines: [line({ exposureImpact: -0.02 * S })] }), 'storm');
    assert.equal(key({ lines: [line({ exposureImpact: -0.03 * S, hedgeImpact: 0.03 * S })] }), 'bigSave', 'a flat quarter the hedge saved');
    assert.equal(key({ lines: [line({ exposureImpact: 0.03 * S, hedgeImpact: -0.03 * S })] }), 'bigMiss', 'a flat quarter the hedge gave away');
    assert.equal(key({ lines: [line({ hedgeRatio: 1, realisedNotional: 80, hedgeImpact: 0.03 * S })] }), 'overHedged');
    assert.equal(key({ cashAfter: 0.1 * S, lines: [line({ hedgeImpact: 0.03 * S })] }), 'nearBankrupt', 'the red line comes first');
    for (const v of [0.02, -0.02, 0.01, -0.01]) {
        assert.notEqual(key({ lines: [line({ exposureImpact: v * S })] }), 'calm', `a ${v * 100}% move is never calm`);
    }
});

// ── The board line ──────────────────────────────────────────────────────

test('board line: breaches are split by direction when the band is known; Pro keeps the old keys', () => {
    const key = (s, mandate = BAND) => boardLineKey(summary(s), 60, mandate);
    assert.equal(key({ policy: 'off', breach: 'lucky', riskCover: 1 }), 'overLucky');
    assert.equal(key({ policy: 'off', breach: 'lucky', riskCover: 0 }), 'underLucky');
    assert.equal(key({ policy: 'off', breach: 'loss', riskCover: 1, marketResult: -1 }), 'overLoss');
    assert.equal(key({ policy: 'off', breach: 'loss', riskCover: 0.2, marketResult: -1 }), 'underLoss');
    assert.equal(key({ policy: 'off', breach: 'loss', riskCover: 0.3, marketResult: -1 }, NO_HEDGE), 'overLoss');
    // Pro summaries carry no riskCover and Pro passes no band: the direction is unknown.
    assert.equal(boardLineKey(summary({ policy: 'off', breach: 'lucky', riskCover: undefined }), 60), 'luckyBreach');
    assert.equal(boardLineKey(summary({ policy: 'off', breach: 'loss', riskCover: undefined }), 60), 'breachLoss');
    assert.equal(expressionFor('overLoss'), 'angry');
    assert.equal(expressionFor('underLoss'), 'angry');
    assert.equal(expressionFor('overLucky'), 'neutral');
    assert.equal(expressionFor('underLucky'), 'neutral');
});

// ── The chairman ────────────────────────────────────────────────────────

test('chairman tone: yields to a proposal, the wrong focus and losing breaches; off-policy lines on the others', () => {
    const o = q => ({ quarter: q });
    for (const key of ['policyAdopted', 'wrongFocus', 'overLoss', 'underLoss', 'breachLoss']) {
        assert.ok(CHAIRMAN_YIELDS_TO.includes(key), key);
        assert.equal(chairmanTone(key, o('good')), null, key);
    }
    assert.equal(chairmanTone('overLucky', o('good')), 'offPolicy');
    assert.equal(chairmanTone('underLucky', o('flat')), 'offPolicy');
    assert.equal(chairmanTone('moodUp', o('good')), 'positive');
    assert.equal(chairmanTone('noPolicyNudge', o('flat')), 'positive');
    assert.equal(chairmanTone('inPolicyBad', o('bad')), 'negative');
    assert.equal(chairmanTone('inPolicyBad', o('flat')), 'negative', 'a small in-policy loss');
    assert.equal(chairmanTone('noPolicyHedgeLoss', o('flat')), 'negative');
    assert.equal(chairmanTone('redZone', o('flat')), 'negative');
    assert.equal(chairmanTone('noPolicyHedgeWin', o('bad')), 'negative', 'the quarter decides first');
});

test('the chairman never talks over a breach: on a breach quarter he speaks an off-policy line or yields', () => {
    const r = run();
    const persona = chairmanFor(r.seed);
    const breach = (o) => summary({ q: 1, policy: 'off', inMandate: false, ...o });
    const cases = [
        [breach({ breach: 'lucky', riskCover: 1, lines: [line({ exposureImpact: 0.03 * S, hedgeImpact: -0.01 * S, hedgeRatio: 1 })] }),
            'overLucky', 'over'],
        [breach({ breach: 'lucky', riskCover: 0, lines: [line({ exposureImpact: 0.02 * S })] }), 'underLucky', 'under'],
    ];
    for (const [s, key, dir] of cases) {
        const { boardReaction: b } = feedback(r, s);
        assert.equal(b.key, key);
        assert.equal(b.speaker, 'chairman', key);
        assert.equal(b.chairmanId, persona);
        assert.ok(quips.chairman[persona].offPolicy[dir].includes(b.line), `${key}: ${b.line}`);
        assert.equal(b.expression, 'neutral');
    }
    for (const [s, key] of [
        [breach({ breach: 'loss', riskCover: 1, lines: [line({ exposureImpact: -0.02 * S, hedgeRatio: 1 })] }), 'overLoss'],
        [breach({ breach: 'loss', riskCover: 0, lines: [line({ exposureImpact: -0.02 * S })] }), 'underLoss'],
        [summary({ q: 1, policy: 'off', breach: 'loss', wrongFocus: true, lines: [line({ exposureImpact: -0.02 * S })] }), 'wrongFocus'],
        [summary({ q: 1, policy: 'none', policyAdopted: { min: 0.5, max: 0.75 } }), 'policyAdopted'],
    ]) {
        const { boardReaction: b } = feedback({ ...r, mandate: key === 'policyAdopted' ? null : BAND }, s);
        assert.equal(b.key, key);
        assert.equal(b.speaker, 'board', `${key}: the chairman yields`);
        assert.ok(quips.board[b.member.personality][key].includes(b.line), `${key}: ${b.line}`);
    }
});

test('the chairman picks positive or negative lines by the outcome, with a matching face', () => {
    const r = run();
    const persona = chairmanFor(r.seed);
    const good = feedback(r, summary({ q: 4, lines: [line({ exposureImpact: 0.02 * S })] })).boardReaction;
    assert.equal(good.speaker, 'chairman');
    assert.ok(quips.chairman[persona].positive.includes(good.line), good.line);
    assert.equal(good.expression, 'happy');
    const bad = feedback(r, summary({ q: 4, lines: [line({ exposureImpact: -0.02 * S })] })).boardReaction;
    assert.equal(bad.key, 'inPolicyBad');
    assert.ok(quips.chairman[persona].negative.includes(bad.line), bad.line);
    assert.equal(bad.expression, 'angry');
});

// ── The user's two playtest cases ───────────────────────────────────────

// Case 1: no hedge, a 50–75% board, the market made 2% of starting cash. Not "Uneventful", and the reaction says the
// player hedged less than the board asked for.
const CASE_1 = (q) => summary({ q, policy: 'off', inMandate: false, breach: 'lucky', riskCover: 0,
    lines: [line({ exposureImpact: 0.02 * S, hedgeRatio: 0 })] });
// Case 2: 100% hedged on a 50–75% board; the hedges cost 2% of starting cash but the quarter was still good.
const CASE_2 = (q) => summary({ q, policy: 'off', inMandate: false, breach: 'lucky', riskCover: 1,
    lines: [line({ exposureImpact: 0.03 * S, hedgeImpact: -0.02 * S, hedgeRatio: 1 })] });

test('playtest case 1: unhedged under a 50–75% policy, market +2%: an under-hedged breach line, never calm', () => {
    for (const q of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const s = CASE_1(q);
        assert.deepEqual(outcomeFor(s, S, BAND), { policyState: 'under', quarter: 'good', hedge: 'none' });
        const { quip, boardReaction: b } = feedback(run(), s);
        assert.notEqual(quip.key, 'calm', `Q${q}`);
        assert.equal(quip.key, 'boom');
        assert.ok(quips.result.boom.includes(quip.text));
        assert.equal(b.key, 'underLucky', `Q${q}`);
        const pool = b.speaker === 'chairman'
            ? quips.chairman[b.chairmanId].offPolicy.under
            : quips.board[b.member.personality].underLucky;
        assert.ok(pool.includes(b.line), `Q${q} ${b.speaker}: ${b.line}`);
    }
});

test('playtest case 2: 100% hedged on a 50–75% board, hedge -2%, quarter good: an over-hedged breach line', () => {
    for (const q of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const s = CASE_2(q);
        assert.deepEqual(outcomeFor(s, S, BAND), { policyState: 'over', quarter: 'good', hedge: 'lost' });
        const { quip, boardReaction: b } = feedback(run(), s);
        assert.equal(quip.key, 'bigMiss', `Q${q}`);
        assert.equal(b.key, 'overLucky', `Q${q}`);
        const pool = b.speaker === 'chairman'
            ? quips.chairman[b.chairmanId].offPolicy.over
            : quips.board[b.member.personality].overLucky;
        assert.ok(pool.includes(b.line), `Q${q} ${b.speaker}: ${b.line}`);
    }
});

// ── No repeats, resume-stable ───────────────────────────────────────────

test('linePick: a seeded permutation, so the first N uses of a pool are N different lines', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    for (const seed of [1, 2, 3, 99, 0xFFFFFFFF]) {
        const picks = pool.map((_, i) => linePick(seed, 'result.calm', pool, i));
        assert.equal(new Set(picks).size, pool.length, `seed ${seed}`);
        assert.deepEqual(picks, pool.map((_, i) => linePick(seed, 'result.calm', pool, i)), 'deterministic');
    }
    const a = pool.map((_, i) => linePick(7, 'result.calm', pool, i)).join('');
    const b = pool.map((_, i) => linePick(7, 'result.boom', pool, i)).join('');
    assert.notEqual(a, b, 'each pool has its own order');
    assert.equal(linePick(7, 'x', [], 0), '');
});

test('no line repeats when the same outcome comes up 8 quarters running', () => {
    for (const make of [CASE_1, CASE_2, q => summary({ q }), q => summary({ q, lines: [line({ exposureImpact: -0.02 * S })] })]) {
        for (const seed of [1, 2, 3, 4, 5]) {
            const history = [];
            const quipsSeen = [];
            const linesSeen = [];
            for (let q = 1; q <= 8; q++) {
                const s = make(q);
                const { quip, boardReaction } = feedback(run({ seed, history: [...history] }), s);
                quipsSeen.push(quip.text);
                linesSeen.push(boardReaction.line);
                history.push(s);
            }
            assert.equal(new Set(quipsSeen).size, 8, `seed ${seed}: ${quipsSeen.join(' | ')}`);
            assert.equal(new Set(linesSeen).size, 8, `seed ${seed}: ${linesSeen.join(' | ')}`);
        }
    }
});

class FakeStorage {
    constructor() { this.m = new Map(); }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
    setItem(k, v) { this.m.set(k, String(v)); }
    removeItem(k) { this.m.delete(k); }
}
const EMAIL = 'ann@x.com';
const T0 = 1_700_000_000_000;

function decide(rc) {
    const d = rc.currentDecisionsDefaults();
    const r = rc.run;
    if (r.pendingEvent) d.eventChoice = content.events.find(e => e.id === r.pendingEvent).choices[0].id;
    if (r.mandate === null && r.quarter < r.maxQuarters - 1) d.proposePolicy = { min: 0.5, max: 0.75 };
    return d;
}
const controller = () => new RunController({ storage, api: null, market: marketEngine, content, now: () => T0 });

beforeEach(() => {
    storage.setStorageBackend(new FakeStorage());
    globalThis.localStorage = new FakeStorage();
    storage.saveRegistration({ playerName: 'Ann', email: EMAIL, company: 'Co', gameToken: 't', gameTokenExpiry: T0 * 2 });
});

test('a full run never repeats a quip or a board line, and a reload every quarter gives the same lines', () => {
    for (const seed of [3, 5, 11, 21]) {
        storage.setStorageBackend(new FakeStorage());
        const straight = controller();
        straight.start('airline', { seed });
        const expected = [];
        const decisions = [];
        while (!isRunOver(straight.run)) {
            const d = decide(straight);
            decisions.push(d);
            const r = straight.playQuarter(d);
            expected.push([r.quip.text, r.boardReaction.line]);
        }
        const quipTexts = expected.map(e => e[0]);
        const boardLines = expected.map(e => e[1]);
        assert.equal(new Set(quipTexts).size, quipTexts.length, `seed ${seed} quips: ${quipTexts.join(' | ')}`);
        assert.equal(new Set(boardLines).size, boardLines.length, `seed ${seed} board: ${boardLines.join(' | ')}`);

        // The same run, reloaded from storage before every quarter.
        storage.setStorageBackend(new FakeStorage());
        controller().start('airline', { seed });
        const got = [];
        for (const d of decisions) {
            const rc = controller();
            assert.ok(rc.resume(EMAIL), 'resumes');
            const r = rc.playQuarter(d);
            got.push([r.quip.text, r.boardReaction.line]);
        }
        assert.deepEqual(got, expected, `seed ${seed}`);
    }
});

test('the feedback for a quarter depends only on the run before it and the summary (resume-stable)', () => {
    const history = [CASE_1(1), CASE_1(2), summary({ q: 3 })];
    const a = feedback(run({ history: structuredClone(history) }), CASE_1(4));
    const b = feedback(JSON.parse(JSON.stringify(run({ history }))), JSON.parse(JSON.stringify(CASE_1(4))));
    assert.deepEqual(a, b);
});
