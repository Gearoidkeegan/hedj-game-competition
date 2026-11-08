// Task F2: Pro polish. Start years, IR cap valuation, the hedge lines sum and the cash meter wiring.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeDom } from '../helpers/fakeDom.js';
import { loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine, computeBudgetRate } from '../../js/engine/MarketEngine.js';
import { gameState } from '../../js/engine/GameState.js';
import { gameLoop } from '../../js/engine/GameLoop.js';
import { bankEngine } from '../../js/engine/BankEngine.js';
import { hedgingEngine } from '../../js/engine/HedgingEngine.js';
import { eventEngine } from '../../js/engine/EventEngine.js';
import { HEDGING_POLICY_TYPES, PHASE, GAME_CONFIG } from '../../js/utils/constants.js';
import { eligibleStartYears } from '../../js/engine/sim/startYears.js';
import { toQuarterSummary, proCashMeterInput } from '../../js/engine/sim/proAdapter.js';
import { boardLineKey, resultQuipKey } from '../../js/screens/simple/RunController.js';
import { CashMeter } from '../../js/ui/CashMeter.js';

marketEngine.loadFromObjects(loadMarketData());
const industries = loadIndustries();
const near = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-6, `${msg} ${a} !== ${b}`);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

function init(industryId, seed, { unlockAll = false } = {}) {
    const industry = structuredClone(industries.find(i => i.id === industryId));
    if (unlockAll) for (const e of industry.exposures) e.unlockQuarter = 0;
    gameState.reset();
    eventEngine.reset();
    gameState.initGame({
        playerName: 'T', industry, hedgingPolicy: HEDGING_POLICY_TYPES.find(p => p.id === 'basic'), seed
    });
    return industry;
}

test('Pro start years come from the real-data chooser, for every industry and several seeds', () => {
    for (const ind of industries) {
        const ok = eligibleStartYears(marketEngine, ind.exposures, GAME_CONFIG.MAX_QUARTERS);
        assert.ok(ok.length > 0, `${ind.id} has eligible years`);
        for (const seed of [1, 7, 99, 4242, 123456]) {
            init(ind.id, seed);
            const y = gameState.get().startYear;
            assert.ok(ok.includes(y), `${ind.id} seed ${seed}: ${y} has real data for every exposure`);
        }
    }
});

test('the same seed gives the same Pro start year', () => {
    init('airline', 555); const a = gameState.get().startYear;
    init('airline', 555); const b = gameState.get().startYear;
    assert.equal(a, b);
});

// ---- IR caps ----
const YEAR = 2010;
function startFloatingDebt() {
    init('airline', 4242, { unlockAll: true });
    gameState.update({ startYear: YEAR });
    bankEngine.init(2, 1e13, gameState.getRng());
    const { exposures } = gameState.get();
    const currentRates = marketEngine.getRatesForQuarter(exposures, YEAR, 1);
    const budgetRates = {};
    for (const exp of exposures) {
        const br = computeBudgetRate(exp, currentRates[exp.underlying]);
        if (br !== null) budgetRates[exp.underlying] = br;
    }
    gameState.update({ currentRates, previousRates: { ...currentRates }, budgetRates });
    gameLoop.beginDecisionPhase();
}

function bookCap(notional) {
    const s = gameState.get();
    const exp = s.exposures.find(e => e.type === 'ir');
    const hedge = hedgingEngine.createTrade({
        exposure: exp, productId: 'ir_cap', notional, tenorQuarters: 1,
        spotRate: s.currentRates[exp.underlying], currentQuarter: s.totalQuartersPlayed,
        bankId: bankEngine.getActiveBanks()[0].id
    });
    assert.equal(hedge.productType, 'cap');
    assert.equal(gameLoop.bookHedge(hedge, 0), true);
    return hedge;
}

function playQuarter(rates) {
    const s = gameState.get();
    gameState.update({ previousRates: { ...s.currentRates }, currentRates: { ...s.currentRates, ...rates } });
    gameLoop.endDecisionPhase();
    if (gameState.get().phase === PHASE.EVENT) {
        const ev = gameState.get().activeEvents[0];
        gameLoop.completeEvent(ev, ev.choices?.[0]?.id ?? null);
    }
    return gameState.get().quarterlyResults.at(-1);
}

test('an IR cap pays out when the rate ends above its strike', () => {
    startFloatingDebt();
    const hedge = bookCap(1e9);
    const cash0 = gameState.get().cashBalance;
    const result = playQuarter({ EURIBOR: hedge.strike + 0.01 });
    const d = result.details.find(x => x.type === 'hedge');
    near(d.mtmChange, 0.01 * 1e9 * 0.25, 'cap payoff = (rate - strike) x notional x 0.25');
    near(d.pnl, 0.01 * 1e9 * 0.25, 'settled value');
    near(gameState.get().cashBalance - cash0, d.mtmChange, 'paid into cash once');
});

