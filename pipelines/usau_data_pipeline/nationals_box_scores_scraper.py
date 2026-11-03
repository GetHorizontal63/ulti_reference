"""
nationals_box_scores_scraper.py

Scrapes per-game player box scores (G, A, Blocks, Turnovers) AND point-by-point
game progression from USAU nationals match report pages (2014-2025).

Populates:
  - usau_nationals_box_scores
  - usau_nationals_game_progression

Uses the match_report_url column in the games table. Identifies nationals events
via a curated set of event slugs. Skips games already present in the target tables.

Usage:
    python nationals_box_scores_scraper.py --db "path/to/ultimate.db"
    python nationals_box_scores_scraper.py --db "path/to/ultimate.db" --event-slug "USA-Ultimate-National-Championships-2019"
    python nationals_box_scores_scraper.py --db "path/to/ultimate.db" --limit 10 --dry-run
    python nationals_box_scores_scraper.py --db "path/to/ultimate.db" --rescrape
    python nationals_box_scores_scraper.py --db "path/to/ultimate.db" --debug
"""

import argparse
import re
import sqlite3
import time
import logging
from datetime import datetime

import requests
from bs4 import BeautifulSoup

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

BASE_URL = "https://play.usaultimate.org"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
SLEEP = 1.5
RETRY_SLEEP = 30.0
MAX_RETRIES = 2

# ---------------------------------------------------------------------------
# Nationals event slugs — exactly as stored in the games table
# ---------------------------------------------------------------------------

# Club nationals
CLUB_SLUGS = {
    2014: "USA-Ultimate-National-Championships",
    2015: "USA-Ultimate-National-Championships-2015",
    2016: "USA-Ultimate-National-Championships-2016",
    2017: "USA-Ultimate-National-Championships-2017",
    2018: "USA-Ultimate-National-Championships-2018",
    2019: "USA-Ultimate-National-Championships-2019",
    2021: "USA-Ultimate-National-Championships-2021",
    2022: "2022-USA-Ultimate-National-Championships",
    2023: "2023-USA-Ultimate-Club-Championships",
    2024: "2024-usa-ultimate-club-championships",
    2025: "2025-USA-Ultimate-Club-Nationals",
}

# College D-I nationals
COLLEGE_D1_SLUGS = {
    2014: "USA-Ultimate-D-I-College-Championships",
    2015: "USA-Ultimate-D-I-College-Championships-2015",
    2016: "USA-Ultimate-D-I-College-Championships-2016",
    2017: "2017-USA-Ultimate-College-Championships",
    2018: "USA-Ultimate-D-I-College-Championships-2018",
    2019: "D-I-College-Championships-2019",
    2021: "USA-Ultimate-College-Championships-2021",
    2022: "2022-D-I-College-Championships",
    2023: "2023-USA-Ultimate-College-Championships",
    2024: "2024-USA-Ultimate-D-1-College-Championships",
    2025: "2025-USA-Ultimate-College-Championships",
}

# College D-III nationals
COLLEGE_D3_SLUGS = {
    2014: "USA-Ultimate-D-III-College-Championships",
    2015: "USA-Ultimate-D-III-College-Championships-2015",
    2016: "USA-Ultimate-D-III-College-Championships-2016",
    2017: "USA-Ultimate-D-III-College-Championships-2017",
    2018: "USA-Ultimate-D-III-College-Championships-2018",
    2019: "D-III-College-Championships-2019",
    2021: "USA-Ultimate-College-Championships-2021",
    2022: "2022-D-III-College-Championships",
    2023: "2023-USA-Ultimate-D3-College-Championships",
    2024: "2024-USA-Ultimate-D-3-College-Championships",
    2025: "2025-USA-Ultimate-D3-College-Championships",
}

ALL_CLUB_SLUGS_LOWER  = {v.lower() for v in CLUB_SLUGS.values()}
ALL_D1_SLUGS_LOWER    = {v.lower() for v in COLLEGE_D1_SLUGS.values()}
ALL_D3_SLUGS_LOWER    = {v.lower() for v in COLLEGE_D3_SLUGS.values()}

