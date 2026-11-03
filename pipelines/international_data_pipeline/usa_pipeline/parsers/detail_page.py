"""
Parser for USAU Team USA detail pages.

Results section
---------------
  div.results > div.game-list > div.game
    div.usa-score      → USA score
    div.opponent-score → opponent score
    div.round          → round name
    div.opponent.team  → opponent name

Roster section
--------------
  <table> immediately after the h4 "Roster" heading
    tr.player (no .staff class) → player: td.name, td.city ("City, ST")
    tr.player.staff             → staff:  td.name, td.team (role title)
    tr.staff-header             → separator row, skipped

Returns (games: list[dict], roster: list[dict])
"""
from __future__ import annotations

import logging
import re

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _split_city_state(city_str: str) -> tuple[str | None, str | None]:
    """Split 'Denver, CO' into ('Denver', 'CO'). Returns (None, None) if empty."""
    if not city_str:
        return None, None
    if "," in city_str:
        parts = city_str.split(",", 1)
        return parts[0].strip() or None, parts[1].strip() or None
    return city_str.strip() or None, None


# ---------------------------------------------------------------------------
# Results parsing
# ---------------------------------------------------------------------------

def parse_results(soup: BeautifulSoup) -> list[dict]:
    """
    Parse game results from div.results > div.game-list > div.game elements.
    """
    games: list[dict] = []
    for i, game_div in enumerate(soup.select("div.results div.game-list div.game")):
        usa_score_el = game_div.select_one("div.usa-score")
        opp_score_el = game_div.select_one("div.opponent-score")
        round_el     = game_div.select_one("div.round")
        opponent_el  = game_div.select_one("div.opponent.team")

        if not (usa_score_el and opp_score_el and opponent_el):
            logger.debug("Skipping malformed game div at index %d", i)
            continue

        try:
            usa_score = int(usa_score_el.get_text(strip=True))
            opp_score = int(opp_score_el.get_text(strip=True))
        except ValueError:
            logger.debug("Non-integer score in game div at index %d", i)
            continue

        games.append(
            {
                "game_order": i + 1,
                "round":      round_el.get_text(strip=True) if round_el else None,
                "opponent":   opponent_el.get_text(strip=True),
                "usa_score":  usa_score,
                "opp_score":  opp_score,
                "result":     "W" if usa_score > opp_score else "L",
            }
        )

    logger.debug("parse_results: %d game(s) found", len(games))
    return games


# ---------------------------------------------------------------------------
# Roster parsing
# ---------------------------------------------------------------------------

def parse_roster(soup: BeautifulSoup) -> list[dict]:
    """
    Locate the Roster table and return members with keys:
      name, city, state, role
    Players have role='player'; staff rows carry their specific role title.
    Extra columns (school, club team, etc.) are ignored.
    """
    header = None
    for tag in soup.find_all(["h3", "h4", "h5"]):
        if re.match(r"^Roster$", tag.get_text(strip=True), re.I):
            header = tag
            break

    if header is None:
        logger.debug("No Roster section found on detail page")
        return []

    table = header.find_next("table")
    if not table:
        logger.debug("No table found after Roster heading")
        return []

    members: list[dict] = []
    for tr in table.find_all("tr"):
        classes = set(tr.get("class") or [])

        # Skip the "Staff" separator header row and non-player rows (thead, etc.)
        if "staff-header" in classes or "player" not in classes:
            continue

        name_td = tr.find("td", class_="name")
        if not name_td:
            continue
        name = name_td.get_text(strip=True)
        if not name:
            continue

        if "staff" in classes:
            role_td = tr.find("td", class_="team")
            role = role_td.get_text(strip=True).lower() if role_td else "staff"
            members.append({"name": name, "city": None, "state": None, "role": role})
        else:
            city_td  = tr.find("td", class_="city")
            city_str = city_td.get_text(strip=True) if city_td else ""
            city, state = _split_city_state(city_str)
            members.append({"name": name, "city": city, "state": state, "role": "player"})

    logger.debug("parse_roster: %d member(s) found", len(members))
    return members


# ---------------------------------------------------------------------------
# Top-level entry point
# ---------------------------------------------------------------------------

def parse_detail_page(html: str) -> tuple[list[dict], list[dict]]:
    """
    Parse a Team USA detail page.

    Returns:
      (games, roster)  — both may be empty lists if the sections are absent.
    """
    soup = BeautifulSoup(html, "html.parser")
    games  = parse_results(soup)
    roster = parse_roster(soup)
    return games, roster
