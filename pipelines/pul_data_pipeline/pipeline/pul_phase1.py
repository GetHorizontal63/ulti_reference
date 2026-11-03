"""
PUL Phase 1 — Playwright scrape of pul-stats-hub.pages.dev/players.

For every season in PUL_SEASONS (plus 'career'):
  1. Navigate to /players/?season={season}
  2. Set rows-per-page dropdown to "All"
  3. Open the Columns panel and click "Show all"
  4. Extract every visible player row (name, team, all stat columns, profile URL)
  5. Upsert rows into pul_player_season_stats

Requires: playwright (pip install playwright && playwright install chromium)
"""
from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Path bootstrap — shared helpers live in usau_data_pipeline
# ---------------------------------------------------------------------------
_ROOT = Path(__file__).resolve().parent.parent.parent
_USAU = _ROOT / "usau_data_pipeline"
sys.path.insert(0, str(_USAU))
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import now_iso, log_pul, is_pul_season_scraped, upsert_pul_player_stats
from pipelines.pul_data_pipeline.parsers.pul_player_table import parse_player_rows

logger = logging.getLogger(__name__)

PUL_BASE_URL = "https://pul-stats-hub.pages.dev"
PLAYERS_URL = f"{PUL_BASE_URL}/players/"

# Seasons available on the site (newest first so DB gets populated in order)
PUL_SEASONS = ["2026", "2025", "2024", "2023", "2022", "career"]


def run_pul_phase1(
    conn,
    dry_run: bool = False,
    force: bool = False,
    seasons: list[str] | None = None,
) -> None:
    """Scrape all player stats for every PUL season."""
    target_seasons = seasons if seasons is not None else PUL_SEASONS
    logger.info("PUL Phase 1: player stats scrape via Playwright")

    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    except ImportError:
        logger.error(
            "playwright is not installed.  Run:  pip install playwright && playwright install chromium"
        )
        return

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

        if force:
            for s in target_seasons:
                conn.execute("DELETE FROM pul_player_season_stats WHERE season=?", (s,))
                conn.execute("DELETE FROM pul_scrape_log WHERE season=?", (s,))
            conn.commit()
            logger.info("  Cleared existing rows for %d seasons (force mode)", len(target_seasons))

        for season in target_seasons:
            if not force and is_pul_season_scraped(conn, season):
                logger.info("  Skipping already-scraped season %s", season)
                continue

            if dry_run:
                logger.info("  [dry-run] Would scrape season %s", season)
                continue

            logger.info("  Scraping season %s …", season)
            try:
                rows = _scrape_season(page, season, PWTimeout)
            except Exception as exc:
                logger.error("  Failed to scrape season %s: %s", season, exc)
                log_pul(conn, season, "error", str(exc))
                continue

            if not rows:
                logger.warning("  No rows returned for season %s", season)
                log_pul(conn, season, "empty")
                continue

            scraped_at = now_iso()
            parsed = parse_player_rows(rows, season, scraped_at)
            _upsert_rows(conn, parsed)
            log_pul(conn, season, "success", f"{len(parsed)} rows")
            logger.info("  Season %s: %d players upserted", season, len(parsed))

        browser.close()

    logger.info("PUL Phase 1 complete")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _scrape_season(page, season: str, PWTimeout) -> list[dict[str, Any]]:
    """Navigate to a season's player page and return raw row dicts."""
    url = f"{PLAYERS_URL}?season={season}"
    page.goto(url, wait_until="networkidle", timeout=60_000)

    # Wait for the active season's table to have rows.
    # Seasons with no data (e.g. 2022) will timeout — handled below.
    _ACTIVE = "document.querySelector('[data-season]:not(.hidden) table')"
    try:
        page.wait_for_function(
            f"() => {{ const t = {_ACTIVE}; return t && t.querySelectorAll('tbody tr').length > 0; }}",
            timeout=30_000,
        )
    except PWTimeout:
        row_check = page.evaluate(
            f"() => {{ const t = {_ACTIVE}; return t ? t.querySelectorAll('tbody tr').length : -1; }}"
        )
        if row_check <= 0:
            logger.info("  Season %s: no data rows available", season)
            return []
        # rows appeared just after the wait; continue
    page.wait_for_timeout(500)

    # All UI interactions scoped to the currently-visible [data-season] section
    # so that other seasons' hidden DOM nodes are never targeted.

    # Click the Overall tab within the active section
    page.evaluate(
        "() => { const sec = document.querySelector('[data-season]:not(.hidden)');"
        " if (!sec) return;"
        " const b = Array.from(sec.querySelectorAll('button[data-tab]'))"
        ".find(b => b.dataset.tab === 'overall'); if (b) b.click(); }"
    )
    page.wait_for_timeout(400)

    # Set rows-per-page to All within the active section
    current_count = page.evaluate(
        f"() => {{ const t = {_ACTIVE}; return t ? t.querySelectorAll('tbody tr').length : 0; }}"
    )
    max_value = page.evaluate(
        "() => { const sec = document.querySelector('[data-season]:not(.hidden)');"
        " if (!sec) return null;"
        " const s = Array.from(sec.querySelectorAll('select'))"
        ".find(s => Array.from(s.options).some(o => o.value === '20'));"
        " if (!s) return null;"
        " const opts = Array.from(s.options);"
        " const allOpt = opts.find(o => /^all$/i.test(o.text.trim())) || opts[opts.length - 1];"
        " return allOpt ? allOpt.value : null; }"
    )
    if max_value:
        page.evaluate(
            f"() => {{ const sec = document.querySelector('[data-season]:not(.hidden)');"
            f" if (!sec) return;"
            f" const s = Array.from(sec.querySelectorAll('select'))"
            f".find(s => Array.from(s.options).some(o => o.value === '20'));"
            f" if (!s) return; s.value='{max_value}';"
            f" s.dispatchEvent(new Event('change',{{bubbles:true}})); }}"
        )
        try:
            page.wait_for_function(
                f"() => {{ const t = {_ACTIVE};"
                f" return t && t.querySelectorAll('tbody tr').length !== {current_count}; }}",
                timeout=10_000,
            )
        except PWTimeout:
            pass

    # Open Columns panel within the active section
    page.evaluate(
        "() => { const sec = document.querySelector('[data-season]:not(.hidden)');"
        " if (!sec) return;"
        " const b = Array.from(sec.querySelectorAll('button'))"
        ".find(b => b.getAttribute('aria-label') === 'Toggle column visibility');"
        " if (b) b.click(); }"
    )
    page.wait_for_timeout(600)

    # Click Show all within the active section
    page.evaluate(
        "() => { const sec = document.querySelector('[data-season]:not(.hidden)');"
        " if (!sec) return;"
        " const b = Array.from(sec.querySelectorAll('button'))"
        ".find(b => b.textContent.trim() === 'Show all');"
        " if (b) b.click(); }"
    )
    page.wait_for_timeout(800)

    # Extract column headers (first table only)
    headers = _extract_headers(page)
    logger.debug("    Headers (%d): %s", len(headers), headers)

    # Extract all body rows (first table only)
    rows = _extract_rows(page, headers)
    return rows


