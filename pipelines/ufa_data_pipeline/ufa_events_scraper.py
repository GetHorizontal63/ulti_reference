"""
Scrapes UFA game events from https://www.backend.ufastats.com/api/v1/gameEvents
for all game_ids in ufa_games on or after 2019-08-10, storing results in ufa_game_events.

Schema notes:
  - One row per event per team perspective (home/away)
  - 'line' stored as JSON array (player slugs)
  - All coordinate/player fields nullable — only present for certain event types
  - event_seq: 0-based index within the home/away events array
"""

import os
import sqlite3
import requests
import json
import time
import logging
from pathlib import Path

DB_PATH = os.environ.get("UFA_DB_PATH") or str(Path(__file__).resolve().parents[2] / "data" / "db" / "ultimate.db")
API_URL = "https://www.backend.ufastats.com/api/v1/gameEvents"
MIN_DATE = "2019-08-10"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler("scrape_ufa_game_events.log"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger(__name__)

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS ufa_game_events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id          TEXT    NOT NULL,
    perspective      TEXT    NOT NULL CHECK(perspective IN ('home', 'away')),
    event_seq        INTEGER NOT NULL,  -- 0-based index within home/away array

    -- Present on all or most events
    type             INTEGER NOT NULL,
    time             INTEGER,           -- seconds into period; NULL for some event types

    -- Type 1/2/3/5/25: line substitution events
    line             TEXT,              -- JSON array of player slugs

    -- Type 7/8: pull events
    puller           TEXT,
    pull_x           REAL,
    pull_y           REAL,
    pull_ms          INTEGER,

    -- Type 18/19/20: pass/score/drop events (thrower side)
    thrower          TEXT,
    thrower_x        REAL,
    thrower_y        REAL,

    -- Type 18/19/20: pass/score/drop events (receiver side)
    receiver         TEXT,
    receiver_x       REAL,
    receiver_y       REAL,

    -- Type 22: throwaway / OB
    turnover_x       REAL,
    turnover_y       REAL,

    -- Type 11: defensive block
    defender         TEXT,

    -- Raw JSON of the full event object for anything not explicitly mapped
    raw_event        TEXT    NOT NULL,

    UNIQUE(game_id, perspective, event_seq)
);
"""

INDEX_SQLS = [
    "CREATE INDEX IF NOT EXISTS idx_ufa_game_events_game_id   ON ufa_game_events(game_id);",
    "CREATE INDEX IF NOT EXISTS idx_ufa_game_events_type       ON ufa_game_events(type);",
    "CREATE INDEX IF NOT EXISTS idx_ufa_game_events_thrower    ON ufa_game_events(thrower);",
    "CREATE INDEX IF NOT EXISTS idx_ufa_game_events_receiver   ON ufa_game_events(receiver);",
]

INSERT_SQL = """
INSERT OR IGNORE INTO ufa_game_events (
    game_id, perspective, event_seq, type, time,
    line,
    puller, pull_x, pull_y, pull_ms,
    thrower, thrower_x, thrower_y,
    receiver, receiver_x, receiver_y,
    turnover_x, turnover_y,
    defender,
    raw_event
) VALUES (
    :game_id, :perspective, :event_seq, :type, :time,
    :line,
    :puller, :pull_x, :pull_y, :pull_ms,
    :thrower, :thrower_x, :thrower_y,
    :receiver, :receiver_x, :receiver_y,
    :turnover_x, :turnover_y,
    :defender,
    :raw_event
)
"""


def flatten_event(game_id: str, perspective: str, seq: int, ev: dict) -> dict:
    line = ev.get("line")
    return {
        "game_id":      game_id,
        "perspective":  perspective,
        "event_seq":    seq,
        "type":         ev.get("type"),
        "time":         ev.get("time"),
        "line":         json.dumps(line) if line is not None else None,
        "puller":       ev.get("puller"),
        "pull_x":       ev.get("pullX"),
        "pull_y":       ev.get("pullY"),
        "pull_ms":      ev.get("pullMs"),
        "thrower":      ev.get("thrower"),
        "thrower_x":    ev.get("throwerX"),
        "thrower_y":    ev.get("throwerY"),
        "receiver":     ev.get("receiver"),
        "receiver_x":   ev.get("receiverX"),
        "receiver_y":   ev.get("receiverY"),
        "turnover_x":   ev.get("turnoverX"),
        "turnover_y":   ev.get("turnoverY"),
        "defender":     ev.get("defender"),
        "raw_event":    json.dumps(ev),
    }


def get_game_ids(conn: sqlite3.Connection) -> list[str]:
    cur = conn.execute(
        "SELECT game_id FROM ufa_games WHERE game_id >= ? ORDER BY game_id",
        (MIN_DATE,),
    )
    return [row[0] for row in cur.fetchall()]


def already_scraped(conn: sqlite3.Connection, game_id: str) -> bool:
    cur = conn.execute(
        "SELECT 1 FROM ufa_game_events WHERE game_id = ? LIMIT 1", (game_id,)
    )
    return cur.fetchone() is not None


def fetch_events(game_id: str, session: requests.Session) -> dict | None:
    try:
        r = session.get(API_URL, params={"gameID": game_id}, timeout=15)
        if r.status_code == 404:
            log.warning(f"{game_id}: 404 — skipping")
            return None
        r.raise_for_status()
        payload = r.json()
        return payload.get("data", {})
    except requests.RequestException as e:
        log.error(f"{game_id}: request failed — {e}")
        return None


def scrape(resume: bool = True):
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute(CREATE_TABLE_SQL)
    for idx_sql in INDEX_SQLS:
        conn.execute(idx_sql)
    conn.commit()

    game_ids = get_game_ids(conn)
    log.info(f"Found {len(game_ids)} game IDs >= {MIN_DATE}")

    session = requests.Session()
    session.headers.update({"User-Agent": "UFA-Analytics-Scraper/1.0"})

    inserted_total = 0
    skipped = 0
    errors = 0

    for i, game_id in enumerate(game_ids, 1):
        if resume and already_scraped(conn, game_id):
            skipped += 1
            continue

        data = fetch_events(game_id, session)
        if data is None:
            errors += 1
            time.sleep(0.5)
            continue

        rows = []
        for perspective, key in [("home", "homeEvents"), ("away", "awayEvents")]:
            for seq, ev in enumerate(data.get(key) or []):
                rows.append(flatten_event(game_id, perspective, seq, ev))

        if rows:
            conn.executemany(INSERT_SQL, rows)
            conn.commit()
            inserted_total += len(rows)

        log.info(f"[{i}/{len(game_ids)}] {game_id}: {len(rows)} events inserted")
        time.sleep(0.25)  # polite rate limiting

    conn.close()
    log.info(
        f"Done. Inserted {inserted_total} rows. "
        f"Skipped {skipped} (already scraped). Errors: {errors}."
    )


if __name__ == "__main__":
    scrape(resume=True)