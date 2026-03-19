import os
import time
import asyncio
import httpx
import numpy as np
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
load_dotenv()  # must run before any local imports that read os.getenv at module level

from torvik import fetch_torvik_teams
from team_mapper import match_team, save_alias
from database import (init_db, upsert_prediction, get_performance_stats, get_game_log,
                      get_results_without_predictions, get_predictions_without_spread,
                      insert_retroactive_prediction, update_consensus_spread,
                      get_stored_consensus_spreads,
                      upsert_ou_prediction, get_ou_game_log, get_ou_performance_stats)
from scores import fetch_and_store_scores
from ou_model import calibrate, predict_total, MIN_OU_EDGE, MAX_OU_EDGE


async def _nightly_score_job():
    """
    Background task: fetches yesterday's scores every night at 2 AM local time.

    Runs continuously, sleeping until the next 2 AM window.
    daysFrom=1 captures games that finished yesterday — well within the
    Odds API's 3-day retention window before results expire permanently.
    """
    while True:
        now = datetime.now()
        next_run = now.replace(hour=2, minute=0, second=0, microsecond=0)
        if next_run <= now:
            next_run += timedelta(days=1)
        wait_secs = (next_run - now).total_seconds()
        print(f"[scheduler] Next score refresh at {next_run.strftime('%Y-%m-%d %H:%M')} ({wait_secs/3600:.1f}h away)")
        await asyncio.sleep(wait_secs)
        print("[scheduler] Running nightly score refresh...")
        await fetch_and_store_scores(days_from=1, force=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: init DB, backfill up to 3 days of completed scores
    init_db()
    print("[startup] Backfilling scores for last 3 days...")
    await fetch_and_store_scores(days_from=3, force=True)
    # Launch nightly background task
    task = asyncio.create_task(_nightly_score_job())
    yield
    # Shutdown: cancel the background task cleanly
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="NCAAB Betting Analytics API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ODDS_API_KEY = os.getenv("ODDS_API_KEY", "")
ODDS_API_BASE = "https://api.the-odds-api.com/v4"

# ──────────────────────────────────────────────
# Sign convention helpers
# ──────────────────────────────────────────────
# Internal convention:  positive spread = home favored
# Market convention:    negative spread = home favored (standard sportsbook)

def to_market(home_favored_pts: float) -> float:
    """Internal (+home) → market (-home)."""
    return -round(home_favored_pts, 1)

def to_internal(market_spread: float) -> float:
    """Market (-home) → internal (+home)."""
    return -market_spread

# ──────────────────────────────────────────────
# Caches
# ──────────────────────────────────────────────

_team_cache = {"data": None, "ts": 0}
_odds_cache = {"data": None, "ts": 0}
TEAM_TTL = 600   # 10 min
ODDS_TTL = 600   # 10 min — refresh pre-game lines; started games use locked DB spread

# National average offensive efficiency — recomputed each time teams are refreshed.
# BartTorvik adjOE/adjDE are normalized so the D1 mean OE ≈ mean DE.
# Using a hard-coded 100 would systematically bias projections if the actual
# season average drifts; computing it from live data keeps the formula honest.
_nat_avg = 100.0


def get_teams() -> dict:
    global _nat_avg
    now = time.time()
    if _team_cache["data"] is None or (now - _team_cache["ts"]) > TEAM_TTL:
        data = fetch_torvik_teams()
        _team_cache["data"] = data
        _team_cache["ts"] = now
        oes = [t["adjOE"] for t in data.values() if "adjOE" in t]
        if oes:
            _nat_avg = float(np.mean(oes))
            print(f"[model] NAT_AVG updated: {_nat_avg:.2f} (from {len(oes)} teams)")
    return _team_cache["data"]


async def get_odds() -> list:
    now = time.time()
    if _odds_cache["data"] is not None and (now - _odds_cache["ts"]) < ODDS_TTL:
        return _odds_cache["data"]

    if ODDS_API_KEY:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{ODDS_API_BASE}/sports/basketball_ncaab/odds",
                    params={
                        "apiKey": ODDS_API_KEY,
                        "regions": "us",
                        "markets": "spreads,h2h,totals",
                        "oddsFormat": "american",
                        "bookmakers": "draftkings,fanduel,betmgm,williamhill_us,betrivers,pointsbetus",
                    },
                    timeout=15,
                )
                resp.raise_for_status()
                data = resp.json()
                _odds_cache["data"] = data
                _odds_cache["ts"] = now
                print(f"[odds] Fetched {len(data)} games from The Odds API")
                return data
        except Exception as e:
            print(f"[odds] API error: {e}")
            if _odds_cache["data"]:
                return _odds_cache["data"]
    return []


