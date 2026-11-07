// Sprites: 32x32 pixel busts for the board members and the chairmen, drawn in
// the same inked, flat-shaded style as the scenes.
//
//   drawSprite(ctx, spriteId, expression, x, y, scale)
//   spriteIdForMember(member, index)  -> e.g. 'aggressive.2.1.3.0'
//   CHAIRMAN_SPRITES                  -> { jameson, musk, ... } keyed by ceoPersonas id
//
// A sprite is built in a 32x32 PixelCanvas from layers (hair behind, body,
// head, hair, face, beard, prop), inked with a one-pixel outline, then blitted
// as merged rectangles. Expressions change the brows, eyes and mouth, and angry
// adds a flush and a red anger mark. The chairmen are generic characters told
// apart by their signature prop and colours, never by a likeness.

import { PixelCanvas } from './PixelCanvas.js';
import { PAL, mix } from './palette.js';

const SIZE = 32;
const EXPRESSIONS = new Set(['neutral', 'happy', 'angry']);
const ARCHETYPES = ['aggressive', 'cautious', 'operational'];

const SKINS = ['#f6d5b8', '#f0c49a', '#dcab7c', '#c08a5c', '#93603c', '#6a4128'];
const HAIRS = ['#2a201c', '#5a3a22', '#8a4a24', '#d8b25a', '#9aa0a8', '#e6e2da', '#3c2a40'];

// Per-archetype hair styles and outfits. Outfit colours: main (jacket, cardigan
// or shirt), shirt (under it) and accent (tie, bow tie or lanyard).
const STYLES = {
    aggressive: ['slick', 'bob', 'bald'],
    cautious: ['parting', 'bun', 'curly'],
    operational: ['crop', 'ponytail', 'spiky'],
};
const OUTFITS = {
    aggressive: [
        { kind: 'suit', main: '#2e3a52', shirt: PAL.white, accent: PAL.red },
        { kind: 'suit', main: '#4a2c3c', shirt: PAL.white, accent: PAL.yellow },
        { kind: 'suit', main: '#3a3f47', shirt: '#d9e6f5', accent: PAL.orange },
        { kind: 'suit', main: '#2c4a6e', shirt: PAL.white, accent: PAL.redDark },
    ],
    cautious: [
        { kind: 'cardigan', main: '#7f91a6', shirt: PAL.white, accent: PAL.redDark },
        { kind: 'cardigan', main: '#6f7d4e', shirt: '#f2ead8', accent: PAL.blueDark },
        { kind: 'cardigan', main: '#9a7656', shirt: PAL.white, accent: PAL.greenDark },
        { kind: 'cardigan', main: '#5d6e84', shirt: '#e7eef6', accent: PAL.yellow },
    ],
    operational: [
        { kind: 'shirt', main: PAL.blue, shirt: PAL.blue, accent: PAL.red },
        { kind: 'shirt', main: '#3f9a6a', shirt: '#3f9a6a', accent: PAL.blueDark },
        { kind: 'shirt', main: PAL.orange, shirt: PAL.orange, accent: PAL.ink },
        { kind: 'shirt', main: '#7a5aa8', shirt: '#7a5aa8', accent: PAL.yellow },
    ],
};

