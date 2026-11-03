"""
build_usau_teams.py

Reads usau_event_teams, deduplicates into a canonical usau_teams table,
assigns structured IDs, normalises state names, and flags similar club teams.

Run after migrate_rename_teams.py and after phase 4 has populated
usau_event_teams with team_name / city / state / competition_level / gender_division.

Usage:
    python build_usau_teams.py [--dry-run]
"""
from pathlib import Path
import os
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from difflib import SequenceMatcher

DB = os.environ.get("UFA_DB_PATH") or str(Path(__file__).resolve().parents[2] / "data" / "db" / "ultimate.db")
DRY_RUN = "--dry-run" in sys.argv

# ---------------------------------------------------------------------------
# State normalisation map
# All variations found in the data → full English name.
# ---------------------------------------------------------------------------
_STATE_ABBR: dict[str, str] = {
    # US states
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
    # Canadian provinces
    "AB": "Alberta", "BC": "British Columbia", "MB": "Manitoba", "NB": "New Brunswick",
    "NL": "Newfoundland", "NS": "Nova Scotia", "ON": "Ontario", "PE": "Prince Edward Island",
    "QC": "Quebec", "SK": "Saskatchewan",
}

# Additional full-name passthrough or compound remapping
_STATE_PASSTHROUGH = {s.lower() for s in _STATE_ABBR.values()}

# Patterns like "GA, Georgia" or "DC, Maryland" or "FL, Florida" → take full name part
_COMMA_ABBR_FULL = re.compile(r'^([A-Z]{2}),\s*(.+)$')
# Patterns like "Georgia, US, Georgia" → first segment
_COMMA_MULTI = re.compile(r'^([^,]+),.*$')
# Patterns like "Colorado United States, Colorado" → last segment after comma
_TRAILING_STATE = re.compile(r',\s*([A-Za-z ]+)$')
# "- CO" or "- FL" style
_DASH_ABBR = re.compile(r'^-\s*([A-Z]{2})$')
# "Colorado US" or "Alberta CA" → strip country suffix
_STATE_COUNTRY = re.compile(r'^([A-Za-z ]+?)\s+(?:US|USA|CA|MX|AU|GB|BE|DE|IT|JP|FR)$')
# Two-letter abbreviation standing alone
_LONE_ABBR = re.compile(r'^([A-Z]{2})$')


def normalise_state(raw: str | None) -> str | None:
    if not raw:
        return None
    s = raw.strip()
    if not s:
        return None

    # "GA, Georgia" or "DC, District of Columbia" → use the full-name part
    m = _COMMA_ABBR_FULL.match(s)
    if m:
        abbr, full = m.group(1), m.group(2).strip()
        if abbr in _STATE_ABBR:
            return _STATE_ABBR[abbr]
        return _lookup(full)

    # "- CO"
    m = _DASH_ABBR.match(s)
    if m:
        return _STATE_ABBR.get(m.group(1))

    # lone abbreviation
    m = _LONE_ABBR.match(s)
    if m and m.group(1) in _STATE_ABBR:
        return _STATE_ABBR[m.group(1)]

    # "Colorado United States, Colorado" etc – try after last comma
    if "," in s:
        after = s.rsplit(",", 1)[-1].strip()
        result = _lookup(after)
        if result:
            return result
        # Fallback: take first segment
        first = s.split(",")[0].strip()
        result = _lookup(first)
        if result:
            return result

    return _lookup(s)


def _lookup(s: str) -> str | None:
    """Return a canonical full state name for s, or None if unrecognised."""
    s = s.strip()
    # Strip trailing country codes like "CO", "AU", "BE" etc
    m = _STATE_COUNTRY.match(s)
    if m:
        s = m.group(1).strip()

    if s.upper() in _STATE_ABBR:
        return _STATE_ABBR[s.upper()]
    if s.lower() in _STATE_PASSTHROUGH:
        # Return the canonical capitalisation
        for canon in _STATE_ABBR.values():
            if canon.lower() == s.lower():
                return canon
    return None


# ---------------------------------------------------------------------------
# Competition-level → level code
# ---------------------------------------------------------------------------
LEVEL_CODE: dict[str, str] = {
    "Club":                "S",
    "College":             "A",
    "Youth Club U-20":     "B",
    "Youth Club U-17":     "B",
    "Youth Club U-15":     "B",
    "High School":         "C",
    "Middle School":       "D",
    "Masters":             "E",
    "Grand Masters":       "F",
    "Great Grand Masters": "G",
    "Beach":               "H",
    "Beach Masters":       "H",
    "Beach Grand Masters": "H",
    "None":                "S",   # treat unknown as club
}

