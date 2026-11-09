// The player character (v3.1): 8 pixel busts in the board sprites' inked, flat-shaded style, each with a happy,
// worried and angry face.
//
//   AVATAR_IDS                       -> ['p1', ..., 'p8'] in picker order
//   AVATARS[id]                      -> { palette, faces: { happy, worried, angry }, features, hair }
//   isAvatarId(id)                   -> true for a known id
//   drawAvatar(ctx, id, expression, x, y, scale)
//
// Each face is a 32x32 pixel map (one character per pixel, '.' transparent) over a per-avatar palette, composed
// once at load from layers (body, hair behind, head, hair, headwear, face, beard, glasses), then inked with a
// one-pixel outline. The characters are told apart by pictures only: the ids and the picker's labels
// ("Character 1".."Character 8") never describe a person. `features` and `hair` are for tests and comments.

import { PixelCanvas } from './PixelCanvas.js';
import { PAL, mix } from './palette.js';

export const AVATAR_SIZE = 32;
export const AVATAR_EXPRESSIONS = Object.freeze(['happy', 'worried', 'angry']);
const S = AVATAR_SIZE;

// ---- Grid helpers -------------------------------------------------------------

const blank = () => Array.from({ length: S }, () => Array(S).fill('.'));
const put = (g, x, y, ch) => { if (x >= 0 && y >= 0 && x < S && y < S) g[y][x] = ch; };
const at = (g, x, y) => (x >= 0 && y >= 0 && x < S && y < S ? g[y][x] : '.');
const hline = (g, x0, x1, y, ch) => { for (let x = x0; x <= x1; x++) put(g, x, y, ch); };
// Stamp a map at (x, y); '.' and ' ' are transparent. `only` limits it to pixels already painted.
function stamp(g, rows, x = 0, y = 0, only = false) {
    rows.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
            const ch = row[c];
            if (ch === '.' || ch === ' ') continue;
            if (only && at(g, x + c, y + r) === '.') continue;
            put(g, x + c, y + r, ch);
        }
    });
}
// Mirror a left-half feature onto the right: (x, y) -> (31 - x, y).
const both = (g, pts, ch) => { for (const [x, y] of pts) { put(g, x, y, ch); put(g, S - 1 - x, y, ch); } };

// ---- Head and body ------------------------------------------------------------

// The head's [left, right] columns per row, from row 5 (crown) to row 22 (chin). The face is 18 wide (x 7..24).
const HEAD_ROWS = {
    5: [11, 20], 6: [9, 22], 7: [8, 23],
    8: [7, 24], 9: [7, 24], 10: [7, 24], 11: [7, 24], 12: [7, 24], 13: [7, 24], 14: [7, 24], 15: [7, 24],
    16: [7, 24], 17: [7, 24], 18: [7, 24], 19: [8, 23], 20: [9, 22], 21: [10, 21], 22: [12, 19],
};

function drawHead(g) {
    for (const [y, [l, r]] of Object.entries(HEAD_ROWS)) {
        hline(g, l, r, +y, 's');
        put(g, r, +y, 'S');
        if (+y >= 19) put(g, r - 1, +y, 'S');
    }
    // ears
    for (let y = 12; y <= 15; y++) { put(g, 6, y, 's'); put(g, 25, y, 'S'); }
    put(g, 6, 13, 'S'); put(g, 6, 14, 'S');
}

