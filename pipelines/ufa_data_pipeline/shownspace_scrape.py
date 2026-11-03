"""
Scrapes https://shownspace.com/api/games/{game_id} for all game_ids in ufa_games.
Creates and populates the following tables:
  - shownspace_games
  - shownspace_player_stats
  - shownspace_team_stats
  - shownspace_recent_team_stats
  - shownspace_throws
  - shownspace_blocks
  - shownspace_pulls
  - shownspace_game_links
"""

import os
import sqlite3
import requests
import time
import logging
from pathlib import Path

DB_PATH = Path(os.environ.get("UFA_DB_PATH") or Path(__file__).resolve().parents[2] / "data" / "db" / "ultimate.db")
API_BASE = "https://shownspace.com/api/games"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("scrape_shownspace.log"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS shownspace_games (
    game_id             TEXT PRIMARY KEY,
    away_team_id        TEXT,
    home_team_id        TEXT,
    away_score          INTEGER,
    home_score          INTEGER,
    status              TEXT,
    start_timestamp     TEXT,
    start_timezone      TEXT,
    week                TEXT,
    year                INTEGER,
    update_timestamp    TEXT,
    is_final            INTEGER,
    finalized_at        TEXT,
    home_team_colour    TEXT,
    away_team_colour    TEXT,
    home_team_abbrev    TEXT,
    away_team_abbrev    TEXT,
    insert_timestamp    TEXT
);

CREATE TABLE IF NOT EXISTS shownspace_player_stats (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id                         TEXT NOT NULL,
    player_id                       TEXT NOT NULL,
    full_name                       TEXT,
    first_name                      TEXT,
    last_name                       TEXT,
    team_id                         TEXT,
    jersey_number                   TEXT,
    year                            INTEGER,
    assists                         INTEGER,
    goals                           INTEGER,
    hockey_assists                  INTEGER,
    completions                     INTEGER,
    throw_attempts                  INTEGER,
    throwaways                      INTEGER,
    stalls                          INTEGER,
    callahans_thrown                INTEGER,
    yards_received                  INTEGER,
    yards_thrown                    INTEGER,
    catches                         INTEGER,
    drops                           INTEGER,
    blocks                          INTEGER,
    callahans                       INTEGER,
    pulls                           INTEGER,
    ob_pulls                        INTEGER,
    recorded_pulls                  INTEGER,
    recorded_pulls_hangtime         INTEGER,
    o_points_played                 INTEGER,
    o_points_scored                 INTEGER,
    d_points_played                 INTEGER,
    d_points_scored                 INTEGER,
    seconds_played                  INTEGER,
    lag_contribution                REAL,
    xcp                             REAL,
    cpoe_completions                INTEGER,
    cpoe_attempts                   INTEGER,
    cpoe                            REAL,
    throws_dropped                  INTEGER,
    thrower_aec                     REAL,
    receiver_aec                    REAL,
    total_aec                       REAL,
    offensive_possessions           INTEGER,
    offensive_possessions_involved  INTEGER,
    offensive_possessions_scored    INTEGER,
    defensive_possessions           INTEGER,
    defensive_possessions_stopped   INTEGER,
    completion_percentage           REAL,
    team_total_aec                  REAL,
    player_impact                   REAL,
    total_possession_aec            REAL,
    player_impact_possession        REAL,
    hucks_thrown                    INTEGER,
    hucks_completed                 INTEGER,
    hucks_dropped                   INTEGER,
    hucks_caught                    INTEGER,
    connections                     TEXT,
    huck_completion_percentage      REAL,
    oe                              REAL,
    de                              REAL,
    turnovers                       INTEGER,
    insert_timestamp                TEXT,
    UNIQUE(game_id, player_id)
);

CREATE TABLE IF NOT EXISTS shownspace_team_stats (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id                         TEXT NOT NULL,
    team_id                         TEXT NOT NULL,
    is_home                         INTEGER,
    line_type                       TEXT,
    year                            INTEGER,
    total_aec                       REAL,
    xcp                             REAL,
    cpoe_attempts                   INTEGER,
    cpoe_completions                INTEGER,
    cpoe                            REAL,
    goals                           INTEGER,
    assists                         INTEGER,
    hockey_assists                  INTEGER,
    throw_attempts                  INTEGER,
    completions                     INTEGER,
    completion_percentage           REAL,
    stalls                          INTEGER,
    callahans_thrown                INTEGER,
    callahans_caught                INTEGER,
    yards_thrown                    INTEGER,
    yards_received                  INTEGER,
    hucks_attempted                 INTEGER,
    hucks_completed                 INTEGER,
    huck_completion_percentage      REAL,
    catches                         INTEGER,
    drops                           INTEGER,
    pulls                           INTEGER,
    ob_pulls                        INTEGER,
    roller_pulls                    INTEGER,
    offensive_possessions           INTEGER,
    defensive_possessions           INTEGER,
    goals_allowed                   INTEGER,
    redzone_offensive_possessions   INTEGER,
    redzone_goals                   INTEGER,
    redzone_defensive_possessions   INTEGER,
    redzone_goals_allowed           INTEGER,
    time_per_possession             REAL,
    throws_per_possession           REAL,
    oe                              REAL,
    de                              REAL,
    redzone_oe                      REAL,
    redzone_de                      REAL,
    xoe                             REAL,
    xde                             REAL,
    oeoe                            REAL,
    deoe                            REAL,
    blocks                          INTEGER,
    o_points                        INTEGER,
    d_points                        INTEGER,
    holds                           INTEGER,
    clean_holds                     INTEGER,
    breaks                          INTEGER,
    hold_percent                    REAL,
    clean_hold_percent              REAL,
    break_percent                   REAL,
    opp_hucks_attempted             INTEGER,
    opp_hucks_completed             INTEGER,
    opp_huck_completion_percentage  REAL,
    throwaways                      INTEGER,
    insert_timestamp                TEXT,
    UNIQUE(game_id, team_id, line_type)
);

CREATE TABLE IF NOT EXISTS shownspace_recent_team_stats (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id                         TEXT NOT NULL,
    team_id                         TEXT NOT NULL,
    is_home                         INTEGER,
    line_type                       TEXT,
    year                            INTEGER,
    total_aec                       REAL,
    xcp                             REAL,
    cpoe_attempts                   INTEGER,
    cpoe_completions                INTEGER,
    cpoe                            REAL,
    goals                           INTEGER,
    assists                         INTEGER,
    hockey_assists                  INTEGER,
    throw_attempts                  INTEGER,
    completions                     INTEGER,
    completion_percentage           REAL,
    stalls                          INTEGER,
    callahans_thrown                INTEGER,
    callahans_caught                INTEGER,
    yards_thrown                    INTEGER,
    yards_received                  INTEGER,
    hucks_attempted                 INTEGER,
    hucks_completed                 INTEGER,
    huck_completion_percentage      REAL,
    catches                         INTEGER,
    drops                           INTEGER,
    pulls                           INTEGER,
    ob_pulls                        INTEGER,
    roller_pulls                    INTEGER,
    offensive_possessions           INTEGER,
    defensive_possessions           INTEGER,
    goals_allowed                   INTEGER,
    redzone_offensive_possessions   INTEGER,
    redzone_goals                   INTEGER,
    redzone_defensive_possessions   INTEGER,
    redzone_goals_allowed           INTEGER,
    time_per_possession             REAL,
    throws_per_possession           REAL,
    oe                              REAL,
    de                              REAL,
    redzone_oe                      REAL,
    redzone_de                      REAL,
    xoe                             REAL,
    xde                             REAL,
    oeoe                            REAL,
    deoe                            REAL,
    blocks                          INTEGER,
    o_points                        INTEGER,
    d_points                        INTEGER,
    holds                           INTEGER,
    clean_holds                     INTEGER,
    breaks                          INTEGER,
    hold_percent                    REAL,
    clean_hold_percent              REAL,
    break_percent                   REAL,
    opp_hucks_attempted             INTEGER,
    opp_hucks_completed             INTEGER,
    opp_huck_completion_percentage  REAL,
    throwaways                      INTEGER,
    insert_timestamp                TEXT,
    UNIQUE(game_id, team_id, line_type)
);

CREATE TABLE IF NOT EXISTS shownspace_throws (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id                 TEXT NOT NULL,
    event_id                INTEGER,
    event_id_calc           INTEGER,
    global_event_seq        INTEGER,
    source_global_event_seq INTEGER,
    event_sig_id            TEXT UNIQUE,
    throw_sig_id            TEXT,
    source_throw_hash       TEXT,
    thrower                 TEXT,
    thrower_x               REAL,
    thrower_y               REAL,
    receiver                TEXT,
    receiver_x              REAL,
    receiver_y              REAL,
    turnover                INTEGER,
    dropped_throw           INTEGER,
    stall                   INTEGER,
    offensive_line          TEXT,
    defensive_line          TEXT,
    is_home_team            INTEGER,
    home_team_score         INTEGER,
    away_team_score         INTEGER,
    game_quarter            INTEGER,
    quarter_point           INTEGER,
    point_start_time        INTEGER,
    possession_num          INTEGER,
    possession_throw        INTEGER,
    start_on_offense        INTEGER,
    o_line                  INTEGER,
    source_side             TEXT,
    source_side_idx         INTEGER,
    source_timestamp        INTEGER,
    source_event_type       INTEGER,
    source_event_id         INTEGER,
    derived_sort_timestamp  INTEGER,
    sort_timestamp_imputed  INTEGER,
    time_left               REAL,
    throw_distance          REAL,
    x_diff                  REAL,
    y_diff                  REAL,
    throw_angle             REAL,
    cp                      REAL,
    cpoe                    REAL,
    min_fv                  REAL,
    fv_thrower              REAL,
    fv_receiver             REAL,
    fv_opponent             REAL,
    game_time_left          REAL,
    score_diff              INTEGER,
    win_prob                REAL,
    ec                      REAL,
    aec                     REAL,
    insert_timestamp        TEXT
);

CREATE TABLE IF NOT EXISTS shownspace_blocks (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id                     TEXT NOT NULL,
    event_id                    INTEGER,
    event_id_calc               INTEGER,
    global_event_seq            INTEGER,
    source_global_event_seq     INTEGER,
    event_sig_id                TEXT UNIQUE,
    throw_sig_id                TEXT,
    throw_ref_id                TEXT,
    source_throw_hash           TEXT,
    thrower                     TEXT,
    thrower_x                   REAL,
    thrower_y                   REAL,
    receiver                    TEXT,
    receiver_x                  REAL,
    receiver_y                  REAL,
    defender                    TEXT,
    turnover                    INTEGER,
    turnover_x                  REAL,
    turnover_y                  REAL,
    dropped_throw               INTEGER,
    stall                       INTEGER,
    offensive_line              TEXT,
    defensive_line              TEXT,
    is_home_team                INTEGER,
    home_team_score             INTEGER,
    away_team_score             INTEGER,
    game_quarter                INTEGER,
    quarter_point               INTEGER,
    point_start_time            INTEGER,
    possession_num              INTEGER,
    possession_throw            INTEGER,
    start_on_offense            INTEGER,
    o_line                      INTEGER,
    source_side                 TEXT,
    source_side_idx             INTEGER,
    source_timestamp            INTEGER,
    source_event_type           INTEGER,
    source_event_id             INTEGER,
    derived_sort_timestamp      INTEGER,
    sort_timestamp_imputed      INTEGER,
    time_left                   REAL,
    throw_distance              REAL,
    x_diff                      REAL,
    y_diff                      REAL,
    throw_angle                 REAL,
    cp                          REAL,
    cpoe                        REAL,
    min_fv                      REAL,
    fv_thrower                  REAL,
    fv_receiver                 REAL,
    fv_opponent                 REAL,
    game_time_left              REAL,
    score_diff                  INTEGER,
    win_prob                    REAL,
    ec                          REAL,
    aec                         REAL,
    pull_x                      REAL,
    pull_y                      REAL,
    pull_ms                     INTEGER,
    puller                      TEXT,
    in_bounds                   INTEGER,
    penalty_on_recording_team   INTEGER,
    insert_timestamp            TEXT
);

CREATE TABLE IF NOT EXISTS shownspace_pulls (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id                     TEXT NOT NULL,
    event_id                    INTEGER,
    event_id_calc               INTEGER,
    global_event_seq            INTEGER,
    source_global_event_seq     INTEGER,
    event_sig_id                TEXT UNIQUE,
    throw_sig_id                TEXT,
    throw_ref_id                TEXT,
    source_throw_hash           TEXT,
    thrower                     TEXT,
    thrower_x                   REAL,
    thrower_y                   REAL,
    receiver                    TEXT,
    receiver_x                  REAL,
    receiver_y                  REAL,
    puller                      TEXT,
    pull_x                      REAL,
    pull_y                      REAL,
    pull_ms                     INTEGER,
    in_bounds                   INTEGER,
    turnover                    INTEGER,
    dropped_throw               INTEGER,
    stall                       INTEGER,
    offensive_line              TEXT,
    defensive_line              TEXT,
    is_home_team                INTEGER,
    home_team_score             INTEGER,
    away_team_score             INTEGER,
    game_quarter                INTEGER,
    quarter_point               INTEGER,
    point_start_time            INTEGER,
    possession_num              INTEGER,
    possession_throw            INTEGER,
    start_on_offense            INTEGER,
    o_line                      INTEGER,
    source_side                 TEXT,
    source_side_idx             INTEGER,
    source_timestamp            INTEGER,
    source_event_type           INTEGER,
    source_event_id             INTEGER,
    derived_sort_timestamp      INTEGER,
    sort_timestamp_imputed      INTEGER,
    time_left                   REAL,
    throw_distance              REAL,
    x_diff                      REAL,
    y_diff                      REAL,
    throw_angle                 REAL,
    cp                          REAL,
    cpoe                        REAL,
    min_fv                      REAL,
    fv_thrower                  REAL,
    fv_receiver                 REAL,
    fv_opponent                 REAL,
    game_time_left              REAL,
    score_diff                  INTEGER,
    win_prob                    REAL,
    ec                          REAL,
    aec                         REAL,
    penalty_on_recording_team   INTEGER,
    defender                    TEXT,
    turnover_x                  REAL,
    turnover_y                  REAL,
    insert_timestamp            TEXT
);

CREATE TABLE IF NOT EXISTS shownspace_game_links (
    game_id         TEXT PRIMARY KEY,
    yt_highlights   TEXT,
    yt_full         TEXT,
    watchufa_full   TEXT
);

CREATE INDEX IF NOT EXISTS idx_ss_throws_game_id      ON shownspace_throws(game_id);
CREATE INDEX IF NOT EXISTS idx_ss_throws_thrower       ON shownspace_throws(thrower);
CREATE INDEX IF NOT EXISTS idx_ss_throws_receiver      ON shownspace_throws(receiver);
CREATE INDEX IF NOT EXISTS idx_ss_blocks_game_id       ON shownspace_blocks(game_id);
CREATE INDEX IF NOT EXISTS idx_ss_pulls_game_id        ON shownspace_pulls(game_id);
CREATE INDEX IF NOT EXISTS idx_ss_player_stats_game_id ON shownspace_player_stats(game_id);
CREATE INDEX IF NOT EXISTS idx_ss_team_stats_game_id   ON shownspace_team_stats(game_id);
"""


def create_schema(conn):
    for stmt in SCHEMA.strip().split(";"):
        stmt = stmt.strip()
        if stmt:
            conn.execute(stmt)
    conn.commit()


def already_scraped(conn, game_id):
    cur = conn.execute("SELECT 1 FROM shownspace_games WHERE game_id = ? LIMIT 1", (game_id,))
    return cur.fetchone() is not None


def get_game_ids(conn):
    cur = conn.execute("SELECT game_id FROM ufa_games ORDER BY game_id")
    return [row[0] for row in cur.fetchall()]


def fetch(game_id, session):
    try:
        r = session.get(f"{API_BASE}/{game_id}", timeout=20)
        if r.status_code == 404:
            log.warning(f"{game_id}: 404 skipping")
            return None
        r.raise_for_status()
        return r.json()
    except Exception as e:
        log.error(f"{game_id}: {e}")
        return None


def insert_game(conn, d, game_id):
    g = d["game"]
    conn.execute("""
        INSERT OR REPLACE INTO shownspace_games VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    """, (
        g.get("GameID"), g.get("AwayTeamID"), g.get("HomeTeamID"),
        g.get("AwayScore"), g.get("HomeScore"), g.get("Status"),
        g.get("StartTimestamp"), g.get("StartTimezone"), g.get("Week"), g.get("Year"),
        g.get("UpdateTimeStamp"), g.get("is_final"), g.get("finalized_at"),
        d.get("homeTeamColour"), d.get("awayTeamColour"),
        d.get("homeTeamAbbrev"), d.get("awayTeamAbbrev"),
        g.get("insert_timestamp"),
    ))


def insert_player_stats(conn, d):
    for p in d.get("playerStats") or []:
        conn.execute("""
            INSERT OR IGNORE INTO shownspace_player_stats (
                game_id,player_id,full_name,first_name,last_name,team_id,jersey_number,year,
                assists,goals,hockey_assists,completions,throw_attempts,throwaways,stalls,
                callahans_thrown,yards_received,yards_thrown,catches,drops,blocks,callahans,
                pulls,ob_pulls,recorded_pulls,recorded_pulls_hangtime,
                o_points_played,o_points_scored,d_points_played,d_points_scored,seconds_played,
                lag_contribution,xcp,cpoe_completions,cpoe_attempts,cpoe,throws_dropped,
                thrower_aec,receiver_aec,total_aec,offensive_possessions,
                offensive_possessions_involved,offensive_possessions_scored,
                defensive_possessions,defensive_possessions_stopped,completion_percentage,
                team_total_aec,player_impact,total_possession_aec,player_impact_possession,
                hucks_thrown,hucks_completed,hucks_dropped,hucks_caught,connections,
                huck_completion_percentage,oe,de,turnovers,insert_timestamp
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            p.get("GameID"), p.get("PlayerID"), p.get("full_name"), p.get("FirstName"), p.get("LastName"),
            p.get("TeamID"), p.get("JerseyNumber"), p.get("Year"),
            p.get("Assists"), p.get("Goals"), p.get("HockeyAssists"), p.get("Completions"),
            p.get("ThrowAttempts"), p.get("Throwaways"), p.get("Stalls"), p.get("CallahansThrown"),
            p.get("YardsReceived"), p.get("YardsThrown"), p.get("Catches"), p.get("Drops"),
            p.get("Blocks"), p.get("Callahans"), p.get("Pulls"), p.get("OBPulls"),
            p.get("RecordedPulls"), p.get("RecordedPullsHangtime"),
            p.get("OPointsPlayed"), p.get("OPointsScored"), p.get("DPointsPlayed"), p.get("DPointsScored"),
            p.get("SecondsPlayed"), p.get("lag_contribution"), p.get("xcp"),
            p.get("cpoe_completions"), p.get("cpoe_attempts"), p.get("cpoe"), p.get("throws_dropped"),
            p.get("thrower_aec"), p.get("receiver_aec"), p.get("total_aec"),
            p.get("offensive_possessions"), p.get("offensive_possessions_involved"),
            p.get("offensive_possessions_scored"), p.get("defensive_possessions"),
            p.get("defensive_possessions_stopped"), p.get("completion_percentage"),
            p.get("team_total_aec"), p.get("player_impact"), p.get("total_possession_aec"),
            p.get("player_impact_possession"), p.get("hucks_thrown"), p.get("hucks_completed"),
            p.get("hucks_dropped"), p.get("hucks_caught"), p.get("connections"),
            p.get("huck_completion_percentage"), p.get("OE"), p.get("DE"),
            p.get("turnovers"), p.get("insert_timestamp"),
        ))


