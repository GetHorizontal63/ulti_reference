"""
scrape_nationals_match_reports.py

Scrapes per-game player stats (G, A, D, T) from USAU nationals match report pages
for all games already in the games table that have a match_report_url.

Populates: usau_nationals_player_stats

Usage:
    python scrape_nationals_match_reports.py --db "Z:/Code_Server/.../backend/ultimate.db"
    python scrape_nationals_match_reports.py --db "Z:/..." --dry-run
    python scrape_nationals_match_reports.py --db "Z:/..." --event-slug "USA-Ultimate-National-Championships-2019"
    python scrape_nationals_match_reports.py --db "Z:/..." --limit 10
"""

import argparse
import re
import sqlite3
import time
import logging
from datetime import datetime

import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

BASE_URL   = "https://play.usaultimate.org"
HEADERS    = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
SLEEP        = 4.0
RETRY_SLEEP  = 60.0
MAX_RETRIES  = 2

# Nationals event slugs — only scrape these
NATIONALS_SLUGS = {
    "USA-Ultimate-National-Championships",
    "USA-Ultimate-National-Championships-2015",
    "USA-Ultimate-National-Championships-2016",
    "USA-Ultimate-National-Championships-2017",
    "USA-Ultimate-National-Championships-2018",
    "USA-Ultimate-National-Championships-2019",
    "USA-Ultimate-National-Championships-2021",
    "2022-USA-Ultimate-National-Championships",
    "2023-USA-Ultimate-Club-Championships",
    "2024-usa-ultimate-club-championships",
    "2025-USA-Ultimate-Club-Nationals",
    "USA-Ultimate-D-I-College-Championships",
    "USA-Ultimate-D-I-College-Championships-2015",
    "USA-Ultimate-D-I-College-Championships-2016",
    "USA-Ultimate-D-I-College-Championships-2018",
    "2017-USA-Ultimate-College-Championships",
    "USA-Ultimate-College-Championships-2021",
    "2022-D-I-College-Championships",
    "2023-USA-Ultimate-College-Championships",
    "2024-USA-Ultimate-D-1-College-Championships",
    "2025-USA-Ultimate-College-Championships",
    "USA-Ultimate-D-III-College-Championships",
    "USA-Ultimate-D-III-College-Championships-2015",
    "USA-Ultimate-D-III-College-Championships-2016",
    "USA-Ultimate-D-III-College-Championships-2017",
    "USA-Ultimate-D-III-College-Championships-2018",
    "D-I-College-Championships-2019",
    "D-III-College-Championships-2019",
    "2022-D-III-College-Championships",
    "2023-USA-Ultimate-D3-College-Championships",
    "2024-USA-Ultimate-D-3-College-Championships",
    "2025-USA-Ultimate-D3-College-Championships",
    "D-I-College-Championships-2019",
    "D-III-College-Championships-2019",
    "2024-USA-Ultimate-Club-Championships",
    "2024-USA-Ultimate-D-1-College-Championships",
    "2024-USA-Ultimate-D-3-College-Championships",
    "2025-USA-Ultimate-Club-Nationals",
    "2025-USA-Ultimate-College-Championships",
    "2025-USA-Ultimate-D3-College-Championships",
    "2026-D-I-College-Championships",
    "2026-D-III-College-Championships",
}


def fetch_with_retry(session, url):
    for attempt in range(MAX_RETRIES + 1):
        try:
            time.sleep(SLEEP)
            r = session.get(url, headers=HEADERS, timeout=20)
            if r.status_code == 404:
                log.warning(f"  404: {url}")
                return None
            if r.status_code == 500:
                if attempt < MAX_RETRIES:
                    log.warning(f"  500 attempt {attempt+1}, retrying in {RETRY_SLEEP}s")
                    time.sleep(RETRY_SLEEP)
                    continue
                log.error(f"  500 after retries: {url}")
                return None
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            if attempt < MAX_RETRIES:
                log.warning(f"  Error attempt {attempt+1}: {e}")
                time.sleep(RETRY_SLEEP)
            else:
                log.error(f"  Failed: {e}")
                return None
    return None


def parse_player_name_jersey(raw):
    """
    Parse '#NN Name' -> (name, jersey).
    Examples: '#00 Jacob Janin' -> ('Jacob Janin', '00')
              'Jacob Janin' -> ('Jacob Janin', None)
    """
    m = re.match(r"^#(\w+)\s+(.+)$", raw.strip())
    if m:
        return m.group(2).strip(), m.group(1)
    return raw.strip(), None


def parse_match_report(html, event_game_id, event_slug, conn):
    """
    Parse a match report page. Returns list of stat dicts ready for insert.
    Identifies teams by matching heading text against usau_event_teams.
    """
    soup = BeautifulSoup(html, "html.parser")
    tables = soup.find_all("table")

    # Find tables with G/A/D/T headers
    stat_tables = []
    for t in tables:
        headers = [th.get_text(strip=True) for th in t.find_all("th")]
        if headers == ["Players", "G", "A", "D", "T"]:
            stat_tables.append(t)

    if not stat_tables:
        log.debug(f"  No stat tables found for {event_game_id}")
        return []

    rows_out = []
    now = datetime.utcnow().isoformat()

    for table in stat_tables:
        # Find preceding heading for team name
        heading = table.find_previous(["h1", "h2", "h3", "h4"])
        if not heading:
            log.debug(f"  No heading found for table in {event_game_id}")
            continue
        team_name_raw = heading.get_text(strip=True)

        # Resolve event_team_id from usau_event_teams
        event_team_id = resolve_event_team_id(conn, event_slug, team_name_raw)
        if not event_team_id:
            log.debug(f"  Could not resolve team '{team_name_raw}' for {event_slug}")
            event_team_id = None

        for tr in table.find_all("tr")[1:]:  # skip header row
            cells = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
            if len(cells) < 5:
                continue
            player_raw, g, a, d, t = cells[0], cells[1], cells[2], cells[3], cells[4]
            if not player_raw:
                continue

            player_name, jersey = parse_player_name_jersey(player_raw)

            rows_out.append({
                "event_game_id": event_game_id,
                "event_team_id": event_team_id,
                "numeric_team_id": None,
                "player_name": player_name,
                "jersey_number": jersey,
                "goals":   int(g) if g.isdigit() else None,
                "assists": int(a) if a.isdigit() else None,
                "ds":      int(d) if d.isdigit() else None,
                "turns":   int(t) if t.isdigit() else None,
                "player_id": None,
                "scraped_at": now,
            })

    return rows_out


