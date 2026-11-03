"""
WUL Phase 3 — Build canonical wul_games from wul_team_game_stats.

Each game appears as two rows in wul_team_game_stats (one per team perspective).
This phase deduplicates them, assigns a canonical home/away order (alphabetical by
franchise_id), and upserts into wul_games.

game_id format: wul_{YYYY-MM-DD}_{franchise_id_a}_{franchise_id_b}
  where franchise_id_a < franchise_id_b (alphabetical)
"""
from __future__ import annotations

import logging
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_wul_date(d: str | None) -> str | None:
    """Normalise WUL date strings to ISO YYYY-MM-DD.

    Handles:
      - "M-D-YYYY"   e.g. "3-29-2025"
      - "MM-DD-YYYY" e.g. "03-29-2025"
      - Already ISO  e.g. "2025-03-29"
    """
    if not d:
        return None
    d = d.strip()
    # Already ISO?
    if re.match(r"^\d{4}-\d{2}-\d{2}$", d):
        return d
    # M-D-YYYY or MM-DD-YYYY
    m = re.match(r"^(\d{1,2})-(\d{1,2})-(\d{4})$", d)
    if m:
        mo, dy, yr = m.group(1), m.group(2), m.group(3)
        return f"{yr}-{int(mo):02d}-{int(dy):02d}"
    return d  # return as-is if we can't parse


def _season_year(season: str | None) -> int | None:
    """Extract year from a season string like '2025 Regular Season'."""
    if not season:
        return None
    try:
        return int(season.split()[0])
    except (IndexError, ValueError):
        return None


def _slug(name: str) -> str:
    """Very simple slug for use in game_id when no franchise_id is available."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


# ---------------------------------------------------------------------------
# Main phase function
# ---------------------------------------------------------------------------

def run_wul_phase3(conn: sqlite3.Connection) -> int:
    """Rebuild wul_games from wul_team_game_stats. Returns number of games upserted."""

    # Build alias map: team_name -> franchise_id
    alias_rows = conn.execute(
        "SELECT alias_name, franchise_id FROM wul_team_name_aliases"
    ).fetchall()
    alias_map: dict[str, str] = {r["alias_name"]: r["franchise_id"] for r in alias_rows}

    # Pull all per-team game rows  (we only need identifying + score columns)
    stat_rows = conn.execute(
        "SELECT team, opponent, date, season, g, ga FROM wul_team_game_stats"
    ).fetchall()

    games: dict[str, dict] = {}

    for r in stat_rows:
        team = r["team"] or ""
        opp  = r["opponent"] or ""
        date_iso = _parse_wul_date(r["date"])
        season   = r["season"]

        fid_team = alias_map.get(team, _slug(team))
        fid_opp  = alias_map.get(opp,  _slug(opp))

        # Canonical ordering: smaller franchise_id → "home"
        if fid_team <= fid_opp:
            home_name, away_name = team, opp
            home_fid,  away_fid  = fid_team, fid_opp
            home_score = int(r["g"])  if r["g"]  is not None else None
            away_score = int(r["ga"]) if r["ga"] is not None else None
        else:
            home_name, away_name = opp, team
            home_fid,  away_fid  = fid_opp, fid_team
            home_score = int(r["ga"]) if r["ga"] is not None else None
            away_score = int(r["g"])  if r["g"]  is not None else None

        game_id = f"wul_{date_iso}_{home_fid}_{away_fid}"

        if game_id in games:
            # Already recorded from the other team's perspective — skip
            continue

        games[game_id] = {
            "game_id":      game_id,
            "year":         _season_year(season),
            "date":         date_iso,
            "season":       season,
            "home_team":    home_name,
            "away_team":    away_name,
            "home_team_id": home_fid,
            "away_team_id": away_fid,
            "home_score":   home_score,
            "away_score":   away_score,
            "status":       "Final",
            "scraped_at":   _now_iso(),
        }

    if not games:
        logger.info("WUL Phase 3: no team game stats found — nothing to build")
        return 0

    conn.executemany(
        """
        INSERT OR REPLACE INTO wul_games
            (game_id, year, date, season, home_team, away_team,
             home_team_id, away_team_id, home_score, away_score,
             status, scraped_at)
        VALUES
            (:game_id, :year, :date, :season, :home_team, :away_team,
             :home_team_id, :away_team_id, :home_score, :away_score,
             :status, :scraped_at)
        """,
        games.values(),
    )
    conn.commit()

    n = len(games)
    logger.info("WUL Phase 3: upserted %d canonical game records into wul_games", n)
    return n
