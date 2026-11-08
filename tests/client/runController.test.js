import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadJson, loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { simulateQuarter, isRunOver } from '../../js/engine/sim/SimEngine.js';
import { emptyProgress } from '../../js/engine/sim/progress.js';
import { CHAIRMAN_SPRITES } from '../../js/ui/pixel/sprites.js';
import * as storage from '../../js/utils/storage.js';
import {
    RunController, boardLineKey, resultQuipKey, chairmanFor, CHAIRMAN_QUARTERS
} from '../../js/screens/simple/RunController.js';

marketEngine.loadFromObjects(loadMarketData());

class FakeStorage {
    constructor() { this.m = new Map(); }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
    setItem(k, v) { this.m.set(k, String(v)); }
    removeItem(k) { this.m.delete(k); }
}

const EMAIL = 'ann@x.com';
const T0 = 1_700_000_000_000;
const content = {
    industries: loadIndustries(),
    events: loadJson('data/simple-events.json').events,
    quips: loadJson('data/quips.json'),
    powerups: loadJson('data/powerups.json')
};

// Fake api: records submissions; `fail` makes submitScore reject like an offline device.
function fakeApi({ fail = false } = {}) {
    const api = {
        submitted: [], flushes: 0, puts: [],
        async submitScore(payload) {
            if (fail) throw Object.assign(new Error('offline'), { status: 0 });
            api.submitted.push(payload);
            return { rank: 7, best: payload.score, isBest: true };
        },
        async flushScoreQueue() { api.flushes++; return 0; },
        async getRemoteProgress() { return null; },
        async putRemoteProgress(p) { api.puts.push(p); return p; }
    };
    return api;
}

function controller(api = fakeApi()) {
    return new RunController({ storage, api, market: marketEngine, content, now: () => T0 });
}

// A sensible player: the defaults, the first event choice, and a 50-75% policy proposed to a no-policy board.
function decide(rc) {
    const d = rc.currentDecisionsDefaults();
    const run = rc.run;
    if (run.pendingEvent) d.eventChoice = content.events.find(e => e.id === run.pendingEvent).choices[0].id;
    if (run.mandate === null && run.quarter < run.maxQuarters - 1) d.proposePolicy = { min: 0.5, max: 0.75 };
    return d;
}

function playOut(rc) {
    const results = [];
    while (!isRunOver(rc.run)) results.push(rc.playQuarter(decide(rc)));
    return results;
}

// Seed 3 on the airline (a 25-50% board) completes all 8 quarters with the sensible player above (checked in the
// first test). Seed 5 draws a no-policy board, so the player proposes a policy in Q1; it also completes.
const COMPLETE_SEED = 3;
const NO_POLICY_SEED = 5;

beforeEach(() => {
    storage.setStorageBackend(new FakeStorage());
    globalThis.localStorage = new FakeStorage();
    storage.saveRegistration({ playerName: 'Ann', email: EMAIL, company: 'Co', gameToken: 't', gameTokenExpiry: T0 * 2 });
});

test('start→8×playQuarter→finish produces a score and clears the save', async () => {
    const api = fakeApi();
    const rc = controller(api);
    const run = rc.start('airline', { seed: COMPLETE_SEED });
    assert.equal(run.quarter, 0);
    assert.ok(storage.loadRun(EMAIL), 'start autosaves');

    const results = playOut(rc);
    assert.equal(results.length, 8);
    assert.equal(rc.run.status, 'complete');
    for (const r of results.slice(0, 7)) assert.equal(r.finished, null);
    assert.ok(results[7].finished instanceof Promise, 'the last quarter finishes the run');

    const out = await results[7].finished;
    assert.ok(Number.isInteger(out.score) && out.score > 0, `score ${out.score}`);
    assert.equal(typeof out.title, 'string');
    assert.equal(out.rank, 7);
    assert.equal(out.queued, false);
    assert.equal(storage.loadRun(EMAIL), null, 'the save is cleared');
    assert.deepEqual(storage.getQueuedScores(), [], 'the submitted score left the queue');

    assert.equal(api.submitted.length, 1);
    const p = api.submitted[0];
    assert.deepEqual(
        { gameId: p.gameId, email: p.email, mode: p.mode, score: p.score, quartersPlayed: p.quartersPlayed,
          startedAt: p.startedAt, industryId: p.industryId, playerName: p.playerName },
        { gameId: rc.run.gameId, email: EMAIL, mode: 'simple', score: out.score, quartersPlayed: 8,
          startedAt: T0, industryId: 'airline', playerName: 'Ann' });

    // finish() is idempotent: the same result, progress applied once.
    assert.equal(await rc.finish(), out);
    assert.equal(storage.getProgress(EMAIL).runs, 1);
});

