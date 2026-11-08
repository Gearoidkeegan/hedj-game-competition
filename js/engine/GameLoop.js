// Game loop controller — manages the quarterly cycle and phase transitions

import { gameState } from './GameState.js';
import { eventEngine } from './EventEngine.js';
import { marketEngine, computeBudgetRate } from './MarketEngine.js';
import { forecastEngine } from './ForecastEngine.js';
import { bankEngine } from './BankEngine.js';
import { hedgingEngine } from './HedgingEngine.js';
import { exposureCashImpact } from './sim/exposureMath.js';
import { toQuarterSummary, proStatus, scorePro } from './sim/proAdapter.js';
import { PHASE, GAME_CONFIG } from '../utils/constants.js';

class GameLoopController {
    constructor() {
        this.onPhaseChange = null; // Callback set by main.js to trigger screen transitions
    }

    // Start a new game (called from SetupScreen for backward compat)
    startGame({ playerName, industry, hedgingPolicy, seed, playerGender, companyName, contactEmail }) {
        gameState.initGame({ playerName, industry, hedgingPolicy, seed, playerGender, companyName, contactEmail });
        this.setPhase(PHASE.DECISION);
    }

    // Transition to decision phase (used when state is already initialized)
    beginDecisionPhase() {
        this.ensureIrBudgetRates();
        this.setPhase(PHASE.DECISION);
    }

    // Set current phase and notify
    setPhase(phase) {
        const prevPhase = gameState.get().phase;
        gameState.update({ phase });
        if (this.onPhaseChange) {
            this.onPhaseChange(phase, prevPhase);
        }
    }

    // Book one hedge: allocate bank credit, pay any premium, add it to the portfolio and record its
    // trading cost. Returns false (nothing booked) if the bank lacks the credit.
    bookHedge(hedge, creditUsage = 0) {
        if (creditUsage > 0 && !bankEngine.allocateTrade(hedge.bankId, hedge.id, creditUsage)) return false;
        const state = gameState.get();
        const premium = hedge.premiumPaid || 0;
        const tradingCost = hedgingEngine.getTradingCost(hedge.productType, hedge.notional);
        gameState.update({
            cashBalance: state.cashBalance - premium,
            tradesThisQuarter: state.tradesThisQuarter + 1,
            tradingCostsThisQuarter: state.tradingCostsThisQuarter + tradingCost,
            totalTradingCosts: state.totalTradingCosts + tradingCost,
            premiumsThisQuarter: state.premiumsThisQuarter + premium
        });
        gameState.addHedge(hedge);
        return true;
    }

    // Player has finished making decisions — advance the quarter
    endDecisionPhase() {
        this.setPhase(PHASE.RESOLUTION);
        // Resolution is processed, then we check for events
        this.resolveQuarter();
    }

    // Process quarter resolution: advance rates, calculate P&L, check margins
    resolveQuarter() {
        const state = gameState.get();

        // Policy compliance is judged on the book the player chose for this quarter, before this
        // quarter's hedges settle (checking after settlement always missed the maturing bucket).
        const inCompliance = this.checkPolicyCompliance();

        // IR exposures active from the start have no budget yet (computeBudgetRate skips IR)
        this.ensureIrBudgetRates();

        // v2: Generate realized notionals (forecast variance)
        const realized = forecastEngine.generateQuarterRealized(
            state.exposures,
            state.currentYearOffset,
            state.tmsModuleCount || 0,
            gameState.getRng()
        );
        gameState.update({ realizedNotionals: realized });

        // MarketEngine will have already updated rates before this is called
        // Calculate P&L for this quarter
        const result = this.calculateQuarterlyPnL();
        result.inMandate = inCompliance;

        // Check margin calls
        if (result.marginCallAmount > 0) {
            gameState.update({
                cashBalance: state.cashBalance - result.marginCallAmount,
                marginPosted: state.marginPosted + result.marginCallAmount,
                marginCallCount: state.marginCallCount + 1
            });
            if (state.cashBalance - result.marginCallAmount < 0) {
                gameState.update({ cashWentNegative: true });
            }
        }

        // Update cash from settlements
        gameState.update({
            cashBalance: gameState.get().cashBalance + result.cashImpact
        });

        if (inCompliance) {
            gameState.update({
                totalQuartersInCompliance: state.totalQuartersInCompliance + 1
            });
        } else {
            gameState.update({
                policyViolations: state.policyViolations + 1,
                perfectCompliance: false
            });
        }

        // Record result
        gameState.addQuarterlyResult(result);

        // Store rate history
        const rateHistory = [...state.rateHistory, {
            quarter: state.totalQuartersPlayed,
            rates: { ...state.currentRates }
        }];
        gameState.update({ rateHistory });

        // Check for events, then summary (results), then board (feedback)
        if (eventEngine.shouldFireEvent()) {
            const event = eventEngine.selectEvent();
            if (event) {
                gameState.update({ activeEvents: [event] });
                this.setPhase(PHASE.EVENT);
            } else {
                this.setPhase(PHASE.SUMMARY);
            }
        } else {
            this.setPhase(PHASE.SUMMARY);
        }
    }

