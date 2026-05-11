// Game balance constants and configuration

export const GAME_CONFIG = {
    DEFAULT_QUARTERS: 8,        // 2 years = ~5 minute game
    EXTENSION_QUARTERS: 4,      // Each extension adds 1 year
    MAX_EXTENSIONS: 2,          // Up to 16 quarters total
    QUARTERS_PER_YEAR: 4,

    // Board satisfaction
    STARTING_SATISFACTION: 60,
    MAX_SATISFACTION: 100,
    FIRE_THRESHOLD: 10,
    SATISFACTION_GAIN_MAX: 5,
    SATISFACTION_LOSS_MAX: -15,

    // Hedging limits
    MAX_HEDGE_RATIO: 2.0,       // 200% - over-hedging allowed but board criticises heavily
    OVERHEDGE_PENALTY_RATE: 0.02, // 2% penalty per quarter on overhedged amount
    EARLY_UNWIND_COST: 0.005,   // 0.5% breakage cost on notional

    // Cash / margin
    MARGIN_CALL_THRESHOLD: 0.05, // MTM loss > 5% of notional triggers margin
    MARGIN_REQUIREMENT: 0.10,    // 10% of notional posted as margin
    LOW_CASH_THRESHOLD: 0.10,    // Warning below 10% of starting cash

    // Events
    MAX_EVENTS_PER_QUARTER: 1,
    MIN_EVENTS_PER_YEAR: 2,

    // Scoring weights
    SCORE_WEIGHTS: {
        pnl: 0.30,
        boardSatisfaction: 0.25,
        cashManagement: 0.20,
        policyCompliance: 0.15,
        riskAdjusted: 0.10
    },

    // Option pricing (simplified)
    OPTION_PREMIUM_ATM: 0.03,   // 3% of notional for ATM option
    OPTION_PREMIUM_SCALE: 1.5,  // Vol multiplier for premium

    // Data window
    MIN_DATA_YEAR: 1994,
    MAX_DATA_YEAR: 2024,
    GAME_WINDOW_YEARS: 4,        // Max years of data needed per game

    // Bank request gating (board approval mechanic)
    MIN_SATISFACTION_FOR_BANK_REQUEST: 50,    // Min board satisfaction to onboard a new bank
    MIN_SATISFACTION_FOR_LIMIT_INCREASE: 50,  // Min board satisfaction to raise credit lines
    BANK_REQUEST_COOLDOWN_QUARTERS: 2         // Quarters between any bank/limit request
};

export const GRADES = [
    { min: 90, grade: 'A+', title: 'Chief Risk Officer Material', description: 'A headhunter is on the line for you.' },
    { min: 80, grade: 'A',  title: 'Contract Extended', description: 'The board wants to extend your contract.' },
    { min: 70, grade: 'B',  title: 'Solid Treasury Management', description: 'Steady hands on the wheel.' },
    { min: 60, grade: 'C',  title: 'Adequate Performance', description: 'Room for improvement, but you kept the lights on.' },
    { min: 50, grade: 'D',  title: 'Under Review', description: 'The board is reviewing your performance.' },
    { min: 0,  grade: 'F',  title: 'Looking for Work', description: 'Your LinkedIn profile has been updated.' }
];

