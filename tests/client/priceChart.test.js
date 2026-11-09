import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartSeries, drawPriceChart, mountPriceChart, chartLabel, chartInverted } from '../../js/ui/PriceChart.js';

// Monthly series 2000-01 .. 2003-12 where the value is the month index + 1 (so slices are easy to read).
function series(fromIdx = 0, toIdx = 47, skip = []) {
    const out = {};
    for (let i = fromIdx; i <= toIdx; i++) {
        if (skip.includes(i)) continue;
        out[`${2000 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`] = i + 1;
    }
    return out;
}

test('chartSeries: trailing 12 history months to the quarter start, then the quarter start plus 3 months', () => {
    // Run quarter index 1 from 2001 is Q2 2001, which starts at 2001-04 (index 15, value 16).
    const s = chartSeries(series(), 2001, 1);
    assert.deepEqual(s.history, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    assert.deepEqual(s.quarter, [16, 17, 18, 19]);
});

test('chartSeries: returns null when the series starts after the quarter', () => {
    assert.equal(chartSeries(series(30, 47), 2001, 1), null);
    assert.equal(chartSeries({}, 2001, 1), null);
    assert.equal(chartSeries(null, 2001, 1), null);
    assert.equal(chartSeries(undefined, 2001, 1), null);
});

test('chartSeries: a series that starts mid-history gives a shorter history, not a throw', () => {
    const s = chartSeries(series(13, 47), 2001, 1);   // starts 2001-02
    assert.deepEqual(s.history, [14, 15, 16]);
    assert.deepEqual(s.quarter, [16, 17, 18, 19]);
});

test('chartSeries: gaps are skipped and values are never NaN', () => {
    const gappy = series(0, 47, [10, 11, 17]);
    gappy['2001-06-01'] = NaN;
    gappy['2001-05-01'] = 'x';
    const s = chartSeries(gappy, 2001, 1);
    for (const v of [...s.history, ...s.quarter]) assert.ok(Number.isFinite(v));
    assert.ok(s.history.length < 12);
});

test('chartSeries: the quarter slice never goes past the quarter end', () => {
    const s = chartSeries(series(), 2001, 1);
    assert.ok(Math.max(...s.quarter) <= 19);          // 2001-07 is the next quarter start
    assert.ok(s.quarter.length <= 4);
    // A series that stops mid-quarter gives a short quarter slice, and fewer than 2 points is null.
    assert.deepEqual(chartSeries(series(0, 17), 2001, 1).quarter, [16, 17, 18]);
    assert.equal(chartSeries(series(0, 15), 2001, 1), null);
});

test('chartSeries upTo start: history only, nothing after the current quarter start', () => {
    const s = chartSeries(series(), 2001, 1, { upTo: 'start' });
    assert.deepEqual(s.quarter, []);
    assert.equal(s.history.at(-1), 16);
    assert.ok(Math.max(...s.history) <= 16);
    assert.equal(chartSeries(series(15, 47), 2001, 1, { upTo: 'start' }), null, 'one point is not a line');
    assert.equal(chartSeries(series(30, 47), 2001, 1, { upTo: 'start' }), null);
});

test('chartSeries invert: shows the other side of an FX pair', () => {
    const s = chartSeries(series(), 2001, 1, { invert: true });
    assert.equal(s.quarter[0], 1 / 16);
});

test('chartInverted and chartLabel follow the result-line wording', () => {
    assert.equal(chartInverted({ type: 'fx', underlying: 'EURUSD', unit: 'USD' }), true);
    assert.equal(chartInverted({ type: 'fx', underlying: 'EURUSD', unit: 'EUR' }), false);
    assert.equal(chartInverted({ type: 'commodity', underlying: 'BRENT', unit: 'bbl' }), false);
    assert.equal(chartLabel({ type: 'commodity' }, 6.24), '+6.2%');
    assert.equal(chartLabel({ type: 'commodity' }, -0.04), '0.0%');
    assert.equal(chartLabel({ type: 'commodity' }, -3), '-3.0%');
    assert.equal(chartLabel({ type: 'ir' }, 0.25), '+0.25pp');
    assert.equal(chartLabel({ type: 'fx', underlying: 'EURUSD', unit: 'USD' }, 10), '-9.1%');
    assert.equal(chartLabel({ type: 'commodity' }, NaN), '0.0%');
});

// A recording canvas context.
function fakeCtx() {
    const calls = [];
    const ctx = { calls, canvas: { width: 0, height: 0 } };
    for (const m of ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'stroke', 'fill', 'clearRect',
        'setLineDash', 'setTransform', 'scale', 'fillRect']) ctx[m] = (...a) => calls.push([m, ...a]);
    ctx.fillText = (...a) => calls.push(['fillText', ...a]);
    ctx.measureText = t => ({ width: t.length * 7 });
    return ctx;
}
const DATA = chartSeries(series(), 2001, 1);
const texts = ctx => ctx.calls.filter(c => c[0] === 'fillText');

test('drawPriceChart draws only finite coordinates and text that is just the % move', () => {
    for (const progress of [0, 0.37, 1]) {
        const ctx = fakeCtx();
        drawPriceChart(ctx, { ...DATA, progress, hedgeRatio: 0.75, tone: 'down', label: '-3.0%', w: 320, h: 72 });
        for (const c of ctx.calls) {
            if (['moveTo', 'lineTo'].includes(c[0])) assert.ok(Number.isFinite(c[1]) && Number.isFinite(c[2]), `${c}`);
        }
        assert.ok(texts(ctx).every(c => c[1] === '-3.0%'), 'no dates, years or price levels');
    }
});

