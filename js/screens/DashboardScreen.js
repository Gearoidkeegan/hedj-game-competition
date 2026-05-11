// Dashboard Screen — main gameplay view
// Phase 2: Real market data, multi-product hedging, intra-quarter live trading,
//          trade direction test, bank counterparties, BEGIN QUARTER flow

import { gameState } from '../engine/GameState.js';
import { gameLoop } from '../engine/GameLoop.js';
import { marketEngine } from '../engine/MarketEngine.js';
import { hedgingEngine } from '../engine/HedgingEngine.js';
import { bankEngine } from '../engine/BankEngine.js';
import { tmsEngine } from '../engine/TMSEngine.js';
import { GAME_CONFIG } from '../utils/constants.js';
import { formatCurrency, formatRate, formatPercent, formatQuarter, formatPnL, pnlClass } from '../utils/formatters.js';
import { EraPopup } from '../ui/EraPopup.js';
import { IsometricScene } from '../ui/IsometricScene.js';
import { BloombergTerminal } from '../ui/BloombergTerminal.js';
import { HedgeLadder } from '../ui/HedgeLadder.js';
import { StressFace } from '../ui/StressFace.js';
import { soundFX } from '../ui/SoundFX.js';

// Format exposure size using physical units (mT, bbl) when defined, otherwise currency
function formatExposureNotional(exp, notionalUSD) {
    const n = notionalUSD !== undefined ? notionalUSD : (exp.quarterlyNotional || 0);
    if (exp.physicalNotional && exp.physicalUnit && exp.quarterlyNotional > 0) {
        const scaled = Math.round(exp.physicalNotional * (n / exp.quarterlyNotional));
        return `${scaled.toLocaleString()} ${exp.physicalUnit}`;
    }
    return formatCurrency(n, '', true);
}

export class DashboardScreen {
    constructor(app) {
        this.app = app;
        this.el = null;
        this.selectedExposure = null;
        this.selectedProductId = null;
        this.selectedBankId = null;
        this.isoScene = null;
        this.bloombergTerminal = null;
        this.hedgeLadder = null;
        this.stressFace = null;

        // Quarter state
        this.quarterStarted = false;     // Has BEGIN QUARTER been pressed?
        this.tradesThisQuarter = 0;      // Trading cost tracker
        this.tradingCostsThisQuarter = 0;
        this.tradeDirectionConfirmed = false; // Has user passed the direction test?

        // Rate state for end-of-quarter resolution
        this.endOfQuarterRates = null;
    }

    render() {
        this.el = document.createElement('div');
        this.el.className = 'screen active dashboard-screen';

        const state = gameState.get();
        const quarterLabel = formatQuarter(state.currentYearOffset, state.currentQuarter);

        this.el.innerHTML = `
            <!-- Quarter Bar -->
            <div class="quarter-bar">
                <div class="qbar-row1">
                    <span class="company-name">${state.industry?.name || 'Company'}</span>
                    <span class="quarter-label">${quarterLabel}</span>
                    <div class="quarter-pips" id="quarter-pips"></div>
                </div>
                <div class="qbar-row2">
                    <span class="qbar-stat">
                        <span class="pixel-text" style="font-size:8px;color:var(--text-secondary)">CASH</span>
                        <span class="pixel-text" style="font-size:9px;color:${state.cashBalance >= state.startingCash * 0.2 ? 'var(--pnl-positive)' : 'var(--pnl-negative)'}">${formatCurrency(state.cashBalance, state.industry?.baseCurrency, true)}</span>
                    </span>
                    <span class="qbar-stat">
                        <span class="pixel-text" style="font-size:8px;color:var(--text-secondary)">P&L</span>
                        <span class="pixel-text ${pnlClass(state.cumulativePnL)}" style="font-size:9px">${formatPnL(state.cumulativePnL, state.industry?.baseCurrency)}</span>
                    </span>
                    <span class="qbar-stat">
                        <span class="pixel-text" style="font-size:8px;color:var(--text-secondary)">BOARD</span>
                        <span id="qbar-satisfaction" class="pixel-text" style="font-size:9px;color:${state.boardSatisfaction >= 50 ? 'var(--satisfaction-high)' : state.boardSatisfaction >= 25 ? 'var(--satisfaction-mid)' : 'var(--satisfaction-low)'}">
                            ${state.boardSatisfaction}%
                        </span>
                    </span>
                    <span id="stress-face-slot"></span>
                    <span id="trade-count-badge" class="pixel-text" style="font-size:7px;color:var(--text-muted)"></span>
                </div>
            </div>

            <!-- Policy strip -->
            <div class="policy-strip" id="policy-strip"></div>

            <!-- Main area -->
            <div class="dashboard-main">
                <!-- Left: Scene + Exposures -->
                <div class="dashboard-left">
                    <!-- Isometric viewport with Bloomberg terminal overlay -->
                    <div class="isometric-viewport" id="iso-viewport" style="position:relative;">
                        <canvas id="iso-canvas" width="620" height="200"></canvas>
                        <!-- Mobile Bloomberg overlay — rendered on top of isometric scene when quarter active -->
                        <canvas id="bloomberg-canvas-mobile" width="620" height="150"
                            style="position:absolute;top:0;left:0;width:100%;height:100%;display:none;z-index:2;
                            border-radius:2px;box-shadow:0 0 8px rgba(0,140,255,0.3), inset 0 0 2px rgba(0,140,255,0.2);"></canvas>
                    </div>

                    <!-- Tabs -->
                    <div class="tab-bar" id="main-tab-bar">
                        <div class="tab active" data-tab="exposures">EXPOSURES</div>
                        <div class="tab" data-tab="market">MARKET</div>
                        <div class="tab" data-tab="portfolio">PORTFOLIO</div>
                        <div class="tab" data-tab="banks">BANKS</div>
                        <div class="tab" data-tab="board-requests">REQUESTS</div>
                        <div class="tab mobile-only-tab" data-tab="hedging">HEDGING</div>
                    </div>

                    <div class="tab-content active" data-tab-content="exposures" id="exposures-tab">
                        <div class="panel-inset exposure-list" id="exposure-list"></div>
                    </div>
                    <div class="tab-content" data-tab-content="market" id="market-tab">
                        <div class="panel-inset overflow-auto flex-1" id="market-view"></div>
                    </div>
                    <div class="tab-content" data-tab-content="portfolio" id="portfolio-tab">
                        <div class="panel-inset overflow-auto flex-1" id="portfolio-view"></div>
                    </div>
                    <div class="tab-content" data-tab-content="banks" id="banks-tab">
                        <div class="panel-inset overflow-auto flex-1" id="banks-view"></div>
                    </div>
                    <div class="tab-content" data-tab-content="board-requests" id="board-requests-tab">
                        <div class="panel-inset overflow-auto flex-1" id="board-requests-view"></div>
                    </div>
                </div>

                <!-- Right: Hedging controls -->
                <div class="dashboard-right">
                    <div class="panel hedge-panel">
                        <div class="panel-title">
                            HEDGING DESK
                            <span id="policy-badge" class="badge" style="font-size:6px"></span>
                        </div>

                        <!-- Mobile exposure selector (hidden on desktop) -->
                        <div class="mobile-exposure-selector" id="mobile-exposure-selector">
                            <select id="mobile-exposure-select" class="mobile-exposure-dropdown">
                                <option value="">— Select exposure —</option>
                            </select>
                        </div>

                        <!-- Scrollable middle: exposure info, direction test, products, ladder -->
                        <div style="flex:1;min-height:0;overflow-y:auto;">
                            <!-- Bloomberg terminal chart — selected exposure price -->
                            <div id="bloomberg-right" style="margin-bottom:8px;">
                                <canvas id="bloomberg-canvas-right" width="280" height="130" style="width:100%;border-radius:2px;box-shadow:0 0 8px rgba(0,140,255,0.3), inset 0 0 2px rgba(0,140,255,0.2);display:none;"></canvas>
                            </div>

                            <!-- Selected exposure info -->
                            <div class="panel-inset mb-8" id="selected-exposure-info">
                                <div class="readable-text" style="color:var(--text-muted);text-align:center;padding:16px;">
                                    Select an exposure to hedge
                                </div>
                            </div>

                            <!-- Trade direction test (shown when exposure selected) -->
                            <div id="direction-test" style="display:none;"></div>

                            <!-- Product selector (shown after direction confirmed) -->
                            <div class="hedge-product-selector" id="product-selector" style="display:none;"></div>

                            <!-- Hedge ladder -->
                            <div id="hedge-ladder-container" style="display:none;"></div>
                        </div>

                        <!-- Fixed bottom: bank execute buttons (always visible) -->
                        <div id="trade-execution" style="display:none;border-top:1px solid var(--border);padding-top:6px;margin-top:4px;flex-shrink:0;"></div>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div class="dashboard-footer">
                <div>
                    <span class="pixel-text" style="font-size:8px;color:var(--text-muted)">POLICY: </span>
                    <span class="pixel-text" style="font-size:8px;color:var(--cyan)" id="policy-name"></span>
                </div>
                <button class="btn btn-gold" id="btn-begin-quarter" style="display:inline-block;">
                    BEGIN QUARTER ▶
                </button>
                <button class="btn btn-gold" id="btn-end-quarter" style="display:inline-block;">
                    END QUARTER ■
                </button>
            </div>
        `;

        return this.el;
    }

