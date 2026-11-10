# v3 engine contract

Shapes and signatures only. Every stream reads this first. Source of truth: the task briefs (A3, A4, A5, A6, C1, C2, D1).
`js/engine/sim/**` is pure: no `window`, `document`, `localStorage`, `fetch`, `Math.random` or `Date.now`. All randomness comes from `SeededRandom` seeded from the run seed.

## RunState (A3, JSON-serialisable)

```js
{
  version: 3, gameId: string, seed: number, mode: 'simple',
  industryId: string, baseCurrency: string, crisisId: string|null,
  startYear: number, quarter: number /* quarters completed, 0..8 */, maxQuarters: 8,
  startingCash: number, cash: number, benchmarkCash: number, redLine: number,
  mandate: { min: number, max: number } | null,   // A9: the board's policy; null = no policy at all (boardType 'none')
  boardType: 'band'|'noHedge'|'none',       // A9 (R42): noHedge = "our policy is not to hedge" ({0,0}); none = immature, no policy
  exposures: [{ id, type, underlying, direction, unit, quarterlyNotional, unlockQuarter, description }],
  rates: { [underlying]: number },          // rates at the start of the next quarter
  powerUps: { owned: string[], used: string[] },   // owned: forecasting (once, at level >= 1), facilities, hedgeAccess; used: visibility
  forecastLevel: 0|1|2|3,                   // A9 (R44): forecasting modules bought (replaces varianceMultiplier)
  boardMood: number,                        // 0..100, starts at BALANCE.startMood
  pendingEvent: string|null,                // event id to resolve in the next quarter
  chairmenMet: string[],                    // filled in by RunController (B1); the engine passes it through untouched
  history: QuarterSummary[],
  status: 'playing'|'complete'|'bankrupt'|'fired',
  startedAt: number                         // passed in by the caller, never Date.now() here
}
```

## Decisions (Simple)

```js
{ hedges: { [exposureId]: 0|0.25|0.5|0.75|1 }, buyPowerUp: string|null, eventChoice: string|null,
  proposePolicy?: { min, max } | null }   // A9 (R43): only while run.mandate === null; one of POLICY_OPTIONS
```

`useOptions` is gone (A9, R44: Simple has no options; Pro keeps its own). A hedge ratio outside 0..1 throws. A ratio above
what the exposure allows is clamped, not thrown: the limit is 0 when `isHedgeable` is false, otherwise `hedgeCap(run)`.
`proposePolicy` throws (like `applyPowerUp`) when the board already has a policy, when the band is not one of
`POLICY_OPTIONS`, or in the final quarter (`run.quarter === run.maxQuarters − 1`), where the policy could never apply.
The proposal is adopted after the quarter resolves: this quarter is still judged as no-policy; `run.mandate` and
`run.boardType` are set for the next quarter.

## QuarterSummary (shared with Pro, consumed by score.js)

```js
{ q: number,
  policy: 'in'|'off'|'none',   // A9: 'none' = no-policy board this quarter (Pro emits it too)
  inMandate: boolean|null,     // policy === 'in'; null when policy === 'none'
  playerDelta: number, benchmarkDelta: number,
  marketResult: number,   // Σ(exposureImpact + hedgeImpact + costImpact) this quarter; costImpact is absent/0 in Simple (R54) (excludes baseOcf, events, power-ups)
  breach: 'none'|'lucky'|'loss',   // 'none' if in policy or no policy; else 'lucky' if marketResult ≥ 0, 'loss' if < 0
  severe: boolean,   // A8/R35: breach === 'loss' and marketResult ≤ −BALANCE.severeBreachLossPct × startingCash (fires at once)
  cashAfter: number, benchmarkCashAfter: number, redLine: number, boardMoodAfter: number,
  lines: [{ exposureId, movePct, exposureImpact, hedgeImpact, realisedNotional, forecastNotional,
            costImpact,     // F2/R54: trading costs and premiums (≤ 0), Pro's exposureId 'other' line only; 0 or absent elsewhere
            hedgeRatio,     // A9: the ratio actually applied (after clamping)
            clamped }],     // A9: true when the requested ratio was above the allowed limit
  event: { id, choice } | null, powerUp: string|null,
  policyAdopted: { min, max } | null,   // A9 (R43): the proposal adopted at the end of this quarter
  riskCover: number|null,               // v3.1 Simple only: size-weighted share hedged (policyCover); null when nothing counts
  wrongFocus: boolean,                  // v3.1 Simple only: the biggest exposure under-hedged next to a small one
  exposureValues: { [exposureId]: number },   // v3.1 Simple only: each active exposure's size this quarter
  // v3.2 Simple only: the parts of the cash change (the result screen's breakdown)
  cashBefore: number,      // run.cash before the quarter
  ocf: number,             // BALANCE.baseOcfPct × startingCash
  exposureTotal: number,   // Σ lines[].exposureImpact (the market move on realised volumes)
  hedgeTotal: number,      // Σ lines[].hedgeImpact (on forecast × hedge ratio)
  eventCash: number,       // the event response's cashPct × startingCash; 0 without one
  addOnCost: number }      // the power-up's cost net of Cash Visibility's cash (negative when it pays more); 0 without one
```

