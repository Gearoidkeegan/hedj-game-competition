// Crisis scenarios: a forced start year and industry. Crisis runs are unranked
// (never submitted to the leaderboard). Every forcedYear is verified eligible for
// its industry by tests/sim/progress.test.js, so the data stays the source of truth.

export const CRISES = [
    { id: 'gfc2008', label: 'Global Financial Crisis (2008)', forcedYear: 2008, industryId: 'airline' },
    { id: 'brexit2016', label: 'Brexit vote (2016)', forcedYear: 2016, industryId: 'retail' },
    { id: 'covid2020', label: 'Covid-19 shock (2020)', forcedYear: 2020, industryId: 'airline' },
    { id: 'energy2022', label: 'Energy price spike (2021-22)', forcedYear: 2021, industryId: 'construction' }
];
