// Pro mode (legacy dashboard desk) on v3 scoring: bug fixes and the QuarterSummary adapter (Task F1).
// Drives the real singletons headlessly, with market data loaded via loadFromObjects.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMarketData, loadIndustries } from '../helpers/loadData.js';
import { marketEngine, computeBudgetRate } from '../../js/engine/MarketEngine.js';
import { gameState } from '../../js/engine/GameState.js';
import { gameLoop } from '../../js/engine/GameLoop.js';
import { bankEngine } from '../../js/engine/BankEngine.js';
import { hedgingEngine } from '../../js/engine/HedgingEngine.js';
import { eventEngine } from '../../js/engine/EventEngine.js';
import { GAME_CONFIG, HEDGING_POLICY_TYPES, PHASE } from '../../js/utils/constants.js';
import { BALANCE } from '../../js/engine/sim/balance.js';
import { classifyBreach } from '../../js/engine/sim/SimEngine.js';
import { finalScore } from '../../js/engine/sim/score.js';
import { toQuarterSummary, scorePro, proStatus, proSceneState } from '../../js/engine/sim/proAdapter.js';

marketEngine.loadFromObjects(loadMarketData());
const industries = loadIndustries();
const near = (a, b, msg = '') => assert.ok(Math.abs(a - b) < 1e-6, `${msg} ${a} !== ${b}`);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

const START_YEAR = 2010;
const BIG_LIMIT = 1e13;

// Mirrors SetupScreen.startGame + setMarketRates, without the DOM.
function startPro({ industryId = 'airline', policyId = 'basic', seed = 4242, unlockAll = false } = {}) {
    const industry = structuredClone(industries.find(i => i.id === industryId));
    if (unlockAll) for (const e of industry.exposures) e.unlockQuarter = 0;
    gameState.reset();
    eventEngine.reset();
    gameState.initGame({
        playerName: 'Test',
        industry,
        hedgingPolicy: HEDGING_POLICY_TYPES.find(p => p.id === policyId),
        seed
    });
    gameState.update({ startYear: START_YEAR });
    bankEngine.init(2, BIG_LIMIT, gameState.getRng());

    const { exposures } = gameState.get();
    const currentRates = marketEngine.getRatesForQuarter(exposures, START_YEAR, 1);
    const budgetRates = {};
    for (const exp of exposures) {
        const br = computeBudgetRate(exp, currentRates[exp.underlying]);
        if (br !== null) budgetRates[exp.underlying] = br;
    }
    gameState.update({ currentRates, previousRates: { ...currentRates }, budgetRates });
    gameLoop.beginDecisionPhase();
}

const PRODUCT = { fx: 'fx_forward', commodity: 'commodity_future', ir: 'ir_swap' };

function bank() {
    return bankEngine.getActiveBanks()[0].id;
}

// Books one hedge the way DashboardScreen.executeHedgeViaBank does. Returns the hedge.
function book(exposureId, { notional, tenor = 1, productId } = {}) {
    const s = gameState.get();
    const exp = s.exposures.find(e => e.id === exposureId);
    const hedge = hedgingEngine.createTrade({
        exposure: exp,
        productId: productId || PRODUCT[exp.type],
        notional: notional ?? exp.quarterlyNotional * 0.5,
        tenorQuarters: tenor,
        spotRate: s.currentRates[exp.underlying],
        currentQuarter: s.totalQuartersPlayed,
        bankId: bank()
    });
    const creditUsage = hedge.productType === 'option' || hedge.productType === 'cap' ? 0
        : hedge.productType === 'swap' ? hedge.notional / 4 : hedge.notional;
    assert.equal(gameLoop.bookHedge(hedge, creditUsage), true, 'booking succeeds');
    return hedge;
}

