"""
Parser for WFDF results site — teams / standings view.

Target URL pattern:
  https://results.wfdf.sport/{event-slug}/?view=teams&list=bystandings&goindex=1
  (optionally with &season={SEASON_KEY})

The standings page shows a table (or card list) with:
  - Placement / rank
  - Team name
  - Country flag / code
  - Wins / Losses  (sometimes Win %, point differential)

The rosters view (?list=byrosters) nests player rows under each team.

Because results.wfdf.sport is a JavaScript-rendered SPA the HTML passed here
is the *fully rendered* DOM obtained via Playwright (page.content()).
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from bs4 import BeautifulSoup, Tag

logger = logging.getLogger(__name__)

_PLAYER_ID_RE = re.compile(r"[?&]player=(\d+)")
_SERIES_RE    = re.compile(r"[?&]series=(\d+)")


def _player_id_from_tag(tag: Tag) -> tuple[int | None, int]:
    """Extract (player_id, series) from a playercard link inside a tag."""
    for a in tag.find_all("a", href=True):
        href = a["href"]
        pm = _PLAYER_ID_RE.search(href)
        sm = _SERIES_RE.search(href)
        if pm:
            return int(pm.group(1)), int(sm.group(1)) if sm else 0
    return None, 0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clean(tag: Optional[Tag], default: str = "") -> str:
    return tag.get_text(" ", strip=True) if tag else default


def _int_or_none(text: str) -> Optional[int]:
    m = re.search(r"-?\d+", text.strip())
    return int(m.group()) if m else None


# ---------------------------------------------------------------------------
# Standings parser
# ---------------------------------------------------------------------------

def parse_standings_page(html: str, division_hint: str | None = None) -> list[dict]:
    """
    Parse the standings view and return a list of standing dicts.

    Each dict has keys:
      division, placement, team_name, country, wins, losses, point_diff
    """
    soup = BeautifulSoup(html, "html.parser")
    results: list[dict] = []

    # ------------------------------------------------------------------
    # Strategy 1: <table> with thead columns
    # ------------------------------------------------------------------
    for table in soup.find_all("table"):
        thead = table.find("thead")
        if not thead:
            continue

        headers = [th.get_text(strip=True).lower() for th in thead.find_all(["th", "td"])]
        # Require at least a team/name column to consider this table
        if not any(k in headers for k in ("team", "name", "club")):
            continue

        # Map column indices
        idx = {h: i for i, h in enumerate(headers)}
        col_team   = next((idx[k] for k in ("team", "name", "club") if k in idx), None)
        col_place  = next((idx[k] for k in ("#", "place", "rank", "placement", "pos") if k in idx), None)
        col_wins   = next((idx[k] for k in ("w", "wins", "won") if k in idx), None)
        col_losses = next((idx[k] for k in ("l", "losses", "lost") if k in idx), None)
        col_diff   = next((idx[k] for k in ("+/-", "diff", "point diff", "pd") if k in idx), None)
        col_ctry   = next((idx[k] for k in ("country", "nat", "flag") if k in idx), None)

        tbody = table.find("tbody") or table
        for tr in tbody.find_all("tr"):
            tds = tr.find_all(["td", "th"])
            if len(tds) < 2:
                continue

            def cell(i):
                return _clean(tds[i]) if i is not None and i < len(tds) else None

            team_name = cell(col_team)
            if not team_name:
                continue

            placement_raw = cell(col_place)
            placement = _int_or_none(placement_raw) if placement_raw else None
            if placement is None and results:
                placement = len(results) + 1

            results.append({
                "division":   division_hint,
                "placement":  placement,
                "team_name":  team_name,
                "country":    cell(col_ctry),
                "wins":       _int_or_none(cell(col_wins) or ""),
                "losses":     _int_or_none(cell(col_losses) or ""),
                "point_diff": _int_or_none(cell(col_diff) or ""),
            })

        if results:
            return results

    # ------------------------------------------------------------------
    # Strategy 2: standing cards / rows (no table)
    # ------------------------------------------------------------------
    for i, card in enumerate(
        soup.find_all(class_=re.compile(r"standing|team.?row|placement", re.I)), start=1
    ):
        name_el  = card.find(class_=re.compile(r"name|title|team", re.I))
        place_el = card.find(class_=re.compile(r"place|rank|position|number", re.I))
        ctry_el  = card.find(class_=re.compile(r"country|flag|nat", re.I))
        wins_el  = card.find(class_=re.compile(r"\bwins?\b|\bwon\b", re.I))
        loss_el  = card.find(class_=re.compile(r"\blosses?\b|\blost\b", re.I))
        diff_el  = card.find(class_=re.compile(r"diff|point.diff|\+/-", re.I))

        team_name = _clean(name_el)
        if not team_name:
            continue

        place_raw = _clean(place_el)
        placement = _int_or_none(place_raw) if place_raw else i

        results.append({
            "division":   division_hint,
            "placement":  placement,
            "team_name":  team_name,
            "country":    _clean(ctry_el) or None,
            "wins":       _int_or_none(_clean(wins_el)) if wins_el else None,
            "losses":     _int_or_none(_clean(loss_el)) if loss_el else None,
            "point_diff": _int_or_none(_clean(diff_el)) if diff_el else None,
        })

    if not results:
        logger.warning("parse_standings_page: no standings found — HTML structure may have changed.")

    return results


# ---------------------------------------------------------------------------
# Rosters parser
# ---------------------------------------------------------------------------

def parse_rosters_page(html: str, division_hint: str | None = None) -> list[dict]:
    """
    Parse the rosters view and return a list of player dicts.

    Each dict has keys:
      team_name, division, player_name, jersey_number, country
    """
    soup = BeautifulSoup(html, "html.parser")
    players: list[dict] = []

    current_team: str | None = None
    current_country: str | None = None

    # ------------------------------------------------------------------
    # Strategy 1: team-block containers each holding a player list
    # ------------------------------------------------------------------
    team_blocks = soup.find_all(class_=re.compile(r"team.?block|team.?section|roster.?team", re.I))

    if team_blocks:
        for block in team_blocks:
            name_el = block.find(class_=re.compile(r"team.?name|club.?name|title", re.I))
            current_team = _clean(name_el) or current_team
            ctry_el = block.find(class_=re.compile(r"country|flag|nat", re.I))
            current_country = _clean(ctry_el) or current_country

            for row in block.find_all(class_=re.compile(r"\bplayer\b|athlete|member", re.I)):
                player = _extract_player(row, current_team, current_country, division_hint)
                if player:
                    players.append(player)

        if players:
            return players

    # ------------------------------------------------------------------
    # Strategy 2: table rows grouped under team header rows
    # ------------------------------------------------------------------
    for table in soup.find_all("table"):
        for tr in table.find_all("tr"):
            # Detect team header row (colspan, or specific class)
            tds = tr.find_all(["td", "th"])
            if len(tds) == 1 or tr.get("class") and re.search(r"header|team", " ".join(tr.get("class", []))):
                name_candidate = _clean(tds[0]) if tds else ""
                if name_candidate:
                    current_team = name_candidate
                continue

            player_name_el = tds[0] if tds else None
            jersey_el      = next((td for td in tds if re.search(r"^\d+$", _clean(td))), None)
            ctry_el        = next(
                (td for td in tds if td.find(class_=re.compile(r"flag|country|nat", re.I))), None
            )

            player_name = _clean(player_name_el)
            if not player_name or player_name == current_team:
                continue

            player_id, _ = _player_id_from_tag(tds[0]) if tds else (None, None)

            players.append({
                "wfdf_player_id": player_id,
                "team_name":     current_team,
                "division":      division_hint,
                "player_name":   player_name,
                "jersey_number": _clean(jersey_el) or None,
                "country":       _clean(ctry_el) or current_country,
            })

    if not players:
        logger.warning("parse_rosters_page: no roster entries found — HTML structure may have changed.")

    return players


def _extract_player(
    el: Tag,
    team: str | None,
    country: str | None,
    division: str | None,
) -> dict | None:
    name_el    = el.find(class_=re.compile(r"name|player.?name", re.I)) or el
    num_el     = el.find(class_=re.compile(r"number|jersey|shirt", re.I))
    ctry_el    = el.find(class_=re.compile(r"country|flag|nat", re.I))

    player_name = _clean(name_el)
    if not player_name:
        return None

    player_id, _ = _player_id_from_tag(el)

    return {
        "wfdf_player_id": player_id,
        "team_name":      team,
        "division":       division,
        "player_name":    player_name,
        "jersey_number":  _clean(num_el) or None,
        "country":        _clean(ctry_el) or country,
    }