def insert_team_stats(conn, d, table):
    target = "shownspace_team_stats" if table == "teamStats" else "shownspace_recent_team_stats"
    for t in d.get(table) or []:
        conn.execute(f"""
            INSERT OR IGNORE INTO {target} (
                game_id,team_id,is_home,line_type,year,total_aec,xcp,cpoe_attempts,cpoe_completions,
                cpoe,goals,assists,hockey_assists,throw_attempts,completions,completion_percentage,
                stalls,callahans_thrown,callahans_caught,yards_thrown,yards_received,hucks_attempted,
                hucks_completed,huck_completion_percentage,catches,drops,pulls,ob_pulls,roller_pulls,
                offensive_possessions,defensive_possessions,goals_allowed,redzone_offensive_possessions,
                redzone_goals,redzone_defensive_possessions,redzone_goals_allowed,time_per_possession,
                throws_per_possession,oe,de,redzone_oe,redzone_de,xoe,xde,oeoe,deoe,blocks,
                o_points,d_points,holds,clean_holds,breaks,hold_percent,clean_hold_percent,
                break_percent,opp_hucks_attempted,opp_hucks_completed,opp_huck_completion_percentage,
                throwaways,insert_timestamp
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            t.get("GameID"), t.get("TeamID"), t.get("is_home"), t.get("line_type"), t.get("Year"),
            t.get("total_aec"), t.get("xcp"), t.get("cpoe_attempts"), t.get("cpoe_completions"),
            t.get("cpoe"), t.get("goals"), t.get("assists"), t.get("hockey_assists"),
            t.get("throw_attempts"), t.get("completions"), t.get("completion_percentage"),
            t.get("stalls"), t.get("callahans_thrown"), t.get("callahans_caught"),
            t.get("yards_thrown"), t.get("yards_received"), t.get("hucks_attempted"),
            t.get("hucks_completed"), t.get("huck_completion_percentage"),
            t.get("catches"), t.get("drops"), t.get("pulls"), t.get("ob_pulls"), t.get("roller_pulls"),
            t.get("offensive_possessions"), t.get("defensive_possessions"), t.get("goals_allowed"),
            t.get("redzone_offensive_possessions"), t.get("redzone_goals"),
            t.get("redzone_defensive_possessions"), t.get("redzone_goals_allowed"),
            t.get("time_per_possession"), t.get("throws_per_possession"),
            t.get("OE"), t.get("DE"), t.get("redzone_OE"), t.get("redzone_DE"),
            t.get("xOE"), t.get("xDE"), t.get("OEOE"), t.get("DEOE"),
            t.get("blocks"), t.get("o_points"), t.get("d_points"),
            t.get("holds"), t.get("clean_holds"), t.get("breaks"),
            t.get("hold_percent"), t.get("clean_hold_percent"), t.get("break_percent"),
            t.get("opp_hucks_attempted"), t.get("opp_hucks_completed"),
            t.get("opp_huck_completion_percentage"), t.get("throwaways"), t.get("insert_timestamp"),
        ))

def insert_throws(conn, d):
    for t in d.get("throws") or []:
        conn.execute("""
            INSERT OR IGNORE INTO shownspace_throws (
                game_id,event_id,event_id_calc,global_event_seq,source_global_event_seq,
                event_sig_id,throw_sig_id,source_throw_hash,
                thrower,thrower_x,thrower_y,receiver,receiver_x,receiver_y,
                turnover,dropped_throw,stall,offensive_line,defensive_line,is_home_team,
                home_team_score,away_team_score,game_quarter,quarter_point,point_start_time,
                possession_num,possession_throw,start_on_offense,o_line,
                source_side,source_side_idx,source_timestamp,source_event_type,source_event_id,
                derived_sort_timestamp,sort_timestamp_imputed,time_left,
                throw_distance,x_diff,y_diff,throw_angle,cp,cpoe,min_fv,
                fv_thrower,fv_receiver,fv_opponent,game_time_left,score_diff,win_prob,
                ec,aec,insert_timestamp
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            t.get("GameID"), t.get("event_id"), t.get("event_id_calc"),
            t.get("global_event_seq"), t.get("source_global_event_seq"),
            t.get("event_sig_id"), t.get("throw_sig_id"), t.get("source_throw_hash"),
            t.get("Thrower"), t.get("ThrowerX"), t.get("ThrowerY"),
            t.get("Receiver"), t.get("ReceiverX"), t.get("ReceiverY"),
            t.get("turnover"), t.get("DroppedThrow"), t.get("stall"),
            t.get("offensive_line"), t.get("defensive_line"), t.get("is_home_team"),
            t.get("home_team_score"), t.get("away_team_score"),
            t.get("game_quarter"), t.get("quarter_point"), t.get("PointStartTime"),
            t.get("possession_num"), t.get("possession_throw"),
            t.get("start_on_offense"), t.get("o_line"),
            t.get("source_side"), t.get("source_side_idx"), t.get("source_timestamp"),
            t.get("source_event_type"), t.get("source_event_id"),
            t.get("derived_sort_timestamp"), t.get("sort_timestamp_imputed"),
            t.get("time_left"), t.get("throw_distance"), t.get("x_diff"), t.get("y_diff"),
            t.get("throw_angle"), t.get("cp"), t.get("cpoe"), t.get("min_fv"),
            t.get("fv_thrower"), t.get("fv_receiver"), t.get("fv_opponent"),
            t.get("game_time_left"), t.get("score_diff"), t.get("win_prob"),
            t.get("ec"), t.get("aec"), t.get("insert_timestamp"),
        ))


