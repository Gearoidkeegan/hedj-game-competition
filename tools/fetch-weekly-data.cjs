#!/usr/bin/env node

/**
 * fetch-weekly-data.cjs (v3.2)
 *
 * Weekly closes for the Simple-mode price charts. Chart-only: the engine never reads these files, it keeps
 * using the monthly ones (see tools/fetch-market-data.cjs).
 *
 * Sources (no keys):
 *   - ECB daily reference rates, sampled at each week's last trading day. GBPUSD and USDJPY are derived from
 *     the EUR pairs on each day, as in the monthly file.
 *   - Yahoo Finance, interval 1wk (the bar's close is the week's last close). Same tickers and scaling as the
 *     monthly fetcher, plus COFFEE (KC=F, US cents/lb, the monthly file's unit).
 *
 * Output (one value per week, dated by that week's Friday; null for a week with no data; 5 significant figures):
 *   data/market/fx-weekly.json, data/market/commodities-weekly.json
 *   { "_meta": {...}, "EURUSD": { "start": "1999-01-08", "anchor": "avg", "v": [1.1789, ...] }, ... }
 *
 * "anchor" says what a monthly value (keyed YYYY-MM-01) is, so a chart can pin the weekly line at the right
 * moment: "avg" = the month's average (ECB), "end" = the month's last close (the Yahoo monthly bars). The fetcher
 * measures it against the monthly file rather than assuming it.
 *
 * Each series covers the same months as its monthly series. A series that fails is left out and listed in
 * _meta.failed: the charts then fall back to the monthly data for it. Nothing is invented.
 *
 * Usage: node tools/fetch-weekly-data.cjs
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.resolve(__dirname, '..', 'data', 'market');
const DAY = 864e5;

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------

const iso = ms => new Date(ms).toISOString().slice(0, 10);
const parse = s => Date.parse(`${s}T00:00:00Z`);

// The Friday of the Monday-to-Sunday week holding the date.
function weekFriday(dateStr) {
    const t = parse(dateStr);
    const dow = new Date(t).getUTCDay();          // 0 = Sunday
    const sinceMonday = (dow + 6) % 7;
    return iso(t + (4 - sinceMonday) * DAY);
}

// A Yahoo weekly bar is stamped at midnight New York time on the Monday (04:00 or 05:00 UTC). Adding 12 hours
// lands on that Monday whatever the daylight-saving offset.
function yahooWeekDate(unixSeconds) {
    return iso(unixSeconds * 1000 + 12 * 3600 * 1000);
}

// [[YYYY-MM-DD, value]] (any order) -> Map(Friday -> the value on the week's last trading day), in date order.
function sampleWeekly(daily) {
    const sorted = [...daily].filter(([, v]) => Number.isFinite(v)).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const out = new Map();
    for (const [d, v] of sorted) out.set(weekFriday(d), v);
    return new Map([...out].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

function sig5(x) {
    if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) return null;
    return Number(x.toPrecision(5));
}

// Map(Friday -> value) -> { start, v } covering Fridays in [from, to], one slot per week, edges trimmed.
function toCompact(weekly, from, to) {
    const lo = parse(weekFriday(from)) < parse(from) ? parse(weekFriday(from)) + 7 * DAY : parse(weekFriday(from));
    const hi = parse(to);
    const v = [];
    for (let t = lo; t <= hi; t += 7 * DAY) v.push(sig5(weekly.get(iso(t))));
    let a = 0;
    let b = v.length;
    while (a < b && v[a] === null) a++;
    while (b > a && v[b - 1] === null) b--;
    if (a === b) return null;
    return { start: iso(lo + a * 7 * DAY), v: v.slice(a, b) };
}

// Which weekly reading the monthly file holds for a month: its average ("avg") or its last close ("end").
// Returns the anchor with the smaller median |log error| and that error.
function chooseAnchor(weekly, monthly) {
    const byMonth = new Map();
    for (const [d, v] of weekly) {
        if (!Number.isFinite(v)) continue;
        const m = d.slice(0, 7);
        if (!byMonth.has(m)) byMonth.set(m, []);
        byMonth.get(m).push(v);
    }
    const errs = { avg: [], end: [] };
    for (const [k, mv] of Object.entries(monthly)) {
        const vals = byMonth.get(k.slice(0, 7));
        if (!vals || !(mv > 0)) continue;
        errs.avg.push(Math.abs(Math.log(vals.reduce((a, b) => a + b, 0) / vals.length / mv)));
        errs.end.push(Math.abs(Math.log(vals[vals.length - 1] / mv)));
    }
    const median = a => {
        if (!a.length) return Infinity;
        const s = [...a].sort((x, y) => x - y);
        return s[Math.floor(s.length / 2)];
    };
    const avg = median(errs.avg);
    const end = median(errs.end);
    return end < avg ? { anchor: 'end', err: end } : { anchor: 'avg', err: avg };
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', Accept: 'application/json' },
            timeout: 60000
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                fetchJSON(res.headers.location).then(resolve, reject);
                return;
            }
            let data = '';
            res.on('data', c => { data += c; });
            res.on('end', () => {
                if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
                try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// The ECB API sometimes answers a long daily request with a 504: try again a few times before giving up.
async function fetchRetry(url, tries = 4) {
    for (let i = 1; ; i++) {
        try {
            return await fetchJSON(url);
        } catch (e) {
            if (i >= tries) throw e;
            console.error(`    retry ${i} after: ${e.message.slice(0, 60)}`);
            await sleep(3000 * i);
        }
    }
}

const ECB_CURRENCIES = { EURUSD: 'USD', EURGBP: 'GBP', EURJPY: 'JPY', EURCHF: 'CHF', EURBRL: 'BRL', EURCAD: 'CAD', EURAUD: 'AUD' };

// Same tickers and divisors as fetch-market-data.cjs, plus coffee.
const YAHOO = {
    BRENT: { ticker: 'BZ=F', divisor: 1 },
    NATGAS: { ticker: 'NG=F', divisor: 1 },
    COPPER: { ticker: 'HG=F', divisor: 1 },
    GOLD: { ticker: 'GC=F', divisor: 1 },
    WHEAT: { ticker: 'ZW=F', divisor: 100 },
    CORN: { ticker: 'ZC=F', divisor: 100 },
    DAIRY: { ticker: 'DC=F', divisor: 1 },
    STEEL: { ticker: 'SLX', divisor: 1 },
    COFFEE: { ticker: 'KC=F', divisor: 1 }
};

async function ecbDaily(currency, from, to) {
    const url = `https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A?format=jsondata&startPeriod=${from}&endPeriod=${to}`;
    const data = await fetchRetry(url);
    const series = data.dataSets[0].series;
    const obs = series[Object.keys(series)[0]].observations;
    const time = data.structure.dimensions.observation[0].values;
    const out = new Map();
    for (const [idx, vals] of Object.entries(obs)) {
        const v = vals?.[0];
        if (typeof v === 'number' && Number.isFinite(v)) out.set(time[Number(idx)].id, v);
    }
    return out;
}

async function yahooWeekly({ ticker, divisor }, from, to) {
    const p1 = Math.floor(parse(from) / 1000) - 7 * 86400;
    const p2 = Math.floor(parse(to) / 1000) + 86400;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${p1}&period2=${p2}&interval=1wk`;
    const data = await fetchRetry(url);
    const r = data.chart?.result?.[0];
    if (!r || !r.timestamp) throw new Error('no data');
    const closes = r.indicators?.quote?.[0]?.close || [];
    const daily = r.timestamp.map((s, i) => [yahooWeekDate(s), typeof closes[i] === 'number' ? closes[i] / divisor : NaN]);
    return sampleWeekly(daily);
}

// The monthly series' range: from its first month's first day to its last month's last day.
function monthlyRange(series) {
    const keys = Object.keys(series).sort();
    const last = keys[keys.length - 1];
    const y = Number(last.slice(0, 4));
    const m = Number(last.slice(5, 7));
    return { from: keys[0], to: iso(Date.UTC(y, m, 0)), keys };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function build(name, weekly, monthlySeries, report) {
    const { from, to } = monthlyRange(monthlySeries);
    // Keep the week after the last month too (its close is still inside the month for a month-end anchor).
    const compact = toCompact(weekly, from, iso(parse(to) + 7 * DAY));
    if (!compact) throw new Error('no weekly values in range');
    const { anchor, err } = chooseAnchor(weekly, monthlySeries);
    // Same units as the monthly file, or the chart pinning would be meaningless: refuse a mismatch.
    if (!(err < 0.1)) throw new Error(`does not match the monthly series (median error ${(err * 100).toFixed(1)}%)`);
    report.push({ name, anchor, err, weeks: compact.v.length, nulls: compact.v.filter(x => x === null).length, start: compact.start });
    return { start: compact.start, anchor, v: compact.v };
}

async function main() {
    const read = f => JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, f), 'utf8'));
    const fxMonthly = read('fx-monthly.json');
    const comMonthly = read('commodities-monthly.json');
    const report = [];
    const failed = { fx: [], commodities: [] };

    console.log('ECB daily FX...');
    const daily = {};
    for (const [pair, cur] of Object.entries(ECB_CURRENCIES)) {
        try {
            const { from, to } = monthlyRange(fxMonthly[pair]);
            daily[pair] = await ecbDaily(cur, from, to);
            console.log(`  ${pair}: ${daily[pair].size} days`);
        } catch (e) {
            console.error(`  ${pair} FAILED: ${e.message}`);
        }
        await sleep(500);
    }
    // Crosses from the EUR pairs on the same day.
    const cross = (a, b, f) => {
        if (!daily[a] || !daily[b]) return null;
        const out = new Map();
        for (const [d, x] of daily[a]) { const y = daily[b].get(d); if (y) out.set(d, f(x, y)); }
        return out;
    };
    daily.GBPUSD = cross('EURUSD', 'EURGBP', (usd, gbp) => usd / gbp);
    daily.USDJPY = cross('EURJPY', 'EURUSD', (jpy, usd) => jpy / usd);

    const fxOut = {};
    for (const pair of Object.keys(fxMonthly).filter(k => k !== '_meta')) {
        try {
            if (!daily[pair]) throw new Error('no daily data');
            fxOut[pair] = build(pair, sampleWeekly([...daily[pair]]), fxMonthly[pair], report);
        } catch (e) {
            console.error(`  ${pair} FAILED: ${e.message}`);
            failed.fx.push(pair);
        }
    }

    console.log('Yahoo weekly commodities...');
    const comOut = {};
    for (const name of Object.keys(comMonthly).filter(k => k !== '_meta')) {
        try {
            if (!YAHOO[name]) throw new Error('no Yahoo ticker');
            const { from, to } = monthlyRange(comMonthly[name]);
            const weekly = await yahooWeekly(YAHOO[name], from, iso(parse(to) + 7 * DAY));
            comOut[name] = build(name, weekly, comMonthly[name], report);
            console.log(`  ${name} (${YAHOO[name].ticker}): ${comOut[name].v.length} weeks`);
        } catch (e) {
            console.error(`  ${name} FAILED: ${e.message}`);
            failed.commodities.push(name);
        }
        await sleep(1000);
    }

    const meta = (source, f) => ({
        generated: new Date().toISOString(),
        source,
        note: 'Chart-only weekly closes, dated by the week\'s Friday. The engine uses the monthly files.',
        failed: f
    });
    const fxFile = path.join(OUTPUT_DIR, 'fx-weekly.json');
    const comFile = path.join(OUTPUT_DIR, 'commodities-weekly.json');
    fs.writeFileSync(fxFile, JSON.stringify({ _meta: meta('ECB daily reference rates', failed.fx), ...fxOut }));
    fs.writeFileSync(comFile, JSON.stringify({ _meta: meta('Yahoo Finance 1wk', failed.commodities), ...comOut }));

    console.log('\n=== Summary ===');
    for (const r of report) {
        console.log(`  ${r.name.padEnd(7)} from ${r.start}  ${String(r.weeks).padStart(5)} weeks  ${String(r.nulls).padStart(3)} gaps  anchor ${r.anchor} (median fit ${(r.err * 100).toFixed(2)}%)`);
    }
    console.log(`  failed: ${[...failed.fx, ...failed.commodities].join(', ') || 'none'}`);
    const size = fs.statSync(fxFile).size + fs.statSync(comFile).size;
    console.log(`  fx-weekly.json ${fs.statSync(fxFile).size} B, commodities-weekly.json ${fs.statSync(comFile).size} B, total ${(size / 1024).toFixed(1)} KB`);
}

module.exports = { weekFriday, yahooWeekDate, sampleWeekly, sig5, toCompact, chooseAnchor, monthlyRange };

if (require.main === module) {
    main().catch((e) => {
        console.error('Fatal error:', e);
        process.exit(1);
    });
}
