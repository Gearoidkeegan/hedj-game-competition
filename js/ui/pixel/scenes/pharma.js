// Life-sciences campus (pharma). Market link: the flag out front flies the
// currency that moved most (Swiss for EURCHF, American for EURUSD, European
// otherwise). It drops to half-mast and hangs limp in a storm and streams
// out at the top of the pole in a boom.

import { PAL } from '../palette.js';
import { layout, ground, backdrop, block, windows, tree, lorry, drive, smoke } from '../parts.js';

const FLAGS = {
    EURCHF: { map: ['rrrrrrrr', 'rrrwwrrr', 'rwwwwwwr', 'rwwwwwwr', 'rrrwwrrr', 'rrrrrrrr'], pal: { r: PAL.red, w: PAL.white } },
    EURUSD: { map: ['bwbwrrrr', 'bbbbwwww', 'bwbwrrrr', 'wwwwwwww', 'rrrrrrrr', 'wwwwwwww'], pal: { r: PAL.red, w: PAL.white, b: PAL.blueDark } },
    EU: { map: ['bbbbbbbb', 'bbbybbbb', 'bbybbybb', 'bbybbybb', 'bbbbybbb', 'bbbbbbbb'], pal: { b: PAL.blue, y: PAL.yellow } },
};

function flag(px, x, G, state, tMs) {
    const poleH = 28;
    px.outlined(PAL.ink, () => px.vline(x, G - poleH, poleH, PAL.wall1));
    px.pixel(x, G - poleH - 1, PAL.yellow);
    const f = FLAGS[state.highlight] || FLAGS.EU;
    const halfMast = state.mood === 'storm';
    const top = halfMast ? G - Math.floor(poleH / 2) : G - poleH + 1;
    const speed = state.mood === 'boom' ? 120 : 260;
    const n = f.map[0].length;
    for (let col = 0; col < n; col++) {
        // limp flags hang down as they go out; flying flags ripple
        const dy = halfMast ? Math.floor(col / 2) : (Math.floor(tMs / speed + col / 2) % 2);
        for (let row = 0; row < f.map.length; row++) {
            const c = f.pal[f.map[row][col]];
            px.pixel(x + 1 + col, top + row + dy, c);
        }
    }
}

// A spinning DNA helix sculpture on a plinth.
function helix(px, x, G, tMs) {
    const h = 16;
    px.outlined(PAL.ink, () => px.rect(x - 3, G - 2, 8, 2, PAL.wall2));
    for (let i = 0; i < h; i++) {
        const a = i / 2.2 + tMs / 500;
        const s = Math.sin(a);
        const xa = x + 1 + Math.round(s * 2.5), xb = x + 1 - Math.round(s * 2.5);
        const y = G - 3 - i;
        if (i % 2 === 0) px.line(Math.min(xa, xb) + 1, y, Math.max(xa, xb) - 1, y, PAL.wall3);
        const front = Math.cos(a) > 0;
        px.pixel(xb, y, front ? PAL.blueDark : PAL.orange);
        px.pixel(xa, y, front ? PAL.orange : PAL.blueDark);
    }
}

function greenhouse(px, x, G) {
    const w = 26, h = 6;
    px.outlined(PAL.ink, () => {
        for (let i = 0; i < w; i++) {
            const k = (i - w / 2 + 0.5) / (w / 2);
            const arch = Math.round(Math.sqrt(Math.max(0, 1 - k * k)) * 6);
            px.rect(x + i, G - h - arch, 1, h + arch, PAL.glass);
        }
    });
    for (let i = 0; i < w; i += 4) px.vline(x + i, G - 12, 12, PAL.wall0);
    px.hline(x, G - h, w, PAL.wall0);
    for (let i = 1; i < w - 1; i += 3) px.sprite(['g.', 'gg'], x + i, G - 3, { g: PAL.leafLight });
}

export function draw(px, state, tMs) {
    const L = layout(px);
    const { cx, G, roadBottom } = L;

    backdrop(px, L, { hills: true, city: true, seed: 9 });
    ground(px, L, { lot: 'grass' });

    // research wing: long, low, white, with fume vents on the roof
    const wx = cx - 64;
    block(px, wx, G, 40, 12, 8, { front: PAL.wall0, side: PAL.wall1, roof: PAL.wall1 });
    windows(px, wx + 3, G - 9, 7, 1, { w: 4, h: 4, gx: 1, lit: state.mood === 'storm' ? 0.7 : 0.15, seed: 11 });
    px.hline(wx, G - 3, 40, PAL.green);
    for (let i = 0; i < 3; i++) {
        const vx = wx + 8 + i * 10;
        px.outlined(PAL.ink, () => px.rect(vx, G - 17, 2, 3, PAL.wall2));
        smoke(px, vx, G - 18, tMs + i * 700, { strength: 0.35 });
    }

    // HQ tower: a glass curtain wall with the green-cross sign on top
    const tx = cx - 18;
    block(px, tx, G, 30, 32, 10, { front: PAL.glass, side: PAL.glassDark, roof: PAL.wall1 });
    windows(px, tx + 1, G - 31, 7, 7, { w: 3, h: 3, gx: 1, gy: 1, lit: state.mood === 'storm' ? 0.55 : 0.12, seed: 3 });
    px.rect(tx + 11, G - 6, 8, 6, PAL.glassDark);
    px.hline(tx + 9, G - 7, 12, PAL.wall0);
    px.outlined(PAL.ink, () => px.rect(tx + 11, G - 42, 8, 8, PAL.white));
    px.sprite(['..gg..', '..gg..', 'gggggg', 'gggggg', '..gg..', '..gg..'], tx + 12, G - 41, { g: PAL.green });

    greenhouse(px, cx + 26, G);
    helix(px, cx - 26, G + 4, tMs);
    flag(px, cx + 18, G + 3, state, tMs);
    tree(px, cx + 58, G + 2);
    tree(px, cx - 70, G + 3);

    // the cold-chain van on the road
    const vx = drive(L, tMs, 0.03, 18, 20);
    lorry(px, vx, roadBottom - 1, { body: PAL.white, cab: PAL.green });
    px.hline(vx, roadBottom - 4, 10, PAL.green);
}
