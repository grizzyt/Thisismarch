"""
Fetch and cache historical data for backtesting.

Sources:
  Ratings : https://barttorvik.com/{year}_team_results.json  (end-of-season)
  Games   : ESPN scoreboard API (unofficial, no key required)
            https://site.api.espn.com/apis/site/v2/sports/basketball/
                    mens-college-basketball/scoreboard?dates=YYYYMMDD&groups=50

Limitation:
  End-of-season ratings are used for ALL games. Early-season games will be
  evaluated against ratings that weren't fully calibrated yet — expect higher
  error there. Use --after 20250201 in backtest.py for a fairer evaluation.
"""

import json
import time
import httpx
from datetime import date, timedelta
from pathlib import Path

CACHE_DIR = Path(__file__).parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)

TORVIK_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://barttorvik.com/",
}

ESPN_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
}

ESPN_BASE = (
    "https://site.api.espn.com/apis/site/v2/sports/basketball"
    "/mens-college-basketball/scoreboard"
)

# 2024-25 season date range
SEASON_START = date(2024, 11, 4)
SEASON_END   = date(2025, 4, 8)   # National Championship


def fetch_season_ratings(year: int = 2025, force: bool = False) -> dict:
    """
    End-of-season adjusted efficiency ratings for all D1 teams.
    Cached after first fetch.
    """
    cache_path = CACHE_DIR / f"ratings_{year}.json"
    if cache_path.exists() and not force:
        data = json.loads(cache_path.read_text())
        print(f"[historical] Loaded {len(data)} teams for {year} from cache")
        return data

    url = f"https://barttorvik.com/{year}_team_results.json"
    print(f"[historical] Fetching {year} ratings from {url} ...")
    with httpx.Client(timeout=30, follow_redirects=True, headers=TORVIK_HEADERS) as c:
        resp = c.get(url)
        resp.raise_for_status()
        raw = resp.json()

    teams = {}
    for row in raw:
        if not isinstance(row, list) or len(row) < 45:
            continue
        name = row[1]
        if not name:
            continue
        try:
            teams[name] = {
                "rank":    int(row[0])   if row[0]  else 999,
                "conf":    str(row[2])   if row[2]  else "",
                "adjOE":   round(float(row[4]),  2),
                "adjDE":   round(float(row[6]),  2),
                "barthag": round(float(row[8]),  4),
                "luck":    round(float(row[33]), 4),
                "sos":     round(float(row[41]), 2),
                "tempo":   round(float(row[44]), 2),
            }
        except (ValueError, IndexError, TypeError):
            continue

    cache_path.write_text(json.dumps(teams))
    print(f"[historical] Cached {len(teams)} teams for {year}")
    return teams


def fetch_game_results(year: int = 2025, force: bool = False) -> list[dict]:
    """
    Fetch all completed NCAAB games for a season from the ESPN scoreboard API.

    Returns list of:
      {date, home, away, home_pts, away_pts, margin, neutral}

    Sorted by date ascending.

    ESPN uses full mascot names ("Duke Blue Devils"); we strip them down to
    short names ("Duke") that map to BartTorvik's naming convention.
    team_mapper.match_team() will handle residual mismatches during backtest.
    """
    cache_path = CACHE_DIR / f"games_{year}.json"
    if cache_path.exists() and not force:
        data = json.loads(cache_path.read_text())
        print(f"[historical] Loaded {len(data)} games for {year} from cache")
        return data

    # Determine date range for the season
    if year == 2025:
        start, end = SEASON_START, SEASON_END
    else:
        # Generic: Nov 1 through Apr 10 of given year
        start = date(year - 1, 11, 1)
        end   = date(year, 4, 10)

    games = _fetch_espn_range(start, end)
    cache_path.write_text(json.dumps(games))
    print(f"[historical] Cached {len(games)} games for {year}")
    return games


def _fetch_espn_range(start: date, end: date) -> list[dict]:
    """Walk day-by-day through the season pulling completed games from ESPN."""
    games = []
    total_days = (end - start).days + 1
    current = start

    with httpx.Client(timeout=20, follow_redirects=True, headers=ESPN_HEADERS) as c:
        day_num = 0
        while current <= end:
            day_num += 1
            date_str = current.strftime("%Y%m%d")

            try:
                resp = c.get(
                    ESPN_BASE,
                    params={"dates": date_str, "groups": "50", "limit": "200"},
                )
                resp.raise_for_status()
                events = resp.json().get("events", [])
            except Exception as e:
                print(f"[historical] {date_str} — fetch error: {e}")
                current += timedelta(days=1)
                continue

            day_games = 0
            for event in events:
                game = _parse_espn_event(event, date_str)
                if game:
                    games.append(game)
                    day_games += 1

            if day_num % 10 == 0 or day_games > 0:
                print(f"[historical] {date_str} ({day_num}/{total_days}): "
                      f"{day_games} games  (total so far: {len(games)})")

            time.sleep(0.15)   # ~150ms between requests — polite rate limit
            current += timedelta(days=1)

    return sorted(games, key=lambda g: g["date"])


def _parse_espn_event(event: dict, date_str: str) -> dict | None:
    """Extract game data from one ESPN scoreboard event."""
    try:
        comps = event.get("competitions", [])
        if not comps:
            return None
        comp = comps[0]

        # Only include completed games
        if not comp.get("status", {}).get("type", {}).get("completed", False):
            return None

        competitors = comp.get("competitors", [])
        home = next((t for t in competitors if t["homeAway"] == "home"), None)
        away = next((t for t in competitors if t["homeAway"] == "away"), None)
        if not home or not away:
            return None

        home_pts = int(home.get("score", 0))
        away_pts = int(away.get("score", 0))
        if home_pts == 0 and away_pts == 0:
            return None

        neutral = comp.get("neutralSite", False)

        # ESPN gives "Duke Blue Devils" — strip mascot (last word) for BartTorvik compat
        home_name = _strip_mascot(home["team"]["displayName"])
        away_name = _strip_mascot(away["team"]["displayName"])

        return {
            "date":      date_str,
            "home":      home_name,
            "away":      away_name,
            "home_pts":  home_pts,
            "away_pts":  away_pts,
            "margin":    home_pts - away_pts,   # positive = home won
            "neutral":   neutral,
        }
    except (KeyError, ValueError, TypeError):
        return None


def _strip_mascot(display_name: str) -> str:
    """
    Convert ESPN display name to BartTorvik-style short name.
    "Duke Blue Devils"       → "Duke"
    "North Carolina Tar Heels" → "North Carolina"
    "St. John's Red Storm"   → "St. John's"
    "Florida State Seminoles"  → "Florida St."  (team_mapper handles final step)

    Strategy: drop the LAST word. For multi-word mascots ("Blue Devils",
    "Red Storm", "Tar Heels") the team_mapper fuzzy match handles the rest.
    """
    # Known multi-word mascots where we need to drop two words
    TWO_WORD_MASCOTS = {
        "Blue Devils", "Red Storm", "Tar Heels", "Golden Eagles", "Golden Hurricanes",
        "Golden Gophers", "Green Wave", "Black Bears", "Blue Hens", "Red Raiders",
        "Horned Frogs", "Scarlet Knights", "Mean Green", "Blue Raiders",
    }
    for mascot in TWO_WORD_MASCOTS:
        if display_name.endswith(mascot):
            return display_name[: -len(mascot)].strip()

    # Default: drop last word
    parts = display_name.rsplit(" ", 1)
    return parts[0] if len(parts) == 2 else display_name