// Neck and shoulders. kind: 'blazer' (open jacket, shirt V, optional tie), 'crew' (sweater) or 'collar' (shirt).
function drawBody(g, kind, tie) {
    for (let y = 22; y <= 25; y++) hline(g, 13, 18, y, 's');
    hline(g, 13, 18, 22, 'S');
    hline(g, 13, 18, 23, 'S');
    put(g, 18, 24, 'S'); put(g, 18, 25, 'S');
    const widths = { 25: [8, 23], 26: [5, 26], 27: [4, 27], 28: [3, 28], 29: [3, 28], 30: [3, 28], 31: [3, 28] };
    for (const [y, [l, r]] of Object.entries(widths)) {
        hline(g, l, r, +y, 'o');
        hline(g, r - 2, r, +y, 'O');
    }
    put(g, 8, 28, 'O'); put(g, 8, 29, 'O'); put(g, 8, 30, 'O'); put(g, 8, 31, 'O');   // arm seams
    put(g, 23, 28, 'O'); put(g, 23, 29, 'O'); put(g, 23, 30, 'O'); put(g, 23, 31, 'O');
    if (kind === 'blazer') {
        // shirt V and lapels
        const V = { 25: [13, 18], 26: [13, 18], 27: [14, 17], 28: [14, 17], 29: [15, 16], 30: [15, 16] };
        for (const [y, [l, r]] of Object.entries(V)) {
            hline(g, l, r, +y, 'p');
            put(g, l - 1, +y, 'O'); put(g, r + 1, +y, 'O');
        }
        if (tie) {
            put(g, 15, 25, 'A'); put(g, 16, 25, 'A');
            for (let y = 26; y <= 30; y++) { put(g, 15, y, 'a'); put(g, 16, y, 'a'); }
            put(g, 16, 30, 'A'); put(g, 15, 31, 'a'); put(g, 16, 31, 'A');
        }
    } else if (kind === 'collar') {
        stamp(g, ['pp....pp', 'ppp..ppp', '.pp..pp.'], 12, 25);
        for (const y of [28, 30]) put(g, 15, y, 'O');
    } else {
        // crew neck: a rib around the neck
        hline(g, 12, 19, 25, 'O');
        put(g, 12, 26, 'O'); put(g, 19, 26, 'O');
        hline(g, 13, 18, 26, 'O');
    }
}

// ---- Hair -----------------------------------------------------------------------
// h hair, H highlight, d shade. Maps are full-width rows from row `y`.

