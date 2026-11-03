"""Per-player UFA game scraper — SVG-only.

Renders the WatchUFA game page once, then iterates every player checkbox
in the field-map filter — one player at a time — capturing an HTML
snapshot per (team, player). Each snapshot is cached on disk.

ALL data comes from the SVG field map. We do NOT touch the play-by-play.

Output schema (per row, JSON):
    Team             str   ("MAD")
    Thrower_ID       int   (UFA player id; the selected player when
                            their `rect` is filled)
    Receiver_ID      int|None
    Event_Outcome    str   pass | drop | throwaway | stall | callahan | score
    Thrower_X        float (normalized 0..1)
    Thrower_Y        float
    Receiver_X       float|None
    Receiver_Y       float|None
    Thrower_color    str|None  (raw rect color)
    Receiver_color   str|None  (raw circle color)

Each event is captured ONCE — only from the thrower's filtered SVG.
Receiver_ID is resolved by coord-matching the receiver position against
all other players' filtered SVGs (the receiver's SVG will contain the
exact same marker with the inverse fill pattern).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path
from typing import Optional

from pipelines.pipeline.player_field_map import (
    parse_field_map_roster,
    parse_player_svg_markers,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "data" / "raw" / "ufa"
PROCESSED_DIR = REPO_ROOT / "data" / "processed" / "ufa"
UFA_GAME_URL = "https://www.watchufa.com/stats/game/{slug}"

# Tolerance for matching receiver coords across two filtered SVGs.
COORD_EPS = 1e-4


# -----------------------------------------------------------------------
# Cache helpers
# -----------------------------------------------------------------------

def _player_html_path(slug: str, team: str, player_id: str) -> Path:
    return RAW_DIR / slug / f"player__{team}__{player_id}.html"


def _roster_path(slug: str) -> Path:
    return RAW_DIR / slug / "rosters.json"


# -----------------------------------------------------------------------
# Playwright driver
# -----------------------------------------------------------------------

async def render_per_player_snapshots(
    slug: str,
    *,
    only_player: Optional[str] = None,
    only_team: Optional[str] = None,
    headless: bool = True,
) -> dict[str, dict]:
    from playwright.async_api import async_playwright

    url = UFA_GAME_URL.format(slug=slug)
    rosters: dict[str, list[dict]] = {}
    snapshots: dict[str, dict[str, str]] = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=headless)
        ctx = await browser.new_context(viewport={"width": 1400, "height": 1400})
        page = await ctx.new_page()
        await page.goto(url, wait_until="networkidle", timeout=60_000)
        await page.wait_for_selector("#stats-pages", timeout=60_000)
        try:
            await page.wait_for_selector("svg", timeout=30_000)
        except Exception:
            pass

        field_map = page.locator("div.field-map").first

        # Discover team codes from the field-map team-filter buttons.
        team_codes: list[str] = []
        for btn in await field_map.locator("button").all():
            label = (await btn.inner_text()).strip()
            if re.fullmatch(r"[A-Z]{2,4}", label) and label not in team_codes:
                team_codes.append(label)
        if only_team:
            team_codes = [t for t in team_codes if t == only_team]
        print(f"[scraper] teams: {team_codes}")

        for team in team_codes:
            print(f"[scraper] === team {team} ===")

            await _click_team_button(field_map, team, page)
            await asyncio.sleep(0.4)

            team_html = await page.content()
            roster = parse_field_map_roster(team_html)
            rosters[team] = roster
            print(f"[scraper] {team} roster: {len(roster)} players")

            # Field-map has FOUR filter groups in DOM order:
            #   0=Select Player, 1=Select Event, 2=Select Line, 3=Select Period
            # Make sure Event/Line/Period are fully selected and Player
            # is cleared so we can tick exactly one player at a time.
            groups = field_map.locator("div.grouped.fields")
            player_group = groups.nth(0)
            for idx, name in [(1, "Event"), (2, "Line"), (3, "Period")]:
                await _click_group_action(groups.nth(idx), "select-all", name, page)
            await _click_group_action(player_group, "deselect-all", "Player", page)

            snapshots[team] = {}
            target_players = roster
            if only_player:
                target_players = [p for p in roster if p["id"] == only_player]
                if not target_players:
                    print(f"[scraper] player {only_player} not in {team}, skipping")
                    continue

            for i, p in enumerate(target_players, 1):
                pid = p["id"]
                cache = _player_html_path(slug, team, pid)
                cache.parent.mkdir(parents=True, exist_ok=True)

                print(f"[scraper] {team} {i}/{len(target_players)} "
                      f"{p['name']} ({pid})", flush=True)

                # Semantic UI hides <input>; click the visible <label>.
                label_loc = player_group.locator(
                    f"div.ui.checkbox:has(input[value='{pid}']) label"
                ).first
                try:
                    await label_loc.click(timeout=5_000)
                except Exception as e:
                    print(f"[scraper]   ! click failed: {e}")
                    continue
                await page.wait_for_timeout(300)

                html = await page.content()
                cache.write_text(html, encoding="utf-8")
                snapshots[team][pid] = html

                try:
                    await label_loc.click(timeout=5_000)
                except Exception:
                    pass
                await page.wait_for_timeout(120)

        await browser.close()

    _roster_path(slug).parent.mkdir(parents=True, exist_ok=True)
    _roster_path(slug).write_text(json.dumps(rosters, indent=2), encoding="utf-8")

    return {"rosters": rosters, "snapshots": snapshots}


async def _click_team_button(scope, team: str, page) -> None:
    for btn in await scope.locator("button").all():
        label = (await btn.inner_text()).strip()
        if label == team:
            try:
                await btn.click(timeout=5_000)
                await page.wait_for_timeout(400)
            except Exception as e:
                print(f"[scraper]   ! team click failed: {e}")
            return


async def _click_group_action(group, action_class: str,
                              group_label: str, page) -> None:
    try:
        b = group.locator(f"div.{action_class} button").first
        await b.click(timeout=3_000)
        await page.wait_for_timeout(200)
    except Exception as e:
        print(f"[scraper]   ! group '{group_label}' .{action_class} "
              f"click failed: {e}")


# -----------------------------------------------------------------------
# Cache loader
# -----------------------------------------------------------------------

def load_cached(slug: str) -> dict[str, dict]:
    rosters_path = _roster_path(slug)
    if not rosters_path.exists():
        raise FileNotFoundError(
            f"missing roster cache at {rosters_path}; "
            f"run without --use-cached first."
        )
    rosters = json.loads(rosters_path.read_text(encoding="utf-8"))

    snapshots: dict[str, dict[str, str]] = {}
    for team, roster in rosters.items():
        snapshots[team] = {}
        for p in roster:
            pid = p["id"]
            cache = _player_html_path(slug, team, pid)
            if cache.exists():
                snapshots[team][pid] = cache.read_text(encoding="utf-8")
    return {"rosters": rosters, "snapshots": snapshots}


# -----------------------------------------------------------------------
# Build canonical thrower-perspective rows (SVG only)
# -----------------------------------------------------------------------

def _is_filled(v: Optional[str]) -> bool:
    if v is None:
        return False
    s = v.lower()
    return s not in ("", "white", "none")


def build_game_rows(slug: str, rendered: dict) -> dict:
    rosters = rendered["rosters"]
    snapshots = rendered["snapshots"]

    # Pre-parse every player's markers ONCE.
    parsed: dict[str, dict[str, list[dict]]] = {}
    for team, roster in rosters.items():
        parsed[team] = {}
        for p in roster:
            pid = p["id"]
            html = snapshots.get(team, {}).get(pid)
            parsed[team][pid] = parse_player_svg_markers(html) if html else []

    canonical: list[dict] = []
    diagnostics: list[dict] = []

    for team, roster in rosters.items():
        for pid, markers in parsed[team].items():
            kept = 0
            for m in markers:
                rect_filled = _is_filled(m["rect_fill"])
                circ_filled = _is_filled(m["circle_fill"])
                # Selected player is the THROWER iff their rect is filled.
                # Throwaways / stalls / callahans have no circle at all;
                # rect filled in those cases also means they threw it.
                if not rect_filled or circ_filled:
                    continue
                kept += 1

                receiver_id = None
                if m["receiver_x"] is not None:
                    receiver_id = _resolve_receiver_id(
                        team, pid, m["receiver_x"], m["receiver_y"], parsed
                    )

                canonical.append({
                    "Team":           team,
                    "Thrower_ID":     _to_int(pid),
                    "Receiver_ID":    _to_int(receiver_id),
                    "Event_Outcome":  m["outcome"],
                    "Thrower_X":      m["thrower_x"],
                    "Thrower_Y":      m["thrower_y"],
                    "Receiver_X":     m["receiver_x"],
                    "Receiver_Y":     m["receiver_y"],
                    "Thrower_color":  m["rect_fill"],
                    "Receiver_color": m["circle_fill"],
                })

            diagnostics.append({
                "team": team, "player_id": pid,
                "marker_count": len(markers),
                "thrower_rows_kept": kept,
            })

    return {
        "game_slug": slug,
        "rosters": rosters,
        "rows": canonical,
        "diagnostics": diagnostics,
    }


def _resolve_receiver_id(team: str, thrower_pid: str,
                         rx: float, ry: float,
                         parsed: dict) -> Optional[str]:
    """Find the player whose filtered SVG has a marker whose RECEIVER
    end is at (rx, ry) AND whose circle is filled (i.e., they caught it).
    """
    for pid, markers in parsed[team].items():
        if pid == thrower_pid:
            continue
        for m in markers:
            if m["receiver_x"] is None:
                continue
            if (abs(m["receiver_x"] - rx) <= COORD_EPS
                    and abs(m["receiver_y"] - ry) <= COORD_EPS
                    and _is_filled(m["circle_fill"])
                    and not _is_filled(m["rect_fill"])):
                return pid
    return None


def _to_int(v):
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return v


# -----------------------------------------------------------------------
# CLI
# -----------------------------------------------------------------------

def _main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", required=True,
                    help="UFA game slug, e.g. 2025-07-26-MAD-MIN")
    ap.add_argument("--use-cached", action="store_true",
                    help="Skip the browser and rebuild from cached HTML on disk.")
    ap.add_argument("--player", default=None,
                    help="Render only this UFA player id (debugging).")
    ap.add_argument("--team", default=None,
                    help="Render only this team code (debugging).")
    ap.add_argument("--no-headless", action="store_true",
                    help="Show the browser window.")
    args = ap.parse_args()

    if args.use_cached:
        rendered = load_cached(args.game)
    else:
        rendered = asyncio.run(render_per_player_snapshots(
            args.game,
            only_player=args.player,
            only_team=args.team,
            headless=not args.no_headless,
        ))

    bundle = build_game_rows(args.game, rendered)

    out = PROCESSED_DIR / f"{args.game}__throws.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bundle, indent=2), encoding="utf-8")
    print(f"[scraper] wrote {out}: {len(bundle['rows'])} thrower-perspective rows")

    from collections import Counter
    by_team = Counter(r["Team"] for r in bundle["rows"])
    by_outcome = Counter(r["Event_Outcome"] for r in bundle["rows"])
    missing_recv = sum(1 for r in bundle["rows"]
                       if r["Receiver_X"] is not None and r["Receiver_ID"] is None)
    print(f"[scraper] by team:    {dict(by_team)}")
    print(f"[scraper] by outcome: {dict(by_outcome)}")
    print(f"[scraper] rows with receiver coord but no resolved id: {missing_recv}")


if __name__ == "__main__":
    _main()
