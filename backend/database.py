"""
SQLite persistence layer for prediction tracking and model performance.

Tables:
  predictions — one row per game, upserted every time /api/games runs.
                Stores the model's prediction snapshot at capture time.
  results     — one row per completed game, populated from Odds API /scores.

Sign conventions stored in DB:
  model_spread / consensus_spread / blended_spread — market convention (negative = home favored)
  actual_margin — home_score - away_score (positive = home won)
"""

import sqlite3
import os
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(__file__), "predictions.db")

_DDL = """
CREATE TABLE IF NOT EXISTS predictions (
    game_id          TEXT PRIMARY KEY,
    commence_time    TEXT NOT NULL,
    home_team        TEXT NOT NULL,
    away_team        TEXT NOT NULL,
    home_torvik      TEXT,
    away_torvik      TEXT,
    model_spread     REAL,
    blended_spread   REAL,
    consensus_spread REAL,
    home_win_pct     REAL,
    away_win_pct     REAL,
    edge             REAL,
    credible         INTEGER,
    value_bet_edge   REAL,
    value_bet_side   TEXT,
    value_bet_reason TEXT,
    mc_mean_spread   REAL,
    mc_std_dev       REAL,
    mc_home_win_pct  REAL,
    captured_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
    game_id       TEXT PRIMARY KEY,
    home_team     TEXT,
    away_team     TEXT,
    home_score    INTEGER,
    away_score    INTEGER,
    actual_margin INTEGER,
    completed     INTEGER NOT NULL DEFAULT 0,
    commence_time TEXT,
    fetched_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pred_commence ON predictions(commence_time);

CREATE TABLE IF NOT EXISTS ou_predictions (
    game_id         TEXT PRIMARY KEY,
    commence_time   TEXT NOT NULL,
    home_team       TEXT NOT NULL,
    away_team       TEXT NOT NULL,
    home_torvik     TEXT,
    away_torvik     TEXT,
    raw_total       REAL,
    model_total     REAL,
    consensus_total REAL,
    ou_edge         REAL,
    ou_pick         TEXT,
    ou_value        INTEGER DEFAULT 0,
    captured_at     TEXT NOT NULL
);
"""


def _conn():
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    with _conn() as c:
        c.executescript(_DDL)
        # Migrate: add columns that may not exist in older DBs
        for col, typedef in (
            ("home_team", "TEXT"),
            ("away_team", "TEXT"),
            ("commence_time", "TEXT"),
        ):
            try:
                c.execute(f"ALTER TABLE results ADD COLUMN {col} {typedef}")
            except Exception:
                pass  # column already exists


def upsert_prediction(entry: dict):
    p = entry.get("prediction") or {}
    vb = entry.get("value_bet") or {}
    mc = p.get("monte_carlo") or {}
    now = datetime.now(timezone.utc).isoformat()

    with _conn() as c:
        c.execute(
            """
            INSERT INTO predictions (
                game_id, commence_time, home_team, away_team,
                home_torvik, away_torvik,
                model_spread, blended_spread, consensus_spread,
                home_win_pct, away_win_pct, edge, credible,
                value_bet_edge, value_bet_side, value_bet_reason,
                mc_mean_spread, mc_std_dev, mc_home_win_pct,
                captured_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(game_id) DO UPDATE SET
                consensus_spread = excluded.consensus_spread,
                model_spread     = excluded.model_spread,
                blended_spread   = excluded.blended_spread,
                edge             = excluded.edge,
                credible         = excluded.credible,
                value_bet_edge   = excluded.value_bet_edge,
                value_bet_side   = excluded.value_bet_side,
                value_bet_reason = excluded.value_bet_reason,
                mc_mean_spread   = excluded.mc_mean_spread,
                mc_std_dev       = excluded.mc_std_dev,
                mc_home_win_pct  = excluded.mc_home_win_pct,
                captured_at      = excluded.captured_at
            """,
            (
                entry.get("id", ""),
                entry.get("commence_time", ""),
                entry.get("home_team", ""),
                entry.get("away_team", ""),
                entry.get("home_torvik"),
                entry.get("away_torvik"),
                p.get("model_spread"),
                p.get("blended_spread"),
                p.get("consensus_spread"),
                p.get("home_win_pct"),
                p.get("away_win_pct"),
                p.get("edge"),
                int(p.get("credible", False)),
                vb.get("edge"),
                vb.get("side_display"),   # Odds API name — matches scores endpoint
                vb.get("reason"),
                mc.get("mean_spread"),
                mc.get("std_dev"),
                mc.get("home_win_pct"),
                now,
            ),
        )


