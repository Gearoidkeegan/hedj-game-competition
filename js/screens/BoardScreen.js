// Board Screen — boardroom review with BoardAI-driven personality dialogue and CEO personas

import { gameState } from '../engine/GameState.js';
import { gameLoop } from '../engine/GameLoop.js';
import { boardAI } from '../engine/BoardAI.js';
import { formatPnL, formatQuarter, pnlClass } from '../utils/formatters.js';

const CEO_EMOJIS = {
    'jameson': '📰',
    'musk': '🚀',
    'oleary': '✈️',
    'dimon': '🏦',
    'buffett': '🍦',
    'jobs': '🍎',
    'dorsey': '🧘',
    'ackman': '📝'
};
import { StressFace } from '../ui/StressFace.js';
import { soundFX } from '../ui/SoundFX.js';

export class BoardScreen {
    constructor(app) {
        this.app = app;
        this.el = null;
        this.typewriterTimers = [];
        this.stressFace = null;
    }

    render() {
        this.el = document.createElement('div');
        this.el.className = 'screen active board-screen';

        const state = gameState.get();
        const lastResult = state.quarterlyResults[state.quarterlyResults.length - 1];

        // Get BoardAI feedback (rich dialogue + CEO appearance)
        const feedback = boardAI.generateFeedback();

        // Calculate total satisfaction change
        const totalDelta = feedback.reduce((sum, f) => sum + f.satisfactionDelta, 0);

        // Apply satisfaction change
        const clampedDelta = Math.round(Math.max(-15, Math.min(5, totalDelta)));
        gameState.adjustSatisfaction(clampedDelta);

        // Also apply event-based satisfaction if there was a recent event
        const eventResult = state.lastEventResult;
        let eventNote = '';
        if (eventResult) {
            if (eventResult.type === 'part2_resolved' && eventResult.boardReactions?.length > 0) {
                eventNote = eventResult.boardReactions.map(r =>
                    `<div style="font-style:italic;color:${r.type.includes('praise') ? 'var(--pnl-positive)' : 'var(--pnl-negative)'};font-size:14px;margin-top:4px;">"${r.text}"</div>`
                ).join('');
            }
        }

        // Separate regular board members from CEO
        const regularFeedback = feedback.filter(f => f.member.personality !== 'ceo');
        const ceoFeedback = feedback.find(f => f.member.personality === 'ceo');

        this.el.innerHTML = `
            <div class="quarter-bar">
                <span class="company-name">${state.industry?.name || 'Company'}</span>
                <span class="quarter-label">BOARD REVIEW — ${formatQuarter(state.currentYearOffset, state.currentQuarter)}</span>
                <span id="board-stress-face"></span>
                <span>
                    <span class="pixel-text" style="font-size:8px;color:var(--text-secondary)">QUARTERLY P&L</span>
                    <span class="pixel-text ${pnlClass(lastResult?.netPnL || 0)}" style="font-size:10px">${formatPnL(lastResult?.netPnL || 0)}</span>
                </span>
            </div>

            <div style="flex:1;padding:16px;display:flex;flex-direction:column;overflow-y:auto;">
                <!-- Satisfaction change — shown first so it's always visible -->
                <div style="text-align:center;margin-bottom:12px;">
                    <div class="panel" style="display:inline-block;min-width:280px;max-width:95vw;">
                        <div style="font-family:var(--font-pixel);font-size:9px;color:var(--text-secondary);margin-bottom:8px;">BOARD SATISFACTION</div>
                        <div class="gauge" style="width:100%;height:24px;">
                            <div class="gauge-fill ${state.boardSatisfaction >= 50 ? 'high' : state.boardSatisfaction >= 25 ? 'mid' : 'low'}"
                                 style="width:${state.boardSatisfaction}%"></div>
                            <div class="gauge-label">${state.boardSatisfaction}%</div>
                        </div>
                        <div style="font-family:var(--font-pixel);font-size:9px;margin-top:6px;color:${clampedDelta >= 0 ? 'var(--pnl-positive)' : 'var(--pnl-negative)'}">
                            ${clampedDelta >= 0 ? '+' : ''}${clampedDelta}
                        </div>
                    </div>
                </div>

                <!-- Boardroom table -->
                <div class="boardroom-table">
                    QUARTERLY REVIEW
                </div>

                <!-- Board members with reactions -->
                <div class="board-members">
                    ${regularFeedback.map((fb, i) => `
                        <div class="board-member">
                            <div class="board-member-portrait">
                                ${this.getMemberEmoji(fb.member.personality)}
                            </div>
                            <div class="board-member-name">${fb.member.name}</div>
                            <div class="board-member-role">${fb.member.role}</div>
                            <div class="board-member-delta" style="font-family:var(--font-pixel);font-size:7px;color:${fb.satisfactionDelta >= 0 ? 'var(--pnl-positive)' : 'var(--pnl-negative)'};">
                                ${fb.satisfactionDelta >= 0 ? '+' : ''}${Math.round(fb.satisfactionDelta)}
                            </div>
                            <div class="board-speech" id="speech-${i}">
                                <span class="speech-text"></span><span class="blink">_</span>
                            </div>
                        </div>
                    `).join('')}
                </div>

                ${eventNote ? `
                    <div class="panel" style="margin-top:12px;border-color:var(--gold-dark);">
                        <div class="pixel-text" style="font-size:7px;color:var(--gold);margin-bottom:4px;">RE: RECENT EVENT</div>
                        ${eventNote}
                    </div>
                ` : ''}

                ${ceoFeedback ? `
                    <div class="ceo-appearance" style="margin-top:16px;">
                        <div class="panel" style="border-color:var(--gold);background:rgba(255,204,0,0.05);">
                            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                                <span style="font-size:28px;">${CEO_EMOJIS[boardAI.ceoPersona] || '👑'}</span>
                                <div>
                                    <div class="pixel-text" style="font-size:9px;color:var(--gold);">${ceoFeedback.member.name}</div>
                                    <div style="font-family:var(--font-pixel);font-size:7px;color:var(--text-muted);">CHAIRMAN OF THE BOARD</div>
                                </div>
                            </div>
                            <div class="board-speech" id="speech-ceo" style="border-color:var(--gold-dark);background:rgba(0,0,0,0.2);">
                                <span class="speech-text"></span><span class="blink">_</span>
                            </div>
                        </div>
                    </div>
                ` : ''}
            </div>

            <div class="dashboard-footer">
                <div></div>
                <button class="btn btn-primary" id="btn-continue">CONTINUE ▶</button>
            </div>
        `;

        // Store feedback data for typewriter
        this._feedback = { regular: regularFeedback, ceo: ceoFeedback };

        return this.el;
    }

