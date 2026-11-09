import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadIndustries } from '../helpers/loadData.js';
import { drawScene, SceneLoop, sceneNameFor } from '../../js/ui/pixel/Scene.js';
import { PixelCanvas } from '../../js/ui/pixel/PixelCanvas.js';
import { IsometricScene } from '../../js/ui/IsometricScene.js';

const MOODS = ['calm', 'storm', 'boom'];

// A stub 2D context that records every call and fillStyle assignment.
function recordingContext(width = 375, height = 200) {
    const calls = [];
    const ctx = {
        canvas: { width, height },
        calls,
        _fill: '#000000',
        get fillStyle() { return this._fill; },
        set fillStyle(v) { this._fill = v; calls.push(['fillStyle', v]); },
        imageSmoothingEnabled: true,
    };
    for (const name of ['fillRect', 'clearRect', 'drawImage', 'putImageData', 'save', 'restore']) {
        ctx[name] = (...args) => calls.push([name, ...args]);
    }
    return ctx;
}

const drawCalls = (ctx) => ctx.calls.filter(([name]) => name === 'fillRect' || name === 'drawImage');

test('drawScene renders every industry and mood without throwing and issues >= 50 draw calls', () => {
    const industries = loadIndustries();
    assert.equal(industries.length, 7);
    for (const industry of industries) {
        for (const mood of MOODS) {
            const ctx = recordingContext();
            const state = { mood, cashLevel: 0.6, highlight: industry.exposures[0].underlying };
            drawScene(ctx, industry.id, state, 12345);
            const n = drawCalls(ctx).length;
            assert.ok(n >= 50, `${industry.id}/${mood} issued only ${n} draw calls`);
        }
    }
});

test('industry ids map to the scene files named in the brief', () => {
    assert.deepEqual(
        loadIndustries().map((i) => sceneNameFor(i.id)),
        ['airport', 'agrifoods', 'tech', 'pharma', 'construction', 'energy', 'retail']
    );
    // Pro mode passes the legacy industries.json `scene` names; they resolve to the same scenes.
    for (const industry of loadIndustries()) {
        assert.equal(sceneNameFor(industry.scene), sceneNameFor(industry.id));
    }
});

test('drawScene is pure: the same inputs give the same draw calls', () => {
    const state = { mood: 'storm', cashLevel: 0.3, highlight: 'JETNWE' };
    const a = recordingContext();
    const b = recordingContext();
    drawScene(a, 'airline', state, 4321);
    drawScene(b, 'airline', state, 4321);
    assert.deepEqual(a.calls, b.calls);
});

test('the market-linked element reacts: airport planes are grounded in a JETNWE storm', () => {
    const t = 2000;
    const grounded = recordingContext();
    const flying = recordingContext();
    drawScene(grounded, 'airline', { mood: 'storm', cashLevel: 0.5, highlight: 'JETNWE' }, t);
    drawScene(flying, 'airline', { mood: 'storm', cashLevel: 0.5, highlight: 'EURUSD' }, t);
    assert.notDeepEqual(grounded.calls, flying.calls);
});

test('moods draw differently and cashLevel changes the picture', () => {
    const base = { cashLevel: 0.5, highlight: null };
    const pics = MOODS.map((mood) => {
        const ctx = recordingContext();
        drawScene(ctx, 'retail', { ...base, mood }, 1000);
        return JSON.stringify(ctx.calls);
    });
    assert.equal(new Set(pics).size, 3);
    const poor = recordingContext();
    const rich = recordingContext();
    drawScene(poor, 'retail', { ...base, mood: 'calm', cashLevel: 0 }, 1000);
    drawScene(rich, 'retail', { ...base, mood: 'calm', cashLevel: 1 }, 1000);
    assert.notDeepEqual(poor.calls, rich.calls);
});

test('drawScene copes with tiny, wide and portrait canvases and an unknown industry', () => {
    const state = { mood: 'calm', cashLevel: 0.5, highlight: null };
    for (const [w, h] of [[1, 1], [1240, 200], [300, 600], [960, 320]]) {
        const ctx = recordingContext(w, h);
        drawScene(ctx, 'energy', state, 0);
        assert.ok(drawCalls(ctx).length > 0, `${w}x${h}`);
    }
    assert.doesNotThrow(() => drawScene(recordingContext(), 'no-such-industry', state, 0));
});

test('PixelCanvas: rect, pixel and sprite write the buffer; blitTo covers the target', () => {
    const px = new PixelCanvas(4, 3);
    px.rect(0, 0, 4, 3, '#111111');
    px.pixel(1, 1, '#ff0000');
    px.sprite(['ab', '.a'], 2, 1, { a: '#00ff00', b: '#0000ff' });
    assert.equal(px.get(1, 1), '#ff0000');
    assert.equal(px.get(2, 1), '#00ff00');
    assert.equal(px.get(3, 1), '#0000ff');
    assert.equal(px.get(2, 2), '#111111'); // '.' is transparent
    assert.equal(px.get(3, 2), '#00ff00');
    px.rect(-5, -5, 2, 2, '#ffffff'); // fully clipped, no throw
    const ctx = recordingContext(8, 6);
    px.blitTo(ctx, 2);
    const area = drawCalls(ctx).reduce((sum, [, , , w, h]) => sum + w * h, 0);
    assert.equal(area, 8 * 6);
});

