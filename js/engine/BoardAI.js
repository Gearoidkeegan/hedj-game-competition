// BoardAI — personality-driven board reactions with CEO personas
// Selects contextual dialogue based on quarter performance, player behaviour, and board member personality
// v2: TMS spending awareness, forecast variance feedback, new CEO personas

import { gameState } from './GameState.js';
import { forecastEngine } from './ForecastEngine.js';
import { GAME_CONFIG } from '../utils/constants.js';

class BoardAIController {
    constructor() {
        this.dialogueData = null;
        this.ceoPersona = null;    // Current game's CEO persona id
        this.usedLines = new Map(); // poolKey -> Set of used indices (no-repeat across a playthrough)
    }

    /**
     * Pick a line from a pool without repeating within the current game.
     * Tracks used indices per pool key so CEO/Chairman/board comments don't
     * repeat over an 8-quarter playthrough. Once a pool is exhausted it resets
     * so picking can continue.
     */
    pickNoRepeat(arr, key, rng) {
        if (!arr || arr.length === 0) return null;
        let used = this.usedLines.get(key);
        if (!used) { used = new Set(); this.usedLines.set(key, used); }

        let available = [];
        for (let i = 0; i < arr.length; i++) {
            if (!used.has(i)) available.push(i);
        }
        // All lines used — reset this pool so it can cycle again
        if (available.length === 0) {
            used.clear();
            for (let i = 0; i < arr.length; i++) available.push(i);
        }

        const idx = available[Math.floor(rng.next() * available.length)];
        used.add(idx);
        return arr[idx];
    }

    /**
     * Load dialogue data. Call once at app startup.
     */
    async loadDialogue(basePath = 'data') {
        try {
            const resp = await fetch(`${basePath}/board-dialogue.json`);
            this.dialogueData = await resp.json();
            console.log('BoardAI: dialogue loaded');
        } catch (e) {
            console.warn('BoardAI: could not load dialogue', e);
        }
    }

    /**
     * Assign a random CEO persona for this game.
     */
    assignCEOPersona(rng) {
        const personas = ['jameson', 'musk', 'oleary', 'dimon', 'buffett', 'jobs', 'dorsey', 'ackman'];
        this.ceoPersona = rng.pick(personas);
        this.usedLines = new Map(); // Fresh no-repeat tracking for each new game
        return this.ceoPersona;
    }

    /**
     * Get the CEO persona info.
     */
    getCEOPersona() {
        if (!this.dialogueData || !this.ceoPersona) return null;
        return this.dialogueData.ceoPersonas[this.ceoPersona] || null;
    }

    /**
     * Generate board feedback for the current quarter.
     * Returns an array of { member, lines[], satisfactionDelta } objects.
     */
    generateFeedback() {
        const state = gameState.get();
        const result = state.quarterlyResults[state.quarterlyResults.length - 1];
        if (!result) return [];

        const feedback = [];
        const boardMembers = state.industry?.boardMembers || [];

        for (const member of boardMembers) {
            const lines = this.getMemberLines(member, result, state);
            const delta = this.calculateSatisfactionDelta(member, result, state);
            feedback.push({
                member,
                lines,
                satisfactionDelta: delta
            });
        }

        // CEO special appearance (every 2-4 quarters, or on big events)
        const ceoAppearance = this.shouldCEOAppear(result, state);
        if (ceoAppearance) {
            feedback.push({
                member: {
                    role: 'Chairman',
                    name: this.getCEODisplayName(),
                    personality: 'ceo',
                    title: 'Chairman of the Board'
                },
                lines: ceoAppearance,
                satisfactionDelta: 0
            });
        }

        return feedback;
    }