    mount() {
        soundFX.boardReview();

        this.el.querySelector('#btn-continue').addEventListener('click', () => {
            gameLoop.completeBoardReview();
        });

        // Stress face in quarter bar
        this.stressFace = new StressFace(40);
        const slot = this.el.querySelector('#board-stress-face');
        if (slot) {
            slot.appendChild(this.stressFace.createWidget());
            this.stressFace.start();
            this.stressFace.updateWidget();
        }

        // Typewriter effect for board members
        const { regular, ceo } = this._feedback;

        setTimeout(() => {
            regular.forEach((fb, i) => {
                const text = fb.lines.join(' ');
                this.typewriteText(`speech-${i}`, text, 200 + i * 600);
            });

            // CEO appears last with extra delay
            if (ceo) {
                const ceoDelay = 200 + regular.length * 600 + 400;
                const ceoText = ceo.lines.join(' ');
                this.typewriteText('speech-ceo', ceoText, ceoDelay);
            }
        }, 300);
    }

    unmount() {
        this.typewriterTimers.forEach(t => clearTimeout(t));
        this.typewriterTimers = [];
        if (this.stressFace) { this.stressFace.stop(); this.stressFace = null; }
    }

    getMemberEmoji(personality) {
        switch (personality) {
            case 'aggressive': return '👔';
            case 'cautious': return '📊';
            case 'operational': return '⚙️';
            default: return '💼';
        }
    }

    typewriteText(elementId, text, delay = 0) {
        const container = this.el.querySelector(`#${elementId}`);
        if (!container) return;

        const textSpan = container.querySelector('.speech-text');
        const cursor = container.querySelector('.blink');
        if (!textSpan) return;

        let index = 0;
        // Adaptive speed: longer text types faster so players don't wait forever
        const speed = text.length > 200 ? 12 : text.length > 100 ? 20 : 30;

        const timer = setTimeout(() => {
            const typeTimer = setInterval(() => {
                if (index < text.length) {
                    textSpan.textContent += text[index];
                    index++;
                } else {
                    clearInterval(typeTimer);
                    if (cursor) cursor.style.display = 'none';
                }
            }, speed);

            this.typewriterTimers.push(typeTimer);
        }, delay);

        this.typewriterTimers.push(timer);
    }
}