// The chairmen: one signature prop and a colour scheme each.
export const CHAIRMAN_SPRITES = Object.freeze({
    jameson: Object.freeze({ label: 'The Editor', prop: 'cigar', skin: '#f0c49a', hair: '#3a3a3a', style: 'flattop',
        outfit: { kind: 'braces', main: '#f4f4ec', shirt: '#f4f4ec', accent: '#6b4a33', braces: PAL.red }, moustache: '#3a3a3a' }),
    musk: Object.freeze({ label: 'The Rocketeer', prop: 'rocket', skin: '#f6d5b8', hair: '#3a2a22', style: 'swept',
        outfit: { kind: 'tee', main: '#2c2c34' } }),
    oleary: Object.freeze({ label: 'The Budget Flyer', prop: 'piggy', skin: '#f0c49a', hair: '#8a8a8a', style: 'crop',
        outfit: { kind: 'suit', main: '#1f4fa0', shirt: PAL.white, accent: PAL.yellow } }),
    dimon: Object.freeze({ label: 'The Banker', prop: 'magnifier', skin: '#f0c49a', hair: '#d2d6dc', style: 'slick',
        outfit: { kind: 'suit', main: '#283550', shirt: PAL.white, accent: PAL.blue, pinstripe: '#4c5c7c' } }),
    buffett: Object.freeze({ label: 'The Sage', prop: 'icecream', skin: '#f6d5b8', hair: '#eeeeee', style: 'bald',
        outfit: { kind: 'suit', main: '#6f7c8c', shirt: PAL.white, accent: PAL.redDark }, glasses: 'thick' }),
    jobs: Object.freeze({ label: 'The Visionary', prop: 'apple', skin: '#f0c49a', hair: '#7a7a7a', style: 'shaved',
        outfit: { kind: 'turtleneck', main: '#26262c' }, glasses: 'round', stubble: '#7a7a7a' }),
    dorsey: Object.freeze({ label: 'The Monk', prop: 'bitcoin', skin: '#f6d5b8', hair: '#4a3a2c', style: 'beanie',
        outfit: { kind: 'tee', main: '#2c2c34' }, beard: '#6a5a4a', beanie: '#5d6e84' }),
    ackman: Object.freeze({ label: 'The Essayist', prop: 'scroll', skin: '#f0c49a', hair: '#b8bcc4', style: 'parting',
        outfit: { kind: 'suit', main: '#2b3a5c', shirt: '#cfe0f5', accent: '#5a7ab0' } }),
});

// FNV-1a: a stable 32-bit hash of a string.
function strHash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

export function spriteIdForMember(member, index) {
    const archetype = ARCHETYPES.includes(member?.personality) ? member.personality : 'operational';
    const i = Number.isInteger(index) && index >= 0 ? index : 0;
    const h = strHash(String(member?.name ?? ''));
    // Each part steps with the seat index, so neighbouring seats always differ in outfit.
    const hair = (h + i * 3) % HAIRS.length;
    const skin = ((h >>> 8) + i * 5) % SKINS.length;
    const outfit = ((h >>> 16) + i) % OUTFITS[archetype].length;
    const style = ((h >>> 4) + i * 2) % STYLES[archetype].length;
    return `${archetype}.${hair}.${skin}.${outfit}.${style}`;
}

// Turns a sprite id into a drawing spec. Unknown ids draw a plain member.
function specFor(spriteId) {
    const chairman = Object.hasOwn(CHAIRMAN_SPRITES, spriteId) ? CHAIRMAN_SPRITES[spriteId] : null;
    if (chairman) return chairman;
    const [arch, ...parts] = String(spriteId).split('.');
    const archetype = ARCHETYPES.includes(arch) ? arch : 'operational';
    const [hair, skin, outfit, style] = [HAIRS, SKINS, OUTFITS[archetype], STYLES[archetype]]
        .map((list, k) => list[(Number(parts[k]) >>> 0) % list.length] ?? list[0]);
    return { archetype, hair, skin, outfit, style, glasses: archetype === 'cautious' ? 'round' : null };
}

// ---- Layers -----------------------------------------------------------------

// Head, 16 wide from x = 8, rows y = 6..18. s skin, S shade.
const HEAD = [
    '....ssssssss....',
    '...ssssssssss...',
    '..ssssssssssss..',
    '..sssssssssssS..',
    '..sssssssssssS..',
    '.ssssssssssssSS.',
    '.ssssssssssssSS.',
    '.ssssssssssssSS.',
    '..sssssssssssS..',
    '..sssssssssssS..',
    '..sssssssssssS..',
    '...ssssssssssS..',
    '....sssssssS....',
];