def _extract_headers(page) -> list[str]:
    """Return column header labels from the active season's table (single JS call)."""
    return page.evaluate(
        "() => {"
        " const t = document.querySelector('[data-season]:not(.hidden) table');"
        " if (!t) return [];"
        " return Array.from(t.querySelectorAll('thead tr th'))"
        ".map((th, i) => th.innerText.trim() || ('col_' + i)); }"
    )


def _extract_rows(page, headers: list[str]) -> list[dict[str, Any]]:
    """Return one dict per tbody row from the active season's table (bulk JS call)."""
    raw_rows: list[dict[str, str]] = page.evaluate(
        "() => {"
        " const t = document.querySelector('[data-season]:not(.hidden) table');"
        " if (!t) return [];"
        " return Array.from(t.querySelectorAll('tbody tr')).map(tr => {"
        "  const cells = Array.from(tr.querySelectorAll('td'));"
        "  const a = cells[0] && cells[0].querySelector('a');"
        "  const row = {"
        "   __player_name__: a ? a.innerText.trim() : (cells[0] ? cells[0].innerText.trim() : ''),"
        "   __player_url__: a ? (a.href || '') : ''"
        "  };"
        "  cells.slice(1).forEach((td, i) => { row['__cell_' + i + '__'] = td.innerText.trim(); });"
        "  return row;"
        " }); }"
    )
    result = []
    stat_headers = headers[1:]  # skip the player-name column
    for raw in raw_rows:
        name = raw.get("__player_name__", "").strip()
        if not name:
            continue
        row: dict[str, Any] = {
            "player_name": name,
            "player_url": raw.get("__player_url__", ""),
        }
        for i, header in enumerate(stat_headers):
            row[header] = raw.get(f"__cell_{i}__", "")
        result.append(row)
    return result


def _upsert_rows(conn, rows: list[dict[str, Any]]) -> None:
    for row in rows:
        upsert_pul_player_stats(conn, row)