NATIONALS_SLUGS = (
    set(CLUB_SLUGS.values())
    | set(COLLEGE_D1_SLUGS.values())
    | set(COLLEGE_D3_SLUGS.values())
)

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def init_tables(conn: sqlite3.Connection) -> None:
    """Create usau_nationals_box_scores and usau_nationals_game_progression if needed."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS usau_nationals_box_scores (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            event           TEXT,
            level           TEXT,
            event_slug      TEXT NOT NULL,
            game_id         TEXT NOT NULL,
            uniform_number  TEXT,
            player_name     TEXT NOT NULL,
            player_usau_id  TEXT,
            goals           INTEGER,
            assists         INTEGER,
            blocks          INTEGER,
            turnovers       INTEGER,
            scraped_at      TEXT,
            UNIQUE (game_id, player_name)
        );
        CREATE INDEX IF NOT EXISTS idx_nbs_game   ON usau_nationals_box_scores(game_id);
        CREATE INDEX IF NOT EXISTS idx_nbs_player ON usau_nationals_box_scores(player_name);
        CREATE INDEX IF NOT EXISTS idx_nbs_slug   ON usau_nationals_box_scores(event_slug);

        CREATE TABLE IF NOT EXISTS usau_nationals_game_progression (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            event               TEXT,
            level               TEXT,
            event_slug          TEXT NOT NULL,
            game_id             TEXT NOT NULL,
            home_event_team_id  TEXT,
            away_event_team_id  TEXT,
            home_team_name      TEXT,
            away_team_name      TEXT,
            home_usau_team_id   TEXT,
            away_usau_team_id   TEXT,
            point               INTEGER NOT NULL,
            home_score          INTEGER NOT NULL,
            away_score          INTEGER NOT NULL,
            UNIQUE (game_id, point)
        );
        CREATE INDEX IF NOT EXISTS idx_ngp_game ON usau_nationals_game_progression(game_id);
        CREATE INDEX IF NOT EXISTS idx_ngp_slug ON usau_nationals_game_progression(event_slug);
    """)
    # Migrate: apply schema changes for tables created by earlier versions
    existing_cols = {r[1] for r in conn.execute("PRAGMA table_info(usau_nationals_game_progression)")}
    if "home_event_team_id" not in existing_cols:
        conn.execute("ALTER TABLE usau_nationals_game_progression ADD COLUMN home_event_team_id TEXT")
    if "away_event_team_id" not in existing_cols:
        conn.execute("ALTER TABLE usau_nationals_game_progression ADD COLUMN away_event_team_id TEXT")
    if "home_team_name" not in existing_cols:
        conn.execute("ALTER TABLE usau_nationals_game_progression ADD COLUMN home_team_name TEXT")
    if "away_team_name" not in existing_cols:
        conn.execute("ALTER TABLE usau_nationals_game_progression ADD COLUMN away_team_name TEXT")
    if "home_usau_team_id" not in existing_cols:
        conn.execute("ALTER TABLE usau_nationals_game_progression ADD COLUMN home_usau_team_id TEXT")
    if "away_usau_team_id" not in existing_cols:
        conn.execute("ALTER TABLE usau_nationals_game_progression ADD COLUMN away_usau_team_id TEXT")
    # Rename old score columns if table was created with team_1_score/team_2_score names
    if "team_1_score" in existing_cols and "home_score" not in existing_cols:
        conn.execute("ALTER TABLE usau_nationals_game_progression RENAME COLUMN team_1_score TO home_score")
    if "team_2_score" in existing_cols and "away_score" not in existing_cols:
        conn.execute("ALTER TABLE usau_nationals_game_progression RENAME COLUMN team_2_score TO away_score")
    # Drop superseded display-name columns (replaced by home_team_name / away_team_name)
    if "team_1" in existing_cols:
        conn.execute("ALTER TABLE usau_nationals_game_progression DROP COLUMN team_1")
    if "team_2" in existing_cols:
        conn.execute("ALTER TABLE usau_nationals_game_progression DROP COLUMN team_2")


_event_title_cache: dict[str, str] = {}

_SEED_RE = re.compile(r'\s*\(\d+\)\s*$')

