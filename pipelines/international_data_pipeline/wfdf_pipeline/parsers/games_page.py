"""
Parser for WFDF results site — games/schedule view.

Target URL pattern:
  https://results.wfdf.sport/{event-slug}/?view=games&filter=tournaments&group=all
  (optionally with &season={SEASON_KEY})

The page groups games by date. Each game card typically contains:
  - Date / timeslot header
  - Division label
  - Field name
  - Round (Pool play, Bracket, etc.)
  - Team A name  vs  Team B name
  - Score A  –  Score B
  - A link to the gameplay detail page (?view=gameplay&game={game_ref})

Because results.wfdf.sport is a JavaScript-rendered SPA the HTML passed here
is the *fully rendered* DOM obtained via Playwright (page.content()).
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from bs4 import BeautifulSoup, Tag

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clean(tag: Optional[Tag], default: str = "") -> str:
    return tag.get_text(" ", strip=True) if tag else default


def _parse_score(text: str) -> Optional[int]:
    m = re.search(r"\d+", text.strip())
    return int(m.group()) if m else None


def _extract_game_ref(el: Tag) -> Optional[int]:
    """Find a gameplay link inside a game card and return the numeric game ID."""
    for a in el.find_all("a", href=True):
        m = re.search(r"[?&]game=(\d+)", a["href"])
        if m:
            return int(m.group(1))
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_games_page(html: str, division_hint: str | None = None) -> list[dict]:
    """
    Parse the rendered games view and return a list of game dicts.

    Each dict has keys:
      game_date, timeslot, division, field, round,
      team_a, team_b, score_a, score_b, winner
    """
    soup = BeautifulSoup(html, "html.parser")
    games: list[dict] = []

    current_date: str | None = None
    current_timeslot: str | None = None

    # ------------------------------------------------------------------
    # Strategy 1: day-group containers  (div.day-group or similar)
    # ------------------------------------------------------------------
    day_groups = (
        soup.find_all("div", class_=re.compile(r"day.?group|date.?group", re.I))
        or soup.find_all("div", attrs={"data-date": True})
    )

    if day_groups:
        for day_div in day_groups:
            # Try to extract date from header or data attribute
            date_tag = (
                day_div.find(class_=re.compile(r"day.?header|date.?header", re.I))
                or day_div.find(["h2", "h3", "h4"], class_=re.compile(r"date|day", re.I))
            )
            current_date = _clean(date_tag) or day_div.get("data-date") or current_date

            for game in day_div.find_all(class_=re.compile(r"\bgame\b", re.I)):
                record = _extract_game(game, current_date, current_timeslot, division_hint)
                if record:
                    games.append(record)
        if games:
            return games

    # ------------------------------------------------------------------
    # Strategy 2: flat list of game cards  (any element with class "game")
    # ------------------------------------------------------------------
    for game in soup.find_all(class_=re.compile(r"\bgame\b", re.I)):
        # Look for a sibling/parent date header before this card
        prev = game.find_previous(class_=re.compile(r"day.?header|date.?header|schedule.?date", re.I))
        current_date = _clean(prev) if prev else current_date

        record = _extract_game(game, current_date, current_timeslot, division_hint)
        if record:
            games.append(record)
    if not games:
        logger.warning("parse_games_page: no game cards found — HTML structure may have changed.")

    return games


def _extract_game(
    game_el: Tag,
    date: str | None,
    timeslot: str | None,
    division_hint: str | None,
) -> dict | None:
    """
    Extract one game record from a game card element.
    Returns None if the element doesn't look like a real game.
    """
    # --- game_ref (numeric WFDF game ID from gameplay link) ---
    game_ref = _extract_game_ref(game_el)

    # --- Timeslot ---
    ts_el = game_el.find(class_=re.compile(r"timeslot|time", re.I))
    timeslot_val = _clean(ts_el) if ts_el else timeslot

    # --- Division ---
    div_el = game_el.find(class_=re.compile(r"division|category", re.I))
    division = _clean(div_el) or division_hint

    # --- Field ---
    field_el = game_el.find(class_=re.compile(r"\bfield\b", re.I))
    field = _clean(field_el) or None

    # --- Round ---
    round_el = game_el.find(class_=re.compile(r"\ground\b|bracket|pool", re.I))
    round_val = _clean(round_el) or None

    # --- Teams & Scores ---
    team_els = (
        game_el.find_all(class_=re.compile(r"\bteam\b", re.I))
        or game_el.find_all(class_=re.compile(r"competitor|participant", re.I))
    )

    if len(team_els) < 2:
        return None

    team_a_el, team_b_el = team_els[0], team_els[1]

    name_a_el = team_a_el.find(class_=re.compile(r"name|title", re.I)) or team_a_el
    name_b_el = team_b_el.find(class_=re.compile(r"name|title", re.I)) or team_b_el
    team_a = _clean(name_a_el)
    team_b = _clean(name_b_el)

    if not team_a or not team_b:
        return None

    score_a_el = team_a_el.find(class_=re.compile(r"score|result|point", re.I))
    score_b_el = team_b_el.find(class_=re.compile(r"score|result|point", re.I))

    if not (score_a_el and score_b_el):
        score_els = game_el.find_all(class_=re.compile(r"\bscore\b", re.I))
        if len(score_els) >= 2:
            score_a_el, score_b_el = score_els[0], score_els[1]

    score_a = _parse_score(_clean(score_a_el)) if score_a_el else None
    score_b = _parse_score(_clean(score_b_el)) if score_b_el else None

    winner: str | None = None
    if score_a is not None and score_b is not None:
        winner = team_a if score_a > score_b else (team_b if score_b > score_a else None)

    return {
        "game_ref":  game_ref,
        "game_date": date,
        "timeslot":  timeslot_val,
        "division":  division,
        "field":     field,
        "round":     round_val,
        "team_a":    team_a,
        "team_b":    team_b,
        "score_a":   score_a,
        "score_b":   score_b,
        "winner":    winner,
    }
