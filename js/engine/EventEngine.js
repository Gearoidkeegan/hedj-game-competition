// EventEngine — loads events, selects contextual events per quarter, handles two-part events

import { gameState } from './GameState.js';
import { GAME_CONFIG } from '../utils/constants.js';

class EventEngineController {
    constructor() {
        this.eventPool = [];
        this.pendingPart2 = [];   // Two-part events awaiting resolution: { event, choice, resolveAtQuarter }
    }

    /**
     * Load events from JSON. Call once at app startup.
     */
    async loadEvents(basePath = 'data') {
        try {
            const resp = await fetch(`${basePath}/events.json`);
            const data = await resp.json();
            this.eventPool = data.events || [];
            console.log(`EventEngine: loaded ${this.eventPool.length} events`);
        } catch (e) {
            console.warn('EventEngine: could not load events', e);
            this.eventPool = [];
        }
    }

    /**
     * Select an event for the current quarter (may return null).
     * Considers: industry, cooldowns, min_quarter, weights, pending part2 resolutions.
     */
    selectEvent() {
        const state = gameState.get();
        const rng = gameState.getRng();

        // First check for pending part2 resolutions
        const dueResolution = this.getDuePart2();
        if (dueResolution) {
            return dueResolution;
        }

        // Filter eligible events
        const eligible = this.eventPool.filter(ev => this.isEligible(ev, state));
        if (eligible.length === 0) return null;

        // Weighted random selection
        const totalWeight = eligible.reduce((sum, ev) => sum + (ev.weight || 1), 0);
        let roll = rng.next() * totalWeight;

        for (const ev of eligible) {
            roll -= (ev.weight || 1);
            if (roll <= 0) {
                return this.prepareEvent(ev);
            }
        }

        // Fallback (shouldn't reach here)
        return this.prepareEvent(eligible[eligible.length - 1]);
    }

    /**
     * Check if an event is eligible to fire this quarter.
     */
    isEligible(event, state) {
        // Industry filter
        if (event.industries && !event.industries.includes('all')) {
            if (!event.industries.includes(state.industryId)) return false;
        }

        // Cooldown check
        if (state.eventCooldowns[event.id] > 0) return false;

        // Minimum quarter requirement
        if (event.min_quarter && state.totalQuartersPlayed < event.min_quarter) return false;

        // Don't fire the same two-part event if part2 is still pending
        if (this.pendingPart2.some(p => p.event.id === event.id)) return false;

        // PE acquisition can only happen once
        if (event.id === 'pe_acquisition' && state.peAcquired) return false;

        return true;
    }

    /**
     * Prepare an event for display. Returns a standardised event object.
     */
    prepareEvent(event) {
        if (event.type === 'two_part') {
            return {
                id: event.id,
                name: event.name,
                type: 'two_part_trigger',
                category: event.category,
                title: event.part1.title,
                description: this.interpolateDescription(event.part1.description),
                choices: event.part1.choices,
                _sourceEvent: event
            };
        }

        // Instant event
        return {
            id: event.id,
            name: event.name,
            type: 'instant',
            category: event.category,
            title: event.title,
            description: this.interpolateDescription(event.description),
            choices: event.choices,
            board_note: event.board_note || null,
            _sourceEvent: event
        };
    }

    /**
     * Interpolate dynamic placeholders in event descriptions.
     */
    interpolateDescription(text) {
        if (!text) return '';
        const state = gameState.get();

        // Replace {exposure_type} with the primary exposure type
        const primaryExposure = state.exposures?.[0];
        const exposureType = primaryExposure
            ? `${primaryExposure.assetClass} (${primaryExposure.underlying})`
            : 'FX';

        // Calculate hedge book MTM for {hedge_mtm} placeholder
        let hedgeMtm = 0;
        let hedgeCount = 0;
        for (const h of state.hedgePortfolio) {
            if (h.status === 'active') {
                hedgeMtm += (h.currentMtm || 0);
                hedgeCount++;
            }
        }
        const mtmSign = hedgeMtm >= 0 ? 'in' : 'out of';
        const mtmAbs = Math.abs(hedgeMtm);
        const mtmStr = mtmAbs >= 1e6
            ? `${(mtmAbs / 1e6).toFixed(1)}M`
            : mtmAbs >= 1e3
                ? `${(mtmAbs / 1e3).toFixed(0)}K`
                : mtmAbs.toFixed(0);
        const currency = state.industry?.baseCurrency || 'EUR';
        const hedgeMtmText = hedgeCount > 0
            ? `Your ${hedgeCount} active hedge${hedgeCount > 1 ? 's are' : ' is'} currently ${currency} ${mtmStr} ${mtmSign} the money.`
            : 'You have no active hedges.';

        return text
            .replace(/\{exposure_type\}/g, exposureType)
            .replace(/\{industry\}/g, state.industry?.name || 'your company')
            .replace(/\{company\}/g, state.companyName || state.industry?.companyName || 'the company')
            .replace(/\{hedge_mtm\}/g, hedgeMtmText);
    }

