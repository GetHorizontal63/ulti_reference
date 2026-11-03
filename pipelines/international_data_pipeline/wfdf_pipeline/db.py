"""
DB schema and helpers for the WFDF international data pipeline.

Tables (all prefixed wfdf_):
  wfdf_events      — one row per event × season (e.g. WUCC 2018, WJUC 2024)
  wfdf_games       — game-by-game results per event
  wfdf_standings   — team placement / standings per event
  wfdf_rosters     — player rosters per team per event
  wfdf_scrape_log  — phase-level audit trail
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------

def get_connection(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

def init_wfdf_db(conn: sqlite3.Connection) -> None:
    """Create all wfdf_ tables if they don't exist (idempotent)."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS wfdf_events (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            event_slug       TEXT    NOT NULL,
            season_key       TEXT    UNIQUE NOT NULL,
            event_name       TEXT,
            season_year      INTEGER,
            division         TEXT,
            source_type      TEXT,
            base_url         TEXT    NOT NULL,
            games_url        TEXT,
            standings_url    TEXT,
            rosters_url      TEXT,
            detail_scraped   INTEGER NOT NULL DEFAULT 0,
            scraped_at       TEXT
        );

        CREATE TABLE IF NOT EXISTS wfdf_games (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id          INTEGER NOT NULL
                REFERENCES wfdf_events(id) ON DELETE CASCADE,
            game_ref          INTEGER,
            game_date         TEXT,
            timeslot          TEXT,
            division          TEXT,
            field             TEXT,
            round             TEXT,
            team_a            TEXT,
            team_b            TEXT,
            score_a           INTEGER,
            score_b           INTEGER,
            winner            TEXT,
            gameplay_scraped  INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS wfdf_game_stats (
            id                         INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id                    INTEGER NOT NULL
                REFERENCES wfdf_games(id) ON DELETE CASCADE,
            team_name                  TEXT    NOT NULL,
            goals                      INTEGER,
            time_on_offence_min        REAL,
            time_on_offence_pct        REAL,
            time_on_defence_min        REAL,
            time_on_defence_pct        REAL,
            goals_from_offence_made    INTEGER,
            goals_from_offence_total   INTEGER,
            goals_from_defence_made    INTEGER,
            goals_from_defence_total   INTEGER,
            goals_from_turnovers       INTEGER,
            timeouts                   INTEGER,
            spirit_points              INTEGER,
            spirit_breakdown           TEXT
        );

        CREATE TABLE IF NOT EXISTS wfdf_game_player_stats (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id        INTEGER NOT NULL
                REFERENCES wfdf_games(id) ON DELETE CASCADE,
            team_name      TEXT,
            jersey_number  TEXT,
            player_name    TEXT    NOT NULL,
            wfdf_player_id INTEGER,
            assists        INTEGER,
            goals          INTEGER,
            total          INTEGER
        );

        CREATE TABLE IF NOT EXISTS wfdf_event_player_id (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id         INTEGER NOT NULL
                REFERENCES wfdf_events(id) ON DELETE CASCADE,
            event_slug       TEXT    NOT NULL,
            event_year       INTEGER,
            player_event_id  INTEGER NOT NULL,
            series           INTEGER NOT NULL DEFAULT 0,
            player_name      TEXT,
            jersey_number    TEXT,
            team_name        TEXT,
            master_player_id INTEGER,
            UNIQUE(event_slug, player_event_id, series)
        );

        CREATE TABLE IF NOT EXISTS wfdf_game_points (
            id                 INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id            INTEGER NOT NULL
                REFERENCES wfdf_games(id) ON DELETE CASCADE,
            point_number       INTEGER,
            score_a            INTEGER,
            score_b            INTEGER,
            assister_player_id INTEGER,
            assister_jersey    TEXT,
            assister_name      TEXT,
            scorer_player_id   INTEGER,
            scorer_jersey      TEXT,
            scorer_name        TEXT,
            time_elapsed       TEXT,
            point_duration     TEXT,
            game_event         TEXT,
            is_halftime        INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS wfdf_player_season_stats (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id       INTEGER NOT NULL
                REFERENCES wfdf_events(id) ON DELETE CASCADE,
            wfdf_player_id INTEGER NOT NULL,
            series         INTEGER NOT NULL DEFAULT 0,
            player_name    TEXT,
            jersey_number  TEXT,
            team_name      TEXT,
            games_played   INTEGER,
            assists        INTEGER,
            goals          INTEGER,
            total          INTEGER,
            assist_avg     REAL,
            goals_avg      REAL,
            point_avg      REAL,
            wins           INTEGER,
            win_pct        REAL,
            UNIQUE(event_id, wfdf_player_id, series)
        );

        CREATE TABLE IF NOT EXISTS wfdf_standings (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id       INTEGER NOT NULL
                REFERENCES wfdf_events(id) ON DELETE CASCADE,
            division       TEXT,
            placement      INTEGER,
            team_name      TEXT,
            country        TEXT,
            wins           INTEGER,
            losses         INTEGER,
            point_diff     INTEGER
        );

        CREATE TABLE IF NOT EXISTS wfdf_rosters (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id         INTEGER NOT NULL
                REFERENCES wfdf_events(id) ON DELETE CASCADE,
            wfdf_player_id   INTEGER,
            team_name        TEXT    NOT NULL,
            division         TEXT,
            player_name      TEXT    NOT NULL,
            jersey_number    TEXT,
            country          TEXT
        );

        CREATE TABLE IF NOT EXISTS wfdf_scrape_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            phase      TEXT    NOT NULL,
            key        TEXT    NOT NULL,
            status     TEXT    NOT NULL,
            message    TEXT,
            scraped_at TEXT    NOT NULL
        );
    """)
    conn.commit()
    logger.info("wfdf_ tables verified / created.")

    # -----------------------------------------------------------------------
    # Migrations — add columns that didn't exist in the initial schema
    # -----------------------------------------------------------------------
    _ensure_column(conn, "wfdf_games",            "game_ref",           "INTEGER")
    _ensure_column(conn, "wfdf_games",            "gameplay_scraped",   "INTEGER NOT NULL DEFAULT 0")
    _ensure_column(conn, "wfdf_game_points",      "assister_player_id", "INTEGER")
    _ensure_column(conn, "wfdf_game_points",      "scorer_player_id",   "INTEGER")
    _ensure_column(conn, "wfdf_rosters",          "wfdf_player_id",     "INTEGER")
    _ensure_column(conn, "wfdf_event_player_id",  "event_year",         "INTEGER")
    _ensure_column(conn, "wfdf_events",           "source_type",        "TEXT")


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, col_def: str) -> None:
    """Add a column to a table if it doesn't already exist."""
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}")
        conn.commit()
        logger.info("Migration: added %s.%s", table, column)