// Hair maps, 16 wide from x = 8, starting at row y. h hair, H highlight, d dark.
const HAIR = {
    slick: { y: 3, rows: [
        '.....hhhhhh.....',
        '...hhhhhhhhhh...',
        '..hhHHHHhhhhhh..',
        '..hhhhhhhhhhhd..',
        '..hhhhhhhhhhhd..',
        '..hh........hd..',
        '..h..........d..',
    ] },
    bob: { y: 3, rows: [
        '.....hhhhhh.....',
        '...hhhhhhhhhh...',
        '..hhHHHhhhhhhh..',
        '.hhhhhhhhhhhhhd.',
        '.hhhhhhhhhhhhhd.',
        '.hhhhhh.....hhd.',
        '.hhhh.......hhd.',
        '.hhh.........hd.',
        '.hh..........hd.',
        '.hh..........hd.',
        '.hh..........hd.',
        '.hh..........hd.',
        '.hh..........hd.',
        '.hhh........hhd.',
        '..hh........hd..',
    ] },
    bald: { y: 8, rows: [
        '..h..........d..',
        '.hh..........dd.',
        '.hh..........dd.',
    ] },
    parting: { y: 3, rows: [
        '....hhhhhhh.....',
        '..hhhhhhhhhhh...',
        '..hhHHHhhhhhhh..',
        '..hhhhh.hhhhhd..',
        '..hhhhhhhhhhhd..',
        '..hhhhhh....hd..',
        '..hh.........d..',
        '..h..........d..',
    ] },
    bun: { y: 1, rows: [
        '......hhhh......',
        '.....hHhhhd.....',
        '......hhhd......',
        '....dddddddd....',
        '...hhhhhhhhhh...',
        '..hhHHHhhhhhhh..',
        '..hhhhhhhhhhhd..',
        '..hhh.hhhh.hhd..',
        '..hh........hd..',
        '..h..........d..',
    ] },
    curly: { y: 2, rows: [
        '.....hhHhhh.....',
        '...hhHhhhHhhh...',
        '..hHhhhHhhhHhh..',
        '.hhhhHhhhhHhhhd.',
        '.hHhhhhHhhhhHhd.',
        '.hhhHhhhhHhhhhd.',
        '.hhh.h.hh.h.hhd.',
        '.hh..........hd.',
        '.hh..........hd.',
        '..h..........d..',
    ] },
    crop: { y: 4, rows: [
        '....hhhhhhhh....',
        '...hHHhhhhhhh...',
        '..hhhhhhhhhhhd..',
        '..hhhhhhhhhhhd..',
        '..h..........d..',
    ] },
    ponytail: { y: 3, rows: [
        '.....hhhhhh.....',
        '...hhhhhhhhhh...',
        '..hhHHHhhhhhhh..',
        '..hhhhhhhhhhhd..',
        '..hhhhhhh.hhhd..',
        '..hh........hd..',
        '..h..........d..',
    ] },
    spiky: { y: 1, rows: [
        '...h..h..h..h...',
        '...hh.hh.hh.hh..',
        '..hhhhhhhhhhhh..',
        '..hHHhhhhhhhhh..',
        '..hhhhhhhhhhhd..',
        '..hhhhhhhhhhhd..',
        '..hh.hh.hh.hhd..',
        '..h..........d..',
    ] },
    flattop: { y: 2, rows: [
        '...hhhhhhhhhh...',
        '...hhhhhhhhhh...',
        '...hhhhhhhhhh...',
        '..Hhhhhhhhhhhd..',
        '..Hhhhhhhhhhhd..',
        '..HH........Hd..',
        '..H..........H..',
        '..H..........H..',
    ] },
    swept: { y: 3, rows: [
        '......hhhhh.....',
        '...hhhhhhhhhh...',
        '..hhhHHHhhhhhh..',
        '..hhhhhhhhhhhd..',
        '..hhhhhhhhhhhd..',
        '..hhhhh......d..',
        '..hh.........d..',
    ] },
    shaved: { y: 6, rows: [
        '................',
        '................',
        '..H..........H..',
        '..H..........H..',
        '.HH..........HH.',
    ] },
    beanie: { y: 1, rows: [
        '......bbbb......',
        '....bbbbbbbb....',
        '...bbbbbbbbbb...',
        '..bbbbbbbbbbbb..',
        '..bbbbbbbbbbbb..',
        '..rrrrrrrrrrrr..',
        '..rrrrrrrrrrrr..',
        '..hh........hh..',
        '..h..........h..',
    ] },
};

