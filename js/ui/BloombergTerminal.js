// Bloomberg Terminal-style market ticker widget
// Shows the main exposure's price developing in real-time during the quarter

import { gameState } from '../engine/GameState.js';

export class BloombergTerminal {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.animFrame = null;
        this.running = false;

        // Terminal dimensions
        this.w = canvas.width;
        this.h = canvas.height;

        // Price data
        this.underlying = '';
        this.exposureType = '';
        this.ticks = [];           // Generated intra-quarter price ticks
        this.currentTickIndex = 0;
        this.tickSpeed = 120;      // ms per tick
        this.lastTickTime = 0;
        this.startRate = 0;
        this.endRate = 0;

        // Display state
        this.bid = 0;
        this.ask = 0;
        this.open = 0;
        this.high = 0;
        this.low = 0;
        this.last = 0;
        this.change = 0;
        this.changePct = 0;
        this.volume = 0;

        // Visual
        this.scanlineOffset = 0;
        this.cursorBlink = true;
        this.blinkTimer = 0;
        this.newsIndex = 0;
        this.newsScrollX = 0;

        // News ticker messages
        this.newsMessages = [
            'CENTRAL BANK HOLDS RATES STEADY',
            'GLOBAL TRADE TENSIONS RISE',
            'COMMODITY MARKETS VOLATILE',
            'FX MARKETS AWAIT POLICY DECISION',
            'INFLATION DATA DUE THIS WEEK',
            'RISK APPETITE IMPROVES ON DATA',
            'TREASURY YIELDS EDGE HIGHER',
            'EMERGING MARKETS UNDER PRESSURE',
            'OIL INVENTORIES DECLINE',
            'MANUFACTURING PMI BEATS FORECAST',
            'CONSUMER CONFIDENCE SLIPS',
            'CORPORATE EARNINGS SEASON BEGINS',
            'HEDGE FUND FLOWS SHIFT TO SAFETY',
            'RATE CUT EXPECTATIONS PRICED IN',
            'SUPPLY CHAIN DISRUPTIONS PERSIST'
        ];
    }

    /**
     * Generate synthetic intra-quarter price ticks using a random bridge.
     * Starts at prevRate, ends near nextRate, with realistic noise.
     */
    generateTicks(prevRate, nextRate, rng, numTicks = 60) {
        this.ticks = [];
        this.startRate = prevRate;
        this.endRate = nextRate;

        if (!prevRate || !nextRate) return;

        // Brownian bridge: path from prevRate to nextRate with controlled volatility
        const totalReturn = nextRate / prevRate - 1;
        const dailyDrift = totalReturn / numTicks;
        const dailyVol = Math.abs(totalReturn) * 0.4 + 0.002; // Scale vol with move size

        let price = prevRate;
        this.ticks.push(price);

        for (let i = 1; i < numTicks; i++) {
            const t = i / numTicks;
            // Pull toward the target as t → 1
            const target = prevRate + (nextRate - prevRate) * t;
            const pullStrength = 0.15 + 0.35 * t; // Stronger pull near end
            const noise = (rng ? rng.floatRange(-1, 1) : (Math.random() * 2 - 1)) * dailyVol * prevRate;

            price = price * (1 - pullStrength) + target * pullStrength + noise;
            // Clamp to avoid nonsense
            price = Math.max(prevRate * 0.85, Math.min(prevRate * 1.15, price));
            this.ticks.push(price);
        }

        // Final tick snaps to endRate
        this.ticks.push(nextRate);
    }

    /**
     * Start the terminal animation for a given exposure.
     * @param {string} underlying - e.g. 'EURUSD', 'BRENT'
     * @param {string} exposureType - 'fx', 'commodity', 'ir'
     * @param {number} prevRate - rate at start of quarter
     * @param {number} nextRate - rate at end of quarter (target)
     * @param {object} rng - SeededRandom instance
     */
    start(underlying, exposureType, prevRate, nextRate, rng) {
        this.underlying = underlying;
        this.exposureType = exposureType;
        this.currentTickIndex = 0;
        this.lastTickTime = 0;
        this.volume = Math.floor((rng ? rng.floatRange(50, 200) : 120) * 1000);

        this.generateTicks(prevRate, nextRate, rng);

        if (this.ticks.length > 0) {
            this.open = this.ticks[0];
            this.high = this.ticks[0];
            this.low = this.ticks[0];
            this.last = this.ticks[0];
            this.bid = this.ticks[0];
            this.ask = this.ticks[0];
            this.change = 0;
            this.changePct = 0;
        }

        // Shuffle news
        if (rng) {
            this.newsMessages = rng.shuffle([...this.newsMessages]);
        }
        this.newsScrollX = this.w;
        this.newsIndex = 0;

        this.running = true;
        this.animate(performance.now());
    }

    stop() {
        this.running = false;
        if (this.animFrame) {
            cancelAnimationFrame(this.animFrame);
            this.animFrame = null;
        }
    }

    /** Returns true if all ticks have been displayed */
    isComplete() {
        return this.currentTickIndex >= this.ticks.length - 1;
    }

    /** Get the current displayed price */
    getCurrentPrice() {
        return this.last;
    }

    animate(timestamp) {
        if (!this.running) return;

        // Advance ticks
        if (timestamp - this.lastTickTime > this.tickSpeed && !this.isComplete()) {
            this.lastTickTime = timestamp;
            this.currentTickIndex++;
            this.last = this.ticks[this.currentTickIndex];

            // Spread: wider for less liquid / more volatile
            const spreadBps = this.exposureType === 'fx' ? 2 : this.exposureType === 'ir' ? 1 : 5;
            const halfSpread = this.last * (spreadBps / 10000);
            this.bid = this.last - halfSpread;
            this.ask = this.last + halfSpread;

            this.high = Math.max(this.high, this.last);
            this.low = Math.min(this.low, this.last);
            this.change = this.last - this.open;
            this.changePct = this.open > 0 ? (this.change / this.open) * 100 : 0;
            this.volume += Math.floor(Math.random() * 500 + 100);
        }

        // Blink cursor
        this.blinkTimer += 16;
        if (this.blinkTimer > 500) {
            this.cursorBlink = !this.cursorBlink;
            this.blinkTimer = 0;
        }

        // Scroll news
        this.newsScrollX -= 0.8;

        this.draw(timestamp);
        this.animFrame = requestAnimationFrame((t) => this.animate(t));
    }

    draw(timestamp) {
        const ctx = this.ctx;
        const w = this.w;
        const h = this.h;

        // Background — deep Bloomberg navy/black
        ctx.fillStyle = '#0a0e1a';
        ctx.fillRect(0, 0, w, h);

        // Subtle scanlines
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        for (let y = 0; y < h; y += 2) {
            ctx.fillRect(0, y, w, 1);
        }

        // Border glow
        ctx.strokeStyle = '#1a3050';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
        ctx.strokeStyle = '#0d1f35';
        ctx.strokeRect(1.5, 1.5, w - 3, h - 3);

        // Layout regions
        const headerH = 18;
        const tickerBarH = 14;
        const chartTop = headerH + 2;
        const chartBottom = h - tickerBarH - 2;
        const chartH = chartBottom - chartTop;
        const quoteAreaW = 110;
        const chartLeft = 4;
        const chartRight = w - quoteAreaW - 4;
        const chartW = chartRight - chartLeft;

        // === HEADER BAR ===
        ctx.fillStyle = '#1a2744';
        ctx.fillRect(0, 0, w, headerH);

        // Underlying name — Bloomberg orange
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = '#ff8c00';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.formatUnderlying(), 4, headerH / 2);

        // Asset class badge
        const badgeText = this.exposureType.toUpperCase();
        const badgeX = ctx.measureText(this.formatUnderlying()).width + 10;
        ctx.fillStyle = this.exposureType === 'fx' ? '#1a5c3a' : this.exposureType === 'commodity' ? '#5c4a1a' : '#1a3a5c';
        ctx.fillRect(badgeX, 3, ctx.measureText(badgeText).width + 8, 12);
        ctx.fillStyle = this.exposureType === 'fx' ? '#44cc88' : this.exposureType === 'commodity' ? '#ccaa44' : '#4488cc';
        ctx.font = '9px monospace';
        ctx.fillText(badgeText, badgeX + 4, headerH / 2);

        // Timestamp
        ctx.font = '9px monospace';
        ctx.fillStyle = '#667799';
        const timeStr = this.formatTimestamp();
        ctx.textAlign = 'right';
        ctx.fillText(timeStr, w - 4, headerH / 2);
        ctx.textAlign = 'left';

        // === PRICE CHART ===
        this.drawChart(ctx, chartLeft, chartTop, chartW, chartH);

        // === QUOTE PANEL (right side) ===
        this.drawQuotePanel(ctx, chartRight + 4, chartTop, quoteAreaW - 4, chartH);

        // === NEWS TICKER BAR ===
        this.drawNewsTicker(ctx, 0, h - tickerBarH, w, tickerBarH);
    }

    drawChart(ctx, x, y, w, h) {
        // Chart background
        ctx.fillStyle = '#060c18';
        ctx.fillRect(x, y, w, h);

        // Border
        ctx.strokeStyle = '#1a2744';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, w, h);

        if (this.ticks.length < 2) return;

        const visibleTicks = this.ticks.slice(0, this.currentTickIndex + 1);
        const allTicks = this.ticks;

        // Price range for scaling — use full range for stability
        let minP = Math.min(...allTicks) * 0.9998;
        let maxP = Math.max(...allTicks) * 1.0002;
        if (maxP === minP) { maxP += 0.001; minP -= 0.001; }
        const range = maxP - minP;

        const chartPad = 4;
        const cw = w - chartPad * 2;
        const ch = h - chartPad * 2;
        const cx = x + chartPad;
        const cy = y + chartPad;

        // Grid lines
        ctx.strokeStyle = '#0f1a2e';
        ctx.lineWidth = 0.5;
        const gridLines = 4;
        for (let i = 0; i <= gridLines; i++) {
            const gy = cy + (ch / gridLines) * i;
            ctx.beginPath();
            ctx.moveTo(cx, gy);
            ctx.lineTo(cx + cw, gy);
            ctx.stroke();

            // Price labels
            const gridPrice = maxP - (range / gridLines) * i;
            ctx.font = '8px monospace';
            ctx.fillStyle = '#334466';
            ctx.fillText(this.formatPrice(gridPrice), cx + 1, gy - 2);
        }

        // Open price line (dashed)
        if (this.open > 0) {
            const openY = cy + ch - ((this.open - minP) / range) * ch;
            ctx.strokeStyle = '#334466';
            ctx.lineWidth = 0.5;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(cx, openY);
            ctx.lineTo(cx + cw, openY);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.font = '7px monospace';
            ctx.fillStyle = '#445577';
            ctx.textAlign = 'right';
            ctx.fillText('OPEN', cx + cw - 1, openY - 2);
            ctx.textAlign = 'left';
        }

        // Price line
        if (visibleTicks.length > 1) {
            const totalTicks = allTicks.length;

            // Filled area under the line
            ctx.beginPath();
            const firstX = cx;
            const firstY = cy + ch - ((visibleTicks[0] - minP) / range) * ch;
            ctx.moveTo(firstX, firstY);

            for (let i = 1; i < visibleTicks.length; i++) {
                const px = cx + (i / (totalTicks - 1)) * cw;
                const py = cy + ch - ((visibleTicks[i] - minP) / range) * ch;
                ctx.lineTo(px, py);
            }

            const lastX = cx + ((visibleTicks.length - 1) / (totalTicks - 1)) * cw;
            const lastY = cy + ch - ((visibleTicks[visibleTicks.length - 1] - minP) / range) * ch;

            // Fill under line
            ctx.lineTo(lastX, cy + ch);
            ctx.lineTo(firstX, cy + ch);
            ctx.closePath();
            const isUp = this.change >= 0;
            const fillGrad = ctx.createLinearGradient(0, cy, 0, cy + ch);
            fillGrad.addColorStop(0, isUp ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)');
            fillGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            ctx.fillStyle = fillGrad;
            ctx.fill();

            // Line itself
            ctx.beginPath();
            ctx.moveTo(firstX, firstY);
            for (let i = 1; i < visibleTicks.length; i++) {
                const px = cx + (i / (totalTicks - 1)) * cw;
                const py = cy + ch - ((visibleTicks[i] - minP) / range) * ch;
                ctx.lineTo(px, py);
            }
            ctx.strokeStyle = isUp ? '#22c55e' : '#ef4444';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Glowing dot at current price
            ctx.beginPath();
            ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
            ctx.fillStyle = isUp ? '#22c55e' : '#ef4444';
            ctx.fill();

            // Pulse ring
            if (this.cursorBlink && !this.isComplete()) {
                ctx.beginPath();
                ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
                ctx.strokeStyle = isUp ? 'rgba(34, 197, 94, 0.4)' : 'rgba(239, 68, 68, 0.4)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            // Current price label at right edge
            ctx.fillStyle = isUp ? '#22c55e' : '#ef4444';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'right';
            ctx.fillText(this.formatPrice(this.last), cx + cw - 1, lastY - 5);
            ctx.textAlign = 'left';
        }
    }

    drawQuotePanel(ctx, x, y, w, h) {
        // Panel background
        ctx.fillStyle = '#0c1220';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#1a2744';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, w, h);

        const isUp = this.change >= 0;
        const pad = 6;
        let cy = y + pad;
        const lineH = 13;

        // LAST price — big
        ctx.font = 'bold 14px monospace';
        ctx.fillStyle = isUp ? '#22c55e' : '#ef4444';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(this.formatPrice(this.last), x + w / 2, cy);
        cy += 18;

        // Change
        const changeStr = `${isUp ? '+' : ''}${this.change.toFixed(4)}`;
        const pctStr = `${isUp ? '+' : ''}${this.changePct.toFixed(2)}%`;
        ctx.font = '9px monospace';
        ctx.fillStyle = isUp ? '#22c55e' : '#ef4444';
        ctx.fillText(`${changeStr}  ${pctStr}`, x + w / 2, cy);
        cy += lineH + 4;

        // Divider
        ctx.strokeStyle = '#1a2744';
        ctx.beginPath();
        ctx.moveTo(x + pad, cy);
        ctx.lineTo(x + w - pad, cy);
        ctx.stroke();
        cy += 6;

        // Quote details
        ctx.textAlign = 'left';
        const labelX = x + pad;
        const valueX = x + w - pad;

        const rows = [
            ['BID', this.formatPrice(this.bid)],
            ['ASK', this.formatPrice(this.ask)],
            ['OPEN', this.formatPrice(this.open)],
            ['HIGH', this.formatPrice(this.high)],
            ['LOW', this.formatPrice(this.low)],
            ['VOL', this.formatVolume(this.volume)]
        ];

        for (const [label, value] of rows) {
            if (cy + lineH > y + h - 4) break;

            ctx.font = '8px monospace';
            ctx.fillStyle = '#556688';
            ctx.textAlign = 'left';
            ctx.fillText(label, labelX, cy);

            ctx.fillStyle = '#aabbcc';
            ctx.textAlign = 'right';
            ctx.fillText(value, valueX, cy);

            cy += lineH;
        }

        ctx.textAlign = 'left';
    }

    drawNewsTicker(ctx, x, y, w, h) {
        // Ticker background
        ctx.fillStyle = '#0d1520';
        ctx.fillRect(x, y, w, h);

        // Top border
        ctx.strokeStyle = '#1a2744';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y);
        ctx.stroke();

        // "NEWS" badge
        ctx.fillStyle = '#ff8c00';
        ctx.fillRect(x + 2, y + 2, 32, h - 4);
        ctx.font = 'bold 8px monospace';
        ctx.fillStyle = '#0a0e1a';
        ctx.textBaseline = 'middle';
        ctx.fillText('NEWS', x + 5, y + h / 2);

        // Scrolling text
        const msg = this.newsMessages[this.newsIndex % this.newsMessages.length];
        ctx.font = '9px monospace';
        ctx.fillStyle = '#889abb';

        // Clip to ticker area
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 36, y, w - 38, h);
        ctx.clip();

        ctx.fillText(msg, this.newsScrollX, y + h / 2);

        ctx.restore();

        // Advance to next message when current scrolls off
        const textW = ctx.measureText(msg).width;
        if (this.newsScrollX < -textW) {
            this.newsScrollX = w;
            this.newsIndex++;
        }
    }

    // === Formatting helpers ===

    formatUnderlying() {
        // Format for Bloomberg style: EUR/USD, BRENT, etc.
        const u = this.underlying;
        if (u.length === 6 && this.exposureType === 'fx') {
            return `${u.slice(0, 3)}/${u.slice(3)} Curncy`;
        }
        if (this.exposureType === 'ir') {
            return `${u} Index`;
        }
        return `${u} Comdty`;
    }

    formatPrice(price) {
        if (!price) return '—';
        if (this.exposureType === 'ir') return price.toFixed(4);
        if (this.underlying.includes('JPY')) return price.toFixed(2);
        if (this.exposureType === 'commodity') return price.toFixed(2);
        return price.toFixed(4);
    }

    formatVolume(vol) {
        if (vol >= 1e6) return `${(vol / 1e6).toFixed(1)}M`;
        if (vol >= 1e3) return `${(vol / 1e3).toFixed(0)}K`;
        return `${vol}`;
    }

    formatTimestamp() {
        const state = gameState.get();
        const year = state.startYear + state.currentYearOffset;
        const quarter = state.currentQuarter;
        const months = ['JAN', 'APR', 'JUL', 'OCT'];
        const progress = this.ticks.length > 0
            ? Math.min(2, Math.floor((this.currentTickIndex / this.ticks.length) * 3))
            : 0;
        const monthIdx = (quarter - 1) * 3 + progress;
        const allMonths = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
        const day = Math.floor(Math.random() * 28) + 1; // Cosmetic jitter
        return `${String(day).padStart(2,'0')} ${allMonths[monthIdx]} ${year}`;
    }
}
