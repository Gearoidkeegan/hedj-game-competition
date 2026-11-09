// Free play (R66): whether a competition is live, from GET /api/event (the backend decides from the deploy
// settings and the event dates). Fallback order when the check fails: the last answer cached on this device, then
// free play. No DOM here, so it runs under Node tests; main.js owns the one instance (app.eventMode).
//
// The mode is applied (storage.setFreePlay) only where no run is under way: the title and the start of a run.
// A live event that closes mid-run therefore lets the run finish as a registered run, and its score goes through
// the normal submit (the server's 2-hour grace, or the R63 "competition has closed" rejection).

export const FREE_PLAY = Object.freeze({ live: false, startIso: null, endIso: null });
export const RECHECK_MS = 60_000;   // a tab coming back into view checks again at most once a minute

const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Dublin' });
const validIso = v => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);

export function normaliseEvent(data) {
    return { live: data?.live === true, startIso: validIso(data?.startIso), endIso: validIso(data?.endIso) };
}

// "20 November 2026" (the date in Dublin, where the events run).
export function formatEventDate(iso) {
    return DATE_FMT.format(new Date(iso));
}

// The start of a competition still ahead, or null.
export function nextStartIso(event, nowMs) {
    const start = Date.parse(event?.startIso ?? '');
    return Number.isFinite(start) && start > nowMs ? event.startIso : null;
}

// The one line free play shows in place of a rank (90 characters or fewer).
export function practiceLine(event, nowMs) {
    const next = nextStartIso(event, nowMs);
    return next ? `Practice mode. Next competition: ${formatEventDate(next)}` : 'Practice mode. Play for prizes at the Hedj stand';
}

// main.js's gate: starting a run (Simple industry pick or Pro setup) needs a valid registration, except in free play.
export function needsRegistration(screenId, storage, nowMs) {
    if (screenId !== 'setup' && screenId !== 'industry') return false;
    if (storage.isFreePlay()) return false;
    const reg = storage.getRegistration();
    return !reg || reg.gameTokenExpiry < nowMs;
}

export class EventMode {
    // fetchEvent: api.fetchEvent; storage: js/utils/storage.js (the cache and the free-play switch).
    constructor({ fetchEvent, storage, now = () => Date.now() }) {
        this.fetchEvent = fetchEvent;
        this.storage = storage;
        this.now = now;
        const cached = storage.getCachedEvent();
        this.event = cached ? normaliseEvent(cached) : FREE_PLAY;
        this.fresh = false;           // the last check reached the server
        this.checkedAt = -Infinity;
        this._inflight = null;
    }

    // Asks the server; on failure keeps the cached value, or free play when there is none. Never rejects.
    refresh() {
        if (this._inflight) return this._inflight;
        this.checkedAt = this.now();
        this._inflight = (async () => {
            try {
                this.event = normaliseEvent(await this.fetchEvent());
                this.fresh = true;
                this.storage.saveCachedEvent(this.event);
            } catch {
                const cached = this.storage.getCachedEvent();
                this.event = cached ? normaliseEvent(cached) : FREE_PLAY;
                this.fresh = false;
            }
            return this.event;
        })().finally(() => { this._inflight = null; });
        return this._inflight;
    }

    // Free play unless the event is live. Returns true when the mode changed.
    apply() {
        const free = !this.event.live;
        const changed = free !== this.storage.isFreePlay();
        this.storage.setFreePlay(free);
        return changed;
    }

    // PLAY: when the last check failed, quietly try again (the event may be live after all), then apply the mode.
    async beforePlay() {
        if (!this.fresh) await this.refresh();
        return this.apply();
    }

    // A tab back in view: checks again at most once a minute. Returns true when `live` changed. Does not apply it.
    async recheck() {
        if (this.now() - this.checkedAt < RECHECK_MS) return false;
        const before = this.event.live;
        await this.refresh();
        return this.event.live !== before;
    }
}
