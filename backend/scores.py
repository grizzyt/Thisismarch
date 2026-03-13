"""
Fetches completed game scores from The Odds API and stores them in the DB.

Endpoint: GET /v4/sports/basketball_ncaab/scores?daysFrom=N&apiKey=...
Returns scores for games completed within the last N days (max 3 on free tier).

After 3 days, scores are permanently unavailable from this API.
The nightly background job ensures results are captured within 24 hours
of completion, well inside the 3-day window.

API quota: free tier = 500 requests/month. Each /scores call = 1 request.
A rate-limit guard prevents fetching more often than once per 30 minutes
on on-demand calls to protect quota.
"""

import os
import time
import httpx
from database import upsert_result

ODDS_API_BASE = "https://api.the-odds-api.com/v4"

# Rate-limit guard: track last fetch time so the Performance tab
# doesn't burn quota on every page load.
_last_fetch_ts: float = 0.0
MIN_FETCH_INTERVAL = 1800  # 30 minutes between on-demand fetches


async def fetch_and_store_scores(days_from: int = 1, force: bool = False) -> dict:
    """
    Pull completed scores from Odds API and persist them to the DB.

    Args:
        days_from: How many days back to pull (1–3). Use 1 for nightly jobs,
                   3 for startup backfill.
        force:     Skip the 30-minute rate-limit guard (used for startup/nightly).

    Returns:
        dict with 'stored' count and 'skipped' (rate-limited) flag.
    """
    global _last_fetch_ts

    ODDS_API_KEY = os.getenv("ODDS_API_KEY", "")
    if not ODDS_API_KEY:
        return {"stored": 0, "skipped": False, "reason": "no api key"}

    now = time.time()
    if not force and (now - _last_fetch_ts) < MIN_FETCH_INTERVAL:
        age_min = round((now - _last_fetch_ts) / 60, 1)
        print(f"[scores] Skipping fetch — last run {age_min}m ago (limit: 30m)")
        return {"stored": 0, "skipped": True, "reason": f"rate limited ({age_min}m ago)"}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{ODDS_API_BASE}/sports/basketball_ncaab/scores",
                params={"apiKey": ODDS_API_KEY, "daysFrom": days_from},
            )
            resp.raise_for_status()
            data = resp.json()
            remaining = resp.headers.get("x-requests-remaining", "?")
            print(f"[scores] Fetched {len(data)} games (daysFrom={days_from}) — {remaining} API requests remaining")
    except Exception as e:
        print(f"[scores] Failed to fetch: {e}")
        return {"stored": 0, "skipped": False, "reason": str(e)}

    _last_fetch_ts = time.time()

    stored = 0
    for game in data:
        if not game.get("completed"):
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
        stored += 1

    if stored:
        print(f"[scores] Stored/updated results for {stored} completed games")

    return {"stored": stored, "skipped": False}
