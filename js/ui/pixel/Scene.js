// Scene: draws an industry's pixel scene with its mood (sky, weather, light)
// and runs the single animation loop that keeps it moving.
//
//   drawScene(ctx, industryId, sceneState, tMs)  pure drawing, no timers
//   new SceneLoop(canvas, getState).start() / .stop()
//
// SceneState = { mood: 'calm'|'storm'|'boom', cashLevel: 0..1, highlight: string|null }

import { PixelCanvas } from './PixelCanvas.js';
import { PAL, SKY, mix, moodGrade } from './palette.js';
import { hash, phase, layout } from './parts.js';
import * as airport from './scenes/airport.js';
import * as agrifoods from './scenes/agrifoods.js';
import * as tech from './scenes/tech.js';
import * as pharma from './scenes/pharma.js';
import * as construction from './scenes/construction.js';
import * as energy from './scenes/energy.js';
import * as retail from './scenes/retail.js';

const SCENES = { airport, agrifoods, tech, pharma, construction, energy, retail };

// Industry id -> scene file (airline flies from the airport; the rest share their id).
const INDUSTRY_SCENES = {
    airline: 'airport', agrifoods: 'agrifoods', tech: 'tech', pharma: 'pharma',
    construction: 'construction', energy: 'energy', retail: 'retail',
};

// The `scene` names in industries.json, which Pro mode still passes in.
const LEGACY_SCENES = {
    airport: 'airport', roastery: 'agrifoods', factory: 'tech', lab: 'pharma',
    building_site: 'construction', energy_grid: 'energy', shopping_centre: 'retail',
};

export function sceneNameFor(id) {
    return INDUSTRY_SCENES[id] || LEGACY_SCENES[id] || (SCENES[id] ? id : 'airport');
}

const BASE_H = 84;          // logical pixel rows the scenes are designed for
const MIN_W = 128, MAX_W = 320, MAX_H = 240;

// Logical size and scale for a backing store of cw x ch device pixels.
function fit(cw, ch) {
    let scale = ch / BASE_H;
    let w = Math.ceil(cw / scale);
    let h = BASE_H;
    if (w > MAX_W || w < MIN_W) {
        w = w > MAX_W ? MAX_W : MIN_W;
        scale = cw / w;
        h = Math.min(MAX_H, Math.max(BASE_H, Math.ceil(ch / scale)));
    }
    return { w, h, scale };
}

let surface = null;
function surfaceFor(w, h) {
    if (!surface || surface.w !== w || surface.h !== h) surface = new PixelCanvas(w, h);
    surface.clear(null);
    surface.ox = 0; surface.oy = 0; surface.force = null; surface.under = false;
    return surface;
}

function normalise(s = {}) {
    const mood = s.mood === 'storm' || s.mood === 'boom' ? s.mood : 'calm';
    const raw = Number(s.cashLevel);
    const cashLevel = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.5;
    return { mood, cashLevel, highlight: typeof s.highlight === 'string' ? s.highlight : null };
}

export function drawScene(ctx, industryId, sceneState, tMs) {
    const cw = ctx?.canvas?.width || 0;
    const ch = ctx?.canvas?.height || 0;
    if (cw <= 0 || ch <= 0) return;
    const state = normalise(sceneState);
    const t = Number.isFinite(tMs) ? tMs : 0;
    const { w, h, scale } = fit(cw, ch);
    const px = surfaceFor(w, h);
    const L = layout(px);

    SCENES[sceneNameFor(industryId)].draw(px, state, t);
    cashPile(px, L, state.cashLevel);

    const grade = moodGrade(state.mood);
    if (grade) px.remap(grade);

    px.under = true;
    sky(px, L, state.mood, t);
    px.under = false;

    if (state.mood === 'storm') storm(px, L, t);
    if (state.mood === 'boom') coins(px, L, t);

    ctx.imageSmoothingEnabled = false;
    px.blitTo(ctx, scale, (cw - w * scale) / 2, ch - h * scale);
}

// ---------------------------------------------------------------- sky

const CLOUD = [
    '....wwww......',
    '..wwwwwwww.ww.',
    '.wwwwwwwwwwwww',
    'wwwwwwwwwwwwww',
    '.ssssssssssss.',
];

