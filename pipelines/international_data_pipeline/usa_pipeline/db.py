"""
DB schema and helpers for the international (USA national team) pipeline.

Tables (all prefixed international_):
  international_tournaments  — one row per team appearance at a tournament
  international_games        — game-by-game results for each appearance
  international_roster       — players and staff for each appearance
  international_scrape_log   — phase-level audit trail
"""
from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Connection helpers (mirrors usau_data_pipeline/db.py pattern)
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
# Schema initialisation
# ---------------------------------------------------------------------------

def init_international_db(conn: sqlite3.Connection) -> None:
    """Create all international_ tables if they don't exist (idempotent)."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS international_tournaments (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_key   TEXT    UNIQUE NOT NULL,
            event_type       TEXT    NOT NULL,
            division         TEXT    NOT NULL,
            year             INTEGER NOT NULL,
            location         TEXT,
            wins             INTEGER,
            losses           INTEGER,
            finish           TEXT,
            detail_url       TEXT,
            detail_scraped   INTEGER NOT NULL DEFAULT 0,
            scraped_at       TEXT
        );

        CREATE TABLE IF NOT EXISTS international_games (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL
                REFERENCES international_tournaments(id) ON DELETE CASCADE,
            game_order    INTEGER,
            round         TEXT,
            opponent      TEXT,
            usa_score     INTEGER,
            opp_score     INTEGER,
            result        TEXT
        );

        CREATE TABLE IF NOT EXISTS international_roster (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            tournament_id INTEGER NOT NULL
                REFERENCES international_tournaments(id) ON DELETE CASCADE,
            name          TEXT NOT NULL,
            city          TEXT,
            state         TEXT,
            role          TEXT NOT NULL DEFAULT 'player',
            canonical_id  INTEGER
        );

        CREATE TABLE IF NOT EXISTS international_scrape_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            phase      TEXT    NOT NULL,
            key        TEXT    NOT NULL,
            status     TEXT    NOT NULL,
            message    TEXT,
            scraped_at TEXT    NOT NULL
        );
    """)
    conn.commit()
    # Migrate: if roster table still has old 'hometown' column, drop and recreate it
    cur = conn.execute("PRAGMA table_info(international_roster)")
    cols = {row[1] for row in cur.fetchall()}
    if "hometown" in cols:
        conn.executescript("""
            DROP TABLE IF EXISTS international_roster;
            CREATE TABLE international_roster (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                tournament_id INTEGER NOT NULL
                    REFERENCES international_tournaments(id) ON DELETE CASCADE,
                name          TEXT NOT NULL,
                city          TEXT,
                state         TEXT,
                role          TEXT NOT NULL DEFAULT 'player',
                canonical_id  INTEGER
            );
            UPDATE international_tournaments SET detail_scraped = 0;
        """)
        conn.commit()
        logger.info("Migrated international_roster: hometown -> city + state; reset detail_scraped")
    # Migrate: add canonical_id column if missing
    cur = conn.execute("PRAGMA table_info(international_roster)")
    cols = {row[1] for row in cur.fetchall()}
    if "canonical_id" not in cols:
        conn.execute("ALTER TABLE international_roster ADD COLUMN canonical_id INTEGER")
        _refresh_canonical_ids(conn)
        conn.commit()
        logger.info("Migrated international_roster: added canonical_id column")
    logger.debug("international_ tables initialised")


# ---------------------------------------------------------------------------
# Upsert helpers
# ---------------------------------------------------------------------------

def upsert_tournament(conn: sqlite3.Connection, row: dict) -> int:
    """Insert-or-update a tournament row; returns the row's id."""
    conn.execute(
        """
        INSERT INTO international_tournaments
            (tournament_key, event_type, division, year, location,
             wins, losses, finish, detail_url, scraped_at)
        VALUES (:tournament_key, :event_type, :division, :year, :location,
                :wins, :losses, :finish, :detail_url, :scraped_at)
        ON CONFLICT(tournament_key) DO UPDATE SET
            location     = excluded.location,
            wins         = excluded.wins,
            losses       = excluded.losses,
            finish       = excluded.finish,
            detail_url   = excluded.detail_url,
            scraped_at   = excluded.scraped_at
        """,
        row,
    )
    conn.commit()
    cur = conn.execute(
        "SELECT id FROM international_tournaments WHERE tournament_key = ?",
        (row["tournament_key"],),
    )
    return cur.fetchone()["id"]


def insert_games(conn: sqlite3.Connection, tournament_id: int, games: list[dict]) -> None:
    """Replace all games for a tournament_id."""
    conn.execute(
        "DELETE FROM international_games WHERE tournament_id = ?", (tournament_id,)
    )
    conn.executemany(
        """
        INSERT INTO international_games
            (tournament_id, game_order, round, opponent, usa_score, opp_score, result)
        VALUES (:tournament_id, :game_order, :round, :opponent, :usa_score, :opp_score, :result)
        """,
        [{**g, "tournament_id": tournament_id} for g in games],
    )
    conn.commit()


def _refresh_canonical_ids(conn: sqlite3.Connection) -> None:
    """Set canonical_id = MIN(id) per player name across all roster rows."""
    conn.execute("""
        UPDATE international_roster
        SET canonical_id = (
            SELECT MIN(id) FROM international_roster r2
            WHERE r2.name = international_roster.name
        )
    """)


def insert_roster(conn: sqlite3.Connection, tournament_id: int, members: list[dict]) -> None:
    """Replace the roster for a tournament_id."""
    conn.execute(
        "DELETE FROM international_roster WHERE tournament_id = ?", (tournament_id,)
    )
    conn.executemany(
        """
        INSERT INTO international_roster (tournament_id, name, city, state, role)
        VALUES (:tournament_id, :name, :city, :state, :role)
        """,
        [{**m, "tournament_id": tournament_id} for m in members],
    )
    # Refresh canonical_ids for any name that appears in this batch
    names = tuple(m["name"] for m in members)
    if names:
        placeholders = ",".join("?" * len(names))
        conn.execute(f"""
            UPDATE international_roster
            SET canonical_id = (
                SELECT MIN(id) FROM international_roster r2
                WHERE r2.name = international_roster.name
            )
            WHERE name IN ({placeholders})
        """, names)
    conn.commit()


def mark_detail_scraped(conn: sqlite3.Connection, tournament_id: int) -> None:
    conn.execute(
        "UPDATE international_tournaments SET detail_scraped = 1 WHERE id = ?",
        (tournament_id,),
    )
    conn.commit()


def log_international(
    conn: sqlite3.Connection,
    phase: str,
    key: str,
    status: str,
    message: Optional[str] = None,
) -> None:
    conn.execute(
        """
        INSERT INTO international_scrape_log (phase, key, status, message, scraped_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (phase, key, status, message, now_iso()),
    )
    conn.commit()
