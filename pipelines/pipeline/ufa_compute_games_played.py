"""
Compute games_played per player per year from raw UFA API game files.
Reads all JSON files in data/raw/ufa_api/, counts distinct game IDs each
player slug appeared on a roster for, then updates ufa_player_season_stats.
"""
import os
import json
import sqlite3
from collections import defaultdict
from pathlib import Path

ROOT     = Path(__file__).resolve().parent.parent.parent
RAW_DIR  = ROOT / "data" / "raw" / "ufa_api"
DB_PATH  = Path(os.environ.get("UFA_DB_PATH") or ROOT / "data" / "db" / "ultimate.db")


def build_name_to_slug() -> dict[str, str]:
    """Build 'First Last' → player_slug lookup from ufa_players."""
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT player_slug, display_name FROM ufa_players").fetchall()
    conn.close()
    return {display_name.strip().lower(): slug for slug, display_name in rows if display_name}


def build_game_counts() -> dict[tuple[str, int], int]:
    """Returns {(player_slug, year): games_played}"""
    counts: dict[tuple[str, int], set] = defaultdict(set)
    name_to_slug = build_name_to_slug()

    files = sorted(RAW_DIR.glob("*.json"))
    print(f"Processing {len(files)} game files…")

    for path in files:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  SKIP {path.name}: {e}")
            continue

        game = data.get("game", {})
        game_id = game.get("id")
        ts = game.get("start_timestamp", "")
        if not game_id or not ts:
            continue

        try:
            year = int(ts[:4])
        except (ValueError, TypeError):
            continue

        slugs: set[str] = set()
        for side in ("rostersHome", "rostersAway"):
            for entry in data.get(side, []):
                player = entry.get("player") or {}
                slug = player.get("ext_player_id")
                if not slug:
                    # Fall back to name matching (e.g. 2025+ files)
                    first = (player.get("first_name") or "").strip()
                    last  = (player.get("last_name")  or "").strip()
                    if first and last:
                        slug = name_to_slug.get(f"{first} {last}".lower())
                if slug:
                    slugs.add(slug)

        for slug in slugs:
            counts[(slug, year)].add(game_id)

    return {key: len(game_ids) for key, game_ids in counts.items()}


COVERAGE_THRESHOLD = 0.90  # skip any year where we can't cover >=90% of season rows


def update_db(counts: dict[tuple[str, int], int]) -> None:
    conn = sqlite3.connect(DB_PATH)

    # Total season rows per year (ground truth)
    totals: dict[int, int] = {
        row[0]: row[1]
        for row in conn.execute(
            "SELECT year, COUNT(*) FROM ufa_player_season_stats GROUP BY year"
        ).fetchall()
    }

    # Count how many rows our computed counts would touch per year
    from collections import Counter
    hits_per_year: Counter = Counter()
    for (slug, year) in counts:
        hits_per_year[year] += 1

    good_years:    set[int] = set()
    partial_years: set[int] = set()
    for year, total in totals.items():
        hits = hits_per_year.get(year, 0)
        coverage = hits / total if total else 0
        if coverage >= COVERAGE_THRESHOLD:
            good_years.add(year)
            print(f"  {year}: {hits}/{total} ({coverage:.0%}) → INCLUDE (roster files)")
        elif coverage > 0:
            partial_years.add(year)
            print(f"  {year}: {hits}/{total} ({coverage:.0%}) → SKIP (partial — null out)")
        else:
            print(f"  {year}: {hits}/{total} ({coverage:.0%}) → LEAVE (no roster files; keep scraped values)")

    # Null out only partial years (we have some files but not enough to be accurate)
    for year in partial_years:
        conn.execute(
            "UPDATE ufa_player_season_stats SET games_played = NULL WHERE year = ?",
            (year,),
        )

    # Write good years
    updated = 0
    for (slug, year), gp in counts.items():
        if year not in good_years:
            continue
        cur = conn.execute(
            "UPDATE ufa_player_season_stats SET games_played = ? "
            "WHERE player_id = ? AND year = ?",
            (gp, slug, year),
        )
        updated += cur.rowcount

    conn.commit()
    conn.close()
    print(f"Updated {updated} rows across {len(good_years)} complete years. "
          f"Nulled out {len(partial_years)} partial years: {sorted(partial_years)}")


if __name__ == "__main__":
    counts = build_game_counts()
    print(f"Found game counts for {len(counts)} (player, year) pairs.")
    update_db(counts)
    print("Done.")
