# Hedj Treasury Game v3: conference phone edition

## Context
The current game (already labelled v2.0) is too long, too dense and too fragile for its real use: a player scans a
QR code at the Hedj conference stand and then plays on their own phone whenever they're bored during the event.
Players are CFOs, treasury managers and the wider range of attendees. They should keep coming back to beat their
own best, climb the conference leaderboard, win a prize at the stand, and unlock new things.

Exploration of **hedj-game-competition** (the base for v3; it already contains all of main's v2.0 work) found:
- A "5 min" Quick Play really takes 6–16 min and 50–300 taps. Hedging one exposure means a direction test, a product,
  an 8-row tenor ladder and a bank choice.
- There's no save or resume (`storage.js:22-50` and `GameState.toJSON/fromJSON` exist but are never called).
- The leaderboard can't support a prize:
  - the score is computed in the browser and trusted (`backend/handlers/score.mjs:36`);
  - names aren't escaped (`TitleScreen.js:337,422`, `GameOverScreen.js:~404`), so a player can inject code;
  - there's one global list storing every game, not each player's best;
  - the token lasts 4 hours, so players re-register and lose their consent ticks.
- Broken mechanics:
  - the score penalises gains like losses;
  - credit lines never free up;
  - interest-rate exposures produce zero P&L;
  - the trading-cost penalty is always 0;
  - simulation logic lives in the UI (end rates are computed in `DashboardScreen.js:418-447`);
  - the shared RNG is consumed by UI timers, so no run can be replayed.
- 19 MB of scene PNGs (one has an AI watermark) and emoji board members. Pixel fonts at 6–8 px on phones.
- Cash has no operating cash flow.
- The humour (parody chairmen, JP Moaning, board one-liners) is a strength; the event text is flat.

**Outcome:** a ~3-minute, 8-quarter, phone-first run that is quick to retry and fair enough to award a prize on.
It looks better, is funnier, and shows the Hedj platform's newer forecasting and cash themes.

## Decisions

**Made by the user**
- **Base:** hedj-game-competition. This is an upgrade of the existing framework, built quickly with parallel agents, not a rebuild.
- **Run:** about 3 minutes, 8 quarters.
- **Retry hooks:** all four — personal best, conference leaderboard, prize at the stand, unlocks.
- **Market:** random every run (no daily seed).
- **Modes:** Simple mode for everyone, plus a Pro mode with today's full desk.
- **Realism:** a cash runway meter. Running out of cash ends the game.
- **Graphics:** built in code, refined retro pixel style (keep the identity, make it crisp and readable).
- **Out of scope:** website version, realistic training scenarios, the hedj.eu/game route (parked separately).
- **Hosting:** v3 replaces competition.hedj.eu (same bucket, distribution and backend stack). A new `eventId`
  starts fresh; old competition data stays in the admin export.
- **Two leaderboards, Simple and Pro, with the same protection.** Prizes are awarded at the stand from either; the build doesn't change.
- **Security is casual-level:** nobody is expected to bother cheating, but nothing may risk the wider hosting or
  domain. So there's no server-side replay; plausibility checks, escaping, rate limits and isolation instead (see Backend).
- **Register before playing,** as today, but once per event: the token lasts the event and consent is kept.
- **Both people's own phones and a shared stand device.** Progress (best score, unlocks, saved run) is tied to the
  registered player, mirrored to the backend, and "Not you?" switching stays.

**My calls (flag any you disagree with)**
- **Score is measured against doing nothing in the same market.** Random markets add luck, so the score is skill
  relative to the unhedged result in that exact run, plus survival and board points. That keeps the leaderboard
  fair with no daily seed.
- **Separate leaderboards for Simple and Pro**, best score per player per mode, with Today and Whole-event tabs.
- **A board mandate band** replaces the random hedging policy. One band per run (e.g. "board wants 50–75% hedged"), shown on the dial.
- **Power-ups are Hedj platform features:** Cash Forecasting, Cash Visibility, Options Desk. Each card has one line
  of "in real life Hedj does this". This replaces TMS modules.
- **Pro mode unlocks after the first completed run**, so the first experience stays simple.
- **Career mode and Quick Play extensions are removed.** Every run is 8 quarters. `CareerEngine`, `ExtendScreen`
  and `career-levels.json` are deleted and the README updated.
- **The start year stays hidden until game over** (as today). Crisis scenarios are unranked challenges with their
  own badges, so remembering history can't top the leaderboard.
- **Interest-rate exposures:**
  - EUR companies keep theirs, using real EURIBOR.
  - The synthetic SOFR/SONIA exposures are dropped (Tech, Energy, Retail), so those industries hedge FX and
    commodities only.
- **The game works offline (PWA),** with self-hosted fonts and add-to-home-screen, so it survives conference wifi
  and stays on the phone.
- **Start years only where real data exists** (2000+ for FX, 2008+ for jet fuel). The synthetic SOFR/SONIA series stop being used.

## The experience (Simple mode)

1. **Title:** a big PLAY button, personal best, current rank, "chairmen met 3/8" and unlock progress. RESUME appears if
   a run is in progress. Registration happens once per event; the token lasts the event (config) and re-registering
   never wipes consent.
2. **Pick industry:** from the unlocked ones. Start with 3; the rest unlock by score or runs played. Then straight into Q1.
3. **Quarter screen (one screen, about 3 taps):**
   - A cash runway meter at the top, big, with a red zone.
   - An animated scene strip.
   - Up to 4 exposure cards, each with a hedge dial (0/25/50/75/100%) showing the mandate band and a
     forecast-confidence hint.
   - One power-up slot.
   - A "RUN THE QUARTER" button.
4. **Result (about 10 s, tap to skip):**
   - The market move plays out on the scene and the cash meter animates.
   - One line per exposure (e.g. "Dollar jumped 6%. Your hedge saved €1.2m").
   - One board or chairman quip of 90 characters or fewer.
   - Sometimes an event card with two real, funny choices.
5. **After Q8, or bankruptcy or firing:**
   - The score counts up, with a NEW PERSONAL BEST fanfare and the player's conference rank.
   - Anything unlocked is shown.
   - One-tap PLAY AGAIN.
   - Share text.

A run should take 25–35 taps. The autosave after each quarter means a closed tab loses nothing.

**Pro mode:** today's dashboard desk (direction, product, tenor ladder, banks), running on the new engine and score,
with its bugs fixed (credit release, IR P&L, trading costs, unwinds). It has its own leaderboard.

## Mechanics

- **Cash runway.** Each quarter:

  cash += forecast operating cash flow × (1 + forecast surprise)
        ± rate move on the unhedged part
        ± hedge settlement
        − premiums − margin calls − power-up costs

  Cash at 0 means "The bank has called": the run ends, keeping the points earned so far. Low cash triggers board panic.
  Reuse `ForecastEngine.js` for the surprise and the existing margin logic in `GameLoop.calculateQuarterlyPnL`.
- **Forecasting teaches itself.** If you hedge 100% and actual volumes come in 30% under forecast, the over-hedge
  costs cash. The Cash Forecasting power-up narrows the surprise; reuse the variance reduction from `TMSEngine.js`.
- **Score** (an integer to chase, not a 0–100 grade):
  - per-quarter points for staying in the mandate band and out of the red zone;
  - a stability bonus for smaller swings than the unhedged run;
  - outperformance versus the unhedged run, positive or negative (gains are no longer penalised);
  - a board-mood multiplier.

  Weights get tuned with the simulator (see Verification).
- **Unlocks:**
  - industries;
  - Pro mode;
  - crisis scenarios (2008, Brexit, COVID, 2022 energy), forced start years with bonus multipliers;
  - collectible chairmen ("met 3/8");
  - power-ups.

  All progress is stored per player (localStorage, mirrored to the backend).
- **Engine cleanup:** separate RNG streams for the simulation and for cosmetics (`js/utils/random.js`). Rate
  resolution moves out of the Dashboard into the engine. The engine stays free of DOM code, so it runs in Node for
  the balance simulator and tests.

## Humour (content pass, data only)
- Rewrite board and chairman pools to 90 characters or fewer for phones, keeping the parody cast and the banks
  (JP Moaning, Debit Suisse…).
- Result-screen quips keyed to the outcome: big save, big miss, over-hedged, near bankruptcy.
- Event cards rewritten as funny dilemmas with two real choices that change the simulation. Fix the ones whose
  text promises choices they don't have (`fuel_spike`, `pe_acquisition`).
- A conference event pool: keynote overran, lanyard mix-up, coffee queue, "the CFO is at the bar".
- Power-up cards: one-line real-world Hedj tie-in. Game-over titles per score band.

## Graphics (code-drawn, refined retro pixel)
- Replace the 7 PNG scenes (19 MB) with procedurally drawn pixel scenes rendered at low logical resolution and
  scaled crisply. Build on the existing ~1,900-line procedural fallback in `js/ui/IsometricScene.js`.
- Scenes react to the market: grounded planes when fuel spikes, storm clouds on a bad FX move, coins on a save.
- Board members and the 8 chairmen become pixel sprites with neutral, happy and angry expressions (pixel maps in
  JS), replacing the emoji. A board reaction plays on the result screen.
- Short code-driven cutscenes for the intro, bankruptcy and new personal best (canvas, no video files).
- Readability: a 12 px minimum for pixel text on mobile, VT323 for body text, the CRT overlay off or light on
  mobile, and one animation loop (pause it when hidden).
- Use the frontend-design and canvas-design skills during build. The page should load in under 1.5 MB.

## Backend (`backend/`)
- **Per event:** an `eventId` in config. The leaderboard keeps each player's best per mode per event, with Today and
  Whole-event views. Players are deduplicated, so one person can't fill the top 10.
- **`POST /score` plausibility checks:** score within the achievable range for the mode, quarters ≤ 8, run duration
  at least about 60 s (start time recorded at run start), and one submission per `gameId`.
- **Identity:**
  - the token lasts the event (configurable) instead of 4 hours;
  - re-registering updates the player row without wiping consent or `registeredAt`;
  - a per-player play count;
  - a scores index by email.
- **Player progress endpoint** (`GET/PUT /progress`, token-auth): best per mode, unlocks, chairmen met. This makes
  progress follow the player between the stand device and their phone. The saved mid-run state stays on the device.
- **Security and isolation** (casual cheating isn't a concern, but the wider hosting is):
  - escape every player-supplied string when it's shown, and validate it on the server (length, characters);
  - API Gateway throttling and per-route rate limits;
  - request size limits;
  - CORS locked to competition.hedj.eu;
  - least-privilege Lambda roles (each handler touches only its table);
  - admin key sent only in a header and compared in constant time, plus admin throttling;
  - CSP and security headers on the competition CloudFront distribution;
  - the stack stays fully separate from the hedj.eu / platform accounts' resources.
- **Privacy:**
  - write the `ttl` attribute so the 90-day deletion promised in `privacy.html` actually happens;
  - fix the info@ vs competition@ contact mismatch;
  - add `admin.html` and `privacy.html` to the frontend deploy triggers.
- **Admin:**
  - plays per day, unique players, **return rate** (runs per player, % who played in 2+ sessions);
  - a prize-winner export;
  - a big-screen leaderboard page for the stand (auto-refresh).

## Build plan (parallel agents, split by file ownership)

**Step 0 (lead, first): the contract.** Write `js/engine/contract.md`, defining:
- the run state shape;
- the decision-log format;
- `simulateQuarter(state, decisions) → {state, result}`;
- the scene API `drawScene(ctx, industry, sceneState, t)`;
- the dialogue keys.

Everything below builds against it.

| Stream | Owns | Depends on |
|---|---|---|
| **A. Engine** | `js/engine/*`, `js/utils/random.js`, `js/state/GameState.js`, `tools/simulate.js`. Covers deterministic RNG, the new `SimEngine` (rate resolution pulled out of the Dashboard), cash runway, the new score, power-ups, mandate band, unlocks, save/resume, Pro-mode bug fixes, and the Node test suite. | Contract |
| **C. Graphics** | `js/ui/IsometricScene.js` (rewrite), new `js/ui/sprites/*`, `js/ui/Cutscene.js`, removal of `assets/images/scenes/*` | Contract (scene API) |
| **D. Content** | `data/board-dialogue.json`, `data/events.json`, new `data/quips.json`, `data/powerups.json` | Contract (keys) |
| **E1. Backend** | `backend/*` except replay: per-event leaderboard, best-per-player, tokens, escaping, TTL, admin metrics, stand page | Contract |
| **B. Simple UI** | new `js/screens/QuarterScreen.js` and `ResultScreen.js`; rework of `TitleScreen`, `SetupScreen`, `GameOverScreen` and `main.js`; mobile-first CSS | A's API, C, D |
| **F. Pro mode** | `DashboardScreen.js` rewired to the new engine and score | A |
| **E2. Client wiring** | `js/utils/api.js` and `storage.js`: score submit, progress sync, per-player local storage, offline queue (multi-entry) | E1, A |
| **G. PWA/perf** | `manifest.json`, `sw.js`, self-hosted fonts, `index.html` | B |

Order: Step 0 → A, C, D and E1 in parallel → B, F and E2 → G → balance and playtest (lead).
If time is short, cut in this order:
1. cutscenes;
2. crisis scenarios;
3. Pro mode polish (keep its bug fixes);
4. the stand big-screen page. The HowToPlay guide gets
cut to 3 swipe cards for Simple mode, and the README is updated (it currently claims 10 industries and ~5 min).

## Verification
- **Balance simulator.** `node tools/simulate.js` runs 1,000+ random runs per strategy: unhedged, flat 50%, follow the
  mandate, 100%, and random. Checks:
  - mandate-following clearly beats unhedged on average;
  - the luck spread in score is bounded (a good strategy's 25th percentile is above a bad strategy's 75th);
  - unhedged runs sometimes go bankrupt;
  - every run ends in 8 quarters or fewer.
- **Engine tests.** `node --test`: same seed + decisions → same result; cash-runway bankruptcy; the score doesn't
  penalise gains; credit lines release; IR P&L is non-zero for EUR firms.
- **Backend.** Handler unit tests:
  - a name like `<img src=x onerror=alert(1)>` renders as text;
  - re-registering keeps consent;
  - best-per-player dedupe works;
  - out-of-range and too-fast scores are rejected;
  - progress syncs between two "devices" (two browser profiles);
  - the throttling config is present in the SAM template.
- **Phone playtest.**
  - Local server (`python -m http.server`) on a real phone and in Chrome device mode.
  - Time a Simple run (3–3.5 min) and count taps (≤35).
  - Close the tab mid-run and resume.
  - Airplane mode: play offline and see the queued score submit later.
  - Check text is readable at 360 px wide.
- **Weight.** Lighthouse mobile: under 1.5 MB transferred, good LCP, no console errors.
- **Pre-event dry run.** Use a `test` eventId on competition.hedj.eu, then switch the config to the real event.

## Risks
- **Parody chairmen** (Jamie Diamond, ElonUsk, Michael O'Scary…) in front of bankers and CFOs. They're already
  shipped, but worth a quick tone check before a bigger event.
- **Replacing competition.hedj.eu** is a live cutover. Export the current admin CSV first, deploy the backend
  (additive tables and indexes) before the frontend, and dry-run with a `test` eventId.
