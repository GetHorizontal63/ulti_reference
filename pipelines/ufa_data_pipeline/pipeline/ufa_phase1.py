"""
UFA Phase 1 — Paginated player list crawl.

Walks all pages of https://watchufa.com/league/players?page={N},
writing player stub rows into ufa_players.
"""
import logging
import sys
from pathlib import Path

_USAU_PIPELINE = Path(__file__).resolve().parent.parent.parent / "usau_data_pipeline"
sys.path.insert(0, str(_USAU_PIPELINE))
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import (
    now_iso,
    log_ufa,
    is_ufa_page_scraped,
    upsert_ufa_player_stub,
)
from http_client import RateLimiter, create_session, get_with_retry
from pipelines.ufa_data_pipeline.parsers.ufa_player_list import detect_last_page, parse_player_list_page

logger = logging.getLogger(__name__)

UFA_BASE_URL = "https://watchufa.com"
PLAYER_LIST_URL = f"{UFA_BASE_URL}/league/players"


def run_ufa_phase1(conn, dry_run: bool = False, force: bool = False) -> None:
    logger.info("UFA Phase 1: player list crawl")

    session = create_session()
    rate_limiter = RateLimiter(min_delay=1.5, jitter=0.5)

    # Determine last page
    resp = get_with_retry(session, PLAYER_LIST_URL, rate_limiter)
    if resp is None:
        logger.error("Failed to fetch player list page 0 — aborting phase 1")
        return

    last_page = detect_last_page(resp.text)
    if last_page is None:
        logger.warning("Could not detect last page number; defaulting to 194")
        last_page = 194
    logger.info("  Last page: %d  (%d pages total)", last_page, last_page + 1)

    # Process page 0 (already fetched)
    _process_page(conn, resp.text, PLAYER_LIST_URL, 0, dry_run, force)

    for page_num in range(1, last_page + 1):
        url = f"{PLAYER_LIST_URL}?page={page_num}"

        if not force and is_ufa_page_scraped(conn, url):
            logger.debug("  Skipping already-scraped page %d", page_num)
            continue

        if dry_run:
            logger.info("  [dry-run] Would fetch: %s", url)
            continue

        resp = get_with_retry(session, url, rate_limiter)
        if resp is None:
            logger.error("  Failed to fetch page %d", page_num)
            log_ufa(conn, url, "player_list", "error")
            continue

        _process_page(conn, resp.text, url, page_num, dry_run, force)

    logger.info("UFA Phase 1 complete")


def _process_page(
    conn,
    html: str,
    url: str,
    page_num: int,
    dry_run: bool,
    force: bool,
) -> None:
    if dry_run:
        return

    players = parse_player_list_page(html)
    if not players:
        logger.warning("  Page %d: no player rows found", page_num)
        log_ufa(conn, url, "player_list", "error", error_msg="no rows parsed")
        return

    for player in players:
        upsert_ufa_player_stub(conn, player)

    log_ufa(conn, url, "player_list", "success")
    logger.info("  Page %d: %d players upserted", page_num, len(players))
