// ForecastEngine — generates realized exposure notionals with variance from forecast
// Variance is high in early years, reduces with company maturity and TMS investment
// IR exposures are excluded (debt notionals are contracted, not forecast)

import { gameState } from './GameState.js';

const VARIANCE_BASE = 0.40;            // +/-40% in Year 1
const VARIANCE_YEAR_DECAY = 0.10;      // Reduces by 10% per year of maturity
const VARIANCE_TMS_REDUCTION = 0.05;   // Each TMS module reduces by 5%
const VARIANCE_FLOOR = 0.05;           // Minimum 5% variance even with max TMS

class ForecastEngineController {

    /**
     * Calculate the effective variance band for a given year and TMS level.
     * @param {number} yearOffset - 0-based year (0 = Y1)
     * @param {number} tmsModuleCount - Number of TMS modules installed
     * @returns {number} Effective variance (e.g. 0.40 = +/-40%)
     */
    getEffectiveVariance(yearOffset, tmsModuleCount) {
        const yearReduction = yearOffset * VARIANCE_YEAR_DECAY;
        const tmsReduction = (tmsModuleCount || 0) * VARIANCE_TMS_REDUCTION;
        return Math.max(VARIANCE_FLOOR, VARIANCE_BASE - yearReduction - tmsReduction);
    }

    /**
     * Generate realized notionals for all active exposures this quarter.
     * Called once at quarter resolution, before P&L calculation.
     *
     * @param {Array} exposures - Active exposure objects
     * @param {number} yearOffset - Current year offset (0-based)
     * @param {number} tmsModuleCount - TMS modules purchased
     * @param {object} rng - Seeded RNG instance
     * @returns {object} Map of { exposureId: realizedNotional }
     */
    generateQuarterRealized(exposures, yearOffset, tmsModuleCount, rng) {
        const variance = this.getEffectiveVariance(yearOffset, tmsModuleCount);
        const realized = {};

        for (const exp of exposures) {
            // IR exposures excluded — debt notionals are contracted, not forecast
            if (exp.type === 'ir') {
                realized[exp.id] = exp.quarterlyNotional;
                continue;
            }

            // Generate a variance factor within [-variance, +variance]
            const varianceFactor = (rng.next() * 2 - 1) * variance;
            realized[exp.id] = Math.round(exp.quarterlyNotional * (1 + varianceFactor));
        }

        return realized;
    }

    /**
     * Calculate the variance percentage between forecast and realized.
     * @param {number} forecast - quarterlyNotional
     * @param {number} realized - actual notional
     * @returns {number} Percentage variance (e.g. -15.3 for 15.3% below forecast)
     */
    getVariancePercent(forecast, realized) {
        if (!forecast || forecast === 0) return 0;
        return ((realized - forecast) / forecast) * 100;
    }
}

export const forecastEngine = new ForecastEngineController();
