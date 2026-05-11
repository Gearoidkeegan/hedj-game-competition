// Game Over Screen — final score, grade, global leaderboard submission

import { gameState } from '../engine/GameState.js';
import { scoreEngine } from '../engine/ScoreEngine.js';
import { GRADES, GAME_CONFIG } from '../utils/constants.js';
import { formatPnL, formatPercent, formatCurrency } from '../utils/formatters.js';
import { addLeaderboardEntry, getLeaderboard, getRegistration, savePendingScore, clearPendingScore } from '../utils/storage.js';
import { submitScore, fetchLeaderboard } from '../utils/api.js';
import { soundFX } from '../ui/SoundFX.js';

export class GameOverScreen {
    constructor(app) {
        this.app = app;
        this.el = null;
        this.yearFacts = null;
        this.submitted = false;
    }

    async loadYearFacts() {
        if (this.yearFacts) return;
        try {
            const resp = await fetch('data/year-facts.json');
            const data = await resp.json();
            this.yearFacts = data.yearFacts || {};
        } catch (e) {
            console.warn('Could not load year facts:', e);
            this.yearFacts = {};
        }
    }

    render() {
        this.el = document.createElement('div');
        this.el.className = 'screen active gameover-screen';

        const state = gameState.get();
        const scores = scoreEngine.calculateScores(state);
        const finalScore = scores.total;
        const gradeInfo = scoreEngine.getGrade(finalScore);

        // Check special outcomes
        let specialMessage = '';
        const stressedOut = state.burnedOut || (state.maxStressReached || 0) >= 100;
        if (state.burnedOut) {
            specialMessage = `
                <div class="panel" style="border-color:var(--pnl-negative);margin-bottom:16px;max-width:500px;">
                    <div class="readable-text" style="font-size:18px;color:var(--pnl-negative);text-align:center;">
                        BURNED OUT.
                        <br>The pressure became too much. You've walked out of the building
                        <br>with no notice and no plan. Your therapist is going to be busy.
                    </div>
                </div>
            `;
        } else if (state.firedByBoard) {
            specialMessage = `
                <div class="panel" style="border-color:var(--pnl-negative);margin-bottom:16px;max-width:500px;">
                    <div class="readable-text" style="font-size:18px;color:var(--pnl-negative);text-align:center;">
                        You have been escorted from the building by security.
                        <br>Your personal effects will be mailed to you.
                    </div>
                </div>
            `;
        } else if (state.promotedToCEO) {
            specialMessage = `
                <div class="panel" style="border-color:var(--gold);margin-bottom:16px;max-width:500px;">
                    <div class="readable-text" style="font-size:18px;color:var(--gold);text-align:center;">
                        Outstanding performance! A headhunter has called —
                        <br>you've been offered the CEO position at a competitor.
                    </div>
                </div>
            `;
        } else if (state.perfectCompliance) {
            specialMessage = `
                <div class="panel" style="border-color:var(--cyan);margin-bottom:16px;max-width:500px;">
                    <div class="readable-text" style="font-size:16px;color:var(--cyan);text-align:center;">
                        Perfect policy compliance throughout your tenure.
                        <br>The board may grumble, but you followed their direction the whole way through.
                    </div>
                </div>
            `;
        }

        this.el.innerHTML = `
            <h2 style="color:var(--text-secondary);margin-top:8px;">GAME OVER</h2>

            ${specialMessage}

            <div class="gameover-grade">${gradeInfo.grade}</div>
            <div class="gameover-title">${gradeInfo.title}</div>
            <div class="gameover-description">${gradeInfo.description}</div>

            <!-- Score breakdown -->
            <div class="score-breakdown">
                ${this.renderScoreBar('P&L vs Budget', scores.pnl, GAME_CONFIG.SCORE_WEIGHTS.pnl)}
                ${this.renderScoreBar('Board Satisfaction', scores.boardSatisfaction, GAME_CONFIG.SCORE_WEIGHTS.boardSatisfaction)}
                ${this.renderScoreBar('Cash Management', scores.cashManagement, GAME_CONFIG.SCORE_WEIGHTS.cashManagement)}
                ${this.renderScoreBar('Policy Compliance', scores.policyCompliance, GAME_CONFIG.SCORE_WEIGHTS.policyCompliance)}
                ${this.renderScoreBar('Risk-Adjusted', scores.riskAdjusted, GAME_CONFIG.SCORE_WEIGHTS.riskAdjusted)}

                ${scores.tradingCostPenalty > 0 ? `
                    <div style="font-family:var(--font-pixel);font-size:7px;color:var(--pnl-negative);text-align:right;">
                        TRADING COST PENALTY: -${Math.round(scores.tradingCostPenalty)}
                    </div>
                ` : ''}
                ${scores.diversificationBonus > 0 ? `
                    <div style="font-family:var(--font-pixel);font-size:7px;color:var(--pnl-positive);text-align:right;">
                        DIVERSIFICATION BONUS: +${scores.diversificationBonus}
                    </div>
                ` : ''}

                <hr class="divider" style="margin:12px 0;">

                <div class="score-row">
                    <span class="score-label" style="color:var(--gold)">FINAL SCORE</span>
                    <div class="score-bar-bg">
                        <div class="score-bar-fill" style="width:${finalScore}%;background:var(--gold);"></div>
                    </div>
                    <span class="score-value" style="font-size:11px;">${Math.round(finalScore)}</span>
                </div>
            </div>

            <!-- Stats summary -->
            <div class="panel" style="max-width:500px;width:100%;margin-bottom:16px;">
                <div class="panel-title">CAREER STATISTICS</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-family:var(--font-readable);font-size:17px;">
                    <div style="color:var(--text-muted)">Industry</div>
                    <div style="text-align:right">${state.industry?.name || '—'}</div>
                    <div style="color:var(--text-muted)">Quarters Played</div>
                    <div style="text-align:right">${state.totalQuartersPlayed}</div>
                    <div style="color:var(--text-muted)">Cumulative P&L</div>
                    <div style="text-align:right" class="${state.cumulativePnL >= 0 ? 'pnl-positive' : 'pnl-negative'}">${formatPnL(state.cumulativePnL)}</div>
                    <div style="color:var(--text-muted)">Final Cash</div>
                    <div style="text-align:right">${formatCurrency(state.cashBalance, state.industry?.baseCurrency, true)}</div>
                    <div style="color:var(--text-muted)">Margin Calls</div>
                    <div style="text-align:right">${state.marginCallCount}</div>
                    <div style="color:var(--text-muted)">Policy Violations</div>
                    <div style="text-align:right">${state.policyViolations}</div>
                    <div style="color:var(--text-muted)">Seed</div>
                    <div style="text-align:right;color:var(--text-muted);font-size:14px;">#${state.seed}</div>
                </div>
            </div>

            <!-- Year reveal -->
            <div class="panel" id="year-reveal" style="max-width:500px;width:100%;margin-bottom:16px;display:none;">
                <div class="panel-title" style="color:var(--gold);">THE YEAR REVEALED</div>
                <div style="text-align:center;margin-bottom:8px;">
                    <span class="pixel-text" style="font-size:24px;color:var(--gold);" id="revealed-year"></span>
                </div>
                <div id="year-headline" style="font-family:var(--font-pixel);font-size:9px;color:var(--cyan);text-align:center;margin-bottom:8px;"></div>
                <div id="year-fact" style="font-family:var(--font-readable);font-size:16px;color:var(--text-primary);text-align:center;margin-bottom:8px;"></div>
                <div id="year-market-note" style="font-family:var(--font-pixel);font-size:7px;color:var(--text-muted);text-align:center;"></div>
            </div>

            <!-- Share your score -->
            <div class="panel" style="max-width:500px;width:100%;margin-bottom:16px;text-align:center;">
                <div class="panel-title">SHARE YOUR SCORE</div>
                <div class="readable-text" style="font-size:14px;color:var(--text-secondary);margin-bottom:8px;user-select:all;" id="share-text">
                    I scored ${Math.round(finalScore)} (${gradeInfo.grade}) as Treasury Manager of ${state.industry?.name || 'a company'}! Can you beat me? 🎮💰 #TreasuryManagerSimulator
                </div>
                <button class="btn" id="btn-copy-score" style="font-size:14px;min-height:28px;padding:4px 12px;">📋 Copy Score</button>
            </div>

            <!-- Global leaderboard submission status -->
            <div id="submit-status" class="submit-status" style="min-height:24px;margin-bottom:8px;text-align:center;"></div>

            <div class="gameover-buttons">
                <button class="btn btn-gold" id="btn-play-again">PLAY AGAIN</button>
                <button class="btn" id="btn-leaderboard">LEADERBOARD</button>
            </div>

            ${(state.firedByBoard || stressedOut) ? `
                <div class="readable-text" style="font-size:15px;color:var(--text-muted);font-style:italic;margin:12px 0;text-align:center;">
                    Lucky this was a simulation —
                    <a href="https://www.hedj.eu" target="_blank" rel="noopener" style="color:var(--cyan);">find out how Hedj can help →</a>
                </div>
            ` : ''}

            <!-- Hedj branding -->
            <div style="margin-top:20px;text-align:center;padding-bottom:20px;">
                <div class="pixel-text" style="font-size:8px;color:var(--gold);margin-bottom:4px;">POWERED BY HEDJ</div>
                <div class="readable-text" style="font-size:14px;color:var(--text-secondary);">
                    Treasury Risk Management Solutions
                </div>
                <div class="readable-text" style="font-size:13px;margin-top:4px;">
                    <a href="https://www.hedj.eu" target="_blank" rel="noopener" style="color:var(--cyan);text-decoration:underline;">www.hedj.eu →</a>
                </div>
            </div>
        `;

        return this.el;
    }

