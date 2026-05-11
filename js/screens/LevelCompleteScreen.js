// Level Complete Screen — career mode transition between levels
// Shows score summary, pass/fail, flavour text, next level preview

import { gameState } from '../engine/GameState.js';
import { gameLoop } from '../engine/GameLoop.js';
import { careerEngine } from '../engine/CareerEngine.js';
import { scoreEngine } from '../engine/ScoreEngine.js';
import { GAME_CONFIG, GRADES } from '../utils/constants.js';
import { formatPnL, formatCurrency } from '../utils/formatters.js';

export class LevelCompleteScreen {
    constructor(app) {
        this.app = app;
        this.el = null;
        this.levelResult = null;
    }

    render() {
        this.el = document.createElement('div');
        this.el.className = 'screen active level-complete-screen';

        const state = gameState.get();
        const scores = scoreEngine.calculateScores(state);
        const finalScore = scores.total;
        const level = careerEngine.getCurrentLevel();
        const evaluation = careerEngine.evaluateLevel(finalScore);

        this.levelResult = { scores, finalScore, evaluation, level };

        const stressedOut = state.burnedOut || (state.maxStressReached || 0) >= 100;
        const passed = evaluation.passed && !state.firedByBoard && !state.burnedOut;
        const gradeInfo = scoreEngine.getGrade(finalScore);

        // Pick a reason-appropriate fail message instead of always using
        // the level's "ran out of cash" line, which can contradict the actual state.
        let flavourText;
        if (state.burnedOut) {
            flavourText = 'You walked out mid-quarter. The pressure was too much. Time for a long break.';
        } else if (state.firedByBoard) {
            if (state.cashWentNegative || state.cashBalance < 0) {
                flavourText = 'The company ran out of cash. Your LinkedIn now says "Open to Work".';
            } else if (state.boardSatisfaction <= GAME_CONFIG.FIRE_THRESHOLD) {
                flavourText = 'The board has lost confidence in you. Security is on the way to your desk.';
            } else {
                flavourText = level?.flavourText?.fail || 'The board has decided to part ways with you.';
            }
        } else {
            flavourText = careerEngine.getFlavourText(passed);
        }

        // Next level preview
        const nextLevelIdx = careerEngine.currentLevel + 1;
        const nextLevel = careerEngine.levelsData?.[nextLevelIdx] || null;

        // Career progress bar
        const progress = careerEngine.getProgress();
        const progressPips = careerEngine.getAllLevels().map((lvl, i) => {
            const done = i < progress.currentLevel;
            const current = i === progress.currentLevel;
            const scoreStr = progress.levelScores[i] ? `${Math.round(progress.levelScores[i])}` : '';
            return `
                <div class="career-pip ${done ? 'done' : current ? 'current' : 'future'}">
                    <div class="career-pip-icon">${lvl.icon}</div>
                    <div class="career-pip-name">${lvl.name}</div>
                    ${scoreStr ? `<div class="career-pip-score">${scoreStr}</div>` : ''}
                </div>
            `;
        }).join('<div class="career-pip-arrow">→</div>');

        this.el.innerHTML = `
            <div class="quarter-bar">
                <span class="company-name">CAREER MODE</span>
                <span class="quarter-label">LEVEL ${state.careerLevel} — ${(level?.name || '').toUpperCase()}</span>
            </div>

            <div style="flex:1;padding:24px;display:flex;flex-direction:column;align-items:center;overflow-y:auto;">

                <!-- Career progress -->
                <div class="career-progress" style="margin-bottom:20px;">
                    ${progressPips}
                </div>

                <!-- Result -->
                <div style="text-align:center;margin-bottom:16px;">
                    <div class="pixel-text" style="font-size:14px;color:${passed ? 'var(--pnl-positive)' : 'var(--pnl-negative)'};">
                        ${state.burnedOut ? 'BURNED OUT' : state.firedByBoard ? 'FIRED' : passed ? (evaluation.isLastLevel ? 'CAREER COMPLETE' : 'LEVEL PASSED') : 'LEVEL FAILED'}
                    </div>
                    <div class="gameover-grade" style="font-size:36px;">${gradeInfo.grade}</div>
                    <div class="pixel-text" style="font-size:9px;color:var(--text-secondary);margin-bottom:8px;">${gradeInfo.title}</div>
                </div>

                ${evaluation.specialOutcome ? `
                    <div class="panel" style="border-color:var(--gold);max-width:500px;width:100%;margin-bottom:16px;text-align:center;">
                        <div style="font-size:36px;margin-bottom:8px;">${evaluation.specialOutcome.icon}</div>
                        <div class="pixel-text" style="font-size:11px;color:var(--gold);margin-bottom:6px;">${evaluation.specialOutcome.title}</div>
                        <div class="readable-text" style="font-size:16px;color:var(--text-primary);">${evaluation.specialOutcome.description}</div>
                    </div>
                ` : ''}

                <!-- Score breakdown -->
                <div class="score-breakdown" style="max-width:500px;width:100%;">
                    ${this.renderScoreBar('P&L vs Budget', scores.pnl, GAME_CONFIG.SCORE_WEIGHTS.pnl)}
                    ${this.renderScoreBar('Board Satisfaction', scores.boardSatisfaction, GAME_CONFIG.SCORE_WEIGHTS.boardSatisfaction)}
                    ${this.renderScoreBar('Cash Management', scores.cashManagement, GAME_CONFIG.SCORE_WEIGHTS.cashManagement)}
                    ${this.renderScoreBar('Policy Compliance', scores.policyCompliance, GAME_CONFIG.SCORE_WEIGHTS.policyCompliance)}
                    ${this.renderScoreBar('Risk-Adjusted', scores.riskAdjusted, GAME_CONFIG.SCORE_WEIGHTS.riskAdjusted)}
                    <hr class="divider" style="margin:8px 0;">
                    <div class="score-row">
                        <span class="score-label" style="color:var(--gold)">LEVEL SCORE</span>
                        <div class="score-bar-bg">
                            <div class="score-bar-fill" style="width:${finalScore}%;background:var(--gold);"></div>
                        </div>
                        <span class="score-value" style="font-size:11px;">${Math.round(finalScore)}</span>
                    </div>
                    ${!evaluation.isLastLevel ? `
                        <div style="font-family:var(--font-pixel);font-size:7px;color:var(--text-muted);text-align:center;margin-top:4px;">
                            REQUIRED TO ADVANCE: ${evaluation.scoreToAdvance}
                        </div>
                    ` : ''}
                </div>

                <!-- Flavour text -->
                <div class="panel" style="max-width:500px;width:100%;margin:16px 0;">
                    <div class="readable-text" style="font-size:16px;color:var(--text-primary);text-align:center;font-style:italic;">
                        "${flavourText}"
                    </div>
                </div>

                ${(state.firedByBoard || stressedOut) ? `
                    <div class="panel" style="max-width:500px;width:100%;margin-bottom:16px;border-color:var(--gold);text-align:center;">
                        <div class="readable-text" style="font-size:16px;color:var(--text-primary);font-style:italic;margin-bottom:8px;">
                            Lucky this was a simulation. If you need real help with your treasury risk,
                            talk to <a href="https://www.hedj.eu" target="_blank" rel="noopener" style="color:var(--cyan);text-decoration:underline;">Hedj</a> today.
                        </div>
                        <a href="https://www.hedj.eu" target="_blank" rel="noopener" class="btn btn-gold" style="display:inline-block;font-size:13px;padding:6px 14px;text-decoration:none;">VISIT HEDJ.EU</a>
                    </div>
                ` : ''}

                <!-- Stats -->
                <div class="panel" style="max-width:500px;width:100%;margin-bottom:16px;">
                    <div class="panel-title">LEVEL STATISTICS</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-family:var(--font-readable);font-size:16px;">
                        <div style="color:var(--text-muted)">Industry</div>
                        <div style="text-align:right">${state.industry?.name || '—'}</div>
                        <div style="color:var(--text-muted)">Quarters</div>
                        <div style="text-align:right">${state.totalQuartersPlayed}</div>
                        <div style="color:var(--text-muted)">Cumulative P&L</div>
                        <div style="text-align:right;color:${state.cumulativePnL >= 0 ? 'var(--pnl-positive)' : 'var(--pnl-negative)'};">${formatPnL(state.cumulativePnL)}</div>
                        <div style="color:var(--text-muted)">Final Satisfaction</div>
                        <div style="text-align:right">${state.boardSatisfaction}%</div>
                    </div>
                </div>

                ${passed && nextLevel && !evaluation.isLastLevel ? `
                    <!-- Next level preview -->
                    <div class="panel" style="max-width:500px;width:100%;border-color:var(--cyan-dark);margin-bottom:16px;">
                        <div class="panel-title" style="color:var(--cyan);">NEXT: LEVEL ${nextLevelIdx + 1} — ${nextLevel.name.toUpperCase()}</div>
                        <div class="readable-text" style="font-size:15px;color:var(--text-secondary);margin-bottom:8px;">${nextLevel.description}</div>
                        <div style="font-family:var(--font-pixel);font-size:7px;color:var(--text-muted);">
                            ${nextLevel.quarters} QUARTERS · ${nextLevel.parameters.maxExposures} EXPOSURES · ${nextLevel.parameters.startingBanks} BANKS
                        </div>
                    </div>
                ` : ''}

                <!-- Actions -->
                <div class="gameover-buttons">
                    ${passed && !evaluation.isLastLevel ? `
                        <button class="btn btn-gold" id="btn-next-level">NEXT LEVEL ▶</button>
                    ` : ''}
                    ${evaluation.isLastLevel || !passed ? `
                        <button class="btn btn-gold" id="btn-career-results">VIEW CAREER RESULTS</button>
                    ` : ''}
                    <button class="btn" id="btn-quit-career">QUIT TO MENU</button>
                </div>
            </div>
        `;

        return this.el;
    }