v3.2: `cashBefore + ocf + exposureTotal + hedgeTotal + eventCash − addOnCost = cashAfter` (to float precision). Summaries
saved before v3.2 (and every Pro summary) have none of these; the result screen then hides the breakdown.

Summaries saved before v3.1 (and every Pro summary) have no `riskCover`, `wrongFocus` or `exposureValues`; readers
treat them as absent (`wrongFocus` falsy) and never require them.

Interest rates in the market data are decimals (EURIBOR 0.034671 = 3.47%). The IR cash impact is
`−(end − start) × notional × 0.25` (one quarter of interest for a floating-rate payer).

`lines[].movePct`: percent change of the rate for `fx` and `commodity`; for `ir` it is the change in percentage points,
`(end − start) × 100`. A zero or missing start rate (or missing end rate) is no move: `movePct`, `exposureImpact` and
`hedgeImpact` are all 0.

Policy compliance (v3.1, Simple) is size-weighted, through `policyCover` (below):

- **Weight** `w`: `exposureValue(exp, startRate, forecastNotional)` (exposureMath.js), the size in the reporting currency
  of this quarter's forecast notional (after the event's `notionalMult`). FX and commodity notionals are already
  reporting-currency amounts, as `exposureCashImpact` treats them, so `w = |notional|`; floating debt is one quarter
  of interest at the start rate, `w = |notional × rate × 0.25|`. (The quarter screen never shows this interest figure,
  which would reveal the rate level and so the era: the floating-debt card shows the principal instead.)
- **Policy set** `P`: active exposures with forecast ≠ 0, `w > 0`, `isHedgeable`, and a usable (finite) start rate
  (after the I4 seeding). Locked (not yet hedgeable) exposures keep a size for the screen but never count; a weightless
  one (debt at a 0% rate) adds nothing to cover and is left out so it can't be wrong focus's "small one".
- **Cover** `= Σ h·w / Σ w` over `P`, with `h` the applied (clamped) ratio. `null` when `P` is empty.
- **wrongFocus**: within `P` minus floating debt (`ir` counts in cover but is never `L` or `S`, because its card shows
  the principal, not the interest weight), the largest-weight exposure `L` (the first one on a tie) has another `S` with
  `w_L ≥ 2 × w_S` and `h_S − h_L ≥ 0.5` (with 1e-9 slack on the gap). Always false when cover is `null`, and always
  false on a noHedge board (`mandate.max === 0`), where any hedge is the breach and "hedge the big one" is wrong advice.
- **In policy** with a mandate: `cover === null` (vacuous), or `min − 1e-9 ≤ cover ≤ max + 1e-9` and not `wrongFocus`.
  The real band is used even when the cap makes it unreachable (75–100 before `facilities` is off policy). A noHedge
  board (`{0,0}`) needs cover 0, i.e. no hedge on anything that counts, as before.
