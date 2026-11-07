// Reusable pixel-art parts shared by the industry scenes: layout, ground,
// oblique boxes, windows, trees, vehicles, people, smoke and lights.
// Everything is a pure function of its arguments (tMs drives all motion).

import { PAL, mix } from './palette.js';

// Deterministic 0..1 noise for an integer (or a pair of integers).
export function hash(a, b = 0) {
    let n = (a * 374761393 + b * 668265263) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    n = n ^ (n >>> 16);
    return (n >>> 0) / 4294967296;
}

// Phase 0..1 of a repeating cycle of `period` ms.
export const phase = (tMs, period, offset = 0) => (((tMs + offset) % period) + period) % period / period;

// Scene geometry: everything stands on the ground line G, anchored to the
// bottom of the canvas, so taller canvases just show more sky.
export function layout(px) {
    const G = px.h - 24;
    return { w: px.w, h: px.h, cx: Math.floor(px.w / 2), G, horizon: G - 4, roadTop: G + 5, roadBottom: G + 13 };
}

// The ground: a lot surface from the horizon to the road, a road with a dashed
// centre line, then a strip of foreground grass.
export function ground(px, L, { lot = 'grass', roadLine = PAL.paint } = {}) {
    const { w, h, horizon, roadTop, roadBottom } = L;
    const lots = {
        grass: [PAL.grass, PAL.grassDark],
        tarmac: [PAL.tarmac, PAL.tarmacDark],
        dirt: [PAL.dirt, PAL.dirtDark],
        paving: [PAL.wall1, PAL.wall2],
    };
    const [c1, c2] = lots[lot];
    px.rect(0, horizon, w, roadTop - horizon, c1);
    px.dither(0, horizon, w, 1, mix(c1, '#ffffff', 0.25), c1);
    for (let x = 0; x < w; x++) {
        for (let y = horizon + 1; y < roadTop; y++) if (hash(x, y) < 0.09) px.pixel(x, y, c2);
    }
    px.hline(0, roadTop - 1, w, PAL.kerb);
    px.rect(0, roadTop, w, roadBottom - roadTop, PAL.tarmac);
    px.hline(0, roadTop, w, PAL.tarmacDark);
    const mid = Math.floor((roadTop + roadBottom) / 2);
    for (let x = 2; x < w; x += 8) px.hline(x, mid, 4, roadLine);
    px.hline(0, roadBottom, w, PAL.kerb);
    px.rect(0, roadBottom + 1, w, h - roadBottom - 1, PAL.grass);
    for (let x = 0; x < w; x++) {
        for (let y = roadBottom + 1; y < h; y++) {
            const n = hash(x + 911, y);
            if (n < 0.1) px.pixel(x, y, PAL.grassDark);
            else if (n > 0.95) px.pixel(x, y, PAL.grassLight);
        }
    }
}

// Pale distant silhouettes along the horizon: rolling hills, a far city, or both.
export function backdrop(px, L, { hills = true, city = false, seed = 1 } = {}) {
    const { w, horizon } = L;
    if (hills) {
        for (let x = 0; x < w; x++) {
            const y = horizon - 6 - Math.round(4 * Math.sin((x + seed * 37) / 17) + 3 * Math.sin((x + seed * 11) / 7));
            px.rect(x, y, 1, horizon - y, '#9fc2a6');
            px.pixel(x, y, '#b4d3b5');
        }
    }
    if (city) {
        let x = 0;
        while (x < w) {
            const bw = 5 + Math.floor(hash(x, seed) * 8);
            const bh = 6 + Math.floor(hash(seed, x) * 14);
            px.rect(x, horizon - bh, bw, bh, '#a9bdd2');
            px.vline(x + bw - 1, horizon - bh, bh, '#9bb0c7');
            for (let wy = horizon - bh + 2; wy < horizon - 1; wy += 3) {
                for (let wx = x + 1; wx < x + bw - 2; wx += 2) if (hash(wx, wy + seed) < 0.3) px.pixel(wx, wy, '#c3d3e3');
            }
            x += bw + (hash(x + 3, seed) < 0.3 ? 2 : 0);
        }
    }
}

// An oblique box: a front face, a right side face receding up-right at 1:2 and
// a roof. base is the y of the ground the box stands on (exclusive).
export function box(px, x, base, w, h, d, { front = PAL.wall1, side = PAL.wall2, roof = PAL.wall0 } = {}) {
    const rise = Math.floor(d / 2);
    const top = base - h;
    px.rect(x, top, w, h, front);
    for (let j = 0; j < w + d; j++) {
        const roofTop = top - Math.min(rise, Math.floor((j + 1) / 2));
        const faceTop = j < w ? top : top - Math.floor((j - w + 1) / 2);
        for (let y = roofTop; y < faceTop; y++) px.pixel(x + j, y, roof);
        if (j >= w) {
            const k = Math.floor((j - w + 1) / 2);
            for (let y = faceTop; y < base - k; y++) px.pixel(x + j, y, side);
        }
    }
}