def upsert_result(game_id: str, home_score: int, away_score: int,
                  actual_margin: int, completed: int,
                  home_team: str = None, away_team: str = None,
                  commence_time: str = None):
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        c.execute(
            """
            INSERT INTO results (game_id, home_team, away_team, home_score, away_score,
                                 actual_margin, completed, commence_time, fetched_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(game_id) DO UPDATE SET
                home_team     = COALESCE(excluded.home_team, home_team),
                away_team     = COALESCE(excluded.away_team, away_team),
                home_score    = excluded.home_score,
                away_score    = excluded.away_score,
                actual_margin = excluded.actual_margin,
                completed     = excluded.completed,
                commence_time = COALESCE(excluded.commence_time, commence_time),
                fetched_at    = excluded.fetched_at
            """,
            (game_id, home_team, away_team, home_score, away_score,
             actual_margin, completed, commence_time, now),
        )


def get_performance_stats() -> dict:
    with _conn() as c:
        # Overall model accuracy (completed games with a model spread)
        row = c.execute("""
            SELECT
                COUNT(*) AS n,
                ROUND(AVG(ABS(-p.model_spread - r.actual_margin)), 2) AS mae,
                ROUND(SQRT(AVG((-p.model_spread - r.actual_margin)*(-p.model_spread - r.actual_margin))), 2) AS rmse,
                ROUND(AVG(-p.model_spread - r.actual_margin), 2) AS bias,
                SUM(CASE
                    WHEN p.consensus_spread IS NOT NULL
                      AND (r.actual_margin + p.consensus_spread) != 0
                      AND (
                        (p.value_bet_side IS NOT NULL AND p.value_bet_side = p.home_team AND (r.actual_margin + p.consensus_spread) > 0)
                        OR (p.value_bet_side IS NOT NULL AND p.value_bet_side = p.away_team AND (r.actual_margin + p.consensus_spread) < 0)
                        OR (p.value_bet_side IS NULL AND p.model_spread < 0 AND (r.actual_margin + p.consensus_spread) > 0)
                        OR (p.value_bet_side IS NULL AND p.model_spread > 0 AND (r.actual_margin + p.consensus_spread) < 0)
                      )
                    THEN 1 ELSE 0 END) AS correct_winners
            FROM predictions p
            JOIN results r ON p.game_id = r.game_id
            WHERE r.completed = 1
              AND p.model_spread IS NOT NULL
              AND r.actual_margin != 0
              AND p.consensus_spread IS NOT NULL
              AND (r.actual_margin + p.consensus_spread) != 0
        """).fetchone()

        n = row["n"] or 0
        stats = {
            "games_completed": n,
            "mae": row["mae"],
            "rmse": row["rmse"],
            "bias": row["bias"],
            "winner_accuracy_pct": round(row["correct_winners"] / n * 100, 1) if n else None,
        }

        # Value bet performance (spread cover, not outright winner)
        vb = c.execute("""
            SELECT
                COUNT(*) AS n,
                SUM(CASE
                    WHEN p.value_bet_side = p.home_team AND (r.actual_margin + p.consensus_spread) > 0 THEN 1
                    WHEN p.value_bet_side = p.away_team AND (r.actual_margin + p.consensus_spread) < 0 THEN 1
                    ELSE 0 END) AS wins
            FROM predictions p
            JOIN results r ON p.game_id = r.game_id
            WHERE r.completed = 1
              AND p.value_bet_side IS NOT NULL
              AND p.consensus_spread IS NOT NULL
              AND (r.actual_margin + p.consensus_spread) != 0
        """).fetchone()

        vn = vb["n"] or 0
        stats["value_bets_completed"] = vn
        stats["value_bet_win_rate_pct"] = round(vb["wins"] / vn * 100, 1) if vn else None
        stats["value_bet_wins"] = vb["wins"] if vn else 0

        # Pending counts
        pending = c.execute("""
            SELECT COUNT(*) AS n FROM predictions p
            LEFT JOIN results r ON p.game_id = r.game_id
            WHERE r.completed IS NULL OR r.completed = 0
        """).fetchone()
        stats["games_pending"] = pending["n"]

        return stats


