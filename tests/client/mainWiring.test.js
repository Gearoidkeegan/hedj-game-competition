// js/main.js wiring for free play (R66, review M6): the mode is applied only on the title and at a run start, the
// registration gate is skipped in free play, and a tab back in view redraws only the title or the registration form.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fakeDom.js';
import * as storage from '../../js/utils/storage.js';
import { EventMode, RECHECK_MS } from '../../js/utils/eventStatus.js';
import { App } from '../../js/main.js';

class FakeStorage {
    constructor() { this.m = new Map(); }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
    setItem(k, v) { this.m.set(k, String(v)); }
    removeItem(k) { this.m.delete(k); }
}

let dom;
beforeEach(() => {
    dom = installFakeDom();
    globalThis.localStorage = new FakeStorage();
    storage.setStorageBackend(new FakeStorage());
    storage.setFreePlay(false);
});
afterEach(() => {
    storage.setFreePlay(false);
    storage.setStorageBackend(null);
    delete globalThis.localStorage;
    dom.restore();
});

// An App with recording stand-in screens and an EventMode whose server answer the test sets.
function makeApp() {
    const clock = { t: 1_700_000_000_000, live: false };
    const app = new App();
    app.container = dom.document.createElement('div');
    app.shown = [];
    const screen = id => ({
        render() { app.shown.push(id); return dom.document.createElement('div'); },
        mount() {}, unmount() {}
    });
    app.screens = Object.fromEntries(['title', 'registration', 'industry', 'setup', 'quarter', 'gameover']
        .map(id => [id, screen(id)]));
    app.eventMode = new EventMode({ fetchEvent: async () => ({ live: clock.live }), storage, now: () => clock.t });
    return { app, clock };
}

test('the mode is applied on the title and at a run start, never on other screens', async () => {
    const { app, clock } = makeApp();
    await app.eventMode.refresh();   // free play
    app.showScreen('title');
    assert.equal(storage.isFreePlay(), true);
    clock.live = true;
    await app.eventMode.refresh();
    for (const id of ['quarter', 'gameover', 'registration']) {
        app.showScreen(id);
        assert.equal(storage.isFreePlay(), true, `${id} leaves a run under way as it began`);
    }
    app.showScreen('industry');
    assert.equal(storage.isFreePlay(), false, 'a run start applies live');
    clock.live = false;
    await app.eventMode.refresh();
    app.showScreen('setup');
    assert.equal(storage.isFreePlay(), true, 'Pro setup applies free play');
});

test('free play never shows registration; live without a registration does, then carries on', async () => {
    const { app, clock } = makeApp();
    await app.eventMode.refresh();
    app.showScreen('industry');
    app.showScreen('setup');
    assert.deepEqual(app.shown, ['industry', 'setup']);
    clock.live = true;
    await app.eventMode.refresh();
    app.showScreen('industry');
    assert.deepEqual(app.shown.slice(2), ['registration']);
    assert.equal(app.screens.registration.nextScreen, 'industry');
});

test('a tab back in view redraws the title or the registration form on a change, and nothing else', async () => {
    const { app, clock } = makeApp();
    await app.eventMode.refresh();
    app.showScreen('title');
    clock.live = true;
    clock.t += RECHECK_MS;
    await app.onVisible();
    assert.deepEqual(app.shown, ['title', 'title'], 'the title redraws in live mode');
    assert.equal(storage.isFreePlay(), false);

    app.showScreen('quarter');
    clock.live = false;
    clock.t += RECHECK_MS;
    await app.onVisible();
    assert.deepEqual(app.shown.slice(2), ['quarter'], 'mid-run: no redraw');
    assert.equal(storage.isFreePlay(), false, 'and the run keeps its mode');

    app.currentScreen = 'registration';
    clock.t += RECHECK_MS;
    await app.onVisible();
    assert.deepEqual(app.shown.slice(3), ['title'], 'the registration form gives way to the free-play title');
    assert.equal(storage.isFreePlay(), true);

    clock.t += 1000;
    await app.onVisible();
    assert.deepEqual(app.shown.slice(4), [], 'at most one check a minute');
});