    // Calculate P&L for the current quarter
    calculateQuarterlyPnL() {
        const state = gameState.get();
        let exposurePnL = 0;
        let hedgePnL = 0;
        let marginCallAmount = 0;
        let cashImpact = 0;
        const details = [];

        // Exposure P&L against a reference rate for each exposure (exposureCashImpact, A2):
        // - with a budget policy, the budget rate; IR exposures budget at the start-of-game rate,
        //   −(rate − budget) × notional × 0.25;
        // - with no budget rate (policy 'none'), the start-of-quarter rate (R46), so the unhedged
        //   benchmark and IR P&L still move with the market.
        // v2: Use realized notional (with forecast variance) instead of fixed quarterlyNotional
        const policy = state.hedgingPolicy;
        const hasBudgetRate = policy && policy.budgetRateType !== 'none';

        for (const exposure of state.exposures) {
            const rawBudget = hasBudgetRate ? state.budgetRates[exposure.underlying] : undefined;
            const budgetRate = Number.isFinite(rawBudget) ? rawBudget : 0;
            const startRate = state.previousRates[exposure.underlying];
            const referenceRate = hasBudgetRate ? rawBudget : startRate;
            const currentRate = state.currentRates[exposure.underlying] ?? referenceRate;
            const forecastNotional = exposure.quarterlyNotional || 0;
            const realizedNotional = (state.realizedNotionals && state.realizedNotionals[exposure.id])
                || forecastNotional;

            // IR rates may be zero or negative (EURIBOR 2015-2021); other prices divide by the reference.
            const usable = Number.isFinite(referenceRate) && Number.isFinite(currentRate)
                && (exposure.type === 'ir' || referenceRate !== 0);
            let expPnL = 0;
            if (usable) {
                // `+ 0` turns -0 into 0
                expPnL = exposureCashImpact(exposure, referenceRate, currentRate, realizedNotional) + 0;
            }
            exposurePnL += expPnL;

            const variancePct = forecastNotional > 0
                ? ((realizedNotional - forecastNotional) / forecastNotional) * 100
                : 0;

            details.push({
                type: 'exposure',
                exposureId: exposure.id,
                exposureType: exposure.type,
                underlying: exposure.underlying,
                description: exposure.description,
                pnl: expPnL,
                budgetRate,
                referenceRate,
                startRate,
                currentRate,
                forecastNotional,
                realizedNotional,
                variancePct
            });
        }

        // Hedge P&L: MTM changes on active hedges + settlements
        // Track settled (maturing this Q) vs unsettled (future) separately
        const settledHedges = [];
        let settledHedgePnL = 0;   // Cash flow from hedges settling this quarter (full cumulative MTM)
        let unsettledHedgePnL = 0; // MTM change on hedges maturing in future quarters
        let totalHedgeMtm = 0;     // Total current MTM across all hedges (for programme view)
        for (const hedge of state.hedgePortfolio) {
            if (hedge.status !== 'active') continue;

            const currentRate = state.currentRates[hedge.underlying] || hedge.contractRate;
            let mtmChange = 0;
            let settlesQuarterly = false;

            // Hedge MTM uses the same percentage base (budget rate) as exposure P&L so
            // that a 100%-hedged position produces a near-zero net.  The hedge locks in
            // the contract rate, so its value is the difference between the contract rate
            // and the current rate, expressed as a percentage of the budget rate and
            // applied to the hedge notional.
            // MTM = (currentRate - contractRate) / budgetRate * notional * direction

            if (hedge.productType === 'forward' || hedge.productType === 'future') {
                const direction = hedge.direction === 'buy' ? 1 : -1;
                const budgetRate = state.budgetRates[hedge.underlying] || hedge.contractRate;
                const baseRate = budgetRate !== 0 ? budgetRate : hedge.contractRate;
                const priceMoveRatio = baseRate !== 0
                    ? (currentRate - hedge.contractRate) / baseRate
                    : 0;
                const newMtm = priceMoveRatio * hedge.notional * direction;
                mtmChange = newMtm - (hedge.currentMtm || 0);
                hedge.currentMtm = newMtm;
            } else if (hedge.productType === 'option') {
                // Simplified option: intrinsic value as % of budget rate, then * notional.
                // The premium is paid in cash at booking and counted in that quarter's P&L
                // (premiumsThisQuarter), so it is not netted here as well.
                const direction = hedge.direction === 'buy' ? 1 : -1;
                const strike = hedge.strikeRate || hedge.strike || 1;
                const budgetRate = state.budgetRates[hedge.underlying] || strike;
                const baseRate = budgetRate !== 0 ? budgetRate : strike;
                const rawIntrinsic = Math.max(0, (currentRate - strike) * direction);
                const intrinsic = rawIntrinsic / baseRate;
                const newMtm = intrinsic * hedge.notional;
                mtmChange = newMtm - (hedge.currentMtm || 0);
                hedge.currentMtm = newMtm;
            } else if (hedge.productType === 'swap') {
                // IR Swap: (floating - fixed) * notional * 0.25, rates are decimals
                const floatingRate = currentRate;
                const fixedRate = hedge.contractRate;
                const quarterPnL = (floatingRate - fixedRate) * hedge.notional * 0.25;
                mtmChange = quarterPnL;
                hedge.currentMtm = (hedge.currentMtm || 0) + quarterPnL;
                cashImpact += quarterPnL; // Swaps settle quarterly
                settlesQuarterly = true;
            }

            hedgePnL += mtmChange;
            totalHedgeMtm += hedge.currentMtm || 0;

            // Check if hedge matures this quarter.
            // totalQuartersPlayed is 0-indexed and hasn't incremented yet during
            // resolution, so the quarter being resolved is totalQuartersPlayed + 1.
            const currentQ = state.totalQuartersPlayed + 1;
            const maturesThisQ = hedge.maturityQuarter <= currentQ;
            if (maturesThisQ) {
                hedge.status = 'matured';
                // Quarterly-settled hedges (swaps) were already paid in cash each quarter
                if (!settlesQuarterly) cashImpact += hedge.currentMtm || 0;
                settledHedges.push(hedge);
                bankEngine.releaseTrade(hedge.bankId, hedge.id);
                // Settlement cash flow = full accumulated MTM at maturity
                settledHedgePnL += hedge.currentMtm || 0;
            } else {
                unsettledHedgePnL += mtmChange;
            }

            // Margin call check for forwards and futures
            if ((hedge.productType === 'forward' || hedge.productType === 'future') && hedge.currentMtm < 0) {
                const requiredMargin = Math.abs(hedge.currentMtm) * GAME_CONFIG.MARGIN_REQUIREMENT;
                const additionalMargin = Math.max(0, requiredMargin - (hedge.marginPosted || 0));
                if (additionalMargin > 0) {
                    marginCallAmount += additionalMargin;
                    hedge.marginPosted = requiredMargin;
                }
            }

            details.push({
                type: 'hedge',
                underlying: hedge.underlying,
                assetClass: hedge.assetClass,
                productType: hedge.productType,
                // For settled hedges, show total settlement value; for active, show quarterly MTM change
                pnl: maturesThisQ ? (hedge.currentMtm || 0) : mtmChange,
                mtmChange,
                contractRate: hedge.contractRate,
                currentRate,
                status: hedge.status,
                maturedThisQ: maturesThisQ
            });
        }

        // Remove matured hedges
        if (settledHedges.length > 0) {
            gameState.update({
                hedgePortfolio: state.hedgePortfolio.filter(h => h.status === 'active')
            });
        }

        // Compute horizon exposure P&L: total exposure value change across
        // the full hedge horizon (quarterlyNotional * horizon * rate move)
        const policyHorizon = (policy && policy.hedgeHorizon) || 4;
        const remainingQ = Math.max(1, state.maxQuarters - state.totalQuartersPlayed);
        const horizon = Math.min(remainingQ, policyHorizon);
        let horizonExposurePnL = 0;
        if (hasBudgetRate) {
            for (const exposure of state.exposures) {
                const budgetRate = state.budgetRates[exposure.underlying] || 0;
                const currentRate = state.currentRates[exposure.underlying] || budgetRate;
                if (budgetRate === 0) continue;
                const horizonNotional = (exposure.quarterlyNotional || 0) * horizon;
                horizonExposurePnL += exposureCashImpact(exposure, budgetRate, currentRate, horizonNotional);
            }
        }

        // Trading costs and premiums of the trades booked this quarter
        const tradingCosts = state.tradingCostsThisQuarter || 0;
        const premiums = state.premiumsThisQuarter || 0;
        const netPnL = exposurePnL + hedgePnL - tradingCosts - premiums;

        return {
            quarter: state.totalQuartersPlayed,
            yearOffset: state.currentYearOffset,
            quarterNum: state.currentQuarter,
            exposurePnL,
            hedgePnL,
            settledHedgePnL,
            unsettledHedgePnL,
            horizonExposurePnL,
            totalHedgeMtm,
            horizon,
            tradingCosts,
            premiums,
            netPnL,
            cashImpact,
            marginCallAmount,
            cashBalance: gameState.get().cashBalance,
            details
        };
    }

