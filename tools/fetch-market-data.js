#!/usr/bin/env node

/**
 * fetch-market-data.js
 *
 * Fetches historical market data from free APIs and writes static JSON files
 * for the Treasury Manager Simulator game.
 *
 * Sources:
 *   - ECB (no key): FX rates, EURIBOR
 *   - FRED (free key): SOFR, SONIA proxy, Fed Funds
 *   - Yahoo Finance (no key): Commodities
 *
 * Output:
 *   - data/market/fx-monthly.json
 *   - data/market/commodities-monthly.json
 *   - data/market/rates-monthly.json
 *
 * Usage:
 *   node tools/fetch-market-data.js [--fred-key YOUR_KEY]
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const START_DATE = '1994-01-01';
const END_DATE = '2024-12-31';
const OUTPUT_DIR = path.resolve(__dirname, '..', 'data', 'market');

const FRED_KEY = process.argv.includes('--fred-key')
    ? process.argv[process.argv.indexOf('--fred-key') + 1]
    : process.env.FRED_API_KEY || null;

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function fetchJSON(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                ...headers
            },
            timeout: 30000
        };
        const req = mod.get(url, options, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                fetchJSON(res.headers.location, headers).then(resolve).catch(reject);
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 400) {
                    reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
                    return;
                }
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`JSON parse error: ${e.message}\nBody: ${data.slice(0, 200)}`)); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// ECB — FX rates (all quoted vs EUR)
// ---------------------------------------------------------------------------

const ECB_FX_PAIRS = {
    'EURUSD': 'USD',
    'EURGBP': 'GBP',
    'EURJPY': 'JPY',
    'EURCHF': 'CHF',
    'EURBRL': 'BRL',
    'EURCAD': 'CAD',
    'EURAUD': 'AUD',
};

async function fetchECBFXRates() {
    console.log('Fetching ECB FX rates...');
    const results = {};

    for (const [pair, currency] of Object.entries(ECB_FX_PAIRS)) {
        console.log(`  ${pair}...`);
        const url = `https://data-api.ecb.europa.eu/service/data/EXR/M.${currency}.EUR.SP00.A?format=jsondata&startPeriod=${START_DATE.slice(0, 7)}&endPeriod=${END_DATE.slice(0, 7)}`;

        try {
            const data = await fetchJSON(url);
            const series = data.dataSets[0].series;
            const seriesKey = Object.keys(series)[0];
            const observations = series[seriesKey].observations;
            const timeDim = data.structure.dimensions.observation[0].values;

            const monthly = {};
            for (const [idx, vals] of Object.entries(observations)) {
                const dateStr = timeDim[parseInt(idx)].id;
                const date = dateStr.length === 7 ? `${dateStr}-01` : dateStr;
                if (vals[0] !== null && vals[0] !== undefined) {
                    monthly[date] = parseFloat(vals[0].toFixed(6));
                }
            }
            results[pair] = monthly;
        } catch (e) {
            console.error(`  ERROR fetching ${pair}: ${e.message}`);
        }
        await sleep(500);
    }

    // Derive cross rates from EUR pairs
    console.log('  Deriving GBPUSD, USDJPY...');
    const gbpusd = {};
    const usdjpy = {};

    for (const date of Object.keys(results['EURUSD'] || {})) {
        const eurusd = results['EURUSD'][date];
        const eurgbp = results['EURGBP']?.[date];
        const eurjpy = results['EURJPY']?.[date];

        if (eurusd && eurgbp) {
            gbpusd[date] = parseFloat((eurusd / eurgbp).toFixed(6));
        }
        if (eurusd && eurjpy) {
            usdjpy[date] = parseFloat((eurjpy / eurusd).toFixed(4));
        }
    }
    results['GBPUSD'] = gbpusd;
    results['USDJPY'] = usdjpy;

    return results;
}

// ---------------------------------------------------------------------------
// ECB — EURIBOR
// ---------------------------------------------------------------------------

async function fetchECBEuribor() {
    console.log('Fetching ECB EURIBOR...');
    // 3-month EURIBOR
    const url = `https://data-api.ecb.europa.eu/service/data/FM/M.U2.EUR.RT.MM.EURIBOR3MD_.HSTA?format=jsondata&startPeriod=${START_DATE.slice(0, 7)}&endPeriod=${END_DATE.slice(0, 7)}`;

    try {
        const data = await fetchJSON(url);
        const series = data.dataSets[0].series;
        const seriesKey = Object.keys(series)[0];
        const observations = series[seriesKey].observations;
        const timeDim = data.structure.dimensions.observation[0].values;

        const monthly = {};
        for (const [idx, vals] of Object.entries(observations)) {
            const dateStr = timeDim[parseInt(idx)].id;
            const date = dateStr.length === 7 ? `${dateStr}-01` : dateStr;
            if (vals[0] !== null && vals[0] !== undefined) {
                // ECB returns percentage, convert to decimal
                monthly[date] = parseFloat((vals[0] / 100).toFixed(6));
            }
        }
        return monthly;
    } catch (e) {
        console.error(`  ERROR fetching EURIBOR: ${e.message}`);
        return {};
    }
}

// ---------------------------------------------------------------------------
// FRED — Interest rates
// ---------------------------------------------------------------------------

const FRED_SERIES = {
    'SOFR': 'SOFR',
    'FEDFUNDS': 'FEDFUNDS',
    'SONIA': 'IUDSOIA',  // Bank of England Sterling Overnight Index Average
    'TREASURY_2Y': 'DGS2',
    'TREASURY_10Y': 'DGS10',
};

async function fetchFREDRates() {
    if (!FRED_KEY) {
        console.log('FRED: No API key provided. Skipping. (Use --fred-key YOUR_KEY)');
        return {};
    }

    console.log('Fetching FRED interest rates...');
    const results = {};

    for (const [name, seriesId] of Object.entries(FRED_SERIES)) {
        console.log(`  ${name} (${seriesId})...`);
        // Fetch monthly frequency to keep data compact
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&observation_start=${START_DATE}&observation_end=${END_DATE}&frequency=m&aggregation_method=avg`;

        try {
            const data = await fetchJSON(url);
            const monthly = {};
            for (const obs of data.observations) {
                if (obs.value !== '.' && obs.value !== '') {
                    // FRED returns percentage, convert to decimal
                    monthly[obs.date] = parseFloat((parseFloat(obs.value) / 100).toFixed(6));
                }
            }
            results[name] = monthly;
        } catch (e) {
            console.error(`  ERROR fetching ${name}: ${e.message}`);
        }
        await sleep(300);
    }

    return results;
}

// ---------------------------------------------------------------------------
// Yahoo Finance — Commodities
// ---------------------------------------------------------------------------

const YAHOO_COMMODITIES = {
    'BRENT': { ticker: 'BZ=F', divisor: 1 },
    'NATGAS': { ticker: 'NG=F', divisor: 1 },
    'COPPER': { ticker: 'HG=F', divisor: 1 },
    'GOLD': { ticker: 'GC=F', divisor: 1 },
    'WHEAT': { ticker: 'ZW=F', divisor: 100 },
    'CORN': { ticker: 'ZC=F', divisor: 100 },
    'DAIRY': { ticker: 'DC=F', divisor: 1 },
    'STEEL': { ticker: 'SLX', divisor: 1 },  // Steel ETF as proxy
};

async function fetchYahooCommodities() {
    console.log('Fetching Yahoo Finance commodities...');
    const results = {};

    const startUnix = Math.floor(new Date(START_DATE).getTime() / 1000);
    const endUnix = Math.floor(new Date(END_DATE).getTime() / 1000);

    for (const [name, config] of Object.entries(YAHOO_COMMODITIES)) {
        console.log(`  ${name} (${config.ticker})...`);
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(config.ticker)}?period1=${startUnix}&period2=${endUnix}&interval=1mo`;

        try {
            const data = await fetchJSON(url);
            const result = data.chart?.result?.[0];
            if (!result) {
                console.error(`  No data for ${name}`);
                continue;
            }

            const timestamps = result.timestamp || [];
            const closes = result.indicators?.quote?.[0]?.close || [];
            const monthly = {};

            for (let i = 0; i < timestamps.length; i++) {
                if (closes[i] === null || closes[i] === undefined) continue;
                const date = new Date(timestamps[i] * 1000);
                const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
                let price = closes[i] / config.divisor;
                monthly[dateStr] = parseFloat(price.toFixed(4));
            }
            results[name] = monthly;
        } catch (e) {
            console.error(`  ERROR fetching ${name}: ${e.message}`);
        }
        await sleep(1000); // Be gentle with Yahoo
    }

    return results;
}

// ---------------------------------------------------------------------------
// Synthetic data fallback — for commodities/rates with limited history
// ---------------------------------------------------------------------------

function generateSyntheticSeries(baseName, startPrice, annualVol, startDate, endDate) {
    console.log(`  Generating synthetic ${baseName}...`);
    const monthly = {};
    const start = new Date(startDate);
    const end = new Date(endDate);
    let price = startPrice;
    const monthlyVol = annualVol / Math.sqrt(12);

    const current = new Date(start);
    while (current <= end) {
        const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-01`;
        monthly[dateStr] = parseFloat(price.toFixed(4));

        // Geometric Brownian Motion step
        const z = normalRandom();
        price *= Math.exp(-0.5 * monthlyVol * monthlyVol + monthlyVol * z);
        price = Math.max(price * 0.3, price); // Floor at 30% of current

        current.setMonth(current.getMonth() + 1);
    }
    return monthly;
}

function normalRandom() {
    // Box-Muller transform
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('=== Treasury Manager Simulator — Market Data Fetcher ===\n');

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // 1. FX rates from ECB
    const fxData = await fetchECBFXRates();

    // 2. Interest rates
    const euribor = await fetchECBEuribor();
    const fredRates = await fetchFREDRates();

    // Combine rates
    const ratesData = { EURIBOR: euribor };
    for (const [key, data] of Object.entries(fredRates)) {
        ratesData[key] = data;
    }

    // If FRED unavailable, generate synthetic SOFR/SONIA
    if (!ratesData.SOFR || Object.keys(ratesData.SOFR).length === 0) {
        ratesData.SOFR = generateSyntheticSeries('SOFR', 0.05, 0.3, START_DATE, END_DATE);
    }
    if (!ratesData.SONIA || Object.keys(ratesData.SONIA).length === 0) {
        ratesData.SONIA = generateSyntheticSeries('SONIA', 0.045, 0.25, START_DATE, END_DATE);
    }

    // 3. Commodities from Yahoo
    const commodityData = await fetchYahooCommodities();

    // Fill gaps with synthetic data where Yahoo has limited history
    if (!commodityData.STEEL || Object.keys(commodityData.STEEL).length < 120) {
        console.log('  Steel data limited — using synthetic with copper correlation');
        commodityData.STEEL = generateSyntheticSeries('STEEL', 500, 0.35, START_DATE, END_DATE);
    }
    if (!commodityData.DAIRY || Object.keys(commodityData.DAIRY).length < 120) {
        commodityData.DAIRY = generateSyntheticSeries('DAIRY', 15, 0.25, START_DATE, END_DATE);
    }

    // 4. Write output files
    const fxFile = path.join(OUTPUT_DIR, 'fx-monthly.json');
    const ratesFile = path.join(OUTPUT_DIR, 'rates-monthly.json');
    const commoditiesFile = path.join(OUTPUT_DIR, 'commodities-monthly.json');

    const writeMeta = (data) => ({
        _meta: {
            generated: new Date().toISOString(),
            startDate: START_DATE,
            endDate: END_DATE,
            source: 'ECB, FRED, Yahoo Finance'
        },
        ...data
    });

    fs.writeFileSync(fxFile, JSON.stringify(writeMeta(fxData), null, 0));
    fs.writeFileSync(ratesFile, JSON.stringify(writeMeta(ratesData), null, 0));
    fs.writeFileSync(commoditiesFile, JSON.stringify(writeMeta(commodityData), null, 0));

    // Summary
    console.log('\n=== Summary ===');
    console.log(`FX pairs: ${Object.keys(fxData).length}`);
    for (const [k, v] of Object.entries(fxData)) {
        console.log(`  ${k}: ${Object.keys(v).length} months`);
    }
    console.log(`\nRates: ${Object.keys(ratesData).length}`);
    for (const [k, v] of Object.entries(ratesData)) {
        console.log(`  ${k}: ${Object.keys(v).length} months`);
    }
    console.log(`\nCommodities: ${Object.keys(commodityData).length}`);
    for (const [k, v] of Object.entries(commodityData)) {
        console.log(`  ${k}: ${Object.keys(v).length} months`);
    }

    const totalSize = [fxFile, ratesFile, commoditiesFile].reduce((sum, f) => {
        return sum + fs.statSync(f).size;
    }, 0);
    console.log(`\nTotal file size: ${(totalSize / 1024).toFixed(0)} KB`);
    console.log('Done!');
}

main().catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
});
