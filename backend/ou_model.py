"""
Over/Under (Totals) prediction model.

Uses the same possession-based framework as the spread model:
  raw_total = (home_exp_oe + away_exp_oe) / 100 * avg_tempo

Calibration:
  Fits a linear correction (slope, intercept) against historical
  actual totals stored in the DB. Falls back to (1.0, 0.0) if
  insufficient data (<10 completed games with Torvik matches).
"""

import sqlite3
import numpy as np

MIN_OU_EDGE = 2.0
MAX_OU_EDGE = 10.0


def compute_raw_total(home: dict, away: dict, nat_avg: float) -> dict:
    """Returns raw (uncalibrated) predicted total and intermediate stats."""
    avg_tempo = (home["tempo"] + away["tempo"]) / 2
    home_exp_oe = home["adjOE"] * away["adjDE"] / nat_avg
    away_exp_oe = away["adjOE"] * home["adjDE"] / nat_avg
    raw_total = (home_exp_oe + away_exp_oe) / 100 * avg_tempo
    return {
        "raw_total": round(raw_total, 1),
        "home_exp_oe": round(home_exp_oe, 2),
        "away_exp_oe": round(away_exp_oe, 2),
        "avg_tempo": round(avg_tempo, 1),
    }


def calibrate(db_path: str, teams: dict, nat_avg: float) -> tuple[float, float]:
    """
    Fits slope + intercept by comparing raw predictions to actual totals
    for all completed games where both teams have Torvik data.

    Returns (slope, intercept). Falls back to (1.0, 0.0) if < 10 samples.
    """
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
            SELECT p.home_torvik, p.away_torvik,
                   r.home_score + r.away_score AS actual_total
            FROM predictions p
            JOIN results r ON p.game_id = r.game_id
            WHERE r.completed = 1
              AND p.home_torvik IS NOT NULL
              AND p.away_torvik IS NOT NULL
              AND r.home_score IS NOT NULL
              AND r.away_score IS NOT NULL
        """).fetchall()
        conn.close()
    except Exception:
        return 1.0, 0.0

    predicted = []
    actual = []
    for row in rows:
        ht = teams.get(row["home_torvik"])
        at = teams.get(row["away_torvik"])
        if not ht or not at:
            continue
        res = compute_raw_total(ht, at, nat_avg)
        predicted.append(res["raw_total"])
        actual.append(row["actual_total"])

    if len(predicted) < 10:
        return 1.0, 0.0

    x = np.array(predicted)
    y = np.array(actual)
    slope, intercept = np.polyfit(x, y, 1)
    print(f"[ou_model] Calibrated on {len(predicted)} games: slope={slope:.3f}, intercept={intercept:.1f}")
    return float(slope), float(intercept)


def predict_total(home: dict, away: dict, nat_avg: float,
                  slope: float = 1.0, intercept: float = 0.0) -> dict:
    """Returns calibrated model total and intermediate stats."""
    base = compute_raw_total(home, away, nat_avg)
    model_total = round(slope * base["raw_total"] + intercept, 1)
    return {**base, "model_total": model_total}