    mount() {
        const state = gameState.get();
        if (state.firedByBoard) {
            soundFX.fired();
        } else {
            soundFX.gameOver();
        }

        this.el.querySelector('#btn-play-again').addEventListener('click', () => {
            gameState.reset();
            this.app.showScreen('title');
        });

        this.el.querySelector('#btn-leaderboard').addEventListener('click', () => {
            this.showLeaderboard();
        });

        // Copy score button
        this.el.querySelector('#btn-copy-score')?.addEventListener('click', () => {
            const shareText = this.el.querySelector('#share-text')?.textContent?.trim() || '';
            navigator.clipboard.writeText(shareText).then(() => {
                this.app.showToast('Score copied to clipboard!', 'success');
            }).catch(() => {
                this.app.showToast('Could not copy — select and copy manually', 'info');
            });
        });

        // Reveal the hidden year after a dramatic pause
        this.revealYear();

        // Submit score to global leaderboard
        this.submitScoreToApi();
    }

    unmount() {
        this.submitted = false;
    }

    async submitScoreToApi() {
        if (this.submitted) return;
        this.submitted = true;

        const state = gameState.get();
        const scores = scoreEngine.calculateScores(state);
        const finalScore = Math.round(scores.total);
        const gradeInfo = scoreEngine.getGrade(finalScore);

        const entry = {
            playerName: state.playerName,
            companyName: state.companyName || '',
            contactEmail: state.contactEmail || '',
            industry: state.industry?.name || 'Unknown',
            industryId: state.industryId || '',
            score: finalScore,
            grade: gradeInfo.grade,
            quartersPlayed: state.totalQuartersPlayed,
            seed: state.seed
        };

        // Always save locally as backup
        addLeaderboardEntry(entry);

        const reg = getRegistration();
        if (!reg?.gameToken || reg.gameTokenExpiry < Date.now()) {
            // No valid token — local save only, no status shown
            return;
        }

        const payload = {
            gameId: state.gameId,
            playerName: state.playerName,
            company: state.companyName || reg.company || '',
            industry: state.industry?.name || '',
            industryId: state.industryId || '',
            score: finalScore,
            grade: gradeInfo.grade,
            quartersPlayed: state.totalQuartersPlayed,
            seed: state.seed,
            cumulativePnL: state.cumulativePnL || 0
        };

        this.showSubmitStatus('loading', null);

        try {
            const result = await submitScore(payload);
            clearPendingScore();
            this.showSubmitStatus('success', result?.rank);
        } catch {
            savePendingScore(payload);
            this.showSubmitStatus('error', null);
        }
    }