// Mirrors DashboardScreen.endQuarter (real next-quarter rates) and the event, summary and board screens.
function playQuarter(rateOverrides = {}) {
    const s = gameState.get();
    let q = s.currentQuarter + 1;
    let y = s.startYear + s.currentYearOffset;
    if (q > 4) { q = 1; y++; }
    const end = {};
    for (const exp of s.exposures) {
        end[exp.underlying] = marketEngine.getRate(exp.underlying, y, q) ?? s.currentRates[exp.underlying];
    }
    gameState.update({ previousRates: { ...s.currentRates }, currentRates: { ...end, ...rateOverrides } });
    gameLoop.endDecisionPhase();
    if (gameState.get().phase === PHASE.EVENT) {
        const event = gameState.get().activeEvents[0];
        gameLoop.completeEvent(event, event.choices?.[0]?.id ?? null);
    }
    gameLoop.completeSummary();
    gameLoop.completeBoardReview();
    return gameState.get().quarterlyResults.at(-1);
}

// Keep every exposure at `ratio` per tenor across the policy horizon (a mandate-friendly strategy).
function hedgeToRatio(ratio) {
    const s = gameState.get();
    const horizon = Math.min(s.hedgingPolicy.hedgeHorizon, s.maxQuarters - s.totalQuartersPlayed);
    for (const exp of s.exposures) {
        for (let t = 1; t <= horizon; t++) {
            const maturity = s.totalQuartersPlayed + t;
            const have = s.hedgePortfolio
                .filter(h => h.underlying === exp.underlying && h.status === 'active' && h.maturityQuarter === maturity)
                .reduce((a, h) => a + h.notional, 0);
            const need = exp.quarterlyNotional * ratio - have;
            if (need > 1) book(exp.id, { notional: need, tenor: t });
        }
    }
}

function usedCredit() {
    return sum(bankEngine.getActiveBanks().map(b => b.usedLimit));
}

test('settled hedge frees bank credit', () => {
    startPro();
    book('fuel', { notional: 50e6, tenor: 1 });
    near(usedCredit(), 50e6, 'credit used after booking');
    playQuarter();
    assert.equal(gameState.get().hedgePortfolio.length, 0, 'hedge settled');
    near(usedCredit(), 0, 'credit released on settlement');
    assert.equal(bankEngine.getSummary().every(b => b.tradeCount === 0), true);
});

test('unwound hedge frees bank credit', () => {
    startPro();
    book('fuel', { notional: 40e6, tenor: 4 });
    near(usedCredit(), 40e6);
    const event = { id: 'test_unwind', choices: [{ id: 'unwind', label: 'Unwind', effect: { unwind_pct: 1 } }] };
    gameLoop.completeEvent(event, 'unwind');
    assert.equal(gameState.get().hedgePortfolio.length, 0, 'hedge unwound');
    near(usedCredit(), 0, 'credit released on unwind');
});

test('IR exposure P&L non-zero when EURIBOR moves', () => {
    startPro({ unlockAll: true });
    const start = marketEngine.getRate('EURIBOR', START_YEAR, 1);
    assert.ok(start > 0 && start < 0.2, `EURIBOR is a decimal, got ${start}`);
    const result = playQuarter({ EURIBOR: start + 0.01 });
    const debt = result.details.find(d => d.type === 'exposure' && d.exposureId === 'floating-debt');
    const notional = gameState.get().exposures.find(e => e.id === 'floating-debt').quarterlyNotional;
    near(debt.budgetRate, start, 'IR budget is the start-of-game rate');
    near(debt.pnl, -0.01 * notional * 0.25, 'floating-rate payer loses a quarter of interest');
    assert.notEqual(debt.pnl, 0);
});

test('IR budget at unlock is the start-of-game rate', () => {
    startPro({ policyId: 'none' });
    assert.equal(gameState.get().exposures.some(e => e.type === 'ir'), false);
    for (let i = 0; i < 6; i++) playQuarter();
    assert.ok(gameState.get().exposures.some(e => e.id === 'floating-debt'), 'IR unlocked at Q6');
    near(gameState.get().budgetRates.EURIBOR, marketEngine.getRate('EURIBOR', START_YEAR, 1));
});

