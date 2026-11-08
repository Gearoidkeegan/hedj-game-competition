import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, key } from '../helpers/fakeDom.js';
import { loadJson, loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import { POLICY_OPTIONS } from '../../js/engine/sim/SimEngine.js';
import * as storage from '../../js/utils/storage.js';
import { RunController } from '../../js/screens/simple/RunController.js';
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

function setup(seed, { industry = 'airline', patch = null } = {}) {
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
    const screen = new QuarterScreen(app);
    const el = screen.render();
    dom.document.body.appendChild(el);
    screen.mount();
    const q = s => el.querySelector(s);
    const qa = s => el.querySelectorAll(s);
    const card = id => q(`[data-exposure="${id}"]`);
    const step = (id, v) => card(id).querySelector(`[data-step="${v}"]`);
    const run = q('.q-run');
    return { rc, app, screen, el, q, qa, card, step, run, played };
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
    const pressed = id => card(id).querySelector('[aria-pressed="true"]').getAttribute('data-step');
    assert.equal(pressed('usd-revenue'), String(d.hedges['usd-revenue']));
    assert.equal(pressed('fuel'), '0');
});

test('locked exposure: commodity dial is stuck at 0 with a one-line reason; hedgeAccess unlocks it', () => {
    const { card, q, run, played } = setup(SEED.band2550);
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
    const { q, qa, card, run, played } = setup(SEED.band2550);
    const ids = qa('[data-powerup]').map(b => b.getAttribute('data-powerup'));
    assert.deepEqual(ids, ['forecasting', 'facilities', 'hedgeAccess'], 'visibility is locked on run 1');
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
    const { q, qa, run, played } = setup(SEED.band2550, { patch: { pendingEvent: ev.id } });
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
    const { card, qa, q } = setup(SEED.band75100);
    const note = card('usd-revenue').querySelector('.hd-note');
    assert.equal(note.textContent, 'Your board wants 75–100%; your bank lines cap you at 50%');
    const first = qa('[data-powerup]')[0];
    assert.equal(first.getAttribute('data-powerup'), 'facilities');
    assert.ok(first.classList.contains('is-urgent'));
    assert.ok(first.textContent.includes("Your board's policy needs this"));
    q('[data-powerup="facilities"]').click();
    assert.equal(note.hidden, true, 'buying facilities clears the conflict');
});

test('R51: off-policy decisions need a confirm tap before RUN; ADJUST cancels', () => {
    const { q, run, played, step } = setup(SEED.band75100);
    run.click();
    assert.equal(played.length, 0, 'not played yet');
    const confirm = q('.q-confirm');
    assert.equal(confirm.hidden, false);
    assert.equal(confirm.querySelector('p').textContent, OFF_POLICY_PROMPT);
    assert.equal(OFF_POLICY_PROMPT, "Outside the board's policy — run anyway?");
    q('.q-adjust').click();
    assert.equal(confirm.hidden, true);
    assert.equal(played.length, 0);
    run.click();
    step('usd-revenue', 0.25).click();   // any change withdraws the prompt
    assert.equal(confirm.hidden, true);
    run.click();
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
    const slider = card('usd-revenue').querySelector('[role="slider"]');
    key(slider, 'ArrowLeft');
    run.click();
    assert.equal(played[0].hedges['usd-revenue'], 0.25);
});

test('a failing playQuarter shows a toast and stays on the screen', () => {
    const { rc, app, run } = setup(SEED.band2550);
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