// Long hair drawn behind the head and shoulders.
const HAIR_BACK = {
    bob: { x: 8, y: 17, rows: ['.hhhhhhhhhhhhhd.', '.hhhhhhhhhhhhhd.', '..hhhhhhhhhhhd..'] },
    ponytail: { x: 21, y: 7, rows: ['.hh.', 'hhhd', 'hhhd', 'hhhd', '.hhd', '.hhd', '.hd.', '..d.'] },
};

const BEARD = { x: 10, y: 14, rows: [
    'b..........b',
    'bb........bb',
    'bbbbbbbbbbbb',
    'bbbbbbbbbbbb',
    'bbbbbbbbbbbb',
    '.bbbbbbbbbb.',
    '.bbbbbbbbbb.',
    '..bbbbbbbb..',
    '..bbbbbbbb..',
    '...bbbbbb...',
    '....bbbb....',
] };

// Props, each with its own small palette.
const PROPS = {
    cigar: { x: 19, y: 9, pal: { c: '#6b4a33', C: '#8a6040', g: PAL.yellow, e: PAL.flameO, r: PAL.flameR, s: PAL.smoke, S: PAL.smokeDark }, rows: [
        '.....ss',
        '....sS.',
        '.....s.',
        '....s..',
        '.......',
        '.......',
        '.......',
        'Ccgcce.',
        'ccgccr.',
    ] },
    rocket: { x: 24, y: 2, pal: { r: PAL.red, R: PAL.redDark, w: PAL.white, W: PAL.wall1, b: PAL.glass, y: PAL.flameY, o: PAL.flameO }, rows: [
        '...r...',
        '..rrR..',
        '..wwW..',
        '..wbW..',
        '..wwW..',
        '..wwW..',
        '.rwwWR.',
        'rr.W.RR',
        '..yoy..',
        '...o...',
    ] },
    piggy: { x: 20, y: 20, pal: { p: '#f4a6b8', P: '#d77d94', k: PAL.ink, n: '#e88aa2', y: PAL.coin, Y: PAL.coinDark }, rows: [
        '......yy...',
        '......yY...',
        '...pPkkpp..',
        '..ppppppppP',
        'nnpkpppppPP',
        'nnpppppppPP',
        '..pppppppP.',
        '..pP...pP..',
        '..PP...PP..',
    ] },
    magnifier: { x: 22, y: 16, pal: { g: PAL.coin, G: PAL.coinDark, l: '#cfe6f5', w: PAL.white, t: PAL.trunk }, rows: [
        '..gggg....',
        '.gllllg...',
        'glwllllG..',
        'glwllllG..',
        'gllllllG..',
        '.gllllG...',
        '..GGGGt...',
        '.......t..',
        '.......tt.',
        '........tt',
        '.........t',
    ] },
    icecream: { x: 23, y: 13, pal: { p: '#f4a6b8', P: '#d77d94', w: PAL.white, c: PAL.sack, C: PAL.sackDark, r: PAL.cherry }, rows: [
        '...r...',
        '.pppp..',
        'pwppppP',
        'ppppppP',
        'PPpPpPP',
        '.cCcCc.',
        '.CcCcC.',
        '..cCc..',
        '..CcC..',
        '...c...',
        '...C...',
    ] },
    apple: { x: 23, y: 20, pal: { r: PAL.red, R: PAL.redDark, w: '#ff9a9a', t: PAL.trunk, g: PAL.green }, rows: [
        '...t.gg',
        '...tgg.',
        '.rr.rr.',
        'rwrrrrR',
        'rwrrrrR',
        'rrrrrrR',
        '.rrrrR.',
        '..R.R..',
    ] },
    bitcoin: { x: 22, y: 21, pal: { o: '#f7931a', O: '#c46f0c', w: PAL.white }, rows: [
        '..ooooo..',
        '.oowwwooO',
        'ooowoowoO',
        'ooowwwooO',
        'ooowoowoO',
        'ooowwwooO',
        '.oooooOO.',
        '..OOOOO..',
    ] },
    scroll: { x: 23, y: 6, pal: { r: PAL.sackDark, p: '#f2e6c8', P: '#dccaa0', t: PAL.wall3 }, rows: [
        'rrrrrrr',
        '.ppppP.',
        '.pttpP.',
        '.ppppP.',
        '.ptttP.',
        '.ppppP.',
        '.pttpP.',
        '.ppppP.',
        '.ptttP.',
        '.ppppP.',
        '.ptppP.',
        '.ppppP.',
        '.pttpP.',
        '.ppppP.',
        '.ptttP.',
        '.ppppP.',
        '.pttpP.',
        '.ppppP.',
        '.ptttP.',
        '.ppppP.',
        '..pppP.',
        '..rrrr.',
        '...rrr.',
    ] },
};

