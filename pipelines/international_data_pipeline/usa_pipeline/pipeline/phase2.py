"""
Phase 2 — Scrape detail pages for all unscraped tournament appearances.

For each row in international_tournaments where detail_scraped = 0 and detail_url IS NOT NULL:
  1. Fetch the detail page
  2. Parse game results  → international_games
  3. Parse roster        → international_roster
  4. Mark detail_scraped = 1

Skips rows where detail_url is NULL (upcoming events with no page yet).
"""
from __future__ import annotations

import logging
import random
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Path bootstrap
# ---------------------------------------------------------------------------
_PKG = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PKG))

import requests

from pipelines.international_data_pipeline.usa_pipeline.config import (
    HEADERS,
    RATE_LIMIT_SECONDS,
    RATE_LIMIT_JITTER,
    REQUEST_TIMEOUT,
    MAX_RETRIES,
    RETRY_BACKOFF,
)
from pipelines.international_data_pipeline.usa_pipeline.db import (
    now_iso,
    insert_games,
    insert_roster,
    mark_detail_scraped,
    log_international,
)
from pipelines.international_data_pipeline.usa_pipeline.parsers.detail_page import parse_detail_page

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal HTTP helper (mirrors phase1)
# ---------------------------------------------------------------------------

def _get(session: requests.Session, url: str, attempt: int = 0) -> requests.Response | None:
    delay = RATE_LIMIT_SECONDS + random.uniform(0, RATE_LIMIT_JITTER)
    time.sleep(delay)
    try:
        resp = session.get(url, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            return resp
        if resp.status_code == 404:
            logger.warning("404 for %s — skipping", url)
            return None
        if resp.status_code in (429, 503) and attempt < MAX_RETRIES - 1:
            wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
            logger.warning("Rate-limited (%d) — retrying in %ds", resp.status_code, wait)
            time.sleep(wait)
            return _get(session, url, attempt + 1)
        logger.error("HTTP %d fetching %s", resp.status_code, url)
        return None
    except requests.RequestException as exc:
        logger.error("Request failed for %s: %s", url, exc)
        return None


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_phase2(
    conn,
    force: bool = False,
    dry_run: bool = False,
    event_types: list[str] | None = None,
) -> None:
    """
    Fetch detail pages and populate international_games + international_roster.

    Args:
        conn:         open SQLite connection
        force:        re-scrape already-scraped detail pages
        dry_run:      print actions without making requests
        event_types:  limit to specific event types
    """
    where_clauses = ["detail_url IS NOT NULL"]
    params: list = []

    if not force:
        where_clauses.append("detail_scraped = 0")

    if event_types:
        placeholders = ",".join("?" * len(event_types))
        where_clauses.append(f"event_type IN ({placeholders})")
        params.extend(event_types)

    sql = (
        "SELECT id, tournament_key, detail_url FROM international_tournaments "
        "WHERE " + " AND ".join(where_clauses)
        + " ORDER BY year DESC"
    )
    rows = conn.execute(sql, params).fetchall()

    logger.info("Phase 2: %d detail page(s) to scrape", len(rows))

    if not rows:
        logger.info("  Nothing to scrape — all detail pages already processed")
        return

    session = requests.Session()
    session.headers.update(HEADERS)

    scraped = 0
    for row in rows:
        tid   = row["id"]
        key   = row["tournament_key"]
        url   = row["detail_url"]

        logger.info("  Scraping detail: %s  %s", key, url)

        if dry_run:
            logger.info("  [dry-run] Would fetch %s", url)
            continue

        resp = _get(session, url)
        if resp is None:
            log_international(conn, "phase2", key, "error", "HTTP fetch failed")
            continue

        try:
            games, roster = parse_detail_page(resp.text)
        except Exception as exc:
            logger.error("  Parse error for %s: %s", key, exc)
            log_international(conn, "phase2", key, "error", str(exc))
            continue

        insert_games(conn, tid, games)
        insert_roster(conn, tid, roster)
        mark_detail_scraped(conn, tid)

        log_international(
            conn, "phase2", key, "success",
            f"{len(games)} games, {len(roster)} roster members"
        )
        logger.info(
            "  %s: %d game(s), %d roster member(s)", key, len(games), len(roster)
        )
        scraped += 1

    logger.info("Phase 2 complete — %d detail pages scraped", scraped)
