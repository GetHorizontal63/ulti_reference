"""Batch SVG scraper — scrapes every game in the discovery index,
exporting each game's bundle immediately after it completes.
Runs multiple Playwright workers in parallel.

Usage:
    python -m pipeline.ufa_scrape_all                        # all years, skip cached
    python -m pipeline.ufa_scrape_all --years 2025 2026      # limit to seasons
    python -m pipeline.ufa_scrape_all --refresh              # re-scrape even if cached
    python -m pipeline.ufa_scrape_all --workers 3            # parallel Playwright instances
    python -m pipeline.ufa_scrape_all --export-only          # skip scraping, just re-bundle
    python -m pipeline.ufa_scrape_all --slug 2025-08-23-BOS-MIN  # single game

A game is considered cached when its processed throws file already exists:
    data/processed/ufa/<slug>__throws.json
"""
from __future__ import annotations

import os
import argparse
import asyncio
import json
import sys
import threading
import time
from collections import defaultdict
from pathlib import Path
from typing import Optional

REPO_ROOT  = Path(__file__).resolve().parents[2]
INDEX_PATH = REPO_ROOT / "data" / "raw" / "ufa_api" / "_index.json"
PROC_DIR   = REPO_ROOT / "data" / "processed" / "ufa"
PUBLIC_DIR = Path(os.environ.get("UFA_EXPORT_DIR") or REPO_ROOT / "data" / "exports") / "ufa"

# Lock so parallel workers don't clobber season bundle files simultaneously.
_export_lock = threading.Lock()


# ── helpers ────────────────────────────────────────────────────────────────

def _load_index() -> dict:
    if not INDEX_PATH.exists():
        print(f"[batch] ERROR: index not found at {INDEX_PATH}", file=sys.stderr)
        print("[batch] Run  python -m pipeline.ufa_discover  first.", file=sys.stderr)
        sys.exit(1)
    return json.loads(INDEX_PATH.read_text(encoding="utf-8"))


def _is_cached(slug: str) -> bool:
    return (PROC_DIR / f"{slug}__throws.json").exists()


def _slugs_for_years(index: dict, years: Optional[list[int]]) -> list[str]:
    from datetime import date
    today = date.today().isoformat()   # e.g. "2026-04-29"
    year_data = index.get("years", {})
    slugs: list[str] = []
    for yr_str, entry in year_data.items():
        if years and int(yr_str) not in years:
            continue
        for slug in entry.get("slugs", []):
            # Slug format: YYYY-MM-DD-AWAY-HOME — first 10 chars are the date.
            if slug[:10] <= today:
                slugs.append(slug)
    return sorted(set(slugs))


def _season_of(slug: str) -> int:
    return int(slug[:4])


# ── per-game export (called immediately after scrape completes) ────────────

