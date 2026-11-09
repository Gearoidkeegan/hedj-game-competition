# v3.1 Simple mode: market charts, exposure size, player character — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three things to Simple mode:
- real market price charts;
- visible exposure sizes, with a size-weighted "risk covered" policy check;
- a player character whose face follows performance.

**Architecture:** Vanilla ES modules, no build step.
- The engine (`js/engine/sim/`) stays DOM-free and deterministic.
- Charts and the avatar are cosmetic, so they never draw from the simulation RNG.
- Tasks 1 and 2 run in parallel, in separate worktrees, and are merged into `v31-simple-visuals`. Task 3 follows on the merged branch.

**Tech stack:** Canvas 2D, `node --test`, `tools/simulate.js`.

**Spec:** this plan's Goal and Global Constraints, plus the user-approved design in chat (2026-11-09). That design is summarised below and is binding.

## Approved design (user, 2026-11-09)
1. **Market charts on the Simple result screen.**
   - Each active exposure's real price line animates across the quarter: about 2 s, and a tap skips it.
   - The line ends on the % move, coloured by whether the move hurt or helped the business.
   - The hedged share is shown as a shaded "protected" area against the locked rate.
   - The quarter screen shows a small static sparkline of the recent trend on each exposure card.
2. **Exposure size.**
   - Each exposure card shows its size this quarter.
   - A "Risk covered" meter shows the size-weighted share hedged.
   - The board's policy band is checked against the size-weighted cover, not each dial separately.
   - A "wrong focus" quarter (the big exposure left open while a small one is fully hedged) is called out by the board line and earns no in-policy points.
   - Locked (not yet hedgeable) exposures show their size, but don't count in the policy check.
   - The balance simulator must still pass all 15 criteria.
3. **Player character.**
   - 8 pixel avatars covering a range of skin tones, hair and presentation, chosen from pictures, never labelled by race or gender.
   - Picked once, before the first run; a title button changes it.
   - Shown next to the cash meter, on the result screen and on game over.
   - The face moves happy → worried → angry with cash and board mood.
4. **Out of scope:** Pro mode, the board roster and line changes, and a free-play leaderboard.

