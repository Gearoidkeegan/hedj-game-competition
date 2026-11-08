// Simple-mode run creation and quarter simulation. Pure: no DOM, storage, Math.random or Date.now.

import { SeededRandom } from '../../utils/random.js';
import { BALANCE } from './balance.js';
import { pickStartYear } from './startYears.js';
import {
    applyPowerUp, borrowingBuffer, canBuyPowerUp, forecastVariance, isHedgeable, maxHedgeRatio, POWER_UP_IDS
} from './powerUps.js';
import { applyEventChoice, rollEvent } from './events.js';
import { exposureCashImpact, hedgeCashImpact } from './exposureMath.js';

const MAX_QUARTERS = 8;

// A9 (R43): the policies a player may propose to a no-policy board: the three bands and "not to hedge".
// Frozen: validation relies on it, so UI code must not be able to change what the engine accepts.
export const POLICY_OPTIONS = Object.freeze(BALANCE.boards
    .filter(b => b.type !== 'none')
    .map(b => Object.freeze({ min: b.min, max: b.max })));

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

const boardTypeOf = mandate => (mandate === null ? 'none' : mandate.max === 0 ? 'noHedge' : 'band');

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
    // RNG order: the start year first (no draw when forcedYear is set), then the board (one draw).
    const { year: startYear } = pickStartYear(market, exposures, rng, { quarters: MAX_QUARTERS, forcedYear });
    const board = rng.weightedPick(BALANCE.boards);
    const mandate = board.type === 'none' ? null : { min: board.min, max: board.max };

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
        mandate,
        boardType: board.type,
        exposures,
        rates,
        powerUps: { owned: [], used: [] },
        forecastLevel: 0,
        boardMood: BALANCE.startMood,
        pendingEvent: null,
        chairmenMet: [],
        history: [],
        status: 'playing',
        startedAt
    };
}

// Off mandate: 'lucky' if the market result made money, 'loss' if it lost. A loss of at least
// BALANCE.severeBreachLossPct of starting cash is severe (fires at once).
// R38: a non-finite marketResult counts as 0; a non-finite or non-positive startingCash is never severe
// (running out of cash is bankruptcy's job).
export function classifyBreach({ inMandate, marketResult, startingCash }) {
    if (inMandate) return { breach: 'none', severe: false };
    const result = Number.isFinite(marketResult) ? marketResult : 0;
    if (result >= 0) return { breach: 'lucky', severe: false };
    const severe = Number.isFinite(startingCash) && startingCash > 0
        && result <= -BALANCE.severeBreachLossPct * startingCash;
    return { breach: 'loss', severe };
}

function usableRate(r) {
    return typeof r === 'number' && Number.isFinite(r);
}

// A9 (R43): a proposal is only valid on a no-policy board, before the final quarter (it applies from the next
// quarter), and must be one of POLICY_OPTIONS.
function validateProposal(run, proposal) {
    if (run.mandate !== null) throw new Error('Cannot propose a policy: the board already has one');
    if (run.quarter >= run.maxQuarters - 1) throw new Error('Cannot propose a policy in the final quarter');
    const ok = proposal && typeof proposal === 'object'
        && POLICY_OPTIONS.some(o => o.min === proposal.min && o.max === proposal.max);
    if (!ok) throw new Error(`Invalid policy proposal: ${JSON.stringify(proposal)}`);
}