export const HEDGING_POLICY_TYPES = [
    {
        id: 'none',
        name: 'No Formal Policy',
        description: 'No hedging requirements. Full discretion. No budget rate.',
        detail: 'The board has not set a formal hedging policy. You may hedge as much or as little as you like, using any product available. No budget rate is set — P&L is measured on a mark-to-market basis only.',
        minHedgeRatio: 0,
        maxHedgeRatio: 1.0,
        requiredProducts: [],
        rules: [],
        difficulty: 'easy',
        hedgeHorizon: 8,
        tenorBands: null,
        budgetRateType: 'none',
        productExpansionAllowed: false
    },
    {
        id: 'basic',
        name: 'Basic Policy',
        description: 'Hedge 25-75% over 12 months. Annual budget rate.',
        detail: 'The board requires a minimum 25% and maximum 75% hedge ratio on all exposures within a 12-month horizon. No restrictions on product choice. Budget rate is set annually and reviewed each year. Compliance is reviewed quarterly.',
        minHedgeRatio: 0.25,
        maxHedgeRatio: 0.75,
        requiredProducts: [],
        rules: ['Minimum 25% hedge ratio on all exposures', 'Maximum 75% hedge ratio', '12-month hedge horizon', 'Annual budget rate'],
        difficulty: 'easy',
        hedgeHorizon: 4,
        tenorBands: null,
        budgetRateType: 'annual',
        productExpansionAllowed: false
    },
    {
        id: 'conservative',
        name: 'Conservative Policy',
        description: 'Layered hedging over 12 months. Forwards only. Annual budget rate.',
        detail: 'The board requires a layered hedging programme over a 12-month horizon using forwards only. Hedge ratios decrease with tenor: Q+1 at 70-80%, Q+2 at 50-70%, Q+3 at 30-50%, Q+4 at 10-30%. Options and swaps may be requested via board approval. Budget rate is set annually.',
        minHedgeRatio: 0.10,
        maxHedgeRatio: 0.80,
        requiredProducts: ['forward'],
        rules: ['Forwards only (options/swaps require board approval)', 'Layered programme: Q+1 70-80%, Q+2 50-70%, Q+3 30-50%, Q+4 10-30%', '12-month hedge horizon', 'Quarterly compliance report to CFO'],
        difficulty: 'normal',
        hedgeHorizon: 4,
        tenorBands: [
            { tenor: 1, min: 0.70, max: 0.80 },
            { tenor: 2, min: 0.50, max: 0.70 },
            { tenor: 3, min: 0.30, max: 0.50 },
            { tenor: 4, min: 0.10, max: 0.30 }
        ],
        budgetRateType: 'annual',
        productExpansionAllowed: true
    },
    {
        id: 'moderate',
        name: 'Moderate Policy',
        description: 'Hedge 30-70% over 18 months. Quarterly budget rate reset.',
        detail: 'The board permits both forwards and options but requires hedge ratios between 30% and 70% across an 18-month horizon. Budget rate resets each quarter to prevailing market rates. Option premiums must not exceed 3% of notional per quarter. Bank diversification required for trades over €5M.',
        minHedgeRatio: 0.30,
        maxHedgeRatio: 0.70,
        requiredProducts: ['forward', 'option'],
        rules: ['Forwards and options permitted', 'Hedge ratio must be 30-70%', '18-month hedge horizon', 'Quarterly budget rate reset', 'Option premiums capped at 3% of notional', 'Diversify banks for large trades'],
        difficulty: 'normal',
        hedgeHorizon: 6,
        tenorBands: null,
        budgetRateType: 'quarterly',
        productExpansionAllowed: false
    },
    {
        id: 'rigorous',
        name: 'Rigorous Policy',
        description: 'Layered rolling programme over 24 months. Fixed budget rate.',
        detail: 'Strict rolling hedging programme over a 24-month horizon. Forwards required for core hedging. Near-term (Q+1 to Q+4) must be hedged 70-100%. Outer tenors (Q+5 to Q+8) must be hedged 40-70%. Options only permitted for tail risk (max 20% of total hedge book). Minimum 2 bank counterparties. Budget rate is set once at game start.',
        minHedgeRatio: 0.40,
        maxHedgeRatio: 1.00,
        requiredProducts: ['forward'],
        rules: ['Hedge ratio 70-100% for Q+1 to Q+4', 'Hedge ratio 40-70% for Q+5 to Q+8', '24-month rolling horizon', 'Forwards required for core programme', 'Options max 20% of total hedge book', 'Minimum 2 bank counterparties', 'No single bank >60% of exposure', 'Monthly compliance reporting'],
        difficulty: 'hard',
        hedgeHorizon: 8,
        tenorBands: [
            { tenor: 1, min: 0.70, max: 1.00 },
            { tenor: 2, min: 0.70, max: 1.00 },
            { tenor: 3, min: 0.70, max: 1.00 },
            { tenor: 4, min: 0.70, max: 1.00 },
            { tenor: 5, min: 0.40, max: 0.70 },
            { tenor: 6, min: 0.40, max: 0.70 },
            { tenor: 7, min: 0.40, max: 0.70 },
            { tenor: 8, min: 0.40, max: 0.70 }
        ],
        budgetRateType: 'fixed',
        productExpansionAllowed: true
    },
    {
        id: 'pe_mandate',
        name: 'PE Board Mandate',
        description: 'Layered 80-100% over 12 months. Quarterly budget rate. Zero tolerance.',
        detail: 'The PE partners mandate maximum hedging with minimum cost over a 12-month horizon. Layered programme: Q+1 at 90-100%, Q+2 at 80-90%, Q+3 at 60-80%, Q+4 at 40-60%. Forwards and swaps only — option premiums are explicitly prohibited. Budget rate resets quarterly. No speculation. Any deviation requires prior board approval.',
        minHedgeRatio: 0.40,
        maxHedgeRatio: 1.00,
        requiredProducts: ['forward', 'swap'],
        rules: ['Layered programme: Q+1 90-100%, Q+2 80-90%, Q+3 60-80%, Q+4 40-60%', '12-month hedge horizon', 'Forwards and swaps only — options prohibited', 'Quarterly budget rate reset', 'Zero premium spend tolerance', 'No speculative positions', 'Prior board approval for any deviation', 'Weekly reporting to PE partners'],
        difficulty: 'very_hard',
        hedgeHorizon: 4,
        tenorBands: [
            { tenor: 1, min: 0.90, max: 1.00 },
            { tenor: 2, min: 0.80, max: 0.90 },
            { tenor: 3, min: 0.60, max: 0.80 },
            { tenor: 4, min: 0.40, max: 0.60 }
        ],
        budgetRateType: 'quarterly',
        productExpansionAllowed: false
    }
];

export const QUARTER_NAMES = ['Q1', 'Q2', 'Q3', 'Q4'];

export const PHASE = {
    SETUP: 'setup',
    DECISION: 'decision',
    RESOLUTION: 'resolution',
    EVENT: 'event',
    BOARD: 'board',
    SUMMARY: 'summary',
    EXTEND: 'extend',
    LEVEL_COMPLETE: 'level_complete',
    GAMEOVER: 'gameover'
};
