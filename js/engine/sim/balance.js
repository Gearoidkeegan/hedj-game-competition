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
//
// A8 (ruling R35): a single severe losing breach fires at once (`severeBreachLossPct`).
// Loss of a losing breach as a share of starting cash, -marketResult / startingCash, at the A7 BALANCE
// above (no severe rule), n = 1000, all 5 strategies pooled: 5572 losing breaches,
//   p10 0.5%  p25 1.5%  p50 5.5%  p75 16.2%  p80 20.3%  p85 25.3%  p90 34.3%  p95 54.4%  p99 132.3%
// (unhedged p90 50.7%, flat50 24.8%, full 4.3%, random 34.6%; mandate never breaches).
// severeBreachLossPct = 0.35, so 9.7% of losing breaches are severe.
// Severe firings pre-empt later bankruptcies: unhedged bankruptRate fell 0.042 -> 0.020 (n = 1000) and
// 0.043 -> 0.027 (n = 300). notionalScale is at its R34 cap, so baseOcfPct 0.05 -> 0.035 is the retune;
// it brings the n = 300 test back to 0.030 but no allowed retune lifts n = 1000 above 0.021.
// `node tools/simulate.js --n 1000` after A8 (`severe` = share of runs fired by a severe breach):
//
//  strategy   mean    p10    p25 median    p75    p90    max bankrupt  fired severe meanQ
//  unhedged     19      0      0      0      0      0    778    0.021  0.956  0.253  3.71
//    flat50   1665      0     12   2254   2604   3115   4473    0.016  0.340  0.031  6.58
//   mandate   2525   1964   2215   2441   2798   3387   5879    0.031  0.000  0.000  7.93
//      full   1179      0      0    195   2500   3325   7082    0.000  0.638  0.000  5.30
//    random    577      0      0    189   1023   1761   4286    0.016  0.720  0.134  5.46
//
// share(full > median(mandate)) 0.261; share(random > median(mandate)) 0.027. gameOverTitles bands
// move by at most 0.3 points per band pooled, so their `min` values are unchanged.

export const BALANCE = {
    startMood: 60,
    fireThreshold: 10,
    redLinePct: 0.2,
    baseOcfPct: 0.035,
    eventChance: 0.35,
    mandates: [{ min: 0.25, max: 0.5 }, { min: 0.5, max: 0.75 }, { min: 0.75, max: 1 }],
    mood: { inMandate: 4, luckyBreach: -3, breachLoss: -25, beatBenchmark: 3, redZone: -12 },
    breachLossesToFire: 2,
    severeBreachLossPct: 0.35,
    notionalScale: 6,
    points: { inMandate: 100, luckyBreach: 25, breachLoss: -300, aboveRedLine: 50, stability: 100, outperformPerPct: 12, survival: 500 }
};
