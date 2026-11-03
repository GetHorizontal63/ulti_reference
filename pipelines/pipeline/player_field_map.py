"""Per-player field-map extractor.

The UFA stats page exposes a player checkbox filter on the field map. With
exactly ONE player selected, every SVG marker is an event involving that
player as either the thrower or the receiver. Which role they played is
encoded by which end of the line is filled in the team color (the other
end is white/hollow). The line color encodes the outcome.

This module:
  1) Reads the player roster + IDs from the field-map filter checkboxes.
  2) Parses one player-filtered SVG into structured rows.
  3) Walks the team's play-by-play to attach Period/Line/partner-name to
     each row by chronological position.

It does NOT run the browser. The caller is expected to have already
captured one HTML snapshot per player (one render with that player's
checkbox the only one ticked). See ``pipeline.ufa_scraper`` for the
Playwright driver.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

from bs4 import BeautifulSoup, Tag

# SVG field rect: x=5, y=5, width=200, height=450.
SVG_X_MIN, SVG_Y_MIN = 5.0, 5.0
SVG_X_MAX, SVG_Y_MAX = 205.0, 455.0
SVG_W, SVG_H = SVG_X_MAX - SVG_X_MIN, SVG_Y_MAX - SVG_Y_MIN

# Outcome derivation rules (per user, verbatim):
#   blue  line + circle filled    -> 'pass' (complete)
#   green line + circle           -> 'score'
#   red   line + circle           -> 'drop'
#   red   line, no circle         -> 'throwaway'
#   no line, purple square        -> 'stall'
#   darkred line, no circle       -> 'callahan'
def _classify_outcome(line_stroke: str, has_circle: bool,
                      rect_fill: str) -> str:
    line_stroke = (line_stroke or "").lower()
    rect_fill   = (rect_fill   or "").lower()

    # Stall: no line, purple marker.
    if not line_stroke and "purple" in rect_fill:
        return "stall"

    if "green" in line_stroke:
        return "score"
    if "darkred" in line_stroke or "maroon" in line_stroke:
        return "callahan"
    if line_stroke == "red" or line_stroke.startswith("#db28") or line_stroke == "#db2828":
        return "drop" if has_circle else "throwaway"
    if "blue" in line_stroke:
        return "pass"
    if not line_stroke:
        # No line + no purple already handled → unknown.
        return "unknown"
    return "unknown"


@dataclass
class FieldMapRow:
    period:        Optional[int]
    team:          str
    thrower_id:    Optional[str]
    receiver_id:   Optional[str]
    thrower_name:  Optional[str]
    receiver_name: Optional[str]
    event_outcome: str
    line:          Optional[str]
    thrower_x:     Optional[float]
    thrower_y:     Optional[float]
    receiver_x:    Optional[float]
    receiver_y:    Optional[float]
    thrower_color: Optional[str]
    receiver_color: Optional[str]
    selected_player_role: str   # 'thrower' or 'receiver' or 'self_only'
    raw_line_color:        str
    raw_rect_fill:         str
    raw_circle_fill:       Optional[str]


# -----------------------------------------------------------------------
# Field-map filter: roster + player ids
# -----------------------------------------------------------------------

def parse_field_map_roster(html: str) -> list[dict]:
    """Return [{id, name, jersey}, ...] from the field-map player filter."""
    soup = BeautifulSoup(html, "lxml")
    fm = soup.select_one(".field-map")
    if fm is None:
        return []
    out: list[dict] = []
    # The field-map filter has FOUR `.grouped.fields` blocks: Player, Event,
    # Line, Period — in that DOM order. The Player group is the first one,
    # identified by the "Select Player" header.
    player_group = None
    for g in fm.select(".grouped.fields"):
        hdr = g.select_one(".info-header")
        if hdr and "select player" in hdr.get_text(strip=True).lower():
            player_group = g
            break
    if player_group is None:
        return []
    for cb in player_group.select(".ui.checkbox"):
        inp = cb.find("input")
        lab = cb.find("label")
        if inp is None or lab is None:
            continue
        pid = inp.get("value")
        if not pid:
            continue
        text = lab.get_text(strip=True)
        m = re.match(r"^(.*?)\s*\((\d+)\)\s*$", text)
        if m:
            name = m.group(1).strip()
            jersey = int(m.group(2))
        else:
            name = text
            jersey = None
        out.append({"id": pid, "name": name, "jersey": jersey})
    return out


def parse_active_team(html: str) -> Optional[str]:
    """The currently active team button label (e.g. 'MAD')."""
    soup = BeautifulSoup(html, "lxml")
    fm = soup.select_one(".field-map")
    if fm is None:
        return None
    btn = fm.select_one(".ui.buttons button.active")
    return btn.get_text(strip=True) if btn else None


# -----------------------------------------------------------------------
# SVG marker parser
# -----------------------------------------------------------------------

def _f(s) -> Optional[float]:
    if s is None:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _norm_xy(x: float, y: float) -> tuple[float, float]:
    """Return raw SVG pixel coordinates unchanged.
    The frontend constructs its own field geometry using the known SVG
    viewport (field rect x=5..205, y=5..455) and maps pixels to yards
    directly, so no normalization is needed here.
    """
    return round(x, 5), round(y, 5)


def _is_filled(fill: Optional[str]) -> bool:
    if not fill:
        return False
    f = fill.lower()
    return f not in ("", "white", "none")


def parse_player_svg_markers(html: str) -> list[dict]:
    """Parse the field-map SVG (with one player filtered) into raw markers."""
    soup = BeautifulSoup(html, "lxml")
    fm = soup.select_one(".field-map")
    if fm is None:
        return []
    target: Optional[Tag] = None
    for svg in fm.find_all("svg"):
        for r in svg.find_all("rect"):
            if (_f(r.get("x")) == 5.0 and _f(r.get("y")) == 5.0
                    and _f(r.get("width")) == 200.0
                    and _f(r.get("height")) == 450.0):
                target = svg
                break
        if target is not None:
            break
    if target is None:
        return []

    markers: list[dict] = []
    for g in target.find_all("g"):
        rect   = g.find("rect")
        circle = g.find("circle")
        line   = g.find("line")
        if rect is None and circle is None and line is None:
            continue

        # Origin (rect = thrower position).
        if rect is not None:
            rx = _f(rect.get("x"))
            ry = _f(rect.get("y"))
            rw = _f(rect.get("width")) or 0.0
            rh = _f(rect.get("height")) or 0.0
            if rx is None or ry is None:
                continue
            ox, oy = rx + rw / 2.0, ry + rh / 2.0
            rect_fill   = (rect.get("fill") or "").lower()
            rect_stroke = (rect.get("stroke") or "").lower()
        else:
            continue  # without a rect, we can't anchor a thrower position

        # Receiver: prefer circle (complete/score/drop), fall back to
        # the far end of the line for no-circle throws (throwaway, callahan).
        if circle is not None:
            cx = _f(circle.get("cx"))
            cy = _f(circle.get("cy"))
            circle_fill   = (circle.get("fill")   or "").lower()
            circle_stroke = (circle.get("stroke") or "").lower()
        elif line is not None:
            # Line x1/y1 is the thrower end; x2/y2 is the throw destination.
            # Verify by checking which end is closer to the rect center.
            lx1, ly1 = _f(line.get("x1")), _f(line.get("y1"))
            lx2, ly2 = _f(line.get("x2")), _f(line.get("y2"))
            if lx1 is not None and lx2 is not None:
                d1 = (lx1 - ox) ** 2 + (ly1 - oy) ** 2
                d2 = (lx2 - ox) ** 2 + (ly2 - oy) ** 2
                # Whichever end is farther from the thrower rect is the destination.
                cx, cy = (lx2, ly2) if d2 >= d1 else (lx1, ly1)
            else:
                cx = cy = None
            circle_fill = None
            circle_stroke = None
        else:
            cx = cy = None
            circle_fill = None
            circle_stroke = None

        line_stroke = (line.get("stroke") or "").lower() if line is not None else ""

        # Bounds-check the rect (skip legend / decoration).
        if not (SVG_X_MIN - 5 <= ox <= SVG_X_MAX + 5):
            continue
        if not (SVG_Y_MIN - 5 <= oy <= SVG_Y_MAX + 5):
            continue

        tx, ty = _norm_xy(ox, oy)
        rxn = ryn = None
        if cx is not None and cy is not None:
            rxn, ryn = _norm_xy(cx, cy)

        rect_filled  = _is_filled(rect_fill)
        circle_filled = _is_filled(circle_fill) if circle is not None else False

        if rect_filled and not circle_filled:
            role = "thrower"
        elif circle_filled and not rect_filled:
            role = "receiver"
        elif circle is None and rect_filled:
            # No circle (throwaway/callahan/stall) — selected player threw it.
            role = "thrower"
        else:
            # Both filled, or neither: unable to tell → flag it.
            role = "ambiguous"

        outcome = _classify_outcome(line_stroke, has_circle=circle is not None,
                                    rect_fill=rect_fill)

        markers.append({
            "thrower_x": tx, "thrower_y": ty,
            "receiver_x": rxn, "receiver_y": ryn,
            "rect_fill": rect_fill or None,
            "rect_stroke": rect_stroke or None,
            "circle_fill": circle_fill,
            "circle_stroke": circle_stroke,
            "line_stroke": line_stroke or None,
            "selected_role": role,
            "outcome": outcome,
        })
    return markers


# -----------------------------------------------------------------------
# Play-by-play walk
# -----------------------------------------------------------------------

_QUARTER_MAP = {"First": 1, "Second": 2, "Third": 3, "Fourth": 4,
                "Overtime": 5, "Double Overtime": 6}

# Throw events in PBP that involve a thrower (and usually a receiver).
_THROW_EVENT_PATTERNS = [
    ("dropped_huck",   re.compile(r"^Dropped huck from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
    ("dropped",        re.compile(r"^Dropped pass from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
    ("huck_throwaway", re.compile(r"^Huck throwaway from\s+(?P<thrower>.+)$", re.I)),
    ("throwaway",      re.compile(r"^Throwaway from\s+(?P<thrower>.+)$", re.I)),
    ("callahan_thrown",re.compile(r"^Callahan Thrown from\s+(?P<thrower>.+)$", re.I)),
    ("stalled_out",    re.compile(r"^Stalled out from\s+(?P<thrower>.+)$", re.I)),
    ("score",          re.compile(r"^Score from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
    ("huck",           re.compile(r"^Huck from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
    ("swing",          re.compile(r"^Swing from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
    ("dump",           re.compile(r"^Dump from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
    ("dish",           re.compile(r"^Dish from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
    ("pass",           re.compile(r"^Pass from\s+(?P<thrower>.+?)\s+to\s+(?P<receiver>.+)$", re.I)),
]


@dataclass
class PbpThrow:
    quarter:    Optional[int]
    line:       Optional[str]   # 'O-Line' / 'D-Line'
    score:      Optional[str]
    event_text: str
    throw_type: str
    thrower:    Optional[str]
    receiver:   Optional[str]


def parse_team_pbp(html: str) -> list[PbpThrow]:
    """Walk the PBP section in DOM order, emitting one PbpThrow per throw."""
    soup = BeautifulSoup(html, "lxml")
    sec = soup.select_one(".play-by-play")
    if sec is None:
        return []

    out: list[PbpThrow] = []
    quarter: Optional[int] = None
    line: Optional[str] = None
    score: Optional[str] = None

    for el in sec.descendants:
        name = getattr(el, "name", None)
        cls = el.get("class") if name else None
        cls_set = set(cls) if cls else set()

        if name == "h3" and "play-by-play-quarter-header" in cls_set:
            txt = el.get_text(strip=True)
            for label, num in _QUARTER_MAP.items():
                if txt.startswith(label):
                    quarter = num
                    break

        if name == "div" and "title" in cls_set and "play-by-play-point" in cls_set:
            line_el = el.select_one(".play-by-play-is-o-line, .play-by-play-is-d-line")
            line = line_el.get_text(strip=True) if line_el else None
            score_el = el.select_one(".play-by-play-score")
            score = score_el.get_text(strip=True) if score_el else None

        if name == "div" and "play-by-play-event-label" in cls_set:
            text = el.get_text(strip=True)
            tt, thr, rcv = _classify_event_text(text)
            if tt is None:
                continue
            out.append(PbpThrow(
                quarter=quarter, line=line, score=score,
                event_text=text, throw_type=tt,
                thrower=thr, receiver=rcv,
            ))
    return out


def _classify_event_text(text: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    for tt, pat in _THROW_EVENT_PATTERNS:
        m = pat.match(text)
        if m:
            gd = m.groupdict()
            return tt, gd.get("thrower"), gd.get("receiver")
    return None, None, None


# -----------------------------------------------------------------------
# Join: SVG markers (filtered to one player) + team PBP
# -----------------------------------------------------------------------

def build_player_rows(
    *,
    player_id: str,
    player_name: str,
    team: str,
    field_map_html: str,
    team_pbp_html: str,
    name_to_id: dict[str, str],
) -> list[FieldMapRow]:
    """Combine one player's filtered SVG with the team's PBP into rows."""
    markers = parse_player_svg_markers(field_map_html)

    # PBP rows where this player is the thrower OR receiver.
    pbp_all = parse_team_pbp(team_pbp_html)
    last = _last_name(player_name)
    pbp_player = [p for p in pbp_all
                  if (p.thrower and _last_name(p.thrower) == last)
                  or (p.receiver and _last_name(p.receiver) == last)]

    rows: list[FieldMapRow] = []
    n = max(len(markers), len(pbp_player))
    for i in range(n):
        m = markers[i] if i < len(markers) else None
        p = pbp_player[i] if i < len(pbp_player) else None

        # Determine thrower / receiver names (and ids) from PBP.
        thr_name = p.thrower if p else None
        rcv_name = p.receiver if p else None

        thr_id = _resolve_id(thr_name, name_to_id)
        rcv_id = _resolve_id(rcv_name, name_to_id)

        rows.append(FieldMapRow(
            period=p.quarter if p else None,
            team=team,
            thrower_id=thr_id,
            receiver_id=rcv_id,
            thrower_name=thr_name,
            receiver_name=rcv_name,
            event_outcome=(m["outcome"] if m else (p.throw_type if p else "unknown")),
            line=p.line if p else None,
            thrower_x=m["thrower_x"]   if m else None,
            thrower_y=m["thrower_y"]   if m else None,
            receiver_x=m["receiver_x"] if m else None,
            receiver_y=m["receiver_y"] if m else None,
            thrower_color=(m["rect_fill"] or m["rect_stroke"]) if m else None,
            receiver_color=(m["circle_fill"] or m["circle_stroke"]) if m else None,
            selected_player_role=(m["selected_role"] if m else "pbp_only"),
            raw_line_color=(m["line_stroke"] or "") if m else "",
            raw_rect_fill=(m["rect_fill"] or "") if m else "",
            raw_circle_fill=(m["circle_fill"]) if m else None,
        ))
    return rows


def _last_name(full: Optional[str]) -> str:
    if not full:
        return ""
    return full.strip().split()[-1].lower()


def _resolve_id(name: Optional[str], name_to_id: dict[str, str]) -> Optional[str]:
    if not name:
        return None
    last = _last_name(name)
    # Match by last-name suffix.
    for k, v in name_to_id.items():
        if _last_name(k) == last:
            return v
    return None


def rows_to_dicts(rows: list[FieldMapRow]) -> list[dict]:
    return [asdict(r) for r in rows]


# -----------------------------------------------------------------------
# Validation CLI
# -----------------------------------------------------------------------

def _main() -> None:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--field-map-html", required=True,
                    help="HTML snapshot with ONE player selected on the field map.")
    ap.add_argument("--team-pbp-html", default=None,
                    help="HTML snapshot containing the team's PBP. Defaults to "
                         "the field-map HTML.")
    ap.add_argument("--player-name", required=True)
    ap.add_argument("--player-id", required=True)
    ap.add_argument("--team", required=True)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    fm_html = Path(args.field_map_html).read_text(encoding="utf-8")
    pbp_html = Path(args.team_pbp_html).read_text(encoding="utf-8") if args.team_pbp_html else fm_html

    roster = parse_field_map_roster(fm_html)
    name_to_id = {r["name"]: r["id"] for r in roster}

    rows = build_player_rows(
        player_id=args.player_id,
        player_name=args.player_name,
        team=args.team,
        field_map_html=fm_html,
        team_pbp_html=pbp_html,
        name_to_id=name_to_id,
    )

    payload = {
        "meta": {
            "player_id": args.player_id,
            "player_name": args.player_name,
            "team": args.team,
            "row_count": len(rows),
            "marker_count": len(parse_player_svg_markers(fm_html)),
            "pbp_match_count": sum(1 for r in rows if r.period is not None),
        },
        "rows": rows_to_dicts(rows),
    }

    out_text = json.dumps(payload, indent=2)
    if args.out:
        Path(args.out).write_text(out_text, encoding="utf-8")
        print(f"wrote {args.out}: {len(rows)} rows")
    else:
        print(out_text)


if __name__ == "__main__":
    _main()