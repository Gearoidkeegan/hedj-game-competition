// PriceChart: the real market line behind a Simple-mode exposure. Shape and % move only: no dates, years, month
// names or price levels (the start year stays secret until game over). The only text is the end label (the % move)
// and the faint gridline labels, which are a % (pp for interest rates) change from the quarter start.
//
//   chartSeries(dataset, startYear, quarter, opts) -> { history, quarter, source } | null     pure
//   gridLines(lo, hi, px, scale) -> [{ value, label }]                                        pure
//   drawPriceChart(ctx, { history, quarter, progress, hedgeRatio, tone, label, scale, w, h, variant, colors })
//   mountPriceChart(container, opts) -> { skip(), destroy() }
//
// `quarter` is the 0-based run quarter (the engine's calendar index). The monthly dataset is keyed YYYY-MM-01.
// history = up to 12 months ending on the quarter's start month; quarter = that start plus the 3 months after it
// (the last one is the next quarter's start, which is the rate the engine settles the quarter at).
//
// v3.2: with opts.weekly (MarketEngine.getWeekly) the same windows are drawn from weekly closes, pinned so each
// window starts and ends exactly on the engine's monthly values (see pinnedWindow). Missing or patchy weekly data
// falls back to the monthly series for the whole chart.

import { calendar } from '../engine/sim/SimEngine.js';

const HISTORY_MONTHS = 12;
const QUARTER_MONTHS = 3;
export const CHART_MS = 1800;
const DEFAULT_MS = CHART_MS;
const PAD = { top: 8, bottom: 8, left: 4, right: 4 };
const SPARK_PAD = { top: 2, bottom: 2, left: 1, right: 1 };
const LABEL_FONT = 'bold 14px system-ui, sans-serif';
const GRID_FONT = '12px system-ui, sans-serif';
const HISTORY_SHARE = 0.4;          // of the plot width, when a chart shows both history and the quarter
const MIN_GRID_PX = 16;             // between gridlines: room for a 12 px label
const MAX_GRID_LINES = 5;
const DAY = 864e5;
const WEEK = 7 * DAY;
const MAX_GAP = 21 * DAY;           // weekly points further apart than this: use the monthly data instead

const keyFor = idx => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
const usable = v => typeof v === 'number' && Number.isFinite(v);

// When the monthly value for month `idx` was observed: mid-month for a monthly average, the last day for a month-end
// close (the weekly file says which, per series).
function anchorTime(idx, anchor) {
    const y = Math.floor(idx / 12);
    const m = idx % 12;
    return anchor === 'end' ? Date.UTC(y, m + 1, 0) : Date.UTC(y, m, 15);
}

// Weekly closes between the monthly values of months aIdx and bIdx, pinned to them: a correction factor that runs
// linearly from A / raw(start) to B / raw(end) scales every weekly point, and the ends are A and B exactly. raw(t) is
// the last weekly close at or before t, so a window never uses a price from after its end. null when the weekly
// data has a gap longer than MAX_GAP in the window (or no close near its ends).
function pinnedWindow(wk, flip, aIdx, bIdx, A, B) {
    const ta = anchorTime(aIdx, wk.anchor);
    const tb = anchorTime(bIdx, wk.anchor);
    const value = i => {
        const x = i >= 0 && i < wk.v.length ? wk.v[i] : null;
        const v = usable(x) && x > 0 ? flip(x) : NaN;
        return usable(v) ? v : null;
    };
    const rawAt = t => {
        for (let i = Math.floor((t - wk.t0) / WEEK); i >= 0 && t - (wk.t0 + i * WEEK) <= MAX_GAP; i--) {
            const v = value(i);
            if (v !== null) return v;
        }
        return null;
    };
    const ra = rawAt(ta);
    const rb = rawAt(tb);
    if (ra === null || rb === null) return null;
    const ca = A / ra;
    const cb = B / rb;
    const out = [A];
    let prev = ta;
    for (let i = Math.max(0, Math.floor((ta - wk.t0) / WEEK) + 1); wk.t0 + i * WEEK < tb; i++) {
        const t = wk.t0 + i * WEEK;
        if (t <= ta) continue;
        const v = value(i);
        if (v === null) continue;
        if (t - prev > MAX_GAP) return null;
        const p = v * (ca + (cb - ca) * ((t - ta) / (tb - ta)));
        if (!usable(p)) return null;
        out.push(p);
        prev = t;
    }
    if (tb - prev > MAX_GAP) return null;
    out.push(B);
    return out;
}

function usableWeekly(wk) {
    return !!wk && typeof wk === 'object' && usable(wk.t0) && Array.isArray(wk.v) && wk.v.length > 0;
}