test('resume after reload returns the same quarter', () => {
    const rc = controller();
    rc.start('airline', { seed: COMPLETE_SEED });
    for (let i = 0; i < 3; i++) rc.playQuarter(decide(rc));
    const before = rc.run;

    const reloaded = controller();
    const run = reloaded.resume(EMAIL);
    assert.equal(run.quarter, 3);
    assert.deepEqual(run, before);
    assert.deepEqual(reloaded.currentDecisionsDefaults(), rc.currentDecisionsDefaults());
    assert.equal(controller().resume('someone-else@x.com'), null, 'another player sees no run');
});

test('crisis runs are not queued for submission', async () => {
    const api = fakeApi();
    const rc = controller(api);
    const run = rc.start('airline', { crisisId: 'gfc2008', seed: 11 });
    assert.equal(run.startYear, 2008);
    assert.equal(run.crisisId, 'gfc2008');
    const results = playOut(rc);
    const out = await results.at(-1).finished;
    assert.equal(out.rank, null);
    assert.equal(out.queued, false);
    assert.deepEqual(storage.getQueuedScores(), []);
    assert.equal(api.submitted.length, 0);
    assert.equal(storage.getProgress(EMAIL).runs, 1, 'crisis runs still count toward runs');
    assert.equal(storage.getProgress(EMAIL).best.simple, 0, 'but never set a best');
    assert.throws(() => controller().start('retail', { crisisId: 'gfc2008' }), /industry/);
});

test('finish unlocks mode:pro after first run', async () => {
    const rc = controller();
    rc.start('airline', { seed: COMPLETE_SEED });
    const results = playOut(rc);
    assert.equal(rc.run.status, 'complete');
    const out = await results.at(-1).finished;
    assert.ok(out.newlyUnlocked.includes('mode:pro'));
    assert.equal(out.isPersonalBest, true);
    assert.ok(storage.getProgress(EMAIL).unlocked.includes('mode:pro'));
    assert.ok(rc.run.chairmenMet.length >= 1, 'the chairman appears at least at Q1, Q4 or Q8');
    assert.deepEqual(storage.getProgress(EMAIL).chairmenMet, rc.run.chairmenMet);
});

test('offline at game over: the score stays queued and rank is null', async () => {
    const rc = controller(fakeApi({ fail: true }));
    rc.start('airline', { seed: COMPLETE_SEED });
    const out = await playOut(rc).at(-1).finished;
    assert.equal(out.rank, null);
    assert.equal(out.queued, true);
    assert.deepEqual(storage.getQueuedScores().map(p => p.gameId), [rc.run.gameId]);
});

test('the run is deterministic: quips and the chairman never touch the simulation RNG', () => {
    const rc = controller();
    rc.start('airline', { seed: COMPLETE_SEED });
    let direct = structuredClone(rc.run);
    while (!isRunOver(rc.run)) {
        const d = decide(rc);
        direct = simulateQuarter(direct, d, marketEngine, { events: content.events }).run;
        rc.playQuarter(d);
    }
    const { chairmenMet: _a, ...viaController } = rc.run;
    const { chairmenMet: _b, ...viaEngine } = direct;
    assert.deepEqual(viaController, viaEngine);
});

test('the same seed gives the same quips and board reactions', () => {
    const play = () => {
        storage.setStorageBackend(new FakeStorage());
        const rc = controller();
        rc.start('airline', { seed: COMPLETE_SEED });
        return playOut(rc).map(r => [r.quip, r.boardReaction]);
    };
    assert.deepEqual(play(), play());
});

