// v3.2 cash clarity: the meter preview on the quarter screen, forecast ranges, and the result screen's facts line,
// cash breakdown and volume wording.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fakeDom.js';
import { loadJson, loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import * as storage from '../../js/utils/storage.js';
import { RunController } from '../../js/screens/simple/RunController.js';
import { QuarterScreen } from '../../js/screens/simple/QuarterScreen.js';
import { ResultScreen } from '../../js/screens/simple/ResultScreen.js';
import { CashMeter } from '../../js/ui/CashMeter.js';
import { TAP_GUARD_MS } from '../../js/ui/tapGuard.js';
import { cashBreakdown, factsLine, forecastRangeText, signedCash, volumeText } from '../../js/ui/labels.js';
import { createRun, simulateQuarter, isRunOver } from '../../js/engine/sim/SimEngine.js';
import { canBuyPowerUp, POWER_UP_IDS } from '../../js/engine/sim/powerUps.js';
import { SeededRandom } from '../../js/utils/random.js';

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
const airline = content.industries.find(i => i.id === 'airline');
const exp = id => airline.exposures.find(e => e.id === id);
const BAND = { min: 0.5, max: 0.75 };

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

// A manual animation clock: frames run only when the test calls tick().
function frames() {
    let t = 0;
    let queue = [];
    return {
        now: () => t,
        requestAnimationFrame: fn => { queue.push(fn); return queue.length; },
        cancelAnimationFrame: () => { queue = []; },
        matchMedia: () => ({ matches: false }),
        tick(ms) {
            t += ms;
            const q = queue;
            queue = [];
            for (const fn of q) fn(t);
        },
        // The first frame of an animation only records its start time.
        finish() { this.tick(16); this.tick(1000); }
    };
}

function quarter(seed, patch = null) {
    const rc = new RunController({ storage, market: marketEngine, content, now: () => 1_700_000_000_000 });
    rc.start('airline', { seed });
    if (patch) rc.run = { ...structuredClone(rc.run), ...patch };
    const app = { runController: rc, content, shown: [], showScreen(id) { this.shown.push(id); }, showToast() {} };
    const anim = frames();
    const screen = new QuarterScreen(app, { now: anim.now, requestAnimationFrame: anim.requestAnimationFrame,
        cancelAnimationFrame: anim.cancelAnimationFrame, matchMedia: anim.matchMedia });
    const el = screen.render();
    dom.document.body.appendChild(el);
    screen.mount();
    anim.tick(TAP_GUARD_MS);
    const q = s => el.querySelector(s);
    return { rc, screen, el, q, anim, card: id => q(`[data-exposure="${id}"]`) };
}

// ── Helpers ───────────────────────────────────────────────────────────────

test('signedCash: "+€3.0m", "-€3.0m", "+€0"', () => {
    assert.equal(signedCash(3e6, 'EUR'), '+€3.0m');
    assert.equal(signedCash(-3e6, 'EUR'), '-€3.0m');
    assert.equal(signedCash(0, 'USD'), '+$0');
    assert.equal(signedCash(-0, 'USD'), '+$0');
});

test('forecastRangeText: the volume miss as ± whole percent', () => {
    assert.equal(forecastRangeText(0.4), '±40%');
    assert.equal(forecastRangeText(0.4 * 2 / 3), '±27%');
    assert.equal(forecastRangeText(0), '±0%');
});

test('volumeText: on forecast under a 2% miss, otherwise N% under or over; over-hedged when h × forecast > realised', () => {
    const line = (realised, h = 0) => ({ realisedNotional: realised, forecastNotional: 100e6, hedgeRatio: h });
    const fx = exp('usd-revenue');
    assert.equal(volumeText(fx, line(91e6)), 'Volume 9% under forecast');
    assert.equal(volumeText(fx, line(109e6)), 'Volume 9% over forecast');
    assert.equal(volumeText(fx, line(98.1e6)), 'Volume on forecast');
    assert.equal(volumeText(fx, line(101.9e6)), 'Volume on forecast');
    assert.equal(volumeText(fx, line(98e6)), 'Volume 2% under forecast', 'a 2% miss is a miss');
    assert.equal(volumeText(fx, line(102e6)), 'Volume 2% over forecast');
    assert.equal(volumeText(fx, line(100e6)), 'Volume on forecast');
    // 100% hedged on 91% realised: the hedge is bigger than what came in.
    assert.equal(volumeText(fx, line(91e6, 1)), 'Volume 9% under forecast (over-hedged)');
    assert.equal(volumeText(fx, line(91e6, 0.9)), 'Volume 9% under forecast', '90 hedged of 91: not over');
    assert.equal(volumeText(fx, line(99e6, 1)), 'Volume on forecast', 'a miss under 2% is never called over-hedged (W3)');
    assert.equal(volumeText(fx, line(100e6, 1)), 'Volume on forecast', 'exactly on forecast is not over-hedged');
    assert.equal(volumeText(exp('fuel'), line(120e6, 0.5)), 'Volume 20% over forecast');
    // Debt principal is contractual; and old or empty lines say nothing.
    assert.equal(volumeText(exp('floating-debt'), { realisedNotional: 2e9, forecastNotional: 2e9, hedgeRatio: 0 }), '');
    assert.equal(volumeText(fx, { exposureId: 'usd-revenue', movePct: 1 }), '');
    assert.equal(volumeText(fx, line(0)), 'Volume 100% under forecast');
    assert.equal(volumeText(fx, { realisedNotional: 0, forecastNotional: 0, hedgeRatio: 0 }), '');
    assert.equal(volumeText(null, line(91e6)), '');
});

test('factsLine: each policy state', () => {
    const s = (extra) => ({ policy: 'in', riskCover: 0.62, wrongFocus: false, policyAdopted: null, ...extra });
    assert.equal(factsLine(s(), BAND), 'In policy: 62% of risk covered (board wants 50–75%)');
    assert.equal(factsLine(s({ policy: 'off', riskCover: 1 }), BAND), 'Off policy: 100% hedged, board wants 50–75%');
    // Near the band an off cover never rounds onto it (coverPercent).
    assert.equal(factsLine(s({ policy: 'off', riskCover: 0.496 }), BAND), 'Off policy: 49% hedged, board wants 50–75%');
    assert.equal(factsLine(s({ policy: 'off', riskCover: 0.6, wrongFocus: true }), BAND), 'Off policy: big exposure under-hedged');
    assert.equal(factsLine(s({ policy: 'none', riskCover: 0.3 }), null), 'No board policy yet');
    assert.equal(factsLine(s({ policy: 'none', policyAdopted: { min: 0.5, max: 0.75 } }), BAND), 'Policy adopted from next quarter');
    assert.equal(factsLine(s({ policy: 'in', riskCover: 0 }), { min: 0, max: 0 }), 'In policy: 0% of risk covered (board wants 0%)');
    assert.equal(factsLine(s({ policy: 'off', riskCover: 0.25 }), { min: 0, max: 0 }), 'Off policy: 25% hedged, board wants 0%');
    assert.equal(factsLine(s({ policy: 'in', riskCover: null }), BAND), 'In policy: nothing you can hedge yet');
    // Summaries saved before v3.1 (no riskCover), and before A9 (inMandate only).
    assert.equal(factsLine({ policy: 'in' }, BAND), 'In policy (board wants 50–75%)');
    assert.equal(factsLine({ policy: 'off' }, BAND), 'Off policy: board wants 50–75%');
    assert.equal(factsLine({ inMandate: true }, BAND), 'In policy (board wants 50–75%)');
    assert.equal(factsLine({ inMandate: false }, BAND), 'Off policy: board wants 50–75%');
    assert.equal(factsLine({ inMandate: null }, null), 'No board policy yet');
    for (const t of [factsLine(s(), BAND), factsLine(s({ policy: 'off', riskCover: 1 }), BAND)]) {
        assert.ok(t.length <= 90 && !t.includes('—'), t);
    }
});

const parts = { cashBefore: 500e6, ocf: 20e6, exposureTotal: 12e6, hedgeTotal: -14e6, eventCash: 0, addOnCost: 2.5e6 };
const withParts = extra => ({ ...parts, ...extra,
    cashAfter: (extra?.cashBefore ?? parts.cashBefore) + (extra?.ocf ?? parts.ocf) + (extra?.exposureTotal ?? parts.exposureTotal)
        + (extra?.hedgeTotal ?? parts.hedgeTotal) + (extra?.eventCash ?? parts.eventCash) - (extra?.addOnCost ?? parts.addOnCost) });

test('cashBreakdown: Operations, Market, Hedges, Add-ons then the cash change; signed, zero parts dropped', () => {
    const b = cashBreakdown(withParts(), 'USD');
    assert.deepEqual(b.parts.map(p => p.text), ['Operations +$20.0m', 'Market +$12.0m', 'Hedges -$14.0m', 'Add-ons -$2.5m']);
    assert.equal(b.total.text, 'Cash +$15.5m');
    const plain = cashBreakdown(withParts({ exposureTotal: 0, hedgeTotal: 0, addOnCost: 0 }), 'EUR');
    assert.deepEqual(plain.parts.map(p => p.text), ['Operations +€20.0m'], 'Operations always shows');
    assert.equal(plain.total.text, 'Cash +€20.0m');
    // An event's cash, and Cash Visibility paying back more than it cost (a negative add-on cost).
    const ev = cashBreakdown(withParts({ eventCash: -10e6, addOnCost: -12.5e6 }), 'EUR');
    assert.deepEqual(ev.parts.map(p => p.text),
        ['Operations +€20.0m', 'Market +€12.0m', 'Hedges -€14.0m', 'Event -€10.0m', 'Add-ons +€12.5m']);
});

test('cashBreakdown: the shown parts add up to the shown total, even when each part rounds', () => {
    const shown = t => Number(t.replace(/^[A-Za-z-]+ /, '').replace(/[€$£]/g, '').replace(/m$/, ''));
    const rng = new SeededRandom(99);
    for (let i = 0; i < 2000; i++) {
        const r = () => (rng.next() * 2 - 1) * 40e6;
        const s = withParts({ ocf: 6e6 + rng.next() * 30e6, exposureTotal: r(), hedgeTotal: r(),
            eventCash: rng.next() < 0.3 ? r() / 4 : 0, addOnCost: rng.next() < 0.5 ? rng.next() * 8e6 : 0 });
        const b = cashBreakdown(s, 'EUR');
        const sum = b.parts.reduce((a, p) => a + p.value, 0);
        assert.ok(Math.abs(sum - b.total.value) < 1e-6, `values ${sum} vs ${b.total.value}`);
        if (b.parts.every(p => p.text.endsWith('m')) && b.total.text.endsWith('m')) {
            const shownSum = b.parts.reduce((a, p) => a + shown(p.text), 0);
            assert.ok(Math.abs(shownSum - shown(b.total.text)) < 1e-6, `${b.parts.map(p => p.text).join(' · ')} = ${b.total.text}`);
        }
        assert.ok(Math.abs(b.total.value - (s.cashAfter - s.cashBefore)) <= 0.5e5 + 1e-6, 'total within display rounding');
    }
});

test('cashBreakdown: null for a summary saved before v3.2', () => {
    assert.equal(cashBreakdown({ cashAfter: 1, lines: [] }, 'EUR'), null);
    assert.equal(cashBreakdown({ ...withParts(), ocf: undefined }, 'EUR'), null);
    assert.equal(cashBreakdown(null, 'EUR'), null);
});

test('CashMeter: deltaFrom shows the change from a fixed point, hidden when there is none', async () => {
    const host = dom.document.createElement('div');
    const meter = new CashMeter(host, { currency: 'EUR' });
    const shape = { startingCash: 500e6, redLine: 100e6 };
    await meter.set({ cash: 500e6, ...shape });
    await meter.set({ cash: 497.5e6, ...shape, deltaFrom: 500e6 });
    assert.equal(host.querySelector('.cm-delta').textContent, '-€2.5m');
    assert.equal(host.querySelector('.cm-delta').hidden, false);
    await meter.set({ cash: 500e6, ...shape, deltaFrom: 500e6 });
    assert.equal(host.querySelector('.cm-delta').hidden, true, 'back where it started: no "+€2.5m" tag');
});

// ── Quarter screen ────────────────────────────────────────────────────────

test('quarter: picking a power-up drops the meter to the cash after its cost, with a tag; un-picking restores it', () => {
    const { screen, q, anim } = quarter(3);
    assert.equal(q('.cm-value').textContent, '€500.0m');
    assert.equal(q('.cm-delta').hidden, true);
    q('[data-powerup="forecasting"]').click();
    assert.equal(screen.meter.value, 497.5e6);
    assert.equal(q('.cm-delta').textContent, '-€2.5m');
    assert.equal(q('.cm-delta').hidden, false);
    assert.ok(screen.meter.displayed > 497.5e6, 'it animates down rather than jumping');
    anim.finish();
    assert.equal(q('.cm-value').textContent, '€497.5m');
    // Another pick moves the meter to that one's cost.
    q('[data-powerup="facilities"]').click();
    anim.finish();
    assert.equal(q('.cm-value').textContent, '€495.0m');
    assert.equal(q('.cm-delta').textContent, '-€5.0m');
    q('[data-powerup="facilities"]').click();   // un-pick
    assert.equal(screen.meter.value, 500e6);
    assert.ok(screen.meter.displayed < 500e6, 'it animates back');
    anim.finish();
    assert.equal(q('.cm-value').textContent, '€500.0m');
    assert.equal(q('.cm-delta').hidden, true);
});

test('quarter: a dial change does not move the meter', () => {
    const { screen, card } = quarter(3);
    card('usd-revenue').querySelector('[data-step="0.25"]').click();
    assert.equal(screen.meter.value, 500e6);
});

test('quarter: fx and commodity cards show the forecast range; Cash Forecasting narrows it (preview and owned)', () => {
    const { q, card } = quarter(3);
    assert.equal(card('usd-revenue').querySelector('.exp-forecast').textContent, 'Forecast ±40%');
    assert.equal(card('fuel').querySelector('.exp-forecast').textContent, 'Forecast ±40%');
    q('[data-powerup="forecasting"]').click();
    assert.equal(card('usd-revenue').querySelector('.exp-forecast').textContent, 'Forecast ±40% → ±27%');
    assert.equal(card('fuel').querySelector('.exp-forecast').textContent, 'Forecast ±40% → ±27%');
    q('[data-powerup="forecasting"]').click();
    assert.equal(card('usd-revenue').querySelector('.exp-forecast').textContent, 'Forecast ±40%');
    const owned = quarter(3, { forecastLevel: 2, powerUps: { owned: ['forecasting'], used: [] } });
    assert.equal(owned.card('usd-revenue').querySelector('.exp-forecast').textContent, 'Forecast ±13%');
});

test('quarter: interest-rate cards show no range; an event that changes forecast accuracy changes the range', () => {
    const { rc } = quarter(3);
    const patched = { ...structuredClone(rc.run), pendingEvent: 'hockey_stick_forecast' };
    patched.exposures = patched.exposures.map(e => ({ ...e, unlockQuarter: 0 }));
    const { q, card } = quarter(3, patched);
    assert.equal(card('floating-debt').querySelector('.exp-forecast').textContent, 'Amount known exactly');
    q('[data-choice="haircut_it"]').click();
    assert.equal(card('usd-revenue').querySelector('.exp-forecast').textContent, 'Forecast ±32%');
    q('[data-choice="hedge_to_it"]').click();
    assert.equal(card('usd-revenue').querySelector('.exp-forecast').textContent, 'Forecast ±60%');
});

// ── Result screen ─────────────────────────────────────────────────────────

function fakeTimers() {
    let now = 0;
    let next = 0;
    const queue = new Map();
    return {
        setTimeout(fn, ms) { const id = ++next; queue.set(id, { at: now + ms, fn }); return id; },
        clearTimeout(id) { queue.delete(id); },
        advance(ms) { now += ms; for (const [id, t] of [...queue]) if (t.at <= now) { queue.delete(id); t.fn(); } },
        get time() { return now; }
    };
}

function result(lastQuarter, rc) {
    const timers = fakeTimers();
    const app = { runController: rc, content, lastQuarter, shown: [], showScreen(id) { this.shown.push(id); }, showToast() {} };
    const screen = new ResultScreen(app, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, now: () => timers.time });
    const el = screen.render();
    dom.document.body.appendChild(el);
    screen.mount();
    timers.advance(TAP_GUARD_MS);
    return { el, q: s => el.querySelector(s), qa: s => el.querySelectorAll(s) };
}

