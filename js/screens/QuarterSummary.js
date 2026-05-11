// Quarter Summary Screen — end-of-quarter P&L recap
// v2: Forecast vs realized breakdown, rate vs budget, overall hedging programme summary

import { gameState } from '../engine/GameState.js';
import { gameLoop } from '../engine/GameLoop.js';
import { formatPnL, formatCurrency, formatQuarter, formatPercent, formatRate, pnlClass } from '../utils/formatters.js';
import { MiniChart } from '../ui/MiniChart.js';
import { EraPopup } from '../ui/EraPopup.js';
import { soundFX } from '../ui/SoundFX.js';

export class QuarterSummaryScreen {
    constructor(app) {
        this.app = app;
        this.el = null;
    }

    render() {
        this.el = document.createElement('div');
        this.el.className = 'screen active summary-screen';

        const state = gameState.get();
        const result = state.quarterlyResults[state.quarterlyResults.length - 1];

        if (!result) {
            this.el.innerHTML = '<div class="flex-center flex-1 readable-text">No results to show</div>';
            return this.el;
        }

        const exposurePnL = result.exposurePnL || 0;
        const hedgePnL = result.hedgePnL || 0;
        const netPnL = result.netPnL || 0;
        const settledHedgePnL = result.settledHedgePnL || 0;
        const unsettledHedgePnL = result.unsettledHedgePnL || 0;
        const horizonExposurePnL = result.horizonExposurePnL || 0;
        const totalHedgeMtm = result.totalHedgeMtm || 0;
        const horizon = result.horizon || 4;
        const policy = state.hedgingPolicy;
        const hasBudget = policy && policy.budgetRateType !== 'none';
        const baseCcy = state.industry?.baseCurrency || '';
        const prevRates = state.previousRates || {};

        // Separate exposure and hedge details
        const exposureDetails = (result.details || []).filter(d => d.type === 'exposure');
        const hedgeDetails = (result.details || []).filter(d => d.type === 'hedge');

        this.el.innerHTML = `
            <div class="quarter-bar">
                <span class="company-name">${state.industry?.name || 'Company'}</span>
                <span class="quarter-label">QUARTER SUMMARY — ${formatQuarter(result.yearOffset, result.quarterNum)}</span>
                <span></span>
            </div>

            <div style="flex:1;padding:0 16px;overflow-y:auto;">
                <!-- Per-exposure breakdown -->
                <div class="panel" style="max-width:640px;margin:12px auto 0;">
                    <div class="panel-title">EXPOSURE BREAKDOWN</div>
                    ${exposureDetails.length > 0 ? exposureDetails.map(d => this.renderExposureDetail(d, hasBudget, baseCcy, prevRates)).join('') : '<div class="readable-text" style="color:var(--text-muted);padding:8px;">No exposure details</div>'}
                </div>

                <!-- Forecast variance communication -->
                ${this.renderVarianceCommunication(exposureDetails, baseCcy)}

                <!-- Hedge performance -->
                ${hedgeDetails.length > 0 ? `
                <div class="panel" style="max-width:640px;margin:8px auto;">
                    <div class="panel-title">HEDGE PERFORMANCE</div>
                    ${hedgeDetails.map(d => this.renderHedgeDetail(d, baseCcy)).join('')}
                </div>
                ` : ''}

                <!-- This quarter: realized exposure vs settled hedge cash flows -->
                <div class="panel" style="max-width:640px;margin:8px auto;">
                    <div class="panel-title">THIS QUARTER — REALIZED P&L</div>

                    <div class="summary-stat">
                        <span class="summary-stat-label">Exposure P&L (realized vs budget)</span>
                        <span class="summary-stat-value ${pnlClass(exposurePnL)}">${formatPnL(exposurePnL, baseCcy)}</span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-stat-label">Hedge settlement cash flow</span>
                        <span class="summary-stat-value ${pnlClass(settledHedgePnL)}">${formatPnL(settledHedgePnL, baseCcy)}</span>
                    </div>
                    <hr class="divider">
                    <div class="summary-stat">
                        <span class="summary-stat-label" style="font-weight:bold;">Net realized P&L</span>
                        <span class="summary-stat-value ${pnlClass(exposurePnL + settledHedgePnL)}" style="font-weight:bold;">${formatPnL(exposurePnL + settledHedgePnL, baseCcy)}</span>
                    </div>
                    ${settledHedgePnL === 0 && hedgeDetails.filter(d => d.maturedThisQ).length === 0 ? `
                    <div class="pixel-text" style="font-size:7px;color:var(--text-muted);text-align:center;margin-top:4px;">
                        No hedges matured this quarter
                    </div>` : ''}
                    ${this.renderHedgeEffectiveness(exposurePnL, settledHedgePnL)}
                </div>

                <!-- Full programme: horizon exposure vs total hedge book MTM -->
                <div class="panel" style="max-width:640px;margin:8px auto;">
                    <div class="panel-title">HEDGING PROGRAMME — ${horizon}Q HORIZON</div>

                    <div class="summary-stat">
                        <span class="summary-stat-label">Forecast exposure change (vs budget)</span>
                        <span class="summary-stat-value ${pnlClass(horizonExposurePnL)}">${formatPnL(horizonExposurePnL, baseCcy)}</span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-stat-label">Hedge book MTM (all hedges)</span>
                        <span class="summary-stat-value ${pnlClass(totalHedgeMtm)}">${formatPnL(totalHedgeMtm, baseCcy)}</span>
                    </div>
                    <hr class="divider">
                    <div class="summary-stat">
                        <span class="summary-stat-label" style="color:var(--text-primary);font-size:20px;">Net programme P&L</span>
                        <span class="summary-stat-value ${pnlClass(horizonExposurePnL + totalHedgeMtm)}" style="font-size:14px;">${formatPnL(horizonExposurePnL + totalHedgeMtm, baseCcy)}</span>
                    </div>

                    ${result.marginCallAmount > 0 ? `
                        <div class="summary-stat" style="margin-top:8px;">
                            <span class="summary-stat-label" style="color:var(--warning)">Margin Call</span>
                            <span class="summary-stat-value pnl-negative">${formatPnL(-result.marginCallAmount, baseCcy)}</span>
                        </div>
                    ` : ''}

                    ${this.renderHedgeEffectiveness(horizonExposurePnL, totalHedgeMtm)}
                </div>

                <!-- Running totals -->
                <div class="panel" style="max-width:640px;margin:8px auto;">
                    <div class="panel-title">RUNNING TOTALS</div>

                    <div class="summary-stat">
                        <span class="summary-stat-label">Cumulative P&L</span>
                        <span class="summary-stat-value ${pnlClass(state.cumulativePnL)}">${formatPnL(state.cumulativePnL, baseCcy)}</span>
                    </div>
                    <div class="pixel-text" style="font-size:7px;color:var(--text-muted);margin-top:-2px;margin-bottom:4px;">
                        Sum of quarterly exposure P&L + hedge MTM changes across all quarters played
                    </div>
                    <div class="summary-stat">
                        <span class="summary-stat-label">Cash Balance</span>
                        <span class="summary-stat-value" style="color:${state.cashBalance >= state.startingCash * 0.2 ? 'var(--pnl-positive)' : 'var(--pnl-negative)'}">
                            ${formatCurrency(state.cashBalance, baseCcy, true)}
                        </span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-stat-label">Board Satisfaction</span>
                        <span class="summary-stat-value" style="color:${state.boardSatisfaction >= 50 ? 'var(--satisfaction-high)' : state.boardSatisfaction >= 25 ? 'var(--satisfaction-mid)' : 'var(--satisfaction-low)'}">
                            ${state.boardSatisfaction}%
                        </span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-stat-label">Active Hedges</span>
                        <span class="summary-stat-value" style="color:var(--cyan)">
                            ${state.hedgePortfolio.filter(h => h.status === 'active').length}
                        </span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-stat-label">Quarters Remaining</span>
                        <span class="summary-stat-value" style="color:var(--gold)">
                            ${state.maxQuarters - state.totalQuartersPlayed - 1}
                        </span>
                    </div>

                    <!-- Sparklines -->
                    <div style="display:flex;gap:16px;margin-top:8px;justify-content:center;">
                        <div style="text-align:center;">
                            <div class="pixel-text" style="font-size:6px;color:var(--text-muted);margin-bottom:2px;">P&L HISTORY</div>
                            <div id="pnl-sparkline"></div>
                        </div>
                        <div style="text-align:center;">
                            <div class="pixel-text" style="font-size:6px;color:var(--text-muted);margin-bottom:2px;">SATISFACTION</div>
                            <div id="sat-sparkline"></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="dashboard-footer">
                <div></div>
                <button class="btn btn-gold" id="btn-next-quarter">NEXT QUARTER ▶</button>
            </div>
        `;

        return this.el;
    }

