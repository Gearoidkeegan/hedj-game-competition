// Anti-AI-style copy checks for every player-facing string in the game.
// Rules come from .superpowers/sdd/2026-11-09-v32-feedback/anti-ai-checklist.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BS = String.fromCharCode(92);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const JSON_FILES = [
    'data/board-dialogue.json', 'data/events.json', 'data/simple-events.json', 'data/powerups.json',
    'data/industries.json', 'data/year-facts.json', 'data/products.json', 'data/quips.json',
];
const JS_FILES = [
    ...fs.readdirSync(path.join(ROOT, 'js/screens')).filter(f => f.endsWith('.js')).map(f => `js/screens/${f}`),
    ...fs.readdirSync(path.join(ROOT, 'js/screens/simple')).filter(f => f.endsWith('.js')).map(f => `js/screens/simple/${f}`),
    'js/ui/labels.js', 'js/ui/pixel/sprites.js', 'js/stand.js', 'js/admin.js',
];
const HTML_FILES = ['index.html', 'stand.html', 'privacy.html', 'admin.html'];

// TODO(Task 3a): remove this allow-list when Task 3a (Simple feedback rules, quips.json, sprites,
// Simple screens, labels) merges. The controller removes it at merge so these files are then checked.
const PENDING_3A = new Set([
    'data/quips.json', 'js/ui/labels.js', 'js/ui/pixel/sprites.js',
    ...fs.readdirSync(path.join(ROOT, 'js/screens/simple')).map(f => `js/screens/simple/${f}`),
]);

const BANNED = [
    'delve', 'leverage', 'seamless', 'seamlessly', 'robust', 'navigate', 'navigating', 'landscape', 'journey',
    'elevate', 'tapestry', 'realm', 'testament', 'game-changer', 'crucial', 'vital', 'pivotal',
    "in today's", "it's important to note", "let's dive", "here's the thing", 'in conclusion',
    'at the end of the day', 'moreover', 'furthermore', 'additionally',
    'certainly', 'great question', 'i hope this helps', 'let me know',
];
const BANNED_RE = new RegExp('(?<![\\w-])(' + BANNED.join('|') + ')(?![\\w-])', 'i');
// "unlock" as a verb is banned in data copy; the Unlocks feature label lives in code strings, which are exempt.
const UNLOCK_RE = /\bunlock(s|ed|ing)?\b/i;
const MIRROR_RE = /\bnot just\b[^.]*\bit's\b|\bIt's not [^.]+\. It's\b/i;

function jsonStrings(node, out = []) {
    if (typeof node === 'string') out.push(node);
    else if (Array.isArray(node)) node.forEach(n => jsonStrings(n, out));
    else if (node && typeof node === 'object') Object.values(node).forEach(n => jsonStrings(n, out));
    return out;
}

// Pull the contents of every string and template literal out of JS source, skipping comments.
function jsStrings(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? src.length : i + 2; continue; }
        if (c === "'" || c === '"' || c === '`') {
            let j = i + 1, s = '';
            while (j < src.length && src[j] !== c) { if (src[j] === BS) { s += src[j + 1]; j += 2; } else { s += src[j++]; } }
            out.push(s);
            i = j + 1;
            continue;
        }
        i++;
    }
    return out;
}

function htmlText(src) {
    return src.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
}

function collect() {
    const all = [];
    for (const f of JSON_FILES) all.push({ file: f, kind: 'json', strings: jsonStrings(JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'))) });
    for (const f of JS_FILES) all.push({ file: f, kind: 'js', strings: jsStrings(fs.readFileSync(path.join(ROOT, f), 'utf8')) });
    for (const f of HTML_FILES) all.push({ file: f, kind: 'html', strings: [htmlText(fs.readFileSync(path.join(ROOT, f), 'utf8'))] });
    return all.filter(x => !PENDING_3A.has(x.file));
}

function offenders(test) {
    const bad = [];
    for (const { file, kind, strings } of collect()) {
        for (const s of strings) {
            const why = test(s, kind);
            if (why) bad.push(`${file}: ${why}: ${s.slice(0, 100).replace(/\s+/g, ' ')}`);
        }
    }
    return bad;
}

test('no em dashes in player-facing copy', () => {
    assert.deepEqual(offenders(s => { const i = s.indexOf('—'); return i >= 0 && 'em dash near "' + s.slice(Math.max(0, i - 40), i + 40).replace(/\s+/g, ' ') + '"'; }), []);
});

test('no banned words or phrases', () => {
    assert.deepEqual(offenders(s => { const m = s.match(BANNED_RE); return m && `banned "${m[1]}"`; }), []);
});

test('"unlock" does not appear in data copy', () => {
    const bad = [];
    for (const f of JSON_FILES.filter(f => !PENDING_3A.has(f))) {
        for (const s of jsonStrings(JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')))) {
            if (UNLOCK_RE.test(s)) bad.push(`${f}: ${s}`);
        }
    }
    assert.deepEqual(bad, []);
});

test('no "not just X, it\'s Y" mirrors or chatbot leftovers', () => {
    assert.deepEqual(offenders(s => MIRROR_RE.test(s) && 'mirror construction'), []);
});

test('the scanner itself catches what it should', () => {
    assert.ok(BANNED_RE.test('A rich tapestry of risk'));
    assert.ok(BANNED_RE.test("Let's dive in"));
    assert.ok(!BANNED_RE.test('The navigator arrives'));
    assert.deepEqual(jsStrings("const a = 'x " + BS + "' y'; // 'no'" + String.fromCharCode(10) + "const b = `t ${1}`;"), ["x ' y", 't ${1}']);
});