function sky(px, L, mood, t) {
    const { w, horizon } = L;
    if (mood === 'storm') {
        // Two drifting cloud decks with scalloped undersides; the near deck is
        // drawn first so it sits in front (under mode keeps the first colour).
        cloudDeck(px, w, Math.floor(horizon * 0.28), t * 0.006, ['#56617a', '#3a4356', '#2c3445']);
        cloudDeck(px, w, Math.floor(horizon * 0.5), t * 0.003 + 40, ['#5b667e', '#4a5469', '#3f485b']);
    } else {
        const sun = mood === 'boom'
            ? { x: w - 26, y: 14, r: 7, c: '#ffd23f', rim: '#ffe98a' }
            : { x: w - 24, y: 13, r: 4, c: '#fff2b8', rim: '#fffbe0' };
        px.disc(sun.x, sun.y, sun.r - 1, sun.c);
        px.disc(sun.x, sun.y, sun.r, sun.rim);
        if (mood === 'boom') {
            const spin = Math.floor(t / 300) % 2;
            for (let a = 0; a < 8; a++) {
                const ang = (a / 8) * Math.PI * 2 + (spin ? Math.PI / 8 : 0);
                const len = a % 2 ? 3 : 5;
                for (let k = 0; k < len; k++) {
                    const rr = sun.r + 2 + k;
                    px.pixel(sun.x + Math.round(Math.cos(ang) * rr), sun.y + Math.round(Math.sin(ang) * rr), '#ffe066');
                }
            }
        }
        const n = mood === 'boom' ? 2 : 3;
        for (let i = 0; i < n; i++) {
            const x = Math.floor(((i * 71 + 10 + t * 0.002 * (1 + i * 0.3)) % (w + 30)) - 15);
            const y = 5 + Math.floor(hash(i, 3) * Math.max(1, horizon * 0.35));
            px.sprite(CLOUD, x, y, { w: PAL.white, s: '#dfeaf4' });
        }
        if (mood === 'calm') {
            // A pair of gulls gliding across.
            for (let i = 0; i < 2; i++) {
                const bx = Math.floor(((t * 0.012 + i * 9) % (w + 20)) - 10);
                const by = 10 + i * 4 + (Math.floor(t / 400 + i) % 2);
                px.sprite(['k.k', '.k.'], bx, by, { k: '#3c4a66' });
            }
        }
    }
    // Banded gradient with a one-row checkerboard dither at each seam.
    const bands = SKY[mood];
    const n = bands.length;
    const bandH = Math.max(1, (horizon + 1) / n);
    const seam = (i) => Math.floor(i * bandH);
    for (let y = 0; y <= horizon; y++) {
        const i = Math.min(n - 1, Math.floor(y / bandH));
        if (i > 0 && y === seam(i)) {
            for (let x = 0; x < w; x++) px.pixel(x, y, (x + y) & 1 ? bands[i] : bands[i - 1]);
        } else {
            px.hline(0, y, w, bands[i]);
        }
    }
}

// A cloud deck from the top of the sky down to a lumpy edge near baseY.
// colours: [rim highlight, body, shadowed underside].
function cloudDeck(px, w, baseY, drift, [rim, body, belly]) {
    for (let x = 0; x < w; x++) {
        const u = x + drift;
        const edge = baseY + Math.floor(3 * Math.sqrt(Math.abs(Math.sin(u / 7)))) + Math.round(2 * Math.sin(u / 19));
        px.rect(x, edge - 2, 1, 2, belly);
        if (Math.abs(Math.sin(u / 7)) < 0.25) px.pixel(x, edge - 4, rim);
        px.rect(x, 0, 1, edge - 2, body);
    }
}

// ---------------------------------------------------------------- weather

const flash = new Map();
const lighten = (c) => {
    let out = flash.get(c);
    if (!out) { out = mix(c, '#e8eeff', 0.35); flash.set(c, out); }
    return out;
};

function storm(px, L, t) {
    const { w, h, G } = L;
    const strike = Math.floor(t / 4700);
    if (phase(t, 4700) < 0.035) {
        px.remap(lighten);
        let x = 10 + Math.floor(hash(strike, 5) * (w - 20));
        let y = 8;
        while (y < G - 18) {
            const nx = x + Math.floor(hash(strike, y) * 5) - 2;
            px.line(x, y, nx, y + 4, PAL.bolt);
            x = nx; y += 4;
        }
    }
    const drops = Math.floor((w * h) / 90);
    for (let i = 0; i < drops; i++) {
        const x = Math.floor((hash(i, 1) * (w + 20) + t * 0.03) % (w + 20)) - 10;
        const y = Math.floor((hash(i, 2) * (h + 10) + t * 0.16 * (0.8 + hash(i, 3) * 0.4)) % (h + 10)) - 5;
        const c = hash(i, 4) < 0.5 ? PAL.rain : '#7f93ae';
        px.pixel(x, y, c);
        px.pixel(x - 1, y + 1, c);
    }
    for (let i = 0; i < Math.floor(w / 6); i++) {
        if (phase(t, 600, i * 97) > 0.35) continue;
        const x = Math.floor(hash(i, 9) * w);
        const y = G + 1 + Math.floor(hash(i, 10) * (h - G - 2));
        px.sprite(['r.r', '.r.'], x, y, { r: PAL.rain });
    }
}

