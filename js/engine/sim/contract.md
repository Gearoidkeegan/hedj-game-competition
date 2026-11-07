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
  mandate: { min: number, max: number },
  exposures: [{ id, type, underlying, direction, unit, quarterlyNotional, unlockQuarter, description }],
  rates: { [underlying]: number },          // rates at the start of the next quarter
  powerUps: { owned: string[], used: string[] },
  varianceMultiplier: number,               // 1, reduced by the forecasting power-up
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
{ hedges: { [exposureId]: 0|0.25|0.5|0.75|1 }, useOptions: boolean, buyPowerUp: string|null, eventChoice: string|null }
```

## QuarterSummary (shared with Pro, consumed by score.js)

```js
{ q: number, inMandate: boolean, playerDelta: number, benchmarkDelta: number,
  marketResult: number,   // Σ(exposureImpact + hedgeImpact) − option premiums this quarter (excludes baseOcf, events, power-ups)
  breach: 'none'|'lucky'|'loss',   // 'none' if inMandate; else 'lucky' if marketResult ≥ 0, 'loss' if marketResult < 0
  severe: boolean,   // A8/R35: breach === 'loss' and marketResult ≤ −BALANCE.severeBreachLossPct × startingCash (fires at once)
  cashAfter: number, benchmarkCashAfter: number, redLine: number, boardMoodAfter: number,
  lines: [{ exposureId, movePct, exposureImpact, hedgeImpact, realisedNotional, forecastNotional }],
  event: { id, choice } | null, powerUp: string|null }
```

Interest rates in the market data are decimals (EURIBOR 0.034671 = 3.47%). The IR cash impact is
`−(end − start) × notional × 0.25` (one quarter of interest for a floating-rate payer).

`lines[].movePct`: percent change of the rate for `fx` and `commodity`; for `ir` it is the change in percentage points,
`(end − start) × 100`. A zero or missing start rate (or missing end rate) is no move: `movePct`, `exposureImpact` and
`hedgeImpact` are all 0.

`inMandate` is vacuously true when no active exposure has a non-zero notional (every current industry has one from Q1).

`QuarterResult` (return of `simulateQuarter`): `{ run: RunState, summary: QuarterSummary }`.

## SimEngine (A3)

```js
activeExposures(run) -> Exposure[]            // unlockQuarter <= run.quarter
createRun({ industry, seed, startedAt, market, crisisId = null, forcedYear = null }) -> RunState
simulateQuarter(run, decisions, market, content) -> { run, summary }   // pure; content = { events: SimpleEvent[] }
isRunOver(run) -> boolean                     // status !== 'playing'
classifyBreach({ inMandate, marketResult, startingCash }) -> { breach: 'none'|'lucky'|'loss', severe: boolean }
                                              // A8: used by simulateQuarter; F1's Pro adapter imports it
```

A severe breach is scored as a normal `'loss'` breach (A5 scoring is unchanged).

## BALANCE (A3, `js/engine/sim/balance.js`; A5 adds `points`; A7 tuned values, R34; A8 adds `severeBreachLossPct`, R35)

```js
{ startMood: 60, fireThreshold: 10, redLinePct: 0.2, baseOcfPct: 0.05, eventChance: 0.35,
  mandates: [{min:0.25,max:0.5},{min:0.5,max:0.75},{min:0.75,max:1}],
  mood: { inMandate: 4, luckyBreach: -3, breachLoss: -25, beatBenchmark: 3, redZone: -12 },
  breachLossesToFire: 2,
  severeBreachLossPct: 0.35,
  notionalScale: 6,
  points: { inMandate: 100, luckyBreach: 25, breachLoss: -300, aboveRedLine: 50, stability: 100, outperformPerPct: 12, survival: 500 } }
