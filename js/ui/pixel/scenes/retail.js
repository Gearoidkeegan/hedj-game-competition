// Shopping centre (retail). Market link: the high street. When sterling
// (GBPUSD, EURGBP) is the big mover the shop shutters come half down in a
// storm, and red-white-and-blue bunting goes up over a queue in a boom.
// Shoppers come out in the sun and hide under umbrellas in the rain.

import { PAL } from '../palette.js';
import { layout, ground, backdrop, block, person, lorry, drive, hash } from '../parts.js';

const AWNINGS = [PAL.orange, PAL.blue, PAL.green, PAL.red];
const SHIRTS = [PAL.red, PAL.blue, PAL.green, PAL.orange, PAL.yellow, PAL.wall4];
const CAR = ['..ccccc..', '.cggcggc.', 'ccccccccc', 'ckcccccck', '.k.....k.'];

function shopFront(px, x, G, i, shutters) {
    const w = 18;
    const c = AWNINGS[i % AWNINGS.length];
    // sign band, window display, awning with a scalloped edge
    px.rect(x + 2, G - 15, w - 4, 3, c);
    px.hline(x + 3, G - 14, w - 6, PAL.white);
    px.rect(x + 1, G - 9, w - 2, 8, PAL.glass);
    for (let k = 0; k < 4; k++) px.rect(x + 3 + k * 4, G - 4 - (k % 2), 2, 2 + (k % 2), SHIRTS[(i + k) % SHIRTS.length]);
    px.pixel(x + 2, G - 8, PAL.white);
    for (let k = 0; k < w; k++) {
        const stripe = (k >> 1) & 1 ? c : PAL.white;
        px.rect(x + k, G - 11, 1, 2, stripe);
        if (k % 3 !== 1) px.pixel(x + k, G - 9, stripe);
    }
    if (shutters) {
        px.rect(x + 1, G - 8, w - 2, 5, PAL.wall3);
        for (let y = G - 8; y < G - 3; y += 2) px.hline(x + 1, y, w - 2, PAL.wall4);
        px.pixel(x + 4, G - 5, PAL.red);
        px.pixel(x + w - 5, G - 5, PAL.red);
    }
}

function atrium(px, x, G, top) {
    const w = 22;
    px.outlined(PAL.ink, () => {
        for (let i = 0; i < w; i++) {
            const k = (i - w / 2 + 0.5) / (w / 2);
            const arch = Math.round(Math.sqrt(Math.max(0, 1 - k * k)) * 8);
            px.rect(x + i, top - arch, 1, G - top + arch, PAL.glass);
        }
    });
    for (let i = 3; i < w; i += 4) px.vline(x + i, top - 7, G - top + 7, PAL.wall0);
    for (let y = top; y < G; y += 4) px.hline(x, y, w, PAL.wall0);
    px.rect(x + 7, G - 7, 8, 7, PAL.glassDark);
    px.vline(x + 11, G - 7, 7, PAL.wall0);
}

function bunting(px, x0, x1, y, tMs) {
    const cols = [PAL.red, PAL.white, PAL.blue];
    for (let x = x0; x < x1; x++) {
        const t = (x - x0) / (x1 - x0);
        const sag = Math.round(Math.sin(t * Math.PI) * 3);
        px.pixel(x, y + sag, PAL.ink);
        if ((x - x0) % 4 === 0) {
            const c = cols[((x - x0) / 4) % 3];
            const flutter = Math.floor(tMs / 250 + x) % 2;
            px.sprite(['ccc', '.c' + (flutter ? 'c' : '.')], x, y + sag + 1, { c });
        }
    }
}

export function draw(px, state, tMs) {
    const L = layout(px);
    const { w, cx, G, roadBottom } = L;
    const sterling = state.highlight === 'GBPUSD' || state.highlight === 'EURGBP';
    const shutters = sterling && state.mood === 'storm';
    const party = sterling && state.mood === 'boom';

    backdrop(px, L, { hills: false, city: true, seed: 17 });
    ground(px, L, { lot: 'paving' });

    // the centre: a long block with two shop fronts either side of a glass atrium
    const bx = cx - 58;
    block(px, bx, G, 116, 17, 10, { front: PAL.wall1, side: PAL.wall2, roof: PAL.wall0 });
    [3, 24, 72, 93].forEach((dx, i) => shopFront(px, bx + dx, G, i, shutters));
    atrium(px, cx - 11, G, G - 17);
    if (party) bunting(px, bx + 2, bx + 114, G - 21, tMs);

    // the car park, fuller in the sun
    const cars = state.mood === 'storm' ? 2 : state.mood === 'boom' ? 7 : 4;
    const carColours = [PAL.red, PAL.blue, PAL.white, PAL.yellow, PAL.green, PAL.wall3, PAL.orange];
    for (let i = 0; i < cars; i++) {
        const left = i % 2 === 0;
        const slot = Math.floor(i / 2);
        const x = left ? cx - 36 - slot * 11 : cx + 22 + slot * 11;
        px.outlined(PAL.ink, () => px.sprite(CAR, x, G + 4 - 5, { c: carColours[i], g: PAL.glass, k: PAL.ink }));
    }
    for (let x = 4; x < w; x += 11) px.vline(x, G + 1, 3, PAL.white);

    // shoppers out front
    const n = state.mood === 'storm' ? 2 : state.mood === 'boom' ? 7 : 4;
    for (let i = 0; i < n; i++) {
        const range = 22;
        const p = (tMs * (0.004 + hash(i, 1) * 0.004) + hash(i, 2) * range * 2) % (range * 2);
        const x = cx - range + Math.floor(p < range ? p : range * 2 - p);
        person(px, x, G + 3, {
            shirt: SHIRTS[i % SHIRTS.length], tMs: tMs + i * 110,
            bag: state.mood === 'boom' ? PAL.orange : null,
            umbrella: state.mood === 'storm' ? (i % 2 ? PAL.red : PAL.blue) : null,
        });
    }
    if (party) for (let i = 0; i < 4; i++) person(px, cx + 12 + i * 4, G + 1, { shirt: SHIRTS[(i + 2) % 6], walking: false });

    lorry(px, drive(L, tMs, 0.03, 18, 70), roadBottom - 1, { body: PAL.white, cab: PAL.orange });
}