test('drawPriceChart: label only at the end, dashed locked line only when hedged', () => {
    const early = fakeCtx();
    drawPriceChart(early, { ...DATA, progress: 0.4, hedgeRatio: 0, tone: 'up', label: '+1.0%', w: 320, h: 72 });
    assert.equal(texts(early).length, 0);
    assert.ok(!early.calls.some(c => c[0] === 'setLineDash' && c[1].length));
    const done = fakeCtx();
    drawPriceChart(done, { ...DATA, progress: 1, hedgeRatio: 0.5, tone: 'up', label: '+1.0%', w: 320, h: 72 });
    assert.equal(texts(done).length, 1);
    assert.ok(done.calls.some(c => c[0] === 'setLineDash' && c[1].length), 'dashed locked line');
});

test('drawPriceChart survives empty and degenerate input', () => {
    const ctx = fakeCtx();
    drawPriceChart(ctx, { history: [], quarter: [], progress: 1, w: 100, h: 40 });
    drawPriceChart(ctx, { history: [5, 5, 5], quarter: [5, 5], progress: 1, hedgeRatio: 1, w: 100, h: 40 });
    drawPriceChart(ctx, { history: [1, NaN, 3], quarter: [3], progress: 0.5, w: 0, h: 0 });
    for (const c of ctx.calls) for (const a of c.slice(1)) if (typeof a === 'number') assert.ok(Number.isFinite(a));
});

// A manual clock for mountPriceChart.
function clock() {
    let t = 0, q = [], id = 0;
    const listeners = {};
    const doc = {
        hidden: false,
        addEventListener: (e, f) => { listeners[e] = f; },
        removeEventListener: (e) => { delete listeners[e]; }
    };
    return {
        doc, listeners,
        env: {
            document: doc,
            requestAnimationFrame: fn => { q.push([++id, fn]); return id; },
            cancelAnimationFrame: i => { q = q.filter(([k]) => k !== i); },
            matchMedia: () => ({ matches: false })
        },
        pending: () => q.length,
        tick(ms) { t += ms; const run = q; q = []; for (const [, fn] of run) fn(t); }
    };
}
function host(ctx) {
    const canvas = { style: {}, width: 0, height: 0, getContext: () => ctx, setAttribute() {}, remove() {} };
    const el = { clientWidth: 300, appendChild(c) { return c; }, append() {} };
    return { el, canvas };
}

test('mountPriceChart animates to the end, skip() completes at once, destroy() stops the loop', () => {
    const c = clock();
    const ctx = fakeCtx();
    const { el, canvas } = host(ctx);
    const chart = mountPriceChart(el, { ...DATA, hedgeRatio: 0, tone: 'up', label: '+1.0%', env: { ...c.env, createCanvas: () => canvas } });
    assert.ok(c.pending() > 0, 'animating');
    c.tick(16); c.tick(500);
    assert.equal(texts(ctx).length, 0, 'not finished yet');
    chart.skip();
    assert.equal(texts(ctx).length, 1, 'skip draws the final frame with the label');
    assert.equal(c.pending(), 0, 'loop stopped');
    chart.skip();   // idempotent
    chart.destroy();
    chart.destroy();
    assert.equal(c.listeners.visibilitychange, undefined, 'listener removed');
});

test('mountPriceChart: reduced motion draws the final frame at once, no loop', () => {
    const c = clock();
    const ctx = fakeCtx();
    const { el, canvas } = host(ctx);
    mountPriceChart(el, { ...DATA, tone: 'down', label: '-2.0%', env: { ...c.env, matchMedia: () => ({ matches: true }), createCanvas: () => canvas } });
    assert.equal(texts(ctx).length, 1);
    assert.equal(c.pending(), 0);
});

test('mountPriceChart: a hidden tab does not advance the animation', () => {
    const c = clock();
    const ctx = fakeCtx();
    const { el, canvas } = host(ctx);
    const chart = mountPriceChart(el, { ...DATA, tone: 'up', label: '+1.0%', durationMs: 1000, env: { ...c.env, createCanvas: () => canvas } });
    c.tick(16);
    c.doc.hidden = true; c.listeners.visibilitychange();
    assert.equal(c.pending(), 0, 'frame cancelled while hidden');
    c.doc.hidden = false; c.listeners.visibilitychange();
    c.tick(5000);   // the first frame back only re-bases the clock
    assert.equal(texts(ctx).length, 0, 'time spent hidden does not count');
    c.tick(1200);
    assert.equal(texts(ctx).length, 1);
    chart.destroy();
});

test('mountPriceChart: static variant draws once and never loops; no context is tolerated', () => {
    const c = clock();
    const ctx = fakeCtx();
    const { el, canvas } = host(ctx);
    mountPriceChart(el, { history: DATA.history, quarter: [], variant: 'spark', tone: 'neutral', env: { ...c.env, createCanvas: () => canvas } });
    assert.equal(c.pending(), 0);
    assert.ok(ctx.calls.some(x => x[0] === 'lineTo'));
    assert.equal(texts(ctx).length, 0);
    const none = host(null);
    const chart = mountPriceChart(none.el, { ...DATA, env: { ...c.env, createCanvas: () => none.canvas } });
    chart.skip(); chart.destroy();
});
