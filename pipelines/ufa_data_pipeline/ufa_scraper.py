#!/usr/bin/env python3
"""
UFA Player Scraper
Collects player profiles and career statistics from watchufa.com

Writes to the shared SQLite database (ultimate.db) alongside the USAU tables.
All UFA tables are prefixed `ufa_` with a `data_source = 'ufa'` column on ufa_players.

Usage examples:
  # Full pipeline — Phase 1 (player list) then Phase 2 (profiles + stats)
  python ufa_scraper.py

  # Player list only
  python ufa_scraper.py --phases 1

  # Re-scrape profiles after a schema change
  python ufa_scraper.py --phases 2 --force

  # Use a separate database
  python ufa_scraper.py --db ufa_only.db

  # Dry run — print URLs that would be fetched, no HTTP requests
  python ufa_scraper.py --dry-run
"""
import sys
import logging
from pathlib import Path

# Workspace root — needed so 'from pipelines...' absolute imports resolve
_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT))
# Shared code (db, http_client, config) lives in usau_data_pipeline
_USAU_PIPELINE = Path(__file__).resolve().parent.parent / "usau_data_pipeline"
sys.path.insert(0, str(_USAU_PIPELINE))
# Local ufa_data_pipeline for parsers/pipeline subpackages
sys.path.insert(0, str(Path(__file__).parent))

import click

from config import DEFAULT_DB_PATH, DEFAULT_LOG_PATH
from db import get_connection, init_db, init_ufa_db
from pipelines.ufa_data_pipeline.pipeline.ufa_phase1 import run_ufa_phase1
from pipelines.ufa_data_pipeline.pipeline.ufa_phase2 import run_ufa_phase2
from pipelines.ufa_data_pipeline.pipeline.ufa_phase3 import run_ufa_phase3


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
@click.option(
    "--phases",
    default="1,2,3",
    show_default=True,
    help="Comma-separated phases to run: 1=player list, 2=profiles, 3=season stats API.",
)
@click.option(
    "--db",
    "db_path",
    default=None,
    type=click.Path(),
    help=f"Path to SQLite database. Default: {DEFAULT_DB_PATH}",
)
@click.option(
    "--force",
    is_flag=True,
    default=False,
    help="Re-scrape already-completed items.",
)
@click.option(
    "--force-years",
    "force_years",
    default=None,
    help="Comma-separated years to force re-fetch in phase 3 (e.g. 2026).",
)
@click.option(
    "--log-level",
    default="INFO",
    show_default=True,
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    help="Logging verbosity.",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Print URLs that would be fetched; make no HTTP requests.",
)
def main(phases: str, db_path: str | None, force: bool, log_level: str, dry_run: bool,
         force_years: str | None = None) -> None:
    resolved_db = Path(db_path) if db_path else DEFAULT_DB_PATH
    log_path = resolved_db.parent / "ufa_scrape.log"

    _setup_logging(log_level, log_path)
    logger = logging.getLogger(__name__)

    logger.info("UFA Scraper starting")
    logger.info("  Database : %s", resolved_db)
    logger.info("  Phases   : %s", phases)
    logger.info("  Force    : %s", force)
    logger.info("  Dry run  : %s", dry_run)

    phase_list = [p.strip() for p in phases.split(",")]

    conn = get_connection(resolved_db)
    init_db(conn)        # Ensure USAU tables exist (idempotent)
    init_ufa_db(conn)    # Ensure UFA tables exist (idempotent)

    try:
        if "1" in phase_list:
            run_ufa_phase1(conn, dry_run=dry_run, force=force)

        if "2" in phase_list:
            run_ufa_phase2(conn, dry_run=dry_run, force=force)

        if "3" in phase_list:
            parsed_force_years = (
                [int(y.strip()) for y in force_years.split(",") if y.strip()]
                if force_years else None
            )
            run_ufa_phase3(conn, dry_run=dry_run, force=force,
                           force_years=parsed_force_years)
    finally:
        conn.close()

    logger.info("UFA Scraper finished")


if __name__ == "__main__":
    main()
