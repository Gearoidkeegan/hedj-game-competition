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

test('fonts.css declares both faces with font-display: swap from assets/fonts', () => {
    const css = fs.readFileSync(path.join(root, 'css/fonts.css'), 'utf8');
    for (const [fam, file] of [['Press Start 2P', 'PressStart2P-Regular'], ['VT323', 'VT323-Regular']]) {
        assert.ok(css.includes(`font-family: '${fam}'`));
        assert.ok(css.includes(`../assets/fonts/${file}.woff2`));
    }
    assert.equal((css.match(/font-display: swap/g) || []).length, 2);
});

test('every page that uses the pixel fonts links css/fonts.css', () => {
    for (const p of ['index.html', 'admin.html', 'stand.html', 'privacy.html']) {
        assert.ok(fs.readFileSync(path.join(root, p), 'utf8').includes('css/fonts.css'), p);
    }
});

test('woff2 files are real woff2', { skip: !fs.existsSync(path.join(root, 'assets/fonts/VT323-Regular.woff2')) && 'woff2 files not yet added (download blocked)' }, () => {
    for (const f of ['PressStart2P-Regular.woff2', 'VT323-Regular.woff2']) {
        assert.equal(fs.readFileSync(path.join(root, 'assets/fonts', f)).subarray(0, 4).toString('latin1'), 'wOF2');
    }
});