# ──────────────────────────────────────────────
# Prediction engine
# ──────────────────────────────────────────────

# Calibration shrinkage: compresses predictions toward zero (regression-to-mean).
SHRINKAGE = 0.80

# Home court advantage in points (only for true home games; 0 for neutral sites).
HCA_PTS = 3.5

# Market blend weights: model vs. consensus market line.
MODEL_WEIGHT = 0.65
MARKET_WEIGHT = 0.35

# Value-bet credibility window: edges outside this range are likely model error.
MIN_EDGE = 2.0
MAX_EDGE = 8.0


def compute_spread(home: dict, away: dict, neutral_site: bool = True,
                   market_spread: float | None = None,
                   nat_avg: float | None = None) -> dict:
    """
    KenPom-style possession-based spread projection.

    Matchup arithmetic:
        home_exp_oe = home_adjOE * away_adjDE / nat_avg
        away_exp_oe = away_adjOE * home_adjDE / nat_avg
        raw_spread  = (home_exp_oe - away_exp_oe) / 100 * avg_tempo

    nat_avg defaults to the live season mean adjOE computed from current
    BartTorvik data (updated every 10 min). Pass explicitly for backtesting
    with historical ratings.

    sos_adj and luck_adj intentionally excluded from v1 baseline — both
    variables may double-count information already embedded in adjOE/adjDE.
    Add back only after backtesting validates incremental value.
    """
    effective_nat_avg = nat_avg if nat_avg is not None else _nat_avg
    avg_tempo = (home["tempo"] + away["tempo"]) / 2

    home_exp_oe = home["adjOE"] * away["adjDE"] / effective_nat_avg
    away_exp_oe = away["adjOE"] * home["adjDE"] / effective_nat_avg

    raw_spread = (home_exp_oe - away_exp_oe) / 100 * avg_tempo
    hca = 0.0 if neutral_site else HCA_PTS

    pre_cal = raw_spread + hca
    model_spread = round(pre_cal * SHRINKAGE, 1)

    if market_spread is not None:
        blended_home = MODEL_WEIGHT * model_spread + MARKET_WEIGHT * to_internal(market_spread)
        blended_spread = to_market(blended_home)
    else:
        blended_spread = None

    return {
        "spread": model_spread,          # internal: positive = home favored
        "home_exp_oe": round(home_exp_oe, 2),
        "away_exp_oe": round(away_exp_oe, 2),
        "raw_spread": round(raw_spread, 1),
        "hca": hca,
        "avg_tempo": round(avg_tempo, 1),
        "nat_avg": round(effective_nat_avg, 2),
        "blended_spread": blended_spread,  # market convention (negative = home fav)
    }


def monte_carlo_sim(home: dict, away: dict, neutral_site: bool = True,
                    n: int = 10_000, nat_avg: float | None = None) -> dict:
    """
    Possession-level Monte Carlo simulation.

    Instead of drawing final spreads from a flat normal distribution, this
    simulates each game from first principles:

      1. Tempo  ~ N(avg_tempo, TEMPO_STD)   — possession count uncertainty
      2. Home OE ~ N(home_exp_oe, EFF_STD)  — game-level efficiency variance
      3. Away OE ~ N(away_exp_oe, EFF_STD)  — game-level efficiency variance
      4. raw_margin = (home_oe - away_oe) / 100 * tempo
      5. margin = raw_margin * SHRINKAGE + hca

    Advantages over the flat-normal approach:
    - High-tempo games naturally produce higher variance (more possessions = more
      opportunity for randomness to cancel out, but also higher raw point swings).
    - Efficiency variance and tempo variance contribute independently.
    - Spread distribution shape emerges from the simulation rather than being
      assumed; can be slightly non-normal depending on tempo tails.

    EFF_STD=11 and TEMPO_STD=3 are empirical estimates for D1 NCAAB.
    These should be calibrated against historical game data once available.
    """
    rng = np.random.default_rng()
    base = compute_spread(home, away, neutral_site=neutral_site, nat_avg=nat_avg)

    home_exp_oe = base["home_exp_oe"]
    away_exp_oe = base["away_exp_oe"]
    avg_tempo = base["avg_tempo"]
    hca = base["hca"]

    EFF_STD = 11.0    # game-to-game efficiency variance (pts per 100 possessions)
    TEMPO_STD = 3.0   # possession count std dev per game

    tempo_sim = np.clip(rng.normal(avg_tempo, TEMPO_STD, n), 55, 85)
    home_oe_sim = rng.normal(home_exp_oe, EFF_STD, n)
    away_oe_sim = rng.normal(away_exp_oe, EFF_STD, n)

    # Raw margin: efficiency delta × possessions / 100, then calibrate
    raw_margin = (home_oe_sim - away_oe_sim) / 100 * tempo_sim
    margin_sim = raw_margin * SHRINKAGE + hca

    home_wins = int(np.sum(margin_sim > 0))

    return {
        "simulations": n,
        "mean_spread": round(float(np.mean(margin_sim)), 1),
        "std_dev": round(float(np.std(margin_sim)), 1),
        "home_win_pct": round(home_wins / n * 100, 1),
        "away_win_pct": round((n - home_wins) / n * 100, 1),
        "distribution": [
            {"bin": round(float(b_val), 1), "count": int(c)}
            for b_val, c in zip(
                *np.unique(np.round(margin_sim).astype(int), return_counts=True)
            )
        ],
    }