test('an IR cap pays nothing when the rate ends below its strike', () => {
    startFloatingDebt();
    const hedge = bookCap(1e9);
    const result = playQuarter({ EURIBOR: hedge.strike - 0.01 });
    const d = result.details.find(x => x.type === 'hedge');
    assert.equal(d.mtmChange, 0);
});

// ---- proAdapter lines ----
const baseState = (over = {}) => ({
    startingCash: 1000, boardSatisfaction: 55, quarterSummaries: [], eventHistory: [],
    hedgingPolicy: { id: 'basic' }, ...over
});

function result({ details, hedgePnL, tradingCosts = 0, premiums = 0 }) {
    const exposurePnL = sum(details.filter(d => d.type === 'exposure').map(d => d.pnl));
    return {
        quarter: 0, inMandate: true, exposurePnL, hedgePnL, tradingCosts, premiums,
        netPnL: exposurePnL + hedgePnL - tradingCosts - premiums, details
    };
}
const expo = (id, underlying, pnl) => ({
    type: 'exposure', exposureId: id, underlying, exposureType: 'fx', pnl,
    startRate: 1, currentRate: 1.1, forecastNotional: 10, realizedNotional: 10
});
const hdg = (underlying, mtmChange) => ({ type: 'hedge', underlying, productType: 'forward', mtmChange, pnl: mtmChange });

test('lines sum to marketResult when a hedge has no matching exposure, and with costs and premiums', () => {
    const details = [expo('a', 'EURUSD', -50), expo('b', 'EURUSD', -20), hdg('EURUSD', 30), hdg('BRENT', 12)];
    const r = result({ details, hedgePnL: 42, tradingCosts: 3, premiums: 4 });
    const s = toQuarterSummary(baseState(), r);
    near(sum(s.lines.map(l => l.exposureImpact + l.hedgeImpact + l.costImpact)), s.marketResult, 'lines sum');
    near(sum(s.lines.map(l => l.exposureImpact)), s.benchmarkDelta, 'exposure part');
    const other = s.lines.find(l => l.exposureId === 'other');
    assert.ok(other, 'an other-hedges line carries the unattributed hedge');
    near(other.hedgeImpact, 12, 'costs are not in hedgeImpact');
    near(other.costImpact, -7);
    assert.ok(s.lines.filter(l => l.exposureId !== 'other').every(l => l.costImpact === 0));
    assert.equal(other.exposureImpact, 0);
});

test('with every hedge attributed and no costs there is no other line', () => {
    const details = [expo('a', 'EURUSD', -50), hdg('EURUSD', 30)];
    const s = toQuarterSummary(baseState(), result({ details, hedgePnL: 30 }));
    assert.equal(s.lines.length, 1);
    near(s.lines[0].exposureImpact + s.lines[0].hedgeImpact + s.lines[0].costImpact, s.marketResult);
});

test('R54: a premium-only quarter is not a hedge loss for the no-policy board', () => {
    const state = baseState({ hedgingPolicy: { id: 'none' } });
    const s = toQuarterSummary(state, result({ details: [expo('a', 'EURUSD', 0)], hedgePnL: 0, premiums: 5 }));
    assert.equal(s.policy, 'none');
    assert.ok(s.lines.some(l => l.costImpact === -5));
    assert.equal(boardLineKey(s, 55), 'noPolicyNudge');
});

test('R54: a small premium does not cancel a bigSave', () => {
    // hedge worth 30 on 1000 starting cash (3% > 2%); the premium of 15 would drop it below 2% if it counted
    const details = [expo('a', 'EURUSD', -40), hdg('EURUSD', 30)];
    const s = toQuarterSummary(baseState(), result({ details, hedgePnL: 30, premiums: 15 }));
    assert.equal(resultQuipKey(s, 1000), 'bigSave');
});

// ---- Cash meter wiring ----
let dom;
beforeEach(() => { dom = installFakeDom(); });
afterEach(() => dom.restore());

