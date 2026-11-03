"""
Phase 3 parser: USAU division schedule page.

One GET of a schedule URL returns all tabs (Pool Play, bracket rounds, placement
brackets) rendered simultaneously in the DOM — no AJAX needed.

Public API
----------
is_not_found(response)     -> bool
has_schedule_content(response) -> bool
parse_schedule_page(html, event_slug, gender, level) -> (games: list, team_ids: set)

Each game dict is ready for db.upsert_game().
Each team entry in team_ids is a (event_team_id: str, team_name: str) tuple.
"""
import re
import logging
from typing import Optional, Tuple
from urllib.parse import urlparse, parse_qs

from bs4 import BeautifulSoup, Tag

from pipelines.usau_data_pipeline.config import SLUG_NOT_FOUND_MARKER

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Event ID extraction (from schedule page JS)
# ---------------------------------------------------------------------------

def extract_event_ids(html: str) -> tuple:
    """
    Extract (event_id, event_group_id) from the checkStandings JS call
    present on USAU schedule pages.  Returns (None, None) if not found.
    """
    import re as _re
    m_id  = _re.search(r"\bevent\s*:\s*(\d+)",       html)
    m_grp = _re.search(r"\beventGroup\s*:\s*(\d+)",  html)
    event_id       = int(m_id.group(1))  if m_id  else None
    event_group_id = int(m_grp.group(1)) if m_grp else None
    return event_id, event_group_id


# ---------------------------------------------------------------------------
# Not-found detection
# ---------------------------------------------------------------------------

def is_not_found(response) -> bool:
    """Return True if the response represents a missing page (HTTP 404 or soft 404)."""
    if response is None:
        return True
    if response.status_code == 404:
        return True
    if SLUG_NOT_FOUND_MARKER in response.text:
        return True
    return False


def has_schedule_content(response) -> bool:
    """Return True if the response body contains actual schedule data."""
    if response is None:
        return False
    text = response.text
    return (
        'class="tabsLeft tabs"' in text
        or "data-game=" in text
        or 'class="bracket_game"' in text
    )


def is_confirmed_no_schedule(response) -> bool:
    """
    Return True when a 200 response is actually the event detail page showing
    a groupButtons section with NO schedule link — meaning this event has no
    schedule published at all and further URL candidates should be skipped.
    """
    if response is None or response.status_code != 200:
        return False
    text = response.text
    if 'class="groupButtons"' not in text:
        return False
    soup = BeautifulSoup(text, "lxml")
    for dd in soup.find_all("dd", class_="groupButtons"):
        for a in dd.find_all("a", href=True):
            if "schedule" in a["href"].lower():
                return False
    # groupButtons present but contains no schedule link
    return True


# ---------------------------------------------------------------------------
# URL token helpers
# ---------------------------------------------------------------------------

def extract_event_team_id(href: str) -> Optional[str]:
    """Extract the URL-encoded EventTeamId query parameter from an href."""
    if not href:
        return None
    qs = parse_qs(urlparse(href).query)
    vals = qs.get("EventTeamId")
    return vals[0] if vals else None


def extract_event_game_id(href: str) -> Optional[str]:
    """Extract the URL-encoded EventGameId query parameter from an href."""
    if not href:
        return None
    qs = parse_qs(urlparse(href).query)
    vals = qs.get("EventGameId")
    return vals[0] if vals else None


# ---------------------------------------------------------------------------
# Top-level parser
# ---------------------------------------------------------------------------

