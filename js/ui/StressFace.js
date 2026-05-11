// StressFace — Doom-style HUD face that shows player stress level
// Renders a pixel-art face on a small canvas (64x64)
// Expression deteriorates as stress increases:
//   0-20: Calm (slight smile)
//  21-40: Concerned (neutral)
//  41-60: Worried (frown, slight sweat)
//  61-80: Panicking (wide eyes, sweating, red face)
//  81-100: Broken (X eyes, steam coming off head)

import { boardAI } from '../engine/BoardAI.js';
import { gameState } from '../engine/GameState.js';

export class StressFace {
    constructor(size = 64) {
        this.size = size;
        this.canvas = document.createElement('canvas');
        this.canvas.width = size;
        this.canvas.height = size;
        this.canvas.className = 'stress-face-canvas';
        this.ctx = this.canvas.getContext('2d');
        this.animFrame = 0;
        this.animTimer = null;
        this.lastStress = 0;
        this.blinkTimer = 0;
        this.isBlinking = false;
        this.sweatDropY = 0;
        this.gender = gameState.get().playerGender || 'male';
    }

    /**
     * Get the canvas element to insert into DOM.
     */
    getElement() {
        return this.canvas;
    }

    /**
     * Start animation loop.
     */
    start() {
        this.stop();
        this.animTimer = setInterval(() => {
            this.animFrame++;
            this.blinkTimer++;

            // Blink every ~80 frames (less frequent when stressed)
            const blinkInterval = this.lastStress > 60 ? 40 : 80;
            if (this.blinkTimer >= blinkInterval) {
                this.isBlinking = true;
                this.blinkTimer = 0;
                setTimeout(() => { this.isBlinking = false; }, 150);
            }

            // Animate sweat drops
            if (this.lastStress > 40) {
                this.sweatDropY = (this.sweatDropY + 1) % 20;
            }

            this.draw(this.lastStress);
        }, 100);
    }

    /**
     * Stop animation.
     */
    stop() {
        if (this.animTimer) {
            clearInterval(this.animTimer);
            this.animTimer = null;
        }
    }

    /**
     * Update and draw with current stress from BoardAI.
     */
    update() {
        this.lastStress = boardAI.getStressLevel();
        // Track lifetime max stress on game state for end-of-game messaging
        const state = gameState.get();
        if (this.lastStress > (state.maxStressReached || 0)) {
            gameState.update({ maxStressReached: this.lastStress });
        }
        // Burnout: at sustained 100% stress the player walks out
        if (this.lastStress >= 100 && !state.burnedOut && !state.firedByBoard) {
            gameState.update({ burnedOut: true });
        }
        this.draw(this.lastStress);
    }

    /**
     * Draw the face at a given stress level (0-100).
     */
    draw(stress) {
        const ctx = this.ctx;
        const s = this.size;
        const px = s / 64; // Scale factor (1 at 64px)

        ctx.clearRect(0, 0, s, s);

        // Face background
        const skinColor = this.getSkinColor(stress);
        this.drawRoundRect(ctx, 4 * px, 4 * px, 56 * px, 56 * px, 8 * px, skinColor);

        // Face border
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2 * px;
        this.strokeRoundRect(ctx, 4 * px, 4 * px, 56 * px, 56 * px, 8 * px);

        // Hair — different styles for male/female
        if (this.gender === 'female') {
            this.drawFemaleHair(ctx, px);
        } else {
            this.drawMaleHair(ctx, px);
        }

        // Eyes
        if (stress >= 81) {
            this.drawXEyes(ctx, px, stress);
        } else if (this.isBlinking) {
            this.drawClosedEyes(ctx, px);
        } else {
            this.drawEyes(ctx, px, stress);
        }

        // Eyelashes for female character
        if (this.gender === 'female' && stress < 81 && !this.isBlinking) {
            this.drawEyelashes(ctx, px);
        }

        // Eyebrows
        this.drawEyebrows(ctx, px, stress);

        // Mouth
        this.drawMouth(ctx, px, stress);

        // Sweat drops (stress > 40)
        if (stress > 40) {
            this.drawSweat(ctx, px, stress);
        }

        // Steam/rage marks (stress > 80)
        if (stress > 80) {
            this.drawSteam(ctx, px);
        }

        // Stress meter bar at bottom
        this.drawStressMeter(ctx, px, stress);
    }

