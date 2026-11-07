// Simple-mode run creation and quarter simulation. Pure: no DOM, storage, Math.random or Date.now.

import { SeededRandom } from '../../utils/random.js';
import { forecastEngine } from '../ForecastEngine.js';
import { BALANCE } from './balance.js';
import { pickStartYear } from './startYears.js';
import { applyPowerUp, canBuyPowerUp, POWER_UPS } from './powerUps.js';
import { applyEventChoice, rollEvent } from './events.js';
import { exposureCashImpact, hedgeCashImpact, optionPremium } from './exposureMath.js';

const MAX_QUARTERS = 8;

export function activeExposures(run) {
    return run.exposures.filter(e => e.unlockQuarter <= run.quarter);
}

export function isRunOver(run) {
    return run.status !== 'playing';
}

// Calendar position of run quarter index i (0-based from the start year's Q1).
function calendar(startYear, i) {
    return { year: startYear + Math.floor(i / 4), quarter: (i % 4) + 1 };
}

export function createRun({ industry, seed, startedAt, market, crisisId = null, forcedYear = null }) {
    const rng = new SeededRandom(seed);
    const exposures = industry.exposures.map(e => ({
        id: e.id,
        type: e.type,
        underlying: e.underlying,
        direction: e.direction,
        unit: e.unit,
        quarterlyNotional: e.quarterlyNotional * BALANCE.notionalScale,
        unlockQuarter: e.unlockQuarter ?? 0,
        description: e.description ?? ''
    }));
    const { year: startYear } = pickStartYear(market, exposures, rng, { quarters: MAX_QUARTERS, forcedYear });
    const { min, max } = rng.pick(BALANCE.mandates);

    const rates = {};
    for (const e of exposures) {
        const r = market.getRate(e.underlying, startYear, 1);
        if (r !== null && r !== undefined) rates[e.underlying] = r;
    }

    const startingCash = industry.startingCash;
    return {
        version: 3,
        gameId: `${industry.id}-${(seed >>> 0).toString(36)}-${startedAt.toString(36)}`,
        seed,
        mode: 'simple',
        industryId: industry.id,
        baseCurrency: industry.baseCurrency,
        crisisId,
        startYear,
        quarter: 0,
        maxQuarters: MAX_QUARTERS,
        startingCash,
        cash: startingCash,
        benchmarkCash: startingCash,
        redLine: BALANCE.redLinePct * startingCash,
        mandate: { min, max },
        exposures,
        rates,
        powerUps: { owned: [], used: [] },
        varianceMultiplier: 1,
        boardMood: BALANCE.startMood,
        pendingEvent: null,
        chairmenMet: [],
        history: [],
        status: 'playing',
        startedAt
    };
}

function usableRate(r) {
    return typeof r === 'number' && Number.isFinite(r);
}

