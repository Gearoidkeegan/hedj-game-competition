// Airport (airline). Market link: when jet fuel (JETNWE) is the big mover in
// a storm, the fleet is grounded: planes parked at the gates and the runway
// coned off. In a fuel boom a second jet is already up in the sky.

import { PAL } from '../palette.js';
import { layout, ground, backdrop, block, windows, blinker, cone, phase, hash } from '../parts.js';

const PLANE = [
    'tt......................',
    'tOt.....................',
    '.tOt....................',
    '.twwwwwwwwwwwwwwwwwww...',
    'wwwwkwkwkwkwkwkwkwkwwgg.',
    'ooooooooooooooooooooowww',
    '.sssssssEEEssssssssssss.',
    '........EE..............',
];
const GEAR = '.....k...........k......';
const PLANE_PAL = {
    t: PAL.blue, O: PAL.orange, w: PAL.white, k: PAL.glassDark, g: PAL.glass,
    o: PAL.orange, s: PAL.wall1, E: PAL.wall3,
};

function plane(px, x, y, { flip = false, gear = true } = {}) {
    px.outlined(PAL.ink, () => {
        px.sprite(PLANE, x, y, PLANE_PAL, flip);
        if (gear) px.sprite([GEAR], x, y + 8, { k: PAL.ink }, flip);
    });
}

function tower(px, x, G, t) {
    px.outlined(PAL.ink, () => {
        px.rect(x, G - 26, 4, 26, PAL.wall1);
        px.vline(x + 3, G - 26, 26, PAL.wall2);
        px.rect(x - 4, G - 33, 12, 7, PAL.glassDark);
        px.rect(x - 5, G - 35, 14, 2, PAL.wall3);
        px.vline(x + 2, G - 39, 4, PAL.wall3);
    });
    px.rect(x - 3, G - 32, 10, 3, PAL.glass);
    px.hline(x - 3, G - 32, 10, '#b8d8f0');
    px.hline(x - 4, G - 27, 12, PAL.orange);
    for (let y = G - 22; y < G - 2; y += 5) px.pixel(x + 1, y, PAL.glass);
    blinker(px, x + 2, G - 40, PAL.lamp, t, 1400);
}

function terminal(px, x, G, mood, t) {
    block(px, x, G, 62, 15, 8, { front: PAL.wall1, side: PAL.wall2, roof: PAL.wall0 });
    px.rect(x + 2, G - 12, 58, 6, PAL.glass);
    windows(px, x + 3, G - 11, 14, 1, { w: 3, h: 4, gx: 1, lit: mood === 'storm' ? 0.6 : 0.15, seed: 4 });
    px.hline(x, G - 14, 62, PAL.orange);
    px.hline(x, G - 13, 62, PAL.orangeDark);
    // entrance canopy and doors
    px.rect(x + 27, G - 5, 8, 5, PAL.glassDark);
    px.hline(x + 25, G - 6, 12, PAL.wall4);
    // rooftop plant
    px.outlined(PAL.ink, () => px.rect(x + 46, G - 19, 6, 3, PAL.wall2));
    px.pixel(x + 48 + (Math.floor(t / 250) % 2), G - 18, PAL.wall4);
}

function hangar(px, x, G, open) {
    const w = 38, h = 12;
    px.outlined(PAL.ink, () => {
        for (let i = 0; i < w; i++) {
            const k = (i - w / 2) / (w / 2);
            const arch = Math.round(Math.sqrt(Math.max(0, 1 - k * k)) * 8);
            px.rect(x + i, G - h - arch, 1, h + arch, i < w / 2 ? PAL.wall2 : PAL.wall3);
        }
    });
    for (let i = 2; i < w - 2; i += 3) {
        const k = (i - w / 2) / (w / 2);
        const arch = Math.round(Math.sqrt(Math.max(0, 1 - k * k)) * 8);
        px.vline(x + i, G - h - arch + 1, arch, PAL.wall1);
    }
    px.rect(x + 5, G - 11, w - 10, 11, open ? '#2c3a52' : PAL.wall4);
    if (open) {
        px.sprite(PLANE.slice(3, 7).map((r) => r.slice(14)), x + 6, G - 6, PLANE_PAL);
    } else {
        for (let y = G - 10; y < G; y += 2) px.hline(x + 5, y, w - 10, PAL.wall3);
    }
}

function windsock(px, x, G, mood, t) {
    px.vline(x, G - 12, 12, PAL.wall4);
    const flap = Math.floor(t / (mood === 'storm' ? 120 : 400)) % 2;
    const droop = mood === 'calm' ? 1 : 0;
    for (let i = 0; i < 6; i++) {
        const y = G - 12 + Math.floor((i * droop) / 2) + (i > 3 ? flap : 0);
        px.rect(x + 1 + i, y, 1, 2, i % 2 ? PAL.white : PAL.orange);
    }
}

export function draw(px, state, tMs) {
    const L = layout(px);
    const { w, cx, G, roadTop, roadBottom } = L;
    const grounded = state.mood === 'storm' && state.highlight === 'JETNWE';

    backdrop(px, L, { hills: true, city: true, seed: 3 });
    ground(px, L, { lot: 'tarmac', roadLine: PAL.paint });

    // runway threshold stripes and edge lights
    for (let i = 0; i < 4; i++) px.rect(4 + i * 3, roadTop + 2, 2, 5, PAL.paint);
    for (let x = 0; x < w; x += 10) {
        const on = grounded ? phase(tMs, 900) < 0.5 : Math.floor(tMs / 120) % Math.ceil(w / 10) === x / 10;
        px.pixel(x, roadTop - 1, grounded ? (on ? PAL.lamp : PAL.redDark) : (on ? PAL.flameY : PAL.wall3));
    }

    tower(px, cx - 66, G, tMs);
    terminal(px, cx - 52, G, state.mood, tMs);
    hangar(px, cx + 22, G, !grounded);
    windsock(px, cx + 66, roadTop - 1, state.mood, tMs);

    // the stand: one jet always parked at the gate, nose to the terminal
    const tug = Math.floor(Math.sin(tMs / 1500) * 6);
    plane(px, cx - 34, G - 5, { flip: true });
    px.outlined(PAL.ink, () => px.sprite(['yy.cc.cc', 'kk.kk.kk'], cx - 10 + tug, G + 2, { y: PAL.yellow, c: PAL.wall2, k: PAL.ink }));

    if (grounded) {
        // the whole fleet sits on the ground and the runway is closed
        plane(px, cx + 8, roadBottom - 9);
        for (let x = 12; x < w - 4; x += 22) cone(px, x, roadBottom);
        for (let i = 0; i < 3; i++) {
            const xx = Math.floor(w * (0.2 + i * 0.3));
            px.line(xx, roadTop + 2, xx + 4, roadTop + 6, PAL.red);
            px.line(xx + 4, roadTop + 2, xx, roadTop + 6, PAL.red);
        }
        return;
    }

    // take-off run: roll, rotate, climb out over the right-hand edge
    const p = phase(tMs, 9000);
    const lift = w * 0.55;
    const x = Math.floor(-26 + p * p * (w + 120));
    const climb = x > lift ? Math.floor((x - lift) * 0.45) : 0;
    plane(px, x, roadBottom - 9 - climb, { gear: climb < 4 });

    if (state.mood === 'boom') {
        // a second jet already cruising
        const cx2 = Math.floor(((tMs * 0.02) % (w + 40)) - 30);
        plane(px, w - cx2, 10 + Math.floor(hash(1, 2) * 6), { flip: true, gear: false });
    }
}
