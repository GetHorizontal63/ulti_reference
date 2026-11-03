"""
Phase 1 parser: USAU tournament calendar page (ASP.NET WebForms).

Verified form/table names from live HTML inspection (May 2026):
  - Form prefix:   CT_HP_Mid_1   (NOT CT_Main_0)
  - Submit button: CT_HP_Mid_1$btnSubmit
  - Past-events grid: CT_HP_Mid_1_gvPastEvents
  - Upcoming grid:    CT_HP_Mid_1_gvCurrentUpcomingEvents
"""
import re
import logging
from datetime import datetime
from typing import Optional, Tuple

from bs4 import BeautifulSoup

from pipelines.usau_data_pipeline.config import BASE_URL, FORM_PREFIX, CALENDAR_TABLE_PAST, CALENDAR_TABLE_NOW

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Normalization rules — ordered, first match wins
# ---------------------------------------------------------------------------

_COMPETITION_LEVEL_RULES: list[tuple[str, str]] = [
    (r"\bbeach\b",                                                  "Beach"),
    (r"great\s+grand\s+masters?",                                   "Great Grand Masters"),
    (r"grand\s+masters?",                                           "Grand Masters"),
    (r"\bmasters?\b|40\+|\bma\d+\b|\bfa\d+\b",                    "Masters"),
    (r"\bclub\b",                                                   "Club"),
    (r"\bcollege\b|^d-?i{1,3}\b|^diii?\b",                        "College"),
    (r"high\s+school|interscholastic|\bhs\b",                      "High School"),
    (r"\bjv\b|\bvarsity\b|junior\s+varsity",                       "High School"),
    (r"middle\s+school|\bgraders?\b",                              "Middle School"),
    (r"elementary\s+school",                                        "Elementary School"),
    (r"\byouth\b|^u-?\d{2}\b|^u\d{2}\b|\bmj\d+\b|\bfj\d+\b",    "Youth"),
    (r"national\s+team",                                            "National Team"),
    (r"\bleague\b",                                                 "League"),
    (r"\bconvention\b",                                             "Convention"),
]

_GENDER_RULES: list[tuple[str, str]] = [
    (r"\bmixed\b|non.?binary",                                                          "Mixed"),
    (r"\bwomen'?s?\b|\bgirls?\b|\bwomxn'?s?\b|\bfa\d+\b|\bfj\d+\b|\bgx\b",           "Women"),
    (r"\bmen'?s?\b|\bboys?\b|\bopen\b|\bma\d+\b|\bmj\d+\b|\bbx\b",                   "Men"),
]


def derive_competition_level(group: str) -> Optional[str]:
    """Return normalized competition_level from raw competition_group text."""
    if not group:
        return None
    gl = group.lower().strip()
    for pattern, level in _COMPETITION_LEVEL_RULES:
        if re.search(pattern, gl):
            return level
    return None


def derive_gender(group: str) -> Optional[str]:
    """Return normalized gender from raw competition_group text."""
    if not group:
        return None
    gl = group.lower().strip()
    for pattern, gender in _GENDER_RULES:
        if re.search(pattern, gl):
            return gender
    return None


_MONTHS_RE = (
    r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec"
    r"|January|February|March|April|June|July|August"
    r"|September|October|November|December)"
)


# ---------------------------------------------------------------------------
# Form field extraction (submits ALL form fields to satisfy ASP.NET)
# ---------------------------------------------------------------------------

def extract_all_form_data(soup: BeautifulSoup) -> dict:
    """
    Extract every <input> and <select> field value from the page so that
    the POST carries the full form state ASP.NET expects.
    Submit buttons are intentionally excluded (added explicitly by callers).
    """
    data: dict = {}
    form = soup.find("form") or soup

    for inp in form.find_all("input"):
        name  = inp.get("name", "")
        itype = (inp.get("type") or "text").lower()
        if not name:
            continue
        if itype == "submit":
            continue  # callers add the correct submit button explicitly
        if itype in ("checkbox", "radio"):
            if inp.get("checked"):
                data[name] = inp.get("value", "on")
        else:
            data[name] = inp.get("value", "")

    for sel in form.find_all("select"):
        name = sel.get("name", "")
        if not name:
            continue
        selected = sel.find("option", selected=True)
        if selected:
            data[name] = selected.get("value", "")
        else:
            first = sel.find("option")
            data[name] = first.get("value", "") if first else ""

    return data


def build_next_page_form_data(soup: BeautifulSoup, target: str) -> dict:
    """Build POST data for a GridView pagination postback.

    Preserves the current page's form state (VIEWSTATE etc.) and only sets
    __EVENTTARGET so ASP.NET knows which grid to advance — no filter overrides.
    """
    data = extract_all_form_data(soup)
    data.update({
        "__EVENTTARGET":   target,
        "__EVENTARGUMENT": "",
    })
    data.pop(f"{FORM_PREFIX}$btnSubmit", None)
    return data


# ---------------------------------------------------------------------------
# Page parser
# ---------------------------------------------------------------------------