const shade = (c, t = 0.25) => mix(c, PAL.ink, t);
const light = (c, t = 0.3) => mix(c, '#ffffff', t);

function drawBody(px, outfit, skin, skinShade) {
    const { kind, main } = outfit;
    const dark = shade(main, 0.28);
    // neck
    px.rect(13, 18, 6, 4, skin);
    px.hline(13, 18, 6, skinShade);
    px.hline(13, 19, 6, skinShade);
    // shoulders and torso
    for (let y = 22; y < SIZE; y++) {
        const hw = y === 22 ? 8 : y === 23 ? 10 : y === 24 ? 11 : 12;
        px.hline(16 - hw, y, hw * 2, main);
        px.hline(16 + hw - 3, y, 3, dark);
    }
    px.hline(9, 22, 5, light(main, 0.2));
    px.vline(8, 26, 6, dark);
    px.vline(23, 26, 6, dark);
    if (outfit.pinstripe) {
        for (let x = 5; x < 28; x += 3) {
            for (let y = 23; y < SIZE; y++) if (px.get(x, y) === main) px.pixel(x, y, outfit.pinstripe);
        }
    }

    if (kind === 'suit' || kind === 'braces') {
        const V = [3, 3, 3, 2, 2, 1, 1];
        for (let k = 0; k < V.length; k++) {
            const y = 21 + k, v = V[k];
            if (kind === 'suit') {
                px.hline(16 - v, y, v * 2, outfit.shirt);
                if (y > 21) { px.pixel(15 - v, y, dark); px.pixel(16 + v, y, dark); }
            }
        }
        if (kind === 'braces') {
            for (let y = 22; y < SIZE; y++) { px.pixel(11, y, outfit.braces); px.pixel(20, y, outfit.braces); }
        }
        px.rect(13, 21, 2, 1, outfit.shirt);
        px.rect(17, 21, 2, 1, outfit.shirt);
        px.rect(15, 22, 2, 1, shade(outfit.accent, 0.2));
        px.rect(15, 23, 2, 5, outfit.accent);
        px.pixel(15, 28, outfit.accent);
        px.pixel(16, 28, shade(outfit.accent, 0.3));
    } else if (kind === 'cardigan') {
        const V = [3, 3, 2, 2, 2, 1];
        V.forEach((v, k) => px.hline(16 - v, 21 + k, v * 2, outfit.shirt));
        px.pixel(13, 21, outfit.accent); px.pixel(18, 21, outfit.accent);
        px.hline(13, 22, 6, outfit.accent);
        px.rect(15, 22, 2, 1, shade(outfit.accent, 0.35));
        px.pixel(13, 23, outfit.accent); px.pixel(18, 23, outfit.accent);
        for (const y of [27, 29, 31]) px.pixel(15, y, light(main, 0.55));
    } else if (kind === 'shirt') {
        // open collar, lanyard and ID badge, pen in the pocket
        px.rect(14, 21, 4, 2, skin);
        px.rect(15, 23, 2, 1, skin);
        const collar = light(main, 0.35);
        px.rect(12, 21, 2, 2, collar); px.rect(18, 21, 2, 2, collar);
        px.line(12, 23, 14, 27, outfit.accent);
        px.line(19, 23, 17, 27, outfit.accent);
        px.rect(13, 27, 6, 4, PAL.white);
        px.hline(13, 27, 6, PAL.blue);
        px.pixel(14, 29, PAL.wall3); px.hline(16, 29, 2, PAL.wall3);
        px.rect(20, 26, 3, 3, shade(main, 0.15));
        px.vline(21, 24, 3, PAL.blueDark);
    } else if (kind === 'tee') {
        px.rect(13, 21, 6, 1, skin);
        px.rect(14, 22, 4, 1, skin);
        px.hline(12, 21, 1, light(main, 0.25)); px.hline(19, 21, 1, light(main, 0.25));
        px.pixel(13, 22, light(main, 0.25)); px.pixel(18, 22, light(main, 0.25));
        px.hline(14, 23, 4, light(main, 0.25));
    } else if (kind === 'turtleneck') {
        px.rect(12, 18, 8, 4, main);
        for (const y of [19, 21]) px.hline(12, y, 8, light(main, 0.18));
        px.hline(17, 18, 3, dark);
    }
}

