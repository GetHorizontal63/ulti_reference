#!/usr/bin/env python3
"""
UFA player profile stats scraper.

Scrapes https://www.watchufa.com/league/players/{slug} for each player
in ufa_players, sums Regular Season + Playoffs per year, and upserts
into ufa_player_season_stats.

Handles:
  - NEW columns: games_played, points_played, plus_minus
  - Derived: throw_attempts (from completions + Cmp%), hucks_completed (from Hck + Hck%)
  - ob_pulls derived from pulls * (1 - Pul%/100)
  - seconds_played from M (minutes) * 60
  - RS + Playoffs summed into a single row per year
  - Existing rows: UPDATE only profile-sourced columns; preserve game-level columns
  - New rows (years not yet in DB): full INSERT

Team abbreviations from the page (e.g. ATX, AUS, PIT, RAL) are stored as-is
in team_id for newly inserted rows. Existing rows keep their current team_id.
All unique abbreviations encountered are printed at the end so you can supply
the abbrev→slug mapping.

Usage:
  python pipeline/ufa_profile_stats_scraper.py
  python pipeline/ufa_profile_stats_scraper.py --player emoore
  python pipeline/ufa_profile_stats_scraper.py --concurrency 8
  python pipeline/ufa_profile_stats_scraper.py --force   # re-scrape already-scraped
  python pipeline/ufa_profile_stats_scraper.py --dry-run
"""
from __future__ import annotations

import os
import argparse
import asyncio
import logging
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from bs4 import BeautifulSoup

DB_PATH = Path(os.environ.get("UFA_DB_PATH") or Path(__file__).resolve().parents[2] / "data" / "db" / "ultimate.db")
PROFILE_URL = "https://www.watchufa.com/league/players/{slug}"
DEFAULT_CONCURRENCY = 8