def get_game_log(limit: int = 200) -> list[dict]:
    with _conn() as c:
        rows = c.execute("""
            SELECT
                p.game_id,
                p.commence_time,
                p.home_team,
                p.away_team,
                p.home_torvik,
                p.away_torvik,
                p.model_spread,
                p.consensus_spread,
                p.blended_spread,
                p.edge,
                p.credible,
                p.value_bet_side,
                p.value_bet_edge,
                p.value_bet_reason,
                p.home_win_pct,
                p.away_win_pct,
                p.mc_mean_spread,
                p.mc_std_dev,
                p.mc_home_win_pct,
                r.home_score,
                r.away_score,
                r.actual_margin,
                COALESCE(r.completed, 0) AS completed,
                CASE
                    WHEN COALESCE(r.completed,0)=0 THEN 'pending'
                    WHEN r.actual_margin = 0        THEN 'push'
                    WHEN p.consensus_spread IS NULL THEN NULL
                    WHEN (r.actual_margin + p.consensus_spread) = 0 THEN 'push'
                    WHEN p.value_bet_side IS NOT NULL AND p.value_bet_side = p.home_team
                      AND (r.actual_margin + p.consensus_spread) > 0 THEN 'correct'
                    WHEN p.value_bet_side IS NOT NULL AND p.value_bet_side = p.away_team
                      AND (r.actual_margin + p.consensus_spread) < 0 THEN 'correct'
                    WHEN p.value_bet_side IS NOT NULL THEN 'incorrect'
                    WHEN (p.model_spread < 0 AND (r.actual_margin + p.consensus_spread) > 0)
                      OR (p.model_spread > 0 AND (r.actual_margin + p.consensus_spread) < 0) THEN 'correct'
                    ELSE 'incorrect'
                END AS model_result,
                CASE
                    WHEN p.value_bet_side IS NULL OR p.consensus_spread IS NULL THEN NULL
                    WHEN COALESCE(r.completed,0)=0                              THEN 'pending'
                    WHEN (r.actual_margin + p.consensus_spread) = 0             THEN 'push'
                    WHEN p.value_bet_side = p.home_team AND (r.actual_margin + p.consensus_spread) > 0 THEN 'won'
                    WHEN p.value_bet_side = p.away_team AND (r.actual_margin + p.consensus_spread) < 0 THEN 'won'
                    ELSE 'lost'
                END AS value_bet_result
            FROM predictions p
            LEFT JOIN results r ON p.game_id = r.game_id
            ORDER BY
                COALESCE(r.completed, 0) DESC,        -- completed games first
                p.commence_time DESC                   -- most recent first within each group
            LIMIT ?
        """, (limit,)).fetchall()
        return [dict(r) for r in rows]


def get_stored_consensus_spreads(game_ids: list[str]) -> dict:
    """Returns {game_id: consensus_spread} for predictions that already have a spread locked in."""
    if not game_ids:
        return {}
    placeholders = ",".join("?" * len(game_ids))
    with _conn() as c:
        rows = c.execute(
            f"SELECT game_id, consensus_spread FROM predictions WHERE game_id IN ({placeholders}) AND consensus_spread IS NOT NULL",
            game_ids,
        ).fetchall()
    return {r["game_id"]: r["consensus_spread"] for r in rows}


