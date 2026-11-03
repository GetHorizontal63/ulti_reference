#!/usr/bin/env python3
"""
USAU Archive Scraper
Scrapes club and college nationals standings from archive.usaultimate.org
and inserts into usau_nationals SQLite table.

Usage:
    python usau_scraper.py --type club --start 1979 --end 2019 --db path/to/ultimate.db
    python usau_scraper.py --type college --start 1979 --end 2019 --db path/to/ultimate.db
    python usau_scraper.py --type both --start 1979 --end 2019 --db path/to/ultimate.db
"""

import argparse
import sqlite3
import time
import re
import sys
from bs4 import BeautifulSoup
import requests

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BASE_URL = "https://archive.usaultimate.org/archives/{year}_{type}.aspx"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; USAU-scraper/1.0)"
}

# Maps division label in HTML to (competition_level, division, gender)
# Club page section anchors: nats_X, nats_O, nats_W
# College page section anchors: DI_O, DI_W, DIII_O, DIII_W
CLUB_SECTION_MAP = {
    "nats_x":  ("Club",    None, "X"),
    "nats_o":  ("Club",    None, "M"),
    "nats_w":  ("Club",    None, "W"),
}

COLLEGE_SECTION_MAP = {
    "di_o":    ("College", "1",  "M"),
    "di_w":    ("College", "1",  "W"),
    "diii_o":  ("College", "3",  "M"),
    "diii_w":  ("College", "3",  "W"),
}

# Years where college DIII didn't exist yet
DIII_START_YEAR = 2010

# Mixed division started 1998 (1997 was unofficial)
MIXED_START_YEAR = 1998


# ---------------------------------------------------------------------------
# Standing normalisation
# ---------------------------------------------------------------------------

def normalise_standing(raw: str) -> str:
    """
    Convert archive standing strings to our DB format.
    '1' -> '1', '2' -> '2', '3T' -> 'T3', '5T' -> 'T5', '13T' -> 'T13'
    Already-correct forms ('T3') passed through unchanged.
    """
    raw = raw.strip()
    if not raw:
        return raw
    # Already in our format
    if raw.startswith("T"):
        return raw
    # Trailing T  e.g. '3T', '13T'
    if raw.endswith("T"):
        return "T" + raw[:-1]
    # Plain number
    return raw


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

def fetch_page(year: int, page_type: str) -> BeautifulSoup | None:
    url = BASE_URL.format(year=year, type=page_type)
    try:
        resp = requests.get(url, headers=HEADERS, timeout=20)
        if resp.status_code == 404:
            print(f"  404: {url}")
            return None
        resp.raise_for_status()
        return BeautifulSoup(resp.text, "html.parser")
    except Exception as e:
        print(f"  ERROR fetching {url}: {e}")
        return None


# ---------------------------------------------------------------------------
# Parse standings tables
# ---------------------------------------------------------------------------

def find_section_table(soup: BeautifulSoup, anchor_name: str):
    """
    Find the standings <table> that follows the <a name="anchor"> element.
    Returns the BeautifulSoup table element or None.
    """
    anchor = soup.find("a", attrs={"name": re.compile(anchor_name, re.IGNORECASE)})
    if not anchor:
        return None

    # Walk forward through siblings/parents to find the next tablesorter
    # The table is usually within the next few sibling/cousin elements
    # Strategy: find all tablesorter tables, pick the one that comes after anchor
    all_tables = soup.find_all("table", class_="tablesorter")
    if not all_tables:
        # Some years use border=1 without class
        all_tables = soup.find_all("table", border="1")

    anchor_pos = str(soup).find(str(anchor))
    for tbl in all_tables:
        tbl_pos = str(soup).find(str(tbl))
        if tbl_pos > anchor_pos:
            return tbl
    return None


def parse_standings_table(table) -> list[dict]:
    """
    Parse a standings table into list of dicts with keys:
    standing, team_name
    """
    rows = []
    if table is None:
        return rows

    tbody = table.find("tbody")
    if not tbody:
        return rows

    for tr in tbody.find_all("tr"):
        cells = tr.find_all("td")
        if len(cells) < 2:
            continue
        standing_raw = cells[0].get_text(strip=True)
        team_raw = cells[1].get_text(strip=True)

        # Skip empty or header-like rows
        if not standing_raw or not team_raw:
            continue
        # Unknown standing (?) -> None (NULL in DB)
        if standing_raw == "?":
            standing = None
        elif not re.match(r"^\d+T?$|^T\d+$", standing_raw):
            continue
        else:
            standing = normalise_standing(standing_raw)
        rows.append({"standing": standing, "team_name": team_raw})

    return rows


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def get_existing_keys(conn: sqlite3.Connection, competition_level: str,
                       division, gender: str, year: int) -> set:
    """Return set of team_names already in DB for this bucket."""
    cur = conn.execute(
        """SELECT team_name FROM usau_nationals
           WHERE competition_level=? AND (division IS ? OR division=?)
             AND gender=? AND year=?""",
        (competition_level, division, division, gender, year)
    )
    return {row[0] for row in cur.fetchall()}