    // Check if current hedge ratios comply with policy (v2: horizon + tenor bands)
    checkPolicyCompliance() {
        const state = gameState.get();
        const policy = state.hedgingPolicy;
        if (!policy || policy.id === 'none') return true;

        const remainingQuarters = Math.max(1, state.maxQuarters - state.totalQuartersPlayed);
        const horizon = Math.min(remainingQuarters, policy.hedgeHorizon || remainingQuarters);

        for (const exposure of state.exposures) {
            if (policy.tenorBands && policy.tenorBands.length > 0) {
                // Per-tenor compliance: check each tenor bucket individually
                for (const band of policy.tenorBands) {
                    if (band.tenor > horizon) continue;
                    const tenorQuarter = state.totalQuartersPlayed + band.tenor;

                    // Hedge notional maturing at this tenor for this underlying
                    const hedgedAtTenor = state.hedgePortfolio
                        .filter(h => h.underlying === exposure.underlying &&
                                     h.status === 'active' &&
                                     h.maturityQuarter === tenorQuarter)
                        .reduce((sum, h) => sum + h.notional, 0);

                    const tenorRatio = exposure.quarterlyNotional > 0
                        ? hedgedAtTenor / exposure.quarterlyNotional
                        : 0;

                    if (tenorRatio < band.min || tenorRatio > band.max) {
                        return false;
                    }
                }
            } else {
                // Flat compliance: aggregate ratio within horizon
                const totalExposure = exposure.quarterlyNotional * horizon;
                const hedgedAmount = state.hedgePortfolio
                    .filter(h => h.underlying === exposure.underlying &&
                                 h.status === 'active' &&
                                 h.maturityQuarter <= state.totalQuartersPlayed + horizon)
                    .reduce((sum, h) => sum + h.notional, 0);

                const hedgeRatio = totalExposure > 0
                    ? hedgedAmount / totalExposure
                    : 0;

                if (hedgeRatio < policy.minHedgeRatio || hedgeRatio > policy.maxHedgeRatio) {
                    return false;
                }
            }

            // Penalise hedges booked beyond the policy horizon
            const beyondHorizon = state.hedgePortfolio
                .filter(h => h.underlying === exposure.underlying &&
                             h.status === 'active' &&
                             h.maturityQuarter > state.totalQuartersPlayed + horizon)
                .reduce((sum, h) => sum + h.notional, 0);

            if (beyondHorizon > 0) {
                return false;
            }
        }
        return true;
    }