def get_predictions_without_spread() -> list[dict]:
    """Returns completed predictions that have no consensus_spread — candidates for historical spread backfill."""
    with _conn() as c:
        rows = c.execute("""
            SELECT p.game_id, p.home_team, p.away_team, p.credible,
                   COALESCE(r.commence_time, p.commence_time) AS commence_time
            FROM predictions p
            JOIN results r ON p.game_id = r.game_id
            WHERE r.completed = 1
              AND (p.consensus_spread IS NULL OR p.value_bet_side IS NULL)
              AND p.home_team IS NOT NULL
        """).fetchall()
        return [dict(r) for r in rows]


def get_results_without_predictions() -> list[dict]:
    """Returns completed results that have no matching prediction row — candidates for retroactive sim."""
    with _conn() as c:
        rows = c.execute("""
            SELECT r.game_id, r.home_team, r.away_team, r.home_score, r.away_score,
                   r.actual_margin, r.commence_time, r.fetched_at
            FROM results r
            LEFT JOIN predictions p ON r.game_id = p.game_id
            WHERE r.completed = 1
              AND p.game_id IS NULL
              AND r.home_team IS NOT NULL
              AND r.away_team IS NOT NULL
        """).fetchall()
        return [dict(r) for r in rows]


def insert_retroactive_prediction(game_id: str, home_team: str, away_team: str,
                                   home_torvik: str, away_torvik: str,
                                   model_spread: float, home_win_pct: float,
                                   away_win_pct: float, mc_mean: float,
                                   mc_std: float, mc_home_win_pct: float,
                                   commence_time: str,
                                   consensus_spread: float = None,
                                   edge: float = None,
                                   credible: bool = False):
    """
    Insert a retroactively simulated prediction.
    Uses INSERT OR IGNORE — will NOT overwrite a real prediction captured at game time.
    consensus_spread / value_bet fields are NULL unless historical odds were fetched.
    """
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        c.execute(
            """
            INSERT OR IGNORE INTO predictions (
                game_id, commence_time, home_team, away_team,
                home_torvik, away_torvik,
                model_spread, blended_spread, consensus_spread,
                home_win_pct, away_win_pct, edge, credible,
                value_bet_edge, value_bet_side, value_bet_reason,
                mc_mean_spread, mc_std_dev, mc_home_win_pct,
                captured_at
            ) VALUES (?,?,?,?,?,?,?,NULL,?,?,?,?,?,NULL,NULL,NULL,?,?,?,?)
            """,
            (game_id, commence_time, home_team, away_team,
             home_torvik, away_torvik,
             model_spread, consensus_spread,
             home_win_pct, away_win_pct,
             edge, int(credible),
             mc_mean, mc_std, mc_home_win_pct, now),
        )
        return c.execute("SELECT changes()").fetchone()[0]  # 1 = inserted, 0 = ignored


def upsert_ou_prediction(game_id: str, commence_time: str,
                         home_team: str, away_team: str,
                         home_torvik: str, away_torvik: str,
                         raw_total: float, model_total: float,
                         consensus_total: float, ou_edge: float,
                         ou_pick: str, ou_value: bool):
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as c:
        c.execute("""
            INSERT INTO ou_predictions (
                game_id, commence_time, home_team, away_team,
                home_torvik, away_torvik, raw_total, model_total,
                consensus_total, ou_edge, ou_pick, ou_value, captured_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(game_id) DO UPDATE SET
                consensus_total = excluded.consensus_total,
                model_total     = excluded.model_total,
                raw_total       = excluded.raw_total,
                ou_edge         = excluded.ou_edge,
                ou_pick         = excluded.ou_pick,
                ou_value        = excluded.ou_value,
                captured_at     = excluded.captured_at
        """, (game_id, commence_time, home_team, away_team,
              home_torvik, away_torvik, raw_total, model_total,
              consensus_total, ou_edge, ou_pick, int(ou_value), now))