    mount() {
        // Reset quarter state
        this.quarterStarted = false;
        this.tradesThisQuarter = 0;
        this.tradingCostsThisQuarter = 0;
        this.tradeDirectionConfirmed = false;
        this.endOfQuarterRates = null;
        this.selectedExposure = null;
        this.selectedProductId = null;
        this.selectedBankId = null;

        // Initialize stress face
        this.stressFace = new StressFace(48);
        const stressSlot = this.el.querySelector('#stress-face-slot');
        if (stressSlot) {
            stressSlot.appendChild(this.stressFace.createWidget());
            this.stressFace.start();
            this.stressFace.updateWidget();
        }

        this.renderQuarterPips();
        this.renderExposures();
        this.renderMarketView();
        this.renderPortfolio();
        this.renderBanksView();
        this.renderBoardRequests();
        this.renderPolicy();
        this.drawIsometricScene();
        this.updateTradeCountBadge();

        // Tab switching (with mobile HEDGING tab support)
        this.el.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = tab.dataset.tab;
                this.el.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const dashLeft = this.el.querySelector('.dashboard-left');
                const dashRight = this.el.querySelector('.dashboard-right');

                if (tabId === 'hedging') {
                    // Mobile: show hedging panel below viewport, hide tab content but keep viewport visible
                    this.el.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
                    dashLeft.classList.add('mobile-hedging-active');
                    dashRight.classList.add('mobile-active');
                } else {
                    // Normal tab: show left content, hide hedging panel on mobile
                    dashLeft.classList.remove('mobile-hedging-active');
                    dashRight.classList.remove('mobile-active');
                    this.el.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
                    const target = this.el.querySelector(`[data-tab-content="${tabId}"]`);
                    if (target) target.classList.add('active');
                }
            });
        });

        // Mobile exposure selector dropdown
        this.populateMobileExposureSelector();
        const mobileExpSelect = this.el.querySelector('#mobile-exposure-select');
        if (mobileExpSelect) {
            mobileExpSelect.addEventListener('change', () => {
                const underlying = mobileExpSelect.value;
                if (underlying) {
                    this.selectExposure(underlying);
                }
            });
        }

        // BEGIN QUARTER — starts Bloomberg animation + live trading
        this.el.querySelector('#btn-begin-quarter').addEventListener('click', () => {
            this.beginQuarter();
        });

        // END QUARTER — resolves the quarter
        this.el.querySelector('#btn-end-quarter').addEventListener('click', () => {
            this.endQuarter();
        });

        // Execute hedge buttons are wired dynamically in renderBankExecuteButtons()

        // Listen for exposure unlocks (fired when advanceQuarter() unlocks new exposures)
        this._exposureUnlockHandler = (newExposures) => {
            this.showExposureUnlockNotification(newExposures);
            this.renderExposures();
        };
        gameState.on('exposuresUnlocked', this._exposureUnlockHandler);

        // Check if exposures were just unlocked this quarter (show notification on first mount)
        const state = gameState.get();
        const justUnlocked = state.exposures.filter(exp => exp.unlockQuarter === state.totalQuartersPlayed);
        if (justUnlocked.length > 0) {
            setTimeout(() => this.showExposureUnlockNotification(justUnlocked), 500);
        }
    }

    unmount() {
        if (this._exposureUnlockHandler) {
            gameState.off('exposuresUnlocked', this._exposureUnlockHandler);
            this._exposureUnlockHandler = null;
        }
        if (this.isoScene) { this.isoScene.stop(); this.isoScene = null; }
        if (this.bloombergTerminal) { this.bloombergTerminal.stop(); this.bloombergTerminal = null; }
        if (this.mobileBloomberg) { this.mobileBloomberg.stop(); this.mobileBloomberg = null; }
        if (this.stressFace) { this.stressFace.stop(); this.stressFace = null; }
        if (this.priceRefreshTimer) { clearInterval(this.priceRefreshTimer); this.priceRefreshTimer = null; }
    }

    // -----------------------------------------------------------------------
    // Quarter flow
    // -----------------------------------------------------------------------

    beginQuarter() {
        this.quarterStarted = true;
        soundFX.quarterStart();

        // Hide BEGIN button once quarter started
        this.el.querySelector('#btn-begin-quarter').style.display = 'none';

        // Calculate end-of-quarter rates (from MarketEngine or random walk)
        this.calculateEndOfQuarterRates();

        // Start Bloomberg terminal for currently selected exposure (or first)
        this.startBloombergForExposure();

        // Periodically refresh trade preview and exposure rates with live pricing
        this.priceRefreshTimer = setInterval(() => {
            this.updateLivePrices();
            if (this.selectedExposure && this.hedgeLadder) {
                this.renderTradePreview();
            }
            // Burnout: stress hit 100%, end the quarter immediately
            if (gameState.get().burnedOut) {
                this.app.showToast('You have burned out! Walking off the trading floor...', 'danger');
                clearInterval(this.priceRefreshTimer);
                this.priceRefreshTimer = null;
                setTimeout(() => this.endQuarter(), 1500);
            }
        }, 500);

        this.app.showToast('Quarter started — markets are live!', 'info');
    }

    /**
     * Update displayed rates on exposure list and market view with live Bloomberg prices.
     * Called every 500ms during active quarter so prices visibly fluctuate.
     */
    updateLivePrices() {
        if (!this.quarterStarted || !this.bloombergTerminal) return;

        const livePrice = this.bloombergTerminal.getCurrentPrice();
        if (!livePrice || livePrice <= 0) return;

        const underlying = this.bloombergTerminal.underlying;
        if (!underlying) return;

        // Update the rate shown in the exposure list row for this underlying
        const expRow = this.el.querySelector(`.exposure-row[data-underlying="${underlying}"]`);
        if (expRow) {
            const state = gameState.get();
            const exp = state.exposures.find(e => e.underlying === underlying);
            if (exp) {
                const budgetRate = state.budgetRates[underlying] || 0;
                const decimals = exp.type === 'ir' ? 4 : (exp.underlying.includes('JPY') ? 2 : 4);
                const isFx = exp.type === 'fx';
                let rateClass;
                if (exp.direction === 'buy') {
                    rateClass = isFx
                        ? (livePrice >= budgetRate ? 'pnl-positive' : 'pnl-negative')
                        : (livePrice <= budgetRate ? 'pnl-positive' : 'pnl-negative');
                } else {
                    rateClass = isFx
                        ? (livePrice <= budgetRate ? 'pnl-positive' : 'pnl-negative')
                        : (livePrice >= budgetRate ? 'pnl-positive' : 'pnl-negative');
                }
                const rateSpan = expRow.querySelector('.exposure-detail + span span');
                if (rateSpan) {
                    rateSpan.className = rateClass;
                    rateSpan.textContent = formatRate(livePrice, decimals, exp.type);
                }
            }
        }

        // Update market view table if visible
        const marketTable = this.el.querySelector('#market-view table');
        if (marketTable) {
            const rows = marketTable.querySelectorAll('tbody tr');
            const state = gameState.get();
            for (const row of rows) {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 4 && cells[0].textContent.includes(underlying)) {
                    const exp = state.exposures.find(e => e.underlying === underlying);
                    if (exp) {
                        const decimals = exp.type === 'ir' ? 4 : (exp.underlying.includes('JPY') ? 2 : 4);
                        const budget = state.budgetRates[underlying] || 0;
                        const diff = budget > 0 ? (livePrice - budget) / budget : 0;
                        cells[1].textContent = formatRate(livePrice, decimals, exp.type);
                        cells[3].textContent = `${(diff * 100).toFixed(2)}%`;
                        cells[3].className = diff >= 0 ? 'pnl-positive' : 'pnl-negative';
                    }
                }
            }
        }

        // Update direction test bid/ask if shown and matching current exposure
        if (this.selectedExposure && this.selectedExposure.underlying === underlying && !this.tradeDirectionConfirmed) {
            const dirContainer = this.el.querySelector('#direction-test');
            if (dirContainer && dirContainer.style.display !== 'none') {
                const exp = this.selectedExposure;
                const spreadBps = exp.type === 'fx' ? 5 : exp.type === 'commodity' ? 10 : 3;
                const halfSpread = livePrice * (spreadBps / 10000);
                const buyBtn = dirContainer.querySelector('#btn-direction-buy');
                const sellBtn = dirContainer.querySelector('#btn-direction-sell');
                const label = exp.unit || exp.underlying;
                if (buyBtn) buyBtn.innerHTML = `BUY ${label}<br>@ ${formatRate(livePrice - halfSpread, 4, exp.type)}`;
                if (sellBtn) sellBtn.innerHTML = `SELL ${label}<br>@ ${formatRate(livePrice + halfSpread, 4, exp.type)}`;
            }
        }
    }

    calculateEndOfQuarterRates() {
        const state = gameState.get();
        const rng = gameState.getRng();

        if (marketEngine.isLoaded()) {
            // Use real historical rates
            const year = state.startYear + state.currentYearOffset;
            let nextQ = state.currentQuarter + 1;
            let nextY = year;
            if (nextQ > 4) { nextQ = 1; nextY++; }

            this.endOfQuarterRates = {};
            for (const exp of state.exposures) {
                const nextRate = marketEngine.getRate(exp.underlying, nextY, nextQ);
                if (nextRate !== null) {
                    this.endOfQuarterRates[exp.underlying] = nextRate;
                } else {
                    // Fallback: random walk
                    const current = state.currentRates[exp.underlying] || 1;
                    this.endOfQuarterRates[exp.underlying] = current * (1 + rng.floatRange(-0.05, 0.05));
                }
            }
        } else {
            // Placeholder random walk
            this.endOfQuarterRates = {};
            for (const [key, rate] of Object.entries(state.currentRates)) {
                this.endOfQuarterRates[key] = rate * (1 + rng.floatRange(-0.05, 0.05));
            }
        }
    }

    endQuarter() {
        // Stop price refresh timer and mobile Bloomberg
        if (this.priceRefreshTimer) { clearInterval(this.priceRefreshTimer); this.priceRefreshTimer = null; }
        this.hideMobileBloomberg();

        // If quarter wasn't started with BEGIN, run it silently
        if (!this.quarterStarted) {
            this.calculateEndOfQuarterRates();
        }

        if (!this.endOfQuarterRates) {
            this.calculateEndOfQuarterRates();
        }

        const state = gameState.get();
        const previousRates = { ...state.currentRates };

        // Store trading costs in state for scoring
        gameState.update({
            previousRates,
            currentRates: this.endOfQuarterRates,
            tradesThisQuarter: this.tradesThisQuarter,
            tradingCostsThisQuarter: this.tradingCostsThisQuarter
        });

        // Trigger the game loop resolution
        gameLoop.endDecisionPhase();
    }

    // -----------------------------------------------------------------------
    // Trade direction test
    // -----------------------------------------------------------------------

    showDirectionTest(exposure) {
        const container = this.el.querySelector('#direction-test');
        const state = gameState.get();
        const rate = state.currentRates[exposure.underlying] || 0;

        // Calculate bid/offer with spread
        const spreadBps = exposure.type === 'fx' ? 5 : exposure.type === 'commodity' ? 10 : 3;
        const halfSpread = rate * (spreadBps / 10000);
        const bid = rate - halfSpread;
        const ask = rate + halfSpread;

        container.style.display = 'block';
        container.innerHTML = `
            <div class="panel-inset mb-8" style="border-color:var(--gold);">
                <div class="pixel-text" style="font-size:8px;color:var(--gold);margin-bottom:6px;">TRADE DIRECTION</div>
                <div class="readable-text" style="font-size:14px;color:var(--text-secondary);margin-bottom:8px;">
                    ${exposure.description}
                </div>
                <div style="display:flex;gap:8px;justify-content:center;">
                    <button class="btn" id="btn-direction-buy" style="min-width:120px;">
                        BUY ${exposure.unit || exposure.underlying}<br>@ ${formatRate(bid, 4, exposure.type)}
                    </button>
                    <button class="btn" id="btn-direction-sell" style="min-width:120px;">
                        SELL ${exposure.unit || exposure.underlying}<br>@ ${formatRate(ask, 4, exposure.type)}
                    </button>
                </div>
            </div>
        `;

        // Buttons represent action on the UNIT currency (FX) / underlying (commodity/IR).
        // Correct hedge action matches exposure.direction: sell-unit exposure → SELL button,
        // buy-unit exposure → BUY button. The HedgingEngine maps this to pair direction
        // internally based on pair orientation.
        const correctDirection = exposure.direction;

        container.querySelector('#btn-direction-buy').addEventListener('click', () => {
            if (correctDirection === 'buy' || correctDirection === 'pay') {
                this.onDirectionCorrect(exposure);
            } else {
                this.onDirectionWrong(exposure);
            }
        });

        container.querySelector('#btn-direction-sell').addEventListener('click', () => {
            if (correctDirection === 'sell' || correctDirection === 'receive') {
                this.onDirectionCorrect(exposure);
            } else {
                this.onDirectionWrong(exposure);
            }
        });
    }

    onDirectionCorrect(exposure) {
        this.tradeDirectionConfirmed = true;
        const container = this.el.querySelector('#direction-test');
        container.innerHTML = `
            <div class="panel-inset mb-8" style="border-color:var(--pnl-positive);">
                <div class="readable-text" style="font-size:14px;color:var(--pnl-positive);text-align:center;padding:4px;">
                    ✓ Correct direction
                </div>
            </div>
        `;
        setTimeout(() => { container.style.display = 'none'; }, 1500);

        // Show product selector and controls
        this.renderProductsForExposure(exposure);
        this.el.querySelector('#product-selector').style.display = 'flex';
        this.el.querySelector('#hedge-ladder-container').style.display = 'block';
        this.el.querySelector('#trade-execution').style.display = 'block';

        this.initHedgeLadder(exposure);
        this.renderBankExecuteButtons();
    }

    onDirectionWrong(exposure) {
        this.tradeDirectionConfirmed = false;
        const container = this.el.querySelector('#direction-test');
        container.innerHTML = `
            <div class="panel-inset mb-8" style="border-color:var(--pnl-negative);">
                <div class="readable-text" style="font-size:14px;color:var(--pnl-negative);text-align:center;padding:4px;">
                    ✗ TRADING ERROR — Wrong direction!
                </div>
                <div class="readable-text" style="font-size:12px;color:var(--text-muted);text-align:center;">
                    The board has been notified.
                </div>
            </div>
        `;

        // Major board penalty
        soundFX.tradeError();
        gameState.update({ tradeDirectionErrors: (gameState.get().tradeDirectionErrors || 0) + 1 });
        gameState.adjustSatisfaction(-8);
        this.app.showToast('Trading error! Board satisfaction -8', 'danger');

        // Allow retry after a pause
        setTimeout(() => {
            this.showDirectionTest(exposure);
        }, 2000);
    }

    // -----------------------------------------------------------------------
    // Product selector — 2 products per asset class
    // -----------------------------------------------------------------------

    renderProductsForExposure(exposure) {
        let products = hedgingEngine.getProductsForAssetClass(exposure.type);
        const container = this.el.querySelector('#product-selector');

        // Filter products by policy restrictions + board-approved expansions
        const state = gameState.get();
        const policy = state.hedgingPolicy;
        if (policy && policy.requiredProducts && policy.requiredProducts.length > 0) {
            const approved = state.approvedProducts || [];
            const allowed = [...policy.requiredProducts, ...approved];
            products = products.filter(p => allowed.some(a =>
                p.type === a || p.type === 'future' && a === 'forward' || p.type === 'forward' && a === 'future'
            ));
        }

        let html = '';
        for (const product of products) {
            const selected = this.selectedProductId === product.id ? 'selected' : '';
            const costNote = product.hasUpfrontCost ? '(premium)' : '(no upfront)';
            html += `
                <div class="hedge-product-btn ${selected}" data-product-id="${product.id}">
                    <div>${product.name}</div>
                    <div style="font-size:6px;color:var(--text-muted);font-family:var(--font-pixel);">${costNote}</div>
                </div>
            `;
        }

        container.innerHTML = html;

        // Default to first product
        if (!this.selectedProductId) {
            this.selectedProductId = products[0]?.id;
            container.querySelector('.hedge-product-btn')?.classList.add('selected');
        }

        container.querySelectorAll('.hedge-product-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                container.querySelectorAll('.hedge-product-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                this.selectedProductId = btn.dataset.productId;
                this.renderTradePreview();
            });
        });
    }

    // -----------------------------------------------------------------------
    // Bank execute buttons — each bank offers a slightly different price
    // -----------------------------------------------------------------------

    getBankPricingSpread(bank) {
        // Tier 1 banks: tighter spreads (better price). Tier 2: wider.
        // Returns a multiplier applied to the contract rate.
        const rng = gameState.getRng();
        const baseBps = bank.tier === 1 ? 3 : 8; // basis points
        const jitter = rng.floatRange(-1, 2); // slight randomness
        return (baseBps + jitter) / 10000;
    }

    renderBankExecuteButtons() {
        const container = this.el.querySelector('#trade-execution');
        if (!this.selectedExposure || !this.hedgeLadder) {
            container.innerHTML = '';
            return;
        }

        const state = gameState.get();
        const exp = this.selectedExposure;
        const banks = bankEngine.getActiveBanks();
        const changes = this.hedgeLadder.getChangedBuckets().filter(c => c.deltaPct > 0);

        // Calculate total new notional
        const totalNewNotional = changes.reduce((sum, c) => sum + exp.quarterlyNotional * c.deltaPct, 0);

        if (totalNewNotional <= 0 || banks.length === 0) {
            container.innerHTML = `<div class="readable-text" style="font-size:13px;color:var(--text-muted);text-align:center;padding:8px;">Adjust coverage sliders above to hedge</div>`;
            return;
        }

        // Get base rate
        const livePrice = (this.quarterStarted && this.bloombergTerminal && this.bloombergTerminal.underlying === exp.underlying)
            ? this.bloombergTerminal.getCurrentPrice() : 0;
        const currentRate = (livePrice > 0) ? livePrice : (state.currentRates[exp.underlying] || 0);

        // Determine product type and whether it's a premium-paying product
        const productType = this.selectedProductId?.split('_').pop() || 'forward';
        const isPremiumProduct = productType === 'option' || productType === 'cap';

        // Price the product at mid
        let midRate = currentRate;
        let midPremium = 0; // for option/cap, premium per 1 unit notional
        if (this.selectedProductId) {
            if (this.selectedProductId.includes('forward') || this.selectedProductId.includes('future')) {
                const { tenor } = this.hedgeLadder.getSelection();
                midRate = exp.type === 'fx'
                    ? hedgingEngine.priceFXForward(currentRate, 0.03, 0.04, tenor)
                    : hedgingEngine.priceCommodityFuture(currentRate, 0.04, tenor);
            } else if (this.selectedProductId === 'ir_swap') {
                const { tenor } = this.hedgeLadder.getSelection();
                midRate = hedgingEngine.priceIRSwap(currentRate, tenor);
            } else if (this.selectedProductId === 'ir_cap') {
                const { tenor } = this.hedgeLadder.getSelection();
                const cap = hedgingEngine.priceIRCap(currentRate, tenor);
                midRate = cap.strike;
                midPremium = cap.premium; // fraction of notional
            } else if (productType === 'option') {
                const { tenor } = this.hedgeLadder.getSelection();
                const opt = hedgingEngine.priceOption(currentRate, null, tenor, exp.type);
                midRate = opt.strike;
                midPremium = opt.premiumPct; // fraction of notional
            }
        }

        // Check diversification requirement from policy
        const policy = state.hedgingPolicy;
        const requiresDiversification = policy && policy.rules &&
            policy.rules.some(r => r.toLowerCase().includes('diversif') || r.toLowerCase().includes('no single bank'));

        // Credit usage for credit-line check (option/cap don't consume bank lines)
        const creditUsageForCheck = isPremiumProduct
            ? 0
            : (productType === 'swap' ? totalNewNotional / 4 : totalNewNotional);

        // Build per-bank pricing
        const bankOffers = banks.map(bank => {
            const spreadBps = bank.tier === 1 ? 3 : 8;
            // For premium products, the bank "spread" inflates the premium instead of the rate.
            // Premium spread: tier1 ~3%, tier2 ~8% premium markup.
            const premiumMarkup = bank.tier === 1 ? 0.03 : 0.08;
            const spread = isPremiumProduct ? 0 : this.getBankPricingSpread(bank);
            const direction = exp.direction === 'buy' ? 1 : -1;
            const bankRate = isPremiumProduct ? midRate : midRate + (spread * direction);
            const bankPremium = isPremiumProduct ? midPremium * (1 + premiumMarkup) : 0;
            const bankPremiumCash = bankPremium * totalNewNotional;
            const avail = bankEngine.getAvailableCredit(bank.id);
            const hasCredit = creditUsageForCheck === 0 ? true : avail >= creditUsageForCheck;
            // For premium products, also check player has enough cash for the premium
            const hasCash = isPremiumProduct ? bankPremiumCash <= state.cashBalance : true;
            return { bank, bankRate, bankPremium, bankPremiumCash, spread, premiumMarkup, hasCredit, hasCash, avail };
        });

        // Find best offer (lowest premium for premium products; best rate for forwards/swaps)
        const tradableOffers = bankOffers.filter(o => o.hasCredit && o.hasCash);
        let bestRate, bestPremium;
        if (isPremiumProduct) {
            bestPremium = tradableOffers.length > 0
                ? Math.min(...tradableOffers.map(o => o.bankPremium))
                : Infinity;
            bestRate = midRate;
        } else {
            bestRate = tradableOffers.length > 0
                ? (exp.direction === 'buy'
                    ? Math.min(...tradableOffers.map(o => o.bankRate))
                    : Math.max(...tradableOffers.map(o => o.bankRate)))
                : 0;
        }

        // Summary line
        let html = `<div style="font-family:var(--font-pixel);font-size:7px;color:var(--text-secondary);margin-bottom:4px;">
            EXECUTE VIA BANK — ${formatCurrency(totalNewNotional, '', true)} notional
            ${changes.length > 1 ? ` (${changes.length} tenors)` : ''}
        </div>`;

        html += '<div style="display:flex;gap:4px;flex-wrap:wrap;">';

        for (const offer of bankOffers) {
            const tradable = offer.hasCredit && offer.hasCash;
            const isBest = tradable && (isPremiumProduct
                ? Math.abs(offer.bankPremium - bestPremium) < 1e-10
                : Math.abs(offer.bankRate - bestRate) < 1e-10);
            const borderColor = !tradable ? 'var(--pnl-negative)' : isBest ? 'var(--pnl-positive)' : 'var(--border-inner)';
            const priceColor = isBest ? 'var(--pnl-positive)' : 'var(--text-primary)';
            const disableTitle = !offer.hasCash ? 'Insufficient cash for premium' : !offer.hasCredit ? 'Insufficient credit' : '';

            // Premium products show premium $ amount, others show rate
            const priceLine = isPremiumProduct
                ? `<div class="pixel-text" style="font-size:9px;color:${priceColor};margin:2px 0;">PREM ${formatCurrency(offer.bankPremiumCash, '', true)}</div>
                   <div class="pixel-text" style="font-size:6px;color:var(--text-muted);">strike ${formatRate(offer.bankRate, 4, exp.type)}</div>`
                : `<div class="pixel-text" style="font-size:9px;color:${priceColor};margin:2px 0;">${formatRate(offer.bankRate, 4, exp.type)}</div>
                   <div class="pixel-text" style="font-size:6px;color:var(--text-muted);">${formatCurrency(offer.avail, '', true)} avail</div>`;

            html += `
                <button class="btn bank-execute-btn" data-bank-id="${offer.bank.id}"
                    style="flex:1;min-width:80px;padding:6px 4px;text-align:center;border-color:${borderColor};${!tradable ? 'opacity:0.4;' : ''}"
                    ${!tradable ? `disabled title="${disableTitle}"` : ''}>
                    <div class="pixel-text" style="font-size:8px;color:var(--cyan);">${offer.bank.shortName}</div>
                    ${priceLine}
                    ${isBest ? '<div class="pixel-text" style="font-size:6px;color:var(--pnl-positive);">BEST</div>' : ''}
                </button>
            `;
        }

        html += '</div>';

        if (requiresDiversification) {
            html += `<div class="pixel-text" style="font-size:6px;color:var(--gold);margin-top:3px;">⚠ Policy requires bank diversification</div>`;
        }

        container.innerHTML = html;

        // Store offers for execute logic
        this._bankOffers = bankOffers;
        this._bestBankRate = bestRate;
        this._bestBankPremium = bestPremium;
        this._isPremiumProduct = isPremiumProduct;
        this._requiresDiversification = requiresDiversification;

        // Wire up bank execute buttons
        container.querySelectorAll('.bank-execute-btn:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                const bankId = btn.dataset.bankId;
                this.executeHedgeViaBank(bankId);
            });
        });
    }

    // -----------------------------------------------------------------------
    // Hedge ladder
    // -----------------------------------------------------------------------

    initHedgeLadder(exposure) {
        const container = this.el.querySelector('#hedge-ladder-container');
        const state = gameState.get();
        this.hedgeLadder = new HedgeLadder(container, {
            exposure,
            maxTenor: 8,
            completedQuarters: 0,
            onChange: () => this.renderTradePreview()
        });

        // Compute existing coverage per tenor bucket from already-booked hedges
        // for this exposure. Tenor index = quarters from now until maturity.
        // Only include hedges that mature AFTER the current quarter (tenor >= 1).
        const existingByTenor = {};
        const quarterly = exposure.quarterlyNotional || 0;
        for (const h of state.hedgePortfolio || []) {
            if (h.status !== 'active') continue;
            if (h.underlying !== exposure.underlying) continue;
            const tenor = (h.maturityQuarter || 0) - state.totalQuartersPlayed;
            if (tenor < 1 || tenor > 8) continue; // skip matured/past hedges and those beyond horizon
            const ratio = quarterly > 0 ? h.notional / quarterly : 0;
            existingByTenor[tenor] = (existingByTenor[tenor] || 0) + ratio;
        }
        this.hedgeLadder.setExistingCoverage(existingByTenor);
    }

    // -----------------------------------------------------------------------
    // Trade preview & execution
    // -----------------------------------------------------------------------

    renderTradePreview() {
        // Now handled by renderBankExecuteButtons
        this.renderBankExecuteButtons();
    }

    executeHedgeViaBank(bankId) {
        if (!this.selectedExposure || !this.hedgeLadder || !this.tradeDirectionConfirmed) {
            this.app.showToast('Select an exposure and confirm direction first', 'warning');
            return;
        }

        const state = gameState.get();
        const exp = this.selectedExposure;
        const changes = this.hedgeLadder.getChangedBuckets().filter(c => c.deltaPct > 0);

        if (changes.length === 0) {
            this.app.showToast('Adjust coverage sliders to set hedging', 'warning');
            return;
        }

        // Get bank-specific rate from stored offers
        const offer = this._bankOffers?.find(o => o.bank.id === bankId);
        if (!offer) return;

        const livePrice = (this.quarterStarted && this.bloombergTerminal && this.bloombergTerminal.underlying === exp.underlying)
            ? this.bloombergTerminal.getCurrentPrice() : 0;
        const currentRate = (livePrice > 0) ? livePrice : (state.currentRates[exp.underlying] || 0);

        const productType = this.selectedProductId?.split('_').pop() || 'forward';
        const isPremiumProduct = productType === 'option' || productType === 'cap';

        // Pre-check: if this is a premium product, ensure player has enough cash
        // for the total premium across all tenors before booking anything.
        if (isPremiumProduct) {
            const expectedPremium = (offer.bankPremiumCash || 0);
            if (expectedPremium > state.cashBalance) {
                this.app.showToast(`Insufficient cash for premium (${formatCurrency(expectedPremium, '', true)} needed, ${formatCurrency(state.cashBalance, '', true)} available)`, 'error');
                return;
            }
        }

        let totalNotionalBooked = 0;
        let totalPremium = 0;
        let tradesBooked = 0;

        for (const { tenor, deltaPct } of changes) {
            const notional = exp.quarterlyNotional * deltaPct;
            if (notional <= 0) continue;

            const currentHedgeRatio = gameLoop.getHedgeRatio(exp.underlying);
            if (currentHedgeRatio + deltaPct > GAME_CONFIG.MAX_HEDGE_RATIO) {
                this.app.showToast(`Cannot exceed ${GAME_CONFIG.MAX_HEDGE_RATIO * 100}% hedge ratio`, 'warning');
                break;
            }

            let creditUsage = notional;
            if (productType === 'option' || productType === 'cap') {
                creditUsage = 0;
            } else if (productType === 'swap') {
                creditUsage = notional / 4;
            }

            if (creditUsage > 0) {
                const avail = bankEngine.getAvailableCredit(bankId);
                if (creditUsage > avail) {
                    this.app.showToast(`${offer.bank.shortName}: insufficient credit`, 'warning');
                    break;
                }
            }

            // Use the bank-specific rate (mid + bank spread)
            const hedge = hedgingEngine.createTrade({
                exposure: exp,
                productId: this.selectedProductId || 'fx_forward',
                notional,
                tenorQuarters: tenor,
                spotRate: currentRate,
                rBase: 0.03,
                rQuote: 0.04,
                currentQuarter: state.totalQuartersPlayed,
                bankId
            });

            if (hedge.premiumPaid > 0) {
                const cashNow = gameState.get().cashBalance;
                if (hedge.premiumPaid > cashNow) {
                    this.app.showToast(`Insufficient cash for premium on Q+${tenor}`, 'error');
                    break;
                }
                gameState.update({ cashBalance: cashNow - hedge.premiumPaid });
                totalPremium += hedge.premiumPaid;
            }

            const tradingCost = hedgingEngine.getTradingCost(hedge.productType, notional);
            this.tradesThisQuarter++;
            this.tradingCostsThisQuarter += tradingCost;

            if (creditUsage > 0) {
                bankEngine.allocateTrade(bankId, hedge.id, creditUsage);
            }

            gameState.addHedge(hedge);
            totalNotionalBooked += notional;
            tradesBooked++;
        }

        if (tradesBooked > 0) {
            soundFX.tradeExecute();

            // Check if player picked best price
            const pickedBest = Math.abs(offer.bankRate - this._bestBankRate) < 1e-10;
            const requiresDiv = this._requiresDiversification;

            // Satisfaction logic: penalise for not picking best price (unless diversification needed)
            if (!pickedBest && !requiresDiv) {
                // Chose a worse price with no diversification reason — board unhappy
                gameState.adjustSatisfaction(-2);
                this.app.showToast(`${offer.bank.shortName}: hedges booked but not best price — board noticed`, 'warning');
            } else if (pickedBest && requiresDiv) {
                // Picked best price but policy requires diversification — check concentration
                const bankTrades = (state.hedgePortfolio || []).filter(h => h.bankId === bankId && h.status === 'active');
                const totalActive = (state.hedgePortfolio || []).filter(h => h.status === 'active');
                const concentration = totalActive.length > 0 ? bankTrades.length / totalActive.length : 0;
                if (concentration > 0.6) {
                    gameState.adjustSatisfaction(-2);
                    this.app.showToast(`${offer.bank.shortName}: best price, but too concentrated — diversify!`, 'warning');
                } else {
                    const premNote = totalPremium > 0 ? ` (premium: ${formatCurrency(totalPremium, '', true)})` : '';
                    this.app.showToast(`${offer.bank.shortName}: ${formatCurrency(totalNotionalBooked, '', true)} booked${premNote}`, 'success');
                }
            } else {
                const premNote = totalPremium > 0 ? ` (premium: ${formatCurrency(totalPremium, '', true)})` : '';
                this.app.showToast(`${offer.bank.shortName}: ${formatCurrency(totalNotionalBooked, '', true)} booked${premNote}`, 'success');
            }

            if (this.tradesThisQuarter > 3) {
                this.app.showToast('Excessive trading! Costs are mounting.', 'warning');
            }
        }

        // Refresh
        this.renderExposures();
        this.renderPortfolio();
        this.renderBanksView();
        this.updateTradeCountBadge();
        this.selectExposure(exp.underlying);
    }

    updateQuarterBarSatisfaction() {
        const state = gameState.get();
        const el = this.el.querySelector('#qbar-satisfaction');
        if (!el) return;
        const sat = state.boardSatisfaction;
        el.textContent = `${sat}%`;
        el.style.color = sat >= 50 ? 'var(--satisfaction-high)' : sat >= 25 ? 'var(--satisfaction-mid)' : 'var(--satisfaction-low)';
    }

    updateTradeCountBadge() {
        const badge = this.el.querySelector('#trade-count-badge');
        if (badge) {
            if (this.tradesThisQuarter > 0) {
                const color = this.tradesThisQuarter > 3 ? 'var(--pnl-negative)' : 'var(--text-muted)';
                badge.style.color = color;
                badge.textContent = `TRADES: ${this.tradesThisQuarter}`;
            } else {
                badge.textContent = '';
            }
        }
    }

    // -----------------------------------------------------------------------
    // Rendering helpers
    // -----------------------------------------------------------------------

    renderQuarterPips() {
        const state = gameState.get();
        const container = this.el.querySelector('#quarter-pips');
        const total = state.maxQuarters;
        let html = '';
        for (let i = 0; i < total; i++) {
            if (i > 0 && i % 4 === 0) html += '<div class="quarter-pip-divider"></div>';
            let cls = 'future';
            if (i < state.totalQuartersPlayed) cls = 'completed';
            else if (i === state.totalQuartersPlayed) cls = 'current';
            html += `<div class="quarter-pip ${cls}"></div>`;
        }
        container.innerHTML = html;
    }

    renderExposures() {
        const state = gameState.get();
        const container = this.el.querySelector('#exposure-list');

        if (!state.exposures || state.exposures.length === 0) {
            container.innerHTML = '<div class="readable-text p-8" style="color:var(--text-muted)">No exposures</div>';
            return;
        }

        const policy = state.hedgingPolicy;
        const remainingQuarters = Math.max(1, state.maxQuarters - state.totalQuartersPlayed);
        const horizon = policy && policy.hedgeHorizon
            ? Math.min(remainingQuarters, policy.hedgeHorizon)
            : remainingQuarters;
        const baseCcy = state.industry?.baseCurrency || '';

        let html = '';
        for (const exp of state.exposures) {
            const currentRate = state.currentRates[exp.underlying] || 0;
            const budgetRate = state.budgetRates[exp.underlying] || 0;
            const hedgeRatio = gameLoop.getHedgeRatio(exp.underlying);
            const hasBudget = policy && policy.budgetRateType !== 'none' && budgetRate > 0;
            // Rate colour: green if move is favourable, red if adverse.
            // FX EUR-cross: inverted relationship (higher rate = stronger EUR = bad for sell/good for buy).
            let rateClass = '';
            if (hasBudget) {
                const isFx = exp.type === 'fx';
                if (exp.direction === 'buy') {
                    rateClass = isFx
                        ? (currentRate >= budgetRate ? 'pnl-positive' : 'pnl-negative')
                        : (currentRate <= budgetRate ? 'pnl-positive' : 'pnl-negative');
                } else {
                    rateClass = isFx
                        ? (currentRate <= budgetRate ? 'pnl-positive' : 'pnl-negative')
                        : (currentRate >= budgetRate ? 'pnl-positive' : 'pnl-negative');
                }
            }
            const decimals = exp.type === 'ir' ? 4 : (exp.underlying.includes('JPY') ? 2 : 4);

            // Calculate hedged notional within horizon
            const maxMaturity = state.totalQuartersPlayed + horizon;
            const hedgedNotional = state.hedgePortfolio
                .filter(h => h.underlying === exp.underlying && h.status === 'active' && h.maturityQuarter <= maxMaturity)
                .reduce((sum, h) => sum + h.notional, 0);

            const hrColor = hedgeRatio >= 0.5 ? 'var(--pnl-positive)' : hedgeRatio > 0.1 ? 'var(--gold)' : 'var(--text-muted)';

            html += `
                <div class="exposure-row" data-underlying="${exp.underlying}" style="cursor:pointer">
                    <div class="exposure-row-top">
                        <span class="exposure-type-badge ${exp.type}">${exp.type}</span>
                        <span class="exposure-underlying">${exp.underlying}</span>
                        <span class="exposure-detail">${exp.description}</span>
                        <span class="readable-text" style="min-width:60px;text-align:right">
                            <span class="${rateClass}">${formatRate(currentRate, decimals, exp.type)}</span>
                        </span>
                    </div>
                    <div class="exposure-row-bottom">
                        <span class="pixel-text" style="font-size:7px;color:var(--text-muted)">
                            Forecast: ${formatExposureNotional(exp)}/qtr
                        </span>
                        <span class="pixel-text" style="font-size:7px;color:var(--cyan)">
                            Hedged: ${formatCurrency(hedgedNotional, '', true)}
                        </span>
                        <span class="pixel-text" style="font-size:8px;color:${hrColor}">
                            ${formatPercent(hedgeRatio, 0)}
                        </span>
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;

        container.querySelectorAll('.exposure-row').forEach(row => {
            row.addEventListener('click', () => {
                const underlying = row.dataset.underlying;
                container.querySelectorAll('.exposure-row').forEach(r => r.style.background = '');
                row.style.background = 'rgba(68, 204, 221, 0.1)';

                // On mobile: show exposure detail modal instead of directly selecting
                if (window.innerWidth <= 768) {
                    this.showMobileExposureDetail(underlying);
                } else {
                    this.selectExposure(underlying);
                }
            });
        });

        // Refresh mobile exposure dropdown
        this.populateMobileExposureSelector();
    }

    /**
     * Mobile: full-screen exposure detail popup with hedge info and action button.
     */
    showMobileExposureDetail(underlying) {
        const state = gameState.get();
        const exp = state.exposures.find(e => e.underlying === underlying);
        if (!exp) return;

        const policy = state.hedgingPolicy;
        const remainingQuarters = Math.max(1, state.maxQuarters - state.totalQuartersPlayed);
        const horizon = policy && policy.hedgeHorizon
            ? Math.min(remainingQuarters, policy.hedgeHorizon)
            : remainingQuarters;
        const maxMaturity = state.totalQuartersPlayed + horizon;

        const currentRate = state.currentRates[exp.underlying] || 0;
        const budgetRate = state.budgetRates[exp.underlying] || 0;
        const hasBudget = policy && policy.budgetRateType !== 'none' && budgetRate > 0;
        const decimals = exp.type === 'ir' ? 4 : (exp.underlying.includes('JPY') ? 2 : 4);

        // Per-tenor breakdown
        const hedgesByTenor = {};
        for (const h of state.hedgePortfolio.filter(h => h.underlying === exp.underlying && h.status === 'active')) {
            const tenor = Math.max(1, h.maturityQuarter - state.totalQuartersPlayed);
            if (!hedgesByTenor[tenor]) hedgesByTenor[tenor] = [];
            hedgesByTenor[tenor].push(h);
        }

        let tenorHtml = '';
        for (let t = 1; t <= horizon; t++) {
            const hedges = hedgesByTenor[t] || [];
            const hedgedNotional = hedges.reduce((s, h) => s + h.notional, 0);
            const ratio = exp.quarterlyNotional > 0 ? hedgedNotional / exp.quarterlyNotional : 0;

            // Policy band for this tenor
            let bandMin = policy?.minHedgeRatio || 0;
            let bandMax = policy?.maxHedgeRatio || 1;
            if (policy?.tenorBands) {
                const band = policy.tenorBands.find(b => b.tenor === t);
                if (band) { bandMin = band.min; bandMax = band.max; }
            }
            const inRange = ratio >= bandMin && ratio <= bandMax;
            const color = inRange ? 'var(--pnl-positive)' : ratio === 0 ? 'var(--text-muted)' : 'var(--pnl-negative)';

            tenorHtml += `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border-inner);">
                    <span class="pixel-text" style="font-size:8px;color:var(--text-secondary);">Q+${t}</span>
                    <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">${formatPercent(bandMin, 0)}-${formatPercent(bandMax, 0)}</span>
                    <span class="pixel-text" style="font-size:8px;color:${color};">${formatPercent(ratio, 0)}</span>
                    <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">${formatCurrency(hedgedNotional, '', true)}</span>
                    <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">${hedges.length} trade${hedges.length !== 1 ? 's' : ''}</span>
                </div>
            `;
        }

        const totalHedged = state.hedgePortfolio
            .filter(h => h.underlying === exp.underlying && h.status === 'active' && h.maturityQuarter <= maxMaturity)
            .reduce((s, h) => s + h.notional, 0);
        const hedgeRatio = gameLoop.getHedgeRatio(exp.underlying);
        const hrColor = hedgeRatio >= 0.5 ? 'var(--pnl-positive)' : hedgeRatio > 0.1 ? 'var(--gold)' : 'var(--text-muted)';

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'align-items:stretch;';
        overlay.innerHTML = `
            <div class="exposure-detail-modal">
                <div class="modal-header">
                    <span>${exp.underlying} — ${exp.type.toUpperCase()}</span>
                    <button class="modal-close" id="close-exp-detail">X</button>
                </div>
                <div class="modal-body" style="overflow-y:auto;">
                    <div class="readable-text" style="font-size:15px;color:var(--text-primary);margin-bottom:8px;">
                        ${exp.description}
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                        <span class="pixel-text" style="font-size:8px;color:var(--text-muted);">DIRECTION</span>
                        <span class="pixel-text" style="font-size:9px;color:var(--gold);">${exp.direction.toUpperCase()}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                        <span class="pixel-text" style="font-size:8px;color:var(--text-muted);">FORECAST</span>
                        <span class="pixel-text" style="font-size:9px;color:var(--text-primary);">${formatExposureNotional(exp)}/qtr</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                        <span class="pixel-text" style="font-size:8px;color:var(--text-muted);">CURRENT RATE</span>
                        <span class="pixel-text" style="font-size:9px;color:var(--text-primary);">${formatRate(currentRate, decimals, exp.type)}</span>
                    </div>
                    ${hasBudget ? `
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                        <span class="pixel-text" style="font-size:8px;color:var(--text-muted);">BUDGET RATE</span>
                        <span class="pixel-text" style="font-size:9px;color:var(--text-secondary);">${formatRate(budgetRate, decimals, exp.type)}</span>
                    </div>
                    ` : ''}
                    <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                        <span class="pixel-text" style="font-size:8px;color:var(--text-muted);">TOTAL HEDGED</span>
                        <span class="pixel-text" style="font-size:9px;color:var(--cyan);">${formatCurrency(totalHedged, '', true)}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
                        <span class="pixel-text" style="font-size:8px;color:var(--text-muted);">HEDGE RATIO</span>
                        <span class="pixel-text" style="font-size:10px;color:${hrColor};">${formatPercent(hedgeRatio, 0)}</span>
                    </div>

                    <div class="pixel-text" style="font-size:8px;color:var(--gold);margin-bottom:4px;">COVERAGE BY TENOR (${horizon}Q HORIZON)</div>
                    <div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid var(--border-outer);">
                        <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">TENOR</span>
                        <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">REQUIRED</span>
                        <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">ACTUAL</span>
                        <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">NOTIONAL</span>
                        <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">TRADES</span>
                    </div>
                    ${tenorHtml}
                </div>
                <div style="padding:8px;border-top:1px solid var(--border);display:flex;gap:8px;">
                    <button class="btn" id="btn-exp-hedge" style="flex:1;">HEDGE THIS EXPOSURE</button>
                    <button class="btn" id="btn-exp-close" style="flex:1;">CLOSE</button>
                </div>
            </div>
        `;

        const viewport = document.getElementById('game-viewport');
        viewport.appendChild(overlay);

        overlay.querySelector('#close-exp-detail').addEventListener('click', () => overlay.remove());
        overlay.querySelector('#btn-exp-close').addEventListener('click', () => overlay.remove());
        overlay.querySelector('#btn-exp-hedge').addEventListener('click', () => {
            overlay.remove();
            // Select this exposure in the hedging panel, then switch to HEDGING tab
            this.selectExposure(underlying);
            const hedgingTab = this.el.querySelector('.tab[data-tab="hedging"]');
            if (hedgingTab) hedgingTab.click();
        });
    }

    populateMobileExposureSelector() {
        const select = this.el.querySelector('#mobile-exposure-select');
        if (!select) return;
        const state = gameState.get();
        select.innerHTML = '<option value="">— Select exposure —</option>';
        for (const exp of state.exposures) {
            const hedgeRatio = gameLoop.getHedgeRatio(exp.underlying);
            const label = `${exp.underlying} (${exp.type.toUpperCase()}) — ${formatPercent(hedgeRatio, 0)} hedged`;
            select.innerHTML += `<option value="${exp.underlying}">${label}</option>`;
        }
        // Sync with current selection
        if (this.selectedExposure) {
            select.value = this.selectedExposure.underlying;
        }
    }

    selectExposure(underlying) {
        const state = gameState.get();
        this.selectedExposure = state.exposures.find(e => e.underlying === underlying);
        if (!this.selectedExposure) return;

        // Sync mobile dropdown
        const mobileSelect = this.el.querySelector('#mobile-exposure-select');
        if (mobileSelect) mobileSelect.value = underlying;

        const exp = this.selectedExposure;
        const currentRate = state.currentRates[exp.underlying] || 0;
        const hedgeRatio = gameLoop.getHedgeRatio(exp.underlying);

        // Reset trade flow state
        this.tradeDirectionConfirmed = false;
        this.selectedProductId = null;

        // Hide downstream controls
        this.el.querySelector('#product-selector').style.display = 'none';
        this.el.querySelector('#hedge-ladder-container').style.display = 'none';
        this.el.querySelector('#trade-execution').style.display = 'none';

        // Calculate total exposure and total hedged within policy horizon
        const policy = state.hedgingPolicy;
        const remainingQuarters = Math.max(1, state.maxQuarters - state.totalQuartersPlayed);
        const horizon = policy && policy.hedgeHorizon
            ? Math.min(remainingQuarters, policy.hedgeHorizon)
            : remainingQuarters;
        const totalExposure = exp.quarterlyNotional * horizon;
        const maxMaturity = state.totalQuartersPlayed + horizon;
        const totalHedged = state.hedgePortfolio
            .filter(h => h.underlying === exp.underlying && h.status === 'active' && h.maturityQuarter <= maxMaturity)
            .reduce((sum, h) => sum + h.notional, 0);
        const totalUnhedged = Math.max(0, totalExposure - totalHedged);

        // Hedge ratio color
        const hrColor = hedgeRatio >= 1.0 ? 'var(--pnl-negative)' : hedgeRatio >= 0.5 ? 'var(--pnl-positive)' : hedgeRatio > 0 ? 'var(--gold)' : 'var(--text-muted)';

        // Show exposure info
        const infoContainer = this.el.querySelector('#selected-exposure-info');
        infoContainer.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <span class="exposure-type-badge ${exp.type}">${exp.type}</span>
                    <span class="pixel-text" style="font-size:10px;color:var(--gold)">${exp.underlying}</span>
                </div>
                <div class="readable-text" style="font-size:14px;color:var(--text-muted)">${exp.direction.toUpperCase()}</div>
            </div>
            <div class="readable-text" style="font-size:15px;margin-top:4px;">${exp.description}</div>
            <div style="display:flex;justify-content:space-between;margin-top:6px;">
                <span class="readable-text" style="font-size:14px;color:var(--text-muted)">Forecast: ${formatExposureNotional(exp)}/qtr</span>
                <span class="readable-text" style="font-size:14px;color:var(--text-muted)">${horizon}Q horizon</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:4px;">
                <span class="readable-text" style="font-size:14px;color:var(--text-secondary)">Total exposure: ${formatExposureNotional(exp, totalExposure)}</span>
                <span class="readable-text" style="font-size:14px;color:var(--cyan)">Hedged: ${formatCurrency(totalHedged, '', true)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:4px;align-items:center;">
                <span class="readable-text" style="font-size:14px;color:var(--text-muted)">Unhedged: ${formatCurrency(totalUnhedged, '', true)}</span>
                <span class="pixel-text" style="font-size:9px;color:${hrColor}">OVERALL: ${formatPercent(hedgeRatio, 0)} HEDGED</span>
            </div>
        `;

        // Show direction test
        this.showDirectionTest(exp);

        // Update Bloomberg terminal for this exposure (if quarter started)
        if (this.quarterStarted && this.endOfQuarterRates) {
            this.startBloombergForExposure(exp);
        }
    }

    renderMarketView() {
        const state = gameState.get();
        const container = this.el.querySelector('#market-view');

        let html = '<table class="data-table"><thead><tr><th>UNDERLYING</th><th>RATE</th><th>BUDGET</th><th>VS BUDGET</th></tr></thead><tbody>';
        for (const exp of state.exposures) {
            const current = state.currentRates[exp.underlying] || 0;
            const budget = state.budgetRates[exp.underlying] || 0;
            const diff = budget > 0 ? (current - budget) / budget : 0;
            const decimals = exp.type === 'ir' ? 4 : (exp.underlying.includes('JPY') ? 2 : 4);
            html += `<tr>
                <td><span class="exposure-type-badge ${exp.type}" style="margin-right:4px">${exp.type}</span>${exp.underlying}</td>
                <td>${formatRate(current, decimals, exp.type)}</td>
                <td style="color:var(--text-muted)">${formatRate(budget, decimals, exp.type)}</td>
                <td class="${diff >= 0 ? 'pnl-positive' : 'pnl-negative'}">${(diff * 100).toFixed(2)}%</td>
            </tr>`;
        }
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    renderPortfolio() {
        const state = gameState.get();
        const container = this.el.querySelector('#portfolio-view');
        const activeHedges = (state.hedgePortfolio || []).filter(h => h.status === 'active');

        if (activeHedges.length === 0) {
            container.innerHTML = '<div class="readable-text p-8" style="color:var(--text-muted);text-align:center">No active hedges</div>';
            return;
        }

        // Group hedges by expiry quarter
        const byQuarter = {};
        for (const hedge of activeHedges) {
            const qRel = Math.max(0, hedge.maturityQuarter - state.totalQuartersPlayed);
            if (!byQuarter[qRel]) byQuarter[qRel] = [];
            byQuarter[qRel].push(hedge);
        }
        const sortedQuarters = Object.keys(byQuarter).map(Number).sort((a, b) => a - b);

        let totalMtm = 0;
        let html = '';

        for (const q of sortedQuarters) {
            const hedges = byQuarter[q];
            html += `<div class="pixel-text" style="font-size:7px;color:var(--gold);margin:6px 0 2px;border-bottom:1px solid var(--border-inner);padding-bottom:2px;">Q+${q} EXPIRY</div>`;
            html += '<table class="data-table" style="margin-bottom:4px;"><thead><tr><th>TYPE</th><th>UNDERLYING</th><th>NOTIONAL</th><th>RATE</th><th>MTM</th><th>BANK</th></tr></thead><tbody>';
            for (const hedge of hedges) {
                const mtm = hedge.currentMtm || 0;
                totalMtm += mtm;
                const bank = bankEngine.getActiveBanks().find(b => b.id === hedge.bankId);
                html += `<tr>
                    <td><span class="badge badge-${hedge.assetClass || 'fx'}">${hedge.productType}</span></td>
                    <td>${hedge.underlying}</td>
                    <td>${formatCurrency(hedge.notional, '', true)}</td>
                    <td>${formatRate(hedge.contractRate, 4, hedge.assetClass)}</td>
                    <td class="${pnlClass(mtm)}">${formatPnL(mtm, state.industry?.baseCurrency)}</td>
                    <td style="color:var(--text-muted);font-size:12px;">${bank?.shortName || '—'}</td>
                </tr>`;
            }
            html += '</tbody></table>';
        }

        // Total summary
        html += `<div style="text-align:right;padding:4px;border-top:1px solid var(--border);">
            <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">TOTAL HEDGES: ${activeHedges.length}</span>
            <span class="pixel-text ${pnlClass(totalMtm)}" style="font-size:8px;margin-left:8px;">MTM: ${formatPnL(totalMtm, state.industry?.baseCurrency)}</span>
        </div>`;

        container.innerHTML = html;
    }

    renderBanksView() {
        const container = this.el.querySelector('#banks-view');
        const summary = bankEngine.getSummary();
        const divScore = bankEngine.getDiversificationScore();

        if (summary.length === 0) {
            container.innerHTML = '<div class="readable-text p-8" style="color:var(--text-muted);text-align:center">No bank counterparties</div>';
            return;
        }

        let html = `
            <div style="display:flex;justify-content:space-between;padding:4px 8px;">
                <span class="pixel-text" style="font-size:8px;color:var(--text-secondary)">COUNTERPARTIES</span>
                <span class="pixel-text" style="font-size:8px;color:${divScore > 0.5 ? 'var(--pnl-positive)' : 'var(--gold)'}">DIVERSIFICATION: ${Math.round(divScore * 100)}%</span>
            </div>
        `;

        for (const bank of summary) {
            const utilPct = Math.round(bank.utilization * 100);
            const barColor = utilPct > 80 ? 'var(--pnl-negative)' : utilPct > 50 ? 'var(--gold)' : 'var(--pnl-positive)';
            html += `
                <div style="display:flex;align-items:center;gap:8px;padding:4px 8px;">
                    <span class="readable-text" style="font-size:14px;min-width:40px;">${bank.shortName}</span>
                    <div style="flex:1;height:10px;background:var(--bg-input);border:1px solid var(--border-inner);border-radius:2px;overflow:hidden;">
                        <div style="height:100%;width:${utilPct}%;background:${barColor};transition:width 0.2s;"></div>
                    </div>
                    <span class="readable-text" style="font-size:12px;color:var(--text-muted);min-width:80px;text-align:right;">
                        ${formatCurrency(bank.usedLimit, '', true)} / ${formatCurrency(bank.creditLimit, '', true)}
                    </span>
                    <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">${bank.tradeCount} trades</span>
                </div>
            `;
        }

        // Request-from-board actions (gated by board approval)
        const state = gameState.get();
        const nextCost = 3 + Math.min(5, bankEngine.limitRequests);
        const bankGate = bankEngine.canRequest('new_bank', state);
        const limitGate = bankEngine.canRequest('increase_limit', state);
        const bankAttrs = bankGate.allowed
            ? `title="Ask board to onboard a new counterparty (~${nextCost} satisfaction)"`
            : `disabled title="${bankGate.detail}" style="flex:1;font-size:10px;padding:4px 6px;min-height:28px;opacity:0.5;cursor:not-allowed;"`;
        const limitAttrs = limitGate.allowed
            ? `title="Ask board to raise credit limits 25% (~${nextCost} satisfaction)"`
            : `disabled title="${limitGate.detail}" style="flex:1;font-size:10px;padding:4px 6px;min-height:28px;opacity:0.5;cursor:not-allowed;"`;
        html += `
            <div style="display:flex;gap:6px;padding:6px 8px;border-top:1px solid var(--border-inner);margin-top:4px;">
                <button class="btn" id="btn-request-bank" ${bankGate.allowed ? 'style="flex:1;font-size:10px;padding:4px 6px;min-height:28px;"' : ''} ${bankAttrs}>+ BANK</button>
                <button class="btn" id="btn-request-limit" ${limitGate.allowed ? 'style="flex:1;font-size:10px;padding:4px 6px;min-height:28px;"' : ''} ${limitAttrs}>+ LIMIT</button>
            </div>
        `;
        if (!bankGate.allowed || !limitGate.allowed) {
            const reasonText = !bankGate.allowed ? bankGate.detail : limitGate.detail;
            html += `<div class="pixel-text" style="font-size:7px;color:var(--pnl-negative);text-align:center;padding:0 8px 2px;">${reasonText}</div>`;
        }
        html += `<div class="pixel-text" style="font-size:7px;color:var(--text-muted);text-align:center;padding:0 8px 4px;">Costs ~${nextCost} board satisfaction</div>`;

        container.innerHTML = html;

        const btnBank = container.querySelector('#btn-request-bank');
        const btnLimit = container.querySelector('#btn-request-limit');
        if (btnBank && bankGate.allowed) btnBank.addEventListener('click', () => this.handleBankRequest('new_bank'));
        if (btnLimit && limitGate.allowed) btnLimit.addEventListener('click', () => this.handleBankRequest('increase_limit'));
    }

    handleBankRequest(type) {
        const rng = gameState.getRng();
        const state = gameState.get();
        const result = bankEngine.requestFromBoard(type, rng, state);
        if (result.success) {
            gameState.adjustSatisfaction(-result.satisfactionCost);
            this.app.showToast(result.message, 'success');
            soundFX?.click?.();
        } else {
            this.app.showToast(result.message, 'error');
        }
        this.updateQuarterBarSatisfaction();
        this.renderBanksView();
        this.renderBankExecuteButtons();
    }

    showExposureUnlockNotification(newExposures) {
        if (!newExposures || newExposures.length === 0) return;

        const state = gameState.get();

        // Determine sender and message based on exposure types
        const expSummary = newExposures.map(exp => {
            const typeLabel = exp.type === 'fx' ? 'FX' : exp.type === 'ir' ? 'Interest Rate' : 'Commodity';
            return `<strong>${exp.underlying}</strong> — ${exp.description} (${typeLabel}, ${formatExposureNotional(exp)}/qtr)`;
        }).join('<br>');

        // Determine sender based on exposure types
        const hasRevenue = newExposures.some(e => e.direction === 'sell');
        const hasCost = newExposures.some(e => e.direction === 'buy' || e.direction === 'pay');
        const hasIR = newExposures.some(e => e.type === 'ir');

        let from = 'Operations Team';
        let category = 'operations';
        if (hasIR) {
            from = 'CFO — Finance';
            category = 'finance';
        } else if (hasRevenue && !hasCost) {
            from = 'Commercial Team';
            category = 'commercial';
        } else if (hasCost && !hasRevenue) {
            from = 'Procurement';
            category = 'procurement';
        }

        const title = newExposures.length === 1
            ? `New Exposure: ${newExposures[0].underlying}`
            : `${newExposures.length} New Exposures Added`;

        let bodyText = '';
        if (hasIR) {
            bodyText = `The revolving credit facility is now active. You will need to manage the floating rate exposure on the company's debt.<br><br>${expSummary}`;
        } else if (hasRevenue) {
            bodyText = `New revenue streams have come online. These exposures now require hedging attention.<br><br>${expSummary}`;
        } else {
            bodyText = `New procurement contracts have been finalised. The following exposures are now active and require hedging coverage.<br><br>${expSummary}`;
        }

        bodyText += `<br><br><em>Please review and adjust your hedging programme accordingly.</em>`;

        const popupHtml = EraPopup.wrap({
            title,
            from,
            body: bodyText,
            category
        });

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="width:95vw;max-width:520px;">
                ${popupHtml}
                <div style="text-align:center;padding:8px;">
                    <button class="btn btn-gold" id="btn-dismiss-unlock">ACKNOWLEDGED</button>
                </div>
            </div>
        `;

        const viewport = document.getElementById('game-viewport');
        viewport.appendChild(overlay);

        overlay.querySelector('#btn-dismiss-unlock').addEventListener('click', () => {
            overlay.remove();
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }

    renderBoardRequests() {
        const container = this.el.querySelector('#board-requests-view');
        if (!container) return;

        const state = gameState.get();
        const policy = state.hedgingPolicy;
        let html = '';

        // --- TMS Modules ---
        const tms = tmsEngine.getStatus();
        const progressPct = Math.round((tms.moduleCount / tms.maxModules) * 100);
        const variancePct = Math.round(tms.varianceReduction * 100);

        html += `
            <div style="padding:8px;border-bottom:1px solid var(--border-inner);">
                <div class="pixel-text" style="font-size:8px;color:var(--gold);margin-bottom:6px;">TREASURY MANAGEMENT SYSTEM</div>
                <div class="readable-text" style="font-size:13px;color:var(--text-secondary);margin-bottom:6px;">
                    Improve forecast accuracy by investing in TMS modules. Each module reduces forecast variance by 5%.
                </div>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span class="pixel-text" style="font-size:7px;color:var(--text-muted);min-width:50px;">MODULES</span>
                    <div style="flex:1;height:12px;background:var(--bg-input);border:1px solid var(--border-inner);border-radius:2px;overflow:hidden;">
                        <div style="height:100%;width:${progressPct}%;background:var(--cyan);transition:width 0.3s;"></div>
                    </div>
                    <span class="pixel-text" style="font-size:8px;color:var(--cyan);min-width:30px;text-align:right;">${tms.moduleCount}/${tms.maxModules}</span>
                </div>
                <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                    <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">VARIANCE REDUCTION: ${variancePct}%</span>
                    <span class="pixel-text" style="font-size:7px;color:var(--text-muted);">TOTAL SPENT: ${formatCurrency(tms.totalCost, '', true)}</span>
                </div>
                <button class="btn" id="btn-buy-tms" style="width:100%;font-size:10px;padding:6px;" ${!tms.canBuy ? 'disabled style="width:100%;font-size:10px;padding:6px;opacity:0.4;cursor:not-allowed;"' : ''}>
                    INSTALL MODULE — ${formatCurrency(tms.moduleCost, '', true)}
                </button>
                ${!tms.canBuy && tms.moduleCount >= tms.maxModules ? '<div class="pixel-text" style="font-size:7px;color:var(--pnl-positive);text-align:center;margin-top:3px;">All modules installed</div>' : ''}
                ${!tms.canBuy && tms.moduleCount < tms.maxModules ? '<div class="pixel-text" style="font-size:7px;color:var(--pnl-negative);text-align:center;margin-top:3px;">Insufficient cash</div>' : ''}
            </div>
        `;

        // --- Bank Counterparty Onboarding ---
        const bankGate = bankEngine.canRequest('new_bank', state);
        const nextCost = 3 + Math.min(5, bankEngine.limitRequests);

        html += `
            <div style="padding:8px;border-bottom:1px solid var(--border-inner);">
                <div class="pixel-text" style="font-size:8px;color:var(--gold);margin-bottom:6px;">ADD BANK COUNTERPARTY</div>
                <div class="readable-text" style="font-size:13px;color:var(--text-secondary);margin-bottom:6px;">
                    Request board approval to onboard a new bank. More banks = better pricing & diversification.
                </div>
                <div class="readable-text" style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">
                    Current banks: ${bankEngine.getActiveBanks().length} | Satisfaction cost: ~${nextCost}
                </div>
                <button class="btn" id="btn-req-bank" style="width:100%;font-size:10px;padding:6px;" ${!bankGate.allowed ? 'disabled style="width:100%;font-size:10px;padding:6px;opacity:0.4;cursor:not-allowed;"' : ''}>
                    REQUEST ONBOARDING
                </button>
                ${!bankGate.allowed ? `<div class="pixel-text" style="font-size:7px;color:var(--pnl-negative);text-align:center;margin-top:3px;">${bankGate.detail}</div>` : ''}
            </div>
        `;

        // --- Increase Bank Limits ---
        const limitGate = bankEngine.canRequest('increase_limit', state);
        const bankSummary = bankEngine.getSummary();
        const avgUtil = bankSummary.length > 0
            ? Math.round(bankSummary.reduce((s, b) => s + b.utilization, 0) / bankSummary.length * 100)
            : 0;

        html += `
            <div style="padding:8px;border-bottom:1px solid var(--border-inner);">
                <div class="pixel-text" style="font-size:8px;color:var(--gold);margin-bottom:6px;">INCREASE BANK LIMITS</div>
                <div class="readable-text" style="font-size:13px;color:var(--text-secondary);margin-bottom:6px;">
                    Request the board to increase credit limits across all counterparties by 25%.
                </div>
                <div class="readable-text" style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">
                    Avg utilisation: ${avgUtil}% | Satisfaction cost: ~${nextCost}
                </div>
                <button class="btn" id="btn-req-limit" style="width:100%;font-size:10px;padding:6px;" ${!limitGate.allowed ? 'disabled style="width:100%;font-size:10px;padding:6px;opacity:0.4;cursor:not-allowed;"' : ''}>
                    REQUEST LIMIT INCREASE
                </button>
                ${!limitGate.allowed ? `<div class="pixel-text" style="font-size:7px;color:var(--pnl-negative);text-align:center;margin-top:3px;">${limitGate.detail}</div>` : ''}
            </div>
        `;

        // --- Product Expansion (only when policy allows) ---
        if (policy && policy.productExpansionAllowed) {
            const approvedProducts = state.approvedProducts || [];
            const allProductTypes = ['option', 'swap', 'cap'];
            const requiredProducts = policy.requiredProducts || [];
            // Products that could be requested (not already required or approved)
            const requestable = allProductTypes.filter(p =>
                !requiredProducts.includes(p) &&
                !requiredProducts.includes(p === 'cap' ? 'cap' : p) &&
                !approvedProducts.includes(p)
            );
            // Also handle forward/future equivalences
            const alreadyAvailable = [...requiredProducts, ...approvedProducts];

            html += `
                <div style="padding:8px;">
                    <div class="pixel-text" style="font-size:8px;color:var(--gold);margin-bottom:6px;">REQUEST PRODUCT EXPANSION</div>
                    <div class="readable-text" style="font-size:13px;color:var(--text-secondary);margin-bottom:6px;">
                        Your policy restricts product use. Request board approval for additional instruments.
                    </div>
            `;

            if (approvedProducts.length > 0) {
                html += `<div class="pixel-text" style="font-size:7px;color:var(--pnl-positive);margin-bottom:4px;">APPROVED: ${approvedProducts.join(', ').toUpperCase()}</div>`;
            }

            if (requestable.length > 0) {
                for (const prod of requestable) {
                    const prodName = prod === 'option' ? 'Options' : prod === 'swap' ? 'Swaps' : 'IR Caps';
                    html += `
                        <button class="btn btn-product-request" data-product="${prod}" style="width:100%;font-size:10px;padding:5px;margin-bottom:4px;">
                            REQUEST ${prodName.toUpperCase()}
                        </button>
                    `;
                }
            } else {
                html += `<div class="pixel-text" style="font-size:7px;color:var(--text-muted);text-align:center;">All available products approved</div>`;
            }

            html += `</div>`;
        }

        container.innerHTML = html;

        // --- Wire up TMS button ---
        const btnTms = container.querySelector('#btn-buy-tms');
        if (btnTms && tms.canBuy) {
            btnTms.addEventListener('click', () => {
                const result = tmsEngine.purchase();
                if (result.success) {
                    const msg = result.boardReaction === 'positive'
                        ? `TMS module ${result.moduleCount} installed — board impressed!`
                        : result.boardReaction === 'negative'
                        ? `TMS module ${result.moduleCount} installed — board concerned about spending`
                        : `TMS module ${result.moduleCount} installed`;
                    const type = result.boardReaction === 'negative' ? 'warning' : 'success';
                    this.app.showToast(msg, type);
                    soundFX?.click?.();
                    if (result.boardReaction === 'negative') {
                        gameState.adjustSatisfaction(-3);
                    }
                } else {
                    this.app.showToast(result.boardReaction, 'error');
                }
                this.updateQuarterBarSatisfaction();
                this.renderBoardRequests();
            });
        }

        // --- Wire up bank request buttons ---
        const btnReqBank = container.querySelector('#btn-req-bank');
        if (btnReqBank && bankGate.allowed) {
            btnReqBank.addEventListener('click', () => {
                this.handleBankRequest('new_bank');
                this.renderBoardRequests();
            });
        }
        const btnReqLimit = container.querySelector('#btn-req-limit');
        if (btnReqLimit && limitGate.allowed) {
            btnReqLimit.addEventListener('click', () => {
                this.handleBankRequest('increase_limit');
                this.renderBoardRequests();
            });
        }

        // --- Wire up product expansion buttons ---
        container.querySelectorAll('.btn-product-request').forEach(btn => {
            btn.addEventListener('click', () => {
                const product = btn.dataset.product;
                this.handleProductExpansionRequest(product);
            });
        });
    }

    handleProductExpansionRequest(product) {
        const state = gameState.get();
        const satisfaction = state.boardSatisfaction || 0;

        // Board approval depends on satisfaction level
        if (satisfaction < 40) {
            this.app.showToast('Board satisfaction too low to approve new products (need ≥40)', 'error');
            return;
        }

        const prodName = product === 'option' ? 'Options' : product === 'swap' ? 'Swaps' : 'IR Caps';
        const approved = [...(state.approvedProducts || []), product];
        gameState.update({ approvedProducts: approved });
        gameState.adjustSatisfaction(-5);
        soundFX?.click?.();
        this.app.showToast(`${prodName} approved by the board! (-5 satisfaction)`, 'success');
        this.updateQuarterBarSatisfaction();
        this.renderBoardRequests();
    }

    renderPolicy() {
        const state = gameState.get();
        const policy = state.hedgingPolicy;
        if (policy) {
            this.el.querySelector('#policy-name').textContent = policy.name;
            const badge = this.el.querySelector('#policy-badge');
            badge.textContent = `${formatPercent(policy.minHedgeRatio, 0)}-${formatPercent(policy.maxHedgeRatio, 0)}`;
            badge.title = policy.detail || policy.description;
            badge.style.cursor = 'pointer';

            // Click badge to show full policy detail
            badge.addEventListener('click', () => this.showPolicyDetail());

            // Populate policy strip
            const strip = this.el.querySelector('#policy-strip');
            if (strip) {
                const horizonLabel = `${policy.hedgeHorizon * 3}mo`;
                const products = policy.requiredProducts?.length > 0
                    ? policy.requiredProducts.join(', ')
                    : 'any';
                const budgetLabel = policy.budgetRateType === 'none' ? 'no budget'
                    : policy.budgetRateType === 'fixed' ? 'fixed budget'
                    : policy.budgetRateType === 'quarterly' ? 'quarterly budget'
                    : policy.budgetRateType === 'annual' ? 'annual budget'
                    : policy.budgetRateType;

                strip.innerHTML = `
                    <span class="policy-strip-name">${policy.name}</span>
                    <span class="policy-strip-details">
                        ${formatPercent(policy.minHedgeRatio, 0)}-${formatPercent(policy.maxHedgeRatio, 0)}
                        · ${horizonLabel}
                        · ${products}
                        · ${budgetLabel}
                    </span>
                    <span class="policy-strip-tap">TAP FOR DETAIL</span>
                `;
                strip.style.cursor = 'pointer';
                strip.addEventListener('click', () => this.showPolicyDetail());
            }
        }

        // Also add click handler to the policy label text
        const policyLabel = this.el.querySelector('#policy-name');
        if (policyLabel) {
            policyLabel.style.cursor = 'pointer';
            policyLabel.addEventListener('click', () => this.showPolicyDetail());
        }
    }

    showPolicyDetail() {
        const state = gameState.get();
        const policy = state.hedgingPolicy;
        if (!policy) return;

        const rulesHtml = (policy.rules && policy.rules.length > 0)
            ? policy.rules.map(r => `<li style="margin-bottom:4px;">${r}</li>`).join('')
            : '<li>No specific rules — full discretion</li>';

        // Build per-tenor compliance table if policy has tenor bands
        let tenorHtml = '';
        if (policy.tenorBands && policy.tenorBands.length > 0) {
            tenorHtml += `<div class="pixel-text" style="font-size:8px;color:var(--text-secondary);margin:12px 0 4px;">TENOR COMPLIANCE</div>`;
            tenorHtml += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
            tenorHtml += '<tr style="border-bottom:1px solid var(--border-inner);"><th class="pixel-text" style="font-size:7px;text-align:left;padding:3px;color:var(--text-muted);">TENOR</th><th class="pixel-text" style="font-size:7px;text-align:center;padding:3px;color:var(--text-muted);">REQUIRED</th>';
            // One column per exposure
            for (const exp of state.exposures) {
                tenorHtml += `<th class="pixel-text" style="font-size:7px;text-align:center;padding:3px;color:var(--text-muted);">${exp.underlying}</th>`;
            }
            tenorHtml += '</tr>';

            for (const band of policy.tenorBands) {
                tenorHtml += `<tr style="border-bottom:1px solid var(--border-inner);">`;
                tenorHtml += `<td class="pixel-text" style="font-size:7px;padding:3px;color:var(--text-secondary);">Q+${band.tenor}</td>`;
                tenorHtml += `<td class="pixel-text" style="font-size:7px;text-align:center;padding:3px;color:var(--cyan);">${formatPercent(band.min, 0)}-${formatPercent(band.max, 0)}</td>`;

                for (const exp of state.exposures) {
                    const ratio = gameLoop.getHedgeRatioAtTenor(exp.underlying, band.tenor);
                    const inRange = ratio >= band.min && ratio <= band.max;
                    const color = inRange ? 'var(--pnl-positive)' : ratio === 0 ? 'var(--pnl-negative)' : 'var(--gold)';
                    tenorHtml += `<td class="pixel-text" style="font-size:7px;text-align:center;padding:3px;color:${color};">${formatPercent(ratio, 0)}</td>`;
                }
                tenorHtml += '</tr>';
            }
            tenorHtml += '</table>';
        } else {
            // Flat policy — show overall compliance per exposure
            tenorHtml += `<div class="pixel-text" style="font-size:8px;color:var(--text-secondary);margin:12px 0 4px;">COMPLIANCE STATUS</div>`;
            for (const exp of state.exposures) {
                const ratio = gameLoop.getHedgeRatio(exp.underlying);
                const inRange = ratio >= policy.minHedgeRatio && ratio <= policy.maxHedgeRatio;
                const color = inRange ? 'var(--pnl-positive)' : 'var(--pnl-negative)';
                const icon = inRange ? '●' : '○';
                tenorHtml += `<div style="display:flex;justify-content:space-between;padding:2px 0;">
                    <span class="pixel-text" style="font-size:7px;color:var(--text-secondary);">${icon} ${exp.underlying}</span>
                    <span class="pixel-text" style="font-size:7px;color:${color};">${formatPercent(ratio, 0)}</span>
                </div>`;
            }
        }

        // Budget rate type info
        const budgetLabel = policy.budgetRateType === 'none' ? 'No budget rate (MTM only)'
            : policy.budgetRateType === 'fixed' ? 'Fixed at game start'
            : policy.budgetRateType === 'quarterly' ? 'Resets each quarter'
            : policy.budgetRateType === 'annual' ? 'Resets annually (Q1)'
            : policy.budgetRateType;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal" style="width:95vw;max-width:540px;">
                <div class="modal-header">
                    HEDGING POLICY
                    <button class="modal-close" id="close-policy">X</button>
                </div>
                <div class="modal-body">
                    <div class="pixel-text" style="font-size:10px;color:var(--gold);margin-bottom:8px;">${policy.name}</div>
                    <div class="readable-text" style="font-size:15px;color:var(--text-primary);margin-bottom:12px;">
                        ${policy.detail || policy.description}
                    </div>
                    <div class="pixel-text" style="font-size:8px;color:var(--text-secondary);margin-bottom:4px;">POLICY RULES</div>
                    <ul class="readable-text" style="font-size:14px;color:var(--text-secondary);padding-left:20px;margin:0;">
                        ${rulesHtml}
                    </ul>
                    <div style="margin-top:12px;display:flex;justify-content:space-between;">
                        <span class="pixel-text" style="font-size:8px;color:var(--text-muted)">HEDGE HORIZON</span>
                        <span class="pixel-text" style="font-size:9px;color:var(--cyan)">${policy.hedgeHorizon}Q (${policy.hedgeHorizon * 3} months)</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;">
                        <span class="pixel-text" style="font-size:8px;color:var(--text-muted)">BUDGET RATE</span>
                        <span class="pixel-text" style="font-size:9px;color:var(--cyan)">${budgetLabel}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;">
                        <span class="pixel-text" style="font-size:8px;color:var(--text-muted)">HEDGE RANGE</span>
                        <span class="pixel-text" style="font-size:9px;color:var(--cyan)">${formatPercent(policy.minHedgeRatio, 0)}-${formatPercent(policy.maxHedgeRatio, 0)}</span>
                    </div>
                    ${tenorHtml}
                </div>
            </div>
        `;

        const viewport = document.getElementById('game-viewport');
        viewport.appendChild(overlay);
        overlay.querySelector('#close-policy').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    drawIsometricScene() {
        const canvas = this.el.querySelector('#iso-canvas');
        if (!canvas) return;
        const state = gameState.get();
        if (this.isoScene) this.isoScene.stop();
        this.isoScene = new IsometricScene(canvas);
        this.isoScene.start(state.industry?.scene || 'airport', state.currentYearOffset, state.currentQuarter);
    }

    startBloombergForExposure(exposure) {
        const canvas = this.el.querySelector('#bloomberg-canvas-right');
        if (!canvas) return;

        const state = gameState.get();
        if (!state.exposures || state.exposures.length === 0) return;

        // Use selected exposure or fall back to first
        const exp = exposure || this.selectedExposure || state.exposures[0];
        const underlying = exp.underlying;
        const exposureType = exp.type;
        const currentRate = state.currentRates[underlying] || 0;
        const targetRate = this.endOfQuarterRates?.[underlying] || currentRate;
        const rng = gameState.getRng();

        canvas.style.display = 'block';

        if (this.bloombergTerminal) this.bloombergTerminal.stop();
        this.bloombergTerminal = new BloombergTerminal(canvas);
        this.bloombergTerminal.start(underlying, exposureType, currentRate, targetRate, rng);

        // On mobile, also show Bloomberg overlay on the isometric viewport
        this.showMobileBloomberg(exp);
    }

    /**
     * On mobile, overlay the Bloomberg chart on the isometric viewport area.
     * Uses a separate BloombergTerminal instance tied to the mobile canvas.
     */
    showMobileBloomberg(exposure) {
        const mobileCanvas = this.el.querySelector('#bloomberg-canvas-mobile');
        if (!mobileCanvas) return;

        // Only activate on narrow screens
        if (window.innerWidth > 768) return;

        const state = gameState.get();
        const underlying = exposure.underlying;
        const currentRate = state.currentRates[underlying] || 0;
        const targetRate = this.endOfQuarterRates?.[underlying] || currentRate;
        const rng = gameState.getRng();

        mobileCanvas.style.display = 'block';

        if (this.mobileBloomberg) this.mobileBloomberg.stop();
        this.mobileBloomberg = new BloombergTerminal(mobileCanvas);
        this.mobileBloomberg.start(underlying, exposure.type, currentRate, targetRate, rng);
    }

    /**
     * Hide the mobile Bloomberg overlay (called when quarter ends).
     */
    hideMobileBloomberg() {
        const mobileCanvas = this.el.querySelector('#bloomberg-canvas-mobile');
        if (mobileCanvas) mobileCanvas.style.display = 'none';
        if (this.mobileBloomberg) {
            this.mobileBloomberg.stop();
            this.mobileBloomberg = null;
        }
    }
}