    /**
     * Get dialogue lines for a board member based on context.
     */
    getMemberLines(member, result, state) {
        const personality = member.personality;
        const pool = this.dialogueData?.[personality];
        if (!pool) return [this.fallbackLine(member, result)];

        const lines = [];
        const rng = gameState.getRng();
        const k = (cat) => `${personality}.${cat}`;

        // Primary reaction: P&L outcome
        const pnlCategory = this.getPnLCategory(result);
        const pnlPool = pool[`${pnlCategory}_pnl`] || [];
        if (pnlPool.length > 0) {
            lines.push(this.pickNoRepeat(pnlPool, k(`${pnlCategory}_pnl`), rng));
        }

        // Secondary reactions based on player behaviour
        if (state.tradesThisQuarter > 3 && pool.overtrading) {
            lines.push(this.pickNoRepeat(pool.overtrading, k('overtrading'), rng));
        }

        if (state.tradeDirectionErrors > 0 && pool.trade_direction_error && state.tradesThisQuarter > 0) {
            const prevErrors = state.quarterlyResults.length > 1
                ? (state.quarterlyResults[state.quarterlyResults.length - 2]?.tradeDirectionErrors || 0)
                : 0;
            if (state.tradeDirectionErrors > prevErrors) {
                lines.push(this.pickNoRepeat(pool.trade_direction_error, k('trade_direction_error'), rng));
            }
        }

        if (result.marginCallAmount > 0 && pool.margin_call) {
            lines.push(this.pickNoRepeat(pool.margin_call, k('margin_call'), rng));
        }

        // Check for option usage — board reacts to premium cost
        const hasOptions = state.hedgePortfolio.some(h =>
            h.status === 'active' && (h.productType === 'option' || h.productType === 'cap') && h.premiumPaid > 0
        );
        if (hasOptions && pool.option_premium && rng.chance(0.4)) {
            lines.push(this.pickNoRepeat(pool.option_premium, k('option_premium'), rng));
        }

        // Policy violations
        if (state.policyViolations > 0 && pool.policy_violation) {
            const justViolated = !this.wasInComplianceLastQuarter(state);
            if (justViolated) {
                lines.push(this.pickNoRepeat(pool.policy_violation, k('policy_violation'), rng));
            }
        }

        // Over-hedging criticism (>100% of total remaining exposure)
        const remainingQuarters = Math.max(1, state.maxQuarters - state.totalQuartersPlayed);
        const maxHedgeRatio = state.exposures.reduce((maxR, exp) => {
            const totalExposure = exp.quarterlyNotional * remainingQuarters;
            const hedged = state.hedgePortfolio
                .filter(h => h.underlying === exp.underlying && h.status === 'active')
                .reduce((sum, h) => sum + h.notional, 0);
            const ratio = totalExposure > 0 ? hedged / totalExposure : 0;
            return Math.max(maxR, ratio);
        }, 0);
        if (maxHedgeRatio > 1.0) {
            const overhedgeLines = pool.overhedging || [
                "You're over-hedged. That's speculation, not hedging.",
                "Why are we hedged more than 100%? Are you running a prop desk?",
                "Over-hedging creates risk, it doesn't reduce it. Fix this.",
                "The policy says hedge our exposure, not take new positions."
            ];
            lines.push(this.pickNoRepeat(overhedgeLines, k('overhedging'), rng));
        }

        // v2: TMS spending feedback (30% chance per member to comment)
        if (rng.chance(0.3)) {
            const tmsLine = this.getTMSFeedbackLine(pool, state, rng, personality);
            if (tmsLine) lines.push(tmsLine);
        }

        // v2: Forecast variance feedback (25% chance, only if variance is notable)
        if (rng.chance(0.25)) {
            const varianceLine = this.getVarianceFeedbackLine(pool, state, rng, personality);
            if (varianceLine) lines.push(varianceLine);
        }

        // Limit to 2 lines max per member (keep it punchy)
        return lines.slice(0, 2);
    }

