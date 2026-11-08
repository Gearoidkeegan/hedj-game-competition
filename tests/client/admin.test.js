// js/admin.js: the admin page logic moved out of admin.html for the CSP. Same behaviour as the inline script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFakeDocument, key } from '../helpers/fakeDom.js';
import { initAdmin } from '../../js/admin.js';

const IDS = ['admin-key-input', 'btn-login', 'auth-msg', 'auth-section', 'data-section', 'stat-visits', 'stat-plays',
    'stat-regs', 'm-unique', 'm-runs', 'm-return', 'm-multiday', 'btn-download-csv', 'btn-refresh', 'player-count',
    'players-msg', 'players-table-wrap', 'players-tbody'];
const PRIZE = [['simple', 'event'], ['pro', 'event'], ['simple', 'today'], ['pro', 'today']];

function page() {
    const doc = createFakeDocument();
    doc.querySelectorAll = s => doc.body.querySelectorAll(s);
    for (const id of IDS) {
        const el = doc.createElement(id.startsWith('btn') ? 'button' : 'div');
        el.id = id;
        doc.body.appendChild(el);
    }
    // The fake DOM refuses innerHTML; the admin table is still built from an escaped string, so record it as text.
    Object.defineProperty(doc.getElementById('players-tbody'), 'innerHTML', { value: '', writable: true });
    for (const [m, p] of PRIZE) {
        const b = doc.createElement('button');
        b.setAttribute('data-prize-mode', m);
        b.setAttribute('data-prize-period', p);
        doc.body.appendChild(b);
    }
    return doc;
}

const DATA = {
    '/api/analytics': { counts: { visit: 1234, play: 56 } },
    '/api/admin/players': { players: [
        { playerName: 'Ann <b>', email: 'a@x.ie', company: 'A&Co', registeredAt: '2026-11-08T10:00:00Z', marketingConsent: true },
        { playerName: 'Bo', email: 'b@x.ie', company: 'B', registeredAt: '', marketingConsent: false }
    ] },
    '/api/admin/metrics': { uniquePlayers: 2, runsPerPlayer: 2.5, returnRate: 0.5, multiDayRate: 0.25 }
};

function env({ status = 200, stored = '' } = {}) {
    const calls = [];
    const store = new Map(stored ? [['hedj_admin_key', stored]] : []);
    const saved = [];
    const alerts = [];
    return {
        calls, store, saved, alerts,
        fetch: async (url, opts) => {
            calls.push({ url, key: opts?.headers?.['x-admin-key'] });
            if (status !== 200) return { ok: false, status, json: async () => ({}), text: async () => '' };
            const path = url.split('?')[0];
            return { ok: true, status, json: async () => DATA[path], text: async () => `csv for ${url}` };
        },
        sessionStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
        alert: m => alerts.push(m),
        Blob: class { constructor(parts) { this.text = parts.join(''); } },
        URL: { createObjectURL: b => { saved.push(b.text); return 'blob:x'; }, revokeObjectURL() {} }
    };
}

const settle = () => new Promise(r => setTimeout(r, 0));

test('UNLOCK with a key loads stats and players, escaping player text', async () => {
    const doc = page();
    const e = env();
    initAdmin({ document: doc, ...e });
    doc.getElementById('admin-key-input').value = '  secret ';
    doc.getElementById('btn-login').click();
    await settle();
    assert.deepEqual(e.calls.map(c => c.url).sort(), ['/api/admin/metrics', '/api/admin/players', '/api/analytics']);
    assert.ok(e.calls.every(c => c.key === 'secret'));
    assert.equal(e.store.get('hedj_admin_key'), 'secret');
    assert.equal(doc.getElementById('data-section').style.display, 'block');
    assert.equal(doc.getElementById('auth-section').style.display, 'none');
    assert.equal(doc.getElementById('stat-visits').textContent, (1234).toLocaleString());
    assert.equal(doc.getElementById('stat-regs').textContent, '2');
    assert.equal(doc.getElementById('m-runs').textContent, '2.5');
    assert.equal(doc.getElementById('m-multiday').textContent, '25%');
    assert.equal(doc.getElementById('player-count').textContent, '2 PLAYERS');
    const html = doc.getElementById('players-tbody').innerHTML;
    assert.ok(html.includes('Ann &lt;b&gt;') && html.includes('A&amp;Co') && !html.includes('<b>'));
});

test('Enter in the key box logs in; an empty key does nothing', async () => {
    const doc = page();
    const e = env();
    initAdmin({ document: doc, ...e });
    key(doc.getElementById('admin-key-input'), 'Enter');
    await settle();
    assert.equal(e.calls.length, 0);
    doc.getElementById('admin-key-input').value = 'k';
    key(doc.getElementById('admin-key-input'), 'Enter');
    await settle();
    assert.equal(e.calls.length, 3);
});

test('a rejected key shows INVALID ADMIN KEY and clears the stored key', async () => {
    const doc = page();
    const e = env({ status: 403 });
    initAdmin({ document: doc, ...e });
    doc.getElementById('admin-key-input').value = 'bad';
    doc.getElementById('btn-login').click();
    await settle();
    assert.equal(doc.getElementById('auth-msg').textContent, 'INVALID ADMIN KEY');
    assert.equal(doc.getElementById('auth-msg').style.display, 'block');
    assert.equal(e.store.get('hedj_admin_key'), '');
});

test('a stored session key auto-unlocks; REFRESH reloads; CSV and prize buttons save files', async () => {
    const doc = page();
    const e = env({ stored: 'kept' });
    const admin = initAdmin({ document: doc, ...e });
    await admin.ready;
    assert.equal(doc.getElementById('admin-key-input').value, 'kept');
    assert.equal(e.calls.length, 3);

    doc.getElementById('btn-refresh').click();
    assert.equal(doc.getElementById('players-msg').textContent, 'LOADING...');
    await settle();
    assert.equal(e.calls.length, 6);

    doc.getElementById('btn-download-csv').click();
    assert.match(e.saved[0], /^Name,Email,Company,Registered At,Marketing Consent\r\n"Ann <b>","a@x\.ie","A&Co",/);

    for (const b of doc.body.querySelectorAll('[data-prize-mode]')) b.click();
    await settle();
    const prizeUrls = e.calls.slice(6).map(c => c.url);
    assert.deepEqual(prizeUrls, PRIZE.map(([m, p]) => `/api/admin/prize?mode=${m}&period=${p}&limit=10`));
    assert.equal(e.saved.length, 5);
    assert.equal(e.alerts.length, 0);
});

test('admin.html loads js/admin.js and has the ids and data attributes it binds', () => {
    const html = readFileSync(new URL('../../admin.html', import.meta.url), 'utf8');
    assert.ok(html.includes('<script type="module" src="js/admin.js"></script>'));
    for (const id of IDS) assert.ok(html.includes(`id="${id}"`), `admin.html is missing #${id}`);
    for (const [m, p] of PRIZE) assert.ok(html.includes(`data-prize-mode="${m}" data-prize-period="${p}"`));
});
