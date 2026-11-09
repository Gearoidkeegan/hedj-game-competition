# Treasury Game v3 (Conference Edition) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the competition game into a ~3-minute, 8-quarter, phone-first run with a cash runway meter, a
one-dial Simple mode, a Pro mode, per-player progress and unlocks, code-drawn pixel art, punchier humour, and a
per-event best-per-player leaderboard. It must be safe to run on competition.hedj.eu.

**Architecture:**
- **Simple-mode engine:** a new pure, DOM-free simulation in `js/engine/sim/` (state in → state out,
  JSON-serialisable, deterministic per seed). It runs in the browser and in Node for tests and the balance simulator.
- **Pro mode:** keeps the existing singleton engines (`GameLoop`, `GameState`), with bugs fixed. It is scored by
  the same `sim/score.js` through an adapter.
- **UI:** new Simple screens under `js/screens/simple/`.
- **Graphics:** code-drawn pixel graphics under `js/ui/pixel/`.
- **Backend:** the SAM backend gains per-event best-per-player boards and a progress endpoint, behind
  dependency-injected handlers so they can be unit-tested.

**Tech Stack:**
- Frontend: vanilla ES modules with no build step, Canvas 2D, a service worker.
- Backend: Node 20, AWS SAM (HTTP API, Lambda, DynamoDB), `@aws-sdk/lib-dynamodb` v3.
- Tests: `node --test` (Node ≥ 20).

**Spec:** `docs/superpowers/specs/2026-11-06-v3-conference-edition-design.md`

## Global Constraints

- **No build step and no new frontend runtime dependencies.** Plain ES modules loaded by `index.html`.
- **Backend:** Node 20 and `@aws-sdk/client-dynamodb` / `@aws-sdk/lib-dynamodb` v3 only.
- **Runs:** a Simple run is exactly 8 quarters maximum. Career mode and Quick Play extensions are removed.
- **Purity:** `js/engine/sim/**` must not touch `window`, `document`, `localStorage`, `fetch`, `Math.random` or
  `Date.now`. All randomness comes from `SeededRandom` seeded from the run seed.
- **Copy length:** every board, chairman and result quip is 90 characters or fewer.
- **Readability on phones:** no visible text below 12 px at widths ≤ 768 px. VT323 for body text, Press Start 2P for
  headings only.
- **Page weight:** under 1.5 MB transferred on first load. The scene PNGs are deleted.
- **Escaping:** every player-supplied string (name, company) is rendered with `escapeHtml` or `textContent`. Never
  interpolate it raw into `innerHTML`.
- **Market data:**
  - Start years only where every active underlying has real monthly data for the whole run.
  - The synthetic `SOFR` and `SONIA` series are not used.
- **Copy:** British English ("realised", "favour").
- **Cross-origin access (CORS):** only `https://competition.hedj.eu` plus `http://localhost:8080` for development.
- **Hosting:** v3 replaces competition.hedj.eu, and the event is selected by an `EVENT_ID` backend parameter.

## Review Focus

1. **Resuming a save from an older build** (`version` mismatch or a corrupt JSON save): the title screen offers
   PLAY, not RESUME, and the bad save is cleared without throwing. Test owner: Task A6.
2. **Shared stand device:** player B registers after player A left a run mid-way. B must not see A's RESUME,
   personal best or unlocks. Test owner: Task E2.
3. **Offline at game over, then the token expires before reconnecting:** queued scores are kept (up to 20) and
   submitted after the player re-registers. Test owner: Task E2.
4. **Start year where an underlying has a data gap** (DAIRY starts 2006, JETNWE needs Brent from 2007-08): the
   year chooser never returns a year missing data for any exposure that unlocks during the run. Test owner: Task A1.
5. **Names with HTML, emoji or over 20 characters:** the server rejects anything longer than 20 characters or with
   `<>"'&` and accepts emoji and accented letters. The client shows names as text everywhere. Test owners: Task E1-2
   (server) and Task E2 (client).

---

## Execution order and parallelism

```
Task 0 (lead)
  ├─ Stream A: A1 → A2 → A3 → A4 → A5 → A6 → A7      (engine)
  ├─ Stream C: C1 → C2 → C3                          (graphics)
  ├─ Stream D: D1 → D2                               (content)
  └─ Stream E1: E1-1 → E1-2 → E1-3                   (backend)
then (after A5, plus C1 and D1 for B):
  ├─ Stream B: B1 → B2 → B3 → B4                     (Simple UI)
  ├─ Stream F: F1 → F2                               (Pro mode)
  └─ Stream E2                                       (client wiring)
then G (PWA/perf) → H (balance, playtest, docs, cutover)
```

Each stream works only in the files its tasks list.

If time is short, cut in this order:
1. C3 (cutscenes)
2. crisis scenarios (part of A6)
3. F2 (Pro polish)
4. the stand page (part of E1-3)

---

### Task 0: Branch, test harness, and the contract

**Files:**
- Create: `package.json` (repo root), `tests/helpers/loadData.js`, `js/engine/sim/contract.md`
- Rename: `tools/fetch-market-data.js` → `tools/fetch-market-data.cjs` (done in Task 0) (it uses `require`; the root becomes `"type": "module"`)

**Interfaces:**
- Produces:
  - `loadMarketData() → { fx, rates, commodities }` (raw JSON from `data/market/*.json`)
  - `loadIndustries() → Industry[]` (from `data/industries.json` `.industries`)
  - `loadJson(relPath) → any`

  All in `tests/helpers/loadData.js`, read with `fs`, paths relative to the repo root.

- [ ] **Step 1:** Make sure you're on branch `v3-conference-edition` (already created).
- [ ] **Step 2:** Create the root `package.json`: `{"name":"hedj-game-v3","private":true,"type":"module","scripts":{"test":"node --test tests/ backend/test/","simulate":"node tools/simulate.js"}}`.
- [ ] **Step 3:** Write `tests/helpers/loadData.js` and the smoke test `tests/harness.test.js`. It asserts that
  `loadIndustries().length === 7` and that `loadMarketData().fx.EURUSD` has a `'2008-01-01'` key (after the
  existing `stripMeta` logic; replicate it in the helper by deleting a `_meta` key if one is present).
- [ ] **Step 4:** Run `npm test`. Expected: PASS (1 test).
- [ ] **Step 5:** Write `js/engine/sim/contract.md`. Copy the exact `RunState`, `Decisions`, `QuarterResult`,
  `QuarterSummary`, `SceneState` and quip-key shapes from the Interfaces blocks of Tasks A3, A5, C1 and D1. Every
  stream reads this file first.
- [ ] **Step 6:** Commit: `git add -A && git commit -m "chore(v3): test harness, contract, root package"`

---

## Stream A — Engine (`js/engine/sim/`, `js/engine/MarketEngine.js`, `data/industries.json`, `tools/simulate.js`)

### Task A1: Market data in Node, and real-data start years

**Files:**
- Modify: `js/engine/MarketEngine.js` (split `loadData` so the parsing goes into a new method)
- Modify: `data/industries.json`. Delete the `floating-debt` exposures whose underlying is `SOFR` or `SONIA` (tech, energy, retail).
- Create: `js/engine/sim/startYears.js`
- Test: `tests/sim/startYears.test.js`