    /**
     * Get TMS-related feedback line for a board member.
     */
    getTMSFeedbackLine(pool, state, rng, personality = 'x') {
        const moduleCount = state.tmsModuleCount || 0;
        if (moduleCount === 0) return null;

        // Check if TMS spending is excessive
        const totalCost = state.tmsTotalCost || 0;
        const totalAnnualExposure = (state.exposures || [])
            .filter(e => e.type !== 'ir')
            .reduce((sum, e) => sum + (e.quarterlyNotional || 0) * 4, 0);

        const overSpending = (totalAnnualExposure > 0 && totalCost > totalAnnualExposure * 0.01) ||
                            (state.cashBalance > 0 && totalCost > state.cashBalance * 0.20);

        if (overSpending && pool.tms_overspend) {
            return this.pickNoRepeat(pool.tms_overspend, `${personality}.tms_overspend`, rng);
        } else if (moduleCount <= 2 && pool.tms_positive) {
            return this.pickNoRepeat(pool.tms_positive, `${personality}.tms_positive`, rng);
        }

        return null;
    }

    /**
     * Get forecast variance feedback line for a board member.
     */
    getVarianceFeedbackLine(pool, state, rng, personality = 'x') {
        const variance = forecastEngine.getEffectiveVariance(
            state.currentYearOffset,
            state.tmsModuleCount || 0
        );

        // High variance (>25%) — board is concerned
        if (variance > 0.25 && pool.high_variance) {
            return this.pickNoRepeat(pool.high_variance, `${personality}.high_variance`, rng);
        }

        // Low variance (<15%) — board is pleased
        if (variance < 0.15 && pool.low_variance) {
            return this.pickNoRepeat(pool.low_variance, `${personality}.low_variance`, rng);
        }

        return null;
    }

    /**
     * Determine P&L category for dialogue selection.
     */
    getPnLCategory(result) {
        const netPnL = result.netPnL || 0;
        const state = gameState.get();
        const revenue = state.industry?.annualRevenue || 1e9;
        const threshold = revenue * 0.005; // 0.5% of annual revenue

        if (netPnL > threshold) return 'good';
        if (netPnL < -threshold) return 'bad';
        return 'neutral';
    }

    /**
     * Calculate satisfaction change from this board member.
     */
    calculateSatisfactionDelta(member, result, state) {
        let delta = 0;
        const pnlCategory = this.getPnLCategory(result);

        // Base delta from P&L — gains rebalanced upward so good play is meaningful
        switch (pnlCategory) {
            case 'good':
                delta += member.personality === 'aggressive' ? 4 : member.personality === 'cautious' ? 5 : 3;
                break;
            case 'bad':
                delta += member.personality === 'aggressive' ? -4 : member.personality === 'cautious' ? -2 : -2;
                break;
            case 'neutral':
                delta += member.personality === 'aggressive' ? 0 : 1;
                break;
        }

        // Modifiers
        if (result.marginCallAmount > 0) delta -= 2;
        if (state.tradesThisQuarter > 3) delta -= 1;
        // Only penalize direction errors if trades were actually made this quarter
        if (state.tradeDirectionErrors > 0 && state.tradesThisQuarter > 0) delta -= 2;

        // Policy compliance bonus
        if (this.wasInComplianceLastQuarter(state)) delta += 2;

        // v2: Forecast variance penalty — high variance means less predictability
        const variance = forecastEngine.getEffectiveVariance(
            state.currentYearOffset,
            state.tmsModuleCount || 0
        );
        if (variance > 0.30 && member.personality === 'cautious') delta -= 1;
        if (variance < 0.15) delta += 1; // Tight forecasts = happy board

        // Clamp
        return Math.round(Math.max(GAME_CONFIG.SATISFACTION_LOSS_MAX / 3, Math.min(GAME_CONFIG.SATISFACTION_GAIN_MAX / 3, delta)));
    }

