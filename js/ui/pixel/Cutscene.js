// Cutscene: short code-drawn canvas sequences, 2-4 s each, no video files.
//
//   playCutscene(container, id, { industryId }) -> Promise<void>
//     id: 'intro' | 'bankrupt' | 'fired' | 'personalBest'
//     Adds a canvas to the container, plays the sequence once, then removes the
//     canvas and its listeners and resolves. A tap (click) or any key skips it.
//     It resolves at once, drawing nothing, under prefers-reduced-motion or for
//     an unknown id.
//   drawCutscene(ctx, id, { industryId }, tMs, dpr)   one frame, pure (the gallery uses it)
//
// All motion is a function of tMs; cosmetic randomness comes from hash(), never
// Math.random, so a frame always looks the same.

import { PixelCanvas } from './PixelCanvas.js';
import { PAL, mix } from './palette.js';
import { hash, phase, windows, tree } from './parts.js';
import { drawScene } from './Scene.js';
import { drawSprite, spriteIdForMember } from './sprites.js';

// ---------------------------------------------------------------- fit

// The logical canvas is at least 128 x 84 pixels, but one logical pixel is never
// smaller than 2 CSS pixels, so a 7-row glyph is always at least 14 CSS px tall.
const MIN_W = 128, MIN_H = 84, MIN_CSS_SCALE = 2;

// Logical size and device-pixel scale for a backing store of cw x ch device pixels.
export function fitCutscene(cw, ch, dpr = 1) {
    const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    const scale = Math.max(MIN_CSS_SCALE * d, Math.min(cw / MIN_W, ch / MIN_H));
    return { w: Math.max(1, Math.ceil(cw / scale)), h: Math.max(1, Math.ceil(ch / scale)), scale };
}