    showSubmitStatus(state, rank) {
        const el = this.el?.querySelector('#submit-status');
        if (!el) return;
        if (state === 'loading') {
            el.innerHTML = `<span class="pixel-text" style="font-size:8px;color:var(--text-muted);">Submitting to leaderboard…</span>`;
        } else if (state === 'success') {
            const rankText = rank != null ? ` · You are ranked <strong>#${rank}</strong> globally` : '';
            el.innerHTML = `<span class="pixel-text" style="font-size:8px;color:var(--gold);">Score submitted!${rankText}</span>`;
        } else if (state === 'error') {
            el.innerHTML = `<span class="pixel-text" style="font-size:8px;color:var(--text-muted);">Could not submit — score saved locally and will retry next visit.</span>`;
        }
    }

    async revealYear() {
        await this.loadYearFacts();

        const state = gameState.get();
        const year = state.startYear;
        const yearStr = String(year);
        const fact = this.yearFacts[yearStr];

        const revealEl = this.el.querySelector('#year-reveal');
        if (!revealEl) return;

        // Show after 2 second delay for dramatic effect
        setTimeout(() => {
            this.el.querySelector('#revealed-year').textContent = yearStr;

            if (fact) {
                this.el.querySelector('#year-headline').textContent = fact.headline;
                this.el.querySelector('#year-fact').textContent = fact.fact;
                this.el.querySelector('#year-market-note').textContent = fact.market_note || '';
            } else {
                this.el.querySelector('#year-headline').textContent = 'A Year in the Markets';
                this.el.querySelector('#year-fact').textContent = `Your trial year was ${yearStr}. The markets told their own story.`;
            }

            revealEl.style.display = 'block';
            revealEl.style.opacity = '0';
            revealEl.style.transition = 'opacity 1s ease';
            requestAnimationFrame(() => {
                revealEl.style.opacity = '1';
            });
        }, 2000);
    }

