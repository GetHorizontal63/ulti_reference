"""
Configuration for the WFDF international data pipeline.
"""
import os
from pathlib import Path

# ---------------------------------------------------------------------------
# URL patterns
# ---------------------------------------------------------------------------

# Query-string templates appended to a base event URL
GAMES_VIEW_PARAMS      = "?view=games&filter=tournaments&group=all"
STANDINGS_VIEW_PARAMS  = "?view=teams&list=bystandings&goindex=1"
ROSTERS_VIEW_PARAMS    = "?view=teams&list=byrosters&goindex=1"

# When a multi-season event needs a season qualifier:
# base_url + f"?view=teams&season={season_key}&list=bystandings&goindex=1"
STANDINGS_SEASON_TMPL  = "?view=teams&season={season}&list=bystandings&goindex=1"
ROSTERS_SEASON_TMPL    = "?view=teams&season={season}&list=byrosters&goindex=1"
GAMES_SEASON_TMPL      = "?view=games&season={season}&filter=tournaments&group=all"

# Phase 3 — per-game deep dive
# base_url + GAMEPLAY_URL_TMPL.format(game_id=30)
GAMEPLAY_URL_TMPL      = "?view=gameplay&game={game_id}"

# Phase 4 — per-player season card
# base_url + PLAYERCARD_URL_TMPL.format(series=0, player_id=139)
PLAYERCARD_URL_TMPL    = "?view=playercard&series={series}&player={player_id}"

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
_ROOT             = Path(__file__).resolve().parent.parent.parent.parent
DEFAULT_DB_PATH   = Path(os.environ.get("UFA_DB_PATH") or _ROOT / "data" / "db" / "ultimate.db")
DEFAULT_LOG_PATH  = Path(os.environ.get("UFA_LOG_DIR") or _ROOT / "data" / "logs") / "scrape.log"
URLS_FILE         = Path(__file__).resolve().parent / "urls.csv"

# ---------------------------------------------------------------------------
# Playwright / HTTP settings
# ---------------------------------------------------------------------------
# Time (ms) to wait after navigation before reading page content
PAGE_LOAD_WAIT_MS      = 5_000
# Additional wait (ms) if a season selector interaction triggers a reload
SEASON_SWITCH_WAIT_MS  = 3_000
# Headless browser mode
HEADLESS               = True

# Fallback requests-based settings (used only if Playwright unavailable)
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}
RATE_LIMIT_SECONDS = 3.0
RATE_LIMIT_JITTER  = 1.0
REQUEST_TIMEOUT    = 30
MAX_RETRIES        = 3
RETRY_BACKOFF      = [10, 30, 90]
