import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDdb } from './fakeDdb.mjs';
import { createHandler as createRegister } from '../handlers/register.mjs';
import { createHandler as createScore } from '../handlers/score.mjs';
import { createHandler as createLeaderboard } from '../handlers/leaderboard.mjs';
import { createHandler as createProgress } from '../handlers/progress.mjs';
import { createHandler as createAdmin } from '../handlers/admin.mjs';
import { createHandler as createAnalytics } from '../handlers/analytics.mjs';
import { mergeProgress } from '../lib/progress.mjs';

const T0 = 1_700_000_000_000; // 2023-11-14T22:13:20Z
const MIN = 60_000;
const HOUR = 3_600_000;

function setup(startMs = T0) {
    const ddb = createFakeDdb({
        P: { pk: 'email' },
        S: { pk: 'scoreId' },
        B: { pk: 'board', sk: 'email', indexes: { ByScore: { pk: 'board', sk: 'score' } } },
        A: { pk: 'metricName' }
    });
    let t = startMs;
    let n = 0;
    const deps = {
        ddb,
        env: {
            PLAYERS_TABLE: 'P', SCORES_TABLE: 'S', BEST_TABLE: 'B', ANALYTICS_TABLE: 'A', ADMIN_KEY: 'k',
            EVENT_ID: 'ev', EVENT_END_ISO: '2023-12-01T00:00:00Z', TOKEN_TTL_HOURS: '120'
        },
        now: () => t,
        uuid: () => `uuid-${++n}`
    };
    return { deps, ddb, advance: ms => { t += ms; } };
}

const post = body => ({ body: JSON.stringify(body) });
const reg = { playerName: 'Ann', email: 'Ann@Example.com', company: 'Acme', consentGiven: true };
const PUT = { requestContext: { http: { method: 'PUT' } } };

async function register(deps, over = {}) {
    return JSON.parse((await createRegister(deps)(post({ ...reg, ...over }))).body);
}
function scoreBody(token, over = {}) {
    return {
        gameToken: token, email: 'ann@example.com', gameId: 'g1', mode: 'simple', score: 1200, quartersPlayed: 8,
        startedAt: T0 - 5 * MIN, industryId: 'airline', playerName: 'Ann', company: 'Acme', ...over
    };
}
const submit = (deps, body) => createScore(deps)(post(body));
const row = (ddb, table, ...keyParts) => ddb.tables[table].get(keyParts.join('\u0000'));

test('re-register keeps registeredAt and marketingConsent:true', async () => {
    const { deps, ddb, advance } = setup();
    await register(deps, { marketingConsent: true });
    const first = row(ddb, 'P', 'ann@example.com');
    advance(HOUR);
    await register(deps, { marketingConsent: false });
    await register(deps); // omitted
    const again = row(ddb, 'P', 'ann@example.com');
    assert.equal(again.registeredAt, first.registeredAt);
    assert.equal(again.registeredAt, new Date(T0).toISOString());
    assert.equal(again.marketingConsent, true);
    assert.notEqual(again.gameToken, first.gameToken);
});

test('marketingConsent defaults to false; ttl is event end + 90 days', async () => {
    const { deps, ddb } = setup();
    await register(deps);
    const p = row(ddb, 'P', 'ann@example.com');
    assert.equal(p.marketingConsent, false);
    assert.equal(p.ttl, Math.floor((Date.parse('2023-12-01T00:00:00Z') + 90 * 24 * HOUR) / 1000));
});

test('token lasts TokenTtlHours', async () => {
    const { deps, advance } = setup();
    const r = await register(deps);
    assert.equal(r.expiresAt, T0 + 120 * HOUR);
    advance(119 * HOUR);
    assert.equal((await submit(deps, scoreBody(r.gameToken, { startedAt: T0 }))).statusCode, 200);
    advance(2 * HOUR);
    assert.equal((await submit(deps, scoreBody(r.gameToken, { gameId: 'g2', startedAt: T0 }))).statusCode, 401);
});

test('register rejects bad names and companies, accepts emoji', async () => {
    const { deps } = setup();
    const h = createRegister(deps);
    for (const playerName of ['<b>', 'a"b', 'a&b', 'a'.repeat(21), '  ']) {
        assert.equal((await h(post({ ...reg, playerName }))).statusCode, 400, playerName);
    }
    for (const company of ['<x>', 'c'.repeat(61), '']) {
        assert.equal((await h(post({ ...reg, company }))).statusCode, 400, company);
    }
    assert.equal((await h(post({ ...reg, playerName: 'Zoë ❤️' }))).statusCode, 200);
});