    // Event phase complete — player has chosen, move to summary
    completeEvent(event, choiceId) {
        const result = event ? eventEngine.processChoice(event, choiceId) : null;
        // Events can unwind hedges: free the bank credit of anything no longer in the book
        bankEngine.releaseClosedTrades(gameState.get().hedgePortfolio
            .filter(h => h.status === 'active')
            .map(h => h.id));
        // Store the event result for the board to reference
        gameState.update({
            activeEvents: [],
            lastEventResult: result
        });
        this.setPhase(PHASE.SUMMARY);
    }

    // Summary phase complete — move to board review
    completeSummary() {
        this.setPhase(PHASE.BOARD);
    }

    // Board review phase complete — record the v3 QuarterSummary, then advance or end the game
    completeBoardReview() {
        const status = this.recordQuarterSummary();

        // Clear event result now that board has seen it
        gameState.update({ lastEventResult: null });
        gameState.advanceQuarter();

        // Set rates for any exposures that just unlocked (before budget rate reset)
        this.initRatesForNewExposures();

        // v2: Check if budget rates need resetting for this quarter
        this.checkBudgetRateReset();

        if (status === 'playing') {
            this.setPhase(PHASE.DECISION);
        } else {
            this.finishGame(status);
        }
    }

    // Append this quarter's QuarterSummary (v3 contract) and return the run status
    recordQuarterSummary() {
        const state = gameState.get();
        const result = state.quarterlyResults[state.quarterlyResults.length - 1];
        const quarterSummaries = [...state.quarterSummaries, toQuarterSummary(state, result)];
        const runStatus = proStatus(quarterSummaries, {
            boardMood: state.boardSatisfaction,
            maxQuarters: state.maxQuarters,
            walkedOut: state.firedByBoard || state.burnedOut
        });
        gameState.update({ quarterSummaries, runStatus });
        return runStatus;
    }

