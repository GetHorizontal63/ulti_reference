"""
UFA Phase 2 — Player profile + stats scrape.

For each player_slug in ufa_players where scraped_at IS NULL,
fetch https://watchufa.com/league/players/{slug}, parse the profile block
and stat tables, then persist everything to the DB.
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
    update_ufa_player_profile,
    insert_ufa_stat_row,
    get_unscraped_ufa_players,
    mark_ufa_player_scraped,
    delete_ufa_player_stats,
)
from http_client import RateLimiter, create_session, get_with_retry
from pipelines.ufa_data_pipeline.parsers.ufa_player_profile import parse_player_profile

logger = logging.getLogger(__name__)

UFA_BASE_URL = "https://watchufa.com"


def run_ufa_phase2(conn, dry_run: bool = False, force: bool = False) -> None:
    logger.info("UFA Phase 2: player profile scrape")

    slugs = get_unscraped_ufa_players(conn)

    if force:
        # With --force, re-scrape ALL players (including already-scraped ones)
        all_rows = conn.execute(
            "SELECT player_slug FROM ufa_players ORDER BY player_slug"
        ).fetchall()
        slugs = [r["player_slug"] for r in all_rows]
        logger.info("  --force: re-scraping all %d players", len(slugs))
    else:
        logger.info("  %d players pending profile scrape", len(slugs))

    if not slugs:
        logger.info("  Nothing to do — all profiles already scraped")
        return

    session = create_session()
    rate_limiter = RateLimiter(min_delay=1.5, jitter=0.5)

    success_count = 0
    skip_count = 0
    error_count = 0

    for i, player_slug in enumerate(slugs, start=1):
        url = f"{UFA_BASE_URL}/league/players/{player_slug}"

        if dry_run:
            logger.info("  [dry-run] Would fetch: %s", url)
            continue

        resp = get_with_retry(session, url, rate_limiter)

        if resp is None:
            # 404 or connection failure
            logger.warning("  [%d/%d] Skip %s (not found / error)", i, len(slugs), player_slug)
            log_ufa(conn, url, "player_profile", "skip")
            skip_count += 1
            continue

        scraped_at = now_iso()
        profile, stat_rows = parse_player_profile(resp.text, player_slug, scraped_at)

        if profile is None:
            logger.error("  [%d/%d] Parse failure for %s", i, len(slugs), player_slug)
            log_ufa(conn, url, "player_profile", "error",
                    http_status=resp.status_code, error_msg="no player box")
            error_count += 1
            continue

        # Clear old stats if re-scraping with --force
        if force:
            delete_ufa_player_stats(conn, player_slug)

        update_ufa_player_profile(conn, profile)

        for stat in stat_rows:
            insert_ufa_stat_row(conn, stat)

        mark_ufa_player_scraped(conn, player_slug, scraped_at)
        log_ufa(conn, url, "player_profile", "success", http_status=resp.status_code)

        success_count += 1
        if i % 100 == 0:
            logger.info(
                "  Progress: %d/%d  (ok=%d  skip=%d  err=%d)",
                i, len(slugs), success_count, skip_count, error_count,
            )

    logger.info(
        "UFA Phase 2 complete — ok=%d  skip=%d  err=%d",
        success_count, skip_count, error_count,
    )
