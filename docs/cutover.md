# v3 cutover checklist: competition.hedj.eu

This checklist replaces the live v2 competition game with v3. Work through it top to bottom and tick each box as you
go. Commands are for Git Bash or any POSIX shell, with the AWS CLI signed in to the competition account
(`eu-north-1`), and `gh` signed in to the GitHub repo.

**How deploys work now.** There is one workflow, `.github/workflows/deploy.yml`. Every push to `main` that touches the
site or `backend/` deploys the **backend first, then the frontend**, whatever changed. An unchanged backend is a quick
no-op and the site sync is idempotent. The frontend job never runs after a failed or cancelled backend deploy. Two
deploys never overlap. You can also run it by hand: Actions → "Deploy Competition (backend, then frontend)" → Run
workflow → `both`, `backend` or `frontend`.

Names used below:

| Thing | Value |
| --- | --- |
| Site | `https://competition.hedj.eu` |
| Bucket | `hedj-comp-assets-eu-north-1` |
| Stack | `hedj-competition-backend` |
| Tables | `HCompPlayers-hedj-competition-backend`, `HCompScores-…`, `HCompBest-…` (new), `HCompAnalytics-…` |

---

## A. Before anything

- [ ] **A1. Export the current admin CSV.** Open `https://competition.hedj.eu/admin.html`, enter the admin key and
      press **DOWNLOAD CSV**. Or from a shell:
      ```sh
      curl -fsS -H "x-admin-key: <ADMIN KEY>" \
        "https://competition.hedj.eu/api/admin/players?format=csv" -o players-pre-v3.csv
      ```
      Keep this file safe. It is personal data.
- [ ] **A2. Take a raw backup of the tables.** v3 keeps the existing tables and only adds new ones, but a backup costs
      nothing:
      ```sh
      for t in HCompPlayers HCompScores HCompAnalytics; do
        aws dynamodb scan --region eu-north-1 --table-name "$t-hedj-competition-backend" \
          --output json > "backup-$t-$(date +%Y%m%d).json"
      done
      ```
- [ ] **A3. Back up the live site,** so the rollback (section J) can put it back exactly:
      ```sh
      aws s3 sync s3://hedj-comp-assets-eu-north-1/ ./comp-bucket-backup-$(date +%Y%m%d)/ --region eu-north-1
      ```
- [ ] **A4. Tag what is live now:**
      ```sh
      git fetch origin && git tag pre-v3-cutover origin/main && git push origin pre-v3-cutover
      ```
- [ ] **A5. Check the CloudFront `/api/*` behaviour.** v3 sends two new request headers (`x-player-email`,
      `x-game-token`), uses `PUT /api/progress`, and relies on query strings (`?mode=…&period=…`):
      ```sh
      aws cloudfront get-distribution-config --id <CF_COMP_DISTRIBUTION_ID> \
        --query "DistributionConfig.CacheBehaviors.Items[?PathPattern=='/api/*'].{methods:AllowedMethods.Items,cache:CachePolicyId,origin:OriginRequestPolicyId,legacy:ForwardedValues}"
      ```
      Expect all seven methods (including `PUT`), the managed cache policy **CachingDisabled**, and the managed origin
      request policy **AllViewerExceptHostHeader** (or a legacy `ForwardedValues` that forwards all headers and all
      query strings). If headers or query strings are not forwarded, fix the behaviour before going on. Otherwise
      progress sync fails with 401, and the today/all-time leaderboards can show the same cached list.

## B. GitHub settings

