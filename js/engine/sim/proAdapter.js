// Pro mode (the legacy dashboard desk) on v3 scoring: turns a resolved Pro quarter into a QuarterSummary
// (contract.md) and scores the run with the shared finalScore. Pure: reads only the state passed in.
//
// Pro "cash" for scoring is economic, not the dashboard's cash balance (which only moves on hedge
// settlements, premiums, margin and events): cashAfter = startingCash + Σ playerDelta, and the unhedged
// benchmark is startingCash + Σ benchmarkDelta. Pro has no base operating cash flow.

import { BALANCE } from './balance.js';
import { classifyBreach } from './SimEngine.js';
import { finalScore } from './score.js';

const num = (v) => (Number.isFinite(v) ? v : 0);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Contract movePct: percentage points for ir, percent change otherwise; no usable start rate is no move.
function movePct(type, startRate, endRate) {
    if (!Number.isFinite(startRate) || startRate === 0 || !Number.isFinite(endRate)) return 0;
    return type === 'ir' ? (endRate - startRate) * 100 : ((endRate - startRate) / startRate) * 100;
}

/**
 * @param state Pro game state (GameState) after the quarter's board review.
 * @param quarterResult the quarter's entry in state.quarterlyResults (GameLoop.calculateQuarterlyPnL plus inMandate).
 */
export function toQuarterSummary(state, quarterResult) {
    const startingCash = state.startingCash;
    const details = quarterResult.details || [];
    const exposureDetails = details.filter(d => d.type === 'exposure');
    const hedgeDetails = details.filter(d => d.type === 'hedge');

    const benchmarkDelta = exposureDetails.reduce((s, d) => s + num(d.pnl), 0);
    const marketResult = benchmarkDelta + num(quarterResult.hedgePnL)
        - num(quarterResult.tradingCosts) - num(quarterResult.premiums);
    const playerDelta = num(quarterResult.netPnL);
    const inMandate = quarterResult.inMandate === true;
    const { breach, severe } = classifyBreach({ inMandate, marketResult, startingCash });

    const prev = (state.quarterSummaries || []).at(-1);
    const cashAfter = (prev ? prev.cashAfter : startingCash) + playerDelta;
    const benchmarkCashAfter = (prev ? prev.benchmarkCashAfter : startingCash) + benchmarkDelta;

    // A hedge's MTM change is attributed to the first exposure on its underlying.
    const seen = new Set();
    const lines = exposureDetails.map(d => {
        const first = !seen.has(d.underlying);
        seen.add(d.underlying);
        const hedgeImpact = first
            ? hedgeDetails.filter(h => h.underlying === d.underlying).reduce((s, h) => s + num(h.mtmChange), 0)
            : 0;
        return {
            exposureId: d.exposureId,
            movePct: movePct(d.exposureType, d.startRate, d.currentRate),
            exposureImpact: num(d.pnl),
            hedgeImpact,
            realisedNotional: num(d.realizedNotional),
            forecastNotional: num(d.forecastNotional)
        };
    });

    const ev = (state.eventHistory || []).find(e => e.quarter === quarterResult.quarter);

    return {
        q: num(quarterResult.quarter) + 1,
        inMandate,
        playerDelta,
        benchmarkDelta,
        marketResult,
        breach,
        severe,
        cashAfter,
        benchmarkCashAfter,
        redLine: BALANCE.redLinePct * startingCash,
        boardMoodAfter: state.boardSatisfaction,
        lines,
        event: ev ? { id: ev.eventId, choice: ev.choiceId ?? null } : null,
        powerUp: null
    };
}

/**
 * Run status after the latest summary, in the Simple precedence (contract.md step 8).
 * walkedOut: the legacy Pro burnout or board firing (GameState.burnedOut / firedByBoard) also ends the run as fired.
 */
export function proStatus(history, { boardMood, maxQuarters, walkedOut = false }) {
    const last = history.at(-1);
    if (!last) return 'playing';
    if (last.cashAfter <= 0) return 'bankrupt';
    if (last.severe) return 'fired';
    if (history.filter(s => s.breach === 'loss').length >= BALANCE.breachLossesToFire) return 'fired';
    if (boardMood <= BALANCE.fireThreshold) return 'fired';
    if (walkedOut) return 'fired';
    if (last.q >= maxQuarters) return 'complete';
    return 'playing';
}

// v3 score of a Pro run: A5 finalScore over the run's QuarterSummaries.
export function scorePro(state, gameOverTitles = []) {
    return finalScore({
        history: state.quarterSummaries || [],
        status: state.runStatus,
        startingCash: state.startingCash,
        boardMood: state.boardSatisfaction
    }, gameOverTitles);
}

// SceneState (contract.md, C1) for the Pro dashboard scene, from the last QuarterSummary (R17).
export function proSceneState(state) {
    const last = (state.quarterSummaries || []).at(-1);
    if (!last) return { mood: 'calm', cashLevel: 0.5, highlight: null };
    const big = 0.02 * state.startingCash;
    let mood = 'calm';
    if (last.breach === 'loss' || last.cashAfter < last.redLine || last.playerDelta < -big) mood = 'storm';
    else if (last.playerDelta > big) mood = 'boom';

    let highlight = null;
    let biggest = 0;
    for (const line of last.lines || []) {
        if (Math.abs(line.movePct) > biggest) {
            biggest = Math.abs(line.movePct);
            highlight = (state.exposures || []).find(e => e.id === line.exposureId)?.underlying ?? null;
        }
    }
    return { mood, cashLevel: clamp(last.cashAfter / (2 * state.startingCash), 0, 1), highlight };
}
