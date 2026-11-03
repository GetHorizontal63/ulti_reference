"""
Database initialization, upsert helpers, and scrape_log utilities.
"""
import sqlite3
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def get_connection(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    # isolation_level=None → autocommit; avoids Python's implicit BEGIN which
    # raises SQLITE_LOCKED immediately (not retried by busy_timeout).
    conn = sqlite3.connect(str(db_path), timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS events (
            event_slug        TEXT NOT NULL,
            competition_group TEXT NOT NULL DEFAULT '',
            event_title       TEXT NOT NULL,
            event_url         TEXT,
            source            TEXT NOT NULL DEFAULT 'usau',
            event_type        TEXT,
            event_id          INTEGER,
            event_group_id    INTEGER,
            city              TEXT,
            state             TEXT,
            date_start        TEXT,
            date_end          TEXT,
            season_year       INTEGER,
            competition_level TEXT,
            gender            TEXT,
            division_label    TEXT,
            scraped_at        TEXT,
            PRIMARY KEY (event_slug, competition_group)
        );

        CREATE TABLE IF NOT EXISTS teams (
            event_team_id     TEXT PRIMARY KEY,
            numeric_team_id   INTEGER,
            team_name         TEXT NOT NULL DEFAULT '',
            city              TEXT,
            state             TEXT,
            competition_level TEXT,
            gender_division   TEXT,
            event_slug        TEXT,
            scraped_at        TEXT,
            usau_team_id      TEXT REFERENCES usau_teams(usau_team_id)
        );

        CREATE TABLE IF NOT EXISTS team_coaches (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            event_team_id     TEXT REFERENCES teams(event_team_id),
            coach_name        TEXT NOT NULL,
            is_head_coach     INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS player_identities (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            canonical_name    TEXT NOT NULL,
            first_seen_event  TEXT,
            first_seen_team   TEXT REFERENCES teams(event_team_id),
            notes             TEXT
        );

        CREATE TABLE IF NOT EXISTS players (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            event_team_id        TEXT NOT NULL REFERENCES teams(event_team_id),
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

        CREATE TABLE IF NOT EXISTS games (
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
            home_event_team_id    TEXT REFERENCES teams(event_team_id),
            away_event_team_id    TEXT REFERENCES teams(event_team_id),
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

        CREATE TABLE IF NOT EXISTS game_player_stats (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            event_game_id     TEXT NOT NULL REFERENCES games(event_game_id),
            event_team_id     TEXT NOT NULL REFERENCES teams(event_team_id),
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

        CREATE TABLE IF NOT EXISTS scrape_log (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            url               TEXT NOT NULL,
            layer             TEXT NOT NULL,
            status            TEXT NOT NULL,
            http_status       INTEGER,
            detail            TEXT,
            error_msg         TEXT,
            scraped_at        TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS usau_player_ids (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            usau_player_id  TEXT NOT NULL,   -- title-cased concatenated name, e.g. "LucasParnell"
            player_name     TEXT NOT NULL,   -- canonical display name, e.g. "Lucas Parnell"
            jersey_number   TEXT,
            UNIQUE (usau_player_id, jersey_number)
        );
        CREATE INDEX IF NOT EXISTS idx_usau_player_ids_pid
            ON usau_player_ids(usau_player_id);

        CREATE TABLE IF NOT EXISTS usau_programs (
            program_id        TEXT PRIMARY KEY,   -- e.g. 'usau_p_club_m_bravo'
            -- Identity
            canonical_name    TEXT NOT NULL,       -- display name shown everywhere
            short_name        TEXT,                -- abbreviated name (e.g. 'Bravo')
            -- Classification — should match the team rows linked to this program
            competition_level TEXT NOT NULL,       -- Club / College / High School / etc.
            gender_division   TEXT,                -- Men / Women / Mixed / Boys / Girls
            -- Location
            city              TEXT,
            state             TEXT,
            -- Branding
            logo_filename     TEXT,                -- filename in public/assets/png/USAU_teams/
            logo_url          TEXT,                -- full URL (e.g. Wikimedia Commons) or local path; takes precedence over logo_filename
            primary_color     TEXT,                -- hex
            secondary_color   TEXT,                -- hex
            -- Metadata
            active            INTEGER NOT NULL DEFAULT 1,
            notes             TEXT,
            built_at          TEXT
        );

        CREATE TABLE IF NOT EXISTS usau_teams (
            usau_team_id      TEXT PRIMARY KEY,
            -- Human-readable identity
            school_name       TEXT,          -- NULL for non-school (club) teams
            team_name         TEXT NOT NULL, -- canonical display name
            nickname          TEXT,          -- nickname/mascot (text inside parens for school teams)
            -- Classification
            competition_level TEXT NOT NULL,
            level_code        TEXT NOT NULL, -- S=Club A=College B=Youth C=HighSchool D=MiddleSchool E=Masters F=GrandMasters G=GreatGrandMasters H=Beach
            gender_division   TEXT,
            gender_code       TEXT NOT NULL, -- M=Men/Boys W=Women/Girls X=Mixed U=Unknown
            -- B/JV team flag
            is_b_team         INTEGER NOT NULL DEFAULT 0,
            b_team_suffix     TEXT,          -- 'B', 'C', or 'D'
            -- Location (standardised)
            city              TEXT,
            state             TEXT,          -- full state/province name
            zip               TEXT,
            -- Similar-team linkage (for club teams with near-duplicate names)
            similar_team_id   TEXT REFERENCES usau_teams(usau_team_id),
            -- Program linkage (manually curated)
            program_id        TEXT REFERENCES usau_programs(program_id),
            built_at          TEXT
        );

        CREATE TABLE IF NOT EXISTS usau_event_teams (
            event_team_id     TEXT PRIMARY KEY,
            team_name         TEXT NOT NULL DEFAULT '',
            event_slug        TEXT,
            city              TEXT,
            state             TEXT,
            competition_level TEXT,
            gender_division   TEXT,
            scraped_at        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_uet_slug ON usau_event_teams(event_slug);

        CREATE TABLE IF NOT EXISTS usau_nationals (
            usau_team_id      TEXT NOT NULL,
            school_name       TEXT,
            team_name         TEXT NOT NULL,
            competition_level TEXT NOT NULL,
            division          TEXT,
            gender            TEXT,
            city              TEXT,
            state             TEXT,
            year              INTEGER NOT NULL,
            finish            INTEGER,
            spirit_award      INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (usau_team_id, year)
        );

        CREATE TABLE IF NOT EXISTS usau_nationals_player_stats (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            event_game_id   TEXT NOT NULL REFERENCES games(event_game_id),
            event_team_id   TEXT REFERENCES usau_event_teams(event_team_id),
            numeric_team_id INTEGER,
            player_name     TEXT NOT NULL,
            jersey_number   TEXT,
            goals           INTEGER,
            assists         INTEGER,
            ds              INTEGER,
            turns           INTEGER,
            player_id       INTEGER REFERENCES players(id),
            scraped_at      TEXT,
            UNIQUE(event_game_id, player_name)
        );
        CREATE INDEX IF NOT EXISTS idx_nps_game   ON usau_nationals_player_stats(event_game_id);
        CREATE INDEX IF NOT EXISTS idx_nps_player ON usau_nationals_player_stats(player_name);
    """)
    conn.commit()


def init_ufa_db(conn: sqlite3.Connection) -> None:
    """Create UFA-specific tables (prefixed ufa_) in the shared database."""
    # Drop and recreate ufa_player_season_stats if it has the old HTML schema
    # (detected by absence of the API-native 'seconds_played' column).
    existing = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='ufa_player_season_stats'"
    ).fetchone()
    if existing:
        cols = [r[1] for r in conn.execute("PRAGMA table_info(ufa_player_season_stats)").fetchall()]
        if "seconds_played" not in cols:
            conn.execute("DROP TABLE ufa_player_season_stats")
            conn.commit()
        elif "team_id" not in cols:
            conn.execute("ALTER TABLE ufa_player_season_stats ADD COLUMN team_id TEXT")
            conn.commit()

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ufa_teams (
            team_slug       TEXT PRIMARY KEY,
            team_name       TEXT,
            division        TEXT,
            active          INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS ufa_players (
            player_slug             TEXT PRIMARY KEY,
            display_name            TEXT NOT NULL,
            current_team_name       TEXT,
            current_team_slug       TEXT,
            jersey_number           TEXT,
            photo_url               TEXT,
            bio_text                TEXT,
            most_recent_team_name   TEXT,
            most_recent_team_slug   TEXT,
            most_recent_team_year   INTEGER,
            data_source             TEXT NOT NULL DEFAULT 'ufa',
            player_surrogate_id     INTEGER REFERENCES player_identities(id),
            scraped_at              TEXT
        );

        CREATE TABLE IF NOT EXISTS ufa_player_season_stats (
            id                          INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id                   TEXT NOT NULL,
            year                        INTEGER NOT NULL,
            assists                     INTEGER,
            goals                       INTEGER,
            hockey_assists              INTEGER,
            completions                 INTEGER,
            throw_attempts              INTEGER,
            throwaways                  INTEGER,
            stalls                      INTEGER,
            callahans_thrown            INTEGER,
            yards_received              INTEGER,
            yards_thrown                INTEGER,
            hucks_attempted             INTEGER,
            hucks_completed             INTEGER,
            catches                     INTEGER,
            drops                       INTEGER,
            blocks                      INTEGER,
            callahans                   INTEGER,
            pulls                       INTEGER,
            ob_pulls                    INTEGER,
            recorded_pulls              INTEGER,
            recorded_pulls_hangtime     INTEGER,
            o_points_played             INTEGER,
            o_points_scored             INTEGER,
            d_points_played             INTEGER,
            d_points_scored             INTEGER,
            seconds_played              INTEGER,
            o_opportunities             INTEGER,
            o_opportunity_scores        INTEGER,
            d_opportunities             INTEGER,
            d_opportunity_stops         INTEGER,
            team_id                     TEXT,
            scraped_at                  TEXT,
            UNIQUE(player_id, year)
        );

        CREATE TABLE IF NOT EXISTS ufa_games (
            game_id             TEXT PRIMARY KEY,
            year                INTEGER NOT NULL,
            away_team_id        TEXT NOT NULL,
            home_team_id        TEXT NOT NULL,
            away_score          INTEGER,
            home_score          INTEGER,
            status              TEXT,
            start_timestamp     TEXT,
            start_timezone      TEXT,
            week                TEXT,
            streaming_url       TEXT,
            scraped_at          TEXT
        );

        CREATE TABLE IF NOT EXISTS ufa_team_seasons (
            team_id         TEXT NOT NULL,
            year            INTEGER NOT NULL,
            division_id     TEXT,
            division_name   TEXT,
            city            TEXT,
            name            TEXT,
            full_name       TEXT,
            abbrev          TEXT,
            wins            INTEGER,
            losses          INTEGER,
            ties            INTEGER,
            standing        INTEGER,
            scraped_at      TEXT,
            PRIMARY KEY (team_id, year)
        );

        CREATE TABLE IF NOT EXISTS ufa_scrape_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            url             TEXT NOT NULL,
            layer           TEXT NOT NULL,
            status          TEXT NOT NULL,
            http_status     INTEGER,
            error_msg       TEXT,
            scraped_at      TEXT NOT NULL
        );
    """)
    conn.commit()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# scrape_log helpers
# ---------------------------------------------------------------------------

def log_scrape(
    conn: sqlite3.Connection,
    url: str,
    layer: str,
    status: str,
    http_status: Optional[int] = None,
    detail: Optional[str] = None,
    error_msg: Optional[str] = None,
) -> None:
    conn.execute(
        """INSERT INTO scrape_log (url, layer, status, http_status, detail, error_msg, scraped_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (url, layer, status, http_status, detail, error_msg, now_iso()),
    )
    conn.commit()


def is_scrape_logged(
    conn: sqlite3.Connection,
    url: str,
    detail: Optional[str] = None,
) -> bool:
    if detail:
        row = conn.execute(
            "SELECT 1 FROM scrape_log WHERE url=? AND detail=? AND status IN ('success','skip') LIMIT 1",
            (url, detail),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT 1 FROM scrape_log WHERE url=? AND status IN ('success','skip') LIMIT 1",
            (url,),
        ).fetchone()
    return row is not None


# ---------------------------------------------------------------------------
# Event helpers
# ---------------------------------------------------------------------------

def upsert_event(conn: sqlite3.Connection, event: dict) -> None:
    conn.execute(
        """INSERT INTO events
               (event_slug, competition_group, event_title, event_url, source, event_type,
                city, state, date_start, date_end,
                season_year, competition_level, gender, division_label)
           VALUES
               (:event_slug, :competition_group, :event_title, :event_url, :source, :event_type,
                :city, :state, :date_start, :date_end,
                :season_year, :competition_level, :gender, :division_label)
           ON CONFLICT(event_slug, competition_group) DO NOTHING""",
        event,
    )
    conn.commit()


def update_event_ids(
    conn: sqlite3.Connection,
    event_slug: str,
    event_id: Optional[int],
    event_group_id: Optional[int],
    scraped_at: str,
) -> None:
    conn.execute(
        "UPDATE events SET event_id=?, event_group_id=?, scraped_at=? WHERE event_slug=?",
        (event_id, event_group_id, scraped_at, event_slug),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Team helpers
# ---------------------------------------------------------------------------

def upsert_team_stub(
    conn: sqlite3.Connection,
    event_team_id: str,
    event_slug: str,
    team_name: Optional[str] = None,
) -> None:
    name = team_name or ""
    conn.execute(
        """INSERT INTO usau_event_teams (event_team_id, team_name, event_slug)
           VALUES (?, ?, ?)
           ON CONFLICT(event_team_id) DO UPDATE SET
               team_name = CASE WHEN excluded.team_name != '' THEN excluded.team_name ELSE team_name END""",
        (event_team_id, name, event_slug),
    )
    conn.commit()


def update_team_full(conn: sqlite3.Connection, team: dict) -> None:
    conn.execute(
        """UPDATE usau_event_teams SET
               team_name        = :team_name,
               city             = :city,
               state            = :state,
               competition_level = :competition_level,
               gender_division  = :gender_division,
               scraped_at       = :scraped_at
           WHERE event_team_id = :event_team_id""",
        team,
    )
    conn.commit()


def insert_coaches(conn: sqlite3.Connection, coaches: list) -> None:
    conn.executemany(
        """INSERT INTO team_coaches (event_team_id, coach_name, is_head_coach)
           VALUES (:event_team_id, :coach_name, :is_head_coach)""",
        coaches,
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Game helpers
# ---------------------------------------------------------------------------

def upsert_game(conn: sqlite3.Connection, game: dict) -> None:
    conn.execute(
        """INSERT INTO games (
               event_game_id, numeric_game_id, event_slug, division_label,
               round_context, bracket_section, round_label, pool_name,
               game_date, game_time, game_datetime, field,
               home_event_team_id, away_event_team_id,
               team1_url, team2_url,
               home_score, away_score, status,
               match_report_url, has_match_report, scraped_at
           ) VALUES (
               :event_game_id, :numeric_game_id, :event_slug, :division_label,
               :round_context, :bracket_section, :round_label, :pool_name,
               :game_date, :game_time, :game_datetime, :field,
               :home_event_team_id, :away_event_team_id,
               :team1_url, :team2_url,
               :home_score, :away_score, :status,
               :match_report_url, :has_match_report, :scraped_at
           )
           ON CONFLICT(event_game_id) DO UPDATE SET
               home_event_team_id = COALESCE(excluded.home_event_team_id, home_event_team_id),
               away_event_team_id = COALESCE(excluded.away_event_team_id, away_event_team_id),
               team1_url          = COALESCE(excluded.team1_url, team1_url),
               team2_url          = COALESCE(excluded.team2_url, team2_url),
               home_score         = excluded.home_score,
               away_score         = excluded.away_score,
               status             = excluded.status,
               match_report_url   = excluded.match_report_url,
               has_match_report   = excluded.has_match_report,
               scraped_at         = excluded.scraped_at""",
        game,
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Player helpers
# ---------------------------------------------------------------------------

def insert_players(conn: sqlite3.Connection, players: list) -> None:
    conn.executemany(
        """INSERT INTO players (
               event_team_id, event_slug, player_name, jersey_number, pronouns,
               position, height, tournament_goals, tournament_assists,
               tournament_ds, tournament_turns, scraped_at
           ) VALUES (
               :event_team_id, :event_slug, :player_name, :jersey_number, :pronouns,
               :position, :height, :tournament_goals, :tournament_assists,
               :tournament_ds, :tournament_turns, :scraped_at
           )""",
        players,
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Game player stats helpers
# ---------------------------------------------------------------------------

def insert_game_player_stats(conn: sqlite3.Connection, stats: list) -> None:
    conn.executemany(
        """INSERT INTO game_player_stats (
               event_game_id, event_team_id, numeric_team_id,
               player_name, jersey_number, goals, assists, ds, turns, scraped_at
           ) VALUES (
               :event_game_id, :event_team_id, :numeric_team_id,
               :player_name, :jersey_number, :goals, :assists, :ds, :turns, :scraped_at
           )""",
        stats,
    )
    conn.commit()


# ---------------------------------------------------------------------------
# UFA helpers
# ---------------------------------------------------------------------------

def log_ufa(
    conn: sqlite3.Connection,
    url: str,
    layer: str,
    status: str,
    http_status: Optional[int] = None,
    error_msg: Optional[str] = None,
) -> None:
    conn.execute(
        """INSERT INTO ufa_scrape_log (url, layer, status, http_status, error_msg, scraped_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (url, layer, status, http_status, error_msg, now_iso()),
    )
    conn.commit()


def is_ufa_page_scraped(conn: sqlite3.Connection, url: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM ufa_scrape_log WHERE url=? AND status IN ('success','skip') LIMIT 1",
        (url,),
    ).fetchone()
    return row is not None


def upsert_ufa_player_stub(conn: sqlite3.Connection, player: dict) -> None:
    conn.execute(
        """INSERT INTO ufa_players
               (player_slug, display_name, most_recent_team_name, most_recent_team_slug, most_recent_team_year)
           VALUES
               (:player_slug, :display_name, :most_recent_team_name, :most_recent_team_slug, :most_recent_team_year)
           ON CONFLICT(player_slug) DO UPDATE SET
               display_name            = excluded.display_name,
               most_recent_team_name   = excluded.most_recent_team_name,
               most_recent_team_slug   = excluded.most_recent_team_slug,
               most_recent_team_year   = excluded.most_recent_team_year""",
        player,
    )
    conn.commit()


def update_ufa_player_profile(conn: sqlite3.Connection, profile: dict) -> None:
    conn.execute(
        """UPDATE ufa_players SET
               display_name        = :display_name,
               current_team_name   = :current_team_name,
               current_team_slug   = :current_team_slug,
               jersey_number       = :jersey_number,
               photo_url           = :photo_url,
               bio_text            = :bio_text,
               scraped_at          = :scraped_at
           WHERE player_slug = :player_slug""",
        profile,
    )
    conn.commit()


def upsert_ufa_team(conn: sqlite3.Connection, team_slug: str, team_name: str, division: str) -> None:
    conn.execute(
        """INSERT INTO ufa_teams (team_slug, team_name, division)
           VALUES (?, ?, ?)
           ON CONFLICT(team_slug) DO UPDATE SET
               team_name=excluded.team_name,
               division=excluded.division""",
        (team_slug, team_name, division),
    )
    conn.commit()


def insert_ufa_stat_row(conn: sqlite3.Connection, stat: dict) -> None:
    conn.execute(
        """INSERT INTO ufa_player_season_stats (
               player_id, year,
               assists, goals, hockey_assists, completions, throw_attempts,
               throwaways, stalls, callahans_thrown,
               yards_received, yards_thrown,
               hucks_attempted, hucks_completed,
               catches, drops, blocks, callahans,
               pulls, ob_pulls, recorded_pulls, recorded_pulls_hangtime,
               o_points_played, o_points_scored,
               d_points_played, d_points_scored,
               seconds_played,
               o_opportunities, o_opportunity_scores,
               d_opportunities, d_opportunity_stops,
               team_id, scraped_at
           ) VALUES (
               :player_id, :year,
               :assists, :goals, :hockey_assists, :completions, :throw_attempts,
               :throwaways, :stalls, :callahans_thrown,
               :yards_received, :yards_thrown,
               :hucks_attempted, :hucks_completed,
               :catches, :drops, :blocks, :callahans,
               :pulls, :ob_pulls, :recorded_pulls, :recorded_pulls_hangtime,
               :o_points_played, :o_points_scored,
               :d_points_played, :d_points_scored,
               :seconds_played,
               :o_opportunities, :o_opportunity_scores,
               :d_opportunities, :d_opportunity_stops,
               :team_id, :scraped_at
           )
           ON CONFLICT(player_id, year) DO UPDATE SET
               assists=excluded.assists, goals=excluded.goals,
               hockey_assists=excluded.hockey_assists,
               completions=excluded.completions, throw_attempts=excluded.throw_attempts,
               throwaways=excluded.throwaways, stalls=excluded.stalls,
               callahans_thrown=excluded.callahans_thrown,
               yards_received=excluded.yards_received, yards_thrown=excluded.yards_thrown,
               hucks_attempted=excluded.hucks_attempted, hucks_completed=excluded.hucks_completed,
               catches=excluded.catches, drops=excluded.drops,
               blocks=excluded.blocks, callahans=excluded.callahans,
               pulls=excluded.pulls, ob_pulls=excluded.ob_pulls,
               recorded_pulls=excluded.recorded_pulls,
               recorded_pulls_hangtime=excluded.recorded_pulls_hangtime,
               o_points_played=excluded.o_points_played, o_points_scored=excluded.o_points_scored,
               d_points_played=excluded.d_points_played, d_points_scored=excluded.d_points_scored,
               seconds_played=excluded.seconds_played,
               o_opportunities=excluded.o_opportunities,
               o_opportunity_scores=excluded.o_opportunity_scores,
               d_opportunities=excluded.d_opportunities,
               d_opportunity_stops=excluded.d_opportunity_stops,
               team_id=excluded.team_id,
               scraped_at=excluded.scraped_at""",
        stat,
    )
    conn.commit()


def get_unscraped_ufa_players(conn: sqlite3.Connection) -> list:
    """Return list of player_slugs that have not yet had profiles scraped."""
    rows = conn.execute(
        "SELECT player_slug FROM ufa_players WHERE scraped_at IS NULL ORDER BY player_slug"
    ).fetchall()
    return [r["player_slug"] for r in rows]


def mark_ufa_player_scraped(conn: sqlite3.Connection, player_slug: str, scraped_at: str) -> None:
    conn.execute(
        "UPDATE ufa_players SET scraped_at=? WHERE player_slug=?",
        (scraped_at, player_slug),
    )
    conn.commit()


def delete_ufa_player_stats(conn: sqlite3.Connection, player_slug: str) -> None:
    """Remove all season stats for a player (used when re-scraping with --force)."""
    conn.execute(
        "DELETE FROM ufa_player_season_stats WHERE player_slug=?",
        (player_slug,),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# PUL helpers
# ---------------------------------------------------------------------------

def init_pul_db(conn: sqlite3.Connection) -> None:
    """Create PUL-specific tables in the shared database."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS pul_player_season_stats (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            player_name         TEXT NOT NULL,
            player_url          TEXT NOT NULL DEFAULT '',
            team                TEXT,
            season              TEXT NOT NULL,
            games_played        INTEGER,
            goals               INTEGER,
            assists             INTEGER,
            blocks              INTEGER,
            turnovers           INTEGER,
            touches             INTEGER,
            o_pts               INTEGER,
            d_pts               INTEGER,
            plus_minus          REAL,
            total_pts           INTEGER,
            throws              INTEGER,
            catches             INTEGER,
            second_ast          INTEGER,
            poss_init           INTEGER,
            throw_err           INTEGER,
            rec_err             INTEGER,
            throwing_yards      REAL,
            throwing_yards_avg  REAL,
            catching_yards      REAL,
            catching_yards_avg  REAL,
            extra_stats         TEXT,
            scraped_at          TEXT,
            UNIQUE(player_name, season)
        );

        CREATE TABLE IF NOT EXISTS pul_scrape_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            season      TEXT NOT NULL,
            status      TEXT NOT NULL,
            detail      TEXT,
            scraped_at  TEXT NOT NULL
        );

        -- One row per game discovered from the results/schedule pages.
        -- has_stats=1 once team + player box-score rows have been written.
        CREATE TABLE IF NOT EXISTS pul_game_index (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            season      TEXT NOT NULL,
            round       TEXT,
            game_slug   TEXT NOT NULL,
            away_team   TEXT NOT NULL,
            home_team   TEXT NOT NULL,
            score_away  INTEGER,
            score_home  INTEGER,
            game_date   TEXT,
            game_url    TEXT NOT NULL UNIQUE,
            has_stats   INTEGER NOT NULL DEFAULT 0,
            scraped_at  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_pul_game_season ON pul_game_index(season);

        -- Team-level box score per game (two rows per game: one each side).
        CREATE TABLE IF NOT EXISTS pul_team_game_stats (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id           INTEGER NOT NULL REFERENCES pul_game_index(id) ON DELETE CASCADE,
            team              TEXT NOT NULL,
            goals             INTEGER,
            break_goals       INTEGER,
            holds             INTEGER,
            clean_holds       INTEGER,
            blocks            INTEGER,
            turnovers         INTEGER,
            pass_attempts     INTEGER,
            completed_passes  INTEGER,
            hucks             INTEGER,
            completion_pct    REAL,
            UNIQUE(game_id, team)
        );

        -- Per-player box score per game.
        CREATE TABLE IF NOT EXISTS pul_player_game_stats (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id         INTEGER NOT NULL REFERENCES pul_game_index(id) ON DELETE CASCADE,
            team            TEXT NOT NULL,
            player_name     TEXT NOT NULL,
            jersey_number   TEXT,
            goals           INTEGER,
            assists         INTEGER,
            blocks          INTEGER,
            turnovers       INTEGER,
            pass_attempts   INTEGER,
            completions     INTEGER,
            points_played   INTEGER,
            plus_minus      INTEGER,
            extra_stats     TEXT,
            UNIQUE(game_id, team, player_name)
        );
        CREATE INDEX IF NOT EXISTS idx_pul_pgstats_game   ON pul_player_game_stats(game_id);
        CREATE INDEX IF NOT EXISTS idx_pul_pgstats_player ON pul_player_game_stats(player_name);

        -- Scrape log for individual game pages.
        CREATE TABLE IF NOT EXISTS pul_game_scrape_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id     INTEGER NOT NULL REFERENCES pul_game_index(id),
            status      TEXT NOT NULL,
            detail      TEXT,
            scraped_at  TEXT NOT NULL
        );
    """)
    conn.commit()


def log_pul(
    conn: sqlite3.Connection,
    season: str,
    status: str,
    detail: Optional[str] = None,
) -> None:
    conn.execute(
        "INSERT INTO pul_scrape_log (season, status, detail, scraped_at) VALUES (?, ?, ?, ?)",
        (season, status, detail, now_iso()),
    )
    conn.commit()


def is_pul_season_scraped(conn: sqlite3.Connection, season: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM pul_scrape_log WHERE season=? AND status='success' LIMIT 1",
        (season,),
    ).fetchone()
    return row is not None


def upsert_pul_player_stats(conn: sqlite3.Connection, row: dict) -> None:
    """Upsert a single player-season stat row into pul_player_season_stats.

    The row dict must contain at least player_name and season.
    All known stat columns are mapped; any unrecognised keys go into extra_stats.
    """
    known = {
        "player_name", "player_url", "team", "season", "scraped_at",
        "games_played", "goals", "assists", "blocks", "turnovers", "touches",
        "o_pts", "d_pts", "plus_minus", "total_pts", "throws", "catches",
        "second_ast", "poss_init", "throw_err", "rec_err",
        "throwing_yards", "throwing_yards_avg", "catching_yards", "catching_yards_avg",
    }
    import json as _json
    main = {k: row[k] for k in known if k in row}
    extra = {k: v for k, v in row.items() if k not in known}
    if extra:
        main["extra_stats"] = _json.dumps(extra)

    cols = list(main.keys())
    placeholders = ", ".join("?" * len(cols))
    updates = ", ".join(f"{c}=excluded.{c}" for c in cols if c not in ("player_name", "season"))
    conn.execute(
        f"INSERT INTO pul_player_season_stats ({', '.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(player_name, season) DO UPDATE SET {updates}",
        list(main.values()),
    )
    conn.commit()


def upsert_master_player_pul(
    conn: sqlite3.Connection,
    pul_id: str,
    full_name: str,
    first_name: str,
    last_name: str,
) -> None:
    """Insert or update a master_players row keyed by PUL_ID."""
    existing = conn.execute(
        "SELECT ID FROM master_players WHERE PUL_ID=? LIMIT 1", (pul_id,)
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE master_players SET Name=?, FirstName=?, LastName=? WHERE ID=?",
            (full_name, first_name, last_name, existing[0]),
        )
    else:
        conn.execute(
            "INSERT OR IGNORE INTO master_players (ID, Name, FirstName, LastName, PUL_ID) "
            "VALUES (?, ?, ?, ?, ?)",
            (f"pul_{pul_id}", full_name, first_name, last_name, pul_id),
        )
    conn.commit()


def set_pul_photo_url(conn: sqlite3.Connection, player_id: int, photo_url: str) -> None:
    conn.execute(
        "UPDATE master_players SET PUL_photo_url=? WHERE ID=?",
        (photo_url, player_id),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# WUL helpers
# ---------------------------------------------------------------------------

def init_wul_db(conn: sqlite3.Connection) -> None:
    """Create WUL-specific tables in the shared database."""
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS wul_scrape_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            year        TEXT NOT NULL,
            data_type   TEXT NOT NULL,
            status      TEXT NOT NULL,
            detail      TEXT,
            scraped_at  TEXT NOT NULL
        );

        -- Per-player game-level stats.  Base columns match the Standard CSV;
        -- wul_phase2 adds any additional columns from Advanced CSVs via ALTER TABLE.
        CREATE TABLE IF NOT EXISTS wul_player_game_stats (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            season          TEXT NOT NULL,
            date            TEXT,
            team            TEXT NOT NULL,
            player          TEXT NOT NULL,
            opponent        TEXT,
            completions     REAL,
            assists         REAL,
            throwing_yards  REAL,
            receptions      REAL,
            goals           REAL,
            receiving_yards REAL,
            dpp             REAL,
            blocks          REAL,
            scraped_at      TEXT,
            UNIQUE(season, date, team, player, opponent)
        );
        CREATE INDEX IF NOT EXISTS idx_wul_pgstats_player ON wul_player_game_stats(player);
        CREATE INDEX IF NOT EXISTS idx_wul_pgstats_date   ON wul_player_game_stats(date);

        -- Per-team game-level stats.  Additional columns added dynamically.
        CREATE TABLE IF NOT EXISTS wul_team_game_stats (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            season      TEXT NOT NULL,
            date        TEXT,
            team        TEXT NOT NULL,
            opponent    TEXT,
            scraped_at  TEXT,
            UNIQUE(season, date, team, opponent)
        );
        CREATE INDEX IF NOT EXISTS idx_wul_tgstats_team ON wul_team_game_stats(team);

        -- Canonical game records synthesized from wul_team_game_stats.
        -- home/away is assigned alphabetically by franchise_id (no official h/a in WUL stats).
        CREATE TABLE IF NOT EXISTS wul_games (
            game_id         TEXT PRIMARY KEY,
            year            INTEGER NOT NULL,
            date            TEXT,
            season          TEXT,
            home_team       TEXT NOT NULL,
            away_team       TEXT NOT NULL,
            home_team_id    TEXT,
            away_team_id    TEXT,
            home_score      INTEGER,
            away_score      INTEGER,
            status          TEXT,
            scraped_at      TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_wul_games_date ON wul_games(date);
        CREATE INDEX IF NOT EXISTS idx_wul_games_year ON wul_games(year);
    """)
    conn.commit()


def log_wul(
    conn: sqlite3.Connection,
    year: str,
    data_type: str,
    status: str,
    detail: Optional[str] = None,
) -> None:
    conn.execute(
        "INSERT INTO wul_scrape_log (year, data_type, status, detail, scraped_at) VALUES (?, ?, ?, ?, ?)",
        (year, data_type, status, detail, now_iso()),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# UltiAnalytics submission helpers
# ---------------------------------------------------------------------------

def init_ua_db(conn: sqlite3.Connection) -> None:
    """Create UltiAnalytics upload / submission tables in the shared database."""
    conn.executescript("""
        PRAGMA foreign_keys = ON;

        -- Teams authorised to submit .iexport files.
        -- Registered by admin; upload_code_hash is SHA-256 of the team's upload code.
        CREATE TABLE IF NOT EXISTS ua_authorized_teams (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            team_cloud_id    TEXT NOT NULL UNIQUE,
            team_name        TEXT NOT NULL,
            authorized_email TEXT NOT NULL,
            upload_code_hash TEXT NOT NULL,
            division         TEXT,
            program_id       TEXT REFERENCES usau_programs(program_id),
            active           INTEGER NOT NULL DEFAULT 1,
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            notes            TEXT
        );

        -- One row per .iexport upload.  raw_json stores the full parsed payload
        -- so it can be re-processed if the schema changes.
        CREATE TABLE IF NOT EXISTS ua_game_submissions (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            team_cloud_id    TEXT NOT NULL REFERENCES ua_authorized_teams(team_cloud_id),
            submitted_by     TEXT NOT NULL,
            submitted_at     TEXT NOT NULL DEFAULT (datetime('now')),
            file_hash        TEXT NOT NULL UNIQUE,
            game_date        TEXT,
            season           TEXT,
            opponent_name    TEXT,
            tournament_name  TEXT,
            score_us         INTEGER,
            score_them       INTEGER,
            raw_json         TEXT NOT NULL,
            status           TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','viable','rejected','approved','withdrawn')),
            viability_checked_at  TEXT,
            viability_notes       TEXT,
            usau_game_id          TEXT REFERENCES games(event_game_id),
            approved_by      TEXT,
            approved_at      TEXT,
            rejection_reason TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ua_submissions_team   ON ua_game_submissions(team_cloud_id);
        CREATE INDEX IF NOT EXISTS idx_ua_submissions_status ON ua_game_submissions(status);
        CREATE INDEX IF NOT EXISTS idx_ua_submissions_date   ON ua_game_submissions(game_date);

        -- Exploded roster — populated when a submission is approved.
        CREATE TABLE IF NOT EXISTS ua_game_roster (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id    INTEGER NOT NULL REFERENCES ua_game_submissions(id) ON DELETE CASCADE,
            player_name      TEXT NOT NULL,
            jersey_number    TEXT,
            position         TEXT,
            gender           TEXT,
            absent           INTEGER NOT NULL DEFAULT 0,
            usau_player_id   INTEGER REFERENCES usau_player_ids(id),
            identity_confidence TEXT CHECK(identity_confidence IN ('exact','fuzzy','manual',NULL))
        );
        CREATE INDEX IF NOT EXISTS idx_ua_roster_submission ON ua_game_roster(submission_id);
        CREATE INDEX IF NOT EXISTS idx_ua_roster_usau_pid   ON ua_game_roster(usau_player_id);

        -- Per-player stats — populated when a submission is approved.
        CREATE TABLE IF NOT EXISTS ua_game_player_stats (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id           INTEGER NOT NULL REFERENCES ua_game_submissions(id) ON DELETE CASCADE,
            roster_id               INTEGER NOT NULL REFERENCES ua_game_roster(id),
            goals                   INTEGER NOT NULL DEFAULT 0,
            assists                 INTEGER NOT NULL DEFAULT 0,
            hockey_assists          INTEGER NOT NULL DEFAULT 0,
            pass_attempts           INTEGER NOT NULL DEFAULT 0,
            completions             INTEGER NOT NULL DEFAULT 0,
            throwaways              INTEGER NOT NULL DEFAULT 0,
            pass_pct                REAL,
            drops                   INTEGER NOT NULL DEFAULT 0,
            blocks                  INTEGER NOT NULL DEFAULT 0,
            callahans               INTEGER NOT NULL DEFAULT 0,
            pulls                   INTEGER NOT NULL DEFAULT 0,
            pull_hangtime_avg_sec   REAL
        );
        CREATE INDEX IF NOT EXISTS idx_ua_stats_submission ON ua_game_player_stats(submission_id);
        CREATE INDEX IF NOT EXISTS idx_ua_stats_roster     ON ua_game_player_stats(roster_id);

        -- Immutable audit trail for every status transition.
        CREATE TABLE IF NOT EXISTS ua_upload_audit_log (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id INTEGER NOT NULL REFERENCES ua_game_submissions(id),
            action        TEXT NOT NULL,
            actor         TEXT,
            detail        TEXT,
            at            TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_ua_audit_submission ON ua_upload_audit_log(submission_id);
    """)
    conn.commit()


def is_wul_item_downloaded(conn: sqlite3.Connection, year: str, data_type: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM wul_scrape_log WHERE year=? AND data_type=? AND status='downloaded' LIMIT 1",
        (year, data_type),
    ).fetchone()
    return row is not None


def is_wul_item_imported(conn: sqlite3.Connection, year: str, data_type: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM wul_scrape_log WHERE year=? AND data_type=? AND status='imported' LIMIT 1",
        (year, data_type),
    ).fetchone()
    return row is not None


# ---------------------------------------------------------------------------
# PUL per-game helpers
# ---------------------------------------------------------------------------

def upsert_pul_game_index(
    conn: sqlite3.Connection,
    season: str,
    round_: str | None,
    game_slug: str,
    away_team: str,
    home_team: str,
    game_url: str,
    score_away: int | None = None,
    score_home: int | None = None,
    game_date: str | None = None,
) -> int:
    """Insert or update a game in pul_game_index; return the row id."""
    conn.execute(
        """
        INSERT INTO pul_game_index
            (season, round, game_slug, away_team, home_team, game_url,
             score_away, score_home, game_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(game_url) DO UPDATE SET
            score_away = excluded.score_away,
            score_home = excluded.score_home,
            game_date  = excluded.game_date
        """,
        (season, round_, game_slug, away_team, home_team, game_url,
         score_away, score_home, game_date),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id FROM pul_game_index WHERE game_url=?", (game_url,)
    ).fetchone()
    return row[0]


def mark_pul_game_scraped(
    conn: sqlite3.Connection, game_id: int, has_stats: int
) -> None:
    conn.execute(
        "UPDATE pul_game_index SET has_stats=?, scraped_at=? WHERE id=?",
        (has_stats, now_iso(), game_id),
    )
    conn.commit()


def log_pul_game(
    conn: sqlite3.Connection,
    game_id: int,
    status: str,
    detail: str | None = None,
) -> None:
    conn.execute(
        "INSERT INTO pul_game_scrape_log (game_id, status, detail, scraped_at) VALUES (?, ?, ?, ?)",
        (game_id, status, detail, now_iso()),
    )
    conn.commit()


def upsert_pul_team_game_stat(conn: sqlite3.Connection, game_id: int, row: dict) -> None:
    """Insert or replace a team-level game stat row."""
    COLS = (
        "game_id", "team", "goals", "break_goals", "holds", "clean_holds",
        "blocks", "turnovers", "pass_attempts", "completed_passes", "hucks", "completion_pct",
    )
    data = {"game_id": game_id}
    data.update({k: row.get(k) for k in COLS if k != "game_id"})
    cols = list(data.keys())
    placeholders = ", ".join("?" * len(cols))
    updates = ", ".join(f"{c}=excluded.{c}" for c in cols if c not in ("game_id", "team"))
    conn.execute(
        f"INSERT INTO pul_team_game_stats ({', '.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(game_id, team) DO UPDATE SET {updates}",
        list(data.values()),
    )
    conn.commit()


def upsert_pul_player_game_stat(conn: sqlite3.Connection, game_id: int, row: dict) -> None:
    """Insert or replace a per-player game stat row."""
    import json as _json
    KNOWN = {
        "game_id", "team", "player_name", "jersey_number",
        "goals", "assists", "blocks", "turnovers",
        "pass_attempts", "completions", "points_played", "plus_minus",
    }
    data = {"game_id": game_id}
    data.update({k: row[k] for k in KNOWN if k in row and k != "game_id"})
    extra = {k: v for k, v in row.items() if k not in KNOWN}
    if extra:
        data["extra_stats"] = _json.dumps(extra)

    cols = list(data.keys())
    placeholders = ", ".join("?" * len(cols))
    updates = ", ".join(
        f"{c}=excluded.{c}" for c in cols if c not in ("game_id", "team", "player_name")
    )
    conn.execute(
        f"INSERT INTO pul_player_game_stats ({', '.join(cols)}) VALUES ({placeholders}) "
        f"ON CONFLICT(game_id, team, player_name) DO UPDATE SET {updates}",
        list(data.values()),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Auth / Subscription helpers
# ---------------------------------------------------------------------------

def init_auth_db(conn: sqlite3.Connection) -> None:
    """Create user auth + subscription tables in the shared database."""
    # Migration: drop auth_subscriptions if it predates the expanded tier set
    # (tables were freshly added and have no production data yet)
    if conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='auth_subscriptions'"
    ).fetchone():
        cols = {r[1] for r in conn.execute("PRAGMA table_info(auth_subscriptions)").fetchall()}
        if "billing_cycle" not in cols:
            conn.executescript("""
                DROP TABLE IF EXISTS auth_report_credits;
                DROP TABLE IF EXISTS auth_org_members;
                DROP TABLE IF EXISTS auth_subscriptions;
            """)
            conn.commit()

    conn.executescript("""
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS auth_users (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            email          TEXT UNIQUE NOT NULL,
            password_hash  TEXT NOT NULL,
            display_name   TEXT,
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            email_verified INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);

        CREATE TABLE IF NOT EXISTS auth_org_teams (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT NOT NULL,
            league        TEXT,
            team_type     TEXT CHECK(team_type IN ('high_school','college','club','pro')),
            owner_user_id INTEGER REFERENCES auth_users(id),
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- Individual subscriptions:  user_id set, org_team_id NULL
        -- Team org subscriptions:    org_team_id set, user_id may be NULL
        CREATE TABLE IF NOT EXISTS auth_subscriptions (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id                INTEGER REFERENCES auth_users(id),
            org_team_id            INTEGER REFERENCES auth_org_teams(id),
            tier                   TEXT NOT NULL DEFAULT 'free'
                CHECK(tier IN ('free','pro','analyst','hs_team','college_team','club_team','pro_team')),
            billing_cycle          TEXT NOT NULL DEFAULT 'monthly'
                CHECK(billing_cycle IN ('monthly','annual')),
            seat_count             INTEGER NOT NULL DEFAULT 1,
            stripe_customer_id     TEXT,
            stripe_subscription_id TEXT UNIQUE,
            stripe_price_id        TEXT,
            status                 TEXT NOT NULL DEFAULT 'active'
                CHECK(status IN ('active','past_due','canceled','trialing')),
            current_period_end     TEXT,
            created_at             TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_auth_subs_user        ON auth_subscriptions(user_id);
        CREATE INDEX IF NOT EXISTS idx_auth_subs_org         ON auth_subscriptions(org_team_id);
        CREATE INDEX IF NOT EXISTS idx_auth_subs_stripe_cust ON auth_subscriptions(stripe_customer_id);
        CREATE INDEX IF NOT EXISTS idx_auth_subs_stripe_sub  ON auth_subscriptions(stripe_subscription_id);

        -- Monthly report-credit tracking for College / Club / Pro-team plans
        CREATE TABLE IF NOT EXISTS auth_report_credits (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            subscription_id  INTEGER NOT NULL REFERENCES auth_subscriptions(id),
            month_key        TEXT NOT NULL,  -- 'YYYY-MM'
            credits_included INTEGER NOT NULL DEFAULT 1,
            credits_used     INTEGER NOT NULL DEFAULT 0,
            UNIQUE(subscription_id, month_key)
        );

        CREATE TABLE IF NOT EXISTS auth_org_members (
            org_team_id INTEGER NOT NULL REFERENCES auth_org_teams(id),
            user_id     INTEGER NOT NULL REFERENCES auth_users(id),
            role        TEXT NOT NULL DEFAULT 'member'
                CHECK(role IN ('owner','admin','member')),
            joined_at   TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (org_team_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_auth_org_members_user ON auth_org_members(user_id);
    """)
    conn.commit()