- **No-policy board:** `wrongFocus` is still reported and picks the board line; it changes nothing in the mood.

Pro (`proAdapter.js`) keeps its own per-exposure compliance from GameLoop and emits none of the v3.1 fields. The no-policy board's hedge result is `Σ lines[].hedgeImpact`.
Costs and premiums are never in `hedgeImpact`; the identity is `Σ (exposureImpact + hedgeImpact + costImpact) = marketResult`.
Pro adds an `exposureId: 'other'` line for hedges with no exposure detail (`hedgeImpact`) and for costs (`costImpact`).

`QuarterResult` (return of `simulateQuarter`): `{ run: RunState, summary: QuarterSummary }`.

## SimEngine (A3)

```js
activeExposures(run) -> Exposure[]            // unlockQuarter <= run.quarter
POLICY_OPTIONS                                // A9: [{0.25,0.5},{0.5,0.75},{0.75,1},{0,0}], the proposals a no-policy board accepts
                                              // (frozen, entries too)
createRun({ industry, seed, startedAt, market, crisisId = null, forcedYear = null }) -> RunState
                                              // RNG order (run seed): start year (no draw with forcedYear), then the board
                                              // (one rng.weightedPick over BALANCE.boards)
simulateQuarter(run, decisions, market, content) -> { run, summary }   // pure; content = { events: SimpleEvent[] }
quarterStartRates(run, market) -> { [underlying]: number }   // run.rates plus the I4 seeding for this quarter (a copy, no RNG)
policyCover(run, hedges, notionalMult = {}) -> { cover: number|null, wrongFocus: boolean, values: { [exposureId]: number } }
                                              // v3.1: the shared policy check (see Policy compliance); run must carry this
                                              // quarter's start rates and any power-up bought now. The quarter screen calls it
                                              // with the same inputs, so its RISK COVERED meter matches the engine
isRunOver(run) -> boolean                     // status !== 'playing'
classifyBreach({ inMandate, marketResult, startingCash }) -> { breach: 'none'|'lucky'|'loss', severe: boolean }
                                              // A8: used by simulateQuarter; F1's Pro adapter imports it
                                              // R38: non-finite marketResult counts as 0; startingCash not finite or <= 0 -> severe false
```

A severe breach is scored as a normal `'loss'` breach (A5 scoring is unchanged).

## BALANCE (A3, `js/engine/sim/balance.js`; A5 points; A7 R34; A8 severeBreachLossPct R35; A9 R40–R44; H R57 baseOcfPct)

```js
{ startMood: 60, fireThreshold: 10, redLinePct: 0.2, baseOcfPct: 0.04, eventChance: 0.35,
  boards: [{ type:'band', min:0.25, max:0.5, weight:0.2 }, { type:'band', min:0.5, max:0.75, weight:0.2 },
           { type:'band', min:0.75, max:1, weight:0.2 }, { type:'noHedge', min:0, max:0, weight:0.15 }, { type:'none', weight:0.25 }],
  mood: { inPolicyGood: 4, inPolicyBad: -2, luckyBreach: 0, breachLoss: -12,
          noPolicyHedgeLoss: -20, noPolicyHedgeWin: 1, noPolicyDrift: -6.25, policyAdopted: 10, beatBenchmark: 3, redZone: -12 },
  severeBreachLossPct: 0.35,
  notionalScale: 5,
  forecast: { baseVariance: 0.4 },
  facilities: { baseHedgeCap: 0.5, borrowPct: 0.1 },
  powerUpCosts: { forecasting: [0.005, 0.01, 0.015], visibility: 0.005, facilities: 0.01, hedgeAccess: 0.01 },   // × startingCash
  points: { inMandate: 100, luckyBreach: 25, breachLoss: -300, aboveRedLine: 50, stability: 100, outperformPerPct: 12,
            survival: 500, policyAdopted: 100 } }
```

`BALANCE.mandates` and `BALANCE.breachLossesToFire` are gone (A9).

## simulateQuarter rules fixed by the contract (A3, A9)

