// Every tunable number of the Simple simulation. A7 tunes these values.

export const BALANCE = {
    startMood: 60,
    fireThreshold: 10,
    redLinePct: 0.2,
    baseOcfPct: -0.03,
    eventChance: 0.35,
    mandates: [{ min: 0.25, max: 0.5 }, { min: 0.5, max: 0.75 }, { min: 0.75, max: 1 }],
    mood: { inMandate: 4, luckyBreach: -3, breachLoss: -25, beatBenchmark: 3, redZone: -12 },
    breachLossesToFire: 2,
    notionalScale: 1,
    points: { inMandate: 100, luckyBreach: 0, breachLoss: -300, aboveRedLine: 50, stability: 100, outperformPerPct: 40, survival: 500 }
};
