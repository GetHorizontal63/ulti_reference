"""
Phase 4 — Event Team Roster Pages.

GETs each team's event roster page, parses player and coach data,
and writes the results to the DB.
"""
import logging
import sqlite3
from urllib.parse import quote

from pipelines.usau_data_pipeline.config import BASE_URL
from pipelines.usau_data_pipeline.db import update_team_full, insert_players, insert_coaches, log_scrape, now_iso
from pipelines.usau_data_pipeline.http_client import RateLimiter, create_session, get_with_retry
from pipelines.usau_data_pipeline.parsers.roster import parse_roster_page

logger = logging.getLogger(__name__)


def run_phase4(
    conn: sqlite3.Connection,
    force: bool = False,
    dry_run: bool = False,
) -> None:
    session      = create_session()
    rate_limiter = RateLimiter()

    if force:
        rows = conn.execute("SELECT event_team_id, event_slug FROM usau_event_teams").fetchall()
    else:
        rows = conn.execute(
            "SELECT event_team_id, event_slug FROM usau_event_teams WHERE scraped_at IS NULL"
        ).fetchall()

    logger.info("Phase 4: %d team roster pages to process", len(rows))

    for row in rows:
        event_team_id = row["event_team_id"]
        event_slug    = row["event_slug"]
        url = f"{BASE_URL}/events/teams/?EventTeamId={quote(event_team_id, safe='')}"

        if dry_run:
            logger.info("  [DRY RUN] Would GET %s", url)
            continue

        resp = get_with_retry(session, url, rate_limiter)
        if not resp:
            log_scrape(conn, url, "roster", "error", error_msg="GET failed")
            continue

        try:
            scraped_at = now_iso()
            data       = parse_roster_page(resp.text, event_team_id, event_slug, scraped_at)
            meta       = data["team_meta"]
            players    = data["players"]
            coaches    = data["coaches"]

            update_team_full(conn, {
                "event_team_id":    event_team_id,
                "team_name":        meta.get("team_name") or "",
                "city":             meta.get("city"),
                "state":            meta.get("state"),
                "competition_level": meta.get("competition_level"),
                "gender_division":  meta.get("gender_division"),
                "scraped_at":       scraped_at,
            })

            if coaches:
                conn.execute(
                    "DELETE FROM team_coaches WHERE event_team_id=?", (event_team_id,)
                )
                insert_coaches(conn, coaches)

            if players:
                conn.execute(
                    "DELETE FROM players WHERE event_team_id=? AND event_slug=?",
                    (event_team_id, event_slug),
                )
                conn.commit()
                insert_players(conn, players)

            log_scrape(conn, url, "roster", "success",
                       http_status=200,
                       detail=f"{len(players)} players")
            logger.info(
                "  %s: %d players, %d coaches",
                meta.get("team_name") or event_team_id, len(players), len(coaches),
            )

        except Exception as exc:
            logger.error("  Parse error for %s: %s", event_team_id, exc)
            log_scrape(conn, url, "roster", "error",
                       http_status=200, error_msg=str(exc))