test('the chairman speaks at Q1, Q4 and Q8 unless the board must answer a proposal or a losing breach', () => {
    const rc = controller();
    rc.start('airline', { seed: NO_POLICY_SEED });
    assert.equal(rc.run.boardType, 'none');
    const persona = chairmanFor(rc.run.seed);
    assert.ok(Object.hasOwn(CHAIRMAN_SPRITES, persona));
    const results = playOut(rc);
    assert.equal(results[0].boardReaction.key, 'policyAdopted');
    assert.equal(results[0].boardReaction.speaker, 'board', 'the board answers the proposal, not the chairman');
    assert.equal(results[0].boardReaction.expression, 'happy');
    assert.deepEqual(rc.run.chairmenMet, [persona]);
    for (const r of results) {
        const { boardReaction: b, summary: s, quip } = r;
        assert.ok(b.line.length > 0 && b.line.length <= 90);
        assert.ok(quip.text.length > 0, `quip for ${quip.key}`);
        assert.ok(['neutral', 'happy', 'angry'].includes(b.expression));
        const big = Math.abs(s.playerDelta - s.benchmarkDelta) > 0.03 * rc.run.startingCash;
        const due = (CHAIRMAN_QUARTERS.includes(s.q) || big) && !['policyAdopted', 'breachLoss'].includes(b.key);
        assert.equal(b.speaker, due ? 'chairman' : 'board', `Q${s.q}`);
        if (due) {
            assert.equal(b.chairmanId, persona);
            assert.ok(content.quips.chairman[persona].includes(b.line));
        } else {
            assert.ok(content.quips.board[b.member.personality][b.key].includes(b.line));
        }
    }
});

test('board line precedence', () => {
    const base = { policy: 'in', breach: 'none', marketResult: 1, cashAfter: 100, redLine: 10, boardMoodAfter: 60,
        policyAdopted: null, lines: [{ hedgeImpact: 0 }] };
    const key = (over, moodBefore = 50) => boardLineKey({ ...base, ...over }, moodBefore);
    const none = { policy: 'none', breach: 'none' };
    assert.equal(key({ ...none, policyAdopted: { min: 0.5, max: 0.75 }, lines: [{ hedgeImpact: -5 }] }), 'policyAdopted');
    assert.equal(key({ ...none, lines: [{ hedgeImpact: -5 }, { hedgeImpact: 2 }] }), 'noPolicyHedgeLoss');
    assert.equal(key({ ...none, lines: [{ hedgeImpact: 5 }] }), 'noPolicyHedgeWin');
    assert.equal(key({ ...none, cashAfter: 1 }), 'noPolicyNudge');
    assert.equal(key({ policy: 'off', breach: 'loss', marketResult: -1, cashAfter: 1 }), 'breachLoss');
    assert.equal(key({ policy: 'off', breach: 'lucky', cashAfter: 1 }), 'luckyBreach');
    assert.equal(key({ marketResult: -1, cashAfter: 1 }), 'inPolicyBad');
    assert.equal(key({ cashAfter: 1 }), 'redZone');
    assert.equal(key({}, 50), 'moodUp');
    assert.equal(key({}, 70), 'moodDown');
});

test('result quip selection follows the D1 rules', () => {
    const S = 1000;
    const line = (o = {}) => ({ hedgeImpact: 0, exposureImpact: 0, hedgeRatio: 0, forecastNotional: 100, realisedNotional: 100, ...o });
    const base = { playerDelta: 0, benchmarkDelta: 0, cashAfter: 500, redLine: 200, lines: [line()] };
    const key = over => resultQuipKey({ ...base, ...over }, S);
    assert.equal(key({ lines: [line({ hedgeImpact: 21 })] }), 'bigSave');
    assert.equal(key({ benchmarkDelta: 30, playerDelta: 5 }), 'bigMiss');
    assert.equal(key({ lines: [line({ hedgeRatio: 1, realisedNotional: 80 })] }), 'overHedged');
    assert.equal(key({ cashAfter: 100 }), 'nearBankrupt');
    assert.equal(key({ lines: [line({ exposureImpact: 25 })] }), 'boom');
    assert.equal(key({}), 'calm');
});