test('trading costs accumulate', () => {
    startPro();
    const a = book('fuel', { notional: 40e6, tenor: 1 });
    const b = book('usd-revenue', { notional: 30e6, tenor: 2 });
    const costs = hedgingEngine.getTradingCost(a.productType, a.notional) + hedgingEngine.getTradingCost(b.productType, b.notional);
    assert.ok(costs > 0);
    let s = gameState.get();
    assert.equal(s.tradesThisQuarter, 2);
    near(s.tradingCostsThisQuarter, costs);
    near(s.totalTradingCosts, costs);

    const result = playQuarter();
    near(result.tradingCosts, costs, 'quarter result carries the costs');
    near(result.netPnL, result.exposurePnL + result.hedgePnL - costs - result.premiums, 'net P&L is net of costs');

    s = gameState.get();
    assert.equal(s.tradesThisQuarter, 0, 'per-quarter counters reset');
    assert.equal(s.tradingCostsThisQuarter, 0);
    near(s.totalTradingCosts, costs, 'running total kept');
    book('fuel', { notional: 10e6, tenor: 1 });
    near(gameState.get().totalTradingCosts, costs + hedgingEngine.getTradingCost('future', 10e6));
});

test('option premium is charged once: cash at booking, P&L in the booking quarter, not netted in MTM', () => {
    startPro();
    const cash0 = gameState.get().cashBalance;
    const opt = book('fuel', { notional: 50e6, tenor: 2, productId: 'commodity_option' });
    assert.ok(opt.premiumPaid > 0);
    near(gameState.get().cashBalance, cash0 - opt.premiumPaid, 'premium paid in cash');
    near(gameState.get().premiumsThisQuarter, opt.premiumPaid);
    const result = playQuarter();
    near(result.premiums, opt.premiumPaid);
    const held = gameState.get().hedgePortfolio.find(h => h.id === opt.id);
    assert.ok(held.currentMtm >= 0, `option MTM is intrinsic value only, got ${held.currentMtm}`);
});

test('a swap settles quarterly and is not paid out again at maturity', () => {
    startPro({ unlockAll: true });
    const start = marketEngine.getRate('EURIBOR', START_YEAR, 1);
    book('floating-debt', { notional: 1e9, tenor: 1 });
    const cash0 = gameState.get().cashBalance;
    playQuarter({ EURIBOR: start + 0.01 });
    const swap = gameState.get().quarterlyResults.at(-1).details.find(d => d.type === 'hedge');
    const quarterly = swap.mtmChange;
    near(gameState.get().cashBalance, cash0 + quarterly, 'cash moves by one quarterly settlement');
});

test('toQuarterSummary benchmarkDelta equals sum of exposure details', () => {
    startPro();
    hedgeToRatio(0.5);
    const result = playQuarter();
    const s = gameState.get();
    const summary = s.quarterSummaries.at(-1);
    const exposureDetails = result.details.filter(d => d.type === 'exposure');
    near(summary.benchmarkDelta, sum(exposureDetails.map(d => d.pnl)));
    near(summary.playerDelta, result.netPnL);
    near(summary.marketResult, result.exposurePnL + result.hedgePnL - result.tradingCosts - result.premiums);
    assert.equal(summary.q, 1);
    assert.equal(summary.inMandate, result.inMandate);
    assert.equal(summary.redLine, 0.2 * s.startingCash);
    assert.equal(summary.lines.length, exposureDetails.length);
    near(summary.cashAfter, s.startingCash + summary.playerDelta);
    near(summary.benchmarkCashAfter, s.startingCash + summary.benchmarkDelta);
    const expected = classifyBreach({ inMandate: summary.inMandate, marketResult: summary.marketResult, startingCash: s.startingCash });
    assert.equal(summary.breach, expected.breach);
    assert.equal(summary.severe, expected.severe);
});

