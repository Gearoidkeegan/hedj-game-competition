// ScoreEngine — centralised scoring with trading cost penalty and bank diversification bonus

import { GAME_CONFIG, GRADES } from '../utils/constants.js';
import { bankEngine } from './BankEngine.js';

class ScoreEngineController {

    /**
     * Calculate final scores for a completed game/level.
     * @param {object} state - gameState snapshot
     * @returns {{ pnl, boardSatisfaction, cashManagement, policyCompliance, riskAdjusted, tradingCostPenalty, diversificationBonus, total }}
     */
    calculateScores(state) {
        const annualRevenue = state.industry?.annualRevenue || 1e9;
        const maxDeviation = annualRevenue * 0.05;

        // P&L score: 100 = at budget, decreases with deviation
        const rawPnlScore = Math.max(0, 100 * (1 - Math.abs(state.cumulativePnL) / maxDeviation));

        // Trading cost penalty: deducted from P&L score
        // Each excess trade (beyond 3/quarter average) costs 2 points
        const avgTradesPerQuarter = state.totalQuartersPlayed > 0
            ? (state.totalTradingCosts || 0) / (state.totalQuartersPlayed || 1)
            : 0;
        const tradingCostPenalty = Math.min(15, Math.max(0, (avgTradesPerQuarter - 3) * 2));
        const pnlScore = Math.max(0, rawPnlScore - tradingCostPenalty);

        // Board satisfaction: direct value
        const boardScore = state.boardSatisfaction;

        // Cash management
        let cashScore = 100;
        cashScore -= state.marginCallCount * 10;
        if (state.cashWentNegative) cashScore -= 20;
        if (state.cashBalance < state.startingCash * GAME_CONFIG.LOW_CASH_THRESHOLD) cashScore -= 15;
        cashScore = Math.max(0, cashScore);

        // Policy compliance
        const totalQuarters = state.totalQuartersPlayed || 1;
        const complianceScore = (state.totalQuartersInCompliance / totalQuarters) * 100;

        // Risk-adjusted: penalize volatile P&L
        const pnls = state.quarterlyResults.map(r => r.netPnL || 0);
        const avgPnL = pnls.reduce((s, p) => s + p, 0) / (pnls.length || 1);
        const variance = pnls.reduce((s, p) => s + Math.pow(p - avgPnL, 2), 0) / (pnls.length || 1);
        const vol = Math.sqrt(variance);
        const maxVol = annualRevenue * 0.02;
        const rawRiskScore = Math.max(0, 100 * (1 - vol / maxVol));

        // Bank diversification bonus: adds up to 10 points to risk-adjusted score
        const diversificationScore = bankEngine.getDiversificationScore();
        const diversificationBonus = Math.round(diversificationScore * 10);
        const riskAdjScore = Math.min(100, rawRiskScore + diversificationBonus);

        // Trade direction error penalty: -5 per error from board score
        const directionPenalty = Math.min(20, (state.tradeDirectionErrors || 0) * 5);

        // Weighted total
        const weights = GAME_CONFIG.SCORE_WEIGHTS;
        const total =
            pnlScore * weights.pnl +
            Math.max(0, boardScore - directionPenalty) * weights.boardSatisfaction +
            cashScore * weights.cashManagement +
            complianceScore * weights.policyCompliance +
            riskAdjScore * weights.riskAdjusted;

        // Perfect compliance bonus: adds up to 10 points, but does NOT guarantee a minimum grade
        // Previously this guaranteed C (60), which was too generous for catastrophic failures
        const complianceBonus = state.perfectCompliance ? Math.min(10, 100 - total) : 0;

        let finalTotal = Math.min(100, total + complianceBonus);

        // If the player was fired by the board or burned out, the grade must reflect that.
        // Cap the total at the F threshold so the grade is always "Looking for Work".
        if (state.firedByBoard || state.burnedOut) {
            finalTotal = Math.min(finalTotal, 45);
        }

        return {
            pnl: pnlScore,
            boardSatisfaction: boardScore,
            cashManagement: cashScore,
            policyCompliance: complianceScore,
            riskAdjusted: riskAdjScore,
            tradingCostPenalty,
            diversificationBonus,
            directionPenalty,
            complianceBonus,
            total: finalTotal
        };
    }

    /**
     * Get grade info for a score.
     */
    getGrade(score) {
        for (const grade of GRADES) {
            if (score >= grade.min) return grade;
        }
        return GRADES[GRADES.length - 1];
    }
}

// Singleton
export const scoreEngine = new ScoreEngineController();
