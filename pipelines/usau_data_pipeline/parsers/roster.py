"""
Phase 4 parser: USAU event team roster page.

Parses team metadata, coach list, and player roster from
https://play.usaultimate.org/events/teams/?EventTeamId={token}

Public API
----------
parse_roster_page(html, event_team_id, event_slug, scraped_at) -> dict
  Returns:
    {
      "team_meta": { team_name, city, state, competition_level, gender_division },
      "coaches":   [ { event_team_id, coach_name, is_head_coach }, ... ],
      "players":   [ { event_team_id, event_slug, player_name, jersey_number,
                       pronouns, position, height,
                       tournament_goals, tournament_assists,
                       tournament_ds, tournament_turns, scraped_at }, ... ],
    }
"""
import logging
from typing import Optional

from bs4 import BeautifulSoup, NavigableString, Tag

logger = logging.getLogger(__name__)


def parse_roster_page(
    html: str,
    event_team_id: str,
    event_slug: str,
    scraped_at: str,
) -> dict:
    soup = BeautifulSoup(html, "lxml")
    result: dict = {"team_meta": {}, "coaches": [], "players": []}

    # ------------------------------------------------------------------
    # Team metadata
    # ------------------------------------------------------------------
    meta: dict = {}

    profile = soup.find("div", class_="profile_area")
    if profile:
        h4 = profile.find("h4")
        if h4:
            meta["team_name"] = h4.get_text(strip=True)

    def _dl_dd(dl_id: str) -> Optional[str]:
        el = soup.find(id=dl_id)
        if not el:
            return None
        dd = el.find("dd")
        return dd.get_text(strip=True) if dd else None

    # city is a <p> tag (not a <dl>/<dd>), so read it directly
    city_el = soup.find(id="CT_Main_0_ucTeamDetails_dlCity")
    loc = city_el.get_text(strip=True) if city_el else None
    if loc:
        if "," in loc:
            parts = loc.split(",", 1)
            meta["city"]  = parts[0].strip() or None
            meta["state"] = parts[1].strip() or None
        else:
            meta["city"] = loc

    meta["competition_level"] = _dl_dd("CT_Main_0_ucTeamDetails_dlCompetitionLevel")
    meta["gender_division"]   = _dl_dd("CT_Main_0_ucTeamDetails_dlGenderDivision")

    result["team_meta"] = meta

    # ------------------------------------------------------------------
    # Coaches
    # ------------------------------------------------------------------
    coach_dl = soup.find(id="CT_Main_0_ucTeamDetails_dlHeadCoach")
    if coach_dl:
        dd = coach_dl.find("dd")
        if dd:
            entries = _parse_br_delimited(dd)
            for entry in entries:
                if not entry:
                    continue
                is_head   = "(Head Coach)" in entry
                coach_name = (
                    entry
                    .replace("(Head Coach)", "")
                    .replace("(Assistant Coach)", "")
                    .strip()
                )
                if coach_name:
                    result["coaches"].append({
                        "event_team_id": event_team_id,
                        "coach_name":    coach_name,
                        "is_head_coach": 1 if is_head else 0,
                    })

    # ------------------------------------------------------------------
    # Roster table
    # ------------------------------------------------------------------
    table = soup.find("table", id="CT_Main_0_ucTeamDetails_gvList")
    if not table:
        logger.debug("No roster table found for %s", event_team_id)
        return result

    tbody = table.find("tbody") or table

    for row in tbody.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) < 5:
            continue

        def cell_text(idx: int) -> Optional[str]:
            if idx >= len(cells):
                return None
            t = cells[idx].get_text(strip=True)
            return t if t and t != "\xa0" else None

        def stat_span(suffix: str) -> Optional[int]:
            span = row.find("span", id=lambda x: x and x.endswith(suffix))
            if not span:
                return None
            t = span.get_text(strip=True)
            return int(t) if t.isdigit() else None

        player_name = cell_text(1)
        if not player_name:
            continue

        result["players"].append({
            "event_team_id":     event_team_id,
            "event_slug":        event_slug,
            "player_name":       player_name,
            "jersey_number":     cell_text(0),
            "pronouns":          cell_text(2),
            "position":          cell_text(3),
            "height":            cell_text(4),
            "tournament_goals":   stat_span("lblPoints"),
            "tournament_assists": stat_span("lblAssists"),
            "tournament_ds":      stat_span("lblDs"),
            "tournament_turns":   stat_span("lblTurns"),
            "scraped_at":        scraped_at,
        })

    return result


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _parse_br_delimited(dd: Tag) -> list:
    """Split a <dd> element's content on <br> tags, returning text segments."""
    entries = []
    current = []
    for node in dd.contents:
        if isinstance(node, NavigableString):
            text = node.strip()
            if text:
                current.append(text)
        elif isinstance(node, Tag):
            if node.name == "br":
                combined = " ".join(current).strip()
                if combined:
                    entries.append(combined)
                current = []
            else:
                text = node.get_text(strip=True)
                if text:
                    current.append(text)
    combined = " ".join(current).strip()
    if combined:
        entries.append(combined)
    return entries
