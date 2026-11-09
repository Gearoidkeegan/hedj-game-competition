// Free play (Task FP, R66): the competition is live only while EventId is set and now is inside
// [EventStartIso, EventEndIso). Outside it, register, progress and score are closed (403 competition_closed),
// except the 2-hour score grace for runs started before the end; the leaderboard shows the last event's board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDdb } from './fakeDdb.mjs';
import { isLive, eventStatus, inScoreGrace, SCORE_GRACE_MS } from '../lib/event.mjs';
import { createHandler as createEvent } from '../handlers/event.mjs';
import { createHandler as createRegister } from '../handlers/register.mjs';
import { createHandler as createScore } from '../handlers/score.mjs';
import { createHandler as createLeaderboard } from '../handlers/leaderboard.mjs';
import { createHandler as createProgress } from '../handlers/progress.mjs';
import { createHandler as createAdmin } from '../handlers/admin.mjs';
import { createHandler as createAnalytics } from '../handlers/analytics.mjs';

const START = '2026-11-20T09:00:00Z';
const END = '2026-11-21T18:00:00Z';
const START_MS = Date.parse(START);
const END_MS = Date.parse(END);
const MIN = 60_000;
const HOUR = 3_600_000;

const env = over => ({ EVENT_ID: 'expo', EVENT_START_ISO: START, EVENT_END_ISO: END, ...over });

test('live only with an event id, from the start (inclusive) to the end (exclusive)', () => {
    const e = env();
    assert.equal(isLive(e, START_MS - 1), false, 'a millisecond before the start');
    assert.equal(isLive(e, START_MS), true, 'at the start');
    assert.equal(isLive(e, END_MS - 1), true, 'a millisecond before the end');
    assert.equal(isLive(e, END_MS), false, 'at the end');
    assert.equal(isLive(env({ EVENT_ID: '' }), START_MS + HOUR), false, 'empty id: never live');
    assert.equal(isLive(env({ EVENT_ID: undefined }), START_MS + HOUR), false, 'missing id: never live');
});

test('no start date: live until the end; no end date: live from the start; neither: live while the id is set', () => {
    assert.equal(isLive(env({ EVENT_START_ISO: '' }), 0), true);
    assert.equal(isLive(env({ EVENT_START_ISO: '' }), END_MS), false);
    assert.equal(isLive(env({ EVENT_END_ISO: '' }), START_MS - 1), false);
    assert.equal(isLive(env({ EVENT_END_ISO: '' }), END_MS * 2), true);
    assert.equal(isLive(env({ EVENT_START_ISO: '', EVENT_END_ISO: '' }), 0), true);
    assert.equal(isLive({ EVENT_ID: 'test' }, 0), true, 'the B2 dry run: an id and no dates');
});

test('eventStatus is { live, startIso, endIso } and never carries the event id', () => {
    assert.deepEqual(eventStatus(env(), START_MS), { live: true, startIso: START, endIso: END });
    assert.deepEqual(eventStatus(env({ EVENT_START_ISO: '', EVENT_END_ISO: undefined }), 0), { live: true, startIso: null, endIso: null });
    assert.deepEqual(eventStatus(env({ EVENT_ID: '' }), START_MS), { live: false, startIso: START, endIso: END });
    assert.ok(!JSON.stringify(eventStatus(env(), START_MS)).includes('expo'));
});

test('score grace: a run started before the end is accepted for 2 h after it, never longer', () => {
    const e = env();
    const before = END_MS - 10 * MIN;
    assert.equal(SCORE_GRACE_MS, 2 * HOUR);
    assert.equal(inScoreGrace(e, END_MS + HOUR + 59 * MIN, before), true, 'end + 1 h 59 m');
    assert.equal(inScoreGrace(e, END_MS + 2 * HOUR, before), false, 'end + 2 h');
    assert.equal(inScoreGrace(e, END_MS + 30 * MIN, END_MS), false, 'started at the end');
    assert.equal(inScoreGrace(e, END_MS + 30 * MIN, END_MS + MIN), false, 'started after the end');
    assert.equal(inScoreGrace(env({ EVENT_ID: '' }), END_MS + MIN, before), false, 'no event, no grace');
    assert.equal(inScoreGrace(env({ EVENT_END_ISO: '' }), END_MS + MIN, before), false, 'no end, no grace');
    assert.equal(inScoreGrace(e, START_MS - HOUR, START_MS - 2 * HOUR), false, 'before the event is not a grace');
    assert.equal(inScoreGrace(e, END_MS + MIN, 'x'), false);
});

