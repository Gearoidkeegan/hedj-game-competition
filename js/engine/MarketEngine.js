// MarketEngine — loads historical market data and replays rates quarter-by-quarter

import { GAME_CONFIG } from '../utils/constants.js';

// Budget = spot shifted 0.5% toward the unfavourable direction for FX/commodity
// (so a spot outcome yields ~0.5% positive variance). Rates: no budget.
export const BUDGET_SPREAD = 0.005;
export function computeBudgetRate(exp, spot) {
    if (spot === undefined || spot === null) return null;
    if (exp.type === 'ir') return null;
    const revenue = (exp.direction === 'sell' || exp.direction === 'receive');
    let unfavourableUp;
    if (exp.type === 'fx') {
        const homeIsBase = typeof exp.underlying === 'string'
            && typeof exp.unit === 'string'
            && exp.underlying.endsWith(exp.unit);
        unfavourableUp = homeIsBase ? revenue : !revenue;
    } else {
        unfavourableUp = !revenue; // commodity: cost side hurt by rising price
    }
    return spot * (1 + (unfavourableUp ? BUDGET_SPREAD : -BUDGET_SPREAD));
}

function monthIndex(key) {
    return parseInt(key.slice(0, 4), 10) * 12 + (parseInt(key.slice(5, 7), 10) - 1);
}
function monthKey(idx) {
    const y = Math.floor(idx / 12);
    return `${y}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
}

/**
 * Fill runs of 1..maxGap consecutive missing months (keys YYYY-MM-01) that have real
 * data on both sides, by linear interpolation. Longer runs and the edges stay unfilled.
 * Pure: returns a new object.
 */
export function fillShortGaps(series, maxGap = 2) {
    const out = { ...series };
    const keys = Object.keys(series).sort();
    for (let i = 1; i < keys.length; i++) {
        const a = monthIndex(keys[i - 1]);
        const b = monthIndex(keys[i]);
        const gap = b - a - 1;
        if (gap < 1 || gap > maxGap) continue;
        const va = series[keys[i - 1]];
        const vb = series[keys[i]];
        for (let m = 1; m <= gap; m++) {
            out[monthKey(a + m)] = va + (vb - va) * (m / (gap + 1));
        }
    }
    return out;
}

/**
 * v3.2 chart-only weekly series: { start: 'YYYY-MM-DD', anchor?: 'avg'|'end', v: [number|null, ...] }, one value
 * per week (start + 7 days per step). Decodes to { t0 (UTC ms), anchor, v } with every gap or bad value as null,
 * or null when the entry is unusable. "anchor" says what the monthly value for a month is: its average or its
 * last close (see tools/fetch-weekly-data.cjs).
 */
export function decodeWeekly(entry) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.v) || !entry.v.length) return null;
    if (typeof entry.start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.start)) return null;
    const t0 = Date.parse(`${entry.start}T00:00:00Z`);
    if (!Number.isFinite(t0)) return null;
    const v = entry.v.map(x => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null));
    return { t0, anchor: entry.anchor === 'end' ? 'end' : 'avg', v };
}

const JET_FACTOR = 1.8 * 7.4;   // Jet CIF NWE proxy from Brent ($/bbl -> $/tonne with crack spread)

function fillAll(group) {
    const out = {};
    for (const [name, series] of Object.entries(group)) out[name] = fillShortGaps(series);
    return out;
}

export class MarketEngineController {
    constructor() {
        this.fxData = null;
        this.ratesData = null;
        this.commoditiesData = null;
        this.loaded = false;
        // v3.2: weekly series for the charts only. Nothing in the engine reads these (getRate, getDataset and the
        // simulation stay on the monthly data).
        this.weekly = null;
        this._weeklyLoading = null;
    }

    /**
     * Load the chart-only weekly files. Optional and lazy: call it after the first screen is up. Shares a load
     * in flight, does nothing once loaded, never rejects. On any failure the charts stay on the monthly data.
     */
    loadWeekly(basePath = 'data/market', fetchImpl = globalThis.fetch?.bind(globalThis)) {
        if (this.weekly) return Promise.resolve();
        if (this._weeklyLoading) return this._weeklyLoading;
        const get = async (file) => {
            const res = await fetchImpl(`${basePath}/${file}`);
            if (!res?.ok) throw new Error(`${file}: ${res?.status}`);
            return res.json();
        };
        this._weeklyLoading = (async () => {
            try {
                if (typeof fetchImpl !== 'function') throw new Error('no fetch');
                const [fx, commodities] = await Promise.all([get('fx-weekly.json'), get('commodities-weekly.json')]);
                this.loadWeeklyFromObjects({ fx, commodities });
            } catch (e) {
                console.warn('MarketEngine: weekly chart data not available, charts use monthly', e?.message || e);
            } finally {
                this._weeklyLoading = null;
            }
        })();
        return this._weeklyLoading;
    }

    /** Set the weekly series from parsed JSON (Node tests, and loadWeekly). Derives the JETNWE proxy. */
    loadWeeklyFromObjects({ fx, commodities } = {}) {
        const out = {};
        for (const group of [fx, commodities]) {
            if (!group || typeof group !== 'object') continue;
            for (const [name, entry] of Object.entries(group)) {
                if (name === '_meta') continue;
                const d = decodeWeekly(entry);
                if (d) out[name] = d;
            }
        }
        if (out.BRENT && !out.JETNWE) {
            out.JETNWE = { ...out.BRENT, v: out.BRENT.v.map(x => (x === null ? null : x * JET_FACTOR)) };
        }
        this.weekly = out;
    }

    /** The decoded weekly series for a chart, or null (not loaded, or no weekly data for it: use monthly). */
    getWeekly(underlying) {
        if (!this.weekly || typeof underlying !== 'string') return null;
        return Object.prototype.hasOwnProperty.call(this.weekly, underlying) ? this.weekly[underlying] : null;
    }

    /**
     * Load all market data JSON files.
     * Call once at app startup.
     */
    async loadData(basePath = 'data/market') {
        try {
            const [fxRes, ratesRes, commoditiesRes] = await Promise.all([
                fetch(`${basePath}/fx-monthly.json`).then(r => r.json()),
                fetch(`${basePath}/rates-monthly.json`).then(r => r.json()),
                fetch(`${basePath}/commodities-monthly.json`).then(r => r.json())
            ]);

            this.loadFromObjects({ fx: fxRes, rates: ratesRes, commodities: commoditiesRes });
            console.log('MarketEngine: data loaded', {
                fx: Object.keys(this.fxData).length,
                rates: Object.keys(this.ratesData).length,
                commodities: Object.keys(this.commoditiesData).length
            });
        } catch (e) {
            console.warn('MarketEngine: could not load market data, will use placeholders', e);
            this.loaded = false;
        }
    }

    /**
     * Set the datasets from already-parsed JSON objects (used by Node and by loadData).
     * Derives the JETNWE proxy and marks the engine as loaded.
     */
    loadFromObjects({ fx, rates, commodities }) {
        this.fxData = fillAll(this.stripMeta(fx));
        this.ratesData = fillAll(this.stripMeta(rates));
        this.commoditiesData = fillAll(this.stripMeta(commodities));

        // Derived proxy: Jet CIF NWE ≈ Brent × 1.8 × 7.4 ($/bbl → $/tonne with crack spread)
        if (this.commoditiesData.BRENT && !this.commoditiesData.JETNWE) {
            const k = JET_FACTOR;
            const jet = {};
            for (const [date, px] of Object.entries(this.commoditiesData.BRENT)) {
                jet[date] = px * k;
            }
            this.commoditiesData.JETNWE = jet;
        }

        this.loaded = true;
    }

    stripMeta(data) {
        const { _meta, ...rest } = data;
        return rest;
    }

    /**
     * Get the dataset for a given underlying.
     */
    getDataset(underlying) {
        if (!this.loaded) return null;

        // Check each data source
        if (this.fxData[underlying]) return this.fxData[underlying];
        if (this.ratesData[underlying]) return this.ratesData[underlying];
        if (this.commoditiesData[underlying]) return this.commoditiesData[underlying];

        // Try mapping common names
        const aliases = {
            'EURIBOR': 'EURIBOR',
            'SOFR': 'SOFR',
            'SONIA': 'SONIA'
        };
        const alias = aliases[underlying];
        if (alias && this.ratesData[alias]) return this.ratesData[alias];

        return null;
    }

    /**
     * Get all available dates (sorted) for an underlying.
     */
    getDates(underlying) {
        const dataset = this.getDataset(underlying);
        if (!dataset) return [];
        return Object.keys(dataset).sort();
    }

    /**
     * Find the valid start year range for a game.
     * The game needs GAME_WINDOW_YEARS of forward data.
     */
    getValidStartYears() {
        if (!this.loaded) return { min: 1994, max: 2020 };

        // Find the overlap of all datasets
        let globalMin = 1900;
        let globalMax = 2100;

        const allDatasets = [
            ...Object.values(this.fxData),
            ...Object.values(this.ratesData),
            ...Object.values(this.commoditiesData)
        ];

        for (const dataset of allDatasets) {
            const dates = Object.keys(dataset).sort();
            if (dates.length === 0) continue;
            const minYear = parseInt(dates[0].slice(0, 4));
            const maxYear = parseInt(dates[dates.length - 1].slice(0, 4));
            globalMin = Math.max(globalMin, minYear);
            globalMax = Math.min(globalMax, maxYear);
        }

        // Leave room for game duration
        return {
            min: globalMin,
            max: globalMax - GAME_CONFIG.GAME_WINDOW_YEARS
        };
    }

    /**
     * Get the rate for a specific underlying at a given date.
     * Uses the nearest available date if exact match not found.
     * @param {string} underlying - e.g. 'EURUSD', 'BRENT', 'SOFR'
     * @param {number} year
     * @param {number} quarter - 1-4
     * @returns {number|null}
     */
    getRate(underlying, year, quarter) {
        const dataset = this.getDataset(underlying);
        if (!dataset) return null;

        // Quarter to month: Q1=Jan, Q2=Apr, Q3=Jul, Q4=Oct
        const months = [1, 4, 7, 10];
        const month = months[quarter - 1];
        const dateStr = `${year}-${String(month).padStart(2, '0')}-01`;

        // Exact match
        if (dataset[dateStr] !== undefined) {
            return dataset[dateStr];
        }

        // Nearest date within ±3 months
        const dates = Object.keys(dataset).sort();
        let closest = null;
        let closestDist = Infinity;

        for (const d of dates) {
            const dist = Math.abs(new Date(d) - new Date(dateStr));
            if (dist < closestDist) {
                closestDist = dist;
                closest = d;
            }
        }

        if (closest && closestDist < 100 * 24 * 3600 * 1000) {
            return dataset[closest];
        }

        return null;
    }

    /**
     * Get rates for all exposures at a given quarter.
     * @param {Array} exposures - array of exposure objects with .underlying
     * @param {number} year - calendar year
     * @param {number} quarter - 1-4
     * @returns {Object} { underlying: rate }
     */
    getRatesForQuarter(exposures, year, quarter) {
        const rates = {};
        for (const exp of exposures) {
            const rate = this.getRate(exp.underlying, year, quarter);
            if (rate !== null) {
                rates[exp.underlying] = rate;
            }
        }
        return rates;
    }

    /**
     * Get budget rates — the rates at the start of the game.
     * Budget rates include a small spread favorable to the company.
     * @param {Array} exposures
     * @param {number} startYear
     * @param {number} startQuarter
     * @returns {Object} { underlying: budgetRate }
     */
    getBudgetRates(exposures, startYear, startQuarter) {
        const spotRates = this.getRatesForQuarter(exposures, startYear, startQuarter);
        const budgetRates = {};

        for (const exp of exposures) {
            const spot = spotRates[exp.underlying];
            if (spot === undefined) continue;
            const br = computeBudgetRate(exp, spot);
            if (br !== null) budgetRates[exp.underlying] = br;
        }

        return budgetRates;
    }

    /**
     * Reset budget rates based on policy budgetRateType (v2).
     * Called at the start of each quarter's DECISION phase.
     *
     * @param {object} state - Current game state
     * @returns {object|null} New budget rates, or null if no reset needed
     */
    resetBudgetRates(state) {
        const policy = state.hedgingPolicy;
        if (!policy) return null;

        const budgetRateType = policy.budgetRateType || 'fixed';

        // 'none' = no budget rates at all
        if (budgetRateType === 'none') {
            return {};
        }

        // 'fixed' = never resets (set once at game start)
        if (budgetRateType === 'fixed') {
            return null;
        }

        const year = state.startYear + state.currentYearOffset;
        const quarter = state.currentQuarter;

        // 'quarterly' = reset every quarter
        if (budgetRateType === 'quarterly') {
            return this.getBudgetRates(state.exposures, year, quarter);
        }

        // 'annual' = reset at Q1 of each year only
        if (budgetRateType === 'annual' && quarter === 1) {
            return this.getBudgetRates(state.exposures, year, quarter);
        }

        return null; // No reset this quarter
    }

    /**
     * Get intra-quarter price ticks for the Bloomberg terminal.
     * Interpolates between two quarterly rates with realistic noise.
     * @param {string} underlying
     * @param {number} year
     * @param {number} quarter
     * @param {object} rng - SeededRandom instance
     * @param {number} numTicks - number of ticks to generate
     * @returns {{ startRate: number, endRate: number, ticks: number[] }}
     */
    getIntraQuarterTicks(underlying, year, quarter, rng, numTicks = 60) {
        const startRate = this.getRate(underlying, year, quarter);

        // End rate = next quarter
        let nextYear = year;
        let nextQuarter = quarter + 1;
        if (nextQuarter > 4) { nextQuarter = 1; nextYear++; }
        const endRate = this.getRate(underlying, nextYear, nextQuarter);

        if (startRate === null || endRate === null) {
            return null;
        }

        // Brownian bridge interpolation
        const ticks = [startRate];
        const totalReturn = endRate / startRate - 1;
        const dailyVol = Math.abs(totalReturn) * 0.4 + 0.002;
        let price = startRate;

        for (let i = 1; i < numTicks; i++) {
            const t = i / numTicks;
            const target = startRate + (endRate - startRate) * t;
            const pullStrength = 0.15 + 0.35 * t;
            const noise = rng.floatRange(-1, 1) * dailyVol * startRate;
            price = price * (1 - pullStrength) + target * pullStrength + noise;
            price = Math.max(startRate * 0.85, Math.min(startRate * 1.15, price));
            ticks.push(price);
        }
        ticks.push(endRate);

        return { startRate, endRate, ticks };
    }

    /**
     * Check if real market data is available.
     */
    isLoaded() {
        return this.loaded;
    }
}

// Singleton
export const marketEngine = new MarketEngineController();
