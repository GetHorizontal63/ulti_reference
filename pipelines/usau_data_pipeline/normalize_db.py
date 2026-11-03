"""
One-shot normalization pass: update competition_level, gender, division_label
for all rows in the events table using the centralized derive_* functions.
"""
import os
import sqlite3
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
from parsers.calendar import derive_competition_level, derive_gender

DB_PATH = Path(os.environ.get("UFA_DB_PATH") or Path(__file__).parent.parent.parent / "data" / "db" / "ultimate.db")

conn = sqlite3.connect(DB_PATH)
rows = conn.execute("SELECT rowid, competition_group FROM events").fetchall()

updates = []
for rowid, cg in rows:
    level  = derive_competition_level(cg or "")
    gender = derive_gender(cg or "")
    div_label = f"{level}-{gender}" if level and gender else None
    updates.append((level, gender, div_label, rowid))

conn.executemany(
    "UPDATE events SET competition_level=?, gender=?, division_label=? WHERE rowid=?",
    updates,
)
conn.commit()
print(f"Updated {len(updates)} rows")

# Summary
print("\n--- competition_level breakdown ---")
for row in conn.execute(
    "SELECT competition_level, COUNT(*) n FROM events GROUP BY competition_level ORDER BY n DESC"
).fetchall():
    print(f"  {row[1]:5d}  {row[0]!r}")

print("\n--- gender breakdown ---")
for row in conn.execute(
    "SELECT gender, COUNT(*) n FROM events GROUP BY gender ORDER BY n DESC"
).fetchall():
    print(f"  {row[1]:5d}  {row[0]!r}")

null_level = conn.execute(
    "SELECT competition_group, COUNT(*) n FROM events "
    "WHERE competition_level IS NULL AND competition_group != '' "
    "GROUP BY competition_group ORDER BY n DESC"
).fetchall()
print(f"\n--- {len(null_level)} groups with NULL competition_level ---")
for cg, n in null_level:
    print(f"  {n:4d}  {cg!r}")