```

## simulateQuarter rules fixed by the contract (A3)

Forecast variance (step 4): `fx` and `commodity` exposures (volume-driven) have
`realised = forecast × (1 + (rng.next()×2−1) × variance)`. `ir` exposures (debt principal, contractual) have
`realised = forecast` exactly and draw no random number.

Board mood (step 7), clamped to 0..100:

- `breach === 'none'`: `+BALANCE.mood.inMandate`.
- `breach === 'lucky'`: `+BALANCE.mood.luckyBreach` (a mild telling-off).
- `breach === 'loss'`: `+BALANCE.mood.breachLoss` (a heavy telling-off).
- `+BALANCE.mood.beatBenchmark` if `playerDelta >= benchmarkDelta`.
- `+BALANCE.mood.redZone` if `cashAfter < redLine`.

Status (step 8), checked in this order:

1. `cash <= 0` -> `'bankrupt'`.
2. this quarter's `severe` is true -> `'fired'` (A8, R35: one particularly bad losing breach fires at once).
3. the run's count of `breach === 'loss'` quarters reaches `BALANCE.breachLossesToFire` -> `'fired'`.
4. `boardMood <= BALANCE.fireThreshold` -> `'fired'`.
5. `quarter === 8` -> `'complete'`.

## Power-ups and events (A4)

`POWER_UPS`, keyed by id (exact object shape is defined by Task A4):

- `forecasting`: cost `0.01 × startingCash`; sets `varianceMultiplier = 0.5` permanently.
- `visibility`: cost `0.005 × startingCash`, single use; adds `+0.03 × startingCash` to the player only.
- `options`: cost `0.005 × startingCash`; unlocks `useOptions`.

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
  // sums: BALANCE.points.inMandate (100) when breach === 'none'; luckyBreach (25) when 'lucky';
  // breachLoss (-300) when 'loss'; aboveRedLine (50) when cashAfter >= redLine; plus the stability bonus
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

emptyProgress() -> Progress      // unlocked: ['industry:airline','industry:agrifoods','industry:retail','powerup:forecasting']
UNLOCK_RULES                     // mode:pro: first completed run (R32); industry:construction best.simple>=1500; industry:pharma runs>=3;
                                 // industry:tech best.simple>=2500; industry:energy runs>=6; powerup:visibility runs>=2;
                                 // powerup:options best.simple>=2000; crisis:* runs>=4
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
CHAIRMAN_SPRITES                                // ids: jameson, musk, oleary, dimon, buffett, jobs, dorsey, ackman
```

## Quips (D1, `data/quips.json`)

```json
{ "result": { "bigSave": [], "bigMiss": [], "overHedged": [], "nearBankrupt": [], "calm": [], "boom": [] },
  "board": { "aggressive": { "moodUp": [], "moodDown": [], "redZone": [], "luckyBreach": [], "breachLoss": [] },
             "cautious":   { "moodUp": [], "moodDown": [], "redZone": [], "luckyBreach": [], "breachLoss": [] },
             "operational":{ "moodUp": [], "moodDown": [], "redZone": [], "luckyBreach": [], "breachLoss": [] } },
  "chairman": { "jameson": [], "musk": [], "oleary": [], "dimon": [], "buffett": [], "jobs": [], "dorsey": [], "ackman": [] },
  "gameOverTitles": [ { "min": 0, "title": "", "line": "" } ],
  "bankrupt": [], "fired": [] }
```

Every string is 90 characters or fewer. `gameOverTitles` is sorted by `min` and starts at 0.

Result-quip selection rules (B3):

- `bigSave`: total `hedgeImpact` > 2% of starting cash.
- `bigMiss`: `benchmarkDelta - playerDelta` > 2% of starting cash.
- `overHedged`: any line with `h * forecast > 1.15 * realised`.
- `nearBankrupt`: `cashAfter < redLine`.
- otherwise `calm`, or `boom` on a large favourable move.

Board line selection (B1): `breach === 'loss'` -> `breachLoss`. This is a heavy, scathing telling-off, and the angry sprite always wins over other moods. `breach === 'lucky'` -> `luckyBreach`: a grudging "it worked, but don't do that again". Otherwise `redZone`, `moodUp` or `moodDown` by mood change.

Tone: `luckyBreach` is mild and wry; `breachLoss` is the harshest in the game (the board is furious, with HR hints). The `fired` lines follow from repeated losing breaches (or one severe one, A8).

## Events and power-ups (A4)

`applyEventChoice(run, event, choiceId) -> { run, quarterNotionalMult, quarterVarianceMult }`. `varianceMult` and `notionalMult` last only for the quarter the event resolves in (R21); `notionalMult` keys naming an exposure the industry lacks are ignored. `rollEvent(run, events, rng)` only selects an unseen event by weight (SimEngine rolls the chance). Fixture/content shape: `{ events: SimpleEvent[] }`. `visibility` is single use per run (recorded in `powerUps.used`); `forecasting` and `options` go in `powerUps.owned`.