    renderExposureDetail(d, hasBudget, baseCcy, prevRates) {
        const decimals = d.underlying.includes('JPY') ? 2 : 4;
        const isIR = d.underlying === 'EURIBOR' || d.underlying === 'SOFR' || d.underlying === 'SONIA';
        const dec = isIR ? 4 : decimals;
        const forecastNotional = d.forecastNotional || 0;
        const realizedNotional = d.realizedNotional || forecastNotional;
        const variancePct = d.variancePct || 0;
        const hasVariance = Math.abs(variancePct) > 0.1;

        const startRate = prevRates[d.underlying] || d.budgetRate || 0;
        const endRate = d.currentRate || 0;
        const rateChange = startRate > 0 ? ((endRate - startRate) / startRate * 100) : 0;

        return `
            <div style="padding:6px 0;border-bottom:1px solid var(--border-inner);">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                        <span class="badge badge-fx" style="margin-right:4px;">${d.underlying}</span>
                        <span class="readable-text" style="font-size:13px;color:var(--text-secondary);">${d.description || ''}</span>
                    </div>
                    <span class="pixel-text ${pnlClass(d.pnl)}" style="font-size:9px;">${formatPnL(d.pnl, baseCcy)}</span>
                </div>
                <!-- Rate movement: start → end -->
                <div style="display:flex;gap:8px;margin-top:4px;align-items:center;flex-wrap:wrap;">
                    <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">
                        START: ${formatRate(startRate, dec, isIR ? 'ir' : null)}
                    </span>
                    <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">→</span>
                    <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">
                        END: ${formatRate(endRate, dec, isIR ? 'ir' : null)}
                    </span>
                    <span class="pixel-text" style="font-size:7px;color:${rateChange >= 0 ? 'var(--pnl-positive)' : 'var(--pnl-negative)'};">
                        ${rateChange >= 0 ? '+' : ''}${rateChange.toFixed(2)}%
                    </span>
                </div>
                <div style="display:flex;gap:12px;margin-top:2px;flex-wrap:wrap;">
                    <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">
                        FORECAST: ${formatCurrency(forecastNotional, '', true)}
                    </span>
                    <span class="pixel-text" style="font-size:7px;color:${hasVariance ? 'var(--gold)' : 'var(--text-muted)'};">
                        REALIZED: ${formatCurrency(realizedNotional, '', true)}
                        ${hasVariance ? `(${variancePct > 0 ? '+' : ''}${variancePct.toFixed(1)}%)` : ''}
                    </span>
                    ${hasBudget && d.budgetRate > 0 ? `
                    <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">
                        BUDGET: ${formatRate(d.budgetRate, dec, isIR ? 'ir' : null)}
                    </span>
                    ` : ''}
                </div>
            </div>
        `;
    }