**Interfaces:**
- Produces:
  - `marketEngine.loadFromObjects({ fx, rates, commodities }) → void`. Sets the datasets, derives JETNWE, and sets
    `loaded = true`. `loadData()` now fetches and then calls this.
  - `marketEngine.getRate(underlying, year, quarter)` is unchanged.
  - `pickStartYear(market, exposures, rng, { quarters = 8, forcedYear = null }) → { year: number, quarter: 1 }`.
    It picks uniformly from `eligibleStartYears(...)`, or returns `forcedYear` when that year is eligible (otherwise
    it throws).
  - `eligibleStartYears(market, exposures, quarters = 8) → number[]`. Returns every year Y where, for every exposure
    `e`, `market.getRate(e.underlying, …)` is non-null at the exact month key (not the nearest-date fallback) for each
    quarter from `Y Q1 + e.unlockQuarter` through `Y Q1 + quarters`.
  - Also export `hasExactRate(market, underlying, year, quarter) → boolean`.

- [ ] **Step 1: Write the failing tests** in `tests/sim/startYears.test.js`:
  - `eligible years for airline exclude 2006 (no JETNWE)`: `eligibleStartYears(m, airline.exposures)` does not
    include `2006` and does include `2010`.
  - `agrifoods requires DAIRY from Q6`: no eligible year is below `2005`.
  - `no industry uses SOFR or SONIA`: every exposure in `loadIndustries()` has `underlying` not in `['SOFR','SONIA']`.
  - `pickStartYear is deterministic per seed`: two calls with `new SeededRandom(42)` return the same year.
  - `forcedYear outside eligibility throws`: `pickStartYear(m, airline.exposures, rng, {forcedYear: 1995})` throws.
- [ ] **Step 2:** Run `node --test tests/sim/startYears.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `loadFromObjects` and `startYears.js`, and edit `industries.json` as described.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(sim): real-data start years; drop synthetic SOFR/SONIA exposures`

### Task A2: Exposure and hedge cash maths

**Files:**
- Create: `js/engine/sim/exposureMath.js`
- Test: `tests/sim/exposureMath.test.js`

**Interfaces:**
- Consumes: the conventions in `computeBudgetRate` (`MarketEngine.js:8-23`) and `GameLoop.calculateQuarterlyPnL`
  (`GameLoop.js:122-158`). This task must match their signs.
- Produces:
  - `exposureCashImpact(exp, startRate, endRate, notional) → number`. This is the home-currency cash effect of the
    rate move on `notional`.
    - **FX and commodity:** `ratio = (end − start) / start`; `buy` → `−ratio × notional`, `sell` → `+ratio × notional`.
      Then invert the sign for FX when `exp.underlying.endsWith(exp.unit)`, exactly as `GameLoop.js:150-156` does.
    - **IR** (`type === 'ir'`, floating-rate payer): `−(end − start) / 100 × notional × 0.25` (rates are in percent).
  - `hedgeCashImpact(exp, startRate, endRate, hedgedNotional, product) → number`.
    - `product === 'forward'`: exactly `−exposureCashImpact(exp, startRate, endRate, hedgedNotional)`.
    - `product === 'option'`: `max(0, that value)`, i.e. it pays only when the move hurts the exposure.
  - `optionPremium(hedgedNotional) → number`: `0.015 × hedgedNotional`.

- [ ] **Step 1: Write the failing tests:**
  - `EUR airline, fuel buy, JETNWE +10% on 100 → −10`.
  - `EUR firm, EURUSD usd-revenue (unit USD, sell), EURUSD +10% on 100 → −10` (a stronger euro cuts USD revenue).
  - `USD tech, EURUSD eur-revenue (unit EUR, sell), EURUSD +10% on 100 → +10`.
  - `IR floating payer, 3.0 → 4.0 on 400 → −1`.
  - `100% forward hedge nets to zero`: `exposureCashImpact + hedgeCashImpact(…,'forward') === 0` for every case above.
  - `option pays only adverse`: for the fuel case with `endRate` below `startRate`, `hedgeCashImpact(…,'option') === 0`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the three exported functions.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(sim): exposure and hedge cash maths`

### Task A3: `SimEngine`: run creation and quarter simulation (cash runway, benchmark, board mood)

**Files:**
- Create: `js/engine/sim/balance.js` (every tunable number, exported as `BALANCE`), `js/engine/sim/SimEngine.js`
- Test: `tests/sim/SimEngine.test.js`

**Interfaces:**
- Consumes: A1 `pickStartYear`, A2 maths, `SeededRandom` (`js/utils/random.js`), and
  `forecastEngine.getEffectiveVariance(yearOffset, 0)` (`ForecastEngine.js:20`, pure).
- Produces (this exact shape goes into `contract.md`):

```js
// RunState (JSON-serialisable)
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
// Decisions (Simple)
{ hedges: { [exposureId]: 0|0.25|0.5|0.75|1 }, useOptions: boolean, buyPowerUp: string|null, eventChoice: string|null }
// QuarterSummary (shared with Pro, consumed by score.js)
{ q: number, inMandate: boolean, playerDelta: number, benchmarkDelta: number,
  marketResult: number,   // Σ(exposureImpact + hedgeImpact) − option premiums this quarter (excludes baseOcf, events, power-ups)
  breach: 'none'|'lucky'|'loss',   // 'none' if inMandate; else 'lucky' if marketResult ≥ 0, 'loss' if marketResult < 0
  cashAfter: number, benchmarkCashAfter: number, redLine: number, boardMoodAfter: number,
  lines: [{ exposureId, movePct, exposureImpact, hedgeImpact, realisedNotional, forecastNotional }],
  event: { id, choice } | null, powerUp: string|null }