# ──────────────────────────────────────────────
# /api/teams
# ──────────────────────────────────────────────

@app.get("/api/teams")
def api_teams():
    teams = get_teams()
    rows = []
    for name, s in teams.items():
        rows.append({
            "team":    name,
            "rank":    s.get("rank"),
            "conf":    s.get("conf"),
            "record":  s.get("record"),
            "adjOE":   s.get("adjOE"),
            "adjDE":   s.get("adjDE"),
            "adjEM":   round(s["adjOE"] - s["adjDE"], 1) if s.get("adjOE") and s.get("adjDE") else None,
            "barthag": s.get("barthag"),
            "tempo":   s.get("tempo"),
            "sos":     s.get("sos"),
            "luck":    s.get("luck"),
            "seed":    s.get("seed"),
        })
    rows.sort(key=lambda r: r["rank"] if r["rank"] else 9999)
    return {"teams": rows, "count": len(rows)}


@app.get("/api/unmatched-teams")
async def api_unmatched_teams():
    """Returns Odds API team names that couldn't be matched to a BartTorvik team."""
    odds = await get_odds()
    teams = get_teams()
    unmatched = []
    for game in odds:
        for side in ("home_team", "away_team"):
            name = game.get(side, "")
            if name and not match_team(name, teams):
                if name not in unmatched:
                    unmatched.append(name)
    torvik_names = sorted(teams.keys())
    return {"unmatched": unmatched, "torvik_teams": torvik_names}


@app.post("/api/team-alias")
async def api_team_alias(body: dict):
    """Save a manual mapping: {odds_name, torvik_name}."""
    odds_name = body.get("odds_name", "").strip()
    torvik_name = body.get("torvik_name", "").strip()
    teams = get_teams()
    if not odds_name or not torvik_name:
        return {"error": "odds_name and torvik_name are required"}
    if torvik_name not in teams:
        return {"error": f"'{torvik_name}' not found in BartTorvik data"}
    save_alias(odds_name, torvik_name)
    # Clear odds cache so next /api/games call re-processes with new mapping
    _odds_cache["data"] = None
    return {"saved": True, "odds_name": odds_name, "torvik_name": torvik_name}


# ──────────────────────────────────────────────
# /api/predict
# ──────────────────────────────────────────────

@app.get("/api/predict")
def predict(
    team_a: str = Query(..., description="First team (BartTorvik name)"),
    team_b: str = Query(..., description="Second team (BartTorvik name)"),
    neutral: bool = Query(True, description="Neutral site game (default True)"),
):
    teams = get_teams()
    if team_a not in teams:
        raise HTTPException(404, f"Team not found: {team_a}")
    if team_b not in teams:
        raise HTTPException(404, f"Team not found: {team_b}")

    a, b = teams[team_a], teams[team_b]
    factors = compute_spread(a, b, neutral_site=neutral)
    sim = monte_carlo_sim(a, b, neutral_site=neutral)

    return {
        "team_a": team_a,
        "team_b": team_b,
        "projected_spread": factors["spread"],
        "factors": factors,
        "monte_carlo": sim,
        "win_probability": {
            "team_a": sim["home_win_pct"],
            "team_b": sim["away_win_pct"],
        },
    }


