// v3.2 weekly market data: chart-only. The fetcher's pure helpers, the compact decode, the lazy loader, the size
// budget and the rule that the engine never reads weekly data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fetcher from '../../tools/fetch-weekly-data.cjs';
import { decodeWeekly, MarketEngineController } from '../../js/engine/MarketEngine.js';
import { loadJson, loadMarketData } from '../helpers/loadData.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { weekFriday, sampleWeekly, toCompact, sig5, chooseAnchor, yahooWeekDate } = fetcher;

// ── Fetcher helpers ─────────────────────────────────────────────────────────

test('weekFriday: every day of a Monday-to-Sunday week maps to that week\'s Friday', () => {
    // 2024-12-02 is a Monday.
    for (const d of ['2024-12-02', '2024-12-04', '2024-12-06', '2024-12-07', '2024-12-08']) {
        assert.equal(weekFriday(d), '2024-12-06', d);
    }
    assert.equal(weekFriday('2024-12-09'), '2024-12-13');
    assert.equal(weekFriday('2000-02-29'), '2000-03-03');
});

test('yahooWeekDate: a weekly bar stamped at midnight New York (either side of DST) is that Monday', () => {
    assert.equal(yahooWeekDate(Date.UTC(2024, 6, 29, 4) / 1000), '2024-07-29');   // EDT
    assert.equal(yahooWeekDate(Date.UTC(2024, 11, 30, 5) / 1000), '2024-12-30');  // EST
});

test('sampleWeekly keeps each week\'s last trading day', () => {
    const daily = [['2024-12-02', 1], ['2024-12-05', 2], ['2024-12-09', 3], ['2024-12-13', 4], ['2024-12-12', 9]];
    const w = sampleWeekly(daily);
    assert.deepEqual([...w.entries()], [['2024-12-06', 2], ['2024-12-13', 4]]);
});

test('sig5 rounds to 5 significant figures and keeps non-finite values out', () => {
    assert.equal(sig5(1.0478753), 1.0479);
    assert.equal(sig5(161.08354), 161.08);
    assert.equal(sig5(0.00012345678), 0.00012346);
    assert.equal(sig5(NaN), null);
    assert.equal(sig5(null), null);
    assert.equal(sig5(-1), null, 'prices are positive');
});

test('toCompact: one value per week from the first Friday, null for a missing week, edges trimmed', () => {
    const w = new Map([['2024-11-29', 5], ['2024-12-06', 1.234567], ['2024-12-20', 3], ['2025-01-10', 7]]);
    const c = toCompact(w, '2024-12-01', '2024-12-31');
    assert.deepEqual(c, { start: '2024-12-06', v: [1.2346, null, 3] });
    assert.equal(toCompact(new Map(), '2024-12-01', '2024-12-31'), null);
});

test('chooseAnchor picks the month average or the month-end close, whichever the monthly file matches', () => {
    // Weekly values rise through each month; the monthly file holds the month-end close.
    const weekly = new Map();
    const monthly = {};
    let x = 100;
    for (const m of ['01', '02', '03', '04', '05', '06']) {
        for (const d of ['05', '12', '19', '26']) weekly.set(`2024-${m}-${d}`, (x += 1));
        monthly[`2024-${m}-01`] = x;
    }
    const end = chooseAnchor(weekly, monthly);
    assert.equal(end.anchor, 'end');
    assert.ok(end.err < 1e-9);
    const avg = {};
    for (const m of ['01', '02', '03', '04', '05', '06']) {
        const vals = [...weekly].filter(([d]) => d.slice(5, 7) === m).map(([, v]) => v);
        avg[`2024-${m}-01`] = vals.reduce((a, b) => a + b) / vals.length;
    }
    assert.equal(chooseAnchor(weekly, avg).anchor, 'avg');
});

// ── Decode and loader ───────────────────────────────────────────────────────

test('decodeWeekly: gaps decode to null, never NaN; bad entries give null', () => {
    const d = decodeWeekly({ start: '2024-12-06', anchor: 'end', v: [1.5, null, 'x', -2, 3, NaN] });
    assert.equal(d.t0, Date.UTC(2024, 11, 6));
    assert.equal(d.anchor, 'end');
    assert.deepEqual(d.v, [1.5, null, null, null, 3, null]);
    assert.equal(decodeWeekly({ start: '2024-12-06', v: [1] }).anchor, 'avg', 'default anchor');
    for (const bad of [null, undefined, 3, {}, { start: 'nope', v: [1] }, { start: '2024-12-06' }, { start: '2024-12-06', v: [] }]) {
        assert.equal(decodeWeekly(bad), null, JSON.stringify(bad));
    }
});

function engineWithMonthly() {
    const e = new MarketEngineController();
    e.loadFromObjects(loadMarketData());
    return e;
}

test('loader: weekly data is optional; getWeekly is null until loaded, JETNWE follows BRENT', () => {
    const e = engineWithMonthly();
    assert.equal(e.getWeekly('EURUSD'), null);
    e.loadWeeklyFromObjects({
        fx: { _meta: {}, EURUSD: { start: '2024-12-06', v: [1.05, null, 1.04] } },
        commodities: { BRENT: { start: '2024-12-06', anchor: 'end', v: [70, 71] }, BAD: { v: 3 } }
    });
    assert.deepEqual(e.getWeekly('EURUSD').v, [1.05, null, 1.04]);
    assert.equal(e.getWeekly('BRENT').anchor, 'end');
    assert.equal(e.getWeekly('JETNWE').anchor, 'end');
    assert.ok(Math.abs(e.getWeekly('JETNWE').v[1] / e.getWeekly('BRENT').v[1] - 1.8 * 7.4) < 1e-9);
    assert.equal(e.getWeekly('BAD'), null);
    assert.equal(e.getWeekly('EURIBOR'), null, 'rates stay monthly');
    assert.equal(e.getWeekly('_meta'), null);
});

