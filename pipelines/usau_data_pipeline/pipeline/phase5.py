"""
Phase 5 — Match Report Pages (optional, enabled with --match-reports flag).

GETs each game's match report page, parses per-game individual player stats,
and writes the results to the DB.  Volume: ~6,600 requests at ~1.5 s/req.
"""
import logging
import sqlite3

from pipelines.usau_data_pipeline.config import BASE_URL
from pipelines.usau_data_pipeline.db import insert_game_player_stats, log_scrape, now_iso
from pipelines.usau_data_pipeline.http_client import RateLimiter, create_session, get_with_retry
from pipelines.usau_data_pipeline.parsers.match_report import parse_match_report

logger = logging.getLogger(__name__)


def run_phase5(
    conn: sqlite3.Connection,
    force: bool = False,
    dry_run: bool = False,
) -> None:
    session      = create_session()
    rate_limiter = RateLimiter()

    if force:
        rows = conn.execute(
            "SELECT event_game_id, home_event_team_id, away_event_team_id "
            "FROM games WHERE has_match_report=1"
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT event_game_id, home_event_team_id, away_event_team_id "
            "FROM games WHERE has_match_report=1 AND match_report_scraped=0"
        ).fetchall()

    logger.info("Phase 5: %d match report pages to process", len(rows))

    for row in rows:
        event_game_id = row["event_game_id"]
        home_etid     = row["home_event_team_id"]
        away_etid     = row["away_event_team_id"]
        url = f"{BASE_URL}/teams/events/match_report/?EventGameId={event_game_id}"

        if dry_run:
            logger.info("  [DRY RUN] Would GET %s", url)
            continue

        resp = get_with_retry(session, url, rate_limiter)
        if not resp:
            conn.execute(
                "UPDATE games SET match_report_scraped=1 WHERE event_game_id=?",
                (event_game_id,),
            )
            conn.commit()
            log_scrape(conn, url, "match_report", "skip",
                       error_msg="GET failed or 404")
            continue

        try:
            scraped_at = now_iso()
            data       = parse_match_report(resp.text, event_game_id, scraped_at)
            meta       = data["meta"]
            home_stats = data["home_stats"]
            away_stats = data["away_stats"]

            numeric_home = meta.get("numeric_home_team_id")
            numeric_away = meta.get("numeric_away_team_id")

            for stat in home_stats:
                stat["event_team_id"]  = home_etid or ""
                stat["numeric_team_id"] = numeric_home

            for stat in away_stats:
                stat["event_team_id"]  = away_etid or ""
                stat["numeric_team_id"] = numeric_away

            all_stats = home_stats + away_stats

            if all_stats:
                conn.execute(
                    "DELETE FROM game_player_stats WHERE event_game_id=?",
                    (event_game_id,),
                )
                conn.commit()
                insert_game_player_stats(conn, all_stats)

            numeric_game_id = meta.get("numeric_game_id")
            conn.execute(
                """UPDATE games
                   SET numeric_game_id     = COALESCE(?, numeric_game_id),
                       match_report_scraped = 1
                   WHERE event_game_id = ?""",
                (numeric_game_id, event_game_id),
            )
            conn.commit()

            log_scrape(conn, url, "match_report", "success",
                       http_status=200,
                       detail=f"{len(all_stats)} player stats")
            logger.info("  %s: %d player stats", event_game_id, len(all_stats))

        except Exception as exc:
            logger.error("  Parse error for match report %s: %s", event_game_id, exc)
            conn.execute(
                "UPDATE games SET match_report_scraped=1 WHERE event_game_id=?",
                (event_game_id,),
            )
            conn.commit()
            log_scrape(conn, url, "match_report", "error",
                       http_status=200, error_msg=str(exc))
