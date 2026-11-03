"""
Populate missing usau_team_id values on usau_nationals for College rows.

Strategy:
  1. Auto-match on school_name + gender_code (exact, case-insensitive), non-B-teams only.
  2. Apply manual name-change mappings for schools that have been renamed.

Skipped (no entry in usau_teams):
  Chabot CC, SUNY-Purchase, Earlham, Queen's, Georgia College & State
"""

from pathlib import Path
import os
import sqlite3
import argparse

DB_PATH = os.environ.get("UFA_DB_PATH") or str(Path(__file__).resolve().parents[2] / "data" / "db" / "ultimate.db")

# Manual mappings: (nationals_team_name, gender_code) -> usau_team_id
MANUAL_MAPPINGS = [
    ("SW Missouri State", "M", "usau_A_M_missouri-state"),
    ("Glassboro",         "M", "usau_A_M_rowan"),
    ("Glassboro",         "W", "usau_A_W_rowan"),
    ("Carleton College-B","W", "usau_A_W_carleton-college_c"),
]


def check_pk_conflict(cur, team_id: str, year: int) -> bool:
    cur.execute(
        "SELECT 1 FROM usau_nationals WHERE usau_team_id = ? AND year = ?",
        (team_id, year),
    )
    return cur.fetchone() is not None


def run(db_path: str, dry_run: bool = False):
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    auto_updated = 0
    auto_skipped = 0
    manual_updated = 0
    manual_skipped = 0

    # ------------------------------------------------------------------ #
    # 1. Auto-match                                                        #
    # ------------------------------------------------------------------ #
    cur.execute("""
        SELECT n.team_name, n.gender, n.year, t.usau_team_id AS new_id
        FROM usau_nationals n
        JOIN usau_teams t
          ON LOWER(n.team_name) = LOWER(t.school_name)
         AND n.gender           = t.gender_code
         AND t.level_code       = 'A'
         AND t.is_b_team        = 0
        WHERE n.competition_level = 'College'
          AND (n.usau_team_id IS NULL OR n.usau_team_id = '')
    """)
    auto_rows = cur.fetchall()

    for row in auto_rows:
        if check_pk_conflict(cur, row["new_id"], row["year"]):
            print(f"  [SKIP-CONFLICT] {row['team_name']} {row['gender']} {row['year']} -> {row['new_id']}")
            auto_skipped += 1
            continue
        if dry_run:
            print(f"  [DRY-RUN] {row['team_name']} {row['gender']} {row['year']} -> {row['new_id']}")
        else:
            cur.execute(
                """UPDATE usau_nationals
                      SET usau_team_id = ?
                    WHERE team_name = ? AND gender = ? AND year = ?
                      AND (usau_team_id IS NULL OR usau_team_id = '')""",
                (row["new_id"], row["team_name"], row["gender"], row["year"]),
            )
        auto_updated += 1

    # ------------------------------------------------------------------ #
    # 2. Manual mappings                                                   #
    # ------------------------------------------------------------------ #
    for nat_name, gender, new_id in MANUAL_MAPPINGS:
        # Find matching rows
        cur.execute(
            """SELECT year FROM usau_nationals
               WHERE team_name = ? AND gender = ?
                 AND (usau_team_id IS NULL OR usau_team_id = '')""",
            (nat_name, gender),
        )
        years = [r["year"] for r in cur.fetchall()]

        for year in years:
            if check_pk_conflict(cur, new_id, year):
                print(f"  [SKIP-CONFLICT] {nat_name} {gender} {year} -> {new_id}")
                manual_skipped += 1
                continue
            if dry_run:
                print(f"  [DRY-RUN] {nat_name} {gender} {year} -> {new_id}")
            else:
                cur.execute(
                    """UPDATE usau_nationals
                          SET usau_team_id = ?
                        WHERE team_name = ? AND gender = ? AND year = ?
                          AND (usau_team_id IS NULL OR usau_team_id = '')""",
                    (new_id, nat_name, gender, year),
                )
            manual_updated += 1

    if not dry_run:
        con.commit()

    con.close()

    print(f"\nAuto-match:  {auto_updated} updated, {auto_skipped} skipped (PK conflict)")
    print(f"Manual maps: {manual_updated} updated, {manual_skipped} skipped (PK conflict)")
    if dry_run:
        print("(dry run — no changes written)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(args.db, dry_run=args.dry_run)
