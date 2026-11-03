#!/usr/bin/env python3
"""
Player identity resolution tool.
Pass 1: Auto-resolve all names silently.
Pass 2: Present only manual cases for human review.
Pass 3: Flagged items reviewed at end.
Resume-capable.
"""

from pathlib import Path
import os
import sqlite3
import json
import re

DB_PATH = os.environ.get("UFA_DB_PATH") or str(Path(__file__).resolve().parents[2] / "data" / "db" / "ultimate.db")

STAGING_DDL = """
CREATE TABLE IF NOT EXISTS player_identity_staging (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_name        TEXT NOT NULL,
    usau_team_ids         TEXT NOT NULL,
    player_name           TEXT NOT NULL,
    representative_jersey TEXT,
    representative_height TEXT,
    resolution            TEXT NOT NULL,
    notes                 TEXT,
    resolved_at           TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS player_identity_staging_map (
    players_id  INTEGER NOT NULL,
    staging_id  INTEGER NOT NULL REFERENCES player_identity_staging(id),
    PRIMARY KEY (players_id, staging_id)
);
"""

LEVEL_ORDER = {
    "Youth Club U-17": 0, "High School": 0,
    "College": 1,
    "Club": 2, "Beach": 2,
    "Masters": 3,
    "Grand Masters": 4,
    "Great Grand Masters": 5,
}

ZERO_JERSEYS = {"0", "00", "000", "", None}

def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_staging(conn):
    conn.executescript(STAGING_DDL)
    conn.commit()

def get_resolved_names(conn):
    cur = conn.execute("SELECT DISTINCT player_name FROM player_identity_staging WHERE resolution != 'flagged'")
    return {row[0] for row in cur.fetchall()}

def get_flagged(conn):
    cur = conn.execute("SELECT DISTINCT player_name FROM player_identity_staging WHERE resolution='flagged'")
    return [row[0] for row in cur.fetchall()]

def get_pending_manual(conn):
    cur = conn.execute("SELECT DISTINCT player_name FROM player_identity_staging WHERE resolution='pending_manual'")
    return [row[0] for row in cur.fetchall()]

def get_all_player_names(conn):
    cur = conn.execute("SELECT DISTINCT player_name FROM players ORDER BY player_name")
    return [row[0] for row in cur.fetchall()]

def get_candidates(conn, player_name):
    cur = conn.execute("""
        SELECT
            et.usau_team_id,
            ut.team_name,
            ut.competition_level,
            ut.city,
            ut.state,
            GROUP_CONCAT(DISTINCT p.jersey_number) AS jerseys,
            GROUP_CONCAT(DISTINCT p.height)        AS heights,
            COUNT(DISTINCT p.event_slug)            AS event_count
        FROM players p
        JOIN usau_event_teams et ON p.event_team_id = et.event_team_id
        LEFT JOIN usau_teams ut  ON et.usau_team_id  = ut.usau_team_id
        WHERE p.player_name = ?
        GROUP BY et.usau_team_id
        ORDER BY
            COALESCE(ut.competition_level, 'zzz'),
            COALESCE(ut.team_name, et.usau_team_id)
    """, (player_name,))
    return cur.fetchall()

def get_player_ids_for_team(conn, player_name, usau_team_id):
    cur = conn.execute("""
        SELECT p.id FROM players p
        JOIN usau_event_teams et ON p.event_team_id = et.event_team_id
        WHERE p.player_name = ? AND et.usau_team_id = ?
    """, (player_name, usau_team_id))
    return [row[0] for row in cur.fetchall()]

def base_team_id(tid):
    return re.sub(r'[_-](b|c|d|e|f|g|h|jv|ii|iii|iv)$', '', tid, flags=re.IGNORECASE)

def meaningful_jerseys(jerseys_str):
    if not jerseys_str:
        return set()
    return {j.strip() for j in jerseys_str.split(",")
            if j.strip() and j.strip() not in ZERO_JERSEYS}

def meaningful_heights(heights_str):
    if not heights_str:
        return set()
    return {h.strip() for h in heights_str.split(",")
            if h.strip() and h.strip() not in ("", "?", "None")}

def is_career_arc(candidates):
    levels = [LEVEL_ORDER.get(c["competition_level"], 99) for c in candidates]
    return levels == sorted(levels) and len(levels) == len(set(levels))

