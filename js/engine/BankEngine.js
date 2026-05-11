// BankEngine — manages bank counterparties, credit limits, and diversification scoring

import { GAME_CONFIG } from '../utils/constants.js';

const BANK_POOL = [
    { id: 'goldmansacks', name: 'Goldman Sacks',     shortName: 'GSX',  tier: 1 },
    { id: 'jp_moaning',   name: 'JP Moaning',        shortName: 'JPM',  tier: 1 },
    { id: 'debit_suisse', name: 'Debit Suisse',      shortName: 'DBS',  tier: 1 },
    { id: 'barklays',     name: 'Bark Lays Bank',     shortName: 'BLB',  tier: 1 },
    { id: 'bnp_paribus',  name: 'BNP Pair-a-bus',    shortName: 'BNP',  tier: 1 },
    { id: 'hedge_bc',     name: 'HEDGE-BC',          shortName: 'HSBC', tier: 1 },
    { id: 'deutschemark', name: 'Deutschemark Bank',  shortName: 'DMB',  tier: 1 },
    { id: 'rbs',          name: 'Really Big Spreads', shortName: 'RBS',  tier: 2 },
    { id: 'nomura_idea',  name: 'No More Ideas',     shortName: 'NMI',  tier: 2 },
    { id: 'socgen',       name: 'So-So Générale',    shortName: 'SSG',  tier: 2 },
    { id: 'citi_slicker', name: 'City Slickers',     shortName: 'CSK',  tier: 2 },
    { id: 'ubs_downs',    name: 'UBS & Downs',       shortName: 'UBD',  tier: 2 },
];

class BankEngineController {
    constructor() {
        this.banks = [];           // Active bank relationships
        this.tradesByBank = {};    // { bankId: [hedgeIds] }
        this.limitRequests = 0;    // Times player requested more banks/limits
        this.lastRequestQuarter = -Infinity; // Most recent successful request quarter
    }

    /**
     * Initialize banks for a new game.
     * @param {number} numBanks - starting number of banks (1-3)
     * @param {number} creditLimitPerBank - default credit limit per bank
     * @param {object} rng - SeededRandom
     */
    init(numBanks, creditLimitPerBank, rng) {
        this.banks = [];
        this.tradesByBank = {};
        this.limitRequests = 0;
        this.lastRequestQuarter = -Infinity;

        // Pick random banks from pool
        const shuffled = rng.shuffle([...BANK_POOL]);
        for (let i = 0; i < Math.min(numBanks, shuffled.length); i++) {
            this.banks.push({
                ...shuffled[i],
                creditLimit: creditLimitPerBank,
                usedLimit: 0,
                active: true
            });
            this.tradesByBank[shuffled[i].id] = [];
        }
    }

    /**
     * Get list of active banks.
     */
    getActiveBanks() {
        return this.banks.filter(b => b.active);
    }

    /**
     * Get available credit at a specific bank.
     */
    getAvailableCredit(bankId) {
        const bank = this.banks.find(b => b.id === bankId);
        if (!bank || !bank.active) return 0;
        return Math.max(0, bank.creditLimit - bank.usedLimit);
    }

    /**
     * Allocate a trade to a bank.
     * @returns {boolean} true if successful
     */
    allocateTrade(bankId, hedgeId, notional) {
        const bank = this.banks.find(b => b.id === bankId);
        if (!bank || !bank.active) return false;

        if (bank.usedLimit + notional > bank.creditLimit) {
            return false; // Exceeds credit limit
        }

        bank.usedLimit += notional;
        if (!this.tradesByBank[bankId]) this.tradesByBank[bankId] = [];
        this.tradesByBank[bankId].push({ hedgeId, notional });
        return true;
    }

    /**
     * Release a trade from a bank (on settlement or unwind).
     */
    releaseTrade(bankId, hedgeId) {
        const bank = this.banks.find(b => b.id === bankId);
        if (!bank) return;

        const trades = this.tradesByBank[bankId] || [];
        const idx = trades.findIndex(t => t.hedgeId === hedgeId);
        if (idx >= 0) {
            bank.usedLimit -= trades[idx].notional;
            bank.usedLimit = Math.max(0, bank.usedLimit);
            trades.splice(idx, 1);
        }
    }