// Reusable layers, cleared per frame.
const layers = [];
function layer(v, i) {
    let px = layers[i];
    if (!px || px.w !== v.w || px.h !== v.h) px = layers[i] = new PixelCanvas(v.w, v.h);
    px.clear(null);
    px.ox = 0; px.oy = 0; px.force = null; px.under = false;
    return px;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (p) => 1 - (1 - p) ** 3;
const easeOutBack = (p) => 1 + 2.2 * (p - 1) ** 3 + 1.2 * (p - 1) ** 2;
const progress = (t, start, len) => clamp01((t - start) / len);

// ---------------------------------------------------------------- pixel text

// A 5x7 pixel font with just the letters the cutscenes spell.
const FONT = {
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
    H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
    K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
};
const GLYPH_W = 5, GLYPH_H = 7;

const textWidth = (s, k) => (s.length * (GLYPH_W + 1) - 1) * k;

// Text at (x, y), each font pixel k x k. colour is a colour or fn(row 0..6).
function text(px, s, x, y, k, colour) {
    for (let i = 0; i < s.length; i++) {
        const g = FONT[s[i]];
        if (!g) continue;
        for (let r = 0; r < GLYPH_H; r++) {
            const c = typeof colour === 'function' ? colour(r) : colour;
            for (let col = 0; col < GLYPH_W; col++) {
                if (g[r][col] === '#') px.rect(x + (i * (GLYPH_W + 1) + col) * k, y + r * k, k, k, c);
            }
        }
    }
}

// Inked text with a one-pixel drop shadow under its outline.
function caption(px, s, x, y, k, colour, shadow = '#0a0f24') {
    px.oy += 1;
    px.outlined(shadow, () => text(px, s, x, y, k, shadow));
    px.oy -= 1;
    px.outlined(PAL.ink, () => text(px, s, x, y, k, colour));
}

// ---------------------------------------------------------------- logo

// The Hedj mark, sampled from the logo's geometry onto a 16 x 20 grid: a green
// bar, a blue-grey and an orange diamond, and a yellow dot.
const LOGO = { g: '#34b57c', b: '#7a9cb5', o: '#e98c33', y: '#ffc000' };
const LOGO_MAP = (() => {
    const rows = [];
    for (let r = 0; r < 20; r++) {
        let line = '';
        for (let c = 0; c < 16; c++) {
            const x = (c + 0.5) * 32.5, y = (r + 0.5) * 32.25;   // 520 x 645 source units
            const corner = (cx, cy) => Math.hypot(x - cx, y - cy) > 40;
            let ch = '.';
            if (x <= 260 && y <= 470 && !(x < 40 && y < 40 && corner(40, 40)) && !(x > 220 && y < 40 && corner(220, 40))) ch = 'g';
            if (x <= 260 && x + y >= 460 && x + y <= 840 && x - y >= -475) ch = 'b';
            if (x >= 260 && x + y >= 480 && x + y <= 820 && x - y <= 220 && x - y >= -330) ch = 'o';
            if (Math.hypot(x - 370, y - 515) <= 66) ch = 'y';
            line += ch;
        }
        rows.push(line);
    }
    return rows;
})();

// A plate with the mark and the HEDJ wordmark; returns its size.
function logoPlate(px, cx, y, t) {
    const k = px.w >= 90 ? 2 : 1;
    const tw = textWidth('HEDJ', k);
    const w = 6 + 16 + 5 + tw + 6, h = 28;
    const x = Math.round(cx - w / 2);
    px.outlined(PAL.ink, () => {
        px.rect(x + 1, y, w - 2, h, '#24345a');
        px.rect(x, y + 1, w, h - 2, '#24345a');
    });
    px.hline(x + 2, y + 1, w - 4, '#3a4f7e');
    px.sprite(LOGO_MAP, x + 6, y + 4, LOGO);
    const ty = y + Math.round((h - GLYPH_H * k) / 2);
    caption(px, 'HEDJ', x + 6 + 16 + 5, ty, k, PAL.white, '#101a33');
    // A glint sweeps across the plate once the logo has landed.
    const g = progress(t, 1500, 600);
    if (g > 0 && g < 1) {
        const d = Math.round(g * (w + h)) - h;
        for (let yy = 0; yy < h; yy++) {
            for (const dx of [0, 1]) {
                const xx = x + d + yy + dx, c = px.get(xx, y + yy);
                if (c && c !== PAL.ink) px.pixel(xx, y + yy, mix(c, '#ffffff', 0.55));
            }
        }
    }
    return { x, y, w, h };
}

// ---------------------------------------------------------------- intro

// The logo drops in, then the player's industry scene pans in beneath it.
function intro(ctx, v, t, { industryId }) {
    const pan = easeOut(progress(t, 250, 1300));
    const dx = Math.round((1 - pan) * v.cw);
    if (dx < v.cw) {
        ctx.save();
        ctx.translate(dx, 0);
        drawScene(ctx, industryId, { mood: 'calm', cashLevel: 0.6, highlight: null }, t);
        ctx.restore();
    }
    const px = layer(v, 0);
    const target = Math.max(3, Math.round(v.h * 0.1));
    const y = Math.round(-32 + (target + 32) * easeOutBack(progress(t, 0, 650)));
    logoPlate(px, Math.floor(v.w / 2), y, t);
    px.blitTo(ctx, v.scale, v.ox, v.oy);
}

// ---------------------------------------------------------------- bankrupt

const WOOD = { top: '#b98a5a', face: '#8a5a3a', dark: '#6b4a33', edge: '#d0a070' };
const BANK_MANAGER = spriteIdForMember({ name: 'Bank Manager', personality: 'aggressive' }, 0);

// A red desk phone: body, rotary dial and handset; lift raises the handset.
function phone(px, x, base, lift) {
    px.outlined(PAL.ink, () => {
        px.rect(x + 1, base - 6, 12, 6, PAL.red);
        px.rect(x, base - 8 - lift, 14, 2, PAL.redDark);
        px.rect(x, base - 9 - lift, 3, 2, PAL.redDark);
        px.rect(x + 11, base - 9 - lift, 3, 2, PAL.redDark);
    });
    px.hline(x + 2, base - 6, 10, mix(PAL.red, '#ffffff', 0.35));
    px.disc(x + 7, base - 3, 2, PAL.wall0);
    px.pixel(x + 7, base - 3, PAL.ink);
}

// The bank manager at his desk while the phone rings off the hook, then the stamp.
function bankrupt(ctx, v, t) {
    const { w, h } = v;
    const cx = Math.floor(w / 2);
    const F = h - 8;                 // floor line
    const deskTop = F - 22;
    const back = layer(v, 0);

    // Wall: striped paper, a dado rail and skirting; carpet below.
    back.rect(0, 0, w, F, '#cfd9c6');
    for (let x = 0; x < w; x += 6) back.vline(x, 0, F - 14, '#c2cdb8');
    back.hline(0, F - 14, w, WOOD.face);
    back.hline(0, F - 13, w, WOOD.dark);
    back.rect(0, F - 2, w, 2, WOOD.dark);
    back.rect(0, F, w, h - F, '#7a3a3a');
    back.dither(0, F, w, 1, '#7a3a3a', '#5e2a2a');

    // A wall chart whose line falls off a cliff as the scene plays.
    const chart = { x: cx + 12, y: Math.max(2, deskTop - 46), w: 30, h: 20 };
    back.outlined(PAL.ink, () => back.rect(chart.x, chart.y, chart.w, chart.h, WOOD.top));
    back.rect(chart.x + 2, chart.y + 2, chart.w - 4, chart.h - 4, PAL.white);
    back.vline(chart.x + 4, chart.y + 3, chart.h - 7, PAL.wall3);
    back.hline(chart.x + 4, chart.y + chart.h - 4, chart.w - 7, PAL.wall3);
    const pts = [[0, 5], [5, 3], [9, 4], [13, 2], [16, 8], [20, 9], [23, 13]];
    const drawn = progress(t, 200, 1600) * (pts.length - 1);
    for (let i = 0; i < Math.floor(drawn) && i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        back.line(chart.x + 5 + x0, chart.y + 2 + y0, chart.x + 5 + x1, chart.y + 2 + y1, i < 3 ? PAL.greenDark : PAL.red);
    }
    back.blitTo(ctx, v.scale, v.ox, v.oy);

    // The manager, alarmed once the phone has rung a while.
    const bx = cx - 34, by = deskTop - 24;
    drawSprite(ctx, BANK_MANAGER, t < 1300 ? 'neutral' : 'angry', v.ox + bx * v.scale, v.oy + by * v.scale, v.scale);

    // Desk in front of him, with a BANK nameplate and the ringing phone.
    const front = layer(v, 1);
    const dx0 = cx - 44, dw = 88;
    front.outlined(PAL.ink, () => {
        front.rect(dx0, deskTop, dw, 3, WOOD.top);
        front.rect(dx0 + 2, deskTop + 3, dw - 4, F - deskTop - 3, WOOD.face);
    });
    front.hline(dx0, deskTop, dw, WOOD.edge);
    front.rect(dx0 + 2, deskTop + 3, dw - 4, 1, WOOD.dark);
    const plateW = textWidth('BANK', 1) + 6;
    const plateX = cx - Math.floor(plateW / 2) - 12;
    front.outlined(PAL.ink, () => front.rect(plateX, deskTop + 6, plateW, 11, '#24345a'));
    text(front, 'BANK', plateX + 3, deskTop + 8, 1, PAL.coin);

    const ringing = t >= 300 && t < 2250 && phase(t - 300, 650) < 0.7;
    const jitter = ringing ? (Math.floor(t / 50) % 2 ? 1 : -1) : 0;
    const phX = cx + 10 + jitter;
    phone(front, phX, deskTop, ringing ? 1 + (Math.floor(t / 70) % 2) : 0);
    if (ringing) {
        for (const [sx, dir] of [[phX - 3, -1], [phX + 16, 1]]) {
            front.pixel(sx, deskTop - 9, PAL.ink);
            front.pixel(sx + dir, deskTop - 7, PAL.ink);
            front.pixel(sx, deskTop - 5, PAL.ink);
        }
        const k = 1, rw = textWidth('RING!', k);
        const side = Math.floor((t - 300) / 650) % 2 ? 4 : -4;
        const rx = Math.max(1, Math.min(w - rw - 1, phX + 7 - Math.floor(rw / 2) + side));
        caption(front, 'RING!', rx, deskTop - 21, k, PAL.yellow);
    }

    // The stamp slams down.
    if (t >= 2250) {
        const k = w >= 104 ? 2 : 1;
        // paper, then a red border inset by k, then a k gap round the text
        const sw = textWidth('BANKRUPT', k) + 6 * k, sh = (GLYPH_H + 6) * k;
        const shake = t < 2400 ? (Math.floor(t / 40) % 2 ? 1 : -1) : 0;
        const sx = cx - Math.floor(sw / 2) + shake;
        const sy = Math.max(1, Math.min(h - sh - 1, deskTop - 1));
        front.outlined(PAL.ink, () => front.rect(sx, sy, sw, sh, '#fbe9e4'));
        const [bx0, by0, bw, bh] = [sx + k, sy + k, sw - 2 * k, sh - 2 * k];
        front.rect(bx0, by0, bw, k, PAL.red);
        front.rect(bx0, by0 + bh - k, bw, k, PAL.red);
        front.rect(bx0, by0, k, bh, PAL.red);
        front.rect(bx0 + bw - k, by0, k, bh, PAL.red);
        text(front, 'BANKRUPT', sx + 3 * k, sy + 3 * k, k, PAL.redDark);
    }
    front.blitTo(ctx, v.scale, v.ox, v.oy);
}

// ---------------------------------------------------------------- fired

const CHAIR = spriteIdForMember({ name: 'The Chair', personality: 'cautious' }, 1);
const SUIT = '#4a5a78', TROUSERS = '#2e3a52', GUARD = '#22283a';

// Two walking legs at x, x+3 on the ground line, striding on alternate steps.
function legs(px, x, base, step, c) {
    px.rect(x + (step ? -1 : 0), base - 4, 1, 4, c);
    px.rect(x + 3 + (step ? 1 : 0), base - 4, 1, 4, c);
}

// The player, facing left, carrying a box with a plant and a photo frame.
function player(px, x, base, step, t) {
    const bob = step ? 1 : 0;
    px.outlined(PAL.ink, () => {
        legs(px, x + 2, base, step, TROUSERS);
        px.rect(x + 1, base - 10 + bob, 6, 6, SUIT);
        px.rect(x + 2, base - 14 + bob, 4, 4, PAL.skin);
        px.rect(x + 2, base - 15 + bob, 5, 1, '#5a3a22');
        px.rect(x + 5, base - 14 + bob, 2, 2, '#5a3a22');
        // the box
        px.rect(x - 4, base - 9 + bob, 7, 5, PAL.sack);
        px.rect(x - 2, base - 12 + bob, 1, 3, PAL.leafDark);
        px.rect(x - 4, base - 13 + bob, 3, 2, PAL.leaf);
        px.rect(x, base - 11 + bob, 2, 2, PAL.glassDark);
    });
    px.pixel(x + 2, base - 13 + bob, PAL.ink);                       // eye
    px.pixel(x + 2, base - 11 + bob, mix(PAL.skin, PAL.ink, 0.4));   // glum mouth
    px.hline(x - 4, base - 9 + bob, 7, PAL.sackDark);                // box flap
    px.pixel(x - 1, base - 7 + bob, PAL.sackDark);
    px.pixel(x - 3, base - 14 + bob, PAL.leafLight);
    px.pixel(x + 1, base - 11 + bob, PAL.wall0);
    // A small personal rain cloud, drizzling.
    const cy = base - 23 + (Math.floor(t / 400) % 2);
    px.outlined(PAL.ink, () => px.sprite(['..ccc..', '.ccccc.', 'ccccccc', '.ddddd.'], x - 1, cy, { c: '#7f8ba0', d: '#5f6b80' }));
    for (let i = 0; i < 3; i++) {
        const p = phase(t, 360, i * 120);
        px.pixel(x + i * 2, cy + 5 + Math.floor(p * 5), PAL.rain);
    }
}

// The security guard, a step behind, steering the player by the shoulder.
function guard(px, x, base, step) {
    px.outlined(PAL.ink, () => {
        legs(px, x + 2, base, !step, GUARD);
        px.rect(x + 1, base - 11, 7, 7, GUARD);
        px.rect(x + 2, base - 15, 5, 4, '#c08a5c');
        px.rect(x + 2, base - 17, 5, 2, GUARD);
        px.rect(x + 1, base - 16, 2, 1, GUARD);           // cap peak, facing left
    });
    px.hline(x + 2, base - 14, 3, PAL.ink);               // dark glasses
    px.pixel(x + 6, base - 10, PAL.yellow);               // badge
    px.hline(x - 2, base - 9, 4, GUARD);                  // arm on the player's shoulder
    px.pixel(x - 3, base - 9, '#c08a5c');
}

// Walked out of HQ with a box, the chair glaring from an upper window.
function fired(ctx, v, t) {
    const { w, h } = v;
    const F = h - 7;                     // pavement line
    const back = layer(v, 0);

    // Overcast sky, pavement and kerb.
    const bands = ['#8d9db2', '#97a7bb', '#a2b1c3', '#adbbcb', '#b9c5d3'];
    for (let y = 0; y < F; y++) back.hline(0, y, w, bands[Math.min(bands.length - 1, Math.floor((y / F) * bands.length))]);
    back.rect(0, F, w, h - F, PAL.wall2);
    for (let x = 3; x < w; x += 8) back.vline(x, F, h - F - 2, PAL.wall3);   // paving joints
    back.rect(0, h - 2, w, 2, PAL.tarmac);

    // HQ on the right: cladding, windows, a sliding door under an EXIT sign.
    const bx = Math.max(Math.floor(w * 0.5), w - 72);
    const top = Math.max(2, F - 64);
    back.outlined(PAL.ink, () => back.rect(bx, top, w - bx + 2, F - top, PAL.wall1));
    back.hline(bx, top, w - bx, PAL.wall0);
    windows(back, bx + 4, top + 4, Math.floor((w - bx - 6) / 5), Math.max(1, Math.floor((F - top - 30) / 5)),
        { w: 3, h: 3, gx: 2, gy: 2, lit: 0.3, seed: 3 });
    const door = { x: bx + 8, w: 14, h: 18 };
    const open = t < 2400 ? easeOut(progress(t, 0, 400)) : 1 - easeOut(progress(t, 2400, 400));
    back.rect(door.x - 1, F - door.h - 1, door.w + 2, door.h + 1, PAL.ink);
    back.rect(door.x, F - door.h, door.w, door.h, '#2a3550');
    const slide = Math.round(open * 6);
    for (const [px0, dir] of [[door.x, -1], [door.x + 7, 1]]) {
        const x0 = px0 + dir * slide;
        const vis0 = Math.max(door.x, x0), vis1 = Math.min(door.x + door.w, x0 + 7);
        if (vis1 > vis0) {
            back.rect(vis0, F - door.h, vis1 - vis0, door.h, PAL.glass);
            back.vline(vis0, F - door.h, door.h, PAL.glassDark);
        }
    }
    const signW = textWidth('EXIT', 1) + 4;
    back.outlined(PAL.ink, () => back.rect(door.x + Math.floor((door.w - signW) / 2), F - door.h - 11, signW, 9, PAL.greenDark));
    text(back, 'EXIT', door.x + Math.floor((door.w - signW) / 2) + 2, F - door.h - 10, 1, PAL.white);

    // An upper window where the chair watches.
    const win = { x: door.x + door.w + 6, y: F - door.h - 22, s: 18 };
    const showChair = win.x + win.s < w && win.y > top + 2;
    if (showChair) {
        back.rect(win.x - 1, win.y - 1, win.s + 2, win.s + 2, PAL.ink);
        back.rect(win.x, win.y, win.s, win.s, PAL.glass);
    }
    // A street lamp and a tree on the pavement to the left.
    const lampX = Math.max(6, Math.floor(bx * 0.3));
    back.outlined(PAL.ink, () => {
        back.vline(lampX, F - 26, 26, PAL.steelDark);
        back.rect(lampX - 1, F - 28, 5, 2, PAL.steelDark);
    });
    back.rect(lampX + 1, F - 26, 3, 1, PAL.glassLit);
    if (bx > 60) tree(back, Math.floor(bx * 0.72), F);
    back.blitTo(ctx, v.scale, v.ox, v.oy);
    if (showChair) {
        drawSprite(ctx, CHAIR, t < 900 ? 'neutral' : 'angry',
            v.ox + (win.x + 1) * v.scale, v.oy + (win.y + 2) * v.scale, v.scale / 2);
    }

    const front = layer(v, 1);
    if (showChair) {
        front.rect(win.x - 1, win.y + win.s - 1, win.s + 2, 2, PAL.wall2);     // sill over the chair's chest
        front.hline(win.x - 1, win.y + win.s + 1, win.s + 2, PAL.ink);
    }

    // The walk: out of the door at 0.35 s, off the left edge by about 2.6 s.
    const start = door.x + 3;
    const walked = Math.max(0, t - 350) * ((start + 24) / 2250);
    const x = Math.round(start - walked);
    const step = Math.floor(t / 180) % 2;
    // A leaf drops from the plant and stays on the pavement.
    const leafX = Math.round(start - 900 * ((start + 24) / 2250)) - 3;
    const lp = progress(t, 1250, 450);
    if (lp > 0) front.rect(leafX, Math.round(F - 13 + lp * 12), 2, 1, PAL.leaf);
    guard(front, x + 9, F, step);
    player(front, x, F, step, t);
    front.hline(x + 7, F - 9 + (step ? 1 : 0), 2, GUARD);                   // the guard's hand
    front.blitTo(ctx, v.scale, v.ox, v.oy);
}

// ---------------------------------------------------------------- personal best

const NIGHT = ['#0e1430', '#121a3a', '#182046', '#1f2752', '#29305e', '#36346a'];
const SPARKS = [
    [PAL.white, PAL.coinLight, PAL.coin, PAL.coinDark],
    [PAL.white, PAL.orangeLight, PAL.orange, PAL.orangeDark],
    [PAL.white, '#9ff0b8', PAL.green, PAL.greenDark],
    [PAL.white, '#ff9a9a', PAL.red, PAL.redDark],
    [PAL.white, '#bfe0ff', PAL.glass, PAL.glassDark],
];
const BURSTS = 9, LAUNCH = 350, BURST = 1100;

function firework(px, i, w, h, t) {
    const start = 60 + i * 300;
    const bx = Math.floor(w * (0.12 + 0.76 * hash(i, 1)));
    const by = Math.floor(h * (0.12 + 0.3 * hash(i, 2)));
    const sparks = SPARKS[i % SPARKS.length];
    const age = t - start;
    if (age < 0) return;
    if (age < LAUNCH) {                       // the rocket climbing, with a short trail
        const p = easeOut(age / LAUNCH);
        const y = Math.round(h - (h - by) * p);
        px.vline(bx, y, 3, sparks[2]);
        px.pixel(bx, y, PAL.white);
        return;
    }
    const a = (age - LAUNCH) / BURST;
    if (a >= 1) return;
    const n = 12 + (i % 3) * 2;
    const R = Math.max(10, Math.min(24, Math.floor(w / 6)));
    if (a < 0.12) px.disc(bx, by, 2, PAL.white);
    for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2 + hash(i, 3) * 2;
        for (const [lag, shade] of [[0.07, 1], [0, 0]]) {
            const q = Math.max(0, a - lag);
            const r = R * easeOut(q);
            const x = Math.round(bx + Math.cos(ang) * r);
            const y = Math.round(by + Math.sin(ang) * r + 10 * q * q);
            const c = sparks[Math.min(3, Math.floor(a * 4) + shade)];
            if (shade === 0 && a < 0.5) px.rect(x, y, 2, 2, c);   // a bold head while it is fresh
            else px.pixel(x, y, c);
        }
    }
}