def auto_resolve(candidates):
    n = len(candidates)
    if n == 1:
        return ('merge_all', 'single_team')

    bases = {base_team_id(c["usau_team_id"]) for c in candidates}
    if len(bases) == 1:
        return ('merge_all', 'same_base_team')

    per_jerseys = [meaningful_jerseys(c["jerseys"]) for c in candidates]
    per_heights = [meaningful_heights(c["heights"]) for c in candidates]
    all_jerseys = set.union(*per_jerseys) if per_jerseys else set()
    all_heights = set.union(*per_heights) if per_heights else set()
    all_states  = {c["state"] for c in candidates if c["state"]}

    shared_jersey = set.intersection(*per_jerseys) if all(per_jerseys) else set()
    shared_height = set.intersection(*per_heights) if all(per_heights) else set()

    if shared_jersey and shared_height:
        return ('merge_all', 'shared_jersey_and_height')

    if is_career_arc(candidates) and shared_jersey and len(all_states) <= 1:
        return ('merge_all', 'career_arc_jersey_state')

    if shared_jersey and len(all_states) == 1:
        return ('merge_all', 'shared_jersey_same_state')

    all_diff_jerseys = len(all_jerseys) == n and not shared_jersey
    all_diff_states  = len(all_states) == n
    if all_jerseys and all_heights and all_diff_jerseys and all_diff_states:
        return ('split_all', 'distinct_jerseys_and_states')

    return ('manual', 'ambiguous')

