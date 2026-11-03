"""
Configuration constants for the USAU historical data scraper.
"""
import os
from pathlib import Path

BASE_URL = "https://play.usaultimate.org"

# Database and log output go to project_root/backend/ for frontend accessibility
DEFAULT_DB_PATH = Path(os.environ.get("UFA_DB_PATH") or Path(__file__).parent.parent.parent / "data" / "db" / "ultimate.db")
DEFAULT_LOG_PATH = Path(os.environ.get("UFA_LOG_DIR") or Path(__file__).parent.parent.parent / "data" / "logs") / "scrape.log"
DEFAULT_REVIEW_CSV_PATH = Path(os.environ.get("UFA_LOG_DIR") or Path(__file__).parent.parent.parent / "data" / "logs") / "review_queue.csv"

# drpSeasonId values: season_id = year - 2005  (verified from live select options:
#   21=2026, 20=2025, 19=2024, 18=2023, 17=2022 …)
# 2006–2026 → season_ids 1–21
SEASON_ID_RANGE = range(1, 22)  # 1 through 21 inclusive (2006–2026)

# drpEventTypeId=8 means Championship Tournament
EVENT_TYPE_CHAMPIONSHIP = 8

# ---- Actual form field / table names (verified against live HTML) ----
# The form control prefix on the tournament calendar page is CT_HP_Mid_1, NOT CT_Main_0.
FORM_PREFIX          = "CT_HP_Mid_1"
CALENDAR_TABLE_PAST  = "CT_HP_Mid_1_gvPastEvents"
CALENDAR_TABLE_NOW   = "CT_HP_Mid_1_gvCurrentUpcomingEvents"

# Competition level configs keyed by division label
# competition_level_id: the drpCompetitionLevelId value for the search form
DIVISION_CONFIG = {
    "Club-Men":          {"competition_level_id": 21, "competition_level": "Club",    "gender": "Men"},
    "Club-Women":        {"competition_level_id": 22, "competition_level": "Club",    "gender": "Women"},
    "Club-Mixed":        {"competition_level_id": 7,  "competition_level": "Club",    "gender": "Mixed"},
    "College-Men":       {"competition_level_id": 27, "competition_level": "College", "gender": "Men"},
    "College-Women":     {"competition_level_id": 28, "competition_level": "College", "gender": "Women"},
    "Youth-U20-Boys-D1": {"competition_level_id": 23, "competition_level": "Youth",   "gender": "Men"},
    "Youth-U20-Girls":   {"competition_level_id": 24, "competition_level": "Youth",   "gender": "Women"},
    "Youth-U17-Boys":    {"competition_level_id": 25, "competition_level": "Youth",   "gender": "Men"},
    "Youth-U17-Girls":   {"competition_level_id": 26, "competition_level": "Youth",   "gender": "Women"},
    "Youth-U20-Mixed":   {"competition_level_id": 6,  "competition_level": "Youth",   "gender": "Mixed"},
}

ALL_DIVISIONS = list(DIVISION_CONFIG.keys())

# HTTP client settings
RATE_LIMIT_SECONDS = 3.0
RATE_LIMIT_JITTER = 1.0
REQUEST_TIMEOUT = 30
MAX_RETRIES = 3
RETRY_BACKOFF = [10, 30, 90]  # seconds between retries

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

# Schedule URL candidate matrix
# Gender and level segments vary by division and year — probe all combinations
GENDER_SEGMENTS = ["Men", "Women", "Mixed", "Boys", "Girls", "Open"]

LEVEL_SEGMENTS = [
    "Club",
    "College",
    "High-School",
    "Masters",
    "Grand-Masters",
    "Great-Grand-Masters",
    "Beach",
    "Middle-School",
    "Youth-Club-U-20",
    "Youth-Club-U-17",
    "Youth-U-20",
    "Youth-U-17",
]

# Soft-404 detection: site sometimes returns HTTP 200 with this text instead of a real 404
SLUG_NOT_FOUND_MARKER = "Sorry, the page you requested could not be found."