test('register validates input and rejects oversized, malformed or non-object bodies', async () => {
    const { deps } = setup();
    const h = createRegister(deps);
    assert.equal((await h(post({ ...reg, consentGiven: false }))).statusCode, 400);
    assert.equal((await h(post({ ...reg, email: 'nope' }))).statusCode, 400);
    assert.equal((await h({ body: '{nope' })).statusCode, 400);
    assert.equal((await h({ body: '[]' })).statusCode, 400);
    assert.equal((await h({ body: JSON.stringify({ ...reg, company: 'x'.repeat(5000) }) })).statusCode, 413);
});

test('register then score round trip', async () => {
    const { deps } = setup();
    const r = await register(deps);
    assert.equal(r.gameToken, 'uuid-1');
    const s = await submit(deps, scoreBody(r.gameToken));
    assert.equal(s.statusCode, 200);
    assert.deepEqual(JSON.parse(s.body), { rank: 1, best: 1200, isBest: true });
});

test('score rejects 10001, quartersPlayed 9, too-fast run, bad name', async () => {
    const { deps } = setup();
    const r = await register(deps);
    const cases = [
        { score: 10001 }, { score: -1 }, { score: 12.5 }, { score: '9' }, { quartersPlayed: 9 }, { quartersPlayed: 0 },
        { mode: 'career' }, { startedAt: T0 - 59_999 }, { startedAt: T0 + MIN }, { startedAt: undefined },
        { playerName: '<script>' }, { playerName: 'a'.repeat(21) }, { company: 'x<y' }, { company: 'c'.repeat(61) }
    ];
    for (const over of cases) {
        const res = await submit(deps, scoreBody(r.gameToken, over));
        assert.equal(res.statusCode, 400, JSON.stringify(over));
    }
    const edge = await submit(deps, scoreBody(r.gameToken, { score: 10000, quartersPlayed: 8, startedAt: T0 - MIN }));
    assert.equal(edge.statusCode, 200);
});

test('score rejects wrong token, unknown player and expired token', async () => {
    const { deps, advance } = setup();
    const r = await register(deps);
    assert.equal((await submit(deps, scoreBody('nope'))).statusCode, 401);
    assert.equal((await submit(deps, scoreBody(r.gameToken, { email: 'who@example.com' }))).statusCode, 401);
    advance(121 * HOUR);
    assert.equal((await submit(deps, scoreBody(r.gameToken, { startedAt: T0 }))).statusCode, 401);
});

test('duplicate gameId is idempotent', async () => {
    const { deps, ddb } = setup();
    const r = await register(deps);
    await submit(deps, scoreBody(r.gameToken));
    const dup = await submit(deps, scoreBody(r.gameToken, { score: 9000 }));
    assert.equal(dup.statusCode, 200);
    assert.deepEqual(JSON.parse(dup.body), { duplicate: true });
    assert.equal(row(ddb, 'P', 'ann@example.com').playCount, 1);
    assert.equal(row(ddb, 'B', 'ev#simple#all', 'ann@example.com').score, 1200);
    assert.equal(row(ddb, 'S', 'g1').score, 1200);
});

test('best board keeps the higher of two scores; one entry per player', async () => {
    const { deps, ddb } = setup();
    const r = await register(deps);
    const bob = await register(deps, { email: 'bob@example.com', playerName: 'Bob' });
    await submit(deps, scoreBody(r.gameToken, { gameId: 'a', score: 3000 }));
    const lower = JSON.parse((await submit(deps, scoreBody(r.gameToken, { gameId: 'b', score: 2000 }))).body);
    assert.deepEqual(lower, { rank: 1, best: 3000, isBest: false });
    const higher = JSON.parse((await submit(deps, scoreBody(r.gameToken, { gameId: 'c', score: 4000 }))).body);
    assert.deepEqual(higher, { rank: 1, best: 4000, isBest: true });
    const bobRes = JSON.parse((await submit(deps, scoreBody(bob.gameToken, {
        email: 'bob@example.com', playerName: 'Bob', gameId: 'd', score: 3500
    }))).body);
    assert.equal(bobRes.rank, 2);
    const rows = [...ddb.tables.B.values()].filter(x => x.board === 'ev#simple#all');
    assert.equal(rows.length, 2);
    assert.equal(rows.find(x => x.email === 'ann@example.com').score, 4000);
    const p = row(ddb, 'P', 'ann@example.com');
    assert.equal(p.playCount, 3);
    assert.deepEqual([...p.playDays], ['2023-11-14']);
});

