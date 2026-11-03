"""
Parser for WFDF results site — gameplay detail view.

Target URL pattern:
  https://results.wfdf.sport/{event-slug}/?view=gameplay&game={game_id}

Confirmed page structure (from live fetch):

Game stats table
----------------
  <table>  (first data table after the heading)
    rows: stat label | team_a value | team_b value
  e.g.
    Goals:                          6            15
    Time on offence:          44.25 min (73.2 %)   16.15 min (26.8 %)
    Goals from starting on offence: 6/14 (42.9 %)   7/7 (100.0 %)
    Goals from turnovers:           0            8
    Time-outs:                      1            0
    Spirit points:             11 (2+2+2+3+2)   11 (2+2+3+2+2)

Per-team player stats
---------------------
  Team name heading, then <table>
    header: # | Name | Ast. | Goals | Tot.
    rows: jersey | name (with optional playercard link) | assists | goals | total

Point-by-point log
------------------
  <table> with header: Scores | Assist | Goal | Time | Dur. | Game events
    row:  "0 - 1" | "#3 Tomas Hlubocky" | "#21 Jakub Ježek" | 1.00 | 1.00 | Offence 0.00
    special row: "Half-time" colspan (is_halftime=1)

Because results.wfdf.sport is JS-rendered the HTML here is from Playwright.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from bs4 import BeautifulSoup, Tag

logger = logging.getLogger(__name__)

_SCORE_RE    = re.compile(r"(\d+)\s*[-–]\s*(\d+)")
_TIME_RE     = re.compile(r"(\d+(?:\.\d+)?)\s*min")
_PCT_RE      = re.compile(r"\((\d+(?:\.\d+)?)\s*%\)")
_FRAC_RE     = re.compile(r"(\d+)/(\d+)")
_JERSEY_RE   = re.compile(r"#(\d+)\s+(.*)")
_SPIRIT_RE   = re.compile(r"(\d+)\s*\(([0-9+]+)\)")
_PLAYER_ID_RE = re.compile(r"[?&]player=(\d+)")
_SERIES_RE   = re.compile(r"[?&]series=(\d+)")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clean(tag: Optional[Tag], default: str = "") -> str:
    return tag.get_text(" ", strip=True) if tag else default


def _float_or_none(s: str) -> Optional[float]:
    try:
        return float(s.strip())
    except (ValueError, AttributeError):
        return None


def _int_or_none(s: str) -> Optional[int]:
    m = re.search(r"-?\d+", s.strip())
    return int(m.group()) if m else None


def _parse_jersey_name(cell_text: str) -> tuple[Optional[str], str]:
    """'#3 Tomas Hlubocky' → ('3', 'Tomas Hlubocky')"""
    m = _JERSEY_RE.match(cell_text.strip())
    if m:
        return m.group(1), m.group(2).strip()
    return None, cell_text.strip()


def _player_id_from_tag(tag: Tag) -> tuple[Optional[int], Optional[int]]:
    """Extract (player_id, series) from a playercard link inside a tag."""
    for a in tag.find_all("a", href=True):
        href = a["href"]
        pm = _PLAYER_ID_RE.search(href)
        sm = _SERIES_RE.search(href)
        if pm:
            return int(pm.group(1)), int(sm.group(1)) if sm else 0
    return None, None


# ---------------------------------------------------------------------------
# Game stats parser
# ---------------------------------------------------------------------------

def parse_game_stats(html: str) -> tuple[str | None, str | None, list[dict]]:
    """
    Parse the team-level statistics block.

    Returns:
      (team_a_name, team_b_name, stats_rows)

    Each stats_row dict has keys matching wfdf_game_stats columns.
    """
    soup  = BeautifulSoup(html, "html.parser")
    stats = []

    # Find the stats table: look for a <table> whose first row has 3 cells
    # and whose first cell is empty (label | team_a | team_b)
    stats_table = None
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        first_cells = rows[0].find_all(["th", "td"])
        if len(first_cells) == 3:
            stats_table = table
            break

    if not stats_table:
        logger.warning("parse_game_stats: could not locate stats table")
        return None, None, []

    rows     = stats_table.find_all("tr")
    header   = rows[0].find_all(["th", "td"])
    team_a   = _clean(header[1]) if len(header) > 1 else None
    team_b   = _clean(header[2]) if len(header) > 2 else None

    # Collect raw stat values keyed by label
    raw: dict[str, tuple[str, str]] = {}
    for tr in rows[1:]:
        cells = tr.find_all(["td", "th"])
        if len(cells) < 3:
            continue
        label = cells[0].get_text(strip=True).lower().rstrip(":")
        raw[label] = (_clean(cells[1]), _clean(cells[2]))

    def _build_team_row(team_name: str, col: int) -> dict:
        def v(key):
            pair = raw.get(key, ("", ""))
            return pair[col]

        goals_raw  = v("goals")
        off_raw    = v("time on offence")
        def_raw    = v("time on defence")
        off_g_raw  = v("goals from starting on offence")
        def_g_raw  = v("goals from starting on defence")
        turn_raw   = v("goals from turnovers")
        to_raw     = v("time-outs")
        spirit_raw = v("spirit points")

        # Parse time fields  "44.25 min (73.2 %)"
        off_min  = _float_or_none(_TIME_RE.search(off_raw).group(1)) if _TIME_RE.search(off_raw) else None
        off_pct  = _float_or_none(_PCT_RE.search(off_raw).group(1))  if _PCT_RE.search(off_raw)  else None
        def_min  = _float_or_none(_TIME_RE.search(def_raw).group(1)) if _TIME_RE.search(def_raw) else None
        def_pct  = _float_or_none(_PCT_RE.search(def_raw).group(1))  if _PCT_RE.search(def_raw)  else None

        # Parse fraction fields  "6/14 (42.9 %)"
        off_g_m  = _FRAC_RE.search(off_g_raw)
        def_g_m  = _FRAC_RE.search(def_g_raw)

        # Spirit: "11 (2+2+2+3+2)"
        spirit_m    = _SPIRIT_RE.search(spirit_raw)
        spirit_pts  = int(spirit_m.group(1))        if spirit_m else _int_or_none(spirit_raw)
        spirit_brkd = spirit_m.group(2)             if spirit_m else None

        return {
            "team_name":                 team_name,
            "goals":                     _int_or_none(goals_raw),
            "time_on_offence_min":       off_min,
            "time_on_offence_pct":       off_pct,
            "time_on_defence_min":       def_min,
            "time_on_defence_pct":       def_pct,
            "goals_from_offence_made":   int(off_g_m.group(1)) if off_g_m else None,
            "goals_from_offence_total":  int(off_g_m.group(2)) if off_g_m else None,
            "goals_from_defence_made":   int(def_g_m.group(1)) if def_g_m else None,
            "goals_from_defence_total":  int(def_g_m.group(2)) if def_g_m else None,
            "goals_from_turnovers":      _int_or_none(turn_raw),
            "timeouts":                  _int_or_none(to_raw),
            "spirit_points":             spirit_pts,
            "spirit_breakdown":          spirit_brkd,
        }

    if team_a:
        stats.append(_build_team_row(team_a, 0))
    if team_b:
        stats.append(_build_team_row(team_b, 1))

    return team_a, team_b, stats


# ---------------------------------------------------------------------------
# Per-team player stats parser
# ---------------------------------------------------------------------------

def parse_game_player_stats(html: str) -> list[dict]:
    """
    Parse each team's player stats table from the gameplay page.

    Returns list of dicts with keys:
      team_name, jersey_number, player_name, wfdf_player_id, assists, goals, total
    """
    soup    = BeautifulSoup(html, "html.parser")
    players: list[dict] = []

    # Look for tables whose header is: # | Name | Ast. | Goals | Tot.
    for table in soup.find_all("table"):
        thead = table.find("thead") or table
        header_row = thead.find("tr")
        if not header_row:
            continue
        headers = [th.get_text(strip=True).lower() for th in header_row.find_all(["th", "td"])]
        if "name" not in headers or "goals" not in headers:
            continue

        # Find team name from the preceding heading sibling
        team_name: str | None = None
        prev = table.find_previous(["h2", "h3", "h4", "strong", "b"])
        if prev:
            team_name = prev.get_text(strip=True) or None

        idx = {h: i for i, h in enumerate(headers)}
        i_num   = next((idx[k] for k in ("#", "no", "nr", "num") if k in idx), 0)
        i_name  = idx.get("name", 1)
        i_ast   = next((idx[k] for k in ("ast.", "ast", "assists", "a") if k in idx), None)
        i_goals = next((idx[k] for k in ("goals", "g") if k in idx), None)
        i_tot   = next((idx[k] for k in ("tot.", "tot", "total", "pts") if k in idx), None)

        tbody = table.find("tbody") or table
        for tr in tbody.find_all("tr"):
            cells = tr.find_all(["td", "th"])
            if len(cells) < 2:
                continue

            def cell_text(i):
                return _clean(cells[i]) if i is not None and i < len(cells) else ""

            player_name = cell_text(i_name)
            if not player_name or player_name.lower() in ("name",):
                continue

            # Try to pull player_id from a link in the name cell
            player_id, _ = _player_id_from_tag(cells[i_name]) if i_name < len(cells) else (None, None)

            players.append({
                "team_name":     team_name,
                "jersey_number": cell_text(i_num) or None,
                "player_name":   player_name,
                "wfdf_player_id": player_id,
                "assists":       _int_or_none(cell_text(i_ast)),
                "goals":         _int_or_none(cell_text(i_goals)),
                "total":         _int_or_none(cell_text(i_tot)),
            })

    if not players:
        logger.warning("parse_game_player_stats: no player stat rows found")

    return players


# ---------------------------------------------------------------------------
# Point-by-point log parser
# ---------------------------------------------------------------------------

def parse_game_points(html: str) -> list[dict]:
    """
    Parse the point-by-point game history table.

    Expected header: Scores | Assist | Goal | Time | Dur. | Game events

    Returns list of dicts with keys:
      point_number, score_a, score_b, assister_jersey, assister_name,
      scorer_jersey, scorer_name, time_elapsed, point_duration,
      game_event, is_halftime
    """
    soup   = BeautifulSoup(html, "html.parser")
    points: list[dict] = []

    # Find the table with a "Scores" column
    points_table = None
    for table in soup.find_all("table"):
        header_row = table.find("tr")
        if not header_row:
            continue
        headers = [th.get_text(strip=True).lower() for th in header_row.find_all(["th", "td"])]
        if "scores" in headers and ("assist" in headers or "goal" in headers):
            points_table = table
            break

    if not points_table:
        logger.warning("parse_game_points: could not locate point-log table")
        return []

    header_row = points_table.find("tr")
    headers    = [th.get_text(strip=True).lower() for th in header_row.find_all(["th", "td"])]
    idx        = {h: i for i, h in enumerate(headers)}

    i_scores = idx.get("scores", 0)
    i_assist = next((idx[k] for k in ("assist", "passer") if k in idx), 1)
    i_goal   = next((idx[k] for k in ("goal", "scorer")   if k in idx), 2)
    i_time   = next((idx[k] for k in ("time", "t")        if k in idx), 3)
    i_dur    = next((idx[k] for k in ("dur.", "dur", "duration") if k in idx), 4)
    i_event  = next((idx[k] for k in ("game events", "events") if k in idx), None)

    point_number = 0
    for tr in points_table.find_all("tr")[1:]:
        cells = tr.find_all(["td", "th"])
        if not cells:
            continue

        def cell_text(i):
            return _clean(cells[i]) if i is not None and i < len(cells) else ""

        scores_raw = cell_text(i_scores)

        # Halftime separator row
        if re.search(r"half.?time|halftime", scores_raw, re.I) or (
            len(cells) == 1 and re.search(r"half", cells[0].get_text(), re.I)
        ):
            points.append({
                "point_number":   None,
                "score_a":        None,
                "score_b":        None,
                "assister_jersey": None,
                "assister_name":  None,
                "scorer_jersey":  None,
                "scorer_name":    None,
                "time_elapsed":   None,
                "point_duration": None,
                "game_event":     None,
                "is_halftime":    1,
            })
            continue

        score_m = _SCORE_RE.search(scores_raw)
        if not score_m:
            continue

        point_number += 1
        score_a = int(score_m.group(1))
        score_b = int(score_m.group(2))

        assist_jersey, assist_name = _parse_jersey_name(cell_text(i_assist))
        scorer_jersey, scorer_name = _parse_jersey_name(cell_text(i_goal))

        # Extract player IDs from links inside the assist/goal cells
        assist_pid, _ = _player_id_from_tag(cells[i_assist]) if i_assist < len(cells) else (None, None)
        scorer_pid, _ = _player_id_from_tag(cells[i_goal])   if i_goal   < len(cells) else (None, None)

        points.append({
            "point_number":      point_number,
            "score_a":           score_a,
            "score_b":           score_b,
            "assister_player_id": assist_pid,
            "assister_jersey":   assist_jersey,
            "assister_name":     assist_name,
            "scorer_player_id":  scorer_pid,
            "scorer_jersey":     scorer_jersey,
            "scorer_name":       scorer_name,
            "time_elapsed":      cell_text(i_time) or None,
            "point_duration":    cell_text(i_dur)  or None,
            "game_event":        cell_text(i_event) if i_event is not None else None,
            "is_halftime":       0,
        })

    logger.info("parse_game_points: %d point(s) parsed", point_number)
    return points