test('default dials: band midpoint capped by the hedge limit, 0 with no policy, then the previous dials', () => {
    const rc = controller();
    rc.start('airline', { seed: COMPLETE_SEED });
    const set = (mandate, boardType) => { rc.run = { ...rc.run, mandate, boardType }; };
    const fx = rc.run.exposures.find(e => e.type === 'fx' && e.unlockQuarter === 0).id;
    const fuel = rc.run.exposures.find(e => e.type === 'commodity' && e.unlockQuarter === 0).id;

    set({ min: 0.25, max: 0.5 }, 'band');
    assert.equal(rc.currentDecisionsDefaults().hedges[fx], 0.5);
    set({ min: 0.75, max: 1 }, 'band');
    assert.equal(rc.currentDecisionsDefaults().hedges[fx], 0.5, 'capped at 50% before facilities');
    assert.equal(rc.currentDecisionsDefaults().hedges[fuel], 0, 'commodity needs hedgeAccess');
    rc.run = { ...rc.run, powerUps: { owned: ['facilities', 'hedgeAccess'], used: [] } };
    assert.equal(rc.currentDecisionsDefaults().hedges[fx], 1);
    assert.equal(rc.currentDecisionsDefaults().hedges[fuel], 1);
    set(null, 'none');
    assert.equal(rc.currentDecisionsDefaults().hedges[fx], 0);
    set({ min: 0, max: 0 }, 'noHedge');
    assert.equal(rc.currentDecisionsDefaults().hedges[fx], 0);

    set({ min: 0.5, max: 0.75 }, 'band');
    const d = rc.currentDecisionsDefaults();
    assert.deepEqual({ buyPowerUp: d.buyPowerUp, eventChoice: d.eventChoice, proposePolicy: d.proposePolicy },
        { buyPowerUp: null, eventChoice: null, proposePolicy: null });
    d.hedges[fx] = 0.25;
    if (rc.run.pendingEvent) d.eventChoice = content.events.find(e => e.id === rc.run.pendingEvent).choices[0].id;
    rc.playQuarter(d);
    assert.equal(rc.currentDecisionsDefaults().hedges[fx], 0.25, 'after Q1 the previous dial is reused');
});

test('after a policy is adopted the dials default to the new band', () => {
    const rc = controller();
    rc.start('airline', { seed: NO_POLICY_SEED });
    const fx = rc.run.exposures.find(e => e.type === 'fx' && e.unlockQuarter === 0).id;
    assert.equal(rc.currentDecisionsDefaults().hedges[fx], 0, 'no policy: no hedge');
    rc.playQuarter(decide(rc));
    assert.deepEqual(rc.run.mandate, { min: 0.5, max: 0.75 });
    assert.equal(rc.currentDecisionsDefaults().hedges[fx], 0.5, '0.625 rounds to 0.75, capped at 0.5');
});

test('progress always includes the free unlocks, even from a pre-A9 save', () => {
    storage.saveProgress(EMAIL, { version: 3, runs: 2, best: { simple: 900, pro: 0 },
        unlocked: ['industry:airline', 'powerup:forecasting'], chairmenMet: [], crisisBadges: [] });
    const rc = controller();
    const unlocked = rc.progress().unlocked;
    for (const id of emptyProgress().unlocked) assert.ok(unlocked.includes(id), id);
    rc.start('airline', { seed: COMPLETE_SEED });
    assert.ok(rc.unlockedPowerUps().includes('facilities'));
    assert.ok(!rc.unlockedPowerUps().includes('visibility'));
    assert.equal(rc.canBuy('visibility'), false, 'locked power-ups cannot be bought');
    assert.throws(() => rc.playQuarter({ ...decide(rc), buyPowerUp: 'visibility' }), /visibility/);
});

test('syncProgress merges server progress and unions the free unlocks', async () => {
    const api = fakeApi();
    api.getRemoteProgress = async () => ({ version: 3, runs: 4, best: { simple: 1800, pro: 0 },
        unlocked: ['industry:airline', 'mode:pro'], chairmenMet: ['musk'], crisisBadges: [] });
    const merged = await controller(api).syncProgress();
    assert.equal(merged.runs, 4);
    assert.ok(merged.unlocked.includes('mode:pro'));
    assert.ok(merged.unlocked.includes('powerup:hedgeAccess'));
    assert.equal(storage.getProgress(EMAIL).best.simple, 1800);
});