test('retry after a failed Scores write succeeds (not duplicate) and the board holds the score', async () => {
    const { deps, ddb } = setup();
    const r = await register(deps);
    const realSend = ddb.send;
    let failed = false;
    ddb.send = async cmd => {
        if (!failed && cmd.constructor.name === 'PutCommand' && cmd.input.TableName === 'S') {
            failed = true;
            throw new Error('boom');
        }
        return realSend(cmd);
    };
    await assert.rejects(submit(deps, scoreBody(r.gameToken, { score: 2500 })), /boom/);
    assert.equal(row(ddb, 'B', 'ev#simple#all', 'ann@example.com').score, 2500);
    assert.equal(row(ddb, 'S', 'g1'), undefined);

    const retry = await submit(deps, scoreBody(r.gameToken, { score: 2500 }));
    assert.equal(retry.statusCode, 200);
    const out = JSON.parse(retry.body);
    assert.equal(out.duplicate, undefined);
    assert.deepEqual(out, { rank: 1, best: 2500, isBest: true });
    assert.equal(row(ddb, 'S', 'g1').score, 2500);
    const again = JSON.parse((await submit(deps, scoreBody(r.gameToken, { score: 2500 }))).body);
    assert.deepEqual(again, { duplicate: true });
});

test('modes are separate boards', async () => {
    const { deps } = setup();
    const r = await register(deps);
    await submit(deps, scoreBody(r.gameToken, { gameId: 'a', score: 100 }));
    await submit(deps, scoreBody(r.gameToken, { gameId: 'b', mode: 'pro', score: 900 }));
    const simple = JSON.parse((await createLeaderboard(deps)({ queryStringParameters: { mode: 'simple' } })).body);
    const pro = JSON.parse((await createLeaderboard(deps)({ queryStringParameters: { mode: 'pro' } })).body);
    assert.deepEqual(simple.entries.map(e => e.score), [100]);
    assert.deepEqual(pro.entries.map(e => e.score), [900]);
});

test('leaderboard omits email and is sorted desc', async () => {
    const { deps } = setup();
    const a = await register(deps);
    const b = await register(deps, { email: 'bob@example.com', playerName: 'Bob 👍🏽' });
    await submit(deps, scoreBody(a.gameToken, { score: 500 }));
    await submit(deps, scoreBody(b.gameToken, {
        email: 'bob@example.com', playerName: 'Bob 👍🏽', gameId: 'g2', score: 800, industryId: 'retail'
    }));
    const res = await createLeaderboard(deps)({ queryStringParameters: { mode: 'simple', period: 'event' } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body).entries, [
        { rank: 1, playerName: 'Bob 👍🏽', company: 'Acme', score: 800, industryId: 'retail' },
        { rank: 2, playerName: 'Ann', company: 'Acme', score: 500, industryId: 'airline' }
    ]);
    assert.ok(!res.body.includes('@'));
});

test('leaderboard validates mode and period', async () => {
    const { deps } = setup();
    const h = createLeaderboard(deps);
    assert.equal((await h({ queryStringParameters: { mode: 'x' } })).statusCode, 400);
    assert.equal((await h({ queryStringParameters: { period: 'week' } })).statusCode, 400);
    assert.equal((await h({ queryStringParameters: { limit: '9999' } })).statusCode, 200);
    assert.equal((await h({})).statusCode, 200);
});

test('leaderboard caps limit at 50', async () => {
    const { deps, ddb } = setup();
    for (let i = 0; i < 60; i++) {
        ddb.tables.B.set(`ev#simple#all\u0000p${i}@x.com`, { board: 'ev#simple#all', email: `p${i}@x.com`, score: i, playerName: `P${i}` });
    }
    const res = JSON.parse((await createLeaderboard(deps)({ queryStringParameters: { limit: '9999' } })).body);
    assert.equal(res.entries.length, 50);
    assert.equal(res.entries[0].score, 59);
});

test('today board uses Europe/Dublin date', async () => {
    // 2023-07-01T23:30:00Z is already 2023-07-02 00:30 in Dublin (IST, UTC+1).
    const late = Date.parse('2023-07-01T23:30:00Z');
    const { deps, ddb, advance } = setup(late);
    const r = await register(deps);
    await submit(deps, scoreBody(r.gameToken, { startedAt: late - 5 * MIN, score: 700 }));
    assert.ok(row(ddb, 'B', 'ev#simple#2023-07-02', 'ann@example.com'));
    assert.equal(row(ddb, 'B', 'ev#simple#2023-07-01', 'ann@example.com'), undefined);
    const today = JSON.parse((await createLeaderboard(deps)({ queryStringParameters: { period: 'today' } })).body);
    assert.equal(today.entries.length, 1);
    advance(24 * HOUR);
    const tomorrow = JSON.parse((await createLeaderboard(deps)({ queryStringParameters: { period: 'today' } })).body);
    assert.equal(tomorrow.entries.length, 0);
    const event = JSON.parse((await createLeaderboard(deps)({ queryStringParameters: { period: 'event' } })).body);
    assert.equal(event.entries.length, 1);
});

