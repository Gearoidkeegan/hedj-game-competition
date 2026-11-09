// Board Screen — boardroom review with BoardAI-driven personality dialogue and CEO personas

import { gameState } from '../engine/GameState.js';
import { gameLoop } from '../engine/GameLoop.js';
import { boardAI } from '../engine/BoardAI.js';
import { formatPnL, formatQuarter, pnlClass } from '../utils/formatters.js';
import { toQuarterSummary } from '../engine/sim/proAdapter.js';
import { boardLineKey, expressionFor, cosmeticRng } from './simple/RunController.js';
import { typewrite } from '../ui/typewriter.js';

import { StressFace } from '../ui/StressFace.js';
import { soundFX } from '../ui/SoundFX.js';
import { drawSprite, spriteIdForMember, CHAIRMAN_SPRITES } from '../ui/pixel/sprites.js';

// Salt for the board-review quips, clear of the Simple screens' cosmetic salts.
const QUIP_SALT = 400;

/**
 * D1 quips for the regular board members, chosen by the board-line precedence in contract.md.
 * Returns { key, expression } and swaps each member's lines for one quip; members whose personality has no
 * quip for the key keep BoardAI's own lines. Never throws: on any failure the BoardAI lines stand.
 */
export function applyBoardQuips(feedback, quips, state, lastResult, moodBefore) {
    try {
        const summary = toQuarterSummary(state, lastResult);
        const key = boardLineKey(summary, moodBefore);
        const expression = expressionFor(key);
        if (!quips?.board) return { key, expression };
        const rng = cosmeticRng(state.seed || 0, QUIP_SALT + (lastResult?.quarter || 0));
        for (const f of feedback) {
            if (f.member.personality === 'ceo') continue;
            const pool = quips.board[f.member.personality]?.[key];
            const line = Array.isArray(pool) && pool.length ? rng.pick(pool) : '';
            if (line) f.lines = [line];
        }
        return { key, expression };
    } catch (err) {
        console.error('Board quips unavailable, using BoardAI lines', err);
        return { key: null, expression: null };
    }
}

export class BoardScreen {
    constructor(app) {
        this.app = app;
        this.el = null;
        this.typing = null;
        this.stressFace = null;
        this.expression = null;
        this.currentMemberIndex = 0;
        this._allMembers = [];
    }