const HAIR = {
    // straight long hair with a side parting, past the shoulders
    long: {
        back: { y: 8, rows: [
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhhh..............hddd.....',
            '.....hhhhh............hhddd.....',
            '.....hhhhhh..........hhhddd.....',
            '.....hhhhhh..........hhhddd.....',
            '.....hhhhhh..........hhhddd.....',
            '.....hhhhhh..........hhhddd.....',
            '.....hhhhh............hhdd......',
            '.....hhhh..............hdd......',
            '......hh................d.......',
        ] },
        front: { y: 2, rows: [
            '............hhhhhhhh............',
            '..........hhhhhhhhhhhh..........',
            '.........hhhHHHHhhhhhhh.........',
            '........hhHHHhhhhhhhhhhh........',
            '.......hhHHhhhhhhhhhhhhhh.......',
            '......hhhhhhhhhhhhhhhhhhhd......',
            '......hhhhhhhhhhhhhhhh.hhd......',
            '......hhhhhhhhhhhhh.....hd......',
            '......hhhhhhhhhh.........d......',
            '......hhhhhhh............d......',
            '......hhhh...............d......',
            '......hhh................dd.....',
            '......hhh................dd.....',
            '......hhh................dd.....',
            '......hh.................dd.....',
            '......hh.................dd.....',
        ] },
    },
    // short, close-cropped coils with a crisp hairline
    coilCrop: {
        front: { y: 3, rows: [
            '...........hHhhHhhHh............',
            '.........hhhhhHhhhhhHh..........',
            '........hHhhhhhhHhhhhhhd........',
            '.......hhhhHhhhhhhhhHhhhd.......',
            '.......hhHhhhhhHhhhhhhhhd.......',
            '.......hhhhhhhhhhhhhhhhhd.......',
            '.......hh..............hd.......',
            '.......h................d.......',
        ] },
    },
    // a straight bob with a full fringe, chin length
    bob: {
        back: { y: 10, rows: [
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhh................ddd.....',
            '.....hhhh..............dddd.....',
            '.....hhhh..............dddd.....',
            '......hhh..............ddd......',
        ] },
        front: { y: 3, rows: [
            '..........hhhhhhhhhhhh..........',
            '........hhhhHHHhhhhhhhhh........',
            '.......hhhHHhhhhhhhhhhhhh.......',
            '......hhhHhhhhhhhhhhhhhhhd......',
            '......hhhhhhhhhhhhhhhhhhhd......',
            '......hhhhhhhhhhhhhhhhhhhd......',
            '......hhhhhhhhhhhhhhhhhhhd......',
            '......hhhdhhhdhhhdhhhdhhdd......',
            '......hhh................dd.....',
            '......hhh................dd.....',
            '......hh.................dd.....',
            '......hh.................dd.....',
            '......hh.................dd.....',
            '......hh.................dd.....',
            '......hh.................dd.....',
            '......hh.................dd.....',
        ] },
    },
    // a big rounded afro
    afro: {
        back: { y: 0, rows: [
            '...........hhhhhhhhhh...........',
            '........hhhhHhhhhhhhhhh.........',
            '......hhhhHhhhhHhhhhhhhhd.......',
            '.....hhhHhhhhhhhhhhHhhhhhd......',
            '....hhhhhhhhHhhhhhhhhhhhhhd.....',
            '...hhHhhhhhhhhhhhHhhhhhhhhhd....',
            '...hhhhhhhHhhhhhhhhhhhHhhhhd....',
            '..hhhHhhhhhhhhhhhhhhhhhhhhhdd...',
            '..hhhhhhhhhhhhHhhhhhhhhhhhhdd...',
            '..hHhhhhhhhhhhhhhhhhhhhhHhhdd...',
            '..hhhhhhhhhhhhhhhhhhhhhhhhhdd...',
            '..hhhhHhhhhhhhhhhhhhhhhhhhddd...',
            '..hhhhhhhhhhhhhhhhhhhhhhhhddd...',
            '..hhhhhhhhhhhhhhhhhhhhhhhhddd...',
            '...hhhhhhhhhhhhhhhhhhhhhhhdd....',
            '...hhhhhhhhhhhhhhhhhhhhhhddd....',
            '....hhhhhhhhhhhhhhhhhhhhddd.....',
            '.....hhhhhhhhhhhhhhhhhhddd......',
        ] },
        front: { y: 4, rows: [
            '.........hhhhhhhhhhhhhh.........',
            '.......hhhhHhhhhhhHhhhhhh.......',
            '.......hHhhhhhhhhhhhhhhhd.......',
            '.......hhhhhhHhhhhhhhhhhd.......',
            '.......hhhh..........hhhd.......',
            '.......hh..............hd.......',
        ] },
    },
    // short and neatly parted
    parted: {
        front: { y: 3, rows: [
            '...........hhhhhhhhhh...........',
            '.........hhhhhhhhhhhhhh.........',
            '........hhHHHHhhdhhhhhhd........',
            '.......hhHHhhhhhhdhhhhhhd.......',
            '.......hhhhhhhhhhhdhhhhhd.......',
            '.......hhhhhhhhhhhhhddhhd.......',
            '.......hhhhh...........d.......',
            '.......hh..............dd.......',
            '.......h................d.......',
        ] },
    },
    // braids gathered into a high bun, a few hanging behind
    braidBun: {
        back: { y: 8, rows: [
            '.....hdh................hdh.....',
            '.....dhd................dhd.....',
            '.....hdh................hdh.....',
            '.....dhd................dhd.....',
            '.....hdh................hdh.....',
            '.....dhd................dhd.....',
            '.....hdh................hdh.....',
            '.....dhd................dhd.....',
            '.....hdh................hdh.....',
            '.....dhd................dhd.....',
            '.....hdh................hdh.....',
            '.....dhd................dhd.....',
            '.....hdh................hdh.....',
            '.....dhd................dhd.....',
            '.....hdh................hdh.....',
            '.....dhd................dhd.....',
            '......h..................h......',
        ] },
        front: { y: 0, rows: [
            '.............hhhhhh.............',
            '............hHHhhhhd............',
            '............hhhhhhhd............',
            '..........hhhdddddddhh..........',
            '.........hhdhhdhhdhhdhh.........',
            '........hhdhhdhhdhhdhhdh........',
            '.......hdhhdhhdhhdhhdhhdd.......',
            '......hhdhhdhhdhhdhhdhhdhd......',
            '......hdh..............hdh......',
            '......dh................hd......',
            '......h..................d......',
        ] },
    },
    // short, loose curls
    curls: {
        front: { y: 1, rows: [
            '..........hh..hh..hh............',
            '.........hHhhhHhhhHhhh..........',
            '........hhhhHhhhHhhhHhh.........',
            '.......hHhhhhhHhhhhhhHhd........',
            '......hhhhHhhhhhhHhhhhhhd.......',
            '......hHhhhhHhhhhhhhhHhhd.......',
            '......hhhhhhhhhhHhhhhhhhdd......',
            '......hhhHhhhhhhhhhhHhhhdd......',
            '......hhh.hh.hhh.hh.hhh.dd......',
            '......hh................hd......',
            '.......h................d.......',
        ] },
    },
};