// Fireworks over a night skyline, and NEW PB bouncing in.
function personalBest(ctx, v, t) {
    const { w, h } = v;
    const px = layer(v, 0);
    const bandH = h / NIGHT.length;
    for (let y = 0; y < h; y++) px.hline(0, y, w, NIGHT[Math.min(NIGHT.length - 1, Math.floor(y / bandH))]);
    const stars = Math.floor((w * h) / 140);
    for (let i = 0; i < stars; i++) {
        if (phase(t, 1400, i * 211) < 0.15) continue;
        px.pixel(Math.floor(hash(i, 21) * w), Math.floor(hash(i, 22) * h * 0.7), hash(i, 23) < 0.3 ? PAL.coinLight : '#8d96c8');
    }

    for (let i = 0; i < BURSTS; i++) firework(px, i, w, h, t);

    // The skyline, its windows lit for the celebration.
    let x = 0;
    for (let b = 0; x < w; b++) {
        const bw = 10 + Math.floor(hash(b, 31) * 12);
        const bh = 12 + Math.floor(hash(b, 32) * Math.min(30, h * 0.3));
        px.rect(x, h - bh, bw, bh, b % 2 ? '#141a33' : '#192040');
        windows(px, x + 2, h - bh + 3, Math.floor((bw - 3) / 3), Math.floor((bh - 4) / 4),
            { w: 1, h: 2, gx: 2, gy: 2, lit: 0.45, seed: b + 7, glass: '#232b52' });
        x += bw;
    }

    // NEW PB in gold, dropping in with a bounce, then twinkling.
    const k = w >= 76 ? 2 : 1;
    const tw = textWidth('NEW PB', k);
    const tx = Math.floor((w - tw) / 2);
    const rest = Math.round(h * 0.42 - (GLYPH_H * k) / 2);
    const ty = Math.round(-20 + (rest + 20) * easeOutBack(progress(t, 250, 550)));
    const gold = (r) => (r < 2 ? PAL.coinLight : r < 5 ? PAL.coin : PAL.coinDark);
    caption(px, 'NEW PB', tx, ty, k, gold);
    if (t > 800) {
        for (let i = 0; i < 5; i++) {
            if (phase(t, 700, i * 170) > 0.45) continue;
            const sx = tx - 4 + Math.floor(hash(i, 41) * (tw + 8));
            const sy = ty - 4 + Math.floor(hash(i, 42) * (GLYPH_H * k + 8));
            px.sprite(['.s.', 'sws', '.s.'], sx - 1, sy - 1, { s: PAL.coinLight, w: PAL.white });
        }
    }
    px.blitTo(ctx, v.scale, v.ox, v.oy);
}

