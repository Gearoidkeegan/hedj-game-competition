// Free play (R66): whether a competition is live, from GET /api/event (the backend decides from the deploy
// settings and the event dates). Fallback order when the check fails: the last answer cached on this device, then
// free play. No DOM here, so it runs under Node tests; main.js owns the one instance (app.eventMode).
//
// The mode is applied (storage.setFreePlay) only where no run is under way: the title and the start of a run.
// A live event that closes mid-run therefore lets the run finish as a registered run, and its score goes through
// the normal submit (the server's 2-hour grace, or the R63 "competition has closed" rejection).

export const FREE_PLAY = Object.freeze({ live: false, startIso: null, endIso: null });
// A good answer is reused for at most this long (and never past a cached start or end date); a tab coming back into
// view also checks again at most once a minute.
export const RECHECK_MS = 60_000;

const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Dublin' });
const DAY_FMT = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Europe/Dublin' });
const TIME_FMT = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Dublin' });
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

// When the next competition starts: "today at 09:00" on the day itself (Dublin time), "20 November 2026" before.
export function nextCompetitionText(iso, nowMs) {
    const start = new Date(iso);
    return DAY_FMT.format(start) === DAY_FMT.format(new Date(nowMs)) ? `today at ${TIME_FMT.format(start)}` : formatEventDate(iso);
}

// The one line free play shows in place of a rank (90 characters or fewer).
export function practiceLine(event, nowMs) {
    const next = nextStartIso(event, nowMs);
    return next ? `Practice mode. Next competition: ${nextCompetitionText(next, nowMs)}` : 'Practice mode. Play for prizes at the Hedj stand';
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

    // True when the status should be asked again before it is used: the last check failed, it is older than
    // RECHECK_MS, or a cached start or end date has passed since it was fetched (a phone left open across either).
    isStale() {
        if (this._inflight) return true;   // a second tap waits for the same answer, never goes on the old mode
        const now = this.now();
        if (!this.fresh || now - this.checkedAt >= RECHECK_MS) return true;
        const crossed = iso => {
            const t = Date.parse(iso ?? '');
            return Number.isFinite(t) && this.checkedAt < t && now >= t;
        };
        return crossed(this.event.startIso) || crossed(this.event.endIso);
    }

    // PLAY, PLAY AGAIN and the title: ask again when stale (quietly; fetchEvent gives up after its 4 s timeout),
    // then apply the mode. Returns true when the mode changed. Never rejects.
    async beforePlay() {
        if (this.isStale()) await this.refresh();
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
