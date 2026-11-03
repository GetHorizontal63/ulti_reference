#!/usr/bin/env python3
"""
sync_all.py — Master new-data checker for UFA, USAU, PUL, and WUL.

Checks every data table for each league and reports gaps.
Optionally runs the appropriate scrapers to fill them.

Usage:
  python sync_all.py                    # check only — print gap report
  python sync_all.py --run              # check + run scrapers for any gaps
  python sync_all.py --run --force      # force re-scrape everything
  python sync_all.py --league ufa,pul   # limit to specific leagues
  python sync_all.py --run --league wul # run WUL scraper only

Tables covered:
  UFA:        ufa_games, ufa_team_seasons, ufa_teams, ufa_franchises,
              ufa_players, ufa_player_season_stats, ufa_game_events,
              ufa_game_events_dictionary
  Shownspace: shownspace_games, shownspace_player_stats, shownspace_team_stats,
              shownspace_recent_team_stats, shownspace_blocks, shownspace_pulls,
              shownspace_throws, shownspace_game_links
  USAU:       events, games, game_player_stats, game_urls, teams, team_coaches,
              players, usau_event_teams, usau_nationals, usau_nomination_videos,
              usau_player_ids, usau_programs, usau_regions, usau_teams,
              usau_upa_events, usau_upa_games, usau_upa_teams
  PUL:        pul_player_season_stats, pul_game_index,
              pul_team_game_stats, pul_player_game_stats
  WUL:        wul_player_game_stats, wul_team_game_stats,
              wul_team_name_aliases, wul_teams
"""
import argparse
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────
ROOT     = Path(__file__).resolve().parent
DB_PATH  = Path(os.environ.get("UFA_DB_PATH") or ROOT / "data" / "db" / "ultimate.db")
USAU_DIR = ROOT / "pipelines" / "usau_data_pipeline"
UFA_DIR  = ROOT / "pipelines" / "ufa_data_pipeline"
PUL_DIR  = ROOT / "pipelines" / "pul_data_pipeline"
WUL_DIR  = ROOT / "pipelines" / "wul_data_pipeline"
WUL_RAW  = ROOT / "data" / "raw" / "wul"

# ── Season definitions ────────────────────────────────────────────────────
CURRENT_YEAR     = datetime.now(timezone.utc).year
UFA_FIRST_YEAR   = 2012
UFA_GAME_YEARS   = list(range(UFA_FIRST_YEAR, CURRENT_YEAR + 1))
UFA_SKIP_YEARS   = {2020}
UFA_STAT_SEASONS = sorted({2019, 2021, 2022, 2023, 2024, 2025} | {CURRENT_YEAR})
USAU_YEAR_RANGE  = range(2014, CURRENT_YEAR + 1)   # scraper only covers 2014+
PUL_SEASONS      = sorted({"2022", "2023", "2024", "2025", str(CURRENT_YEAR)}) + ["career"]
WUL_YEARS        = sorted({"2022", "2023", "2024", "2025", str(CURRENT_YEAR)})
WUL_DATA_TYPES   = [
    "player_standard_game", "player_advanced_game",
    "team_standard_game",   "team_advanced_game",
]

# ── ANSI colours ──────────────────────────────────────────────────────────
_G = "\033[92m"; _Y = "\033[93m"; _R = "\033[91m"
_C = "\033[96m"; _B = "\033[1m";  _X = "\033[0m"

def _ok(msg):   print(f"  {_G}v{_X}  {msg}")
def _gap(msg):  print(f"  {_Y}~{_X}  {msg}")
def _miss(msg): print(f"  {_R}x{_X}  {msg}")
def _hdr(msg):  print(f"\n{_B}{_C}{msg}{_X}")