def strip_seed(name: str | None) -> str | None:
    """Remove trailing tournament seed like ' (1)' or ' (13)' from a team name."""
    if not name:
        return name
    return _SEED_RE.sub('', name).strip() or name


_usau_team_id_cache: dict[str, str | None] = {}

def lookup_usau_team_id(conn: sqlite3.Connection, team_name: str | None) -> str | None:
    """Look up usau_team_id from usau_teams by canonical team_name (seed already stripped)."""
    if not team_name:
        return None
    if team_name in _usau_team_id_cache:
        return _usau_team_id_cache[team_name]
    row = conn.execute(
        "SELECT usau_team_id FROM usau_teams WHERE team_name = ? LIMIT 1",
        (team_name,),
    ).fetchone()
    result = row[0] if row else None
    _usau_team_id_cache[team_name] = result
    return result

def get_event_title(conn: sqlite3.Connection, event_slug: str) -> str:
    if event_slug in _event_title_cache:
        return _event_title_cache[event_slug]
    row = conn.execute(
        "SELECT event_title FROM events WHERE event_slug=? LIMIT 1",
        (event_slug,),
    ).fetchone()
    title = row[0] if row else event_slug
    _event_title_cache[event_slug] = title
    return title


def get_level(event_slug: str, division_label: str) -> str:
    """
    Derive a human-readable competition level from the event slug and
    division_label (e.g. 'Club-Men-Men' -> 'Club Men').
    """
    slug_lower = event_slug.lower()
    dl = (division_label or "").lower()

    # Determine competition tier from slug
    if slug_lower in ALL_D3_SLUGS_LOWER:
        tier = "College D3"
    elif slug_lower in ALL_D1_SLUGS_LOWER:
        tier = "College D1"
    elif slug_lower in ALL_CLUB_SLUGS_LOWER:
        tier = "Club"
    elif "d-iii" in slug_lower or "d-3" in slug_lower or "d3" in slug_lower:
        tier = "College D3"
    elif "d-i" in slug_lower or "d-1" in slug_lower or "college" in slug_lower:
        tier = "College D1"
    else:
        tier = "Club"

    # Determine gender from division_label
    if "women" in dl:
        gender = "Women"
    elif "mixed" in dl:
        gender = "Mixed"
    elif "men" in dl:
        gender = "Men"
    else:
        gender = ""

    return f"{tier} {gender}".strip() if gender else tier


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def fetch_with_retry(session: requests.Session, url: str):
    for attempt in range(MAX_RETRIES + 1):
        try:
            time.sleep(SLEEP)
            r = session.get(url, headers=HEADERS, timeout=20)
            if r.status_code == 404:
                log.warning("  404: %s", url)
                return None
            if r.status_code == 500:
                if attempt < MAX_RETRIES:
                    log.warning("  500 attempt %d, retrying in %.0fs", attempt + 1, RETRY_SLEEP)
                    time.sleep(RETRY_SLEEP)
                    continue
                log.error("  500 after retries: %s", url)
                return None
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            if attempt < MAX_RETRIES:
                log.warning("  Error attempt %d: %s", attempt + 1, e)
                time.sleep(RETRY_SLEEP)
            else:
                log.error("  Failed: %s", e)
                return None
    return None


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def parse_player_name_jersey(raw: str) -> tuple[str, str | None]:
    """
    '#00 Wilson Matthews' -> ('Wilson Matthews', '00')
    'Wilson Matthews'     -> ('Wilson Matthews', None)
    """
    m = re.match(r"^#(\S+)\s+(.+)$", raw.strip())
    if m:
        return m.group(2).strip(), m.group(1)
    return raw.strip(), None