Forecast variance (step 4): `fx` and `commodity` exposures (volume-driven) have
`realised = forecast × (1 + (rng.next()×2−1) × variance)`, with `variance = forecastVariance(run) × the event's
one-quarter varianceMult`. They draw a number even when the variance is 0. `ir` exposures (debt principal, contractual) have
`realised = forecast` exactly and draw no random number. There is no year decay in Simple (A9).

Board mood (step 7, A9 R41/R43), clamped to 0..100:

- `policy === 'none'` (no-policy board, judges the hedge alone): `+mood.noPolicyDrift` every such quarter (R49: it loses
  patience while there is no policy, the proposal quarter included); plus `Σ hedgeImpact < 0` → `+mood.noPolicyHedgeLoss`
  (even if the business gained); `> 0` → `+mood.noPolicyHedgeWin`; `0` → nothing more.
- `policy === 'in'`: `marketResult >= 0` → `+mood.inPolicyGood`; otherwise `+mood.inPolicyBad` (critical, falls slightly).
  A `noHedge` board with 0 hedging everywhere is in policy.
- `breach === 'lucky'` (off policy, good): `+mood.luckyBreach` (mixed, about 0).
- `breach === 'loss'` (off policy, bad): `+mood.breachLoss` (the heaviest criticism).
- `+mood.beatBenchmark` only if `playerDelta > benchmarkDelta` (R49: strictly; an unhedged tie earns nothing);
  `+mood.redZone` if `cashAfter < redLine`.
- `boardMood` is a number (not necessarily an integer, since `noPolicyDrift` is −6.25); round it for display.
- `+mood.policyAdopted` once, in the quarter a proposal is made.

Status (step 9, A9 R40: results decide, not hedging), checked in this order:

1. `cash < −borrowingBuffer(run)` → `'bankrupt'` ("CFO replaced"). Without facilities the buffer is 0.
2. this quarter's `severe` is true → `'fired'` (A8, R35; `classifyBreach` unchanged; never on the no-policy board).
3. `boardMood <= BALANCE.fireThreshold` → `'fired'`.
4. `quarter === 8` → `'complete'`.

The two-strike rule is gone.

## Power-ups and events (A4)

`POWER_UPS`, keyed by id (A9, R44; costs are `BALANCE.powerUpCosts` × startingCash):

- `forecasting`: tiered, up to 3 modules (`run.forecastLevel` 0..3); each costs the next entry of
  `powerUpCosts.forecasting`. Accuracy = 0.4 + 0.2 × level; variance = `forecast.baseVariance × (1 − accuracy) / 0.6`
  (0.40, 0.267, 0.133, 0). A 4th purchase is rejected.
- `visibility`: unchanged. Cost 0.005, single use; adds `+0.03 × startingCash` to the player only.
- `facilities` (bigger bank facilities): one purchase. Hedge cap 0.5 → 1.0 and borrowing buffer 0 → `0.10 × startingCash`.
- `hedgeAccess` (interest-rate and commodity hedging): one purchase, only when the industry has an `ir` or `commodity`
  exposure (`canBuyPowerUp` is false otherwise). Before it, `ir` and `commodity` exposures can't be hedged.
- `options` is removed from Simple (Pro keeps its own options product).

A power-up bought in a quarter's decisions applies to that quarter's hedges.

```js
// powerUps.js exports for the Simple UI (B) and SimEngine
POWER_UP_IDS                       // ['forecasting', 'visibility', 'facilities', 'hedgeAccess']
powerUpCost(run, id) -> number     // the next purchase's cost (forecasting: next module); Infinity at forecasting level 3
forecastAccuracy(run) -> 0.4|0.6|0.8|1
forecastVariance(run) -> number    // 0.40, 0.267, 0.133, 0
hedgeCap(run) -> 0.5|1
borrowingBuffer(run) -> number     // 0, or 0.10 × startingCash with facilities
isHedgeable(run, exposure) -> boolean   // fx always; ir/commodity only with hedgeAccess
maxHedgeRatio(run, exposure) -> number  // isHedgeable ? hedgeCap : 0 (the clamp SimEngine applies)
```

