"""UFA advanced-stats discovery + bulk pull.

Walks the ``backend.ufastats.com`` Game Finder API for every season in
``YEARS`` and downloads the rich per-game JSON
(``/stats-pages/game/<slug>``) for any game that exposes advanced stats.

Outputs:
    data/raw/ufa_api/<slug>.json        rich per-game payload
    data/raw/ufa_api/_index.json        manifest of all discovered slugs
                                        with an ``has_advanced`` flag

Usage:
    python -m pipeline.ufa_discover                # 2021-2026, skip cached
    python -m pipeline.ufa_discover --years 2025
    python -m pipeline.ufa_discover --refresh      # re-pull every game
    python -m pipeline.ufa_discover --list-only    # just enumerate slugs
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

import httpx

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = REPO_ROOT / "data" / "raw" / "ufa_api"
INDEX_PATH = RAW_DIR / "_index.json"

LIST_URL = "https://www.backend.ufastats.com/web-v1/games"
GAME_URL = "https://www.backend.ufastats.com/stats-pages/game/{slug}"
PAGE_LIMIT = 10  # API caps `limit` at 10 (verified empirically).
DEFAULT_YEARS = list(range(2021, 2027))


def list_year(client: httpx.Client, year: int) -> list[dict[str, Any]]:
    """Enumerate every game record for `year` via the paginated API."""
    games: list[dict[str, Any]] = []
    page = 1
    total: int | None = None
    while True:
        r = client.get(LIST_URL, params={"limit": PAGE_LIMIT,
                                         "years": year,
                                         "page": page})
        r.raise_for_status()
        body = r.json()
        batch = body.get("games", [])
        if total is None:
            total = body.get("total", 0)
        games.extend(batch)
        if len(games) >= (total or 0) or not batch:
            break
        page += 1
    return games


def fetch_game(client: httpx.Client, slug: str) -> tuple[bool, dict[str, Any]]:
    """Return (has_advanced, payload). ``has_advanced`` is False when the
    backend responds with an ``error`` envelope."""
    r = client.get(GAME_URL.format(slug=slug))
    r.raise_for_status()
    payload = r.json()
    has_adv = "game" in payload and "tsgHome" in payload
    return has_adv, payload


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--years", nargs="*", type=int, default=DEFAULT_YEARS,
                    help="Seasons to enumerate (default 2021-2026).")
    ap.add_argument("--refresh", action="store_true",
                    help="Re-download games even if a cached JSON exists.")
    ap.add_argument("--list-only", action="store_true",
                    help="Enumerate slugs but skip the per-game pull.")
    ap.add_argument("--sleep", type=float, default=0.0,
                    help="Optional delay (seconds) between game fetches.")
    args = ap.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)

    index: dict[str, Any] = {"years": {}, "games": {}}
    if INDEX_PATH.exists():
        try:
            index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            index = {"years": {}, "games": {}}
    index.setdefault("years", {})
    index.setdefault("games", {})

    with httpx.Client(timeout=30.0, headers={"User-Agent": "ufa-discover/0.1"}) as client:
        all_slugs: list[tuple[int, str]] = []
        for y in args.years:
            try:
                games = list_year(client, y)
            except httpx.HTTPError as exc:
                print(f"[discover] year {y}: list failed: {exc}", file=sys.stderr)
                continue
            slugs = [g["gameID"] for g in games]
            index["years"][str(y)] = {"count": len(slugs), "slugs": slugs}
            print(f"[discover] {y}: {len(slugs)} games")
            all_slugs.extend((y, s) for s in slugs)

        INDEX_PATH.write_text(json.dumps(index, indent=2), encoding="utf-8")
        if args.list_only:
            print(f"[discover] wrote slug index → {INDEX_PATH}")
            return 0

        n_pulled = n_skipped = n_no_adv = n_err = 0
        for i, (year, slug) in enumerate(all_slugs, 1):
            cache = RAW_DIR / f"{slug}.json"
            entry = index["games"].get(slug, {})
            if cache.exists() and not args.refresh:
                n_skipped += 1
                if i % 50 == 0:
                    print(f"[discover] {i}/{len(all_slugs)} (cached)")
                continue
            try:
                has_adv, payload = fetch_game(client, slug)
            except httpx.HTTPError as exc:
                n_err += 1
                print(f"[discover] {slug}: fetch failed: {exc}", file=sys.stderr)
                index["games"][slug] = {**entry, "year": year, "error": str(exc)}
                continue
            cache.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            index["games"][slug] = {
                "year": year,
                "has_advanced": has_adv,
                "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            if has_adv:
                n_pulled += 1
            else:
                n_no_adv += 1
            if i % 25 == 0 or i == len(all_slugs):
                INDEX_PATH.write_text(json.dumps(index, indent=2), encoding="utf-8")
                print(f"[discover] {i}/{len(all_slugs)} "
                      f"(pulled={n_pulled} no_adv={n_no_adv} cached={n_skipped} err={n_err})")
            if args.sleep:
                time.sleep(args.sleep)

        INDEX_PATH.write_text(json.dumps(index, indent=2), encoding="utf-8")
        print(f"[discover] done: pulled={n_pulled} no_adv={n_no_adv} "
              f"cached={n_skipped} err={n_err}")
        print(f"[discover] index → {INDEX_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
