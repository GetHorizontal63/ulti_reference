#!/usr/bin/env python3
"""
WUL Stats Scraper
Downloads player and team game stats from westernultimateleague.shinyapps.io/stats/
using the site's built-in CSV download button (Playwright), then imports the
CSVs into the shared SQLite database with wul_-prefixed tables.

Usage examples:
  # Full pipeline — download all years, all types, then import
  python wul_scraper.py

  # Specific years only
  python wul_scraper.py --years 2025,2026

  # Specific data types only
  python wul_scraper.py --types player_standard_game,player_advanced_game

  # Re-download already-completed items
  python wul_scraper.py --force

  # Download only (skip DB import)
  python wul_scraper.py --phase 1

  # Import only from already-downloaded CSVs
  python wul_scraper.py --phase 2

  # Use a separate database
  python wul_scraper.py --db my_wul.db

  # Dry run — print what would be downloaded, no browser launched
  python wul_scraper.py --dry-run
"""
import sys
import logging
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT))
_USAU_PIPELINE = Path(__file__).resolve().parent.parent / "usau_data_pipeline"
sys.path.insert(0, str(_USAU_PIPELINE))
sys.path.insert(0, str(Path(__file__).parent))

import click

from config import DEFAULT_DB_PATH, DEFAULT_LOG_PATH
from db import get_connection, init_db, init_wul_db
from pipelines.wul_data_pipeline.pipeline.wul_phase1 import run_wul_phase1, WUL_YEARS, WUL_DATA_TYPES
from pipelines.wul_data_pipeline.pipeline.wul_phase2 import run_wul_phase2
from pipelines.wul_data_pipeline.pipeline.wul_phase3 import run_wul_phase3

_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_WUL_RAW_DIR = _ROOT / "data" / "raw" / "wul"


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
    "--years",
    default=None,
    help=(
        "Comma-separated years to process, e.g. '2025,2026'. "
        f"Defaults to all: {','.join(WUL_YEARS)}"
    ),
)
@click.option(
    "--types",
    "data_types",
    default=None,
    help=(
        "Comma-separated data types to process. "
        f"Defaults to all: {','.join(WUL_DATA_TYPES)}"
    ),
)
@click.option(
    "--phase",
    type=click.Choice(["1", "2", "3", "all"]),
    default="all",
    show_default=True,
    help="Which phase(s) to run: 1=download CSVs, 2=import to DB, 3=build wul_games, all=all three.",
)
@click.option(
    "--db",
    "db_path",
    default=None,
    help=f"Path to SQLite database. Defaults to {DEFAULT_DB_PATH}",
)
@click.option(
    "--raw-dir",
    "raw_dir",
    default=None,
    help=f"Directory for downloaded CSVs. Defaults to {DEFAULT_WUL_RAW_DIR}",
)
@click.option("--force", is_flag=True, default=False, help="Re-download/re-import already-done items.")
@click.option("--dry-run", is_flag=True, default=False, help="Print what would run without launching a browser.")
@click.option(
    "--log-level",
    default="INFO",
    show_default=True,
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR"], case_sensitive=False),
    help="Logging verbosity.",
)
def main(years, data_types, phase, db_path, raw_dir, force, dry_run, log_level):
    """Download WUL stats CSVs and import them into the shared database."""
    log_path = DEFAULT_LOG_PATH.parent / "wul_scraper.log"
    _setup_logging(log_level, log_path)

    resolved_db = Path(db_path) if db_path else DEFAULT_DB_PATH
    resolved_raw = Path(raw_dir) if raw_dir else DEFAULT_WUL_RAW_DIR

    target_years = [y.strip() for y in years.split(",")] if years else None
    target_types = [t.strip() for t in data_types.split(",")] if data_types else None

    logging.info("WUL scraper starting — db=%s  raw_dir=%s", resolved_db, resolved_raw)

    with get_connection(resolved_db) as conn:
        init_db(conn)
        init_wul_db(conn)

        if phase in ("1", "all"):
            run_wul_phase1(
                conn,
                raw_dir=resolved_raw,
                dry_run=dry_run,
                force=force,
                years=target_years,
                data_types=target_types,
            )

        if phase in ("2", "all"):
            run_wul_phase2(
                conn,
                raw_dir=resolved_raw,
                force=force,
                years=target_years,
                data_types=target_types,
            )

        if phase in ("3", "all"):
            run_wul_phase3(conn)

    logging.info("WUL scraper finished")


if __name__ == "__main__":
    main()