```

- `activeExposures(run) → Exposure[]`: those with `unlockQuarter ≤ run.quarter`.
- `createRun({ industry, seed, startedAt, market, crisisId = null, forcedYear = null }) → RunState`:
  - `startingCash = industry.startingCash`;
  - `redLine = BALANCE.redLinePct × startingCash`;
  - the mandate is picked by seed from `BALANCE.mandates`;
  - `rates` are taken at `startYear` Q1.
- `simulateQuarter(run, decisions, market, content) → { run: RunState, summary: QuarterSummary }`. Pure: it returns
  a new object. `content = { events: SimpleEvent[] }`. The algorithm order is fixed:
  1. `rng = new SeededRandom((run.seed ^ Math.imul(run.quarter + 1, 0x9E3779B1)) >>> 0)`.
  2. Apply `buyPowerUp` (A4) and the `eventChoice` effects (A4) to both the player and the benchmark.
  3. End rates come from `market.getRate` at the next calendar quarter.
  4. For each active exposure:
     - `realised = forecast × (1 + (rng.next()×2−1) × variance)`, where
       `variance = getEffectiveVariance(floor(q/4), 0) × run.varianceMultiplier`;
     - player delta += exposure impact on `realised` + hedge impact on `h × forecast` (product `'option'` when
       `useOptions` and `options` is owned, minus the premium);
     - benchmark delta += exposure impact only.
  5. Both sides add `BALANCE.baseOcfPct × startingCash`.
  6. `inMandate`: every active non-zero-notional exposure has `h` within `[mandate.min, mandate.max]`. Compute
     `marketResult` and `breach` as defined in QuarterSummary.
  7. Board mood (user decision: success mitigates a breach; a losing breach is punished hard):
     - `breach === 'none'`: `+BALANCE.mood.inMandate`;
     - `breach === 'lucky'`: `+BALANCE.mood.luckyBreach` (a mild telling-off);
     - `breach === 'loss'`: `+BALANCE.mood.breachLoss` (a heavy telling-off);
     - `+BALANCE.mood.beatBenchmark` if playerDelta ≥ benchmarkDelta;
     - `+BALANCE.mood.redZone` if `cashAfter < redLine`;
     - clamped to 0..100.
  8. Status, checked in this order:
     1. `cash ≤ 0` → `'bankrupt'`;
     2. the run's count of `breach === 'loss'` quarters reaches `BALANCE.breachLossesToFire` → `'fired'`;
     3. `boardMood ≤ BALANCE.fireThreshold` → `'fired'`;
     4. `quarter === 8` → `'complete'`.
  9. Roll the next `pendingEvent` with `rng.chance(BALANCE.eventChance)`, from events not yet seen this run, using
     weighted selection (A4).
- `isRunOver(run) → boolean`: `status !== 'playing'`.
- Initial `BALANCE` values (A7 tunes them):

  ```
  { startMood: 60, fireThreshold: 10, redLinePct: 0.2, baseOcfPct: -0.03, eventChance: 0.35,
    mandates: [{min:0.25,max:0.5},{min:0.5,max:0.75},{min:0.75,max:1}],
    mood: { inMandate: 4, luckyBreach: -3, breachLoss: -25, beatBenchmark: 3, redZone: -12 },
    breachLossesToFire: 2,
    notionalScale: 1 }
  ```

  Exposure notionals are multiplied by `notionalScale` in `createRun`.

- [ ] **Step 1: Write the failing tests** (use `loadMarketData()`, `marketEngine.loadFromObjects` and the airline
  industry):
  - `createRun is deterministic`: same seed → deep-equal runs.
  - `run is JSON round-trippable`: `JSON.parse(JSON.stringify(run))` deep-equals `run`.
  - `all-zero hedges: playerDelta === benchmarkDelta` (when there's no power-up or option).
  - `100% forward on every active exposure: |playerDelta − benchmarkDelta| equals |Σ exposure impact on (realised − forecast)|`
    (only the over- or under-hedge remains).
  - `simulateQuarter does not mutate its input` (deep-freeze the input; no throw).
  - `breach classification`: out-of-band dials with `marketResult ≥ 0` give `'lucky'`; out-of-band with
    `marketResult < 0` gives `'loss'`; in-band gives `'none'` whatever the result.
  - `lucky breach is criticised less than a losing breach`: the mood change for `lucky` > the change for `loss`.
  - `two losing breaches → fired`: force two `'loss'` quarters → `status === 'fired'` even when mood > fireThreshold.
  - `bankruptcy`: set `run.cash = 1`, force a bad quarter → `status === 'bankrupt'`.
  - `complete after 8`: 8 calls with valid decisions → `status === 'complete'`, `history.length === 8`.
  - `GBP exposure unlocks at Q4`: `activeExposures` at quarter 4 includes `gbp-revenue`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement `balance.js` and `SimEngine.js`. Stub `applyPowerUp` and `applyEventChoice` as identity
  functions until A4.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(sim): SimEngine with cash runway, benchmark and board mood`

### Task A4: Power-ups and Simple events

**Files:**
- Create: `js/engine/sim/powerUps.js`, `js/engine/sim/events.js`
- Modify: `js/engine/sim/SimEngine.js` (replace the stubs)
- Test: `tests/sim/powerUpsEvents.test.js`, using a fixture `tests/fixtures/simple-events.json` with 2 events

**Interfaces:**
- Produces:
  - `POWER_UPS`, keyed by id:
    - `forecasting`: cost `0.01 × startingCash`; sets `varianceMultiplier = 0.5` permanently.
    - `visibility`: cost `0.005 × startingCash`, single use; adds `+0.03 × startingCash` to the player only.
    - `options`: cost `0.005 × startingCash`; unlocks `useOptions`.
  - `canBuyPowerUp(run, id, unlockedIds) → boolean`: not owned (or `visibility` not yet used), affordable, and in `unlockedIds`.
  - `applyPowerUp(run, id) → run`.
  - A `SimpleEvent` JSON entry looks like:

    ```
    { id, pool: 'business'|'conference', weight, title, text,
      choices: [{ id, label, quip,
                  effects: { cashPct?, mood?, varianceMult?, notionalMult?: { [exposureId]: number } } }] }
    ```

    - `cashPct` is a fraction of `startingCash` applied to **both** player and benchmark.
    - `mood` is applied to the player only.
    - `notionalMult` applies to this quarter's forecast notional for both sides.
  - `rollEvent(run, events, rng) → string|null`.
  - `applyEventChoice(run, event, choiceId) → { run, quarterNotionalMult }`. An unknown `choiceId` throws.

- [ ] **Step 1: Write the failing tests:**
  - `cannot buy twice`;
  - `cannot buy when cash < cost`;
  - `visibility adds 3% to the player only (benchmark unchanged)`;
  - `forecasting halves variance`: the realised spread across 200 seeds is about half (ratio within 0.4–0.6);
  - `event cashPct hits both sides equally`;
  - `unknown choice throws`;
  - `rollEvent never repeats an id within a run`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement, and wire into `simulateQuarter` steps 2 and 9.
