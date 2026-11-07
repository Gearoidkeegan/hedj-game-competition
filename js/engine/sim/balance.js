// Every tunable number of the Simple simulation. A7 tunes these values.
//
// Tuned by A7 (ruling R34): `node tools/simulate.js --n 1000` (seeds 1..1000, all 7 industries, real events):
//
//  strategy   mean    p10    p25 median    p75    p90    max bankrupt  fired meanQ
//  unhedged     17      0      0      0      0      0    778    0.042  0.935  4.05
//    flat50   1673      0      0   2254   2605   3131   4601    0.008  0.340  6.62
//   mandate   2537   1981   2220   2441   2801   3407   5879    0.022  0.000  7.96
//      full   1179      0      0    195   2500   3325   7082    0.000  0.638  5.30
//    random    605      0      0    224   1063   1781   4286    0.021  0.697  5.67
//
// share(full > median(mandate)) 0.261; share(random > median(mandate)) 0.029.
// Changed from the A3/A5 defaults: notionalScale 1 -> 6, baseOcfPct -0.03 -> 0.05,
// points.luckyBreach 0 -> 25, points.outperformPerPct 40 -> 12.

export const BALANCE = {
    startMood: 60,
    fireThreshold: 10,
    redLinePct: 0.2,
    baseOcfPct: 0.05,
    eventChance: 0.35,
    mandates: [{ min: 0.25, max: 0.5 }, { min: 0.5, max: 0.75 }, { min: 0.75, max: 1 }],
    mood: { inMandate: 4, luckyBreach: -3, breachLoss: -25, beatBenchmark: 3, redZone: -12 },
    breachLossesToFire: 2,
    notionalScale: 6,
    points: { inMandate: 100, luckyBreach: 25, breachLoss: -300, aboveRedLine: 50, stability: 100, outperformPerPct: 12, survival: 500 }
};
