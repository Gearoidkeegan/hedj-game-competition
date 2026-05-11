// Game loop controller — manages the quarterly cycle and phase transitions

import { gameState } from './GameState.js';
import { eventEngine } from './EventEngine.js';
import { careerEngine } from './CareerEngine.js';
import { marketEngine, computeBudgetRate } from './MarketEngine.js';
import { forecastEngine } from './ForecastEngine.js';
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

    // Player has finished making decisions — advance the quarter
    endDecisionPhase() {
        this.setPhase(PHASE.RESOLUTION);
        // Resolution is processed, then we check for events
        this.resolveQuarter();
    }

    // Process quarter resolution: advance rates, calculate P&L, check margins
    resolveQuarter() {
        const state = gameState.get();

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

        // Check policy compliance
        const inCompliance = this.checkPolicyCompliance();
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

        // Exposure P&L: (budget_rate - actual_rate) * notional for each exposure
        // v2: Use realized notional (with forecast variance) instead of fixed quarterlyNotional
        const policy = state.hedgingPolicy;
        const hasBudgetRate = policy && policy.budgetRateType !== 'none';

        for (const exposure of state.exposures) {
            const budgetRate = hasBudgetRate ? (state.budgetRates[exposure.underlying] || 0) : 0;
            const currentRate = state.currentRates[exposure.underlying] || budgetRate;
            const forecastNotional = exposure.quarterlyNotional || 0;
            const realizedNotional = (state.realizedNotionals && state.realizedNotionals[exposure.id])
                || forecastNotional;

            let expPnL = 0;
            if (hasBudgetRate && budgetRate !== 0) {
                // Percentage-based P&L normalised relative to the budget rate.
                const priceMoveRatio = (currentRate - budgetRate) / budgetRate;

                if (exposure.direction === 'buy') {
                    // Commodity buy: price up → more cost → LOSS
                    expPnL = -priceMoveRatio * realizedNotional;
                } else {
                    // Commodity sell: price up → more revenue → GAIN
                    expPnL = priceMoveRatio * realizedNotional;
                }

                // FX inversion only applies when the company's home currency is the
                // BASE of the pair (pair ends with the unit currency, e.g. EUR-base +
                // EURUSD with unit=USD). When home is the QUOTE of the pair (e.g.
                // USD-base + EURUSD with unit=EUR), rate changes map directly to the
                // unit value in home terms, same as commodity convention.
                if (exposure.type === 'fx'
                    && typeof exposure.underlying === 'string'
                    && typeof exposure.unit === 'string'
                    && exposure.underlying.endsWith(exposure.unit)) {
                    expPnL = -expPnL;
                }
            }
            exposurePnL += expPnL;

            const variancePct = forecastNotional > 0
                ? ((realizedNotional - forecastNotional) / forecastNotional) * 100
                : 0;

            details.push({
                type: 'exposure',
                underlying: exposure.underlying,
                description: exposure.description,
                pnl: expPnL,
                budgetRate,
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
                // Simplified option: intrinsic value as % of budget rate, then * notional
                const direction = hedge.direction === 'buy' ? 1 : -1;
                const strike = hedge.strikeRate || hedge.strike || 1;
                const budgetRate = state.budgetRates[hedge.underlying] || strike;
                const baseRate = budgetRate !== 0 ? budgetRate : strike;
                const rawIntrinsic = Math.max(0, (currentRate - strike) * direction);
                const intrinsic = rawIntrinsic / baseRate;
                const newMtm = intrinsic * hedge.notional - (hedge.premiumPaid || 0);
                mtmChange = newMtm - (hedge.currentMtm || 0);
                hedge.currentMtm = newMtm;
            } else if (hedge.productType === 'swap') {
                // IR Swap: (floating - fixed) * notional * 0.25
                const floatingRate = currentRate;
                const fixedRate = hedge.contractRate;
                const quarterPnL = (floatingRate - fixedRate) * hedge.notional * 0.25;
                mtmChange = quarterPnL;
                hedge.currentMtm = (hedge.currentMtm || 0) + quarterPnL;
                cashImpact += quarterPnL; // Swaps settle quarterly
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
                cashImpact += hedge.currentMtm || 0;
                settledHedges.push(hedge);
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
        // the full hedge horizon (quarterlyNotional * horizon * rate move %)
        const policyHorizon = (policy && policy.hedgeHorizon) || 4;
        const remainingQ = Math.max(1, state.maxQuarters - state.totalQuartersPlayed);
        const horizon = Math.min(remainingQ, policyHorizon);
        let horizonExposurePnL = 0;
        if (hasBudgetRate) {
            for (const exposure of state.exposures) {
                const budgetRate = state.budgetRates[exposure.underlying] || 0;
                const currentRate = state.currentRates[exposure.underlying] || budgetRate;
                if (budgetRate === 0) continue;
                const priceMoveRatio = (currentRate - budgetRate) / budgetRate;
                const horizonNotional = (exposure.quarterlyNotional || 0) * horizon;
                let pnl = exposure.direction === 'buy'
                    ? -priceMoveRatio * horizonNotional
                    : priceMoveRatio * horizonNotional;
                // FX inversion only when home=base of pair (see exposurePnL notes).
                if (exposure.type === 'fx'
                    && typeof exposure.underlying === 'string'
                    && typeof exposure.unit === 'string'
                    && exposure.underlying.endsWith(exposure.unit)) {
                    pnl = -pnl;
                }
                horizonExposurePnL += pnl;
            }
        }

        const netPnL = exposurePnL + hedgePnL;

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
        const result = eventEngine.processChoice(event, choiceId);
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

    // Board review phase complete — advance or end game
    completeBoardReview() {
        // Clear event result now that board has seen it
        gameState.update({ lastEventResult: null });
        gameState.advanceQuarter();

        // Set rates for any exposures that just unlocked (before budget rate reset)
        this.initRatesForNewExposures();

        // v2: Check if budget rates need resetting for this quarter
        this.checkBudgetRateReset();

        const state = gameState.get();

        if (state.firedByBoard || state.burnedOut) {
            if (state.careerMode) {
                this.setPhase(PHASE.LEVEL_COMPLETE);
            } else {
                this.setPhase(PHASE.GAMEOVER);
            }
        } else if (state.totalQuartersPlayed >= state.maxQuarters) {
            if (state.careerMode) {
                this.setPhase(PHASE.LEVEL_COMPLETE);
            } else if (gameState.canExtend()) {
                this.setPhase(PHASE.EXTEND);
            } else {
                this.setPhase(PHASE.GAMEOVER);
            }
        } else {
            this.setPhase(PHASE.DECISION);
        }
    }

    // Player chose to extend
    extendGame() {
        gameState.extendGame();
        this.setPhase(PHASE.DECISION);
    }

    // Player chose not to extend
    endGame() {
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
            'EURIBOR': 0.035, 'SOFR': 0.05, 'SONIA': 0.05
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
    }

    // v2: Check and apply budget rate reset based on policy budgetRateType
    checkBudgetRateReset() {
        const state = gameState.get();
        const newRates = marketEngine.resetBudgetRates(state);
        if (newRates !== null) {
            // Merge new rates with existing (preserves rates for underlyings not in current exposures)
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
