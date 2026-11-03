"""Normalize UFA advanced-stats API payloads → canonical throw rows.

Reads ``data/raw/ufa_api/<slug>.json`` (produced by ``ufa_discover.py``)
and emits ``data/processed/ufa/<slug>__throws.json`` whose schema is
identical to the legacy Playwright scraper output so that
``export_static_bundle.py`` can consume both interchangeably.

Event-type mapping (reverse-engineered from sample data — see
``decode notes.md`` if needed):

    1, 2, 40, 41   lineup set (O / D)             → reset possession
    3              SCORE catch         (r,x,y,ms) → emit row outcome='score'
    20             pass catch          (r,x,y,s)  → emit row outcome='pass'
    22             pull                (r,x,y,s)  → reset (we're on D)
    4              pull caught         (r,x,y)    → start possession
    5              score acknowledgement (r)      → ignored (t=3 already emitted)
    8              drop                (x,y)      → emit row outcome='drop'
    19             throwaway           (r,x,y)    → emit row outcome='throwaway'
    33             stall               (r,x,y)    → emit row outcome='stall'
    7              opponent callahan   (x,y,s)    → emit row outcome='callahan'
    9-15,21,23-26,42,43,50,53,54  period/timeout → reset

Field coords (UFA canonical):
    x ∈ [-FW/2, +FW/2] yards (sideline-to-sideline; FW=53.333)
    y ∈ [0, FL] yards (full field including end zones; FL=120)
Both are normalized to [0, 1] in the output rows so the existing
frontend pipeline keeps working unchanged.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "data" / "raw" / "ufa_api"
PROC_DIR = REPO_ROOT / "data" / "processed" / "ufa"

FW = 53.3333  # yards (sideline-to-sideline)
FL = 120.0    # yards (full field with end zones)

# Event-type sets.
# Lineup-only events (1=O-line set, 2=D-line set, 40/41=period flags). These
# can appear *between* the last t=20 of a possession and a subsequent t=3
# score event — the score's thrower has to be inherited from prev, so lineup
# events MUST NOT reset prev.
LINEUP_TYPES: set[int] = set()
# Resets that DO terminate a possession (timeouts, period ends, injuries,
# stoppages). t=22 is intentionally *not* in here: a t=22 own-pull happens
# right after a score and the *following* t=3 needs prev intact to know who
# threw the scoring pass.
RESET_TYPES = {9, 10, 11, 12, 13, 14, 15, 21, 23, 24, 25, 26,
               42, 43, 50, 53, 54}


def _norm_x(x: float | None) -> float | None:
    if x is None:
        return None
    n = (float(x) + FW / 2.0) / FW
    return round(max(0.0, min(1.0, n)), 5)


def _norm_y(y: float | None) -> float | None:
    if y is None:
        return None
    n = float(y) / FL
    return round(max(0.0, min(1.0, n)), 5)


def _build_roster(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for r in raw:
        pid = r.get("id")
        p = r.get("player", {}) or {}
        first = (p.get("first_name") or "").strip()
        last  = (p.get("last_name")  or "").strip()
        name = (last or first or str(pid)).strip()
        jersey_raw = r.get("jersey_number")
        try:
            jersey = int(jersey_raw) if jersey_raw not in (None, "", "-") else None
        except (TypeError, ValueError):
            jersey = None
        out.append({
            "id": str(pid),
            "name": name,
            "first_name": first or None,
            "last_name": last or None,
            "jersey": jersey,
        })
    return out


def _emit_team_throws(events: list[dict[str, Any]], team_abbrev: str
                      ) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Walk a single team's tsg event list and emit canonical throw rows."""
    rows: list[dict[str, Any]] = []
    counts = {"pass": 0, "score": 0, "drop": 0, "throwaway": 0,
              "stall": 0, "callahan": 0}
    prev: tuple[int, float, float] | None = None  # (player_id, x, y)

    def add(thrower: int | None, receiver: int | None,
            tx: float | None, ty: float | None,
            rx: float | None, ry: float | None,
            outcome: str) -> None:
        rows.append({
            "Team": team_abbrev,
            "Thrower_ID": thrower,
            "Receiver_ID": receiver,
            "Event_Outcome": outcome,
            "Thrower_X": _norm_x(tx),
            "Thrower_Y": _norm_y(ty),
            "Receiver_X": _norm_x(rx),
            "Receiver_Y": _norm_y(ry),
            "Thrower_color": "lightblue",
            "Receiver_color": "white",
        })
        counts[outcome] += 1

    for ev in events:
        t = ev.get("t")
        if t in LINEUP_TYPES or t in RESET_TYPES:
            prev = None
            continue
        x = ev.get("x"); y = ev.get("y"); r = ev.get("r")
        if t == 4:  # pull caught — start of possession at (x,y) by r
            if r is not None and x is not None and y is not None:
                prev = (int(r), float(x), float(y))
            continue
        if t == 20:  # pass catch
            if r is None or x is None or y is None:
                continue
            if prev is not None:
                add(prev[0], int(r), prev[1], prev[2], float(x), float(y), "pass")
            prev = (int(r), float(x), float(y))
            continue
        if t == 3:   # score catch
            if r is None or x is None or y is None:
                continue
            if prev is not None:
                add(prev[0], int(r), prev[1], prev[2], float(x), float(y), "score")
            else:
                # No tracked thrower (rare); record as receiver-only score row.
                add(None, int(r), None, None, float(x), float(y), "score")
            prev = None
            continue
        if t == 8:   # throwaway (thrown into space, no receiver — disc landed at x,y)
            tx = prev[1] if prev else None
            ty = prev[2] if prev else None
            thrower = prev[0] if prev else None
            add(thrower, None, tx, ty,
                float(x) if x is not None else None,
                float(y) if y is not None else None,
                "throwaway")
            prev = None
            continue
        if t == 19:  # drop — r=intended receiver, (x,y)=their position
            if prev is None or x is None or y is None:
                prev = None
                continue
            recv = int(r) if r is not None else None
            add(prev[0], recv, prev[1], prev[2], float(x), float(y), "drop")
            prev = None
            continue
        if t == 33:  # stall (thrower r stalled at x,y)
            if r is None:
                prev = None
                continue
            xx = float(x) if x is not None else (prev[1] if prev else None)
            yy = float(y) if y is not None else (prev[2] if prev else None)
            add(int(r), None, xx, yy, xx, yy, "stall")
            prev = None
            continue
        if t == 7:   # opponent callahan (catch in our defending end zone)
            tx = prev[1] if prev else None
            ty = prev[2] if prev else None
            thrower = prev[0] if prev else None
            add(thrower, None, tx, ty,
                float(x) if x is not None else None,
                float(y) if y is not None else None,
                "callahan")
            prev = None
            continue
        # other event types (5 score-ack, 6 block, etc.) ignored
    return rows, counts


