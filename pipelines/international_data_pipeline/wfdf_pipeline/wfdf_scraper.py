#!/usr/bin/env python3
"""
WFDF International Data Pipeline
==================================
Scrapes WFDF event results (games, standings, rosters) from results.wfdf.sport.

Pages are JavaScript-rendered; this pipeline requires Playwright:
  pip install playwright
  playwright install chromium

Phase 1 — Read urls.txt, discover all seasons for each event, populate wfdf_events.
Phase 2 — For each event row, scrape games list, standings, and rosters.
Phase 3 — For each game with a known game_ref, scrape gameplay detail:
           team stats, per-player stats, point-by-point log.
Phase 4 — For each player ID discovered in Phase 3, scrape their player card
           for season-level aggregate stats.

Usage examples
--------------
  # Full run — all four phases
  python wfdf_scraper.py

  # Single phase
  python wfdf_scraper.py --phase 1
  python wfdf_scraper.py --phase 3

  # Limit to specific event slugs
  python wfdf_scraper.py --events wucc,wjuc-2024

  # Re-scrape everything from scratch
  python wfdf_scraper.py --force

  # Dry run — log what would happen without making requests
  python wfdf_scraper.py --dry-run

  # Use a custom URLs file
  python wfdf_scraper.py --urls-file /path/to/my_urls.txt

  # Use a different database
  python wfdf_scraper.py --db /path/to/other.db
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent.parent))

import click

from pipelines.international_data_pipeline.wfdf_pipeline.config import (
    DEFAULT_DB_PATH,
    DEFAULT_LOG_PATH,
    URLS_FILE,
)
from pipelines.international_data_pipeline.wfdf_pipeline.db import (
    get_connection,
    init_wfdf_db,
)
from pipelines.international_data_pipeline.wfdf_pipeline.pipeline.phase1 import run_phase1
from pipelines.international_data_pipeline.wfdf_pipeline.pipeline.phase2 import run_phase2
from pipelines.international_data_pipeline.wfdf_pipeline.pipeline.phase3 import run_phase3
from pipelines.international_data_pipeline.wfdf_pipeline.pipeline.phase4 import run_phase4


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def _setup_logging(log_level: str, log_path: Path) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    level = getattr(logging, log_level.upper(), logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s  %(levelname)-8s  %(name)s: %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(str(log_path), encoding="utf-8"),
        ],
    )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

@click.command()
@click.option(
    "--db",
    default=str(DEFAULT_DB_PATH),
    show_default=True,
    help="Path to SQLite database.",
)
@click.option(
    "--phase",
    default=0,
    type=int,
    show_default=True,
    help="Run a single phase (1–4). 0 = run all phases.",
)
@click.option(
    "--events",
    default=None,
    help="Comma-separated event slugs to limit scraping, e.g. wucc,wjuc-2024",
)
@click.option(
    "--urls-file",
    default=str(URLS_FILE),
    show_default=True,
    help="Path to the txt file of event base URLs.",
)
@click.option(
    "--force",
    is_flag=True,
    default=False,
    help="Re-scrape even if already done.",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Log actions without making requests or writing data.",
)
@click.option(
    "--log-level",
    default="INFO",
    show_default=True,
    help="Logging level: DEBUG, INFO, WARNING, ERROR.",
)
@click.option(
    "--log-file",
    default=str(DEFAULT_LOG_PATH),
    show_default=True,
    help="Path to log file.",
)
def main(
    db: str,
    phase: int,
    events: str | None,
    urls_file: str,
    force: bool,
    dry_run: bool,
    log_level: str,
    log_file: str,
) -> None:
    _setup_logging(log_level, Path(log_file))
    logger = logging.getLogger(__name__)

    db_path        = Path(db)
    urls_file_path = Path(urls_file)
    event_slugs    = [e.strip() for e in events.split(",")] if events else None

    logger.info("=== WFDF Pipeline starting (phase=%d, force=%s, dry_run=%s) ===",
                phase, force, dry_run)

    conn = get_connection(db_path)
    init_wfdf_db(conn)

    try:
        if phase in (0, 1):
            run_phase1(conn, urls_file=urls_file_path, force=force, dry_run=dry_run)

        if phase in (0, 2):
            run_phase2(conn, force=force, dry_run=dry_run, event_slugs=event_slugs)

        if phase in (0, 3):
            run_phase3(conn, force=force, dry_run=dry_run, event_slugs=event_slugs)

        if phase in (0, 4):
            run_phase4(conn, force=force, dry_run=dry_run, event_slugs=event_slugs)
    finally:
        conn.close()

    logger.info("=== WFDF Pipeline done. ===")


if __name__ == "__main__":
    main()