// The headscarf frames the face, covers the hair and ears, and drapes over the shoulders. f main, F shade, q fold.
// Per row: the scarf's outer [left, right] and the face opening [left, right] (none above the hem).
const SCARF_OUTER = {
    1: [11, 20], 2: [9, 22], 3: [8, 23], 4: [7, 24], 5: [6, 25], 24: [4, 27], 25: [3, 28], 26: [3, 28], 27: [3, 28],
    28: [5, 26], 29: [8, 23], 30: [11, 20],
};
const SCARF_OPEN = { 9: [8, 23], 19: [9, 22], 20: [10, 21], 21: [11, 20], 22: [12, 19] };
const SCARF_FOLDS = [[13, 2], [12, 3], [11, 4], [10, 5], [9, 6], [8, 7], [7, 25], [8, 26], [9, 27], [10, 28]];

function drawScarf(g) {
    for (let y = 1; y <= 30; y++) {
        const [l, r] = SCARF_OUTER[y] || [5, 26];
        const open = y >= 9 && y <= 22 ? SCARF_OPEN[y] || (y < 19 ? SCARF_OPEN[9] : null) : null;
        for (let x = l; x <= r; x++) {
            if (open && x >= open[0] && x <= open[1]) continue;
            put(g, x, y, x >= r - 2 ? 'F' : 'f');
        }
        if (open) put(g, open[1] + 1, y, 'F');   // the inner rim on the shaded side
    }
    for (const [x, y] of SCARF_FOLDS) put(g, x, y, 'q');
}

function drawHair(g, style, layer) {
    const map = HAIR[style]?.[layer];
    if (map) stamp(g, map.rows, 0, map.y);
}

// ---- Faces ----------------------------------------------------------------------
// e eye, w white, b brow, n nose, m mouth line, t mouth inside, c blush, x angry flush, z freckle.

function drawEyes(g, expression) {
    if (expression === 'angry') {
        // narrowed: a lid line over a slit
        both(g, [[10, 13], [11, 13], [12, 13], [13, 13]], 'b');
        both(g, [[11, 14], [12, 14]], 'e');
        both(g, [[10, 14]], 'w');
        return;
    }
    both(g, [[11, 13], [12, 13], [11, 14], [12, 14]], 'e');
    if (expression === 'worried') {
        // wide eyes: white on the outside, a lower lid
        both(g, [[10, 13], [10, 14]], 'w');
        both(g, [[11, 15], [12, 15]], 'S');
    } else {
        both(g, [[11, 13]], 'w');   // a catchlight
    }
}

function drawBrows(g, expression) {
    if (expression === 'happy') both(g, [[10, 11], [11, 10], [12, 10], [13, 11]], 'b');            // raised arches
    else if (expression === 'worried') both(g, [[10, 11], [11, 11], [12, 10], [13, 9]], 'b');      // inner ends up
    else both(g, [[9, 10], [10, 10], [11, 11], [12, 11], [13, 12], [12, 12]], 'b');                // slammed down
}