function drawHair(px, spec, layer) {
    const pal = { h: spec.hair, H: light(spec.hair, 0.35), d: shade(spec.hair, 0.3) };
    if (layer === 'back') {
        const back = HAIR_BACK[spec.style];
        if (back) px.sprite(back.rows, back.x, back.y, pal);
        return;
    }
    const map = HAIR[spec.style];
    if (!map) return;
    const beanie = spec.beanie || PAL.wall4;
    px.sprite(map.rows, 8, map.y, { ...pal, b: beanie, r: shade(beanie, 0.25) });
    if (spec.style === 'bald' || spec.style === 'shaved') px.rect(12, 7, 2, 1, light(spec.skin, 0.45));
}

function drawGlasses(px, kind) {
    const rim = kind === 'thick' ? PAL.ink : PAL.wall4;
    for (const x of [11, 17]) {
        px.hline(x, 11, 4, rim); px.hline(x, 14, 4, rim);
        px.vline(x, 11, 4, rim); px.vline(x + 3, 11, 4, rim);
        px.rect(x + 1, 12, 2, 2, '#e4f0f8');
    }
    px.hline(15, 12, 2, rim);
    if (kind === 'thick') { px.pixel(10, 12, rim); px.pixel(21, 12, rim); }
}

function drawFace(px, spec, expression, skin) {
    const ink = PAL.ink;
    const brow = mix(spec.hair, ink, 0.55);
    const lip = mix(skin, '#6b2a2a', 0.55);
    if (spec.glasses) drawGlasses(px, spec.glasses);
    px.pixel(16, 14, mix(skin, '#7a3a2a', 0.22)); // nose

    if (expression === 'happy') {
        // raised brows, smiling eyes, a grin and rosy cheeks
        for (const [x, d] of [[11, 1], [20, -1]]) {
            px.pixel(x, 10, brow); px.pixel(x + d, 9, brow); px.pixel(x + 2 * d, 9, brow); px.pixel(x + 3 * d, 10, brow);
            px.pixel(x, 13, ink); px.pixel(x + d, 12, ink); px.pixel(x + 2 * d, 12, ink); px.pixel(x + 3 * d, 13, ink);
        }
        const cheek = mix(skin, PAL.red, 0.35);
        px.pixel(11, 15, cheek); px.pixel(20, 15, cheek);
        px.pixel(13, 15, ink); px.pixel(18, 15, ink);
        px.hline(14, 16, 4, PAL.white);
        px.pixel(13, 16, ink); px.pixel(18, 16, ink);
        px.hline(14, 17, 4, ink);
    } else if (expression === 'angry') {
        // brows slammed down into a V, a glare and a frown
        for (const [x, d] of [[11, 1], [20, -1]]) {
            px.pixel(x, 10, brow); px.pixel(x + d, 10, brow); px.pixel(x + 2 * d, 11, brow); px.pixel(x + 3 * d, 11, brow);
            px.pixel(x + d, 9, brow); px.pixel(x + 2 * d, 10, brow);
            px.pixel(x + d, 12, PAL.white); px.pixel(x + 2 * d, 12, ink);
            px.pixel(x + d, 13, ink); px.pixel(x + 2 * d, 13, ink);
        }
        px.hline(14, 16, 4, ink);
        px.pixel(13, 17, ink); px.pixel(18, 17, ink);
    } else {
        px.hline(11, 10, 4, brow);
        px.hline(17, 10, 4, brow);
        px.rect(12, 12, 1, 2, PAL.white); px.rect(13, 12, 1, 2, ink);
        px.rect(18, 12, 1, 2, ink); px.rect(19, 12, 1, 2, PAL.white);
        px.hline(14, 16, 4, lip);
    }
}

