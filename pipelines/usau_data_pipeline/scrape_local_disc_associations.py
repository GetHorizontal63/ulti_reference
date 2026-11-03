"""
Scrape USAU local disc associations from https://usaultimate.org/local/{state}/
and insert them into usau_programs as competition_level='Club' entries.

Run from repo root:  python scrape_local_disc_associations.py
Use --dry-run to preview without writing to DB.
Use --state <slug> to test a single state.
"""

import os
import sqlite3
import re
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DB_PATH = Path(os.environ.get("UFA_DB_PATH") or Path(__file__).resolve().parents[2] / "data" / "db" / "ultimate.db")
BASE_URL = "https://usaultimate.org/local/"
COMPETITION_LEVEL = "Club"
PROGRAM_ID_PREFIX = "usau_p_lda_"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; UltimateAnalyticsBot/1.0; "
        "+https://github.com/your-org/ultimate-frisbee-analytics)"
    )
}

# All state slugs as listed in USAU nav (+ DC + territories with known pages)
STATE_SLUGS = [
    "alabama", "alaska", "arizona", "arkansas", "california",
    "colorado", "connecticut", "delaware", "florida", "georgia",
    "hawaii", "idaho", "illinois", "indiana", "iowa",
    "kansas", "kentucky", "louisiana", "maine", "maryland",
    "massachusetts", "michigan", "minnesota", "mississippi", "missouri",
    "montana", "nebraska", "nevada", "new-hampshire", "new-jersey",
    "new-mexico", "new-york", "north-carolina", "north-dakota", "ohio",
    "oklahoma", "oregon", "pennsylvania", "rhode-island", "south-carolina",
    "south-dakota", "tennessee", "texas", "utah", "vermont",
    "virginia", "washington", "west-virginia", "wisconsin", "wyoming",
    "washington-dc",
    # Territories that may have pages
    "puerto-rico",
]