def write_groups(conn, player_name, candidates, groups, resolution, notes=""):
    for group_idxs in groups:
        team_ids = [candidates[i]["usau_team_id"] for i in group_idxs]
        jerseys  = list(dict.fromkeys(
            j for i in group_idxs
            for j in (candidates[i]["jerseys"] or "").split(",") if j.strip()
        ))
        heights  = list(dict.fromkeys(
            h for i in group_idxs
            for h in (candidates[i]["heights"] or "").split(",") if h.strip()
        ))
        cur = conn.execute("""
            INSERT INTO player_identity_staging
                (canonical_name, usau_team_ids, player_name,
                 representative_jersey, representative_height, resolution, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            player_name, json.dumps(team_ids), player_name,
            jerseys[0] if jerseys else None,
            heights[0] if heights else None,
            resolution, notes,
        ))
        staging_id = cur.lastrowid
        for i in group_idxs:
            for pid in get_player_ids_for_team(conn, player_name, candidates[i]["usau_team_id"]):
                conn.execute("""
                    INSERT OR IGNORE INTO player_identity_staging_map (players_id, staging_id)
                    VALUES (?, ?)
                """, (pid, staging_id))
    conn.commit()

def write_pending_manual(conn, player_name):
    conn.execute("""
        INSERT OR IGNORE INTO player_identity_staging
            (canonical_name, usau_team_ids, player_name, resolution)
        VALUES (?, '[]', ?, 'pending_manual')
    """, (player_name, player_name))
    conn.commit()

def write_flag(conn, player_name):
    conn.execute("""
        INSERT OR REPLACE INTO player_identity_staging
            (canonical_name, usau_team_ids, player_name, resolution)
        VALUES (?, '[]', ?, 'flagged')
    """, (player_name, player_name))
    conn.commit()

def display_candidates(candidates):
    print()
    for i, c in enumerate(candidates):
        team  = c["team_name"] or c["usau_team_id"]
        level = c["competition_level"] or "?"
        state = c["state"] or "?"
        print(f"  [{i+1}] {team} ({level} / {state})")
        print(f"       Jersey: {c['jerseys'] or '?'}  Height: {c['heights'] or '?'}  Events: {c['event_count']}")
        print(f"       ID: {c['usau_team_id']}")
    print()

def prompt_merge(candidates):
    remaining = list(range(len(candidates)))
    groups = []
    while remaining:
        print(f"  Remaining: [{', '.join(str(i+1) for i in remaining)}]")
        print("  Enter numbers to merge (e.g. 1,2), single number for own identity,")
        print("  or: [f]lag  [d]one (rest individual)  [q]uit")
        inp = input("  > ").strip().lower()
        if inp in ("q", "quit"):  return "quit", []
        if inp in ("f", "flag"):  return "flag", []
        if inp in ("d", "done"):
            for i in remaining: groups.append([i])
            return "manual", groups
        try:
            chosen = [int(x.strip()) - 1 for x in inp.split(",")]
        except ValueError:
            print("  Invalid input.\n"); continue
        invalid = [c for c in chosen if c not in remaining]
        if invalid:
            print(f"  Not available: {[c+1 for c in invalid]}\n"); continue
        groups.append(chosen)
        for c in chosen: remaining.remove(c)
    return "manual", groups

def do_manual_review(conn, player_name, candidates, progress):
    print(f"\n{'─'*60}")
    print(f"  {progress}  {player_name}  ({len(candidates)} teams)")
    display_candidates(candidates)
    resolution, groups = prompt_merge(candidates)
    if resolution == "quit":
        return "quit"
    elif resolution == "flag":
        write_flag(conn, player_name)
        print(f"  Flagged {player_name}")
    else:
        write_groups(conn, player_name, candidates, groups, resolution='manual')
        print(f"  Saved {len(groups)} identit{'y' if len(groups)==1 else 'ies'} for {player_name}")
    return "ok"

def main():
    conn = get_conn()
    init_staging(conn)

    all_names    = get_all_player_names(conn)
    resolved     = get_resolved_names(conn)
    pending      = set(get_pending_manual(conn))
    total        = len(all_names)

    # ── PASS 1: Auto-resolution ────────────────────────────────
    todo_auto = [n for n in all_names if n not in resolved and n not in pending]

    if todo_auto:
        print(f"\n{'='*60}")
        print(f"  PASS 1: Auto-resolution")
        print(f"  {len(todo_auto)} names to process")
        print(f"{'='*60}")

        auto_merge = auto_split = manual_queued = 0

        for idx, player_name in enumerate(todo_auto):
            candidates = get_candidates(conn, player_name)
            decision, reason = auto_resolve(candidates)

            if decision == 'merge_all':
                write_groups(conn, player_name, candidates,
                             [list(range(len(candidates)))],
                             resolution='auto', notes=reason)
                auto_merge += 1
            elif decision == 'split_all':
                write_groups(conn, player_name, candidates,
                             [[i] for i in range(len(candidates))],
                             resolution='auto', notes=reason)
                auto_split += 1
            else:
                write_pending_manual(conn, player_name)
                manual_queued += 1

            if (idx + 1) % 1000 == 0 or (idx + 1) == len(todo_auto):
                print(f"  {idx+1:>7}/{len(todo_auto)}  "
                      f"merged={auto_merge}  split={auto_split}  manual_queued={manual_queued}")

        print(f"\n  Pass 1 complete.")
        print(f"  Auto-merged : {auto_merge}")
        print(f"  Auto-split  : {auto_split}")
        print(f"  Need review : {manual_queued}")

    # ── PASS 2: Manual review ──────────────────────────────────
    pending_manual = get_pending_manual(conn)

    if pending_manual:
        print(f"\n{'='*60}")
        print(f"  PASS 2: Manual review — {len(pending_manual)} names")
        print(f"  Commands: numbers to merge, [d]one, [f]lag, [q]uit")
        print(f"{'='*60}\n")

        for idx, player_name in enumerate(pending_manual):
            # Remove pending placeholder before writing real resolution
            conn.execute(
                "DELETE FROM player_identity_staging WHERE player_name=? AND resolution='pending_manual'",
                (player_name,)
            )
            conn.commit()

            candidates = get_candidates(conn, player_name)
            progress   = f"[{idx+1}/{len(pending_manual)}]"
            result = do_manual_review(conn, player_name, candidates, progress)
            if result == "quit":
                # Re-insert pending for anything not yet done
                for remaining_name in pending_manual[idx+1:]:
                    write_pending_manual(conn, remaining_name)
                # Also re-insert current one as pending since we didn't resolve it
                write_pending_manual(conn, player_name)
                print("\n  Progress saved. Run again to resume.")
                conn.close()
                return

    # ── PASS 3: Flagged review ─────────────────────────────────
    flagged = get_flagged(conn)

    if flagged:
        print(f"\n{'='*60}")
        print(f"  PASS 3: Flagged review — {len(flagged)} names")
        print(f"{'='*60}\n")

        for idx, player_name in enumerate(flagged):
            conn.execute(
                "DELETE FROM player_identity_staging WHERE player_name=? AND resolution='flagged'",
                (player_name,)
            )
            conn.commit()

            candidates = get_candidates(conn, player_name)
            progress   = f"[FLAG {idx+1}/{len(flagged)}]"
            result = do_manual_review(conn, player_name, candidates, progress)
            if result == "quit":
                for remaining_name in flagged[idx+1:]:
                    write_flag(conn, remaining_name)
                write_flag(conn, player_name)
                print("\n  Progress saved. Run again to resume.")
                conn.close()
                return

    print(f"\n{'='*60}")
    print(f"  All done.")
    print(f"{'='*60}")
    conn.close()

if __name__ == "__main__":
    main()