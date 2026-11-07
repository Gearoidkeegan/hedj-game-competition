import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDdb } from './fakeDdb.mjs';
import { createHandler as createAdmin } from '../handlers/admin.mjs';

const T0 = 1_700_000_000_000;
const KEY = { 'x-admin-key': 'k' };

function setup() {
    const ddb = createFakeDdb({
        P: { pk: 'email' },
        B: { pk: 'board', sk: 'email', indexes: { ByScore: { pk: 'board', sk: 'score' } } }
    });
    const deps = { ddb, env: { PLAYERS_TABLE: 'P', BEST_TABLE: 'B', ADMIN_KEY: 'k', EVENT_ID: 'ev' }, now: () => T0 };
    return { ddb, admin: createAdmin(deps) };
}
const get = (admin, rawPath, qs = {}, headers = KEY) =>
    admin({ rawPath, headers, queryStringParameters: qs });

test('metrics require admin key', async () => {
    const { admin } = setup();
    assert.equal((await get(admin, '/admin/metrics', {}, {})).statusCode, 401);
    assert.equal((await get(admin, '/admin/metrics', {}, { 'x-admin-key': 'nope' })).statusCode, 401);
    assert.equal((await get(admin, '/admin/metrics')).statusCode, 200);
});

test('returnRate computed from playCount', async () => {
    const { ddb, admin } = setup();
    const put = (email, playCount, days) =>
        ddb.tables.P.set(email, { email, playCount, playDays: days && new Set(days) });
    put('a@x.com', 3, ['2023-11-14', '2023-11-15']);
    put('b@x.com', 1, ['2023-11-14']);
    put('c@x.com', 2, ['2023-11-14']);
    put('d@x.com', 0);                       // registered, never played
    put('e@x.com', undefined);               // legacy row without counters
    const res = await get(admin, '/admin/metrics');
    const m = JSON.parse(res.body);
    assert.equal(m.players, 5);
    assert.equal(m.plays, 6);
    assert.equal(m.uniquePlayers, 3);
    assert.equal(m.runsPerPlayer, 2);        // 6 plays / 3 players who played
    assert.equal(m.returnRate, 2 / 3);       // playCount >= 2 among players who played
    assert.equal(m.multiDayRate, 1 / 3);
    assert.deepEqual(m.playsByDay, { '2023-11-14': 3, '2023-11-15': 1 });
});

test('metrics with no players are zeroed, not NaN', async () => {
    const { admin } = setup();
    const m = JSON.parse((await get(admin, '/admin/metrics')).body);
    assert.deepEqual(m, { players: 0, plays: 0, uniquePlayers: 0, runsPerPlayer: 0, returnRate: 0, multiDayRate: 0, playsByDay: {} });
});

test('prize CSV escapes commas/quotes and is admin-only', async () => {
    const { ddb, admin } = setup();
    const best = (email, score, playerName, company) =>
        ddb.tables.B.set(`ev#simple#all\u0000${email}`, { board: 'ev#simple#all', email, score, playerName, company });
    best('a@x.com', 900, 'Ann, "The Boss"', 'Acme, Ltd');
    best('b@x.com', 1500, '=HYPERLINK("x")', 'Beta');
    best('c@x.com', 100, 'Cy', 'Gamma');
    ddb.tables.P.set('a@x.com', { email: 'a@x.com', marketingConsent: true });
    ddb.tables.P.set('b@x.com', { email: 'b@x.com', marketingConsent: false });

    assert.equal((await get(admin, '/admin/prize', {}, {})).statusCode, 401);

    const res = await get(admin, '/admin/prize', { mode: 'simple', period: 'event', limit: '2' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['Content-Type'], /text\/csv/);
    const lines = res.body.split('\r\n');
    assert.equal(lines[0], 'rank,playerName,company,email,score,marketingConsent');
    assert.equal(lines.length, 3);
    assert.equal(lines[1], `"1","'=HYPERLINK(""x"")","Beta","b@x.com","1500","No"`);
    assert.equal(lines[2], `"2","Ann, ""The Boss""","Acme, Ltd","a@x.com","900","Yes"`);
});

test('prize rejects bad mode or period, and a missing player row means no consent', async () => {
    const { ddb, admin } = setup();
    assert.equal((await get(admin, '/admin/prize', { mode: 'x' })).statusCode, 400);
    assert.equal((await get(admin, '/admin/prize', { period: 'week' })).statusCode, 400);
    ddb.tables.B.set('ev#pro#all\u0000z@x.com', { board: 'ev#pro#all', email: 'z@x.com', score: 5, playerName: 'Zed', company: 'Z' });
    const res = await get(admin, '/admin/prize', { mode: 'pro' });
    assert.ok(res.body.endsWith('"No"'));
});

test('players route still works when rawPath is absent or /admin/players', async () => {
    const { ddb, admin } = setup();
    ddb.tables.P.set('a@x.com', { email: 'a@x.com', playerName: 'Ann', registeredAt: 'x' });
    assert.equal(JSON.parse((await admin({ headers: KEY })).body).total, 1);
    assert.equal(JSON.parse((await get(admin, '/admin/players')).body).total, 1);
    assert.equal((await get(admin, '/admin/nope')).statusCode, 404);
});