    unmount() {}

    renderScoreBar(label, score, weight) {
        const weighted = score * weight;
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


    async showLeaderboard() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="width:95vw;max-width:500px;">
                <div class="modal-header">
                    GLOBAL LEADERBOARD
                    <button class="modal-close" id="close-leaderboard">X</button>
                </div>
                <div class="modal-body" id="leaderboard-body" style="max-height:400px;overflow-y:auto;">
                    <div class="pixel-text" style="font-size:8px;color:var(--text-muted);text-align:center;padding:16px;">
                        Loading global scores…
                    </div>
                </div>
            </div>
        `;

        const viewport = document.getElementById('game-viewport');
        viewport.appendChild(overlay);
        overlay.querySelector('#close-leaderboard').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        try {
            const { entries } = await fetchLeaderboard(20);
            this.renderLeaderboardTable(overlay.querySelector('#leaderboard-body'), entries, false);
        } catch {
            const local = getLeaderboard();
            const mapped = local.map((e, i) => ({
                rank: i + 1,
                playerName: e.playerName,
                company: e.companyName || '',
                industry: e.industry,
                score: e.score,
                grade: e.grade,
                quartersPlayed: e.quartersPlayed
            }));
            this.renderLeaderboardTable(overlay.querySelector('#leaderboard-body'), mapped, true);
        }
    }

    renderLeaderboardTable(container, entries, isOffline) {
        if (entries.length === 0) {
            container.innerHTML = `<div class="pixel-text" style="font-size:8px;color:var(--text-muted);text-align:center;padding:16px;">No scores yet — be the first!</div>`;
            return;
        }
        const offlineNote = isOffline
            ? `<div class="pixel-text" style="font-size:7px;color:var(--text-muted);text-align:center;margin-bottom:8px;">(showing local scores — offline)</div>`
            : '';
        container.innerHTML = `
            ${offlineNote}
            <table class="data-table">
                <thead><tr><th>#</th><th>NAME</th><th>INDUSTRY</th><th>SCORE</th><th>GRADE</th></tr></thead>
                <tbody>
                    ${entries.map(e => `
                        <tr>
                            <td style="color:${e.rank <= 3 ? 'var(--gold)' : 'var(--text-muted)'}">${e.rank}</td>
                            <td>${e.playerName}</td>
                            <td style="color:var(--text-muted)">${e.industry}</td>
                            <td style="color:var(--cyan)">${e.score}</td>
                            <td style="color:var(--gold)">${e.grade}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }
}
