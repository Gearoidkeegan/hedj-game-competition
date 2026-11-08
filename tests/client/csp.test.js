// CSP readiness (docs/cloudfront-security-headers.md): script-src 'self' blocks inline <script> bodies, on*=
// handler attributes and javascript: URLs, in the shipped pages and in markup the JS injects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const PAGES = ['index.html', 'admin.html', 'stand.html', 'privacy.html'];

function jsFiles(dir) {
    return readdirSync(dir).flatMap(n => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? jsFiles(p) : p.endsWith('.js') ? [p] : [];
    });
}

test('shipped pages have no inline script bodies', () => {
    for (const page of PAGES) {
        const html = readFileSync(join(root, page), 'utf8');
        for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
            assert.ok(/\bsrc=/.test(m[1]), `${page}: inline <script> without src`);
            assert.equal(m[2].trim(), '', `${page}: <script src> with a body`);
        }
    }
});

test('shipped pages and injected markup have no on*= handlers or javascript: URLs', () => {
    const files = [...PAGES.map(p => join(root, p)), ...jsFiles(join(root, 'js'))];
    for (const f of files) {
        const src = readFileSync(f, 'utf8');
        // An HTML attribute: whitespace, on<event>=, then a quote. Matches markup in .html and in JS template strings.
        assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(src), `${f}: inline on*= handler`);
        assert.ok(!/javascript:/i.test(src), `${f}: javascript: URL`);
    }
});
