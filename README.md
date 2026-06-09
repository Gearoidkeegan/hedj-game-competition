# Treasury Manager Simulator — Competition Edition

An interactive, web-based educational game where players manage treasury operations for companies across different industries. The **Competition Edition** extends the base game with a registration gate, global persistent leaderboard, admin analytics dashboard, and GDPR-compliant data handling — designed for live events, conferences, and online competitions.

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

Players take the role of a Corporate Treasury Manager, responsible for hedging FX, commodity, and interest rate exposures for a company. Each quarter they must decide how much of their exposure to hedge, which instruments to use, and which counterparty banks to trade with — all within the constraints of a board-mandated hedging policy.

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
│   │   ├── ScoreEngine.js         # Final score calculation (penalties/bonuses)
│   │   ├── MarketEngine.js        # Rate generation, budget rates
│   │   ├── HedgingEngine.js       # Derivative pricing, hedge book
│   │   ├── EventEngine.js         # Random quarterly market events
│   │   ├── BoardAI.js             # AI board feedback & satisfaction
│   │   ├── CareerEngine.js        # Career mode progression
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
│       ├── storage.js             # localStorage (saves, registration, pending scores)
│       ├── constants.js           # Game balance (grades, policies, phases)
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
│   ├── industries.json            # Industry definitions (10+ industries)
│   ├── products.json              # Hedging instruments (forwards, options, swaps)
│   ├── events.json                # Market shock event definitions
│   ├── career-levels.json         # 5 career progression levels
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
| **Quick Play** | ~5 min | 8 quarters, single industry, no progression. Good for events/demos. |
| **Career Mode** | ~25 min | 5 levels from Startup to PE-Backed company, with increasing complexity and score gates between levels. |

### Core Gameplay Loop

Each quarter runs through the following phases:

1. **Decision Phase** — Select which exposures to hedge, at what notional, with which instrument and counterparty bank.
2. **Resolution Phase** — Market rates advance; P&L is calculated against budget rates; policy compliance is checked.
3. **Event Phase** — A random market event may trigger (currency crisis, commodity spike, etc.).
4. **Board Phase** — The AI board evaluates performance and updates satisfaction.
5. **Summary Phase** — Quarterly results are reviewed.
6. **Extend Phase** *(end of game)* — Option to extend by 4 more quarters (maximum 2 extensions).
7. **Game Over** — Final score, grade, and leaderboard submission.

### Hedging Instruments

| Instrument | Premium | Payoff | Tenor | Unwind Cost |
|---|---|---|---|---|
| **Forward** | None | Linear; locked in at strike | 1–4 quarters | 0.5% |
| **Option** | ~3% upfront (ATM) | Asymmetric; floors/ceilings | 1–4 quarters | — |
| **Swap** | None | Fixed/floating interest rate conversion | 4–16 quarters | 1% |

### Industries

Ten base industries are available, each with multiple exposure types (FX, commodity, interest rate), scaled revenue and cash, and distinct board personalities:

Airline, Bank, Manufacturing, Pharma, Food & Beverage, Energy, Retailer, Technology, Agriculture, Fintech.

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

Final score is out of 100, weighted across five components:

| Component | Weight | Description |
|---|---|---|
| P&L vs Budget | 30% | Actual costs vs. board-set budget rates |
| Board Satisfaction | 25% | AI satisfaction score (10–100) |
| Cash Management | 20% | Penalises margin calls, low cash, negative balances |
| Policy Compliance | 15% | Quarterly adherence to hedge ratio and tenor rules |
| Risk-Adjusted Return | 10% | P&L volatility + diversification bonus (up to +10 pts) |

**Modifiers:**
- Trading cost penalty: −2 pts per trade above 3 avg/quarter
- Diversification bonus: up to +10 pts for spreading trades across banks
- Direction penalty: −5 pts per board-advised direction error
- Perfect compliance bonus: +10 pts for zero violations
- Fired/burnout cap: Score capped at 45 (grade F) if player is terminated

**Grades:**

| Grade | Score | Description |
|---|---|---|
| A+ | 90+ | Chief Risk Officer Material |
| A | 80–89 | Contract Extended |
| B | 70–79 | Solid Treasury Management |
| C | 60–69 | Adequate Performance |
| D | 50–59 | Under Review |
| F | <50 | Looking for Work |

### Board Dynamics

- Board satisfaction starts at 55–60 and ranges from 10–100.
- Satisfaction increases for policy compliance, decreases for over-hedging, over-trading, large losses, and policy violations.
- If satisfaction drops below 10 the player is fired; cumulative stress above 100 triggers burnout.
- Career Mode requires a minimum score of 55–60 to unlock the next level.

---

## Competition Features

### Registration

Before playing for the competition leaderboard, players complete a registration form collecting:

- Full name, email address, company name
- Required consent (data processing + competition contact)
- Optional marketing consent (follow-up communications)

On successful registration the backend returns a 4-hour `gameToken` stored in localStorage. This token is required to submit a score to the leaderboard. Players on a shared device can use "Play as someone else" to clear the stored registration and register a new player.

### Global Leaderboard

- Scores are submitted automatically at game over if the player is registered and the token is valid.
- If submission fails (network error) the score is queued in localStorage and retried on the next visit.
- Submission is idempotent — re-submitting the same `gameId` returns the existing rank without creating a duplicate.
- The leaderboard shows: player name, company, industry, score, grade, number of quarters played, and submission time. Email addresses are intentionally excluded from the public leaderboard.
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
- **Contact:** [competition@hedj.eu](mailto:competition@hedj.eu)

Marketing consent is stored separately and used only to identify players who opted in to follow-up communications. It is never assumed.

---

*Powered by Hedj — Treasury Risk Management Solutions | [www.hedj.eu](https://www.hedj.eu)*
