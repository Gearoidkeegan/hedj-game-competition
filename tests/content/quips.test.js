import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJson } from '../helpers/loadData.js';
import { assertLengths, jsonShape, allStrings } from '../helpers/copy.js';

// v3.2: result quips follow the outcome (the quarter's market result and the hedge's), never the policy.
const RESULT_KEYS = ['nearBankrupt', 'overHedged', 'bigSave', 'bigMiss', 'boom', 'storm', 'calm'];
const PERSONALITIES = ['aggressive', 'cautious', 'operational'];
// v3.2: luckyBreach and breachLoss are split by the direction of the breach. Simple uses these keys.
const SIMPLE_BOARD_KEYS = [
    'moodUp', 'moodDown', 'redZone', 'overLucky', 'underLucky', 'overLoss', 'underLoss',
    'inPolicyBad', 'noPolicyHedgeLoss', 'noPolicyHedgeWin', 'noPolicyNudge', 'policyAdopted', 'wrongFocus',
];
// Pro has no band on its summaries, so its board review keeps the direction-free breach lines.
const PRO_ONLY_BOARD_KEYS = ['luckyBreach', 'breachLoss'];
const BOARD_KEYS = [...SIMPLE_BOARD_KEYS, ...PRO_ONLY_BOARD_KEYS];
const BOARD_INTRO_KEYS = ['band', 'noHedge', 'none'];
const CHAIRMEN = ['jameson', 'musk', 'oleary', 'dimon', 'buffett', 'jobs', 'dorsey', 'ackman'];
// A Simple pool can come up in all 8 quarters, so 8 lines guarantee no repeat within a run.
const RUN_LENGTH = 8;

function assertStringArray(arr, min, label) {
    assert.ok(Array.isArray(arr), `${label} is an array`);
    assert.ok(arr.length >= min, `${label} has ${arr.length} entries, needs >= ${min}`);
    for (const s of arr) assert.equal(typeof s, 'string', `${label} holds strings`);
    assert.equal(new Set(arr).size, arr.length, `${label} has no repeated line`);
}

test('quips.json result pools: one per outcome key, each with at least 8 quips', () => {
    const q = loadJson('data/quips.json');
    assert.deepEqual(Object.keys(q.result).sort(), [...RESULT_KEYS].sort());
    for (const k of RESULT_KEYS) assertStringArray(q.result[k], RUN_LENGTH, `result.${k}`);
});

test('result quips talk about the market and the hedge, never the board, the policy or luck', () => {
    const q = loadJson('data/quips.json');
    for (const k of RESULT_KEYS) {
        for (const l of q.result[k]) assert.doesNotMatch(l, /\b(board|polic(y|ies)|mandate|band|luck\w*)\b/i, `result.${k}: ${l}`);
    }
});

test('quips.json board lines cover every personality and trigger; Simple pools hold 8 lines', () => {
    const q = loadJson('data/quips.json');
    assert.deepEqual(Object.keys(q.board).sort(), [...PERSONALITIES].sort());
    for (const p of PERSONALITIES) {
        assert.deepEqual(Object.keys(q.board[p]).sort(), [...BOARD_KEYS].sort(), `board.${p} keys`);
        for (const k of SIMPLE_BOARD_KEYS) assertStringArray(q.board[p][k], RUN_LENGTH, `board.${p}.${k}`);
        for (const k of PRO_ONLY_BOARD_KEYS) assertStringArray(q.board[p][k], 6, `board.${p}.${k}`);
    }
});

// The copy names the breach: past the board's limit, or less cover than the board asked for.
const NAMES_OVER = /\b(more (cover|hedging)|limit|ceiling|cap|maximum|more than|too much|over-hedg\w*|past|beyond|above|over the|excess|extra)\b/i;
const NAMES_UNDER = /\b(less (cover|hedging)|less than|under-hedg\w*|below|short of|minimum|floor|too little|unhedged|open|bare|not enough|uncovered)\b/i;

test('the split breach pools name the breach: over the limit, or under what the board asked for', () => {
    const q = loadJson('data/quips.json');
    for (const p of PERSONALITIES) {
        for (const k of ['overLucky', 'overLoss']) for (const l of q.board[p][k]) assert.match(l, NAMES_OVER, `board.${p}.${k}: ${l}`);
        for (const k of ['underLucky', 'underLoss']) for (const l of q.board[p][k]) assert.match(l, NAMES_UNDER, `board.${p}.${k}: ${l}`);
    }
    for (const c of CHAIRMEN) {
        const { over, under } = q.chairman[c].offPolicy;
        for (const l of over) assert.match(l, NAMES_OVER, `chairman.${c}.offPolicy.over: ${l}`);
        for (const l of under) assert.match(l, NAMES_UNDER, `chairman.${c}.offPolicy.under: ${l}`);
    }
});

test('lucky breach lines name the breach rather than leaning on luck', () => {
    const q = loadJson('data/quips.json');
    for (const p of PERSONALITIES) {
        for (const k of ['overLucky', 'underLucky', 'luckyBreach']) {
            const lucky = q.board[p][k].filter(l => /\bluck/i.test(l));
            assert.ok(lucky.length <= 1, `board.${p}.${k} leans on luck ${lucky.length} times`);
        }
    }
});