    /**
     * Process the player's choice for an event.
     * Returns the outcome including effects to apply.
     */
    processChoice(event, choiceId) {
        const state = gameState.get();
        const rng = gameState.getRng();

        // Set cooldown (4 quarters by default — same scenario can't repeat within a year)
        const cooldownQuarters = 4;
        gameState.update({
            eventCooldowns: {
                ...state.eventCooldowns,
                [event.id]: cooldownQuarters
            }
        });

        // Record in event history
        state.eventHistory.push({
            eventId: event.id,
            quarter: state.totalQuartersPlayed,
            choiceId
        });

        // Handle two-part event trigger (part 1)
        if (event.type === 'two_part_trigger') {
            const sourceEvent = event._sourceEvent;
            const resolveAt = state.totalQuartersPlayed + (sourceEvent.part2_delay || 1);

            this.pendingPart2.push({
                event: sourceEvent,
                choiceId,
                resolveAtQuarter: resolveAt
            });

            return {
                type: 'pending',
                message: `Decision recorded. The outcome will be revealed in ${sourceEvent.part2_delay || 1} quarter(s).`
            };
        }

        // Handle part2 resolution
        if (event.type === 'part2_resolution') {
            return this.resolvePart2(event, choiceId);
        }

        // Handle instant event
        const choice = event.choices?.find(c => c.id === choiceId);
        if (!choice) return { type: 'error', message: 'Invalid choice.' };

        const effects = choice.effect || {};
        this.applyEffects(effects);

        return {
            type: 'instant',
            choiceLabel: choice.label,
            effects,
            satisfactionDelta: effects.satisfaction_delta || 0
        };
    }

    /**
     * Check for pending part2 events that are due this quarter.
     * Returns a prepared part2 resolution event, or null.
     */
    getDuePart2() {
        const state = gameState.get();
        const rng = gameState.getRng();

        const dueIdx = this.pendingPart2.findIndex(
            p => p.resolveAtQuarter <= state.totalQuartersPlayed
        );

        if (dueIdx === -1) return null;

        const pending = this.pendingPart2.splice(dueIdx, 1)[0];
        const sourceEvent = pending.event;

        // Determine if the contingent event materialised
        const materialised = rng.chance(sourceEvent.part2_materialise_chance || 0.5);

        const part2 = materialised
            ? sourceEvent.part2_materialised
            : sourceEvent.part2_not_materialised;

        // Build outcome based on original choice and whether ITM/OTM
        let outcomeKey = pending.choiceId;

        if (materialised && (pending.choiceId === 'hedge_forward' || pending.choiceId === 'hedge_option')) {
            // Determine if the hedge is ITM or OTM
            const isITM = rng.chance(0.5);
            outcomeKey = `${pending.choiceId}_${isITM ? 'itm' : 'otm'}`;
        }

        const outcome = part2.outcomes[outcomeKey];
        if (!outcome) {
            console.warn(`EventEngine: no outcome for key "${outcomeKey}" in event "${sourceEvent.id}"`);
            return null;
        }

        return {
            id: `${sourceEvent.id}_part2`,
            name: sourceEvent.name,
            type: 'part2_resolution',
            category: sourceEvent.category,
            title: part2.title,
            description: part2.description,
            materialised,
            originalChoice: pending.choiceId,
            outcome,
            outcomeKey,
            choices: [
                {
                    id: 'acknowledge',
                    label: 'Acknowledge',
                    description: outcome.description
                }
            ],
            _sourceEvent: sourceEvent
        };
    }