    render() {
        this.el = document.createElement('div');
        this.el.className = 'screen active board-screen';

        const state = gameState.get();
        const lastResult = state.quarterlyResults[state.quarterlyResults.length - 1];

        // Get BoardAI feedback (rich dialogue + CEO appearance)
        const feedback = boardAI.generateFeedback();
        const moodBefore = state.boardSatisfaction;

        // Calculate total satisfaction change
        const totalDelta = feedback.reduce((sum, f) => sum + f.satisfactionDelta, 0);

        // Apply satisfaction change
        const clampedDelta = Math.round(Math.max(-15, Math.min(5, totalDelta)));
        gameState.adjustSatisfaction(clampedDelta);

        // v3 voice: D1 quips by board-line precedence, and the sprite expression that goes with them.
        this.expression = applyBoardQuips(feedback, this.app?.content?.quips, gameState.get(), lastResult, moodBefore).expression;

        // Also apply event-based satisfaction if there was a recent event
        const eventResult = state.lastEventResult;
        let eventNote = '';
        if (eventResult) {
            if (eventResult.type === 'part2_resolved' && eventResult.boardReactions?.length > 0) {
                eventNote = eventResult.boardReactions.map(r =>
                    `<div style="font-style:italic;color:${r.type.includes('praise') ? 'var(--pnl-positive)' : 'var(--pnl-negative)'};font-size:18px;margin-top:4px;">"${r.text}"</div>`
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
                    <span class="pixel-text" style="font-size:12px;color:var(--text-secondary)">QUARTERLY P&L</span>
                    <span class="pixel-text ${pnlClass(lastResult?.netPnL || 0)}" style="font-size:12px">${formatPnL(lastResult?.netPnL || 0)}</span>
                </span>
            </div>

            <div style="flex:1;padding:16px;display:flex;flex-direction:column;overflow-y:auto;">
                <!-- Satisfaction change — shown first so it's always visible -->
                <div style="text-align:center;margin-bottom:12px;">
                    <div class="panel" style="display:inline-block;min-width:280px;max-width:95vw;">
                        <div style="font-family:var(--font-readable);font-size:18px;color:var(--text-secondary);margin-bottom:8px;">BOARD SATISFACTION</div>
                        <div class="gauge" style="width:100%;height:24px;">
                            <div class="gauge-fill ${state.boardSatisfaction >= 50 ? 'high' : state.boardSatisfaction >= 25 ? 'mid' : 'low'}"
                                 style="width:${state.boardSatisfaction}%"></div>
                            <div class="gauge-label">${state.boardSatisfaction}%</div>
                        </div>
                        <div style="font-family:var(--font-readable);font-size:20px;margin-top:6px;color:${clampedDelta >= 0 ? 'var(--pnl-positive)' : 'var(--pnl-negative)'}">
                            ${clampedDelta >= 0 ? '+' : ''}${clampedDelta}
                        </div>
                    </div>
                </div>

                <!-- Boardroom table -->
                <div class="boardroom-table">
                    QUARTERLY REVIEW
                </div>

                <!-- Single member slot — one at a time -->
                <div id="current-member-slot" class="board-members" style="min-height:160px;"></div>

                ${eventNote ? `
                    <div class="panel" id="event-note-panel" style="margin-top:12px;border-color:var(--gold-dark);display:none;">
                        <div class="pixel-text" style="font-size:12px;color:var(--gold);margin-bottom:4px;">RE: RECENT EVENT</div>
                        ${eventNote}
                    </div>
                ` : ''}
            </div>

            <div class="dashboard-footer">
                <div class="pixel-text" id="member-counter" style="font-size:14px;color:var(--text-muted);align-self:center;padding-left:8px;"></div>
                <button class="btn btn-primary" id="btn-board-advance">NEXT →</button>
            </div>
        `;

        // Build ordered member list: regular members, then CEO at the end
        this._allMembers = [...regularFeedback, ...(ceoFeedback ? [ceoFeedback] : [])];
        this._eventNote = eventNote;
        this.currentMemberIndex = 0;

        return this.el;
    }

    mount() {
        soundFX.boardReview();

        // Stress face in quarter bar
        this.stressFace = new StressFace(40);
        const slot = this.el.querySelector('#board-stress-face');
        if (slot) {
            slot.appendChild(this.stressFace.createWidget());
            this.stressFace.start();
            this.stressFace.updateWidget();
        }

        const advanceBtn = this.el.querySelector('#btn-board-advance');
        advanceBtn.addEventListener('click', () => {
            const next = this.currentMemberIndex + 1;
            if (next < this._allMembers.length) {
                this.currentMemberIndex = next;
                this.showMember(next);
            } else {
                gameLoop.completeBoardReview();
            }
        });

        // Show first member
        this.showMember(0);
    }

    unmount() {
        if (this.typing) { this.typing.cancel(); this.typing = null; }
        if (this.stressFace) { this.stressFace.stop(); this.stressFace = null; }
        this.currentMemberIndex = 0;
    }

    showMember(index) {
        if (this.typing) { this.typing.cancel(); this.typing = null; }

        const fb = this._allMembers[index];
        const isLast = index === this._allMembers.length - 1;
        const isCEO = fb.member.personality === 'ceo';

        // Update counter
        const counter = this.el.querySelector('#member-counter');
        if (counter) {
            counter.textContent = `${index + 1} / ${this._allMembers.length}`;
        }

        // Update advance button label
        const btn = this.el.querySelector('#btn-board-advance');
        if (btn) {
            btn.textContent = isLast ? 'CONTINUE ▶' : 'NEXT →';
        }

        // Show event note panel only on the last item
        const notePanel = this.el.querySelector('#event-note-panel');
        if (notePanel) {
            notePanel.style.display = isLast && this._eventNote ? 'block' : 'none';
        }

        // Render member HTML into slot
        const memberSlot = this.el.querySelector('#current-member-slot');
        if (!memberSlot) return;

        if (isCEO) {
            memberSlot.innerHTML = `
                <div class="ceo-appearance">
                    <div class="panel" style="border-color:var(--gold);background:rgba(255,204,0,0.05);">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                            <canvas class="ceo-portrait" width="128" height="128" style="width:64px;height:64px;image-rendering:pixelated;"></canvas>
                            <div>
                                <div class="pixel-text" style="font-size:12px;color:var(--gold);">${fb.member.name}</div>
                                <div style="font-family:var(--font-readable);font-size:16px;color:var(--text-muted);">CHAIRMAN OF THE BOARD</div>
                            </div>
                            <div class="board-member-delta" style="font-family:var(--font-readable);font-size:18px;color:${fb.satisfactionDelta >= 0 ? 'var(--pnl-positive)' : 'var(--pnl-negative)'};">
                                ${fb.satisfactionDelta >= 0 ? '+' : ''}${Math.round(fb.satisfactionDelta)}
                            </div>
                        </div>
                        <div class="board-speech" id="current-speech" style="border-color:var(--gold-dark);background:rgba(0,0,0,0.2);">
                            <span class="speech-text"></span><span class="blink">_</span>
                        </div>
                    </div>
                </div>
            `;
        } else {
            memberSlot.innerHTML = `
                <div class="board-member">
                    <div class="board-member-portrait"><canvas width="128" height="128" style="width:64px;height:64px;image-rendering:pixelated;"></canvas></div>
                    <div class="board-member-name">${fb.member.name}</div>
                    <div class="board-member-role">${fb.member.role}</div>
                    <div class="board-member-delta" style="font-family:var(--font-readable);font-size:18px;color:${fb.satisfactionDelta >= 0 ? 'var(--pnl-positive)' : 'var(--pnl-negative)'};">
                        ${fb.satisfactionDelta >= 0 ? '+' : ''}${Math.round(fb.satisfactionDelta)}
                    </div>
                    <div class="board-speech" id="current-speech">
                        <span class="speech-text"></span><span class="blink">_</span>
                    </div>
                </div>
            `;
        }

        const expression = this.expression || (fb.satisfactionDelta > 0 ? 'happy' : fb.satisfactionDelta < 0 ? 'angry' : 'neutral');
        const portrait = memberSlot.querySelector('.board-member-portrait canvas');
        if (portrait) {
            drawSprite(portrait.getContext('2d'), spriteIdForMember(fb.member, index), expression, 0, 0, 4);
        }
        const ceoPortrait = memberSlot.querySelector('.ceo-portrait');
        if (ceoPortrait) {
            const id = CHAIRMAN_SPRITES[boardAI.ceoPersona] ? boardAI.ceoPersona : 'jameson';
            drawSprite(ceoPortrait.getContext('2d'), id, 'neutral', 0, 0, 4);
        }

        // Typewriter for this member: 8 ms per character, and a tap on the speech completes it.
        const text = fb.lines.join(' ');
        const speech = memberSlot.querySelector('#current-speech');
        if (speech) {
            const typing = typewrite({
                textEl: speech.querySelector('.speech-text'),
                cursorEl: speech.querySelector('.blink'),
                text
            });
            this.typing = typing;
            speech.addEventListener('click', () => typing.complete());
        }
    }
}