function playOne(seed = 3, decisions = null) {
    const rc = new RunController({ storage, market: marketEngine, content, now: () => 1_700_000_000_000 });
    rc.start('airline', { seed });
    const d = decisions || { ...rc.currentDecisionsDefaults(), buyPowerUp: 'forecasting' };
    return { rc, res: rc.playQuarter(d) };
}

test('result: the facts line and the cash breakdown open the result, before the exposure lines', () => {
    const { rc, res } = playOne();
    const { el, q, qa } = result(res, rc);
    const facts = q('.r-facts');
    const breakdown = q('.r-breakdown');
    assert.ok(facts && breakdown);
    assert.equal(facts.textContent, factsLine(res.summary, res.run.mandate));
    const b = cashBreakdown(res.summary, 'EUR');
    assert.deepEqual(qa('.r-part').map(p => p.textContent), b.parts.map(p => p.text));
    assert.equal(q('.r-cash-total').textContent, b.total.text);
    assert.ok(qa('.r-part').some(p => p.textContent.startsWith('Add-ons -€2.5m')));
    // Order in the body: facts, breakdown, then the lines.
    const body = q('.r-body');
    const order = [...body.children].map(c => c.className);
    const at = cls => order.findIndex(c => c.split(' ').includes(cls));
    assert.ok(at('r-facts') === 0 && at('r-breakdown') === 1 && at('r-lines') > 1, order.join(' | '));
    assert.equal(facts.hidden, false, 'shown at once, not part of the reveal');
    assert.ok(!el.textContent.includes('NaN') && !el.textContent.includes('undefined'));
});