    // Pro end of game: score on v3 and hand over to the game-over screen.
    // GameOverScreen (B3) reads gameState.get().proResult = { mode: 'pro', status, score, history }.
    finishGame(status) {
        const state = gameState.get();
        gameState.update({
            proResult: {
                mode: 'pro',
                status,
                score: scorePro(state),
                history: state.quarterSummaries
            }
        });
        this.setPhase(PHASE.GAMEOVER);
    }

    // Set market + budget rates for exposures that have just been unlocked
    // (their underlyings won't have entries in currentRates/budgetRates yet)
    initRatesForNewExposures() {
        const state = gameState.get();
        const rng = gameState.getRng();

        // Placeholder rates — same table as SetupScreen.setMarketRates()
        const placeholderRates = {
            'EURUSD': 1.10, 'EURGBP': 0.86, 'EURBRL': 5.50, 'EURCHF': 0.96,
            'EURJPY': 155, 'USDJPY': 140, 'GBPUSD': 1.27,
            'BRENT': 75, 'JETNWE': 75 * 1.8 * 7.4, 'NATGAS': 3.0, 'COPPER': 4.0, 'STEEL': 600,
            'DAIRY': 18, 'WHEAT': 6.0, 'CORN': 4.5, 'GOLD': 1900, 'COFFEE': 150,
            'EURIBOR': 0.035
        };

        const currentRates = { ...state.currentRates };
        const previousRates = { ...state.previousRates };
        const budgetRates = { ...state.budgetRates };
        let changed = false;

        for (const exp of state.exposures) {
            if (currentRates[exp.underlying] && currentRates[exp.underlying] !== 0) continue;

            // This underlying has no rate yet — set it from historical or placeholder
            let baseRate = null;
            if (marketEngine.isLoaded()) {
                const year = state.startYear + state.currentYearOffset;
                baseRate = marketEngine.getRate(exp.underlying, year, state.currentQuarter);
            }
            if (!baseRate) {
                const placeholder = placeholderRates[exp.underlying] || 1.0;
                baseRate = placeholder * (1 + rng.floatRange(-0.05, 0.05));
            }

            currentRates[exp.underlying] = baseRate;
            previousRates[exp.underlying] = baseRate;

            const br = computeBudgetRate(exp, baseRate);
            if (br !== null) budgetRates[exp.underlying] = br;
            changed = true;
        }

        if (changed) {
            gameState.update({ currentRates, previousRates, budgetRates });
        }
        this.ensureIrBudgetRates();
    }

