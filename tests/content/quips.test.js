import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJson } from '../helpers/loadData.js';

const MAX_LEN = 90;
const RESULT_KEYS = ['bigSave', 'bigMiss', 'overHedged', 'nearBankrupt', 'calm', 'boom'];
const PERSONALITIES = ['aggressive', 'cautious', 'operational'];
const BOARD_KEYS = ['moodUp', 'moodDown', 'redZone', 'luckyBreach', 'breachLoss'];
const CHAIRMEN = ['jameson', 'musk', 'oleary', 'dimon', 'buffett', 'jobs', 'dorsey', 'ackman'];

// Collects every string in a JSON value with its path, so failures name the offending entry.
function allStrings(value, path = '$', out = []) {
    if (typeof value === 'string') out.push({ path, s: value });
    else if (Array.isArray(value)) value.forEach((v, i) => allStrings(v, `${path}[${i}]`, out));
    else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) allStrings(v, `${path}.${k}`, out);
    }
    return out;
}

function assertStringArray(arr, min, label) {
    assert.ok(Array.isArray(arr), `${label} is an array`);
    assert.ok(arr.length >= min, `${label} has ${arr.length} entries, needs >= ${min}`);
    for (const s of arr) assert.equal(typeof s, 'string', `${label} holds strings`);
}

function assertLengths(data, file) {
    const strings = allStrings(data);
    assert.ok(strings.length > 0, `${file} has strings`);
    const empty = strings.filter(({ s }) => s.trim() === '').map(({ path }) => path);
    assert.deepEqual(empty, [], `${file} has no empty strings`);
    const tooLong = strings.filter(({ s }) => s.length > MAX_LEN).map(({ path, s }) => `${path} (${s.length})`);
    assert.deepEqual(tooLong, [], `${file} strings are <= ${MAX_LEN} characters`);
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
