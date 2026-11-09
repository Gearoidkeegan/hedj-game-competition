// Free play (Task FP, R66): outside a live event the game runs as a local guest. No registration, no score
// submission, no queue, no /progress; the guest's progress, saved run and guide flag live apart from any
// registered player's on the same device. The event status comes from GET /api/event, then the cached value,
// then free play.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadJson, loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { isRunOver } from '../../js/engine/sim/SimEngine.js';
import * as storage from '../../js/utils/storage.js';
import { fetchEvent } from '../../js/utils/api.js';
import { rejectionText } from '../../js/utils/scoreRejection.js';
import { EventMode, FREE_PLAY, RECHECK_MS, normaliseEvent, practiceLine } from '../../js/utils/eventStatus.js';
import { RunController } from '../../js/screens/simple/RunController.js';

marketEngine.loadFromObjects(loadMarketData());

class FakeStorage {
    constructor() { this.m = new Map(); }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
    setItem(k, v) { this.m.set(k, String(v)); }
    removeItem(k) { this.m.delete(k); }
}

const T0 = 1_700_000_000_000;
const ANN = 'ann@x.com';
const content = {
    industries: loadIndustries(),
    events: loadJson('data/simple-events.json').events,
    quips: loadJson('data/quips.json'),
    powerups: loadJson('data/powerups.json')
};

let backend;
beforeEach(() => {
    backend = new FakeStorage();
    storage.setStorageBackend(backend);
    globalThis.localStorage = new FakeStorage();
    storage.setFreePlay(false);
});
afterEach(() => {
    storage.setFreePlay(false);
    storage.setStorageBackend(null);
    delete globalThis.localStorage;
    delete globalThis.fetch;
});

function fakeApi() {
    const api = {
        submitted: [], puts: [], gets: 0, flushes: 0, plays: 0,
        async submitScore(p) { api.submitted.push(p); return { rank: 3 }; },
        async flushScoreQueue() { api.flushes++; return 0; },
        async getRemoteProgress() { api.gets++; return { best: { simple: 9999 } }; },
        async putRemoteProgress(p) { api.puts.push(p); return p; },
        trackEvent(name) { if (name === 'play') api.plays++; }
    };
    return api;
}
const controller = api => new RunController({ storage, api, market: marketEngine, content, now: () => T0 });
const decide = rc => {
    const d = rc.currentDecisionsDefaults();
    if (rc.run.pendingEvent) d.eventChoice = content.events.find(e => e.id === rc.run.pendingEvent).choices[0].id;
    return d;
};
const playOut = rc => { while (!isRunOver(rc.run)) rc.playQuarter(decide(rc)); };
const registerAnn = () => storage.saveRegistration({ playerName: 'Ann', email: ANN, company: 'Co', gameToken: 't', gameTokenExpiry: T0 * 2 });

// ── Storage: the guest profile ───────────────────────────────────────────

test('the guest key can never be an email, and its rows are apart from every player row', () => {
    assert.ok(!storage.GUEST_PLAYER.includes('@'), 'every registered email contains @');
    storage.saveProgress(storage.GUEST_PLAYER, { ...storage.getProgress(storage.GUEST_PLAYER), runs: 4 });
    storage.saveProgress(ANN, { ...storage.getProgress(ANN), runs: 1 });
    assert.equal(storage.getProgress(storage.GUEST_PLAYER).runs, 4);
    assert.equal(storage.getProgress(ANN).runs, 1);
    assert.equal(storage.getProgress('guest@x.com').runs, 0);
});

test('free play has its own guide flag; the live one is untouched', () => {
    storage.setFreePlay(true);
    assert.equal(storage.hasSeenGuide(), false);
    storage.markGuideSeen();
    assert.equal(storage.hasSeenGuide(), true);
    storage.setFreePlay(false);
    assert.equal(storage.hasSeenGuide(), false, 'a registered player still gets the guide');
    storage.markGuideSeen();
    storage.setFreePlay(true);
    assert.equal(storage.hasSeenGuide(), true);
});