    /**
     * Check whether the player can currently make a bank request.
     * Returns { allowed, reason, detail } so UI can pre-disable buttons.
     * @param {string} requestType - 'new_bank' or 'increase_limit'
     * @param {object} state - current gameState snapshot
     */
    canRequest(requestType, state) {
        const minSat = requestType === 'new_bank'
            ? GAME_CONFIG.MIN_SATISFACTION_FOR_BANK_REQUEST
            : GAME_CONFIG.MIN_SATISFACTION_FOR_LIMIT_INCREASE;

        if ((state.boardSatisfaction || 0) < minSat) {
            return {
                allowed: false,
                reason: 'satisfaction_too_low',
                detail: `Requires satisfaction of at least ${minSat}% (currently ${state.boardSatisfaction || 0}%)`
            };
        }

        const cooldown = GAME_CONFIG.BANK_REQUEST_COOLDOWN_QUARTERS;
        const quartersSince = (state.totalQuartersPlayed || 0) - this.lastRequestQuarter;
        if (quartersSince < cooldown) {
            const remaining = cooldown - quartersSince;
            return {
                allowed: false,
                reason: 'cooldown',
                detail: `Cooldown: ${remaining} quarter${remaining === 1 ? '' : 's'} remaining`
            };
        }

        if (requestType === 'new_bank') {
            const currentIds = new Set(this.banks.map(b => b.id));
            const available = BANK_POOL.filter(b => !currentIds.has(b.id));
            if (available.length === 0) {
                return {
                    allowed: false,
                    reason: 'no_banks_available',
                    detail: 'All banks already onboarded'
                };
            }
        }

        return { allowed: true, reason: 'ok', detail: '' };
    }

    /**
     * Request additional bank or increased limits from the board.
     * Returns the result and board satisfaction cost.
     * @param {string} requestType - 'new_bank' or 'increase_limit'
     * @param {object} rng
     * @param {object} state - current gameState snapshot (for gating + cooldown stamp)
     * @returns {{ success: boolean, bank?: object, satisfactionCost: number, message: string, reason?: string }}
     */
    requestFromBoard(requestType, rng, state) {
        // Gate first — do not mutate anything if not allowed.
        const gate = this.canRequest(requestType, state);
        if (!gate.allowed) {
            return {
                success: false,
                satisfactionCost: 0,
                message: gate.detail,
                reason: gate.reason
            };
        }

        this.limitRequests++;

        // Each request costs board goodwill (diminishing patience)
        const baseCost = 3;
        const escalation = Math.min(5, this.limitRequests - 1);
        const satisfactionCost = baseCost + escalation;

        if (requestType === 'new_bank') {
            const currentIds = new Set(this.banks.map(b => b.id));
            const available = BANK_POOL.filter(b => !currentIds.has(b.id));

            const newBank = rng.pick(available);
            const avgLimit = this.banks.reduce((sum, b) => sum + b.creditLimit, 0) / this.banks.length;

            this.banks.push({
                ...newBank,
                creditLimit: avgLimit,
                usedLimit: 0,
                active: true
            });
            this.tradesByBank[newBank.id] = [];
            this.lastRequestQuarter = state.totalQuartersPlayed || 0;

            return {
                success: true,
                bank: newBank,
                satisfactionCost,
                message: `${newBank.name} has been onboarded as a new counterparty.`,
                reason: 'ok'
            };
        }

        if (requestType === 'increase_limit') {
            // Increase all banks by 25%
            for (const bank of this.banks) {
                bank.creditLimit = Math.round(bank.creditLimit * 1.25);
            }
            this.lastRequestQuarter = state.totalQuartersPlayed || 0;

            return {
                success: true,
                satisfactionCost,
                message: "Credit limits increased by 25% across all counterparties.",
                reason: 'ok'
            };
        }

        return { success: false, satisfactionCost: 0, message: "Unknown request type.", reason: 'unknown' };
    }

    /**
     * Calculate diversification score (0-1).
     * Higher = more evenly spread across banks.
     * Uses Herfindahl-Hirschman Index (HHI) inverted.
     */
    getDiversificationScore() {
        const activeBanks = this.getActiveBanks();
        if (activeBanks.length <= 1) return 0;

        const totalUsed = activeBanks.reduce((sum, b) => sum + b.usedLimit, 0);
        if (totalUsed === 0) return 0.5; // Neutral if nothing allocated

        // HHI = sum of squared market shares
        const hhi = activeBanks.reduce((sum, b) => {
            const share = b.usedLimit / totalUsed;
            return sum + share * share;
        }, 0);

        // Perfect diversification among N banks: HHI = 1/N
        // Single bank concentration: HHI = 1
        // Normalize: 0 = fully concentrated, 1 = perfectly diversified
        const minHHI = 1 / activeBanks.length;
        const maxHHI = 1;
        const score = 1 - (hhi - minHHI) / (maxHHI - minHHI);

        return Math.max(0, Math.min(1, score));
    }

    /**
     * Get utilization summary per bank for UI display.
     */
    getSummary() {
        return this.banks.map(b => ({
            ...b,
            utilization: b.creditLimit > 0 ? b.usedLimit / b.creditLimit : 0,
            tradeCount: (this.tradesByBank[b.id] || []).length
        }));
    }
}

// Singleton
export const bankEngine = new BankEngineController();
