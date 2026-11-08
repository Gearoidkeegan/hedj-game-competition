# Treasury Manager Simulator — Competition Edition

An interactive, web-based educational game where players manage treasury operations for companies across different industries. The **Competition Edition** extends the base game with a registration gate, global persistent leaderboard, admin analytics dashboard, and GDPR-compliant data handling — designed for live events, conferences, and online competitions.

**v3 (conference edition):** phone-first, seven industries, and a run of 8 quarters that takes about 3 minutes. Two modes: **Simple** (the default: one dial per exposure, a board with a hedging policy, power-ups) and **Pro** (the full instrument-by-instrument game, unlocked by finishing a Simple run). Career mode has been removed.

Built and branded for **[Hedj — Treasury Risk Management Solutions](https://www.hedj.eu)**.

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Game Features](#game-features)
  - [Game Modes](#game-modes)
  - [Core Gameplay Loop](#core-gameplay-loop)
  - [Hedging Instruments](#hedging-instruments)
  - [Industries](#industries)
  - [Policies](#policies)
  - [Scoring System](#scoring-system)
  - [Board Dynamics](#board-dynamics)
- [Competition Features](#competition-features)
  - [Registration](#registration)
  - [Global Leaderboard](#global-leaderboard)
  - [Admin Dashboard](#admin-dashboard)
  - [Analytics](#analytics)
- [Local Development](#local-development)
- [Backend Deployment (AWS)](#backend-deployment-aws)
- [Frontend Deployment](#frontend-deployment)
- [Configuration](#configuration)
- [Privacy & GDPR](#privacy--gdpr)

---

## Overview

Players take the role of a Corporate Treasury Manager, responsible for hedging FX, commodity, and interest rate exposures for a company. In Simple mode, each quarter the player sets one dial per exposure (0, 25, 50, 75 or 100% hedged), answers any event, optionally buys one power-up, and runs the quarter. The board may have a hedging policy (a band such as 50–75%), may have a policy of not hedging at all, or may have no policy yet, in which case the player should propose one. In Pro mode they also choose instruments and counterparty banks.

The game simulates realistic market dynamics (using historical rate data from 1994–2024), random market events (currency crises, commodity shocks), and an AI-driven board that evaluates performance and can fire the player if satisfaction falls too low.

At the end of a game, registered players are ranked on a global leaderboard and can compete for prizes.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript (ES6 modules), HTML5, CSS3 |
| Backend | AWS Lambda (Node.js 20) |
| Database | Amazon DynamoDB |
| API | Amazon API Gateway (REST) |
| Infrastructure | AWS SAM (CloudFormation) |
| Hosting | AWS CloudFront + S3 (static frontend) |

No frontend frameworks or build tools are required. The game runs entirely from static files served over HTTP.

---

## Project Structure

```
hedj-game-competition/
├── index.html                     # Main game entry point
├── admin.html                     # Admin dashboard
├── privacy.html                   # GDPR privacy notice
│
├── js/
│   ├── main.js                    # App bootstrap, screen router, event bus
│   ├── config.js                  # API base URL, competition flags
│   │
│   ├── engine/                    # Game simulation logic
│   │   ├── GameState.js           # Central state store
│   │   ├── GameLoop.js            # Quarterly cycle, phase transitions
│   │   ├── MarketEngine.js        # Rate generation, budget rates
│   │   ├── HedgingEngine.js       # Derivative pricing, hedge book
│   │   ├── EventEngine.js         # Random quarterly market events
│   │   ├── BoardAI.js             # AI board feedback & satisfaction
│   │   ├── BankEngine.js          # Counterparty management
│   │   └── ForecastEngine.js      # Notional variance (forecast uncertainty)
│   │
│   ├── screens/                   # UI screens
│   │   ├── TitleScreen.js         # Main menu, attract mode (kiosk)
│   │   ├── RegistrationScreen.js  # Competition sign-up form
│   │   ├── SetupScreen.js         # Industry / policy / difficulty selection
│   │   ├── DashboardScreen.js     # Main gameplay UI
│   │   ├── BoardScreen.js         # AI board feedback
│   │   ├── GameOverScreen.js      # Results & leaderboard submission
│   │   └── QuarterSummary.js      # Quarterly recap
│   │
│   └── utils/
│       ├── api.js                 # API wrappers (register, score, leaderboard)
│       ├── storage.js             # localStorage (registration, per-player runs and progress, score queue)
│       ├── constants.js           # Game balance (policies, phases)
│       ├── formatters.js          # Currency & P&L formatting
│       └── random.js              # Seeded RNG for reproducible games
│
├── css/
│   ├── retro.css                  # Pixel/retro aesthetic foundation
│   ├── components.css             # Buttons, panels, inputs
│   ├── screens.css                # Screen-specific layouts
│   ├── eras.css                   # Animated era backgrounds
│   └── responsive.css             # Mobile/tablet adaptations
│
├── data/
│   ├── industries.json            # Industry definitions (7 industries)
│   ├── products.json              # Hedging instruments (forwards, options, swaps)
│   ├── events.json                # Market shock event definitions
│   ├── simple-events.json         # Simple-mode events (two choices each)
│   ├── powerups.json              # Power-up cards
│   ├── quips.json                 # Board and chairman quips
│   ├── board-dialogue.json        # AI board feedback templates
│   ├── year-facts.json            # Historical trivia revealed at game end
│   └── market/                    # Historical market rates (1994–2024)
│
├── backend/
│   ├── package.json
│   ├── template.yaml              # AWS SAM / CloudFormation template
│   └── handlers/
│       ├── register.mjs           # POST /register
│       ├── score.mjs              # POST /score
│       ├── leaderboard.mjs        # GET /leaderboard
│       ├── analytics.mjs          # POST/GET /analytics
│       └── admin.mjs              # GET /admin/players
│
├── assets/images/
└── docs/
    └── game-qr.png                # QR code for sharing
```

---

## Game Features

### Game Modes

| Mode | Duration | Description |
|---|---|---|
| **Simple** | ~3 min | 8 quarters, one industry, a dial per exposure. The conference mode and the default. Three industries are open at the start; the rest, Pro mode and the crisis scenarios unlock as you play. |
| **Pro** | longer | The full instrument-by-instrument game. Unlocked by finishing a Simple run. |

There is no career mode and no extension past 8 quarters.

### Core Gameplay Loop

Each quarter runs through the following phases:

1. **Decision Phase** — Select which exposures to hedge, at what notional, with which instrument and counterparty bank.
2. **Resolution Phase** — Market rates advance; P&L is calculated against budget rates; policy compliance is checked.
3. **Event Phase** — A random market event may trigger (currency crisis, commodity spike, etc.).
4. **Board Phase** — The AI board evaluates performance and updates satisfaction.
5. **Summary Phase** — Quarterly results are reviewed.
6. **Game Over** — Final score, title, and leaderboard submission.

### Hedging Instruments

| Instrument | Premium | Payoff | Tenor | Unwind Cost |
|---|---|---|---|---|
| **Forward** | None | Linear; locked in at strike | 1–4 quarters | 0.5% |
| **Option** | ~3% upfront (ATM) | Asymmetric; floors/ceilings | 1–4 quarters | — |
| **Swap** | None | Fixed/floating interest rate conversion | 4–16 quarters | 1% |

### Industries

Seven industries are available, each with its own exposure types (FX, commodity, interest rate), scaled revenue and cash, and distinct board personalities:

SkyBridge Airlines, Roasters Plc, NexGen Electronics, MedGlobal Labs, Momentum Construction, TerraEnergy and MainStreet Retail.

### Policies

Six hedging policy templates control the rules the player must operate within:

| Policy | Difficulty | Key Rules |
|---|---|---|
| **None** | Easy | 0–100% hedge, full discretion, no budget rate |
| **Basic** | Easy | 25–75% hedge, 12-month horizon |
| **Conservative** | Normal | Layered forwards (Q+1: 70–80%, etc.), annual reset |
| **Moderate** | Normal | 30–70%, 18-month horizon, quarterly reset, option cap 3% |
| **Rigorous** | Hard | 70–100% near-term, 40–70% outer quarters, 2+ banks required |
| **PE Mandate** | Very Hard | 90–100% near-term, swaps only, zero premium tolerance |

### Scoring System

Simple and Pro share one score (`js/engine/sim/score.js`), measured against an unhedged benchmark and capped at 10,000:

- **Each quarter:** +100 inside the board's policy, +25 off policy but lucky, −300 off policy with a loss, +50 above the red line, +100 for getting a policy adopted, and up to +100 for steady cash flow.
- **Outperformance:** 12 points per 1% of starting cash ahead of the unhedged benchmark at the end.
- **Survival:** +500 for finishing all 8 quarters.
- **Board mood:** the total is multiplied by 0.8–1.2 from the final board mood.

The game-over title comes from `gameOverTitles` in `data/quips.json`.

### Board Dynamics

- Board satisfaction starts at 55–60 and ranges from 10–100.
- Satisfaction increases for policy compliance, decreases for over-hedging, over-trading, large losses, and policy violations.
- If satisfaction drops below 10 the player is fired; cumulative stress above 100 triggers burnout.
- In Simple mode the board is one of three kinds: a hedging band (stay inside it), a "policy is not to hedge" board, or a board with no policy that judges each hedge on its own profit until the player proposes one.
- Bank lines cap hedging at 50% until the player buys Bigger Bank Facilities, which also adds a borrowing cushion. Rate & Commodity Hedging is a power-up too.

---

## Competition Features

### Registration

Before playing for the competition leaderboard, players complete a registration form collecting:

- Full name, email address, company name
- Required consent (data processing + competition contact)
- Optional marketing consent (follow-up communications)

On successful registration the backend returns a `gameToken` (valid for `TokenTtlHours`, 120 hours by default) stored in localStorage. This token is required to submit a score to the leaderboard. Players on a shared device can use "Play as someone else" to clear the stored registration and register a new player.

### Global Leaderboard

- Scores are submitted automatically at game over if the player is registered and the token is valid.
- If submission fails (network error) the score is queued in localStorage and retried on the next visit.
- Submission is idempotent — re-submitting the same `gameId` returns the existing rank without creating a duplicate.
- The leaderboard shows: player name, company, industry, score, number of quarters played, and submission time. Email addresses are intentionally excluded from the public leaderboard.
- Leaderboard responses are cached for 30 seconds; limited to 50 entries.

### Admin Dashboard

Access `admin.html` with the admin key (set at deploy time).

**Features:**
- Total visits, total plays, and registration count
- Full player list with name, email, company, consent flags, and registration timestamp
- CSV export of player data (for post-competition prize administration)
- The CSV includes marketing consent status to identify players who opted in to follow-up communications

### Analytics

Two events are tracked server-side:

| Event | Trigger |
|---|---|
| `visit` | Page load |
| `play` | Game start |

Public `GET /analytics` returns play count only. Admin `GET /analytics` (with key) returns all metrics including visits and registration count.

---

## Local Development

**Requirements:** Any static HTTP server. No build step.

```bash
# Start a local server (Python)
python -m http.server 8080

# Or Node
npx serve .

# Visit
http://localhost:8080
```

**Backend (optional, requires AWS CLI + SAM CLI):**

```bash
cd backend
sam local start-api --parameter-overrides AdminKey=testkey
# Local API at http://localhost:3000
```

Update `js/config.js` to point `apiBase` at `http://localhost:3000` for local backend testing.

---

## Backend Deployment (AWS)

The backend is defined as an AWS SAM application (`backend/template.yaml`).

### Prerequisites

- AWS CLI configured with appropriate credentials
- SAM CLI installed (`brew install aws-sam-cli` or see [SAM docs](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html))

### Deploy

```bash
cd backend
npm install
sam build
sam deploy --guided \
  --parameter-overrides AdminKey=<strong-secret-key>
```

Backend parameters (`backend/template.yaml`):

| Parameter | Purpose |
|---|---|
| `AdminKey` | Secret for the admin analytics endpoint |
| `EventId` | The live event; selects the leaderboard partition (default `test`) |
| `EventEndIso` | Event end (ISO-8601); player and score rows expire 90 days after it |
| `TokenTtlHours` | Game token lifetime in hours (default 120) |

Follow the prompts. On first deploy use `--guided`; subsequent deploys can omit it.

The deploy outputs the API Gateway URL. Use this as the CloudFront origin for `/api/*` routes.

### DynamoDB Tables

| Table | Primary Key | Notes |
|---|---|---|
| `HCompPlayers` | `email` (PK) | Registration data; TTL 90 days post-competition |
| `HCompScores` | `scoreId` (PK) | Game scores; GSI on `leaderboard/score`; TTL 90 days |
| `HCompAnalytics` | `metricName` (PK) | Visit/play counters |

### CORS

API Gateway is configured to accept requests from:
- `https://competition.hedj.eu`
- `http://localhost:8080`
- `http://localhost:3000`

Update `template.yaml` if the production domain changes.

---

## Frontend Deployment

The frontend is a fully static site (HTML, JS, CSS, JSON data files). Recommended deployment: **AWS CloudFront + S3**.

**CloudFront origin routing:**

| Path | Origin |
|---|---|
| `/api/*` | API Gateway (Lambda backend) |
| Everything else | S3 bucket (static files) |

Upload all files except `backend/` to the S3 bucket. Invalidate the CloudFront distribution after each deploy.

---

## Configuration

### `js/config.js`

```javascript
{
  apiBase: '/api',           // API Gateway base path (CloudFront rewrites /api/*)
  competitionActive: true,   // Show registration gate and leaderboard features
  attractModeIdleMs: 300000  // Kiosk attract mode delay (5 minutes)
}
```

Set `competitionActive: false` to run the game without the registration gate (e.g. for internal demos).

### Admin Key

The `AdminKey` parameter is set at SAM deploy time and stored as a Lambda environment variable. It is sent as the `x-admin-key` request header from `admin.html`. Keep it secret — it grants access to player PII.

---

## Privacy & GDPR

A full privacy notice is available at `privacy.html`. Key points:

- **Data collected:** Name, email, company (competition admin), game scores (leaderboard), marketing consent flag.
- **Not collected:** Payment info, ID documents, sensitive personal data, IP addresses, cookies.
- **Legal basis:** Legitimate interest (competition administration); consent (marketing).
- **Retention:** All competition data is auto-deleted 90 days after the competition closes (DynamoDB TTL).
- **Infrastructure:** AWS EU region only. No third-party data sharing.
- **Player rights:** Access, correction, deletion, and the right to lodge a complaint with the Data Protection Commission (Ireland).
- **Contact:** [info@hedj.eu](mailto:info@hedj.eu)

Marketing consent is stored separately and used only to identify players who opted in to follow-up communications. It is never assumed.

---

*Powered by Hedj — Treasury Risk Management Solutions | [www.hedj.eu](https://www.hedj.eu)*
