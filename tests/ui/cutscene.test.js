import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playCutscene, drawCutscene, fitCutscene, CUTSCENES } from '../../js/ui/pixel/Cutscene.js';

const IDS = ['intro', 'bankrupt', 'fired', 'personalBest'];

// A stub 2D context that records every call and fillStyle assignment.
function recordingContext(width = 360, height = 640) {
    const calls = [];
    const ctx = {
        canvas: { width, height },
        calls,
        _fill: '#000000',
        get fillStyle() { return this._fill; },
        set fillStyle(v) { this._fill = v; calls.push(['fillStyle', v]); },
        imageSmoothingEnabled: true,
    };
    for (const name of ['fillRect', 'clearRect', 'drawImage', 'save', 'restore', 'translate']) {
        ctx[name] = (...args) => calls.push([name, ...args]);
    }
    return ctx;
}

const fills = (ctx) => ctx.calls.filter(([name]) => name === 'fillRect').length;

// A fake DOM: a container, a document that makes canvases, and the event
// listeners each one holds (with their capture flag), so tests can tap, press
// keys and check clean-up. fire() returns the event so tests can see whether it
// was consumed.
function withListeners(owner) {
    owner.handlers = [];
    owner.addEventListener = (type, fn, opts) => {
        const capture = opts === true || Boolean(opts?.capture);
        if (!owner.handlers.some((h) => h.type === type && h.fn === fn && h.capture === capture)) owner.handlers.push({ type, fn, capture });
    };
    owner.removeEventListener = (type, fn, opts) => {
        const capture = opts === true || Boolean(opts?.capture);
        owner.handlers = owner.handlers.filter((h) => !(h.type === type && h.fn === fn && h.capture === capture));
    };
    owner.fire = (type, init = {}) => {
        const event = {
            type, ...init, defaultPrevented: false, propagationStopped: false,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() { this.propagationStopped = true; },
        };
        for (const h of owner.handlers.filter((x) => x.type === type)) h.fn(event);
        return event;
    };
    owner.count = () => owner.handlers.length;
    return owner;
}

function fakeDom({ width = 360, height = 640 } = {}) {
    const container = withListeners({
        clientWidth: width, clientHeight: height, children: [],
        appendChild(el) { this.children.push(el); el.parentNode = this; return el; },
        removeChild(el) { this.children = this.children.filter((c) => c !== el); el.parentNode = null; return el; },
    });
    const created = [];
    const document = withListeners({
        hidden: false,
        createElement(tag) {
            assert.equal(tag, 'canvas');
            const canvas = withListeners({ width: 300, height: 150, style: {}, attrs: {}, parentNode: null });
            canvas.setAttribute = (k, v) => { canvas.attrs[k] = v; };
            canvas.ctx = recordingContext();
            canvas.ctx.canvas = canvas;
            canvas.getContext = () => canvas.ctx;
            created.push(canvas);
            return canvas;
        },
    });
    return { container, document, created };
}

// Injected animation frames and timers that the test drives by hand.
function fakeClock() {
    let next = 1;
    const frames = new Map();
    const timers = new Map();
    return {
        frames, timers,
        requestAnimationFrame: (fn) => { const id = next++; frames.set(id, fn); return id; },
        cancelAnimationFrame: (id) => { frames.delete(id); },
        setTimeout: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; },
        clearTimeout: (id) => { timers.delete(id); },
        tick(t) { const [[id, fn]] = frames; frames.delete(id); fn(t); },
    };
}

function envFor(dom, clock, { reduce = false, dpr = 1 } = {}) {
    return {
        document: dom.document,
        matchMedia: (q) => ({ matches: reduce && q === '(prefers-reduced-motion: reduce)' }),
        requestAnimationFrame: clock.requestAnimationFrame,
        cancelAnimationFrame: clock.cancelAnimationFrame,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        devicePixelRatio: dpr,
    };
}

// Resolves to 'resolved' if the promise has settled by the next macrotask, else 'pending'.
const settled = (p) => Promise.race([p.then(() => 'resolved'), new Promise((r) => setImmediate(() => r('pending')))]);

