import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fakeDom.js';
import { loadJson, loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { gameState } from '../../js/engine/GameState.js';
import { scorePro } from '../../js/engine/sim/proAdapter.js';
import * as storage from '../../js/utils/storage.js';
import { RunController, cosmeticRng } from '../../js/screens/simple/RunController.js';
import { ResultScreen } from '../../js/screens/simple/ResultScreen.js';
import { GameOverScreen, endingFor, endingQuip, rankText, COUNT_MS } from '../../js/screens/GameOverScreen.js';

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
const FACTS = { yearFacts: { 2008: { headline: 'The Global Financial Crisis', fact: 'Lehman fell.', market_note: 'Oil crashed' } } };
const flush = () => new Promise(r => setImmediate(r));
const REDUCED = { matchMedia: () => ({ matches: true }) };

let dom;
beforeEach(() => {
    dom = installFakeDom();
    globalThis.localStorage = new FakeStorage();
    storage.setStorageBackend(new FakeStorage());
    storage.saveRegistration({ playerName: 'Ann', email: 'ann@x.com', company: 'X', gameToken: 't', gameTokenExpiry: Date.now() + 1e9 });
    gameState.reset();
});
afterEach(() => {
    storage.setStorageBackend(null);
    delete globalThis.localStorage;
    gameState.reset();
    dom.restore();
});

// A finished Simple run behind a RunController-shaped stub. `resolve` settles finish()'s promise.
function stubRc({ status = 'complete', severe = false, crisisId = null, outcome = {} } = {}) {
    const run = {
        status, seed: 3, industryId: 'airline', crisisId, startYear: 2008, baseCurrency: 'EUR',
        history: [{ q: 8, severe }]
    };
    const base = {
        score: 2140, title: 'Group Treasurer', breakdown: {}, newlyUnlocked: [], isPersonalBest: false,
        rank: null, queued: true, ranked: !crisisId, storageFailed: false, ...outcome
    };
    let settle;
    const promise = new Promise(r => { settle = r; });
    return {
        run, outcome: base, started: [],
        finish() { return promise; },
        resolve(extra = {}) { settle({ ...base, ...extra }); },
        start(id, opts) { this.started.push([id, opts]); return {}; }
    };
}

function fakeApi({ rank = 4, fail = false } = {}) {
    return {
        calls: [], puts: [],
        async submitScore(p) { this.calls.push(p); if (fail) throw new Error('offline'); return { rank, best: p.score, isBest: true }; },
        async flushScoreQueue() { return 0; },
        async putRemoteProgress(p) { this.puts.push(p); return p; }
    };
}

function makeApp(rc, mode = 'simple') {
    return {
        runController: rc, content, marketReady: Promise.resolve(), gameOverMode: mode,
        shown: [], toasts: [],
        showScreen(id) { this.shown.push(id); },
        showToast(msg, type) { this.toasts.push([msg, type]); }
    };
}

function mountGameOver(app, extra = {}) {
    const cuts = [];
    const sounds = [];
    const copied = [];
    const deps = {
        playCutscene: async (container, id, opts) => { cuts.push([id, opts?.industryId, container.hidden]); },
        sound: { gameOver: () => sounds.push('gameOver'), fired: () => sounds.push('fired') },
        fetch: async () => ({ json: async () => FACTS }),
        clipboard: { writeText: async (t) => { copied.push(t); } },
        api: fakeApi(),
        storage,
        env: REDUCED,
        ...extra
    };
    const screen = new GameOverScreen(app, deps);
    const el = screen.render();
    dom.document.body.appendChild(el);
    screen.mount();
    return { screen, el, cuts, sounds, copied, deps, q: s => el.querySelector(s), qa: s => el.querySelectorAll(s) };
}

// ── Endings ───────────────────────────────────────────────────────────────

test('endings: complete, bankrupt (CFO replaced / bank called), fired by confidence, fired by a severe loss', () => {
    assert.deepEqual(endingFor('complete', false).headline, 'RUN COMPLETE');
    assert.equal(endingFor('complete', false).cutscene, null);
    const b = endingFor('bankrupt', false);
    assert.equal(b.headline, 'BANKRUPT');
    assert.match(b.sub, /bank has called/);
    assert.match(b.sub, /CFO has been replaced/);
    assert.equal(b.cutscene, 'bankrupt');
    const mood = endingFor('fired', false);
    assert.equal(mood.headline, 'FIRED');
    assert.match(mood.sub, /confidence/);
    assert.equal(mood.cutscene, 'fired');
    const severe = endingFor('fired', true);
    assert.equal(severe.headline, 'FIRED');
    assert.match(severe.sub, /severe off-policy loss/);
    for (const e of [b, mood, severe, endingFor('complete')]) assert.doesNotMatch(`${e.headline} ${e.sub}`, /strike/i);
});

test('ending quips: a confidence firing never blames one bet; a severe firing does; bankrupt uses the bankrupt list', () => {
    for (let seed = 1; seed <= 40; seed++) {
        const mood = endingQuip(content.quips, 'fired', false, cosmeticRng(seed, 30));
        assert.ok(content.quips.fired.includes(mood));
        assert.doesNotMatch(mood, /\bbet\b/i);
        assert.match(endingQuip(content.quips, 'fired', true, cosmeticRng(seed, 30)), /\bbet\b/i);
        assert.ok(content.quips.bankrupt.includes(endingQuip(content.quips, 'bankrupt', false, cosmeticRng(seed, 30))));
        assert.equal(endingQuip(content.quips, 'complete', false, cosmeticRng(seed, 30)), '');
    }
});

for (const [status, severe, headline, sub, sound] of [
    ['complete', false, 'RUN COMPLETE', /all 8 quarters/, 'gameOver'],
    ['bankrupt', false, 'BANKRUPT', /bank has called/, 'gameOver'],
    ['fired', false, 'FIRED', /confidence/, 'fired'],
    ['fired', true, 'FIRED', /severe off-policy loss/, 'fired']
]) {
    test(`Simple game over headline: ${status}${severe ? ' (severe)' : ''}`, async () => {
        const rc = stubRc({ status, severe });
        const { q, el, sounds } = mountGameOver(makeApp(rc));
        assert.equal(q('.go-headline').textContent, headline);
        assert.match(q('.go-sub').textContent, sub);
        await flush();
        assert.equal(q('.go-score').textContent, '2,140', 'counted up (reduced motion: at once) after the cutscenes');
        assert.equal(q('.go-title').textContent, 'Group Treasurer');
        assert.equal(q('.go-title-line').textContent, content.quips.gameOverTitles.find(t => t.title === 'Group Treasurer').line);
        assert.deepEqual(sounds, [sound]);
        const quip = q('.go-quip');
        if (status === 'complete') assert.equal(quip, null);
        else {
            assert.ok(content.quips[status].includes(quip.textContent));
            if (status === 'fired' && !severe) assert.doesNotMatch(quip.textContent, /\bbet\b/i, 'no off-policy-bet quip for a mood firing');
        }
        assert.doesNotMatch(el.textContent, /strike|CAREER/i);
        await flush();
    });
}

test('cutscenes: the personal best first, then the bankrupt one, in a sized overlay that hides afterwards', async () => {
    const rc = stubRc({ status: 'bankrupt', outcome: { isPersonalBest: true } });
    const { cuts, q } = mountGameOver(makeApp(rc));
    await flush();
    assert.deepEqual(cuts, [['personalBest', 'airline', false], ['bankrupt', 'airline', false]]);
    assert.equal(q('.go-cutscene').hidden, true);
    assert.equal(q('.go-pb').hidden, false);
    assert.equal(q('.go-pb').textContent, 'New personal best!');
});

test('cutscenes: a complete run with no personal best plays none', async () => {
    const { cuts, q } = mountGameOver(makeApp(stubRc({ status: 'complete' })));
    await flush();
    assert.deepEqual(cuts, []);
    assert.equal(q('.go-pb').hidden, true);
});

test('the score counts up after the cutscenes', async () => {
    let clock = 0;
    const frames = [];
    const env = { requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {}, now: () => clock };
    const rc = stubRc({ status: 'fired', outcome: { isPersonalBest: true } });
    const { q } = mountGameOver(makeApp(rc), { env });
    assert.equal(q('.go-score').textContent, '0', 'waits for the cutscenes');
    await flush();
    const step = (t) => { clock = t; const f = frames.shift(); f?.(t); };
    step(0);
    step(COUNT_MS / 2);
    const mid = Number(q('.go-score').textContent.replace(/,/g, ''));
    assert.ok(mid > 0 && mid < 2140, `mid count ${mid}`);
    step(COUNT_MS + 1);
    assert.equal(q('.go-score').textContent, '2,140');
});

// ── Rank, offline queue, storage failure, crisis ─────────────────────────

test('rank text: submitting, then the rank', async () => {
    const rc = stubRc();
    const { q } = mountGameOver(makeApp(rc));
    assert.equal(q('.go-rank').textContent, 'Submitting your score…');
    rc.resolve({ rank: 7, queued: false });
    await flush();
    assert.equal(q('.go-rank').textContent, 'Rank #7 on the leaderboard');
});

test('rank text: offline, the score is queued', async () => {
    const rc = stubRc();
    const { q } = mountGameOver(makeApp(rc));
    rc.resolve({ rank: null, queued: true });
    await flush();
    assert.equal(q('.go-rank').textContent, 'Queued, will submit when online');
});

test("rank text: storage failure says the score couldn't be saved", async () => {
    assert.equal(rankText({ ranked: true, rank: null, queued: false, storageFailed: true }),
        "Your score couldn't be saved on this device");
    assert.equal(rankText({ ranked: true, rank: 3, queued: false, storageFailed: true }),
        "Rank #3 on the leaderboard. Your score couldn't be saved on this device");
    assert.equal(rankText({ ranked: true, rank: null, queued: false, storageFailed: false }), 'Score submitted');
    const rc = stubRc({ outcome: { storageFailed: true, queued: false } });
    const { q } = mountGameOver(makeApp(rc));
    rc.resolve({ rank: null, queued: false, storageFailed: true });
    await flush();
    assert.match(q('.go-rank').textContent, /couldn't be saved/);
});

test('crisis runs: a badge only, never a rank', async () => {
    const won = stubRc({ status: 'complete', crisisId: 'gfc2008', outcome: { ranked: false, queued: false } });
    const a = mountGameOver(makeApp(won));
    won.resolve();
    await flush();
    assert.match(a.q('.go-rank').textContent, /^Crisis badge earned: /);
    assert.doesNotMatch(a.q('.go-rank').textContent, /#\d|Rank|Queued|Submitting/);
    assert.doesNotMatch(a.q('.go-rank').textContent, /gfc2008/, 'a label, never the raw id');
    a.el.remove();

    const lost = stubRc({ status: 'bankrupt', crisisId: 'gfc2008', outcome: { ranked: false, queued: false } });
    const b = mountGameOver(makeApp(lost));
    lost.resolve();
    await flush();
    assert.doesNotMatch(b.q('.go-rank').textContent, /#\d|Rank|Queued|Submitting/);
    assert.match(b.q('.go-rank').textContent, /badge/);
});

// ── Year, unlocks, share, play again ──────────────────────────────────────

test('the hidden start year is revealed with its fact', async () => {
    const { q } = mountGameOver(makeApp(stubRc()));
    await flush();
    await flush();
    assert.equal(q('.go-year').hidden, false);
    assert.equal(q('.go-year-title').textContent, 'Your hidden year was 2008');
    assert.equal(q('.go-year-headline').textContent, 'The Global Financial Crisis');
    assert.equal(q('.go-year-fact').textContent, 'Lehman fell.');
});

test('newly unlocked items are listed by name, never by id', async () => {
    const rc = stubRc({ outcome: { newlyUnlocked: ['mode:pro', 'powerup:visibility', 'industry:pharma'] } });
    const { q, qa } = mountGameOver(makeApp(rc));
    assert.equal(q('.go-unlocks').hidden, false);
    assert.deepEqual(qa('.go-unlocks li').map(li => li.textContent), ['Pro mode', 'Cash Visibility', 'MedGlobal Labs']
        .map((v, i) => i === 1 ? content.powerups.visibility.name : v));
    await flush();
});

test('share copies a score line', async () => {
    const { q, copied, screen } = mountGameOver(makeApp(stubRc()));
    q('.go-share').click();
    await flush();
    assert.equal(copied.length, 1);
    assert.match(copied[0], /2,140/);
    assert.match(copied[0], /Group Treasurer/);
    assert.match(copied[0], /SkyBridge Airlines/);
    assert.deepEqual(screen.app.toasts.at(-1)[1], 'success');
});

test('PLAY AGAIN starts a new run of the same industry in one tap', async () => {
    const rc = stubRc({ status: 'bankrupt' });
    const app = makeApp(rc);
    const { q } = mountGameOver(app);
    q('.go-again').click();
    q('.go-again').click();
    await flush();
    assert.deepEqual(rc.started, [['airline', {}]]);
    assert.deepEqual(app.shown, ['quarter']);
});

test('PLAY AGAIN on a crisis replays the crisis', async () => {
    const rc = stubRc({ crisisId: 'gfc2008', outcome: { ranked: false } });
    const app = makeApp(rc);
    mountGameOver(app).q('.go-again').click();
    await flush();
    assert.deepEqual(rc.started, [['airline', { crisisId: 'gfc2008' }]]);
});

// ── Pro (R6) ──────────────────────────────────────────────────────────────

function proState({ status, severe = false, legacy = {} }) {
    const summary = {
        q: 3, policy: 'off', inMandate: false, playerDelta: -4e6, benchmarkDelta: -1e6, marketResult: -4e6,
        breach: 'loss', severe, cashAfter: 96e6, benchmarkCashAfter: 99e6, redLine: 20e6, boardMoodAfter: 8, lines: [],
        event: null, powerUp: null
    };
    const history = [{ ...summary, q: 1, breach: 'none', policy: 'in', inMandate: true, marketResult: 1e6, playerDelta: 1e6 },
        { ...summary, q: 2, breach: 'none', policy: 'in', inMandate: true, marketResult: 1e6, playerDelta: 1e6 }, summary];
    gameState.update({
        gameId: 'game_99', seed: 99, startedAt: 1_700_000_000_000, industryId: 'pharma',
        industry: content.industries.find(i => i.id === 'pharma'), startYear: 2008, startingCash: 100e6,
        boardSatisfaction: 8, quarterSummaries: history, runStatus: status,
        firedByBoard: false, burnedOut: false, ...legacy
    });
    const state = gameState.get();
    gameState.update({ proResult: { mode: 'pro', status, score: scorePro(state), history } });
    return gameState.get();
}

test('Pro: the headline is keyed on proResult.status, not the legacy flags', async () => {
    proState({ status: 'fired', legacy: { burnedOut: true } });
    const a = mountGameOver(makeApp(null, 'pro'));
    assert.equal(a.q('.go-headline').textContent, 'FIRED');
    assert.match(a.q('.go-sub').textContent, /confidence/);
    assert.doesNotMatch(a.el.textContent, /BURNED OUT|escorted/i);
    await flush();
    a.el.remove();

    proState({ status: 'complete', legacy: { firedByBoard: true } });
    const b = mountGameOver(makeApp(null, 'pro'));
    assert.equal(b.q('.go-headline').textContent, 'RUN COMPLETE');
    await flush();
    b.el.remove();

    proState({ status: 'fired', severe: true });
    const c = mountGameOver(makeApp(null, 'pro'));
    assert.match(c.q('.go-sub').textContent, /severe off-policy loss/);
    await flush();
});

test('Pro: the title comes from scorePro with gameOverTitles, and the score is submitted with mode pro', async () => {
    const state = proState({ status: 'bankrupt' });
    const expected = scorePro(state, content.quips.gameOverTitles);
    const api = fakeApi({ rank: 2 });
    const { q } = mountGameOver(makeApp(null, 'pro'), { api });
    assert.equal(q('.go-headline').textContent, 'BANKRUPT');
    assert.equal(q('.go-title').textContent, expected.title);
    assert.ok(expected.title.length > 0);
    await flush();
    await flush();
    assert.equal(api.calls.length, 1);
    const p = api.calls[0];
    assert.equal(p.mode, 'pro');
    assert.equal(p.score, state.proResult.score.total);
    assert.equal(p.gameId, 'game_99');
    assert.equal(p.industryId, 'pharma');
    assert.equal(p.quartersPlayed, 3);
    assert.equal(p.email, 'ann@x.com');
    assert.equal(q('.go-rank').textContent, 'Rank #2 on the leaderboard');
    assert.deepEqual(storage.getQueuedScores(), [], 'removed from the queue once sent');
    assert.equal(storage.getProgress('ann@x.com').best.pro, state.proResult.score.total);
});

test('Pro: offline keeps the score queued; a re-render does not submit or count the run twice', async () => {
    proState({ status: 'complete' });
    const api = fakeApi({ fail: true });
    const app = makeApp(null, 'pro');
    const m = mountGameOver(app, { api });
    await flush();
    await flush();
    assert.equal(m.q('.go-rank').textContent, 'Queued, will submit when online');
    assert.equal(storage.getQueuedScores().length, 1);
    assert.equal(storage.getQueuedScores()[0].mode, 'pro');
    m.screen.unmount();
    m.screen.render();
    m.screen.mount();
    await flush();
    assert.equal(api.calls.length, 1);
    assert.equal(storage.getProgress('ann@x.com').runs, 1);
});

// ── Integration: forced bankruptcy through the real controller (brief step 3, in Node) ──

test('forced bankruptcy: result -> game over shows BANKRUPT and the score is still submitted', async () => {
    const api = fakeApi({ rank: 11 });
    const rc = new RunController({ storage, api, market: marketEngine, content, now: () => Date.now() });
    rc.start('airline', { seed: 3 });
    rc.run = { ...structuredClone(rc.run), cash: -1e12 };
    const app = makeApp(rc, null);
    app.lastQuarter = rc.playQuarter(rc.currentDecisionsDefaults());
    const result = new ResultScreen(app, { setTimeout: () => 0, clearTimeout() {} });
    result.render();
    result.mount();
    result.nextBtn.click();
    assert.deepEqual(app.shown, ['gameover']);
    assert.equal(app.gameOverMode, 'simple');
    result.unmount();

    const { q } = mountGameOver(app, { api });
    assert.equal(q('.go-headline').textContent, 'BANKRUPT');
    await flush();
    await flush();
    assert.equal(api.calls.length, 1);
    assert.equal(api.calls[0].mode, 'simple');
    assert.equal(api.calls[0].industryId, 'airline');
    assert.equal(q('.go-rank').textContent, 'Rank #11 on the leaderboard');
});

test('no finished run: BACK TO TITLE', () => {
    const app = makeApp(null, 'simple');
    const { q } = mountGameOver(app);
    q('.q-back').click();
    assert.deepEqual(app.shown, ['title']);
});