```js
canBuyPowerUp(run, id, unlockedIds) -> boolean
applyPowerUp(run, id) -> run
rollEvent(run, events, rng) -> string|null   // selects only (weighted, ids not yet seen this run); SimEngine applies
                                             // rng.chance(BALANCE.eventChance) first and never rolls once the run is over
applyEventChoice(run, event, choiceId) -> { run, quarterNotionalMult, quarterVarianceMult }   // unknown choiceId throws

// SimpleEvent (JSON)
{ id, pool: 'business'|'conference', weight, title, text,
  choices: [{ id, label, quip,
              effects: { cashPct?, mood?, varianceMult?, notionalMult?: { [exposureId]: number } } }] }
```

`cashPct`: fraction of `startingCash`, applied to both player and benchmark. `mood`: player only. `notionalMult`: this quarter's forecast notional, both sides.

## Scoring (A5, `score.js`)

```js
quarterPoints(summary, startingCash) -> number
  // sums: BALANCE.points.inMandate (100) when in policy (policy === 'in'; a summary without `policy` falls back to
  // inMandate === true), so a no-policy quarter (policy 'none', inMandate null, breach 'none') earns none;
  // luckyBreach (25) when 'lucky'; breachLoss (-300) when 'loss'; aboveRedLine (50) when cashAfter >= redLine;
  // policyAdopted (100) once when summary.policyAdopted is set; plus the stability bonus
finalScore({ history, status, startingCash, boardMood }, gameOverTitles?) ->
  { total: number, breakdown: { quarters, outperformance, survival, moodMultiplier }, title: string }
SCORE_MAX = 10000
```

`title` is looked up from `gameOverTitles` in `data/quips.json` (injected as the optional 2nd argument; defaults to `''`).

## Progress and save format (A6)

```js
// Progress
{ version: 3, runs: number, best: { simple: number, pro: number },
  unlocked: string[], chairmenMet: string[], crisisBadges: string[] }

emptyProgress() -> Progress      // unlocked: ['industry:airline','industry:agrifoods','industry:retail',
                                 //   'powerup:forecasting','powerup:facilities','powerup:hedgeAccess'] (A9: facilities and
                                 //   hedgeAccess gate core play, so they are free from run 1)
UNLOCK_RULES                     // mode:pro: first completed run (R32); industry:construction best.simple>=1500; industry:pharma runs>=3;
                                 // industry:tech best.simple>=2500; industry:energy runs>=6; powerup:visibility runs>=2;
                                 // crisis:* runs>=4 (A9: powerup:options removed)
applyRunToProgress(progress, { mode, score, chairmenMet, crisisId, status }) -> { progress, newlyUnlocked: string[], isPersonalBest: boolean }
mergeProgress(a, b) -> Progress  // max of runs and each best; ordered union of arrays (a first); tolerates missing/partial a or b; output is always version 3
CRISES                           // each { id, label, forcedYear, industryId }; unranked (never submitted to leaderboard)
                                 // gfc2008 2008 airline; brexit2016 2016 retail; covid2020 2020 airline; energy2022 <=2021 construction
// Run status (R32): every finished run (complete, bankrupt, fired) counts toward `runs`; every non-crisis run may
// set best[mode] whatever its status; mode:pro unlocks only when a run finishes with status 'complete'
// (checked in applyRunToProgress, no extra Progress field). Crisis runs count toward `runs` but never set best.
serialiseSave(run) -> string
parseSave(str) -> RunState|null  // null on bad JSON or version !== 3
```

## Pixel scenes (C1)

```js
// SceneState
{ mood: 'calm'|'storm'|'boom', cashLevel: number /* 0..1 */, highlight: string|null /* underlying that moved most */ }

drawScene(ctx, industryId, sceneState, tMs) -> void       // pure drawing, no internal timers
new SceneLoop(canvas, getState: () => ({ industryId, sceneState }))   // .start(), .stop(); single rAF loop; pauses on document.visibilitychange
// each scenes/<name>.js exports: draw(px, sceneState, tMs)
// PixelCanvas: rect(x,y,w,h,c), pixel(x,y,c), sprite(map, x, y, paletteMap), blitTo(ctx, scale)
// industry id -> scene file follows industries.json (airline -> airport, etc.)
```

