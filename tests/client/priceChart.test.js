import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartSeries, drawPriceChart, mountPriceChart, chartLabel, chartInverted, createChartTicker, gridLines } from '../../js/ui/PriceChart.js';

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
    // A pair that lost 100% or more has no finite reverse: never Infinity or NaN text.
    for (const m of [-100, -150, -1e9]) {
        const t = chartLabel({ type: 'fx', underlying: 'EURUSD', unit: 'USD' }, m);
        assert.ok(/^[+-][0-9]+([.][0-9])?%$/.test(t), t);
    }
});

// A recording canvas context.
function fakeCtx() {
    const calls = [];
    const ctx = { calls, canvas: { width: 0, height: 0 } };
    for (const m of ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'stroke', 'fill', 'clearRect',
        'setLineDash', 'setTransform', 'scale', 'fillRect']) ctx[m] = (...a) => calls.push([m, ...a]);
    ctx.fill = () => calls.push(['fill', ctx.fillStyle]);
    ctx.fillText = (...a) => calls.push(['fillText', ...a]);
    ctx.measureText = t => ({ width: t.length * 7 });
    ctx.strokeStyle = ''; ctx.fillStyle = '';
    return ctx;
}
const DATA = chartSeries(series(), 2001, 1);
const texts = ctx => ctx.calls.filter(c => c[0] === 'fillText');
// The end label only (v3.2 charts also draw % gridline labels).
const ends = (ctx, label) => texts(ctx).filter(c => c[1] === label);
const PCT_LABEL = /^(0|[+-]\d+(\.\d+)?)(%|pp)$/;

test('drawPriceChart draws only finite coordinates and text that is just the % move', () => {
    for (const progress of [0, 0.37, 1]) {
        const ctx = fakeCtx();
        drawPriceChart(ctx, { ...DATA, progress, hedgeRatio: 0.75, tone: 'down', label: '-3.0%', w: 320, h: 72 });
        for (const c of ctx.calls) {
            if (['moveTo', 'lineTo'].includes(c[0])) assert.ok(Number.isFinite(c[1]) && Number.isFinite(c[2]), `${c}`);
        }
        assert.ok(texts(ctx).every(c => PCT_LABEL.test(c[1])), 'no dates, years or price levels');
        assert.ok(ends(ctx, '-3.0%').length <= 1);
    }
});