export function simulateQuarter(run, decisions, market, content) {
    if (isRunOver(run)) throw new Error(`Run is over (${run.status})`);
    const hedges = decisions.hedges || {};
    for (const [id, h] of Object.entries(hedges)) {
        if (typeof h !== 'number' || !(h >= 0 && h <= 1)) {
            throw new Error(`Hedge ratio for ${id} must be between 0 and 1, got ${h}`);
        }
    }

    // 1. Quarter RNG
    const rng = new SeededRandom((run.seed ^ Math.imul(run.quarter + 1, 0x9E3779B1)) >>> 0);

    // 2. Power-up purchase and event choice (A4), on a private copy
    let next = structuredClone(run);
    if (decisions.buyPowerUp) {
        if (!canBuyPowerUp(next, decisions.buyPowerUp, Object.keys(POWER_UPS))) {
            throw new Error(`Cannot buy power-up ${decisions.buyPowerUp}`);
        }
        next = applyPowerUp(next, decisions.buyPowerUp);
    }
    let quarterNotionalMult = {};
    let quarterVarianceMult = 1;
    if (next.pendingEvent) {
        const event = (content.events || []).find(e => e.id === next.pendingEvent);
        if (!decisions.eventChoice) throw new Error('eventChoice required while an event is pending');
        ({ run: next, quarterNotionalMult, quarterVarianceMult } = applyEventChoice(next, event, decisions.eventChoice));
    }

    // 3. End rates at the next calendar quarter
    const end = calendar(run.startYear, run.quarter + 1);
    const endRates = {};
    for (const [u, r] of Object.entries(next.rates)) {
        const er = market.getRate(u, end.year, end.quarter);
        endRates[u] = usableRate(er) ? er : r;
    }

    // 4. Exposures
    const variance = forecastEngine.getEffectiveVariance(Math.floor(run.quarter / 4), 0) * next.varianceMultiplier * quarterVarianceMult;
    const useOption = !!decisions.useOptions && next.powerUps.owned.includes('options');
    const product = useOption ? 'option' : 'forward';
    let playerMarket = 0;
    let benchmarkMarket = 0;
    let premiums = 0;
    // Vacuously in mandate when no active exposure has a non-zero notional (every current industry has one from Q1).
    let inMandate = true;
    const lines = [];
    for (const exp of activeExposures(next)) {
        const forecast = exp.quarterlyNotional * (quarterNotionalMult[exp.id] ?? 1);
        // Volume forecasts (fx, commodity) miss by up to ±variance; debt principal (ir) is contractual.
        // ir draws no random number.
        const realised = exp.type === 'ir' ? forecast : forecast * (1 + (rng.next() * 2 - 1) * variance);
        const h = hedges[exp.id] ?? 0;
        const hedged = h * forecast;
        const startRate = next.rates[exp.underlying];
        const endRate = endRates[exp.underlying];
        // A zero or missing start rate (or missing end rate) counts as no move.
        const moved = usableRate(startRate) && startRate !== 0 && usableRate(endRate);

        let movePct = 0;
        let exposureImpact = 0;
        let hedgeImpact = 0;
        if (moved) {
            // IR rates are decimals: report the move in percentage points ((end − start) × 100).
            movePct = exp.type === 'ir' ? (endRate - startRate) * 100 : ((endRate - startRate) / startRate) * 100;
            // `+ 0` turns -0 into 0 so the run stays deep-equal after a JSON round trip.
            exposureImpact = exposureCashImpact(exp, startRate, endRate, realised) + 0;
            hedgeImpact = hedgeCashImpact(exp, startRate, endRate, hedged, product) + 0;
        }
        const premium = useOption ? optionPremium(hedged) : 0;

        playerMarket += exposureImpact + hedgeImpact;
        benchmarkMarket += exposureImpact;
        premiums += premium;
        if (forecast !== 0 && (h < next.mandate.min || h > next.mandate.max)) inMandate = false;
        lines.push({ exposureId: exp.id, movePct, exposureImpact, hedgeImpact, realisedNotional: realised, forecastNotional: forecast });
    }

    // 5. Base operating cash flow, both sides
    const baseOcf = BALANCE.baseOcfPct * next.startingCash;
    next.cash += playerMarket - premiums + baseOcf;
    next.benchmarkCash += benchmarkMarket + baseOcf;
    next.rates = endRates;

    // 6. Mandate and breach
    const marketResult = playerMarket - premiums;
    const breach = inMandate ? 'none' : (marketResult >= 0 ? 'lucky' : 'loss');
    const playerDelta = next.cash - run.cash;
    const benchmarkDelta = next.benchmarkCash - run.benchmarkCash;

    // 7. Board mood
    let mood = next.boardMood;
    if (breach === 'none') mood += BALANCE.mood.inMandate;
    else if (breach === 'lucky') mood += BALANCE.mood.luckyBreach;
    else mood += BALANCE.mood.breachLoss;
    if (playerDelta >= benchmarkDelta) mood += BALANCE.mood.beatBenchmark;
    if (next.cash < next.redLine) mood += BALANCE.mood.redZone;
    next.boardMood = Math.min(100, Math.max(0, mood));

    next.quarter = run.quarter + 1;
    const summary = {
        q: next.quarter,
        inMandate,
        playerDelta,
        benchmarkDelta,
        marketResult,
        breach,
        cashAfter: next.cash,
        benchmarkCashAfter: next.benchmarkCash,
        redLine: next.redLine,
        boardMoodAfter: next.boardMood,
        lines,
        event: run.pendingEvent ? { id: run.pendingEvent, choice: decisions.eventChoice ?? null } : null,
        powerUp: decisions.buyPowerUp ?? null
    };
    next.history = [...next.history, summary];

    // 8. Status
    const losses = next.history.filter(s => s.breach === 'loss').length;
    if (next.cash <= 0) next.status = 'bankrupt';
    else if (losses >= BALANCE.breachLossesToFire) next.status = 'fired';
    else if (next.boardMood <= BALANCE.fireThreshold) next.status = 'fired';
    else if (next.quarter >= next.maxQuarters) next.status = 'complete';

    // 9. Next event (only while the run continues)
    next.pendingEvent = null;
    if (next.status === 'playing' && rng.chance(BALANCE.eventChance)) {
        next.pendingEvent = rollEvent(next, content.events || [], rng);
    }

    return { run: next, summary };
}