def parse_schedule_page(
    html: str,
    event_slug: str,
    gender: str,
    level: str,
) -> Tuple[list, set]:
    """
    Parse all schedule content from a single schedule page GET.

    Returns:
        games    – list of game dicts (upsert-ready)
        team_ids – set of (event_team_id, team_name) tuples
    """
    soup = BeautifulSoup(html, "lxml")
    games: list = []
    team_ids: set = set()
    division_label = f"{level}-{gender}"

    tab_sections = _extract_tab_sections(soup)

    for _section_id, tab_label, section_el in tab_sections:
        # --- Pool schedule tables ----------------------------------------
        for table in section_el.find_all(
            "table",
            class_=lambda c: c and "global_table" in c and "scores_table" in c,
        ):
            pool_games, pool_teams = _parse_pool_schedule_table(
                table, tab_label, event_slug, division_label
            )
            games.extend(pool_games)
            team_ids.update(pool_teams)

        # --- Bracket game divs -------------------------------------------
        for bg_div in section_el.find_all(
            "div", class_=lambda c: c and "bracket_game" in c.split()
        ):
            bracket_section = _find_bracket_section(bg_div)
            round_label     = _find_round_label(bg_div)

            game, bg_teams = _parse_bracket_game(
                bg_div, tab_label, bracket_section, round_label,
                event_slug, division_label
            )
            if game:
                games.append(game)
            team_ids.update(bg_teams)

    # Harvest teams from pool standings tables (div.pool rows)
    for pool_div in soup.find_all("div", class_="pool"):
        for a in pool_div.find_all("a", href=lambda h: h and "EventTeamId" in (h or "")):
            etid = extract_event_team_id(a["href"])
            name = a.get_text(strip=True)
            if etid:
                team_ids.add((etid, name))

    return games, team_ids


# ---------------------------------------------------------------------------
# Tab section extraction
# ---------------------------------------------------------------------------

def _extract_tab_sections(soup: BeautifulSoup) -> list:
    """
    Return [(section_id, tab_label, section_element), ...] for each schedule tab.
    Falls back to treating the whole page as one section when tabs are absent.
    """
    results = []

    tabs_ul = soup.find(
        "ul",
        class_=lambda c: c and "tabsLeft" in c.split() and "tabs" in c.split(),
    )

    if not tabs_ul:
        # No tab bar — treat the entire document as one section
        results.append((None, "Schedule", soup))
        return results

    for li in tabs_ul.find_all("li"):
        a = li.find("a")
        if not a:
            continue
        tab_label = a.get_text(strip=True)

        # The `rel` attribute holds the section div id
        rel_attr = a.get("rel", "")
        if isinstance(rel_attr, list):
            rel_attr = " ".join(rel_attr)
        section_id = rel_attr.strip()

        section_el = soup.find(id=section_id) if section_id else None
        if section_el is None:
            href = a.get("href", "")
            if href.startswith("#"):
                section_el = soup.find(id=href[1:])

        if section_el is not None:
            results.append((section_id, tab_label, section_el))

    if not results:
        results.append((None, "Schedule", soup))

    return results


# ---------------------------------------------------------------------------
# Pool schedule table parser
# ---------------------------------------------------------------------------