test('toQuarterSummary classifies breaches with classifyBreach (pure)', () => {
    const state = { startingCash: 1000, boardSatisfaction: 55, quarterSummaries: [], exposures: [], eventHistory: [] };
    const mk = (inMandate, exp, hedge, costs = 0, premiums = 0) => ({
        quarter: 0, inMandate, exposurePnL: exp, hedgePnL: hedge, tradingCosts: costs, premiums,
        netPnL: exp + hedge - costs - premiums,
        details: [{ type: 'exposure', exposureId: 'x', underlying: 'EURUSD', pnl: exp, startRate: 1, currentRate: 1.1, forecastNotional: 10, realizedNotional: 10 }]
    });
    assert.equal(toQuarterSummary(state, mk(true, -500, 0)).breach, 'none');
    assert.equal(toQuarterSummary(state, mk(false, 10, 0)).breach, 'lucky');
    const loss = toQuarterSummary(state, mk(false, -100, 0));
    assert.equal(loss.breach, 'loss');
    assert.equal(loss.severe, false);
    const severe = toQuarterSummary(state, mk(false, -300, 0, 25, 25));
    near(severe.marketResult, -350);
    assert.equal(severe.breach, 'loss');
    assert.equal(severe.severe, true, '35% of starting cash is severe');
    assert.equal(severe.boardMoodAfter, 55);
    assert.equal(severe.redLine, 200);
    near(severe.lines[0].movePct, 10);
});

test('proStatus precedence: bankrupt, severe, second loss, mood, complete', () => {
    const s = (over) => ({ q: 3, breach: 'none', severe: false, cashAfter: 100, ...over });
    const opts = { boardMood: 50, maxQuarters: 8 };
    assert.equal(proStatus([s({ cashAfter: 0, breach: 'loss', severe: true })], opts), 'bankrupt');
    assert.equal(proStatus([s({ breach: 'loss', severe: true })], opts), 'fired');
    assert.equal(proStatus([s({ breach: 'loss' })], opts), 'playing');
    assert.equal(proStatus([s({ breach: 'loss' }), s({ breach: 'loss' })], opts), 'fired');
    assert.equal(proStatus([s()], { ...opts, boardMood: BALANCE.fireThreshold }), 'fired');
    assert.equal(proStatus([s()], { ...opts, walkedOut: true }), 'fired');
    assert.equal(proStatus([s({ q: 8 })], opts), 'complete');
    assert.equal(proStatus([s({ q: 7 })], opts), 'playing');
});

test('game ends at 8 quarters', () => {
    startPro({ policyId: 'none' });
    assert.equal(gameState.get().maxQuarters, 8);
    assert.equal(GAME_CONFIG.MAX_QUARTERS, 8);
    assert.equal(GAME_CONFIG.MAX_EXTENSIONS, undefined, 'extension constants removed');
    assert.equal(GAME_CONFIG.EXTENSION_QUARTERS, undefined);
    assert.equal(typeof gameState.extendGame, 'undefined', 'no extension logic');
    assert.equal(typeof gameState.canExtend, 'undefined');
    assert.equal(typeof gameLoop.extendGame, 'undefined');
    for (let i = 0; i < 7; i++) {
        playQuarter();
        assert.equal(gameState.get().phase, PHASE.DECISION, `still playing after Q${i + 1}`);
    }
    playQuarter();
    const s = gameState.get();
    assert.equal(s.phase, PHASE.GAMEOVER);
    assert.equal(s.totalQuartersPlayed, 8);
    assert.equal(s.runStatus, 'complete');
    assert.equal(s.quarterSummaries.length, 8);
    assert.equal(gameState.isGameOver(), true);
});

