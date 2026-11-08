import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fakeDom.js';
import { loadJson, loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine } from '../../js/engine/MarketEngine.js';
import * as storage from '../../js/utils/storage.js';
import { RunController, boardLineKey, expressionFor } from '../../js/screens/simple/RunController.js';
import {
    ResultScreen, RESULT_MS, resultLine, moveText, impactText, unitMovePct
} from '../../js/screens/simple/ResultScreen.js';

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
const airline = content.industries.find(i => i.id === 'airline');
const exp = id => airline.exposures.find(e => e.id === id);

// A manual clock for setTimeout, so the 10 s screen runs instantly.
function fakeTimers() {
    let now = 0;
    let next = 0;
    const queue = new Map();
    return {
        setTimeout(fn, ms) { const id = ++next; queue.set(id, { at: now + ms, fn }); return id; },
        clearTimeout(id) { queue.delete(id); },
        advance(ms) {
            const until = now + ms;
            for (;;) {
                const due = [...queue].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                queue.delete(due[0]);
                now = due[1].at;
                due[1].fn();
            }
            now = until;
        },
        get pending() { return queue.size; }
    };
}

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

function mountResult(app, timers = fakeTimers()) {
    const screen = new ResultScreen(app, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
    const el = screen.render();
    dom.document.body.appendChild(el);
    screen.mount();
    return { screen, el, timers, q: s => el.querySelector(s), qa: s => el.querySelectorAll(s) };
}

function appWith(rc, lastQuarter) {
    return {
        runController: rc, content, lastQuarter, shown: [], gameOverMode: null,
        showScreen(id) { this.shown.push(id); },
        showToast() {}
    };
}

// One real quarter: airline seed 3 (a 25–50% board), default dials.
function playOne() {
    const rc = new RunController({ storage, market: marketEngine, content, now: () => 1_700_000_000_000 });
    rc.start('airline', { seed: 3 });
    const result = rc.playQuarter(rc.currentDecisionsDefaults());
    return { rc, result };
}

// ── Result-line formatting ────────────────────────────────────────────────

test('result line: "Dollar +6%. Your hedge saved €1.2m" (EURUSD falls 5.66%, so the dollar gains 6%)', () => {
    const line = { exposureId: 'usd-revenue', movePct: -5.66, exposureImpact: -2.4e6, hedgeImpact: 1.2e6 };
    assert.equal(resultLine(exp('usd-revenue'), line, 'EUR'), 'Dollar +6%. Your hedge saved €1.2m');
});

test('result line: FX move is shown from the foreign currency side, base or quote', () => {
    // EURUSD quoted as USD per EUR: up 10% means the dollar is ~9.1% weaker.
    assert.ok(Math.abs(unitMovePct(exp('usd-revenue'), 10) - (100 / 1.1 - 100)) < 1e-9);
    // Tech (USD base) earns euros on EURUSD: the euro's own move is the rate's move.
    const tech = content.industries.find(i => i.id === 'tech');
    const eurRev = tech.exposures.find(e => e.id === 'eur-revenue');
    assert.equal(unitMovePct(eurRev, 3), 3);
    assert.equal(moveText(eurRev, 3), 'Euro +3%');
    assert.equal(moveText(exp('gbp-revenue'), 0.5), 'Pound -0.5%');
});

test('result line: commodities, interest rates, unhedged and flat moves', () => {
    assert.equal(resultLine(exp('fuel'), { movePct: 12.4, exposureImpact: -9e6, hedgeImpact: 0 }, 'EUR'),
        'Jet fuel +12%. Unhedged, it cost you €9.0m');
    assert.equal(resultLine(exp('fuel'), { movePct: -8, exposureImpact: 4e6, hedgeImpact: -2e6 }, 'EUR'),
        'Jet fuel -8%. Your hedge cost €2.0m');
    assert.equal(resultLine(exp('floating-debt'), { movePct: 0.25, exposureImpact: -625e3, hedgeImpact: 0 }, 'EUR'),
        'Interest rates +0.25pp. Unhedged, it cost you €625k');
    assert.equal(resultLine(exp('usd-revenue'), { movePct: 2, exposureImpact: 3e6, hedgeImpact: 0 }, 'EUR'),
        'Dollar -2%. Unhedged, it made you €3.0m');
    assert.equal(resultLine(exp('usd-revenue'), { movePct: 0, exposureImpact: 0, hedgeImpact: 0 }, 'EUR'),
        'Dollar flat. No impact');
    assert.equal(impactText({ hedgeImpact: 0.2, exposureImpact: -0.1 }, 'EUR'), 'No impact', 'sub-unit noise is no impact');
    assert.equal(moveText(exp('floating-debt'), 0), 'Interest rates unchanged');
});

// ── Board line precedence and the sprite expression ───────────────────────

test('board line precedence: policyAdopted > no-policy > breachLoss > luckyBreach > inPolicyBad > redZone > mood', () => {
    const base = { policy: 'in', breach: 'none', marketResult: 1, cashAfter: 100, redLine: 50, boardMoodAfter: 60, lines: [] };
    const cases = [
        [{ ...base, policyAdopted: { min: 0.5, max: 0.75 }, policy: 'none', lines: [{ hedgeImpact: -5 }] }, 'policyAdopted', 'happy'],
        [{ ...base, policy: 'none', lines: [{ hedgeImpact: -5 }], cashAfter: 10 }, 'noPolicyHedgeLoss', 'angry'],
        [{ ...base, policy: 'none', lines: [{ hedgeImpact: 5 }] }, 'noPolicyHedgeWin', 'neutral'],
        [{ ...base, policy: 'none', lines: [{ hedgeImpact: 0 }] }, 'noPolicyNudge', 'neutral'],
        // breachLoss wins over the red zone and a rising mood: the angry sprite always wins.
        [{ ...base, policy: 'off', breach: 'loss', marketResult: -9, cashAfter: 10, boardMoodAfter: 90 }, 'breachLoss', 'angry'],
        // luckyBreach is mixed (neutral), even in the red zone.
        [{ ...base, policy: 'off', breach: 'lucky', cashAfter: 10 }, 'luckyBreach', 'neutral'],
        [{ ...base, marketResult: -1, cashAfter: 10 }, 'inPolicyBad', 'neutral'],
        [{ ...base, cashAfter: 10 }, 'redZone', 'angry'],
        [{ ...base, boardMoodAfter: 64 }, 'moodUp', 'happy'],
        [{ ...base, boardMoodAfter: 55 }, 'moodDown', 'angry']
    ];
    for (const [summary, key, expression] of cases) {
        assert.equal(boardLineKey(summary, 60), key);
        assert.equal(expressionFor(key), expression, key);
    }
});

test('the board card shows the reaction: sprite expression, speaker and the line for its key', () => {
    const { rc, result } = playOne();
    const lastQuarter = {
        ...result,
        boardReaction: {
            speaker: 'board', key: 'breachLoss', expression: 'angry', line: 'This was not the policy.',
            chairmanId: null, spriteId: 'aggressive', member: { index: 0, name: 'Dana <b>Ford</b>', title: 'CEO' }
        }
    };
    const { q } = mountResult(appWith(rc, lastQuarter));
    const card = q('.r-board');
    assert.equal(card.getAttribute('data-key'), 'breachLoss');
    assert.equal(q('.r-board-sprite').getAttribute('data-expression'), 'angry');
    assert.ok(card.classList.contains('is-angry'));
    assert.equal(q('.r-board-name').textContent, 'Dana <b>Ford</b>, CEO', 'names render as text');
    assert.equal(q('.r-board-line').textContent, 'This was not the policy.');
});

test('a chairman reaction is labelled with the chairman persona', () => {
    const { rc, result } = playOne();
    const lastQuarter = {
        ...result,
        boardReaction: { speaker: 'chairman', key: 'luckyBreach', expression: 'neutral', line: 'Hm.',
            chairmanId: 'buffett', spriteId: 'buffett', member: null }
    };
    const { q } = mountResult(appWith(rc, lastQuarter));
    assert.match(q('.r-board-name').textContent, /Chairman/);
    assert.equal(q('.r-board-sprite').getAttribute('data-expression'), 'neutral');
});

// ── The screen ────────────────────────────────────────────────────────────

test('renders the quarter: one line per exposure, the quip, the cash meter and a rounded board mood', () => {
    const { rc, result } = playOne();
    const { q, qa } = mountResult(appWith(rc, { ...result, run: { ...result.run, boardMood: 57.75 } }));
    assert.equal(q('h1').textContent, 'Quarter 1 results');
    const lines = qa('.r-line');
    assert.equal(lines.length, result.summary.lines.length);
    for (const [i, l] of result.summary.lines.entries()) {
        assert.equal(lines[i].getAttribute('data-exposure'), l.exposureId);
        assert.equal(lines[i].textContent, resultLine(result.run.exposures.find(e => e.id === l.exposureId), l, 'EUR'));
    }
    assert.equal(q('.r-quip').textContent, result.quip.text);
    assert.ok(result.quip.text.length > 0);
    assert.match(q('.r-mood').textContent, /^Board mood 58 \([+-]\d+\)$/);
    assert.equal(q('.cm-value').textContent.startsWith('€'), true);
    assert.ok(q('.r-scene canvas'), 'scene strip');
    assert.equal(q('.r-next').textContent, 'NEXT');
});

test('the result reveals itself over time; a tap skips the reveal, NEXT goes to the next quarter', () => {
    const { rc, result } = playOne();
    const app = appWith(rc, result);
    const { el, q, qa, timers } = mountResult(app);
    assert.ok(qa('.r-line').every(l => l.hidden), 'lines start hidden');
    assert.equal(q('.r-board').hidden, true);
    el.querySelector('.r-body').click();
    assert.ok(qa('.r-line').every(l => !l.hidden), 'a tap reveals every line');
    assert.equal(q('.r-board').hidden, false);
    assert.deepEqual(app.shown, [], 'the first tap only skips the reveal');
    q('.r-next').click();
    assert.deepEqual(app.shown, ['quarter']);
    q('.r-next').click();
    assert.deepEqual(app.shown, ['quarter'], 'a double tap advances once');
    assert.equal(timers.pending, 0, 'timers are cleared when leaving');
});

test('it advances on its own after about 10 s; a tap after the reveal also advances', () => {
    const { rc, result } = playOne();
    const app = appWith(rc, result);
    const { timers, qa } = mountResult(app);
    timers.advance(4000);
    assert.ok(qa('.r-line').every(l => !l.hidden), 'all lines shown well before the end');
    assert.deepEqual(app.shown, []);
    timers.advance(RESULT_MS - 4000);
    assert.deepEqual(app.shown, ['quarter']);

    const app2 = appWith(rc, result);
    const m2 = mountResult(app2);
    m2.timers.advance(5000);
    m2.q('.r-body').click();
    assert.deepEqual(app2.shown, ['quarter']);
});

test('on the last quarter NEXT goes to the Simple game over', () => {
    const rc = new RunController({ storage, market: marketEngine, content, now: () => 1_700_000_000_000 });
    rc.start('airline', { seed: 3 });
    rc.run = { ...structuredClone(rc.run), cash: -1e12 };   // forced bankruptcy (brief step 3)
    const result = rc.playQuarter(rc.currentDecisionsDefaults());
    assert.equal(result.run.status, 'bankrupt');
    const app = appWith(rc, result);
    const { q } = mountResult(app);
    q('.r-next').click();
    assert.equal(app.gameOverMode, 'simple');
    assert.deepEqual(app.shown, ['gameover']);
});

test('no quarter to show: a BACK TO TITLE button', () => {
    const app = appWith(null, null);
    const { q } = mountResult(app);
    q('.q-back').click();
    assert.deepEqual(app.shown, ['title']);
});
