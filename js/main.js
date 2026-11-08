// Treasury Manager Simulator — Competition Edition
// Screen router, event bus, and app bootstrap

import { gameState } from './engine/GameState.js';
import { gameLoop } from './engine/GameLoop.js';
import { marketEngine } from './engine/MarketEngine.js';
import { eventEngine } from './engine/EventEngine.js';
import { boardAI } from './engine/BoardAI.js';
import { PHASE } from './utils/constants.js';
import { TitleScreen } from './screens/TitleScreen.js';
import { SetupScreen } from './screens/SetupScreen.js';
import { DashboardScreen } from './screens/DashboardScreen.js';
import { BoardScreen } from './screens/BoardScreen.js';
import { QuarterSummaryScreen } from './screens/QuarterSummary.js';
import { EventScreen } from './screens/EventScreen.js';
import { GameOverScreen } from './screens/GameOverScreen.js';
import { HowToPlayScreen } from './screens/HowToPlayScreen.js';
import { RegistrationScreen } from './screens/RegistrationScreen.js';
import { RunController } from './screens/simple/RunController.js';
import { IndustryScreen } from './screens/simple/IndustryScreen.js';
import { QuarterScreen } from './screens/simple/QuarterScreen.js';
import * as api from './utils/api.js';
import * as storage from './utils/storage.js';

const { trackEvent, submitScore, flushScoreQueue } = api;
const { getRegistration, getPendingScore, clearPendingScore } = storage;

// Stand-in for the Simple result screen that B3 builds.
class PlaceholderScreen {
    constructor(app, name) {
        this.app = app;
        this.name = name;
        this.el = null;
    }

    render() {
        this.el = document.createElement('div');
        this.el.className = 'screen active';
        this.el.textContent = `${this.name.toUpperCase()}: coming soon`;
        return this.el;
    }

    mount() {}
    unmount() {}
}

class App {
    constructor() {
        this.container = document.getElementById('screen-container');
        this.currentScreen = null;
        this.screens = {};
        this.industriesData = null;
        this.productsData = null;
        this.gameMode = 'quickplay';
        // v3 Simple mode content and the run hub (set up in init)
        this.content = { industries: [], events: [], eventsLoaded: false, quips: null, powerups: null };
        this.marketReady = Promise.resolve();
        this.runController = null;
        this.lastQuarter = null;   // the latest runController.playQuarter() result, for the result screen (B3)
    }

    async init() {
        // Load game data
        await this.loadData();
        this.runController = new RunController({
            storage, api, market: marketEngine, content: this.content, now: () => Date.now()
        });

        // Initialize screens
        this.screens = {
            title: new TitleScreen(this),
            registration: new RegistrationScreen(this),
            // Simple mode (v3)
            industry: new IndustryScreen(this),
            quarter: new QuarterScreen(this),
            result: new PlaceholderScreen(this, 'result'),
            gameover: new GameOverScreen(this),
            // Pro mode
            setup: new SetupScreen(this),
            dashboard: new DashboardScreen(this),
            event: new EventScreen(this),
            board: new BoardScreen(this),
            summary: new QuarterSummaryScreen(this),
            howtoplay: new HowToPlayScreen(this)
        };

        // Wire up game loop phase changes to screen transitions
        gameLoop.onPhaseChange = (phase) => {
            this.onPhaseChange(phase);
        };

        // Track site visit (fire-and-forget)
        trackEvent('visit');

        // Flush any pending score submission from a previous session
        this.flushPendingScore();
        flushScoreQueue().catch(() => {});
        window.addEventListener('online', () => flushScoreQueue().catch(() => {}));

        // Always start at title screen
        this.showScreen('title');
    }

    // Retry for the quarter screen when the events failed to load. Resolves true when they are now available.
    async reloadEvents() {
        try {
            const resp = await fetch('data/simple-events.json');
            if (!resp.ok) return false;
            this.content.events = (await resp.json())?.events || [];
            this.content.eventsLoaded = true;
            return true;
        } catch {
            return false;
        }
    }

    async loadData() {
        try {
            const [industriesResp, productsResp, quipsResp, simpleEventsResp, powerupsResp] = await Promise.all([
                fetch('data/industries.json'),
                fetch('data/products.json'),
                fetch('data/quips.json'),
                fetch('data/simple-events.json'),
                fetch('data/powerups.json')
            ]);
            this.industriesData = await industriesResp.json();
            this.productsData = await productsResp.json();
            this.content.industries = this.industriesData?.industries || [];
            this.content.quips = await quipsResp.json();
            this.content.events = (await simpleEventsResp.json())?.events || [];
            this.content.eventsLoaded = true;
            this.content.powerups = await powerupsResp.json();
        } catch (e) {
            console.error('Failed to load game data:', e);
        }

        // Load market data (non-blocking). A Simple run needs it: await app.marketReady before start().
        this.marketReady = marketEngine.loadData('data/market').catch(() => {
            console.warn('Market data not available — using placeholder rates');
        });

        // Load events and board dialogue (non-blocking)
        eventEngine.loadEvents('data').catch(() => {
            console.warn('Events not available');
        });
        boardAI.loadDialogue('data').catch(() => {
            console.warn('Board dialogue not available');
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
            case PHASE.GAMEOVER:
                this.showScreen('gameover');
                break;
        }
    }

    showScreen(screenId) {
        // Redirect to registration when a run (Pro setup or Simple industry pick) is requested without a valid token
        if (screenId === 'setup' || screenId === 'industry') {
            const reg = getRegistration();
            if (!reg || reg.gameTokenExpiry < Date.now()) {
                // After registering, carry on to where the player was going.
                if (this.screens.registration) this.screens.registration.nextScreen = screenId;
                screenId = 'registration';
            }
        }

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

    async flushPendingScore() {
        const pending = getPendingScore();
        if (!pending) return;
        const reg = getRegistration();
        if (!reg?.gameToken || reg.gameTokenExpiry < Date.now()) return;
        try {
            await submitScore(pending);
            clearPendingScore();
        } catch {
            // Will retry next visit
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
