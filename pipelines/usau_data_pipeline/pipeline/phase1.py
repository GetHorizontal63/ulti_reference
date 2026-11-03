"""
Phase 1 — Event Discovery.

GETs the USAU tournament calendar base URL (which already shows all events,
all years, all divisions by default) and paginates through every page.
No form filtering — all metadata is extracted from each row.
"""
import logging
import sqlite3

from bs4 import BeautifulSoup

from pipelines.usau_data_pipeline.config import BASE_URL
from pipelines.usau_data_pipeline.db import upsert_event, log_scrape, is_scrape_logged
from pipelines.usau_data_pipeline.http_client import RateLimiter, create_session, get_with_retry, post_with_retry
from pipelines.usau_data_pipeline.parsers.calendar import (
    build_next_page_form_data,
    parse_calendar_page,
    find_next_page_target,
)

logger = logging.getLogger(__name__)

CALENDAR_URL = f"{BASE_URL}/events/tournament/"


def run_phase1(
    conn: sqlite3.Connection,
    divisions: list,    # unused — kept for CLI compatibility
    season_ids: list,   # unused — kept for CLI compatibility
    force: bool = False,
    dry_run: bool = False,
) -> None:
    session      = create_session()
    rate_limiter = RateLimiter()
    detail_key   = "all/all"

    logger.info("Phase 1: scraping full event calendar (no filter)")

    if not force and is_scrape_logged(conn, CALENDAR_URL, detail_key + "/page_1"):
        logger.info("  Already scraped — skipping")
        return

    if dry_run:
        logger.info("  [DRY RUN] Would GET %s", CALENDAR_URL)
        return

    # GET the calendar — default page shows all events, all years, all divisions
    resp = get_with_retry(session, CALENDAR_URL, rate_limiter)
    if not resp:
        logger.error("Failed to load calendar page")
        log_scrape(conn, CALENDAR_URL, "calendar", "error",
                   error_msg="Failed to load calendar page")
        return

    page_num = 1
    while True:
        events = parse_calendar_page(resp.text)
        logger.info("  Page %d: %d events", page_num, len(events))
        for event in events:
            upsert_event(conn, event)

        log_scrape(conn, CALENDAR_URL, "calendar", "success",
                   http_status=200, detail=f"{detail_key}/page_{page_num}")

        next_target = find_next_page_target(resp.text)
        if not next_target:
            break

        soup      = BeautifulSoup(resp.text, "lxml")
        next_data = build_next_page_form_data(soup, next_target)

        resp = post_with_retry(session, CALENDAR_URL, next_data, rate_limiter)
        if not resp:
            logger.error("Pagination POST failed at page %d", page_num + 1)
            break
        page_num += 1
