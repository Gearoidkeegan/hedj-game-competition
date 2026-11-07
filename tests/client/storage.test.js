import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    setStorageBackend, saveRun, loadRun, clearRun, getProgress, saveProgress,
    queueScore, getQueuedScores, removeQueuedScore, saveRegistration
} from '../../js/utils/storage.js';
import { flushScoreQueue, getRemoteProgress, fetchLeaderboard } from '../../js/utils/api.js';
import { emptyProgress, serialiseSave } from '../../js/engine/sim/progress.js';

class FakeStorage {
    constructor() { this.m = new Map(); }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
    setItem(k, v) { this.m.set(k, String(v)); }
    removeItem(k) { this.m.delete(k); }
}

const A = 'a@x.com';
const B = 'b@x.com';
const run = { version: 3, history: [], marker: 'A-run' };
const score = (gameId, email = A) => ({
    gameId, email, playerName: 'Ann', mode: 'simple', score: 1200, quartersPlayed: 8, startedAt: 1, industryId: 'airline'
});
const reg = (email, token, expiry = Date.now() + 3600_000) =>
    saveRegistration({ playerName: 'Ann', email, company: 'Co', gameToken: token, gameTokenExpiry: expiry });

let calls;
function fakeFetch(statusFor) {
    calls = [];
    globalThis.fetch = async (url, opts) => {
        const body = opts?.body ? JSON.parse(opts.body) : null;
        calls.push({ url, body, headers: opts?.headers });
        const status = statusFor(body, url);
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => (status < 300
                ? { rank: 1, best: 1200, isBest: true, entries: [{ rank: 1 }], progress: null }
                : { error: 'nope' })
        };
    };
}

beforeEach(() => {
    setStorageBackend(new FakeStorage());
    // The legacy registration helpers use the global localStorage; give Node a stand-in.
    globalThis.localStorage = new FakeStorage();
});

test("player B does not see player A's run or progress", () => {
    saveRun(A, serialiseSave(run));
    const p = emptyProgress();
    p.runs = 5;
    p.best.simple = 2600;
    saveProgress(A, p);

    assert.equal(loadRun(B), null);
    assert.deepEqual(getProgress(B), emptyProgress());
    assert.equal(loadRun(A).marker, 'A-run');
    assert.equal(getProgress(A).best.simple, 2600);
});

test('email keys are case-insensitive', () => {
    saveRun('A@X.com', serialiseSave(run));
    assert.equal(loadRun(A).marker, 'A-run');
});

test('a corrupt or old-version save loads as null and is cleared', () => {
    const s = new FakeStorage();
    setStorageBackend(s);
    s.setItem(`hedj_v3:${A}:run`, '{not json');
    assert.equal(loadRun(A), null);
    assert.equal(s.getItem(`hedj_v3:${A}:run`), null);
    s.setItem(`hedj_v3:${A}:run`, JSON.stringify({ version: 2, history: [] }));
    assert.equal(loadRun(A), null);
    saveRun(A, serialiseSave(run));
    clearRun(A);
    assert.equal(loadRun(A), null);
});

test('queue keeps 20 newest', () => {
    for (let i = 1; i <= 25; i++) queueScore(score(`g${i}`));
    const q = getQueuedScores();
    assert.equal(q.length, 20);
    assert.equal(q[0].gameId, 'g6');
    assert.equal(q[19].gameId, 'g25');
    removeQueuedScore('g25');
    assert.equal(getQueuedScores().length, 19);
});

test('queued scores survive token expiry and flush after new registration', async () => {
    queueScore(score('g1'));
    fakeFetch(() => 200);
    reg(A, 'old', Date.now() - 1000);
    assert.equal(await flushScoreQueue(), 0);
    assert.equal(calls.length, 0);
    assert.equal(getQueuedScores().length, 1);

    reg(A, 'fresh');
    assert.equal(await flushScoreQueue(), 1);
    assert.equal(calls[0].body.gameToken, 'fresh');
    assert.equal(calls[0].body.gameId, 'g1');
    assert.equal(getQueuedScores().length, 0);
});

test('401 keeps item, 400 drops item', async () => {
    reg(A, 't');
    queueScore(score('g1'));
    fakeFetch(() => 401);
    assert.equal(await flushScoreQueue(), 0);
    assert.equal(getQueuedScores().length, 1);

    fakeFetch(() => 400);
    assert.equal(await flushScoreQueue(), 0);
    assert.equal(getQueuedScores().length, 0);
});

test('a network failure keeps the item', async () => {
    reg(A, 't');
    queueScore(score('g1'));
    globalThis.fetch = async () => { throw new TypeError('network'); };
    assert.equal(await flushScoreQueue(), 0);
    assert.equal(getQueuedScores().length, 1);
});

test("another player's queued score is not sent with this player's token", async () => {
    reg(B, 'tb');
    queueScore(score('g1', A));
    fakeFetch(() => 200);
    assert.equal(await flushScoreQueue(), 0);
    assert.equal(calls.length, 0);
    assert.equal(getQueuedScores().length, 1);
});

test('fetchLeaderboard builds the query and returns the entries array', async () => {
    fakeFetch(() => 200);
    const entries = await fetchLeaderboard({ mode: 'pro', period: 'today', limit: 5 });
    assert.deepEqual(entries, [{ rank: 1 }]);
    assert.equal(calls[0].url, '/api/leaderboard?mode=pro&period=today&limit=5');
});

test('getRemoteProgress sends the player headers and returns null without a token', async () => {
    fakeFetch(() => 200);
    assert.equal(await getRemoteProgress(), null);
    assert.equal(calls.length, 0);
    reg(A, 'tok');
    await getRemoteProgress();
    assert.equal(calls[0].headers['x-game-token'], 'tok');
    assert.equal(calls[0].headers['x-player-email'], A);
});
