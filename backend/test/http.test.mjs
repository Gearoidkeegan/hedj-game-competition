import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validName, parseBody, requireAdmin, HttpError, json } from '../lib/http.mjs';

test('validName accepts letters, accents and the . \' _ - punctuation set', () => {
    assert.ok(validName('Zoë'));
    assert.ok(validName("O'Brien-Smith_Jr."));
});

test('validName rejects html, over-long, empty and non-string input', () => {
    assert.equal(validName('<b>x'), false);
    assert.equal(validName('a'.repeat(21)), false);
    assert.equal(validName('a'.repeat(20)), true);
    assert.equal(validName(''), false);
    assert.equal(validName(42), false);
});

test('validName rejects each of < > " & on its own', () => {
    for (const ch of ['<', '>', '"', '&']) {
        assert.equal(validName(`a${ch}b`), false, ch);
        assert.equal(validName(ch), false, ch);
    }
});

test('validName accepts emoji incl. variation selector, ZWJ sequences and skin tones', () => {
    for (const name of ['Zoë 🙂', '❤️', '👨‍👩‍👧', '👍🏽', 'Ann 🚀']) {
        assert.equal(validName(name), true, name);
    }
});

test('parseBody rejects a 5 KB body with 413', () => {
    const event = { body: JSON.stringify({ x: 'a'.repeat(5000) }) };
    assert.throws(() => parseBody(event), e => e instanceof HttpError && e.status === 413);
});

test('parseBody rejects bad JSON with 400 and parses good JSON', () => {
    assert.throws(() => parseBody({ body: '{nope' }), e => e.status === 400);
    assert.deepEqual(parseBody({ body: '{"a":1}' }), { a: 1 });
    assert.deepEqual(parseBody({}), {});
});

test('parseBody rejects non-object JSON (array, null, scalar)', () => {
    for (const body of ['[]', '[1]', 'null', '5', '"x"']) {
        assert.throws(() => parseBody({ body }), e => e instanceof HttpError && e.status === 400, body);
    }
});

test('parseBody decodes a base64-encoded body and still enforces the size limit', () => {
    const body = Buffer.from('{"a":"é"}', 'utf8').toString('base64');
    assert.deepEqual(parseBody({ body, isBase64Encoded: true }), { a: 'é' });
    const big = Buffer.from(JSON.stringify({ x: 'a'.repeat(5000) })).toString('base64');
    assert.throws(() => parseBody({ body: big, isBase64Encoded: true }), e => e.status === 413);
});

test('requireAdmin rejects wrong or missing key, accepts right key', () => {
    const env = { ADMIN_KEY: 'secret-key' };
    assert.throws(() => requireAdmin({ headers: { 'x-admin-key': 'wrong' } }, env), e => e.status === 401);
    assert.throws(() => requireAdmin({ headers: {} }, env), e => e.status === 401);
    assert.throws(() => requireAdmin({ headers: { 'x-admin-key': 'secret-key' } }, {}), e => e.status === 401);
    assert.doesNotThrow(() => requireAdmin({ headers: { 'X-Admin-Key': 'secret-key' } }, env));
});

test('requireAdmin rejects unequal-length keys with 401, not a crash', () => {
    const env = { ADMIN_KEY: 'secret-key' };
    for (const given of ['secret', 'secret-key-and-more']) {
        assert.throws(() => requireAdmin({ headers: { 'x-admin-key': given } }, env), e => e instanceof HttpError && e.status === 401);
    }
});

test('json builds a response', () => {
    const r = json(200, { a: 1 });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body, '{"a":1}');
});