export function simulateQuarter(run, decisions, market, content) {
    if (isRunOver(run)) throw new Error(`Run is over (${run.status})`);
    const hedges = decisions.hedges || {};
    for (const [id, h] of Object.entries(hedges)) {
        if (typeof h !== 'number' || !(h >= 0 && h <= 1)) {
            throw new Error(`Hedge ratio for ${id} must be between 0 and 1, got ${h}`);
        }
    }
    const proposal = decisions.proposePolicy ?? null;
    if (proposal !== null) validateProposal(run, proposal);

    // 1. Quarter RNG
    const rng = new SeededRandom((run.seed ^ Math.imul(run.quarter + 1, 0x9E3779B1)) >>> 0);

    // 2. Power-up purchase and event choice (A4), on a private copy. A power-up bought now applies this quarter.
    let next = structuredClone(run);
    if (decisions.buyPowerUp) {
        if (!canBuyPowerUp(next, decisions.buyPowerUp, POWER_UP_IDS)) {
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

    // 4. Exposures. Variance comes from the forecasting level; an event may scale it for this quarter only.
    const variance = forecastVariance(next) * quarterVarianceMult;
    let playerMarket = 0;
    let benchmarkMarket = 0;
    let hedgeResult = 0;
    // Only hedgeable exposures with a non-zero notional count toward the policy; vacuously in policy otherwise.
    let inPolicy = true;
    const lines = [];
    for (const exp of activeExposures(next)) {
        const forecast = exp.quarterlyNotional * (quarterNotionalMult[exp.id] ?? 1);
        // Volume forecasts (fx, commodity) miss by up to ±variance; debt principal (ir) is contractual.
        // ir draws no random number; fx and commodity always draw one (even at zero variance).
        const realised = exp.type === 'ir' ? forecast : forecast * (1 + (rng.next() * 2 - 1) * variance);
        // A9 (R44): clamp, don't throw: 0 if not hedgeable yet, otherwise the facilities cap.
        const requested = hedges[exp.id] ?? 0;
        const allowed = maxHedgeRatio(next, exp);
        const h = Math.min(requested, allowed);
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
            hedgeImpact = hedgeCashImpact(exp, startRate, endRate, hedged, 'forward') + 0;
        }

        playerMarket += exposureImpact + hedgeImpact;
        benchmarkMarket += exposureImpact;
        hedgeResult += hedgeImpact;
        if (next.mandate && forecast !== 0 && isHedgeable(next, exp)
            && (h < next.mandate.min || h > next.mandate.max)) inPolicy = false;
        lines.push({
            exposureId: exp.id, movePct, exposureImpact, hedgeImpact,
            realisedNotional: realised, forecastNotional: forecast, hedgeRatio: h, clamped: requested > allowed
        });
    }

    // 5. Base operating cash flow, both sides
    const baseOcf = BALANCE.baseOcfPct * next.startingCash;
    next.cash += playerMarket + baseOcf;
    next.benchmarkCash += benchmarkMarket + baseOcf;
    next.rates = endRates;

    // 6. Policy and breach. The no-policy board has nothing to breach.
    const marketResult = playerMarket;
    const policy = next.mandate === null ? 'none' : inPolicy ? 'in' : 'off';
    const { breach, severe } = policy === 'none'
        ? { breach: 'none', severe: false }
        : classifyBreach({ inMandate: inPolicy, marketResult, startingCash: next.startingCash });
    const playerDelta = next.cash - run.cash;
    const benchmarkDelta = next.benchmarkCash - run.benchmarkCash;

    // 7. Board mood (R41 outcome-based; R43 the no-policy board judges the hedge P&L alone; R49 it also loses
    // patience every quarter it still has no policy, and a tie with the benchmark is not a beat)
    const M = BALANCE.mood;
    let mood = next.boardMood;
    if (policy === 'none') {
        mood += M.noPolicyDrift;
        if (hedgeResult < 0) mood += M.noPolicyHedgeLoss;
        else if (hedgeResult > 0) mood += M.noPolicyHedgeWin;
    } else if (breach === 'none') mood += marketResult >= 0 ? M.inPolicyGood : M.inPolicyBad;
    else if (breach === 'lucky') mood += M.luckyBreach;
    else mood += M.breachLoss;
    if (playerDelta > benchmarkDelta) mood += M.beatBenchmark;
    if (next.cash < next.redLine) mood += M.redZone;
    if (proposal !== null) mood += M.policyAdopted;
    next.boardMood = Math.min(100, Math.max(0, mood));

    // 8. Policy adoption: judged from the next quarter.
    if (proposal !== null) {
        next.mandate = { min: proposal.min, max: proposal.max };
        next.boardType = boardTypeOf(next.mandate);
    }

    next.quarter = run.quarter + 1;
    const summary = {
        q: next.quarter,
        policy,
        inMandate: policy === 'none' ? null : inPolicy,
        playerDelta,
        benchmarkDelta,
        marketResult,
        breach,
        severe,
        cashAfter: next.cash,
        benchmarkCashAfter: next.benchmarkCash,
        redLine: next.redLine,
        boardMoodAfter: next.boardMood,
        lines,
        event: run.pendingEvent ? { id: run.pendingEvent, choice: decisions.eventChoice ?? null } : null,
        powerUp: decisions.buyPowerUp ?? null,
        policyAdopted: proposal === null ? null : { min: proposal.min, max: proposal.max }
    };
    next.history = [...next.history, summary];

    // 9. Status (R40): results, not hedging, decide the CFO's fate.
    if (next.cash < -borrowingBuffer(next)) next.status = 'bankrupt';
    else if (severe) next.status = 'fired';
    else if (next.boardMood <= BALANCE.fireThreshold) next.status = 'fired';
    else if (next.quarter >= next.maxQuarters) next.status = 'complete';

    // 10. Next event (only while the run continues)
    next.pendingEvent = null;
    if (next.status === 'playing' && rng.chance(BALANCE.eventChance)) {
        next.pendingEvent = rollEvent(next, content.events || [], rng);
    }

    return { run: next, summary };
}
