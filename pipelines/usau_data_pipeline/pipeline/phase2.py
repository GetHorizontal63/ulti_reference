"""
Phase 2 — Event Landing Pages.

GETs each event's landing page to extract event_id and event_group_id
from the embedded checkStandings JavaScript call.
"""
import logging
import sqlite3

from pipelines.usau_data_pipeline.config import BASE_URL
from pipelines.usau_data_pipeline.db import update_event_ids, log_scrape, now_iso
from pipelines.usau_data_pipeline.http_client import RateLimiter, create_session, get_with_retry
from pipelines.usau_data_pipeline.parsers.event import parse_event_landing

logger = logging.getLogger(__name__)


def run_phase2(
    conn: sqlite3.Connection,
    force: bool = False,
    dry_run: bool = False,
) -> None:
    session      = create_session()
    rate_limiter = RateLimiter()

    if force:
        rows = conn.execute("SELECT event_slug FROM events").fetchall()
    else:
        rows = conn.execute(
            "SELECT event_slug FROM events WHERE event_id IS NULL"
        ).fetchall()

    logger.info("Phase 2: %d event landing pages to process", len(rows))

    for row in rows:
        event_slug = row["event_slug"]
        url = f"{BASE_URL}/events/{event_slug}/"

        if dry_run:
            logger.info("  [DRY RUN] Would GET %s", url)
            continue

        resp = get_with_retry(session, url, rate_limiter)
        if not resp:
            log_scrape(conn, url, "event", "error", error_msg="GET failed")
            continue

        data = parse_event_landing(resp.text)
        event_id       = data.get("event_id")
        event_group_id = data.get("event_group_id")

        if event_id:
            update_event_ids(conn, event_slug, event_id, event_group_id, now_iso())
            log_scrape(conn, url, "event", "success",
                       http_status=200,
                       detail=f"event_id={event_id}")
            logger.info("  %s  →  event_id=%d", event_slug, event_id)
        else:
            log_scrape(conn, url, "event", "skip",
                       http_status=200,
                       detail="No event_id in JS")
            logger.warning("  %s: no event_id found", event_slug)