# Abbreviation → team_slug mapping (from watchufa.com profile pages)
ABBREV_TO_SLUG: dict[str, str] = {
    "ATL":  "hustle",
    "ATX":  "sol",
    "AUS":  "sol",
    "BOS":  "glory",
    "CAR":  "flyers",
    "CHA":  "express",
    "CHI":  "union",
    "CIN":  "revolution",
    "CLB":  "cranes",
    "COL":  "cranes",
    "CON":  "constitution",
    "DAL":  "legion",
    "DC":   "breeze",
    "DET":  "mechanix",
    "HTX":  "havoc",
    "IND":  "alleycats",
    "JAX":  "cannons",
    "LA":   "aviators",
    "LV":   "bighorns",
    "MAD":  "radicals",
    "MIN":  "windchill",
    "MTL":  "royal",
    "NJH":  "hammerheads",
    "NSH":  "nightwatch",
    "NY":   "empire",
    "OAK":  "spiders",
    "ORE":  "steel",
    "OTT":  "outlaws",
    "PHI":  "phoenix",
    "PHS":  "spinners",
    "PIT":  "thunderbirds",
    "POR":  "steel",
    "RAL":  "flyers",
    "RIR":  "rampage",
    "ROC":  "dragons",
    "SD":   "growlers",
    "SEA":  "cascades",
    "SF":   "flamethrowers",
    "SJ":   "spiders",
    "SLC":  "shred",
    "TB":   "cannons",
    "TOR":  "rush",
    "VAN":  "riptide",
}

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def get_conn(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def get_slugs(
    conn: sqlite3.Connection,
    only: Optional[str] = None,
    fix_null_games: bool = False,
) -> list[str]:
    if only:
        return [only]
    if fix_null_games:
        rows = conn.execute(
            """
            SELECT DISTINCT player_id AS player_slug
            FROM ufa_player_season_stats
            WHERE games_played IS NULL
            ORDER BY player_id
            """
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT player_slug FROM ufa_players ORDER BY player_slug"
        ).fetchall()
    return [r["player_slug"] for r in rows]


def upsert_stat_rows(
    conn: sqlite3.Connection, rows: list[dict], scraped_at: str
) -> None:
    for row in rows:
        pid = row["player_id"]
        year = row["year"]

        existing = conn.execute(
            "SELECT id, team_id FROM ufa_player_season_stats WHERE player_id=? AND year=?",
            (pid, year),
        ).fetchone()

        if existing:
            # Preserve existing team_id if already a proper slug; otherwise remap abbrev
            raw_abbr = row.get("team_abbr")
            team_id = existing["team_id"] or ABBREV_TO_SLUG.get(raw_abbr, raw_abbr)
            conn.execute(
                """
                UPDATE ufa_player_season_stats SET
                    games_played            = ?,
                    points_played           = ?,
                    plus_minus              = ?,
                    assists                 = COALESCE(?, assists),
                    goals                   = COALESCE(?, goals),
                    blocks                  = COALESCE(?, blocks),
                    completions             = COALESCE(?, completions),
                    throw_attempts          = COALESCE(?, throw_attempts),
                    yards_thrown            = COALESCE(?, yards_thrown),
                    yards_received          = COALESCE(?, yards_received),
                    hockey_assists          = COALESCE(?, hockey_assists),
                    throwaways              = COALESCE(?, throwaways),
                    stalls                  = COALESCE(?, stalls),
                    drops                   = COALESCE(?, drops),
                    callahans               = COALESCE(?, callahans),
                    hucks_attempted         = COALESCE(?, hucks_attempted),
                    hucks_completed         = COALESCE(?, hucks_completed),
                    o_points_played         = COALESCE(?, o_points_played),
                    d_points_played         = COALESCE(?, d_points_played),
                    pulls                   = COALESCE(?, pulls),
                    ob_pulls                = COALESCE(?, ob_pulls),
                    seconds_played          = COALESCE(?, seconds_played),
                    team_id                 = ?,
                    scraped_at              = ?
                WHERE player_id=? AND year=?
                """,
                (
                    row.get("games_played"),
                    row.get("points_played"),
                    row.get("plus_minus"),
                    row.get("assists"),
                    row.get("goals"),
                    row.get("blocks"),
                    row.get("completions"),
                    row.get("throw_attempts"),
                    row.get("yards_thrown"),
                    row.get("yards_received"),
                    row.get("hockey_assists"),
                    row.get("throwaways"),
                    row.get("stalls"),
                    row.get("drops"),
                    row.get("callahans"),
                    row.get("hucks_attempted"),
                    row.get("hucks_completed"),
                    row.get("o_points_played"),
                    row.get("d_points_played"),
                    row.get("pulls"),
                    row.get("ob_pulls"),
                    row.get("seconds_played"),
                    team_id,
                    scraped_at,
                    pid, year,
                ),
            )
        else:
            # New row — years the game-level scraper never captured
            conn.execute(
                """
                INSERT INTO ufa_player_season_stats (
                    player_id, year,
                    games_played, points_played, plus_minus,
                    assists, goals, blocks, completions, throw_attempts,
                    yards_thrown, yards_received, hockey_assists,
                    throwaways, stalls, drops, callahans,
                    hucks_attempted, hucks_completed,
                    o_points_played, d_points_played,
                    pulls, ob_pulls, seconds_played,
                    team_id, scraped_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    pid, year,
                    row.get("games_played"),
                    row.get("points_played"),
                    row.get("plus_minus"),
                    row.get("assists"),
                    row.get("goals"),
                    row.get("blocks"),
                    row.get("completions"),
                    row.get("throw_attempts"),
                    row.get("yards_thrown"),
                    row.get("yards_received"),
                    row.get("hockey_assists"),
                    row.get("throwaways"),
                    row.get("stalls"),
                    row.get("drops"),
                    row.get("callahans"),
                    row.get("hucks_attempted"),
                    row.get("hucks_completed"),
                    row.get("o_points_played"),
                    row.get("d_points_played"),
                    row.get("pulls"),
                    row.get("ob_pulls"),
                    row.get("seconds_played"),
                    ABBREV_TO_SLUG.get(row.get("team_abbr"), row.get("team_abbr")),
                    scraped_at,
                ),
            )
    conn.commit()


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def _num(text: str) -> Optional[float]:
    t = (text or "").strip()
    if t in ("--", "", "N/A"):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def _int(v: Optional[float]) -> Optional[int]:
    return int(v) if v is not None else None


def _parse_year_abbr(text: str) -> tuple[Optional[int], Optional[str]]:
    """'2025 - ATX' → (2025, 'ATX');  'Career' → (None, None)"""
    t = (text or "").strip()
    if t.lower() == "career":
        return None, None
    parts = t.split(" - ", 1)
    try:
        year = int(parts[0].strip())
    except (ValueError, IndexError):
        return None, None
    abbr = parts[1].strip() if len(parts) > 1 else None
    return year, abbr


def parse_stat_tables(html: str, slug: str) -> tuple[list[dict], set[str]]:
    """
    Parse Regular Season (table 0) and Playoffs (table 1).
    Returns (list of per-year summed stat dicts, set of team abbrevs seen).
    """
    soup = BeautifulSoup(html, "lxml")
    tables = soup.select("#web-panel-player-stats table")
    if not tables:
        return [], set()

    # year → accumulated stat dict
    acc: dict[int, dict] = {}
    abbrevs: set[str] = set()

    for table in tables[:2]:
        tbody = table.find("tbody") or table
        for tr in tbody.find_all("tr"):
            cells = tr.find_all("td")
            if not cells or len(cells) < 2:
                continue

            year, abbr = _parse_year_abbr(cells[0].get_text())
            if year is None:
                continue  # Career total row

            if abbr:
                abbrevs.add(abbr)

            def c(i: int) -> Optional[float]:
                return _num(cells[i].get_text()) if i < len(cells) else None

            games    = c(1)
            pp       = c(2)
            minutes  = c(3)
            ast      = c(4)
            gls      = c(5)
            blk      = c(6)
            pm       = c(7)
            cmp      = c(8)
            cmp_pct  = c(9)
            ty       = c(10)
            ry       = c(11)
            ha       = c(12)
            twy      = c(13)
            st       = c(14)
            drp      = c(15)
            cal      = c(16)
            hck      = c(17)
            hck_pct  = c(18)
            opp      = c(19)
            dpp      = c(20)
            pul      = c(21)
            pul_pct  = c(22)
            # col 23 (PH) skipped — unit ambiguous vs existing DB data

            # Derived counts
            if cmp is not None and cmp_pct is not None and cmp_pct > 0:
                throw_attempts = round(cmp / (cmp_pct / 100))
            else:
                throw_attempts = _int(cmp)

            if hck is not None and hck_pct is not None:
                hucks_completed = round(hck * (hck_pct / 100))
            else:
                hucks_completed = None

            # ob_pulls: Pul% = in-bounds%, so OB = pulls * (1 - pct/100)
            if pul is not None and pul_pct is not None:
                ob_pulls = round(pul * (1.0 - pul_pct / 100.0))
            else:
                ob_pulls = None

            row: dict = {
                "player_id":      slug,
                "year":           year,
                "team_abbr":      abbr,
                "games_played":   _int(games),
                "points_played":  _int(pp),
                "plus_minus":     _int(pm),
                "assists":        _int(ast),
                "goals":          _int(gls),
                "blocks":         _int(blk),
                "completions":    _int(cmp),
                "throw_attempts": throw_attempts,
                "yards_thrown":   _int(ty),
                "yards_received": _int(ry),
                "hockey_assists":  _int(ha),
                "throwaways":     _int(twy),
                "stalls":         _int(st),
                "drops":          _int(drp),
                "callahans":      _int(cal),
                "hucks_attempted": _int(hck),
                "hucks_completed": hucks_completed,
                "o_points_played": _int(opp),
                "d_points_played": _int(dpp),
                "pulls":          _int(pul),
                "ob_pulls":       ob_pulls,
                "seconds_played": round(minutes * 60) if minutes is not None else None,
            }

            if year in acc:
                # Sum this table's row into the accumulator
                existing = acc[year]
                sum_keys = (
                    "games_played", "points_played", "plus_minus",
                    "assists", "goals", "blocks", "completions", "throw_attempts",
                    "yards_thrown", "yards_received", "hockey_assists",
                    "throwaways", "stalls", "drops", "callahans",
                    "hucks_attempted", "hucks_completed",
                    "o_points_played", "d_points_played",
                    "pulls", "ob_pulls", "seconds_played",
                )
                for k in sum_keys:
                    a = existing.get(k)
                    b = row.get(k)
                    if a is None:
                        existing[k] = b
                    elif b is not None:
                        existing[k] = a + b
            else:
                acc[year] = row

    return list(acc.values()), abbrevs


# ---------------------------------------------------------------------------
# Async scraper
# ---------------------------------------------------------------------------

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


async def scrape_one(page, slug: str) -> tuple[str, list[dict], set[str]]:
    url = PROFILE_URL.format(slug=slug)
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        try:
            await page.wait_for_selector("#web-panel-player-stats table", timeout=15_000)
        except Exception:
            pass  # player with no stats — still grab whatever rendered
        html = await page.content()
        rows, abbrevs = parse_stat_tables(html, slug)
        return "ok", rows, abbrevs
    except Exception as exc:
        logger.warning("  error %s: %s", slug, exc)
        return "error", [], set()


async def _worker(
    queue: asyncio.Queue,
    pw,
    conn: sqlite3.Connection,
    scraped_at: str,
    dry_run: bool,
    counters: dict,
    all_abbrevs: set,
    total: int,
    worker_id: int,
) -> None:
    """One browser instance that drains the shared queue."""
    browser = await pw.chromium.launch(headless=True)
    ctx = await browser.new_context(
        user_agent=USER_AGENT,
        viewport={"width": 1280, "height": 900},
    )
    page = await ctx.new_page()
    try:
        while True:
            try:
                idx, slug = queue.get_nowait()
            except asyncio.QueueEmpty:
                break

            status, rows, abbrevs = await scrape_one(page, slug)
            all_abbrevs.update(abbrevs)

            if status == "ok":
                counters["ok"] += 1
                if rows and not dry_run:
                    upsert_stat_rows(conn, rows, scraped_at)
            else:
                counters["err"] += 1

            if idx % 50 == 0 or idx == total:
                logger.info(
                    "  [%d/%d]  ok=%d  err=%d",
                    idx, total, counters["ok"], counters["err"],
                )

            queue.task_done()
            await asyncio.sleep(0.2)
    finally:
        await page.close()
        await ctx.close()
        await browser.close()


async def run(
    db_path: Path,
    slugs: list[str],
    concurrency: int,
    dry_run: bool,
) -> None:
    from playwright.async_api import async_playwright

    conn = get_conn(db_path)
    scraped_at = datetime.now(timezone.utc).isoformat()
    all_abbrevs: set[str] = set()
    counters = {"ok": 0, "err": 0}
    total = len(slugs)

    queue: asyncio.Queue = asyncio.Queue()
    for i, slug in enumerate(slugs, start=1):
        await queue.put((i, slug))

    async with async_playwright() as pw:
        workers = [
            _worker(queue, pw, conn, scraped_at, dry_run, counters, all_abbrevs, total, w)
            for w in range(concurrency)
        ]
        await asyncio.gather(*workers)

    conn.close()
    logger.info("Finished. ok=%d  err=%d", counters["ok"], counters["err"])

    if all_abbrevs:
        abbrev_list = sorted(all_abbrevs)
        print("\n=== Team abbreviations found on profile pages ===")
        for a in abbrev_list:
            print(f"  {a}")
        print(f"\n({len(abbrev_list)} total — provide abbrev→slug mapping to remap team_id on inserted rows)")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape UFA player profile stats into ultimate.db")
    parser.add_argument("--player",      help="Single player slug (e.g. emoore)")
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY,
                        help=f"Concurrent Playwright pages (default {DEFAULT_CONCURRENCY})")
    parser.add_argument("--db",          default=str(DB_PATH),
                        help="Path to SQLite database")
    parser.add_argument("--fix-null-games", action="store_true",
                        help="Only scrape players who have NULL games_played rows")
    parser.add_argument("--dry-run",     action="store_true",
                        help="Scrape and parse but write nothing to the DB")
    parser.add_argument("--log-level",   default="INFO",
                        choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s  %(levelname)-8s  %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )

    db_path = Path(args.db)
    conn = get_conn(db_path)
    slugs = get_slugs(conn, only=args.player, fix_null_games=args.fix_null_games)
    conn.close()

    logger.info("Players to scrape: %d%s", len(slugs), "  [DRY RUN]" if args.dry_run else "")

    asyncio.run(run(db_path, slugs, args.concurrency, args.dry_run))


if __name__ == "__main__":
    main()