def parse_box_scores(
    soup: BeautifulSoup,
    event_slug: str,
    game_id: str,
    event: str,
    level: str,
    now: str,
) -> list[dict]:
    """
    Parse home (CT_Main_0_gvHomeList) and away (CT_Main_0_gvAwayList) player
    stats tables. Returns a list of row dicts ready for INSERT.
    """
    rows = []
    for table_id in ("CT_Main_0_gvHomeList", "CT_Main_0_gvAwayList"):
        table = soup.find("table", id=table_id)
        if not table:
            continue

        for tr in table.find_all("tr")[1:]:  # skip header row
            tds = tr.find_all("td")
            if len(tds) < 5:
                continue

            player_raw = tds[0].get_text(strip=True)
            if not player_raw:
                continue

            player_name, jersey = parse_player_name_jersey(player_raw)

            def safe_int(cell_text: str) -> int:
                return int(cell_text) if cell_text.isdigit() else 0

            rows.append({
                "event":          event,
                "level":          level,
                "event_slug":     event_slug,
                "game_id":        game_id,
                "uniform_number": jersey,
                "player_name":    player_name,
                "player_usau_id": None,  # populated via post-processing join
                "goals":          safe_int(tds[1].get_text(strip=True)),
                "assists":        safe_int(tds[2].get_text(strip=True)),
                "blocks":         safe_int(tds[3].get_text(strip=True)),
                "turnovers":      safe_int(tds[4].get_text(strip=True)),
                "scraped_at":     now,
            })

    return rows


def parse_game_progression(
    soup: BeautifulSoup,
    event_slug: str,
    game_id: str,
    event: str,
    level: str,
    home_event_team_id: str | None,
    away_event_team_id: str | None,
    home_team_name: str | None,
    away_team_name: str | None,
    home_usau_team_id: str | None,
    away_usau_team_id: str | None,
) -> list[dict]:
    """
    Parse the CT_Main_0_gvGameSummary table for point-by-point score progression.

    The table has exactly two data rows. The first row is the home team, the
    second is the away team — matching home_event_team_id / away_event_team_id
    from the games table. Each score cell (excluding the team name cell and
    the trailing "Total: N" cell) is the cumulative score after each successive
    point. Empty cells mean that team did not score; scores are forward-filled.
    """
    table = soup.find("table", id="CT_Main_0_gvGameSummary")
    if not table:
        return []

    data_rows = table.find_all("tr")
    if len(data_rows) < 2:
        return []

    def extract_score_cells(tr) -> list[str]:
        """Return score cell text values, excluding team name (first) and Total (last)."""
        tds = tr.find_all("td")
        if len(tds) < 2:
            return []
        cells = [td.get_text(strip=True) for td in tds[1:]]
        if cells and cells[-1].lower().startswith("total"):
            cells = cells[:-1]
        return cells

    row1_cells = extract_score_cells(data_rows[0])
    row2_cells = extract_score_cells(data_rows[1])

    if not row1_cells and not row2_cells:
        return []

    # Pad to same length
    max_len = max(len(row1_cells), len(row2_cells))
    row1_cells += [""] * (max_len - len(row1_cells))
    row2_cells += [""] * (max_len - len(row2_cells))

    progression = []
    t1_score = 0
    t2_score = 0
    point = 0

    for v1, v2 in zip(row1_cells, row2_cells):
        # Trailing blanks → game is over
        if v1 == "" and v2 == "":
            break

        # Forward-fill: non-empty digit cell updates the running score
        if v1.isdigit():
            t1_score = int(v1)
        if v2.isdigit():
            t2_score = int(v2)

        point += 1
        progression.append({
            "event":              event,
            "level":              level,
            "event_slug":         event_slug,
            "game_id":            game_id,
            "home_event_team_id": home_event_team_id,
            "away_event_team_id": away_event_team_id,
            "home_team_name":     home_team_name,
            "away_team_name":     away_team_name,
            "home_usau_team_id":  home_usau_team_id,
            "away_usau_team_id":  away_usau_team_id,
            "point":              point,
            "home_score":         t1_score,
            "away_score":         t2_score,
        })

    return progression


# ---------------------------------------------------------------------------
# DB writes
# ---------------------------------------------------------------------------