    renderHedgeDetail(d, baseCcy) {
        const isIR = d.underlying === 'EURIBOR' || d.underlying === 'SOFR' || d.underlying === 'SONIA';
        const dec = isIR ? 4 : 4;

        return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border-inner);">
                <div>
                    <span class="badge badge-${d.assetClass || 'fx'}" style="margin-right:4px;">${d.productType}</span>
                    <span class="readable-text" style="font-size:13px;">${d.underlying}</span>
                    <span class="pixel-text" style="font-size:7px;color:var(--text-muted);margin-left:4px;">
                        @ ${formatRate(d.contractRate, dec, isIR ? 'ir' : null)}
                        → ${formatRate(d.currentRate, dec, isIR ? 'ir' : null)}
                    </span>
                    ${d.status === 'matured' ? '<span class="pixel-text" style="font-size:6px;color:var(--gold);margin-left:4px;">SETTLED</span>' : ''}
                </div>
                <span class="pixel-text ${pnlClass(d.pnl)}" style="font-size:9px;">${formatPnL(d.pnl, baseCcy)}</span>
            </div>
        `;
    }

    renderHedgeEffectiveness(exposurePnL, hedgePnL) {
        // Hedge effectiveness: how well did the hedges offset exposure losses?
        if (Math.abs(exposurePnL) < 100) {
            return `<div class="pixel-text" style="font-size:7px;color:var(--text-muted);text-align:center;margin-top:8px;">Minimal exposure movement this quarter</div>`;
        }

        // If exposure lost money, how much did hedges recover?
        // If exposure made money, hedges should offset (opportunity cost)
        const effectiveness = exposurePnL !== 0 ? Math.abs(hedgePnL / exposurePnL) : 0;
        const offsetPct = Math.round(effectiveness * 100);

        let commentary = '';
        let color = 'var(--text-muted)';

        if (exposurePnL < 0 && hedgePnL > 0) {
            // Hedges protecting against losses
            color = offsetPct >= 50 ? 'var(--pnl-positive)' : 'var(--gold)';
            commentary = offsetPct >= 80 ? 'Excellent hedge protection'
                : offsetPct >= 50 ? 'Good hedge protection'
                : offsetPct >= 20 ? 'Partial hedge protection'
                : 'Minimal hedge protection';
        } else if (exposurePnL > 0 && hedgePnL < 0) {
            // Hedges costing against favourable move
            color = 'var(--text-muted)';
            commentary = offsetPct >= 80 ? 'Hedges fully offset favourable move'
                : offsetPct >= 50 ? 'Hedges partially offset favourable move'
                : 'Low opportunity cost from hedging';
        } else if (exposurePnL < 0 && hedgePnL < 0) {
            color = 'var(--pnl-negative)';
            commentary = 'Both exposure and hedges lost value';
        } else {
            color = 'var(--pnl-positive)';
            commentary = 'Both exposure and hedges gained value';
        }

        return `
            <div style="margin-top:8px;text-align:center;">
                <div class="pixel-text" style="font-size:7px;color:var(--text-muted);margin-bottom:2px;">HEDGE EFFECTIVENESS</div>
                <div class="pixel-text" style="font-size:9px;color:${color};">${offsetPct}% — ${commentary}</div>
            </div>
        `;
    }

    renderVarianceCommunication(exposureDetails, baseCcy) {
        // Only show if there are exposures with notable variance (>5%)
        const variances = exposureDetails.filter(d => Math.abs(d.variancePct || 0) > 5);
        if (variances.length === 0) return '';

        const state = gameState.get();
        const tmsLevel = state.tmsModuleCount || 0;

        // Build the body: list each exposure with variance
        const lines = variances.map(d => {
            const dir = (d.variancePct || 0) > 0 ? 'higher' : 'lower';
            const absPct = Math.abs(d.variancePct).toFixed(1);
            return `<strong>${d.underlying}</strong>: Realized ${formatCurrency(d.realizedNotional, '', true)} vs forecast ${formatCurrency(d.forecastNotional, '', true)} (${absPct}% ${dir})`;
        });

        let advice = '';
        if (tmsLevel === 0) {
            advice = 'Consider investing in TMS modules to improve forecast accuracy.';
        } else if (tmsLevel < 4) {
            advice = `Current TMS level: ${tmsLevel}/8 modules. Additional modules will reduce forecast variance.`;
        } else {
            advice = `TMS level: ${tmsLevel}/8 modules. Forecast accuracy is improving.`;
        }

        const body = `
            <p>Please note the following variances between forecast and realized exposure this quarter:</p>
            <ul style="margin:4px 0;padding-left:16px;">
                ${lines.map(l => `<li style="margin:2px 0;font-size:13px;">${l}</li>`).join('')}
            </ul>
            <p style="font-size:12px;color:var(--text-muted);margin-top:6px;">${advice}</p>
        `;

        const popup = EraPopup.wrap({
            title: 'Forecast Variance Report',
            from: 'Finance Team',
            body,
            category: 'forecasting'
        });

        return `<div style="max-width:640px;margin:8px auto;">${popup}</div>`;
    }

    mount() {
        const state = gameState.get();
        const lastResult = state.quarterlyResults[state.quarterlyResults.length - 1];

        // Sound based on P&L
        if (lastResult?.netPnL > 0) {
            soundFX.positivePnL();
        } else if (lastResult?.netPnL < 0) {
            soundFX.negativePnL();
        }

        // Render sparklines
        const pnlData = state.quarterlyResults.map(r => r.netPnL || 0);
        const satData = state.satisfactionHistory.map(s => s.value);

        const pnlContainer = this.el.querySelector('#pnl-sparkline');
        const satContainer = this.el.querySelector('#sat-sparkline');

        if (pnlContainer && pnlData.length > 0) {
            MiniChart.bar(pnlContainer, pnlData, { width: 140, height: 28 });
        }
        if (satContainer && satData.length > 0) {
            MiniChart.satisfaction(satContainer, satData, { width: 140, height: 28 });
        }

        this.el.querySelector('#btn-next-quarter').addEventListener('click', () => {
            gameLoop.completeSummary();
        });
    }

    unmount() {}
}