export function chartSeries(dataset, startYear, quarter, opts = {}) {
    if (!dataset || typeof dataset !== 'object' || !Number.isFinite(startYear) || !Number.isFinite(quarter)) return null;
    const cal = calendar(startYear, quarter);
    const m0 = cal.year * 12 + (cal.quarter - 1) * 3;
    const flip = v => (opts.invert ? (v > 0 ? 1 / v : NaN) : v);
    const at = idx => {
        const raw = dataset[keyFor(idx)];
        const v = usable(raw) ? flip(raw) : NaN;
        return usable(v) ? v : null;
    };
    if (usableWeekly(opts.weekly)) {
        const weekly = weeklySeries(opts.weekly, flip, at, m0, opts.upTo === 'start');
        if (weekly) return weekly;
    }
    return monthlySeries(at, m0, opts.upTo === 'start');
}

// The weekly version of the monthly windows below, or null (then the chart uses the monthly series).
function weeklySeries(wk, flip, at, m0, upToStart) {
    const S = at(m0);
    if (S === null) return null;
    let aIdx = null;
    for (let i = m0 - (HISTORY_MONTHS - 1); i < m0; i++) {
        if (at(i) !== null) { aIdx = i; break; }
    }
    const history = aIdx === null ? [S] : pinnedWindow(wk, flip, aIdx, m0, at(aIdx), S);
    if (!history) return null;
    if (upToStart) return history.length >= 2 ? { history, quarter: [], source: 'weekly' } : null;
    const E = at(m0 + QUARTER_MONTHS);
    if (E === null) return null;
    const q = pinnedWindow(wk, flip, m0, m0 + QUARTER_MONTHS, S, E);
    return q ? { history, quarter: q, source: 'weekly' } : null;
}

// The v3.1 monthly windows (and the fallback when weekly data is missing or patchy).
function monthlySeries(at, m0, upToStart) {
    const history = [];
    for (let i = m0 - (HISTORY_MONTHS - 1); i <= m0; i++) {
        const v = at(i);
        if (v !== null) history.push(v);
    }
    if (upToStart) {
        return history.length >= 2 ? { history, quarter: [], source: 'monthly' } : null;
    }
    if (at(m0) === null) return null;
    const q = [];
    for (let i = m0; i <= m0 + QUARTER_MONTHS; i++) {
        const v = at(i);
        if (v !== null) q.push(v);
    }
    return q.length >= 2 ? { history, quarter: q, source: 'monthly' } : null;
}

// Horizontal gridlines for a chart whose values run from lo to hi (as a change from the quarter start: % or, for
// interest rates, pp) over px pixels: the smallest sensible step that leaves room for a label between lines.
const STEPS = { pct: [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000], pp: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10] };
export function gridLines(lo, hi, px, scale = 'pct') {
    const unit = scale === 'pp' ? 'pp' : '%';
    const steps = STEPS[scale === 'pp' ? 'pp' : 'pct'];
    const fmt = v => {
        if (v === 0) return `0${unit}`;
        const a = Math.abs(v);
        const s = Number.isInteger(a) ? String(a) : String(Number(a.toFixed(2)));
        return `${v > 0 ? '+' : '-'}${s}${unit}`;
    };
    const span = hi - lo;
    if (!usable(lo) || !usable(hi) || !(span > 0) || !(px > 0)) return [{ value: 0, label: fmt(0) }];
    const count = step => Math.floor(hi / step + 1e-9) - Math.ceil(lo / step - 1e-9) + 1;
    const step = steps.find(s => (s / span) * px >= MIN_GRID_PX && count(s) <= MAX_GRID_LINES) ?? steps[steps.length - 1];
    const out = [];
    for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + 1e-9 * step; k++) {
        const value = Number((k * step).toFixed(4)) || 0;   // || 0: never -0
        out.push({ value, label: fmt(value) });
    }
    return out.length ? out : [{ value: 0, label: fmt(0) }];
}

// Does the exposure's currency sit as the quote of the pair (EURUSD for dollars)? Then the chart shows the
// reverse, so the line moves the way the result line's "Dollar +6%" does (see unitMovePct in ResultScreen).
export function chartInverted(exposure) {
    return exposure?.type === 'fx' && typeof exposure.underlying === 'string' && typeof exposure.unit === 'string'
        && exposure.underlying.endsWith(exposure.unit);
}