GENDER_CODE: dict[str, str] = {
    "Men":    "M",
    "Boys":   "M",
    "Women":  "W",
    "Girls":  "W",
    "Mixed":  "X",
    "None":   "U",
}

# Competition levels where the school name pattern applies
SCHOOL_LEVELS = {"College", "High School", "Middle School"}

# B/JV team suffixes (after a dash in the school/team part before the paren)
_B_TEAM_RE = re.compile(r'-([B-Z])(?:\s|$|\()')


def _slug(text: str) -> str:
    """Convert a display name to a slug: lowercase, alphanumeric + hyphens."""
    s = text.lower()
    s = re.sub(r"['\u2019]", "", s)          # drop apostrophes
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = s.strip("-")
    return s


def parse_team_name(raw_name: str, competition_level: str):
    """
    Returns dict with keys:
      school_name, nickname, canonical_name, is_b_team, b_team_suffix
    """
    raw_name = raw_name.strip()

    # Extract nickname (text inside outermost parens at the end)
    nickname = None
    base = raw_name
    paren_match = re.search(r'\(([^)]+)\)\s*$', raw_name)
    if paren_match:
        nickname = paren_match.group(1).strip()
        base = raw_name[:paren_match.start()].strip()

    # Detect B/C/D team suffix
    is_b_team = False
    b_team_suffix = None
    b_match = re.search(r'-([B-D])$', base)
    if b_match:
        b_team_suffix = b_match.group(1)
        is_b_team = True
        base = base[:b_match.start()].strip()
    # Also handle cases like "Washington-B" where dash-suffix precedes paren
    elif paren_match:
        b_match2 = re.search(r'-([B-D])$', base)
        if b_match2:
            b_team_suffix = b_match2.group(1)
            is_b_team = True
            base = base[:b_match2.start()].strip()

    is_school = competition_level in SCHOOL_LEVELS

    if is_school:
        # school_name = the base (minus suffix)
        school_name = base
        # canonical_name = school name only (no suffix, no nickname)
        canonical_name = base
    else:
        school_name = None
        canonical_name = base

    return {
        "school_name":    school_name,
        "nickname":       nickname,
        "canonical_name": canonical_name,
        "is_b_team":      is_b_team,
        "b_team_suffix":  b_team_suffix,
    }


def make_team_id(level_code: str, gender_code: str, canonical_name: str, b_suffix: str | None) -> str:
    """
    Format: usau_{level_code}_{gender_code}_{slug}[_{b_suffix}]
    E.g.   usau_A_M_alabama, usau_A_M_alabama_b, usau_S_W_6ixers
    """
    slug = _slug(canonical_name)
    parts = ["usau", level_code, gender_code, slug]
    if b_suffix:
        parts.append(b_suffix.lower())
    return "_".join(parts)


# ---------------------------------------------------------------------------
# Similarity check for club teams
# ---------------------------------------------------------------------------
def similar_ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


SIMILARITY_THRESHOLD = 0.82


def find_similar_clubs(rows: list[dict]) -> dict[str, str]:
    """
    Returns mapping: usau_team_id -> usau_team_id of a similar team.
    Only applied to non-school (club / masters / youth club) teams.
    """
    club_rows = [r for r in rows if not r["school_name"]]
    mapping: dict[str, str] = {}

    for i, a in enumerate(club_rows):
        for b in club_rows[i + 1:]:
            if a["usau_team_id"] == b["usau_team_id"]:
                continue
            # Only compare same gender AND same competition level
            if a["gender_code"] != b["gender_code"]:
                continue
            if a["level_code"] != b["level_code"]:
                continue
            ratio = similar_ratio(a["team_name"], b["team_name"])
            if ratio >= SIMILARITY_THRESHOLD:
                # Mark the later one as similar to the earlier one
                if b["usau_team_id"] not in mapping:
                    mapping[b["usau_team_id"]] = a["usau_team_id"]
    return mapping