// An outlined box with a lit top edge on the front face.
export function block(px, x, base, w, h, d, colours) {
    px.outlined(PAL.ink, () => box(px, x, base, w, h, d, colours));
    px.hline(x, base - h, w, mix(colours.front || PAL.wall1, '#ffffff', 0.35));
}

// A grid of windows. lit is the share of lit panes; seed keeps the pattern stable.
export function windows(px, x, y, cols, rows, { w = 2, h = 2, gx = 2, gy = 2, lit = 0.25, seed = 0, glass = PAL.glass } = {}) {
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const wx = x + c * (w + gx), wy = y + r * (h + gy);
            const on = hash(c + seed * 13, r + seed) < lit;
            px.rect(wx, wy, w, h, on ? PAL.glassLit : glass);
            if (!on) px.pixel(wx, wy, mix(glass, '#ffffff', 0.5));
        }
    }
}

const TREE = [
    '..ggg..',
    '.gGggg.',
    'gGGgggd',
    'gGgggdd',
    '.gggdd.',
    '..dtd..',
    '...t...',
];

export function tree(px, x, base) {
    const pal = { g: PAL.leaf, G: PAL.leafLight, d: PAL.leafDark, t: PAL.trunk };
    px.outlined(PAL.ink, () => px.sprite(TREE, x - 3, base - 7, pal));
    px.sprite(['.G', 'G.'], x - 2, base - 6, pal);
}

const LORRY = [
    '..........kkkkk.',
    'bbbbbbbbbb.kwwck',
    'bbbbbbbbbb.kwwcc',
    'bbbbbbbbbb.kcccc',
    'bbbbbbbbbb.ccccc',
    'ssssssssssssssss',
    '.oo.....oo...oo.',
];

// A delivery lorry, facing right unless flip. body colours the box trailer.
export function lorry(px, x, base, { body = PAL.white, cab = PAL.orange, flip = false } = {}) {
    const pal = { b: body, k: PAL.ink, w: PAL.glass, c: cab, s: PAL.wall4, o: PAL.ink };
    px.outlined(PAL.ink, () => px.sprite(LORRY, x, base - 7, pal, flip));
    px.hline(x + (flip ? 6 : 0), base - 6, 10, mix(body, '#ffffff', 0.4));
}

// x position of something driving across the full width and back round.
export function drive(L, tMs, speed, len, offset = 0, dir = 1) {
    const span = L.w + len * 2;
    const p = (((tMs * speed + offset) % span) + span) % span;
    return dir > 0 ? Math.floor(p - len) : Math.floor(L.w + len - p - len);
}

// A tiny person 3 px wide, 6 px tall, with a two-frame walk. Optional: a hard
// hat colour, a shopping bag colour, an umbrella colour.
export function person(px, x, base, { shirt = PAL.blue, tMs = 0, walking = true, bag = null, hat = null, umbrella = null } = {}) {
    const step = walking && Math.floor(tMs / 220) % 2;
    px.pixel(x + 1, base - 6, hat || PAL.ink);
    px.pixel(x + 1, base - 5, PAL.skin);
    px.rect(x, base - 4, 3, 2, shirt);
    px.pixel(x + (step ? 0 : 1), base - 2, PAL.ink);
    px.pixel(x + (step ? 2 : 1), base - 1, PAL.ink);
    px.pixel(x + (step ? 0 : 1), base - 1, PAL.ink);
    if (bag) px.rect(x + 3, base - 3, 2, 2, bag);
    if (umbrella) {
        px.sprite(['.uuu.', 'uuuuu', '..k..'], x - 1, base - 9, { u: umbrella, k: PAL.ink });
    }
}

// Rising, fading puffs of smoke from (x, y). strength 0 draws nothing.
export function smoke(px, x, y, tMs, { strength = 1 } = {}) {
    if (strength <= 0) return;
    const n = Math.max(1, Math.round(4 * strength));
    for (let i = 0; i < n; i++) {
        const p = phase(tMs, 2600, i * (2600 / n));
        const py = y - Math.floor(p * 18 * strength);
        const pxx = x + Math.round(Math.sin(p * 6 + i) * 2 + p * 5);
        const r = 1 + Math.floor(p * 3);
        if (p > 0.85) continue;
        px.disc(pxx, py, r, p > 0.55 ? PAL.smoke : PAL.white);
    }
}

export function blinker(px, x, y, c, tMs, period = 1200) {
    if (phase(tMs, period) < 0.5) {
        px.pixel(x, y, c);
        px.pixel(x - 1, y, mix(c, '#ffffff', 0.4));
        px.pixel(x + 1, y, mix(c, '#ffffff', 0.4));
        px.pixel(x, y - 1, mix(c, '#ffffff', 0.4));
    } else {
        px.pixel(x, y, mix(c, PAL.ink, 0.5));
    }
}

// A small traffic cone.
export function cone(px, x, base) {
    px.sprite(['.o.', '.w.', 'ooo'], x, base - 3, { o: PAL.orange, w: PAL.white });
}