def parse_calendar_page(html: str) -> list:
    """
    Parse one page of the USAU calendar.

    Reads BOTH the past-events and current/upcoming grids.
    All division/gender metadata is extracted from each row's
    Competition Groups column (<li> items) — no filter args needed.

    Returns a list of event dicts ready for db.upsert_event().
    """
    soup   = BeautifulSoup(html, "lxml")
    events = []

    for grid in [
        soup.find("table", id=CALENDAR_TABLE_PAST),
        soup.find("table", id=CALENDAR_TABLE_NOW),
    ]:
        if not grid:
            continue

        # Discover column indices from header row
        col_name   = 1
        col_city   = 2
        col_state  = 3
        col_groups = 4
        col_dates  = 5

        header_row = grid.find("tr")
        if header_row:
            ths = [th.get_text(strip=True).lower() for th in header_row.find_all("th")]
            for i, h in enumerate(ths):
                if "event name" in h or (i > 0 and "event" in h and "logo" not in h):
                    col_name = i
                elif h == "city":
                    col_city = i
                elif h == "state":
                    col_state = i
                elif "competition" in h or "group" in h:
                    col_groups = i
                elif "date" in h:
                    col_dates = i

        seen_keys = {(e["event_slug"], e["competition_group"]) for e in events}

        for row in grid.find_all("tr"):
            if row.find("th"):
                continue
            cells = row.find_all("td")
            if len(cells) < col_name + 1:
                continue

            # Event name / slug
            link = cells[col_name].find("a", href=lambda h: h and "/events/" in (h or ""))
            if not link:
                continue
            m = re.search(r"/events/([^/?#]+)/?", link.get("href", ""))
            if not m:
                continue
            event_slug  = m.group(1)
            event_title = link.get_text(strip=True)

            # City / State
            city  = cells[col_city].get_text(strip=True)  if len(cells) > col_city  else None
            state = cells[col_state].get_text(strip=True) if len(cells) > col_state else None
            city  = city  or None
            state = state or None

            # Dates
            date_start, date_end, season_year = None, None, None
            if len(cells) > col_dates:
                date_text = cells[col_dates].get_text(strip=True)
                if re.search(_MONTHS_RE, date_text, re.IGNORECASE):
                    date_start, date_end = _parse_date_range(date_text)
                    if date_start:
                        ym = re.search(r"(\d{4})", date_start)
                        if ym:
                            season_year = int(ym.group(1))

            # Fallback year from title
            if season_year is None:
                ym = re.search(r"\b(20\d{2})\b", event_title)
                season_year = int(ym.group(1)) if ym else None

            # Competition groups — one row per <li> item
            groups = []
            if len(cells) > col_groups:
                for li in cells[col_groups].find_all("li"):
                    text = re.sub(r"\s*\[\d+\].*$", "", li.get_text(strip=True)).strip()
                    if text:
                        groups.append(text)

            # Emit one event dict per group; fall back to one row with empty group
            base = {
                "event_slug":  event_slug,
                "event_title": event_title,
                "event_url":   f"{BASE_URL}/events/{event_slug}/",
                "source":      "usau",
                "event_type":  "tournament",
                "city":        city,
                "state":       state,
                "date_start":  date_start,
                "date_end":    date_end,
                "season_year": season_year,
            }

            for group in (groups or [""]):
                comp_level     = derive_competition_level(group)
                gender         = derive_gender(group)
                division_label = f"{comp_level}-{gender}" if comp_level and gender else None

                if event_slug in seen_keys and not group:
                    continue  # skip blank-group duplicate
                key = (event_slug, group)
                if key in seen_keys:
                    continue
                seen_keys.add(key)

                events.append({**base,
                    "competition_group": group,
                    "competition_level": comp_level,
                    "gender":            gender,
                    "division_label":    division_label,
                })

    return events


# ---------------------------------------------------------------------------
# Pagination helper
# ---------------------------------------------------------------------------

def find_next_page_target(html: str) -> Optional[str]:
    """
    Return the __doPostBack target for the next page of gvPastEvents,
    or None if this is the last page.

    The live page renders pagination as:
        <a href="javascript:__doPostBack('CT_HP_Mid_1$gvPastEvents$ctl23$ctl00$ctl10','')">
            Next 20 »
        </a>
    We match any "Next" link associated with the past-events grid.
    """
    soup = BeautifulSoup(html, "lxml")

    for a in soup.find_all("a", href=lambda h: h and "__doPostBack" in (h or "")):
        href   = a.get("href", "")
        m      = re.search(r"__doPostBack\('([^']+)'", href)
        if not m:
            continue
        target = m.group(1)
        text   = a.get_text(strip=True)

        # Must belong to the past-events grid and be a "next" link
        if "gvPastEvents" in target and re.search(r"[Nn]ext|»|›|>>", text):
            return target

    return None


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _season_id_to_year(season_id: int) -> int:
    """Convert a drpSeasonId value to a calendar year. Formula: year = season_id + 2005."""
    return season_id + 2005


def _parse_date_range(date_text: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Parse date strings like:
      "Jun 5 – 8, 2021"
      "May 24 – Jun 2, 2019"
      "November 21-25, 2019"
    Returns (date_start, date_end) as ISO 8601 strings, or (raw_text, None) on failure.
    """
    if not date_text:
        return None, None

    try:
        year_m = re.search(r"(\d{4})", date_text)
        year   = year_m.group(1) if year_m else None

        # Normalise all dash/en-dash/em-dash variants to ASCII hyphen
        normalized = re.sub(r"[–—−]", "-", date_text)
        parts = [p.strip() for p in normalized.split("-", 1)]

        if len(parts) != 2 or not year:
            return date_text, None

        start_raw, end_raw = parts

        if not re.search(r"\d{4}", start_raw):
            start_raw = f"{start_raw} {year}"
        if not re.search(r"\d{4}", end_raw):
            end_raw = f"{end_raw} {year}"

        for fmt in (
            "%b %d %Y", "%B %d %Y", "%b %d, %Y", "%B %d, %Y",
            "%b %d%Y",  "%B %d%Y",
        ):
            try:
                ds = datetime.strptime(start_raw.strip(), fmt).strftime("%Y-%m-%d")
                de = datetime.strptime(end_raw.strip(),   fmt).strftime("%Y-%m-%d")
                return ds, de
            except ValueError:
                continue

        return date_text, None

    except Exception:
        return date_text, None
