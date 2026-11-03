"""
Configuration for the USA National Team international data pipeline.
"""
import os
from pathlib import Path

# ---------------------------------------------------------------------------
# Index pages — one per competition type
# ---------------------------------------------------------------------------
INDEX_PAGES = {
    "wugc":        "https://usaultimate.org/team-usa/world-championships/",
    "u20":         "https://usaultimate.org/team-usa/u20/",
    "u24":         "https://usaultimate.org/team-usa/u24/",
    "world_games": "https://usaultimate.org/team-usa/world-games/",
    "wcbu":        "https://usaultimate.org/team-usa/beach/",
}

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_ROOT = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_DB_PATH  = Path(os.environ.get("UFA_DB_PATH") or _ROOT / "data" / "db" / "ultimate.db")
DEFAULT_LOG_PATH = Path(os.environ.get("UFA_LOG_DIR") or _ROOT / "data" / "logs") / "scrape.log"

# ---------------------------------------------------------------------------
# HTTP settings
# ---------------------------------------------------------------------------
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
RATE_LIMIT_SECONDS = 2.0
RATE_LIMIT_JITTER  = 1.0
REQUEST_TIMEOUT    = 30
MAX_RETRIES        = 3
RETRY_BACKOFF      = [10, 30, 90]