// "+6.2%", "-3.0%", "0.0%", and "+0.25pp" for interest rates (the engine reports those in percentage points).
export function chartLabel(exposure, movePct) {
    let m = Number.isFinite(movePct) ? movePct : 0;
    if (exposure?.type === 'ir') {
        if (Math.abs(m) < 0.005) return '0.00pp';
        return `${m > 0 ? '+' : '-'}${Math.abs(m).toFixed(2)}pp`;
    }
    if (chartInverted(exposure)) {
        // A pair that lost 100% or more has no finite reverse; cap it so the text is never Infinity or NaN.
        m = m <= -100 ? 999 : 100 / (1 + m / 100) - 100;
    }
    if (Math.abs(m) < 0.05) return '0.0%';
    return `${m > 0 ? '+' : '-'}${Math.abs(m).toFixed(1)}%`;
}

const DEFAULT_COLORS = {
    up: '#33cc66', down: '#ff5a5a', neutral: '#b4b4d2', faint: '#b4b4d2', lock: '#ffcc00', text: '#ececf6'
};

function colorsFor(container) {
    const out = { ...DEFAULT_COLORS };
    try {
        const cs = globalThis.getComputedStyle?.(container);
        const read = (name, key) => {
            const v = cs?.getPropertyValue?.(name)?.trim();
            if (v) out[key] = v;
        };
        read('--v3-green', 'up'); read('--v3-red', 'down'); read('--v3-muted', 'neutral');
        read('--v3-muted', 'faint'); read('--v3-gold', 'lock'); read('--v3-text', 'text');
    } catch { /* defaults */ }
    return out;
}