def _parse_pool_schedule_table(
    table: Tag,
    tab_label: str,
    event_slug: str,
    division_label: str,
) -> Tuple[list, set]:
    games: list  = []
    team_ids: set = set()

    # Derive pool name from the thead header text ("Pool A Schedule & Scores" → "Pool A")
    thead = table.find("thead")
    header_text = thead.get_text(strip=True) if thead else ""
    pool_name_raw = re.sub(r"Schedule\s*&\s*Scores", "", header_text, flags=re.IGNORECASE).strip()
    pool_name = pool_name_raw if pool_name_raw else None

    tbody = table.find("tbody")
    if not tbody:
        return games, team_ids

    for row in tbody.find_all("tr", attrs={"data-game": True}):
        try:
            cells = row.find_all("td")
            if len(cells) < 6:
                continue

            numeric_game_id = int(row["data-game"]) if row.get("data-game", "").isdigit() else None
            game_date = cells[0].get_text(strip=True) or None
            game_time = cells[1].get_text(strip=True) or None
            # Field is at positional index 2 (broken data-type attribute — do not use attr selector)
            field = cells[2].get_text(strip=True) or None

            # Home team (index 3) and away team (index 4)
            home_a = cells[3].find("a") if len(cells) > 3 else None
            away_a = cells[4].find("a") if len(cells) > 4 else None

            home_name = home_a.get_text(strip=True) if home_a else None
            away_name = away_a.get_text(strip=True) if away_a else None
            home_etid = extract_event_team_id(home_a["href"]) if home_a else None
            away_etid = extract_event_team_id(away_a["href"]) if away_a else None

            # Scores: look for named spans first, fall back to .adjust-data class
            home_score, away_score = _parse_scores_from_row(cells)

            status = cells[6].get_text(strip=True) if len(cells) > 6 else None

            # Match report link can appear in any cell
            report_a = None
            for cell in cells:
                report_a = cell.find("a", href=lambda h: h and "match_report" in (h or ""))
                if report_a:
                    break
            egid = extract_event_game_id(report_a["href"]) if report_a else None

            if home_etid:
                team_ids.add((home_etid, home_name or ""))
            if away_etid:
                team_ids.add((away_etid, away_name or ""))

            # Only store rows that have at least one identifier
            if not (egid or numeric_game_id):
                continue

            # Always prefer the numeric_game_id-based key so pre-event placeholders
            # and post-event final results share the same PK and upsert correctly.
            # The EventGameId from the match_report URL is stored in match_report_url.
            if numeric_game_id:
                egid = f"game_{event_slug}_{numeric_game_id}"

            games.append({
                "event_game_id":     egid,
                "numeric_game_id":   numeric_game_id,
                "event_slug":        event_slug,
                "division_label":    division_label,
                "pool_name":         pool_name,
                "round_context":     tab_label,
                "bracket_section":   None,
                "round_label":       None,
                "game_date":         game_date,
                "game_time":         game_time,
                "game_datetime":     None,
                "field":             field,
                "home_event_team_id": home_etid,
                "away_event_team_id": away_etid,
                "team1_url":         None,
                "team2_url":         None,
                "home_score":        home_score,
                "away_score":        away_score,
                "status":            status,
                "match_report_url":  report_a["href"] if report_a else None,
                "has_match_report":  1 if (report_a and egid) else 0,
                "scraped_at":        None,
            })

        except Exception as exc:
            logger.warning("Error parsing pool game row: %s", exc)

    return games, team_ids


def _parse_scores_from_row(cells: list) -> Tuple[Optional[int], Optional[int]]:
    """
    Extract home and away scores from the score cell (index 5).
    Tries named data-type spans first, then falls back to .adjust-data spans.
    """
    if len(cells) <= 5:
        return None, None

    score_cell = cells[5]

    hs_span = score_cell.find("span", attrs={"data-type": "game-score-home"})
    as_span = score_cell.find("span", attrs={"data-type": "game-score-away"})
    if hs_span and as_span:
        hs = hs_span.get_text(strip=True)
        as_ = as_span.get_text(strip=True)
        return (
            int(hs) if hs.isdigit() else None,
            int(as_) if as_.isdigit() else None,
        )

    adj = score_cell.find_all("span", class_="adjust-data")
    if len(adj) >= 2:
        hs  = adj[0].get_text(strip=True)
        as_ = adj[1].get_text(strip=True)
        return (
            int(hs) if hs.isdigit() else None,
            int(as_) if as_.isdigit() else None,
        )

    return None, None


# ---------------------------------------------------------------------------
# Bracket game parser
# ---------------------------------------------------------------------------

