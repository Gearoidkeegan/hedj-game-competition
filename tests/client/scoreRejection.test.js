// R63: a score the server refuses for good (a 4xx other than 401, 408 or 429) is final. It is dropped from the queue
// and the game-over screen says why, instead of "Queued".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFinalRejection, rejectionText, REJECTION_TEXT_MAX } from '../../js/utils/scoreRejection.js';

const err = (status, message = 'nope') => Object.assign(new Error(message), { status });

test('a 4xx other than 401, 408 and 429 is final; network errors, timeouts and 5xx are not', () => {
    for (const s of [400, 403, 404, 409, 413, 422]) assert.equal(isFinalRejection(err(s)), true, String(s));
    for (const s of [401, 408, 429, 500, 502, 503, 0]) assert.equal(isFinalRejection(err(s)), false, String(s));
    assert.equal(isFinalRejection(new TypeError('Failed to fetch')), false);
    assert.equal(isFinalRejection(null), false);
    assert.equal(isFinalRejection(undefined), false);
});

test('the rejection line names the server reason and stays within 90 characters', () => {
    assert.equal(REJECTION_TEXT_MAX, 90);
    assert.equal(rejectionText('Run too short'), 'Score not accepted: run too short');
    assert.equal(rejectionText('Invalid player name'), 'Score not accepted: invalid player name');
    assert.equal(rejectionText(''), 'Score not accepted: the server refused it');
    assert.equal(rejectionText(undefined), 'Score not accepted: the server refused it');
    assert.equal(rejectionText('HTTP 400'), 'Score not accepted: the server refused it');
    const long = rejectionText('x'.repeat(200));
    assert.ok(long.length <= 90, `${long.length}`);
    assert.ok(long.startsWith('Score not accepted: xxx') && long.endsWith('…'));
});
