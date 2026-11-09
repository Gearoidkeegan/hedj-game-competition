// PriceChart: the real market line behind a Simple-mode exposure. Shape and % move only: no axes, ticks, dates,
// years or price levels (the start year stays secret until game over).
//
//   chartSeries(dataset, startYear, quarter, opts) -> { history, quarter } | null     pure
//   drawPriceChart(ctx, { history, quarter, progress, hedgeRatio, tone, label, w, h, variant, colors })
//   mountPriceChart(container, opts) -> { skip(), destroy() }
//
// `quarter` is the 0-based run quarter (the engine's calendar index). The monthly dataset is keyed YYYY-MM-01.
// history = up to 12 months ending on the quarter's start month; quarter = that start plus the 3 months after it
// (the last one is the next quarter's start, which is the rate the engine settles the quarter at).

import { calendar } from '../engine/sim/SimEngine.js';

const HISTORY_MONTHS = 12;
const QUARTER_MONTHS = 3;
const DEFAULT_MS = 1800;
const PAD = { top: 8, bottom: 8, left: 4, right: 4 };
const LABEL_W = 56;

const keyFor = idx => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
const usable = v => typeof v === 'number' && Number.isFinite(v);

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
    const history = [];
    for (let i = m0 - (HISTORY_MONTHS - 1); i <= m0; i++) {
        const v = at(i);
        if (v !== null) history.push(v);
    }
    if (opts.upTo === 'start') {
        return history.length >= 2 ? { history, quarter: [] } : null;
    }
    if (at(m0) === null) return null;
    const q = [];
    for (let i = m0; i <= m0 + QUARTER_MONTHS; i++) {
        const v = at(i);
        if (v !== null) q.push(v);
    }
    return q.length >= 2 ? { history, quarter: q } : null;
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
    if (chartInverted(exposure) && m > -100) m = 100 / (1 + m / 100) - 100;
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
    const left = PAD.left;
    const right = w - (showLabel ? LABEL_W : PAD.right);
    const top = PAD.top;
    const bottom = h - PAD.bottom;
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const span = hi - lo;
    const yOf = v => (span > 0 ? bottom - ((v - lo) / span) * (bottom - top) : (top + bottom) / 2);

    // History and the quarter share one month grid; the quarter starts on the last history point.
    const qStart = history.length ? history.length - 1 : 0;
    const total = qStart + Math.max(0, quarter.length - 1);
    const xOf = i => (total > 0 ? left + (i / total) * (right - left) : left);
    const hist = history.map((v, i) => [xOf(i), yOf(v)]);
    const quar = quarter.map((v, j) => [xOf(qStart + j), yOf(v)]);

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const trace = pts => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    };

    if (hist.length > 1) {
        ctx.globalAlpha = spark ? 1 : 0.4;
        ctx.strokeStyle = spark ? accent : colors.faint;
        ctx.lineWidth = spark ? 1.5 : 1.5;
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
        ctx.globalAlpha = 0.18 + 0.3 * Math.min(1, hedge);
        ctx.fillStyle = accent;
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
                ctx.font = 'bold 14px system-ui, sans-serif';
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'left';
                ctx.fillStyle = accent;
                ctx.fillText(opts.label, Math.min(end[0] + 8, w - 2 - LABEL_W + 8), Math.min(Math.max(end[1], 10), h - 10));
            }
        }
    }
    ctx.restore();
}

// Draws into a new canvas inside `container`. opts: history, quarter, hedgeRatio, tone, label, variant ('spark' =
// static line only), height (CSS px), durationMs, onDone, env (tests: requestAnimationFrame, cancelAnimationFrame,
// document, matchMedia, createCanvas).
export function mountPriceChart(container, opts = {}) {
    const env = opts.env || {};
    const g = globalThis;
    const doc = env.document || g.document || null;
    const raf = env.requestAnimationFrame || (g.requestAnimationFrame ? fn => g.requestAnimationFrame(fn) : null);
    const caf = env.cancelAnimationFrame || (g.cancelAnimationFrame ? id => g.cancelAnimationFrame(id) : () => {});
    const matchMedia = env.matchMedia || (g.matchMedia ? q => g.matchMedia(q) : null);
    const spark = opts.variant === 'spark';

    const canvas = env.createCanvas ? env.createCanvas() : doc?.createElement?.('canvas');
    const noop = { skip() {}, destroy() {} };
    if (!canvas) return noop;
    let ctx = null;
    try { ctx = canvas.getContext('2d'); } catch { ctx = null; }

    const cssW = Math.max(40, container.clientWidth || 300);
    const cssH = opts.height || (spark ? 24 : 72);
    const dpr = Math.min(3, g.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    if (canvas.style) {
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
    }
    canvas.setAttribute?.('aria-hidden', 'true');
    container.appendChild(canvas);

    const colors = colorsFor(container);
    const draw = progress => {
        if (!ctx) return;
        ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
        drawPriceChart(ctx, { ...opts, progress, w: cssW, h: cssH, colors });
    };

    const duration = opts.durationMs > 0 ? opts.durationMs : DEFAULT_MS;
    let handle = null;
    let running = false;
    let finished = false;
    let elapsed = 0;
    let last = null;

    const finish = () => {
        if (finished) return;
        finished = true;
        running = false;
        if (handle !== null) { caf(handle); handle = null; }
        if (doc?.removeEventListener) doc.removeEventListener('visibilitychange', onVisibility);
        draw(1);
        opts.onDone?.();
    };
    const frame = t => {
        handle = null;
        if (!running) return;
        if (last === null) last = t;
        elapsed += t - last;
        last = t;
        if (elapsed >= duration) { finish(); return; }
        draw(1 - (1 - elapsed / duration) ** 2);
        schedule();
    };
    const schedule = () => { if (handle === null && running) handle = raf(frame); };
    function onVisibility() {
        if (doc.hidden) {
            if (handle !== null) { caf(handle); handle = null; }
            last = null;
        } else {
            schedule();
        }
    }

    const reduced = !!matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (spark || reduced || !raf || (opts.quarter || []).length < 2) {
        finished = true;
        draw(1);
        return { skip() {}, destroy() { canvas.remove?.(); } };
    }

    running = true;
    draw(0);
    if (doc?.addEventListener) doc.addEventListener('visibilitychange', onVisibility);
    if (!doc || !doc.hidden) schedule();
    return {
        skip: finish,
        destroy() {
            running = false;
            finished = true;
            if (handle !== null) { caf(handle); handle = null; }
            if (doc?.removeEventListener) doc.removeEventListener('visibilitychange', onVisibility);
            canvas.remove?.();
        }
    };
}