- [ ] **Step 4:** Run the tests. Expected: PASS (and A3's tests still pass).
- [ ] **Step 5:** Commit: `feat(sim): power-ups and simple events`

### Task A5: Shared scoring

**Files:**
- Create: `js/engine/sim/score.js`
- Test: `tests/sim/score.test.js`

**Interfaces:**
- Consumes: `QuarterSummary[]` (A3), the final `status`, `startingCash` and `boardMood`.
- Produces:
  - `quarterPoints(summary, startingCash) → number`, summing:
    - `BALANCE.points.inMandate` (100) when `breach === 'none'`;
    - `BALANCE.points.luckyBreach` (0) when `breach === 'lucky'` (no reward for gambling, but no penalty);
    - `BALANCE.points.breachLoss` (−300) when `breach === 'loss'` (user decision: a losing breach scores very negatively);
    - `BALANCE.points.aboveRedLine` (50) when `cashAfter ≥ redLine`;
    - a stability bonus: `round(BALANCE.points.stability × clamp(1 − |playerDelta − baseOcf| / max(1, |benchmarkDelta − baseOcf|), 0, 1))`
      with `stability = 100`, where `baseOcf = BALANCE.baseOcfPct × startingCash`.
  - `finalScore({ history, status, startingCash, boardMood }) → { total, breakdown: { quarters, outperformance, survival, moodMultiplier }, title }`:
    - `outperformance = round(BALANCE.points.outperformPerPct × 100 × (lastCash − lastBenchmarkCash) / startingCash)`
      with `outperformPerPct = 40`. It can be negative.
    - `survival = status === 'complete' ? BALANCE.points.survival (500) : 0`.
    - `moodMultiplier = 0.8 + 0.4 × boardMood / 100`.
    - `total = max(0, round((quarters + outperformance + survival) × moodMultiplier))`.
    - `title` comes from `gameOverTitles` in `data/quips.json` (D1), injected as an optional 2nd argument; it
      defaults to `''`.
  - `SCORE_MAX = 10000`, used by the backend for plausibility checks.

  Add the `points` block to `BALANCE`.

- [ ] **Step 1: Write the failing tests:**
  - `gains are not penalised`: outperformance > 0 gives a higher total than the same history with 0 outperformance.
  - `bankrupt gets no survival bonus`.
  - `total never negative`.
  - `a perfect 8-quarter run is ≤ SCORE_MAX`.
  - `score is an integer`.
  - `lucky breach scores less than in-mandate, more than losing breach`: three otherwise-identical summaries with
    breach `none` > `lucky` > `loss` in `quarterPoints`.
  - `a losing breach costs more than an in-mandate quarter earns`: `quarterPoints(loss)` < 0 when stability is 0.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(sim): v3 scoring vs unhedged benchmark`

### Task A6: Progress, unlocks, crisis scenarios, save/resume format

**Files:**
- Create: `js/engine/sim/progress.js`, `js/engine/sim/crises.js`
- Test: `tests/sim/progress.test.js`

**Interfaces:**
- Produces:
  - `Progress` = `{ version: 3, runs: number, best: { simple: number, pro: number }, unlocked: string[], chairmenMet: string[], crisisBadges: string[] }`.
  - `emptyProgress() → Progress`. Unlocked from the start: `['industry:airline','industry:agrifoods','industry:retail','powerup:forecasting']`.
  - `UNLOCK_RULES`:

    | Id | Rule |
    |---|---|
    | `mode:pro` | runs ≥ 1 |
    | `industry:construction` | best.simple ≥ 1500 |
    | `industry:pharma` | runs ≥ 3 |
    | `industry:tech` | best.simple ≥ 2500 |
    | `industry:energy` | runs ≥ 6 |
    | `powerup:visibility` | runs ≥ 2 |
    | `powerup:options` | best.simple ≥ 2000 |
    | `crisis:*` | runs ≥ 4 |

  - `applyRunToProgress(progress, { mode, score, chairmenMet, crisisId, status }) → { progress, newlyUnlocked: string[], isPersonalBest: boolean }`.
  - `mergeProgress(a, b) → Progress`: max of `runs` and of each best; union of the arrays. Used by E1 and E2 for sync.
  - `CRISES`:

    | Id | Forced year | Industry | Notes |
    |---|---|---|---|
    | `gfc2008` | 2008 | airline | |
    | `brexit2016` | 2016 | retail | |
    | `covid2020` | 2020 | airline | |
    | `energy2022` | 2021 | construction | `maxQuarters: 8` must fit the data; if 2021 isn't eligible, use the latest eligible year ≤ 2021 and note it in the label |

    Each crisis is `{ id, label, forcedYear, industryId }`. Crisis runs are unranked (B3 must not submit them to the leaderboard).
  - `serialiseSave(run) → string` and `parseSave(str) → RunState|null`. `parseSave` returns null on bad JSON or when `version !== 3`.

- [ ] **Step 1: Write the failing tests:**
  - `first completed run unlocks mode:pro`;
  - `personal best detected only when strictly higher`;
  - `mergeProgress is commutative and idempotent`;
  - `parseSave('garbage') === null`;
  - `parseSave(version 2 save) === null`;
  - `every CRISES forcedYear is eligible for its industry` (via A1 `eligibleStartYears`).
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(sim): progress, unlocks, crises, save format`

### Task A7: Balance simulator and tuning

**Files:**
- Create: `tools/simulate.js`
- Modify: `js/engine/sim/balance.js` (tuned values only)
- Test: `tests/sim/balance.test.js` (the same checks, at 300 runs, so CI stays fast)

**Interfaces:**
- Consumes: A3–A5, plus `data/simple-events.json` once D2 lands (until then the A4 fixture).
- Produces: `runStrategy(strategyName, n, seedBase) → { scores: number[], bankruptRate, firedRate, meanQuarters }`.
  The strategies are:
  - `unhedged`: all 0;
  - `flat50`: all 0.5;
  - `mandate`: the midpoint of the band, snapped to the dial;
  - `full`: all 1;
  - `random`: a random dial each quarter.

  Every strategy buys the forecasting power-up at Q1 except `unhedged` and `random`.

- [ ] **Step 1: Write the failing test** (it fails until tuned): over 300 runs per strategy across all 7 industries:
  - `mean(mandate) > mean(unhedged) × 1.3`;
  - **luck still matters** (user decision: don't eliminate it): the share of `unhedged` runs scoring above
    `median(mandate)` is between 0.08 and 0.30, and the same for `full`;
  - `p25(mandate) > median(unhedged)` (skill wins on balance);
  - `0.08 ≤ bankruptRate(unhedged) ≤ 0.30`;
  - `bankruptRate(mandate) < 0.05`;
  - `firedRate(mandate) < 0.05`;
  - `firedRate(unhedged) ≥ 0.15` when the mandate band excludes 0 (losing breaches get you fired);
  - `max quarters === 8`.
- [ ] **Step 2:** Run `node tools/simulate.js --n 1000` and print a table per strategy.
- [ ] **Step 3:** Tune only the `BALANCE` numbers (`notionalScale`, `baseOcfPct`, `redLinePct`, mood and points) until
  the test passes. Record the final table in a comment at the top of `balance.js`.
- [ ] **Step 4:** Run `npm test`. Expected: all tests pass.
- [ ] **Step 5:** Commit: `feat(sim): balance simulator and tuned constants`

---

## Stream C — Graphics (`js/ui/pixel/`, `js/ui/IsometricScene.js`, `assets/images/scenes/`)

Use the `frontend-design` and `canvas-design` skills. The style is refined retro pixel: draw into a low-resolution
offscreen buffer (`160×64` for scenes, `32×32` for sprites), then scale with `imageSmoothingEnabled = false`.

### Task C1: Pixel scene renderer and the 7 industry scenes

**Files:**
- Create: `js/ui/pixel/PixelCanvas.js`, `js/ui/pixel/palette.js`, `js/ui/pixel/Scene.js`, and
  `js/ui/pixel/scenes/{airport,agrifoods,tech,pharma,construction,energy,retail}.js`
- Create: `tools/scene-gallery.html` (a dev-only page: every scene × 3 moods)
- Modify: `js/ui/IsometricScene.js`. Keep the class and its `start(sceneType, yearOffset, quarter)`, `stop()` API for
  Pro's Dashboard, but draw through `drawScene` and remove the PNG preload.
- Delete: `assets/images/scenes/*.png`
- Test: `tests/ui/sceneApi.test.js`, using a stub 2D context that records calls.

**Interfaces:**
- Produces:
  - `SceneState` = `{ mood: 'calm'|'storm'|'boom', cashLevel: number /*0..1*/, highlight: string|null /*underlying that moved most*/ }`.
  - `drawScene(ctx, industryId, sceneState, tMs) → void`. Pure drawing with no internal timers.
  - `SceneLoop`: `new SceneLoop(canvas, getState: () => {industryId, sceneState})` with `.start()` and `.stop()`.
    It is the single `requestAnimationFrame` loop and pauses on `document.visibilitychange`.
  - Each `scenes/*.js` exports `draw(px, sceneState, tMs)`, where `px` is a `PixelCanvas`.
  - `PixelCanvas` provides `rect(x,y,w,h,c)`, `pixel(x,y,c)`, `sprite(map, x, y, paletteMap)` and `blitTo(ctx, scale)`.
  - Industry ids map to scene files as in `industries.json` (`airline` → `airport`, etc.).
- Mood visuals:
  - `storm`: rain plus dark clouds;
  - `boom`: coins and sun;
  - each scene adds one market-linked element (for example airport: planes grounded when `highlight === 'JETNWE'`
    and mood is `storm`).

- [ ] **Step 1: Write the failing test:** `drawScene renders every industry and mood without throwing and issues ≥ 50 draw calls`, using a recording stub context.
- [ ] **Step 2:** Run the test. Expected: FAIL.
- [ ] **Step 3:** Implement the renderer and the 7 scenes. Port shapes from the procedural fallback in
  `IsometricScene.js` where useful.
- [ ] **Step 4:** Run the test. Expected: PASS. Open `tools/scene-gallery.html` through `python -m http.server 8080`
  and screenshot it at 375 px and 960 px wide; check it visually.
- [ ] **Step 5:** Check that `du -sh assets` is < 300 KB. Commit: `feat(gfx): code-drawn pixel scenes; remove 19MB PNGs`

### Task C2: Board and chairman sprites

**Files:**
- Create: `js/ui/pixel/sprites.js`
- Modify: `js/screens/BoardScreen.js` (Pro) to replace `getMemberEmoji` with a sprite canvas.
- Test: `tests/ui/sprites.test.js`

**Interfaces:**
- Produces:
  - `drawSprite(ctx, spriteId, expression: 'neutral'|'happy'|'angry', x, y, scale) → void`.
  - `spriteIdForMember(member, index) → string`. This uses the archetype from `member.personality`
    (`aggressive`/`cautious`/`operational`) and varies hair, skin and suit palette deterministically by `index` and
    `member.name`.
  - `CHAIRMAN_SPRITES`: ids `jameson, musk, oleary, dimon, buffett, jobs, dorsey, ackman` (the keys of
    `board-dialogue.json` `ceoPersonas`). Each has one signature prop (cigar, rocket, ice cream…), drawn as parody, not likeness.

- [ ] **Step 1: Write the failing test:** every archetype and chairman × 3 expressions draws without throwing, and
  the `happy` and `angry` draw-call lists differ.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the 32×32 pixel maps and palettes.
- [ ] **Step 4:** Run the test. Expected: PASS. Add the sprites to `tools/scene-gallery.html` and check them visually.
- [ ] **Step 5:** Commit: `feat(gfx): pixel board and chairman sprites`

### Task C3: Cutscenes (first to cut)

**Files:**
- Create: `js/ui/pixel/Cutscene.js`
- Test: `tests/ui/cutscene.test.js`

**Interfaces:**
- Produces: `playCutscene(container: HTMLElement, id: 'intro'|'bankrupt'|'fired'|'personalBest', { industryId }) → Promise<void>`.
  - Each lasts 2–4 s, and a tap or key skips it.
  - It resolves immediately when `matchMedia('(prefers-reduced-motion: reduce)')` matches.
  - It cleans up its canvas.

- [ ] **Step 1: Write the failing test:** with a fake container and a stubbed `matchMedia` (reduced motion), the promise resolves.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Implement the four sequences:
  - intro: logo plus the industry scene panning in;
  - bankrupt: the bank manager's phone rings;
  - fired: escorted out with a box;
  - personal best: fireworks plus "NEW PB".
- [ ] **Step 4:** Run the test. Expected: PASS. Check each sequence visually in the gallery page.
- [ ] **Step 5:** Commit: `feat(gfx): cutscenes`

---

## Stream D — Content (`data/` only)

### Task D1: Quips and game-over titles

**Files:**
- Create: `data/quips.json`
- Modify: `data/board-dialogue.json`. Shorten every line over 90 characters; keep all keys.
- Test: `tests/content/quips.test.js`

**Interfaces:**
- Produces the `data/quips.json` schema:

```json
{ "result": { "bigSave": [], "bigMiss": [], "overHedged": [], "nearBankrupt": [], "calm": [], "boom": [] },
  "board": { "aggressive": { "moodUp": [], "moodDown": [], "redZone": [], "luckyBreach": [], "breachLoss": [] },
             "cautious":   { "moodUp": [], "moodDown": [], "redZone": [], "luckyBreach": [], "breachLoss": [] },
             "operational":{ "moodUp": [], "moodDown": [], "redZone": [], "luckyBreach": [], "breachLoss": [] } },
  "chairman": { "jameson": [], "musk": [], "oleary": [], "dimon": [], "buffett": [], "jobs": [], "dorsey": [], "ackman": [] },
  "gameOverTitles": [ { "min": 0, "title": "", "line": "" } ],
  "bankrupt": [], "fired": [] }
```

- Selection rules for B3:
  - `bigSave`: `hedgeImpact` total > 2% of starting cash;
  - `bigMiss`: `benchmarkDelta − playerDelta > 2%` of starting cash;
  - `overHedged`: any line with `h × forecast > 1.15 × realised`;
  - `nearBankrupt`: `cashAfter < redLine`;
  - otherwise `calm`, or `boom` on a large favourable move.
- Board line selection (B1): `breach === 'loss'` → `breachLoss`. This is a heavy, scathing telling-off, and the angry
  sprite always wins over other moods. `breach === 'lucky'` → `luckyBreach`: a grudging "it worked, but don't do that
  again". Otherwise `redZone`, `moodUp` or `moodDown` by mood change.
- Tone: `luckyBreach` is mild and wry; `breachLoss` is the harshest in the game (the board is furious, with HR
  hints). The `fired` lines follow from repeated losing breaches.

- [ ] **Step 1: Write the failing test.** Every array has ≥ 6 entries (`chairman.*` ≥ 4, `gameOverTitles` ≥ 6 sorted
  by `min` and starting at 0). Every string is ≤ 90 characters. Every `board-dialogue.json` string is ≤ 90
  characters. There are no empty strings.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Write the content. Keep the existing tone (dry corporate satire, the parody bank names), add
  conference-life jokes, and don't punch at real individuals beyond the existing parody names.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit: `content: v3 quips, shortened board dialogue`

### Task D2: Simple events, power-up cards, Pro event fixes

**Files:**
- Create: `data/simple-events.json` (the schema from A4), `data/powerups.json`
- Modify: `data/events.json`. Make `fuel_spike` and `pe_acquisition` either offer real choices or stop promising them.
- Test: `tests/content/events.test.js`

**Interfaces:**
- Produces:
  - `data/simple-events.json`: ≥ 16 events, ≥ 5 with `pool: 'conference'` (keynote overran, lanyard mix-up, coffee
    queue, the CFO is at the bar, phone at 3%).
  - Every event has exactly 2 choices with different `effects`.
  - Magnitudes: `cashPct` within ±0.05, `mood` within ±10, `varianceMult` within 0.5–2, `notionalMult` values
    within 0.5–1.5 keyed only by exposure ids that exist in `industries.json`.
  - `data/powerups.json`: `{ forecasting|visibility|options: { name, blurb (≤ 90 chars), hedjLine (≤ 90 chars, "In real life, Hedj …") } }`.

- [ ] **Step 1: Write the failing test.** Check the schema and the bounds above, unique ids, that every quip and label
  is ≤ 90 characters, and that every `notionalMult` key exists in some industry.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Write the content. Replace the A4 fixture path in `tools/simulate.js` with `data/simple-events.json`.
- [ ] **Step 4:** Run `npm test`. Expected: PASS (re-run A7's balance test).
- [ ] **Step 5:** Commit: `content: simple events, power-up cards, pro event fixes`

---

## Stream E1 — Backend (`backend/`, `admin.html`, `stand.html`, `.github/workflows/deploy-*.yml`)

### Task E1-1: Testable handlers, SAM hardening, new table

**Files:**
- Modify: every file in `backend/handlers/*.mjs`. Each exports `createHandler(deps)` and `handler = createHandler(realDeps)`,
  where `deps = { ddb, env, now: () => number, uuid: () => string }`.
- Create: `backend/lib/http.mjs`, `backend/test/fakeDdb.mjs`
- Modify: `backend/template.yaml`
- Test: `backend/test/template.test.mjs`

**Interfaces:**
- Produces:
  - `json(status, body)`;
  - `parseBody(event, maxBytes = 4096) → object` (throws `HttpError(413|400)`);
  - `HttpError`;
  - `requireAdmin(event, env)` (constant-time compare via `crypto.timingSafeEqual` on the `x-admin-key` header; throws `HttpError(401)`);
  - `validName(s) → boolean`: 1–20 code points, Unicode letters, numbers, space and `.'-_` only, using `/^[\p{L}\p{N} .'_-]{1,20}$/u`.

  All of these live in `backend/lib/http.mjs`.
- `fakeDdb.mjs` is an in-memory fake that supports `GetCommand`, `PutCommand` (with
  `ConditionExpression: attribute_not_exists(...)`), `UpdateCommand` (only the expressions used by the handlers),
  and `QueryCommand` on table plus index.
- Template changes:
  - **New table `HCompBest`:** PK `board` (S), SK `email` (S), number attribute `score`; GSI `ByScore` (PK `board`, SK `score`).
  - **Parameters:** `EventId` (default `test`), `EventEndIso`, `TokenTtlHours` (default `120`).
  - **API throttling:** default route settings `ThrottlingBurstLimit: 50`, `ThrottlingRateLimit: 20`; admin routes `5/2`.
  - **CORS:** `AllowOrigins` `https://competition.hedj.eu` and `http://localhost:8080`.
  - **Least privilege:**
    - `LeaderboardFunction`: `DynamoDBReadPolicy` on `HCompBest` only.
    - `ProgressFunction`: CRUD on `HCompPlayers` only.
    - `ScoreFunction`: CRUD on Players, Scores and Best.
  - **TTL:** enable it on Players and Scores with attribute `ttl`.

- [ ] **Step 1: Write the failing test.** `template.test.mjs` reads the YAML as text and asserts it contains
  `ThrottlingRateLimit`, `HCompBest`, `ByScore` and `EventId`, and does not contain `AllowOrigins: ['*']`. Write
  `lib/http` tests:
  - `validName` accepts `'Zoë 🙂'` but rejects `'<b>x'` and a 21-character name;
  - `parseBody` rejects a 5 KB body;
  - `requireAdmin` rejects a wrong key.
- [ ] **Step 2:** Run `node --test backend/test/`. Expected: FAIL.
- [ ] **Step 3:** Implement `lib/http.mjs` and the fake, refactor the handlers to `createHandler` (behaviour unchanged
  for now), and edit the template.
- [ ] **Step 4:** Run the tests. Expected: PASS. Run `sam validate --lint` in `backend/` if SAM is installed;
  otherwise note that it was skipped.
- [ ] **Step 5:** Commit: `feat(backend): DI handlers, throttling, least privilege, best table`

### Task E1-2: Register, score, leaderboard, progress

**Files:**
- Modify: `backend/handlers/register.mjs`, `score.mjs`, `leaderboard.mjs`
- Create: `backend/handlers/progress.mjs` and its template entries (`GET /progress`, `PUT /progress`)
- Test: `backend/test/handlers.test.mjs`

**Interfaces:**
- **`POST /register`** `{ playerName, email, company, consentGiven, marketingConsent }`:
  - `UpdateCommand` sets `registeredAt` with `if_not_exists`.
  - `marketingConsent` becomes `true` if sent `true`; otherwise the existing value is kept (default `false`).
  - It refreshes `gameToken` and `gameTokenExpiry = now + TokenTtlHours`.
  - `ttl = EventEndIso + 90 days` (epoch seconds).
  - Returns `{ gameToken, expiresAt }`.
- **`POST /score`** `{ gameToken, email, gameId, mode: 'simple'|'pro', score, quartersPlayed, startedAt, industryId, playerName, company }`:
  - **Validation:**
    - `mode` is valid;
    - `score` is an integer, 0 ≤ score ≤ 10000 (`SCORE_MAX`);
    - 1 ≤ quartersPlayed ≤ 8;
    - `now − startedAt ≥ 60000`;
    - `validName(playerName)`, and `company` ≤ 60 characters with no `<>`.
  - **Storage:**
    - `Put` into Scores with `scoreId = gameId` and `ConditionExpression attribute_not_exists(scoreId)`; a
      duplicate returns `200 {duplicate:true}`.
    - Best boards: `${EventId}#${mode}#all` and `${EventId}#${mode}#${YYYY-MM-DD in Europe/Dublin}`, updated only when
      the new score is higher (`ConditionExpression attribute_not_exists(score) OR score < :s`).
    - The player row gets `playCount += 1`, and `playDays` gets the date added.
  - Returns `{ rank, best, isBest }`.
- **`GET /leaderboard?mode=simple|pro&period=event|today&limit≤50`** → `{ entries: [{ rank, playerName, company, score, industryId }] }`.
  It queries `ByScore` in descending order. Email is never returned.
- **`GET /progress`** and **`PUT /progress`**:
  - Headers `x-player-email` and `x-game-token`.
  - GET returns `{ progress }` from the player row.
  - PUT body `{ progress }` (≤ 4 KB) is merged server-side using the same rules as `mergeProgress` (A6). Copy the
    function into `backend/lib/progress.mjs`; a test asserts parity with `js/engine/sim/progress.js` on fixtures.

- [ ] **Step 1: Write the failing tests** (`fakeDdb`, fixed `now`):
  - `re-register keeps registeredAt and marketingConsent:true`;
  - `token lasts TokenTtlHours`;
  - `score rejects 10001, quartersPlayed 9, too-fast run, bad name`;
  - `duplicate gameId is idempotent`;
  - `best board keeps the higher of two scores; one entry per player`;
  - `leaderboard omits email and is sorted desc`;
  - `today board uses Europe/Dublin date`;
  - `progress PUT merges (union, max)`;
  - `progress rejects wrong token`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(backend): per-event best-per-player boards, long tokens, progress sync`

### Task E1-3: Admin metrics, prize export, stand page, deploy triggers, headers note

**Files:**
- Modify: `backend/handlers/admin.mjs`, `admin.html`, `.github/workflows/deploy-frontend.yml`
- Create: `stand.html`, `docs/cloudfront-security-headers.md`
- Test: `backend/test/admin.test.mjs`

**Interfaces:**
- **`GET /admin/metrics`** (requires `x-admin-key`) → `{ players, plays, uniquePlayers, runsPerPlayer, returnRate /*playCount≥2 share*/, multiDayRate /*≥2 playDays share*/, playsByDay: {date: n} }`.
- **`GET /admin/prize?mode=&period=&limit=`** → CSV with columns `rank, playerName, company, email, score, marketingConsent`.
- **`stand.html`**: a public big-screen page.
  - Shows the Simple and Pro top 10 side by side for the event board, plus today's board.
  - Auto-refreshes every 30 s.
  - Renders names with `textContent` only.
  - Uses large pixel font.
- **Deploy workflow:** the trigger `paths` add `admin.html`, `privacy.html`, `stand.html`, `manifest.json` and `sw.js`.
- **Contact address:** `README.md:377` changes from competition@hedj.eu to info@hedj.eu, to match `privacy.html`.
  `privacy.html` also describes the token lasting the event and the 90-day TTL deletion.
- **`docs/cloudfront-security-headers.md`:**
  - the exact CloudFront response-headers policy to attach by hand to the competition distribution:
    - CSP `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'`
    - HSTS
    - `X-Content-Type-Options`
    - `Referrer-Policy strict-origin-when-cross-origin`
  - the matching `aws cloudfront create-response-headers-policy` and `update-distribution` steps.

- [ ] **Step 1: Write the failing tests:**
  - `metrics require admin key`;
  - `returnRate computed from playCount`;
  - `prize CSV escapes commas/quotes and is admin-only`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. Check `stand.html` against `python -m http.server` using a mocked `/api` (a fixture JSON
  under `?mock=1`).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(backend): admin metrics, prize export, stand page`

---

## Stream E2 — Client wiring (`js/utils/api.js`, `js/utils/storage.js`, `js/utils/escape.js`)

### Task E2: Per-player storage, offline queue, API v3, escaping

**Files:**
- Create: `js/utils/escape.js`
- Modify: `js/utils/api.js`, `js/utils/storage.js`, `js/config.js` (add `eventId`; remove the unused `competitionActive`)
- Modify (escaping only): `js/screens/TitleScreen.js`, `js/screens/GameOverScreen.js` and every other `innerHTML`
  site that interpolates `playerName` or `company` (find them with `grep -rn "playerName\|company" js/screens`).
- Test: `tests/client/storage.test.js`, `tests/client/escape.test.js`. Use a `FakeStorage` implementing the
  `localStorage` interface, injected through `setStorageBackend(fake)`.

**Interfaces:**
- **`escape.js`:** `escapeHtml(s) → string` escapes `& < > " '`.
- **`storage.js`** (all keys namespaced `hedj_v3:<sha-less key = email lowercased>:`):
  - `getRegistration()` and `saveRegistration()` keep their current shape.
  - `saveRun(email, runJson)`, `loadRun(email) → RunState|null` (via A6 `parseSave`), and `clearRun(email)`.
  - `getProgress(email) → Progress` and `saveProgress(email, progress)`.
  - `queueScore(payload)`, `getQueuedScores() → payload[]` (max 20, oldest dropped) and `removeQueuedScore(gameId)`.
  - `setStorageBackend(store)` (tests only).
- **`api.js`:**
  - `submitScore(payload) → {rank,best,isBest}`;
  - `fetchLeaderboard({ mode, period, limit }) → entries[]`;
  - `getRemoteProgress() → Progress|null`;
  - `putRemoteProgress(progress)`;
  - `flushScoreQueue() → number` (how many were sent). It sends each queued score whenever a valid token exists,
    keeps it on network failure, and drops it on a 4xx other than 401. It runs on app start and on `window` `online`.

- [ ] **Step 1: Write the failing tests:**
  - `escapeHtml('<img src=x onerror=alert(1)>')` contains no `<`;
  - `player B does not see player A's run or progress`;
  - `queue keeps 20 newest`;
  - `queued scores survive token expiry and flush after new registration` (fake fetch);
  - `401 keeps item, 400 drops item`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement, and replace every raw interpolation of player strings with `escapeHtml(...)`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Then run
  `grep -rn '\${[^}]*\(playerName\|company\)' js/screens | grep -v escapeHtml`. Expected: no output.
- [ ] **Step 5:** Commit: `feat(client): per-player storage, score queue, API v3, escaping`

---

## Stream B — Simple-mode UI (`js/screens/simple/`, `js/main.js`, `TitleScreen`, `GameOverScreen`, `SetupScreen`, `HowToPlayScreen`, `css/v3.css`)

Use the `frontend-design` skill. The layout is mobile-first at 360–430 px wide and also works within the 960×640 desktop frame.

### Task B1: `RunController` and routing

**Files:**
- Create: `js/screens/simple/RunController.js`
- Modify: `js/main.js`:
  - routes: `title`, `registration`, `industry`, `quarter`, `result`, `gameover`, plus Pro's existing `dashboard`,
    `event`, `summary`, `board`;
  - remove the `extend` and `levelComplete` screens and the `CareerEngine` import;
  - load `data/quips.json`, `data/simple-events.json` and `data/powerups.json` at init.
- Delete: `js/engine/CareerEngine.js`, `js/screens/ExtendScreen.js`, `js/screens/LevelCompleteScreen.js`, `data/career-levels.json`
- Test: `tests/client/runController.test.js` (fake storage plus loaded market data)

**Interfaces:**
- Consumes: A3–A6, E2 storage and api.
- Produces: `class RunController`, with `constructor({ storage, api, market, content, now })` and these methods:
  - `start(industryId, { crisisId } = {}) → RunState` (autosaves);
  - `resume(email) → RunState|null`;
  - `currentDecisionsDefaults() → Decisions`: each exposure's dial at the nearest 0.25 step to its mandate midpoint
    for a new run, otherwise the previous quarter's dials;
  - `playQuarter(decisions) → { run, summary, quip, boardReaction, pendingEvent }`. This autosaves, and on run end
    calls `finish()`.
  - `finish() → { score, newlyUnlocked, isPersonalBest, rank|null }`. It applies progress (A6), queues and flushes
    the score (E2) unless `crisisId`, and clears the save.

  The quip is selected per the D1 selection rules.
- **Chairman appearances:** the chairman (a persona picked by run seed from `CHAIRMAN_SPRITES`) speaks instead of a
  board member at Q1, Q4 and Q8, and whenever `|playerDelta − benchmarkDelta| > 3%` of starting cash. Each appearance
  adds the persona id to the run's `chairmenMet`, which `finish()` passes to `applyRunToProgress`.
- **Randomness:** quip selection uses a cosmetic `SeededRandom(run.seed ^ 0xC0FFEE)`, never the simulation RNG.

- [ ] **Step 1: Write the failing tests:**
  - `start→8×playQuarter→finish produces a score and clears the save`;
  - `resume after reload returns the same quarter`;
  - `crisis runs are not queued for submission`;
  - `finish unlocks mode:pro after first run`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement `RunController`, rewire `main.js` and delete the career files. `grep -rn "careerEngine\|ExtendScreen\|LevelComplete" js`
  must return nothing.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(ui): RunController and v3 routing; remove career/extend`

### Task B2: Title, industry pick, and quarter screen

**Files:**
- Modify: `js/screens/TitleScreen.js` (v3 layout)
- Create: `js/screens/simple/IndustryScreen.js`, `js/screens/simple/QuarterScreen.js`, `js/ui/CashMeter.js`, `js/ui/HedgeDial.js`, `css/v3.css` (linked in `index.html`)

**Interfaces:**
- Consumes: `RunController`, C1 `SceneLoop`, C2 `drawSprite`, D2 `powerups.json`.
- Produces:
  - `new CashMeter(el)` with `.set({ cash, startingCash, redLine }, animateMs)`;
  - `new HedgeDial(el, { value, mandate, onChange })` with 5 detents (0/25/50/75/100) and the mandate band shaded.
    It needs ≥ 44 px touch targets and is keyboard-operable with arrow keys.
- **Title:**
  - PLAY, plus RESUME when `loadRun` returns a run;
  - personal best, today's rank, "chairmen met n/8" and the next unlock hint;
  - a leaderboard teaser;
  - a PRO button (locked until `mode:pro`);
  - a CRISES entry (locked);
  - "Not you?" (kept).
- **Industry screen:** cards for the 7 industries, with locked ones greyed out showing the unlock rule.
- **Quarter screen:**
  - the cash meter at the top;
  - a 120 px scene strip;
  - an event card when `pendingEvent` is set (its 2 choices must be picked before RUN);
  - one card per active exposure, each with plain-language copy ("You buy jet fuel in dollars"), a dial and a
    forecast confidence hint (`±x%`);
  - a power-up slot;
  - the RUN THE QUARTER button.

- [ ] **Step 1:** In the browser (`python -m http.server 8080`, Chrome device mode at 375×812), play from the title
  through Q1. The screens render, the dial snaps, and RUN calls `playQuarter`.
- [ ] **Step 2:** Implement the screens. No text under 12 px (check computed styles in devtools).
- [ ] **Step 3:** Check there are no console errors and that tap counts are ≤ 4 per quarter with no event.
- [ ] **Step 4:** Run `npm test` (no regressions).
- [ ] **Step 5:** Commit: `feat(ui): v3 title, industry and quarter screens`

### Task B3: Result and game-over screens

**Files:**
- Create: `js/screens/simple/ResultScreen.js`
- Modify: `js/screens/GameOverScreen.js` (v3 layout for Simple and Pro)

**Interfaces:**
- Consumes: the `playQuarter` output, C2 sprites, C3 `playCutscene`, D1 quips and `gameOverTitles`, E2 `fetchLeaderboard`.
- **Result screen:**
  - lasts about 10 s and a tap skips it;
  - the scene runs in `SceneState` mood derived from the summary;
  - the cash meter animates;
  - one line per exposure ("Dollar +6%. Your hedge saved €1.2m", using `formatCurrency` from `js/utils/formatters.js`);
  - one board member sprite with an expression from the mood change, plus a quip;
  - NEXT.
- **Game over:**
  - the score counts up and the title shows;
  - the hidden start year is revealed with its fact from `data/year-facts.json` (reuse the existing loader in
    `GameOverScreen.js:15-30`);
  - the PB cutscene plays if it's a personal best, then the bankrupt or fired cutscene if relevant;
  - rank (or "queued, will submit when online");
  - newly unlocked items;
  - PLAY AGAIN (same industry, one tap);
  - Share (copy text).

- [ ] **Step 1:** Play a full run in device mode. Time it (target 3–3.5 min) and count taps (≤ 35).
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Force bankruptcy (via a devtools `run.cash` edit before RUN) and check the bankrupt path and that
  the score is still submitted.
- [ ] **Step 4:** Run `npm test`.
- [ ] **Step 5:** Commit: `feat(ui): result and game-over screens`

### Task B4: How to Play (3 cards), copy, readability pass

**Files:**
- Modify: `js/screens/HowToPlayScreen.js` (3 swipe cards: the dial, the cash meter, beating "doing nothing"),
  `css/retro.css`, `css/responsive.css`, `README.md`

- [ ] **Step 1:** Rewrite the guide as 3 cards, and update the README (7 industries, ~3 min, Simple/Pro, v3 backend
  parameters, removal of career mode).
- [ ] **Step 2:** Readability pass at 360 px: raise every pixel-font size to ≥ 12 px and turn the CRT overlay off at ≤ 768 px.
- [ ] **Step 3:** In devtools, run `[...document.querySelectorAll('*')].filter(e=>e.offsetParent&&parseFloat(getComputedStyle(e).fontSize)<12&&e.textContent.trim())`
  on every screen. Expected: an empty array.
- [ ] **Step 4:** Run `npm test`.
- [ ] **Step 5:** Commit: `feat(ui): 3-card guide, readability, README`

---

## Stream F — Pro mode (`js/engine/GameLoop.js`, `GameState.js`, `BankEngine.js`, `ScoreEngine.js`, `DashboardScreen.js`)

### Task F1: Pro bug fixes and v3 scoring adapter

**Files:**
- Modify: `js/engine/GameLoop.js`, `js/engine/GameState.js`, `js/engine/BankEngine.js`, `js/screens/DashboardScreen.js`
- Create: `js/engine/sim/proAdapter.js`
- Test: `tests/pro/proFixes.test.js`

**Interfaces:**
- Produces:
  - `toQuarterSummary(state, quarterResult) → QuarterSummary` (A3 shape):
    - `benchmarkDelta` = Σ exposure P&L details;
    - `playerDelta` = net P&L;
    - `inMandate` = the existing compliance result;
    - `marketResult` = Σ exposure P&L + hedge P&L − trading costs and premiums for the quarter, with `breach`
      derived exactly as in A3;
    - `redLine = 0.2 × startingCash`.
  - `scorePro(state) → finalScore(...)` result (A5).

- **Fixes:**
  - `bankEngine.releaseTrade(bankId, hedgeId)` is called when a hedge settles or unwinds.
  - IR exposure P&L uses the start-of-game rate as its budget (`exposureCashImpact` from A2).
  - Every trade adds `hedgingEngine.getTradingCost(...)` to `tradesThisQuarter`, `totalTradingCosts`.
  - `MAX_QUARTERS` is fixed at 8 (remove extension logic and constants).
  - The Pro game-over uses `scorePro` and submits `mode: 'pro'`.

- [ ] **Step 1: Write the failing tests** (singletons, with market data loaded via `loadFromObjects`):
  - `settled hedge frees bank credit`;
  - `IR exposure P&L non-zero when EURIBOR moves`;
  - `trading costs accumulate`;
  - `toQuarterSummary benchmarkDelta equals sum of exposure details`;
  - `game ends at 8 quarters`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npm test`. Expected: PASS. Play one Pro run in the browser and check it reaches game over with
  a v3 score.
- [ ] **Step 5:** Commit: `fix(pro): credit release, IR P&L, trading costs; v3 scoring`

### Task F2: Pro polish (third to cut)

**Files:**
- Modify: `js/screens/DashboardScreen.js`, `js/screens/BoardScreen.js`

Changes:
- the cash meter (B2 `CashMeter`) replaces the cash text;
- the scene uses `SceneLoop`;
- the board uses C2 sprites and D1 quips;
- typing animations drop to ≤ 8 ms per character, and a tap completes them.

- [ ] **Step 1:** In the browser, a Pro quarter (no hedges) takes ≤ 30 s of waiting.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Check there are no console errors in a full Pro run.
- [ ] **Step 4:** Run `npm test`.
- [ ] **Step 5:** Commit: `feat(pro): v3 visuals and faster pacing`

---

### Task G: PWA, fonts, weight

**Files:**
- Create: `manifest.json`, `sw.js`, `assets/fonts/PressStart2P-Regular.woff2`, `assets/fonts/VT323-Regular.woff2`
  (both SIL OFL; add `assets/fonts/OFL.txt`), `assets/icons/icon-192.png` and `icon-512.png` (generated in code to a
  canvas and saved once, or a pixel SVG)
- Modify: `index.html` (manifest link, service worker registration, `theme-color`), and `css/retro.css` (replace the
  Google Fonts `@import` with `@font-face`)

**Interfaces:**
- `sw.js`:
  - cache-first for the app shell (an explicit list: `index.html`, `css/*`, `js/**`, `data/**`, fonts, icons), with
    the cache name `hedj-v3-<version>`;
  - network-only for `/api/*`;
  - deletes old caches on `activate`.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** In Chrome devtools, go Application → Service Workers, tick Offline and reload. The game loads and a
  run completes, and the score queues.
- [ ] **Step 3:** Run Lighthouse (mobile) on `http://localhost:8080`. Check: < 1.5 MB transferred, installable, no
  console errors. Record the numbers in the commit message.
- [ ] **Step 4:** Run `npm test`.
- [ ] **Step 5:** Commit: `feat: offline PWA, self-hosted fonts`

### Task H: Balance check, playtest, cutover

**Files:**
- Create: `docs/cutover.md`

- [ ] **Step 1:** Run `node tools/simulate.js --n 1000` with the final content and confirm the A7 criteria still hold.
- [ ] **Step 2:** Playtest on a real phone (same wifi, `http://<pc-ip>:8080`):
  - 3 Simple runs: time each and count taps;
  - close the tab mid-run, then resume;
  - airplane mode at game over, then reconnect;
  - switch player.
- [ ] **Step 3:** Write `docs/cutover.md`:
  1. export the current admin CSV;
  2. `sam deploy` with `EventId=test`, `EventEndIso`, `TokenTtlHours=120`;
  3. deploy the frontend;
  4. attach the CloudFront headers policy (`docs/cloudfront-security-headers.md`);
  5. dry-run on a phone;
  6. redeploy with the real `EventId`;
  7. print the QR code for `https://competition.hedj.eu`.
- [ ] **Step 4:** Run `npm test` (all green). Then use superpowers:requesting-code-review on the whole branch.
- [ ] **Step 5:** Commit: `docs: v3 cutover checklist`
