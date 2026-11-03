"""
migrate_rename_teams.py

Renames the `teams` table to `usau_event_teams` and updates every
foreign-key reference and dependent table in-place using SQLite's
recommended approach: recreate tables + copy data.

Safe to run repeatedly (checks for already-renamed state first).
"""
from pathlib import Path
import os
import sqlite3
import sys

DB = os.environ.get("UFA_DB_PATH") or str(Path(__file__).resolve().parents[2] / "data" / "db" / "ultimate.db")


def already_migrated(conn: sqlite3.Connection) -> bool:
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    return "usau_event_teams" in names and "teams" not in names


def migrate(conn: sqlite3.Connection) -> None:
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "usau_event_teams" in names and "teams" in names:
        print("Both tables exist – aborting. Clean up manually first.")
        sys.exit(1)

    print("Renaming teams -> usau_event_teams ...")
    # SQLite supports ALTER TABLE RENAME TO directly without recreating dependents.
    # Foreign-key constraints that reference 'teams' by name in other tables
    # need to be updated, but since we have foreign_keys=OFF during DDL this is safe.
    # All runtime code will use the new name after this migration.
    conn.execute("PRAGMA foreign_keys=OFF")
    conn.execute("ALTER TABLE teams RENAME TO usau_event_teams")

    # Recreate team_coaches FK pointing to usau_event_teams
    print("Rebuilding team_coaches ...")
    conn.executescript("""
        CREATE TABLE team_coaches_new (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            event_team_id     TEXT REFERENCES usau_event_teams(event_team_id),
            coach_name        TEXT NOT NULL,
            is_head_coach     INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO team_coaches_new SELECT * FROM team_coaches;
        DROP TABLE team_coaches;
        ALTER TABLE team_coaches_new RENAME TO team_coaches;
    """)

    print("Rebuilding player_identities ...")
    conn.executescript("""
        CREATE TABLE player_identities_new (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            canonical_name    TEXT NOT NULL,
            first_seen_event  TEXT,
            first_seen_team   TEXT REFERENCES usau_event_teams(event_team_id),
            notes             TEXT
        );
        INSERT INTO player_identities_new SELECT * FROM player_identities;
        DROP TABLE player_identities;
        ALTER TABLE player_identities_new RENAME TO player_identities;
    """)

    print("Rebuilding players ...")
    conn.executescript("""
        CREATE TABLE players_new (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            event_team_id        TEXT NOT NULL REFERENCES usau_event_teams(event_team_id),
            event_slug           TEXT NOT NULL,
            player_name          TEXT NOT NULL,
            jersey_number        TEXT,
            pronouns             TEXT,
            position             TEXT,
            height               TEXT,
            tournament_goals     INTEGER,
            tournament_assists   INTEGER,
            tournament_ds        INTEGER,
            tournament_turns     INTEGER,
            player_surrogate_id  INTEGER REFERENCES player_identities(id),
            scraped_at           TEXT
        );
        INSERT INTO players_new SELECT * FROM players;
        DROP TABLE players;
        ALTER TABLE players_new RENAME TO players;
    """)

    print("Rebuilding games ...")
    conn.executescript("""
        CREATE TABLE games_new (
            event_game_id         TEXT PRIMARY KEY,
            numeric_game_id       INTEGER,
            event_slug            TEXT NOT NULL,
            division_label        TEXT,
            round_context         TEXT,
            bracket_section       TEXT,
            round_label           TEXT,
            pool_name             TEXT,
            game_date             TEXT,
            game_time             TEXT,
            game_datetime         TEXT,
            field                 TEXT,
            home_event_team_id    TEXT REFERENCES usau_event_teams(event_team_id),
            away_event_team_id    TEXT REFERENCES usau_event_teams(event_team_id),
            team1_url             TEXT,
            team2_url             TEXT,
            home_score            INTEGER,
            away_score            INTEGER,
            status                TEXT,
            match_report_url      TEXT,
            has_match_report      INTEGER NOT NULL DEFAULT 0,
            match_report_scraped  INTEGER NOT NULL DEFAULT 0,
            scraped_at            TEXT
        );
        INSERT INTO games_new SELECT * FROM games;
        DROP TABLE games;
        ALTER TABLE games_new RENAME TO games;
    """)

    print("Rebuilding game_player_stats ...")
    conn.executescript("""
        CREATE TABLE game_player_stats_new (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            event_game_id     TEXT NOT NULL REFERENCES games(event_game_id),
            event_team_id     TEXT NOT NULL REFERENCES usau_event_teams(event_team_id),
            numeric_team_id   INTEGER,
            player_name       TEXT NOT NULL,
            jersey_number     TEXT,
            goals             INTEGER,
            assists           INTEGER,
            ds                INTEGER,
            turns             INTEGER,
            player_id         INTEGER REFERENCES players(id),
            scraped_at        TEXT
        );
        INSERT INTO game_player_stats_new SELECT * FROM game_player_stats;
        DROP TABLE game_player_stats;
        ALTER TABLE game_player_stats_new RENAME TO game_player_stats;
    """)

    conn.execute("PRAGMA foreign_keys=ON")
    conn.commit()
    print("Migration complete.")


if __name__ == "__main__":
    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA journal_mode=WAL")

    if already_migrated(conn):
        print("Already migrated – nothing to do.")
        sys.exit(0)

    migrate(conn)
    conn.close()