# ---------------------------------------------------------------------------
# Main build
# ---------------------------------------------------------------------------
def build(conn: sqlite3.Connection) -> None:
    # Check source table name
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    src_table = "usau_event_teams" if "usau_event_teams" in tables else "teams"
    print(f"Reading from '{src_table}' ...")

    rows_raw = conn.execute(f"""
        SELECT
            team_name,
            competition_level,
            gender_division,
            city,
            state
        FROM {src_table}
        WHERE team_name != '' AND competition_level IS NOT NULL
    """).fetchall()

    print(f"  {len(rows_raw):,} event-team rows to process")

    # Deduplicate: key = (competition_level, gender_division, canonical_name, is_b_team, b_suffix)
    seen: dict[tuple, dict] = {}

    for row in rows_raw:
        raw_name      = row[0] or ""
        comp_level    = row[1] or "None"
        gender_div    = row[2] or "None"
        city          = row[3]
        raw_state     = row[4]

        parsed = parse_team_name(raw_name, comp_level)
        canonical     = parsed["canonical_name"]
        is_b          = parsed["is_b_team"]
        b_suffix      = parsed["b_team_suffix"]

        level_code  = LEVEL_CODE.get(comp_level, "S")
        gender_code = GENDER_CODE.get(gender_div, "U")
        tid         = make_team_id(level_code, gender_code, canonical, b_suffix)
        state_norm  = normalise_state(raw_state)

        key = (tid,)
        if key not in seen:
            seen[key] = {
                "usau_team_id":      tid,
                "school_name":       parsed["school_name"],
                "team_name":         canonical,
                "_nicknames":        {parsed["nickname"]} if parsed["nickname"] else set(),
                "competition_level": comp_level,
                "level_code":        level_code,
                "gender_division":   gender_div,
                "gender_code":       gender_code,
                "is_b_team":         1 if is_b else 0,
                "b_team_suffix":     b_suffix,
                "city":              city,
                "state":             state_norm,
                "zip":               None,
                "similar_team_id":   None,
                "built_at":          datetime.now(timezone.utc).isoformat(),
            }
        else:
            # Enrich: fill in missing city/state; accumulate all nicknames
            existing = seen[key]
            if not existing["city"] and city:
                existing["city"] = city
            if not existing["state"] and state_norm:
                existing["state"] = state_norm
            if parsed["nickname"]:
                existing["_nicknames"].add(parsed["nickname"])

    # Flatten _nicknames set -> JSON array stored in nickname column
    for rec in seen.values():
        nicks = sorted(rec.pop("_nicknames"))
        rec["nickname"] = json.dumps(nicks) if nicks else None

    records = list(seen.values())
    print(f"  {len(records):,} unique usau_teams records")

    # Similarity pass (club / non-school only)
    print("  Running similarity check on non-school teams ...")
    sim_map = find_similar_clubs(records)
    for rec in records:
        if rec["usau_team_id"] in sim_map:
            rec["similar_team_id"] = sim_map[rec["usau_team_id"]]
    print(f"  {len(sim_map):,} similar-team links found")

    if DRY_RUN:
        print("\n[DRY RUN] First 10 records:")
        for r in records[:10]:
            print(" ", r)
        return

    # Write to DB — preserve manually-set columns (program_id, logo_filename)
    # that are not derived by this script.
    preserved = {
        row[0]: {"program_id": row[1], "logo_filename": row[2]}
        for row in conn.execute(
            "SELECT usau_team_id, program_id, logo_filename FROM usau_teams"
        )
    }

    conn.execute("DELETE FROM usau_teams")
    conn.executemany("""
        INSERT INTO usau_teams (
            usau_team_id, school_name, team_name, nickname,
            competition_level, level_code,
            gender_division, gender_code,
            is_b_team, b_team_suffix,
            city, state, zip,
            similar_team_id, built_at
        ) VALUES (
            :usau_team_id, :school_name, :team_name, :nickname,
            :competition_level, :level_code,
            :gender_division, :gender_code,
            :is_b_team, :b_team_suffix,
            :city, :state, :zip,
            :similar_team_id, :built_at
        )
    """, records)

    # Restore preserved columns
    restore_rows = [
        (p["program_id"], p["logo_filename"], tid)
        for tid, p in preserved.items()
        if p["program_id"] is not None or p["logo_filename"] is not None
    ]
    if restore_rows:
        conn.executemany(
            "UPDATE usau_teams SET program_id = ?, logo_filename = ? WHERE usau_team_id = ?",
            restore_rows,
        )

    conn.commit()
    print(f"  Inserted {len(records):,} rows into usau_teams.")

    # Summary
    print("\n=== Summary ===")
    for r in conn.execute("""
        SELECT level_code, competition_level, COUNT(*) n
        FROM usau_teams
        GROUP BY level_code, competition_level
        ORDER BY n DESC
    """):
        print(f"  {r[0]} {r[1]:30} {r[2]:6,}")

    print(f"\nWith city:  {conn.execute('SELECT COUNT(*) FROM usau_teams WHERE city IS NOT NULL').fetchone()[0]:,}")
    print(f"With state: {conn.execute('SELECT COUNT(*) FROM usau_teams WHERE state IS NOT NULL').fetchone()[0]:,}")
    print(f"Similar:    {conn.execute('SELECT COUNT(*) FROM usau_teams WHERE similar_team_id IS NOT NULL').fetchone()[0]:,}")


if __name__ == "__main__":
    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=OFF")
    conn.row_factory = sqlite3.Row

    # Ensure usau_teams table exists
    from pipelines.usau_data_pipeline.db import init_db
    init_db(conn)

    build(conn)
    conn.close()
