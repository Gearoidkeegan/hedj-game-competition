// v3.1 Task 2: the player character. The mood mapping, per-player device-local storage (never synced), the pixel
// avatars, the picker (a keyboard radio group behind a tap guard), the gate before the industry pick, and the face
// on the quarter, result, game-over and title screens.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom, key } from '../helpers/fakeDom.js';
import { loadJson, loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import * as storage from '../../js/utils/storage.js';
import { EventMode } from '../../js/utils/eventStatus.js';
import { avatarMood } from '../../js/engine/sim/avatarMood.js';
import { AVATARS, AVATAR_IDS, AVATAR_SIZE, AVATAR_EXPRESSIONS, isAvatarId, drawAvatar } from '../../js/ui/pixel/avatars.js';
import { AvatarPicker, avatarPlayer, storedAvatar, needsAvatar, avatarScale, avatarCanvas } from '../../js/screens/simple/AvatarPicker.js';
import { RunController } from '../../js/screens/simple/RunController.js';
import { QuarterScreen } from '../../js/screens/simple/QuarterScreen.js';
import { ResultScreen } from '../../js/screens/simple/ResultScreen.js';
import { GameOverScreen } from '../../js/screens/GameOverScreen.js';
import { TitleScreen } from '../../js/screens/TitleScreen.js';
import { TAP_GUARD_MS } from '../../js/ui/tapGuard.js';
import { App } from '../../js/main.js';

marketEngine.loadFromObjects(loadMarketData());

class FakeStorage {
    constructor() { this.m = new Map(); }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
    setItem(k, v) { this.m.set(k, String(v)); }
    removeItem(k) { this.m.delete(k); }
}

const content = {
    industries: loadIndustries(),
    eventsLoaded: true,
    events: loadJson('data/simple-events.json').events,
    quips: loadJson('data/quips.json'),
    powerups: loadJson('data/powerups.json')
};
const ANN = 'ann@x.com';
const BOB = 'bob@y.com';
const register = email => storage.saveRegistration({ playerName: 'Ann', email, company: 'X', gameToken: 't', gameTokenExpiry: Date.now() + 1e9 });

let dom;
let backing;
beforeEach(() => {
    dom = installFakeDom();
    globalThis.localStorage = new FakeStorage();
    backing = new FakeStorage();
    storage.setStorageBackend(backing);
    storage.setFreePlay(false);
});
afterEach(() => {
    storage.setFreePlay(false);
    storage.setStorageBackend(null);
    delete globalThis.localStorage;
    dom.restore();
});

// ── Mood mapping ─────────────────────────────────────────────────────────

const base = { cash: 500, redLine: 100, startingCash: 500, boardMood: 60, status: 'active' };
const mood = patch => avatarMood({ ...base, ...patch });

test('mood: happy when cash and the board are comfortable', () => {
    assert.equal(mood({}), 'happy');
    assert.equal(mood({ status: 'complete' }), 'happy');
});

test('mood: bankrupt or fired is angry, whatever the numbers', () => {
    assert.equal(mood({ status: 'bankrupt' }), 'angry');
    assert.equal(mood({ status: 'fired' }), 'angry');
});

test('mood: cash below the red line is angry; exactly on it is not', () => {
    assert.equal(mood({ cash: 99.99 }), 'angry');
    assert.equal(mood({ cash: 100 }), 'worried');
});

test('mood: board mood 25 or lower is angry; just above is worried', () => {
    assert.equal(mood({ boardMood: 25 }), 'angry');
    assert.equal(mood({ boardMood: 10 }), 'angry');
    assert.equal(mood({ boardMood: 25.01 }), 'worried');
});

test('mood: board mood below 50 is worried; 50 is happy', () => {
    assert.equal(mood({ boardMood: 49.99 }), 'worried');
    assert.equal(mood({ boardMood: 50 }), 'happy');
});

test('mood: cash below the red line plus 15% of starting cash is worried; exactly there is happy', () => {
    // 100 + 0.15 x 500 = 175
    assert.equal(mood({ cash: 174.99 }), 'worried');
    assert.equal(mood({ cash: 175 }), 'happy');
});

test('mood: missing or non-numeric fields never throw and are ignored', () => {
    assert.equal(avatarMood({}), 'happy');
    assert.equal(avatarMood(), 'happy');
    assert.equal(avatarMood({ status: 'fired' }), 'angry');
    assert.equal(avatarMood({ cash: NaN, redLine: 100, startingCash: 500, boardMood: 60 }), 'happy');
    assert.equal(avatarMood({ cash: 50, redLine: 100 }), 'angry', 'red line still applies without a starting cash');
});

// ── Storage ──────────────────────────────────────────────────────────────

test('storage: the avatar round-trips per player, registered and guest kept apart, never in progress', () => {
    assert.equal(storage.getAvatar(ANN), null);
    assert.equal(storage.saveAvatar(ANN, 'p3'), true);
    assert.equal(storage.saveAvatar(storage.GUEST_PLAYER, 'p7'), true);
    assert.equal(storage.getAvatar(ANN), 'p3');
    assert.equal(storage.getAvatar('ANN@X.com'), 'p3', 'email keys are case-insensitive');
    assert.equal(storage.getAvatar(storage.GUEST_PLAYER), 'p7');
    assert.equal(storage.getAvatar(BOB), null);
    assert.equal(backing.getItem(`hedj_v3:${ANN}:avatar`), 'p3');
    assert.equal(backing.getItem('hedj_v3:guest:avatar'), 'p7');
    assert.equal(storage.getProgress(ANN).avatar, undefined, 'not part of the synced progress');
});

test('storage: a failed write still remembers the pick for this page load, so the picker cannot loop', () => {
    storage.setStorageBackend({ getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem() {} });
    const warn = console.warn;
    console.warn = () => {};
    try {
        assert.equal(storage.saveAvatar('carol@z.com', 'p2'), false);
    } finally { console.warn = warn; }
    assert.equal(storage.getAvatar('carol@z.com'), 'p2');
    assert.equal(storage.getAvatar('dave@z.com'), null);
});

test('the picker is needed for a missing or unknown id, for the registered player and for the guest', () => {
    register(ANN);
    assert.equal(avatarPlayer(storage), ANN);
    assert.equal(needsAvatar(storage), true);
    storage.saveAvatar(ANN, 'nobody');
    assert.equal(storedAvatar(storage, ANN), null);
    assert.equal(needsAvatar(storage), true, 'an unknown id');
    storage.saveAvatar(ANN, '__proto__');
    assert.equal(needsAvatar(storage), true);
    storage.saveAvatar(ANN, 'p4');
    assert.equal(storedAvatar(storage, ANN), 'p4');
    assert.equal(needsAvatar(storage), false);

    storage.setFreePlay(true);
    assert.equal(avatarPlayer(storage), storage.GUEST_PLAYER);
    assert.equal(needsAvatar(storage), true, "the guest has not picked, whatever Ann chose");
    storage.saveAvatar(storage.GUEST_PLAYER, 'p1');
    assert.equal(needsAvatar(storage), false);
});

test('nobody to store for (live, not registered): no picker; the registration gate comes first', () => {
    assert.equal(avatarPlayer(storage), null);
    assert.equal(needsAvatar(storage), false);
});

test('the backend is untouched: no avatar in the progress sync', () => {
    const progress = readFileSync(new URL('../../js/engine/sim/progress.js', import.meta.url), 'utf8');
    const api = readFileSync(new URL('../../js/utils/api.js', import.meta.url), 'utf8');
    assert.ok(!/avatar/i.test(progress) && !/avatar/i.test(api));
});

// ── The pixel avatars ────────────────────────────────────────────────────

function recordingContext() {
    const calls = [];
    const ctx = {
        calls,
        _fill: '#000000',
        get fillStyle() { return this._fill; },
        set fillStyle(v) { this._fill = v; calls.push(['fillStyle', v]); },
    };
    for (const name of ['fillRect', 'clearRect']) ctx[name] = (...args) => calls.push([name, ...args]);
    return ctx;
}
const rects = ctx => ctx.calls.filter(([n]) => n === 'fillRect');

test('avatars: 8 ids x 3 expressions, all the same size, every palette index defined', () => {
    assert.equal(AVATAR_IDS.length, 8);
    assert.deepEqual([...AVATAR_EXPRESSIONS], ['happy', 'worried', 'angry']);
    for (const id of AVATAR_IDS) {
        const a = AVATARS[id];
        assert.ok(a, id);
        for (const expr of AVATAR_EXPRESSIONS) {
            const rows = a.faces[expr];
            assert.equal(rows.length, AVATAR_SIZE, `${id}/${expr} height`);
            for (const row of rows) {
                assert.equal(row.length, AVATAR_SIZE, `${id}/${expr} width`);
                for (const ch of row) {
                    if (ch === '.') continue;
                    assert.match(a.palette[ch] || '', /^#[0-9a-f]{6}$/i, `${id}/${expr}: palette index '${ch}' undefined`);
                }
            }
        }
        const [h, w, an] = AVATAR_EXPRESSIONS.map(e => a.faces[e].join('\n'));
        assert.ok(h !== w && w !== an && h !== an, `${id}: the three faces differ`);
    }
});

test('avatars: a range of skin tones, hair and presentation', () => {
    const skins = new Set(AVATAR_IDS.map(id => AVATARS[id].palette.s.toLowerCase()));
    assert.ok(skins.size >= 5, `${skins.size} skin tones`);
    const features = AVATAR_IDS.flatMap(id => AVATARS[id].features);
    for (const f of ['headscarf', 'beard', 'glasses']) assert.ok(features.includes(f), `has ${f}`);
    const hair = new Set(AVATAR_IDS.map(id => AVATARS[id].hair));
    assert.ok(hair.size >= 6, `${hair.size} hair styles`);
});

test('drawAvatar: draws inside its box at any scale, deterministically, and falls back safely', (t) => {
    const saved = Math.random;
    Math.random = () => { throw new Error('Math.random used'); };
    t.after(() => { Math.random = saved; });
    for (const id of AVATAR_IDS) {
        for (const expr of AVATAR_EXPRESSIONS) {
            const ctx = recordingContext();
            drawAvatar(ctx, id, expr, 5, 7, 3);
            const r = rects(ctx);
            assert.ok(r.length > 30, `${id}/${expr}`);
            for (const [, x, y, w, hh] of r) assert.ok(x >= 5 && y >= 7 && x + w <= 5 + 96 && y + hh <= 7 + 96);
            const again = recordingContext();
            drawAvatar(again, id, expr, 5, 7, 3);
            assert.deepEqual(again.calls, ctx.calls);
        }
    }
    const a = recordingContext();
    drawAvatar(a, 'p1', 'confused', 0, 0, 2);
    const b = recordingContext();
    drawAvatar(b, 'p1', 'happy', 0, 0, 2);
    assert.deepEqual(a.calls, b.calls, 'an unknown expression draws happy');
    assert.doesNotThrow(() => drawAvatar(recordingContext(), 'nobody', 'angry', 0, 0, 0));
    assert.equal(isAvatarId('p1'), true);
    assert.equal(isAvatarId('toString'), false);
    assert.equal(isAvatarId(undefined), false);
});

// ── The picker ───────────────────────────────────────────────────────────

const BANNED = /\b(male|female|man|men|woman|women|boy|girl|lady|ladies|gentleman|gentlemen|guy|he|she|his|her|hers|him|black|white|brown|asian|african|european|caucasian|latino|latina|latinx|hispanic|arab|arabic|indian|middle[- ]eastern|race|racial|ethnic|ethnicity|gender|skin|tone|light|dark|pale|tan|muslim|hijab|beard|glasses|headscarf)\b/i;

function makeApp(extra = {}) {
    const rc = new RunController({ storage, market: marketEngine, content, now: () => 1_700_000_000_000 });
    return {
        runController: rc, content, marketReady: Promise.resolve(), shown: [], toasts: [],
        screens: { howtoplay: { fromAutoShow: false, returnScreen: 'title' } },
        showScreen(id) { this.shown.push(id); },
        showToast(msg, type) { this.toasts.push([msg, type]); },
        ...extra
    };
}

function mountPicker(app, { next = null, settle = true } = {}) {
    const clock = { t: 0 };
    const screen = new AvatarPicker(app, { storage, now: () => clock.t });
    screen.nextScreen = next;
    const el = screen.render();
    dom.document.body.replaceChildren(el);
    screen.mount();
    if (settle) clock.t += TAP_GUARD_MS;
    return { screen, el, clock, q: s => el.querySelector(s), qa: s => el.querySelectorAll(s) };
}

function allText(el) {
    const out = [el.textContent];
    const walk = n => {
        for (const c of n.children) {
            for (const [k, v] of c.attributes) if (k.startsWith('aria-') || k === 'title' || k === 'alt') out.push(v);
            walk(c);
        }
    };
    walk(el);
    return out;
}

test('picker: a radio group of 8 pictures labelled Character 1 to Character 8, with no race or gender words', () => {
    register(ANN);
    const t = mountPicker(makeApp());
    const group = t.q('[role="radiogroup"]');
    assert.ok(group);
    const radios = group.querySelectorAll('[role="radio"]');
    assert.equal(radios.length, 8);
    assert.deepEqual(radios.map(r => r.getAttribute('aria-label')), AVATAR_IDS.map((_, i) => `Character ${i + 1}`));
    for (const r of radios) {
        assert.ok(r.querySelector('canvas'), 'a picture');
        assert.equal(r.textContent.trim(), '', 'pictures only, no visible label');
    }
    for (const s of allText(t.el)) assert.ok(!BANNED.test(s), `banned word in "${s}"`);
    for (const id of AVATAR_IDS) assert.ok(!BANNED.test(id));
});

test('picker: one tap saves the pick for this player and continues; a double tap picks once', () => {
    register(ANN);
    const app = makeApp();
    const t = mountPicker(app, { next: 'industry' });
    const radios = t.qa('[role="radio"]');
    radios[2].click();
    radios[5].click();
    assert.deepEqual(app.shown, ['industry']);
    assert.equal(storage.getAvatar(ANN), AVATAR_IDS[2]);
});

test('picker: taps in the first moments after it opens are ignored (the second tap of PLAY)', () => {
    register(ANN);
    const app = makeApp();
    const t = mountPicker(app, { next: 'industry', settle: false });
    t.qa('[role="radio"]')[0].click();
    assert.deepEqual(app.shown, []);
    assert.equal(storage.getAvatar(ANN), null);
    t.clock.t += TAP_GUARD_MS;
    t.qa('[role="radio"]')[1].click();
    assert.deepEqual(app.shown, ['industry']);
});

test('picker: the arrow keys, Home and End move the checked radio and the focus without leaving', () => {
    register(ANN);
    const app = makeApp();
    const t = mountPicker(app);
    const radios = () => t.qa('[role="radio"]');
    const checked = () => radios().findIndex(r => r.getAttribute('aria-checked') === 'true');
    const tabStops = () => radios().filter(r => r.getAttribute('tabindex') === '0').length;
    assert.equal(checked(), 0);
    assert.equal(tabStops(), 1);
    const group = t.q('[role="radiogroup"]');
    key(group, 'ArrowRight');
    assert.equal(checked(), 1);
    assert.equal(dom.document.activeElement, radios()[1]);
    key(group, 'ArrowDown');
    assert.equal(checked(), 2);
    key(group, 'ArrowLeft');
    key(group, 'ArrowUp');
    key(group, 'ArrowUp');
    assert.equal(checked(), 7, 'wraps around');
    key(group, 'Home');
    assert.equal(checked(), 0);
    key(group, 'End');
    assert.equal(checked(), 7);
    assert.equal(tabStops(), 1);
    assert.deepEqual(app.shown, [], 'moving is not choosing');
    assert.equal(storage.getAvatar(ANN), null);
    radios()[7].click();   // Enter or Space on a focused radio button clicks it
    assert.equal(storage.getAvatar(ANN), AVATAR_IDS[7]);
    assert.deepEqual(app.shown, ['title'], 'opened from the title, it goes back there');
});

test('picker: reopened, the stored pick is checked; the guest stores under the guest key; BACK goes to the title', () => {
    storage.setFreePlay(true);
    storage.saveAvatar(storage.GUEST_PLAYER, AVATAR_IDS[4]);
    const app = makeApp();
    let t = mountPicker(app);
    assert.equal(t.qa('[role="radio"]')[4].getAttribute('aria-checked'), 'true');
    t.qa('[role="radio"]')[6].click();
    assert.equal(storage.getAvatar(storage.GUEST_PLAYER), AVATAR_IDS[6]);
    assert.equal(storage.getAvatar(ANN), null);
    t = mountPicker(app, { next: 'industry' });
    t.q('.av-back').click();
    assert.deepEqual(app.shown, ['title', 'title']);
});

// ── main.js: the picker sits after registration or the free-play PLAY, before the industry pick ──

function makeMainApp() {
    const clock = { t: 1_700_000_000_000, live: false };
    const app = new App();
    app.container = dom.document.createElement('div');
    app.shown = [];
    const screen = id => ({
        render() { app.shown.push(id); return dom.document.createElement('div'); },
        mount() {}, unmount() {}
    });
    app.screens = Object.fromEntries(['title', 'registration', 'industry', 'setup', 'quarter', 'gameover', 'avatar']
        .map(id => [id, screen(id)]));
    app.eventMode = new EventMode({ fetchEvent: async () => ({ live: clock.live }), storage, now: () => clock.t });
    return { app, clock };
}

test('main: free play PLAY shows the picker once, then the industry pick', async () => {
    const { app } = makeMainApp();
    await app.eventMode.refresh();
    app.showScreen('industry');
    assert.deepEqual(app.shown, ['avatar']);
    assert.equal(app.screens.avatar.nextScreen, 'industry');
    storage.saveAvatar(storage.GUEST_PLAYER, 'p2');
    app.showScreen('industry');
    assert.deepEqual(app.shown, ['avatar', 'industry']);
});

test('main: live, registration comes first, then the picker, then the industry pick; Pro never asks', async () => {
    const { app, clock } = makeMainApp();
    clock.live = true;
    await app.eventMode.refresh();
    app.showScreen('industry');
    assert.deepEqual(app.shown, ['registration']);
    register(ANN);
    app.showScreen('industry');
    assert.deepEqual(app.shown.slice(1), ['avatar']);
    app.showScreen('setup');
    assert.deepEqual(app.shown.slice(2), ['setup'], 'Pro screens are unchanged');
    storage.saveAvatar(ANN, 'p5');
    app.showScreen('industry');
    assert.deepEqual(app.shown.slice(3), ['industry']);
});

// ── The face on the screens ──────────────────────────────────────────────

function quarterSetup(patch = null) {
    register(ANN);
    const app = makeApp();
    app.runController.start('airline', { seed: 3 });
    if (patch) app.runController.run = { ...structuredClone(app.runController.run), ...patch };
    const screen = new QuarterScreen(app, { now: () => 0 });
    const el = screen.render();
    dom.document.body.replaceChildren(el);
    screen.mount();
    return { app, screen, el, q: s => el.querySelector(s) };
}

test('quarter: the chosen face sits next to the cash meter, from the run state', () => {
    storage.saveAvatar(ANN, 'p6');
    let t = quarterSetup();
    const face = t.q('.q-head .q-cash-row .av-face');
    assert.ok(face, 'avatar beside the meter');
    assert.ok(t.q('.q-cash-row .q-cash .cash-meter'), 'the meter is still there');
    assert.equal(face.getAttribute('data-avatar'), 'p6');
    assert.equal(face.getAttribute('data-mood'), 'happy');
    assert.equal(face.getAttribute('aria-label'), 'Your character looks happy');
    t.screen.unmount();
    t = quarterSetup({ boardMood: 40 });
    assert.equal(t.q('.av-face').getAttribute('data-mood'), 'worried');
    t.screen.unmount();
});

test('quarter: no avatar chosen (a run saved before this change) shows no face and no error', () => {
    const t = quarterSetup();
    assert.equal(t.q('.av-face'), null);
    assert.ok(t.q('.q-cash .cash-meter'));
});

test('result: the face reacts to the quarter once it is revealed', () => {
    register(ANN);
    storage.saveAvatar(ANN, 'p1');
    const app = makeApp();
    const rc = app.runController;
    rc.start('airline', { seed: 3 });
    rc.run = { ...structuredClone(rc.run), boardMood: 30 };   // the quarter starts with a worried board
    app.lastQuarter = rc.playQuarter(rc.currentDecisionsDefaults());
    const screen = new ResultScreen(app, { now: () => 0, setTimeout: () => 0, clearTimeout() {}, matchMedia: () => ({ matches: true }) });
    const el = screen.render();
    dom.document.body.replaceChildren(el);
    screen.mount();
    const face = el.querySelector('.q-head .q-cash-row .av-face');
    assert.ok(face);
    assert.equal(face.getAttribute('data-avatar'), 'p1');
    const before = avatarMood({ cash: screen.cashBefore, redLine: rc.run.redLine, startingCash: rc.run.startingCash, boardMood: 60, status: 'active' });
    assert.equal(face.getAttribute('data-mood'), before, 'the face before the quarter at first');
    screen._revealAll();
    assert.equal(face.getAttribute('data-mood'), avatarMood(app.lastQuarter.run), 'then the face after it');
    screen.unmount();
});

test('game over: the face from the final status (Simple only)', () => {
    register(ANN);
    storage.saveAvatar(ANN, 'p8');
    const run = { status: 'fired', seed: 3, industryId: 'airline', crisisId: null, startYear: 2008, baseCurrency: 'EUR',
        cash: 400, redLine: 100, startingCash: 500, boardMood: 20, history: [{ q: 3, severe: false }] };
    const rc = {
        run, outcome: { score: 900, title: 'Intern', newlyUnlocked: [], isPersonalBest: false, rank: null, queued: true, ranked: true, storageFailed: false },
        finish() { return null; }
    };
    const app = makeApp({ runController: rc, gameOverMode: 'simple' });
    const screen = new GameOverScreen(app, { storage, playCutscene: async () => {}, sound: { gameOver() {}, fired() {} },
        fetch: async () => ({ json: async () => ({ yearFacts: {} }) }), env: { matchMedia: () => ({ matches: true }), now: () => 0 } });
    const el = screen.render();
    const face = el.querySelector('.go-ending .av-face');
    assert.ok(face);
    assert.equal(face.getAttribute('data-avatar'), 'p8');
    assert.equal(face.getAttribute('data-mood'), 'angry');
    run.status = 'complete';
    run.boardMood = 70;
    assert.equal(screen.render().querySelector('.av-face').getAttribute('data-mood'), 'happy');
});

test('title: CHARACTER reopens the picker for the player, and returns to the title', () => {
    register(ANN);
    const app = makeApp();
    app.screens.avatar = { nextScreen: null };
    const screen = new TitleScreen(app, { api: { async fetchLeaderboard() { return []; }, async getRemoteProgress() { return null; } } });
    const el = screen.render();
    dom.document.body.replaceChildren(el);
    const btn = el.querySelector('.t-character');
    assert.ok(btn);
    assert.match(btn.textContent, /CHARACTER/);
    btn.click();
    assert.deepEqual(app.shown, ['avatar']);
    assert.equal(app.screens.avatar.nextScreen, 'title');
    screen.unmount();
});

test('title: no CHARACTER button without a player to store it for', () => {
    const app = makeApp();
    const screen = new TitleScreen(app, { api: { async fetchLeaderboard() { return []; } } });
    const el = screen.render();
    assert.equal(el.querySelector('.t-character'), null);
    screen.unmount();
});

test('industry: the second tap of a double tap on the picker cannot start a run', async () => {
    register(ANN);
    const { IndustryScreen } = await import('../../js/screens/simple/IndustryScreen.js');
    const app = makeApp();
    const clock = { t: 0 };
    const screen = new IndustryScreen(app, { now: () => clock.t });
    const el = screen.render();
    dom.document.body.replaceChildren(el);
    screen.mount();
    el.querySelector('[data-industry="airline"]').click();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(app.runController.run, null);
    assert.deepEqual(app.shown, []);
    clock.t += TAP_GUARD_MS;
    el.querySelector('[data-industry="airline"]').click();
    await new Promise(r => setTimeout(r, 0));
    assert.equal(app.runController.run?.industryId, 'airline');
    assert.deepEqual(app.shown, ['quarter']);
});

test('storage: a failed save wins over an older value still in the store', () => {
    const old = new FakeStorage();
    old.setItem('hedj_v3:erin@z.com:avatar', 'p1');
    storage.setStorageBackend({ getItem: k => old.getItem(k), setItem: () => { throw new Error('quota'); }, removeItem: k => old.removeItem(k) });
    const warn = console.warn;
    console.warn = () => {};
    try {
        assert.equal(storage.saveAvatar('erin@z.com', 'p2'), false);
    } finally { console.warn = warn; }
    assert.equal(storage.getAvatar('erin@z.com'), 'p2');
});

// Crisp pixels (review Important 1): every avatar canvas is 32 x an integer scale, drawn at that scale, so each
// source pixel is the same whole number of device pixels and none is dropped.
test('avatar canvases draw at an integer scale, 1:1 with device pixels, no row or column dropped (24-64px, DPR 1 to 3)', () => {
    const saved = globalThis.devicePixelRatio;
    try {
        for (const css of [24, 48, 64]) {
            for (const dpr of [1, 1.5, 2, 3]) {
                const s = avatarScale(css, dpr);
                assert.ok(Number.isInteger(s) && s >= 1, `${css}px @${dpr}: scale ${s}`);
                globalThis.devicePixelRatio = dpr;
                const slot = avatarCanvas('p1', 'angry', css);
                const canvas = slot.querySelector('canvas');
                assert.equal(canvas.getAttribute('width'), String(32 * s));
                assert.equal(canvas.getAttribute('height'), String(32 * s));
                // device pixels map 1:1: the CSS size x dpr is exactly the backing size
                for (const side of ['width', 'height']) {
                    const cssSide = parseFloat(canvas.style[side]);
                    assert.ok(Math.abs(cssSide * dpr - 32 * s) < 1e-6, `${css}px @${dpr}: ${side} ${canvas.style[side]}`);
                    assert.ok(Math.abs(cssSide - css) <= css / 3 + 1e-9, `${css}px @${dpr}: shown ${cssSide}px`);
                }
                // the slot keeps the nominal size, so layouts don't jump
                assert.ok(slot.classList.contains('av-slot'));
                assert.equal(slot.style.width, `${css}px`);
                assert.equal(slot.style.height, `${css}px`);
                for (const id of AVATAR_IDS) {
                    const ctx = recordingContext();
                    drawAvatar(ctx, id, 'angry', 0, 0, s);
                    const rows = new Set();
                    const cols = new Set();
                    for (const [, x, y, w, hh] of rects(ctx)) {
                        assert.ok(x % s === 0 && y % s === 0 && w % s === 0 && hh % s === 0, `${id} ${css}px @${dpr}: uneven pixel`);
                        for (let c = x / s; c < (x + w) / s; c++) cols.add(c);
                        for (let r = y / s; r < (y + hh) / s; r++) rows.add(r);
                    }
                    const face = AVATARS[id].faces.angry;
                    const wantRows = face.map((row, r) => (/[^.]/.test(row) ? r : -1)).filter(r => r >= 0);
                    const wantCols = [...Array(32).keys()].filter(c => face.some(row => row[c] !== '.'));
                    assert.deepEqual([...rows].sort((a, b) => a - b), wantRows, `${id}: rows dropped`);
                    assert.deepEqual([...cols].sort((a, b) => a - b), wantCols, `${id}: columns dropped`);
                }
            }
        }
    } finally {
        if (saved === undefined) delete globalThis.devicePixelRatio;
        else globalThis.devicePixelRatio = saved;
    }
});

// Final review M8: at DPR 1.75 (and other odd ratios) the nearest whole scale made a 64px picture 73px, which overhung
// its picker cell. The picker clamps the shown size to its slot; 4 slots, gaps, padding and borders fit at 360px.
test('final M8: picker pictures never overhang their 64px slot at any DPR, and the grid fits 360px', () => {
    const saved = globalThis.devicePixelRatio;
    try {
        for (const dpr of [1, 1.25, 1.5, 1.75, 2, 2.25, 2.625, 3]) {
            globalThis.devicePixelRatio = dpr;
            const t = mountPicker(makeApp());
            const pics = t.qa('canvas.av-pic');
            assert.equal(pics.length, AVATAR_IDS.length);
            for (const c of pics) {
                const shown = parseFloat(c.style.width);
                assert.ok(shown <= 64 + 1e-9, `@${dpr}: shown ${shown}px`);
                assert.ok(shown >= 40, `@${dpr}: not tiny (${shown}px)`);
                const s = Number(c.getAttribute('width')) / 32;
                assert.ok(Number.isInteger(s) && Math.abs(shown * dpr - 32 * s) < 1e-6, `@${dpr}: still 1:1 device pixels`);
                assert.equal(c.parentNode.style.width, '64px');
            }
            t.screen.unmount?.();
        }
    } finally {
        if (saved === undefined) delete globalThis.devicePixelRatio;
        else globalThis.devicePixelRatio = saved;
    }
    // 360px wide, 12px gutters: 4 x (64 + 2 x 4 padding + 2 x 2 border) + 3 x 8 gap = 328 <= 336.
    const css = readFileSync(new URL('../../css/v3.css', import.meta.url), 'utf8');
    assert.match(css, /\.av-grid \{[^}]*gap: 8px/);
    assert.match(css, /\.av-option \{[^}]*padding: 4px;[^}]*border: 2px solid/s);
    assert.ok(4 * (64 + 8 + 4) + 3 * 8 <= 360 - 2 * 12);
});
