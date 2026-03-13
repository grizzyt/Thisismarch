# MadnessLab — March Madness Betting Analytics

Dark-themed, data-dense analytics dashboard for NCAA Tournament betting. Built with React + Vite + Tailwind (frontend) and Python FastAPI (backend).

## Features

- **Matchup Analyzer** — Side-by-side stat comparison with radar chart overlay and win probability
- **Spread Prediction Model** — Factor breakdown + 10k-iteration Monte Carlo simulation
- **Odds Tracker** — Live lines across 6 sportsbooks with line movement chart and value bet detection

## Quick Start

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate     # Windows
# source venv/bin/activate  # macOS/Linux
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend proxies `/api` requests to `localhost:8000`. Open `http://localhost:5173`.

## API Keys

Copy `.env.example` to `backend/.env` and fill in:

- **ODDS_API_KEY** — Free key from [The Odds API](https://the-odds-api.com). Without it, mock odds data is used.

## Data Sources

The app currently uses mock BartTorvik-style efficiency stats for 64 teams in `backend/mock_data.py`.

### Plugging in Real Data

**KenPom / BartTorvik:**
Replace `mock_data.py` with a scraper or API client. Both sources provide:
- Adjusted Offensive/Defensive Efficiency (adjOE, adjDE)
- Tempo (possessions per game)
- Strength of Schedule (SOS)
- Luck rating

BartTorvik offers free CSV exports at `barttorvik.com`. KenPom requires a paid subscription.
Update the `TEAMS` dict in `mock_data.py` or replace the `/api/teams` endpoint to pull live data.

**The Odds API:**
Set `ODDS_API_KEY` in `backend/.env`. The `/api/odds` endpoint will automatically fetch live NCAAB lines from DraftKings, FanDuel, BetMGM, Caesars, BetRivers, and PointsBet.

## Prediction Model

Spread formula:
```
raw = ((adjOE_a - adjDE_b) - (adjOE_b - adjDE_a)) / 100 * avg_tempo
spread = raw + sos_adj + luck_adj
```

Monte Carlo: 10,000 iterations with normal distribution (sigma=8.5) centered on projected spread.

Value bet flag: triggered when model spread disagrees with consensus by 2+ points.

## Tech Stack

- **Frontend:** React 19, Vite, Tailwind CSS v4, Recharts
- **Backend:** Python, FastAPI, NumPy, httpx
- **Design:** #080808 dark theme, Space Mono font, neon green (#00ff87) + electric blue (#00b4ff) accents
