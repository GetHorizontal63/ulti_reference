"""
Insert 2025 USA Ultimate Nationals results into usau_nationals.

Sources:
  - 2025 D-I College Championships (Burlington, WA) — Men's & Women's
  - 2025 D-III College Championships (Burlington, WA) — Men's & Women's
  - 2025 Club Nationals (San Diego, CA) — Men's, Women's, Mixed
"""

from pathlib import Path
import os
import sqlite3
import argparse

DB_PATH = os.environ.get("UFA_DB_PATH") or str(Path(__file__).resolve().parents[2] / "data" / "db" / "ultimate.db")

# fmt: off
# Each entry: (usau_team_id, finish, spirit_award)
# finish follows existing DB convention: zero-padded singles ("01"), prefix-T ties ("T3")

DI_MEN = [
    ("usau_A_M_carleton-college",       "01",  0),
    ("usau_A_M_colorado",               "02",  0),
    ("usau_A_M_massachusetts",          "T3",  0),
    ("usau_A_M_oregon",                 "T3",  0),
    ("usau_A_M_cal-poly-slo",           "T5",  0),
    ("usau_A_M_north-carolina",         "T5",  0),
    ("usau_A_M_penn-state",             "T5",  0),
    ("usau_A_M_western-washington",     "T5",  0),
    ("usau_A_M_michigan",               "T9",  0),
    ("usau_A_M_northeastern",           "T9",  0),
    ("usau_A_M_utah",                   "T9",  0),
    ("usau_A_M_vermont",                "T9",  0),
    ("usau_A_M_california",             "T13", 0),
    ("usau_A_M_texas",                  "T13", 0),
    ("usau_A_M_georgia",                "T15", 0),
    ("usau_A_M_washington-university",  "T15", 1),  # spirit award
    ("usau_A_M_british-columbia",       "T17", 0),
    ("usau_A_M_ottawa",                 "T17", 0),
    ("usau_A_M_california-santa-cruz",  "T19", 0),
    ("usau_A_M_oregon-state",           "T19", 0),
]

DI_WOMEN = [
    ("usau_A_W_british-columbia",          "01",  0),
    ("usau_A_W_carleton-college",          "02",  0),
    ("usau_A_W_vermont",                   "T3",  0),
    ("usau_A_W_washington",                "T3",  0),
    ("usau_A_W_colorado",                  "T5",  0),
    ("usau_A_W_oregon",                    "T5",  0),
    ("usau_A_W_stanford",                  "T5",  0),
    ("usau_A_W_tufts",                     "T5",  0),
    ("usau_A_W_cal-poly-slo",              "T9",  0),
    ("usau_A_W_california-san-diego",      "T9",  0),
    ("usau_A_W_california-santa-barbara",  "T9",  0),
    ("usau_A_W_michigan",                  "T9",  0),
    ("usau_A_W_california-santa-cruz",     "T13", 0),
    ("usau_A_W_north-carolina",            "T13", 0),
    ("usau_A_W_utah",                      "T15", 0),
    ("usau_A_W_victoria",                  "T15", 1),  # spirit award
    ("usau_A_W_california-davis",          "T17", 0),
    ("usau_A_W_pennsylvania",              "T17", 0),
    ("usau_A_W_cornell",                   "T19", 0),
    ("usau_A_W_georgia",                   "T19", 0),
]

DIII_MEN = [
    ("usau_A_M_lewis-clark",           "01",  0),
    ("usau_A_M_middlebury",            "02",  0),
    ("usau_A_M_carleton-college-chop", "T3",  1),  # spirit award
    ("usau_A_M_davenport",             "T3",  0),
    ("usau_A_M_elon",                  "T5",  0),
    ("usau_A_M_rochester",             "T5",  0),
    ("usau_A_M_bowdoin",               "T7",  0),
    ("usau_A_M_whitman",               "T7",  0),
    ("usau_A_M_wesleyan",              "09",  0),
    ("usau_A_M_oklahoma-christian",    "10",  0),
    ("usau_A_M_missouri-s-t",          "11",  0),
    ("usau_A_M_claremont",             "12",  0),
    ("usau_A_M_hillsdale",             "13",  0),
    ("usau_A_M_franciscan",            "14",  0),
    ("usau_A_M_berry",                 "15",  0),
    ("usau_A_M_richmond",              "16",  0),
]

DIII_WOMEN = [
    ("usau_A_W_wesleyan",                "01",  0),
    ("usau_A_W_haverford-bryn-mawr",     "02",  0),
    ("usau_A_W_lewis-clark",             "T3",  0),
    ("usau_A_W_middlebury",              "T3",  0),
    ("usau_A_W_davenport",               "T5",  0),
    ("usau_A_W_whitman",                 "T5",  0),
    ("usau_A_W_mount-holyoke",           "T7",  0),
    ("usau_A_W_st-olaf",                 "T7",  0),
    ("usau_A_W_rochester",               "09",  0),
    ("usau_A_W_kenyon",                  "10",  0),
    ("usau_A_W_carleton-college-eclipse","11",  0),
    ("usau_A_W_union-tennessee",         "12",  0),
    ("usau_A_W_richmond",                "13",  0),  # source typo "Rimchmond"
    ("usau_A_W_rice",                    "14",  0),
    ("usau_A_W_puget-sound",             "15",  0),
    ("usau_A_W_claremont",               "16",  1),  # spirit award
]