# ──────────────────────────────────────────────
# /api/games — the main endpoint: odds + stats + predictions
# ──────────────────────────────────────────────

def extract_consensus_spread(game: dict) -> tuple[float | None, str | None]:
    """Get average home spread across all books. Returns (spread, home_team_name)."""
    spreads = []
    home = game["home_team"]
    for bk in game.get("bookmakers", []):
        for mkt in bk.get("markets", []):
            if mkt["key"] == "spreads":
                for o in mkt["outcomes"]:
                    if o["name"] == home and "point" in o:
                        spreads.append(o["point"])
    if not spreads:
        return None, None
    avg = sum(spreads) / len(spreads)
    rounded = round(avg * 2) / 2  # round to nearest 0.5 (sportsbook convention)
    return rounded, home


def extract_consensus_total(game: dict) -> float | None:
    """Get average over/under point across all books."""
    totals = []
    for bk in game.get("bookmakers", []):
        for mkt in bk.get("markets", []):
            if mkt["key"] == "totals":
                for o in mkt["outcomes"]:
                    if o["name"] == "Over" and "point" in o:
                        totals.append(o["point"])
    if not totals:
        return None
    avg = sum(totals) / len(totals)
    return round(avg * 2) / 2  # nearest 0.5


def extract_consensus_moneyline(game: dict) -> tuple[float | None, float | None]:
    """Get average home/away moneyline across all books."""
    home_mls, away_mls = [], []
    home = game["home_team"]
    away = game["away_team"]
    for bk in game.get("bookmakers", []):
        for mkt in bk.get("markets", []):
            if mkt["key"] == "h2h":
                for o in mkt["outcomes"]:
                    if o["name"] == home and "price" in o:
                        home_mls.append(o["price"])
                    elif o["name"] == away and "price" in o:
                        away_mls.append(o["price"])
    home_ml = round(sum(home_mls) / len(home_mls)) if home_mls else None
    away_ml = round(sum(away_mls) / len(away_mls)) if away_mls else None
    return home_ml, away_ml


async def fetch_historical_spreads(candidates: list[dict]) -> dict:
    """
    Fetch historical consensus spreads for retroactive candidates.
    Groups games by commence_time hour-bucket (one API call per unique hour).
    This gives tipoff-accurate lines rather than a fixed noon proxy.
    Already-stored spreads should be filtered out before calling this.
    Returns dict of {game_id: consensus_spread}.
    """
    if not ODDS_API_KEY:
        return {}

    from collections import defaultdict
    by_hour = defaultdict(list)
    for game in candidates:
        ct = game.get("commence_time") or ""
        if ct:
            # Truncate to the hour: "2026-03-12T23:30:00Z" -> "2026-03-12T23:00:00Z"
            hour_bucket = ct[:14] + "00:00Z"
            by_hour[hour_bucket].append(game)

    spreads = {}
    async with httpx.AsyncClient(timeout=20) as client:
        for hour_ts, games in by_hour.items():
            try:
                resp = await client.get(
                    f"{ODDS_API_BASE}/historical/sports/basketball_ncaab/odds",
                    params={
                        "apiKey": ODDS_API_KEY,
                        "date": hour_ts,
                        "regions": "us",
                        "markets": "spreads",
                        "bookmakers": "draftkings,fanduel,betmgm,williamhill_us,betrivers,pointsbetus",
                    },
                )
                resp.raise_for_status()
                payload = resp.json()
                remaining = resp.headers.get("x-requests-remaining", "?")
                print(f"[historical] {hour_ts}: {len(payload.get('data', []))} games — {remaining} requests remaining")
                for event in payload.get("data", []):
                    spread, _ = extract_consensus_spread(event)
                    if spread is not None:
                        spreads[event["id"]] = spread
            except Exception as e:
                print(f"[historical] Failed for {hour_ts}: {e}")

    return spreads