# ── DB helpers ────────────────────────────────────────────────────────────
def _db() -> sqlite3.Connection:
    if not DB_PATH.exists():
        print(f"{_R}ERROR{_X}: DB not found at {DB_PATH}")
        sys.exit(1)
    conn = sqlite3.connect(DB_PATH, timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def _exists(conn, table: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone() is not None

def _count(conn, table: str, where: str = "", params=()) -> int:
    if not _exists(conn, table):
        return -1
    q = f"SELECT COUNT(*) FROM {table}"
    if where:
        q += f" WHERE {where}"
    return conn.execute(q, params).fetchone()[0]

def _check(conn, table: str, label: str = "") -> int:
    """Print a single-line status for a table total. Returns row count."""
    n   = _count(conn, table)
    lbl = label or table
    if n < 0:
        _miss(f"{lbl}: table missing")
    elif n == 0:
        _miss(f"{lbl}: 0 rows")
    else:
        _ok(f"{lbl}: {n:,} rows")
    return n

# ── Subprocess runner ─────────────────────────────────────────────────────
_VENV_PYTHON = ROOT / ".venv" / "Scripts" / "python.exe"

def _run(cmd: list, cwd: Path) -> int:
    # Use venv Python if available, regardless of how sync_all.py was invoked
    if cmd and str(cmd[0]) == sys.executable and _VENV_PYTHON.exists():
        cmd = [str(_VENV_PYTHON)] + list(cmd[1:])
    # Inject workspace root onto PYTHONPATH so 'from pipelines...' imports resolve
    env = os.environ.copy()
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(ROOT) + (os.pathsep + existing if existing else "")
    print(f"  $ {' '.join(str(c) for c in cmd)}")
    return subprocess.run(cmd, cwd=str(cwd), env=env).returncode


# =========================================================================
# UFA
# =========================================================================
def check_ufa(conn) -> dict:
    gaps = {
        "games_missing_years":      [],
        "stale_years":              [],
        "unscraped_players":        0,
        "stat_seasons_missing":     [],
        "stat_seasons_stale":        [],
        "shownspace_missing_years": [],
        "stale_shownspace_ids":     [],
        "game_events_empty":        False,
    }

    # ufa_teams, ufa_franchises (totals only)
    _hdr("  UFA reference tables")
    _check(conn, "ufa_teams")
    _check(conn, "ufa_franchises")

    # ufa_games + ufa_team_seasons — per year, compared against API
    _hdr("  ufa_games + ufa_team_seasons (per year vs API)")
    try:
        import httpx
        api_counts: dict[int, int | None] = {}
        with httpx.Client(timeout=10) as client:
            for year in UFA_GAME_YEARS:
                if year in UFA_SKIP_YEARS:
                    continue
                try:
                    r = client.get(
                        "https://www.backend.ufastats.com/api/v1/games",
                        params={"date": str(year)},
                        headers={"User-Agent": "UltimateReference/1.0"},
                        timeout=10,
                    )
                    r.raise_for_status()
                    api_counts[year] = len(r.json().get("data", []))
                    time.sleep(0.3)
                except Exception:
                    api_counts[year] = None
    except ImportError:
        api_counts = {}

    for year in UFA_GAME_YEARS:
        if year in UFA_SKIP_YEARS:
            continue
        db_g  = _count(conn, "ufa_games",       "year=?", (year,))
        db_ts = _count(conn, "ufa_team_seasons", "year=?", (year,))
        api_n = api_counts.get(year)

        games_lbl = (
            f"games={db_g} (API unreachable)" if api_n is None
            else f"games={db_g}/{api_n}"
        )
        ts_lbl = f"team_seasons={db_ts}" if db_ts >= 0 else "team_seasons=MISSING"

        short = f"  {year}: {games_lbl}, {ts_lbl}"
        # Past games (before now) that aren't Final yet
        now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        stale = _count(
            conn, "ufa_games",
            "year=? AND start_timestamp < ? AND status != 'Final'",
            (year, now_iso)
        )
        stale_note = f"  {_R}({stale} past games not Final — need rescrape){_X}" if stale > 0 else ""

        if db_g <= 0 or db_ts <= 0:
            _miss(short + stale_note)
            if year not in gaps["games_missing_years"]:
                gaps["games_missing_years"].append(year)
        elif api_n is not None and db_g < api_n:
            _gap(short + f"  (+{api_n - db_g} count missing)" + stale_note)
            if year not in gaps["games_missing_years"]:
                gaps["games_missing_years"].append(year)
        elif stale > 0:
            _gap(short + stale_note)
            if year not in gaps["stale_years"]:
                gaps["stale_years"].append(year)
        else:
            _ok(short)

    # ufa_players
    _hdr("  ufa_players")
    total     = _count(conn, "ufa_players")
    unscraped = _count(conn, "ufa_players", "scraped_at IS NULL")
    if total < 0:
        _miss("ufa_players: table missing")
    elif unscraped > 0:
        _gap(f"ufa_players: {unscraped:,} of {total:,} not yet scraped")
        gaps["unscraped_players"] = unscraped
    else:
        _ok(f"ufa_players: {total:,} all scraped")

    # ufa_player_season_stats — per year
    _hdr("  ufa_player_season_stats (per year)")
    for year in UFA_STAT_SEASONS:
        n = _count(conn, "ufa_player_season_stats", "year=?", (year,))
        if n <= 0:
            _miss(f"  {year}: {n} rows")
            gaps["stat_seasons_missing"].append(year)
        else:
            # Always refresh stats for the current (active) season.
            if year == CURRENT_YEAR:
                _gap(f"  {year}: {n:,} rows  ({_Y}active season — always refresh{_X})")
                gaps["stat_seasons_stale"].append(year)
            else:
                _ok(f"  {year}: {n:,} rows")

    # ufa_game_events + dictionary
    _hdr("  ufa_game_events")
    n_ev = _check(conn, "ufa_game_events")
    _check(conn, "ufa_game_events_dictionary")
    if n_ev == 0:
        gaps["game_events_empty"] = True

    # shownspace — per year + all sub-tables
    _hdr("  shownspace_games (per year)")
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    for year in UFA_STAT_SEASONS:
        n = _count(conn, "shownspace_games", "year=?", (year,))
        stale = _count(
            conn, "shownspace_games",
            "year=? AND start_timestamp < ? AND is_final != 1",
            (year, now_iso)
        )
        stale_note = f"  {_R}({stale} past games not finalized){_X}" if stale > 0 else ""
        if n <= 0:
            _miss(f"  {year}: {n} rows")
            gaps["shownspace_missing_years"].append(year)
        elif stale > 0:
            _gap(f"  {year}: {n:,} rows" + stale_note)
            # Collect the actual stale game IDs so we can targeted-rescrape them
            rows = conn.execute(
                "SELECT game_id FROM shownspace_games "
                "WHERE year=? AND start_timestamp < ? AND is_final != 1",
                (year, now_iso)
            ).fetchall()
            for (gid,) in rows:
                if gid not in gaps["stale_shownspace_ids"]:
                    gaps["stale_shownspace_ids"].append(gid)
        else:
            _ok(f"  {year}: {n:,} rows")

    _hdr("  shownspace sub-tables")
    _check(conn, "shownspace_player_stats")
    _check(conn, "shownspace_team_stats")
    _check(conn, "shownspace_recent_team_stats")
    _check(conn, "shownspace_blocks")
    _check(conn, "shownspace_pulls")
    _check(conn, "shownspace_throws")
    _check(conn, "shownspace_game_links")

    return gaps


def run_ufa(gaps: dict, force: bool) -> None:
    years = gaps.get("games_missing_years", [])
    stale_years = gaps.get("stale_years", [])

    # For years with stale (past-but-not-Final) games, force re-scrape so
    # INSERT OR REPLACE updates status/scores on existing rows.
    force_years = list(set(years) | set(stale_years))
    if force_years or force:
        cmd = [sys.executable, str(UFA_DIR / "ufa_games_scraper.py")]
        if force_years and not force:
            cmd += ["--years", ",".join(str(y) for y in sorted(force_years)), "--force"]
        elif force:
            cmd += ["--force"]
        _run(cmd, UFA_DIR)

    if gaps.get("unscraped_players") or force:
        cmd = [sys.executable, str(UFA_DIR / "ufa_scraper.py"), "--phases", "2"]
        if force:
            cmd += ["--force"]
        _run(cmd, UFA_DIR)

    if gaps.get("stat_seasons_missing") or gaps.get("stat_seasons_stale") or force:
        cmd = [sys.executable, str(UFA_DIR / "ufa_scraper.py"), "--phases", "3"]
        if force:
            cmd += ["--force"]
        else:
            stale = gaps.get("stat_seasons_stale", [])
            missing = gaps.get("stat_seasons_missing", [])
            years_to_force = sorted(set(stale) | set(missing))
            if years_to_force:
                cmd += ["--force-years", ",".join(str(y) for y in years_to_force)]
        _run(cmd, UFA_DIR)

    if gaps.get("game_events_empty") or force:
        _run([sys.executable, str(UFA_DIR / "ufa_events_scraper.py")], UFA_DIR)

    # Shownspace: re-scrape only the specific stale game IDs (past, not finalized)
    stale_ids = gaps.get("stale_shownspace_ids", [])
    if stale_ids:
        chunk = ",".join(stale_ids)
        _run([sys.executable, str(UFA_DIR / "shownspace_scrape.py"), "--game-ids", chunk], UFA_DIR)
    elif gaps.get("shownspace_missing_years") or force:
        cmd = [sys.executable, str(UFA_DIR / "shownspace_scrape.py")]
        if force:
            cmd += ["--no-resume"]
        _run(cmd, UFA_DIR)


# =========================================================================
# USAU
# =========================================================================
def check_usau(conn) -> dict:
    gaps = {"missing_seasons": [], "seasons_with_empty_events": [], "stale_event_slugs": []}

    # Core tables — totals
    _hdr("  USAU core tables")
    _check(conn, "events")
    _check(conn, "games")
    _check(conn, "game_player_stats")
    _check(conn, "game_urls")
    _check(conn, "teams")
    _check(conn, "team_coaches")
    _check(conn, "players")

    # usau_* tables — totals
    _hdr("  usau_* tables")
    _check(conn, "usau_event_teams")
    _check(conn, "usau_nationals")
    _check(conn, "usau_nationals_player_stats")
    _check(conn, "usau_nomination_videos")
    _check(conn, "usau_player_ids")
    _check(conn, "usau_programs")
    _check(conn, "usau_regions")
    _check(conn, "usau_teams")
    _check(conn, "usau_upa_events")
    _check(conn, "usau_upa_games")
    _check(conn, "usau_upa_teams")

    # games per season year (via events join)
    _hdr("  games per year")
    if not _exists(conn, "events") or not _exists(conn, "games"):
        _miss("events or games table missing — cannot check per-year")
        return gaps

    today = datetime.now(timezone.utc).date().isoformat()

    for year in USAU_YEAR_RANGE:
        try:
            n = conn.execute(
                "SELECT COUNT(*) FROM games g "
                "JOIN events e ON g.event_slug = e.event_slug "
                "WHERE e.season_year = ?",
                (year,)
            ).fetchone()[0]
        except Exception as e:
            _gap(f"  {year}: query error — {e}")
            continue

        # Only check for empty/stale events in the current season — historical
        # orphans (events discovered but never scraped) are expected and
        # should not trigger a full backfill on every run.
        if year == CURRENT_YEAR:
            try:
                empty_n = conn.execute(
                    "SELECT COUNT(*) FROM events e "
                    "WHERE e.season_year = ? AND e.date_end < ? "
                    "AND NOT EXISTS (SELECT 1 FROM games g WHERE g.event_slug = e.event_slug)",
                    (year, today)
                ).fetchone()[0]
            except Exception:
                empty_n = 0
        else:
            empty_n = 0

        empty_note = f"  {_Y}({empty_n} events with 0 games){_X}" if empty_n > 0 else ""

        if n == 0:
            _miss(f"  {year}: 0 games")
            gaps["missing_seasons"].append(year)
        elif empty_n > 0:
            _gap(f"  {year}: {n:,} games" + empty_note)
            gaps["seasons_with_empty_events"].append(year)
        else:
            _ok(f"  {year}: {n:,} games")

    # Current-season events that need scrape_log cleared so the scraper
    # will re-fetch their schedule pages.  Two categories:
    #
    #   1. Any event that ended since Jan 1 of the current year — bracket
    #      games are often posted after the first scrape, and we can't know
    #      which events are "complete" without re-checking.
    #
    #   2. Events with 0 games at any age (clear bug — must retry regardless).
    #
    # We keep the display limited to recently-ended events (last 45 days) to
    # avoid printing hundreds of lines, but ALL stale slugs go into the list.
    _hdr(f"  {CURRENT_YEAR} events needing re-scrape check")
    season_start = f"{CURRENT_YEAR}-01-01"
    try:
        stale_events = conn.execute(
            "SELECT e.event_slug, e.event_title, e.date_end, "
            "  (NOT EXISTS (SELECT 1 FROM games g WHERE g.event_slug = e.event_slug)) AS no_games "
            "FROM events e "
            "WHERE e.season_year = ? AND e.date_end >= ? AND e.date_end < ? "
            "ORDER BY e.date_end DESC",
            (CURRENT_YEAR, season_start, today)
        ).fetchall()
    except Exception as e:
        _gap(f"  query error — {e}")
        stale_events = []

    if stale_events:
        display_cutoff = (datetime.now(timezone.utc).date() - timedelta(days=45)).isoformat()
        shown, total_no_games = 0, 0
        for row in stale_events:
            slug, title, date_end, no_games = row
            gaps["stale_event_slugs"].append(slug)
            if no_games:
                total_no_games += 1
            # Only print events from the last 45 days to keep output readable
            if date_end >= display_cutoff:
                label = f"{_R}0 games{_X}" if no_games else "has games"
                _gap(f"  {date_end}  {slug}  ({title})  [{label}]")
                shown += 1
        hidden = len(stale_events) - shown
        if hidden:
            _gap(f"  ... and {hidden} older {CURRENT_YEAR} events ({total_no_games} with 0 games) — scrape_log will be cleared for all")
        if CURRENT_YEAR not in gaps["seasons_with_empty_events"]:
            gaps["seasons_with_empty_events"].append(CURRENT_YEAR)
    else:
        _ok(f"  no ended {CURRENT_YEAR} events found")

    return gaps


def run_usau(gaps: dict, force: bool) -> None:
    missing = gaps.get("missing_seasons", [])
    empty   = gaps.get("seasons_with_empty_events", [])
    stale_slugs = gaps.get("stale_event_slugs", [])
    all_years = sorted(set(missing) | set(empty))
    if not all_years and not force:
        return

    # Phase 3 skips any URL already logged in scrape_log as success/skip.
    # Delete those entries for stale events so the scraper actually re-fetches
    # their schedule pages and picks up new/missing bracket games.
    if stale_slugs and not force:
        try:
            conn2 = sqlite3.connect(str(DB_PATH), timeout=30, isolation_level=None)
            conn2.execute("PRAGMA busy_timeout=30000")
            conn2.execute("PRAGMA journal_mode=WAL")
            deleted = 0
            for slug in stale_slugs:
                cur = conn2.execute(
                    "DELETE FROM scrape_log WHERE url LIKE ?",
                    (f"%/{slug}/%",)
                )
                deleted += cur.rowcount
            conn2.close()
            _gap(f"  Cleared {deleted} scrape_log entries for {len(stale_slugs)} stale events")
        except Exception as e:
            _gap(f"  Warning: could not clear scrape_log: {e}")

    cmd = [sys.executable, str(USAU_DIR / "usau_scraper.py")]
    if all_years and not force:
        cmd += ["--seasons", ",".join(str(y) for y in all_years)]
    if force:
        cmd += ["--force"]
    _run(cmd, USAU_DIR)

    # Nationals standings (team finishes)
    _run([sys.executable, str(USAU_DIR / "nationals_scraper.py"),
          "--db", str(DB_PATH)], USAU_DIR)

    # Nationals per-game player stats
    _run([sys.executable, str(USAU_DIR / "nationals_stats_scraper.py"),
          "--db", str(DB_PATH)], USAU_DIR)


# =========================================================================
# PUL
# =========================================================================
def check_pul(conn) -> dict:
    gaps = {"missing_seasons": [], "games_not_scraped": 0, "game_seasons_missing": []}

    _hdr("  pul_player_season_stats (per season)")
    for season in PUL_SEASONS:
        n = _count(conn, "pul_player_season_stats", "season=?", (season,))
        if n < 0:
            _miss(f"  {season}: table missing")
            gaps["missing_seasons"].append(season)
        elif n == 0:
            _miss(f"  {season}: 0 rows")
            gaps["missing_seasons"].append(season)
        else:
            _ok(f"  {season}: {n:,} rows")

    _hdr("  pul_game_index / per-game box scores (per season)")
    PUL_GAME_SEASONS = [s for s in PUL_SEASONS if s != "career"]
    for season in PUL_GAME_SEASONS:
        total    = _count(conn, "pul_game_index", "season=?", (season,))
        with_stats = _count(conn, "pul_game_index", "season=? AND has_stats=1", (season,))
        no_stats   = _count(conn, "pul_game_index", "season=? AND has_stats=0", (season,))
        if total < 0:
            _miss(f"  {season}: pul_game_index table missing")
            gaps["game_seasons_missing"].append(season)
        elif total == 0:
            _miss(f"  {season}: 0 games discovered")
            gaps["game_seasons_missing"].append(season)
        elif no_stats > 0:
            _gap(f"  {season}: {with_stats}/{total} games scraped ({no_stats} pending)")
            gaps["games_not_scraped"] += no_stats
            if season not in gaps["game_seasons_missing"]:
                gaps["game_seasons_missing"].append(season)
        else:
            _ok(f"  {season}: {total} games, all scraped")

    _hdr("  pul per-game stat tables")
    _check(conn, "pul_team_game_stats",   "pul_team_game_stats")
    _check(conn, "pul_player_game_stats", "pul_player_game_stats")

    return gaps


def run_pul(gaps: dict, force: bool) -> None:
    missing_seasons = gaps.get("missing_seasons", [])
    game_seasons    = gaps.get("game_seasons_missing", [])
    games_pending   = gaps.get("games_not_scraped", 0)

    # Phase 1-3: season player stats
    if missing_seasons or force:
        cmd = [sys.executable, str(PUL_DIR / "pul_scraper.py"), "--skip-games"]
        if missing_seasons and not force:
            cmd += ["--seasons", ",".join(missing_seasons)]
        if force:
            cmd += ["--force"]
        _run(cmd, PUL_DIR)

    # Phase 4: per-game box scores
    if game_seasons or games_pending or force:
        cmd = [sys.executable, str(PUL_DIR / "pul_scraper.py"), "--skip-players"]
        if game_seasons and not force:
            cmd += ["--games-seasons", ",".join(game_seasons)]
        if force:
            cmd += ["--force"]
        _run(cmd, PUL_DIR)


# =========================================================================
# WUL
# =========================================================================
def check_wul(conn) -> dict:
    gaps = {"missing_years": [], "missing_csvs": []}

    # Raw CSVs on disk
    _hdr("  WUL raw CSVs on disk")
    for year in WUL_YEARS:
        year_ok = True
        for dtype in WUL_DATA_TYPES:
            csv_path = WUL_RAW / f"{year}_{dtype}.csv"
            if not csv_path.exists():
                _miss(f"  {csv_path.name}: not downloaded")
                gaps["missing_csvs"].append((year, dtype))
                year_ok = False
        if year_ok:
            _ok(f"  {year}: all 4 CSVs present")

    # wul_player_game_stats + wul_team_game_stats — per year
    # season column stores e.g. "2022 Regular Season" so match by prefix
    _hdr("  wul_player_game_stats + wul_team_game_stats (per year)")
    for year in WUL_YEARS:
        n_p = _count(conn, "wul_player_game_stats", "season LIKE ?", (f"{year}%",))
        n_t = _count(conn, "wul_team_game_stats",   "season LIKE ?", (f"{year}%",))
        if n_p <= 0 and n_t <= 0:
            _miss(f"  {year}: 0 player rows, 0 team rows")
            if year not in gaps["missing_years"]:
                gaps["missing_years"].append(year)
        else:
            _ok(f"  {year}: {n_p:,} player-game rows, {n_t:,} team-game rows")

    # WUL reference tables
    _hdr("  WUL reference tables")
    _check(conn, "wul_teams")
    _check(conn, "wul_team_name_aliases")

    return gaps


def run_wul(gaps: dict, force: bool) -> None:
    missing_years = gaps.get("missing_years", [])
    missing_csvs  = gaps.get("missing_csvs", [])
    if missing_years or missing_csvs or force:
        cmd = [sys.executable, str(WUL_DIR / "wul_scraper.py")]
        if missing_years and not force:
            cmd += ["--years", ",".join(missing_years)]
        if force:
            cmd += ["--force"]
        _run(cmd, WUL_DIR)
    else:
        # CSVs present but DB rows missing — import only
        _run([sys.executable, str(WUL_DIR / "wul_scraper.py"), "--phase", "2"], WUL_DIR)


# =========================================================================
# Main
# =========================================================================
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Audit every data table and optionally scrape gaps."
    )
    parser.add_argument(
        "--run", action="store_true",
        help="Run scrapers to fill detected gaps (default: report only).",
    )
    parser.add_argument(
        "--force", action="store_true",
        help="Pass --force to all scrapers (re-scrape even data already in DB).",
    )
    parser.add_argument(
        "--league", default=None,
        help="Comma-separated subset: ufa, usau, pul, wul "
             "(default: all; usau only when ENABLE_USAU=true).",
    )
    args = parser.parse_args()

    # USAU is hidden until there's a common player/team ID, so the default run
    # skips it. An explicit --league usau still works for manual backfills.
    enable_usau = os.environ.get("ENABLE_USAU", "").lower() in ("1", "true", "yes")
    leagues = (
        {l.strip().lower() for l in args.league.split(",")}
        if args.league else {"ufa", "pul", "wul"} | ({"usau"} if enable_usau else set())
    )

    conn = _db()

    print(f"\n{_B}=== Ultimate Frisbee DB Sync  ({datetime.now().strftime('%Y-%m-%d %H:%M')}){_X}")
    print(f"DB: {DB_PATH}")
    mode = f"{_Y}RUN{_X}{' (--force)' if args.force else ''}" if args.run else "CHECK ONLY"
    print(f"Mode: {mode}")

    all_gaps: dict[str, dict] = {}

    if "ufa"  in leagues:
        _hdr("════ UFA ════════════════════════════════════════")
        all_gaps["ufa"] = check_ufa(conn)

    if "usau" in leagues:
        _hdr("════ USAU ═══════════════════════════════════════")
        all_gaps["usau"] = check_usau(conn)

    if "pul"  in leagues:
        _hdr("════ PUL ════════════════════════════════════════")
        all_gaps["pul"] = check_pul(conn)

    if "wul"  in leagues:
        _hdr("════ WUL ════════════════════════════════════════")
        all_gaps["wul"] = check_wul(conn)

    conn.close()

    _hdr("════ Summary ════════════════════════════════════")
    any_gap = False
    for league, gaps in all_gaps.items():
        has = any(
            (isinstance(v, list) and v)
            or (isinstance(v, int) and v > 0)
            or (isinstance(v, bool) and v)
            for v in gaps.values()
        )
        if has:
            any_gap = True
            _gap(f"{league.upper()}: gaps detected")
        else:
            _ok(f"{league.upper()}: up to date")

    if not any_gap:
        print(f"\n{_G}All leagues up to date.{_X}\n")
        return

    if not args.run:
        print(f"\nRun  {_B}python sync_all.py --run{_X}  to scrape the gaps above.\n")
        return

    _hdr("════ Running scrapers ═══════════════════════════")
    if "ufa"  in all_gaps: run_ufa(all_gaps["ufa"],   args.force)
    if "usau" in all_gaps: run_usau(all_gaps["usau"],  args.force)
    if "pul"  in all_gaps: run_pul(all_gaps["pul"],    args.force)
    if "wul"  in all_gaps: run_wul(all_gaps["wul"],    args.force)
    print(f"\n{_G}Done.{_X}\n")


if __name__ == "__main__":
    main()