def _export_game(slug: str) -> None:
    """Append this game's throws into its season bundle file immediately.
    Uses a lock so parallel workers don't write the same file at the same time.
    """
    from pipelines.pipeline.export_static_bundle import _bundle_for_slug, _now_iso

    season = _season_of(slug)
    out_path = PUBLIC_DIR / f"throws-{season}.json"
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    with _export_lock:
        # Load existing bundle or start fresh.
        if out_path.exists():
            try:
                existing = json.loads(out_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                existing = {"items": [], "meta": {}}
        else:
            existing = {"items": [], "meta": {}}

        existing_games: set[str] = {
            item.get("game_id") for item in existing.get("items", [])
        }

        # Skip if this game is already in the bundle (unless refreshing).
        if slug in existing_games:
            # Remove old entries for this game so we replace with fresh data.
            existing["items"] = [
                item for item in existing["items"]
                if item.get("game_id") != slug
            ]

        try:
            new_items, rosters = _bundle_for_slug(slug)
        except Exception as exc:                        # noqa: BLE001
            print(f"[batch] export failed for {slug}: {exc}", file=sys.stderr)
            return

        existing["items"].extend(new_items)

        # Rebuild meta.
        all_games = sorted({item.get("game_id") for item in existing["items"]})
        existing["meta"] = {
            "league": "UFA",
            "season": season,
            "games": all_games,
            "generated_at": _now_iso(),
            "source": "pipeline.ufa_scrape_all",
            "schema_version": "0.3.0",
        }

        out_path.write_text(json.dumps(existing, indent=2), encoding="utf-8")

    # Also update players + teams incrementally.
    _update_players_teams(rosters)


def _update_players_teams(rosters: dict) -> None:
    """Merge new roster entries into the global players.json / teams.json."""
    from pipelines.pipeline.export_static_bundle import _now_iso

    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    players_path = PUBLIC_DIR / "players.json"
    teams_path   = PUBLIC_DIR / "teams.json"

    with _export_lock:
        # Players.
        if players_path.exists():
            try:
                pl_data = json.loads(players_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pl_data = {"items": []}
        else:
            pl_data = {"items": []}
        pl_by_id = {p["id"]: p for p in pl_data.get("items", [])}

        # Teams.
        if teams_path.exists():
            try:
                tm_data = json.loads(teams_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                tm_data = {"items": []}
        else:
            tm_data = {"items": []}
        tm_by_id = {t["id"]: t for t in tm_data.get("items", [])}

        for team, roster in rosters.items():
            tm_by_id.setdefault(team, {
                "id": team, "league": "UFA", "abbrev": team,
            })
            for p in roster:
                pid = str(p["id"])
                pl_by_id[pid] = {
                    "id":           pid,
                    "league":       "UFA",
                    "team_id":      team,
                    "display_name": p.get("name") or pid,
                    "jersey":       p.get("jersey"),
                }

        players_path.write_text(
            json.dumps({
                "items": list(pl_by_id.values()),
                "meta": {"league": "UFA", "generated_at": _now_iso()},
            }, indent=2),
            encoding="utf-8",
        )
        teams_path.write_text(
            json.dumps({
                "items": list(tm_by_id.values()),
                "meta": {"league": "UFA", "generated_at": _now_iso()},
            }, indent=2),
            encoding="utf-8",
        )


# ── per-game scrape ────────────────────────────────────────────────────────

async def _scrape_one(slug: str, semaphore: asyncio.Semaphore,
                      refresh: bool, headless: bool) -> tuple[str, bool, Optional[str]]:
    if not refresh and _is_cached(slug):
        return slug, True, "cached"

    async with semaphore:
        try:
            from pipelines.pipeline.ufa_player_scraper import (
                render_per_player_snapshots, build_game_rows,
            )
            rendered = await render_per_player_snapshots(slug, headless=headless)
            bundle   = build_game_rows(slug, rendered)

            out = PROC_DIR / f"{slug}__throws.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(bundle, indent=2), encoding="utf-8")

            # Export this game immediately into its season bundle.
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, _export_game, slug)

            return slug, True, None
        except Exception as exc:                        # noqa: BLE001
            return slug, False, f"{type(exc).__name__}: {exc}"


# ── run loop ───────────────────────────────────────────────────────────────

async def _run(slugs: list[str], workers: int,
               refresh: bool, headless: bool) -> tuple[int, int, int]:
    semaphore = asyncio.Semaphore(workers)
    tasks = [
        asyncio.create_task(_scrape_one(slug, semaphore, refresh, headless))
        for slug in slugs
    ]

    n_ok = n_cached = n_err = 0
    errors: list[tuple[str, str]] = []
    start = time.monotonic()

    for i, coro in enumerate(asyncio.as_completed(tasks), 1):
        slug, ok, msg = await coro
        if msg == "cached":
            n_cached += 1
        elif ok:
            n_ok += 1
        else:
            n_err += 1
            errors.append((slug, msg or "unknown error"))

        if i % 10 == 0 or i == len(tasks):
            elapsed = time.monotonic() - start
            rate    = i / elapsed if elapsed > 0 else 0
            eta     = (len(tasks) - i) / rate if rate > 0 else 0
            print(
                f"[batch] {i}/{len(tasks)}  "
                f"scraped={n_ok}  cached={n_cached}  err={n_err}  "
                f"{rate:.1f}/s  ETA {eta/60:.1f}m",
                flush=True,
            )

    if errors:
        print(f"\n[batch] {len(errors)} failures:", file=sys.stderr)
        for s, m in errors[:20]:
            print(f"  {s}: {m}", file=sys.stderr)
        if len(errors) > 20:
            print(f"  ... and {len(errors)-20} more", file=sys.stderr)

    return n_ok, n_cached, n_err


# ── export-only path ───────────────────────────────────────────────────────

def _export_all(years: Optional[list[int]]) -> None:
    """Full rebuild of season bundles from all processed files."""
    from pipelines.pipeline.export_static_bundle import export_seasons
    if years:
        export_seasons(years)
    else:
        all_years = sorted({
            int(p.name[:4])
            for p in PROC_DIR.glob("*__throws.json")
            if p.name[:4].isdigit()
        })
        export_seasons(all_years)


# ── CLI ────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--years", nargs="*", type=int, default=None,
                    help="Limit to these seasons (default: all in index).")
    ap.add_argument("--refresh", action="store_true",
                    help="Re-scrape games that already have a processed file.")
    ap.add_argument("--workers", type=int, default=2,
                    help="Parallel Playwright instances (default 2).")
    ap.add_argument("--no-headless", action="store_true",
                    help="Show browser windows.")
    ap.add_argument("--export-only", action="store_true",
                    help="Skip scraping; rebuild all bundles from processed files.")
    ap.add_argument("--slug", nargs="*", default=None,
                    help="Scrape only these specific slugs.")
    args = ap.parse_args()

    if args.export_only:
        print("[batch] export-only mode …")
        _export_all(args.years)
        print("[batch] done.")
        return 0

    index = _load_index()
    slugs = sorted(args.slug) if args.slug else _slugs_for_years(index, args.years)

    if not slugs:
        print("[batch] No slugs found.", file=sys.stderr)
        return 1

    cached_count = sum(1 for s in slugs if _is_cached(s))
    to_scrape    = len(slugs) if args.refresh else len(slugs) - cached_count
    print(f"[batch] {len(slugs)} games  ({cached_count} cached, {to_scrape} to scrape)  "
          f"workers={args.workers}")

    n_ok, n_cached, n_err = asyncio.run(
        _run(slugs,
             workers=args.workers,
             refresh=args.refresh,
             headless=not args.no_headless)
    )
    print(f"[batch] done — scraped={n_ok}  cached={n_cached}  err={n_err}")
    return 0 if n_err == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())