    mount() {
        const { finalScore, evaluation } = this.levelResult;
        const state = gameState.get();
        const passed = evaluation.passed && !state.firedByBoard;

        // Next level button
        this.el.querySelector('#btn-next-level')?.addEventListener('click', () => {
            careerEngine.advanceLevel(finalScore, state.industryId);
            // Reset game state but keep career progress
            this.app.showScreen('setup');
        });

        // Career results (final level or failed)
        this.el.querySelector('#btn-career-results')?.addEventListener('click', () => {
            careerEngine.advanceLevel(finalScore, state.industryId);
            this.setPhaseGameOver();
        });

        // Quit
        this.el.querySelector('#btn-quit-career')?.addEventListener('click', () => {
            careerEngine.reset();
            gameState.reset();
            this.app.showScreen('title');
        });
    }

    unmount() {}

    setPhaseGameOver() {
        gameState.update({ phase: 'gameover' });
        this.app.showScreen('gameover');
    }

    renderScoreBar(label, score, weight) {
        const barColor = score >= 70 ? 'var(--pnl-positive)' : score >= 40 ? 'var(--gold)' : 'var(--pnl-negative)';
        return `
            <div class="score-row">
                <span class="score-label">${label.toUpperCase()} (${Math.round(weight * 100)}%)</span>
                <div class="score-bar-bg">
                    <div class="score-bar-fill" style="width:${Math.max(0, Math.min(100, score))}%;background:${barColor};"></div>
                </div>
                <span class="score-value">${Math.round(score)}</span>
            </div>
        `;
    }

}