function drawMouth(g, expression) {
    if (expression === 'happy') {
        // an open grin
        stamp(g, ['m......m', '.mwwwwm.', '..mttm..'], 12, 18);
    } else if (expression === 'worried') {
        // a wobbly line
        stamp(g, ['.mm..mm.', 'm..mm..m'], 12, 18);
    } else {
        // a hard frown
        stamp(g, ['..mmmm..', '.mm..mm.', '.m....m.'], 12, 18);
    }
}

function drawCheeks(g, expression, spec) {
    if (spec.freckles) both(g, [[9, 15], [11, 16], [8, 16]], 'z');
    if (expression === 'happy') both(g, [[9, 17], [10, 17]], 'c');
    if (expression === 'angry') both(g, [[8, 16], [9, 16], [10, 16], [9, 17]], 'x');
}

function drawBeard(g) {
    // jaw and chin, leaving the mouth clear
    const rows = [
        '.......d................d.......',
        '.......dd..............dd.......',
        '.......ddd.............ddd......',
        '.......hhhh..........hhhd.......',
        '........hhhh........hhhd........',
        '.........hhh........hhhd........',
        '..........hhhhhhhhhhhd..........',
        '...........hhhhhhhhhd...........',
        '............hhhhhhhd............',
    ];
    stamp(g, rows, 0, 15, true);
    stamp(g, ['.dhhhhhhd.'], 11, 17);   // moustache
}

function drawGlasses(g) {
    // two square frames with tinted lenses, a bridge and the arms
    for (const x0 of [9, 18]) {
        for (let x = x0; x <= x0 + 4; x++) { put(g, x, 12, 'g'); put(g, x, 16, 'g'); }
        for (let y = 12; y <= 16; y++) { put(g, x0, y, 'g'); put(g, x0 + 4, y, 'g'); }
        for (let y = 13; y <= 15; y++) for (let x = x0 + 1; x <= x0 + 3; x++) put(g, x, y, 'G');
    }
    put(g, 14, 13, 'g'); put(g, 15, 13, 'g'); put(g, 16, 13, 'g'); put(g, 17, 13, 'g');
    put(g, 7, 13, 'g'); put(g, 8, 13, 'g'); put(g, 23, 13, 'g'); put(g, 24, 13, 'g');
}

// A red "cross-popping vein" by the head when angry, and a sweat drop when worried.
const ANGER = ['.r.r.', 'rr.rr', '.....', 'rr.rr', '.r.r.'];
const SWEAT = ['..u..', '.uuu.', 'uUuuu', 'uUuuu', '.uuu.'];

function inkOutline(g) {
    const edge = [];
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            if (g[y][x] !== '.') continue;
            if (at(g, x - 1, y) !== '.' || at(g, x + 1, y) !== '.' || at(g, x, y - 1) !== '.' || at(g, x, y + 1) !== '.') edge.push([x, y]);
        }
    }
    for (const [x, y] of edge) g[y][x] = 'k';
}

function compose(spec, expression) {
    const g = blank();
    drawBody(g, spec.outfit.kind, !!spec.outfit.tie);
    drawHair(g, spec.hair, 'back');
    drawHead(g);
    drawHair(g, spec.hair, 'front');
    if (spec.scarf) drawScarf(g);
    drawCheeks(g, expression, spec);
    put(g, 16, 16, 'n'); put(g, 16, 17, 'n');   // nose
    if (spec.beard) drawBeard(g);
    if (spec.glasses) drawGlasses(g);
    drawEyes(g, expression);
    drawBrows(g, expression);
    drawMouth(g, expression);
    if (expression === 'angry') stamp(g, ANGER, 0, 0);
    if (expression === 'worried') stamp(g, SWEAT, 26, 5);
    inkOutline(g);
    return Object.freeze(g.map(row => row.join('')));
}

// ---- The eight characters ---------------------------------------------------------

const BASE = { k: PAL.ink, w: PAL.white, r: PAL.red, u: '#8fd3ff', U: PAL.white, t: '#b8423e', G: '#d6ecf7' };

