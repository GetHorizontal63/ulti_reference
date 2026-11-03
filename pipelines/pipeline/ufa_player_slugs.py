"""ufa_player_slugs.py
Place at: pipeline/ufa_player_slugs.py

Scrapes the WatchUFA player directory (watchufa.com/league/players) to build
a complete slug → numeric ID mapping table.

Strategy:
1. Paginate through all pages of watchufa.com/league/players
   to collect every (slug, display_name, team) entry.
2. For each player page (watchufa.com/league/players/<slug>), intercept
   the network request the Svelte stats component makes to backend.ufastats.com
   to extract the numeric player ID directly from the API response.
3. Write the mapping to data/processed/ufa/player_slugs.json

Output schema per entry:
    {
        "slug":         "bjagt",
        "numeric_id":   "12988",       # null if not resolvable
        "display_name": "Ben Jagt",
        "team":         "New York Empire",
        "image_url":    "https://www.watchufa.com/sites/default/files/players/profile-images/bjagt_profile.jpg"
    }

Usage:
    python -m pipeline.ufa_player_slugs                  # full run
    python -m pipeline.ufa_player_slugs --slugs bjagt gjagt  # specific slugs
    python -m pipeline.ufa_player_slugs --pages-only     # only scrape directory, skip profile fetch
    python -m pipeline.ufa_player_slugs --ids-only       # only fetch IDs for already-scraped slugs
    python -m pipeline.ufa_player_slugs --workers 4      # parallel profile fetches
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup

REPO_ROOT   = Path(__file__).resolve().parents[2]
PROC_DIR    = REPO_ROOT / "data" / "processed" / "ufa"
OUTPUT_PATH = PROC_DIR / "player_slugs.json"

BASE_URL      = "https://www.watchufa.com"
DIRECTORY_URL = f"{BASE_URL}/league/players"
PROFILE_URL   = f"{BASE_URL}/league/players/{{slug}}"
IMAGE_URL     = f"{BASE_URL}/sites/default/files/players/profile-images/{{slug}}_profile.jpg"

# The Svelte stats component fires a request to this pattern.
# We intercept any request to backend.ufastats.com/stats-pages/player/*
STATS_API_PATTERN = re.compile(
    r"backend\.ufastats\.com/(web-v1/players/|stats-pages/player/)"
)


# ── Directory scraper ──────────────────────────────────────────────────────

async def scrape_directory(headless: bool = True) -> list[dict[str, str]]:
    """Paginate through /league/players and collect all slug+name+team entries."""
    from playwright.async_api import async_playwright

    entries: list[dict[str, str]] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=headless)
        ctx     = await browser.new_context()
        page    = await ctx.new_page()

        # Find total page count first.
        await page.goto(DIRECTORY_URL, wait_until="networkidle", timeout=60_000)
        html  = await page.content()
        soup  = BeautifulSoup(html, "lxml")
        last  = soup.select_one("li.pager-last a")
        total = int(re.search(r"page=(\d+)", last["href"]).group(1)) + 1 if last else 1
        print(f"[slugs] directory: {total} pages")

        for p in range(total):
            url = DIRECTORY_URL if p == 0 else f"{DIRECTORY_URL}?page={p}"
            await page.goto(url, wait_until="networkidle", timeout=60_000)
            html = await page.content()
            soup = BeautifulSoup(html, "lxml")

            for row in soup.select("tbody tr"):
                player_td = row.select_one("td.views-field-field-player-display-name")
                team_td   = row.select_one("td.views-field-field-team-display-name")
                if not player_td:
                    continue
                a = player_td.find("a")
                if not a:
                    continue
                href = a.get("href", "")
                slug = href.rstrip("/").split("/")[-1]
                name = a.get_text(strip=True)
                team_a = team_td.find("a") if team_td else None
                team   = team_a.get_text(strip=True) if team_a else ""
                entries.append({
                    "slug":         slug,
                    "display_name": name,
                    "team":         team,
                    "image_url":    IMAGE_URL.format(slug=slug),
                    "numeric_id":   None,
                })

            if (p + 1) % 10 == 0 or p + 1 == total:
                print(f"[slugs] directory page {p+1}/{total} — {len(entries)} entries so far")

        await browser.close()

    return entries


# ── Profile ID fetcher ─────────────────────────────────────────────────────

async def fetch_numeric_id(slug: str, semaphore: asyncio.Semaphore,
                           headless: bool = True) -> tuple[str, str | None]:
    """
    Load a player profile page and intercept the Svelte stats API request
    to extract the numeric player ID.
    Returns (slug, numeric_id_or_None).
    """
    from playwright.async_api import async_playwright

    numeric_id = None

    async with semaphore:
        try:
            async with async_playwright() as pw:
                browser = await pw.chromium.launch(headless=headless)
                ctx     = await browser.new_context()
                page    = await ctx.new_page()

                captured: list[str] = []

                async def on_request(request):
                    if STATS_API_PATTERN.search(request.url):
                        captured.append(request.url)

                async def on_response(response):
                    if STATS_API_PATTERN.search(response.url):
                        try:
                            body = await response.json()
                            # Try common shapes: {id: ...}, {player: {id: ...}},
                            # {players: [{id: ...}]}, array
                            pid = None
                            if isinstance(body, dict):
                                pid = (body.get("id")
                                       or body.get("player_id")
                                       or (body.get("player") or {}).get("id"))
                                if pid is None and "players" in body:
                                    players = body["players"]
                                    if players:
                                        pid = players[0].get("id")
                            elif isinstance(body, list) and body:
                                pid = body[0].get("id")
                            if pid is not None:
                                nonlocal numeric_id
                                numeric_id = str(pid)
                        except Exception:
                            pass

                page.on("request",  on_request)
                page.on("response", on_response)

                await page.goto(PROFILE_URL.format(slug=slug),
                                wait_until="networkidle", timeout=60_000)
                # Give Svelte component time to fire its request.
                await page.wait_for_timeout(3000)

                # Fallback: try to extract from URL pattern if intercepted.
                if numeric_id is None:
                    for url in captured:
                        m = re.search(r"/players?/(\d+)", url)
                        if m:
                            numeric_id = m.group(1)
                            break

                await browser.close()
        except Exception as exc:
            print(f"[slugs]   ! {slug}: {exc}", file=sys.stderr)

    return slug, numeric_id


# ── Main ───────────────────────────────────────────────────────────────────

async def run(args) -> None:
    PROC_DIR.mkdir(parents=True, exist_ok=True)

    # Load existing output if present.
    existing: dict[str, dict[str, Any]] = {}
    if OUTPUT_PATH.exists():
        try:
            data = json.loads(OUTPUT_PATH.read_text(encoding="utf-8"))
            existing = {e["slug"]: e for e in data}
            print(f"[slugs] loaded {len(existing)} existing entries")
        except Exception:
            pass

    # ── Step 1: directory scrape ───────────────────────────────────────────
    if not args.ids_only:
        entries = await scrape_directory(headless=not args.no_headless)
        for e in entries:
            slug = e["slug"]
            if slug in existing:
                # Preserve existing numeric_id if already resolved.
                e["numeric_id"] = existing[slug].get("numeric_id")
            existing[slug] = e
        _save(existing)
        print(f"[slugs] directory done — {len(existing)} unique slugs")

    # ── Step 2: fetch numeric IDs ──────────────────────────────────────────
    if not args.pages_only:
        if args.slugs:
            targets = [s for s in args.slugs if s in existing]
        else:
            # Only fetch for entries that don't have a numeric_id yet.
            targets = [slug for slug, e in existing.items()
                       if e.get("numeric_id") is None]

        print(f"[slugs] fetching numeric IDs for {len(targets)} players "
              f"(workers={args.workers})")

        semaphore = asyncio.Semaphore(args.workers)
        tasks = [
            asyncio.create_task(
                fetch_numeric_id(slug, semaphore, headless=not args.no_headless)
            )
            for slug in targets
        ]

        resolved = 0
        start = time.monotonic()
        for i, coro in enumerate(asyncio.as_completed(tasks), 1):
            slug, pid = await coro
            if pid:
                existing[slug]["numeric_id"] = pid
                resolved += 1
            if i % 25 == 0 or i == len(tasks):
                elapsed = time.monotonic() - start
                rate = i / elapsed if elapsed > 0 else 0
                eta  = (len(tasks) - i) / rate if rate > 0 else 0
                print(f"[slugs] {i}/{len(tasks)} "
                      f"resolved={resolved} "
                      f"{rate:.1f}/s ETA {eta/60:.1f}m")
                _save(existing)

        print(f"[slugs] ID fetch done — {resolved}/{len(targets)} resolved")

    _save(existing)
    print(f"[slugs] wrote {len(existing)} entries → {OUTPUT_PATH}")


def _save(existing: dict[str, dict]) -> None:
    OUTPUT_PATH.write_text(
        json.dumps(list(existing.values()), indent=2),
        encoding="utf-8",
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--slugs",      nargs="*", help="Only process these slugs.")
    ap.add_argument("--pages-only", action="store_true",
                    help="Only scrape directory pages, skip profile ID fetch.")
    ap.add_argument("--ids-only",   action="store_true",
                    help="Skip directory scrape, only fetch IDs for existing entries.")
    ap.add_argument("--workers",    type=int, default=4,
                    help="Parallel Playwright instances for profile fetches (default 4).")
    ap.add_argument("--no-headless", action="store_true")
    args = ap.parse_args()

    asyncio.run(run(args))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())