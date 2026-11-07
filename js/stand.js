// Big-screen leaderboard for the event stand. Public data only; names are rendered with textContent.
// ?mock=1 reads tests/fixtures/stand-mock.json and works for local development only: tests/ is not deployed.
import { CONFIG } from './config.js';

const REFRESH_MS = 30000;
const FETCH_TIMEOUT_MS = 10000;
const LIMIT = 10;
const BOARDS = [
    { mode: 'simple', period: 'event' },
    { mode: 'pro', period: 'event' },
    { mode: 'simple', period: 'today' },
    { mode: 'pro', period: 'today' }
];
const mock = new URLSearchParams(location.search).get('mock') === '1';

async function fetchBoard({ mode, period }) {
    const url = mock
        ? 'tests/fixtures/stand-mock.json'
        : `${CONFIG.apiBase}/leaderboard?mode=${mode}&period=${period}&limit=${LIMIT}`;
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (mock ? data[`${mode}-${period}`] : data.entries) || [];
}

function renderBoard(id, entries) {
    const list = document.getElementById(id);
    list.replaceChildren();
    if (!entries.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'No scores yet';
        list.append(li);
        return;
    }
    for (const e of entries.slice(0, LIMIT)) {
        const li = document.createElement('li');
        const rank = document.createElement('span');
        rank.className = 'rank';
        rank.textContent = String(e.rank);
        const who = document.createElement('span');
        who.className = 'who';
        who.textContent = e.playerName ?? '';
        if (e.company ?? '') {
            const co = document.createElement('span');
            co.className = 'co';
            co.textContent = ` ${e.company}`;
            who.append(co);
        }
        const score = document.createElement('span');
        score.className = 'score';
        score.textContent = Number(e.score).toLocaleString('en-IE');
        li.append(rank, who, score);
        list.append(li);
    }
}

let latest = 0;

async function refresh() {
    const ticket = ++latest;
    const results = await Promise.allSettled(BOARDS.map(fetchBoard));
    if (ticket !== latest) return; // a newer refresh has started; never overwrite its render
    results.forEach((r, i) => {
        if (r.status === 'fulfilled') renderBoard(`b-${BOARDS[i].mode}-${BOARDS[i].period}`, r.value);
    });
    const failed = results.some(r => r.status === 'rejected');
    document.getElementById('updated').textContent = failed
        ? 'Reconnecting...'
        : `Updated ${new Date().toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit' })}`;
}

// Self-rescheduling loop: the next refresh starts only after the previous one finishes. Paused while hidden.
async function loop() {
    if (!document.hidden) await refresh();
    setTimeout(loop, REFRESH_MS);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
loop();
