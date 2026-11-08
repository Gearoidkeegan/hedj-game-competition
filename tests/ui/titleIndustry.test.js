import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fakeDom.js';
import { loadJson, loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { emptyProgress } from '../../js/engine/sim/progress.js';
import * as storage from '../../js/utils/storage.js';
import { RunController } from '../../js/screens/simple/RunController.js';
import { IndustryScreen } from '../../js/screens/simple/IndustryScreen.js';
import { TitleScreen } from '../../js/screens/TitleScreen.js';

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
const BOB = { playerName: 'Bob', email: 'bob@y.com', company: 'Bobco' };
const register = p => storage.saveRegistration({ ...p, gameToken: 't', gameTokenExpiry: Date.now() + 1e9 });

let dom;
beforeEach(() => {
    dom = installFakeDom();
    globalThis.localStorage = new FakeStorage();
    storage.setStorageBackend(new FakeStorage());
});
afterEach(() => {
    storage.setStorageBackend(null);
    delete globalThis.localStorage;
    dom.restore();
});

function fakeApi({ entries = [], fail = false } = {}) {
    return {
        calls: [],
        async fetchLeaderboard(opts) {
            this.calls.push(opts);
            if (fail) throw new Error('offline');
            return entries;
        },
        async getRemoteProgress() { return null; }
    };
}

function makeApp() {
    const rc = new RunController({ storage, market: marketEngine, content, now: () => 1_700_000_000_000 });
    return {
        runController: rc, content, marketReady: Promise.resolve(), shown: [], toasts: [],
        screens: { howtoplay: { fromAutoShow: false, returnScreen: 'title' } },
        showScreen(id) { this.shown.push(id); },
        showToast(msg, type) { this.toasts.push([msg, type]); }
    };
}

function mountTitle(app, api = fakeApi()) {
    const screen = new TitleScreen(app, { api });
    const el = screen.render();
    dom.document.body.replaceChildren(el);
    screen.mount();
    return { screen, el, q: s => el.querySelector(s), qa: s => el.querySelectorAll(s) };
}

const settle = () => new Promise(r => setTimeout(r, 0));

// ── Title ────────────────────────────────────────────────────────────────

test('title: RESUME appears only for the registered player who owns the save (R39)', () => {
    const app = makeApp();
    register(ANN);
    app.runController.start('airline', { seed: 3 });
    app.runController.playQuarter(app.runController.currentDecisionsDefaults());
    app.runController.reset();   // a fresh page load

    let t = mountTitle(app);
    const resume = t.q('.t-resume');
    assert.ok(resume, 'Ann sees RESUME');
    assert.match(resume.textContent, /RESUME/);
    assert.match(resume.textContent, /SkyBridge Airlines, quarter 2 of 8/);
    t.screen.unmount();

    // Bob registers on the same device.
    register(BOB);
    t = mountTitle(app);
    assert.equal(t.q('.t-resume'), null, "Bob never sees Ann's RESUME");
    assert.equal(app.runController.run, null);
    assert.equal(t.q('.t-player-name').textContent, 'Bob');
    t.screen.unmount();
});

test('title: RESUME opens the quarter screen with the resumed run', () => {
    const app = makeApp();
    register(ANN);
    const run = app.runController.start('retail', { seed: 3 });
    app.runController.reset();
    const t = mountTitle(app);
    t.q('.t-resume').click();
    assert.deepEqual(app.shown, ['quarter']);
    assert.equal(app.runController.run.gameId, run.gameId);
    t.screen.unmount();
});

test('title: "Not you?" clears the registration, resets the controller and goes to registration', () => {
    const app = makeApp();
    register(ANN);
    app.runController.start('airline', { seed: 3 });
    let resets = 0;
    const realReset = app.runController.reset.bind(app.runController);
    app.runController.reset = () => { resets++; realReset(); };
    const t = mountTitle(app);
    const before = resets;
    t.q('.t-notyou').click();
    assert.equal(storage.getRegistration(), null);
    assert.equal(resets, before + 1, 'reset() called by the handler');
    assert.equal(app.runController.run, null);
    assert.deepEqual(app.shown, ['registration']);
    t.screen.unmount();

    // The next person to open the title sees no player, no RESUME and no stats.
    const next = mountTitle(app);
    assert.equal(next.q('.t-resume'), null);
    assert.equal(next.q('.t-notyou'), null);
    assert.equal(next.q('.t-stats'), null);
    next.screen.unmount();
});

test('title: player strings are shown as text, never parsed (R7)', () => {
    const app = makeApp();
    register({ ...ANN, playerName: '<img src=x onerror=alert(1)>' });
    const api = fakeApi({ entries: [{ rank: 1, playerName: '<b>Eve</b>', company: '<i>Co</i>', score: 900 }] });
    const t = mountTitle(app, api);
    assert.equal(t.q('.t-player-name').textContent, '<img src=x onerror=alert(1)>');
    assert.equal(t.qa('img').length, 1, 'only the logo image');
    return settle().then(() => {
        assert.equal(t.q('.t-top li .t-top-name').textContent, '<b>Eve</b>');
        assert.equal(t.qa('b').length, 0);
        t.screen.unmount();
    });
});

test('title: personal best, today\'s rank, chairmen met, next unlock and a top-3 teaser', async () => {
    const app = makeApp();
    register(ANN);
    storage.saveProgress(ANN.email, {
        ...emptyProgress(), runs: 1, best: { simple: 1234.4, pro: 0 },
        unlocked: [...emptyProgress().unlocked, 'mode:pro'], chairmenMet: ['dimon', 'musk'], crisisBadges: []
    });
    const api = fakeApi({ entries: [
        { rank: 1, playerName: 'Zed', company: 'Z', score: 3000 },
        { rank: 2, playerName: 'Ann', company: 'Other', score: 2000 },
        { rank: 3, playerName: 'Yan', company: 'Y', score: 1500 },
        { rank: 4, playerName: 'Ann', company: 'Acme', score: 1234 }
    ] });
    const t = mountTitle(app, api);
    const stat = name => t.q(`[data-stat="${name}"] .t-stat-value`).textContent;
    assert.equal(stat('best'), '1,234');
    assert.equal(stat('chairmen'), '2/8');
    assert.equal(t.q('.t-next').textContent, 'Next unlock: Momentum Construction. Score 1,500 in a run (best so far 1,234)');
    await settle();
    assert.deepEqual(api.calls[0], { mode: 'simple', period: 'today', limit: 50 });
    assert.equal(stat('rank'), '#4', 'matched on name and company');
    assert.deepEqual(t.qa('.t-top li').map(li => li.querySelector('.t-top-name').textContent), ['Zed', 'Ann', 'Yan']);
    t.screen.unmount();
});

test('title: offline leaderboard degrades quietly', async () => {
    const app = makeApp();
    register(ANN);
    const t = mountTitle(app, fakeApi({ fail: true }));
    await settle();
    assert.equal(t.q('[data-stat="rank"] .t-stat-value').textContent, 'Offline');
    assert.equal(t.q('.t-top-empty').textContent, "Leaderboard unavailable offline");
    t.screen.unmount();
});

test('title: PRO is locked until mode:pro; CRISES locked until 4 runs', () => {
    const app = makeApp();
    register(ANN);
    let t = mountTitle(app);
    const pro = t.q('.t-pro');
    assert.equal(pro.disabled, true);
    assert.match(pro.textContent, /Finish all 8 quarters of a run/);
    assert.equal(t.q('.t-crises-btn').disabled, true);
    assert.match(t.q('.t-crises-btn').textContent, /Play 4 runs/);
    t.screen.unmount();

    storage.saveProgress(ANN.email, { ...emptyProgress(), runs: 4,
        unlocked: [...emptyProgress().unlocked, 'mode:pro', 'crisis:gfc2008', 'crisis:covid2020'] });
    t = mountTitle(app);
    assert.equal(t.q('.t-pro').disabled, false);
    t.q('.t-pro').click();
    assert.ok(['setup', 'howtoplay'].includes(app.shown.at(-1)));
    const crises = t.q('.t-crises-btn');
    assert.equal(crises.disabled, false);
    crises.click();
    assert.deepEqual(t.qa('[data-crisis]').map(b => b.textContent),
        ['Global Financial Crisis (2008)', 'Covid-19 shock (2020)']);
    t.screen.unmount();
});

test('title: a crisis starts its run (forced industry) and opens the quarter', async () => {
    const app = makeApp();
    register(ANN);
    storage.saveProgress(ANN.email, { ...emptyProgress(), runs: 4, unlocked: [...emptyProgress().unlocked, 'crisis:gfc2008'] });
    const t = mountTitle(app);
    t.q('.t-crises-btn').click();
    await t.screen.startCrisis('gfc2008');
    assert.equal(app.runController.run.crisisId, 'gfc2008');
    assert.equal(app.runController.run.industryId, 'airline');
    assert.deepEqual(app.shown, ['quarter']);
    t.screen.unmount();
});

test('title: PLAY goes to the industry pick, via the guide the first time', () => {
    const app = makeApp();
    register(ANN);
    let t = mountTitle(app);
    t.q('.t-play').click();
    assert.deepEqual(app.shown, ['howtoplay']);
    assert.equal(app.screens.howtoplay.returnScreen, 'industry');
    t.screen.unmount();
    storage.markGuideSeen();
    t = mountTitle(app);
    t.q('.t-play').click();
    assert.equal(app.shown.at(-1), 'industry');
    t.screen.unmount();
});

test('title: unmount ignores late network replies', async () => {
    const app = makeApp();
    register(ANN);
    let release;
    const api = { fetchLeaderboard: () => new Promise(r => { release = r; }), async getRemoteProgress() { return null; } };
    const t = mountTitle(app, api);
    await settle();   // the request is in flight
    t.screen.unmount();
    release([{ rank: 1, playerName: 'Late', company: '', score: 1 }]);
    await settle();
    assert.equal(t.qa('.t-top li').length, 0);
});

// ── Industry pick ────────────────────────────────────────────────────────

function mountIndustry(app) {
    const screen = new IndustryScreen(app);
    const el = screen.render();
    dom.document.body.replaceChildren(el);
    screen.mount();
    return { screen, el, q: s => el.querySelector(s), qa: s => el.querySelectorAll(s) };
}

test('industry: 7 cards; locked ones are greyed with their unlock rule', () => {
    const app = makeApp();
    register(ANN);
    const t = mountIndustry(app);
    const cards = t.qa('[data-industry]');
    assert.equal(cards.length, 7);
    const open = cards.filter(c => !c.classList.contains('is-locked')).map(c => c.getAttribute('data-industry'));
    assert.deepEqual(open, ['airline', 'agrifoods', 'retail']);
    const pharma = t.q('[data-industry="pharma"]');
    assert.equal(pharma.disabled, true);
    assert.equal(pharma.getAttribute('aria-disabled'), 'true');
    assert.equal(pharma.querySelector('.ind-lock').textContent, 'Locked. Play 3 runs');
    assert.equal(t.q('[data-industry="tech"] .ind-lock').textContent, 'Locked. Score 2,250 in a run');
    assert.match(t.q('[data-industry="airline"] .ind-risks').textContent, /Jet fuel/);
});

test('industry: picking waits for market data, starts the run and opens the quarter', async () => {
    const app = makeApp();
    register(ANN);
    let ready;
    app.marketReady = new Promise(r => { ready = r; });
    const t = mountIndustry(app);
    const pick = t.screen.pick('airline');
    await settle();
    assert.equal(app.runController.run, null, 'start() waits for app.marketReady');
    assert.match(t.q('[data-industry="airline"]').textContent, /Opening the books/);
    ready();
    await pick;
    assert.equal(app.runController.run.industryId, 'airline');
    assert.deepEqual(app.shown, ['quarter']);
});

test('industry: tapping a locked card does nothing; a failed start shows a toast', async () => {
    const app = makeApp();
    register(ANN);
    const t = mountIndustry(app);
    t.q('[data-industry="energy"]').click();
    await settle();
    assert.deepEqual(app.shown, []);
    app.runController.start = () => { throw new Error('no eligible start year'); };
    const errors = [];
    const orig = console.error;
    console.error = (...a) => errors.push(a);
    try { await t.screen.pick('retail'); } finally { console.error = orig; }
    assert.deepEqual(app.shown, []);
    assert.equal(app.toasts.length, 1);
    assert.equal(errors.length, 1);
    assert.equal(t.q('[data-industry="retail"]').disabled, false, 'the card works again');
});

test('industry: BACK returns to the title', () => {
    const app = makeApp();
    register(ANN);
    const t = mountIndustry(app);
    t.q('.ind-back').click();
    assert.deepEqual(app.shown, ['title']);
});

// ── B4 follow-ups (B2 review minors) ─────────────────────────────────────

test('title: an expired registration shows no unlocks, and a crisis cannot start', async () => {
    const app = makeApp();
    storage.saveRegistration({ ...ANN, gameToken: 't', gameTokenExpiry: Date.now() - 1000 });
    storage.saveProgress(ANN.email, { ...emptyProgress(), runs: 9,
        unlocked: [...emptyProgress().unlocked, 'mode:pro', 'crisis:gfc2008'] });
    const t = mountTitle(app);
    assert.equal(t.q('.t-pro').disabled, true);
    assert.equal(t.q('.t-crises-btn').disabled, true);
    await t.screen.startCrisis('gfc2008');
    assert.equal(app.runController.run, null);
    assert.deepEqual(app.shown, []);
    t.screen.unmount();
});

test('title: the sound label starts from soundFX.enabled', async () => {
    const { soundFX } = await import('../../js/ui/SoundFX.js');
    const before = soundFX.enabled;
    try {
        soundFX.enabled = false;
        const app = makeApp();
        register(ANN);
        const t = mountTitle(app);
        assert.equal(t.q('.t-sound').textContent, 'SOUND OFF');
        assert.equal(t.q('.t-sound').getAttribute('aria-label'), 'Sound off');
        t.screen.unmount();
    } finally { soundFX.enabled = before; }
});

test('title: the leaderboard modal closes on Escape and on unmount, and returns focus', async () => {
    const app = makeApp();
    register(ANN);
    const api = fakeApi({ entries: [{ rank: 1, playerName: 'Zed', company: '', score: 5 }] });
    const t = mountTitle(app, api);
    const modals = () => dom.document.body.querySelectorAll('.v3-modal');
    const press = k => (dom.document.listeners.get('keydown') || []).slice().forEach(fn => fn({ key: k }));
    const opener = t.q('.t-lb');
    opener.focus();
    await t.screen.showLeaderboard();
    assert.equal(modals().length, 1);
    press('Enter');
    assert.equal(modals().length, 1, 'other keys leave it open');
    press('Escape');
    assert.equal(modals().length, 0);
    assert.equal(dom.document.activeElement, opener, 'focus returns to the opener');
    assert.equal((dom.document.listeners.get('keydown') || []).length, 0, 'no listener left behind');
    await t.screen.showLeaderboard();
    assert.equal(modals().length, 1);
    t.screen.unmount();
    assert.equal(modals().length, 0);
    assert.equal((dom.document.listeners.get('keydown') || []).length, 0);
});

test('industry: BACK during a pending start does not navigate to the quarter later', async () => {
    const app = makeApp();
    register(ANN);
    let ready;
    app.marketReady = new Promise(r => { ready = r; });
    const t = mountIndustry(app);
    const pick = t.screen.pick('airline');
    await settle();
    t.q('.ind-back').click();
    t.screen.unmount();
    ready();
    await pick;
    assert.deepEqual(app.shown, ['title']);
});
