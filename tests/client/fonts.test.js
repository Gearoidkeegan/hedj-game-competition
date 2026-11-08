import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const SKIP = new Set(['node_modules', '.git', '.github', '.superpowers', '.claude', 'docs', 'tests', 'backend']);
const EXT = /\.(html|css|js|mjs|json|webmanifest)$/;

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(path.join(dir, e.name), out); }
        else if (EXT.test(e.name)) out.push(path.join(dir, e.name));
    }
    return out;
}

test('no shipped file references fonts.googleapis or fonts.gstatic', () => {
    const bad = walk(root).filter(f => /fonts\.(googleapis|gstatic)/.test(fs.readFileSync(f, 'utf8')));
    assert.deepEqual(bad.map(f => path.relative(root, f)), []);
});

const FONT_FILES = ['PressStart2P-Regular', 'PressStart2P-LatinExt', 'VT323-Regular', 'VT323-LatinExt'];

test('fonts.css declares latin + latin-ext faces for both families, swap, from assets/fonts', () => {
    const css = fs.readFileSync(path.join(root, 'css/fonts.css'), 'utf8');
    for (const fam of ['Press Start 2P', 'VT323']) assert.ok(css.includes(`font-family: '${fam}'`));
    for (const file of FONT_FILES) assert.ok(css.includes(`../assets/fonts/${file}.woff2`), file);
    const faces = (css.match(/@font-face/g) || []).length;
    assert.equal(faces, 4);
    assert.equal((css.match(/font-display: swap/g) || []).length, faces);
    assert.equal((css.match(/unicode-range:/g) || []).length, faces);
    assert.ok(css.includes('U+20AC'), 'latin subset carries the euro sign');
});

test('every page that uses the pixel fonts links css/fonts.css', () => {
    for (const p of ['index.html', 'admin.html', 'stand.html', 'privacy.html']) {
        assert.ok(fs.readFileSync(path.join(root, p), 'utf8').includes('css/fonts.css'), p);
    }
});

test('woff2 files are real woff2 and the OFL licence covers both families', () => {
    for (const f of FONT_FILES) {
        assert.equal(fs.readFileSync(path.join(root, 'assets/fonts', `${f}.woff2`)).subarray(0, 4).toString('latin1'), 'wOF2', f);
    }
    const ofl = fs.readFileSync(path.join(root, 'assets/fonts/OFL.txt'), 'utf8');
    assert.equal((ofl.match(/SIL Open Font License, Version 1\.1/g) || []).length >= 2, true);
    assert.ok(ofl.includes('Press Start 2P') && ofl.includes('VT323'));
});