def get_usau_team_id(conn: sqlite3.Connection, team_name: str,
                     competition_level: str, gender: str):
    """Look up existing usau_team_id for this team."""
    cur = conn.execute(
        """SELECT usau_team_id FROM usau_nationals
           WHERE team_name=? AND competition_level=? AND gender=?
             AND usau_team_id IS NOT NULL
           LIMIT 1""",
        (team_name, competition_level, gender)
    )
    row = cur.fetchone()
    return row[0] if row else None


def insert_row(conn: sqlite3.Connection, year: int, competition_level: str,
               division, gender: str, team_name: str, standing: str):
    usau_team_id = get_usau_team_id(conn, team_name, competition_level, gender)
    conn.execute(
        """INSERT OR IGNORE INTO usau_nationals
           (usau_team_id, school_name, team_name, competition_level,
            division, gender, city, state, year, finish)
           VALUES (?, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?)""",
        (usau_team_id, team_name, competition_level, division, gender, year, standing)
    )


# ---------------------------------------------------------------------------
# Scrape one year
# ---------------------------------------------------------------------------

def scrape_year(conn: sqlite3.Connection, year: int, page_type: str,
                section_map: dict, dry_run: bool = False) -> int:
    """Scrape one year/type page. Returns number of rows inserted."""
    print(f"  Fetching {year} {page_type}...")
    soup = fetch_page(year, page_type)
    if soup is None:
        return 0

    total = 0
    for anchor, (comp_level, division, gender) in section_map.items():
        # Skip mixed before 1998
        if gender == "X" and year < MIXED_START_YEAR:
            continue
        # Skip DIII before 2010
        if division == "3" and year < DIII_START_YEAR:
            continue

        table = find_section_table(soup, anchor)
        if table is None:
            # Section may not exist for this year
            continue

        rows = parse_standings_table(table)
        if not rows:
            continue

        existing = get_existing_keys(conn, comp_level, division, gender, year)
        inserted = 0
        for row in rows:
            if row["team_name"] in existing:
                continue
            if not dry_run:
                insert_row(conn, year, comp_level, division, gender,
                           row["team_name"], row["standing"])
            inserted += 1

        if inserted:
            print(f"    {comp_level} {division or ''} {gender} {year}: "
                  f"{inserted} rows inserted ({len(rows)} total in table)")
        total += inserted

    if not dry_run:
        conn.commit()

    return total


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Scrape USAU archive standings")
    parser.add_argument("--type", choices=["club", "college", "both"],
                        default="both", help="Which archive type to scrape")
    parser.add_argument("--start", type=int, default=1979,
                        help="Start year (inclusive)")
    parser.add_argument("--end", type=int, default=2013,
                        help="End year (inclusive)")
    parser.add_argument("--db", required=True,
                        help="Path to SQLite database")
    parser.add_argument("--dry-run", action="store_true",
                        help="Parse and print without writing to DB")
    parser.add_argument("--delay", type=float, default=1.5,
                        help="Seconds to wait between requests")
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    types_to_run = []
    if args.type in ("club", "both"):
        types_to_run.append(("club", CLUB_SECTION_MAP))
    if args.type in ("college", "both"):
        types_to_run.append(("college", COLLEGE_SECTION_MAP))

    grand_total = 0
    for year in range(args.start, args.end + 1):
        # 2020 was COVID, no nationals
        if year == 2020:
            print(f"  Skipping {year} (COVID)")
            continue
        for page_type, section_map in types_to_run:
            count = scrape_year(conn, year, page_type, section_map,
                                dry_run=args.dry_run)
            grand_total += count
            time.sleep(args.delay)

    print(f"\nDone. Total rows {'would be ' if args.dry_run else ''}inserted: {grand_total}")
    conn.close()


if __name__ == "__main__":
    main()