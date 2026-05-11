// Event Screen — displays random events with player choices
// Supports instant events, two-part triggers, and part2 resolutions

import { gameState } from '../engine/GameState.js';
import { gameLoop } from '../engine/GameLoop.js';
import { formatPnL, formatQuarter } from '../utils/formatters.js';
import { EraPopup } from '../ui/EraPopup.js';
import { soundFX } from '../ui/SoundFX.js';

export class EventScreen {
    constructor(app) {
        this.app = app;
        this.el = null;
        this.typewriterTimer = null;
    }

    render() {
        this.el = document.createElement('div');
        this.el.className = 'screen active event-screen';

        const state = gameState.get();
        const event = state.activeEvents?.[0];

        if (!event) {
            // No event — skip straight to board
            setTimeout(() => gameLoop.completeEvent(null, null), 100);
            this.el.innerHTML = '<div class="panel" style="text-align:center;margin:auto;">No event this quarter.</div>';
            return this.el;
        }

        const isPart2 = event.type === 'part2_resolution';
        const categoryIcon = this.getCategoryIcon(event.category);

        // Build the body content (typewriter target + part2 outcome)
        const bodyContent = `
            <p class="event-description" id="event-desc">
                <span class="speech-text"></span><span class="blink">_</span>
            </p>
            ${isPart2 && event.outcome ? `
                <div class="event-outcome panel" style="margin-top:12px;">
                    <div class="pixel-text" style="font-size:8px;color:var(--highlight);margin-bottom:6px;">
                        ${event.materialised ? 'OUTCOME' : 'RESULT'}
                    </div>
                    <p style="font-size:11px;color:var(--text-primary);">${event.outcome.description}</p>
                    ${event.outcome.board_reactions ? this.renderBoardReactions(event.outcome.board_reactions) : ''}
                </div>
            ` : ''}
        `;

        // Wrap in era-appropriate styling
        const senderMap = {
            'corporate': 'Board of Directors',
            'universal': 'CFO Office',
            'industry_specific': 'Operations Team'
        };
        const eraWrapped = EraPopup.wrap({
            title: event.title,
            from: senderMap[event.category] || 'Head Office',
            body: bodyContent,
            category: event.category
        });

        this.el.innerHTML = `
            <div class="quarter-bar">
                <span class="company-name">${state.industry?.name || 'Company'}</span>
                <span class="quarter-label">${formatQuarter(state.currentYearOffset, state.currentQuarter)} — EVENT</span>
                <span class="pixel-text" style="font-size:8px;color:var(--text-secondary)">${event.category?.toUpperCase() || 'EVENT'}</span>
            </div>

            <div class="event-content" style="flex:1;padding:16px;display:flex;align-items:center;justify-content:center;">
                <div style="max-width:560px;width:100%;">
                    ${eraWrapped}

                    <div class="event-choices ${this.isAcknowledgeEvent(event) ? 'event-choices-ack' : ''}" id="event-choices" style="display:none;margin-top:12px;">
                        ${this.isAcknowledgeEvent(event) ? `
                            <button class="btn event-choice-btn event-ack-btn" data-choice="acknowledge" style="min-width:200px;font-size:12px;padding:10px 20px;">
                                <div class="choice-label">CONTINUE</div>
                            </button>
                        ` : event.choices.map(choice => `
                            <button class="btn event-choice-btn" data-choice="${choice.id}">
                                <div class="choice-label">${choice.label}</div>
                                <div class="choice-desc">${choice.description}</div>
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        return this.el;
    }

    mount() {
        const state = gameState.get();
        const event = state.activeEvents?.[0];
        if (!event) return;
        soundFX.eventPopup();

        // Typewriter the description, then reveal choices
        const descText = event.description || '';
        this.typewriteDescription(descText, () => {
            const choicesEl = this.el.querySelector('#event-choices');
            if (choicesEl) {
                choicesEl.style.display = 'flex';
                choicesEl.style.opacity = '0';
                requestAnimationFrame(() => {
                    choicesEl.style.transition = 'opacity 0.4s ease';
                    choicesEl.style.opacity = '1';
                });
            }
        });

        // Wire up choice buttons
        this.el.querySelectorAll('.event-choice-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const choiceId = btn.dataset.choice;
                this.handleChoice(event, choiceId);
            });
        });
    }

    unmount() {
        if (this.typewriterTimer) {
            clearInterval(this.typewriterTimer);
            this.typewriterTimer = null;
        }
    }

    handleChoice(event, choiceId) {
        // Disable buttons after click
        this.el.querySelectorAll('.event-choice-btn').forEach(btn => {
            btn.disabled = true;
            if (btn.dataset.choice === choiceId) {
                btn.classList.add('selected');
            } else {
                btn.style.opacity = '0.4';
            }
        });

        // Brief pause, then proceed
        setTimeout(() => {
            gameLoop.completeEvent(event, choiceId);
        }, 800);
    }

    typewriteDescription(text, onComplete) {
        const container = this.el.querySelector('#event-desc');
        if (!container) return;

        const textSpan = container.querySelector('.speech-text');
        const cursor = container.querySelector('.blink');
        if (!textSpan) return;

        let index = 0;

        this.typewriterTimer = setInterval(() => {
            if (index < text.length) {
                textSpan.textContent += text[index];
                index++;
            } else {
                clearInterval(this.typewriterTimer);
                this.typewriterTimer = null;
                if (cursor) cursor.style.display = 'none';
                if (onComplete) onComplete();
            }
        }, 20);
    }

    isAcknowledgeEvent(event) {
        return event && event.type !== 'part2_resolution'
            && Array.isArray(event.choices)
            && event.choices.length === 1
            && event.choices[0].id === 'acknowledge';
    }

    getCategoryIcon(category) {
        switch (category) {
            case 'corporate': return '🏢';
            case 'universal': return '⚠️';
            case 'industry_specific': return '🏭';
            default: return '📋';
        }
    }

    renderBoardReactions(reactions) {
        const entries = Object.entries(reactions);
        if (entries.length === 0) return '';

        return `
            <div style="margin-top:8px;border-top:1px solid var(--border);padding-top:8px;">
                ${entries.map(([type, text]) => {
                    const color = type === 'praise' || type === 'grudging_praise'
                        ? 'var(--pnl-positive)'
                        : type === 'criticism' || type === 'mild_criticism'
                            ? 'var(--pnl-negative)'
                            : 'var(--text-secondary)';
                    const label = type.replace(/_/g, ' ').toUpperCase();
                    return `
                        <div style="margin-bottom:4px;">
                            <span class="pixel-text" style="font-size:7px;color:${color};">${label}:</span>
                            <span style="font-size:10px;color:var(--text-primary);font-style:italic;">"${text}"</span>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }
}
