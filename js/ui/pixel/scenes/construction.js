// Building site (construction). Market link: the tower crane. When steel or
// copper (STEEL, COPPER) is the big mover the crane stands idle under a red
// light with the top floors tarped over in a storm, and swings a heavy load
// of beams up to a growing tower in a boom.

import { PAL } from '../palette.js';
import { layout, ground, backdrop, block, windows, lorry, drive, person, blinker, phase } from '../parts.js';

function lattice(px, x, top, base) {
    px.vline(x, top, base - top, PAL.yellow);
    px.vline(x + 3, top, base - top, PAL.yellow);
    for (let y = top; y < base - 2; y += 3) {
        px.line(x + 1, y, x + 2, y + 2, PAL.orangeDark);
        px.hline(x, y, 4, PAL.orangeDark);
    }
}

function beam(px, x, y, len, c = PAL.steel) {
    px.outlined(PAL.ink, () => px.rect(x, y, len, 2, c));
    px.hline(x, y, len, PAL.wall0);
}

// The tower: clad lower floors, a bare steel frame above, the slab being poured on top.
function tower(px, x, G, floors, tarped, tMs) {
    const w = 30, fh = 5, clad = 3;
    block(px, x, G, w, clad * fh, 8, { front: PAL.wall1, side: PAL.wall2, roof: PAL.wall3 });
    windows(px, x + 2, G - clad * fh + 1, 6, clad, { w: 3, h: 3, gx: 2, gy: 2, lit: 0.1, seed: 8, glass: PAL.glass });
    const top = G - floors * fh;
    for (let f = clad; f < floors; f++) {
        const y = G - (f + 1) * fh;
        px.hline(x, y, w + 1, PAL.wall3);
        px.line(x + w, y, x + w + 7, y - 4, PAL.wall3);
        for (let c = 0; c <= w; c += 6) px.vline(x + c, y + 1, fh - 1, PAL.orange);
        px.vline(x + w + 7, y - 3, fh - 1, PAL.orangeDark);
    }
    px.line(x, top, x + 7, top - 4, PAL.wall3);
    px.hline(x + 7, top - 4, w + 1, PAL.wall3);
    if (tarped) {
        // flapping blue tarpaulin over the unfinished frame
        const flap = Math.floor(tMs / 200) % 2;
        px.rect(x, top, w + 1, (floors - clad) * fh - 1, PAL.blue);
        for (let c = 0; c <= w; c += 3) px.pixel(x + c, top + (floors - clad) * fh - 1 + (c % 2 ? flap : 0), PAL.blueDark);
        for (let c = 2; c < w; c += 6) px.vline(x + c, top + 1, (floors - clad) * fh - 3, PAL.blueDark);
    }
}

function crane(px, mx, G, state, tMs, stalled, boom) {
    const top = G - 52;
    lattice(px, mx, top, G);
    // jib, counter-jib, apex and ties
    const jibL = mx - 14, jibR = mx + 54;
    px.rect(jibL, top, jibR - jibL, 2, PAL.yellow);
    for (let x = jibL; x < jibR; x += 3) px.pixel(x, top + 1, PAL.orangeDark);
    px.outlined(PAL.ink, () => px.rect(jibL, top + 2, 6, 4, PAL.wall3));
    px.line(mx + 1, top - 6, jibL, top, PAL.wall4);
    px.line(mx + 2, top - 6, jibR - 6, top, PAL.wall4);
    px.vline(mx + 1, top - 6, 6, PAL.yellow);
    px.vline(mx + 2, top - 6, 6, PAL.yellow);
    px.outlined(PAL.ink, () => px.rect(mx - 1, top + 2, 5, 4, PAL.orange));
    px.rect(mx, top + 3, 3, 2, PAL.glass);
    blinker(px, jibR - 1, top - 1, PAL.lamp, tMs, stalled ? 500 : 1600);

    // trolley and hook: parked when stalled, otherwise lifting beams
    let tx, hookY;
    if (stalled) {
        tx = mx + 8;
        hookY = top + 6;
    } else {
        const p = phase(tMs, boom ? 4200 : 7000);
        const swing = (1 - Math.cos(p * Math.PI * 2)) / 2;
        tx = Math.floor(mx + 10 + swing * 36);
        hookY = Math.floor(top + 26 - Math.sin(p * Math.PI) * 14);
    }
    px.rect(tx - 1, top + 2, 4, 1, PAL.wall4);
    px.vline(tx + 1, top + 3, hookY - top - 3, PAL.ink);
    px.sprite(['kk', '.k'], tx + 1, hookY, { k: PAL.ink });
    if (!stalled) {
        const len = boom ? 14 : 10;
        px.line(tx + 1, hookY + 2, tx + 1 - len / 2, hookY + 5, PAL.ink);
        px.line(tx + 1, hookY + 2, tx + 1 + len / 2, hookY + 5, PAL.ink);
        beam(px, tx + 1 - len / 2, hookY + 5, len + 1, boom && state.highlight === 'COPPER' ? PAL.copper : PAL.steel);
        if (boom) beam(px, tx + 2 - len / 2, hookY + 7, len - 1, boom && state.highlight === 'COPPER' ? PAL.copper : PAL.steel);
    }
}

