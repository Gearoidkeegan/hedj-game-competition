import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fakeDom.js';
import * as storage from '../../js/utils/storage.js';
import { HowToPlayScreen, CARDS } from '../../js/screens/HowToPlayScreen.js';

class FakeStorage {
    constructor() { this.m = new Map(); }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
    setItem(k, v) { this.m.set(k, String(v)); }
    removeItem(k) { this.m.delete(k); }
}

let dom;
beforeEach(() => { dom = installFakeDom(); globalThis.localStorage = new FakeStorage(); storage.setStorageBackend(new FakeStorage()); });
afterEach(() => { storage.setStorageBackend(null); delete globalThis.localStorage; dom.restore(); });

function make() {
    const app = { shown: [], toasts: [], showScreen(id) { this.shown.push(id); }, showToast(m) { this.toasts.push(m); } };
    const screen = new HowToPlayScreen(app);
    const el = screen.render();
    dom.document.body.appendChild(el);
    return { app, screen, el, q: s => el.querySelector(s), qa: s => el.querySelectorAll(s) };
}
const allText = () => CARDS.map(c => [c.title, ...c.points].join(' ')).join(' ');

test('three cards: the dial, the cash meter, beating doing nothing', () => {
    const { qa } = make();
    assert.deepEqual(qa('.gd-card h2').map(h => h.textContent), ['THE DIAL', 'THE CASH METER', 'BEAT DOING NOTHING']);
    assert.equal(qa('.gd-dot').length, 3);
});

test('copy reflects the board model and avoids retired ideas', () => {
    const t = allText();
    for (const s of [/policy/i, /not to hedge/i, /propose/i, /Bigger Bank Facilities/, /Rate & Commodity Hedging/, /cap/i]) assert.match(t, s);
    assert.doesNotMatch(t, /career|strike/i);
    for (const c of CARDS) for (const p of c.points) assert.ok(p.length < 200, p);
});

test('NEXT walks the cards; the last one reads START GAME and finishes, marking the guide seen', () => {
    const { app, q } = make();
    assert.equal(q('.gd-back').disabled, true);
    assert.equal(q('.gd-next').textContent, 'NEXT');
    q('.gd-next').click();
    q('.gd-next').click();
    assert.equal(q('.gd-next').textContent, 'START GAME');
    assert.equal(q('.gd-back').disabled, false);
    assert.equal(storage.hasSeenGuide(), false);
    q('.gd-next').click();
    assert.deepEqual(app.shown, ['title']);
    assert.equal(storage.hasSeenGuide(), true);
});

test('a swipe (scroll) moves the dots without a second scroll', () => {
    const { screen, qa } = make();
    screen.track.clientWidth = 300;
    screen.track.scrollLeft = 300;
    screen.track.dispatchEvent(new (class { constructor() { this.type = 'scroll'; } })());
    assert.equal(screen.currentStep, 1);
    assert.deepEqual(qa('.gd-dot').map(d => d.classList.contains('is-active')), [false, true, false]);
});

test('SKIP returns to the screen it came from, with a toast on the auto-show', () => {
    const { app, screen, q } = make();
    screen.fromAutoShow = true;
    screen.returnScreen = 'industry';
    q('.gd-skip').click();
    assert.deepEqual(app.shown, ['industry']);
    assert.equal(app.toasts.length, 1);
});
