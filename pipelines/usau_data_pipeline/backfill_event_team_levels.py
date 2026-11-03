"""
backfill_event_team_levels.py

Backfills competition_level and gender_division on usau_event_teams rows
that currently have NULL values by deriving them from the division_label
of associated games.

SAFE: only touches rows where competition_level IS NULL.
After running this, re-run build_usau_teams.py and link_event_teams.py
to populate canonical team IDs and logo linkage.

Usage:
    python backfill_event_team_levels.py [--dry-run]
"""
import os
import re
import sys
import sqlite3
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT))
sys.path.insert(0, str(Path(__file__).parent))

DB = Path(os.environ.get("UFA_DB_PATH") or _ROOT / "data" / "db" / "ultimate.db")
DRY_RUN = "--dry-run" in sys.argv

# ---------------------------------------------------------------------------
# Derive competition_level + gender_division from division_label string.
# The division_label in the games table uses patterns like:
#   CollegeMen-Men, CollegeWomen-Women, High-School-Boys-Boys,
#   Club-Men-Men, Beach-Mens-Men, youth-club-u-20-boys-Boys, etc.
# We reuse the same derive_* functions the original pipeline uses.
# ---------------------------------------------------------------------------
from parsers.calendar import derive_competition_level, derive_gender


def _normalize_label(division_label: str) -> str:
    """Preprocess division_label slug so the derive_* regexes can match it.

    Examples of tricky inputs:
      'CollegeMen-Men'          → 'College Men'
      'CollegeWomen-Women'      → 'College Women'
      'High-School-Boys-Boys'   → 'High School Boys Boys'
      'Middle-School-Boys-Boys' → 'Middle School Boys Boys'
      'grand-masters-men-Men'   → 'grand masters men Men'   (Grand Masters)
    """
    dl = division_label or ""
    # Expand camelCase competition-group prefixes (CollegeMen → College Men)
    dl = re.sub(r"College(Men|Women|Mixed)", r"College \1", dl, flags=re.IGNORECASE)
    # Replace hyphens/underscores with spaces so multi-word phrases are matched
    dl = re.sub(r"[-_]", " ", dl)
    return dl


def level_gender_from_division_label(division_label: str) -> tuple[str | None, str | None]:
    """Extract competition_level and gender_division from a games.division_label."""
    if not division_label:
        return None, None
    normalized = _normalize_label(division_label)
    level  = derive_competition_level(normalized)
    gender = derive_gender(normalized)
    return level, gender


def main() -> None:
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=OFF")

    # Find all event_team_ids that need backfilling, together with the
    # division_label of a game that references them.
    # We pick ONE division_label per team (they should all agree within an event).
    rows = conn.execute("""
        SELECT
            et.event_team_id,
            et.team_name,
            et.event_slug,
            MAX(g.division_label) AS division_label
        FROM usau_event_teams et
        JOIN games g
          ON (g.home_event_team_id = et.event_team_id
              OR g.away_event_team_id = et.event_team_id)
        WHERE et.competition_level IS NULL
          AND g.division_label IS NOT NULL
        GROUP BY et.event_team_id
    """).fetchall()

    print(f"Found {len(rows):,} event-team rows with NULL competition_level "
          f"that appear in at least one game.")

    updates: list[tuple[str, str, str]] = []   # (level, gender, event_team_id)
    skipped = 0
    level_counts: dict[str, int] = {}

    for row in rows:
        level, gender = level_gender_from_division_label(row["division_label"])
        if not level or not gender:
            skipped += 1
            continue
        updates.append((level, gender, row["event_team_id"]))
        level_counts[level] = level_counts.get(level, 0) + 1

    print(f"  Will update : {len(updates):,}")
    print(f"  Skipped     : {skipped:,}  (could not derive level/gender)")
    print()
    print("Breakdown by competition_level:")
    for lvl, cnt in sorted(level_counts.items(), key=lambda x: -x[1]):
        print(f"  {cnt:5,}  {lvl!r}")

    if DRY_RUN:
        print("\n[DRY RUN] No changes written.")
        conn.close()
        return

    conn.executemany(
        "UPDATE usau_event_teams "
        "SET competition_level = ?, gender_division = ? "
        "WHERE event_team_id = ?",
        updates,
    )
    conn.commit()
    print(f"\nUpdated {len(updates):,} rows.")

    # Verify
    null_after = conn.execute(
        "SELECT COUNT(*) FROM usau_event_teams WHERE competition_level IS NULL"
    ).fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM usau_event_teams").fetchone()[0]
    print(f"usau_event_teams: {total - null_after:,} / {total:,} now have "
          f"competition_level ({(total - null_after) / total * 100:.1f}%)")

    conn.close()
    print("\nDone. Next steps:")
    print("  1. python build_usau_teams.py        — adds new canonical team records")
    print("  2. python link_event_teams.py         — links event teams to canonical IDs")


if __name__ == "__main__":
    main()
