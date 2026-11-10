// v3.2 Task 3: the anti-AI-style checklist (.superpowers/sdd/2026-11-09-v32-feedback/anti-ai-checklist.md) for the
// Simple feedback copy: data/quips.json, the Simple screens, js/ui/labels.js; and the parody chairman names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { loadJson } from '../helpers/loadData.js';
import { allStrings } from '../helpers/copy.js';
import { CHAIRMAN_SPRITES } from '../../js/ui/pixel/sprites.js';
import { badgeLabel } from '../../js/ui/labels.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The checklist's hard rules.
const BANNED = [
    [/—/, 'em dash'],
    [/\b(delve\w*|leverag\w*|seamless(ly)?|robust|navigat\w*|landscape|journey|elevat\w*|tapestry|realm|testament|game-changer|crucial|vital|pivotal)\b/i, 'stock word'],
    [/\bin today's\b|\bit's important to note\b|\blet's dive\b|\bhere's the thing\b|\bin conclusion\b|\bat the end of the day\b/i, 'stock phrase'],
    [/\b(moreover|furthermore|additionally)\b/i, 'connector'],
    [/\bnot just\b[^.]*,\s*it'?s\b/i, '"not just X, it\'s Y"'],
    [/\bit'?s not [^.]+\.\s*it'?s\b/i, '"It\'s not X. It\'s Y."'],
    [/\b(certainly|great question|i hope this helps|let me know)\b/i, 'chatbot leftover'],
];
// The checklist's judgement patterns that are easy to test in short lines.
const AVOID = [
    [/\b(spoiler|the catch\?|the result:|overall|in short|bottom line)\b/i, 'reveal or summary closer'],
    [/\b(transformative|stands as|plays a (vital|key) role)\b/i, 'grand wording'],
];

function offences(text, rules) {
    return rules.filter(([re]) => re.test(text)).map(([, why]) => why);
}

test('quips.json follows the anti-AI checklist (no em dashes, stock words, chatbot phrases or summary closers)', () => {
    const bad = [];
    for (const { path, s } of allStrings(loadJson('data/quips.json'))) {
        const why = offences(s, [...BANNED, ...AVOID]);
        if (why.length) bad.push(`${path} (${why.join(', ')}): ${s}`);
    }
    assert.deepEqual(bad, []);
});

// Code comments and identifiers are out of scope; strip // comments before checking.
function codeOnly(src) {
    return src.split(/\r?\n/)
        .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .map(l => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

test('the Simple screens and labels.js have no em dashes or stock phrases in their strings', () => {
    const dir = join(ROOT, 'js', 'screens', 'simple');
    const files = [...readdirSync(dir).map(f => join(dir, f)), join(ROOT, 'js', 'ui', 'labels.js')];
    const bad = [];
    for (const f of files) {
        const why = offences(codeOnly(readFileSync(f, 'utf8')), BANNED);
        if (why.length) bad.push(`${relative(ROOT, f)}: ${why.join(', ')}`);
    }
    assert.deepEqual(bad, []);
});

// ── The parody names ────────────────────────────────────────────────────

const PRO_NAMES = {
    jameson: 'J.J. Jameson', musk: 'ElonUsk', oleary: "Michael O'Scary", dimon: 'Jamie Diamond',
    buffett: 'Warren Biscuit', jobs: 'Steve Jobsworth', dorsey: 'Jack Doorstep', ackman: 'Bill Hackman'
};

test('the chairmen go by the Pro parody names everywhere in Simple', () => {
    for (const [id, name] of Object.entries(PRO_NAMES)) {
        assert.equal(CHAIRMAN_SPRITES[id].label, name, id);
        assert.equal(badgeLabel(id), name, `badge ${id}`);
    }
    assert.deepEqual(Object.keys(CHAIRMAN_SPRITES).sort(), Object.keys(PRO_NAMES).sort());
});

function walk(dir, out = []) {
    for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) {
            if (f !== 'market') walk(p, out);   // price data only
        }
        else if (/\.(js|json|html)$/.test(f)) out.push(p);
    }
    return out;
}

test('no old chairman labels remain ("The Editor", "The Rocketeer" and the rest)', () => {
    const OLD = /\bThe (Editor|Rocketeer|Budget Flyer|Banker|Sage|Visionary|Monk|Essayist)\b/;
    const files = [...walk(join(ROOT, 'js')), ...walk(join(ROOT, 'data')), ...walk(join(ROOT, 'tools')),
        ...readdirSync(ROOT).filter(f => f.endsWith('.html')).map(f => join(ROOT, f))];
    const hits = files.filter(f => OLD.test(readFileSync(f, 'utf8'))).map(f => relative(ROOT, f));
    assert.deepEqual(hits, []);
});
