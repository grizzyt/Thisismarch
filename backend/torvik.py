"""
Fetch live team efficiency data from BartTorvik's public JSON endpoint.
Falls back to mock_data.py if the request fails.

Data source: https://barttorvik.com/2026_team_results.json  (2025-26 season)
Updated constantly during the season. No API key required.

Field mapping (array index → stat):
  [0]  T-Rank                [1]  Team name
  [2]  Conference             [3]  Record (W-L)
  [4]  AdjOE                  [5]  AdjOE Rank
  [6]  AdjDE                  [7]  AdjDE Rank
  [8]  Barthag (0-1)          [9]  Barthag Rank
  [10] Wins                   [11] Losses
  [14] Conference record      [33] Luck
  [41] SOS                    [42] NCAA seed
  [44] Adjusted Tempo
"""

import httpx
from mock_data import TEAMS as MOCK_TEAMS

TORVIK_URL = "https://barttorvik.com/2026_team_results.json"


def fetch_torvik_teams(top_n: int = 0) -> dict:
    """
    Fetch current-season team data from BartTorvik.
    Returns dict keyed by team name.
    """
    try:
        resp = httpx.get(TORVIK_URL, timeout=15)
        resp.raise_for_status()
        raw = resp.json()
    except Exception as e:
        print(f"[torvik] Failed to fetch live data: {e}. Using mock data.")
        return MOCK_TEAMS

    teams = {}
    for row in raw:
        try:
            name = row[1]
            teams[name] = {
                "rank": int(row[0]),
                "conf": str(row[2]),
                "record": str(row[3]),
                "adjOE": round(float(row[4]), 2),
                "adjDE": round(float(row[6]), 2),
                "barthag": round(float(row[8]), 4),
                "luck": round(float(row[33]), 4),
                "sos": round(float(row[41]), 2),
                "seed": int(row[42]) if row[42] else 0,
                "tempo": round(float(row[44]), 2),
            }
        except (IndexError, ValueError, TypeError):
            continue

    if not teams:
        print("[torvik] Parsed 0 teams. Using mock data.")
        return MOCK_TEAMS

    if top_n > 0:
        sorted_teams = sorted(teams.items(), key=lambda x: x[1]["rank"])
        teams = dict(sorted_teams[:top_n])

    print(f"[torvik] Loaded {len(teams)} teams (2025-26 season) from barttorvik.com")
    return teams
