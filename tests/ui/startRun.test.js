// M3: if the market data failed on first load (flaky conference Wi-Fi), starting a run retries the load, so PLAY
// works again once the connection is back instead of failing until the page is reloaded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startRun } from '../../js/screens/simple/IndustryScreen.js';

function app({ loaded, loadSucceeds = true }) {
    const market = { loaded, isLoaded() { return this.loaded; } };
    const a = {
        loads: 0,
        marketReady: Promise.resolve(),
        runController: {
            market,
            started: [],
            start(id, opts) {
                if (!market.isLoaded()) throw new Error('No eligible start year');
                this.started.push([id, opts]);
                return { id };
            }
        },
        loadMarket() {
            a.loads++;
            a.marketReady = Promise.resolve().then(() => { if (loadSucceeds) market.loaded = true; });
            return a.marketReady;
        }
    };
    return a;
}

test('a loaded market starts at once, with no reload', async () => {
    const a = app({ loaded: true });
    await startRun(a, 'airline', { crisisId: null });
    assert.equal(a.loads, 0);
    assert.deepEqual(a.runController.started, [['airline', { crisisId: null }]]);
});

test('a market that failed to load is loaded again before the run starts', async () => {
    const a = app({ loaded: false });
    await startRun(a, 'airline');
    assert.equal(a.loads, 1);
    assert.deepEqual(a.runController.started, [['airline', {}]]);
});

test('still offline: the retry fails, the start throws (the screen toasts), and the next tap retries again', async () => {
    const a = app({ loaded: false, loadSucceeds: false });
    await assert.rejects(startRun(a, 'airline'), /No eligible start year/);
    await assert.rejects(startRun(a, 'airline'), /No eligible start year/);
    assert.equal(a.loads, 2);
});
