"""
link_event_teams.py

Populates usau_event_teams.usau_team_id by matching each event-team row back
to its canonical usau_teams record.

A match is accepted as 100% confirmed ONLY when:
  1. The canonical usau_team_id derived from (team_name, competition_level,
     gender_division) exists in usau_teams.
  2. If the event-team name contains a nickname (text in parens), that nickname
     must appear in the usau_teams.nickname JSON array for that canonical record.

Rows that fail either check are left NULL.
"""
from pathlib import Path
import os
import json
import re
import sqlite3

DB = os.environ.get("UFA_DB_PATH") or str(Path(__file__).resolve().parents[2] / "data" / "db" / "ultimate.db")

# --------------------------------------------------------------------------
# Reuse the same parsing/ID logic as build_usau_teams.py
# --------------------------------------------------------------------------
from pipelines.usau_data_pipeline.build_usau_teams import (
    LEVEL_CODE,
    GENDER_CODE,
    parse_team_name,
    make_team_id,
)


def add_column_if_missing(conn: sqlite3.Connection) -> None:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(usau_event_teams)")}
    if "usau_team_id" not in cols:
        conn.execute(
            "ALTER TABLE usau_event_teams ADD COLUMN usau_team_id TEXT "
            "REFERENCES usau_teams(usau_team_id)"
        )
        conn.commit()
        print("Added usau_team_id column to usau_event_teams.")
    else:
        print("usau_team_id column already present.")


def load_canonical(conn: sqlite3.Connection) -> dict[str, set[str]]:
    """
    Returns {usau_team_id: set_of_nicknames}.
    nickname column is a JSON array (or None).
    """
    out: dict[str, set[str]] = {}
    for tid, nick_json in conn.execute(
        "SELECT usau_team_id, nickname FROM usau_teams"
    ):
        nicks: set[str] = set()
        if nick_json:
            try:
                nicks = {n.lower() for n in json.loads(nick_json)}
            except (json.JSONDecodeError, TypeError):
                pass
        out[tid] = nicks
    return out


def link(conn: sqlite3.Connection) -> None:
    add_column_if_missing(conn)

    canonical = load_canonical(conn)
    print(f"Loaded {len(canonical):,} canonical team records.")

    rows = conn.execute(
        "SELECT event_team_id, team_name, competition_level, gender_division "
        "FROM usau_event_teams "
        "WHERE team_name != '' AND competition_level IS NOT NULL"
    ).fetchall()
    print(f"Processing {len(rows):,} event-team rows ...")

    matched = 0
    ambiguous = 0
    updates: list[tuple[str, str]] = []  # (usau_team_id, event_team_id)

    for event_team_id, raw_name, comp_level, gender_div in rows:
        comp_level = comp_level or "None"
        gender_div = gender_div or "None"

        parsed = parse_team_name(raw_name, comp_level)
        level_code  = LEVEL_CODE.get(comp_level, "S")
        gender_code = GENDER_CODE.get(gender_div, "U")
        tid = make_team_id(level_code, gender_code, parsed["canonical_name"], parsed["b_team_suffix"])

        # Check 1: canonical ID must exist
        if tid not in canonical:
            ambiguous += 1
            continue

        # Check 2: if event row has a nickname, it must be in the canonical set
        nick = parsed["nickname"]
        if nick and nick.lower() not in canonical[tid]:
            ambiguous += 1
            continue

        updates.append((tid, event_team_id))
        matched += 1

    print(f"  Confirmed: {matched:,}  |  Unmatched/ambiguous: {ambiguous:,}")

    # Apply in batches
    conn.executemany(
        "UPDATE usau_event_teams SET usau_team_id = ? WHERE event_team_id = ?",
        updates,
    )
    conn.commit()
    print("Done.")

    # Summary
    total   = conn.execute("SELECT COUNT(*) FROM usau_event_teams").fetchone()[0]
    linked  = conn.execute("SELECT COUNT(*) FROM usau_event_teams WHERE usau_team_id IS NOT NULL").fetchone()[0]
    print(f"\nusau_event_teams: {linked:,} / {total:,} rows now have usau_team_id ({linked/total*100:.1f}%)")


if __name__ == "__main__":
    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=OFF")
    link(conn)
    conn.close()