    /**
     * Determine if CEO should make a special appearance.
     */
    shouldCEOAppear(result, state) {
        if (!this.dialogueData?.ceo_special || !this.ceoPersona) return null;

        const ceoPool = this.dialogueData.ceo_special[this.ceoPersona];
        if (!ceoPool) return null;

        const rng = gameState.getRng();
        const revenue = state.industry?.annualRevenue || 1e9;
        const bigThreshold = revenue * 0.01; // 1% of revenue

        // No-repeat keys are namespaced per persona so the Chairman never repeats
        // a line over an 8-quarter playthrough.
        const ck = (cat) => `ceo.${this.ceoPersona}.${cat}`;

        // CEO always appears on the very first board review to introduce themselves
        if (state.totalQuartersPlayed === 0) {
            return [this.pickNoRepeat(ceoPool.general, ck('general'), rng)];
        }

        // CEO appears on big swings
        if (Math.abs(result.netPnL) > bigThreshold) {
            const category = result.netPnL > 0 ? 'big_win' : 'big_loss';
            const pool = ceoPool[category] || ceoPool.general;
            const poolKey = ceoPool[category] ? ck(category) : ck('general');
            const lines = [this.pickNoRepeat(pool, poolKey, rng)];

            // v2: CEO also comments on TMS if recently purchased
            if ((state.tmsModuleCount || 0) > 0 && ceoPool.tms_comment && rng.chance(0.4)) {
                lines.push(this.pickNoRepeat(ceoPool.tms_comment, ck('tms_comment'), rng));
            }

            return lines;
        }

        // Periodic appearance (~every 2-3 quarters)
        if (state.totalQuartersPlayed % 3 === 0 || rng.chance(0.35)) {
            const lines = [this.pickNoRepeat(ceoPool.general, ck('general'), rng)];

            // Chance to comment on TMS
            if ((state.tmsModuleCount || 0) > 0 && ceoPool.tms_comment && rng.chance(0.3)) {
                lines.push(this.pickNoRepeat(ceoPool.tms_comment, ck('tms_comment'), rng));
            }

            return lines;
        }

        return null;
    }

    /**
     * Get CEO display name based on persona.
     */
    getCEODisplayName() {
        const names = {
            'jameson': 'J.J. Jameson',
            'musk': 'ElonUsk',
            'oleary': "Michael O'Scary",
            'dimon': 'Jamie Diamond',
            'buffett': 'Warren Biscuit',
            'jobs': 'Steve Jobsworth',
            'dorsey': 'Jack Doorstep',
            'ackman': 'Bill Hackman'
        };
        return names[this.ceoPersona] || 'The CEO';
    }

    wasInComplianceLastQuarter(state) {
        const totalQ = state.totalQuartersPlayed || 0;
        const inCompliance = state.totalQuartersInCompliance || 0;
        // If all quarters so far were in compliance
        return inCompliance >= totalQ;
    }

    /**
     * Fallback line when no dialogue data loaded.
     */
    fallbackLine(member, result) {
        const pnl = result?.netPnL || 0;
        if (pnl > 0) return "Acceptable quarter. Keep it up.";
        if (pnl < 0) return "Disappointing numbers. We expect better.";
        return "Hmm. Let's see what next quarter brings.";
    }

    /**
     * Get stress level (0-100) for the Doom face HUD.
     * Higher = more stressed.
     */
    getStressLevel() {
        const state = gameState.get();
        let stress = 0;

        // Inverse of board satisfaction (0-40 points)
        stress += Math.max(0, (100 - state.boardSatisfaction) * 0.4);

        // Margin calls (10 points each)
        stress += Math.min(30, state.marginCallCount * 10);

        // Trade direction errors (15 points each)
        stress += Math.min(30, (state.tradeDirectionErrors || 0) * 15);

        // Negative P&L streak
        const recentResults = state.quarterlyResults.slice(-3);
        const lossStreak = recentResults.filter(r => r.netPnL < 0).length;
        stress += lossStreak * 8;

        // Cash pressure
        if (state.cashBalance < state.startingCash * 0.15) stress += 15;

        // v2: High forecast variance adds stress
        const variance = forecastEngine.getEffectiveVariance(
            state.currentYearOffset,
            state.tmsModuleCount || 0
        );
        if (variance > 0.30) stress += 5;

        return Math.min(100, Math.max(0, Math.round(stress)));
    }
}

// Singleton
export const boardAI = new BoardAIController();