test('result: each exposure line carries the volume result', () => {
    const { rc, res } = playOne();
    const { qa } = result(res, rc);
    const lines = qa('.r-line');
    for (const [i, l] of res.summary.lines.entries()) {
        const e = res.run.exposures.find(x => x.id === l.exposureId);
        const vol = lines[i].querySelector('.r-volume');
        const want = volumeText(e, l);
        if (want) assert.equal(vol.textContent, want);
        else assert.equal(vol, null);
    }
    assert.ok(lines.some(l => l.querySelector('.r-volume')), 'fx and commodity lines have one');
});

test('result: a summary saved before v3.2 renders without the breakdown', () => {
    const { rc, res } = playOne();
    const old = structuredClone(res.summary);
    for (const k of ['cashBefore', 'ocf', 'exposureTotal', 'hedgeTotal', 'eventCash', 'addOnCost']) delete old[k];
    for (const l of old.lines) { delete l.realisedNotional; delete l.forecastNotional; }
    const { el, q, qa } = result({ ...res, summary: old }, rc);
    assert.equal(q('.r-breakdown'), null);
    assert.ok(q('.r-facts'), 'the facts line still shows');
    assert.equal(qa('.r-volume').length, 0);
    assert.ok(!el.textContent.includes('NaN') && !el.textContent.includes('undefined'));
});