export function drawPriceChart(ctx, opts = {}) {
    if (!ctx) return;
    const w = Number.isFinite(opts.w) && opts.w > 0 ? opts.w : 0;
    const h = Number.isFinite(opts.h) && opts.h > 0 ? opts.h : 0;
    const colors = { ...DEFAULT_COLORS, ...(opts.colors || {}) };
    const history = (opts.history || []).filter(usable);
    const quarter = (opts.quarter || []).filter(usable);
    const spark = opts.variant === 'spark';
    const progress = Math.min(1, Math.max(0, Number.isFinite(opts.progress) ? opts.progress : 1));
    const tone = opts.tone === 'up' || opts.tone === 'down' ? opts.tone : 'neutral';
    const accent = colors[tone];

    ctx.clearRect(0, 0, w, h);
    const all = [...history, ...quarter];
    if (!w || !h || all.length < 2) return;

    const showLabel = !spark && !!opts.label;
    const pad = spark ? SPARK_PAD : PAD;
    // Reserve exactly the room the label needs (measured), so a long one like "+123.4%" is never clipped.
    let labelW = 0;
    if (showLabel) {
        ctx.font = LABEL_FONT;
        const m = ctx.measureText?.(opts.label)?.width;
        labelW = Math.ceil(Number.isFinite(m) ? m : opts.label.length * 9) + 10;
    }
    const top = pad.top;
    const bottom = h - pad.bottom;
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const span = hi - lo;
    const yOf = v => (span > 0 ? bottom - ((v - lo) / span) * (bottom - top) : (top + bottom) / 2);

    // Gridlines (result chart only): a change from the quarter start, in % (pp for an interest rate).
    const pp = opts.scale === 'pp';
    const base = quarter.length ? quarter[0] : history[history.length - 1];
    let grid = [];
    if (!spark && (pp || base > 0)) {
        const delta = v => (pp ? (v - base) * 100 : (v / base - 1) * 100);
        const level = d => (pp ? base + d / 100 : base * (1 + d / 100));
        grid = gridLines(delta(lo), delta(hi), bottom - top, pp ? 'pp' : 'pct')
            .map(g => ({ ...g, y: yOf(level(g.value)) }))
            .filter(g => usable(g.y) && g.y >= top - 0.5 && g.y <= bottom + 0.5);
    }
    let gridW = 0;
    if (grid.length) {
        ctx.font = GRID_FONT;
        for (const g of grid) {
            const m = ctx.measureText?.(g.label)?.width;
            gridW = Math.max(gridW, Math.ceil(Number.isFinite(m) ? m : g.label.length * 7) + 6);
        }
    }
    const left = pad.left + gridW;
    const right = Math.max(left + 1, w - (showLabel ? labelW : pad.right));

    // The history takes HISTORY_SHARE of the width and the quarter the rest, so a weekly quarter has room to show
    // its detail; a chart with only one of them uses the whole width.
    const hasH = history.length > 1;
    const hasQ = quarter.length > 1;
    const split = hasH && hasQ ? left + (right - left) * HISTORY_SHARE : hasQ ? left : right;
    const spread = (n, i, x0, x1) => (n > 1 ? x0 + (i / (n - 1)) * (x1 - x0) : x1);
    const hist = history.map((v, i) => [spread(history.length, i, left, split), yOf(v)]);
    const quar = quarter.map((v, j) => [spread(quarter.length, j, split, right), yOf(v)]);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const trace = pts => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    };
    const crisp = v => Math.round(v) + 0.5;

    if (grid.length) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = colors.faint;
        for (const g of grid) {
            ctx.globalAlpha = g.value === 0 ? 0.3 : 0.15;
            ctx.beginPath();
            ctx.moveTo(left, crisp(g.y));
            ctx.lineTo(right, crisp(g.y));
            ctx.stroke();
        }
        ctx.globalAlpha = 0.75;
        ctx.font = GRID_FONT;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillStyle = colors.faint;
        for (const g of grid) ctx.fillText(g.label, 0, Math.min(Math.max(g.y, 7), h - 7));
    }

    // Three month markers across the quarter (the start of each month), no names.
    if (!spark && hasQ) {
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 1;
        ctx.strokeStyle = colors.faint;
        for (let k = 0; k < QUARTER_MONTHS; k++) {
            const x = crisp(split + ((right - split) * k) / QUARTER_MONTHS);
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, bottom);
            ctx.stroke();
        }
    }

    if (hist.length > 1) {
        ctx.globalAlpha = spark ? 1 : 0.4;
        ctx.strokeStyle = spark ? accent : colors.faint;
        ctx.lineWidth = 1.5;
        trace(hist);
        ctx.stroke();
    }

    // The part of the quarter drawn so far: whole months plus an interpolated tail.
    let shown = [];
    if (quar.length > 1) {
        const pos = progress * (quar.length - 1);
        const whole = Math.floor(pos);
        shown = quar.slice(0, whole + 1);
        const frac = pos - whole;
        if (frac > 0 && whole < quar.length - 1) {
            const [x0, y0] = quar[whole];
            const [x1, y1] = quar[whole + 1];
            shown.push([x0 + (x1 - x0) * frac, y0 + (y1 - y0) * frac]);
        }
    }

    const hedge = Number.isFinite(opts.hedgeRatio) ? opts.hedgeRatio : 0;
    if (!spark && shown.length > 1 && hedge > 0) {
        // The locked rate is the price at the quarter's start. Shade the gap between it and the price.
        const lockY = quar[0][1];
        ctx.globalAlpha = 0.16 + 0.24 * Math.min(1, hedge);
        ctx.fillStyle = colors.lock;
        ctx.beginPath();
        ctx.moveTo(shown[0][0], lockY);
        for (const [x, y] of shown) ctx.lineTo(x, y);
        ctx.lineTo(shown[shown.length - 1][0], lockY);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = colors.lock;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(quar[0][0], lockY);
        ctx.lineTo(quar[quar.length - 1][0], lockY);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    if (shown.length > 1) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = accent;
        ctx.lineWidth = spark ? 1.5 : 2.5;
        trace(shown);
        ctx.stroke();
    }

    if (!spark) {
        const end = shown.length ? shown[shown.length - 1] : (hist.length ? hist[hist.length - 1] : null);
        if (end) {
            ctx.globalAlpha = 1;
            ctx.fillStyle = accent;
            ctx.beginPath();
            ctx.moveTo(end[0] + 3, end[1]);
            ctx.lineTo(end[0], end[1] + 3);
            ctx.lineTo(end[0] - 3, end[1]);
            ctx.lineTo(end[0], end[1] - 3);
            ctx.closePath();
            ctx.fill();
            if (showLabel && progress >= 1) {
                ctx.font = LABEL_FONT;
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'left';
                ctx.fillStyle = accent;
                ctx.fillText(opts.label, Math.min(end[0] + 8, Math.max(0, w - labelW + 8)), Math.min(Math.max(end[1], 10), h - 10));
            }
        }
    }
    ctx.restore();
}
// One animation loop for a set of charts (the screen owns it). Charts add themselves; the ticker advances them all
// from a single requestAnimationFrame, pauses while the tab is hidden (hidden time does not count) and stops when
// nothing is left to animate. env (tests): requestAnimationFrame, cancelAnimationFrame, document.
export function createChartTicker(env = {}) {
    const g = globalThis;
    const raf = env.requestAnimationFrame || (g.requestAnimationFrame ? fn => g.requestAnimationFrame(fn) : null);
    const caf = env.cancelAnimationFrame || (g.cancelAnimationFrame ? id => g.cancelAnimationFrame(id) : () => {});
    const doc = env.document || g.document || null;
    const items = new Set();
    let handle = null;
    let last = null;
    let listening = false;

    const frame = t => {
        handle = null;
        if (!items.size) return;
        const dt = last === null ? 0 : Math.max(0, t - last);
        last = t;
        for (const item of [...items]) item.advance(dt);
        schedule();
    };
    function schedule() {
        if (handle === null && items.size && raf && !(doc && doc.hidden)) handle = raf(frame);
    }
    function stopFrame() {
        if (handle !== null) { caf(handle); handle = null; }
        last = null;
    }
    function onVisibility() {
        if (doc.hidden) stopFrame();
        else schedule();
    }
    function unlisten() {
        if (listening && doc?.removeEventListener) doc.removeEventListener('visibilitychange', onVisibility);
        listening = false;
    }
    return {
        available: !!raf,
        add(item) {
            items.add(item);
            if (!listening && doc?.addEventListener) { doc.addEventListener('visibilitychange', onVisibility); listening = true; }
            schedule();
        },
        remove(item) {
            items.delete(item);
            if (!items.size) { stopFrame(); unlisten(); }
        },
        destroy() { items.clear(); stopFrame(); unlisten(); }
    };
}