test('resolves at once when prefers-reduced-motion matches, without drawing', async (t) => {
    const saved = globalThis.matchMedia;
    globalThis.matchMedia = (q) => ({ matches: q === '(prefers-reduced-motion: reduce)' });
    t.after(() => { if (saved === undefined) delete globalThis.matchMedia; else globalThis.matchMedia = saved; });
    const dom = fakeDom();
    const clock = fakeClock();
    const env = envFor(dom, clock);
    delete env.matchMedia; // use the global stub, as a browser would
    const p = playCutscene(dom.container, 'intro', { industryId: 'airline' }, env);
    assert.equal(await settled(p), 'resolved');
    assert.equal(dom.created.length, 0);
    assert.equal(dom.container.children.length, 0);
    assert.equal(clock.frames.size, 0);
});

test('an unknown id resolves immediately without throwing', async () => {
    const dom = fakeDom();
    const clock = fakeClock();
    const p = playCutscene(dom.container, 'no-such-scene', {}, envFor(dom, clock));
    assert.equal(await settled(p), 'resolved');
    assert.equal(dom.created.length, 0);
});

for (const [how, skip] of [
    ['a tap', (dom) => dom.created[0].fire('click')],
    ['a key press', (dom) => dom.document.fire('keydown', { key: 'Enter' })],
]) {
    test(`${how} skips the cutscene, then its canvas, listeners, frame and timer are gone`, async () => {
        const dom = fakeDom();
        const clock = fakeClock();
        const p = playCutscene(dom.container, 'personalBest', { industryId: 'retail' }, envFor(dom, clock));
        assert.equal(dom.container.children.length, 1, 'canvas added');
        const canvas = dom.created[0];
        assert.equal(canvas.count(), 1, 'tap listener on the canvas');
        assert.deepEqual(dom.document.handlers.map((h) => [h.type, h.capture]), [['keydown', true]], 'key listener in the capture phase');
        clock.tick(1000);
        clock.tick(1400);
        assert.ok(fills(canvas.ctx) > 50, 'frames are drawn');
        assert.equal(await settled(p), 'pending');

        skip(dom);
        assert.equal(await settled(p), 'resolved');
        assert.equal(dom.container.children.length, 0, 'canvas removed');
        assert.equal(canvas.parentNode, null);
        assert.equal(canvas.count() + dom.container.count(), 0, 'tap listener removed');
        assert.equal(dom.document.handlers.filter((h) => h.type === 'keydown').length, 0, 'key listener removed');
        assert.equal(clock.frames.size, 0, 'no frame left scheduled');
        dom.document.fire('keyup', { key: 'Enter' }); // ends the one-shot keyup swallow, if any
        assert.equal(dom.document.count(), 0, 'no document listeners left');
        assert.equal(clock.timers.size, 0, 'timers cleared');
        skip(dom); // a second tap or key after the end is harmless
    });
}

test('the skipping tap and key are consumed, and so is the matching keyup, once', async () => {
    let dom = fakeDom();
    let clock = fakeClock();
    let p = playCutscene(dom.container, 'fired', {}, envFor(dom, clock));
    const tap = dom.created[0].fire('click');
    assert.equal(await settled(p), 'resolved');
    assert.ok(tap.defaultPrevented && tap.propagationStopped, 'tap consumed');
    assert.equal(dom.created[0].style.pointerEvents, 'auto');

    dom = fakeDom();
    clock = fakeClock();
    p = playCutscene(dom.container, 'fired', {}, envFor(dom, clock));
    const down = dom.document.fire('keydown', { key: ' ' });
    assert.equal(await settled(p), 'resolved');
    assert.ok(down.defaultPrevented && down.propagationStopped, 'keydown consumed');
    const up = dom.document.fire('keyup', { key: ' ' });
    assert.ok(up.defaultPrevented && up.propagationStopped, 'its keyup consumed');
    const later = dom.document.fire('keyup', { key: ' ' });
    assert.ok(!later.defaultPrevented && !later.propagationStopped, 'only once');
    assert.equal(dom.document.count(), 0);
    assert.equal(clock.timers.size, 0);

    // If the keyup never comes, a timer drops the swallow.
    dom = fakeDom();
    clock = fakeClock();
    playCutscene(dom.container, 'fired', {}, envFor(dom, clock));
    dom.document.fire('keydown', { key: 'Enter' });
    assert.equal(clock.timers.size, 1);
    const [[, drop]] = clock.timers;
    drop.fn();
    assert.equal(dom.document.count(), 0);
});

