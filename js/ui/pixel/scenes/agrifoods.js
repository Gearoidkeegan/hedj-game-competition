// Coffee roastery (agrifoods). Market link: the coffee crop. When COFFEE is
// the big mover the orchard wilts brown in a storm and hangs heavy with red
// cherries (and a picker is out with a basket) in a boom.

import { PAL, mix } from '../palette.js';
import { layout, ground, backdrop, block, windows, lorry, drive, person, smoke, hash } from '../parts.js';

const BUSH = [
    '..ggg..',
    '.gGggg.',
    'gGgggdg',
    'gggdggd',
    '.gdgdd.',
    '...t...',
];

function bush(px, x, base, crop, seed) {
    const pal = crop === 'wilt'
        ? { g: '#9c8550', G: '#b8a36a', d: '#76603a', t: PAL.trunk }
        : { g: PAL.leaf, G: PAL.leafLight, d: PAL.leafDark, t: PAL.trunk };
    px.outlined(PAL.ink, () => px.sprite(BUSH, x, base - 6, pal));
    if (crop === 'wilt') return;
    const cherries = crop === 'bumper' ? 6 : 3;
    for (let i = 0; i < cherries; i++) {
        const cx = x + 1 + Math.floor(hash(seed, i) * 5);
        const cy = base - 5 + Math.floor(hash(i, seed) * 3);
        px.pixel(cx, cy, PAL.cherry);
    }
}

// A row of coffee bushes from x0 to x1 standing on base.
function orchard(px, x0, x1, base, crop, seed) {
    for (let x = x0; x < x1 - 5; x += 8) bush(px, x, base, crop, seed + x);
}

// A pitched roof seen from the gable end, receding d px to the back right.
function gable(px, x, top, w, d) {
    const peak = Math.floor(w / 2);
    const rows = Math.ceil(w / 4);
    px.outlined(PAL.ink, () => {
        for (let r = 0; r < rows; r++) {
            const inset = Math.floor((r * peak) / rows);
            px.rect(x + inset, top - r - 1, w - inset * 2, 1, PAL.wall1);
            // the right-hand slope runs back into the distance
            for (let i = 0; i < d; i++) px.pixel(x + w - inset + i, top - r - 1 - Math.floor(i / 2), (i & 1) ? PAL.wall3 : PAL.wall2);
        }
    });
    for (let r = 0; r < rows; r++) {
        const inset = Math.floor((r * peak) / rows);
        px.pixel(x + inset, top - r - 1, PAL.orange);
        px.pixel(x + w - inset - 1, top - r - 1, PAL.orange);
    }
}

function silo(px, x, G, h) {
    px.outlined(PAL.ink, () => {
        px.rect(x, G - h, 9, h, PAL.wall1);
        px.sprite(['...ooo...', '..ooooo..', '.ooooooo.', 'ooooooooo'], x, G - h - 4, { o: PAL.orange });
    });
    px.vline(x + 1, G - h, h, PAL.white);
    px.rect(x + 6, G - h, 3, h, PAL.wall2);
    px.vline(x + 8, G - h, h, PAL.wall3);
    for (let y = G - h + 3; y < G; y += 4) px.hline(x, y, 9, PAL.wall2);
    px.sprite(['.....dd', '...dddd'], x + 2, G - h - 3, { d: PAL.orangeDark });
}

function drum(px, x, y, tMs, turning) {
    px.outlined(PAL.ink, () => px.disc(x, y, 5, PAL.orange));
    px.disc(x, y, 3, PAL.orangeDark);
    const a = turning ? tMs / 300 : 0.6;
    px.line(x, y, x + Math.round(Math.cos(a) * 3), y + Math.round(Math.sin(a) * 3), PAL.orangeLight);
    px.line(x, y, x - Math.round(Math.cos(a) * 3), y - Math.round(Math.sin(a) * 3), PAL.orangeLight);
    px.pixel(x, y, PAL.ink);
}