def insert_box_scores(conn: sqlite3.Connection, rows: list[dict], dry_run: bool = False) -> int:
    sql = """
        INSERT OR IGNORE INTO usau_nationals_box_scores
            (event, level, event_slug, game_id, uniform_number, player_name,
             player_usau_id, goals, assists, blocks, turnovers, scraped_at)
        VALUES
            (:event, :level, :event_slug, :game_id, :uniform_number, :player_name,
             :player_usau_id, :goals, :assists, :blocks, :turnovers, :scraped_at)
    """
    if dry_run:
        for r in rows:
            log.info(
                "  [DRY RUN] Box  %-30s  G=%-2s A=%-2s B=%-2s T=%-2s",
                r["player_name"], r["goals"], r["assists"], r["blocks"], r["turnovers"],
            )
        return len(rows)
    conn.executemany(sql, rows)
    return len(rows)


def insert_progression(conn: sqlite3.Connection, rows: list[dict], dry_run: bool = False) -> int:
    sql = """
        INSERT OR IGNORE INTO usau_nationals_game_progression
            (event, level, event_slug, game_id,
             home_event_team_id, away_event_team_id,
             home_team_name, away_team_name,
             home_usau_team_id, away_usau_team_id,
             point, home_score, away_score)
        VALUES
            (:event, :level, :event_slug, :game_id,
             :home_event_team_id, :away_event_team_id,
             :home_team_name, :away_team_name,
             :home_usau_team_id, :away_usau_team_id,
             :point, :home_score, :away_score)
    """
    if dry_run:
        for r in rows:
            log.info(
                "  [DRY RUN] Prog pt=%-3d  %s %d - %d %s",
                r["point"], r["home_team_name"] or r["home_event_team_id"],
                r["home_score"], r["away_score"],
                r["away_team_name"] or r["away_event_team_id"],
            )
        return len(rows)
    conn.executemany(sql, rows)
    return len(rows)


def clear_game(conn: sqlite3.Connection, game_id: str) -> None:
    """Remove existing rows for a game (used with --rescrape)."""
    conn.execute("DELETE FROM usau_nationals_box_scores WHERE game_id=?", (game_id,))
    conn.execute("DELETE FROM usau_nationals_game_progression WHERE game_id=?", (game_id,))


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------

