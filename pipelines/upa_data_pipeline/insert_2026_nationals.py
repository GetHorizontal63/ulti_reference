"""
Insert 2026 USA Ultimate Nationals results into usau_nationals.

Sources:
  - 2026 D-III College Championships (Waukegan, IL) — Men's & Women's
"""

from pathlib import Path
import os
import sqlite3
import argparse

DB_PATH = os.environ.get("UFA_DB_PATH") or str(Path(__file__).resolve().parents[2] / "data" / "db" / "ultimate.db")

# fmt: off
DIII_WOMEN = [
    ("usau_A_W_middlebury",          "01",  0),
    ("usau_A_W_whitman",             "02",  0),
    ("usau_A_W_haverford-bryn-mawr", "T3",  0),
    ("usau_A_W_wesleyan",            "T3",  0),
    ("usau_A_W_davenport",           "T5",  0),
    ("usau_A_W_macalester",          "T5",  1),  # spirit award (Pursesnatchers)
    ("usau_A_W_carleton-college-eclipse", "T7", 0),
    ("usau_A_W_rice",                "T7",  0),
    ("usau_A_W_lewis-clark",         "09",  0),
    ("usau_A_W_st-olaf",             "10",  0),
    ("usau_A_W_santa-clara",         "11",  0),
    ("usau_A_W_mount-holyoke",       "12",  0),
    ("usau_A_W_kenyon",              "13",  0),
    ("usau_A_W_union-tennessee",     "14",  0),
    ("usau_A_W_colorado-college",    "15",  0),
    ("usau_A_W_richmond",            "16",  0),
]

DIII_MEN = [
    ("usau_A_M_middlebury",            "01",  0),
    ("usau_A_M_carleton-college-chop", "02",  0),
    ("usau_A_M_elon",                  "T3",  0),
    ("usau_A_M_oklahoma-christian",    "T3",  0),
    ("usau_A_M_claremont",             "T5",  0),
    ("usau_A_M_williams",              "T5",  0),
    ("usau_A_M_berry",                 "T7",  0),
    ("usau_A_M_st-olaf",               "T7",  0),
    ("usau_A_M_lewis-clark",           "09",  0),
    ("usau_A_M_colorado-mines",        "10",  0),
    ("usau_A_M_franciscan",            "11",  0),
    ("usau_A_M_bowdoin",               "12",  0),
    ("usau_A_M_macalester",            "13",  0),
    ("usau_A_M_hillsdale",             "14",  0),
    ("usau_A_M_whitman",               "15",  0),
    ("usau_A_M_rochester",             "16",  0),
]

DATASETS = [
    (DIII_WOMEN, "College", "3", "W"),
    (DIII_MEN,   "College", "3", "M"),
]
# fmt: on

YEAR = 2026


def run(db_path: str, dry_run: bool = False):
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    inserted = 0
    skipped = 0
    missing_ids = []

    for teams, comp_level, division, gender in DATASETS:
        for team_id, finish, spirit in teams:
            cur.execute(
                "SELECT school_name, city, state, team_name FROM usau_teams WHERE usau_team_id = ?",
                (team_id,),
            )
            row = cur.fetchone()
            if row is None:
                missing_ids.append(team_id)
                print(f"  [MISSING] {team_id}")
                skipped += 1
                continue

            if dry_run:
                print(f"  [DRY-RUN] {row['team_name']} | {comp_level} div={division} {gender} | {finish} | spirit={spirit}")
            else:
                cur.execute(
                    """INSERT OR IGNORE INTO usau_nationals
                       (usau_team_id, school_name, team_name, competition_level,
                        division, gender, city, state, year, finish, spirit_award)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (team_id, row["school_name"], row["team_name"], comp_level,
                     division, gender, row["city"], row["state"], YEAR, finish, spirit),
                )
                if cur.rowcount == 0:
                    print(f"  [DUPLICATE] {row['team_name']} {gender} {YEAR} already exists — skipped")
                    skipped += 1
                    continue
            inserted += 1

    if not dry_run:
        con.commit()

    con.close()
    print(f"\nInserted: {inserted}  |  Skipped/missing: {skipped}")
    if missing_ids:
        print(f"Missing team IDs: {missing_ids}")
    if dry_run:
        print("(dry run — no changes written)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DB_PATH)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(args.db, dry_run=args.dry_run)
