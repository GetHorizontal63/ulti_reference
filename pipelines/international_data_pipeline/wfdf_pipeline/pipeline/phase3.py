"""
Phase 3 — Scrape gameplay detail for each game in wfdf_games.

For each game row where gameplay_scraped = 0 AND game_ref IS NOT NULL:
  1. Build URL: base_url + ?view=gameplay&game={game_ref}
  2. Render with Playwright, extract:
       - Team-level game stats  → wfdf_game_stats
       - Per-player game stats  → wfdf_game_player_stats
       - Point-by-point log    → wfdf_game_points
  3. Mark game as gameplay_scraped = 1

As a side-effect, player IDs discovered from playercard links are stored
in wfdf_game_player_stats.wfdf_player_id for Phase 4 to consume.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent.parent))

from pipelines.international_data_pipeline.wfdf_pipeline.config import (
    GAMEPLAY_URL_TMPL,
    PAGE_LOAD_WAIT_MS,
    HEADLESS,
)
from pipelines.international_data_pipeline.wfdf_pipeline.db import (
    insert_game_stats,
    insert_game_player_stats,
    insert_game_points,
    mark_game_gameplay_scraped,
    upsert_event_player,
    log_wfdf,
)
from pipelines.international_data_pipeline.wfdf_pipeline.parsers.gameplay_page import (
    parse_game_stats,
    parse_game_player_stats,
    parse_game_points,
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


def run_phase3(
    conn,
    force: bool = False,
    dry_run: bool = False,
    event_slugs: list[str] | None = None,
) -> None:
    """
    Scrape the gameplay detail page for every game with a known game_ref.

    Args:
        conn:         open SQLite connection
        force:        re-scrape games already marked as gameplay_scraped
        dry_run:      log actions without writing data or making requests
        event_slugs:  limit to specific event slugs
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.error("playwright not installed — run: pip install playwright && playwright install chromium")
        return

    # Build query
    scraped_clause = "" if force else "AND g.gameplay_scraped = 0"
    slug_clause    = ""
    params         = []
    if event_slugs:
        placeholders = ",".join("?" * len(event_slugs))
        slug_clause  = f"AND e.event_slug IN ({placeholders})"
        params       = list(event_slugs)

    games = conn.execute(
        f"""
        SELECT g.id, g.game_ref, g.team_a, g.team_b,
               e.id AS event_id, e.event_slug, e.base_url, e.season_key
        WHERE g.game_ref IS NOT NULL
          {scraped_clause}
          {slug_clause}
        ORDER BY e.season_key, g.id
        """,
        params,
    ).fetchall()

    if not games:
        logger.info("Phase 3: no games to scrape.")
        return

    logger.info("Phase 3: scraping gameplay for %d game(s)", len(games))

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=HEADLESS)
        page    = browser.new_page()

        for game in games:
            game_id    = game["id"]
            game_ref   = game["game_ref"]
            event_id   = game["event_id"]
            event_slug = game["event_slug"]
            event_year = game["season_year"]
            base_url   = game["base_url"].rstrip("/") + "/"
            season_key = game["season_key"]
            url        = base_url + GAMEPLAY_URL_TMPL.format(game_id=game_ref)

            logger.info("  [%s] game_id=%d  game_ref=%d  %s vs %s",
                        season_key, game_id, game_ref, game["team_a"], game["team_b"])

            if dry_run:
                logger.info("    [dry-run] would fetch %s", url)
                continue

            html = _fetch_html(page, url)
            if not html:
                log_wfdf(conn, "phase3", f"game_{game_ref}", "error", "no HTML")
                continue

            # --- Game stats ---
            _, _, game_stats = parse_game_stats(html)
            logger.info("    game_stats: %d team row(s)", len(game_stats))
            insert_game_stats(conn, game_id, game_stats)

            # --- Player stats ---
            player_stats = parse_game_player_stats(html)
            logger.info("    player_stats: %d row(s)", len(player_stats))
            insert_game_player_stats(conn, game_id, player_stats)

            # --- Register players in the event player registry ---
            registry_rows = [
                {
                    "player_event_id": r["wfdf_player_id"],
                    "series":          0,
                    "player_name":     r["player_name"],
                    "jersey_number":   r["jersey_number"],
                    "team_name":       r["team_name"],
                }
                for r in player_stats
                if r.get("wfdf_player_id") is not None
            ]
            if registry_rows:
                upsert_event_player(conn, event_id, event_slug, event_year, registry_rows)
                logger.info("    registered %d player(s) in wfdf_event_player_id", len(registry_rows))

            # --- Point log ---
            points = parse_game_points(html)
            logger.info("    game_points: %d row(s)", len(points))
            insert_game_points(conn, game_id, points)

            mark_game_gameplay_scraped(conn, game_id)
            log_wfdf(conn, "phase3", f"game_{game_ref}", "ok",
                     f"stats={len(game_stats)} players={len(player_stats)} points={len(points)}")

        browser.close()

    logger.info("Phase 3 complete.")