async def fetch_historical_totals(candidates: list[dict]) -> dict:
    """
    Like fetch_historical_spreads but pulls totals market.
    Groups by tipoff hour bucket, one API call per unique hour.
    Returns dict of {game_id: consensus_total}.
    """
    if not ODDS_API_KEY:
        return {}

    from collections import defaultdict
    by_hour = defaultdict(list)
    for game in candidates:
        ct = game.get("commence_time") or ""
        if ct:
            hour_bucket = ct[:14] + "00:00Z"
            by_hour[hour_bucket].append(game)

    totals = {}
    game_ids_for_hour = {}
    for hour_ts, games in by_hour.items():
        game_ids_for_hour[hour_ts] = {g["game_id"] for g in games}

    async with httpx.AsyncClient(timeout=20) as client:
        for hour_ts, games in by_hour.items():
            try:
                resp = await client.get(
                    f"{ODDS_API_BASE}/historical/sports/basketball_ncaab/odds",
                    params={
                        "apiKey": ODDS_API_KEY,
                        "date": hour_ts,
                        "regions": "us",
                        "markets": "totals",
                        "bookmakers": "draftkings,fanduel,betmgm,williamhill_us,betrivers,pointsbetus",
                    },
                )
                resp.raise_for_status()
                payload = resp.json()
                remaining = resp.headers.get("x-requests-remaining", "?")
                print(f"[historical_totals] {hour_ts}: {len(payload.get('data', []))} games — {remaining} requests remaining")
                bucket_ids = game_ids_for_hour[hour_ts]
                for event in payload.get("data", []):
                    if event["id"] not in bucket_ids:
                        continue
                    total = extract_consensus_total(event)
                    if total is not None:
                        totals[event["id"]] = total
            except Exception as e:
                print(f"[historical_totals] Failed for {hour_ts}: {e}")

    return totals


@app.get("/api/games")
async def api_games():
    """
    Returns all live NCAAB games enriched with:
    - BartTorvik stats for both teams
    - Model prediction (spread, win prob, factors)
    - Consensus market spread
    - Value bet flag (model disagrees with market by 2-8 pts)
    """
    teams = get_teams()
    odds = await get_odds()
    games = []

    # Pre-load any already-locked spreads for started games
    now_utc = datetime.utcnow().replace(tzinfo=timezone.utc)
    all_game_ids = [g["id"] for g in odds]
    locked_spreads = get_stored_consensus_spreads(all_game_ids)

    for game in odds:
        home_odds = game["home_team"]
        away_odds = game["away_team"]

        home_tv = match_team(home_odds, teams)
        away_tv = match_team(away_odds, teams)

        home_stats = teams.get(home_tv) if home_tv else None
        away_stats = teams.get(away_tv) if away_tv else None

        # All remaining NCAAB games are neutral site (conference tournaments / NCAA tournament)
        NEUTRAL = True

        # For started games, use the spread that was locked in at prediction time
        game_id = game.get("id", "")
        ct_str = game.get("commence_time", "")
        game_started = bool(ct_str and datetime.fromisoformat(ct_str.replace("Z", "+00:00")) <= now_utc)

        prediction = None
        value_bet = None
        if home_stats and away_stats:
            if game_started and game_id in locked_spreads:
                consensus = locked_spreads[game_id]
            else:
                consensus, _ = extract_consensus_spread(game)

            factors = compute_spread(
                home_stats, away_stats,
                neutral_site=NEUTRAL,
                market_spread=consensus,
            )
            sim = monte_carlo_sim(home_stats, away_stats, neutral_site=NEUTRAL)

            # model_line in market convention (negative = home favored)
            model_line = to_market(factors["spread"])
            blended_line = factors["blended_spread"]

            edge = None
            signed_edge = None  # negative = model likes home more than market
            if consensus is not None:
                edge = round(abs(model_line - consensus), 1)
                signed_edge = round(consensus - model_line, 1)
                # Only flag within the credibility window: 2–8 pts
                if MIN_EDGE <= edge <= MAX_EDGE:
                    if model_line < consensus:   # model likes home more
                        value_bet = {
                            "edge": edge,
                            "signed_edge": signed_edge,
                            "side": home_tv,
                            "side_display": home_odds,
                            "reason": f"Model likes {home_tv} {edge} pts more than market",
                        }
                    else:                         # model likes away more
                        value_bet = {
                            "edge": edge,
                            "signed_edge": signed_edge,
                            "side": away_tv,
                            "side_display": away_odds,
                            "reason": f"Model likes {away_tv} {edge} pts more than market",
                        }

            prediction = {
                "model_spread": model_line,
                "blended_spread": blended_line,
                "factors": factors,
                "home_win_pct": sim["home_win_pct"],
                "away_win_pct": sim["away_win_pct"],
                "consensus_spread": consensus,
                "edge": edge,
                "signed_edge": signed_edge,
                "credible": edge is not None and MIN_EDGE <= edge <= MAX_EDGE,
                "monte_carlo": sim,
            }

        consensus_total = extract_consensus_total(game)
        home_ml, away_ml = extract_consensus_moneyline(game)

        entry = {
            "id": game.get("id", ""),
            "commence_time": game.get("commence_time", ""),
            "home_team": home_odds,
            "away_team": away_odds,
            "home_torvik": home_tv,
            "away_torvik": away_tv,
            "home_stats": {**home_stats, "team": home_tv} if home_stats else None,
            "away_stats": {**away_stats, "team": away_tv} if away_stats else None,
            "bookmakers": game.get("bookmakers", []),
            "consensus_total": consensus_total,
            "home_ml": home_ml,
            "away_ml": away_ml,
            "prediction": prediction,
            "value_bet": value_bet,
        }
        games.append(entry)

    # Persist predictions to DB
    for entry in games:
        if entry.get("prediction"):
            upsert_prediction(entry)

    # Sort: value bets first (by edge desc), then by start time
    games.sort(key=lambda g: (
        0 if g["value_bet"] else 1,
        -(g["value_bet"]["edge"] if g["value_bet"] else 0),
        g["commence_time"],
    ))

    return {
        "count": len(games),
        "games": games,
        "source": "live" if ODDS_API_KEY else "mock",
        "nat_avg": round(_nat_avg, 2),
    }