// Draws into a new canvas inside `container`. opts: history, quarter, hedgeRatio, tone, label, variant ('spark' =
// static line only), height (CSS px), durationMs, onDone, ticker (a shared createChartTicker; otherwise the chart
// makes its own), env (tests: requestAnimationFrame, cancelAnimationFrame, document, matchMedia, createCanvas, window).
// The canvas follows the container's laid-out width, including after a resize or an orientation change.
export function mountPriceChart(container, opts = {}) {
    const env = opts.env || {};
    const g = globalThis;
    const doc = env.document || g.document || null;
    const win = env.window || g.window || null;
    const matchMedia = env.matchMedia || (g.matchMedia ? q => g.matchMedia(q) : null);
    const spark = opts.variant === 'spark';

    const canvas = env.createCanvas ? env.createCanvas() : doc?.createElement?.('canvas');
    const noop = { skip() {}, destroy() {} };
    if (!canvas) return noop;
    let ctx = null;
    try { ctx = canvas.getContext('2d'); } catch { ctx = null; }

    const cssH = opts.height || (spark ? 24 : 110);
    const dpr = Math.min(3, g.devicePixelRatio || 1);
    let cssW = 0;
    const measure = () => Math.max(40, Math.floor(container.clientWidth || 280));
    const size = () => {
        cssW = measure();
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        if (canvas.style) {
            canvas.style.width = `${cssW}px`;
            canvas.style.height = `${cssH}px`;
        }
    };
    size();
    canvas.setAttribute?.('aria-hidden', 'true');
    container.appendChild(canvas);

    const colors = colorsFor(container);
    let progress = 0;
    const draw = () => {
        if (!ctx) return;
        ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
        drawPriceChart(ctx, { ...opts, progress, w: cssW, h: cssH, colors });
    };
    const onResize = () => {
        if (measure() === cssW) return;
        size();
        draw();
    };
    if (win?.addEventListener) {
        win.addEventListener('resize', onResize);
        win.addEventListener('orientationchange', onResize);
    }

    const duration = opts.durationMs > 0 ? opts.durationMs : DEFAULT_MS;
    const ticker = opts.ticker || ((spark || !(opts.quarter || []).length) ? null : createChartTicker(env));
    const ownTicker = !opts.ticker;
    let finished = false;
    let elapsed = 0;

    const cleanup = () => {
        ticker?.remove?.(item);
        if (ownTicker) ticker?.destroy?.();
    };
    const finish = () => {
        if (finished) return;
        finished = true;
        cleanup();
        progress = 1;
        draw();
        opts.onDone?.();
    };
    const item = {
        advance(dt) {
            if (finished) return;
            elapsed += dt;
            if (elapsed >= duration) { finish(); return; }
            progress = 1 - (1 - elapsed / duration) ** 2;
            draw();
        }
    };

    const reduced = !!matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const destroy = () => {
        finished = true;
        cleanup();
        if (win?.removeEventListener) {
            win.removeEventListener('resize', onResize);
            win.removeEventListener('orientationchange', onResize);
        }
        canvas.remove?.();
    };
    if (!ticker || !ticker.available || reduced || (opts.quarter || []).length < 2) {
        finished = true;
        progress = 1;
        draw();
        if (ownTicker) ticker?.destroy?.();
        if (!spark) opts.onDone?.();
        return { skip() {}, destroy };
    }

    draw();
    ticker.add(item);
    return { skip: finish, destroy };
}
