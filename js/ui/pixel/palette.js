// Shared colours for the pixel scenes. A cool Hedj blue-grey world with a
// safety-orange accent, inked with one navy outline colour, plus the mood
// grades that relight a finished scene for storm and boom.

export const PAL = {
    ink: '#1e2a44',

    // concrete and cladding, light to dark
    white: '#ffffff',
    wall0: '#eef3f8',
    wall1: '#d3dde8',
    wall2: '#aab9c9',
    wall3: '#7f91a6',
    wall4: '#5d6e84',

    glass: '#7fb2d9',
    glassDark: '#4f7ea8',
    glassLit: '#ffe08a',

    orange: '#f08040',
    orangeDark: '#c25a24',
    orangeLight: '#ffb07a',
    red: '#e04848',
    redDark: '#a02c2c',
    green: '#44c070',
    greenDark: '#2a8a4c',
    blue: '#3a6fc4',
    blueDark: '#284e8c',
    yellow: '#f5c542',

    grass: '#86bf5e',
    grassDark: '#6aa24a',
    grassLight: '#a5d47a',
    leaf: '#3f8a4a',
    leafDark: '#2c6a3a',
    leafLight: '#62b05a',
    trunk: '#6b4a33',

    tarmac: '#707b8a',
    tarmacDark: '#5a6472',
    kerb: '#c9d2dc',
    paint: '#f4f4ec',

    dirt: '#bf9562',
    dirtDark: '#94693f',
    sand: '#dcc28e',

    coffee: '#5a3420',
    cherry: '#c8402c',
    sack: '#cfae74',
    sackDark: '#a6844e',

    steel: '#8a9bb0',
    steelDark: '#5f6f84',
    copper: '#d07a3a',
    copperLight: '#f0a868',

    water: '#5fa8d8',
    waterDark: '#3f84b8',
    smoke: '#dfe5ec',
    smokeDark: '#b9c3cf',

    coin: '#ffcc33',
    coinDark: '#c98f12',
    coinLight: '#fff2a8',

    skin: '#f0c49a',
    rain: '#a9bdd6',
    bolt: '#fff7c2',

    // light sources: these keep glowing when a storm darkens the scene
    lamp: '#ff3b3b',
    lampGreen: '#5dff8a',
    flameY: '#ffe45c',
    flameO: '#ff9a3c',
    flameR: '#ff5a3c',
};

const GLOW = new Set([PAL.glassLit, PAL.lamp, PAL.lampGreen, PAL.flameY, PAL.flameO, PAL.flameR]);

// Sky bands top to bottom, one set per mood.
export const SKY = {
    calm: ['#5d9fd9', '#6eaae0', '#80b6e6', '#95c4ec', '#accff0', '#c8e2f6'],
    storm: ['#262e3f', '#2d3547', '#353e51', '#3e475b', '#475165', '#525d71'],
    boom: ['#3d9be6', '#52a8ec', '#6cb8f0', '#8dc9f2', '#bfe0ec', '#ffe8ae'],
};

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]) {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
}

export function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}

const grades = {
    // Storm: desaturate, darken and pull towards a cold slate blue.
    storm: (hex) => {
        const [r, g, b] = hexToRgb(hex);
        const grey = 0.3 * r + 0.59 * g + 0.11 * b;
        const d = (v) => (v + (grey - v) * 0.4) * 0.68;
        return mix(rgbToHex([d(r), d(g), d(b)]), '#24304c', 0.18);
    },
    // Boom: a warm late-afternoon glow.
    boom: (hex) => mix(hex, '#ffe2a0', 0.1),
};

const gradeCache = { storm: new Map(), boom: new Map() };

// Returns a memoised colour mapper for the mood, or null when no grade applies.
export function moodGrade(mood) {
    const fn = grades[mood];
    if (!fn) return null;
    const cache = gradeCache[mood];
    return (hex) => {
        let out = cache.get(hex);
        if (out === undefined) {
            out = GLOW.has(hex) ? hex : fn(hex);
            cache.set(hex, out);
        }
        return out;
    };
}