test('progress PUT merges (union, max) and GET returns it', async () => {
    const { deps } = setup();
    const r = await register(deps);
    const headers = { 'x-player-email': 'Ann@Example.com', 'x-game-token': r.gameToken };
    const h = createProgress(deps);
    assert.deepEqual(JSON.parse((await h({ headers })).body), { progress: null });

    const a = { version: 3, runs: 3, best: { simple: 2000, pro: 0 }, unlocked: ['industry:airline', 'mode:pro'], chairmenMet: ['c1'], crisisBadges: [] };
    const b = { version: 3, runs: 2, best: { simple: 1500, pro: 900 }, unlocked: ['industry:airline', 'industry:pharma'], chairmenMet: ['c2'], crisisBadges: ['gfc2008'] };
    assert.equal((await h({ ...PUT, headers, body: JSON.stringify({ progress: a }) })).statusCode, 200);
    const res = await h({ ...PUT, headers, body: JSON.stringify({ progress: b }) });
    const merged = JSON.parse(res.body).progress;
    assert.deepEqual(merged, {
        version: 3, runs: 3, best: { simple: 2000, pro: 900 },
        unlocked: ['industry:airline', 'mode:pro', 'industry:pharma'], chairmenMet: ['c1', 'c2'], crisisBadges: ['gfc2008']
    });
    assert.deepEqual(JSON.parse((await h({ headers })).body), { progress: merged });
});

test('progress rejects wrong token, missing headers, oversize and malformed bodies', async () => {
    const { deps } = setup();
    const r = await register(deps);
    const h = createProgress(deps);
    const good = { 'x-player-email': 'ann@example.com', 'x-game-token': r.gameToken };
    assert.equal((await h({ headers: { ...good, 'x-game-token': 'bad' } })).statusCode, 401);
    assert.equal((await h({ ...PUT, headers: { ...good, 'x-game-token': 'bad' }, body: '{"progress":{}}' })).statusCode, 401);
    assert.equal((await h({ headers: {} })).statusCode, 401);
    assert.equal((await h({ headers: { ...good, 'x-player-email': 'who@example.com' } })).statusCode, 401);
    assert.equal((await h({ ...PUT, headers: good, body: JSON.stringify({ progress: { unlocked: ['x'.repeat(5000)] } }) })).statusCode, 413);
    assert.equal((await h({ ...PUT, headers: good, body: '{"progress":[]}' })).statusCode, 400);
    assert.equal((await h({ ...PUT, headers: good, body: '{}' })).statusCode, 400);
    assert.equal((await h({ requestContext: { http: { method: 'DELETE' } }, headers: good })).statusCode, 405);
});

test('mergeProgress clamps junk and caps array size', () => {
    const m = mergeProgress({ runs: -4, best: { simple: 99999, pro: 'x' }, unlocked: ['a', 7, 'a'] }, undefined);
    assert.deepEqual(m, { version: 3, runs: 0, best: { simple: 10000, pro: 0 }, unlocked: ['a'], chairmenMet: [], crisisBadges: [] });
    const big = mergeProgress({ unlocked: Array.from({ length: 80 }, (_, i) => `u${i}`) }, {});
    assert.equal(big.unlocked.length, 50);
});

test('admin requires key; analytics counts; csv tolerates non-string values', async () => {
    const { deps, ddb } = setup();
    await register(deps);
    const admin = createAdmin(deps);
    assert.equal((await admin({ headers: {} })).statusCode, 401);
    const ok = await admin({ headers: { 'x-admin-key': 'k' } });
    assert.equal(JSON.parse(ok.body).total, 1);

    ddb.tables.P.set('odd@example.com', { email: 'odd@example.com', playerName: 42, company: null, registeredAt: undefined });
    const csv = await admin({ headers: { 'x-admin-key': 'k' }, queryStringParameters: { format: 'csv' } });
    assert.equal(csv.statusCode, 200);
    assert.ok(csv.body.includes('"42"'));

    const a = createAnalytics(deps);
    assert.equal((await a({ body: '{"event":"play"}', requestContext: { http: { method: 'POST' } } })).statusCode, 204);
    assert.equal((await a({ body: '{"event":"bogus"}' })).statusCode, 400);
    const pub = await a({ requestContext: { http: { method: 'GET' } } });
    assert.deepEqual(JSON.parse(pub.body), { play: 1 });
    const priv = await a({ headers: { 'x-admin-key': 'k' }, requestContext: { http: { method: 'GET' } } });
    assert.deepEqual(JSON.parse(priv.body), { counts: { play: 1 } });
});

test('fake ddb PutCommand honours attribute_not_exists', async () => {
    const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
    const ddb = createFakeDdb({ B: { pk: 'board', sk: 'email' } });
    const put = () => ddb.send(new PutCommand({
        TableName: 'B', Item: { board: 'x', email: 'a', score: 1 }, ConditionExpression: 'attribute_not_exists(board)'
    }));
    await put();
    await assert.rejects(put(), { name: 'ConditionalCheckFailedException' });
});
