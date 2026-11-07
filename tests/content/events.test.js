import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadJson, loadIndustries } from '../helpers/loadData.js';
import { assertLengths } from '../helpers/copy.js';

const POOLS = ['business', 'conference'];
const EFFECT_KEYS = ['cashPct', 'mood', 'varianceMult', 'notionalMult'];
const CONFERENCE_IDS = ['keynote_overran', 'lanyard_mixup', 'coffee_queue', 'cfo_at_the_bar', 'phone_at_3pct'];
const POWER_UP_IDS = ['forecasting', 'visibility', 'options'];
// The synthetic SOFR/SONIA floating-debt exposures are being removed from tech, energy and retail, so events
// must not depend on them even while industries.json in this tree still lists them.
const DROPPED_UNDERLYINGS = ['SOFR', 'SONIA'];

function simpleEvents() {
    return loadJson('data/simple-events.json').events;
}

function validExposureIds() {
    const ids = new Set();
    for (const industry of loadIndustries()) {
        for (const e of industry.exposures) {
            if (!DROPPED_UNDERLYINGS.includes(e.underlying)) ids.add(e.id);
        }
    }
    return ids;
}

function inRange(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

test('simple-events.json has at least 16 events with unique ids', () => {
    const events = simpleEvents();
    assert.ok(Array.isArray(events), 'events is an array');
    assert.ok(events.length >= 16, `${events.length} events, needs >= 16`);
    const ids = events.map(e => e.id);
    assert.equal(new Set(ids).size, ids.length, 'event ids are unique');
});

test('simple-events.json has the conference pool, including the five stand classics', () => {
    const events = simpleEvents();
    const conference = events.filter(e => e.pool === 'conference');
    assert.ok(conference.length >= 5, `${conference.length} conference events, needs >= 5`);
    const confIds = conference.map(e => e.id);
    for (const id of CONFERENCE_IDS) assert.ok(confIds.includes(id), `conference event ${id} exists`);
});

test('every simple event matches the SimpleEvent schema', () => {
    for (const e of simpleEvents()) {
        assert.equal(typeof e.id, 'string', 'id is a string');
        assert.ok(POOLS.includes(e.pool), `${e.id} pool is business or conference`);
        assert.ok(typeof e.weight === 'number' && e.weight > 0, `${e.id} weight is a positive number`);
        assert.equal(typeof e.title, 'string', `${e.id} title`);
        assert.equal(typeof e.text, 'string', `${e.id} text`);
        assert.ok(Array.isArray(e.choices) && e.choices.length === 2, `${e.id} has exactly 2 choices`);
        assert.notEqual(e.choices[0].id, e.choices[1].id, `${e.id} choice ids differ`);
        for (const c of e.choices) {
            const where = `${e.id}.${c.id}`;
            assert.equal(typeof c.id, 'string', `${where} id`);
            assert.equal(typeof c.label, 'string', `${where} label`);
            assert.equal(typeof c.quip, 'string', `${where} quip`);
            assert.ok(c.effects && typeof c.effects === 'object', `${where} has effects`);
            const keys = Object.keys(c.effects);
            assert.ok(keys.length > 0, `${where} changes something`);
            for (const k of keys) assert.ok(EFFECT_KEYS.includes(k), `${where} effect ${k} is known`);
        }
    }
});

test('the two choices of every simple event have different effects', () => {
    for (const e of simpleEvents()) {
        assert.notDeepEqual(e.choices[0].effects, e.choices[1].effects, `${e.id} choices differ in effect`);
    }
});

test('simple event effects stay within the magnitude bounds', () => {
    for (const e of simpleEvents()) {
        for (const c of e.choices) {
            const where = `${e.id}.${c.id}`;
            const { cashPct, mood, varianceMult, notionalMult } = c.effects;
            if (cashPct !== undefined) assert.ok(inRange(cashPct, -0.05, 0.05), `${where} cashPct ${cashPct}`);
            if (mood !== undefined) assert.ok(inRange(mood, -10, 10), `${where} mood ${mood}`);
            if (varianceMult !== undefined) {
                assert.ok(inRange(varianceMult, 0.5, 2), `${where} varianceMult ${varianceMult}`);
            }
            if (notionalMult !== undefined) {
                assert.ok(Object.keys(notionalMult).length > 0, `${where} notionalMult is not empty`);
                for (const [k, v] of Object.entries(notionalMult)) {
                    assert.ok(inRange(v, 0.5, 1.5), `${where} notionalMult.${k} ${v}`);
                }
            }
        }
    }
});

test('every notionalMult key is an exposure id that exists in industries.json (no SOFR/SONIA)', () => {
    const valid = validExposureIds();
    const unknown = [];
    for (const e of simpleEvents()) {
        for (const c of e.choices) {
            for (const k of Object.keys(c.effects.notionalMult || {})) {
                if (!valid.has(k)) unknown.push(`${e.id}.${c.id}: ${k}`);
            }
        }
    }
    assert.deepEqual(unknown, []);
});

test('every simple-events.json string (titles, texts, labels, quips) is at most 90 characters', () => {
    assertLengths(loadJson('data/simple-events.json'), 'simple-events.json');
});

test('powerups.json has a card for each power-up with a real-world Hedj line', () => {
    const cards = loadJson('data/powerups.json');
    assert.deepEqual(Object.keys(cards).sort(), [...POWER_UP_IDS].sort());
    for (const id of POWER_UP_IDS) {
        const card = cards[id];
        assert.deepEqual(Object.keys(card).sort(), ['blurb', 'hedjLine', 'name'], `${id} card keys`);
        assert.ok(card.hedjLine.startsWith('In real life, Hedj '), `${id} hedjLine starts "In real life, Hedj "`);
    }
    assertLengths(cards, 'powerups.json');
});

test('Pro fuel_spike and pe_acquisition do not promise choices they do not offer', () => {
    const { events } = loadJson('data/events.json');
    const promise = /\b(decide|decision|choose|whether|adapt|adjust your strategy)\b/i;
    for (const id of ['fuel_spike', 'pe_acquisition']) {
        const e = events.find(x => x.id === id);
        assert.ok(e, `${id} exists`);
        if (e.choices.length >= 2) continue;
        const copy = [e.title, e.description, ...e.choices.flatMap(c => [c.label, c.description])];
        for (const s of copy) assert.doesNotMatch(s, promise, `${id} copy offers no choice: "${s}"`);
    }
});