const COIN_FRAMES = [
    ['.ccc.', 'clllc', 'clcdc', 'clddc', '.ccc.'],
    ['.cc.', 'clcd', 'clcd', 'clcd', '.cc.'],
    ['c', 'l', 'd', 'd', 'c'],
    ['.cc.', 'dclc', 'dclc', 'dclc', '.cc.'],
];
const COIN_PAL = { c: PAL.coinDark, l: PAL.coinLight, d: PAL.coin };

function coins(px, L, t) {
    const { w, h } = L;
    const n = Math.max(6, Math.floor(w / 14));
    for (let i = 0; i < n; i++) {
        const fall = 0.025 + hash(i, 6) * 0.02;
        const y = Math.floor((hash(i, 7) * (h + 12) + t * fall) % (h + 12)) - 8;
        const x = Math.floor(hash(i, 8) * (w - 6) + Math.sin(t / 500 + i) * 2);
        const frame = COIN_FRAMES[Math.floor(t / 120 + i) % COIN_FRAMES.length];
        px.sprite(frame, x + (5 - frame[0].length) / 2, y, COIN_PAL);
    }
    for (let i = 0; i < Math.floor(w / 24); i++) {
        if (phase(t, 900, i * 131) > 0.3) continue;
        const x = Math.floor(hash(i, 11) * w), y = Math.floor(hash(i, 12) * L.G);
        px.sprite(['.s.', 'sws', '.s.'], x, y, { s: PAL.coinLight, w: PAL.white });
    }
}

// ---------------------------------------------------------------- cash

// The company's cash pile, front left: up to three stacks of coins plus a
// money bag when the coffers are full.
function cashPile(px, L, level) {
    const base = L.h - 2;
    const coinsTotal = Math.round(level * 15);
    for (let s = 0; s < 3; s++) {
        const n = Math.max(0, Math.min(5, coinsTotal - s * 5));
        const x = 4 + s * 6;
        for (let k = 0; k < n; k++) {
            const y = base - 2 * (k + 1);
            px.outlined(PAL.ink, () => px.rect(x, y, 5, 2, PAL.coin));
            px.hline(x, y, 5, PAL.coinLight);
            px.pixel(x + 4, y + 1, PAL.coinDark);
        }
    }
    if (level >= 0.9) {
        px.outlined(PAL.ink, () => px.sprite(
            ['..kk..', '.bbbb.', 'bbbbbb', 'bbllbb', 'bbbbbb', '.bbbb.'],
            22, base - 6, { k: PAL.trunk, b: PAL.sack, l: PAL.coin }));
    }
}

// ---------------------------------------------------------------- loop

// The single animation loop for a scene canvas. Each frame it matches the
// canvas backing store to its displayed size (so the canvas must be sized by
// CSS), asks getState() for { industryId, sceneState } and draws. It pauses
// while the page is hidden.
export class SceneLoop {
    // env lets tests inject requestAnimationFrame, cancelAnimationFrame and document.
    constructor(canvas, getState, env = {}) {
        const g = globalThis;
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.getState = getState;
        this.raf = env.requestAnimationFrame || ((fn) => g.requestAnimationFrame(fn));
        this.caf = env.cancelAnimationFrame || ((id) => g.cancelAnimationFrame(id));
        this.doc = env.document || g.document || null;
        this.handle = null;
        this.running = false;
        this.lastDraw = -Infinity;
        this.onVisibility = () => {
            if (this.doc.hidden) this.cancel();
            else if (this.running) this.schedule();
        };
        this.frame = (t) => {
            this.handle = null;
            if (!this.running) return;
            // ~30 fps is plenty for pixel art and kinder to phone batteries.
            if (t - this.lastDraw >= 30) {
                this.lastDraw = t;
                this.render(t);
            }
            this.schedule();
        };
    }

    start() {
        if (this.running) return;
        this.running = true;
        if (this.doc) this.doc.addEventListener('visibilitychange', this.onVisibility);
        if (!this.doc || !this.doc.hidden) this.schedule();
    }

    stop() {
        this.running = false;
        this.cancel();
        if (this.doc) this.doc.removeEventListener('visibilitychange', this.onVisibility);
    }

    schedule() {
        if (this.handle === null) this.handle = this.raf(this.frame);
    }

    cancel() {
        if (this.handle !== null) {
            this.caf(this.handle);
            this.handle = null;
        }
    }

    // Match the backing store to the displayed size so pixels stay crisp.
    fitCanvas() {
        const c = this.canvas;
        const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
        const W = Math.round((c.clientWidth || 0) * dpr), H = Math.round((c.clientHeight || 0) * dpr);
        if (W > 0 && H > 0 && (c.width !== W || c.height !== H)) {
            c.width = W;
            c.height = H;
        }
    }

    render(t) {
        this.fitCanvas();
        const { industryId, sceneState } = this.getState();
        drawScene(this.ctx, industryId, sceneState, t);
    }
}