// ---------------------------------------------------------------- registry

export const CUTSCENES = Object.freeze({
    intro: Object.freeze({ duration: 3200, background: PAL.ink, label: 'Hedj intro', draw: intro }),
    bankrupt: Object.freeze({ duration: 3000, background: '#cfd9c6', label: "Bankrupt: the bank manager's phone rings", draw: bankrupt }),
    fired: Object.freeze({ duration: 3000, background: '#a2b1c3', label: 'Fired: escorted out with a box', draw: fired }),
    personalBest: Object.freeze({ duration: 3000, background: NIGHT[0], label: 'New personal best: fireworks', draw: personalBest }),
});

// One frame of a cutscene at tMs into it. Pure: same inputs, same draw calls.
export function drawCutscene(ctx, id, { industryId } = {}, tMs = 0, dpr = 1) {
    const seq = Object.hasOwn(CUTSCENES, id) ? CUTSCENES[id] : null;
    const cw = ctx?.canvas?.width || 0, ch = ctx?.canvas?.height || 0;
    if (!seq || cw <= 0 || ch <= 0) return;
    const t = Number.isFinite(tMs) ? Math.max(0, tMs) : 0;
    const { w, h, scale } = fitCutscene(cw, ch, dpr);
    const v = { cw, ch, w, h, scale, ox: (cw - w * scale) / 2, oy: ch - h * scale };
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = seq.background;
    ctx.fillRect(0, 0, cw, ch);
    seq.draw(ctx, v, t, { industryId });
}