    /**
     * Resolve a part2 event outcome.
     */
    resolvePart2(event, choiceId) {
        const outcome = event.outcome;
        if (!outcome) return { type: 'error', message: 'No outcome data.' };

        // Build board reaction text
        const reactions = [];
        if (outcome.board_reactions) {
            for (const [type, text] of Object.entries(outcome.board_reactions)) {
                reactions.push({ type, text });
            }
        }

        // Apply satisfaction delta
        if (outcome.satisfaction_delta) {
            gameState.adjustSatisfaction(outcome.satisfaction_delta);
        }

        return {
            type: 'part2_resolved',
            materialised: event.materialised,
            title: event.title,
            description: outcome.description,
            boardReactions: reactions,
            satisfactionDelta: outcome.satisfaction_delta || 0,
            originalChoice: event.originalChoice
        };
    }

    /**
     * Apply effects from an event choice to game state.
     */
    applyEffects(effects) {
        const state = gameState.get();

        // Satisfaction
        if (effects.satisfaction_delta) {
            gameState.adjustSatisfaction(effects.satisfaction_delta);
        }

        // Cash drain (percentage of starting cash)
        if (effects.cash_drain_pct) {
            const drain = state.startingCash * effects.cash_drain_pct;
            gameState.update({ cashBalance: state.cashBalance - drain });
        }

        // Unwind percentage of hedge portfolio
        if (effects.unwind_pct) {
            const hedges = state.hedgePortfolio.filter(h => h.status === 'active');
            const numToUnwind = Math.ceil(hedges.length * effects.unwind_pct);
            for (let i = 0; i < numToUnwind && i < hedges.length; i++) {
                hedges[i].status = 'unwound';
                // Breakage cost
                const breakage = hedges[i].notional * GAME_CONFIG.EARLY_UNWIND_COST;
                gameState.update({ cashBalance: gameState.get().cashBalance - breakage });
            }
            gameState.update({
                hedgePortfolio: state.hedgePortfolio.filter(h => h.status === 'active')
            });
        }

        // Overhedge flag
        if (effects.overhedge_flag) {
            gameState.update({ overhedged: true });
        }

        // Exposure increase (all exposures)
        if (effects.exposure_increase) {
            const exposures = state.exposures.map(exp => ({
                ...exp,
                quarterlyNotional: exp.quarterlyNotional * (1 + effects.exposure_increase)
            }));
            gameState.update({ exposures });
        }

        // Revenue-side exposures shrink (sales/receive directions only).
        // Used by events like revenue_shortfall and pharma_rejection where
        // the underlying *income* drops but cost-side exposures are unaffected.
        // Player must rebalance their hedge book themselves.
        if (effects.revenue_shrink_pct) {
            const exposures = gameState.get().exposures.map(exp => {
                if (exp.direction === 'sell' || exp.direction === 'receive') {
                    return {
                        ...exp,
                        quarterlyNotional: exp.quarterlyNotional * (1 - effects.revenue_shrink_pct)
                    };
                }
                return exp;
            });
            gameState.update({ exposures });
        }

        // Cost-side exposures increase (buy/pay directions only).
        // Used by cost_overrun where operating costs balloon but revenue is unaffected.
        if (effects.cost_increase_pct) {
            const exposures = gameState.get().exposures.map(exp => {
                if (exp.direction === 'buy' || exp.direction === 'pay') {
                    return {
                        ...exp,
                        quarterlyNotional: exp.quarterlyNotional * (1 + effects.cost_increase_pct)
                    };
                }
                return exp;
            });
            gameState.update({ exposures });
        }

        // Cost-side exposures shrink (buy/pay directions only).
        // Used by construction_delay — project pushed out, near-term materials
        // and equipment exposures drop, but the player's existing hedges are
        // now over-sized and must be rolled or unwound.
        if (effects.cost_shrink_pct) {
            const exposures = gameState.get().exposures.map(exp => {
                if (exp.direction === 'buy' || exp.direction === 'pay') {
                    return {
                        ...exp,
                        quarterlyNotional: exp.quarterlyNotional * (1 - effects.cost_shrink_pct)
                    };
                }
                return exp;
            });
            gameState.update({ exposures });
        }

        // PE takeover
        if (effects.pe_takeover) {
            gameState.update({ peAcquired: true });
        }

        // IR exposure multiply
        if (effects.ir_exposure_multiply) {
            const exposures = state.exposures.map(exp => {
                if (exp.assetClass === 'ir') {
                    return { ...exp, quarterlyNotional: exp.quarterlyNotional * effects.ir_exposure_multiply };
                }
                return exp;
            });
            gameState.update({ exposures });
        }

        // Satisfaction reset (e.g. PE acquisition)
        if (effects.satisfaction_reset !== undefined) {
            gameState.update({ boardSatisfaction: effects.satisfaction_reset });
        }

        // Unwind all revenue hedges
        if (effects.unwind_revenue_hedges) {
            const hedges = state.hedgePortfolio.filter(h => h.status === 'active');
            for (const hedge of hedges) {
                if (hedge.productType === 'forward' || hedge.productType === 'future') {
                    const breakage = hedge.notional * GAME_CONFIG.EARLY_UNWIND_COST;
                    gameState.update({ cashBalance: gameState.get().cashBalance - breakage });
                }
                hedge.status = 'unwound';
            }
            gameState.update({
                hedgePortfolio: state.hedgePortfolio.filter(h => h.status === 'active')
            });
        }

        // Rate shock (specific underlying spikes)
        if (effects.rate_shock) {
            const rates = { ...state.currentRates };
            for (const [underlying, pctChange] of Object.entries(effects.rate_shock)) {
                if (rates[underlying]) {
                    rates[underlying] *= (1 + pctChange);
                }
            }
            gameState.update({ currentRates: rates });
        }

        // Counterparty risk flag
        if (effects.counterparty_risk) {
            gameState.update({ counterpartyRiskFlag: true });
        }

        // Roll cost
        if (effects.roll_cost_pct) {
            const totalNotional = state.hedgePortfolio
                .filter(h => h.status === 'active')
                .reduce((sum, h) => sum + h.notional, 0);
            const rollCost = totalNotional * effects.roll_cost_pct;
            gameState.update({ cashBalance: state.cashBalance - rollCost });
        }

        // Transfer cost
        if (effects.transfer_cost_pct) {
            const totalNotional = state.hedgePortfolio
                .filter(h => h.status === 'active')
                .reduce((sum, h) => sum + h.notional, 0);
            const transferCost = totalNotional * effects.transfer_cost_pct;
            gameState.update({ cashBalance: state.cashBalance - transferCost });
        }

        // Commodity spike
        if (effects.commodity_spike) {
            const rates = { ...state.currentRates };
            for (const exp of state.exposures) {
                if (exp.assetClass === 'commodity' && rates[exp.underlying]) {
                    rates[exp.underlying] *= (1 + effects.commodity_spike);
                }
            }
            gameState.update({ currentRates: rates });
        }
    }

