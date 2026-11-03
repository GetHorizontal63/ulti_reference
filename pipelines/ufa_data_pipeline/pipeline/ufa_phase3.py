"""
UFA Phase 3 — Player season stats via the official API.

Strategy:
  For each active UFA season, GET /api/v1/players?years=YYYY to get the
  roster, then batch those playerIDs 100 at a time into:
    GET /api/v1/playerStats?playerIDs=id1,...&years=YYYY

  The 'years' parameter must be an integer (no 'all' support).
  2020 had no UFA season (COVID).
"""
import logging
import sys
from pathlib import Path

_USAU_PIPELINE = Path(__file__).resolve().parent.parent.parent / "usau_data_pipeline"
sys.path.insert(0, str(_USAU_PIPELINE))
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import now_iso, log_ufa, insert_ufa_stat_row, upsert_ufa_team
from http_client import RateLimiter, create_session, get_with_retry
from pipelines.ufa_data_pipeline.parsers.ufa_player_stats_api import parse_player_stats_response

logger = logging.getLogger(__name__)

API_BASE = "https://www.backend.ufastats.com/api/v1"
BATCH_SIZE = 100

from datetime import datetime, timezone

# Extend this list when new seasons are added.
_UFA_SEASONS_BASE = {2019, 2021, 2022, 2023, 2024, 2025}
UFA_SEASONS = sorted(_UFA_SEASONS_BASE | {datetime.now(timezone.utc).year})


def _get_roster_for_year(session, rate_limiter, year: int) -> dict[str, str]:
    """Return {playerID: teamID} for all players active in the given year."""
    url = f"{API_BASE}/players?years={year}"
    resp = get_with_retry(session, url, rate_limiter)
    if resp is None:
        logger.error("  Could not fetch player roster for %d", year)
        return {}
    player_team: dict[str, str] = {}
    for p in resp.json().get("data", []):
        pid = p.get("playerID")
        if not pid:
            continue
        # teams is a list; take the entry matching this year
        team_id = None
        for t in p.get("teams") or []:
            if t.get("year") == year:
                team_id = t.get("teamID")
                break
        player_team[pid] = team_id
    return player_team


def _get_teams_for_year(conn, session, rate_limiter, year: int) -> None:
    """Fetch team display names for the year and upsert into ufa_teams."""
    url = f"{API_BASE}/teams?years={year}"
    resp = get_with_retry(session, url, rate_limiter)
    if resp is None:
        return
    for t in resp.json().get("data", []):
        team_slug = t.get("teamID")
        if team_slug:
            upsert_ufa_team(
                conn,
                team_slug,
                t.get("fullName") or t.get("name") or team_slug,
                (t.get("division") or {}).get("name") or "",
            )


def run_ufa_phase3(conn, dry_run: bool = False, force: bool = False,
                   force_years: list[int] | None = None) -> None:
    logger.info("UFA Phase 3: player season stats from API")
    _force_years: set[int] = set(force_years or [])

    if not force:
        have_stats: set[tuple] = {
            (r["player_id"], r["year"])
            for r in conn.execute(
                "SELECT player_id, year FROM ufa_player_season_stats"
            ).fetchall()
        }
        logger.info("  %d (player, year) pairs already in DB", len(have_stats))
        if _force_years:
            logger.info("  force_years=%s: will re-fetch regardless of existing rows",
                        sorted(_force_years))
    else:
        have_stats = set()
        logger.info("  --force: re-fetching all seasons")

    session = create_session()
    rate_limiter = RateLimiter(min_delay=0.5, jitter=0.25)

    total_rows = 0
    error_count = 0

    for year in UFA_SEASONS:
        logger.info("  Season %d", year)
        _get_teams_for_year(conn, session, rate_limiter, year)
        player_team = _get_roster_for_year(session, rate_limiter, year)
        all_ids = list(player_team.keys())
        if not all_ids:
            logger.warning("    No players found for %d — skipping", year)
            continue

        if not force and year not in _force_years:
            ids = [pid for pid in all_ids if (pid, year) not in have_stats]
        else:
            ids = all_ids

        logger.info("    %d players total, %d to fetch", len(all_ids), len(ids))
        if not ids:
            continue

        batches = [ids[i : i + BATCH_SIZE] for i in range(0, len(ids), BATCH_SIZE)]
        year_rows = 0

        for batch_idx, batch in enumerate(batches, start=1):
            url = f"{API_BASE}/playerStats?playerIDs={','.join(batch)}&years={year}"

            if dry_run:
                logger.info("    [dry-run] batch %d/%d (%d players)",
                            batch_idx, len(batches), len(batch))
                continue

            resp = get_with_retry(session, url, rate_limiter)
            if resp is None:
                logger.error("    Batch %d/%d failed (year=%d)", batch_idx, len(batches), year)
                log_ufa(conn, url, "player_stats_api", "error")
                error_count += 1
                continue

            try:
                body = resp.json()
            except Exception as exc:
                logger.error("    Batch %d/%d JSON error: %s", batch_idx, len(batches), exc)
                log_ufa(conn, url, "player_stats_api", "error",
                        http_status=resp.status_code, error_msg=str(exc))
                error_count += 1
                continue

            rows = parse_player_stats_response(body.get("data", []), now_iso(), player_team)
            for row in rows:
                insert_ufa_stat_row(conn, row)

            year_rows += len(rows)
            log_ufa(conn, url, "player_stats_api", "success", http_status=resp.status_code)
            logger.info("    Batch %d/%d — %d rows", batch_idx, len(batches), len(rows))

        total_rows += year_rows
        logger.info("  Season %d done — %d rows", year, year_rows)

    logger.info(
        "UFA Phase 3 complete — %d total stat rows, %d errors",
        total_rows, error_count,
    )