test('result: across many played quarters the breakdown total matches the meter change and every line fits', () => {
    const rng = new SeededRandom(4242);
    let checked = 0;
    for (const industry of content.industries) {
        for (let seed = 1; seed <= 6; seed++) {
            let run = createRun({ industry, seed, startedAt: 1, market: marketEngine });
            while (!isRunOver(run)) {
                const hedges = Object.fromEntries(run.exposures.map(e => [e.id, rng.pick([0, 0.5, 1])]));
                const buyable = POWER_UP_IDS.filter(id => canBuyPowerUp(run, id, POWER_UP_IDS));
                const buyPowerUp = buyable.length && rng.next() < 0.5 ? rng.pick(buyable) : null;
                const eventChoice = run.pendingEvent
                    ? rng.pick(content.events.find(e => e.id === run.pendingEvent).choices).id : null;
                const { run: next, summary } = simulateQuarter(run, { hedges, buyPowerUp, eventChoice }, marketEngine, content);
                const b = cashBreakdown(summary, run.baseCurrency);
                assert.ok(b);
                assert.ok(Math.abs(b.total.value - (summary.cashAfter - summary.cashBefore)) <= 0.5e5 + 1e-6);
                for (const t of [factsLine(summary, run.mandate), ...b.parts.map(p => p.text), b.total.text,
                    ...summary.lines.map(l => volumeText(run.exposures.find(e => e.id === l.exposureId), l))]) {
                    assert.ok(t.length <= 90 && !t.includes('NaN') && !t.includes('—'), t);
                }
                checked++;
                run = next;
            }
        }
    }
    assert.ok(checked > 200);
});
