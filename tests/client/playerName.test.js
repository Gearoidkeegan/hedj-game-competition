// R64: the registration form checks the leaderboard name and company with the server's rules. The browser copy
// (js/utils/playerName.js) is pinned to the server's (backend/lib/http.mjs, backend/lib/util.mjs) here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validName } from '../../backend/lib/http.mjs';
import { validCompany } from '../../backend/lib/util.mjs';
import { validPlayerName, validCompanyName, NAME_MAX, COMPANY_MAX } from '../../js/utils/playerName.js';

const src = rel => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const regexLine = (text, name) => {
    const m = text.match(new RegExp(`^const ${name} = (.+);\r?$`, 'm'));
    assert.ok(m, `no ${name} in source`);
    return m[1];
};

test('the client name regexes are the server regexes, character for character', () => {
    const server = src('backend/lib/http.mjs');
    const client = src('js/utils/playerName.js');
    for (const name of ['NAME_RE', 'NAME_CONTENT_RE']) assert.equal(regexLine(client, name), regexLine(server, name), name);
    assert.ok(regexLine(server, 'NAME_RE').includes(`{1,${NAME_MAX}}`));
    assert.ok(src('backend/lib/util.mjs').includes(`s.trim().length <= ${COMPANY_MAX}`));
});

const NAMES = [
    'Ann', 'Jane Smith', 'Zoë', 'José Álvarez', 'O\'Neill', 'jane_s-1', 'A.B. #1', '李小龍', 'Ann 🚀', '👍🏽', '🇮🇪 Team',
    'a'.repeat(20), 'a'.repeat(21), 'Christopher Montgomery', 'Smith, Jane', 'Jane (CFO)', 'Ann/Bob', '<b>', 'a&b', 'a"b',
    '', '   ', '...', '-', '‍', ' Ann ', 'x́'.repeat(10)
];

test('client and server agree on every sample name', () => {
    for (const n of NAMES) {
        assert.equal(validPlayerName(n), validName(n.trim()), JSON.stringify(n));
    }
    // The cases the reviewer flagged: over 20, commas, brackets.
    for (const bad of ['Christopher Montgomery', 'Smith, Jane', 'Jane (CFO)', 'a'.repeat(21)]) assert.equal(validPlayerName(bad), false, bad);
    for (const good of ['Jane Smith', 'Zoë', 'Ann 🚀']) assert.equal(validPlayerName(good), true, good);
});

test('client and server agree on companies', () => {
    for (const c of ['Acme', 'A&Co', ' Acme ', 'c'.repeat(60), 'c'.repeat(61), 'x<y', '', '   ']) {
        assert.equal(validCompanyName(c), validCompany(c), JSON.stringify(c));
    }
});
