#!/usr/bin/env python3
"""
USAU Historical Data Scraper
Collects roster, game, and player-stats data from play.usaultimate.org

Usage examples:
  # Full pipeline — all divisions, all seasons
  python usau_scraper.py

  # Club divisions only, 2020–2025
  python usau_scraper.py --divisions Club-Men,Club-Women,Club-Mixed --seasons 2020,2021,2022,2023,2024,2025

  # Run match reports for already-scraped games
  python usau_scraper.py --phases 5 --match-reports

  # Identity resolution only
  python usau_scraper.py --phases 6

  # Dry run to preview what would be fetched
  python usau_scraper.py --dry-run
"""
import sys
import logging
from pathlib import Path

# Add workspace root so 'from pipelines...' imports resolve when run directly.
# (sync_all.py injects ROOT via PYTHONPATH; this covers direct invocation.)
_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT))
sys.path.insert(0, str(Path(__file__).parent))

import click

from pipelines.usau_data_pipeline.config import (
    DEFAULT_DB_PATH,
    DEFAULT_LOG_PATH,
    DEFAULT_REVIEW_CSV_PATH,
    ALL_DIVISIONS,
    SEASON_ID_RANGE,
)
from pipelines.usau_data_pipeline.db import get_connection, init_db
from pipelines.usau_data_pipeline.pipeline.phase1 import run_phase1
from pipelines.usau_data_pipeline.pipeline.phase2 import run_phase2
from pipelines.usau_data_pipeline.pipeline.phase3 import run_phase3
from pipelines.usau_data_pipeline.pipeline.phase4 import run_phase4
from pipelines.usau_data_pipeline.pipeline.phase5 import run_phase5
from pipelines.usau_data_pipeline.identity import run_phase6


# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------

def setup_logging(log_level: str, log_path: Path) -> None:
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
# Argument parsing helpers
# ---------------------------------------------------------------------------

def _parse_season_ids(seasons_str: str | None) -> list:
    """Convert a comma-separated list of years to season IDs."""
    if not seasons_str:
        return list(SEASON_ID_RANGE)
    years = [int(y.strip()) for y in seasons_str.split(",")]
    # season_id = year - 2005  (e.g. 2025=20, 2024=19, 2014=9)
    return [y - 2005 for y in years]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

@click.command(context_settings={"help_option_names": ["-h", "--help"]})
@click.option(
    "--divisions", default=None,
    help=f"Comma-separated division labels. Choices: {', '.join(ALL_DIVISIONS)}. Default: all.",
)
@click.option(
    "--seasons", default=None,
    help="Comma-separated years (2014–2025). Default: all.",
)
@click.option(
    "--phases", default="1,3,4",
    help="Comma-separated phases to run: 1=calendar, 2=events (legacy), 3=schedules, 4=rosters, 5=match reports, 6=identity. Default: 1,3,4.",
)
@click.option(
    "--match-reports", "match_reports", is_flag=True, default=False,
    help="Enable Phase 5 (match report scraping). Equivalent to adding 5 to --phases.",
)
@click.option(
    "--force", is_flag=True, default=False,
    help="Re-scrape items that were already completed.",
)
@click.option(
    "--db", "db_path", default=None,
    help=f"SQLite database path. Default: {DEFAULT_DB_PATH}",
)
@click.option(
    "--log-level", default="INFO",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    help="Log verbosity level. Default: INFO.",
)
@click.option(
    "--dry-run", "dry_run", is_flag=True, default=False,
    help="Print URLs that would be fetched without making any HTTP requests.",
)
def main(
    divisions,
    seasons,
    phases,
    match_reports,
    force,
    db_path,
    log_level,
    dry_run,
):
    """USAU Historical Data Scraper — collect data from play.usaultimate.org"""

    # --- Resolve paths ---------------------------------------------------
    db_resolved  = Path(db_path) if db_path else DEFAULT_DB_PATH
    log_resolved = db_resolved.parent / "scrape.log"

    setup_logging(log_level, log_resolved)
    logger = logging.getLogger("usau_scraper")

    # --- Validate divisions (legacy flag, unused by Phase 1) -------------
    div_list = [d.strip() for d in divisions.split(",")] if divisions else []

    # --- Parse seasons ---------------------------------------------------
    season_ids = _parse_season_ids(seasons)

    # --- Parse phases ----------------------------------------------------
    phase_list = [int(p.strip()) for p in phases.split(",")]
    if match_reports and 5 not in phase_list:
        phase_list.append(5)

    # --- Summary ---------------------------------------------------------
    logger.info("=" * 60)
    logger.info("USAU Scraper starting")
    logger.info("  DB:         %s", db_resolved)
    logger.info("  Log:        %s", log_resolved)
    logger.info("  Divisions:  %s", div_list)
    logger.info("  Season IDs: %s", season_ids)
    logger.info("  Phases:     %s", sorted(phase_list))
    logger.info("  Force:      %s  |  Dry-run: %s", force, dry_run)
    logger.info("=" * 60)

    # --- DB init ---------------------------------------------------------
    conn = get_connection(db_resolved)
    init_db(conn)

    try:
        if 1 in phase_list:
            logger.info(">>> Phase 1: Event Discovery (tournament calendar)")
            run_phase1(conn, div_list, season_ids, force=force, dry_run=dry_run)

        if 2 in phase_list:
            logger.info(">>> Phase 2: Event Landing Pages")
            run_phase2(conn, force=force, dry_run=dry_run)

        if 3 in phase_list:
            logger.info(">>> Phase 3: Division Schedule Pages")
            season_years = [int(y.strip()) for y in seasons.split(",")] if seasons else None
            run_phase3(conn, force=force, dry_run=dry_run, season_years=season_years)

        if 4 in phase_list:
            logger.info(">>> Phase 4: Event Team Roster Pages")
            run_phase4(conn, force=force, dry_run=dry_run)

        if 5 in phase_list:
            logger.info(">>> Phase 5: Match Report Pages")
            run_phase5(conn, force=force, dry_run=dry_run)

        if 6 in phase_list:
            logger.info(">>> Phase 6: Player Identity Resolution")
            review_csv = db_resolved.parent / "review_queue.csv"
            run_phase6(conn, review_csv)

    except KeyboardInterrupt:
        logger.info("Interrupted by user — progress saved to database.")
    finally:
        conn.close()

    logger.info("Done.")


if __name__ == "__main__":
    main()