# Cache event_team lookups to avoid repeated DB queries
_team_cache = {}

def resolve_event_team_id(conn, event_slug, team_name_raw):
    """
    Match team_name_raw (e.g. 'Sockeye (1)') against usau_event_teams.team_name
    for the given event_slug. Falls back to stripped name match.
    """
    key = (event_slug, team_name_raw)
    if key in _team_cache:
        return _team_cache[key]

    # Exact match first
    row = conn.execute(
        "SELECT event_team_id FROM usau_event_teams WHERE event_slug=? AND team_name=?",
        (event_slug, team_name_raw)
    ).fetchone()
    if row:
        _team_cache[key] = row[0]
        return row[0]

    # Strip seed number and try again: 'Sockeye (1)' -> 'Sockeye'
    stripped = re.sub(r"\s*\(\d+\)\s*$", "", team_name_raw).strip()
    row = conn.execute(
        "SELECT event_team_id FROM usau_event_teams WHERE event_slug=? AND team_name LIKE ?",
        (event_slug, f"{stripped}%")
    ).fetchone()
    if row:
        _team_cache[key] = row[0]
        return row[0]

    _team_cache[key] = None
    return None


def insert_stats(conn, rows, dry_run=False):
    sql = """
        INSERT OR IGNORE INTO usau_nationals_player_stats
            (event_game_id, event_team_id, numeric_team_id, player_name, jersey_number,
             goals, assists, ds, turns, player_id, scraped_at)
        VALUES
            (:event_game_id, :event_team_id, :numeric_team_id, :player_name, :jersey_number,
             :goals, :assists, :ds, :turns, :player_id, :scraped_at)
    """
    if dry_run:
        for r in rows:
            log.info(f"  [DRY RUN] {r['player_name']} G={r['goals']} A={r['assists']} D={r['ds']} T={r['turns']}")
        return
    conn.executemany(sql, rows)


def mark_scraped(conn, event_game_id, dry_run=False):
    if dry_run:
        return
    conn.execute(
        "UPDATE games SET match_report_scraped=1 WHERE event_game_id=?",
        (event_game_id,)
    )


def get_games_to_scrape(conn, event_slug_filter=None, limit=None):
    slugs = tuple(NATIONALS_SLUGS)
    placeholders = ",".join("?" * len(slugs))

    if event_slug_filter:
        sql = f"""
            SELECT event_game_id, event_slug, match_report_url
            FROM games
            WHERE event_slug=?
              AND has_match_report=1
              AND match_report_scraped=0
              AND match_report_url IS NOT NULL
            ORDER BY event_game_id
        """
        params = [event_slug_filter]
    else:
        sql = f"""
            SELECT event_game_id, event_slug, match_report_url
            FROM games
            WHERE event_slug IN ({placeholders})
              AND has_match_report=1
              AND match_report_scraped=0
              AND match_report_url IS NOT NULL
            ORDER BY event_slug, event_game_id
        """
        params = list(slugs)

    if limit:
        sql += f" LIMIT {int(limit)}"

    return conn.execute(sql, params).fetchall()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db",           required=True)
    parser.add_argument("--dry-run",      action="store_true")
    parser.add_argument("--event-slug",   help="Scrape a single event only")
    parser.add_argument("--limit",        type=int, help="Max games to scrape")
    parser.add_argument("--debug",        action="store_true")
    args = parser.parse_args()

    if args.debug:
        log.setLevel(logging.DEBUG)

    conn = sqlite3.connect(args.db, timeout=30, isolation_level=None)
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA journal_mode=WAL")
    session = requests.Session()

    games = get_games_to_scrape(conn, args.event_slug, args.limit)
    log.info(f"Games to scrape: {len(games)}")

    total_rows   = 0
    total_errors = 0
    last_slug    = None

    for event_game_id, event_slug, match_report_url in games:
        if event_slug != last_slug:
            log.info(f"Event: {event_slug}")
            last_slug = event_slug

        url = BASE_URL + match_report_url
        r = fetch_with_retry(session, url)
        if r is None:
            total_errors += 1
            continue

        rows = parse_match_report(r.text, event_game_id, event_slug, conn)
        if not rows:
            log.debug(f"  No stats: {event_game_id}")
            mark_scraped(conn, event_game_id, args.dry_run)
            continue

        insert_stats(conn, rows, args.dry_run)
        mark_scraped(conn, event_game_id, args.dry_run)
        total_rows += len(rows)

        if not args.dry_run:
            conn.commit()

        log.debug(f"  {event_game_id}: {len(rows)} player rows")

    conn.close()
    log.info(f"Done. Rows inserted={total_rows} Errors={total_errors}")


if __name__ == "__main__":
    main()