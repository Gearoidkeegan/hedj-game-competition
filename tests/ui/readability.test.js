import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../../css/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.css'));

test('no CSS font-size resolves below 12px (16px root for em/rem)', () => {
    const bad = [];
    for (const f of files) {
        const css = readFileSync(new URL(f, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\[style\*=[^\]]*\]/g, '');   // attribute selectors that lift inline sizes name small sizes on purpose
        for (const m of css.matchAll(/font-size:\s*([0-9.]+)(px|rem|em|pt)\b/g)) {
            const n = Number(m[1]);
            const px = m[2] === 'px' ? n : m[2] === 'pt' ? n * 4 / 3 : n * 16;
            if (px < 12) bad.push(`${f}: ${m[0]}`);
        }
    }
    assert.deepEqual(bad, []);
});

test('the CRT overlay is switched off at 768px and below', () => {
    const css = readFileSync(new URL('responsive.css', dir), 'utf8');
    assert.match(css, /@media \(max-width: 768px\) \{\s*#game-viewport::after \{ display: none; \}/);
});

test('the Simple chart caption stays at 16px: VT323 is hard to read any smaller (final review)', () => {
    const css = readFileSync(new URL('v3.css', dir), 'utf8');
    const rule = css.match(/\.r-chart-caption \{[^}]*\}/);
    assert.ok(rule, '.r-chart-caption rule');
    assert.match(rule[0], /font-size: 16px;/);
});