# ---------------------------------------------------------------------------
# Upsert helpers
# ---------------------------------------------------------------------------

def upsert_event(conn: sqlite3.Connection, row: dict) -> int:
    """
    Insert or update a wfdf_events row.
    Returns the row id.
    """
    conn.execute(
        """
        INSERT INTO wfdf_events
            (event_slug, season_key, event_name, season_year, division,
             base_url, games_url, standings_url, rosters_url, scraped_at)
        VALUES
            (:event_slug, :season_key, :event_name, :season_year, :division,
             :base_url, :games_url, :standings_url, :rosters_url, :scraped_at)
        ON CONFLICT(season_key) DO UPDATE SET
            event_name    = excluded.event_name,
            season_year   = excluded.season_year,
            division      = excluded.division,
            games_url     = excluded.games_url,
            standings_url = excluded.standings_url,
            rosters_url   = excluded.rosters_url,
            scraped_at    = excluded.scraped_at
        """,
        row,
    )
    conn.commit()
    cur = conn.execute(
        "SELECT id FROM wfdf_events WHERE season_key = ?", (row["season_key"],)
    )
    return cur.fetchone()[0]


def mark_event_scraped(conn: sqlite3.Connection, event_id: int) -> None:
    conn.execute(
        "UPDATE wfdf_events SET detail_scraped = 1, scraped_at = ? WHERE id = ?",
        (now_iso(), event_id),
    )
    conn.commit()