# Slug → full state name
SLUG_TO_STATE = {
    "alabama": "Alabama", "alaska": "Alaska", "arizona": "Arizona",
    "arkansas": "Arkansas", "california": "California", "colorado": "Colorado",
    "connecticut": "Connecticut", "delaware": "Delaware", "florida": "Florida",
    "georgia": "Georgia", "hawaii": "Hawaii", "idaho": "Idaho",
    "illinois": "Illinois", "indiana": "Indiana", "iowa": "Iowa",
    "kansas": "Kansas", "kentucky": "Kentucky", "louisiana": "Louisiana",
    "maine": "Maine", "maryland": "Maryland", "massachusetts": "Massachusetts",
    "michigan": "Michigan", "minnesota": "Minnesota", "mississippi": "Mississippi",
    "missouri": "Missouri", "montana": "Montana", "nebraska": "Nebraska",
    "nevada": "Nevada", "new-hampshire": "New Hampshire", "new-jersey": "New Jersey",
    "new-mexico": "New Mexico", "new-york": "New York",
    "north-carolina": "North Carolina", "north-dakota": "North Dakota",
    "ohio": "Ohio", "oklahoma": "Oklahoma", "oregon": "Oregon",
    "pennsylvania": "Pennsylvania", "rhode-island": "Rhode Island",
    "south-carolina": "South Carolina", "south-dakota": "South Dakota",
    "tennessee": "Tennessee", "texas": "Texas", "utah": "Utah",
    "vermont": "Vermont", "virginia": "Virginia", "washington": "Washington",
    "west-virginia": "West Virginia", "wisconsin": "Wisconsin",
    "wyoming": "Wyoming", "washington-dc": "Washington, D.C.",
    "puerto-rico": "Puerto Rico",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def slugify(text: str) -> str:
    """Convert an org name to a URL-safe slug for use in program_id."""
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = text.strip("-")
    return text


def make_program_id(state_slug: str, org_name: str) -> str:
    return f"{PROGRAM_ID_PREFIX}{state_slug}_{slugify(org_name)[:40]}"


def fetch_state_page(state_slug: str) -> BeautifulSoup | None:
    url = f"{BASE_URL}{state_slug}/"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")
    except requests.RequestException as exc:
        print(f"  [WARN] {state_slug}: {exc}")
        return None


def parse_associations(soup: BeautifulSoup, state_slug: str) -> list[dict]:
    """
    Extract all local disc associations from a state page.
    Returns list of dicts with keys: canonical_name, city, state, web_url, program_id
    """
    results = []
    state_name = SLUG_TO_STATE.get(state_slug, state_slug.replace("-", " ").title())

    grid = soup.find("div", class_="locations-grid")
    if not grid:
        return results

    for location in grid.find_all("div", class_="location"):
        headline = location.find("div", class_="headline")
        if not headline:
            continue

        h5 = headline.find("h5")
        h6 = headline.find("h6")
        if not h5 or not h6:
            continue

        city = h5.get_text(strip=True)
        org_name = h6.get_text(strip=True)

        # Find website link inside this location card
        url_div = location.find("div", class_="url")
        web_url = None
        if url_div:
            a = url_div.find("a", href=True)
            if a:
                href = a["href"].strip()
                # Skip internal USAU links that were mis-scraped as relative paths
                if href.startswith("http"):
                    web_url = href

        program_id = make_program_id(state_slug, org_name)

        results.append({
            "program_id": program_id,
            "canonical_name": org_name,
            "city": city,
            "state": state_name,
            "web_url": web_url,
        })

    return results


def upsert_associations(conn: sqlite3.Connection, associations: list[dict], dry_run: bool):
    c = conn.cursor()
    now = datetime.now(timezone.utc).isoformat()
    inserted = 0
    updated = 0
    skipped = 0
    # Track names inserted in this batch to catch same-page duplicates
    seen_in_batch: set[str] = set()

    for assoc in associations:
        # Check if this program_id already exists
        c.execute("SELECT program_id, canonical_name, web_url FROM usau_programs WHERE program_id = ?",
                  (assoc["program_id"],))
        existing = c.fetchone()

        # Deduplicate within the same page
        if assoc["canonical_name"] in seen_in_batch:
            print(f"  [SKIP-PAGE-DUP] {assoc['canonical_name']} duplicate on same page")
            skipped += 1
            continue
        seen_in_batch.add(assoc["canonical_name"])

        if existing:
            # Update web_url if it's now populated and wasn't before
            if assoc["web_url"] and not existing[2]:
                if not dry_run:
                    c.execute(
                        "UPDATE usau_programs SET web_url = ?, built_at = ? WHERE program_id = ?",
                        (assoc["web_url"], now, assoc["program_id"])
                    )
                print(f"  [UPDATE] {assoc['canonical_name']} ({assoc['state']}) — added web_url")
                updated += 1
            else:
                skipped += 1
            continue

        # Check for duplicate by canonical_name + state to avoid double-inserts
        # from overlapping regional pages (e.g. Maryland page includes D.C. orgs)
        c.execute(
            "SELECT program_id FROM usau_programs WHERE canonical_name = ? AND competition_level = ?",
            (assoc["canonical_name"], COMPETITION_LEVEL)
        )
        dup = c.fetchone()
        if dup:
            print(f"  [SKIP-DUP] {assoc['canonical_name']} already exists as {dup[0]}")
            skipped += 1
            continue

        if not dry_run:
            c.execute(
                """INSERT INTO usau_programs
                   (program_id, canonical_name, competition_level, city, state,
                    web_url, active, built_at)
                   VALUES (?, ?, ?, ?, ?, ?, 1, ?)""",
                (
                    assoc["program_id"],
                    assoc["canonical_name"],
                    COMPETITION_LEVEL,
                    assoc["city"],
                    assoc["state"],
                    assoc["web_url"],
                    now,
                )
            )
        print(f"  [INSERT] {assoc['canonical_name']} | {assoc['city']}, {assoc['state']} | {assoc['web_url']}")
        inserted += 1

    if not dry_run:
        conn.commit()

    return inserted, updated, skipped


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Scrape USAU local disc associations into usau_programs.")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing to DB")
    parser.add_argument("--state", help="Process only a single state slug (e.g. maryland)")
    parser.add_argument("--delay", type=float, default=1.0, help="Seconds between requests (default: 1.0)")
    args = parser.parse_args()

    slugs = [args.state] if args.state else STATE_SLUGS

    conn = sqlite3.connect(DB_PATH)

    total_inserted = 0
    total_updated = 0
    total_skipped = 0
    total_associations: list[dict] = []

    print(f"{'[DRY RUN] ' if args.dry_run else ''}Scraping {len(slugs)} state page(s)...\n")

    for slug in slugs:
        print(f"--- {slug} ---")
        soup = fetch_state_page(slug)
        if soup is None:
            print(f"  [SKIP] No page found for {slug}")
            continue

        associations = parse_associations(soup, slug)
        if not associations:
            print(f"  [EMPTY] No associations found on page")
            if args.delay:
                time.sleep(args.delay)
            continue

        print(f"  Found {len(associations)} association(s)")
        i, u, s = upsert_associations(conn, associations, dry_run=args.dry_run)
        total_inserted += i
        total_updated += u
        total_skipped += s
        total_associations.extend(associations)

        if args.delay:
            time.sleep(args.delay)

    conn.close()

    print(f"\n{'[DRY RUN] ' if args.dry_run else ''}Done.")
    print(f"  Total associations found : {len(total_associations)}")
    print(f"  Inserted                 : {total_inserted}")
    print(f"  Updated (web_url added)  : {total_updated}")
    print(f"  Skipped (already exist)  : {total_skipped}")


if __name__ == "__main__":
    main()
