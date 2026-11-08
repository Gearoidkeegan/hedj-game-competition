import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fakeDom.js';
import { CashMeter } from '../../js/ui/CashMeter.js';
import { formatCash } from '../../js/utils/formatters.js';

let dom;
beforeEach(() => { dom = installFakeDom(); });
afterEach(() => dom.restore());

// A manual animation clock: frames run only when the test calls tick().
function clock() {
    let t = 0;
    let queue = [];
    return {
        now: () => t,
        requestAnimationFrame: fn => { queue.push(fn); return queue.length; },
        cancelAnimationFrame: () => { queue = []; },
        tick(ms) {
            t += ms;
            const q = queue;
            queue = [];
            for (const fn of q) fn(t);
        }
    };
}

function make(opts = {}) {
    const host = dom.document.createElement('div');
    const meter = new CashMeter(host, { currency: 'EUR', ...opts });
    return { host, meter };
}

const START = { cash: 500e6, startingCash: 500e6, redLine: 100e6 };

test('formatCash: short money with the currency symbol', () => {
    assert.equal(formatCash(512.34e6, 'EUR'), '€512.3m');
    assert.equal(formatCash(1.25e9, 'USD'), '$1.25bn');
    assert.equal(formatCash(-4.2e6, 'GBP'), '-£4.2m');
    assert.equal(formatCash(12_500, 'EUR'), '€13k');
    assert.equal(formatCash(800, 'CHF'), 'CHF 800');
});

test('set() with no animation shows the cash, fill level and red line at once', async () => {
    const { host, meter } = make();
    await meter.set(START);
    assert.equal(meter.value, 500e6);
    assert.equal(host.querySelector('.cm-value').textContent, '€500.0m');
    // The bar spans 0..1.5 × starting cash, so starting cash fills two thirds.
    assert.ok(Math.abs(meter.level - 2 / 3) < 1e-9);
    assert.equal(host.querySelector('.cm-fill').style.width, '66.7%');
    assert.equal(host.querySelector('.cm-redline').style.left, '13.3%');
    assert.equal(host.querySelector('.cm-sub').textContent, 'Red line €100.0m');
    assert.equal(meter.state, 'ok');
    assert.equal(host.querySelector('.cm-delta').hidden, true, 'no change to show on the first set');
});

test('below the red line the meter turns to danger; the level clamps to 0..1', async () => {
    const { host, meter } = make();
    await meter.set({ ...START, cash: 50e6 });
    assert.equal(meter.state, 'danger');
    assert.ok(host.querySelector('.cash-meter').classList.contains('is-danger'));
    await meter.set({ ...START, cash: -20e6 });
    assert.equal(meter.level, 0);
    await meter.set({ ...START, cash: 2e9 });
    assert.equal(meter.level, 1);
    assert.equal(meter.state, 'ok');
});

test('the change since the last set is shown, signed', async () => {
    const { host, meter } = make();
    await meter.set(START);
    await meter.set({ ...START, cash: 512e6 });
    const delta = host.querySelector('.cm-delta');
    assert.equal(delta.hidden, false);
    assert.equal(delta.textContent, '+€12.0m');
    assert.ok(delta.classList.contains('is-up'));
    await meter.set({ ...START, cash: 500e6 });
    assert.equal(delta.textContent, '-€12.0m');
    assert.ok(delta.classList.contains('is-down'));
});

test('set() animates the number over animateMs and resolves at the end', async () => {
    const c = clock();
    const { host, meter } = make({ env: c });
    await meter.set(START);
    let done = false;
    const p = meter.set({ ...START, cash: 600e6 }, 1000).then(() => { done = true; });
    c.tick(0);
    const shown = () => host.querySelector('.cm-value').textContent;
    assert.equal(shown(), '€500.0m');
    c.tick(500);
    const mid = meter.displayed;
    assert.ok(mid > 500e6 && mid < 600e6, `mid-animation value ${mid}`);
    await Promise.resolve();
    assert.equal(done, false);
    c.tick(600);
    await p;
    assert.equal(done, true);
    assert.equal(shown(), '€600.0m');
    assert.equal(meter.value, 600e6);
});

test('a new set() mid-animation finishes the old promise and starts from the shown value', async () => {
    const c = clock();
    const { meter } = make({ env: c });
    await meter.set(START);
    const first = meter.set({ ...START, cash: 700e6 }, 1000);
    c.tick(0);
    c.tick(500);
    const second = meter.set({ ...START, cash: 400e6 }, 0);
    await first;   // resolves rather than hanging
    await second;
    assert.equal(meter.value, 400e6);
    assert.equal(meter.displayed, 400e6);
});

test('reduced motion skips the animation', async () => {
    const c = clock();
    const { meter } = make({ env: { ...c, matchMedia: () => ({ matches: true }) } });
    await meter.set(START);
    await meter.set({ ...START, cash: 600e6 }, 1000);   // resolves with no ticks
    assert.equal(meter.displayed, 600e6);
});

test('non-finite inputs never throw and show nothing silly', async () => {
    const { host, meter } = make();
    await meter.set({ cash: NaN, startingCash: 0, redLine: undefined });
    assert.equal(meter.level, 0);
    assert.equal(host.querySelector('.cm-value').textContent, '€0');
});