def insert_games(conn: sqlite3.Connection, event_id: int, games: list[dict]) -> None:
    conn.execute("DELETE FROM wfdf_games WHERE event_id = ?", (event_id,))
    for g in games:
        g["event_id"] = event_id
    conn.executemany(
        """
        INSERT INTO wfdf_games
            (event_id, game_ref, game_date, timeslot, division, field, round,
             team_a, team_b, score_a, score_b, winner)
        VALUES
            (:event_id, :game_ref, :game_date, :timeslot, :division, :field, :round,
             :team_a, :team_b, :score_a, :score_b, :winner)
        """,
        games,
    )
    conn.commit()


def insert_standings(conn: sqlite3.Connection, event_id: int, rows: list[dict]) -> None:
    conn.execute("DELETE FROM wfdf_standings WHERE event_id = ?", (event_id,))
    for r in rows:
        r["event_id"] = event_id
    conn.executemany(
        """
        INSERT INTO wfdf_standings
            (event_id, division, placement, team_name, country, wins, losses, point_diff)
        VALUES
            (:event_id, :division, :placement, :team_name, :country, :wins, :losses, :point_diff)
        """,
        rows,
    )
    conn.commit()


def insert_rosters(conn: sqlite3.Connection, event_id: int, rows: list[dict]) -> None:
    conn.execute("DELETE FROM wfdf_rosters WHERE event_id = ?", (event_id,))
    for r in rows:
        r["event_id"] = event_id
        r.setdefault("wfdf_player_id", None)
    conn.executemany(
        """
        INSERT INTO wfdf_rosters
            (event_id, wfdf_player_id, team_name, division, player_name, jersey_number, country)
        VALUES
            (:event_id, :wfdf_player_id, :team_name, :division, :player_name, :jersey_number, :country)
        """,
        rows,
    )
    conn.commit()