def insert_blocks(conn, d):
    for b in d.get("blocks") or []:
        conn.execute("""
            INSERT OR IGNORE INTO shownspace_blocks (
                game_id,event_id,event_id_calc,global_event_seq,source_global_event_seq,
                event_sig_id,throw_sig_id,throw_ref_id,source_throw_hash,
                thrower,thrower_x,thrower_y,receiver,receiver_x,receiver_y,defender,
                turnover,turnover_x,turnover_y,dropped_throw,stall,
                offensive_line,defensive_line,is_home_team,
                home_team_score,away_team_score,game_quarter,quarter_point,point_start_time,
                possession_num,possession_throw,start_on_offense,o_line,
                source_side,source_side_idx,source_timestamp,source_event_type,source_event_id,
                derived_sort_timestamp,sort_timestamp_imputed,time_left,
                throw_distance,x_diff,y_diff,throw_angle,cp,cpoe,min_fv,
                fv_thrower,fv_receiver,fv_opponent,game_time_left,score_diff,win_prob,
                ec,aec,pull_x,pull_y,pull_ms,puller,in_bounds,penalty_on_recording_team,
                insert_timestamp
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            b.get("GameID"), b.get("event_id"), b.get("event_id_calc"),
            b.get("global_event_seq"), b.get("source_global_event_seq"),
            b.get("event_sig_id"), b.get("throw_sig_id"), b.get("throw_ref_id"),
            b.get("source_throw_hash"),
            b.get("Thrower"), b.get("thrower_x"), b.get("thrower_y"),
            b.get("Receiver"), b.get("ReceiverX"), b.get("ReceiverY"), b.get("Defender"),
            b.get("turnover"), b.get("turnover_x"), b.get("turnover_y"),
            b.get("DroppedThrow"), b.get("stall"),
            b.get("offensive_line"), b.get("defensive_line"), b.get("is_home_team"),
            b.get("home_team_score"), b.get("away_team_score"),
            b.get("game_quarter"), b.get("quarter_point"), b.get("PointStartTime"),
            b.get("possession_num"), b.get("possession_throw"),
            b.get("start_on_offense"), b.get("o_line"),
            b.get("source_side"), b.get("source_side_idx"), b.get("source_timestamp"),
            b.get("source_event_type"), b.get("source_event_id"),
            b.get("derived_sort_timestamp"), b.get("sort_timestamp_imputed"),
            b.get("time_left"), b.get("throw_distance"), b.get("x_diff"), b.get("y_diff"),
            b.get("throw_angle"), b.get("cp"), b.get("cpoe"), b.get("min_fv"),
            b.get("fv_thrower"), b.get("fv_receiver"), b.get("fv_opponent"),
            b.get("game_time_left"), b.get("score_diff"), b.get("win_prob"),
            b.get("ec"), b.get("aec"),
            b.get("PullX"), b.get("PullY"), b.get("PullMs"), b.get("Puller"),
            b.get("InBounds"), b.get("penalty_on_recording_team"),
            b.get("insert_timestamp"),
        ))


def insert_pulls(conn, d):
    for p in d.get("pulls") or []:
        conn.execute("""
            INSERT OR IGNORE INTO shownspace_pulls (
                game_id,event_id,event_id_calc,global_event_seq,source_global_event_seq,
                event_sig_id,throw_sig_id,throw_ref_id,source_throw_hash,
                thrower,thrower_x,thrower_y,receiver,receiver_x,receiver_y,
                puller,pull_x,pull_y,pull_ms,in_bounds,
                turnover,dropped_throw,stall,offensive_line,defensive_line,is_home_team,
                home_team_score,away_team_score,game_quarter,quarter_point,point_start_time,
                possession_num,possession_throw,start_on_offense,o_line,
                source_side,source_side_idx,source_timestamp,source_event_type,source_event_id,
                derived_sort_timestamp,sort_timestamp_imputed,time_left,
                throw_distance,x_diff,y_diff,throw_angle,cp,cpoe,min_fv,
                fv_thrower,fv_receiver,fv_opponent,game_time_left,score_diff,win_prob,
                ec,aec,penalty_on_recording_team,defender,turnover_x,turnover_y,
                insert_timestamp
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (
            p.get("GameID"), p.get("event_id"), p.get("event_id_calc"),
            p.get("global_event_seq"), p.get("source_global_event_seq"),
            p.get("event_sig_id"), p.get("throw_sig_id"), p.get("throw_ref_id"),
            p.get("source_throw_hash"),
            p.get("Thrower"), p.get("thrower_x"), p.get("thrower_y"),
            p.get("Receiver"), p.get("ReceiverX"), p.get("ReceiverY"),
            p.get("Puller"), p.get("PullX"), p.get("PullY"), p.get("PullMs"), p.get("InBounds"),
            p.get("turnover"), p.get("DroppedThrow"), p.get("stall"),
            p.get("offensive_line"), p.get("defensive_line"), p.get("is_home_team"),
            p.get("home_team_score"), p.get("away_team_score"),
            p.get("game_quarter"), p.get("quarter_point"), p.get("PointStartTime"),
            p.get("possession_num"), p.get("possession_throw"),
            p.get("start_on_offense"), p.get("o_line"),
            p.get("source_side"), p.get("source_side_idx"), p.get("source_timestamp"),
            p.get("source_event_type"), p.get("source_event_id"),
            p.get("derived_sort_timestamp"), p.get("sort_timestamp_imputed"),
            p.get("time_left"), p.get("throw_distance"), p.get("x_diff"), p.get("y_diff"),
            p.get("throw_angle"), p.get("cp"), p.get("cpoe"), p.get("min_fv"),
            p.get("fv_thrower"), p.get("fv_receiver"), p.get("fv_opponent"),
            p.get("game_time_left"), p.get("score_diff"), p.get("win_prob"),
            p.get("ec"), p.get("aec"), p.get("penalty_on_recording_team"),
            p.get("Defender"), p.get("turnover_x"), p.get("turnover_y"),
            p.get("insert_timestamp"),
        ))


def insert_game_links(conn, d):
    gl = d.get("gameLinks")
    if not gl:
        return
    conn.execute("""
        INSERT OR REPLACE INTO shownspace_game_links VALUES (?,?,?,?)
    """, (
        gl.get("GameID"), gl.get("YT_highlights"), gl.get("YT_full"), gl.get("WatchUFA_full"),
    ))


def scrape(resume=True, game_ids=None):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    create_schema(conn)

    all_game_ids = get_game_ids(conn)
    if game_ids is not None:
        # Only process the explicitly requested IDs
        target_set = set(game_ids)
        all_game_ids = [g for g in all_game_ids if g in target_set]
        log.info(f"Targeting {len(all_game_ids)} specific game IDs")
    else:
        log.info(f"Found {len(all_game_ids)} game IDs")

    session = requests.Session()
    session.headers.update({"User-Agent": "UFA-Analytics-Scraper/1.0"})

    skipped = errors = processed = 0

    for i, game_id in enumerate(all_game_ids, 1):
        if resume and game_ids is None and already_scraped(conn, game_id):
            skipped += 1
            continue

        data = fetch(game_id, session)
        if data is None:
            errors += 1
            time.sleep(0.5)
            continue

        insert_game(conn, data, game_id)
        insert_player_stats(conn, data)
        insert_team_stats(conn, data, "teamStats")
        insert_team_stats(conn, data, "recentTeamStats")
        insert_throws(conn, data)
        insert_blocks(conn, data)
        insert_pulls(conn, data)
        insert_game_links(conn, data)
        conn.commit()

        processed += 1
        log.info(f"[{i}/{len(all_game_ids)}] {game_id}: throws={len(data.get('throws') or [])}, blocks={len(data.get('blocks') or [])}, pulls={len(data.get('pulls') or [])}")
        time.sleep(0.25)

    conn.close()
    log.info(f"Done. Processed={processed}, Skipped={skipped}, Errors={errors}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Scrape shownspace game data")
    parser.add_argument(
        "--game-ids",
        default=None,
        help="Comma-separated game_ids to (re-)scrape. Skips all others."
    )
    parser.add_argument(
        "--no-resume", action="store_true",
        help="Re-scrape all games, even already-scraped ones."
    )
    args = parser.parse_args()

    target_ids = None
    if args.game_ids:
        target_ids = [g.strip() for g in args.game_ids.split(",") if g.strip()]

    scrape(resume=not args.no_resume, game_ids=target_ids)