test('full headless Pro run reaches game over with a finite v3 score and mode pro', () => {
    startPro({ industryId: 'airline', policyId: 'basic', seed: 777 });
    let guard = 0;
    while (gameState.get().phase !== PHASE.GAMEOVER && guard++ < 20) {
        hedgeToRatio(0.5);
        playQuarter();
    }
    const s = gameState.get();
    assert.equal(s.phase, PHASE.GAMEOVER);
    assert.equal(s.totalQuartersPlayed, 8, 'a mandate-compliant run lasts the full 8 quarters');
    assert.equal(s.runStatus, 'complete');
    assert.ok(s.quarterSummaries.every(q => q.inMandate), 'the 50% ladder stays in mandate every quarter');
    const { proResult } = s;
    assert.equal(proResult.mode, 'pro');
    assert.equal(proResult.status, 'complete');
    assert.ok(Number.isFinite(proResult.score.total), `finite score, got ${proResult.score.total}`);
    assert.ok(proResult.score.total > 0);
    assert.deepEqual(proResult.score, scorePro(s));
    assert.deepEqual(scorePro(s), finalScore({
        history: s.quarterSummaries, status: 'complete', startingCash: s.startingCash, boardMood: s.boardSatisfaction
    }));
    assert.equal(proResult.history.length, 8);
    near(usedCredit(), sum(s.hedgePortfolio.map(h => h.productType === 'swap' ? h.notional / 4 : h.notional)),
        'bank credit matches the live book');
});

test('scorePro passes gameOverTitles through', () => {
    startPro({ policyId: 'none' });
    playQuarter();
    const titles = [{ min: 0, title: 'Intern', line: '' }];
    assert.equal(scorePro(gameState.get(), titles).title, 'Intern');
});

test('proSceneState maps the last QuarterSummary to a scene mood', () => {
    const base = { startingCash: 1000, exposures: [{ id: 'fuel', underlying: 'JETNWE' }, { id: 'usd', underlying: 'EURUSD' }] };
    assert.deepEqual(proSceneState({ ...base, quarterSummaries: [] }), { mood: 'calm', cashLevel: 0.5, highlight: null });
    const summary = (over) => ({
        breach: 'none', playerDelta: 0, cashAfter: 1000, redLine: 200,
        lines: [{ exposureId: 'fuel', movePct: 3 }, { exposureId: 'usd', movePct: -8 }], ...over
    });
    const calm = proSceneState({ ...base, quarterSummaries: [summary()] });
    assert.equal(calm.mood, 'calm');
    assert.equal(calm.highlight, 'EURUSD');
    near(calm.cashLevel, 0.5);
    assert.equal(proSceneState({ ...base, quarterSummaries: [summary({ breach: 'loss' })] }).mood, 'storm');
    assert.equal(proSceneState({ ...base, quarterSummaries: [summary({ cashAfter: 150 })] }).mood, 'storm');
    assert.equal(proSceneState({ ...base, quarterSummaries: [summary({ playerDelta: -30 })] }).mood, 'storm');
    assert.equal(proSceneState({ ...base, quarterSummaries: [summary({ playerDelta: 30 })] }).mood, 'boom');
    assert.equal(proSceneState({ ...base, quarterSummaries: [summary({ cashAfter: 5000 })] }).cashLevel, 1);
});

test('the Pro dashboard scene runs in the mood passed to IsometricScene.start (R17)', async (t) => {
    const { IsometricScene } = await import('../../js/ui/IsometricScene.js');
    globalThis.requestAnimationFrame = () => 1;
    globalThis.cancelAnimationFrame = () => {};
    t.after(() => { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; });
    const canvas = { width: 620, height: 200, style: {}, getContext: () => ({}) };
    const scene = new IsometricScene(canvas);
    const storm = { mood: 'storm', cashLevel: 0.2, highlight: 'JETNWE' };
    scene.start('airport', 0, 1, storm);
    assert.deepEqual(scene.loop.getState(), { industryId: 'airport', sceneState: storm });
    scene.stop();
    const calm = new IsometricScene(canvas);
    calm.start('airport', 0, 1);
    assert.equal(calm.loop.getState().sceneState.mood, 'calm', 'defaults to calm');
    calm.stop();
});