test('Tab, modifier keys, auto-repeat and IME composition do not skip', async () => {
    const dom = fakeDom();
    const clock = fakeClock();
    const p = playCutscene(dom.container, 'bankrupt', {}, envFor(dom, clock));
    for (const init of [{ key: 'Tab' }, { key: 'Shift' }, { key: 'Control' }, { key: 'Alt' }, { key: 'Meta' },
        { key: 'Enter', repeat: true }, { key: 'a', isComposing: true }]) {
        const e = dom.document.fire('keydown', init);
        assert.ok(!e.defaultPrevented && !e.propagationStopped, JSON.stringify(init));
    }
    assert.equal(await settled(p), 'pending');
    assert.equal(dom.container.children.length, 1);
    dom.document.fire('keydown', { key: 'Escape' });
    assert.equal(await settled(p), 'resolved');
});

test('never rejects: a throwing render or a throwing DOM resolves and leaves nothing behind', async () => {
    // Drawing throws on the first frame.
    let dom = fakeDom();
    let clock = fakeClock();
    const make = dom.document.createElement;
    dom.document.createElement = (tag) => {
        const c = make(tag);
        c.ctx.fillRect = () => { throw new Error('boom'); };
        return c;
    };
    let p = playCutscene(dom.container, 'intro', {}, envFor(dom, clock));
    assert.equal(await settled(p), 'resolved');
    assert.equal(dom.container.children.length, 0);
    assert.equal(dom.document.count() + dom.created[0].count(), 0);
    assert.equal(clock.frames.size + clock.timers.size, 0);

    // appendChild throws inside the promise executor.
    dom = fakeDom();
    clock = fakeClock();
    dom.container.appendChild = () => { throw new Error('detached'); };
    p = playCutscene(dom.container, 'personalBest', {}, envFor(dom, clock));
    assert.equal(await settled(p), 'resolved');
    assert.equal(dom.document.count() + dom.container.count() + dom.created[0].count(), 0);
    assert.equal(clock.frames.size + clock.timers.size, 0);

    // A later frame throws.
    dom = fakeDom();
    clock = fakeClock();
    p = playCutscene(dom.container, 'fired', {}, envFor(dom, clock));
    dom.created[0].ctx.fillRect = () => { throw new Error('lost context'); };
    clock.tick(100);
    assert.equal(await settled(p), 'resolved');
    assert.equal(clock.frames.size, 0);
    assert.equal(dom.container.children.length, 0);
});

test('one cutscene per container: a second call ends the first, then plays', async () => {
    const dom = fakeDom();
    const clock = fakeClock();
    const first = playCutscene(dom.container, 'intro', { industryId: 'tech' }, envFor(dom, clock));
    const second = playCutscene(dom.container, 'personalBest', {}, envFor(dom, clock));
    assert.equal(await settled(first), 'resolved');
    assert.equal(await settled(second), 'pending');
    assert.deepEqual(dom.container.children, [dom.created[1]]);
    assert.equal(dom.document.handlers.filter((h) => h.type === 'keydown').length, 1);
    dom.created[1].fire('click');
    assert.equal(await settled(second), 'resolved');
    assert.equal(dom.container.children.length, 0);
});

