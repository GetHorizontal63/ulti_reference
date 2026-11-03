#!/usr/bin/env python3
"""
PUL Player Scraper
Collects player season stats from pul-stats-hub.pages.dev using Playwright.

Writes to the shared SQLite database (ultimate.db) using pul_-prefixed tables.

Requires: playwright
  pip install playwright
  playwright install chromium

Usage examples:
  # Full pipeline — scrape all seasons including career totals
  python pul_scraper.py

  # Specific seasons only
  python pul_scraper.py --seasons 2025,2026

  # Re-scrape already-completed seasons
  python pul_scraper.py --force

  # Use a separate database
  python pul_scraper.py --db my_pul.db

  # Dry run — print what would be scraped, no browser launched
  python pul_scraper.py --dry-run
"""
import sys
import logging
from pathlib import Path

# Workspace root — needed so 'from pipelines...' absolute imports resolve
_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT))
# Shared helpers live in usau_data_pipeline
_USAU_PIPELINE = Path(__file__).resolve().parent.parent / "usau_data_pipeline"
sys.path.insert(0, str(_USAU_PIPELINE))
# Local pul_data_pipeline for parsers/pipeline subpackages
sys.path.insert(0, str(Path(__file__).parent))

import click

from config import DEFAULT_DB_PATH, DEFAULT_LOG_PATH
from db import get_connection, init_db, init_pul_db
from pipelines.pul_data_pipeline.pipeline.pul_phase1 import run_pul_phase1, PUL_SEASONS
from pipelines.pul_data_pipeline.pipeline.pul_phase2 import run_pul_phase2
from pipelines.pul_data_pipeline.pipeline.pul_phase3 import run_pul_phase3
from pipelines.pul_data_pipeline.pipeline.pul_phase4 import run_pul_phase4, PUL_GAME_SEASONS


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
    "--seasons",
    default=None,
    help=(
        "Comma-separated seasons to scrape, e.g. '2025,2026,career'. "
        f"Defaults to all: {','.join(PUL_SEASONS)}"
    ),
)
@click.option(
    "--games-seasons",
    default=None,
    help=(
        "Comma-separated seasons for per-game box-score scrape (Phase 4), "
        f"e.g. '2025,2026'.  Defaults to all: {','.join(PUL_GAME_SEASONS)}"
    ),
)
@click.option(
    "--skip-games",
    is_flag=True,
    default=False,
    help="Skip Phase 4 (per-game box-score scrape).",
)
@click.option(
    "--skip-players",
    is_flag=True,
    default=False,
    help="Skip Phases 1-3 (season player stats + photos); run only Phase 4.",
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
    help="Re-scrape seasons that have already been completed.",
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
    help="Print seasons that would be scraped; do not launch a browser.",
)
def main(
    seasons: str | None,
    games_seasons: str | None,
    skip_games: bool,
    skip_players: bool,
    db_path: str | None,
    force: bool,
    log_level: str,
    dry_run: bool,
) -> None:
    resolved_db = Path(db_path) if db_path else DEFAULT_DB_PATH
    log_path = resolved_db.parent / "pul_scrape.log"

    _setup_logging(log_level, log_path)
    logger = logging.getLogger(__name__)

    season_list = (
        [s.strip() for s in seasons.split(",")]
        if seasons
        else PUL_SEASONS
    )
    games_season_list = (
        [s.strip() for s in games_seasons.split(",")]
        if games_seasons
        else PUL_GAME_SEASONS
    )

    logger.info("PUL Scraper starting")
    logger.info("  Database      : %s", resolved_db)
    logger.info("  Seasons       : %s", season_list)
    logger.info("  Games seasons : %s", games_season_list)
    logger.info("  Force         : %s", force)
    logger.info("  Dry run       : %s", dry_run)

    conn = get_connection(resolved_db)
    init_db(conn)       # Ensure shared tables exist (idempotent)
    init_pul_db(conn)   # Ensure pul_ tables exist (idempotent)

    try:
        run_pul_phase1(conn, dry_run=dry_run, force=force, seasons=season_list)
        if not dry_run:
            run_pul_phase2(conn)
            run_pul_phase3(conn, force=force)
        if not skip_games:
            run_pul_phase4(conn, dry_run=dry_run, force=force, seasons=games_season_list)
    finally:
        conn.close()

    logger.info("PUL Scraper finished")


if __name__ == "__main__":
    main()