def log_wfdf(
    conn: sqlite3.Connection,
    phase: str,
    key: str,
    status: str,
    message: Optional[str] = None,
) -> None:
    conn.execute(
        """
        INSERT INTO wfdf_scrape_log (phase, key, status, message, scraped_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (phase, key, status, message, now_iso()),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Event player registry
# ---------------------------------------------------------------------------

def upsert_event_player(
    conn: sqlite3.Connection,
    event_id: int,
    event_slug: str,
    event_year: int | None,
    rows: list[dict],
) -> None:
    """
    Insert or update rows in wfdf_event_player_id.

    Each row must have: player_event_id, series, player_name, jersey_number, team_name.
    master_player_id is optional (nullable — filled in manually or via a later linking step).
    """
    for r in rows:
        r["event_id"]   = event_id
        r["event_slug"] = event_slug
        r["event_year"] = event_year
        r.setdefault("series", 0)
        r.setdefault("master_player_id", None)
    conn.executemany(
        """
        INSERT INTO wfdf_event_player_id
            (event_id, event_slug, event_year, player_event_id, series,
             player_name, jersey_number, team_name, master_player_id)
        VALUES
            (:event_id, :event_slug, :event_year, :player_event_id, :series,
             :player_name, :jersey_number, :team_name, :master_player_id)
        ON CONFLICT(event_slug, player_event_id, series) DO UPDATE SET
            player_name      = excluded.player_name,
            jersey_number    = excluded.jersey_number,
            team_name        = excluded.team_name
        """,
        rows,
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Phase 3 helpers — gameplay (game stats, player stats, point log)
# ---------------------------------------------------------------------------

def insert_game_stats(conn: sqlite3.Connection, game_id: int, rows: list[dict]) -> None:
    conn.execute("DELETE FROM wfdf_game_stats WHERE game_id = ?", (game_id,))
    for r in rows:
        r["game_id"] = game_id
    conn.executemany(
        """
        INSERT INTO wfdf_game_stats
            (game_id, team_name, goals, time_on_offence_min, time_on_offence_pct,
             time_on_defence_min, time_on_defence_pct,
             goals_from_offence_made, goals_from_offence_total,
             goals_from_defence_made, goals_from_defence_total,
             goals_from_turnovers, timeouts, spirit_points, spirit_breakdown)
        VALUES
            (:game_id, :team_name, :goals, :time_on_offence_min, :time_on_offence_pct,
             :time_on_defence_min, :time_on_defence_pct,
             :goals_from_offence_made, :goals_from_offence_total,
             :goals_from_defence_made, :goals_from_defence_total,
             :goals_from_turnovers, :timeouts, :spirit_points, :spirit_breakdown)
        """,
        rows,
    )
    conn.commit()


def insert_game_player_stats(conn: sqlite3.Connection, game_id: int, rows: list[dict]) -> None:
    conn.execute("DELETE FROM wfdf_game_player_stats WHERE game_id = ?", (game_id,))
    for r in rows:
        r["game_id"] = game_id
    conn.executemany(
        """
        INSERT INTO wfdf_game_player_stats
            (game_id, team_name, jersey_number, player_name, wfdf_player_id,
             assists, goals, total)
        VALUES
            (:game_id, :team_name, :jersey_number, :player_name, :wfdf_player_id,
             :assists, :goals, :total)
        """,
        rows,
    )
    conn.commit()


def insert_game_points(conn: sqlite3.Connection, game_id: int, rows: list[dict]) -> None:
    conn.execute("DELETE FROM wfdf_game_points WHERE game_id = ?", (game_id,))
    for r in rows:
        r["game_id"] = game_id
        r.setdefault("assister_player_id", None)
        r.setdefault("scorer_player_id", None)
    conn.executemany(
        """
        INSERT INTO wfdf_game_points
            (game_id, point_number, score_a, score_b,
             assister_player_id, assister_jersey, assister_name,
             scorer_player_id,   scorer_jersey,   scorer_name,
             time_elapsed, point_duration, game_event, is_halftime)
        VALUES
            (:game_id, :point_number, :score_a, :score_b,
             :assister_player_id, :assister_jersey, :assister_name,
             :scorer_player_id,   :scorer_jersey,   :scorer_name,
             :time_elapsed, :point_duration, :game_event, :is_halftime)
        """,
        rows,
    )
    conn.commit()


def mark_game_gameplay_scraped(conn: sqlite3.Connection, game_id: int) -> None:
    conn.execute(
        "UPDATE wfdf_games SET gameplay_scraped = 1 WHERE id = ?", (game_id,)
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Phase 4 helpers — player season stats
# ---------------------------------------------------------------------------

def upsert_player_season_stats(
    conn: sqlite3.Connection, event_id: int, rows: list[dict]
) -> None:
    for r in rows:
        r["event_id"] = event_id
    conn.executemany(
        """
        INSERT INTO wfdf_player_season_stats
            (event_id, wfdf_player_id, series, player_name, jersey_number, team_name,
             games_played, assists, goals, total, assist_avg, goals_avg,
             point_avg, wins, win_pct)
        VALUES
            (:event_id, :wfdf_player_id, :series, :player_name, :jersey_number, :team_name,
             :games_played, :assists, :goals, :total, :assist_avg, :goals_avg,
             :point_avg, :wins, :win_pct)
        ON CONFLICT(event_id, wfdf_player_id, series) DO UPDATE SET
            player_name  = excluded.player_name,
            jersey_number = excluded.jersey_number,
            team_name    = excluded.team_name,
            games_played = excluded.games_played,
            assists      = excluded.assists,
            goals        = excluded.goals,
            total        = excluded.total,
            assist_avg   = excluded.assist_avg,
            goals_avg    = excluded.goals_avg,
            point_avg    = excluded.point_avg,
            wins         = excluded.wins,
            win_pct      = excluded.win_pct
        """,
        rows,
    )
    conn.commit()
