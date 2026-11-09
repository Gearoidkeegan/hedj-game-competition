// Chip factory (tech). Market link: the production line. When copper or the
// yen (COPPER, USDJPY) is the big mover the belt stops dead under a red
// beacon in a storm, and races under a green one in a boom.

import { PAL } from '../palette.js';
import { layout, ground, backdrop, block, windows, lorry, drive, blinker, hash } from '../parts.js';

const CONTAINER_COLOURS = [[PAL.blue, PAL.blueDark], [PAL.orange, PAL.orangeDark], [PAL.red, PAL.redDark], [PAL.green, PAL.greenDark]];

function container(px, x, base, i) {
    const [c, dark] = CONTAINER_COLOURS[i % CONTAINER_COLOURS.length];
    px.outlined(PAL.ink, () => px.rect(x, base - 5, 12, 5, c));
    for (let k = 1; k < 12; k += 2) px.vline(x + k, base - 4, 3, dark);
    px.hline(x, base - 5, 12, PAL.white);
}

const CHIP = [
    '.k.k.k.',
    'kbbbbbk',
    '.bwwwb.',
    'kbwobbk',
    '.bwwwb.',
    'kbbbbbk',
    '.k.k.k.',
];

function sawtooth(px, x, top, teeth) {
    for (let k = 0; k < teeth; k++) {
        const tx = x + k * 8;
        px.outlined(PAL.ink, () => {
            for (let j = 0; j < 8; j++) {
                const hgt = Math.floor((j * 5) / 8) + 1;
                px.rect(tx + j, top - hgt, 1, hgt, j === 7 ? PAL.glass : PAL.wall2);
            }
        });
        px.vline(tx + 7, top - 5, 5, PAL.glass);
        px.pixel(tx + 7, top - 5, PAL.white);
    }
}

function fan(px, x, y, tMs, running) {
    px.outlined(PAL.ink, () => px.rect(x, y, 7, 4, PAL.wall2));
    const f = running ? Math.floor(tMs / 90) % 2 : 0;
    px.sprite(f ? ['k.k', '.k.', 'k.k'] : ['.k.', 'kkk', '.k.'], x + 2, y, { k: PAL.wall4 });
}

function mast(px, x, G, tMs) {
    const h = 30;
    px.vline(x, G - h, h, PAL.wall3);
    px.vline(x + 3, G - h, h, PAL.wall3);
    for (let y = G - h; y < G; y += 3) px.line(x, y, x + 3, y + 3, PAL.wall2);
    px.outlined(PAL.ink, () => px.sprite(['.ww', 'www', 'ww.'], x + 4, G - h + 4, { w: PAL.wall0 }));
    blinker(px, x + 1, G - h - 1, PAL.lamp, tMs, 1600);
}

const speedOf = (halted, racing) => (halted ? 0 : racing ? 0.03 : 0.012);

export function draw(px, state, tMs) {
    const L = layout(px);
    const { cx, G, roadBottom } = L;
    const linked = state.highlight === 'COPPER' || state.highlight === 'USDJPY';
    const halted = linked && state.mood === 'storm';
    const racing = linked && state.mood === 'boom';

    backdrop(px, L, { hills: false, city: true, seed: 7 });
    ground(px, L, { lot: 'paving' });

    // import containers stacked by the gate
    const kx = cx - 72;
    container(px, kx, G, 0);
    container(px, kx + 13, G, 1);
    container(px, kx + 6, G - 6, 2);
    container(px, kx, G - 12, 3);

    // the fab: a tall shed, saw-tooth north lights, cleanroom glazing
    const fx = cx - 44;
    const fh = 20;
    block(px, fx, G, 62, fh, 10, { front: PAL.wall0, side: PAL.wall2, roof: PAL.wall1 });
    sawtooth(px, fx + 1, G - fh, 7);
    px.rect(fx, G - fh + 3, 62, 2, PAL.blue);
    px.outlined(PAL.ink, () => px.rect(fx + 3, G - 15, 9, 9, PAL.blueDark));
    px.sprite(CHIP, fx + 4, G - 14, { k: PAL.wall0, b: PAL.blueDark, w: PAL.glass, o: PAL.orange });
    windows(px, fx + 15, G - 14, 8, 2, { w: 4, h: 3, gx: 1, gy: 2, lit: state.mood === 'storm' ? 0.8 : 0.2, seed: 6, glass: PAL.glassDark });
    px.rect(fx + 54, G - 8, 6, 8, PAL.wall2);
    for (let y = G - 7; y < G; y += 2) px.hline(fx + 54, y, 6, PAL.wall3);
    fan(px, fx + 66, G - fh - 5, tMs, !halted);

    // production beacon on the roof: red when the line stops, green when it races
    const beaconY = G - fh - 8;
    px.vline(fx + 64, beaconY + 1, 3, PAL.wall4);
    if (halted) blinker(px, fx + 64, beaconY, PAL.lamp, tMs, 500);
    else px.pixel(fx + 64, beaconY, racing ? PAL.lampGreen : PAL.wall3);

    mast(px, cx + 40, G, tMs);

    // the conveyor across the forecourt, carrying crates of chips
    const y = G + 1;
    const x0 = cx - 58, x1 = cx + 28;
    px.outlined(PAL.ink, () => px.rect(x0, y, x1 - x0, 2, PAL.wall3));
    const roll = halted ? 0 : Math.floor(tMs * speedOf(halted, racing)) % 3;
    for (let x = x0 + roll; x < x1; x += 3) px.pixel(x, y + 1, PAL.wall4);
    for (let x = x0 + 3; x < x1; x += 14) px.vline(x, y + 3, 1, PAL.ink);
    const speed = speedOf(halted, racing);
    const span = x1 - x0;
    for (let i = 0; i < 6; i++) {
        let bx;
        if (halted) bx = x0 + 4 + i * 6 + Math.floor(hash(i, 2) * 2);   // jammed up together
        else bx = x0 + Math.floor((i * (span / 6) + tMs * speed) % span);
        if (bx > x1 - 5) continue;
        px.outlined(PAL.ink, () => px.rect(bx, y - 4, 5, 4, PAL.sack));
        px.hline(bx, y - 4, 5, PAL.sackDark);
        px.pixel(bx + 2, y - 2, PAL.blueDark);
    }

    // the delivery van on the road
    lorry(px, drive(L, tMs, 0.035, 18, 90, -1), roadBottom - 1, { body: PAL.wall0, cab: PAL.blue, flip: true });
}