## Sprites (C2)

```js
drawSprite(ctx, spriteId, expression /* 'neutral'|'happy'|'angry' */, x, y, scale) -> void
spriteIdForMember(member, index) -> string      // archetype from member.personality (aggressive|cautious|operational)
CHAIRMAN_SPRITES                                // ids: jameson, musk, oleary, dimon, buffett, jobs, dorsey, ackman;
                                                // v3.2: label = the Pro parody name (BoardAI.getCEODisplayName)
```

## Quips (D1, v3.2; `data/quips.json`)

```json
{ "result": { "nearBankrupt": [], "overHedged": [], "bigSave": [], "bigMiss": [], "boom": [], "storm": [], "calm": [] },
  "board": { "aggressive": { "moodUp": [], "moodDown": [], "redZone": [], "overLucky": [], "underLucky": [],
                             "overLoss": [], "underLoss": [], "inPolicyBad": [], "noPolicyHedgeLoss": [],
                             "noPolicyHedgeWin": [], "noPolicyNudge": [], "policyAdopted": [], "wrongFocus": [],
                             "luckyBreach": [], "breachLoss": [] },
             "cautious": { "...": "the same keys" }, "operational": { "...": "the same keys" } },
  "chairman": { "jameson": { "positive": [], "negative": [], "offPolicy": { "over": [], "under": [] } },
                "...": "musk, oleary, dimon, buffett, jobs, dorsey, ackman: the same shape" },
  "gameOverTitles": [ { "min": 0, "title": "", "line": "" } ],
  "bankrupt": [], "fired": [], "boardIntro": { "band": [], "noHedge": [], "none": [] } }
```

Every string is 90 characters or fewer, unique in the file, and follows the anti-AI-style checklist (no em dashes; only
Jameson and ElonUsk use exclamation marks). `gameOverTitles` is sorted by `min` and starts at 0. Simple's result and
board pools hold at least 8 lines (one per quarter); each chairman has at least 8 `positive`, 8 `negative` and 6
`offPolicy` lines each way. `luckyBreach` and `breachLoss` are Pro's direction-free breach lines (Pro summaries carry no
band or cover); Simple never uses them.

The outcome (v3.2, `outcomeFor(summary, startingCash, mandate)` in RunController.js):

- `policyState`: `adopted` (a proposal this quarter) | `wrongFocus` | `none` | `in` | `over` | `under` (an off-policy
  quarter's `riskCover` above the band's max, or below it; a noHedge board's breach is always `over`). `off` only when
  the direction is unknown (no band given, or no `riskCover`, as on Pro).
- `quarter`: `good` | `bad` | `flat`, `marketResult` (exposures plus hedges) against ±0.5% of starting cash.
- `hedge`: `won` | `lost` | `none`, `Σ lines[].hedgeImpact` against ±0.5% of starting cash.

Result-quip selection (v3.2), first match wins. The quip is about the market and the hedge only, never the board, the
policy or luck, so it can't contradict the facts line:

1. `nearBankrupt`: `cashAfter < redLine`.
2. `overHedged`: any line with `lines[].hedgeRatio × forecastNotional > 1.15 × realisedNotional` (`hedgeRatio` is the
   applied ratio after clamping, not the requested one).
3. `bigSave` when the hedge `won`; `bigMiss` when it `lost`.
4. `boom` for a `good` quarter, `storm` for a `bad` one, and `calm` only for a `flat` quarter with no hedge result.

Board line selection (B1; v3.2 `boardLineKey(summary, moodBefore, mandate)`). First match wins:

1. `summary.policyAdopted` set → `policyAdopted` (the board welcomes the proposal).
1a. `summary.wrongFocus === true` → `wrongFocus` (v3.1: the small thing hedged far more than the big one), on a band or
   no-policy board (never set on a noHedge board). The chairman yields to it. Angry when the quarter was also a losing
   breach or, on a no-policy board, a hedge loss; otherwise neutral.
2. `policy === 'none'` → `noPolicyHedgeLoss` if `Σ lines[].hedgeImpact < 0`; `noPolicyHedgeWin` if `> 0`; otherwise
   `noPolicyNudge` (no hedge: the board presses for a policy).
3. `breach === 'loss'` → `overLoss` or `underLoss` by the breach's direction (`breachLoss` when it is unknown, as on
   Pro). A heavy, scathing telling-off that names the breach; the angry sprite always wins over other moods.
