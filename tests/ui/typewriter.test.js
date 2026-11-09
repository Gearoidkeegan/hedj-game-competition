import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from '../helpers/fakeDom.js';
import { typewrite, MS_PER_CHAR } from '../../js/ui/typewriter.js';

let dom;
beforeEach(() => { dom = installFakeDom(); });
afterEach(() => dom.restore());

// A manual timer set: nothing fires until the test advances the clock.
function fakeTimers() {
    let now = 0;
    let nextId = 1;
    const jobs = new Map();
    return {
        setTimeout: (fn, ms) => { const id = nextId++; jobs.set(id, { fn, at: now + ms, every: null }); return id; },
        setInterval: (fn, ms) => { const id = nextId++; jobs.set(id, { fn, at: now + ms, every: ms }); return id; },
        clearTimeout: id => jobs.delete(id),
        clearInterval: id => jobs.delete(id),
        advance(ms) {
            const end = now + ms;
            for (;;) {
                let pick = null;
                for (const [id, j] of jobs) if (j.at <= end && (!pick || j.at < pick[1].at)) pick = [id, j];
                if (!pick) break;
                const [id, j] = pick;
                now = j.at;
                if (j.every) j.at += j.every; else jobs.delete(id);
                j.fn();
            }
            now = end;
        },
        pending: () => jobs.size
    };
}

function parts() {
    const text = dom.document.createElement('span');
    const cursor = dom.document.createElement('span');
    return { text, cursor };
}

test('typing speed is at most 8 ms per character', () => {
    assert.ok(MS_PER_CHAR <= 8);
    const timers = fakeTimers();
    const { text, cursor } = parts();
    const line = 'Hedging is not optional, treasurer.';
    typewrite({ textEl: text, cursorEl: cursor, text: line, delay: 100, timers });
    timers.advance(100 + MS_PER_CHAR * line.length + 1);
    assert.equal(text.textContent, line);
    assert.equal(cursor.style.display, 'none');
});

test('the text builds up one character at a time', () => {
    const timers = fakeTimers();
    const { text, cursor } = parts();
    typewrite({ textEl: text, cursorEl: cursor, text: 'abcdef', delay: 0, timers });
    timers.advance(MS_PER_CHAR * 3);
    assert.equal(text.textContent, 'abc');
});

test('a tap completes the text at once and stops the timers', () => {
    const timers = fakeTimers();
    const { text, cursor } = parts();
    const t = typewrite({ textEl: text, cursorEl: cursor, text: 'A long board speech', delay: 100, timers });
    timers.advance(150);
    t.complete();
    assert.equal(text.textContent, 'A long board speech');
    assert.equal(cursor.style.display, 'none');
    assert.equal(timers.pending(), 0);
    assert.equal(t.done, true);
});

test('complete() works before the start delay has passed, and cancel() leaves the text alone', () => {
    const timers = fakeTimers();
    const a = parts();
    const t1 = typewrite({ textEl: a.text, cursorEl: a.cursor, text: 'hello', delay: 500, timers });
    t1.complete();
    assert.equal(a.text.textContent, 'hello');
    const b = parts();
    const t2 = typewrite({ textEl: b.text, cursorEl: b.cursor, text: 'hello', delay: 0, timers });
    timers.advance(MS_PER_CHAR * 2);
    t2.cancel();
    timers.advance(1000);
    assert.equal(b.text.textContent, 'he');
    assert.equal(timers.pending(), 0);
});

test('emoji are typed whole, never split into surrogate halves', () => {
    const timers = fakeTimers();
    const { text, cursor } = parts();
    let done = 0;
    typewrite({ textEl: text, cursorEl: cursor, text: 'a😀b', delay: 0, timers, onDone: () => done++ });
    timers.advance(MS_PER_CHAR * 2);
    assert.equal(text.textContent, 'a😀');
    timers.advance(MS_PER_CHAR * 5);
    assert.equal(text.textContent, 'a😀b');
    assert.equal(done, 1);
});

test('onDone fires once, also when a tap completes the text', () => {
    const timers = fakeTimers();
    const { text, cursor } = parts();
    let done = 0;
    const t = typewrite({ textEl: text, cursorEl: cursor, text: 'abc', delay: 0, timers, onDone: () => done++ });
    t.complete(); t.complete();
    timers.advance(100);
    assert.equal(done, 1);
});