    /**
     * Should an event fire this quarter?
     * Uses weighted probability based on how many events have fired recently.
     */
    shouldFireEvent() {
        const state = gameState.get();
        const rng = gameState.getRng();

        // Always fire pending part2 events
        if (this.pendingPart2.some(p => p.resolveAtQuarter <= state.totalQuartersPlayed)) {
            return true;
        }

        // Count events in recent quarters
        const recentEvents = state.eventHistory.filter(
            e => e.quarter >= state.totalQuartersPlayed - 3
        ).length;

        // Base probability ~40%, increases if no recent events, decreases if many
        let probability = 0.4;
        if (recentEvents === 0 && state.totalQuartersPlayed >= 2) probability = 0.7;
        if (recentEvents >= 2) probability = 0.2;
        if (recentEvents >= 3) probability = 0.1;

        // Force event if none in last 4 quarters (to meet MIN_EVENTS_PER_YEAR)
        const eventsThisYear = state.eventHistory.filter(
            e => e.quarter >= state.totalQuartersPlayed - 3
        ).length;
        if (eventsThisYear === 0 && state.totalQuartersPlayed >= 4) {
            return true;
        }

        return rng.chance(probability);
    }

    /**
     * Get pending part2 events summary for UI display.
     */
    getPendingEvents() {
        return this.pendingPart2.map(p => ({
            eventName: p.event.name,
            choiceId: p.choiceId,
            resolveAtQuarter: p.resolveAtQuarter,
            quartersRemaining: p.resolveAtQuarter - gameState.get().totalQuartersPlayed
        }));
    }

    /**
     * Reset for new game.
     */
    reset() {
        this.pendingPart2 = [];
    }
}

// Singleton
export const eventEngine = new EventEngineController();
