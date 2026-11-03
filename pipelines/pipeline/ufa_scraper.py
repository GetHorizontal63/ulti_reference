"""UFA / WatchUFA scraper.

Renders a single game page with Playwright (the React app is fully
client-rendered) and parses the four data sections documented in
build_guide.md §3a:

    1. Box score (quarter breakdown)
    2. Team stats table
    3. Player stats table (ReactTable)
    4. Field map (SVG, per team)
    5. Play-by-play (events grouped by quarter / point)

Outputs go to data/raw/ufa/ for traceability and data/processed/ufa/
for the cleaned per-game JSON consumed by export_static_bundle.py.

Usage:
    python -m pipeline.ufa_scraper --game 2025-07-26-MAD-MIN
    python -m pipeline.ufa_scraper --game 2025-07-26-MAD-MIN --use-cached
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from bs4 import BeautifulSoup, Tag

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "data" / "raw" / "ufa"
PROCESSED_DIR = REPO_ROOT / "data" / "processed" / "ufa"

UFA_GAME_URL = "https://www.watchufa.com/stats/game/{slug}"

# ---- SVG coordinate constants (build_guide.md §3a, Section 4) -----------
# Field rect spans x=[5,205], y=[5,455]. Scoring end zone top is at y=80;
# own end zone bottom is at y=380. We normalize to attacking direction:
#   x_norm = (svg_x - 5) / 200          # 0=left sideline, 1=right sideline
#   y_norm = (455 - svg_y) / 450        # 0=own endzone, 1=scoring endzone
SVG_FIELD_X_MIN = 5.0
SVG_FIELD_X_MAX = 205.0
SVG_FIELD_Y_MIN = 5.0
SVG_FIELD_Y_MAX = 455.0
SVG_FIELD_WIDTH = SVG_FIELD_X_MAX - SVG_FIELD_X_MIN  # 200
SVG_FIELD_HEIGHT = SVG_FIELD_Y_MAX - SVG_FIELD_Y_MIN  # 450

# Color → outcome mapping for SVG strokes/fills.
COLOR_OUTCOMES = {
    "lightblue": "complete",
    "green":     "score",
    "red":       "turnover",   # disambiguated below by presence of circle
}


# -----------------------------------------------------------------------
# Dataclasses
# -----------------------------------------------------------------------

@dataclass
class GameMeta:
    game_slug: str
    home_team: str
    away_team: str
    date: Optional[str] = None


@dataclass
class BoxScoreRow:
    team: str
    q1: int
    q2: int
    q3: int
    q4: int
    total: int


@dataclass
class TeamStat:
    team: str
    completion_pct: Optional[float] = None
    completions_made: Optional[int] = None
    completions_attempted: Optional[int] = None
    hucks_pct: Optional[float] = None
    hucks_made: Optional[int] = None
    hucks_attempted: Optional[int] = None
    hold_pct: Optional[float] = None
    oline_conv_pct: Optional[float] = None
    break_pct: Optional[float] = None
    dline_conv_pct: Optional[float] = None
    redzone_conv_pct: Optional[float] = None
    blocks: Optional[int] = None
    turnovers: Optional[int] = None


@dataclass
class PlayerStat:
    game_slug: str
    name: str
    team: str
    jersey: Optional[str]
    pp: Optional[int] = None
    opp: Optional[int] = None
    dpp: Optional[int] = None
    ast: Optional[int] = None
    gls: Optional[int] = None
    blk: Optional[int] = None
    plus_minus: Optional[int] = None
    rcv_yds: Optional[int] = None
    thr_yds: Optional[int] = None
    yds: Optional[int] = None
    cmp: Optional[int] = None
    cmp_pct: Optional[float] = None
    ha: Optional[int] = None
    t: Optional[int] = None
    s: Optional[int] = None
    c: Optional[int] = None
    d: Optional[int] = None


@dataclass
class FieldMapThrow:
    """One <g> from the SVG field map: line + origin rect + optional receive circle."""
    team: str
    sequence_idx: int          # order within the team's SVG
    throw_x: float             # normalized [0,1]
    throw_y: float             # normalized [0,1] (own→scoring)
    recv_x: Optional[float]
    recv_y: Optional[float]
    outcome: str               # complete | score | drop | throwaway
    raw_origin_color: str
    raw_line_color: str
    raw_recv_color: Optional[str]


@dataclass
class PbpEvent:
    quarter: int
    point_idx: int             # 0-indexed within quarter
    point_score: str           # "1-3"
    line_type: Optional[str]   # "O-Line" / "D-Line"
    point_clock: Optional[str]
    point_duration: Optional[str]
    roster: list[str]
    event_idx: int             # 0-indexed within point
    event_text: str
    distance_yards: Optional[int]
    throw_type: Optional[str]  # pass | swing | dump | dish | huck | score | drop | throwaway | callahan | pull | block | timeout | injury | other
    thrower: Optional[str]
    receiver: Optional[str]


# -----------------------------------------------------------------------
# Page rendering
# -----------------------------------------------------------------------

async def render_game_html(slug: str, *, click_field_map_teams: bool = True) -> dict[str, str]:
    """Render the page and return one HTML snapshot per team for the field map.

    Returns:
        { "default": full_html_first_team, "<TEAM>": full_html_with_that_team_filtered }
    The base HTML (default) covers everything except per-team SVG. We then click
    each "Filter by team" button under #stats-pages to capture each team's SVG.
    """
    from playwright.async_api import async_playwright

    url = UFA_GAME_URL.format(slug=slug)
    snapshots: dict[str, str] = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1400, "height": 1200})
        page = await ctx.new_page()
        await page.goto(url, wait_until="networkidle", timeout=60_000)
        # The stats SPA injects under #stats-pages. Wait for it to populate.
        await page.wait_for_selector("#stats-pages", timeout=60_000)
        # Wait for at least one ReactTable body to render (player stats table).
        try:
            await page.wait_for_selector(".rt-tbody", timeout=30_000)
        except Exception:
            pass
        # Wait for the field-map svg.
        try:
            await page.wait_for_selector("svg", timeout=30_000)
        except Exception:
            pass

        snapshots["default"] = await page.content()

        if click_field_map_teams:
            # Scope to the .field-map section so we don't accidentally click
            # buttons in adjacent sections (player stats also has a team filter).
            field_map = page.locator("div.field-map").first

            # Click "Select all" for players + events so the SVG renders the
            # full set of throws, not just whoever is checked by default.
            async def _click_select_all() -> None:
                try:
                    select_alls = await field_map.get_by_text("Select all", exact=True).all()
                    for sa in select_alls:
                        try:
                            await sa.click(timeout=3_000)
                            await page.wait_for_timeout(200)
                        except Exception:
                            continue
                except Exception:
                    pass

            await _click_select_all()

            # The field-map team filter shows abbreviated team buttons (MAD/MIN).
            # Each game has exactly two; click each in turn and capture HTML.
            try:
                team_buttons = await field_map.locator("button").all()
                team_codes_seen: list[str] = []
                for btn in team_buttons:
                    label = (await btn.inner_text()).strip()
                    if not label:
                        continue
                    if label.lower() in {"refresh stats", "both", "select all", "deselect all"}:
                        continue
                    if not re.fullmatch(r"[A-Z]{2,4}", label):
                        continue
                    if label in team_codes_seen:
                        continue
                    team_codes_seen.append(label)
                    try:
                        await btn.click(timeout=5_000)
                        await page.wait_for_timeout(500)
                        # Re-apply Select all on the freshly switched team.
                        await _click_select_all()
                        await page.wait_for_timeout(500)
                        snapshots[label] = await page.content()
                    except Exception:
                        continue
            except Exception:
                pass

            # Capture PBP per team. The play-by-play section has its own
            # MAD/MIN filter; without clicking it the PBP only renders one
            # team's events.
            try:
                pbp_section = page.locator("div.play-by-play").first
                pbp_buttons = await pbp_section.locator("button").all()
                # Try to expand-all first so every event sits in the DOM.
                try:
                    expand_all = pbp_section.get_by_text("Expand all", exact=True).first
                    await expand_all.click(timeout=2_000)
                    await page.wait_for_timeout(300)
                except Exception:
                    pass
                for label in list(team_codes_seen):
                    for btn in pbp_buttons:
                        btext = (await btn.inner_text()).strip()
                        if btext == label:
                            try:
                                await btn.click(timeout=5_000)
                                await page.wait_for_timeout(500)
                                try:
                                    await pbp_section.get_by_text(
                                        "Expand all", exact=True
                                    ).first.click(timeout=2_000)
                                    await page.wait_for_timeout(300)
                                except Exception:
                                    pass
                                snapshots[f"pbp__{label}"] = await page.content()
                            except Exception:
                                pass
                            break
            except Exception:
                pass

        await browser.close()
    return snapshots


# -----------------------------------------------------------------------
# Parsing
# -----------------------------------------------------------------------

# Each top-level data block on the rendered game page lives inside its own
# div with a stable class name. The h2 heading sits in a sibling .row.
SECTION_CLASSES = {
    "box_score":   "quarter-breakdown",
    "team_stats":  "team-stats",
    "player_stats":"stats-table",
    "field_map":   "field-map",
    "pbp":         "play-by-play",
}


def _section(soup: BeautifulSoup, key: str) -> Optional[Tag]:
    cls = SECTION_CLASSES[key]
    return soup.select_one(f"div.{cls}")


def parse_box_score(soup: BeautifulSoup) -> list[BoxScoreRow]:
    """Quarter-by-quarter table. Two rows: home, away.

    The .quarter-breakdown div renders the data as a flat sequence rather
    than a real <table>, but we accept either layout.
    """
    sec = _section(soup, "box_score")
    rows: list[BoxScoreRow] = []
    if sec is None:
        return rows

    # First try a real table.
    for tr in sec.find_all("tr"):
        cells = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
        if len(cells) >= 6 and any(c.isdigit() for c in cells[1:]):
            try:
                rows.append(BoxScoreRow(
                    team=cells[0],
                    q1=int(cells[1]), q2=int(cells[2]),
                    q3=int(cells[3]), q4=int(cells[4]),
                    total=int(cells[5]),
                ))
            except ValueError:
                continue
    if rows:
        return rows

    # Fallback: scan the flat text for "<Team> q1 q2 q3 q4 total" rows.
    text = sec.get_text(" ", strip=True)
    # Strip a leading "Q1 Q2 Q3 Q4 T" header if present.
    text = re.sub(r"^Q1\s+Q2\s+Q3\s+Q4\s+T\s+", "", text, flags=re.I)
    pattern = re.compile(r"([A-Za-z][A-Za-z .'\-]+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)(?=\s+[A-Za-z]|$)")
    for m in pattern.finditer(text):
        team = m.group(1).strip()
        if team.lower() in {"q1", "q2", "q3", "q4", "t"}:
            continue
        try:
            rows.append(BoxScoreRow(
                team=team,
                q1=int(m.group(2)), q2=int(m.group(3)),
                q3=int(m.group(4)), q4=int(m.group(5)),
                total=int(m.group(6)),
            ))
        except ValueError:
            continue
    return rows


_PCT_RE = re.compile(r"(\d+)%\s*\((\d+)/(\d+)\)")


def _parse_pct_made_attempted(s: str) -> tuple[Optional[float], Optional[int], Optional[int]]:
    m = _PCT_RE.search(s)
    if not m:
        return None, None, None
    return float(m.group(1)), int(m.group(2)), int(m.group(3))


def parse_team_stats(soup: BeautifulSoup, teams: list[str]) -> list[TeamStat]:
    sec = _section(soup, "team_stats")
    if sec is None or len(teams) < 2:
        return []
    home, away = teams[0], teams[1]
    out = {home: TeamStat(team=home), away: TeamStat(team=away)}

    field_map = {
        "completions":            ("completion_pct", "completions_made", "completions_attempted"),
        "hucks":                  ("hucks_pct", "hucks_made", "hucks_attempted"),
        "hold %":                 ("hold_pct", None, None),
        "o-line conversion %":    ("oline_conv_pct", None, None),
        "break %":                ("break_pct", None, None),
        "d-line conversion %":    ("dline_conv_pct", None, None),
        "red zone conversion %":  ("redzone_conv_pct", None, None),
    }
    int_fields = {"blocks": "blocks", "turnovers": "turnovers"}

    for tr in sec.find_all("tr"):
        cells = [c.get_text(strip=True) for c in tr.find_all(["td", "th"])]
        if len(cells) < 3:
            continue
        label = cells[0].lower()
        home_v, away_v = cells[1], cells[2]
        if label in field_map:
            pct_f, made_f, att_f = field_map[label]
            for team, val in ((home, home_v), (away, away_v)):
                pct, made, att = _parse_pct_made_attempted(val)
                if pct is not None:
                    setattr(out[team], pct_f, pct)
                if made_f and made is not None:
                    setattr(out[team], made_f, made)
                if att_f and att is not None:
                    setattr(out[team], att_f, att)
        elif label in int_fields:
            for team, val in ((home, home_v), (away, away_v)):
                try:
                    setattr(out[team], int_fields[label], int(val))
                except ValueError:
                    pass
    return list(out.values())


_PLAYER_HEADER_TOKENS = ["Name", "Team", "#", "PP", "OPP", "DPP", "AST", "GLS", "BLK",
                        "+/-", "Rcv Yds", "Thr Yds", "Yds", "Cmp", "Cmp%", "HA",
                        "T", "S", "C", "D"]


def parse_player_stats(soup: BeautifulSoup, game_slug: str) -> list[PlayerStat]:
    """ReactTable player stats. Find the first .rt-tbody whose .rt-tr has 20 cells."""
    out: list[PlayerStat] = []
    for tbody in soup.select(".rt-tbody"):
        rows = tbody.select(".rt-tr-group .rt-tr, .rt-tr")
        for tr in rows:
            cells = [c.get_text(strip=True) for c in tr.select(".rt-td")]
            if len(cells) < 20:
                continue
            try:
                pct_str = cells[14].replace("%", "")
                ps = PlayerStat(
                    game_slug=game_slug,
                    name=cells[0], team=cells[1],
                    jersey=cells[2] or None,
                    pp=_to_int(cells[3]), opp=_to_int(cells[4]), dpp=_to_int(cells[5]),
                    ast=_to_int(cells[6]), gls=_to_int(cells[7]), blk=_to_int(cells[8]),
                    plus_minus=_to_int(cells[9]),
                    rcv_yds=_to_int(cells[10]), thr_yds=_to_int(cells[11]), yds=_to_int(cells[12]),
                    cmp=_to_int(cells[13]),
                    cmp_pct=float(pct_str) if pct_str else None,
                    ha=_to_int(cells[15]), t=_to_int(cells[16]), s=_to_int(cells[17]),
                    c=_to_int(cells[18]), d=_to_int(cells[19]),
                )
                out.append(ps)
            except Exception:
                continue
        if out:
            return out  # accept first matching tbody
    return out


def _to_int(s: str) -> Optional[int]:
    if s is None or s == "":
        return None
    try:
        return int(s.replace("+", ""))
    except ValueError:
        return None


# -----------------------------------------------------------------------
# Field map SVG parsing
# -----------------------------------------------------------------------

def _f(attr: Optional[str]) -> Optional[float]:
    if attr is None:
        return None
    try:
        return float(attr)
    except ValueError:
        return None


def parse_field_map_svg(html: str, team: str) -> list[FieldMapThrow]:
    """Find the field-map SVG (the one whose viewBox/width is 405x505 area).

    Each throw is a <g> containing optionally a <line>, a <rect>, and a <circle>.
    """
    soup = BeautifulSoup(html, "lxml")
    sec = _section(soup, "field_map")
    if sec is None:
        return []
    # The actual field-map SVG should contain a <rect> at x=5 y=5 width=200 height=450.
    target_svg: Optional[Tag] = None
    for svg in sec.find_all("svg"):
        rects = svg.find_all("rect")
        for r in rects:
            if (_f(r.get("x")) == 5.0 and _f(r.get("y")) == 5.0
                    and _f(r.get("width")) == 200.0 and _f(r.get("height")) == 450.0):
                target_svg = svg
                break
        if target_svg is not None:
            break
    if target_svg is None:
        return []

    throws: list[FieldMapThrow] = []
    for idx, g in enumerate(target_svg.find_all("g")):
        rect = g.find("rect")
        circle = g.find("circle")
        line = g.find("line")
        if rect is None and circle is None and line is None:
            continue
        # Origin = rect center (rect is small marker square)
        if rect is not None:
            rx = _f(rect.get("x"))
            ry = _f(rect.get("y"))
            rw = _f(rect.get("width")) or 0.0
            rh = _f(rect.get("height")) or 0.0
            if rx is None or ry is None:
                continue
            ox = rx + rw / 2.0
            oy = ry + rh / 2.0
            origin_color = (rect.get("fill") or rect.get("stroke") or "").lower()
        elif line is not None:
            ox = _f(line.get("x1"))
            oy = _f(line.get("y1"))
            origin_color = (line.get("stroke") or "").lower()
        else:
            continue

        if circle is not None:
            cx = _f(circle.get("cx"))
            cy = _f(circle.get("cy"))
            recv_color = (circle.get("fill") or circle.get("stroke") or "").lower()
        else:
            cx = cy = None
            recv_color = None

        line_color = (line.get("stroke") or "").lower() if line is not None else ""

        outcome = _classify_outcome(origin_color, line_color, recv_color, has_circle=circle is not None)

        # Skip non-field markers (legend, etc.) by bounds-checking.
        if ox is None or oy is None:
            continue
        if not (SVG_FIELD_X_MIN - 5 <= ox <= SVG_FIELD_X_MAX + 5):
            continue
        if not (SVG_FIELD_Y_MIN - 5 <= oy <= SVG_FIELD_Y_MAX + 5):
            continue

        nx = (ox - SVG_FIELD_X_MIN) / SVG_FIELD_WIDTH
        ny = (SVG_FIELD_Y_MAX - oy) / SVG_FIELD_HEIGHT  # flip: scoring at top→1

        if cx is not None and cy is not None:
            rnx: Optional[float] = (cx - SVG_FIELD_X_MIN) / SVG_FIELD_WIDTH
            rny: Optional[float] = (SVG_FIELD_Y_MAX - cy) / SVG_FIELD_HEIGHT
        else:
            rnx = rny = None

        throws.append(FieldMapThrow(
            team=team,
            sequence_idx=idx,
            throw_x=round(_clamp01(nx), 5),
            throw_y=round(_clamp01(ny), 5),
            recv_x=round(_clamp01(rnx), 5) if rnx is not None else None,
            recv_y=round(_clamp01(rny), 5) if rny is not None else None,
            outcome=outcome,
            raw_origin_color=origin_color,
            raw_line_color=line_color,
            raw_recv_color=recv_color,
        ))
    return throws


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def _classify_outcome(origin: str, line: str, recv: Optional[str], *, has_circle: bool) -> str:
    """Per build_guide.md §3a Section 4 color encoding."""
    if "green" in (origin, line) or recv == "green":
        return "score"
    if not has_circle:
        # No receiver → throwaway
        return "throwaway"
    if line == "red" and recv == "red":
        return "drop"
    if line == "lightblue" or origin == "lightblue":
        return "complete"
    # Fallback
    return "complete"


# -----------------------------------------------------------------------
# Play-by-play parsing
# -----------------------------------------------------------------------

_QUARTER_HEADINGS = {
    "first quarter": 1, "second quarter": 2, "third quarter": 3, "fourth quarter": 4,
}

# Event-text patterns. Order matters: more specific first.
_EVENT_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("dropped_huck",   re.compile(r"^Dropped huck from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
    ("dropped",        re.compile(r"^Dropped pass from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
    ("huck_throwaway", re.compile(r"^Huck throwaway from\s+(?P<thrower>.+)$", re.I)),
    ("throwaway",      re.compile(r"^Throwaway from\s+(?P<thrower>.+)$", re.I)),
    ("callahan",       re.compile(r"^Callahan Thrown from\s+(?P<thrower>.+)$", re.I)),
    ("score",          re.compile(r"^Score from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
    ("huck",           re.compile(r"^Huck from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
    ("swing",          re.compile(r"^Swing from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
    ("dump",           re.compile(r"^Dump from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
    ("dish",           re.compile(r"^Dish from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
    ("pass",           re.compile(r"^Pass from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
    ("pull",           re.compile(r"^Pull by\s+(?P<thrower>.+)$", re.I)),
    ("block",          re.compile(r"^Block by\s+(?P<thrower>.+)$", re.I)),
    ("timeout",        re.compile(r"^Timeout", re.I)),
    ("injury",         re.compile(r"^Injury", re.I)),
]

_THROW_EVENT_TYPES = {
    "pass", "swing", "dump", "dish", "huck", "score",
    "dropped", "dropped_huck", "throwaway", "huck_throwaway", "callahan",
}


def parse_play_by_play(soup: BeautifulSoup) -> list[PbpEvent]:
    sec = _section(soup, "pbp")
    out: list[PbpEvent] = []
    if sec is None:
        return out

    # Walk the section linearly, tracking the current quarter / point context.
    quarter = 0
    point_idx = -1
    point_score: Optional[str] = None
    line_type: Optional[str] = None
    point_clock: Optional[str] = None
    point_duration: Optional[str] = None
    roster: list[str] = []
    event_idx = 0

    for el in sec.descendants:
        if not isinstance(el, Tag):
            continue
        cls = " ".join(el.get("class") or [])

        # Quarter heading (h3 with "First Quarter" etc.)
        if el.name in {"h3", "h4"}:
            txt = el.get_text(strip=True).lower()
            if txt in _QUARTER_HEADINGS:
                quarter = _QUARTER_HEADINGS[txt]
                point_idx = -1
            continue

        if "play-by-play-score" in cls:
            # New point starts.
            point_idx += 1
            event_idx = 0
            point_score = el.get_text(strip=True)
            line_type = None
            point_clock = None
            point_duration = None
            roster = []
            continue
        if "play-by-play-is-o-line" in cls:
            line_type = el.get_text(strip=True)
            continue
        if "play-by-play-clock" in cls:
            point_clock = el.get_text(strip=True)
            continue
        if "play-by-play-length" in cls:
            point_duration = el.get_text(strip=True)
            continue
        if "play-by-play-roster" in cls:
            roster = [n.strip() for n in el.get_text(",", strip=True).split(",") if n.strip()]
            continue

        # Match the event container only — its children (.event-icon,
        # .event-distance, .event-label) all share the "play-by-play-event"
        # class prefix, so require the exact bare class.
        if "play-by-play-event" in (el.get("class") or []):
            label_node = el.find(class_="play-by-play-event-label")
            text = label_node.get_text(" ", strip=True) if label_node else el.get_text(" ", strip=True)
            dist_node = el.find(class_="play-by-play-event-distance")
            distance: Optional[int] = None
            if dist_node is not None:
                dt = dist_node.get_text(strip=True)
                m = re.match(r"(-?\d+)\s*y", dt, re.I)
                if m:
                    distance = int(m.group(1))

            ev_type, thrower, receiver = _classify_event_text(text)
            out.append(PbpEvent(
                quarter=quarter,
                point_idx=max(point_idx, 0),
                point_score=point_score or "",
                line_type=line_type,
                point_clock=point_clock,
                point_duration=point_duration,
                roster=list(roster),
                event_idx=event_idx,
                event_text=text,
                distance_yards=distance,
                throw_type=ev_type,
                thrower=thrower,
                receiver=receiver,
            ))
            event_idx += 1
    return out


def _classify_event_text(text: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    for ev_type, pat in _EVENT_PATTERNS:
        m = pat.match(text)
        if m:
            gd = m.groupdict()
            return ev_type, gd.get("thrower"), gd.get("receiver")
    return None, None, None


# -----------------------------------------------------------------------
# PBP ↔ Field Map join
# -----------------------------------------------------------------------

def join_pbp_to_field_map(
    pbp: list[PbpEvent],
    field_throws: list[FieldMapThrow],
    team_name: str,
    team_roster_names: set[str],
) -> list[dict]:
    """Pair per-team PBP throw events with SVG field-map throws by index.

    Both lists are emitted from the source as-is. We do a plain positional
    zip — no outcome remapping, no look-ahead. PBP fields are written to
    `pbp_*` keys (verbatim) and SVG fields to `svg_*` keys (verbatim) so
    nothing is fabricated when the two lists disagree.

    join_confidence:
      - "high"  if len(pbp) == len(svg)
      - "low"   if they differ (lists are still zipped to min length;
                 unpaired tail items appear with the missing side null)
    """
    team_pbp = [e for e in pbp
                if e.throw_type in _THROW_EVENT_TYPES
                and e.thrower is not None
                and _name_belongs_to_team(e, team_roster_names)]

    n_pbp = len(team_pbp)
    n_svg = len(field_throws)
    confidence = "high" if n_pbp == n_svg else "low"
    n = max(n_pbp, n_svg)

    joined: list[dict] = []
    for i in range(n):
        ev = team_pbp[i] if i < n_pbp else None
        ft = field_throws[i] if i < n_svg else None

        joined.append({
            "throw_id": (
                f"{team_name}-q{ev.quarter}-p{ev.point_idx}-e{ev.event_idx}"
                if ev is not None else f"{team_name}-svg-only-{i}"
            ),
            "team": team_name,
            # PBP fields, verbatim
            "pbp_thrower":      ev.thrower         if ev else None,
            "pbp_receiver":     ev.receiver        if ev else None,
            "pbp_throw_type":   ev.throw_type      if ev else None,
            "pbp_event_text":   ev.event_text      if ev else None,
            "pbp_distance_yards": ev.distance_yards if ev else None,
            "pbp_quarter":      ev.quarter         if ev else None,
            "pbp_point_idx":    ev.point_idx       if ev else None,
            "pbp_point_score":  ev.point_score     if ev else None,
            "pbp_line_type":    ev.line_type       if ev else None,
            # SVG fields, verbatim
            "svg_throw_x":  ft.throw_x  if ft else None,
            "svg_throw_y":  ft.throw_y  if ft else None,
            "svg_recv_x":   ft.recv_x   if ft else None,
            "svg_recv_y":   ft.recv_y   if ft else None,
            "svg_outcome":  ft.outcome  if ft else None,
            "join_confidence": confidence,
        })

    return joined


def _name_belongs_to_team(ev: PbpEvent, roster: set[str]) -> bool:
    if not roster:
        return True  # no roster filter available
    return ev.thrower in roster or _last_name(ev.thrower) in {_last_name(n) for n in roster}


def _last_name(full: Optional[str]) -> str:
    if not full:
        return ""
    return full.strip().split()[-1]


# -----------------------------------------------------------------------
# Top-level driver
# -----------------------------------------------------------------------

def parse_team_codes_from_slug(slug: str) -> tuple[str, str]:
    # 2025-07-26-MAD-MIN → ("MAD", "MIN")
    parts = slug.split("-")
    if len(parts) >= 5:
        return parts[-2], parts[-1]
    return "AWAY", "HOME"


async def scrape_game(slug: str, *, use_cached: bool = False) -> dict[str, Any]:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    cache_dir = RAW_DIR / slug
    cache_dir.mkdir(parents=True, exist_ok=True)
    snapshots: dict[str, str]
    if use_cached and (cache_dir / "default.html").exists():
        snapshots = {p.stem: p.read_text(encoding="utf-8") for p in cache_dir.glob("*.html")}
    else:
        print(f"[scrape] rendering {slug} …")
        snapshots = await render_game_html(slug)
        for label, html in snapshots.items():
            (cache_dir / f"{label}.html").write_text(html, encoding="utf-8")
        print(f"[scrape] cached {len(snapshots)} snapshot(s) to {cache_dir}")

    base_html = snapshots.get("default") or next(iter(snapshots.values()))
    base = BeautifulSoup(base_html, "lxml")

    code_a, code_b = parse_team_codes_from_slug(slug)
    teams = [code_a, code_b]

    box = parse_box_score(base)
    team_stats = parse_team_stats(base, teams)
    players = parse_player_stats(base, slug)

    # Per-team field map. Use the team-specific snapshots captured by
    # render_game_html (one click per team button). If no team-specific
    # snapshot exists, fall back to the default render.
    team_codes = [k for k in snapshots.keys()
                  if k != "default" and not k.startswith("pbp__")]
    if not team_codes:
        team_codes = teams
    team_field_throws: dict[str, list[FieldMapThrow]] = {}
    for team in team_codes:
        html = snapshots.get(team) or base_html
        team_field_throws[team] = parse_field_map_svg(html, team)

    # Per-team PBP. The play-by-play section also filters to one team at a
    # time; we captured `pbp__<TEAM>` snapshots for each. Fall back to the
    # default render if missing.
    team_pbp: dict[str, list[PbpEvent]] = {}
    all_pbp: list[PbpEvent] = []
    for team in team_codes:
        snap = snapshots.get(f"pbp__{team}")
        if snap is None:
            # Fall back to the default; tag every event as this team only if
            # it's the only team available.
            snap = base_html
        team_soup = BeautifulSoup(snap, "lxml")
        events = parse_play_by_play(team_soup)
        team_pbp[team] = events
        all_pbp.extend(events)

    # Build per-team rosters from player stats.
    rosters: dict[str, set[str]] = {}
    for ps in players:
        rosters.setdefault(ps.team, set()).add(ps.name)

    joined_throws: list[dict] = []
    for team in team_codes:
        ft = team_field_throws.get(team, [])
        events = team_pbp.get(team, [])
        joined_throws.extend(
            join_pbp_to_field_map(events, ft, team, rosters.get(team, set()))
        )

    # Use the merged PBP (both teams) as the canonical event log.
    pbp = all_pbp

    summary = {
        "game_slug": slug,
        "teams": teams,
        "box_score_rows": len(box),
        "team_stats_rows": len(team_stats),
        "player_stats_rows": len(players),
        "pbp_events": len(pbp),
        "field_map_throws_per_team": {t: len(v) for t, v in team_field_throws.items()},
        "joined_throws": len(joined_throws),
        "low_confidence_joins": sum(1 for j in joined_throws if j.get("join_confidence") == "low"),
    }

    out = {
        "meta": {"game_slug": slug, "teams": teams},
        "box_score": [asdict(b) for b in box],
        "team_stats": [asdict(t) for t in team_stats],
        "player_stats": [asdict(p) for p in players],
        "pbp": [asdict(e) for e in pbp],
        "field_map": {t: [asdict(x) for x in v] for t, v in team_field_throws.items()},
        "throws": joined_throws,
        "summary": summary,
    }

    proc_path = PROCESSED_DIR / f"{slug}.json"
    proc_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"[scrape] wrote {proc_path}")
    print(f"[scrape] summary: {json.dumps(summary, indent=2)}")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape a single UFA game.")
    parser.add_argument("--game", required=True, help="Game slug, e.g. 2025-07-26-MAD-MIN")
    parser.add_argument("--use-cached", action="store_true",
                        help="Reuse cached HTML under data/raw/ufa/<slug>/ if present.")
    args = parser.parse_args()
    asyncio.run(scrape_game(args.game, use_cached=args.use_cached))


if __name__ == "__main__":
    main()