# ──────────────────────────────────────────────
# /api/performance — model accuracy tracking
# ──────────────────────────────────────────────

@app.get("/api/performance")
async def api_performance():
    """
    Returns model performance stats and game log.
    Fetches latest scores on-demand (rate-limited to once per 30 min).
    Nightly job at 2 AM handles incremental daily updates automatically.
    """
    result = await fetch_and_store_scores(days_from=1, force=False)
    stats = get_performance_stats()
    game_log = get_game_log(limit=500)
    return {"stats": stats, "game_log": game_log, "scores_fetch": result}


# ──────────────────────────────────────────────
# /api/ou-games — Over/Under predictions
# ──────────────────────────────────────────────

@app.get("/api/ou-games")
async def api_ou_games():
    teams = get_teams()
    odds = await get_odds()

    slope, intercept = calibrate(
        db_path=__import__('database').DB_PATH,
        teams=teams,
        nat_avg=_nat_avg,
    )

    results = []
    for game in odds:
        home_name = game.get("home_team", "")
        away_name = game.get("away_team", "")
        home_tv = match_team(home_name, teams)
        away_tv = match_team(away_name, teams)

        consensus_total = extract_consensus_total(game)
        ct = game.get("commence_time", "")
        game_id = game.get("id", "")

        home_stats = teams.get(home_tv) if home_tv else None
        away_stats = teams.get(away_tv) if away_tv else None

        if not home_stats or not away_stats or consensus_total is None:
            results.append({
                "id": game_id, "commence_time": ct,
                "home_team": home_name, "away_team": away_name,
                "home_torvik": home_tv, "away_torvik": away_tv,
                "model_total": None, "consensus_total": consensus_total,
                "ou_edge": None, "ou_pick": None, "ou_value": False,
            })
            continue

        pred = predict_total(home_stats, away_stats, _nat_avg, slope, intercept)
        model_total = pred["model_total"]
        ou_edge = round(model_total - consensus_total, 1)
        ou_pick = "over" if ou_edge > 0 else "under"
        ou_value = MIN_OU_EDGE <= abs(ou_edge) <= MAX_OU_EDGE

        upsert_ou_prediction(
            game_id=game_id, commence_time=ct,
            home_team=home_name, away_team=away_name,
            home_torvik=home_tv, away_torvik=away_tv,
            raw_total=pred["raw_total"], model_total=model_total,
            consensus_total=consensus_total, ou_edge=ou_edge,
            ou_pick=ou_pick, ou_value=ou_value,
        )

        results.append({
            "id": game_id, "commence_time": ct,
            "home_team": home_name, "away_team": away_name,
            "home_torvik": home_tv, "away_torvik": away_tv,
            "model_total": model_total, "raw_total": pred["raw_total"],
            "home_exp_oe": pred["home_exp_oe"], "away_exp_oe": pred["away_exp_oe"],
            "avg_tempo": pred["avg_tempo"],
            "consensus_total": consensus_total,
            "ou_edge": ou_edge, "ou_pick": ou_pick, "ou_value": ou_value,
        })

    results.sort(key=lambda g: g["commence_time"])
    return {
        "games": results, "count": len(results),
        "calibration": {"slope": round(slope, 3), "intercept": round(intercept, 1)},
    }


