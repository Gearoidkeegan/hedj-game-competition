// Energy grid (energy). Market link: the oil field. When oil or gas (BRENT,
// NATGAS) is the big mover the pump jack stops and the flare roars in a
// storm, and the jack nods double-time beside a growing pile of barrels in a
// boom. The wind farm always turns, fastest in a storm.

import { PAL } from '../palette.js';
import { layout, ground, backdrop, block, windows, lorry, drive, blinker } from '../parts.js';

function turbine(px, x, base, h, angle) {
    px.vline(x, base - h, h, PAL.wall0);
    px.vline(x + 1, base - h + 2, h - 2, PAL.wall2);
    const hy = base - h;
    for (let k = 0; k < 3; k++) {
        const a = angle + (k * Math.PI * 2) / 3;
        px.line(x, hy, x + Math.round(Math.cos(a) * 8), hy + Math.round(Math.sin(a) * 8), PAL.white);
    }
    px.rect(x - 1, hy - 1, 3, 2, PAL.wall1);
}

function pylon(px, x, base) {
    px.sprite([
        '..k..',
        'kkkkk',
        '.k.k.',
        '.kkk.',
        '.k.k.',
        'kkkkk',
        '.k.k.',
        '.k.k.',
        'k...k',
        'k...k',
        'k...k',
    ], x - 2, base - 11, { k: PAL.wall4 });
}

function tank(px, x, G, w, h, c = PAL.wall0) {
    px.outlined(PAL.ink, () => {
        px.rect(x, G - h, w, h, c);
        px.rect(x + 1, G - h - 1, w - 2, 1, c);
        px.rect(x + 3, G - h - 2, w - 6, 1, c);
    });
    px.rect(x + w - 4, G - h, 4, h, PAL.wall2);
    px.vline(x + 2, G - h, h, PAL.white);
    px.hline(x, G - Math.floor(h / 2), w, PAL.orange);
    for (let y = G - h + 1; y < G; y += 2) px.pixel(x + w - 6, y, PAL.wall3);
}

function column(px, x, G, h) {
    px.outlined(PAL.ink, () => px.rect(x, G - h, 5, h, PAL.wall1));
    px.vline(x + 4, G - h, h, PAL.wall2);
    for (let y = G - h + 4; y < G - 2; y += 6) {
        px.hline(x - 2, y, 9, PAL.orange);
        px.pixel(x - 2, y - 1, PAL.orange);
        px.pixel(x + 6, y - 1, PAL.orange);
    }
    px.rect(x + 1, G - h - 2, 3, 2, PAL.wall3);
}

function flare(px, x, G, tMs, size) {
    const h = 40;
    px.vline(x, G - h, h, PAL.wall3);
    px.vline(x + 1, G - h, h, PAL.wall4);
    for (let y = G - h + 6; y < G; y += 8) px.hline(x - 1, y, 4, PAL.wall4);
    const flick = Math.floor(tMs / 90);
    const fh = size + (flick % 3);
    for (let i = 0; i < fh; i++) {
        const half = Math.max(0, Math.round(((fh - i) / fh) * (size / 2.5)) - (i === fh - 1 ? 1 : 0));
        const wob = Math.round(Math.sin(tMs / 120 + i) * (i / fh) * 1.5);
        const c = i < fh * 0.35 ? PAL.flameY : i < fh * 0.75 ? PAL.flameO : PAL.flameR;
        px.hline(x - half + wob, G - h - 1 - i, half * 2 + 2, c);
    }
}

