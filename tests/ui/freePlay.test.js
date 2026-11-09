// Free play screens (Task FP, R66): the title, the PLAY gate, game over (Simple and Pro) and registration when the
// competition is not live. Live mode is covered, unchanged, by titleIndustry and gameOverScreen tests.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, createFakeDocument } from '../helpers/fakeDom.js';
import { loadJson, loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { isRunOver } from '../../js/engine/sim/SimEngine.js';
import { gameState } from '../../js/engine/GameState.js';
import { scorePro } from '../../js/engine/sim/proAdapter.js';
import * as storage from '../../js/utils/storage.js';
import { EventMode, needsRegistration } from '../../js/utils/eventStatus.js';
import { RunController } from '../../js/screens/simple/RunController.js';
import { TitleScreen } from '../../js/screens/TitleScreen.js';
import { GameOverScreen } from '../../js/screens/GameOverScreen.js';
import { RegistrationScreen } from '../../js/screens/RegistrationScreen.js';
import { TAP_GUARD_MS } from '../../js/ui/tapGuard.js';

marketEngine.loadFromObjects(loadMarketData());

class FakeStorage {
    constructor() { this.m = new Map(); }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
    setItem(k, v) { this.m.set(k, String(v)); }
    removeItem(k) { this.m.delete(k); }
}

const content = {
    industries: loadIndustries(),
    events: loadJson('data/simple-events.json').events,
    quips: loadJson('data/quips.json'),
    powerups: loadJson('data/powerups.json')
};
const ANN = { playerName: 'Ann', email: 'ann@x.com', company: 'Acme' };
const register = p => storage.saveRegistration({ ...p, gameToken: 't', gameTokenExpiry: Date.now() + 1e9 });
const settle = () => new Promise(r => setTimeout(r, 0));
const STAND_LINE = 'Practice mode. Play for prizes at the Hedj stand';

let dom;
beforeEach(() => {
    dom = installFakeDom();
    globalThis.localStorage = new FakeStorage();
    storage.setStorageBackend(new FakeStorage());
    storage.setFreePlay(true);
    gameState.reset();
});
afterEach(() => {
    storage.setFreePlay(false);
    storage.setStorageBackend(null);
    delete globalThis.localStorage;
    gameState.reset();
    dom.restore();
});

function fakeApi({ entries = [] } = {}) {
    return {
        calls: [], board: [], gets: 0, puts: [],
        async fetchLeaderboard(opts) { this.board.push(opts); return entries; },
        async getRemoteProgress() { this.gets++; return null; },
        async submitScore(p) { this.calls.push(p); return { rank: 1 }; },
        async flushScoreQueue() { return 0; },
        async putRemoteProgress(p) { this.puts.push(p); return p; }
    };
}

function makeApp(extra = {}) {
    const rc = new RunController({ storage, market: marketEngine, content, now: () => Date.now() });
    return {
        runController: rc, content, marketReady: Promise.resolve(), shown: [], toasts: [],
        event: { live: false, startIso: null, endIso: null },
        screens: { howtoplay: { fromAutoShow: false, returnScreen: 'title' } },
        showScreen(id) { this.shown.push(id); },
        showToast(msg, type) { this.toasts.push([msg, type]); },
        ...extra
    };
}

function mountTitle(app, api = fakeApi()) {
    const screen = new TitleScreen(app, { api });
    const el = screen.render();
    dom.document.body.replaceChildren(el);
    screen.mount();
    return { screen, el, q: s => el.querySelector(s), qa: s => el.querySelectorAll(s) };
}

// ── Title ────────────────────────────────────────────────────────────────

test('title in free play: PRACTICE MODE and the line; no rank, no top 3, no "Not you?", no sync', async () => {
    register(ANN);   // a registration left on the device changes nothing in free play
    const api = fakeApi();
    const app = makeApp({ event: { live: false, startIso: '2999-03-01T09:00:00Z', endIso: null } });
    const t = mountTitle(app, api);
    assert.equal(t.q('.t-practice-tag').textContent, 'PRACTICE MODE');
    assert.equal(t.q('.t-practice-line').textContent, 'Practice mode. Next competition: 1 March 2999');
    assert.equal(t.q('.t-notyou'), null);
    assert.equal(t.q('.t-player'), null);
    assert.equal(t.q('.t-top'), null, 'no top-3 teaser');
    assert.equal(t.q('[data-stat="rank"]'), null, 'no conference rank');
    assert.ok(t.q('[data-stat="best"]'), 'the guest personal best');
    await settle();
    assert.equal(api.gets, 0, 'no /progress call');
    assert.deepEqual(api.board, [{ mode: 'simple', period: 'event', limit: 1 }]);
    assert.equal(t.q('.t-lb').hidden, true, 'no last board, no button');
    t.screen.unmount();
});

test("title in free play: the last event's leaderboard button appears only when that board has entries", async () => {
    const api = fakeApi({ entries: [{ rank: 1, playerName: 'Zed <b>', company: 'Z', score: 4200 }] });
    const t = mountTitle(makeApp(), api);
    assert.equal(t.q('.t-practice-line').textContent, STAND_LINE);
    await settle();
    const btn = t.q('.t-lb');
    assert.equal(btn.hidden, false);
    assert.equal(btn.textContent, "Last event's leaderboard");
    await t.screen.showLeaderboard();
    const modal = dom.document.body.querySelector('.v3-modal');
    assert.equal(modal.querySelector('h2').textContent, "Last event's leaderboard");
    assert.ok(modal.textContent.includes('Zed <b>'), 'shown as text');
    assert.deepEqual(api.board.at(-1), { mode: 'simple', period: 'event', limit: 20 });
    t.screen.unmount();
});

test('free play: PLAY goes straight to the industries, never to registration', async () => {
    const app = makeApp();
    storage.markGuideSeen();   // the guest's own guide flag
    const t = mountTitle(app);
    t.q('.t-play').click();
    assert.deepEqual(app.shown, ['industry']);
    assert.equal(needsRegistration('industry', storage, Date.now()), false);
    assert.equal(needsRegistration('setup', storage, Date.now()), false);
    storage.setFreePlay(false);
    assert.equal(needsRegistration('industry', storage, Date.now()), true, 'live: the gate is unchanged');
    register(ANN);
    assert.equal(needsRegistration('industry', storage, Date.now()), false);
    t.screen.unmount();
});

test('free play: the first PLAY shows the guide, then the industries', () => {
    const app = makeApp();
    const t = mountTitle(app);
    t.q('.t-play').click();
    assert.deepEqual(app.shown, ['howtoplay']);
    assert.equal(app.screens.howtoplay.returnScreen, 'industry');
    t.screen.unmount();
});

test('free play: the guest RESUME survives a reload and never shows for a registered player', () => {
    const app = makeApp();
    app.runController.start('airline', { seed: 3 });
    app.runController.reset();
    let t = mountTitle(app);
    assert.match(t.q('.t-resume').textContent, /SkyBridge Airlines, quarter 1 of 8/);
    t.screen.unmount();

    storage.setFreePlay(false);
    register(ANN);
    t = mountTitle(app);
    assert.equal(t.q('.t-resume'), null);
    assert.equal(t.q('.t-player-name').textContent, 'Ann', 'live title as before');
    t.screen.unmount();
});

test('a failed event check is retried on PLAY, and a live event switches to live mode (the gate then registers)', async () => {
    let answer = new Error('offline');
    const eventMode = new EventMode({ fetchEvent: async () => { if (answer instanceof Error) throw answer; return answer; }, storage });
    await eventMode.refresh();
    eventMode.apply();
    const app = makeApp({ eventMode, get event() { return eventMode.event; } });
    storage.markGuideSeen();
    globalThis.localStorage.setItem('hedj_has_seen_guide', '1');
    const t = mountTitle(app);
    answer = { live: true, startIso: null, endIso: null };
    t.q('.t-play').click();
    assert.deepEqual(app.shown, [], 'waits for the quiet retry');
    await settle();
    await settle();
    assert.equal(storage.isFreePlay(), false);
    assert.deepEqual(app.shown, ['industry']);
    assert.equal(needsRegistration('industry', storage, Date.now()), true, 'main.js sends the player to register');
    t.screen.unmount();
});

// ── Game over ────────────────────────────────────────────────────────────

function mountGameOver(app, api) {
    const clock = { t: 0 };
    const screen = new GameOverScreen(app, {
        playCutscene: async () => {}, sound: { gameOver() {}, fired() {} },
        fetch: async () => ({ json: async () => ({ yearFacts: {} }) }),
        api, storage, env: { matchMedia: () => ({ matches: true }), now: () => clock.t }
    });
    const el = screen.render();
    dom.document.body.appendChild(el);
    screen.mount();
    clock.t += TAP_GUARD_MS;
    return { screen, el, q: s => el.querySelector(s) };
}

test('game over in free play: score, title and personal best; a practice line, no submission, no queue', async () => {
    const api = fakeApi();
    const rc = new RunController({ storage, api, market: marketEngine, content, now: () => Date.now() });
    const app = makeApp({ runController: rc, gameOverMode: 'simple',
        event: { live: false, startIso: '2999-03-01T09:00:00Z', endIso: null } });
    rc.start('airline', { seed: 3 });
    while (!isRunOver(rc.run)) {
        const d = rc.currentDecisionsDefaults();
        if (rc.run.pendingEvent) d.eventChoice = content.events.find(e => e.id === rc.run.pendingEvent).choices[0].id;
        rc.playQuarter(d);
    }
    const g = mountGameOver(app, api);
    await settle();
    await settle();
    assert.equal(g.q('.go-rank').textContent, 'Practice mode. Next competition: 1 March 2999');
    assert.ok(g.q('.go-rank').textContent.length <= 90);
    assert.equal(g.q('.go-pb').hidden, false, 'NEW PERSONAL BEST');
    assert.ok(g.q('.go-title').textContent.length > 0);
    assert.ok(g.q('.go-again') && g.q('.go-share'));
    assert.deepEqual(api.calls, []);
    assert.deepEqual(api.puts, []);
    assert.deepEqual(storage.getQueuedScores(), []);

    g.q('.go-again').click();   // PLAY AGAIN: a new guest run at once, no registration
    await settle();
    assert.deepEqual(app.shown, ['quarter']);
    assert.equal(rc.email, storage.GUEST_PLAYER);
});

test('Pro in free play: guest progress, no submission, the practice line', async () => {
    const summary = {
        q: 1, policy: 'in', inMandate: true, playerDelta: 1e6, benchmarkDelta: 1e6, marketResult: 1e6, breach: 'none',
        severe: false, cashAfter: 101e6, benchmarkCashAfter: 101e6, redLine: 20e6, boardMoodAfter: 8, lines: [],
        event: null, powerUp: null
    };
    gameState.update({
        gameId: 'game_7', seed: 7, startedAt: 1_700_000_000_000, industryId: 'pharma', contactEmail: storage.GUEST_PLAYER,
        industry: content.industries.find(i => i.id === 'pharma'), startYear: 2008, startingCash: 100e6,
        boardSatisfaction: 8, quarterSummaries: [summary], runStatus: 'complete'
    });
    gameState.update({ proResult: { mode: 'pro', status: 'complete', score: scorePro(gameState.get()), history: [summary] } });
    const api = fakeApi();
    const g = mountGameOver(makeApp({ gameOverMode: 'pro' }), api);
    await settle();
    await settle();
    assert.equal(g.q('.go-rank').textContent, STAND_LINE);
    assert.deepEqual(api.calls, []);
    assert.deepEqual(api.puts, []);
    assert.deepEqual(storage.getQueuedScores(), []);
    assert.equal(storage.getProgress(storage.GUEST_PLAYER).best.pro, gameState.get().proResult.score.total);
});

// ── Registration ─────────────────────────────────────────────────────────

test('registration refused because the competition has closed: say so and go back to the title', async () => {
    storage.setFreePlay(false);
    const doc = createFakeDocument();
    const el = doc.createElement('div');
    for (const [tag, id] of [['input', 'reg-name'], ['div', 'reg-name-error'], ['input', 'reg-email'], ['input', 'reg-company'],
        ['input', 'reg-consent'], ['input', 'reg-marketing'], ['div', 'reg-error'], ['button', 'reg-submit'], ['button', 'reg-switch']]) {
        const e = doc.createElement(tag);
        e.id = id;
        el.appendChild(e);
    }
    let refreshed = 0;
    const app = makeApp({ eventMode: { refresh: async () => { refreshed++; } } });
    const screen = new RegistrationScreen(app, {
        register: async () => { throw Object.assign(new Error('competition_closed'), { status: 403 }); }
    });
    screen.el = el;
    screen.mount();
    el.querySelector('#reg-name').value = 'Ann';
    el.querySelector('#reg-email').value = 'ann@x.com';
    el.querySelector('#reg-company').value = 'Acme';
    el.querySelector('#reg-consent').checked = true;
    await screen.handleSubmit();
    await settle();
    assert.equal(refreshed, 1);
    assert.deepEqual(app.shown, ['title']);
    assert.deepEqual(app.toasts, [['The competition has closed. Practice mode is open to all.', 'info']]);
    assert.equal(storage.getRegistration(), null);
});