function drawBeard(px, spec) {
    if (spec.beard) {
        px.sprite(BEARD.rows, BEARD.x, BEARD.y, { b: spec.beard });
        px.hline(13, 15, 6, shade(spec.beard, 0.2)); // moustache
    }
}

// Stubble goes under the face features so the mouth stays readable.
function drawStubble(px, spec) {
    if (!spec.stubble) return;
    for (let y = 15; y <= 18; y++) {
        for (let x = 11; x <= 20; x++) if ((x + y) % 2 === 0 && px.get(x, y) !== null) px.pixel(x, y, mix(spec.stubble, spec.skin, 0.35));
    }
}

function drawMouthOverBeard(px, expression, skin) {
    // keeps the mouth readable through a full beard
    if (expression === 'happy') {
        px.pixel(13, 15, PAL.ink); px.pixel(18, 15, PAL.ink);
        px.pixel(13, 16, PAL.ink); px.pixel(18, 16, PAL.ink);
        px.hline(14, 16, 4, PAL.white);
        px.hline(14, 17, 4, PAL.ink);
    } else if (expression === 'angry') {
        px.hline(14, 16, 4, PAL.ink);
        px.pixel(13, 17, PAL.ink); px.pixel(18, 17, PAL.ink);
    } else {
        px.hline(14, 16, 4, mix(skin, '#6b2a2a', 0.6));
    }
}

function drawProp(px, prop) {
    const p = PROPS[prop];
    if (p) px.sprite(p.rows, p.x, p.y, p.pal);
}

// A red "cross-popping vein" anger mark beside the head.
const ANGER = ['.r.r.', 'rr.rr', '.....', 'rr.rr', '.r.r.'];

// Ink every transparent pixel that touches an opaque one.
function inkOutline(px) {
    const edge = [];
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            if (px.get(x, y) !== null) continue;
            if (px.get(x - 1, y) || px.get(x + 1, y) || px.get(x, y - 1) || px.get(x, y + 1)) edge.push([x, y]);
        }
    }
    for (const [x, y] of edge) px.pixel(x, y, PAL.ink);
}

function paint(px, spec, expression) {
    const skin = expression === 'angry' ? mix(spec.skin, PAL.red, 0.16) : spec.skin;
    const skinShade = mix(skin, '#7a3a2a', 0.22);
    drawHair(px, spec, 'back');
    drawBody(px, spec.outfit, skin, skinShade);
    px.sprite(HEAD, 8, 6, { s: skin, S: skinShade });
    drawHair(px, spec, 'front');
    drawStubble(px, spec);
    drawFace(px, spec, expression, skin);
    if (spec.moustache) px.hline(14, 15, 4, spec.moustache);
    drawBeard(px, spec);
    if (spec.beard) drawMouthOverBeard(px, expression, skin);
    drawProp(px, spec.prop);
    if (expression === 'angry') px.sprite(ANGER, 3, 3, { r: PAL.red });
    inkOutline(px);
}

export function drawSprite(ctx, spriteId, expression, x, y, scale) {
    const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const expr = EXPRESSIONS.has(expression) ? expression : 'neutral';
    const px = new PixelCanvas(SIZE, SIZE);
    paint(px, specFor(spriteId), expr);
    px.blitTo(ctx, s, Number(x) || 0, Number(y) || 0);
}