function cabins(px, x, G) {
    for (const [dx, dy, c] of [[0, 0, PAL.blue], [16, 0, PAL.wall1], [6, -7, PAL.wall1]]) {
        px.outlined(PAL.ink, () => px.rect(x + dx, G - 7 + dy, 15, 7, c));
        windows(px, x + dx + 2, G - 5 + dy, 3, 1, { w: 3, h: 2, gx: 1, lit: 0.3, seed: dx });
    }
}

function mixer(px, x, base, tMs) {
    px.outlined(PAL.ink, () => {
        px.rect(x, base - 4, 18, 3, PAL.wall3);
        px.rect(x + 13, base - 8, 5, 5, PAL.orange);
        px.disc(x + 6, base - 7, 3, PAL.wall1);
        px.rect(x + 2, base - 9, 9, 4, PAL.wall1);
    });
    px.rect(x + 15, base - 7, 2, 2, PAL.glass);
    const s = Math.floor(tMs / 150) % 3;
    for (let i = 0; i < 3; i++) px.vline(x + 3 + i * 3 + s, base - 9, 4, PAL.orange);
    px.sprite(['.kk.....kk..kk.'], x + 1, base - 1, { k: PAL.ink });
}

export function draw(px, state, tMs) {
    const L = layout(px);
    const { w, cx, G, roadBottom } = L;
    const linked = state.highlight === 'STEEL' || state.highlight === 'COPPER';
    const stalled = linked && state.mood === 'storm';
    const boom = linked && state.mood === 'boom';

    backdrop(px, L, { hills: false, city: true, seed: 11 });
    ground(px, L, { lot: 'dirt' });

    tower(px, cx - 4, G, boom ? 8 : 7, stalled, tMs);
    crane(px, cx - 26, G, state, tMs, stalled, boom);
    cabins(px, cx + 38, G);

    // the steel stack waiting to go up
    const stack = stalled ? 1 : boom ? 5 : 3;
    for (let i = 0; i < stack; i++) beam(px, cx - 66 + (i % 2), G + 1 - i * 3, 16, state.highlight === 'COPPER' ? PAL.copper : PAL.steel);

    // hard hats at work, unless the site is shut
    if (!stalled) {
        person(px, cx - 44 + Math.floor(Math.sin(tMs / 1100) * 5), G + 3, { shirt: PAL.orange, hat: PAL.yellow, tMs });
        person(px, cx + 30, G + 3, { shirt: PAL.orange, hat: PAL.white, tMs, walking: false });
    }

    // site hoarding along the front of the lot
    for (let x = 0; x < w; x++) {
        if (x > cx - 52 && x < cx - 34) continue;   // the gate
        px.pixel(x, G + 4, ((x >> 1) & 1) ? PAL.orange : PAL.white);
        if (x % 10 === 0) px.vline(x, G + 2, 3, PAL.wall4);
    }

    mixer(px, drive(L, tMs, 0.028, 20, 10), roadBottom - 1, tMs);
    if (state.mood !== 'storm') lorry(px, drive(L, tMs, 0.02, 18, 130, -1), roadBottom - 1, { body: PAL.yellow, cab: PAL.wall1, flip: true });
}