// ── Handlers ─────────────────────────────────────────────────────────────

function setup(nowMs, over = {}) {
    const ddb = createFakeDdb({
        P: { pk: 'email' },
        S: { pk: 'scoreId' },
        B: { pk: 'board', sk: 'email', indexes: { ByScore: { pk: 'board', sk: 'score' } } },
        A: { pk: 'metricName' }
    });
    let t = nowMs;
    let n = 0;
    const deps = {
        ddb,
        env: { PLAYERS_TABLE: 'P', SCORES_TABLE: 'S', BEST_TABLE: 'B', ANALYTICS_TABLE: 'A', ADMIN_KEY: 'k', TOKEN_TTL_HOURS: '120', ...env(over) },
        now: () => t,
        uuid: () => `uuid-${++n}`
    };
    return { deps, ddb, set: ms => { t = ms; } };
}

const post = body => ({ body: JSON.stringify(body) });
const reg = { playerName: 'Ann', email: 'ann@example.com', company: 'Acme', consentGiven: true };
const register = async deps => JSON.parse((await createRegister(deps)(post(reg))).body);
const scoreBody = (token, over = {}) => ({
    gameToken: token, email: 'ann@example.com', gameId: 'g1', mode: 'simple', score: 1200, quartersPlayed: 8,
    startedAt: END_MS - 10 * MIN, industryId: 'airline', playerName: 'Ann', company: 'Acme', ...over
});
const closed = res => {
    assert.equal(res.statusCode, 403);
    assert.deepEqual(JSON.parse(res.body), { error: 'competition_closed' });
};

test('GET /event: the status, no-store, and no table read', async () => {
    const { deps, ddb } = setup(START_MS);
    let reads = 0;
    ddb.send = async () => { reads++; return {}; };
    const res = await createEvent(deps)({});
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.deepEqual(JSON.parse(res.body), { live: true, startIso: START, endIso: END });
    assert.ok(res.body.length < 120, 'small');
    assert.equal(reads, 0);
    const { deps: before } = setup(START_MS - 1);
    assert.equal(JSON.parse((await createEvent(before)({})).body).live, false);
    const { deps: none } = setup(START_MS, { EVENT_ID: '', EVENT_START_ISO: '', EVENT_END_ISO: '' });
    assert.deepEqual(JSON.parse((await createEvent(none)({})).body), { live: false, startIso: null, endIso: null });
});

test('not live: register and progress GET/PUT return 403 competition_closed and write nothing', async () => {
    for (const nowMs of [START_MS - MIN, END_MS]) {
        const { deps, ddb } = setup(nowMs);
        closed(await createRegister(deps)(post(reg)));
        const headers = { 'x-player-email': 'ann@example.com', 'x-game-token': 't' };
        closed(await createProgress(deps)({ headers }));
        closed(await createProgress(deps)({ requestContext: { http: { method: 'PUT' } }, headers, body: '{"progress":{}}' }));
        assert.equal(ddb.tables.P.size, 0);
    }
});

test('not live: a score is refused unless it is inside the 2-hour grace', async () => {
    const { deps, ddb, set } = setup(END_MS - HOUR);
    const r = await register(deps);
    set(END_MS + HOUR + 59 * MIN);
    const ok = await createScore(deps)(post(scoreBody(r.gameToken)));
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(JSON.parse(ok.body).rank, 1);
    assert.ok(ddb.tables.B.get('expo#simple#all\u0000ann@example.com'));

    set(END_MS + 2 * HOUR);
    closed(await createScore(deps)(post(scoreBody(r.gameToken, { gameId: 'g2' }))));
    set(END_MS + 30 * MIN);
    closed(await createScore(deps)(post(scoreBody(r.gameToken, { gameId: 'g3', startedAt: END_MS + MIN }))));
    closed(await createScore(deps)(post(scoreBody(r.gameToken, { gameId: 'g4', startedAt: undefined }))));
    assert.equal(ddb.tables.S.size, 1);
});

