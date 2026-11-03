"""
Phase 4 — Scrape individual player cards for season-level aggregate stats.

Player IDs are discovered from two sources (in priority order):
  1. wfdf_game_player_stats.wfdf_player_id  (populated by Phase 3 via gameplay links)
  2. wfdf_rosters — player names are matched against gameplay player links
     if player IDs were embedded in the rosters page HTML

For each unique (event_id, wfdf_player_id, series) not yet in wfdf_player_season_stats:
  1. Build URL: base_url + ?view=playercard&series={series}&player={player_id}
  2. Render with Playwright, parse season aggregate stats
  3. Upsert into wfdf_player_season_stats
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent.parent))

from pipelines.international_data_pipeline.wfdf_pipeline.config import (
    PLAYERCARD_URL_TMPL,
    PAGE_LOAD_WAIT_MS,
    HEADLESS,
)
from pipelines.international_data_pipeline.wfdf_pipeline.db import (
    upsert_player_season_stats,
    log_wfdf,
)
from pipelines.international_data_pipeline.wfdf_pipeline.parsers.playercard_page import (
    parse_playercard,
    extract_player_ids_from_html,
)

logger = logging.getLogger(__name__)


def _fetch_html(page, url: str) -> str | None:
    try:
        page.goto(url, wait_until="networkidle", timeout=60_000)
        page.wait_for_timeout(PAGE_LOAD_WAIT_MS)
        return page.content()
    except Exception as exc:
        logger.error("Failed to load %s: %s", url, exc)
        return None


def _collect_player_targets(conn, event_slugs: list[str] | None) -> list[dict]:
    """
    Build a deduplicated list of players to scrape:
      {event_id, base_url, season_key, wfdf_player_id, series}

    Sources:
      - wfdf_game_player_stats (player_id discovered during Phase 3)
    """
    slug_clause = ""
    params: list = []
    if event_slugs:
        placeholders = ",".join("?" * len(event_slugs))
        slug_clause  = f"AND e.event_slug IN ({placeholders})"
        params       = list(event_slugs)

    rows = conn.execute(
        f"""
        SELECT DISTINCT
            e.id          AS event_id,
            e.base_url,
            e.season_key,
            gps.wfdf_player_id,
            0             AS series
        FROM wfdf_game_player_stats gps
        JOIN wfdf_games   g ON g.id  = gps.game_id
        JOIN wfdf_events  e ON e.id  = g.event_id
        WHERE gps.wfdf_player_id IS NOT NULL
          {slug_clause}
        ORDER BY e.season_key, gps.wfdf_player_id
        """,
        params,
    ).fetchall()

    # Exclude player/event combos already scraped
    already = {
        (r["event_id"], r["wfdf_player_id"], r["series"])
        for r in conn.execute(
            "SELECT event_id, wfdf_player_id, series FROM wfdf_player_season_stats"
        ).fetchall()
    }

    return [
        dict(r)
        for r in rows
        if (r["event_id"], r["wfdf_player_id"], r["series"]) not in already
    ]


def run_phase4(
    conn,
    force: bool = False,
    dry_run: bool = False,
    event_slugs: list[str] | None = None,
) -> None:
    """
    Scrape player card pages for all discovered player IDs.

    Args:
        conn:         open SQLite connection
        force:        re-scrape players already in wfdf_player_season_stats
        dry_run:      log actions without writing data or making requests
        event_slugs:  limit to specific event slugs
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.error("playwright not installed — run: pip install playwright && playwright install chromium")
        return

    if force:
        # Wipe existing so _collect includes all players
        if event_slugs:
            for slug in event_slugs:
                conn.execute(
                    """
                    DELETE FROM wfdf_player_season_stats
                    WHERE event_id IN (SELECT id FROM wfdf_events WHERE event_slug = ?)
                    """,
                    (slug,),
                )
        else:
            conn.execute("DELETE FROM wfdf_player_season_stats")
        conn.commit()

    targets = _collect_player_targets(conn, event_slugs)

    if not targets:
        logger.info("Phase 4: no player cards to scrape.")
        return

    logger.info("Phase 4: scraping %d player card(s)", len(targets))

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=HEADLESS)
        page    = browser.new_page()

        for t in targets:
            event_id   = t["event_id"]
            player_id  = t["wfdf_player_id"]
            series     = t["series"]
            base_url   = t["base_url"].rstrip("/") + "/"
            season_key = t["season_key"]
            url        = base_url + PLAYERCARD_URL_TMPL.format(series=series, player_id=player_id)

            logger.info("  [%s] player_id=%d  series=%d", season_key, player_id, series)

            if dry_run:
                logger.info("    [dry-run] would fetch %s", url)
                continue

            html = _fetch_html(page, url)
            if not html:
                log_wfdf(conn, "phase4", f"player_{player_id}", "error", "no HTML")
                continue

            stats = parse_playercard(html, wfdf_player_id=player_id, series=series)
            if not stats:
                log_wfdf(conn, "phase4", f"player_{player_id}", "error", "parse failed")
                continue

            upsert_player_season_stats(conn, event_id, [stats])
            log_wfdf(conn, "phase4", f"player_{player_id}", "ok",
                     f"{stats.get('player_name')} games={stats.get('games_played')}")
            logger.info("    Saved: %s (%s) — %d games, %d assists, %d goals",
                        stats.get("player_name"), stats.get("team_name"),
                        stats.get("games_played") or 0,
                        stats.get("assists") or 0,
                        stats.get("goals") or 0)

        browser.close()

    logger.info("Phase 4 complete.")