CLUB_WOMEN = [
    ("usau_S_W_brute-squad",   "01",  0),
    ("usau_S_W_fury",          "02",  0),
    ("usau_S_W_scandal",       "03",  0),
    ("usau_S_W_molly-brown",   "04",  0),
    ("usau_S_W_bent",          "05",  0),
    ("usau_S_W_seattle-riot",  "06",  0),
    ("usau_S_W_schwa",         "T7",  0),
    ("usau_S_W_phoenix",       "T7",  0),
    ("usau_S_W_6ixers",        "T9",  0),
    ("usau_S_W_parcha",        "T9",  0),
    ("usau_S_W_flipside",      "11",  0),
    ("usau_S_W_traffic",       "12",  0),
    ("usau_S_W_grit",          "13",  0),
    ("usau_S_W_iris",          "14",  0),
    ("usau_S_W_nightlock",     "15",  0),
    ("usau_S_W_heist",         "16",  0),
]

CLUB_MIXED = [
    ("usau_S_X_hybrid",            "01",  0),
    ("usau_S_X_xist",              "02",  0),
    ("usau_S_X_shame",             "03",  0),
    ("usau_S_X_dragn-thrust",      "04",  0),
    ("usau_S_X_slow",              "05",  0),
    ("usau_S_X_lawless",           "06",  0),
    ("usau_S_X_austin-disco-club", "T7",  0),
    ("usau_S_X_sprocket",          "T7",  0),
    ("usau_S_X_toro",              "T9",  0),
    ("usau_S_X_rally",             "T9",  0),
    ("usau_S_X_seattle-mixtape",   "11",  0),
    ("usau_S_X_space-force",       "12",  0),
    ("usau_S_X_tower",             "13",  0),
    ("usau_S_X_conspiracy",        "14",  0),
    ("usau_S_X_amp",               "15",  0),
    ("usau_S_X_mile-high-trash",   "16",  0),
]

CLUB_MEN = [
    ("usau_S_M_revolver",              "01",  0),
    ("usau_S_M_chicago-machine",       "02",  0),
    ("usau_S_M_pony",                  "03",  0),
    ("usau_S_M_rhino-slam",            "04",  0),
    ("usau_S_M_truck-stop",            "05",  0),
    ("usau_S_M_sockeye",               "06",  0),
    ("usau_S_M_dig",                   "T7",  0),
    ("usau_S_M_ring-of-fire",          "T7",  0),
    ("usau_S_M_johnny-bravo",          "T9",  0),
    ("usau_S_M_philadelphia-pacmen",   "T9",  0),
    ("usau_S_M_goat",                  "11",  0),
    ("usau_S_M_sub-zero",              "12",  0),
    ("usau_S_M_raleigh-durham-united", "13",  0),
    ("usau_S_M_socal-condors",         "14",  0),
    ("usau_S_M_chain-lightning",       "15",  0),
    ("usau_S_M_red-tide",              "16",  0),
]

DATASETS = [
    (DI_MEN,     "College", "1", "M"),
    (DI_WOMEN,   "College", "1", "W"),
    (DIII_MEN,   "College", "3", "M"),
    (DIII_WOMEN, "College", "3", "W"),
    (CLUB_WOMEN, "Club",    None, "W"),
    (CLUB_MIXED, "Club",    None, "X"),
    (CLUB_MEN,   "Club",    None, "M"),
]
# fmt: on

YEAR = 2025


def run(db_path: str, dry_run: bool = False):
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    inserted = 0
    skipped = 0
    missing_ids = []

    for teams, comp_level, division, gender in DATASETS:
        for team_id, finish, spirit in teams:
            # Look up school_name, city, state from usau_teams
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

            school_name = row["school_name"]
            city        = row["city"]
            state       = row["state"]
            team_name   = row["team_name"]

            if dry_run:
                print(f"  [DRY-RUN] {team_name} | {comp_level} div={division} {gender} | {finish} | spirit={spirit}")
            else:
                cur.execute(
                    """INSERT OR IGNORE INTO usau_nationals
                       (usau_team_id, school_name, team_name, competition_level,
                        division, gender, city, state, year, finish, spirit_award)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                    (team_id, school_name, team_name, comp_level,
                     division, gender, city, state, YEAR, finish, spirit),
                )
                if cur.rowcount == 0:
                    print(f"  [DUPLICATE] {team_name} {gender} {YEAR} already exists — skipped")
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