// ---------------------------------------------------------------- player

// env lets tests inject document, matchMedia, requestAnimationFrame,
// cancelAnimationFrame, setTimeout, clearTimeout and devicePixelRatio.
export function playCutscene(container, id, { industryId } = {}, env = {}) {
    const g = globalThis;
    const seq = Object.hasOwn(CUTSCENES, id) ? CUTSCENES[id] : null;
    const doc = env.document || container?.ownerDocument || g.document || null;
    if (!seq || !container || !doc || prefersReducedMotion(env)) return Promise.resolve();

    const raf = env.requestAnimationFrame || ((fn) => g.requestAnimationFrame(fn));
    const caf = env.cancelAnimationFrame || ((h) => g.cancelAnimationFrame(h));
    const setT = env.setTimeout || ((fn, ms) => g.setTimeout(fn, ms));
    const clearT = env.clearTimeout || ((h) => g.clearTimeout(h));
    const dpr = () => Math.min(3, env.devicePixelRatio || g.devicePixelRatio || 1);

    return new Promise((resolve) => {
        const canvas = doc.createElement('canvas');
        Object.assign(canvas.style, {
            display: 'block', width: '100%', height: '100%',
            imageRendering: 'pixelated', cursor: 'pointer', touchAction: 'manipulation',
        });
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', `${seq.label} (tap to skip)`);
        container.appendChild(canvas);
        const ctx = canvas.getContext('2d');

        let done = false, handle = null, timer = null, t0 = null, fitted = null;

        const finish = () => {
            if (done) return;
            done = true;
            if (handle !== null) caf(handle);
            if (timer !== null) clearT(timer);
            container.removeEventListener('click', finish);
            doc.removeEventListener('keydown', finish);
            if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
            resolve();
        };

        // Size the backing store from the container, never from the canvas, so
        // setting width/height can't feed back into the next measurement.
        const fitCanvas = () => {
            const cssW = container.clientWidth || 0;
            let cssH = container.clientHeight || 0;
            if (cssW <= 0) return;
            if (cssH <= 0) {
                cssH = Math.round((cssW * 9) / 16);
                canvas.style.height = `${cssH}px`;
            }
            const d = dpr();
            if (fitted && fitted.cssW === cssW && fitted.cssH === cssH && fitted.d === d) return;
            fitted = { cssW, cssH, d };
            const W = Math.round(cssW * d), H = Math.round(cssH * d);
            if (canvas.width !== W) canvas.width = W;
            if (canvas.height !== H) canvas.height = H;
        };

        // Drawing is cosmetic: an error ends the cutscene rather than stalling the game.
        const render = (elapsed) => {
            try {
                fitCanvas();
                drawCutscene(ctx, id, { industryId }, elapsed, fitted ? fitted.d : dpr());
            } catch {
                finish();
            }
        };

        const frame = (time) => {
            handle = null;
            if (done) return;
            if (t0 === null) t0 = time;
            const elapsed = time - t0;
            if (elapsed >= seq.duration) return finish();
            render(elapsed);
            if (!done) handle = raf(frame);
        };

        if (!ctx) return finish();
        container.addEventListener('click', finish);
        doc.addEventListener('keydown', finish);
        // A backstop for throttled frames (a hidden tab), so the game never waits forever.
        timer = setT(finish, seq.duration + 1500);
        render(0);
        if (!done) handle = raf(frame);
    });
}

function prefersReducedMotion(env) {
    const mm = env.matchMedia || (typeof globalThis.matchMedia === 'function' ? (q) => globalThis.matchMedia(q) : null);
    try {
        return Boolean(mm && mm('(prefers-reduced-motion: reduce)')?.matches);
    } catch {
        return false;
    }
}
