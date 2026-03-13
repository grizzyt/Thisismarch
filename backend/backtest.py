"""
Backtest the spread model against 2024-25 historical game results.

Usage:
  python backtest.py                  # full season, all venues
  python backtest.py --neutral-only   # neutral-site games only (most relevant)
  python backtest.py --after 20250201 # games after Feb 1 (ratings more stable)
  python backtest.py --force          # re-download data even if cached

Output:
  - MAE, RMSE, Bias (systematic home/away lean)
  - Cover rate (% where model correctly predicted winner)
  - Edge bucket breakdown (how accuracy changes at different confidence levels)
  - Worst misses

Note on methodology:
  We use END-OF-SEASON ratings for every game in the season. This means early-
  season games (Oct–Dec) will look worse because the ratings weren't calibrated
  yet. Use --after 20250201 for a fairer evaluation of the model's real accuracy.
"""

import sys
import csv
import json
import argparse
import numpy as np
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from historical import fetch_season_ratings, fetch_game_results
from main import compute_spread, SHRINKAGE


def compute_nat_avg(ratings: dict) -> float:
    """National average adjOE from a ratings snapshot."""
    oes = [t["adjOE"] for t in ratings.values() if "adjOE" in t]
    return float(np.mean(oes)) if oes else 100.0


def run_backtest(
    year: int = 2025,
    neutral_only: bool = False,
    after_date: str | None = None,
    force: bool = False,
) -> dict:
    print(f"\nLoading {year} season data...")
    ratings = fetch_season_ratings(year, force=force)
    games   = fetch_game_results(year, force=force)

    if not games:
        print("No game data available — cannot run backtest.")
        return {}

    nat_avg = compute_nat_avg(ratings)
    print(f"National avg adjOE ({year}): {nat_avg:.2f}")
    print(f"Total games in dataset: {len(games)}")

    # Apply filters
    if neutral_only:
        games = [g for g in games if g["neutral"]]
        print(f"After neutral-only filter: {len(games)} games")
    if after_date:
        games = [g for g in games if g["date"] >= after_date]
        print(f"After date filter (>= {after_date}): {len(games)} games")

    results = []
    skipped = 0

    for game in games:
        home_stats = ratings.get(game["home"])
        away_stats = ratings.get(game["away"])

        if not home_stats or not away_stats:
            skipped += 1
            continue

        factors = compute_spread(
            home_stats, away_stats,
            neutral_site=game["neutral"],
            nat_avg=nat_avg,
        )

        model_margin = factors["spread"]      # internal: positive = home favored
        actual_margin = game["margin"]        # positive = home won

        error = model_margin - actual_margin  # positive = model over-predicted home

        # Cover: model correctly identified which side wins
        if model_margin > 0:
            covered = actual_margin > 0
        elif model_margin < 0:
            covered = actual_margin < 0
        else:
            covered = True  # pick 'em — call it covered

        results.append({
            "date": game["date"],
            "home": game["home"],
            "away": game["away"],
            "model_margin": round(model_margin, 1),
            "actual_margin": actual_margin,
            "error": round(error, 1),
            "covered": covered,
            "neutral": game["neutral"],
        })

    if not results:
        print(f"\nNo matchable games (skipped {skipped} due to missing ratings).")
        return {}

    errors = np.array([r["error"] for r in results])
    covered = np.array([r["covered"] for r in results])

    mae   = float(np.mean(np.abs(errors)))
    rmse  = float(np.sqrt(np.mean(errors ** 2)))
    bias  = float(np.mean(errors))   # positive = model too bullish on home
    cover_rate = float(np.mean(covered)) * 100

    # Edge bucket analysis: how does accuracy vary by model confidence?
    buckets = [
        ("0–3 pts (low conf)",  0, 3),
        ("3–6 pts (moderate)",  3, 6),
        ("6–10 pts (high)",     6, 10),
        ("10+ pts (very high)", 10, 999),
    ]
    bucket_stats = []
    for label, lo, hi in buckets:
        subset = [r for r in results if lo <= abs(r["model_margin"]) < hi]
        if not subset:
            continue
        sub_errors = np.array([r["error"] for r in subset])
        sub_cover  = np.mean([r["covered"] for r in subset]) * 100
        bucket_stats.append({
            "label": label,
            "n": len(subset),
            "mae": round(float(np.mean(np.abs(sub_errors))), 2),
            "cover_pct": round(sub_cover, 1),
        })

    # Worst misses
    worst = sorted(results, key=lambda r: abs(r["error"]), reverse=True)[:10]

    stats = {
        "year": year,
        "games_tested": len(results),
        "games_skipped": skipped,
        "mae": round(mae, 2),
        "rmse": round(rmse, 2),
        "bias": round(bias, 2),
        "cover_rate": round(cover_rate, 1),
        "nat_avg": round(nat_avg, 2),
        "bucket_stats": bucket_stats,
        "worst_misses": worst,
    }

    # -- Print results ------------------------------------------------------
    print(f"\n{'='*56}")
    print(f"  Backtest Results — {year} Season")
    print(f"{'='*56}")
    print(f"  Games tested : {stats['games_tested']}")
    print(f"  Skipped      : {stats['games_skipped']}  (team not in ratings)")
    print(f"  NAT_AVG      : {stats['nat_avg']}")
    print(f"  Shrinkage    : {SHRINKAGE}")
    print(f"{'-'*56}")
    print(f"  MAE          : {stats['mae']} pts  (mean absolute error)")
    print(f"  RMSE         : {stats['rmse']} pts")
    print(f"  Bias         : {stats['bias']} pts  (+ = model too bullish on home)")
    print(f"  Cover rate   : {stats['cover_rate']}%  (50% = random, 55%+ = useful)")
    print(f"{'-'*56}")
    print(f"  Edge bucket breakdown:")
    for b in bucket_stats:
        print(f"    {b['label']:28s}  n={b['n']:4d}  MAE={b['mae']:.2f}  Cover={b['cover_pct']:.1f}%")
    print(f"{'-'*56}")
    print(f"  Worst misses (model_margin vs actual_margin):")
    for r in worst[:5]:
        miss_tag = "HOME" if r["model_margin"] > 0 else "AWAY"
        print(f"    {r['date']}  {r['home']:18s} vs {r['away']:18s}")
        print(f"             Model: {r['model_margin']:+.1f}  Actual: {r['actual_margin']:+d}  Err: {r['error']:+.1f}")
    print(f"{'='*56}\n")

    # -- Save CSVs -------------------------------------------------------------
    suffix_parts = [str(year)]
    if neutral_only:
        suffix_parts.append("neutral")
    if after_date:
        suffix_parts.append(f"after{after_date}")
    suffix = "_".join(suffix_parts)

    out_dir = Path(__file__).parent.parent  # project root
    games_csv  = out_dir / f"backtest_games_{suffix}.csv"
    summary_csv = out_dir / f"backtest_summary_{suffix}.csv"

    # Per-game detail
    with open(games_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "date", "home", "away", "neutral",
            "model_margin", "actual_margin", "error", "abs_error", "covered",
        ])
        writer.writeheader()
        for r in sorted(results, key=lambda x: x["date"]):
            writer.writerow({**r, "abs_error": abs(r["error"])})
    print(f"Game-level CSV:  {games_csv}")

    # Summary stats + buckets
    with open(summary_csv, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Metric", "Value"])
        writer.writerow(["Year", year])
        writer.writerow(["Games tested", stats["games_tested"]])
        writer.writerow(["Games skipped", stats["games_skipped"]])
        writer.writerow(["NAT_AVG", stats["nat_avg"]])
        writer.writerow(["Shrinkage", SHRINKAGE])
        writer.writerow(["MAE (pts)", stats["mae"]])
        writer.writerow(["RMSE (pts)", stats["rmse"]])
        writer.writerow(["Bias (pts)", stats["bias"]])
        writer.writerow(["Cover rate (%)", stats["cover_rate"]])
        writer.writerow([])
        writer.writerow(["Edge Bucket", "N", "MAE", "Cover %"])
        for b in bucket_stats:
            writer.writerow([b["label"], b["n"], b["mae"], b["cover_pct"]])
        writer.writerow([])
        writer.writerow(["Worst Misses", "Home", "Away", "Model", "Actual", "Error"])
        for r in worst:
            writer.writerow(["", r["home"], r["away"],
                             r["model_margin"], r["actual_margin"], r["error"]])
    print(f"Summary CSV:     {summary_csv}")

    return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backtest NCAAB spread model")
    parser.add_argument("--year", type=int, default=2025)
    parser.add_argument("--neutral-only", action="store_true")
    parser.add_argument("--after", type=str, default=None,
                        help="Only games on/after this date, e.g. 20250201")
    parser.add_argument("--force", action="store_true",
                        help="Re-download data even if cached")
    args = parser.parse_args()

    run_backtest(
        year=args.year,
        neutral_only=args.neutral_only,
        after_date=args.after,
        force=args.force,
    )
