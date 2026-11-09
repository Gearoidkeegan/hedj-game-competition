import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, key } from '../helpers/fakeDom.js';
import { loadJson, loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { POLICY_OPTIONS } from '../../js/engine/sim/SimEngine.js';
import * as storage from '../../js/utils/storage.js';
import { RunController } from '../../js/screens/simple/RunController.js';
import { TAP_GUARD_MS } from '../../js/ui/tapGuard.js';
import { QuarterScreen, OFF_POLICY_PROMPT, offPolicyExposures } from '../../js/screens/simple/QuarterScreen.js';

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
const NUDGES = new Set(Object.values(content.quips.board).flatMap(p => p.noPolicyNudge));
const INTROS = content.quips.boardIntro;

// Airline seeds (scanned once): 3 = 25–50% board, 2 = 50–75%, 11 = 75–100%, 5 = no policy, 8 = not to hedge.
const SEED = { band2550: 3, band5075: 2, band75100: 11, none: 5, noHedge: 8 };

let dom;
beforeEach(() => {
    dom = installFakeDom();
    globalThis.localStorage = new FakeStorage();
    storage.setStorageBackend(new FakeStorage());
    storage.saveRegistration({ playerName: 'Ann', email: 'ann@x.com', company: 'X', gameToken: 't', gameTokenExpiry: Date.now() + 1e9 });
});
afterEach(() => {
    storage.setStorageBackend(null);
    delete globalThis.localStorage;
    dom.restore();
});

function setup(seed, { industry = 'airline', patch = null, settle = true } = {}) {
    const rc = new RunController({ storage, market: marketEngine, content, now: () => 1_700_000_000_000 });
    rc.start(industry, { seed });
    if (patch) rc.run = { ...structuredClone(rc.run), ...patch };
    const played = [];
    const real = rc.playQuarter.bind(rc);
    rc.playQuarter = (d) => { played.push(structuredClone(d)); return real(d); };
    const app = {
        runController: rc, content, marketReady: Promise.resolve(),
        shown: [], toasts: [],
        showScreen(id) { this.shown.push(id); },
        showToast(msg, type) { this.toasts.push([msg, type]); }
    };
    // The tap guard's clock (R53): taps in the first TAP_GUARD_MS after mount are ignored, so tests move past it.
    const clock = { t: 0 };
    const screen = new QuarterScreen(app, { now: () => clock.t });
    const el = screen.render();
    dom.document.body.appendChild(el);
    screen.mount();
    if (settle) clock.t += TAP_GUARD_MS;
    const q = s => el.querySelector(s);
    const qa = s => el.querySelectorAll(s);
    const card = id => q(`[data-exposure="${id}"]`);
    const step = (id, v) => card(id).querySelector(`[data-step="${v}"]`);
    const run = q('.q-run');
    return { rc, app, screen, el, q, qa, card, step, run, played, clock };
}

test('renders the cash meter, a 120px scene strip, one card per active exposure and RUN', () => {
    const { rc, q, qa, card, run } = setup(SEED.band2550);
    assert.equal(q('.cm-value').textContent, '€500.0m');
    const scene = q('.q-scene');
    assert.ok(scene && scene.querySelector('canvas'), 'scene strip with a canvas');
    const active = rc.run.exposures.filter(e => e.unlockQuarter <= 0).map(e => e.id);
    assert.deepEqual(qa('[data-exposure]').map(c => c.getAttribute('data-exposure')), active);
    assert.equal(card('fuel').querySelector('.exp-copy').textContent, 'You buy jet fuel in dollars');
    assert.equal(card('usd-revenue').querySelector('.exp-forecast').textContent, 'Forecast accuracy 40%');
    assert.equal(run.textContent, 'RUN THE QUARTER');
    assert.equal(q('.q-quarter').textContent, 'Quarter 1 of 8');
    assert.equal(q('.q-policy').textContent, 'Board policy: hedge 25–50% of each exposure');
    // The start year is a secret until game over.
    assert.ok(!q('.q-head').textContent.includes(String(rc.run.startYear)));
});

test('board mood is shown rounded', () => {
    const { q } = setup(SEED.band2550, { patch: { boardMood: 47.75 } });
    assert.equal(q('.q-mood').textContent, 'Board mood 48');
});

test('RUN sends the dials as decisions and goes to the result screen (2 taps)', () => {
    const { app, step, run, played } = setup(SEED.band2550);
    step('usd-revenue', 0.25).click();
    run.click();
    assert.equal(played.length, 1);
    assert.deepEqual(played[0], {
        hedges: { fuel: 0, 'usd-revenue': 0.25 }, buyPowerUp: null, eventChoice: null, proposePolicy: null
    });
    assert.deepEqual(app.shown, ['result']);
    assert.equal(app.lastQuarter.summary.q, 1);
    assert.equal(app.lastQuarter.run.quarter, 1);
});

test('the dials start at the RunController defaults', () => {
    const { rc, card } = setup(SEED.band2550);
    const d = rc.currentDecisionsDefaults();
    const pressed = id => card(id).querySelector('[aria-checked="true"]').getAttribute('data-step');
    assert.equal(pressed('usd-revenue'), String(d.hedges['usd-revenue']));
    assert.equal(pressed('fuel'), '0');
});

test('R65: on a band board the Q1 dials start at 0, so tapping RUN untouched opens the off-policy prompt', () => {
    const { card, q, run, played } = setup(SEED.band2550);
    const pressed = id => card(id).querySelector('[aria-checked="true"]').getAttribute('data-step');
    assert.equal(pressed('usd-revenue'), '0');
    assert.equal(pressed('fuel'), '0');
    run.click();
    assert.equal(played.length, 0);
    assert.equal(q('.q-confirm').hidden, false);
    assert.equal(q('.q-confirm p').textContent, OFF_POLICY_PROMPT);
});

test('locked exposure: commodity dial is stuck at 0 with a one-line reason; hedgeAccess unlocks it', () => {
    const { card, q, run, played, step } = setup(SEED.band2550);
    step('usd-revenue', 0.5).click();   // in the band, so RUN plays at once (R65: dials start at 0)
    const note = card('fuel').querySelector('.hd-note');
    assert.equal(note.hidden, false);
    assert.equal(note.textContent, "Your bank doesn't offer commodity hedging");
    assert.equal(card('fuel').querySelector('[data-step="0.25"]').disabled, true);
    q('[data-powerup="hedgeAccess"]').click();
    assert.equal(card('fuel').querySelector('[data-step="0.25"]').disabled, false);
    assert.equal(card('fuel').querySelector('[data-step="0.75"]').disabled, true, 'still capped at 50% before facilities');
    card('fuel').querySelector('[data-step="0.25"]').click();
    run.click();
    assert.equal(played[0].buyPowerUp, 'hedgeAccess');
    assert.equal(played[0].hedges.fuel, 0.25);
});

test('power-up slot: cards show blurb, cost and hedjLine; one pick at a time; tap again to drop it', () => {
    const { q, qa, card, run, played, step } = setup(SEED.band2550);
    step('usd-revenue', 0.5).click();   // in the band, so RUN plays at once (R65: dials start at 0)
    const ids = qa('[data-powerup]').map(b => b.getAttribute('data-powerup'));
    // Visibility is locked on run 1. Airline's fuel hint puts Rate & Commodity Hedging first (R57).
    assert.deepEqual(ids, ['hedgeAccess', 'forecasting', 'facilities']);
    const fc = q('[data-powerup="forecasting"]');
    assert.equal(fc.querySelector('.pu-blurb').textContent, content.powerups.forecasting.levels[0]);
    assert.equal(fc.querySelector('.pu-hedj').textContent, content.powerups.forecasting.hedjLine);
    assert.equal(fc.querySelector('.pu-cost').textContent, '€2.5m');
    fc.click();
    assert.equal(fc.getAttribute('aria-pressed'), 'true');
    assert.equal(card('usd-revenue').querySelector('.exp-forecast').textContent, 'Forecast accuracy 40% → 60%');
    q('[data-powerup="facilities"]').click();
    assert.equal(fc.getAttribute('aria-pressed'), 'false', 'picking another drops the first');
    assert.equal(card('usd-revenue').querySelector('[data-step="1"]').disabled, false, 'facilities lifts the cap at once');
    q('[data-powerup="facilities"]').click();
    assert.equal(card('usd-revenue').querySelector('[data-step="1"]').disabled, true);
    fc.click();
    run.click();
    assert.equal(played[0].buyPowerUp, 'forecasting');
});

test('forecasting card shows the next module text from levels[forecastLevel]', () => {
    const { q } = setup(SEED.band2550, { patch: { forecastLevel: 1, powerUps: { owned: ['forecasting'], used: [] } } });
    assert.equal(q('[data-powerup="forecasting"] .pu-blurb').textContent, content.powerups.forecasting.levels[1]);
    assert.equal(q('[data-exposure="usd-revenue"] .exp-forecast').textContent, 'Forecast accuracy 60%');
});

test('an event card blocks RUN until one of its two choices is picked', () => {
    const ev = content.events.find(e => e.id === 'big_export_order');
    const { q, qa, run, played, step } = setup(SEED.band2550, { patch: { pendingEvent: ev.id } });
    step('usd-revenue', 0.5).click();   // in the band, so RUN plays at once (R65: dials start at 0)
    assert.equal(q('.q-event h2').textContent, ev.title);
    const choices = qa('[data-choice]');
    assert.deepEqual(choices.map(c => c.textContent), ev.choices.map(c => c.label));
    assert.equal(run.disabled, true);
    run.click();
    assert.equal(played.length, 0);
    assert.equal(q('.q-status').textContent, 'Choose how to respond to the event first');
    choices[1].click();
    assert.equal(choices[1].getAttribute('aria-pressed'), 'true');
    assert.equal(run.disabled, false);
    run.click();
    assert.equal(played[0].eventChoice, ev.choices[1].id);
});

test('no-policy board: propose-a-policy control, nudge quip, no off-policy prompt', () => {
    const { q, qa, run, played, step } = setup(SEED.none);
    assert.equal(q('.q-policy').textContent, 'No hedging policy yet');
    const options = qa('[data-policy]');
    assert.equal(options.length, POLICY_OPTIONS.length);
    assert.deepEqual(options.map(o => o.textContent), ['25–50%', '50–75%', '75–100%', "Don't hedge"]);
    // Q1: the board intro (no-policy flavour) plus a nudge to propose.
    const lines = qa('.q-board-line').map(l => l.textContent);
    assert.ok(INTROS.none.includes(lines[0]), lines[0]);
    assert.ok(NUDGES.has(lines[1]), lines[1]);
    options[1].click();
    assert.equal(options[1].getAttribute('aria-pressed'), 'true');
    step('usd-revenue', 0.5).click();
    run.click();
    assert.equal(q('.q-confirm').hidden, true, 'no policy, nothing to be outside of');
    assert.deepEqual(played[0].proposePolicy, { min: 0.5, max: 0.75 });
});

test('a proposal can be withdrawn by tapping it again', () => {
    const { qa, run, played } = setup(SEED.none);
    const opt = qa('[data-policy]')[0];
    opt.click();
    opt.click();
    run.click();
    assert.equal(played[0].proposePolicy, null);
});

test('the propose control is hidden in the final quarter (Q8)', () => {
    const { q } = setup(SEED.none, { patch: { quarter: 7 } });
    assert.equal(q('.q-propose'), null);
    assert.equal(q('.q-quarter').textContent, 'Quarter 8 of 8');
});

test('later quarters on a no-policy board still nudge, from a board member', () => {
    const { qa, q } = setup(SEED.none, { patch: { quarter: 2 } });
    const lines = qa('.q-board-line').map(l => l.textContent);
    assert.equal(lines.length, 1);
    assert.ok(NUDGES.has(lines[0]));
    assert.ok(q('.q-board-name').textContent.length > 0);
});

test('Q1 board intro fills {band}', () => {
    const { qa } = setup(SEED.band5075);
    const line = qa('.q-board-line')[0].textContent;
    assert.ok(!line.includes('{band}'));
    assert.ok(INTROS.band.map(l => l.replaceAll('{band}', '50–75%')).includes(line), line);
    const { qa: qa2 } = setup(SEED.band5075, { patch: { quarter: 1 } });
    assert.equal(qa2('.q-board-line').length, 0, 'no intro after Q1 on a board with a policy');
});

test('the mandate band is shaded on the dials: band, 0 for noHedge, none without a policy', () => {
    const shaded = (s, id) => s.card(id).querySelectorAll('.is-band').map(b => b.getAttribute('data-step'));
    assert.deepEqual(shaded(setup(SEED.band5075), 'usd-revenue'), ['0.5', '0.75']);
    const nh = setup(SEED.noHedge);
    assert.deepEqual(shaded(nh, 'usd-revenue'), ['0']);
    assert.equal(nh.q('.q-policy').textContent, 'Board policy: no hedging (0%)');
    assert.deepEqual(shaded(setup(SEED.none), 'usd-revenue'), []);
});

test('R51: an unreachable band shows the conflict on the dial and puts facilities first, highlighted', () => {
    // hedgeAccess already owned, so airline's fuel hint (R57) doesn't take the first slot.
    const { card, qa, q } = setup(SEED.band75100, { patch: { powerUps: { owned: ['hedgeAccess'], used: [] } } });
    const note = card('usd-revenue').querySelector('.hd-note');
    assert.equal(note.textContent, 'Your board wants 75–100%; your bank lines cap you at 50%');
    const first = qa('[data-powerup]')[0];
    assert.equal(first.getAttribute('data-powerup'), 'facilities');
    assert.ok(first.classList.contains('is-urgent'));
    assert.ok(first.textContent.includes("Your board's policy needs this"));
    q('[data-powerup="facilities"]').click();
    assert.equal(note.hidden, true, 'buying facilities clears the conflict');
});

test('R57: a commodity book the bank cannot hedge yet puts Rate & Commodity Hedging first, with a one-line hint', () => {
    const hintFor = id => content.industries.find(i => i.id === id).commodityRiskHint;
    for (const id of ['airline', 'energy']) {
        const hint = hintFor(id);
        assert.ok(hint && hint.length <= 90, `${id} hint is one short line`);
        const { qa } = setup(1, { industry: id });
        const first = qa('[data-powerup]')[0];
        assert.equal(first.getAttribute('data-powerup'), 'hedgeAccess', id);
        assert.ok(first.classList.contains('is-urgent'), id);
        assert.equal(first.querySelector('.pu-urgent').textContent, hint, id);
        assert.equal(qa('.pu-urgent').length, 1, `${id}: the hint shows once, on that card only`);
    }
    assert.equal(hintFor('airline'), "Fuel is your biggest risk. Your bank can't hedge it yet.");
});

test('R57: the hedging card goes ahead of R51 facilities; facilities stays highlighted, second', () => {
    const { qa } = setup(SEED.band75100);
    const cards = qa('[data-powerup]');
    assert.deepEqual(cards.map(b => b.getAttribute('data-powerup')).slice(0, 2), ['hedgeAccess', 'facilities']);
    assert.ok(cards[1].classList.contains('is-urgent'));
    assert.ok(cards[1].textContent.includes("Your board's policy needs this"));
});

test('R57: no hint and the usual order once hedging is bought, or for an industry without a commodity hint', () => {
    const owned = setup(SEED.band2550, { patch: { powerUps: { owned: ['hedgeAccess'], used: [] } } });
    assert.equal(owned.qa('.pu-urgent').length, 0);
    assert.deepEqual(owned.qa('[data-powerup]').map(b => b.getAttribute('data-powerup')), ['forecasting', 'facilities']);
    for (const id of ['agrifoods', 'construction', 'pharma']) {
        assert.equal(content.industries.find(i => i.id === id).commodityRiskHint, undefined, id);
        const s = setup(1, { industry: id });
        assert.notEqual(s.qa('[data-powerup]')[0].getAttribute('data-powerup'), 'hedgeAccess', id);
        assert.equal(s.qa('.pu-urgent').length, s.screen.capConflict ? 1 : 0, id);
    }
});

test('R51: off-policy decisions need a confirm tap before RUN; ADJUST cancels', () => {
    const { q, run, played, step, clock } = setup(SEED.band75100);
    run.click();
    assert.equal(played.length, 0, 'not played yet');
    const confirm = q('.q-confirm');
    assert.equal(confirm.hidden, false);
    assert.equal(confirm.querySelector('p').textContent, OFF_POLICY_PROMPT);
    assert.equal(OFF_POLICY_PROMPT, "Outside the board's policy — run anyway?");
    clock.t += TAP_GUARD_MS;   // opening the prompt re-arms the tap guard
    q('.q-adjust').click();
    assert.equal(confirm.hidden, true);
    assert.equal(played.length, 0);
    run.click();
    step('usd-revenue', 0.25).click();   // any change withdraws the prompt
    assert.equal(confirm.hidden, true);
    run.click();
    clock.t += TAP_GUARD_MS;
    q('.q-run-anyway').click();
    assert.equal(played.length, 1);
    assert.equal(played[0].hedges['usd-revenue'], 0.25);
});

test('R51: with facilities bought and dials in the band, RUN plays at once', () => {
    const { q, run, played, step } = setup(SEED.band75100);
    q('[data-powerup="facilities"]').click();
    step('usd-revenue', 0.75).click();
    run.click();
    assert.equal(q('.q-confirm').hidden, true);
    assert.equal(played.length, 1);
    assert.deepEqual(played[0], {
        hedges: { fuel: 0, 'usd-revenue': 0.75 }, buyPowerUp: 'facilities', eventChoice: null, proposePolicy: null
    });
});

test('offPolicyExposures mirrors the engine: clamps to the cap, skips unhedgeable and zero-notional lines', () => {
    const rc = new RunController({ storage, market: marketEngine, content });
    const run = rc.start('airline', { seed: SEED.band5075 });
    const ids = d => offPolicyExposures(run, d, content.events).map(e => e.id);
    assert.deepEqual(ids({ hedges: { fuel: 0, 'usd-revenue': 0.5 } }), [], 'fuel is not hedgeable yet');
    assert.deepEqual(ids({ hedges: { fuel: 0, 'usd-revenue': 0.25 } }), ['usd-revenue']);
    assert.deepEqual(ids({ hedges: { 'usd-revenue': 1 } }), [], '100% clamps to the 50% cap, inside 50–75%');
    assert.deepEqual(ids({ hedges: { 'usd-revenue': 1 }, buyPowerUp: 'facilities' }), ['usd-revenue']);
    assert.deepEqual(ids({ hedges: { fuel: 0, 'usd-revenue': 0.5 }, buyPowerUp: 'hedgeAccess' }), ['fuel']);
    assert.deepEqual(offPolicyExposures({ ...run, mandate: null }, { hedges: {} }, []), []);
});

test('keyboard: arrow keys on a dial change the decision', () => {
    const { card, run, played } = setup(SEED.band2550);
    const radiogroup = card('usd-revenue').querySelector('[role="radiogroup"]');
    key(radiogroup, 'ArrowRight');   // from the Q1 default of 0 (R65) into the 25–50% band
    run.click();
    assert.equal(played[0].hedges['usd-revenue'], 0.25);
});

test('a failing playQuarter shows a toast and stays on the screen', () => {
    const { rc, app, run, step } = setup(SEED.band2550);
    step('usd-revenue', 0.5).click();   // in the band, so RUN plays at once (R65: dials start at 0)
    rc.playQuarter = () => { throw new Error('boom'); };
    const errors = [];
    const orig = console.error;
    console.error = (...a) => errors.push(a);
    try { run.click(); } finally { console.error = orig; }
    assert.deepEqual(app.shown, []);
    assert.equal(app.toasts.length, 1);
    assert.match(app.toasts[0][0], /boom/);
    assert.equal(errors.length, 1);
    assert.equal(run.disabled, false, 'RUN works again');
});

test('without a run the screen offers a way back instead of throwing', () => {
    const app = { runController: new RunController({ storage, market: marketEngine, content }), content, shown: [],
        showScreen(id) { this.shown.push(id); } };
    const screen = new QuarterScreen(app);
    const el = screen.render();
    screen.mount();
    el.querySelector('.q-back').click();
    assert.deepEqual(app.shown, ['title']);
    screen.unmount();
});

test('unmount stops the scene loop and is safe to call twice', () => {
    const { screen } = setup(SEED.band2550);
    assert.equal(screen.scene.running, true);
    screen.unmount();
    assert.equal(screen.scene, null);
    screen.unmount();
});

// ── B4 follow-ups (B2 review minors) ─────────────────────────────────────

test('Q8 on a no-policy board: no propose control and no nudge either', () => {
    const { q, qa } = setup(SEED.none, { patch: { quarter: 7 } });
    assert.equal(q('.q-propose'), null);
    assert.equal(qa('.q-board-line').filter(l => NUDGES.has(l.textContent)).length, 0);
});

test('a noHedge board at the default dials gets no confirm: RUN plays at once', () => {
    const { q, run, played } = setup(SEED.noHedge);
    run.click();
    assert.equal(q('.q-confirm').hidden, true);
    assert.equal(played.length, 1);
});

test('R51: facilities is shown greyed out, with the reason, when the board needs it and cash is short', () => {
    const { qa, q, rc } = setup(SEED.band75100, { patch: { cash: 100 } });
    const fac = q('[data-powerup="facilities"]');
    assert.ok(fac, 'still shown');
    assert.equal(qa('[data-powerup]')[0], fac, 'and first');
    assert.equal(fac.getAttribute('aria-disabled'), 'true', 'aria-disabled keeps the reason readable');
    assert.ok(fac.classList.contains('is-unaffordable'));
    assert.match(fac.querySelector('.pu-reason').textContent, /^Can't afford it yet: you have /);
    fac.click();
    assert.equal(rc.run.powerUps.owned.includes('facilities'), false);
});

test('a pending event missing from the content is dropped, so the run cannot lock', () => {
    const warnings = [];
    const warn = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));
    let screen;
    try { screen = setup(SEED.band2550, { patch: { pendingEvent: 'gone_from_events_json' } }); } finally { console.warn = warn; }
    assert.deepEqual(warnings, ['RunController: dropping unknown pending event gone_from_events_json']);
    const { q, run, played, step } = screen;
    assert.equal(q('.q-event'), null);
    assert.equal(run.disabled, false);
    step('usd-revenue', 0.5).click();   // in the band, so RUN plays at once (R65: dials start at 0)
    run.click();
    assert.ok(played.length >= 1, 'the engine accepted the quarter');
});