test('each cutscene lasts 2-4 s, plays to the end and resolves; the backstop timer also ends it', async () => {
    assert.deepEqual(Object.keys(CUTSCENES).sort(), [...IDS].sort());
    for (const id of IDS) {
        const ms = CUTSCENES[id].duration;
        assert.ok(ms >= 2000 && ms <= 4000, `${id} lasts ${ms} ms`);

        const dom = fakeDom();
        const clock = fakeClock();
        const p = playCutscene(dom.container, id, { industryId: 'energy' }, envFor(dom, clock));
        for (let t = 500; t <= 500 + ms - 100; t += 400) clock.tick(t);
        assert.equal(await settled(p), 'pending', `${id} still playing before its duration`);
        clock.tick(500 + ms + 1);
        assert.equal(await settled(p), 'resolved', `${id} ends after its duration`);
        assert.equal(dom.container.children.length, 0);
        assert.equal(clock.timers.size, 0);

        // With frames throttled (a hidden tab), the timer still resolves it.
        const dom2 = fakeDom();
        const clock2 = fakeClock();
        const p2 = playCutscene(dom2.container, id, {}, envFor(dom2, clock2));
        const [[, timer]] = clock2.timers;
        assert.ok(timer.ms > ms && timer.ms <= ms + 2000);
        timer.fn();
        assert.equal(await settled(p2), 'resolved');
        assert.equal(dom2.container.children.length, 0);
        assert.equal(clock2.frames.size, 0);
    }
});

test('every frame of every cutscene draws, deterministically, without Math.random', (t) => {
    const saved = Math.random;
    Math.random = () => { throw new Error('cosmetic randomness must be deterministic'); };
    t.after(() => { Math.random = saved; });
    for (const id of IDS) {
        for (const [w, h] of [[360, 640], [720, 400], [1280, 360], [360, 120]]) {
            for (const tMs of [0, 400, 1100, 1700, 2500, CUTSCENES[id].duration]) {
                const a = recordingContext(w, h);
                const b = recordingContext(w, h);
                drawCutscene(a, id, { industryId: 'agrifoods' }, tMs, 1);
                drawCutscene(b, id, { industryId: 'agrifoods' }, tMs, 1);
                // Frame 0 may be just the backdrop (the intro logo is still above the top).
                assert.ok(fills(a) > (tMs === 0 ? 0 : 20), `${id} ${w}x${h} @${tMs}`);
                assert.deepEqual(a.calls, b.calls);
            }
        }
    }
});

test('the sequences move: early and late frames differ', () => {
    for (const id of IDS) {
        const early = recordingContext();
        const late = recordingContext();
        drawCutscene(early, id, { industryId: 'pharma' }, 200, 1);
        drawCutscene(late, id, { industryId: 'pharma' }, CUTSCENES[id].duration - 300, 1);
        assert.notDeepEqual(early.calls, late.calls, id);
    }
});

test('pixel text is at least 12 CSS px tall on phones: a 7-row glyph x scale', () => {
    for (const dpr of [1, 2, 3]) {
        for (const cssW of [320, 360, 414, 768]) {
            for (const cssH of [100, 160, 240, 640, 900]) {
                const { scale } = fitCutscene(cssW * dpr, cssH * dpr, dpr);
                assert.ok((7 * scale) / dpr >= 12, `${cssW}x${cssH}@${dpr}: ${(7 * scale) / dpr}px`);
            }
        }
    }
});

test('the canvas is sized from the container at dpr 2 and stays stable; a zero-height container gets a height', async () => {
    const dom = fakeDom({ width: 360, height: 640 });
    const clock = fakeClock();
    playCutscene(dom.container, 'fired', {}, envFor(dom, clock, { dpr: 2 }));
    const canvas = dom.created[0];
    assert.equal(canvas.style.width, '100%');
    for (let i = 0; i < 6; i++) {
        clock.tick(100 + i * 40);
        assert.deepEqual([canvas.width, canvas.height], [720, 1280]);
    }
    dom.container.clientWidth = 400;
    dom.container.clientHeight = 300;
    clock.tick(400);
    clock.tick(440);
    assert.deepEqual([canvas.width, canvas.height], [800, 600]);
    canvas.fire('click');

    const flat = fakeDom({ width: 360, height: 0 });
    const clock2 = fakeClock();
    playCutscene(flat.container, 'bankrupt', {}, envFor(flat, clock2, { dpr: 2 }));
    const c2 = flat.created[0];
    assert.match(c2.style.height, /^\d+px$/);
    assert.ok(c2.width === 720 && c2.height > 0, `${c2.width}x${c2.height}`);
    c2.fire('click');
});