def _parse_bracket_game(
    div: Tag,
    tab_label: str,
    bracket_section: Optional[str],
    round_label: Optional[str],
    event_slug: str,
    division_label: str,
) -> Tuple[Optional[dict], set]:
    team_ids: set = set()
    try:
        game_id_str = div.get("id", "")
        numeric_game_id = (
            int(game_id_str.replace("game", ""))
            if game_id_str.startswith("game") and game_id_str[4:].isdigit()
            else None
        )

        report_a = div.select_one('div.gameID_area a[href*="match_report"]')
        egid = extract_event_game_id(report_a["href"]) if report_a else None

        top = div.find("div", class_="top_area")
        btm = div.find("div", class_="btm_area")

        home_a = _find_team_link(top, "game-team-home") if top else None
        away_a = _find_team_link(btm, "game-team-away") if btm else None

        home_etid = extract_event_team_id(home_a["href"]) if home_a else None
        away_etid = extract_event_team_id(away_a["href"]) if away_a else None
        home_name = home_a.get_text(strip=True) if home_a else None
        away_name = away_a.get_text(strip=True) if away_a else None

        home_score_span = top.select_one('span[data-type="game-score-home"]') if top else None
        away_score_span = btm.select_one('span[data-type="game-score-away"]') if btm else None

        hs  = home_score_span.get_text(strip=True) if home_score_span else None
        as_ = away_score_span.get_text(strip=True) if away_score_span else None

        field_p   = div.find("p", class_="location")
        date_span = div.find("span", class_="date")
        status_span = div.find("span", class_="game-status")

        if home_etid:
            team_ids.add((home_etid, home_name or ""))
        if away_etid:
            team_ids.add((away_etid, away_name or ""))

        if not (egid or numeric_game_id):
            return None, team_ids

        # Always prefer the numeric_game_id-based key so pre-event placeholders
        # and post-event final results share the same PK and upsert correctly.
        # The EventGameId from the match_report URL is stored in match_report_url.
        if numeric_game_id:
            egid = f"game_{event_slug}_{numeric_game_id}"

        return {
            "event_game_id":     egid,
            "numeric_game_id":   numeric_game_id,
            "event_slug":        event_slug,
            "division_label":    division_label,
            "pool_name":         None,
            "round_context":     tab_label,
            "bracket_section":   bracket_section,
            "round_label":       round_label,
            "game_date":         None,
            "game_time":         None,
            "game_datetime":     date_span.get_text(strip=True) if date_span else None,
            "field":             field_p.get_text(strip=True) if field_p else None,
            "home_event_team_id": home_etid,
            "away_event_team_id": away_etid,
            "team1_url":         None,
            "team2_url":         None,
            "home_score":        int(hs)  if hs  and hs.isdigit()  else None,
            "away_score":        int(as_) if as_ and as_.isdigit() else None,
            "status":            status_span.get_text(strip=True) if status_span else None,
            "match_report_url":  report_a["href"] if report_a else None,
            "has_match_report":  1 if report_a else 0,
            "scraped_at":        None,
        }, team_ids

    except Exception as exc:
        logger.warning("Error parsing bracket game div: %s", exc)
        return None, team_ids


def _find_team_link(area: Tag, data_type: str) -> Optional[Tag]:
    """Find the team anchor within a bracket game area div."""
    span = area.select_one(f'span[data-type="{data_type}"]')
    if span:
        a = span.find("a")
        if a:
            return a
    # Fallback: any EventTeamId link in this area
    return area.find("a", href=lambda h: h and "EventTeamId" in (h or ""))


# ---------------------------------------------------------------------------
# Context label helpers
# ---------------------------------------------------------------------------

def _find_bracket_section(div: Tag) -> Optional[str]:
    """Find the enclosing mod_slide h3 title (e.g. 'National Championship')."""
    mod_slide = div.find_parent("div", class_="mod_slide")
    if not mod_slide:
        return None
    trigger = mod_slide.find("h3", class_="slide_trigger")
    if not trigger:
        return None
    a = trigger.find("a")
    return (a or trigger).get_text(strip=True) or None


def _find_round_label(div: Tag) -> Optional[str]:
    """Find the nearest preceding h4.col_title (e.g. 'Final', 'Semifinals')."""
    # Walk up the tree looking for h4 siblings before this div
    parent = div.parent
    while parent and parent.name not in ("body", "html", None):
        found = None
        for sibling in parent.children:
            if sibling is div:
                break
            if isinstance(sibling, Tag) and sibling.name == "h4":
                classes = sibling.get("class") or []
                if "col_title" in classes:
                    found = sibling
        if found:
            return found.get_text(strip=True) or None
        # Also check if parent itself has a col_title h4 child before the bracket group
        h4 = parent.find("h4", class_="col_title")
        if h4:
            return h4.get_text(strip=True) or None
        parent = parent.parent
    return None
