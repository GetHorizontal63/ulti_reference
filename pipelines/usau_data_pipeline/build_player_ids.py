"""
build_player_ids.py

Populates usau_player_ids from all distinct (player_name, jersey_number)
combinations in the players table.

Player name normalisation:
  - Collapse multiple spaces
  - Title-case each whitespace-delimited word  (preserves hyphens, apostrophes)
  - e.g. "TYLER BERNSTEIN" -> "Tyler Bernstein", id "TylerBernstein"
  - e.g. "Haven Dick-Neal"  -> same,              id "HavenDick-Neal"
  - e.g. "Luke  Regnier"   -> "Luke Regnier",     id "LukeRegnier"

The UNIQUE constraint on (usau_player_id, jersey_number) deduplicates across
casing variants of the same raw name wearing the same jersey number.
"""
from pathlib import Path
import os
import sqlite3

DB = os.environ.get("UFA_DB_PATH") or str(Path(__file__).resolve().parents[2] / "data" / "db" / "ultimate.db")


def make_player_id(raw_name: str) -> tuple[str, str]:
    """
    Returns (usau_player_id, canonical_name).
    canonical_name: title-cased, single-spaced.
    usau_player_id: canonical_name with spaces removed.
    """
    canonical = " ".join(part.title() for part in raw_name.split())
    pid = canonical.replace(" ", "")
    return pid, canonical


def build(conn: sqlite3.Connection) -> None:
    from pipelines.usau_data_pipeline.db import init_db
    init_db(conn)

    # Clear and rebuild
    conn.execute("DELETE FROM usau_player_ids")
    conn.commit()

    print("Reading distinct (player_name, jersey_number) from players ...")
    rows = conn.execute(
        "SELECT DISTINCT player_name, jersey_number FROM players WHERE player_name != ''"
    ).fetchall()
    print(f"  {len(rows):,} distinct (name, jersey_number) combinations")

    records: list[tuple[str, str, str | None]] = []
    seen: set[tuple[str, str | None]] = set()

    for raw_name, jersey_number in rows:
        pid, canonical = make_player_id(raw_name)
        key = (pid, jersey_number)
        if key not in seen:
            seen.add(key)
            records.append((pid, canonical, jersey_number))

    print(f"  {len(records):,} unique (usau_player_id, jersey_number) records after normalisation")

    conn.executemany(
        "INSERT OR IGNORE INTO usau_player_ids (usau_player_id, player_name, jersey_number) "
        "VALUES (?, ?, ?)",
        records,
    )
    conn.commit()

    total = conn.execute("SELECT COUNT(*) FROM usau_player_ids").fetchone()[0]
    unique_ids = conn.execute("SELECT COUNT(DISTINCT usau_player_id) FROM usau_player_ids").fetchone()[0]
    print(f"\nInserted {total:,} rows ({unique_ids:,} distinct usau_player_ids)")

    print("\nSample:")
    for r in conn.execute(
        "SELECT usau_player_id, player_name, jersey_number FROM usau_player_ids LIMIT 10"
    ):
        print(f"  {r[0]!r:35} {r[1]!r:30} #{r[2]}")


if __name__ == "__main__":
    conn = sqlite3.connect(DB)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=OFF")
    build(conn)
    conn.close()
