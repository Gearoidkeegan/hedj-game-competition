import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJson } from '../helpers/loadData.js';
import { assertLengths, jsonShape } from '../helpers/copy.js';

const RESULT_KEYS = ['bigSave', 'bigMiss', 'overHedged', 'nearBankrupt', 'calm', 'boom'];
const PERSONALITIES = ['aggressive', 'cautious', 'operational'];
const BOARD_KEYS = [
    'moodUp', 'moodDown', 'redZone', 'luckyBreach', 'breachLoss',
    'inPolicyBad', 'noPolicyHedgeLoss', 'noPolicyHedgeWin', 'noPolicyNudge', 'policyAdopted',
];
const BOARD_INTRO_KEYS = ['band', 'noHedge', 'none'];
const CHAIRMEN = ['jameson', 'musk', 'oleary', 'dimon', 'buffett', 'jobs', 'dorsey', 'ackman'];

function assertStringArray(arr, min, label) {
    assert.ok(Array.isArray(arr), `${label} is an array`);
    assert.ok(arr.length >= min, `${label} has ${arr.length} entries, needs >= ${min}`);
    for (const s of arr) assert.equal(typeof s, 'string', `${label} holds strings`);
}

test('quips.json result arrays each have at least 6 quips', () => {
    const q = loadJson('data/quips.json');
    assert.deepEqual(Object.keys(q.result).sort(), [...RESULT_KEYS].sort());
    for (const k of RESULT_KEYS) assertStringArray(q.result[k], 6, `result.${k}`);
});

test('quips.json board lines cover every personality and trigger', () => {
    const q = loadJson('data/quips.json');
    assert.deepEqual(Object.keys(q.board).sort(), [...PERSONALITIES].sort());
    for (const p of PERSONALITIES) {
        assert.deepEqual(Object.keys(q.board[p]).sort(), [...BOARD_KEYS].sort(), `board.${p} keys`);
        for (const k of BOARD_KEYS) assertStringArray(q.board[p][k], 6, `board.${p}.${k}`);
    }
});

test('quips.json has at least 4 lines for each parody chairman', () => {
    const q = loadJson('data/quips.json');
    assert.deepEqual(Object.keys(q.chairman).sort(), [...CHAIRMEN].sort());
    for (const c of CHAIRMEN) assertStringArray(q.chairman[c], 4, `chairman.${c}`);
});

test('quips.json boardIntro has at least 4 lines per board type, and band lines carry {band}', () => {
    const { boardIntro } = loadJson('data/quips.json');
    assert.deepEqual(Object.keys(boardIntro).sort(), [...BOARD_INTRO_KEYS].sort());
    for (const k of BOARD_INTRO_KEYS) assertStringArray(boardIntro[k], 4, `boardIntro.${k}`);
    for (const line of boardIntro.band) assert.ok(line.includes('{band}'), `band intro has {band}: ${line}`);
});

test('breachLoss hints at immediate dismissal at least twice per persona', () => {
    const q = loadJson('data/quips.json');
    const sack = /fired|out|lanyard|HR|clear your desk|security|dismiss|access card|coat|pass|final written/i;
    for (const p of PERSONALITIES) {
        const n = q.board[p].breachLoss.filter((l) => sack.test(l)).length;
        assert.ok(n >= 2, `board.${p}.breachLoss has ${n} dismissal hints`);
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
