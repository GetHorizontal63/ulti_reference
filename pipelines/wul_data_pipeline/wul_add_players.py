"""
wul_add_players.py — Add WUL players to master_players.

Actions:
  1. Collect distinct player names from all WUL player CSVs.
  2. Exact-name match against master_players → update WUL_ID on matches.
  3. For unmatched, do a fuzzy check (same last name + same first initial) to
     flag potential duplicates before inserting.
  4. Insert genuinely new players.

WUL_ID format: kebab-case slug, e.g. "abby-hecko".
Run with --dry-run to preview without writing.
"""
from __future__ import annotations

import os
import argparse
import csv
import re
import sqlite3
from pathlib import Path

DB  = Path(os.environ.get("UFA_DB_PATH") or Path(__file__).resolve().parents[2] / "data" / "db" / "ultimate.db")
RAW = Path(__file__).resolve().parents[2] / "data" / "raw" / "wul"


# WUL names that are confirmed aliases of an existing master_players row.
# Maps WUL display name → existing master ID.
# These rows get WUL_ID set on the existing record; no new row is inserted.
KNOWN_ALIASES: dict[str, str] = {
    "Penny Wu":      "00004567",   # = Penelope Wu
    "Rache Johnston": "00004201",  # = Rachel Johnston (typo in WUL data)
}


def to_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def split_name(name: str) -> tuple[str, str]:
    parts = name.strip().split(" ", 1)
    return (parts[0], parts[1]) if len(parts) == 2 else (parts[0], "")


def collect_wul_players() -> list[str]:
    """Return sorted list of unique player names from WUL CSVs."""
    names: set[str] = set()
    for f in RAW.glob("*_player_standard_game.csv"):
        with open(f, encoding="utf-8-sig") as fh:
            for row in csv.DictReader(fh):
                raw = row.get("Player", "").strip()
                if not raw:
                    continue
                parts = raw.split(" ", 1)
                # Strip leading jersey number (all-digit token)
                if len(parts) == 2 and parts[0].isdigit():
                    names.add(parts[1].strip())
                else:
                    names.add(raw)
    return sorted(names)


def main(dry_run: bool) -> None:
    conn = sqlite3.connect(DB)

    wul_names = collect_wul_players()
    print(f"Unique WUL player names: {len(wul_names)}")

    # Load existing master_players
    existing_rows = conn.execute(
        "SELECT ID, Name, FirstName, LastName, WUL_ID FROM master_players"
    ).fetchall()

    exact_map: dict[str, tuple] = {r[1].lower(): r for r in existing_rows}
    max_id = int(conn.execute("SELECT MAX(ID) FROM master_players").fetchone()[0])

    # Build fuzzy index: (first_initial, last_name) → list of rows
    fuzzy_map: dict[tuple[str, str], list[tuple]] = {}
    for row in existing_rows:
        name = row[1]
        fn, ln = split_name(name)
        key = (fn[0].lower() if fn else "", ln.lower())
        fuzzy_map.setdefault(key, []).append(row)

    exact_updates: list[tuple[str, str]] = []   # (wul_id, master_id)
    alias_updates: list[tuple[str, str, str]] = []  # (wul_name, wul_id, master_id)
    new_inserts:   list[dict] = []
    flagged:       list[tuple[str, str, list]] = []  # (wul_name, wul_id, fuzzy_matches)

    next_id = max_id + 1

    for name in wul_names:
        wul_id = to_slug(name)
        key = name.lower()

        # Confirmed alias → update existing row, skip insert
        if name in KNOWN_ALIASES:
            alias_updates.append((name, wul_id, KNOWN_ALIASES[name]))
            continue

        if key in exact_map:
            row = exact_map[key]
            exact_updates.append((wul_id, row[0]))
        else:
            fn, ln = split_name(name)
            fkey = (fn[0].lower() if fn else "", ln.lower())
            fuzzy_hits = [r for r in fuzzy_map.get(fkey, []) if r[1].lower() != key]
            if fuzzy_hits:
                flagged.append((name, wul_id, fuzzy_hits))
            new_inserts.append({
                "id":       f"{next_id:08d}",
                "name":     name,
                "first":    fn,
                "last":     ln,
                "wul_id":   wul_id,
            })
            next_id += 1

    # ── Report ────────────────────────────────────────────────────────────────

    print(f"\n{'='*70}")
    print(f"CONFIRMED ALIASES -> WUL_ID set on existing row, no insert ({len(alias_updates)})")
    print(f"{'='*70}")
    for wul_name, wul_id, master_id in alias_updates:
        row = next(r for r in existing_rows if r[0] == master_id)
        print(f"  WUL: {wul_name:35s}  ->  master: {row[1]:35s}  ID={master_id}  wul_id={wul_id}")

    print(f"\n{'='*70}")
    print(f"EXACT MATCHES already in master_players -> WUL_ID will be set ({len(exact_updates)})")
    print(f"{'='*70}")
    for wul_id, master_id in exact_updates:
        row = next(r for r in existing_rows if r[0] == master_id)
        print(f"  {row[1]:40s}  ID={master_id}  wul_id={wul_id}")

    print(f"\n{'='*70}")
    print(f"FLAGGED — possible duplicates of existing players ({len(flagged)})")
    print(f"{'='*70}")
    if flagged:
        for wul_name, wul_id, hits in flagged:
            for h in hits:
                print(f"  WUL: {wul_name:35s}  <-> master: {h[1]:35s}  (ID={h[0]})")
    else:
        print("  None found.")

    print(f"\n{'='*70}")
    print(f"NEW players to insert ({len(new_inserts)})")
    print(f"{'='*70}")
    for p in new_inserts:
        flag = "  *** FLAGGED ***" if any(p["name"] == f[0] for f in flagged) else ""
        print(f"  {p['id']}  {p['name']:40s}  wul_id={p['wul_id']}{flag}")

    print(f"\nSummary: {len(alias_updates)} alias updates, {len(exact_updates)} exact updates, "
          f"{len(new_inserts)} inserts, {len(flagged)} flagged for review")

    if dry_run:
        print("\n[DRY RUN — no changes written]")
        return

    # ── Write ─────────────────────────────────────────────────────────────────

    # Update WUL_ID on confirmed alias rows
    conn.executemany(
        "UPDATE master_players SET WUL_ID = ? WHERE ID = ?",
        [(wul_id, master_id) for _, wul_id, master_id in alias_updates],
    )

    # Update WUL_ID on exact-match rows
    conn.executemany(
        "UPDATE master_players SET WUL_ID = ? WHERE ID = ?",
        exact_updates,
    )

    # Insert new rows
    conn.executemany(
        """INSERT INTO master_players (ID, Name, FirstName, LastName, WUL_ID)
           VALUES (:id, :name, :first, :last, :wul_id)""",
        new_inserts,
    )

    conn.commit()
    print(f"\nDone. {len(alias_updates)} alias updates, {len(exact_updates)} exact updates, "
          f"{len(new_inserts)} rows inserted.")
    print(f"Review the {len(flagged)} flagged entries above — they may be duplicates.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    main(args.dry_run)