    getSkinColor(stress) {
        if (stress <= 20) return '#f4c794';       // Normal
        if (stress <= 40) return '#f0be84';       // Slightly flushed
        if (stress <= 60) return '#e8a070';       // Flushed
        if (stress <= 80) return '#e07050';       // Red
        return '#cc4040';                          // Very red
    }

    drawRoundRect(ctx, x, y, w, h, r, fill) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
    }

    strokeRoundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.stroke();
    }

    drawEyes(ctx, px, stress) {
        const eyeY = 24 * px;
        const leftEyeX = 20 * px;
        const rightEyeX = 38 * px;
        const eyeW = 10 * px;
        const eyeH = stress > 60 ? 12 * px : 8 * px; // Wider when panicking

        // Eye whites
        ctx.fillStyle = '#fff';
        ctx.fillRect(leftEyeX, eyeY, eyeW, eyeH);
        ctx.fillRect(rightEyeX, eyeY, eyeW, eyeH);

        // Pupils
        ctx.fillStyle = '#222';
        const pupilSize = 4 * px;
        const pupilOffsetX = 3 * px;
        const pupilOffsetY = stress > 60 ? 2 * px : 2 * px;
        ctx.fillRect(leftEyeX + pupilOffsetX, eyeY + pupilOffsetY, pupilSize, pupilSize);
        ctx.fillRect(rightEyeX + pupilOffsetX, eyeY + pupilOffsetY, pupilSize, pupilSize);

        // Eye outline
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1 * px;
        ctx.strokeRect(leftEyeX, eyeY, eyeW, eyeH);
        ctx.strokeRect(rightEyeX, eyeY, eyeW, eyeH);
    }

    drawClosedEyes(ctx, px) {
        const eyeY = 28 * px;
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 2 * px;

        // Left eye — closed line
        ctx.beginPath();
        ctx.moveTo(18 * px, eyeY);
        ctx.lineTo(30 * px, eyeY);
        ctx.stroke();

        // Right eye — closed line
        ctx.beginPath();
        ctx.moveTo(36 * px, eyeY);
        ctx.lineTo(48 * px, eyeY);
        ctx.stroke();
    }

    drawXEyes(ctx, px, stress) {
        const eyeY = 24 * px;
        ctx.strokeStyle = '#cc0000';
        ctx.lineWidth = 2 * px;

        // Left X
        ctx.beginPath();
        ctx.moveTo(18 * px, eyeY);
        ctx.lineTo(28 * px, eyeY + 10 * px);
        ctx.moveTo(28 * px, eyeY);
        ctx.lineTo(18 * px, eyeY + 10 * px);
        ctx.stroke();

        // Right X
        ctx.beginPath();
        ctx.moveTo(36 * px, eyeY);
        ctx.lineTo(46 * px, eyeY + 10 * px);
        ctx.moveTo(46 * px, eyeY);
        ctx.lineTo(36 * px, eyeY + 10 * px);
        ctx.stroke();
    }

    drawEyebrows(ctx, px, stress) {
        const isFemale = this.gender === 'female';
        ctx.strokeStyle = isFemale ? '#2a1a0a' : '#3a2a1a';
        ctx.lineWidth = isFemale ? 1.2 * px : 2 * px;

        const browY = 20 * px;

        if (stress <= 20) {
            if (isFemale) {
                // Thin, arched brows
                ctx.beginPath();
                ctx.moveTo(18 * px, browY + 1 * px);
                ctx.quadraticCurveTo(24 * px, browY - 3 * px, 30 * px, browY);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(36 * px, browY);
                ctx.quadraticCurveTo(42 * px, browY - 3 * px, 48 * px, browY + 1 * px);
                ctx.stroke();
            } else {
                // Relaxed — slight upward curve
                ctx.beginPath();
                ctx.moveTo(18 * px, browY + 1 * px);
                ctx.quadraticCurveTo(24 * px, browY - 1 * px, 30 * px, browY + 1 * px);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(36 * px, browY + 1 * px);
                ctx.quadraticCurveTo(42 * px, browY - 1 * px, 48 * px, browY + 1 * px);
                ctx.stroke();
            }
        } else if (stress <= 60) {
            if (isFemale) {
                // Worried — arched with inner raise
                ctx.beginPath();
                ctx.moveTo(18 * px, browY);
                ctx.quadraticCurveTo(24 * px, browY - 2 * px, 30 * px, browY + 2 * px);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(36 * px, browY + 2 * px);
                ctx.quadraticCurveTo(42 * px, browY - 2 * px, 48 * px, browY);
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.moveTo(18 * px, browY - 1 * px);
                ctx.lineTo(30 * px, browY + 2 * px);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(36 * px, browY + 2 * px);
                ctx.lineTo(48 * px, browY - 1 * px);
                ctx.stroke();
            }
        } else {
            if (isFemale) {
                // Angry — sharper arch
                ctx.beginPath();
                ctx.moveTo(16 * px, browY + 2 * px);
                ctx.quadraticCurveTo(24 * px, browY - 4 * px, 30 * px, browY - 1 * px);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(36 * px, browY - 1 * px);
                ctx.quadraticCurveTo(42 * px, browY - 4 * px, 50 * px, browY + 2 * px);
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.moveTo(16 * px, browY + 3 * px);
                ctx.lineTo(30 * px, browY - 2 * px);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(36 * px, browY - 2 * px);
                ctx.lineTo(50 * px, browY + 3 * px);
                ctx.stroke();
            }
        }
    }

    drawMouth(ctx, px, stress) {
        const mouthY = 42 * px;
        const mouthX = 22 * px;
        const mouthW = 20 * px;
        const isFemale = this.gender === 'female';

        // Female gets fuller, colored lips; male gets thin line mouth
        const lipColor = isFemale && stress <= 60 ? '#cc3355' : '#222';
        ctx.strokeStyle = lipColor;
        ctx.lineWidth = isFemale ? 2.5 * px : 2 * px;

        if (stress <= 20) {
            if (isFemale) {
                // Fuller smile with lip shape
                ctx.fillStyle = '#cc3355';
                ctx.beginPath();
                ctx.moveTo(mouthX + 2 * px, mouthY + 1 * px);
                ctx.quadraticCurveTo(mouthX + mouthW / 2, mouthY - 2 * px, mouthX + mouthW - 2 * px, mouthY + 1 * px);
                ctx.quadraticCurveTo(mouthX + mouthW / 2, mouthY + 7 * px, mouthX + 2 * px, mouthY + 1 * px);
                ctx.fill();
                ctx.strokeStyle = '#aa2244';
                ctx.lineWidth = 0.8 * px;
                ctx.stroke();
                // Upper lip line
                ctx.beginPath();
                ctx.moveTo(mouthX + 2 * px, mouthY + 1 * px);
                ctx.quadraticCurveTo(mouthX + mouthW / 2, mouthY - 2 * px, mouthX + mouthW - 2 * px, mouthY + 1 * px);
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.moveTo(mouthX, mouthY);
                ctx.quadraticCurveTo(mouthX + mouthW / 2, mouthY + 6 * px, mouthX + mouthW, mouthY);
                ctx.stroke();
            }
        } else if (stress <= 40) {
            if (isFemale) {
                // Neutral lips — still visible shape
                ctx.fillStyle = '#cc3355';
                ctx.beginPath();
                ctx.moveTo(mouthX + 2 * px, mouthY + 2 * px);
                ctx.quadraticCurveTo(mouthX + mouthW / 2, mouthY, mouthX + mouthW - 2 * px, mouthY + 2 * px);
                ctx.quadraticCurveTo(mouthX + mouthW / 2, mouthY + 5 * px, mouthX + 2 * px, mouthY + 2 * px);
                ctx.fill();
                ctx.strokeStyle = '#aa2244';
                ctx.lineWidth = 0.6 * px;
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.moveTo(mouthX, mouthY + 2 * px);
                ctx.lineTo(mouthX + mouthW, mouthY + 2 * px);
                ctx.stroke();
            }
        } else if (stress <= 60) {
            if (isFemale) {
                // Slight frown with lip shape
                ctx.fillStyle = '#bb3355';
                ctx.beginPath();
                ctx.moveTo(mouthX + 2 * px, mouthY + 1 * px);
                ctx.quadraticCurveTo(mouthX + mouthW / 2, mouthY + 3 * px, mouthX + mouthW - 2 * px, mouthY + 1 * px);
                ctx.quadraticCurveTo(mouthX + mouthW / 2, mouthY - 2 * px, mouthX + 2 * px, mouthY + 1 * px);
                ctx.fill();
                ctx.strokeStyle = '#992244';
                ctx.lineWidth = 0.6 * px;
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.moveTo(mouthX, mouthY + 2 * px);
                ctx.quadraticCurveTo(mouthX + mouthW / 2, mouthY - 3 * px, mouthX + mouthW, mouthY + 2 * px);
                ctx.stroke();
            }
        } else if (stress <= 80) {
            // Open frown (worried mouth) — same for both
            ctx.fillStyle = '#600';
            ctx.beginPath();
            ctx.ellipse(mouthX + mouthW / 2, mouthY + 2 * px, 8 * px, 5 * px, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            if (isFemale) {
                // Lipstick smudge around the open mouth
                ctx.strokeStyle = '#993344';
                ctx.lineWidth = 1 * px;
                ctx.beginPath();
                ctx.ellipse(mouthX + mouthW / 2, mouthY + 2 * px, 9 * px, 6 * px, 0, 0, Math.PI * 2);
                ctx.stroke();
            }
        } else {
            // Grimace — teeth showing
            ctx.fillStyle = '#600';
            ctx.fillRect(mouthX, mouthY - 2 * px, mouthW, 8 * px);
            ctx.strokeRect(mouthX, mouthY - 2 * px, mouthW, 8 * px);

            // Teeth
            ctx.fillStyle = '#fff';
            for (let i = 0; i < 5; i++) {
                ctx.fillRect(mouthX + 1 * px + i * 4 * px, mouthY - 1 * px, 3 * px, 3 * px);
            }
        }
    }

    drawSweat(ctx, px, stress) {
        const dropCount = stress > 70 ? 3 : stress > 55 ? 2 : 1;
        ctx.fillStyle = '#66bbff';

        for (let i = 0; i < dropCount; i++) {
            const x = (10 + i * 18) * px;
            const baseY = (14 + this.sweatDropY) * px;

            // Teardrop shape
            ctx.beginPath();
            ctx.moveTo(x, baseY);
            ctx.quadraticCurveTo(x - 2 * px, baseY + 4 * px, x, baseY + 6 * px);
            ctx.quadraticCurveTo(x + 2 * px, baseY + 4 * px, x, baseY);
            ctx.fill();
        }
    }

    drawSteam(ctx, px) {
        // Wavy lines above head
        ctx.strokeStyle = 'rgba(255, 100, 100, 0.6)';
        ctx.lineWidth = 1.5 * px;

        const phase = this.animFrame * 0.3;
        for (let i = 0; i < 3; i++) {
            const x = (18 + i * 12) * px;
            ctx.beginPath();
            ctx.moveTo(x, 4 * px);
            ctx.quadraticCurveTo(x + 3 * px, (1 - Math.sin(phase + i)) * px, x, -2 * px);
            ctx.stroke();
        }
    }

    drawMaleHair(ctx, px) {
        // Short cropped hair — pixel blocks on top
        ctx.fillStyle = '#3a2a1a';
        for (let x = 12; x <= 48; x += 4) {
            ctx.fillRect(x * px, 2 * px, 4 * px, 6 * px);
        }
    }

    drawFemaleHair(ctx, px) {
        const hairColor = '#8b5e3c';
        const hairHighlight = '#a87550';

        // Long flowing hair — top section (fuller, rounder)
        ctx.fillStyle = hairColor;
        // Main hair volume — rounded top
        ctx.beginPath();
        ctx.moveTo(8 * px, 12 * px);
        ctx.quadraticCurveTo(8 * px, 0, 32 * px, -1 * px);
        ctx.quadraticCurveTo(56 * px, 0, 56 * px, 12 * px);
        ctx.lineTo(56 * px, 6 * px);
        ctx.quadraticCurveTo(56 * px, -2 * px, 32 * px, -3 * px);
        ctx.quadraticCurveTo(8 * px, -2 * px, 8 * px, 6 * px);
        ctx.closePath();
        ctx.fill();

        // Side hair — left (longer, flowing past face)
        ctx.fillRect(2 * px, 6 * px, 8 * px, 38 * px);
        ctx.fillRect(0 * px, 12 * px, 5 * px, 30 * px);
        // Rounded bottom of left hair
        ctx.beginPath();
        ctx.arc(5 * px, 44 * px, 5 * px, 0, Math.PI);
        ctx.fill();

        // Side hair — right (longer, flowing past face)
        ctx.fillRect(54 * px, 6 * px, 8 * px, 38 * px);
        ctx.fillRect(59 * px, 12 * px, 5 * px, 30 * px);
        // Rounded bottom of right hair
        ctx.beginPath();
        ctx.arc(59 * px, 44 * px, 5 * px, 0, Math.PI);
        ctx.fill();

        // Fringe / bangs — swept to one side
        ctx.fillRect(10 * px, 4 * px, 24 * px, 6 * px);
        ctx.fillRect(10 * px, 8 * px, 16 * px, 3 * px);

        // Hair highlight/shine streak
        ctx.fillStyle = hairHighlight;
        ctx.fillRect(14 * px, 2 * px, 3 * px, 6 * px);
        ctx.fillRect(28 * px, 1 * px, 3 * px, 5 * px);
    }

    drawEyelashes(ctx, px) {
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 1.2 * px;

        const leftX = 20 * px;
        const rightX = 38 * px;
        const eyeTop = 23 * px;

        // Left eye — thick top lashes (more prominent, curved)
        ctx.beginPath();
        ctx.moveTo(leftX - 1 * px, eyeTop + 1 * px);
        ctx.lineTo(leftX - 3 * px, eyeTop - 4 * px);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(leftX + 3 * px, eyeTop - 1 * px);
        ctx.lineTo(leftX + 2 * px, eyeTop - 5 * px);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(leftX + 7 * px, eyeTop - 1 * px);
        ctx.lineTo(leftX + 8 * px, eyeTop - 5 * px);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(leftX + 10 * px, eyeTop);
        ctx.lineTo(leftX + 13 * px, eyeTop - 4 * px);
        ctx.stroke();

        // Right eye — thick top lashes
        ctx.beginPath();
        ctx.moveTo(rightX - 1 * px, eyeTop + 1 * px);
        ctx.lineTo(rightX - 3 * px, eyeTop - 4 * px);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(rightX + 3 * px, eyeTop - 1 * px);
        ctx.lineTo(rightX + 2 * px, eyeTop - 5 * px);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(rightX + 7 * px, eyeTop - 1 * px);
        ctx.lineTo(rightX + 8 * px, eyeTop - 5 * px);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(rightX + 10 * px, eyeTop);
        ctx.lineTo(rightX + 13 * px, eyeTop - 4 * px);
        ctx.stroke();

        // Earrings (small gold circles visible below hair on each side)
        ctx.fillStyle = '#e8c040';
        ctx.strokeStyle = '#c0a030';
        ctx.lineWidth = 0.5 * px;
        // Left earring
        ctx.beginPath();
        ctx.arc(10 * px, 34 * px, 2 * px, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Right earring
        ctx.beginPath();
        ctx.arc(54 * px, 34 * px, 2 * px, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    drawStressMeter(ctx, px, stress) {
        const barX = 8 * px;
        const barY = 54 * px;
        const barW = 48 * px;
        const barH = 6 * px;

        // Background
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(barX, barY, barW, barH);

        // Fill
        const fillW = (stress / 100) * barW;
        if (stress <= 30) ctx.fillStyle = '#33cc66';
        else if (stress <= 60) ctx.fillStyle = '#ffcc00';
        else ctx.fillStyle = '#ff4444';

        ctx.fillRect(barX, barY, fillW, barH);

        // Border
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1 * px;
        ctx.strokeRect(barX, barY, barW, barH);
    }

    /**
     * Create a wrapped element with the face + label.
     */
    createWidget() {
        const wrapper = document.createElement('div');
        wrapper.className = 'stress-face-widget';

        // Label above the graphic, same style as "BOARD SATISFACTION"
        const label = document.createElement('div');
        label.className = 'pixel-text';
        label.style.cssText = 'font-size:8px;color:var(--text-secondary);text-align:center;';
        label.textContent = 'STRESS LEVELS';
        wrapper.appendChild(label);

        wrapper.appendChild(this.canvas);

        const levelEl = document.createElement('div');
        levelEl.className = 'stress-face-level pixel-text';
        levelEl.id = 'stress-level-text';
        levelEl.textContent = '0%';
        wrapper.appendChild(levelEl);

        return wrapper;
    }

    /**
     * Update the widget label text.
     */
    updateWidget() {
        this.update();
        const levelEl = document.getElementById('stress-level-text');
        if (levelEl) {
            levelEl.textContent = `${this.lastStress}%`;
        }
    }
}
