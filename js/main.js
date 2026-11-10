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
import { ResultScreen } from './screens/simple/ResultScreen.js';
import { AvatarPicker, needsAvatar } from './screens/simple/AvatarPicker.js';
import * as api from './utils/api.js';
import * as storage from './utils/storage.js';
import { EventMode, needsRegistration } from './utils/eventStatus.js';

const { trackEvent, flushScoreQueue } = api;

export class App {
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
        this.gameOverMode = null;  // 'simple' (set by the result screen) or 'pro' (the Pro game loop)
        // R66: live competition or free play, from GET /api/event (cached value, then free play, when it fails).
        this.eventMode = new EventMode({ fetchEvent: api.fetchEvent, storage, now: () => Date.now() });
    }

    // { live, startIso, endIso }: the latest known event status.
    get event() {
        return this.eventMode.event;
    }

    async init() {
        // Load game data, and the event status alongside it (a short timeout, so the title never waits long)
        const eventReady = this.eventMode.refresh();
        await this.loadData();
        await eventReady;
        this.eventMode.apply();
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
            result: new ResultScreen(this),
            avatar: new AvatarPicker(this),
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

        // Send any scores queued while offline
        flushScoreQueue().catch(() => {});
        window.addEventListener('online', () => flushScoreQueue().catch(() => {}));

        // R66: a tab back in view checks the event again (at most once a minute). The new mode shows at once only
        // on the title or the registration form; anywhere else it applies at the next title or run start, so a
        // run under way carries on as it began.
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) this.onVisible();
        });

        // Always start at title screen
        this.showScreen('title');

        // v3.2: the weekly chart data loads once the title is up (not awaited, so it never holds the title back).
        this.loadChartData();
    }

    // Chart-only weekly prices (MarketEngine.loadWeekly). Until they arrive, or if they fail, the charts use the
    // monthly data. Never throws, never rejects.
    loadChartData() {
        try {
            marketEngine.loadWeekly('data/market')?.catch?.(() => {});
        } catch {
            // charts fall back to monthly
        }
    }

    // The tab is back in view (see init). Never rejects.
    onVisible() {
        return this.eventMode.recheck().then(() => {
            const stale = this.event.live === storage.isFreePlay();
            if (stale && (this.currentScreen === 'title' || this.currentScreen === 'registration')) this.showScreen('title');
        }).catch(() => {});
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
        this.loadMarket();

        // Load events and board dialogue (non-blocking)
        eventEngine.loadEvents('data').catch(() => {
            console.warn('Events not available');
        });
        boardAI.loadDialogue('data').catch(() => {
            console.warn('Board dialogue not available');
        });
    }

    // (Re)loads the market data and sets app.marketReady. startRun calls it again when the first load failed (M3).
    // A load already in flight is shared, so a double tap doesn't fetch twice. Never rejects.
    loadMarket() {
        if (!this._marketLoading) {
            this._marketLoading = marketEngine.loadData('data/market')
                .catch(() => {})
                .then(() => {
                    if (!marketEngine.isLoaded()) console.warn('Market data not available');
                })
                .finally(() => { this._marketLoading = null; });
            this.marketReady = this._marketLoading;
        }
        return this._marketLoading;
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
                this.gameOverMode = 'pro';
                this.showScreen('gameover');
                break;
        }
    }

    showScreen(screenId) {
        // R66: the title and the start of a run are where the live/free-play mode is applied (no run under way).
        if (screenId === 'title' || screenId === 'setup' || screenId === 'industry') this.eventMode.apply();

        // Redirect to registration when a run (Pro setup or Simple industry pick) is requested without a valid token.
        // Never in free play.
        if (needsRegistration(screenId, storage, Date.now())) {
            // After registering, carry on to where the player was going.
            if (this.screens.registration) this.screens.registration.nextScreen = screenId;
            screenId = 'registration';
        }

        // v3.1: the character picker comes once, before the first Simple run: after registration (or free play's
        // PLAY) and before the industry pick, while the current player has no valid character stored.
        if (screenId === 'industry' && this.screens.avatar && needsAvatar(storage)) {
            this.screens.avatar.nextScreen = 'industry';
            screenId = 'avatar';
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

// Boot the app in a browser. Node tests import App without booting it (there is no `window` there).
if (typeof window !== 'undefined') {
    const app = new App();
    app.init().catch(e => console.error('App init failed:', e));

    // Export for global access if needed
    window.treasuryApp = app;
}