def get_games_to_scrape(
    conn: sqlite3.Connection,
    event_slug_filter: str | None,
    limit: int | None,
    rescrape: bool,
) -> list[sqlite3.Row]:
    slugs = tuple(NATIONALS_SLUGS)
    ph = ",".join("?" * len(slugs))

    # When rescraping, skip the NOT EXISTS filter
    already_done_filter = "" if rescrape else """
        AND NOT EXISTS (
            SELECT 1 FROM usau_nationals_box_scores b
            WHERE b.game_id = g.event_game_id
        )
    """

    if event_slug_filter:
        sql = f"""
            SELECT g.event_game_id, g.event_slug, g.division_label, g.match_report_url,
                   g.home_event_team_id, g.away_event_team_id,
                   ht.team_name AS home_team_name, at.team_name AS away_team_name,
                   ht.usau_team_id AS home_usau_team_id, at.usau_team_id AS away_usau_team_id
            FROM games g
            LEFT JOIN usau_event_teams ht ON ht.event_team_id = g.home_event_team_id
            LEFT JOIN usau_event_teams at ON at.event_team_id = g.away_event_team_id
            WHERE g.event_slug = ?
              AND g.has_match_report = 1
              AND g.match_report_url IS NOT NULL
              {already_done_filter}
            ORDER BY g.event_game_id
        """
        params: list = [event_slug_filter]
    else:
        sql = f"""
            SELECT g.event_game_id, g.event_slug, g.division_label, g.match_report_url,
                   g.home_event_team_id, g.away_event_team_id,
                   ht.team_name AS home_team_name, at.team_name AS away_team_name,
                   ht.usau_team_id AS home_usau_team_id, at.usau_team_id AS away_usau_team_id
            FROM games g
            LEFT JOIN usau_event_teams ht ON ht.event_team_id = g.home_event_team_id
            LEFT JOIN usau_event_teams at ON at.event_team_id = g.away_event_team_id
            WHERE g.event_slug IN ({ph})
              AND g.has_match_report = 1
              AND g.match_report_url IS NOT NULL
              {already_done_filter}
            ORDER BY g.event_slug, g.event_game_id
        """
        params = list(slugs)

    if limit:
        sql += f" LIMIT {int(limit)}"

    return conn.execute(sql, params).fetchall()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape USAU nationals match reports into box_scores and game_progression tables."
    )
    parser.add_argument("--db",          required=True,       help="Path to ultimate.db")
    parser.add_argument("--event-slug",  default=None,        help="Scrape a single event only")
    parser.add_argument("--limit",       type=int, default=None, help="Max games to scrape")
    parser.add_argument("--dry-run",     action="store_true", help="Parse and log without writing")
    parser.add_argument("--rescrape",    action="store_true", help="Re-scrape games already in the tables")
    parser.add_argument("--debug",       action="store_true", help="Verbose logging")
    args = parser.parse_args()

    if args.debug:
        log.setLevel(logging.DEBUG)

    conn = sqlite3.connect(args.db, timeout=30, isolation_level=None)
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row

    init_tables(conn)

    games = get_games_to_scrape(conn, args.event_slug, args.limit, args.rescrape)
    log.info("Games to scrape: %d", len(games))

    if not games:
        log.info("Nothing to do.")
        conn.close()
        return

    session = requests.Session()

    total_bs_rows  = 0  # box score rows inserted
    total_gp_rows  = 0  # game progression rows inserted
    total_errors   = 0
    last_slug      = None

    for row in games:
        event_game_id      = row["event_game_id"]
        event_slug         = row["event_slug"]
        division_label     = row["division_label"] or ""
        match_report_url   = row["match_report_url"]
        home_event_team_id = row["home_event_team_id"]
        away_event_team_id = row["away_event_team_id"]
        home_team_name     = strip_seed(row["home_team_name"])
        away_team_name     = strip_seed(row["away_team_name"])
        home_usau_team_id  = row["home_usau_team_id"] or lookup_usau_team_id(conn, home_team_name)
        away_usau_team_id  = row["away_usau_team_id"] or lookup_usau_team_id(conn, away_team_name)

        if event_slug != last_slug:
            log.info("Event: %s", event_slug)
            last_slug = event_slug

        event = get_event_title(conn, event_slug)
        level = get_level(event_slug, division_label)

        url = BASE_URL + match_report_url
        log.debug("  Fetching %s", url)

        r = fetch_with_retry(session, url)
        if r is None:
            log.warning("  Skipping %s (fetch failed)", event_game_id)
            total_errors += 1
            continue

        soup = BeautifulSoup(r.text, "html.parser")
        now = datetime.utcnow().isoformat()

        # --- Box scores ---
        bs_rows = parse_box_scores(soup, event_slug, event_game_id, event, level, now)
        if not bs_rows:
            log.debug("  No box score rows for %s", event_game_id)
        else:
            if args.rescrape and not args.dry_run:
                clear_game(conn, event_game_id)
            total_bs_rows += insert_box_scores(conn, bs_rows, args.dry_run)

        # --- Game progression ---
        gp_rows = parse_game_progression(soup, event_slug, event_game_id, event, level,
                                         home_event_team_id, away_event_team_id,
                                         home_team_name, away_team_name,
                                         home_usau_team_id, away_usau_team_id)
        if not gp_rows:
            log.debug("  No game progression for %s", event_game_id)
        else:
            if args.rescrape and not args.dry_run and bs_rows:
                # already cleared above; avoid double-clear if no bs_rows
                pass
            elif args.rescrape and not args.dry_run and not bs_rows:
                clear_game(conn, event_game_id)
            total_gp_rows += insert_progression(conn, gp_rows, args.dry_run)

        if not args.dry_run:
            conn.execute("BEGIN")
            conn.execute("COMMIT")  # no-op in autocommit but explicit flush
            pass  # WAL mode; each executemany already committed in autocommit

        log.info(
            "  %s  bs=%d  gp=%d",
            event_game_id, len(bs_rows), len(gp_rows),
        )

    conn.close()
    log.info(
        "Done. box_score_rows=%d  progression_rows=%d  errors=%d",
        total_bs_rows, total_gp_rows, total_errors,
    )


if __name__ == "__main__":
    main()