test('SceneLoop runs one rAF loop, pauses while the page is hidden and stops cleanly', () => {
    let nextId = 1;
    const pending = new Map();
    const raf = (fn) => { const id = nextId++; pending.set(id, fn); return id; };
    const caf = (id) => pending.delete(id);
    const listeners = {};
    const doc = {
        hidden: false,
        addEventListener: (type, fn) => { listeners[type] = fn; },
        removeEventListener: (type, fn) => { if (listeners[type] === fn) delete listeners[type]; },
    };
    const ctx = recordingContext(200, 100);
    const canvas = { width: 200, height: 100, clientWidth: 0, clientHeight: 0, getContext: () => ctx };
    const states = [];
    const loop = new SceneLoop(canvas, () => {
        const s = { industryId: 'pharma', sceneState: { mood: 'boom', cashLevel: 1, highlight: 'EURCHF' } };
        states.push(s);
        return s;
    }, { requestAnimationFrame: raf, cancelAnimationFrame: caf, document: doc });

    const tick = (t) => { const [[id, fn]] = pending; pending.delete(id); fn(t); };

    loop.start();
    loop.start(); // idempotent: still one loop
    assert.equal(pending.size, 1);
    tick(0);
    assert.equal(states.length, 1);
    assert.equal(pending.size, 1);

    doc.hidden = true;
    listeners.visibilitychange();
    assert.equal(pending.size, 0, 'hidden page cancels the frame');

    doc.hidden = false;
    listeners.visibilitychange();
    assert.equal(pending.size, 1, 'visible page resumes');
    tick(100);
    assert.equal(states.length, 2);

    loop.stop();
    assert.equal(pending.size, 0);
    assert.equal(listeners.visibilitychange, undefined);
});

test('IsometricScene keeps the Pro API: start(sceneType, yearOffset, quarter) draws pixel scenes, stop() ends the loop', (t) => {
    const pending = new Map();
    let nextId = 1;
    globalThis.requestAnimationFrame = (fn) => { const id = nextId++; pending.set(id, fn); return id; };
    globalThis.cancelAnimationFrame = (id) => pending.delete(id);
    t.after(() => { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; });
    const ctx = recordingContext(620, 200);
    const canvas = { width: 620, height: 200, clientWidth: 0, clientHeight: 0, style: {}, getContext: () => ctx };
    const scene = new IsometricScene(canvas);
    scene.start('roastery', 2, 3);
    assert.equal(pending.size, 1);
    const [[id, frame]] = pending;
    pending.delete(id);
    frame(0);
    assert.ok(drawCalls(ctx).length >= 50);
    assert.equal(canvas.style.width, '100%');
    scene.stop();
    assert.equal(pending.size, 0);
});

test('SceneLoop sizes the canvas from its parent at dpr 2 and the size stays stable over many frames', (t) => {
    const savedDpr = globalThis.devicePixelRatio;
    globalThis.devicePixelRatio = 2;
    t.after(() => {
        if (savedDpr === undefined) delete globalThis.devicePixelRatio;
        else globalThis.devicePixelRatio = savedDpr;
    });
    const parent = { clientWidth: 320, clientHeight: 140 };
    const ctx = recordingContext(620, 200);
    // Like a real canvas: unstyled, its CSS size is its width/height attributes;
    // styled 100%, it takes its parent's size.
    const canvas = {
        width: 620, height: 200, style: {}, parentElement: parent,
        get clientWidth() { return this.style.width === '100%' ? parent.clientWidth : this.width; },
        get clientHeight() { return this.style.height === '100%' ? parent.clientHeight : this.height; },
        getContext: () => ctx,
    };
    ctx.canvas = canvas;
    const pending = new Map();
    let nextId = 1;
    const loop = new SceneLoop(canvas, () => ({ industryId: 'retail', sceneState: { mood: 'calm', cashLevel: 0.5, highlight: null } }), {
        requestAnimationFrame: (fn) => { const id = nextId++; pending.set(id, fn); return id; },
        cancelAnimationFrame: (id) => pending.delete(id),
        document: null,
    });
    const tick = (time) => { const [[id, fn]] = pending; pending.delete(id); fn(time); };

    loop.start();
    const sizes = [];
    for (let i = 0; i < 8; i++) {
        tick(i * 40);
        sizes.push([canvas.width, canvas.height]);
    }
    for (const size of sizes) assert.deepEqual(size, [640, 280]);

    // a real resize of the parent is picked up once, then stays put
    parent.clientWidth = 375;
    parent.clientHeight = 120;
    tick(400);
    tick(440);
    assert.deepEqual([canvas.width, canvas.height], [750, 240]);
    loop.stop();
});