def get_ou_game_log(limit: int = 200) -> list[dict]:
    with _conn() as c:
        rows = c.execute("""
            SELECT
                o.game_id, o.commence_time, o.home_team, o.away_team,
                o.home_torvik, o.away_torvik,
                o.raw_total, o.model_total, o.consensus_total,
                o.ou_edge, o.ou_pick, o.ou_value,
                r.home_score, r.away_score,
                r.home_score + r.away_score AS actual_total,
                COALESCE(r.completed, 0) AS completed,
                CASE
                    WHEN COALESCE(r.completed, 0) = 0 THEN 'pending'
                    WHEN o.consensus_total IS NULL THEN NULL
                    WHEN (r.home_score + r.away_score) = o.consensus_total THEN 'push'
                    WHEN o.ou_pick = 'over'  AND (r.home_score + r.away_score) > o.consensus_total THEN 'won'
                    WHEN o.ou_pick = 'under' AND (r.home_score + r.away_score) < o.consensus_total THEN 'won'
                    ELSE 'lost'
                END AS ou_result
            FROM ou_predictions o
            LEFT JOIN results r ON o.game_id = r.game_id
            ORDER BY
                COALESCE(r.completed, 0) DESC,
                o.commence_time DESC
            LIMIT ?
        """, (limit,)).fetchall()
        return [dict(r) for r in rows]


def get_ou_performance_stats() -> dict:
    with _conn() as c:
        row = c.execute("""
            SELECT
                COUNT(*) AS n,
                ROUND(AVG(ABS(o.model_total - (r.home_score + r.away_score))), 2) AS mae,
                SUM(CASE
                    WHEN o.ou_pick = 'over'  AND (r.home_score + r.away_score) > o.consensus_total THEN 1
                    WHEN o.ou_pick = 'under' AND (r.home_score + r.away_score) < o.consensus_total THEN 1
                    ELSE 0 END) AS correct
            FROM ou_predictions o
            JOIN results r ON o.game_id = r.game_id
            WHERE r.completed = 1
              AND o.consensus_total IS NOT NULL
              AND (r.home_score + r.away_score) != o.consensus_total
        """).fetchone()

        n = row["n"] or 0
        stats = {
            "games_completed": n,
            "mae": row["mae"],
            "win_rate_pct": round(row["correct"] / n * 100, 1) if n else None,
            "wins": row["correct"] if n else 0,
        }

        vb = c.execute("""
            SELECT
                COUNT(*) AS n,
                SUM(CASE
                    WHEN o.ou_pick = 'over'  AND (r.home_score + r.away_score) > o.consensus_total THEN 1
                    WHEN o.ou_pick = 'under' AND (r.home_score + r.away_score) < o.consensus_total THEN 1
                    ELSE 0 END) AS wins
            FROM ou_predictions o
            JOIN results r ON o.game_id = r.game_id
            WHERE r.completed = 1
              AND o.ou_value = 1
              AND o.consensus_total IS NOT NULL
              AND (r.home_score + r.away_score) != o.consensus_total
        """).fetchone()

        vn = vb["n"] or 0
        stats["value_completed"] = vn
        stats["value_win_rate_pct"] = round(vb["wins"] / vn * 100, 1) if vn else None
        stats["value_wins"] = vb["wins"] if vn else 0

        pending = c.execute("""
            SELECT COUNT(*) AS n FROM ou_predictions o
            LEFT JOIN results r ON o.game_id = r.game_id
            WHERE r.completed IS NULL OR r.completed = 0
        """).fetchone()
        stats["games_pending"] = pending["n"]

        return stats


def update_consensus_spread(game_id: str, consensus_spread: float,
                             edge: float = None, credible: bool = False,
                             value_bet_side: str = None, value_bet_edge: float = None,
                             value_bet_reason: str = None):
    """Update consensus_spread, edge, and value_bet fields for an existing prediction."""
    with _conn() as c:
        c.execute(
            """
            UPDATE predictions
            SET consensus_spread  = ?,
                edge              = ?,
                credible          = ?,
                value_bet_side    = COALESCE(value_bet_side, ?),
                value_bet_edge    = COALESCE(value_bet_edge, ?),
                value_bet_reason  = COALESCE(value_bet_reason, ?)
            WHERE game_id = ?
              AND (consensus_spread IS NULL OR value_bet_side IS NULL)
            """,
            (consensus_spread, edge, int(credible),
             value_bet_side, value_bet_edge, value_bet_reason,
             game_id),
        )
