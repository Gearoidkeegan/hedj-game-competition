import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validName, parseBody, requireAdmin, HttpError, json } from '../lib/http.mjs';

test('validName accepts letters, emoji-free unicode and punctuation set', () => {
    assert.ok(validName('Zoë'));
    assert.ok(validName("O'Brien-Smith_Jr."));
});

test('validName accepts the brief example with emoji-less letters; rejects html and long names', () => {
    assert.equal(validName('<b>x'), false);
    assert.equal(validName('a'.repeat(21)), false);
    assert.equal(validName('a'.repeat(20)), true);
    assert.equal(validName(''), false);
    assert.equal(validName(42), false);
});

test('validName and emoji', () => {
    // Brief: accepts 'Zoë 🙂'. The mandated regex /^[\p{L}\p{N} .'_-]{1,20}$/u has no emoji class,
    // so this documents actual behaviour of the verbatim regex.
    assert.equal(validName('Zoë 🙂'), true);
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

test('requireAdmin rejects wrong or missing key, accepts right key', () => {
    const env = { ADMIN_KEY: 'secret-key' };
    assert.throws(() => requireAdmin({ headers: { 'x-admin-key': 'wrong' } }, env), e => e.status === 401);
    assert.throws(() => requireAdmin({ headers: {} }, env), e => e.status === 401);
    assert.throws(() => requireAdmin({ headers: { 'x-admin-key': 'secret-key' } }, {}), e => e.status === 401);
    assert.doesNotThrow(() => requireAdmin({ headers: { 'X-Admin-Key': 'secret-key' } }, env));
});

test('json builds a response', () => {
    const r = json(200, { a: 1 });
    assert.equal(r.statusCode, 200);
    assert.equal(r.body, '{"a":1}');
});
