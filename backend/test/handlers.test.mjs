import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDdb } from './fakeDdb.mjs';
import { createHandler as createRegister } from '../handlers/register.mjs';
import { createHandler as createScore } from '../handlers/score.mjs';
import { createHandler as createLeaderboard } from '../handlers/leaderboard.mjs';
import { createHandler as createAdmin } from '../handlers/admin.mjs';
import { createHandler as createAnalytics } from '../handlers/analytics.mjs';

function setup() {
    const ddb = createFakeDdb({
        P: { pk: 'email' },
        S: { pk: 'scoreId', indexes: { GlobalLeaderboard: { pk: 'leaderboard', sk: 'score' } } },
        A: { pk: 'metricName' }
    });
    let t = 1_700_000_000_000;
    let n = 0;
    const deps = {
        ddb,
        env: { PLAYERS_TABLE: 'P', SCORES_TABLE: 'S', ANALYTICS_TABLE: 'A', ADMIN_KEY: 'k' },
        now: () => t,
        uuid: () => `uuid-${++n}`
    };
    return { deps, advance: ms => { t += ms; } };
}

const post = body => ({ body: JSON.stringify(body) });
const reg = { playerName: 'Ann', email: 'Ann@Example.com', company: 'Acme', consentGiven: true };

test('register then score round trip, leaderboard hides email', async () => {
    const { deps } = setup();
    const r = JSON.parse((await createRegister(deps)(post(reg))).body);
    assert.equal(r.gameToken, 'uuid-1');
    const s = await createScore(deps)(post({ gameToken: r.gameToken, gameId: 'g1', email: 'ann@example.com', score: 55.55, quartersPlayed: 8 }));
    assert.equal(s.statusCode, 200);
    assert.equal(JSON.parse(s.body).rank, 1);
    const dup = await createScore(deps)(post({ gameToken: r.gameToken, gameId: 'g1', email: 'ann@example.com', score: 55.55, quartersPlayed: 8 }));
    assert.equal(JSON.parse(dup.body).duplicate, true);
    const lb = JSON.parse((await createLeaderboard(deps)({})).body);
    assert.equal(lb.total, 1);
    assert.equal(lb.entries[0].score, 55.6);
    assert.ok(!('email' in lb.entries[0]));
});

test('score rejects wrong token and expired token', async () => {
    const { deps, advance } = setup();
    const r = JSON.parse((await createRegister(deps)(post(reg))).body);
    const bad = await createScore(deps)(post({ gameToken: 'x', gameId: 'g', email: reg.email, score: 10, quartersPlayed: 8 }));
    assert.equal(bad.statusCode, 401);
    advance(5 * 60 * 60 * 1000);
    const expired = await createScore(deps)(post({ gameToken: r.gameToken, gameId: 'g', email: reg.email, score: 10, quartersPlayed: 8 }));
    assert.equal(expired.statusCode, 401);
});

test('register validates input and rejects oversized or malformed bodies', async () => {
    const { deps } = setup();
    const h = createRegister(deps);
    assert.equal((await h(post({ ...reg, consentGiven: false }))).statusCode, 400);
    assert.equal((await h({ body: '{nope' })).statusCode, 400);
    assert.equal((await h({ body: JSON.stringify({ ...reg, company: 'x'.repeat(5000) }) })).statusCode, 413);
});

test('admin requires key; analytics counts', async () => {
    const { deps } = setup();
    await createRegister(deps)(post(reg));
    const admin = createAdmin(deps);
    assert.equal((await admin({ headers: {} })).statusCode, 401);
    const ok = await admin({ headers: { 'x-admin-key': 'k' } });
    assert.equal(JSON.parse(ok.body).total, 1);

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