test('boardIntro fills in the band', () => {
    const rc = controller();
    rc.start('airline', { seed: COMPLETE_SEED });
    rc.run = { ...rc.run, mandate: { min: 0.5, max: 0.75 }, boardType: 'band' };
    const intro = rc.boardIntro();
    assert.equal(intro.band, '50–75%');
    assert.ok(intro.line.includes('50–75%') && !intro.line.includes('{band}'), intro.line);
    rc.run = { ...rc.run, mandate: null, boardType: 'none' };
    assert.ok(content.quips.boardIntro.none.includes(rc.boardIntro().line));
});

test('the pending event is returned as the event object', () => {
    const rc = controller();
    rc.start('airline', { seed: COMPLETE_SEED });
    for (const r of playOut(rc)) {
        if (r.run.pendingEvent) assert.equal(r.pendingEvent.id, r.run.pendingEvent);
        else assert.equal(r.pendingEvent, null);
    }
});

test('start needs a registered player', () => {
    globalThis.localStorage = new FakeStorage();
    assert.throws(() => controller().start('airline'), /registered/);
});

// ── Fix round 1: shared stand device (R39), late submissions, storage failures ──────────────

const B_EMAIL = 'bob@x.com';
function switchTo(email, name = 'Bob') {
    storage.clearRegistration();   // "Not you?"
    storage.saveRegistration({ playerName: name, email, company: 'Co', gameToken: `t-${email}`, gameTokenExpiry: T0 * 2 });
}

// Records which registered player each PUT was sent as; remote progress is per registered player.
function recordingApi(remoteByEmail = {}) {
    const api = fakeApi();
    api.putsBy = [];
    api.putRemoteProgress = async p => { api.putsBy.push({ as: storage.getRegistration()?.email, progress: p }); return p; };
    api.getRemoteProgress = async () => remoteByEmail[storage.getRegistration()?.email] ?? null;
    return api;
}

test('player switch after a finished run: B gets only the free unlocks, nothing of A is PUT as B', async () => {
    const api = recordingApi();
    const rc = controller(api);
    rc.start('airline', { seed: COMPLETE_SEED });
    await playOut(rc).at(-1).finished;
    assert.ok(storage.getProgress(EMAIL).unlocked.includes('mode:pro'));

    switchTo(B_EMAIL);
    assert.equal(rc.resume(B_EMAIL), null);
    assert.equal(rc.run, null);
    assert.equal(rc.email, null);
    assert.equal(rc.outcome, null);
    assert.deepEqual(rc.progress(), emptyProgress());
    assert.deepEqual(await rc.syncProgress(), emptyProgress());
    assert.deepEqual(storage.getProgress(B_EMAIL), emptyProgress());
    assert.deepEqual(api.putsBy.filter(p => p.as === B_EMAIL), []);
});

test('player switch mid-run: B cannot resume or play A\'s run, and A\'s save is kept for A', () => {
    const rc = controller(recordingApi());
    rc.start('airline', { seed: COMPLETE_SEED });
    rc.playQuarter(decide(rc));
    rc.playQuarter(decide(rc));

    switchTo(B_EMAIL);
    assert.throws(() => rc.playQuarter({ hedges: {} }), /No run in progress/, 'detected without an explicit reset');
    assert.equal(rc.run, null);
    assert.equal(rc.resume(B_EMAIL), null);
    assert.equal(rc.resume(EMAIL), null, 'A\'s email while B is registered gives nothing');
    assert.equal(rc.resume(), null);
    assert.deepEqual(rc.progress(), emptyProgress());
    assert.equal(storage.loadRun(EMAIL).quarter, 2, 'A can still resume later');

    switchTo(EMAIL, 'Ann');
    assert.equal(controller().resume(EMAIL).quarter, 2);
});

test('syncProgress never writes A\'s progress under B, even when the player changes mid-request', async () => {
    storage.saveProgress(EMAIL, { ...emptyProgress(), runs: 5, best: { simple: 2400, pro: 0 },
        unlocked: [...emptyProgress().unlocked, 'mode:pro'], chairmenMet: ['musk'] });
    const api = recordingApi();
    let release;
    api.getRemoteProgress = () => new Promise(r => { release = r; });
    const rc = controller(api);
    const pending = rc.syncProgress();
    switchTo(B_EMAIL);
    release({ ...emptyProgress(), runs: 9 });
    const result = await pending;
    assert.deepEqual(result, emptyProgress(), 'B is now registered: B\'s (empty) progress');
    assert.deepEqual(storage.getProgress(B_EMAIL), emptyProgress());
    assert.equal(storage.getProgress(EMAIL).runs, 5, 'A\'s local progress is untouched by the late response');
});

