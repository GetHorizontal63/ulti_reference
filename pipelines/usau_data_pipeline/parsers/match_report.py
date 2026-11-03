"""
Phase 5 parser: USAU match report page.

Parses per-game individual player stats from
https://play.usaultimate.org/teams/events/match_report/?EventGameId={token}

Public API
----------
parse_match_report(html, event_game_id, scraped_at) -> dict
  Returns:
    {
      "meta":       { numeric_game_id, numeric_home_team_id, numeric_away_team_id,
                      game_status, home_score, away_score },
      "home_stats": [ stat_dict, ... ],
      "away_stats": [ stat_dict, ... ],
    }

Each stat_dict contains:
    event_game_id, event_team_id (None — filled by caller),
    numeric_team_id (None — filled by caller),
    player_name, jersey_number, goals, assists, ds, turns, scraped_at
"""
import logging
from typing import Optional

from bs4 import BeautifulSoup, Tag

logger = logging.getLogger(__name__)


def parse_match_report(html: str, event_game_id: str, scraped_at: str) -> dict:
    soup = BeautifulSoup(html, "lxml")
    result: dict = {"meta": {}, "home_stats": [], "away_stats": []}

    # ------------------------------------------------------------------
    # Hidden inputs — numeric IDs
    # ------------------------------------------------------------------
    meta: dict = {}
    for input_id, field in (
        ("hdnEventGameId",          "numeric_game_id"),
        ("hdnHomeTeamEventTeamId",  "numeric_home_team_id"),
        ("hdnAwayTeamEventTeamId",  "numeric_away_team_id"),
    ):
        el = soup.find("input", id=input_id)
        if el and el.get("value", "").strip():
            try:
                meta[field] = int(el["value"])
            except ValueError:
                meta[field] = None

    # Game status
    status_div = soup.select_one("div#CT_Main_0_upMatchReport > div > p")
    if status_div:
        meta["game_status"] = status_div.get_text(strip=True)

    # Scores
    for span_id, key in (
        ("CT_Main_0_lblHomeScore", "home_score"),
        ("CT_Main_0_lblAwayScore", "away_score"),
    ):
        el = soup.find(id=span_id)
        if el:
            meta[key] = el.get_text(strip=True)

    result["meta"] = meta

    # ------------------------------------------------------------------
    # Per-team stats tables
    # ------------------------------------------------------------------
    home_table = soup.find("table", id="CT_Main_0_gvHomeList")
    away_table = soup.find("table", id="CT_Main_0_gvAwayList")

    if home_table:
        result["home_stats"] = _parse_stats_table(home_table, event_game_id, scraped_at)
    if away_table:
        result["away_stats"] = _parse_stats_table(away_table, event_game_id, scraped_at)

    return result


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _parse_stats_table(table: Tag, event_game_id: str, scraped_at: str) -> list:
    stats = []
    tbody = table.find("tbody") or table

    for row in tbody.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 5:
            continue

        raw_name = cells[0].get_text(strip=True)
        # Format: "#02 Isaac Lee" or "#0 Jeremy Langdon"
        jersey: Optional[str] = None
        name = raw_name
        if raw_name.startswith("#"):
            parts = raw_name.split(" ", 1)
            jersey = parts[0].lstrip("#")
            name   = parts[1].strip() if len(parts) > 1 else raw_name

        def stat(idx: int) -> Optional[int]:
            if idx >= len(cells):
                return None
            t = cells[idx].get_text(strip=True)
            return int(t) if t.isdigit() else None

        stats.append({
            "event_game_id":  event_game_id,
            "event_team_id":  None,         # filled by phase5 pipeline
            "numeric_team_id": None,        # filled by phase5 pipeline
            "player_name":    name,
            "jersey_number":  jersey,
            "goals":          stat(1),
            "assists":        stat(2),
            "ds":             stat(3),
            "turns":          stat(4),
            "scraped_at":     scraped_at,
        })

    return stats