def normalize_game(slug: str) -> dict[str, Any]:
    raw_path = RAW_DIR / f"{slug}.json"
    if not raw_path.exists():
        raise FileNotFoundError(raw_path)
    payload = json.loads(raw_path.read_text(encoding="utf-8"))
    if "game" not in payload or "tsgHome" not in payload:
        raise ValueError(f"{slug}: payload missing game/tsg blocks")
    game = payload["game"]
    home_abbrev = game["team_season_home"]["abbrev"]
    away_abbrev = game["team_season_away"]["abbrev"]

    home_roster = _build_roster(payload.get("rostersHome", []))
    away_roster = _build_roster(payload.get("rostersAway", []))

    home_events_raw = payload["tsgHome"].get("events") or "[]"
    away_events_raw = payload["tsgAway"].get("events") or "[]"
    home_events = json.loads(home_events_raw) if isinstance(home_events_raw, str) \
        else home_events_raw
    away_events = json.loads(away_events_raw) if isinstance(away_events_raw, str) \
        else away_events_raw

    home_rows, home_counts = _emit_team_throws(home_events, home_abbrev)
    away_rows, away_counts = _emit_team_throws(away_events, away_abbrev)

    out = {
        "game_slug": slug,
        "rosters": {
            home_abbrev: home_roster,
            away_abbrev: away_roster,
        },
        "rows": home_rows + away_rows,
        "diagnostics": {
            "source": "ufa_api",
            "home": {"team": home_abbrev, **home_counts,
                     "total": sum(home_counts.values())},
            "away": {"team": away_abbrev, **away_counts,
                     "total": sum(away_counts.values())},
        },
    }
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--game", help="Single game slug (e.g. 2025-07-26-MAD-MIN)")
    ap.add_argument("--years", nargs="*", type=int, default=None,
                    help="Limit normalization to these seasons (default: all).")
    ap.add_argument("--all", action="store_true",
                    help="Normalize every game found in data/raw/ufa_api/.")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    PROC_DIR.mkdir(parents=True, exist_ok=True)

    if args.game:
        slugs = [args.game]
    else:
        all_slugs = [p.stem for p in RAW_DIR.glob("*.json")
                     if p.stem != "_index"]
        if args.years:
            ys = {str(y) for y in args.years}
            slugs = [s for s in all_slugs if s.split("-", 1)[0] in ys]
        else:
            slugs = all_slugs
        slugs.sort()

    n_ok = n_err = 0
    totals = {"pass": 0, "score": 0, "drop": 0, "throwaway": 0,
              "stall": 0, "callahan": 0}
    by_year: dict[str, dict[str, int]] = {}
    for i, slug in enumerate(slugs, 1):
        try:
            out = normalize_game(slug)
        except Exception as exc:                                   # noqa: BLE001
            n_err += 1
            print(f"[normalize] {slug}: {exc}", file=sys.stderr)
            continue
        (PROC_DIR / f"{slug}__throws.json").write_text(
            json.dumps(out, indent=2), encoding="utf-8")
        n_ok += 1
        for t in (out["diagnostics"]["home"], out["diagnostics"]["away"]):
            for k in totals:
                totals[k] += t[k]
        yr = slug[:4]
        ybucket = by_year.setdefault(yr, {"games": 0, "rows": 0})
        ybucket["games"] += 1
        ybucket["rows"] += len(out["rows"])
        if not args.quiet and (i % 100 == 0 or i == len(slugs)):
            print(f"[normalize] {i}/{len(slugs)} (ok={n_ok} err={n_err})")

    print(f"[normalize] done: ok={n_ok} err={n_err}")
    print(f"[normalize] outcomes: {totals}")
    print(f"[normalize] per-year: {by_year}")
    return 0 if n_err == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
