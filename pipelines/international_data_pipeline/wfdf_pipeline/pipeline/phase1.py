"""
Phase 1 — Discover seasons from each event base URL listed in urls.txt.

For each base URL:
  1. Launch Playwright, load the page, wait for JS to render.
  2. Look for a season selector element (dropdown / list).
     - If found: iterate each season option, build games/standings/rosters URLs.
     - If not found: treat the URL itself as a single-season event.
  3. Upsert one wfdf_events row per (event_slug × season_key).

Does NOT fetch game or standings data — that is Phase 2.
"""
from __future__ import annotations

import logging
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent.parent))

from pipelines.international_data_pipeline.wfdf_pipeline.config import (
    URLS_FILE,
    PAGE_LOAD_WAIT_MS,
    SEASON_SWITCH_WAIT_MS,
    HEADLESS,
    GAMES_VIEW_PARAMS,
    STANDINGS_VIEW_PARAMS,
    ROSTERS_VIEW_PARAMS,
    GAMES_SEASON_TMPL,
    STANDINGS_SEASON_TMPL,
    ROSTERS_SEASON_TMPL,
)
from pipelines.international_data_pipeline.wfdf_pipeline.db import (
    now_iso,
    upsert_event,
    log_wfdf,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# URL file reader
# ---------------------------------------------------------------------------

def load_urls(urls_file: Path) -> list[dict]:
    """Read event entries from a CSV file (headers: url, type)."""
    import csv
    entries: list[dict] = []
    if not urls_file.exists():
        logger.error("URLs file not found: %s", urls_file)
        return entries
    with urls_file.open(encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            url = row.get("url", "").strip()
            if url and not url.startswith("#"):
                entries.append({"url": url, "type": row.get("type", "").strip()})
    logger.info("Loaded %d URL(s) from %s", len(entries), urls_file)
    return entries


# ---------------------------------------------------------------------------
# Slug / year helpers
# ---------------------------------------------------------------------------

def _clean_base_url(url: str) -> str:
    """Strip query string and fragment, keep scheme + host + path only."""
    p = urlparse(url)
    clean = f"{p.scheme}://{p.netloc}{p.path}"
    if not clean.endswith("/"):
        clean += "/"
    return clean


def _slug_from_url(url: str) -> str:
    """'https://results.wfdf.sport/wjuc-2024/' -> 'wjuc-2024'"""
    path = urlparse(url).path.strip("/")
    return path.split("/")[-1] if path else url


def _year_from_slug(slug: str) -> int | None:
    m = re.search(r"(\d{4})", slug)
    return int(m.group(1)) if m else None


def _season_key(slug: str, season_option: str | None) -> str:
    """Build a unique season key, e.g. 'wucc-WUCC2018', 'wjuc-2024-default'."""
    if season_option:
        return f"{slug}-{season_option}"
    return f"{slug}-default"


def _build_urls(base: str, season: str | None) -> tuple[str, str, str]:
    """Return (games_url, standings_url, rosters_url) for a given season."""
    base = base.rstrip("/") + "/"
    if season:
        games_url     = base + GAMES_SEASON_TMPL.format(season=season)
        standings_url = base + STANDINGS_SEASON_TMPL.format(season=season)
        rosters_url   = base + ROSTERS_SEASON_TMPL.format(season=season)
    else:
        games_url     = base + GAMES_VIEW_PARAMS
        standings_url = base + STANDINGS_VIEW_PARAMS
        rosters_url   = base + ROSTERS_VIEW_PARAMS
    return games_url, standings_url, rosters_url


# ---------------------------------------------------------------------------
# Season discovery via Playwright
# ---------------------------------------------------------------------------

def _discover_seasons_playwright(base_url: str, dry_run: bool) -> list[str | None]:
    """
    Load the base URL with Playwright, look for a season selector,
    and return a list of season values (strings).
    Returns [None] if no selector found (single-season event).
    """
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.error(
            "playwright is not installed. Run: pip install playwright && playwright install chromium"
        )
        return [None]

    seasons: list[str | None] = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=HEADLESS)
        page    = browser.new_page()

        logger.info("  Phase 1: loading %s", base_url)
        if dry_run:
            logger.info("  [dry-run] would load %s", base_url)
            browser.close()
            return [None]

        try:
            page.goto(base_url, wait_until="networkidle", timeout=60_000)
            page.wait_for_timeout(PAGE_LOAD_WAIT_MS)
        except Exception as exc:
            logger.error("  Failed to load %s: %s", base_url, exc)
            browser.close()
            return [None]

        # Look for a season <select> element
        season_select = page.query_selector(
            "select[name*='season'], select[id*='season'], select.season-select"
        )
        if season_select:
            options = season_select.query_selector_all("option")
            for opt in options:
                val = opt.get_attribute("value") or opt.inner_text().strip()
                if val:
                    seasons.append(val)
            logger.info("  Found season selector with %d option(s): %s", len(seasons), seasons)
        else:
            # Try a list of season links / buttons
            season_links = page.query_selector_all(
                "a[href*='season='], button[data-season], li[data-season]"
            )
            for el in season_links:
                val = (
                    el.get_attribute("data-season")
                    or re.search(r"season=([^&]+)", el.get_attribute("href") or "")
                )
                if isinstance(val, re.Match):
                    val = val.group(1)
                if val:
                    seasons.append(val)
            if seasons:
                logger.info("  Found %d season link(s): %s", len(seasons), seasons)

        browser.close()

    return seasons if seasons else [None]


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_phase1(
    conn,
    urls_file: Path = URLS_FILE,
    force: bool = False,
    dry_run: bool = False,
) -> None:
    """
    Read urls.csv, discover seasons for each base URL, and populate wfdf_events.

    Args:
        conn:       open SQLite connection
        urls_file:  path to the CSV file of event base URLs (columns: url, type)
        force:      re-scrape even if events already exist (clears existing rows)
        dry_run:    log actions without writing to DB or making requests
    """
    entries = load_urls(urls_file)
    if not entries:
        logger.warning("No URLs to process.")
        return

    logger.info("Phase 1: discovering seasons for %d event URL(s)", len(entries))

    for entry in entries:
        raw_url     = entry["url"]
        source_type = entry["type"]

        if source_type != "legacy":
            logger.info("Skipping %s (type=%s — only 'legacy' is supported)", raw_url, source_type)
            continue

        base_url = _clean_base_url(raw_url)
        slug = _slug_from_url(base_url)
        logger.info("Processing: %s  (slug=%s, type=%s)", base_url, slug, source_type)

        if force and not dry_run:
            conn.execute("DELETE FROM wfdf_events WHERE event_slug = ?", (slug,))
            conn.commit()
            logger.info("  Cleared existing rows for slug=%s", slug)

        seasons = _discover_seasons_playwright(base_url, dry_run)

        for season in seasons:
            sk        = _season_key(slug, season)
            games_url, standings_url, rosters_url = _build_urls(base_url, season)
            year      = _year_from_slug(season or slug)
            event_row = {
                "event_slug":    slug,
                "season_key":    sk,
                "event_name":    None,          # populated in Phase 2 from page title
                "season_year":   year,
                "division":      None,
                "source_type":   source_type,
                "base_url":      base_url,
                "games_url":     games_url,
                "standings_url": standings_url,
                "rosters_url":   rosters_url,
                "scraped_at":    now_iso(),
            }

            if dry_run:
                logger.info("  [dry-run] would upsert event: %s", event_row)
                continue

            event_id = upsert_event(conn, event_row)
            log_wfdf(conn, "phase1", sk, "ok", f"event_id={event_id}")
            logger.info("  Upserted event id=%d  season_key=%s", event_id, sk)

    logger.info("Phase 1 complete.")