## Global Constraints
- Phone-first: everything fits at 360 px wide with no sideways scroll, and no text is smaller than 12 px.
- New player-facing copy is 90 characters or fewer, plain and in the game's tone. Escape anything shown, as now (use the `h()` helper and textContent; never innerHTML with data).
- **The start year stays hidden until game over.** Charts show **no dates, years or absolute price levels**: only shape and % moves. The quarter screen never shows data after the current quarter's start.
- The engine stays DOM-free and deterministic. Cosmetic code never consumes the simulation RNG (`run.seed` cosmetic streams via `cosmeticRng` only if randomness is needed).
- One animation loop per screen: pause when the tab is hidden, cancel on screen exit, and respect `prefers-reduced-motion` (draw the final frame at once).
- CSP: no inline scripts, no new external origins, no new dependencies. Canvases must be crisp at devicePixelRatio 2–3.
- Pro mode behaviour, its score and its policy checks are unchanged.
- The full `npm test` is green with clean output at the end of each task. No pushes, deploys, AWS or GitHub calls.
- Commit trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013Cv45agQ8i7mj8cWREbXcf
  ```

## Review Focus
1. **An exposure whose data starts mid-run** (dairy in agrifoods 2005, copper in tech 2000), or a series with gaps. The chart and sparkline skip gracefully, with no NaN drawn and no throw.
2. **An exposure with zero notional this quarter** (an event set it to 0), or all exposures locked. The meter shows a sensible state and nothing divides by zero.
3. **Leaking the era.** No axis labels, no year and no price level on any Simple chart.
4. **A saved run from before this change** (no avatar chosen, old summaries without `riskCover`). RESUME works and screens don't crash.
5. **A fast double tap** on the result screen, or on the avatar picker. It doesn't skip two steps or pick twice (use the existing `createTapGuard`).

---

### Task 1: Market charts (Simple)

**Files:**
- Create: `js/ui/PriceChart.js`. This holds the canvas chart, plus a pure helper `chartSeries(dataset, startYear, quarter, opts)` that returns `{ history: number[], quarter: number[] }` or `null`.
- Modify:
  - `js/screens/simple/ResultScreen.js`: a chart per active exposure line.
  - `js/screens/simple/QuarterScreen.js`: a sparkline on each exposure card.
  - CSS (`css/*.css`, wherever the Simple screens are styled).
- Test: `tests/client/priceChart.test.js`

**Interfaces:**
- Consumes:
  - `marketEngine.getDataset(underlying)`, the monthly series keyed `YYYY-MM-01` (see `js/engine/MarketEngine.js:122`);
  - from the result summary lines: `exposureId`, `movePct`, `exposureImpact`, `hedgeImpact` and `hedgeRatio` (`js/engine/sim/SimEngine.js`, `lines.push`);
  - the run's `startYear` and `quarter`, and the calendar helper the engine uses.
- Produces:
  - `chartSeries(...)`, which is pure: the trailing 12 monthly points up to the quarter start (`history`), and the start plus the 3 month-ends of the quarter just played (`quarter`). It returns `null` when fewer than 2 usable points exist.
  - `drawPriceChart(ctx, { history, quarter, progress, hedgeRatio, tone, w, h })`.
  - `mountPriceChart(container, opts) → { skip(), destroy() }`.

**Steps:**
- [ ] **Tests:**
  - `chartSeries` returns the right slices for a known dataset;
  - it returns `null` for a series that starts after the quarter;
  - gaps are filled or skipped, never giving NaN;
  - the `quarter` slice never goes past the quarter's end;
  - the sparkline slice (`opts.upTo: 'start'`) never contains points after the current quarter start.
- [ ] **Result chart:** one compact chart (about 64–80 px tall) per line, stacked to fit 360 px.
  - The history is drawn faint and static, then the quarter segment animates over about 1.8 s with interpolation between monthly points.
  - The end label is the signed % move, e.g. `+6.2%`.
  - The tone is red when the move hurt the business (`exposureImpact < 0`), green when it helped, and neutral when it was about 0. Use the existing CSS colour tokens.
  - When `hedgeRatio > 0`, draw a dashed "locked" line at the quarter's start price, shade the area between it and the price path, and put a small caption under the chart: `Hedged 75%`.
  - There are no axes, ticks, years or price levels.
  - Tapping the result body (the existing skip) completes the chart immediately.
- [ ] **Quarter sparkline:** a static sparkline, about 24 px tall, of the trailing 12 months up to the current quarter start on each exposure card. Leave it out when `chartSeries` is null.
- [ ] Respect reduced motion and hidden-tab pausing. Clean up on screen exit.
- [ ] Run `npm test`, then commit.

### Task 2: Player character (Simple and title)

**Files:**
- Create:
  - `js/ui/pixel/avatars.js`: 8 avatar pixel maps, each with `happy`, `worried` and `angry` faces. Reuse the palette and `drawSprite` format from `js/ui/pixel/sprites.js` if it fits; otherwise export a matching `drawAvatar(ctx, id, expression, x, y, scale)`.
  - `js/engine/sim/avatarMood.js` (pure, DOM-free): `avatarMood({ cash, redLine, startingCash, boardMood, status }) → 'happy'|'worried'|'angry'`.
  - `js/screens/simple/AvatarPicker.js`: the picker.
- Modify:
  - `js/utils/storage.js`: a per-player `avatar` key through the existing per-player helpers. It works for the guest key in free play.
  - `js/main.js`, `js/screens/TitleScreen.js` (a "CHARACTER" button), `QuarterScreen.js`, `ResultScreen.js` and `js/screens/GameOverScreen.js`.
  - CSS.
- Test: `tests/client/avatar.test.js`

**Rules:**
- **Mood mapping:**
  - `angry`: when `status` is `bankrupt` or `fired`, or cash is below `redLine`, or boardMood ≤ 25.
  - `worried`: when boardMood < 50, or cash < `redLine + 0.15 × startingCash`.
  - `happy`: otherwise.
- **Diversity:**
  - at least 5 distinct skin tones across the 8;
  - varied hair textures and styles;
  - at least one headscarf, one beard and one pair of glasses;
  - a mix of presentations;
  - no caricature.
  - The picker shows only the pictures. Use accessible labels `Character 1`–`Character 8`, never race or gender words.
- **Picker flow:**
  - The picker appears once, before the first run, when no avatar is stored for the current player (registered or guest). It sits after registration or the free-play PLAY, and before the industry screen.
  - One tap selects the avatar and continues.
  - A `CHARACTER` button on the title reopens it.
  - Make it a radio group that works with the keyboard, and use `createTapGuard`.
- **Storage:** device-local per player. It is **not** synced to `/progress`; the backend is unchanged (Ruling V1). A missing or unknown id means the picker appears.
- **Placement:**
  - the quarter screen: about 48 px, next to the cash meter, with the face from the current run state;
  - the result screen: the face after the quarter, so it reacts to the quarter;
  - game over: the face from the final status.
  - Pro screens are unchanged.

**Steps:**
- [ ] **Tests:**
  - every boundary of the mood mapping;
  - the storage round trip for a registered player and for the guest, with the two kept separate;
  - an unknown or missing id means the picker is needed;
  - `avatars.js` has 8 ids × 3 expressions, all the same size, with every palette index defined;
  - the picker's accessible labels contain no race or gender words.
- [ ] Implement the files above, wire them into the screens, and add the CSS.
- [ ] Run `npm test`, then commit.

### Task 3: Exposure size and size-weighted policy (runs after Tasks 1 and 2 are merged)

**Files:**
- Modify:
  - `js/engine/sim/SimEngine.js`, steps 4 and 6 of `simulateQuarter`;
  - `js/engine/sim/contract.md`;
  - `js/screens/simple/RunController.js` (board line key);
  - `data/quips.json`: a `wrongFocus` pool for `aggressive`, `cautious` and `operational`, with 6 lines each, every line 90 characters or fewer;
  - `QuarterScreen.js` (sizes and the meter), `ResultScreen.js` (the wrong-focus note), `js/ui/labels.js`;
  - CSS;
  - `README.md` (Board Dynamics).
- Test: `tests/engine/*` (policy) and `tests/client/*` (meter and labels). Update the `tools/simulate.js` strategies if needed.

**Rules (engine):**
- **Weight.** Each active exposure's weight `w` is the absolute value, in the company's reporting currency, of this quarter's forecast notional at the quarter's start rate. Use the same conversion `exposureCashImpact` uses, and put the helper in `exposureMath.js` as `exposureValue(exp, rate, notional)`.
- **The policy set `P`** is the active exposures with forecast ≠ 0, `isHedgeable`, and a usable start rate.
- **Cover:** `cover = Σ h·w / Σ w` over `P`, using the clamped `h`. It is `null` when `P` is empty.
- **wrongFocus** is true when, within `P`, the largest-weight exposure L has another exposure S in `P` such that:
  - `w_L ≥ 2 × w_S`, and
  - `h_S − h_L ≥ 0.5`.
- **inPolicy:**
  - with a mandate and `cover !== null`: `min ≤ cover ≤ max` (with a 1e-9 tolerance) **and** not `wrongFocus`;
  - with a mandate and `cover === null`: vacuously true, as now;
  - for a noHedge board (`max === 0`): cover must be 0, which matches today.
- **Summary** gains:
  - `riskCover` (number or null);
  - `wrongFocus` (boolean);
  - `exposureValues` (`{ [exposureId]: w }`) for the UI.

  Old summaries without these fields must still load.
- **No-policy board:** `wrongFocus` gives the board line only; there is no mood change.
- **Pro** (`proAdapter.js`) is untouched; add a test proving a Pro quarter's policy result is unchanged.

**Rules (UI):**
- **The card size line:** e.g. `$120m this quarter`, formatted in the company currency with the existing `formatCash`. Locked cards show the size greyed, with their existing locked reason.
- **The "RISK COVERED" meter:** sits under the cash meter. It is the live `cover` from the dials as they're set, using the same helper as the engine, so the UI and the engine never disagree.
  - It shows the board's band as a shaded zone and turns amber when the policy check would fail (outside the band or `wrongFocus`).
  - The line `Big exposure left open` shows when `wrongFocus`.
  - Put the shared pure function in the engine, e.g. `policyCover(run, hedges, notionalMult) → { cover, wrongFocus, values }`, and use it in both `simulateQuarter` and the screen.
- **Result screen:** when `wrongFocus`, the board line uses the `wrongFocus` pool. The chairman yields to it, as with the existing yield list.

**Steps:**
- [ ] **Engine tests:**
  - **cover:** a known 2-exposure case gives the exact value;
  - **wrongFocus:** a case each side of the 2× and 0.5 boundaries;
  - **inPolicy:** the band check uses cover;
  - **locked exposures:** excluded;
  - **zero notional:** excluded;
  - **noHedge board:** unchanged;
  - **no-policy board:** no mood effect;
  - **determinism:** the same seed and decisions give the same result;
  - **Pro:** unchanged.
- [ ] Implement the engine, then update `contract.md`.
- [ ] Run `node tools/simulate.js --n 1000`. All 15 criteria must pass with a ≥10% margin. If one fails, change only the simulator strategies' dial choices to follow the new rule (a "follow the mandate" player sets every dial to the band midpoint, which is still in policy). **Do not change `balance.js` numbers without reporting why.** Report the table.
- [ ] Build the UI parts with tests: the meter value equals the engine cover for the same input, and the size label is formatted correctly.
- [ ] Update the README Board Dynamics section. Run `npm test`, then commit.