const SPECS = [
    { id: 'p1', skin: '#f6d5b8', hair: 'long', hairColour: '#6b3e22',
        outfit: { kind: 'blazer', main: '#2e3a52', shirt: PAL.white }, features: [] },
    { id: 'p2', skin: '#5c3a24', hair: 'coilCrop', hairColour: '#3a2a22', beard: true,
        outfit: { kind: 'blazer', main: '#3a3f47', shirt: '#d9e6f5', tie: PAL.red }, features: ['beard'] },
    { id: 'p3', skin: '#c68e5f', hair: 'scarf', hairColour: '#2a201c', scarf: '#2f8f8a',
        outfit: { kind: 'crew', main: '#c9a03a' }, features: ['headscarf'] },
    { id: 'p4', skin: '#f0c49a', hair: 'bob', hairColour: '#1c1c28', glasses: '#c0392b',
        outfit: { kind: 'crew', main: '#3f9a6a' }, features: ['glasses'] },
    { id: 'p5', skin: '#8d5a3b', hair: 'afro', hairColour: '#2b201c',
        outfit: { kind: 'collar', main: PAL.orange, shirt: '#fff2d8' }, features: [] },
    { id: 'p6', skin: '#dcab7c', hair: 'parted', hairColour: '#a9adb5', glasses: '#2b2b33', beard: true,
        outfit: { kind: 'blazer', main: '#6f7c8c', shirt: PAL.white, tie: '#284e8c' }, features: ['glasses', 'beard'] },
    { id: 'p7', skin: '#6e4529', hair: 'braidBun', hairColour: '#241a18',
        outfit: { kind: 'blazer', main: '#7a5aa8', shirt: '#f4ecf8' }, features: [] },
    { id: 'p8', skin: '#f8dcc4', hair: 'curls', hairColour: '#c0602a', freckles: true,
        outfit: { kind: 'collar', main: PAL.blue, shirt: PAL.white }, features: ['freckles'] },
];

function paletteFor(spec) {
    const skin = spec.skin;
    const hair = spec.hairColour;
    const main = spec.outfit.main;
    const accent = spec.outfit.tie || main;
    const scarf = spec.scarf || main;
    return Object.freeze({
        ...BASE,
        s: skin,
        S: mix(skin, '#5a2a1a', 0.22),
        n: mix(skin, '#5a2a1a', 0.3),
        c: mix(skin, '#ff5a6a', 0.35),
        x: mix(skin, PAL.red, 0.5),
        z: mix(skin, '#8a4a24', 0.4),
        e: mix(PAL.ink, '#000000', 0.2),
        b: mix(hair, PAL.ink, 0.45),
        m: mix(skin, '#1a0606', 0.72),
        h: hair,
        H: mix(hair, '#ffffff', 0.28),
        d: mix(hair, PAL.ink, 0.35),
        o: main,
        O: mix(main, PAL.ink, 0.3),
        p: spec.outfit.shirt || mix(main, '#ffffff', 0.5),
        a: accent,
        A: mix(accent, PAL.ink, 0.3),
        g: spec.glasses || PAL.ink,
        f: scarf,
        F: mix(scarf, PAL.ink, 0.3),
        q: mix(scarf, '#ffffff', 0.25),
    });
}

export const AVATARS = Object.freeze(Object.fromEntries(SPECS.map(spec => [spec.id, Object.freeze({
    palette: paletteFor(spec),
    faces: Object.freeze(Object.fromEntries(AVATAR_EXPRESSIONS.map(e => [e, compose(spec, e)]))),
    features: Object.freeze([...spec.features]),
    hair: spec.hair,
})])));

export const AVATAR_IDS = Object.freeze(SPECS.map(s => s.id));

export function isAvatarId(id) {
    return typeof id === 'string' && Object.hasOwn(AVATARS, id);
}

export function drawAvatar(ctx, id, expression, x, y, scale) {
    const avatar = isAvatarId(id) ? AVATARS[id] : null;
    if (!avatar || !ctx) return;
    const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const rows = avatar.faces[AVATAR_EXPRESSIONS.includes(expression) ? expression : 'happy'];
    const px = new PixelCanvas(S, S);
    px.sprite(rows, 0, 0, avatar.palette);
    px.blitTo(ctx, s, Number(x) || 0, Number(y) || 0);
}