test('drawPriceChart: label only at the end, dashed locked line only when hedged', () => {
    const early = fakeCtx();
    drawPriceChart(early, { ...DATA, progress: 0.4, hedgeRatio: 0, tone: 'up', label: '+1.0%', w: 320, h: 72 });
    assert.equal(ends(early, '+1.0%').length, 0);
    assert.ok(!early.calls.some(c => c[0] === 'setLineDash' && c[1].length));
    const done = fakeCtx();
    drawPriceChart(done, { ...DATA, progress: 1, hedgeRatio: 0.5, tone: 'up', label: '+1.0%', w: 320, h: 72 });
    assert.equal(ends(done, '+1.0%').length, 1);
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
    assert.equal(ends(ctx, '+1.0%').length, 0, 'not finished yet');
    chart.skip();
    assert.equal(ends(ctx, '+1.0%').length, 1, 'skip draws the final frame with the label');
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
    assert.equal(ends(ctx, '-2.0%').length, 1);
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
    assert.equal(ends(ctx, '+1.0%').length, 0, 'time spent hidden does not count');
    c.tick(1200);
    assert.equal(ends(ctx, '+1.0%').length, 1);
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

test('the protected shading uses the lock colour, not the move colour', () => {
    const ctx = fakeCtx();
    drawPriceChart(ctx, { ...DATA, progress: 1, hedgeRatio: 0.75, tone: 'down', label: '-3.0%', w: 320, h: 72,
        colors: { down: '#ff0000', lock: '#ffcc00' } });
    const fills = ctx.calls.filter(c => c[0] === 'fill').map(c => c[1]);
    assert.ok(fills.includes('#ffcc00'), 'shade is gold');
    assert.ok(fills.includes('#ff0000'), 'end marker keeps the move colour');
    assert.equal(fills.filter(f => f === '#ff0000').length, 1, 'only the marker, not the shade');
});

test('the sparkline uses most of its 24 px height', () => {
    const ctx = fakeCtx();
    drawPriceChart(ctx, { history: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], quarter: [], variant: 'spark', w: 200, h: 24 });
    const ys = ctx.calls.filter(c => c[0] === 'moveTo' || c[0] === 'lineTo').map(c => c[2]);
    assert.ok(Math.max(...ys) - Math.min(...ys) >= 18, `range ${Math.max(...ys) - Math.min(...ys)}`);
});

test('the end label always fits inside the canvas, even a long one', () => {
    for (const label of ['+6.2%', '+123.4%', '-100.0%']) {
        const ctx = fakeCtx();
        drawPriceChart(ctx, { ...DATA, progress: 1, tone: 'up', label, w: 200, h: 72 });
        const [, , x] = ends(ctx, label)[0];
        assert.ok(x + ctx.measureText(label).width <= 200, `${label} at ${x}`);
        assert.ok(x >= 0);
    }
});

test('a shared ticker drives many charts from one frame loop and stops when they finish', () => {
    const c = clock();
    const ticker = createChartTicker(c.env);
    const ctxs = [fakeCtx(), fakeCtx(), fakeCtx()];
    const charts = ctxs.map(ctx => {
        const { el, canvas } = host(ctx);
        return mountPriceChart(el, { ...DATA, tone: 'up', label: '+1.0%', ticker, env: { ...c.env, createCanvas: () => canvas } });
    });
    assert.equal(c.pending(), 1, 'one frame request for three charts');
    c.tick(16); c.tick(1000);
    assert.ok(ctxs.every(x => ends(x, '+1.0%').length === 0));
    c.tick(1000);
    assert.ok(ctxs.every(x => ends(x, '+1.0%').length === 1), 'all finished');
    assert.equal(c.pending(), 0, 'loop stops');
    assert.equal(c.listeners.visibilitychange, undefined);
    charts.forEach(ch => ch.destroy());
});

test('a shared ticker pauses when hidden and destroy() cancels it', () => {
    const c = clock();
    const ticker = createChartTicker(c.env);
    const { el, canvas } = host(fakeCtx());
    mountPriceChart(el, { ...DATA, ticker, env: { ...c.env, createCanvas: () => canvas } });
    c.doc.hidden = true; c.listeners.visibilitychange();
    assert.equal(c.pending(), 0);
    c.doc.hidden = false; c.listeners.visibilitychange();
    assert.equal(c.pending(), 1);
    ticker.destroy();
    assert.equal(c.pending(), 0);
    assert.equal(c.listeners.visibilitychange, undefined);
});

test('the canvas follows the laid-out width and re-measures on resize and orientation change', () => {
    const c = clock();
    const ctx = fakeCtx();
    const { el, canvas } = host(ctx);
    const win = { l: {}, addEventListener(e, f) { this.l[e] = f; }, removeEventListener(e) { delete this.l[e]; } };
    el.clientWidth = 336;
    const chart = mountPriceChart(el, { ...DATA, tone: 'up', label: '+1.0%', env: { ...c.env, window: win, createCanvas: () => canvas } });
    assert.equal(canvas.style.width, '336px');
    el.clientWidth = 640;   // rotated
    win.l.orientationchange();
    assert.equal(canvas.style.width, '640px');
    el.clientWidth = 300;
    win.l.resize();
    assert.equal(canvas.style.width, '300px');
    chart.destroy();
    assert.deepEqual(Object.keys(win.l), [], 'listeners removed');
});

// ── v3.2: weekly data, pinning, gridlines, month markers ────────────────────

const DAY = 864e5;
// A weekly series from Friday 1999-12-31: a wavy line at a different level from the monthly fixture (the pinning
// has to bring it onto the monthly values). `edit(i, t, base)` can replace a week's value (null = gap).
function weekly(edit = null, { anchor = 'avg', weeks = 260 } = {}) {
    const t0 = Date.UTC(1999, 11, 31);
    const v = [];
    for (let i = 0; i < weeks; i++) {
        const base = 50 + 10 * Math.sin(i / 3);
        v.push(edit ? edit(i, t0 + i * 7 * DAY, base) : base);
    }
    return { t0, anchor, v };
}
const START_Q = Date.UTC(2001, 3, 15);   // the 'avg' anchor of 2001-04, the quarter start in these tests

test('weekly: the quarter line is pinned so its ends equal the engine start and end rates exactly', () => {
    const s = chartSeries(series(), 2001, 1, { weekly: weekly() });
    assert.equal(s.source, 'weekly');
    assert.equal(s.quarter[0], 16, 'engine start rate (2001-04)');
    assert.equal(s.quarter.at(-1), 19, 'engine end rate (2001-07)');
    assert.ok(s.quarter.length >= 12 && s.quarter.length <= 15, `about one point a week: ${s.quarter.length}`);
    for (const v of [...s.history, ...s.quarter]) assert.ok(Number.isFinite(v));
    // The trailing history is pinned the same way, so the join is seamless.
    assert.equal(s.history[0], 5, 'monthly value 11 months back');
    assert.equal(s.history.at(-1), 16, 'joins the quarter at the start rate');
    assert.ok(s.history.length >= 45, `weekly history: ${s.history.length}`);
});

test('weekly: a month-end anchor pins at the month ends; inverted pairs pin to the inverted rates', () => {
    const end = chartSeries(series(), 2001, 1, { weekly: weekly(null, { anchor: 'end' }) });
    assert.equal(end.source, 'weekly');
    assert.deepEqual([end.quarter[0], end.quarter.at(-1)], [16, 19]);
    const inv = chartSeries(series(), 2001, 1, { invert: true, weekly: weekly() });
    assert.equal(inv.quarter[0], 1 / 16);
    assert.equal(inv.quarter.at(-1), 1 / 19);
    assert.equal(inv.history.at(-1), 1 / 16);
});

test('weekly: a one-week gap is bridged; a long gap or a late start falls back to monthly, never NaN', () => {
    const oneGap = chartSeries(series(), 2001, 1, { weekly: weekly((i, t, b) => (Math.abs(t - START_Q - 21 * DAY) < 4 * DAY ? null : b)) });
    assert.equal(oneGap.source, 'weekly');
    for (const v of [...oneGap.history, ...oneGap.quarter]) assert.ok(Number.isFinite(v));
    const longGap = chartSeries(series(), 2001, 1, { weekly: weekly((i, t, b) => (t > START_Q + 10 * DAY && t < START_Q + 50 * DAY ? null : b)) });
    assert.equal(longGap.source, 'monthly');
    assert.deepEqual(longGap.quarter, [16, 17, 18, 19]);
    assert.deepEqual(longGap.history, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const late = chartSeries(series(), 2001, 1, { weekly: weekly((i, t, b) => (t < Date.UTC(2000, 11, 1) ? null : b)) });
    assert.equal(late.source, 'monthly', 'weekly data starting inside the history window');
    const bad = chartSeries(series(), 2001, 1, { weekly: weekly(() => NaN) });
    assert.equal(bad.source, 'monthly');
});

test('weekly not loaded (or unusable): the chart uses the monthly series', () => {
    for (const w of [null, undefined, {}, { t0: NaN, v: [] }, { t0: 0, v: 'x' }]) {
        const s = chartSeries(series(), 2001, 1, { weekly: w });
        assert.equal(s.source, 'monthly');
        assert.deepEqual(s.quarter, [16, 17, 18, 19]);
    }
    // No monthly end rate: the weekly quarter cannot be pinned, so the monthly (short) slice is used.
    assert.deepEqual(chartSeries(series(0, 17), 2001, 1, { weekly: weekly() }).quarter, [16, 17, 18]);
    assert.equal(chartSeries(series(30, 47), 2001, 1, { weekly: weekly() }), null);
});

test('sparkline (upTo start) with weekly data: no point after the quarter start can reach it', () => {
    const a = chartSeries(series(), 2001, 1, { upTo: 'start', weekly: weekly() });
    const b = chartSeries(series(), 2001, 1, { upTo: 'start', weekly: weekly((i, t, base) => (t >= START_Q ? 1e6 : base)) });
    assert.equal(a.source, 'weekly');
    assert.deepEqual(a.quarter, []);
    assert.equal(a.history.at(-1), 16);
    assert.deepEqual(b.history, a.history, 'values after the start change nothing');
    const endAnchor = chartSeries(series(), 2001, 1, { upTo: 'start',
        weekly: weekly((i, t, base) => (t > Date.UTC(2001, 3, 30) ? 1e6 : base), { anchor: 'end' }) });
    assert.equal(endAnchor.source, 'weekly');
    assert.ok(Math.max(...endAnchor.history) < 1e3);
});

test('gridLines: sensible steps, labelled only as a % (or pp) change from the quarter start', () => {
    assert.deepEqual(gridLines(-12, 8, 94).map(x => x.label), ['-10%', '-5%', '0%', '+5%']);
    assert.deepEqual(gridLines(-1.4, 2.2, 94).map(x => x.label), ['-1%', '0%', '+1%', '+2%']);
    assert.deepEqual(gridLines(0, 0, 94).map(x => x.label), ['0%']);
    assert.deepEqual(gridLines(-0.3, 0.6, 94, 'pp').map(x => x.label), ['-0.25pp', '0pp', '+0.25pp', '+0.5pp']);
    for (const [lo, hi, px] of [[-50, 80, 64], [-3, 0.5, 64], [-0.2, 0.2, 94], [-200, 400, 94]]) {
        const lines = gridLines(lo, hi, px);
        assert.ok(lines.length >= 1 && lines.length <= 5, `${lo}..${hi}: ${lines.length}`);
        for (const l of lines) assert.match(l.label, /^(0|[+-]\d+(\.\d+)?)%$/);
        for (let i = 1; i < lines.length; i++) assert.ok((lines[i].value - lines[i - 1].value) / (hi - lo) * px >= 16, 'room for a 12px label');
    }
});

test('the result chart draws faint % gridlines with % labels only, and three month markers', () => {
    const s = chartSeries(series(), 2001, 1, { weekly: weekly() });
    const ctx = fakeCtx();
    drawPriceChart(ctx, { ...s, progress: 1, hedgeRatio: 0.5, tone: 'up', label: '+18.8%', w: 320, h: 110 });
    const t = texts(ctx).map(c => c[1]);
    assert.ok(t.length >= 3, t.join(' '));
    for (const x of t) assert.match(x, PCT_LABEL, 'no dates, years, month names or price levels');
    for (const c of texts(ctx)) assert.ok(c[2] >= 0 && c[3] >= 0 && c[3] <= 110);
    // Vertical segments (same x, different y): the three month markers.
    const vertical = [];
    for (let i = 1; i < ctx.calls.length; i++) {
        const [a, b] = [ctx.calls[i - 1], ctx.calls[i]];
        if (a[0] === 'moveTo' && b[0] === 'lineTo' && a[1] === b[1] && a[2] !== b[2]) vertical.push(a[1]);
    }
    assert.equal(vertical.length, 3, `markers at ${vertical}`);
    for (const x of vertical) assert.equal(x % 1, 0.5, 'pixel-crisp');
    // The sparkline has neither.
    const spark = fakeCtx();
    drawPriceChart(spark, { history: s.history, quarter: [], variant: 'spark', w: 200, h: 24 });
    assert.equal(texts(spark).length, 0);
});

test('an interest-rate chart labels its gridlines in pp', () => {
    const ctx = fakeCtx();
    drawPriceChart(ctx, { history: [0.03, 0.031, 0.032], quarter: [0.032, 0.034, 0.036, 0.035], scale: 'pp',
        progress: 1, tone: 'up', label: '+0.30pp', w: 320, h: 110 });
    const grid = texts(ctx).map(c => c[1]).filter(x => x !== '+0.30pp');
    assert.ok(grid.length >= 2);
    for (const x of grid) assert.match(x, /^(0|[+-]\d+(\.\d+)?)pp$/);
});

test('v3.2: a result chart is about 110 px tall by default, the sparkline stays 24 px, both integer-crisp', () => {
    const c = clock();
    const big = host(fakeCtx());
    mountPriceChart(big.el, { ...DATA, tone: 'up', label: '+1.0%', env: { ...c.env, matchMedia: () => ({ matches: true }), createCanvas: () => big.canvas } });
    assert.equal(big.canvas.style.height, '110px');
    assert.ok(Number.isInteger(big.canvas.width) && Number.isInteger(big.canvas.height));
    const small = host(fakeCtx());
    mountPriceChart(small.el, { history: DATA.history, quarter: [], variant: 'spark', env: { ...c.env, createCanvas: () => small.canvas } });
    assert.equal(small.canvas.style.height, '24px');
});
