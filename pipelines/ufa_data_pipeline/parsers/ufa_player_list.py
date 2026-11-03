"""
UFA Phase 1 — Player list page parser.

Parses one paginated page from https://watchufa.com/league/players?page={N}
and returns a list of player stub dicts.
"""
import logging
from typing import Optional
from urllib.parse import urlparse, parse_qs

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


def detect_last_page(html: str) -> Optional[int]:
    """
    Parse the last page number from the Drupal pager.
    Returns None if the pager is absent (single-page result).
    """
    soup = BeautifulSoup(html, "lxml")
    last_a = soup.select_one("li.pager-last a")
    if not last_a:
        # May also be encoded as 'Go to last page' title
        last_a = soup.select_one('a[title="Go to last page"]')
    if not last_a:
        return None
    href = last_a.get("href", "")
    qs = parse_qs(urlparse(href).query)
    page_vals = qs.get("page", [])
    if page_vals and page_vals[0].isdigit():
        return int(page_vals[0])
    return None


def parse_player_list_page(html: str) -> list[dict]:
    """
    Parse a single player-list page and return a list of player stub dicts.

    Each dict contains:
        player_slug, display_name, most_recent_team_name,
        most_recent_team_slug, most_recent_team_year
    """
    soup = BeautifulSoup(html, "lxml")
    rows = soup.select("table.views-table tbody tr")
    players = []

    for row in rows:
        name_td = row.select_one("td.views-field-field-player-display-name")
        team_td = row.select_one("td.views-field-field-team-display-name")

        if not name_td:
            continue

        name_a = name_td.select_one("a[href]")
        if not name_a:
            continue

        href = name_a.get("href", "")
        player_slug = href.rstrip("/").split("/")[-1]
        display_name = name_a.get_text(strip=True)

        if not player_slug or not display_name:
            continue

        team_text: Optional[str] = None
        team_slug: Optional[str] = None
        team_year: Optional[int] = None

        if team_td:
            team_a = team_td.select_one("a[href]")
            if team_a:
                team_text = team_a.get_text(strip=True)
                team_href = team_a.get("href", "")
                # href format: /{team_slug}/players/{player_slug}
                parts = team_href.strip("/").split("/")
                team_slug = parts[0] if parts else None
                if team_text and len(team_text) >= 4 and team_text[-4:].isdigit():
                    year_candidate = int(team_text[-4:])
                    if 2010 <= year_candidate <= 2050:
                        team_year = year_candidate

        players.append(
            {
                "player_slug": player_slug,
                "display_name": display_name,
                "most_recent_team_name": team_text,
                "most_recent_team_slug": team_slug,
                "most_recent_team_year": team_year,
            }
        )

    return players