test('the screen reads the run through the controller accessor, not rc.run', () => {
    const { rc } = setup(SEED.band2550);
    const seen = [];
    const app = { runController: { currentRun: () => { seen.push('currentRun'); return null; },
        get run() { throw new Error('rc.run must not be read directly'); } }, content, showScreen() {} };
    const el = new QuarterScreen(app).render();
    assert.ok(seen.length >= 1);
    assert.ok(el.querySelector('.q-back'), 'the empty state offers a way back');
    assert.ok(rc);
});

test('unmount really stops the scene loop and removes its visibility listener', () => {
    const { screen } = setup(SEED.band2550);
    const loop = screen.scene;
    assert.ok(loop);
    assert.equal(loop.running, true);
    assert.equal(dom.document.listeners.get('visibilitychange')?.length || 0, 1);
    screen.unmount();
    assert.equal(loop.running, false, 'stop() was called');
    assert.equal(dom.document.listeners.get('visibilitychange')?.length || 0, 0);
});

// ── Fix round 1: a failed content load must not destroy or lock a pending event ──

test('events failed to load: the pending event is kept, nothing is saved, RUN is blocked with a retry', () => {
    const ev = content.events.find(e => e.id === 'big_export_order');
    const failed = { ...content, events: [], eventsLoaded: false };
    const rc = new RunController({ storage, market: marketEngine, content: failed, now: () => 1_700_000_000_000 });
    rc.start('airline', { seed: SEED.band2550 });
    rc.run = { ...structuredClone(rc.run), pendingEvent: ev.id };
    const saves = [];
    const realSave = storage.saveRun;
    rc._save = () => saves.push('save');
    const app = { runController: rc, content: failed, shown: [], toasts: [],
        showScreen(id) { this.shown.push(id); }, showToast(m, t) { this.toasts.push([m, t]); },
        reloadEvents: async () => { failed.events = content.events; failed.eventsLoaded = true; return true; } };
    const screen = new QuarterScreen(app);
    const el = screen.render();
    dom.document.body.appendChild(el);
    assert.equal(rc.run.pendingEvent, ev.id, 'kept');
    assert.deepEqual(saves, [], 'nothing persisted');
    assert.ok(el.querySelector('.q-event-error'));
    assert.match(el.querySelector('.q-event-error').textContent, /Couldn't load this event/);
    const runBtn = el.querySelector('.q-run');
    assert.equal(runBtn.disabled, true);
    assert.equal(el.querySelector('.q-status').textContent, "Couldn't load this event");
    runBtn.click();
    assert.deepEqual(saves, []);
    assert.ok(realSave);
    return el.querySelector('.q-retry').click(), new Promise(r => setTimeout(r, 0)).then(() => {
        assert.deepEqual(app.shown, ['quarter'], 'a successful retry rebuilds the quarter screen');
        const again = new QuarterScreen(app).render();
        assert.ok(again.querySelector('.q-event [data-choice]'), 'the event card is now shown');
    });
});

test('a failed retry toasts and stays put', async () => {
    const ev = content.events.find(e => e.id === 'big_export_order');
    const failed = { ...content, events: [], eventsLoaded: false };
    const rc = new RunController({ storage, market: marketEngine, content: failed, now: () => 1_700_000_000_000 });
    rc.start('airline', { seed: SEED.band2550 });
    rc.run = { ...structuredClone(rc.run), pendingEvent: ev.id };
    const app = { runController: rc, content: failed, shown: [], toasts: [],
        showScreen(id) { this.shown.push(id); }, showToast(m, t) { this.toasts.push([m, t]); }, reloadEvents: async () => false };
    const el = new QuarterScreen(app).render();
    el.querySelector('.q-retry').click();
    await new Promise(r => setTimeout(r, 0));
    assert.deepEqual(app.shown, []);
    assert.equal(app.toasts.length, 1);
});

test('controller: content loaded but the id is unknown drops the event and saves; not loaded keeps it', () => {
    const mk = loaded => {
        const c = { ...content, eventsLoaded: loaded, events: loaded ? content.events : [] };
        const rc = new RunController({ storage, market: marketEngine, content: c, now: () => 1_700_000_000_000 });
        rc.start('airline', { seed: SEED.band2550 });
        rc.run = { ...structuredClone(rc.run), pendingEvent: 'nope' };
        return rc;
    };
    const warn = console.warn; console.warn = () => {};
    try {
        const loaded = mk(true);
        assert.equal(loaded.currentRun().pendingEvent, null);
        assert.equal(loaded.eventMissing(), false);
        const failed = mk(false);
        assert.equal(failed.currentRun().pendingEvent, 'nope');
        assert.equal(failed.eventMissing(), true);
    } finally { console.warn = warn; }
});

test('R53: a double tap on RUN cannot confirm an off-policy quarter (the prompt re-arms the guard)', () => {
    const { q, run, played, clock } = setup(SEED.band75100);
    run.click();
    assert.equal(q('.q-confirm').hidden, false, 'off-policy prompt opens');
    clock.t += TAP_GUARD_MS - 1;
    q('.q-run-anyway').click();   // the second tap of a double tap lands in the same footer slot
    assert.equal(played.length, 0, 'RUN ANYWAY ignored inside the re-armed window');
    clock.t += 1;
    q('.q-run-anyway').click();
    assert.equal(played.length, 1);
});

test('R53: RUN ignores taps in the first 600 ms after mount (a double tap from NEXT), then works', () => {
    const { app, run, played, clock, q, step } = setup(SEED.band2550, { settle: false });
    step('usd-revenue', 0.5).click();   // in the band (R65: dials start at 0); the dials are not tap-guarded
    run.click();
    clock.t = TAP_GUARD_MS - 1;
    run.click();
    assert.deepEqual(played, [], 'taps inside the guard window are dropped');
    assert.equal(q('.q-confirm').hidden, true, 'not even the off-policy prompt opens');
    clock.t = TAP_GUARD_MS;
    run.click();
    if (app.shown.length === 0) q('.q-run-anyway').click();
    assert.equal(played.length, 1);
    assert.deepEqual(app.shown, ['result']);
});

test('each exposure card has a static sparkline when market data exists', () => {
    const { qa, screen } = setup(SEED.band2550);
    const cards = qa('.exp-card');
    assert.ok(cards.length > 0);
    assert.ok(cards.every(c => c.querySelector('.exp-spark canvas')), 'one sparkline per card');
    assert.ok(!/\b(19|20)\d\d\b/.test(qa('.exp-spark').map(s => s.textContent).join(' ')), 'no labels on a sparkline');
    screen.unmount();
});
