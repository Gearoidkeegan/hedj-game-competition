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
    ...fs.readdirSync(path.join(ROOT, 'js/ui')).filter(f => f.endsWith('.js')).map(f => `js/ui/${f}`),
    'js/ui/pixel/sprites.js', 'js/utils/constants.js', 'js/utils/formatters.js', 'js/main.js', 'js/stand.js', 'js/admin.js',
];
// EraPopup's em dash imitates the real Outlook title bar of the era it parodies, so it stays.
const DASH_ALLOWED = new Set(['js/ui/EraPopup.js']);
// EraPopup also mocks Outlook and Teams chrome with decorative icons; those are not game copy.
const EMOJI_ALLOWED = new Set(['js/ui/EraPopup.js']);
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
const MIRROR_RE = /\bnot just\b[^.]*\bit's\b|\bIt's not [^.]+\. It's\b|\b(isn't|aren't|not just|not merely)\b[^.!?]{0,60}[,:;]\s*(it's|it is|they're|they are|that's)\b/i;
// An em dash in any spelling: the character, &mdash;, &#8212;, &#x2014; or a JS escape.
const DASH_RE = new RegExp([String.fromCharCode(0x2014), '&mdash;', '&#8212;', '&#x2014;', BS + BS + 'u2014', BS + BS + 'u\\{2014\\}'].join('|'), 'i');

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
            out.push(s.replace(/<!--[\s\S]*?-->/g, ' '));
            i = j + 1;
            continue;
        }
        i++;
    }
    return out;
}

// JS source with comments removed but everything else kept verbatim (escapes and nested templates included),
// so the dash check also sees JS escapes and the text of nested template literals.
function jsCode(src) {
    let out = '', i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
        if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? src.length : i + 2; continue; }
        out += c; i++;
    }
    return out.replace(/<!--[\s\S]*?-->/g, ' ');
}

function htmlText(src) {
    // <link> tags (favicon data URIs) are not copy.
    const noLinks = src.split(String.fromCharCode(10)).filter(l => !l.includes('<link ')).join(' ');
    return noLinks.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
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
            const why = test(s, kind, file);
            if (why) bad.push(`${file}: ${why}: ${s.slice(0, 100).replace(/\s+/g, ' ')}`);
        }
    }
    return bad;
}

// Known limitation: the banned-word scan reads string and template literals one level deep, so words inside a
// template nested in a ${} expression are not word-checked. The em dash check reads raw code, so nesting is covered.
test('no em dashes in player-facing copy', () => {
    const bad = [];
    const near = s => { const m = DASH_RE.exec(s); return s.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' '); };
    for (const { file, kind, strings } of collect()) {
        if (DASH_ALLOWED.has(file)) continue;
        const texts = kind === 'js' ? [jsCode(fs.readFileSync(path.join(ROOT, file), 'utf8'))] : strings;
        for (const t of texts) if (DASH_RE.test(t)) bad.push(`${file}: em dash near "${near(t)}"`);
    }
    assert.deepEqual(bad, []);
});

test('no emoji', () => {
    assert.deepEqual(offenders((s, kind, file) => !EMOJI_ALLOWED.has(file) && /\p{Emoji_Presentation}|️/u.test(s) && 'emoji'), []);
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
    assert.ok(DASH_RE.test('a ' + String.fromCharCode(0x2014) + ' b'));
    assert.ok(DASH_RE.test('<td>&mdash;</td>') && DASH_RE.test('x &#8212; y') && DASH_RE.test("'" + BS + "u2014'"));
    assert.ok(!DASH_RE.test('range 50' + String.fromCharCode(0x2013) + '75%'));
    assert.ok(DASH_RE.test(jsCode('const a = `x ${c ? `b ' + String.fromCharCode(0x2014) + '` : ""}`; // gone')));
    assert.ok(!DASH_RE.test(jsCode('// ' + String.fromCharCode(0x2014) + ' comment')));
    assert.ok(MIRROR_RE.test("It isn't a hedge, it's a bet") && MIRROR_RE.test("Not just a loss, it's a lesson"));
    assert.ok(!MIRROR_RE.test('Hedge it. It is fine.'));
    assert.deepEqual(jsStrings("const a = 'x " + BS + "' y'; // 'no'" + String.fromCharCode(10) + "const b = `t ${1}`;"), ["x ' y", 't ${1}']);
});
