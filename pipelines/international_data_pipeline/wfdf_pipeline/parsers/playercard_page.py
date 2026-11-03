"""
Parser for WFDF results site — player card view.

Target URL pattern:
  https://results.wfdf.sport/{event-slug}/?view=playercard&series={series}&player={player_id}

Confirmed page structure (from live fetch):

Header
------
  # #33 TOBE DECRAENE
  Team: BEL O

Season aggregate stats table
-----------------------------
  header: Games | Assists | Goals | Tot. | Assist avg. | Goals avg. | Point avg. | Wins | Win-%
  row:      9   |   35    |  16   |  51  |    3.89     |    1.78    |    5.67    |  8   | 88.9%

(Per-game point events are also on this page but are already captured
by parse_game_points() in phase 3, so we do not re-store them here.)
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from bs4 import BeautifulSoup, Tag

logger = logging.getLogger(__name__)

_JERSEY_NAME_RE = re.compile(r"#\s*(\d+)\s+(.*)", re.S)
_PCT_RE         = re.compile(r"([\d.]+)\s*%")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clean(tag: Optional[Tag], default: str = "") -> str:
    return tag.get_text(" ", strip=True) if tag else default


def _float_or_none(s: str) -> Optional[float]:
    s = s.strip().rstrip("%")
    try:
        return float(s)
    except ValueError:
        return None


def _int_or_none(s: str) -> Optional[int]:
    m = re.search(r"\d+", s.strip())
    return int(m.group()) if m else None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_playercard(
    html: str,
    wfdf_player_id: int,
    series: int = 0,
) -> Optional[dict]:
    """
    Parse a player card page and return a season-stats dict.

    Returns None if the page does not contain usable stats.

    Dict keys match wfdf_player_season_stats columns:
      wfdf_player_id, series, player_name, jersey_number, team_name,
      games_played, assists, goals, total,
      assist_avg, goals_avg, point_avg, wins, win_pct
    """
    soup = BeautifulSoup(html, "html.parser")

    # -----------------------------------------------------------------------
    # Player identity — name and jersey from the page heading
    # -----------------------------------------------------------------------
    player_name:   str | None = None
    jersey_number: str | None = None
    team_name:     str | None = None

    # Heading is typically <h1> or <h2> matching "#33 TOBE DECRAENE"
    for heading in soup.find_all(["h1", "h2", "h3"]):
        text = heading.get_text(strip=True)
        m = _JERSEY_NAME_RE.match(text)
        if m:
            jersey_number = m.group(1)
            player_name   = m.group(2).strip().title()
            break

    # Team name — look for "Team: XXX" text or a dedicated element
    for el in soup.find_all(string=re.compile(r"team\s*:", re.I)):
        raw = el.strip()
        m = re.search(r"team\s*:\s*(.+)", raw, re.I)
        if m:
            team_name = m.group(1).strip()
            break
    if not team_name:
        team_el = soup.find(class_=re.compile(r"team.?name|club.?name", re.I))
        team_name = _clean(team_el) or None

    # -----------------------------------------------------------------------
    # Season stats table
    # -----------------------------------------------------------------------
    stats_table = None
    for table in soup.find_all("table"):
        header_row = table.find("tr")
        if not header_row:
            continue
        headers = [th.get_text(strip=True).lower() for th in header_row.find_all(["th", "td"])]
        if "games" in headers and "assists" in headers and "goals" in headers:
            stats_table = table
            break

    if not stats_table:
        logger.warning(
            "parse_playercard: no stats table found for player_id=%d", wfdf_player_id
        )
        return None

    header_row = stats_table.find("tr")
    headers    = [th.get_text(strip=True).lower() for th in header_row.find_all(["th", "td"])]
    idx        = {h: i for i, h in enumerate(headers)}

    i_games    = next((idx[k] for k in ("games", "gp", "g") if k in idx), 0)
    i_assists  = next((idx[k] for k in ("assists", "ast.", "ast") if k in idx), 1)
    i_goals    = next((idx[k] for k in ("goals",) if k in idx), 2)
    i_tot      = next((idx[k] for k in ("tot.", "tot", "total") if k in idx), 3)
    i_aavg     = next((idx[k] for k in ("assist avg.", "assist avg", "a avg") if k in idx), None)
    i_gavg     = next((idx[k] for k in ("goals avg.", "goals avg", "g avg") if k in idx), None)
    i_pavg     = next((idx[k] for k in ("point avg.", "point avg", "p avg") if k in idx), None)
    i_wins     = next((idx[k] for k in ("wins", "w") if k in idx), None)
    i_wpct     = next((idx[k] for k in ("win-%", "win-%", "win%", "win pct") if k in idx), None)

    # Take the first data row (aggregate for the season)
    data_rows = stats_table.find_all("tr")[1:]
    if not data_rows:
        logger.warning("parse_playercard: stats table has no data rows for player_id=%d", wfdf_player_id)
        return None

    cells = data_rows[0].find_all(["td", "th"])

    def cv(i) -> str:
        return _clean(cells[i]) if i is not None and i < len(cells) else ""

    win_pct_raw = cv(i_wpct)
    win_pct_m   = _PCT_RE.search(win_pct_raw)
    win_pct     = _float_or_none(win_pct_m.group(1)) if win_pct_m else _float_or_none(win_pct_raw)

    return {
        "wfdf_player_id": wfdf_player_id,
        "series":         series,
        "player_name":    player_name,
        "jersey_number":  jersey_number,
        "team_name":      team_name,
        "games_played":   _int_or_none(cv(i_games)),
        "assists":        _int_or_none(cv(i_assists)),
        "goals":          _int_or_none(cv(i_goals)),
        "total":          _int_or_none(cv(i_tot)),
        "assist_avg":     _float_or_none(cv(i_aavg)),
        "goals_avg":      _float_or_none(cv(i_gavg)),
        "point_avg":      _float_or_none(cv(i_pavg)),
        "wins":           _int_or_none(cv(i_wins)),
        "win_pct":        win_pct,
    }


def extract_player_ids_from_html(html: str) -> list[tuple[int, int]]:
    """
    Scan any rendered page (gameplay, standings, rosters) for playercard links
    and return a deduplicated list of (player_id, series) tuples.
    """
    soup    = BeautifulSoup(html, "html.parser")
    seen:   set[tuple[int, int]] = set()
    results: list[tuple[int, int]] = []

    for a in soup.find_all("a", href=True):
        href = a["href"]
        if "view=playercard" not in href:
            continue
        pm = re.search(r"[?&]player=(\d+)", href)
        sm = re.search(r"[?&]series=(\d+)", href)
        if pm:
            pair = (int(pm.group(1)), int(sm.group(1)) if sm else 0)
            if pair not in seen:
                seen.add(pair)
                results.append(pair)

    return results
