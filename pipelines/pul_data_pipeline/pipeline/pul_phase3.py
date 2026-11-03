"""
PUL Phase 3 — Scrape player profile photos from pul-stats-hub.pages.dev.

For every player in master_players with a PUL_ID:
  1. Derive the profile URL from pul_player_season_stats.player_url
  2. Visit that URL with Playwright
  3. Extract the <img> whose src contains "r2.dev" (the Cloudflare R2 CDN)
  4. Store the resolved URL in master_players.PUL_photo_url

Players that already have a PUL_photo_url stored are skipped unless
force=True is passed.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT / "usau_data_pipeline"))
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import set_pul_photo_url  # noqa: E402

logger = logging.getLogger(__name__)

PUL_BASE = "https://pul-stats-hub.pages.dev"


def run_pul_phase3(conn, force: bool = False) -> None:
    """Scrape profile photos for all PUL players and store in master_players."""
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    except ImportError:
        logger.error(
            "playwright is not installed. Run:  pip install playwright && playwright install chromium"
        )
        return

    # Fetch the list of players to process: ID, PUL_ID, existing photo, profile URL
    rows = conn.execute(
        """
        SELECT mp.ID, mp.PUL_ID, mp.PUL_photo_url,
               MIN(ps.player_url) AS player_url
        FROM master_players mp
        JOIN pul_player_season_stats ps ON ps.player_name = mp.Name
        WHERE mp.PUL_ID IS NOT NULL
        GROUP BY mp.ID, mp.PUL_ID, mp.PUL_photo_url
        """
    ).fetchall()

    to_scrape = [
        r for r in rows
        if force or not r["PUL_photo_url"]
    ]

    logger.info(
        "PUL Phase 3: %d players to photo-scrape (%d already have URL, force=%s)",
        len(to_scrape),
        len(rows) - len(to_scrape),
        force,
    )

    if not to_scrape:
        logger.info("PUL Phase 3: nothing to do")
        return

    found = 0
    missing = 0

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )
        )
        page = context.new_page()

        for i, r in enumerate(to_scrape, 1):
            pul_id   = r["PUL_ID"]
            url      = r["player_url"]
            if not url:
                logger.warning("  [%d/%d] %s — no player_url, skipping", i, len(to_scrape), pul_id)
                missing += 1
                continue

            logger.info("  [%d/%d] %s", i, len(to_scrape), url)
            try:
                photo_url = _scrape_photo(page, url, PWTimeout)
            except Exception as exc:
                logger.warning("  Failed: %s — %s", url, exc)
                missing += 1
                continue

            if photo_url:
                set_pul_photo_url(conn, pul_id, photo_url)
                found += 1
            else:
                logger.debug("  No r2.dev image found for %s", pul_id)
                missing += 1

        browser.close()

    logger.info(
        "PUL Phase 3 complete: %d photos saved, %d without image",
        found, missing,
    )


def _scrape_photo(page, url: str, PWTimeout) -> str | None:
    """Navigate to a player profile page and return the r2.dev image src, or None."""
    page.goto(url, wait_until="networkidle", timeout=30_000)

    # Wait for any <img> with an r2.dev src to appear
    try:
        page.wait_for_function(
            "() => !!document.querySelector('img[src*=\"r2.dev\"]')",
            timeout=10_000,
        )
    except PWTimeout:
        return None

    src = page.evaluate(
        "() => { const el = document.querySelector('img[src*=\"r2.dev\"]'); return el ? el.src : null; }"
    )
    return src or None