- [ ] **B1. Confirm the secrets exist** (Settings → Secrets and variables → Actions → Secrets): `AWS_ROLE_ARN_COMP`,
      `COMP_ADMIN_KEY` and `CF_COMP_DISTRIBUTION_ID`.
      ```sh
      gh secret list
      ```
      The IAM role's OIDC trust needs no change: it is the same repo and the same `main` branch, and only the workflow
      file name changed. The admin key must not contain a double quote (`"`) or a backslash (`\`): the deploy passes
      it to SAM inside double quotes and refuses such a key. Spaces, commas and other symbols are fine.
- [ ] **B2. Set the event variables to test values first** (Settings → … → Variables):
      ```sh
      gh variable set COMP_EVENT_ID --body test
      gh variable set COMP_TOKEN_TTL_HOURS --body 120
      gh variable delete COMP_EVENT_END_ISO 2>/dev/null || true   # empty for the test event
      gh variable list
      ```
      `COMP_EVENT_ID` **must be set before you merge**: a push to `main` fails the backend job if it is unset (only a
      manual run falls back to `test`). An unset TTL means `120` and an unset end date means "no end date". The event
      id may only contain letters, digits, `_` and `-` (up to 40 characters), and the end date must be UTC in the form
      `2026-11-20T18:00:00Z` (or `…T18:00Z`); the deploy refuses anything else.
- [ ] **B3. Note:** there is no event id in the frontend. The backend's `EventId` alone selects the leaderboard, so the
      two can never disagree.

## C. Deploy the backend first (additive: new tables and indexes)

- [ ] **C1. Merge the v3 branch into `main`** (via the pull request). This starts "Deploy Competition (backend, then
      frontend)". Open it in the Actions tab.
- [ ] **C2. Watch the backend job.** Its log should show `Deploying EventId=test EventEndIso=<empty> TokenTtlHours=120`.
      CloudFormation then adds the `HCompBest` table with its `ByScore` index, the progress function and the admin
      routes. The existing tables are not replaced; they only gain `DeletionPolicy: Retain` and
      `UpdateReplacePolicy: Retain` (a metadata change), so from now on no stack change can delete their data.
      **If this deploy fails and CloudFormation rolls back,** the new `HCompBest-hedj-competition-backend` table may be
      left behind outside the stack (it is Retain too). It is empty: delete it before you retry, or the retry fails with
      "already exists":
      ```sh
      aws dynamodb describe-table --region eu-north-1 --table-name HCompBest-hedj-competition-backend --query Table.ItemCount
      aws dynamodb delete-table --region eu-north-1 --table-name HCompBest-hedj-competition-backend
      ```
- [ ] **C3. Check the API URL** in the job summary. It should be the same API as the CloudFront `/api/*` origin (same
      stack, so the URL should not change). If it differs, update the origin.
- [ ] **C4. Smoke-test the API:**
      ```sh
      curl -fsS "https://competition.hedj.eu/api/leaderboard?mode=simple&period=all&limit=3"; echo
      ```
      Expect valid JSON with an empty list (the `test` event has no scores yet).

## D. Deploy the frontend

- [ ] **D1. Watch the frontend job.** It starts after the backend job finishes. It syncs the site, sets content types,
      uploads the fonts as `font/woff2` with a one-year cache, and invalidates CloudFront.
- [ ] **D2. Check the headers:**
      ```sh
      curl -sI https://competition.hedj.eu/js/main.js | grep -iE 'content-type|cache-control'
      curl -sI https://competition.hedj.eu/assets/fonts/VT323-Regular.woff2 | grep -iE 'content-type|cache-control'
      ```
      Expect `application/javascript` with `max-age=300`, and `font/woff2` with `max-age=31536000, immutable`.
- [ ] **D3. Hard-reload `https://competition.hedj.eu` on a laptop.** You should see the v3 title screen.

## E. One-off bucket cleanup

Earlier deploys synced some dev files into the public bucket. Excluded paths are never deleted by later deploys, so
remove them once by hand. **Run each command with `--dryrun` first, read what it would delete, then run it again
without `--dryrun`.**

- [ ] **E1. See what is there:**
      ```sh
      aws s3 ls s3://hedj-comp-assets-eu-north-1/ --region eu-north-1
      ```
- [ ] **E2. Folders** (dry run, then for real):
      ```sh
      for p in tests docs node_modules .superpowers; do
        aws s3 rm "s3://hedj-comp-assets-eu-north-1/$p/" --recursive --region eu-north-1 --dryrun
      done
      ```
- [ ] **E3. Single files** (dry run, then for real):
      ```sh
      for f in package.json package-lock.json "Open Game.url" "Individual industry sample images.png"; do
        aws s3 rm "s3://hedj-comp-assets-eu-north-1/$f" --region eu-north-1 --dryrun
      done
      ```
- [ ] **E4. Check:** `https://competition.hedj.eu/docs/game-qr.png` and `https://competition.hedj.eu/package.json`
      should now give 403 or 404.

## F. Attach the CloudFront security headers policy

- [ ] **F1. Follow `docs/cloudfront-security-headers.md`:** create the policy, confirm the distribution's alias is
      `competition.hedj.eu` (never the hedj.eu distribution), attach it to the default behaviour (not `/api/*`), and
      verify with `curl -sI`. Do this now, before the phone dry run, so the dry run also proves the CSP blocks nothing.
- [ ] **F2.** Load `/`, `/stand.html`, `/admin.html` and `/privacy.html` on a laptop with the console open. Expect no
      "Content Security Policy" errors. Log in on the admin page and press each button once.

## G. Phone dry run against the test event

Use real phones on mobile data or venue-like wifi: at least one iPhone (Safari) and one Android (Chrome). Use your own
name and email, or obvious test ones, so you can spot them in the CSV later. Open the browser console where you can
(Safari Web Inspector or Chrome remote debugging) and keep it open.

### G1. Everywhere
- [ ] No console errors and no CSP violations on any screen, in Simple or Pro.
- [ ] **No text under 12 px at 360 px wide.** In desktop Chrome device mode at 360 px, paste this into the console on
      each screen (title, guide, industry, quarter, result, game over, leaderboard, registration, the Pro screens):
      ```js
      [...document.querySelectorAll('*')].filter(e => e.offsetParent && parseFloat(getComputedStyle(e).fontSize) < 12 && e.textContent.trim())
      ```
      Expect `[]`.
- [ ] Layout at 360, 375 and 414 px, and on desktop inside the 960×640 frame. Nothing overflows sideways.
- [ ] The sticky footer button sits above the iPhone home indicator.
- [ ] Text drawn on canvases (scene strip, Pro hedge ladder, stress face, Bloomberg terminal) is readable.
- [ ] The symbols →, ▶, ✓, ⚠ and ─ render acceptably. They come from the phone's fallback font, as before.
- [ ] On phones the CRT overlay is gone, and the big cash figure (32 px) looks right.
- [ ] **600 ms tap guard.** A deliberate tap just after a screen changes should not feel ignored. A fast double tap
      on RUN must never play two quarters or confirm an off-policy warning by accident.
- [ ] Fonts load: Network tab shows the woff2 files as `font/woff2`, and nothing from Google.
- [ ] The first load transfers under 1.5 MB (Network tab, cache disabled).

### G2. Registration and title
- [ ] PLAY while not registered → registration → industry screen.
- [ ] Names: `Zoë 🙂` and `O'Brien` are accepted; `<b>x</b>` is rejected; whatever you enter shows as plain text
      everywhere.
- [ ] The title shows today's rank, the top 3 and the LEADERBOARD modal from the live API, and the stats repaint after
      the progress sync.
- [ ] **"Not you?":** player A starts a run and leaves it mid-way. Player B uses "Not you?" and registers. B must see
      no RESUME, no personal best and no unlocks from A. Switch back to A: A's RESUME is there.
- [ ] **A phone that played v2 before:** the old save does not offer RESUME, nothing crashes, and an old registration
      either works or asks the player to register again, with no lost score.
- [ ] **Progress across devices:** finish a run on phone 1. Register on phone 2 with the same email. Its best and
      unlocks appear (this proves `/api/progress` passes through CloudFront).
- [ ] The PLAY guide shows the first time only and can be skipped. Swiping and the dots stay in sync; it scrolls
      smoothly on iOS; the longest bullet still reads well at 360 px.
- [ ] The PRO button reaches the Pro flow.

### G3. A Simple run: timing and taps
- [ ] **Play 3 Simple runs.** Time each one and count every tap from PLAY to PLAY AGAIN. Target: **3 to 3.5
      minutes** and **35 taps or fewer** per run. Write the numbers down:
      | Run | Industry | Minutes | Taps |
      | --- | --- | --- | --- |
      | 1 | | | |
      | 2 | | | |
      | 3 | | | |
- [ ] **Resume:** close the tab mid-run, reopen the site, press RESUME. You land on the same quarter with the same cash.
- [ ] Industry cards are readable, including the pixel-font names.

### G4. Quarter screen
- [ ] The dial snaps to 0/25/50/75/100%; the band shading and the hatched locked steps are clear.
- [ ] **The cash meter:** the fill, the red line and the colours read at a glance.
- [ ] The scene strip is crisp on a high-density screen, doesn't grow or flicker, and pauses when the tab is hidden.
      The chairman sprite is clear at 64 px.
- [ ] A quarter with no event takes 4 taps or fewer (RUN alone is 1; with an off-policy confirm, 2).
- [ ] **On a 75–100% board before Bigger Bank Facilities:** the dial explains the 50% cap, the facilities card comes
      first, and RUN asks "Outside the board's policy — run anyway?". Try an airline run.
- [ ] An unaffordable power-up says why, and a screen reader still reads its reason.
- [ ] **VoiceOver (iPhone) and TalkBack (Android) on the hedge dial:** one swipe stop for the dial, the selected step is
      announced, and swiping up or down changes it. On desktop: Tab reaches each dial once, the arrow keys move it, and
      the focus ring is visible.
- [ ] Event cards: both choices work.

### G5. Result screen
- [ ] **Readability now that there is no auto-advance:** you can read the board's line and the results before tapping
      NEXT, and nothing moves on without you. A tap on the body skips the animation; NEXT advances.
- [ ] The meter counts up, the lines stagger in, and the sprite expression and border colour match the result (angry,
      happy or neutral).

### G6. Game over
- [ ] The score counts up; the title, the year card and the rank show.
- [ ] Cutscenes fill the screen; a tap skips each one, and that tap doesn't also hit PLAY AGAIN. The personal-best
      scene plays before the bankrupt or fired one.
- [ ] **Bankruptcy:** play an unhedged energy or construction run, or set `run.cash` very negative in the console before
      RUN. The bankrupt screen shows and the score is still submitted, with a rank.
- [ ] **Airplane mode at game over, then reconnect:** turn on airplane mode before the last RUN. The game over shows
      "Queued, will submit when online". Turn airplane mode off: the queued score submits by itself (or on the next
      visit) and appears on the leaderboard.
- [ ] **Share:** the copy button works on iOS Safari and on Android Chrome.

### G7. Pro mode
- [ ] Play one full Pro run to game over: the v3 headline, the Pro title, the score submitted as Pro, and PLAY AGAIN
      goes to Pro setup.
- [ ] A Pro quarter with no hedges takes 30 seconds or less of waiting. Event pop-ups type quickly, and a tap
      completes them.
- [ ] At 360 px the Pro dashboard, hedge ladder and board review fit: no overflow, the tabs scroll, the cash-meter row
      fits, the portraits show, and a tap completes the speech bubble.
- [ ] **The cash meter vs the "Settled Cash" label:** the meter shows economic cash (it drives the red line, bankruptcy
      and the score). The quarter summary's "Settled Cash (excl. unrealised)" can differ. Check that the two don't
      read as a contradiction.
- [ ] Board mood visibly moves on the board review screen.

### G8. Stand page and admin page
- [ ] **Stand:** open `https://competition.hedj.eu/stand.html` full screen on the stand device (iOS 16 or later, or a
      current Chrome). The board shows the test scores, refreshes by itself, recovers after a wifi drop, and doesn't
      stall when the tab comes back to the foreground.
- [ ] **Admin:** `https://competition.hedj.eu/admin.html`. Unlock with the key; the visits, plays, registrations and
      engagement figures look plausible; DOWNLOAD CSV works; all four prize CSV buttons download files; REFRESH works;
      a wrong key shows INVALID ADMIN KEY.

### G9. Clean up after the dry run
- [ ] Make sure no test phone has a queued score waiting. Open each one online once, or clear its site data.
      Otherwise a queued test score could submit after the switch and land on the real event's board.

## H. Switch to the real event

- [ ] **H1. Set the real values:**
      ```sh
      gh variable set COMP_EVENT_ID --body <event-id>               # e.g. hedj-expo-2026; letters, digits, _ and - only
      gh variable set COMP_EVENT_END_ISO --body <end, ISO-8601 UTC> # e.g. 2026-11-20T18:00:00Z (Z, no offset)
      gh variable set COMP_TOKEN_TTL_HOURS --body 120
      ```
      Once the event starts, don't change `COMP_EVENT_ID` again. A new id starts an empty leaderboard. Players and
      score rows expire 90 days after the end date.

      **Never delete `COMP_EVENT_ID` after this point.** If it is unset, every push to `main` fails its backend job (and
      so skips the frontend) instead of switching the live event to `test`. Only a manual run
      (`gh workflow run deploy.yml`) falls back to `test`, so don't start one while the variable is missing.
- [ ] **H2. Redeploy the backend only:**
      ```sh
      gh workflow run deploy.yml -f target=backend
      ```
      Check that the log says `Deploying EventId=<event-id> …`.
- [ ] **H3. Check:** the leaderboard is empty, both by curl (as in C4) and on the title screen. Test scores stay under
      the `test` event and don't show. Test registrations do stay in the players CSV, so ignore them.

## I. Print the QR code

- [ ] **I1. Scan `docs/game-qr.png` with a phone first.** It predates v3. Use it only if it opens exactly
      `https://competition.hedj.eu`. Otherwise make a new one:
      ```sh
      npx --yes qrcode@1.5.4 -e H -w 1200 -o competition-qr.png "https://competition.hedj.eu"
      ```
- [ ] **I2.** Print one test copy at the final size. Scan it from 1–2 m with an iPhone camera and an Android camera
      before printing the rest.

## J. Rollback

The v2 frontend can't submit scores to the v3 API (v3 requires `mode` and `startedAt`), so a rollback means rolling
back **both** halves. During the dry run (before H), fixing forward is usually quicker.

- [ ] **J1. Detach the security headers policy first** (`docs/cloudfront-security-headers.md`, "Removing it"). The v2
      pages load Google Fonts and have an inline admin script, which the policy blocks.
- [ ] **J2. Export the v3 best scores.** The rollback keeps the table (it is Retain), but you will have to delete it
      before v3 can be deployed again (J6), so take a copy now:
      ```sh
      aws dynamodb scan --region eu-north-1 --table-name HCompBest-hedj-competition-backend --output json > backup-HCompBest.json
      ```
- [ ] **J3. Revert on `main`:**
      ```sh
      git checkout main && git pull
      git revert -m 1 <merge commit sha> && git push     # for a squash merge: git revert <squash commit sha>
      ```
      The revert brings back the old two workflows, which redeploy the v2 backend and frontend. The v2 template has no
      `HCompBest` table or progress function. CloudFormation deletes the progress function, but only removes the
      `HCompBest` table from the stack: the table itself is retained, with its data, outside the stack.
      `HCompPlayers`, `HCompScores` and `HCompAnalytics` are kept as before (the v2 template drops their Retain
      policy again, which is a metadata change only).
- [ ] **J4. If GitHub Actions is unavailable,** restore by hand from the backups in A3 and A4:
      ```sh
      aws s3 sync ./comp-bucket-backup-<date>/ s3://hedj-comp-assets-eu-north-1/ --delete --region eu-north-1
      for x in "js application/javascript" "css text/css" "json application/json"; do set -- $x
        aws s3 cp s3://hedj-comp-assets-eu-north-1/ s3://hedj-comp-assets-eu-north-1/ --recursive --exclude "*" \
          --include "*.$1" --content-type "$2" --metadata-directive REPLACE --cache-control "public, max-age=300" --region eu-north-1
      done
      aws cloudfront create-invalidation --distribution-id <CF_COMP_DISTRIBUTION_ID> --paths "/*"
      git worktree add ../comp-v2 pre-v3-cutover && cd ../comp-v2/backend && sam build && \
        sam deploy --stack-name hedj-competition-backend --resolve-s3 --capabilities CAPABILITY_IAM \
          --region eu-north-1 --parameter-overrides "AdminKey=<ADMIN KEY>"
      ```
- [ ] **J5. After a rollback,** the old frontend workflow syncs `docs/` and the two root files again, so repeat
      section E.
- [ ] **J6. Before deploying v3 again after a rollback,** remove the orphaned best table. The table names are fixed
      (`HCompBest-<stack name>`), so CloudFormation can't create it while the retained copy exists, and the deploy
      fails with "already exists". DynamoDB can't rename a table: export it first (J2), then delete it:
      ```sh
      aws dynamodb delete-table --region eu-north-1 --table-name HCompBest-hedj-competition-backend
      aws dynamodb wait table-not-exists --region eu-north-1 --table-name HCompBest-hedj-competition-backend
      ```
      To keep the old rows under another name instead, take an on-demand backup (`aws dynamodb create-backup`) and
      restore it to a new table name (`aws dynamodb restore-table-from-backup`) before deleting. The same applies to any
      other table if the whole stack is ever deleted: all four are retained.

## K. Open product questions for the user

Answer these before the event. Each one is a copy change or a single number.

- [ ] **K1. Parody chairmen, tone check.** The board members are "types" of real people: J. Jonah Jameson, Elon Musk,
      Michael O'Leary, Jamie Dimon, Warren Buffett, Steve Jobs, Jack Dorsey and Bill Ackman (`data/board-dialogue.json`).
      Are they all comfortable at a Hedj stand?
- [ ] **K2. The two new "In real life, Hedj …" lines** (`data/powerups.json`). Are these accurate product claims?
      - Bigger Bank Facilities: "In real life, Hedj helps you secure bigger bank facilities as your business outgrows
        them."
      - Rate & Commodity Hedging: "In real life, Hedj gives you interest-rate and commodity hedging many banks won't
        offer."
- [ ] **K3. Firing rates** (`node tools/simulate.js --n 1000`, final content):
      - A player who never hedges is fired in **43%** of runs: 52% on a band board, 46% on a no-policy board and 0% on
        a no-hedge board.
      - A random dialler is fired in 43% of runs, someone who always hedges 100% in 40%, and someone who always hedges
        50% in 40%.
      - A player who follows (or proposes) a policy is **never** fired.
      - On the no-policy board, a player who never proposes lands exactly on the firing line after 8 quarters, so
        **37% of them are fired in the final quarter** itself. A slightly gentler −6 drift lowers that to 27%
        (33% fired overall).

      Is being fired on the last tap the experience you want?
- [ ] **K4. No-hedge-policy bankruptcy is about 6%.** A player who faithfully follows "our policy is not to hedge" goes
      bankrupt in 6% of those runs (0% on band boards), mostly on energy and construction. Across all policy
      followers, bankruptcy is 1%. Ruling R57 already cut the airline fuel book ($200m → $120m a quarter) and the
      energy oil book ($300m → $135m), so an unhedged first quarter now loses at most about two-thirds of starting cash
      (p99 65% airline, 69% energy; it was 106% and 154%), and the base operating cash flow fell from 5% to 4% of
      starting cash a quarter to keep some bankruptcy risk for players who never hedge. Keep the rest, as the "policy
      itself is the risk" lesson, or soften it?
- [ ] **K5. Optional content polish** (low priority):
      - Two event choices read against their quips: `coffee_queue` → take the call (variance ×1.1) and
        `bank_bearing_gifts` → take the tickets (×0.85).
      - Fired endings are picked by matching the word "bet". Splitting them into separate "lost confidence" and
        "severe loss" quips would be cleaner.
      - Should the first-time PLAY guide auto-show at a 3-minute conference game?
      - The title's attract mode was removed for readability (the stand page covers it).
      - Today's rank is matched by name and company, so two identical name+company pairs would share it.
