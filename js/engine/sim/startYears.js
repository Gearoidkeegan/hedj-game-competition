// Start-year selection: only years where every exposure has real monthly data
// (exact month keys, no nearest-date fallback) for each quarter it is active.

const QUARTER_MONTHS = [1, 4, 7, 10];
// Candidate range: the earliest data starts in 1994.
const FIRST_CANDIDATE = 1990;
const LAST_CANDIDATE = 2030;

export function hasExactRate(market, underlying, year, quarter) {
    const dataset = market.getDataset(underlying);
    if (!dataset) return false;
    const key = `${year}-${String(QUARTER_MONTHS[quarter - 1]).padStart(2, '0')}-01`;
    const v = dataset[key];
    return v !== undefined && v !== null;
}

export function eligibleStartYears(market, exposures, quarters = 8) {
    const years = [];
    for (let y = FIRST_CANDIDATE; y <= LAST_CANDIDATE; y++) {
        let ok = true;
        for (const e of exposures) {
            for (let i = e.unlockQuarter || 0; i <= quarters && ok; i++) {
                const year = y + Math.floor(i / 4);
                const quarter = (i % 4) + 1;
                if (!hasExactRate(market, e.underlying, year, quarter)) ok = false;
            }
            if (!ok) break;
        }
        if (ok) years.push(y);
    }
    return years;
}

export function pickStartYear(market, exposures, rng, { quarters = 8, forcedYear = null } = {}) {
    const years = eligibleStartYears(market, exposures, quarters);
    if (forcedYear !== null && forcedYear !== undefined) {
        if (!years.includes(forcedYear)) {
            throw new Error(`Start year ${forcedYear} is not eligible (missing market data)`);
        }
        return { year: forcedYear, quarter: 1 };
    }
    if (years.length === 0) throw new Error('No eligible start year for these exposures');
    return { year: years[rng.intRange(0, years.length - 1)], quarter: 1 };
}
