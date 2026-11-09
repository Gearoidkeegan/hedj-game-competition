// js/stand.js, the big-screen leaderboard (R66): during a live event the four boards as before; outside one, the
// last event's final boards under "FINAL RESULTS", or the next start date / a holding message when there are none.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeDocument } from '../helpers/fakeDom.js';
import { initStand, HOLDING_TEXT } from '../../js/stand.js';

const IDS = ['updated', 'final', 'holding', 'grid-event', 'grid-today',
    'b-simple-event', 'b-pro-event', 'b-simple-today', 'b-pro-today'];
const NOW = Date.parse('2026-11-01T12:00:00Z');

function page() {
    const doc = createFakeDocument();
    for (const id of IDS) {
        const el = doc.createElement(id.startsWith('b-') ? 'ol' : 'div');
        el.id = id;
        doc.body.appendChild(el);
    }
    return doc;
}

// boards: { 'simple-event': [...], ... }; event: the /api/event body, or an Error.
function run({ event, boards = {} }) {
    const doc = page();
    const calls = [];
    const fetch = async (url, opts) => {
        calls.push({ url, cache: opts?.cache });
        if (url.endsWith('/event')) {
            if (event instanceof Error) throw event;
            return { ok: true, status: 200, json: async () => event };
        }
        const q = new URLSearchParams(url.split('?')[1]);
        return { ok: true, status: 200, json: async () => ({ entries: boards[`${q.get('mode')}-${q.get('period')}`] || [] }) };
    };
    const stand = initStand({ document: doc, fetch, search: '', now: () => NOW });
    return { doc, calls, stand, $: id => doc.getElementById(id) };
}

const ENTRY = { rank: 1, playerName: 'Ann <b>', company: 'Acme & Sons', score: 15200 };

test('live: all four boards, no final heading, no holding message', async () => {
    const { $, calls, stand } = run({ event: { live: true, startIso: null, endIso: null }, boards: { 'simple-today': [ENTRY] } });
    await stand.refresh();
    assert.equal($('grid-event').hidden, false);
    assert.equal($('grid-today').hidden, false);
    assert.equal($('final').hidden, true);
    assert.equal($('holding').hidden, true);
    assert.match($('b-simple-today').textContent, /Ann <b>/, 'names as text');
    assert.ok(calls.every(c => c.cache === 'no-store'));
    assert.ok(calls.some(c => c.url === '/api/event'));
});

test('not live with a last board: FINAL RESULTS over the event boards; today hidden', async () => {
    const { $, stand } = run({ event: { live: false, startIso: null, endIso: '2026-10-20T18:00:00Z' }, boards: { 'pro-event': [ENTRY] } });
    await stand.refresh();
    assert.equal($('final').hidden, false);
    assert.equal($('final').textContent, 'FINAL RESULTS');
    assert.equal($('grid-event').hidden, false);
    assert.equal($('grid-today').hidden, true);
    assert.equal($('holding').hidden, true);
    assert.match($('b-pro-event').textContent, /Ann <b>/);
});

test('not live and no board: the next start date, or the holding message', async () => {
    const next = run({ event: { live: false, startIso: '2026-11-20T09:00:00Z', endIso: null } });
    await next.stand.refresh();
    assert.equal(next.$('holding').hidden, false);
    assert.equal(next.$('holding').textContent, 'Next competition: 20 November 2026');
    assert.equal(next.$('grid-event').hidden, true);
    assert.equal(next.$('grid-today').hidden, true);
    assert.equal(next.$('final').hidden, true);

    const today = run({ event: { live: false, startIso: '2026-11-01T15:30:00Z', endIso: null } });
    await today.stand.refresh();
    assert.equal(today.$('holding').textContent, 'Next competition: today at 15:30', 'on the day itself (M9)');

    const none = run({ event: { live: false, startIso: null, endIso: null } });
    await none.stand.refresh();
    assert.equal(none.$('holding').textContent, HOLDING_TEXT);
    assert.ok(HOLDING_TEXT.length <= 90);
});

test('the event check failing shows the boards as before', async () => {
    const { $, stand } = run({ event: new Error('offline'), boards: { 'simple-event': [ENTRY] } });
    await stand.refresh();
    assert.equal($('grid-event').hidden, false);
    assert.equal($('grid-today').hidden, false);
    assert.equal($('holding').hidden, true);
    assert.equal($('updated').textContent, 'Reconnecting...');
});

test('stand.html has every element stand.js uses, and [hidden] wins over the grid display', () => {
    const html = readFileSync(new URL('../../stand.html', import.meta.url), 'utf8');
    for (const id of IDS) assert.ok(html.includes(`id="${id}"`), `stand.html is missing #${id}`);
    assert.match(html, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});
