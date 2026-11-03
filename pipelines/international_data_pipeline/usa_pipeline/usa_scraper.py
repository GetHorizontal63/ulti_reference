#!/usr/bin/env python3
"""
USA National Team International Data Pipeline
==============================================
Scrapes USAU Team USA historical results and rosters from usaultimate.org.

Phase 1 — Index pages: tournament appearances (year, location, record, finish)
Phase 2 — Detail pages: game-by-game results and full roster per appearance

Data is stored in the shared ultimate.db under tables prefixed international_.

Usage examples
--------------
  # Full run — both phases
  python usa_scraper.py

  # Index pages only
  python usa_scraper.py --phase 1

  # Detail pages only (after phase 1 has already run)
  python usa_scraper.py --phase 2

  # Limit to specific event types
  python usa_scraper.py --events wugc,wcbu

  # Re-scrape everything from scratch
  python usa_scraper.py --force

  # Dry run — log what would be scraped
  python usa_scraper.py --dry-run

  # Use a different database
  python usa_scraper.py --db /path/to/other.db
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

# Ensure this package's directory is on the path
sys.path.insert(0, str(Path(__file__).resolve().parent))

import click

from pipelines.international_data_pipeline.usa_pipeline.config import DEFAULT_DB_PATH, DEFAULT_LOG_PATH
from pipelines.international_data_pipeline.usa_pipeline.db import get_connection, init_international_db
from pipelines.international_data_pipeline.usa_pipeline.pipeline.phase1 import run_phase1
from pipelines.international_data_pipeline.usa_pipeline.pipeline.phase2 import run_phase2


# ---------------------------------------------------------------------------
# Logging setup
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
@click.option("--db",       default=str(DEFAULT_DB_PATH), show_default=True,
              help="Path to SQLite database.")
@click.option("--phase",    default=0, type=int, show_default=True,
              help="Run a single phase (1 or 2). 0 = run both.")
@click.option("--events",   default=None,
              help="Comma-separated event types to limit scraping: wugc,u20,u24,world_games,wcbu")
@click.option("--force",    is_flag=True, default=False,
              help="Re-scrape even if data already exists.")
@click.option("--dry-run",  is_flag=True, default=False,
              help="Log what would be scraped without making requests.")
@click.option("--log-level", default="INFO", show_default=True,
              help="Logging level: DEBUG, INFO, WARNING, ERROR.")
def main(db, phase, events, force, dry_run, log_level):
    """USA National Team International Data Pipeline."""
    _setup_logging(log_level, DEFAULT_LOG_PATH)
    logger = logging.getLogger(__name__)

    db_path = Path(db)
    event_list = [e.strip() for e in events.split(",")] if events else None

    logger.info("=== USA International Pipeline ===")
    logger.info("  DB:      %s", db_path)
    logger.info("  Phase:   %s", phase if phase else "1 + 2")
    logger.info("  Events:  %s", event_list or "all")
    logger.info("  Force:   %s", force)
    logger.info("  Dry-run: %s", dry_run)

    conn = get_connection(db_path)
    init_international_db(conn)

    run_p1 = phase in (0, 1)
    run_p2 = phase in (0, 2)

    if run_p1:
        run_phase1(conn, force=force, dry_run=dry_run, event_types=event_list)

    if run_p2:
        run_phase2(conn, force=force, dry_run=dry_run, event_types=event_list)

    conn.close()
    logger.info("=== Pipeline complete ===")


if __name__ == "__main__":
    main()