@app.post("/api/backfill-ou")
async def api_backfill_ou():
    """
    Retroactively runs the O/U model against all completed games that have
    Torvik data. Fetches historical consensus totals from the Odds API.
    Uses INSERT OR REPLACE so it's safe to run multiple times.
    """
    teams = get_teams()
    slope, intercept = calibrate(
        db_path=__import__('database').DB_PATH,
        teams=teams,
        nat_avg=_nat_avg,
    )

    import sqlite3 as _sq
    with _sq.connect(__import__('database').DB_PATH) as c:
        c.row_factory = _sq.Row
        rows = c.execute("""
            SELECT p.game_id, p.home_team, p.away_team,
                   p.home_torvik, p.away_torvik,
                   COALESCE(r.commence_time, p.commence_time) AS commence_time
            FROM predictions p
            JOIN results r ON p.game_id = r.game_id
            WHERE r.completed = 1
              AND p.home_torvik IS NOT NULL
              AND p.away_torvik IS NOT NULL
        """).fetchall()
        candidates = [dict(r) for r in rows]

    if not candidates:
        return {"inserted": 0, "message": "No completed games with Torvik data found"}

    historical_totals = await fetch_historical_totals(candidates)
    print(f"[backfill_ou] Historical totals fetched for {len(historical_totals)} games")

    inserted = 0
    for game in candidates:
        ht = teams.get(game["home_torvik"])
        at = teams.get(game["away_torvik"])
        if not ht or not at:
            continue

        pred = predict_total(ht, at, _nat_avg, slope, intercept)
        consensus_total = historical_totals.get(game["game_id"])
        ou_edge = round(pred["model_total"] - consensus_total, 1) if consensus_total is not None else None
        ou_pick = ("over" if ou_edge > 0 else "under") if ou_edge is not None else None
        ou_value = MIN_OU_EDGE <= abs(ou_edge) <= MAX_OU_EDGE if ou_edge is not None else False

        upsert_ou_prediction(
            game_id=game["game_id"],
            commence_time=game["commence_time"],
            home_team=game["home_team"],
            away_team=game["away_team"],
            home_torvik=game["home_torvik"],
            away_torvik=game["away_torvik"],
            raw_total=pred["raw_total"],
            model_total=pred["model_total"],
            consensus_total=consensus_total,
            ou_edge=ou_edge,
            ou_pick=ou_pick,
            ou_value=ou_value,
        )
        inserted += 1

    return {
        "inserted": inserted,
        "historical_totals_found": len(historical_totals),
        "candidates": len(candidates),
    }


@app.get("/api/ou-performance")
async def api_ou_performance():
    await fetch_and_store_scores(days_from=1, force=False)
    stats = get_ou_performance_stats()
    game_log = get_ou_game_log(limit=500)
    return {"stats": stats, "game_log": game_log}



@app.post("/api/fix-pending-scores")
async def api_fix_pending_scores():
    """
    Fetches scores for the last 14 days but only updates games that are
    already tracked in the predictions table. Safe — won't add new games.
    """
    import sqlite3 as _sqlite3
    with _sqlite3.connect(__import__('database').DB_PATH) as c:
        # Only target predictions that have no completed result yet
        tracked_ids = {r[0] for r in c.execute("""
            SELECT p.game_id FROM predictions p
            LEFT JOIN results r ON p.game_id = r.game_id
            WHERE r.completed IS NULL OR r.completed = 0
        """).fetchall()}

    if not ODDS_API_KEY:
        return {"error": "no api key"}

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{ODDS_API_BASE}/sports/basketball_ncaab/scores",
            params={"apiKey": ODDS_API_KEY, "daysFrom": 3},
        )
        resp.raise_for_status()
        data = resp.json()

    updated = 0
    for game in data:
        if not game.get("completed"):
            continue
        if game["id"] not in tracked_ids:
            continue
        score_map = {s["name"]: s["score"] for s in (game.get("scores") or [])}
        home = game["home_team"]
        away = game["away_team"]
        try:
            home_score = int(score_map.get(home, 0))
            away_score = int(score_map.get(away, 0))
        except (ValueError, TypeError):
            continue
        upsert_result(
            game_id=game["id"],
            home_score=home_score,
            away_score=away_score,
            actual_margin=home_score - away_score,
            completed=1,
            home_team=home,
            away_team=away,
            commence_time=game.get("commence_time"),
        )
        updated += 1

    return {"updated": updated, "tracked_predictions": len(tracked_ids)}