    // IR exposures budget at the start-of-game rate (the first quarter of the hidden start year).
    // Without market data, the rate at the start of the quarter the exposure is first priced.
    // IR rates can be zero or negative, so only a missing (non-finite) rate counts as unset.
    // Policies without a budget rate ('none') get no IR budget either.
    ensureIrBudgetRates() {
        const state = gameState.get();
        const policy = state.hedgingPolicy;
        if (!policy || policy.budgetRateType === 'none') return;
        const budgetRates = { ...state.budgetRates };
        let changed = false;
        for (const exp of state.exposures) {
            if (exp.type !== 'ir' || Number.isFinite(budgetRates[exp.underlying])) continue;
            let start = marketEngine.isLoaded() ? marketEngine.getRate(exp.underlying, state.startYear, 1) : null;
            if (!Number.isFinite(start)) start = state.previousRates[exp.underlying] ?? state.currentRates[exp.underlying];
            if (!Number.isFinite(start)) continue;
            budgetRates[exp.underlying] = start;
            changed = true;
        }
        if (changed) gameState.update({ budgetRates });
    }

    // v2: Check and apply budget rate reset based on policy budgetRateType
    checkBudgetRateReset() {
        const state = gameState.get();
        const newRates = marketEngine.resetBudgetRates(state);
        if (newRates !== null) {
            // Merge new rates with existing (preserves rates for underlyings not in current exposures,
            // and IR budgets, which stay at the start-of-game rate)
            const merged = { ...state.budgetRates, ...newRates };
            gameState.update({ budgetRates: merged });
        }
    }

    // Get current hedge ratio for an exposure (v2: respects policy horizon)
    // Compares total hedge notional within horizon vs total exposure within horizon
    getHedgeRatio(exposureUnderlying) {
        const state = gameState.get();
        const exposure = state.exposures.find(e => e.underlying === exposureUnderlying);
        if (!exposure || !exposure.quarterlyNotional) return 0;

        const policy = state.hedgingPolicy;
        const remainingQuarters = Math.max(1, state.maxQuarters - state.totalQuartersPlayed);
        const horizon = policy && policy.hedgeHorizon
            ? Math.min(remainingQuarters, policy.hedgeHorizon)
            : remainingQuarters;

        const totalExposure = exposure.quarterlyNotional * horizon;
        const maxMaturity = state.totalQuartersPlayed + horizon;

        const totalHedged = state.hedgePortfolio
            .filter(h => h.underlying === exposureUnderlying &&
                         h.status === 'active' &&
                         h.maturityQuarter <= maxMaturity)
            .reduce((sum, h) => sum + h.notional, 0);

        return totalExposure > 0 ? totalHedged / totalExposure : 0;
    }

    // Get per-tenor hedge ratio for an exposure at a specific tenor bucket
    getHedgeRatioAtTenor(exposureUnderlying, tenor) {
        const state = gameState.get();
        const exposure = state.exposures.find(e => e.underlying === exposureUnderlying);
        if (!exposure || !exposure.quarterlyNotional) return 0;

        const tenorQuarter = state.totalQuartersPlayed + tenor;
        const hedgedAtTenor = state.hedgePortfolio
            .filter(h => h.underlying === exposureUnderlying &&
                         h.status === 'active' &&
                         h.maturityQuarter === tenorQuarter)
            .reduce((sum, h) => sum + h.notional, 0);

        return exposure.quarterlyNotional > 0 ? hedgedAtTenor / exposure.quarterlyNotional : 0;
    }
}

export const gameLoop = new GameLoopController();