test('each parody chairman has at least 8 positive, 8 negative and 6 off-policy lines each way', () => {
    const q = loadJson('data/quips.json');
    assert.deepEqual(Object.keys(q.chairman).sort(), [...CHAIRMEN].sort());
    for (const c of CHAIRMEN) {
        const pools = q.chairman[c];
        assert.deepEqual(Object.keys(pools).sort(), ['negative', 'offPolicy', 'positive'], `chairman.${c}`);
        assertStringArray(pools.positive, 8, `chairman.${c}.positive`);
        assertStringArray(pools.negative, 8, `chairman.${c}.negative`);
        assert.deepEqual(Object.keys(pools.offPolicy).sort(), ['over', 'under'], `chairman.${c}.offPolicy`);
        assertStringArray(pools.offPolicy.over, 6, `chairman.${c}.offPolicy.over`);
        assertStringArray(pools.offPolicy.under, 6, `chairman.${c}.offPolicy.under`);
    }
});

test('every line in quips.json is unique, so no two pools can show the same line in a run', () => {
    const seen = new Set();
    const dupes = [];
    for (const { path, s } of allStrings(loadJson('data/quips.json'))) {
        if (seen.has(s)) dupes.push(`${path}: ${s}`);
        seen.add(s);
    }
    assert.deepEqual(dupes, []);
});

test('only J.J. Jameson and ElonUsk use exclamation marks; nobody uses emoji', () => {
    const loud = new Set(['jameson', 'musk']);
    for (const { path, s } of allStrings(loadJson('data/quips.json'))) {
        const m = /^\$\.chairman\.(\w+)/.exec(path);
        if (!(m && loud.has(m[1]))) assert.doesNotMatch(s, /!/, `${path}: ${s}`);
        assert.doesNotMatch(s, /\p{Extended_Pictographic}/u, `${path}: ${s}`);
    }
});

test('quips.json boardIntro has at least 4 lines per board type, and band lines carry {band}', () => {
    const { boardIntro } = loadJson('data/quips.json');
    assert.deepEqual(Object.keys(boardIntro).sort(), [...BOARD_INTRO_KEYS].sort());
    for (const k of BOARD_INTRO_KEYS) assertStringArray(boardIntro[k], 4, `boardIntro.${k}`);
    for (const line of boardIntro.band) assert.ok(line.includes('{band}'), `band intro has {band}: ${line}`);
});

test('losing breaches hint at immediate dismissal at least twice per persona', () => {
    const q = loadJson('data/quips.json');
    const sack = /\b(fired|dismiss\w*|P45|clear your desk|replac(e|ing) you|exit interview|lanyard|access card|security|final written warning|HR)\b/i;
    for (const p of PERSONALITIES) {
        for (const k of ['overLoss', 'underLoss', 'breachLoss']) {
            const n = q.board[p][k].filter((l) => sack.test(l)).length;
            assert.ok(n >= 2, `board.${p}.${k} has ${n} dismissal hints`);
        }
    }
});

test('quips.json bankrupt and fired have at least 6 lines', () => {
    const q = loadJson('data/quips.json');
    assertStringArray(q.bankrupt, 6, 'bankrupt');
    assertStringArray(q.fired, 6, 'fired');
});

test('gameOverTitles has at least 6 tiers, sorted by min and starting at 0', () => {
    const { gameOverTitles } = loadJson('data/quips.json');
    assert.ok(Array.isArray(gameOverTitles) && gameOverTitles.length >= 6, 'at least 6 titles');
    assert.equal(gameOverTitles[0].min, 0);
    for (let i = 0; i < gameOverTitles.length; i++) {
        const t = gameOverTitles[i];
        assert.ok(Number.isInteger(t.min) && t.min >= 0, `title ${i} min is a non-negative integer`);
        assert.equal(typeof t.title, 'string', `title ${i} has a title`);
        assert.equal(typeof t.line, 'string', `title ${i} has a line`);
        if (i > 0) assert.ok(t.min > gameOverTitles[i - 1].min, `title ${i} min is above the previous one`);
    }
});

test('every quips.json string is non-empty and at most 90 characters', () => {
    assertLengths(loadJson('data/quips.json'), 'quips.json');
});

test('every board-dialogue.json string is non-empty and at most 90 characters', () => {
    assertLengths(loadJson('data/board-dialogue.json'), 'board-dialogue.json');
});

// D1 shortened the board-dialogue lines; its keys, nesting and array lengths must stay as they were.
test('board-dialogue.json keeps its pinned shape (keys, nesting, array lengths)', () => {
    const expected = loadJson('tests/content/fixtures/board-dialogue.shape.json');
    assert.deepEqual(jsonShape(loadJson('data/board-dialogue.json')), expected);
});

test('v3.1 wrongFocus: at least 8 lines per persona, no repeats, each 90 characters or fewer', () => {
    const q = loadJson('data/quips.json');
    for (const p of PERSONALITIES) {
        const pool = q.board[p].wrongFocus;
        assertStringArray(pool, RUN_LENGTH, `board.${p}.wrongFocus`);
        for (const l of pool) assert.ok(l.length > 0 && l.length <= 90, `${l.length}: ${l}`);
    }
});

test('final M3: no wrongFocus line mentions "the policy" (the no-policy board says them too)', () => {
    const q = loadJson('data/quips.json');
    for (const p of PERSONALITIES) for (const l of q.board[p].wrongFocus) assert.doesNotMatch(l, /\bpolicy\b/i, l);
});
