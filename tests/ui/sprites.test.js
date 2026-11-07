import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJson, loadIndustries } from '../helpers/loadData.js';
import { drawSprite, spriteIdForMember, CHAIRMAN_SPRITES } from '../../js/ui/pixel/sprites.js';

const EXPRESSIONS = ['neutral', 'happy', 'angry'];
const ARCHETYPES = ['aggressive', 'cautious', 'operational'];

// A stub 2D context that records every call and fillStyle assignment.
function recordingContext(width = 128, height = 128) {
    const calls = [];
    const ctx = {
        canvas: { width, height },
        calls,
        _fill: '#000000',
        get fillStyle() { return this._fill; },
        set fillStyle(v) { this._fill = v; calls.push(['fillStyle', v]); },
    };
    for (const name of ['fillRect', 'clearRect', 'drawImage', 'save', 'restore']) {
        ctx[name] = (...args) => calls.push([name, ...args]);
    }
    return ctx;
}

const rects = (ctx) => ctx.calls.filter(([name]) => name === 'fillRect');

function draw(id, expression, x = 0, y = 0, scale = 4) {
    const ctx = recordingContext();
    drawSprite(ctx, id, expression, x, y, scale);
    return ctx;
}

// Every member sprite id the gallery and the boards can produce: each archetype
// at several indices and names, plus the real board members.
function memberIds() {
    const ids = new Set();
    for (const personality of ARCHETYPES) {
        for (let index = 0; index < 6; index++) {
            for (const name of ['Catherine Walsh', 'Raj Patel', 'Thomas Müller', '']) {
                ids.add(spriteIdForMember({ personality, name }, index));
            }
        }
    }
    for (const industry of loadIndustries()) {
        industry.boardMembers.forEach((m, i) => ids.add(spriteIdForMember(m, i)));
    }
    return [...ids];
}

test('CHAIRMAN_SPRITES has exactly the ceoPersonas ids from board-dialogue.json', () => {
    const personas = Object.keys(loadJson('data/board-dialogue.json').ceoPersonas);
    assert.deepEqual(Object.keys(CHAIRMAN_SPRITES), ['jameson', 'musk', 'oleary', 'dimon', 'buffett', 'jobs', 'dorsey', 'ackman']);
    assert.deepEqual(Object.keys(CHAIRMAN_SPRITES).sort(), personas.sort());
    const props = Object.values(CHAIRMAN_SPRITES).map((c) => c.prop);
    assert.equal(new Set(props).size, props.length, 'each chairman has their own signature prop');
});

test('every archetype and chairman draws all 3 expressions without throwing, inside its 32x32 box', () => {
    const ids = [...memberIds(), ...ARCHETYPES, ...Object.keys(CHAIRMAN_SPRITES)];
    const [x, y, scale] = [10, 6, 3];
    for (const id of ids) {
        for (const expression of EXPRESSIONS) {
            const ctx = draw(id, expression, x, y, scale);
            const r = rects(ctx);
            assert.ok(r.length >= 20, `${id}/${expression} drew only ${r.length} rects`);
            for (const [, rx, ry, rw, rh] of r) {
                assert.ok(rx >= x && ry >= y && rx + rw <= x + 32 * scale && ry + rh <= y + 32 * scale,
                    `${id}/${expression} drew outside its box`);
            }
        }
    }
});

test('happy and angry draw differently from each other and from neutral, for every sprite', () => {
    const ids = [...memberIds(), ...Object.keys(CHAIRMAN_SPRITES)];
    for (const id of ids) {
        const [neutral, happy, angry] = EXPRESSIONS.map((e) => JSON.stringify(draw(id, e).calls));
        assert.notEqual(happy, angry, `${id}: happy and angry are identical`);
        assert.notEqual(happy, neutral, `${id}: happy and neutral are identical`);
        assert.notEqual(angry, neutral, `${id}: angry and neutral are identical`);
    }
});

test('drawing is deterministic and never uses Math.random', (t) => {
    const saved = Math.random;
    Math.random = () => { throw new Error('Math.random used'); };
    t.after(() => { Math.random = saved; });
    for (const id of [...memberIds(), ...Object.keys(CHAIRMAN_SPRITES)]) {
        assert.deepEqual(draw(id, 'angry').calls, draw(id, 'angry').calls);
    }
});

test('spriteIdForMember: archetype from personality, deterministic variation by index and name', () => {
    const m = { name: 'Catherine Walsh', personality: 'aggressive' };
    assert.equal(spriteIdForMember(m, 0), spriteIdForMember({ ...m }, 0));
    for (const personality of ARCHETYPES) {
        assert.ok(spriteIdForMember({ name: 'X', personality }, 0).startsWith(personality + '.'));
    }
    const byIndex = new Set([0, 1, 2, 3].map((i) => spriteIdForMember(m, i)));
    assert.equal(byIndex.size, 4, 'different seats look different');
    const byName = new Set(['A', 'B', 'C', 'D', 'E', 'F'].map((name) => spriteIdForMember({ name, personality: 'cautious' }, 0)));
    assert.ok(byName.size >= 4, 'different names look different');
    // a board's three members never share a sprite
    for (const industry of loadIndustries()) {
        const ids = industry.boardMembers.map((mem, i) => spriteIdForMember(mem, i));
        assert.equal(new Set(ids).size, ids.length);
    }
});

test('unknown personality, sprite id or expression and a bad scale fall back without throwing', () => {
    const id = spriteIdForMember({ personality: 'ceo' }, 0);
    assert.equal(typeof id, 'string');
    assert.ok(rects(draw(id, 'neutral')).length > 0);
    assert.ok(rects(draw('no-such-sprite', 'neutral')).length > 0);
    assert.deepEqual(draw('musk', 'confused').calls, draw('musk', 'neutral').calls);
    assert.doesNotThrow(() => drawSprite(recordingContext(), 'musk', 'happy', 0, 0, 0));
    assert.doesNotThrow(() => spriteIdForMember(null, undefined));
});

test('the sprite scales: x4 covers four times the area of x2', () => {
    const area = (ctx) => rects(ctx).reduce((s, [, , , w, h]) => s + w * h, 0);
    assert.equal(area(draw('buffett', 'happy', 0, 0, 4)), 4 * area(draw('buffett', 'happy', 0, 0, 2)));
});