4. `breach === 'lucky'` → `overLucky` or `underLucky` (`luckyBreach` when unknown): mixed, and it names the breach
   ("you went past the board's limit", "you hedged less than the board asked for") rather than leaning on luck.
5. `policy === 'in'` and `marketResult < 0` → `inPolicyBad`: critical but mild.
6. Otherwise `redZone` (`cashAfter < redLine`), `moodUp` or `moodDown` by mood change.

The chairman (`chairmanAppears`: Q1, Q4, Q8, or a gap to the benchmark above 3% of starting cash) speaks instead of the
board member, in the tone `chairmanTone(key, outcome, cashAfter < redLine)` gives:

- he yields to `policyAdopted`, `wrongFocus` and the losing breaches (`overLoss`, `underLoss`, `breachLoss`);
- cash under the red line (`cashAfter < redLine`, the `nearBankrupt` quip's test) is always `negative` (angry sprite),
  on any board and for any key he speaks to, whatever the market did, so he never cheers beside a `nearBankrupt` quip;
- on `overLucky` and `underLucky` he speaks only an `offPolicy.over` or `offPolicy.under` line, which names the breach
  (neutral sprite); on Pro's direction-free `luckyBreach` he yields;
- otherwise `positive` (happy sprite) on a `good` quarter and `negative` (angry sprite) on a `bad` one; on a `flat` quarter
  `negative` for `inPolicyBad`, `noPolicyHedgeLoss` and `moodDown`, `positive` for the rest.
- His `positive` and `negative` lines never presume hedges (they also fire with none, on a no-policy or noHedge board)
  and never blame the player's process (they fire on in-policy losses); `negative` lines complain about the quarter or
  the market. `offPolicy.under` lines fit partial cover, and `offPolicy.over` lines fit a few points over the cap.

No repeats (v3.2): each pool (`result.<key>`, `board.<personality>.<key>`, `chairman.<id>.<tone>`,
`chairman.<id>.offPolicy.<dir>`) has its own permutation, seeded by the run seed and the pool id (`linePick`), and a
quarter takes the line at its pool's use count, recomputed from `run.history` (`quarterFeedback`). The same saved run
therefore shows the same lines after RESUME, and no line repeats in a run while its pool has unused lines. The chairman
yields to the board when his pool for the tone has no unused line left. All of this is cosmetic (`cosmeticRng`), never
the simulation RNG.

Tone: `overLucky`/`underLucky` are mixed (some praise, some criticism); `overLoss`/`underLoss` are the harshest in the
game (the board is furious, with HR hints). A9: an in-policy loss is critical but mild; the no-policy board is
hyper-focused on the hedge's own P&L (`Σ lines[].hedgeImpact`) and hardest to please, and the player's first step there
is to propose a policy. `fired` follows from overall results: a sinking board mood, or one severe off-policy loss (A8).
Running out of cash is `bankrupt` ("CFO replaced").

## Events and power-ups (A4)

`applyEventChoice(run, event, choiceId) -> { run, quarterNotionalMult, quarterVarianceMult }`. `varianceMult` and `notionalMult` last only for the quarter the event resolves in (R21); `notionalMult` keys naming an exposure the industry lacks are ignored. `rollEvent(run, events, rng)` only selects an unseen event by weight (SimEngine rolls the chance). Fixture/content shape: `{ events: SimpleEvent[] }`. `visibility` is single use per run (recorded in `powerUps.used`); `forecasting` (once, with `run.forecastLevel` counting
modules), `facilities` and `hedgeAccess` go in `powerUps.owned`.
