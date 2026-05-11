// TMSEngine — Treasury Management System module purchase logic
// Players can invest in TMS modules to improve forecast accuracy
// Board reaction depends on spend relative to exposure and cash

import { gameState } from './GameState.js';

const MODULE_COST = 100000;            // EUR 100k per module
const MAX_MODULES = 8;
const VARIANCE_REDUCTION = 0.05;       // 5% forecast error reduction per module

// Board frustration thresholds
const MAX_SPEND_PCT_OF_EXPOSURE = 0.01;  // 1% of total annual exposure
const MAX_SPEND_PCT_OF_CASH = 0.20;      // 20% of current cash balance

class TMSEngineController {

    /**
     * Check if a TMS module can be purchased.
     * @param {object} state - Current game state
     * @returns {{ canBuy: boolean, reason: string }}
     */
    canPurchase(state) {
        if ((state.tmsModuleCount || 0) >= MAX_MODULES) {
            return { canBuy: false, reason: 'Maximum TMS modules already installed' };
        }
        if (state.cashBalance < MODULE_COST) {
            return { canBuy: false, reason: 'Insufficient cash for TMS module' };
        }
        return { canBuy: true, reason: '' };
    }

    /**
     * Purchase a TMS module. Deducts cash and updates state.
     * @returns {{ success: boolean, moduleCount: number, totalCost: number, boardReaction: string }}
     */
    purchase() {
        const state = gameState.get();
        const check = this.canPurchase(state);
        if (!check.canBuy) {
            return { success: false, moduleCount: state.tmsModuleCount || 0, totalCost: state.tmsTotalCost || 0, boardReaction: check.reason };
        }

        const newCount = (state.tmsModuleCount || 0) + 1;
        const newTotalCost = (state.tmsTotalCost || 0) + MODULE_COST;

        gameState.update({
            tmsModuleCount: newCount,
            tmsTotalCost: newTotalCost,
            cashBalance: state.cashBalance - MODULE_COST
        });

        const reaction = this.getBoardReaction(newCount, newTotalCost);

        gameState.emit('tmsPurchased', {
            moduleCount: newCount,
            totalCost: newTotalCost,
            moduleCost: MODULE_COST,
            boardReaction: reaction
        });

        return { success: true, moduleCount: newCount, totalCost: newTotalCost, boardReaction: reaction };
    }

    /**
     * Determine board reaction to TMS spending.
     * @param {number} moduleCount - Total modules after purchase
     * @param {number} totalCost - Cumulative TMS spend
     * @returns {string} 'positive' | 'neutral' | 'negative'
     */
    getBoardReaction(moduleCount, totalCost) {
        // First module is always welcomed
        if (moduleCount === 1) return 'positive';

        const state = gameState.get();

        // Calculate total annual exposure (excluding IR)
        const totalAnnualExposure = (state.exposures || [])
            .filter(e => e.type !== 'ir')
            .reduce((sum, e) => sum + (e.quarterlyNotional || 0) * 4, 0);

        // Check thresholds
        if (totalAnnualExposure > 0 && totalCost > totalAnnualExposure * MAX_SPEND_PCT_OF_EXPOSURE) {
            return 'negative';
        }
        if (state.cashBalance > 0 && totalCost > state.cashBalance * MAX_SPEND_PCT_OF_CASH) {
            return 'negative';
        }

        return 'neutral';
    }

    /**
     * Get the variance reduction provided by current TMS level.
     * @param {number} moduleCount
     * @returns {number} Total variance reduction (e.g. 0.20 for 4 modules)
     */
    getVarianceReduction(moduleCount) {
        return (moduleCount || 0) * VARIANCE_REDUCTION;
    }

    /**
     * Get display info for the TMS panel.
     * @returns {object}
     */
    getStatus() {
        const state = gameState.get();
        return {
            moduleCount: state.tmsModuleCount || 0,
            maxModules: MAX_MODULES,
            moduleCost: MODULE_COST,
            totalCost: state.tmsTotalCost || 0,
            varianceReduction: this.getVarianceReduction(state.tmsModuleCount),
            canBuy: this.canPurchase(state).canBuy
        };
    }
}

export const tmsEngine = new TMSEngineController();
