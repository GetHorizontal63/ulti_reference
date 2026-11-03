#!/usr/bin/env python3
"""
NCAA Logo Scraper - ESPN CDN
Saves to: frontend/public/assets/png/NCAA_teams/PNG/{Team Display Name}.png
Skips teams in: SEC, Big Ten, Big 12, ACC
"""

import time
import argparse
import requests
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
})

# ESPN sport slugs for college sports
SPORTS = {
    "football":          "football/college-football",
    "mens-basketball":   "basketball/mens-college-basketball",
    "womens-basketball": "basketball/womens-college-basketball",
    "baseball":          "baseball/college-baseball",
    "softball":          "softball/college-softball",
    "mens-soccer":       "soccer/mens-college-soccer",
    "womens-soccer":     "soccer/womens-college-soccer",
    "volleyball":        "volleyball/womens-college-volleyball",
    "mens-lacrosse":     "lacrosse/mens-college-lacrosse",
    "womens-lacrosse":   "lacrosse/womens-college-lacrosse",
    "field-hockey":      "fieldhockey/college-field-hockey",
    "mens-hockey":       "hockey/mens-college-hockey",
    "wrestling":         "wrestling/college-wrestling",
    "mens-swimming":     "swimming-diving/mens-college-swimming-diving",
    "womens-swimming":   "swimming-diving/womens-college-swimming-diving",
}

# Conferences to skip — matched against ESPN conference name (case-insensitive substring)
SKIP_CONFERENCES = {"sec", "big ten", "big 12", "acc"}

ESPN_TEAMS_URL = "https://site.api.espn.com/apis/site/v2/sports/{sport}/teams"
LOGO_BASE      = "https://a.espncdn.com/i/teamlogos/ncaa/{size}/{team_id}.png"

# Relative to script location: ../NCAA_teams/PNG
SCRIPT_DIR  = Path(__file__).parent
OUTPUT_DIR  = SCRIPT_DIR.parent / "NCAA_teams" / "PNG"


def conference_name(team: dict) -> str:
    """Extract conference name from ESPN team dict. Returns '' if not found."""
    # ESPN nests conference under team.groups (list) or team.conferenceId
    groups = team.get("groups") or []
    if isinstance(groups, list):
        for g in groups:
            name = g.get("name", "") or g.get("shortName", "")
            if name:
                return name
    if isinstance(groups, dict):
        return groups.get("name", "") or groups.get("shortName", "")
    # Fallback: try top-level conferenceId label if present
    return team.get("conferenceName", "")


def should_skip(team: dict) -> bool:
    conf = conference_name(team).lower()
    if not conf:
        return False
    return any(skip in conf for skip in SKIP_CONFERENCES)


def get_teams(sport_slug: str) -> list[dict]:
    """Fetch all teams for a sport. Returns list of team dicts (raw ESPN)."""
    all_teams = []
    page = 1
    while True:
        url = ESPN_TEAMS_URL.format(sport=sport_slug)
        try:
            r = SESSION.get(url, params={"limit": 1000, "page": page}, timeout=15)
            r.raise_for_status()
            data = r.json()
        except Exception as e:
            print(f"  [WARN] Could not fetch {sport_slug} page {page}: {e}")
            break

        batch = (
            data.get("sports", [{}])[0]
                .get("leagues", [{}])[0]
                .get("teams", [])
        )
        if not batch:
            break

        for entry in batch:
            all_teams.append(entry.get("team", {}))

        count     = data.get("count", 0)
        page_size = data.get("pageSize", 1000)
        if len(all_teams) >= count or len(batch) < page_size:
            break
        page += 1

    return all_teams


def download_logo(team: dict, dest_dir: Path, size: int) -> tuple[str, str, bool]:
    """Download logo. Returns (display_name, conference, success)."""
    display_name = team.get("displayName", "Unknown")
    team_id      = team.get("id", "")
    conf         = conference_name(team) or "Unknown"

    # Sanitize filename — strip chars invalid on Windows paths
    safe_name = display_name
    for ch in r'/\:*?"<>|':
        safe_name = safe_name.replace(ch, "-")
    dest = dest_dir / f"{safe_name}.png"

    if dest.exists():
        return display_name, conf, True

    url = LOGO_BASE.format(size=size, team_id=team_id)
    try:
        r = SESSION.get(url, timeout=15)
        r.raise_for_status()
        dest.write_bytes(r.content)
        return display_name, conf, True
    except Exception:
        return display_name, conf, False


def scrape(sports_filter: list | None = None, output_dir: Path = OUTPUT_DIR,
           size: int = 500, workers: int = 10, delay: float = 0.05):

    dest_dir = Path(output_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)
    print(f"Output directory: {dest_dir.resolve()}")

    sports_to_run = {k: v for k, v in SPORTS.items()
                     if sports_filter is None or k in sports_filter}

    # Collect unique teams across all sports (deduplicated by team id)
    # so we don't re-download the same school logo 15 times
    seen_ids: dict[str, dict] = {}

    print("\nFetching team lists...")
    for sport_key, sport_slug in sports_to_run.items():
        teams = get_teams(sport_slug)
        for t in teams:
            tid = t.get("id", "")
            if tid and tid not in seen_ids:
                seen_ids[tid] = t
        print(f"  {sport_key}: {len(teams)} teams fetched (running total unique: {len(seen_ids)})")

    all_teams = list(seen_ids.values())

    # Apply conference filter
    skipped = [t for t in all_teams if should_skip(t)]
    to_download = [t for t in all_teams if not should_skip(t)]

    if skipped:
        print(f"\nSkipping {len(skipped)} teams in SEC / Big Ten / Big 12 / ACC:")
        skip_sample = sorted(set(conference_name(t) for t in skipped))
        print(f"  Conferences matched: {', '.join(skip_sample)}")

    print(f"\nDownloading logos for {len(to_download)} teams...")

    downloaded = 0
    failed = []

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(download_logo, t, dest_dir, size): t for t in to_download}
        for i, future in enumerate(as_completed(futures), 1):
            name, conf, ok = future.result()
            if ok:
                downloaded += 1
            else:
                failed.append(name)
            if i % 50 == 0 or i == len(to_download):
                print(f"  Progress: {i}/{len(to_download)} — OK: {downloaded}, Failed: {len(failed)}")
            time.sleep(delay)

    print(f"\n{'='*60}")
    print(f"DONE")
    print(f"  Downloaded : {downloaded}")
    print(f"  Skipped (P5 conf): {len(skipped)}")
    print(f"  Failed     : {len(failed)}")
    if failed:
        print(f"  Failed teams: {', '.join(failed[:20])}" + (" ..." if len(failed) > 20 else ""))
    print(f"  Output: {dest_dir.resolve()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NCAA Logo Scraper (ESPN CDN)")
    parser.add_argument(
        "--sports", nargs="+", choices=list(SPORTS.keys()),
        help="Specific sports to include (default: all)"
    )
    parser.add_argument(
        "--output", type=Path, default=OUTPUT_DIR,
        help=f"Output directory (default: {OUTPUT_DIR})"
    )
    parser.add_argument(
        "--size", type=int, choices=[100, 200, 500], default=500,
        help="Logo size in px (default: 500)"
    )
    parser.add_argument(
        "--workers", type=int, default=10,
        help="Parallel download threads (default: 10)"
    )
    parser.add_argument(
        "--delay", type=float, default=0.05,
        help="Per-request delay in seconds (default: 0.05)"
    )
    args = parser.parse_args()

    scrape(
        sports_filter=args.sports,
        output_dir=args.output,
        size=args.size,
        workers=args.workers,
        delay=args.delay,
    )