function sacks(px, x, base, n) {
    const SACK = ['.kk.', 'ssss', 'sSss', 'ssss'];
    for (let i = 0; i < n; i++) {
        const col = i % 4, row = Math.floor(i / 4);
        const sx = x + col * 5 + row * 2, sy = base - 4 - row * 4;
        px.outlined(PAL.ink, () => px.sprite(SACK, sx, sy, { k: PAL.sackDark, s: PAL.sack, S: PAL.sackDark }));
    }
}

export function draw(px, state, tMs) {
    const L = layout(px);
    const { w, cx, G, roadBottom } = L;
    const coffee = state.highlight === 'COFFEE';
    const crop = coffee && state.mood === 'storm' ? 'wilt' : coffee && state.mood === 'boom' ? 'bumper' : 'normal';

    backdrop(px, L, { hills: true, seed: 5 });
    ground(px, L, { lot: 'grass' });

    // back orchard rows across the whole width, behind the roastery
    orchard(px, 0, w, G - 3, crop, 1);

    // roastery barn with the drum showing through its big door
    const bx = cx - 30;
    block(px, bx, G, 40, 15, 10, { front: PAL.wall1, side: PAL.wall2, roof: PAL.wall2 });
    gable(px, bx, G - 15, 40, 10);
    px.rect(bx + 4, G - 12, 18, 12, '#2c3a52');
    drum(px, bx + 13, G - 6, tMs, crop !== 'wilt');
    windows(px, bx + 26, G - 11, 3, 1, { w: 3, h: 3, gx: 1, lit: state.mood === 'storm' ? 1 : 0.3, seed: 2 });
    px.hline(bx + 3, G - 13, 20, PAL.orange);

    // chimney: the smell of roasting coffee, unless the crop has failed
    px.outlined(PAL.ink, () => px.rect(bx + 30, G - 30, 4, 18, PAL.wall2));
    px.hline(bx + 30, G - 27, 4, PAL.orange);
    px.hline(bx + 30, G - 24, 4, PAL.orange);
    smoke(px, bx + 31, G - 32, tMs, { strength: crop === 'wilt' ? 0.3 : crop === 'bumper' ? 1.3 : 0.9 });

    // silos and the conveyor feeding the roaster
    silo(px, cx + 18, G, 20);
    silo(px, cx + 30, G, 16);
    px.line(cx + 18, G - 14, bx + 40, G - 9, PAL.wall4);
    px.line(cx + 18, G - 13, bx + 40, G - 8, PAL.wall3);
    if (crop !== 'wilt') {
        for (let i = 0; i < 3; i++) {
            const p = (tMs / 900 + i / 3) % 1;
            px.pixel(Math.round(cx + 18 - p * (cx + 18 - bx - 40)), Math.round(G - 15 + p * 5), PAL.coffee);
        }
    }

    // front orchard rows either side, and the sack pile by the door
    orchard(px, 0, bx - 6, G + 4, crop, 7);
    orchard(px, cx + 44, w, G + 4, crop, 9);
    sacks(px, bx - 2, G + 4, crop === 'wilt' ? 1 : crop === 'bumper' ? 7 : 4);

    if (crop === 'bumper') {
        const pickerX = cx + 46 + Math.floor((Math.sin(tMs / 1300) + 1) * 8);
        person(px, pickerX, G + 4, { shirt: PAL.orange, tMs, bag: PAL.sack });
    }

    // a lorry of sacks heading for the port (a milk tanker when dairy moves)
    const lx = drive(L, tMs, 0.03, 18, 40);
    const dairy = state.highlight === 'DAIRY';
    lorry(px, lx, roadBottom - 1, { body: dairy ? PAL.white : PAL.sack, cab: dairy ? PAL.blue : PAL.greenDark });
    if (dairy) px.hline(lx + 1, roadBottom - 5, 8, PAL.blue);
    else for (let i = 0; i < 3; i++) px.pixel(lx + 2 + i * 3, roadBottom - 7, mix(PAL.sack, PAL.ink, 0.3));
}
