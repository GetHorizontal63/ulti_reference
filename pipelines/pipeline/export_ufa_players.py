"""
Export UFA player index for the frontend player search page.

Reads from ultimate.db (ufa_players + ufa_player_season_stats) and writes:
  frontend/public/data/ufa/ufa-players-index.json

Run:
  python pipeline/export_ufa_players.py
"""
from __future__ import annotations

import os
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT  = Path(__file__).resolve().parents[2]
DB_PATH    = Path(os.environ.get("UFA_DB_PATH") or REPO_ROOT / "data" / "db" / "ultimate.db")
OUT_PATH   = Path(os.environ.get("UFA_EXPORT_DIR") or REPO_ROOT / "data" / "exports") / "ufa" / "ufa-players-index.json"

sys.path.insert(0, str(REPO_ROOT / "pipelines" / "usau_data_pipeline"))


def main() -> None:
    if not DB_PATH.exists():
        print(f"[export_ufa_players] DB not found: {DB_PATH}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Pull players with their year range from stats
    rows = conn.execute("""
        SELECT
            p.player_slug,
            p.display_name,
            p.jersey_number,
            COALESCE(p.current_team_name, p.most_recent_team_name) AS team_name,
            p.most_recent_team_year,
            MIN(s.year) AS year_start,
            MAX(s.year) AS year_end
        FROM ufa_players p
        LEFT JOIN ufa_player_season_stats s ON s.player_id = p.player_slug
        GROUP BY p.player_slug
        ORDER BY p.display_name COLLATE NOCASE
    """).fetchall()
    conn.close()

    # Determine the most recent season year we have data for
    max_year_with_stats = max(
        (r["year_end"] for r in rows if r["year_end"] is not None),
        default=2024,
    )

    players = []
    for r in rows:
        year_end   = r["year_end"]   or r["most_recent_team_year"]
        year_start = r["year_start"] or year_end or None
        active     = (year_end == max_year_with_stats) if year_end else False

        players.append({
            "slug":      r["player_slug"],
            "name":      r["display_name"],
            "number":    r["jersey_number"],
            "leagues":   ["UFA"],
            "levels":    ["Pro"],
            "teams":     [r["team_name"]] if r["team_name"] else [],
            "active":    active,
            "yearStart": year_start,
            "yearEnd":   year_end,
        })

    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count":        len(players),
        "year_min":     min((p["yearStart"] for p in players if p["yearStart"]), default=2019),
        "year_max":     max((p["yearEnd"]   for p in players if p["yearEnd"]),   default=2024),
        "players":      players,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"[export_ufa_players] wrote {len(players)} players → {OUT_PATH}")


if __name__ == "__main__":
    main()
