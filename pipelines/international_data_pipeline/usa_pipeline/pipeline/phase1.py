"""
Phase 1 — Scrape all five USAU Team USA index pages.

For each event type (wugc, u20, u24, world_games, wcbu):
  1. Fetch the index page
  2. Parse all division blocks (Men / Women / Mixed / etc.)
  3. Upsert each tournament appearance into international_tournaments

Does NOT fetch detail pages — that is Phase 2.
"""
from __future__ import annotations

import logging
import random
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Path bootstrap — config/db live alongside this package
# ---------------------------------------------------------------------------
_PKG = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PKG))

import requests

from pipelines.international_data_pipeline.usa_pipeline.config import (
    INDEX_PAGES,
    HEADERS,
    RATE_LIMIT_SECONDS,
    RATE_LIMIT_JITTER,
    REQUEST_TIMEOUT,
    MAX_RETRIES,
    RETRY_BACKOFF,
)
from pipelines.international_data_pipeline.usa_pipeline.db import now_iso, upsert_tournament, log_international
from pipelines.international_data_pipeline.usa_pipeline.parsers.index_page import parse_index_page

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal HTTP helper
# ---------------------------------------------------------------------------

def _get(session: requests.Session, url: str, attempt: int = 0) -> requests.Response | None:
    """Fetch URL with rate-limiting and simple retry."""
    delay = RATE_LIMIT_SECONDS + random.uniform(0, RATE_LIMIT_JITTER)
    time.sleep(delay)
    try:
        resp = session.get(url, timeout=REQUEST_TIMEOUT)
        if resp.status_code == 200:
            return resp
        if resp.status_code in (429, 503) and attempt < MAX_RETRIES - 1:
            wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
            logger.warning("Rate-limited (%d) on %s — retrying in %ds", resp.status_code, url, wait)
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

def run_phase1(
    conn,
    force: bool = False,
    dry_run: bool = False,
    event_types: list[str] | None = None,
) -> None:
    """
    Scrape all (or selected) index pages and populate international_tournaments.

    Args:
        conn:         open SQLite connection
        force:        re-scrape even if already done (clears existing rows)
        dry_run:      print actions without making requests
        event_types:  limit to specific event types, e.g. ['wugc', 'wcbu']
    """
    targets = {
        k: v for k, v in INDEX_PAGES.items()
        if event_types is None or k in event_types
    }

    logger.info("Phase 1: scraping %d index page(s)", len(targets))

    if force:
        for et in targets:
            conn.execute(
                "DELETE FROM international_tournaments WHERE event_type = ?", (et,)
            )
        conn.commit()
        logger.info("  Cleared existing rows for: %s", ", ".join(targets))

    session = requests.Session()
    session.headers.update(HEADERS)

    total_upserted = 0

    for event_type, url in targets.items():
        logger.info("  Fetching %s (%s) …", event_type, url)

        if dry_run:
            logger.info("  [dry-run] Would fetch %s", url)
            continue

        resp = _get(session, url)
        if resp is None:
            log_international(conn, "phase1", event_type, "error", "HTTP fetch failed")
            continue

        scraped_at = now_iso()
        rows = parse_index_page(resp.text, event_type, scraped_at)

        if not rows:
            logger.warning("  No tournament entries found for %s", event_type)
            log_international(conn, "phase1", event_type, "empty")
            continue

        for row in rows:
            upsert_tournament(conn, row)
            total_upserted += 1

        log_international(
            conn, "phase1", event_type, "success",
            f"{len(rows)} entries upserted"
        )
        logger.info("  %s: %d entries upserted", event_type, len(rows))

    logger.info("Phase 1 complete — %d total tournament entries", total_upserted)