test('the event cache round-trips and ignores junk', () => {
    assert.equal(storage.getCachedEvent(), null);
    storage.saveCachedEvent({ live: true, startIso: null, endIso: '2026-11-20T18:00Z' });
    assert.deepEqual(storage.getCachedEvent(), { live: true, startIso: null, endIso: '2026-11-20T18:00Z' });
    backend.setItem('hedj_v3:_event', '{nope');
    assert.equal(storage.getCachedEvent(), null);
});

// ── api.fetchEvent and the closed-competition copy ──────────────────────

test('fetchEvent: GET /api/event, never cached, with a short timeout signal', async () => {
    let seen;
    globalThis.fetch = async (url, opts) => {
        seen = { url, opts };
        return { ok: true, status: 200, json: async () => ({ live: true, startIso: null, endIso: null }) };
    };
    assert.deepEqual(await fetchEvent(), { live: true, startIso: null, endIso: null });
    assert.equal(seen.url, '/api/event');
    assert.equal(seen.opts.cache, 'no-store');
    assert.ok(seen.opts.signal, 'AbortSignal.timeout');
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    await assert.rejects(fetchEvent(), e => e.status === 503);
});

test('a closed competition reads "Score not accepted: the competition has closed"', () => {
    assert.equal(rejectionText('competition_closed'), 'Score not accepted: the competition has closed');
});

// ── EventMode: fallback order, applying the mode, switching ─────────────

const LIVE = { live: true, startIso: '2026-11-20T09:00:00Z', endIso: '2026-11-21T18:00:00Z' };

test('normaliseEvent keeps only a boolean live flag and valid dates', () => {
    assert.deepEqual(normaliseEvent({ live: true, startIso: 'x', endIso: LIVE.endIso, eventId: 'expo' }),
        { live: true, startIso: null, endIso: LIVE.endIso });
    assert.deepEqual(normaliseEvent({ live: 'yes' }), FREE_PLAY);
    assert.deepEqual(normaliseEvent(null), FREE_PLAY);
});

test('fallback order: the server, then the cached value, then free play', async () => {
    let answer = LIVE;
    const fetchEvent = async () => { if (answer instanceof Error) throw answer; return answer; };
    const em = new EventMode({ fetchEvent, storage, now: () => T0 });

    assert.deepEqual(await em.refresh(), LIVE);
    assert.equal(em.fresh, true);
    assert.deepEqual(storage.getCachedEvent(), LIVE, 'cached for the next visit');

    answer = new Error('offline');
    const offline = new EventMode({ fetchEvent, storage, now: () => T0 });
    assert.deepEqual(await offline.refresh(), LIVE, 'the cached value');
    assert.equal(offline.fresh, false);

    storage.setStorageBackend(new FakeStorage());
    const first = new EventMode({ fetchEvent, storage, now: () => T0 });
    assert.deepEqual(await first.refresh(), FREE_PLAY, 'no cache: free play');
    assert.equal(first.apply(), true);
    assert.equal(storage.isFreePlay(), true);
});

test('free play switches to live after a quiet retry on PLAY; a fresh status is not fetched again', async () => {
    let answer = new Error('offline');
    let calls = 0;
    const em = new EventMode({ fetchEvent: async () => { calls++; if (answer instanceof Error) throw answer; return answer; }, storage, now: () => T0 });
    await em.refresh();
    em.apply();
    assert.equal(storage.isFreePlay(), true);

    answer = LIVE;
    assert.equal(await em.beforePlay(), true, 'the mode changed');
    assert.equal(storage.isFreePlay(), false, 'now live');
    assert.equal(calls, 2);
    assert.equal(await em.beforePlay(), false);
    assert.equal(calls, 2, 'fresh: no second fetch');
});