test('loadWeekly fetches both files once, never rejects, and a failure leaves the charts on monthly', async () => {
    const e = engineWithMonthly();
    const urls = [];
    const okFetch = async (url) => {
        urls.push(url);
        const body = url.endsWith('fx-weekly.json')
            ? { EURUSD: { start: '2024-12-06', v: [1, 2] } }
            : { GOLD: { start: '2024-12-06', anchor: 'end', v: [3, 4] } };
        return { ok: true, json: async () => body };
    };
    const p1 = e.loadWeekly('data/market', okFetch);
    const p2 = e.loadWeekly('data/market', okFetch);
    assert.equal(p1, p2, 'one load in flight');
    await p1;
    assert.deepEqual(urls.sort(), ['data/market/commodities-weekly.json', 'data/market/fx-weekly.json']);
    assert.deepEqual(e.getWeekly('GOLD').v, [3, 4]);
    await e.loadWeekly('data/market', okFetch);
    assert.equal(urls.length, 2, 'already loaded: no refetch');

    const warn = console.warn;
    const warnings = [];
    console.warn = (...a) => warnings.push(a);   // the expected failures below log a warning
    try {
        const f = engineWithMonthly();
        await assert.doesNotReject(f.loadWeekly('data/market', async () => { throw new Error('offline'); }));
        assert.equal(f.getWeekly('EURUSD'), null);
        const g = engineWithMonthly();
        await g.loadWeekly('data/market', async () => ({ ok: false, json: async () => ({}) }));
        assert.equal(g.getWeekly('EURUSD'), null);
    } finally {
        console.warn = warn;
    }
    assert.equal(warnings.length, 2);
});

test('the engine never reads weekly data: rates are identical with absurd weekly values loaded', () => {
    const plain = engineWithMonthly();
    const withWeekly = engineWithMonthly();
    const absurd = {};
    for (const k of ['EURUSD', 'EURGBP', 'GBPUSD', 'BRENT', 'GOLD', 'COFFEE']) absurd[k] = { start: '1999-01-01', v: Array(2000).fill(999999) };
    withWeekly.loadWeeklyFromObjects({ fx: absurd, commodities: absurd });
    for (const u of ['EURUSD', 'GBPUSD', 'BRENT', 'JETNWE', 'GOLD', 'COFFEE', 'EURIBOR']) {
        for (const [y, q] of [[2008, 3], [2015, 1], [2020, 2]]) {
            assert.equal(withWeekly.getRate(u, y, q), plain.getRate(u, y, q), `${u} ${y}Q${q}`);
        }
        assert.equal(withWeekly.getDataset(u), withWeekly.getDataset(u));
        assert.deepEqual(withWeekly.getDataset(u), plain.getDataset(u));
    }
});

// ── The data files ──────────────────────────────────────────────────────────

const FX = ['EURUSD', 'EURGBP', 'EURJPY', 'EURCHF', 'EURBRL', 'EURCAD', 'EURAUD', 'GBPUSD', 'USDJPY'];
const COMMODITIES = ['BRENT', 'NATGAS', 'COPPER', 'GOLD', 'WHEAT', 'CORN', 'DAIRY', 'STEEL', 'COFFEE'];
const fxFile = join(ROOT, 'data/market/fx-weekly.json');
const comFile = join(ROOT, 'data/market/commodities-weekly.json');

test('size budget: both weekly files together are at most 300 KB raw', () => {
    assert.ok(existsSync(fxFile) && existsSync(comFile), 'weekly files present');
    const total = statSync(fxFile).size + statSync(comFile).size;
    assert.ok(total <= 300 * 1024, `${total} bytes`);
});

test('weekly files: compact series for the monthly underlyings, 5 significant figures, near the monthly levels', () => {
    const fx = loadJson('data/market/fx-weekly.json');
    const com = loadJson('data/market/commodities-weekly.json');
    const monthly = loadMarketData();
    const failed = [...(fx._meta?.failed || []), ...(com._meta?.failed || [])];
    for (const [file, names, group] of [[fx, FX, monthly.fx], [com, COMMODITIES, monthly.commodities]]) {
        for (const name of names) {
            if (failed.includes(name)) { assert.equal(file[name], undefined); continue; }
            const s = file[name];
            assert.ok(s, `${name} present or listed as failed`);
            const d = decodeWeekly(s);
            assert.ok(d, `${name} decodes`);
            assert.ok(['avg', 'end'].includes(d.anchor));
            assert.ok(d.v.filter(x => x !== null).length > 100, `${name} has data`);
            for (const x of s.v) if (x !== null) assert.ok(String(x).replace(/^0\.0*|\./g, '').replace(/^-/, '').length <= 5, `${name} ${x}`);
            // Same units as the monthly file (a units check, so a x100 slip fails): the median ratio of the
            // mid-month weekly value to the monthly value is close to 1.
            const first = d.t0;
            const ratios = [];
            for (const k of Object.keys(group[name]).filter(key => Date.parse(key) >= first)) {
                const w = d.v[Math.round((Date.parse(k) + 14 * 864e5 - first) / (7 * 864e5))];
                if (w) ratios.push(w / group[name][k]);
            }
            ratios.sort((a, b) => a - b);
            const med = ratios[Math.floor(ratios.length / 2)];
            assert.ok(ratios.length > 100 && med > 0.9 && med < 1.1, `${name} median ratio ${med}`);
        }
    }
});