test('before the start, a score is refused', async () => {
    const { deps } = setup(START_MS - MIN);
    closed(await createScore(deps)(post(scoreBody('t', { startedAt: START_MS - 10 * MIN }))));
});

test('an empty EventId: everything closed, an empty leaderboard, no row written under an empty event', async () => {
    const { deps, ddb } = setup(START_MS + HOUR, { EVENT_ID: '' });
    ddb.tables.P.set('ann@example.com', {
        email: 'ann@example.com', playerName: 'Ann', company: 'Acme', gameTokens: [{ token: 't', expiry: END_MS * 2 }]
    });
    closed(await createRegister(deps)(post(reg)));
    closed(await createScore(deps)(post(scoreBody('t', { startedAt: START_MS }))));
    closed(await createProgress(deps)({ headers: { 'x-player-email': 'ann@example.com', 'x-game-token': 't' } }));
    ddb.tables.B.set('#simple#all\u0000x@y.z', { board: '#simple#all', email: 'x@y.z', score: 5, playerName: 'X' });
    ddb.tables.B.set('test#simple#all\u0000x@y.z', { board: 'test#simple#all', email: 'x@y.z', score: 5, playerName: 'X' });
    const lb = await createLeaderboard(deps)({ queryStringParameters: { mode: 'simple', period: 'event' } });
    assert.equal(lb.statusCode, 200);
    assert.deepEqual(JSON.parse(lb.body), { entries: [] });
    assert.equal(ddb.tables.S.size, 0);
    // Only the two rows seeded above: nothing was written under an empty event ('#simple#all') or 'test'.
    assert.deepEqual([...ddb.tables.B.keys()].sort(), ['#simple#all\u0000x@y.z', 'test#simple#all\u0000x@y.z']);
});

test('after the end, the leaderboard still shows the last event board', async () => {
    const { deps, ddb } = setup(END_MS + 10 * 24 * HOUR);
    ddb.tables.B.set('expo#simple#all\u0000a@x.com', { board: 'expo#simple#all', email: 'a@x.com', score: 900, playerName: 'Ann' });
    const res = JSON.parse((await createLeaderboard(deps)({ queryStringParameters: { mode: 'simple', period: 'event' } })).body);
    assert.deepEqual(res.entries.map(e => [e.playerName, e.score]), [['Ann', 900]]);
});

test('free play keeps anonymous analytics and the admin endpoints working', async () => {
    const { deps, ddb } = setup(END_MS + HOUR);
    const a = createAnalytics(deps);
    assert.equal((await a({ body: '{"event":"play"}', requestContext: { http: { method: 'POST' } } })).statusCode, 204);
    assert.equal(ddb.tables.A.get('play').count, 1);
    const admin = createAdmin(deps);
    const key = { 'x-admin-key': 'k' };
    assert.equal((await admin({ rawPath: '/admin/players', headers: key })).statusCode, 200);
    assert.equal((await admin({ rawPath: '/admin/metrics', headers: key })).statusCode, 200);
    assert.equal((await admin({ rawPath: '/admin/prize', headers: key })).statusCode, 200);
});

test('admin with no event: the prize export is a header-only CSV, not an error', async () => {
    const { deps, ddb } = setup(START_MS, { EVENT_ID: '' });
    ddb.tables.B.set('test#simple#all\u0000x@y.z', { board: 'test#simple#all', email: 'x@y.z', score: 5, playerName: 'X' });
    const res = await createAdmin(deps)({ rawPath: '/admin/prize', headers: { 'x-admin-key': 'k' } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'rank,playerName,company,email,score,marketingConsent');
});
