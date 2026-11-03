"""
UFA Phase 2 — Player profile page parser.

Parses https://watchufa.com/league/players/{player_slug} and returns:
  - profile dict (top-level player data)
  - list of stat row dicts (regular season + playoffs)
"""
import logging
from typing import Optional

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

# Column index → DB field name (0-based, after the Year-Team column at index 0)
_STAT_COLUMNS = [
    None,                       # 0: Year - Team (handled separately)
    "games",                    # 1
    "points_played",            # 2
    "minutes",                  # 3
    "assists",                  # 4
    "goals",                    # 5
    "blocks",                   # 6
    "plus_minus",               # 7
    "completions",              # 8
    "completion_pct",           # 9
    "throw_yards",              # 10
    "receive_yards",            # 11
    "hockey_assists",           # 12
    "turnovers",                # 13
    "stalls",                   # 14
    "drops",                    # 15
    "callahans",                # 16
    "hucks",                    # 17
    "huck_pct",                 # 18
    "offensive_points_played",  # 19
    "defensive_points_played",  # 20
    "pulls",                    # 21
    "pull_pct",                 # 22
    "points_per_hour",          # 23
]

_FLOAT_FIELDS = {"completion_pct", "huck_pct", "pull_pct", "points_per_hour"}


def _parse_stat(text: str) -> Optional[float | int]:
    t = (text or "").strip()
    if t in ("--", "", "N/A"):
        return None
    try:
        if "." in t:
            return float(t)
        return int(t)
    except ValueError:
        return None


def _parse_year_team(text: str) -> tuple[Optional[int], Optional[str], bool]:
    """
    '2017 - PIT' → (2017, 'PIT', False)
    'Career'     → (None, None, True)
    """
    t = (text or "").strip()
    if t.lower() == "career":
        return None, None, True
    parts = t.split(" - ", 1)
    try:
        year = int(parts[0].strip())
    except (ValueError, IndexError):
        year = None
    team_abbr = parts[1].strip() if len(parts) > 1 else None
    return year, team_abbr, False


def _text_or_none(element, selector: str) -> Optional[str]:
    el = element.select_one(selector)
    if not el:
        return None
    t = el.get_text(strip=True)
    return t if t else None


def _img_src(element, selector: str) -> Optional[str]:
    img = element.select_one(selector)
    if img and img.get("src"):
        return img["src"]
    return None


def parse_player_profile(html: str, player_slug: str, scraped_at: str) -> tuple[Optional[dict], list[dict]]:
    """
    Parse the player profile page.

    Returns:
        (profile_dict, stat_rows)
        profile_dict is None if no player box was found (parse failure).
        stat_rows may be empty if the player has no recorded stats.
    """
    soup = BeautifulSoup(html, "lxml")

    # --- Profile block ---------------------------------------------------
    box = soup.find("div", class_="audl-player-box")
    if not box:
        logger.warning("No audl-player-box found for %s", player_slug)
        return None, []

    team_classes = [c for c in box.get("class", []) if c != "audl-player-box"]
    team_slug = team_classes[0] if team_classes else None

    raw_jersey = _text_or_none(box, ".audl-player-jersey-number")
    jersey = raw_jersey.lstrip("#").strip() if raw_jersey else None

    profile = {
        "player_slug": player_slug,
        "display_name": _text_or_none(box, ".audl-player-display-name") or player_slug,
        "current_team_name": _text_or_none(box, ".audl-player-current-team-position"),
        "current_team_slug": team_slug,
        "jersey_number": jersey,
        "photo_url": _img_src(box, ".audl-player-profile-image img"),
        "bio_text": _text_or_none(box, ".audl-player-bio"),
        "scraped_at": scraped_at,
    }

    # --- Stats tables ----------------------------------------------------
    stat_tables = soup.select("#web-panel-player-stats .svelte-player-stats-table table")
    season_type_map = {0: "regular", 1: "playoffs"}
    stat_rows: list[dict] = []

    for table_idx, table in enumerate(stat_tables):
        season_type = season_type_map.get(table_idx, "regular")
        tbody = table.find("tbody")
        if not tbody:
            continue

        for row in tbody.find_all("tr"):
            cells = row.find_all("td")
            if not cells:
                continue

            # Career row detection: first td has style='text-align: center'
            first_td = cells[0]
            cell_style = first_td.get("style", "")
            is_career_by_style = "text-align: center" in cell_style
            year, team_abbr, is_career_by_text = _parse_year_team(first_td.get_text())
            is_career = is_career_by_style or is_career_by_text

            stat: dict = {
                "player_slug": player_slug,
                "season_type": season_type,
                "is_career_total": 1 if is_career else 0,
                "season_year": year,
                "team_abbr": team_abbr,
                "scraped_at": scraped_at,
            }

            for col_idx, field in enumerate(_STAT_COLUMNS[1:], start=1):
                if col_idx >= len(cells):
                    stat[field] = None
                    continue
                stat[field] = _parse_stat(cells[col_idx].get_text())

            stat_rows.append(stat)

    return profile, stat_rows
