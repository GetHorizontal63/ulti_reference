#!/usr/bin/env python3
"""
UFA Games & Team-Season Scraper
Populates ufa_games and ufa_team_seasons tables from the official UFA API.

Usage:
    python ufa_games_scraper.py              # all years
    python ufa_games_scraper.py --years 2024,2025
    python ufa_games_scraper.py --years 2024 --force   # re-scrape even if data exists
"""
import sys
import time
import logging
import argparse
from datetime import datetime, timezone
from pathlib import Path

import httpx

# Reuse shared DB helpers from usau_data_pipeline
_USAU = Path(__file__).resolve().parent.parent / "usau_data_pipeline"
sys.path.insert(0, str(_USAU))
from db import get_connection, init_ufa_db, now_iso
from config import DEFAULT_DB_PATH

# ── Constants ──────────────────────────────────────────────────────────────
API_BASE   = "https://www.backend.ufastats.com/api/v1"
HDR        = {"User-Agent": "UltimateReference/1.0 (research)"}
FIRST_YEAR = 2012          # UFA's first season with recorded data
RATE_SLEEP = 0.4           # seconds between requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ── HTTP helper ────────────────────────────────────────────────────────────
def _get(client: httpx.Client, url: str, params: dict) -> dict:
    resp = client.get(url, params=params, headers=HDR, timeout=15)
    resp.raise_for_status()
    return resp.json()


# ── Teams/standings ────────────────────────────────────────────────────────
def scrape_team_seasons(conn, years: list[int], force: bool) -> None:
    """Fetch W-L-T standing records for every team in the given years."""
    year_str = ",".join(str(y) for y in years)
    log.info("Fetching team seasons for years: %s", year_str)

    with httpx.Client() as client:
        data = _get(client, f"{API_BASE}/teams", {"years": year_str})

    rows = data.get("data", [])
    log.info("  API returned %d team-season rows", len(rows))

    ts = now_iso()
    upserted = 0
    for r in rows:
        team_id = r.get("teamID", "")
        year    = r.get("year", 0)
        if not team_id or not year:
            continue

        if not force:
            exists = conn.execute(
                "SELECT 1 FROM ufa_team_seasons WHERE team_id=? AND year=?",
                (team_id, year)
            ).fetchone()
            if exists:
                continue

        conn.execute("""
            INSERT OR REPLACE INTO ufa_team_seasons
              (team_id, year, division_id, division_name, city, name, full_name,
               abbrev, wins, losses, ties, standing, scraped_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            team_id, year,
            r.get("division", {}).get("divisionID"),
            r.get("division", {}).get("name"),
            r.get("city"),
            r.get("name"),
            r.get("fullName"),
            r.get("abbrev"),
            r.get("wins", 0),
            r.get("losses", 0),
            r.get("ties", 0),
            r.get("standing"),
            ts,
        ))
        upserted += 1

    conn.commit()
    log.info("  Upserted %d team-season rows", upserted)


# ── Games ──────────────────────────────────────────────────────────────────
def scrape_games_for_year(conn, year: int, force: bool, client: httpx.Client) -> int:
    """Fetch all games for a single year. Returns count inserted/updated."""
    if not force:
        count = conn.execute(
            "SELECT COUNT(*) FROM ufa_games WHERE year=?", (year,)
        ).fetchone()[0]
        if count > 0:
            log.info("  Year %d: already have %d games, skipping (use --force to re-scrape)", year, count)
            return 0

    log.info("  Fetching games for %d …", year)
    try:
        data = _get(client, f"{API_BASE}/games", {"date": str(year)})
    except httpx.HTTPStatusError as e:
        log.warning("  Year %d: HTTP %s — skipping", year, e.response.status_code)
        return 0

    rows = data.get("data", [])
    log.info("  Year %d: %d games returned", year, len(rows))

    ts = now_iso()
    inserted = 0
    for g in rows:
        game_id = g.get("gameID", "")
        if not game_id:
            continue
        conn.execute("""
            INSERT OR REPLACE INTO ufa_games
              (game_id, year, away_team_id, home_team_id,
               away_score, home_score, status,
               start_timestamp, start_timezone, week, streaming_url, scraped_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            game_id,
            year,
            g.get("awayTeamID", ""),
            g.get("homeTeamID", ""),
            g.get("awayScore"),
            g.get("homeScore"),
            g.get("status"),
            g.get("startTimestamp"),
            g.get("startTimezone"),
            g.get("week"),
            g.get("streamingURL"),
            ts,
        ))
        inserted += 1

    conn.commit()
    return inserted


def scrape_games(conn, years: list[int], force: bool) -> None:
    total = 0
    with httpx.Client() as client:
        for year in years:
            n = scrape_games_for_year(conn, year, force, client)
            total += n
            time.sleep(RATE_SLEEP)
    log.info("Games scrape complete. Total inserted/updated: %d", total)


# ── CLI ────────────────────────────────────────────────────────────────────
def main() -> None:
    current_year = datetime.now(timezone.utc).year

    parser = argparse.ArgumentParser(description="Scrape UFA games and team seasons into local DB")
    parser.add_argument(
        "--years",
        default=None,
        help=f"Comma-delimited years to scrape (default: {FIRST_YEAR}–{current_year})"
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Re-scrape and overwrite rows that already exist"
    )
    parser.add_argument(
        "--db", default=str(DEFAULT_DB_PATH),
        help="Path to SQLite database"
    )
    parser.add_argument(
        "--teams-only", action="store_true", help="Only scrape team seasons"
    )
    parser.add_argument(
        "--games-only", action="store_true", help="Only scrape games"
    )
    args = parser.parse_args()

    if args.years:
        years = [int(y.strip()) for y in args.years.split(",")]
    else:
        years = list(range(FIRST_YEAR, current_year + 1))

    log.info("DB: %s", args.db)
    log.info("Years: %s", years)

    conn = get_connection(Path(args.db))
    init_ufa_db(conn)

    if not args.games_only:
        scrape_team_seasons(conn, years, args.force)

    if not args.teams_only:
        scrape_games(conn, years, args.force)

    conn.close()
    log.info("Done.")


if __name__ == "__main__":
    main()
