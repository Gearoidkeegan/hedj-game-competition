// Big-screen leaderboard for the event stand. Public data only; names are rendered with textContent.
// ?mock=1 reads tests/fixtures/stand-mock.json and works for local development only: tests/ is not deployed.
// Free play (R66): outside a live event it shows the last event's boards under FINAL RESULTS, or, with none, the
// next start date or a holding message. If the event check fails it shows the boards as during an event.
// initStand takes its browser dependencies as optional arguments so Node tests can drive it with a fake DOM.
import { CONFIG } from './config.js';
import { normaliseEvent, nextStartIso, formatEventDate } from './utils/eventStatus.js';

const REFRESH_MS = 30000;
const FETCH_TIMEOUT_MS = 10000;
const LIMIT = 10;
const BOARDS = [
    { mode: 'simple', period: 'event' },
    { mode: 'pro', period: 'event' },
    { mode: 'simple', period: 'today' },
    { mode: 'pro', period: 'today' }
];
export const HOLDING_TEXT = 'Treasury Manager by Hedj. Play now at competition.hedj.eu';

export function initStand(env = {}) {
    const doc = env.document ?? globalThis.document;
    const fetchFn = env.fetch ?? ((...a) => globalThis.fetch(...a));
    const now = env.now ?? (() => Date.now());
    const mock = new URLSearchParams(env.search ?? globalThis.location?.search ?? '').get('mock') === '1';
    const $ = id => doc.getElementById(id);
    const get = url => fetchFn(url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

    async function fetchBoard({ mode, period }) {
        const url = mock
            ? 'tests/fixtures/stand-mock.json'
            : `${CONFIG.apiBase}/leaderboard?mode=${mode}&period=${period}&limit=${LIMIT}`;
        const res = await get(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return (mock ? data[`${mode}-${period}`] : data.entries) || [];
    }

    async function fetchEvent() {
        if (mock) return { live: true };
        const res = await get(`${CONFIG.apiBase}/event`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return normaliseEvent(await res.json());
    }

    function renderBoard(id, entries) {
        const list = $(id);
        list.replaceChildren();
        if (!entries.length) {
            const li = doc.createElement('li');
            li.className = 'empty';
            li.textContent = 'No scores yet';
            list.append(li);
            return;
        }
        for (const e of entries.slice(0, LIMIT)) {
            const li = doc.createElement('li');
            const rank = doc.createElement('span');
            rank.className = 'rank';
            rank.textContent = String(e.rank);
            const who = doc.createElement('span');
            who.className = 'who';
            who.textContent = e.playerName ?? '';
            if (e.company ?? '') {
                const co = doc.createElement('span');
                co.className = 'co';
                co.textContent = ` ${e.company}`;
                who.append(co);
            }
            const score = doc.createElement('span');
            score.className = 'score';
            score.textContent = Number(e.score).toLocaleString('en-IE');
            li.append(rank, who, score);
            list.append(li);
        }
    }

    // Live (or unknown): every board. Closed: the event boards under FINAL RESULTS, or the holding line.
    function renderMode(event, results) {
        const closed = !!event && !event.live;
        const hasFinal = results.slice(0, 2).some(r => r.status === 'fulfilled' && r.value.length > 0);
        $('final').textContent = 'FINAL RESULTS';
        $('final').hidden = !closed || !hasFinal;
        $('grid-event').hidden = closed && !hasFinal;
        $('grid-today').hidden = closed;
        const next = closed ? nextStartIso(event, now()) : null;
        $('holding').textContent = next ? `Next competition: ${formatEventDate(next)}` : HOLDING_TEXT;
        $('holding').hidden = !closed || hasFinal;
    }

    let latest = 0;

    async function refresh() {
        const ticket = ++latest;
        const [eventResult, ...results] = await Promise.allSettled([fetchEvent(), ...BOARDS.map(fetchBoard)]);
        if (ticket !== latest) return; // a newer refresh has started; never overwrite its render
        results.forEach((r, i) => {
            if (r.status === 'fulfilled') renderBoard(`b-${BOARDS[i].mode}-${BOARDS[i].period}`, r.value);
        });
        renderMode(eventResult.status === 'fulfilled' ? eventResult.value : null, results);
        const failed = eventResult.status === 'rejected' || results.some(r => r.status === 'rejected');
        $('updated').textContent = failed
            ? 'Reconnecting...'
            : `Updated ${new Date(now()).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}`;
    }

    // Self-rescheduling loop: the next refresh starts only after the previous one finishes. Paused while hidden.
    async function loop() {
        try {
            if (!doc.hidden) await refresh();
        } finally {
            setTimeout(loop, REFRESH_MS);
        }
    }

    function start() {
        doc.addEventListener('visibilitychange', () => { if (!doc.hidden) refresh(); });
        loop();
    }

    return { refresh, start };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') initStand().start();