test('recheck: at most once a minute', async () => {
    let t = T0;
    let answer = LIVE;
    let calls = 0;
    const em = new EventMode({ fetchEvent: async () => { calls++; return answer; }, storage, now: () => t });
    await em.refresh();
    answer = { ...LIVE, live: false };
    t += RECHECK_MS - 1;
    assert.equal(await em.recheck(), false);
    assert.equal(calls, 1);
    t += 1;
    assert.equal(await em.recheck(), true, 'live -> closed');
    assert.equal(calls, 2);
    assert.equal(em.event.live, false);
    assert.equal(storage.isFreePlay(), false, 'recheck does not switch the mode by itself (a run may be under way)');
});

test('practiceLine: the next start date when one is ahead, the stand otherwise; never over 90 characters', () => {
    const ahead = practiceLine({ live: false, startIso: '2026-11-20T09:00:00Z', endIso: null }, Date.parse('2026-11-01T00:00:00Z'));
    assert.equal(ahead, 'Practice mode. Next competition: 20 November 2026');
    const past = practiceLine({ live: false, startIso: '2026-11-20T09:00:00Z', endIso: null }, Date.parse('2026-12-01T00:00:00Z'));
    assert.equal(past, 'Practice mode. Play for prizes at the Hedj stand');
    assert.equal(practiceLine(undefined, T0), past);
    for (const s of [ahead, past]) assert.ok(s.length <= 90);
});

// ── RunController in free play ───────────────────────────────────────────

test('free play: a run belongs to the guest, never submits, never queues, never syncs', async () => {
    storage.setFreePlay(true);
    const api = fakeApi();
    const rc = controller(api);
    rc.start('airline', { seed: 3 });
    assert.equal(api.plays, 1, 'anonymous analytics still counts the play');
    assert.equal(rc.email, storage.GUEST_PLAYER);
    playOut(rc);
    const o = await rc.finish();
    await new Promise(r => setImmediate(r));
    assert.equal(o.practice, true);
    assert.equal(o.ranked, false);
    assert.equal(o.queued, false);
    assert.equal(o.rank, null);
    assert.ok(o.score > 0);
    assert.deepEqual(api.submitted, []);
    assert.deepEqual(api.puts, []);
    assert.equal(api.flushes, 0);
    assert.deepEqual(storage.getQueuedScores(), []);
    assert.equal(storage.getProgress(storage.GUEST_PLAYER).best.simple, o.score);
    assert.equal(o.isPersonalBest, true);
    assert.deepEqual(await rc.syncProgress(), rc.progress());
    assert.equal(api.gets, 0, 'no /progress call');
});

test('free play: the guest saved run resumes, and stays apart from a registered player on the same device', () => {
    registerAnn();
    const rc = controller(fakeApi());
    const annRun = rc.start('retail', { seed: 3 });   // live: Ann's run

    storage.setFreePlay(true);
    rc.reset();
    assert.equal(rc.resume(), null, "the guest never sees Ann's RESUME");
    const guestRun = rc.start('airline', { seed: 5 });
    rc.playQuarter(decide(rc));
    rc.reset();   // a page reload
    const resumed = rc.resume();
    assert.equal(resumed.gameId, guestRun.gameId);
    assert.equal(resumed.quarter, 1);

    storage.setFreePlay(false);
    rc.reset();
    assert.equal(rc.resume().gameId, annRun.gameId, "Ann's run is still hers");
    assert.equal(storage.getProgress(ANN).runs, 0);
});

test('live mode is unchanged: the registered player submits and queues as before', async () => {
    registerAnn();
    const api = fakeApi();
    const rc = controller(api);
    rc.start('airline', { seed: 3 });
    assert.equal(rc.email, ANN);
    playOut(rc);
    const o = await rc.finish();
    assert.equal(o.practice, undefined);
    assert.equal(o.ranked, true);
    assert.equal(o.rank, 3);
    assert.equal(api.submitted.length, 1);
    assert.equal(api.submitted[0].email, ANN);
});
