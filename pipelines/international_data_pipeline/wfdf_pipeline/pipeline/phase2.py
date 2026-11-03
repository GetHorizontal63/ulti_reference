"""
Phase 2 — Scrape games, standings, and rosters for each wfdf_events row.

For each unscraped event (detail_scraped = 0):
  1. Load games_url    → parse → insert wfdf_games
  2. Load standings_url → parse → insert wfdf_standings
  3. Load rosters_url  → parse → insert wfdf_rosters
  4. Mark the event as scraped (detail_scraped = 1)
"""
from __future__ import annotations

import logging
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent.parent))

from pipelines.international_data_pipeline.wfdf_pipeline.config import (
    PAGE_LOAD_WAIT_MS,
    HEADLESS,
)
from pipelines.international_data_pipeline.wfdf_pipeline.db import (
    insert_games,
    insert_standings,
    insert_rosters,
    mark_event_scraped,
    log_wfdf,
    now_iso,
)
from pipelines.international_data_pipeline.wfdf_pipeline.parsers.games_page import parse_games_page
from pipelines.international_data_pipeline.wfdf_pipeline.parsers.teams_page import (
    parse_standings_page,
    parse_rosters_page,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Playwright page helper
# ---------------------------------------------------------------------------

def _fetch_rendered_html(page, url: str) -> str | None:
    """Navigate to url, wait for JS, and return the full page HTML."""
    try:
        page.goto(url, wait_until="networkidle", timeout=60_000)
        page.wait_for_timeout(PAGE_LOAD_WAIT_MS)
        return page.content()
    except Exception as exc:
        logger.error("Failed to load %s: %s", url, exc)
        return None


def _extract_page_title(html: str) -> str | None:
    """Try to pull a human-readable event name from the page title."""
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
    return m.group(1).strip() if m else None


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_phase2(
    conn,
    force: bool = False,
    dry_run: bool = False,
    event_slugs: list[str] | None = None,
) -> None:
    """
    Scrape games, standings, and rosters for all (or selected) wfdf_events rows.

    Args:
        conn:         open SQLite connection
        force:        re-scrape events already marked as scraped
        dry_run:      log actions without making requests or writing data
        event_slugs:  limit to specific event slugs, e.g. ['wucc', 'wjuc-2024']
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.error(
            "playwright is not installed. Run: pip install playwright && playwright install chromium"
        )
        return

    # Fetch candidate events
    if force:
        clause = "WHERE 1=1"
    else:
        clause = "WHERE detail_scraped = 0"

    if event_slugs:
        placeholders = ",".join("?" * len(event_slugs))
        clause += f" AND event_slug IN ({placeholders})"
        params = event_slugs
    else:
        params = []

    rows = conn.execute(
        f"SELECT * FROM wfdf_events {clause} ORDER BY season_year, season_key",
        params,
    ).fetchall()

    if not rows:
        logger.info("Phase 2: no events to scrape.")
        return

    logger.info("Phase 2: scraping %d event(s)", len(rows))

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=HEADLESS)
        page    = browser.new_page()

        for event in rows:
            event_id    = event["id"]
            season_key  = event["season_key"]
            games_url   = event["games_url"]
            standings_url = event["standings_url"]
            rosters_url = event["rosters_url"]

            logger.info("  [%s] scraping event_id=%d", season_key, event_id)

            if dry_run:
                logger.info("    [dry-run] games_url=%s", games_url)
                logger.info("    [dry-run] standings_url=%s", standings_url)
                logger.info("    [dry-run] rosters_url=%s", rosters_url)
                continue

            # ---- Games ----
            if games_url:
                html = _fetch_rendered_html(page, games_url)
                if html:
                    # Try to refine event name from page title
                    title = _extract_page_title(html)
                    if title and not event["event_name"]:
                        conn.execute(
                            "UPDATE wfdf_events SET event_name = ? WHERE id = ?",
                            (title, event_id),
                        )
                        conn.commit()

                    games = parse_games_page(html)
                    logger.info("    Parsed %d game(s)", len(games))
                    insert_games(conn, event_id, games)
                    log_wfdf(conn, "phase2_games", season_key, "ok", f"{len(games)} games")
                else:
                    log_wfdf(conn, "phase2_games", season_key, "error", "no HTML")

            # ---- Standings ----
            if standings_url:
                html = _fetch_rendered_html(page, standings_url)
                if html:
                    standings = parse_standings_page(html)
                    logger.info("    Parsed %d standing row(s)", len(standings))
                    insert_standings(conn, event_id, standings)
                    log_wfdf(conn, "phase2_standings", season_key, "ok", f"{len(standings)} rows")
                else:
                    log_wfdf(conn, "phase2_standings", season_key, "error", "no HTML")

            # ---- Rosters ----
            if rosters_url:
                html = _fetch_rendered_html(page, rosters_url)
                if html:
                    rosters = parse_rosters_page(html)
                    logger.info("    Parsed %d roster entry(ies)", len(rosters))
                    insert_rosters(conn, event_id, rosters)
                    log_wfdf(conn, "phase2_rosters", season_key, "ok", f"{len(rosters)} entries")
                else:
                    log_wfdf(conn, "phase2_rosters", season_key, "error", "no HTML")

            mark_event_scraped(conn, event_id)
            logger.info("    Marked event_id=%d as scraped.", event_id)

        browser.close()

    logger.info("Phase 2 complete.")
