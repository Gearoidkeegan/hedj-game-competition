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
// 0.043 -> 0.027 (n = 300), and no allowed retune (notionalScale, baseOcfPct, points) restores 0.03.
// Ruling R37: baseOcfPct stays at the A7 value 0.05; the unhedged bankruptcy floor drops 0.03 -> 0.015
// (ceiling 0.30 and bankruptRate(mandate) < 0.05 unchanged). Every R34 criterion as amended by R37 passes.
// `node tools/simulate.js --n 1000` after A8/R37 (`severe` = share of runs fired by a severe breach):
//
//  strategy   mean    p10    p25 median    p75    p90    max bankrupt  fired severe meanQ
//  unhedged     19      0      0      0      0      0    778    0.020  0.957  0.254  3.71
//    flat50   1674      0     12   2254   2605   3131   4601    0.008  0.340  0.031  6.58
//   mandate   2537   1981   2220   2441   2801   3407   5879    0.022  0.000  0.000  7.96
//      full   1179      0      0    195   2500   3325   7082    0.000  0.638  0.000  5.30
//    random    576      0      0    188   1022   1761   4286    0.016  0.720  0.134  5.47
//
// share(full > median(mandate)) 0.261; share(random > median(mandate)) 0.027.
// At n = 300 (the test): unhedged bankrupt 0.027, severe 0.270; random severe 0.143; flat50 severe 0.030.
// gameOverTitles bands move by at most 0.3 points per band pooled vs A7, so their `min` values are unchanged.
//
// A9 (rulings R40-R44): board types (band / noHedge / none), proposing a policy, outcome-based mood,
// results-based firing (the two-strike rule and breachLossesToFire are gone), power-ups forecasting (3 tiers),
// visibility, facilities (cap 50% -> 100%, 10% borrowing buffer) and hedgeAccess (IR/commodity); options removed.
// Strategies are redefined (mandate -> policy; see tools/simulate.js). New terms: boards, mood.inPolicyGood/
// inPolicyBad/noPolicyHedgeLoss/noPolicyHedgeWin/policyAdopted, forecast, facilities, powerUpCosts,
// points.policyAdopted. With notionalScale 6 and breachLoss -25, bankruptRate(policy) was 0.049 and
// firedRate(unhedged) 0.475 (both under a 10% margin): the policy strategy follows a noHedge board unhedged,
// and fuel/commodity books are unhedgeable until hedgeAccess. Retuned: notionalScale 6 -> 5,
// mood.breachLoss -25 -> -22 (still the heaviest single term). `node tools/simulate.js --n 1000`:
//
//  strategy   mean    p10    p25 median    p75    p90    max bankrupt  fired severe meanQ
//  unhedged    578      0      0    113   1030   1965   2040    0.054  0.422  0.155  6.37
//    flat50    946      0      0    491   2032   2287   3152    0.044  0.502  0.093  6.31
//    policy   2249   1870   2022   2217   2480   2902   5783    0.035  0.000  0.000  7.90
//      full    876      0      0    290   1614   2543   7186    0.009  0.629  0.054  6.00
//    random    702      0      0    491   1235   1823   3121    0.045  0.470  0.135  6.45
//
// fired rate by starting board (band / noHedge / none): unhedged 0.725 / 0.000 / 0.000; flat50 0.301 / 0.827 / 0.756.
// Every criterion in tools/simulate.js criteria() passes with >= 16% relative margin (n = 1000) and >= 15% (n = 300).
// Policy scores sit ~220 below the A8 mandate strategy, so new gameOverTitles mins are proposed to D3 (A9 report).
//
// A9 fix round 1 (ruling R49): the no-policy board never pressured a non-hedger (0 mood for no hedge, +3 for an
// unhedged tie with the benchmark: unhedged fired 0.000 on none boards). Added mood.noPolicyDrift (every
// no-policy quarter) and made beatBenchmark strict (playerDelta > benchmarkDelta). The strict beat also lifted
// unhedged band-board firing (0.725 -> 0.871), so breachLoss was softened. Criteria added: firedRate(policy) < 0.05;
// on none boards firedRate(unhedged) >= 0.5 x its band-board rate and mean(unhedged) < mean(policy).
// Retuned: mood.breachLoss -22 -> -12, mood.noPolicyDrift -6.25 (new). The drift is a cliff (-6 gives 0.317 on
// none boards, -6.5 gives 0.538); severeBreachLossPct stays 0.35. `node tools/simulate.js --n 1000`:
//
//  strategy   mean    p10    p25 median    p75    p90    max bankrupt  fired severe meanQ
//  unhedged    450      0      0    116    767   1802   1986    0.056  0.427  0.183  6.87
//    flat50    916      0     70    388   2032   2287   3152    0.043  0.401  0.117  6.35
//    policy   2216   1775   1951   2201   2467   2866   5783    0.035  0.000  0.000  7.90
//      full    874      0      0    428   1424   2533   7186    0.009  0.420  0.056  6.38
//    random    647      0     52    342   1131   1807   3121    0.047  0.430  0.156  6.45
//
// fired rate by starting board (band / noHedge / none): unhedged 0.541 / 0.000 / 0.427; flat50 0.151 / 0.436 / 0.935.
// Every criterion passes with >= 15% relative margin at n = 1000 and n = 300.

export const BALANCE = {
    startMood: 60,
    fireThreshold: 10,
    redLinePct: 0.2,
    baseOcfPct: 0.05,
    eventChance: 0.35,
    // A9 (R42): picked once per run in createRun by weight. 'none' is the immature no-policy board
    // (run.mandate null); 'noHedge' is a policy not to hedge ({0, 0}).
    boards: [
        { type: 'band', min: 0.25, max: 0.5, weight: 0.2 },
        { type: 'band', min: 0.5, max: 0.75, weight: 0.2 },
        { type: 'band', min: 0.75, max: 1, weight: 0.2 },
        { type: 'noHedge', min: 0, max: 0, weight: 0.15 },
        { type: 'none', weight: 0.25 }
    ],
    mood: {
        inPolicyGood: 4, inPolicyBad: -2, luckyBreach: 0, breachLoss: -12,
        noPolicyHedgeLoss: -20, noPolicyHedgeWin: 1, noPolicyDrift: -6.25, policyAdopted: 10,
        beatBenchmark: 3, redZone: -12
    },
    severeBreachLossPct: 0.35,
    notionalScale: 5,
    // A9 (R44): forecast surprise variance = baseVariance x (1 - accuracy) / 0.6, accuracy 0.4 + 0.2 x level.
    forecast: { baseVariance: 0.4 },
    // A9 (R44): before facilities each hedge ratio is capped at baseHedgeCap and there is no borrowing buffer.
    facilities: { baseHedgeCap: 0.5, borrowPct: 0.1 },
    // Fractions of starting cash. forecasting is per level (1st, 2nd, 3rd module).
    powerUpCosts: { forecasting: [0.005, 0.01, 0.015], visibility: 0.005, facilities: 0.01, hedgeAccess: 0.01 },
    points: { inMandate: 100, luckyBreach: 25, breachLoss: -300, aboveRedLine: 50, stability: 100, outperformPerPct: 12, survival: 500, policyAdopted: 100 }
};