// The nodding donkey: walking beam on an A-frame, horse head over the well.
function pumpJack(px, x, G, tMs, rate) {
    const a = Math.sin(tMs * rate) * 0.35;
    const pivotX = x + 10, pivotY = G - 12;
    px.line(x + 6, G - 1, pivotX, pivotY, PAL.wall4);
    px.line(x + 14, G - 1, pivotX, pivotY, PAL.wall4);
    const dx = Math.cos(a) * 10, dy = Math.sin(a) * 10;
    const hx = Math.round(pivotX - dx), hy = Math.round(pivotY - dy);
    const tx = Math.round(pivotX + dx), ty = Math.round(pivotY + dy);
    px.outlined(PAL.ink, () => {
        px.line(hx, hy, tx, ty, PAL.orange);
        px.rect(hx - 2, hy - 1, 3, 5, PAL.orange);
        px.rect(tx - 1, ty, 3, 3, PAL.wall3);
    });
    px.vline(hx - 1, hy + 4, Math.max(0, G - 2 - (hy + 4)), PAL.ink);
    px.outlined(PAL.ink, () => px.rect(hx - 3, G - 2, 5, 2, PAL.wall2));
    px.rect(x + 3, G - 1, 16, 1, PAL.wall4);
    px.pixel(pivotX, pivotY, PAL.ink);
}

function barrels(px, x, G, n) {
    for (let i = 0; i < n; i++) {
        const col = i % 4, row = Math.floor(i / 4);
        const bx = x + col * 4 + row * 2, by = G - 4 - row * 4;
        px.outlined(PAL.ink, () => px.rect(bx, by, 3, 4, PAL.blue));
        px.hline(bx, by + 1, 3, PAL.blueDark);
        px.pixel(bx, by, PAL.glass);
    }
}

export function draw(px, state, tMs) {
    const L = layout(px);
    const { w, cx, G, horizon, roadBottom } = L;
    const linked = state.highlight === 'BRENT' || state.highlight === 'NATGAS';
    const stopped = linked && state.mood === 'storm';
    const gusher = linked && state.mood === 'boom';

    backdrop(px, L, { hills: true, seed: 13 });

    // the wind farm on the far ridge
    const spin = state.mood === 'storm' ? 0.009 : state.mood === 'boom' ? 0.004 : 0.002;
    for (const [fx, hgt] of [[0.08, 22], [0.22, 18], [0.78, 20], [0.92, 24]]) {
        turbine(px, Math.floor(w * fx), horizon - 4, hgt, tMs * spin + fx * 9);
    }

    ground(px, L, { lot: 'grass' });

    // power lines strung across the scene on pylons
    const pylons = [];
    for (let x = 6; x < w; x += 44) pylons.push(x);
    for (let i = 0; i < pylons.length - 1; i++) {
        const a = pylons[i], b = pylons[i + 1];
        for (let x = a; x <= b; x++) {
            const t = (x - a) / (b - a);
            px.pixel(x, G - 14 + Math.round(4 * t * (1 - t) * 3), PAL.wall4);
        }
    }
    for (const x of pylons) pylon(px, x, G - 3);

    // the refinery: storage tanks, distillation column, control block, flare
    tank(px, cx - 34, G, 16, 9);
    tank(px, cx - 20, G + 2, 14, 7, PAL.wall1);
    column(px, cx - 2, G, 30);
    column(px, cx + 6, G, 22);
    block(px, cx + 14, G, 18, 9, 6, { front: PAL.wall1, side: PAL.wall2, roof: PAL.wall0 });
    windows(px, cx + 16, G - 7, 4, 1, { w: 2, h: 2, gx: 2, lit: state.mood === 'storm' ? 1 : 0.3, seed: 5 });
    px.line(cx - 18, G - 6, cx - 2, G - 6, PAL.wall3);
    px.line(cx + 3, G - 4, cx + 14, G - 4, PAL.wall3);
    flare(px, cx + 38, G, tMs, stopped ? 12 : gusher ? 6 : 4);
    blinker(px, cx + 38, G - 41, PAL.lamp, tMs, 1300);

    // the oil field out front
    pumpJack(px, cx - 66, G + 4, tMs, stopped ? 0 : gusher ? 0.006 : 0.003);
    barrels(px, cx - 48, G + 4, stopped ? 0 : gusher ? 7 : 2);

    lorry(px, drive(L, tMs, 0.03, 18, 60), roadBottom - 1, { body: PAL.wall0, cab: PAL.red });
    px.hline(drive(L, tMs, 0.03, 18, 60), roadBottom - 5, 10, PAL.orange);
}