test('a submission that resolves after the player switched neither PUTs as B nor sets an outcome', async () => {
    const api = recordingApi();
    let release;
    api.submitScore = () => new Promise(r => { release = r; });
    const rc = controller(api);
    rc.start('airline', { seed: COMPLETE_SEED });
    const finished = playOut(rc).at(-1).finished;
    switchTo(B_EMAIL);
    rc.reset();
    release({ rank: 3, best: 1, isBest: true });
    const out = await finished;
    assert.equal(out.rank, 3);
    assert.equal(rc.outcome, null, 'the late result does not land on the reset controller');
    assert.deepEqual(api.putsBy, [], 'no PUT once A is no longer registered');
});

test('a late submission from the last run does not overwrite the next run\'s outcome', async () => {
    const api = fakeApi();
    let release;
    api.submitScore = () => new Promise(r => { release = r; });
    const rc = controller(api);
    rc.start('airline', { seed: COMPLETE_SEED });
    const finished = playOut(rc).at(-1).finished;
    rc.start('airline', { seed: NO_POLICY_SEED });   // PLAY AGAIN while the submit is pending
    release({ rank: 3, best: 1, isBest: true });
    await finished;
    assert.equal(rc.outcome, null);
    assert.equal(rc.run.quarter, 0);
});

test('a resumed controller produces the same quip and board reaction for the next quarter', () => {
    const rc = controller();
    rc.start('airline', { seed: NO_POLICY_SEED });
    for (let i = 0; i < 3; i++) rc.playQuarter(decide(rc));
    const reloaded = controller();
    reloaded.resume(EMAIL);
    const d = decide(rc);
    const a = rc.playQuarter(d);
    const b = reloaded.playQuarter(d);
    assert.deepEqual(b.quip, a.quip);
    assert.deepEqual(b.boardReaction, a.boardReaction);
    assert.deepEqual(b.run, a.run);
});

test('a noHedge board intro shows 0%', () => {
    const rc = controller();
    rc.start('airline', { seed: COMPLETE_SEED });
    rc.run = { ...rc.run, mandate: { min: 0, max: 0 }, boardType: 'noHedge' };
    const intro = rc.boardIntro();
    assert.equal(intro.band, '0%');
    assert.ok(intro.line.length > 0 && !intro.line.includes('{band}'));
    assert.ok(content.quips.boardIntro.noHedge.map(l => l.replaceAll('{band}', '0%')).includes(intro.line));
});

test('storage write failures are flagged on the outcome', async () => {
    const failing = { ...storage, saveProgress: () => false, queueScore: () => false };
    const rc = new RunController({ storage: failing, api: fakeApi({ fail: true }), market: marketEngine, content, now: () => T0 });
    rc.start('airline', { seed: COMPLETE_SEED });
    const warn = console.warn;
    console.warn = () => {};
    try {
        const r = playOut(rc).at(-1);
        assert.equal(rc.outcome.storageFailed, true);
        assert.equal(rc.outcome.queued, false);
        assert.equal((await r.finished).storageFailed, true);
    } finally {
        console.warn = warn;
    }
});

test('a throw inside finish() does not lose the last quarter\'s result', () => {
    const broken = { ...storage, saveProgress: () => { throw new Error('quota'); } };
    const rc = new RunController({ storage: broken, api: fakeApi(), market: marketEngine, content, now: () => T0 });
    rc.start('airline', { seed: COMPLETE_SEED });
    const err = console.error;
    console.error = () => {};
    try {
        const last = playOut(rc).at(-1);
        assert.equal(last.summary.q, 8);
        assert.ok(last.quip.text && last.boardReaction.line);
        assert.equal(last.finished, null);
        assert.match(last.finishError.message, /quota/);
    } finally {
        console.error = err;
    }
});