@app.post("/api/backfill-predictions")
async def api_backfill_predictions():
    """
    Retroactively run the model against completed games that have no prediction record.
    Uses current BartTorvik ratings + INSERT OR IGNORE (won't overwrite real predictions).
    Fetches historical consensus spreads from Odds API historical endpoint.
    """
    # First refresh scores so team names and commence_times are populated
    await fetch_and_store_scores(days_from=3, force=True)

    teams = get_teams()
    candidates = get_results_without_predictions()         # completed games with no prediction
    existing_no_spread = get_predictions_without_spread()  # predictions missing a spread

    # Fetch historical spreads for both groups in one batched pass (grouped by tipoff hour)
    all_needing_spreads = candidates + [g for g in existing_no_spread if g["game_id"] not in {c["game_id"] for c in candidates}]
    historical_spreads = await fetch_historical_spreads(all_needing_spreads)
    print(f"[backfill] Historical spreads fetched for {len(historical_spreads)} games")

    inserted = 0
    skipped_no_match = 0

    for game in candidates:
        home_tv = match_team(game["home_team"], teams)
        away_tv = match_team(game["away_team"], teams)

        if not home_tv or not away_tv:
            skipped_no_match += 1
            continue

        home_stats = teams.get(home_tv)
        away_stats = teams.get(away_tv)
        if not home_stats or not away_stats:
            skipped_no_match += 1
            continue

        factors = compute_spread(home_stats, away_stats, neutral_site=True)
        sim = monte_carlo_sim(home_stats, away_stats, neutral_site=True)
        model_line = to_market(factors["spread"])

        consensus = historical_spreads.get(game["game_id"])
        edge = round(abs(model_line - consensus), 1) if consensus is not None else None
        credible = edge is not None and MIN_EDGE <= edge <= MAX_EDGE

        commence_time = game.get("commence_time") or game.get("fetched_at", "")

        rows = insert_retroactive_prediction(
            game_id=game["game_id"],
            home_team=game["home_team"],
            away_team=game["away_team"],
            home_torvik=home_tv,
            away_torvik=away_tv,
            model_spread=model_line,
            home_win_pct=sim["home_win_pct"],
            away_win_pct=sim["away_win_pct"],
            mc_mean=sim["mean_spread"],
            mc_std=sim["std_dev"],
            mc_home_win_pct=sim["home_win_pct"],
            commence_time=commence_time,
            consensus_spread=consensus,
            edge=edge,
            credible=credible,
        )
        inserted += rows

    # Patch existing predictions that have no consensus_spread yet
    spread_patched = 0
    if existing_no_spread:
        for g in existing_no_spread:
            consensus = historical_spreads.get(g["game_id"])
            if consensus is not None:
                teams = get_teams()
                home_tv = match_team(g["home_team"], teams)
                away_tv = match_team(g["away_team"], teams)
                home_stats = teams.get(home_tv) if home_tv else None
                away_stats = teams.get(away_tv) if away_tv else None
                edge = None
                credible = False
                vb_side = None
                vb_edge = None
                vb_reason = None
                if home_stats and away_stats:
                    factors = compute_spread(home_stats, away_stats, neutral_site=True)
                    model_line = to_market(factors["spread"])
                    edge = round(abs(model_line - consensus), 1)
                    credible = MIN_EDGE <= edge <= MAX_EDGE
                    if credible:
                        if model_line < consensus:
                            vb_side = g["home_team"]
                            vb_edge = edge
                            vb_reason = f"Model likes {home_tv} {edge} pts more than market"
                        else:
                            vb_side = g["away_team"]
                            vb_edge = edge
                            vb_reason = f"Model likes {away_tv} {edge} pts more than market"
                update_consensus_spread(g["game_id"], consensus, edge=edge, credible=credible,
                                        value_bet_side=vb_side, value_bet_edge=vb_edge,
                                        value_bet_reason=vb_reason)
                spread_patched += 1
        print(f"[backfill] Patched consensus_spread for {spread_patched} existing predictions")

    stats = get_performance_stats()
    return {
        "retroactive_inserted": inserted,
        "spread_patched": spread_patched,
        "skipped_no_team_match": skipped_no_match,
        "total_candidates": len(candidates),
        "historical_spreads_found": len(historical_spreads),
        "performance": stats,
    }

