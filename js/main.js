// Treasury Manager Simulator — Main entry point
// Screen router, event bus, and app bootstrap

import { gameState } from './engine/GameState.js';
import { gameLoop } from './engine/GameLoop.js';
import { marketEngine } from './engine/MarketEngine.js';
import { eventEngine } from './engine/EventEngine.js';
import { boardAI } from './engine/BoardAI.js';
import { careerEngine } from './engine/CareerEngine.js';
import { PHASE } from './utils/constants.js';
import { TitleScreen } from './screens/TitleScreen.js';
import { SetupScreen } from './screens/SetupScreen.js';
import { DashboardScreen } from './screens/DashboardScreen.js';
import { BoardScreen } from './screens/BoardScreen.js';
import { QuarterSummaryScreen } from './screens/QuarterSummary.js';
import { ExtendScreen } from './screens/ExtendScreen.js';
import { EventScreen } from './screens/EventScreen.js';
import { LevelCompleteScreen } from './screens/LevelCompleteScreen.js';
import { GameOverScreen } from './screens/GameOverScreen.js';
import { HowToPlayScreen } from './screens/HowToPlayScreen.js';

class App {
    constructor() {
        this.container = document.getElementById('screen-container');
        this.currentScreen = null;
        this.screens = {};
        this.industriesData = null;
        this.productsData = null;
        this.gameMode = 'quickplay'; // 'quickplay' or 'career'
    }

    async init() {
        // Load game data
        await this.loadData();

        // Initialize screens
        this.screens = {
            title: new TitleScreen(this),
            setup: new SetupScreen(this),
            dashboard: new DashboardScreen(this),
            event: new EventScreen(this),
            levelComplete: new LevelCompleteScreen(this),
            board: new BoardScreen(this),
            summary: new QuarterSummaryScreen(this),
            extend: new ExtendScreen(this),
            gameover: new GameOverScreen(this),
            howtoplay: new HowToPlayScreen(this)
        };

        // Wire up game loop phase changes to screen transitions
        gameLoop.onPhaseChange = (phase) => {
            this.onPhaseChange(phase);
        };

        // Always start at title screen
        this.showScreen('title');
    }

    async loadData() {
        try {
            const [industriesResp, productsResp] = await Promise.all([
                fetch('data/industries.json'),
                fetch('data/products.json')
            ]);
            this.industriesData = await industriesResp.json();
            this.productsData = await productsResp.json();
        } catch (e) {
            console.error('Failed to load game data:', e);
        }

        // Load market data (non-blocking — game works without it)
        marketEngine.loadData('data/market').catch(() => {
            console.warn('Market data not available — using placeholder rates');
        });

        // Load events and board dialogue (non-blocking)
        eventEngine.loadEvents('data').catch(() => {
            console.warn('Events not available');
        });
        boardAI.loadDialogue('data').catch(() => {
            console.warn('Board dialogue not available');
        });
        careerEngine.loadLevels('data').catch(() => {
            console.warn('Career levels not available');
        });
    }

    onPhaseChange(phase) {
        switch (phase) {
            case PHASE.DECISION:
                this.showScreen('dashboard');
                break;
            case PHASE.RESOLUTION:
                // Resolution is automatic, dashboard stays visible
                // The dashboard will show a brief animation
                break;
            case PHASE.EVENT:
                this.showScreen('event');
                break;
            case PHASE.BOARD:
                this.showScreen('board');
                break;
            case PHASE.SUMMARY:
                this.showScreen('summary');
                break;
            case PHASE.LEVEL_COMPLETE:
                this.showScreen('levelComplete');
                break;
            case PHASE.EXTEND:
                this.showScreen('extend');
                break;
            case PHASE.GAMEOVER:
                this.showScreen('gameover');
                break;
        }
    }

    showScreen(screenId) {
        // Unmount current screen
        if (this.currentScreen && this.screens[this.currentScreen]) {
            this.screens[this.currentScreen].unmount();
        }

        // Clear container
        this.container.innerHTML = '';

        // Mount new screen
        if (this.screens[screenId]) {
            const screenEl = this.screens[screenId].render();
            this.container.appendChild(screenEl);
            this.screens[screenId].mount();
            this.currentScreen = screenId;
        }
    }

    // Show a toast notification
    showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
}

// Boot the app
const app = new App();
app.init().catch(e => console.error('App init failed:', e));

// Export for global access if needed
window.treasuryApp = app;
