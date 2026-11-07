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
  cashAfter: number, benchmarkCashAfter: number, redLine: number, boardMoodAfter: number,
  lines: [{ exposureId, movePct, exposureImpact, hedgeImpact, realisedNotional, forecastNotional }],
  event: { id, choice } | null, powerUp: string|null }
```

`QuarterResult` (return of `simulateQuarter`): `{ run: RunState, summary: QuarterSummary }`.

## SimEngine (A3)

```js
activeExposures(run) -> Exposure[]            // unlockQuarter <= run.quarter
createRun({ industry, seed, startedAt, market, crisisId = null, forcedYear = null }) -> RunState
simulateQuarter(run, decisions, market, content) -> { run, summary }   // pure; content = { events: SimpleEvent[] }
isRunOver(run) -> boolean                     // status !== 'playing'
```

## BALANCE (A3, `js/engine/sim/balance.js`; A5 adds `points`; A7 tunes)

```js
{ startMood: 60, fireThreshold: 10, redLinePct: 0.2, baseOcfPct: -0.03, eventChance: 0.35,
  mandates: [{min:0.25,max:0.5},{min:0.5,max:0.75},{min:0.75,max:1}],
  mood: { inMandate: 4, outMandate: -10, beatBenchmark: 3, redZone: -12 },
  notionalScale: 1,
  points: { inMandate: 100, aboveRedLine: 50, stability: 100, outperformPerPct: 40, survival: 500 } }
```

## Power-ups and events (A4)

```js
POWER_UPS = {                                   // keyed by id
  forecasting: { cost: 0.01  * startingCash },  // varianceMultiplier = 0.5 permanently
  visibility:  { cost: 0.005 * startingCash },  // single use; +0.03 * startingCash to player only
  options:     { cost: 0.005 * startingCash }   // unlocks useOptions
}
canBuyPowerUp(run, id, unlockedIds) -> boolean
applyPowerUp(run, id) -> run
rollEvent(run, events, rng) -> string|null
applyEventChoice(run, event, choiceId) -> { run, quarterNotionalMult }   // unknown choiceId throws

// SimpleEvent (JSON)
{ id, pool: 'business'|'conference', weight, title, text,
  choices: [{ id, label, quip,
              effects: { cashPct?, mood?, varianceMult?, notionalMult?: { [exposureId]: number } } }] }
```

`cashPct`: fraction of `startingCash`, applied to both player and benchmark. `mood`: player only. `notionalMult`: this quarter's forecast notional, both sides.

## Scoring (A5, `score.js`)

```js
quarterPoints(summary, startingCash) -> number
finalScore({ history, status, startingCash, boardMood }, gameOverTitles = []) ->
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
UNLOCK_RULES                     // mode:pro runs>=1; industry:construction best.simple>=1500; industry:pharma runs>=3;
                                 // industry:tech best.simple>=2500; industry:energy runs>=6; powerup:visibility runs>=2;
                                 // powerup:options best.simple>=2000; crisis:* runs>=4
applyRunToProgress(progress, { mode, score, chairmenMet, crisisId, status }) -> { progress, newlyUnlocked: string[], isPersonalBest: boolean }
mergeProgress(a, b) -> Progress  // max of runs and each best; union of arrays
CRISES                           // each { id, label, forcedYear, industryId }; unranked (never submitted to leaderboard)
                                 // gfc2008 2008 airline; brexit2016 2016 retail; covid2020 2020 airline; energy2022 <=2021 construction
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
  "board": { "aggressive": { "moodUp": [], "moodDown": [], "redZone": [], "mandateBreach": [] },
             "cautious":   { "moodUp": [], "moodDown": [], "redZone": [], "mandateBreach": [] },
             "operational":{ "moodUp": [], "moodDown": [], "redZone": [], "mandateBreach": [] } },
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