test('the cash meter takes Pro cash numbers: dashboard cash, starting cash and the red line', async () => {
    init('airline', 4242);
    gameState.update({ cashBalance: 321e6 });
    let input = proCashMeterInput(gameState.get());
    assert.equal(input.cash, gameState.get().startingCash, 'before any quarter: starting cash, not the dashboard balance');
    assert.equal(input.startingCash, gameState.get().startingCash);
    near(input.redLine, 0.2 * gameState.get().startingCash);
    const host = dom.document.createElement('div');
    const meter = new CashMeter(host, { currency: gameState.get().industry.baseCurrency });
    await meter.set(input);
    assert.equal(meter.value, gameState.get().startingCash);
    assert.ok(host.querySelector('.cm-value').textContent.length > 0);
    // After a quarter the meter shows the economic cashAfter that decides bankrupt / red zone, whatever the dashboard cash says.
    const sc = gameState.get().startingCash;
    gameState.update({ cashBalance: sc * 5, quarterSummaries: [{ cashAfter: sc * 0.1 }] });
    input = proCashMeterInput(gameState.get());
    assert.equal(input.cash, sc * 0.1);
    near(input.redLine, 0.2 * sc);
    await meter.set(input);
    assert.equal(meter.state, 'danger', 'in the red zone by cashAfter even though dashboard cash is high');
});

test('DashboardScreen shows cash with the CashMeter and the scene with SceneLoop', () => {
    const src = readFileSync(new URL('../../js/screens/DashboardScreen.js', import.meta.url), 'utf8');
    assert.match(src, /import \{ CashMeter \}/);
    assert.match(src, /proCashMeterInput\(/);
    assert.match(src, /new SceneLoop\(/);
});

test('Pro board screen uses the shared typewriter and the D1 quips', () => {
    const src = readFileSync(new URL('../../js/screens/BoardScreen.js', import.meta.url), 'utf8');
    assert.match(src, /from '\.\.\/ui\/typewriter\.js'/);
    assert.match(src, /boardLineKey\(/);
});

test('canvas widgets draw no text, and the stress label is at least 12px', () => {
    for (const f of ['HedgeLadder.js', 'StressFace.js']) {
        const src = readFileSync(new URL(`../../js/ui/${f}`, import.meta.url), 'utf8');
        assert.doesNotMatch(src, /fillText|strokeText|ctx\.font/, `${f} draws no canvas text`);
    }
    const face = readFileSync(new URL('../../js/ui/StressFace.js', import.meta.url), 'utf8');
    assert.match(face, /label\.style\.cssText = 'font-size:12px;/);
});

test('no legacy SOFR/SONIA labels in the Pro screens', () => {
    for (const f of ['SetupScreen.js', 'QuarterSummary.js', 'DashboardScreen.js', 'BoardScreen.js']) {
        const src = readFileSync(new URL(`../../js/screens/${f}`, import.meta.url), 'utf8');
        assert.doesNotMatch(src, /SOFR|SONIA/, f);
    }
});

// ---- multi-quarter cap ----
test('a 3-quarter IR cap pays each quarter, nothing extra at maturity, premium once, credit released', () => {
    startFloatingDebt();
    const s0 = gameState.get();
    const exp = s0.exposures.find(e => e.type === 'ir');
    const hedge = hedgingEngine.createTrade({
        exposure: exp, productId: 'ir_cap', notional: 1e9, tenorQuarters: 3,
        spotRate: s0.currentRates[exp.underlying], currentQuarter: s0.totalQuartersPlayed,
        bankId: bankEngine.getActiveBanks()[0].id
    });
    const cashBefore = gameState.get().cashBalance;
    assert.equal(gameLoop.bookHedge(hedge, 0), true);
    const cashBooked = gameState.get().cashBalance;
    near(cashBefore - cashBooked, hedge.premiumPaid, 'premium paid once at booking');
    const payoff = 0.01 * 1e9 * 0.25;
    for (let q = 1; q <= 3; q++) {
        const before = gameState.get().cashBalance;
        const r = playQuarter({ EURIBOR: hedge.strike + 0.01 });
        const d = r.details.find(x => x.type === 'hedge');
        near(d.mtmChange, payoff, `quarter ${q} payoff`);
        near(gameState.get().cashBalance - before, d.mtmChange, `quarter ${q}: one payoff into cash`);
        near(r.premiums, q === 1 ? hedge.premiumPaid : 0, `quarter ${q}: premium counted only in the booking quarter`);
        if (q < 3) {
            gameLoop.completeSummary(); gameLoop.completeBoardReview();
        }
    }
    assert.equal(gameState.get().hedgePortfolio.length, 0, 'matured and removed');
    assert.ok(bankEngine.getSummary().every(b => b.tradeCount === 0), 'credit released at maturity');
    near(gameState.get().cashBalance - cashBooked, 3 * payoff, 'total cash = 3 payoffs, no extra at maturity');
});
