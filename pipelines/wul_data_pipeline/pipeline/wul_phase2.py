"""
WUL Phase 2 — Parse downloaded CSVs and upsert into SQLite.

For each CSV in data/raw/wul/:
  1. Determine the target table from the filename (data_type)
  2. Normalize CSV column headers to DB-safe snake_case names
  3. Create the table if it doesn't exist, or add any new columns (idempotent)
  4. Upsert all rows using the appropriate composite unique key

Table → key columns mapping
  wul_player_game_stats      : season, date, team, player, opponent
  wul_player_game_adv_stats  : season, date, team, player, opponent
  wul_team_game_stats        : season, date, team, opponent
  wul_team_game_adv_stats    : season, date, team, opponent
"""
from __future__ import annotations

import csv
import logging
import re
import sys
from pathlib import Path
from typing import Any

_ROOT = Path(__file__).resolve().parent.parent.parent
_USAU = _ROOT / "usau_data_pipeline"
sys.path.insert(0, str(_USAU))
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import now_iso, log_wul, is_wul_item_imported  # noqa: E402

logger = logging.getLogger(__name__)

# Maps data_type → (table_name, key_cols)
# Standard and Advanced for the same entity share one table; the second import
# adds columns via ALTER TABLE and merges data via ON CONFLICT upsert.
_TABLE_CONFIG: dict[str, tuple[str, list[str]]] = {
    "player_standard_game": ("wul_player_game_stats", ["season", "date", "team", "player", "opponent"]),
    "player_advanced_game": ("wul_player_game_stats", ["season", "date", "team", "player", "opponent"]),
    "team_standard_game":   ("wul_team_game_stats",   ["season", "date", "team", "opponent"]),
    "team_advanced_game":   ("wul_team_game_stats",   ["season", "date", "team", "opponent"]),
}

# CSV columns that are text identifiers (stored as TEXT, used as unique keys)
_TEXT_COLS = {"team", "player", "opponent", "date", "season", "jersey_number"}


def run_wul_phase2(
    conn,
    raw_dir: Path,
    force: bool = False,
    years: list[str] | None = None,
    data_types: list[str] | None = None,
) -> None:
    """Parse downloaded WUL CSVs and upsert into the database."""
    from pipelines.wul_data_pipeline.pipeline.wul_phase1 import WUL_YEARS, WUL_DATA_TYPES  # local import to avoid circular

    target_years = years if years is not None else WUL_YEARS
    target_types = data_types if data_types is not None else WUL_DATA_TYPES

    logger.info("WUL Phase 2: importing CSVs into DB")

    for year in target_years:
        for dt in target_types:
            csv_path = raw_dir / f"{year}_{dt}.csv"

            if not csv_path.exists():
                logger.debug("  No CSV for %s %s — skipping", year, dt)
                continue

            if not force and is_wul_item_imported(conn, year, dt):
                logger.info("  Already imported %s %s — skipping", year, dt)
                continue

            try:
                row_count = _import_csv(conn, csv_path, dt)
                log_wul(conn, year, dt, "imported", f"{row_count} rows")
                logger.info("  %s %s → %d rows imported", year, dt, row_count)
            except Exception as exc:
                logger.error("  Failed to import %s %s: %s", year, dt, exc)
                log_wul(conn, year, dt, "import_error", str(exc))

    logger.info("WUL Phase 2 complete")


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _normalize_col(col: str) -> str:
    """Convert a CSV column header to a DB-safe snake_case name.

    Examples:
      "PP%"    → "pp_pct"
      "+/-"    → "plus_minus"
      "Com+"   → "com_plus"
      "Rec+"   → "rec_plus"
      "xCom%"  → "xcom_pct"
      "ThY"    → "thy"
      "Player" → "player"
      ""       → ""  (unnamed index column — caller must skip)
    """
    col = col.strip()
    if not col:
        return ""
    col = col.replace("+/-", "plus_minus")
    col = col.replace("%", "_pct")
    col = col.replace("+", "_plus")   # Com+ → com_plus, Rec+ → rec_plus
    col = re.sub(r"[^a-zA-Z0-9_]", "_", col)
    col = re.sub(r"_+", "_", col)
    col = col.strip("_").lower()
    return col


def _col_type(norm_col: str) -> str:
    """Return the SQLite column type for a normalized column name."""
    return "TEXT" if norm_col in _TEXT_COLS else "REAL"


def _ensure_table(conn, table_name: str, key_cols: list[str], all_norm_cols: list[str]) -> None:
    """Create the table if it doesn't exist; add missing columns if it does."""
    existing_cols = {
        r[1] for r in conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    }

    if not existing_cols:
        # Build CREATE TABLE with all columns from the CSV
        col_defs = ",\n            ".join(
            f'"{c}" {_col_type(c)}' for c in all_norm_cols
        )
        pk = ", ".join(f'"{c}"' for c in key_cols)
        conn.execute(f"""
            CREATE TABLE IF NOT EXISTS {table_name} (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                {col_defs},
                scraped_at  TEXT,
                UNIQUE({pk})
            )
        """)
    else:
        # Add any columns that appeared in this CSV but aren't in the table yet
        for c in all_norm_cols:
            if c not in existing_cols:
                col_type = _col_type(c)
                conn.execute(f'ALTER TABLE {table_name} ADD COLUMN "{c}" {col_type}')

    conn.commit()


def _upsert_rows(
    conn,
    table_name: str,
    key_cols: list[str],
    rows: list[dict[str, Any]],
    scraped_at: str,
) -> int:
    """Bulk upsert rows into the target table. Returns count of rows processed."""
    if not rows:
        return 0

    all_cols = list(rows[0].keys()) + ["scraped_at"]
    col_names = ", ".join(f'"{c}"' for c in all_cols)
    placeholders = ", ".join("?" for _ in all_cols)
    update_set = ", ".join(
        f'"{c}" = excluded."{c}"'
        for c in all_cols
        if c not in key_cols and c != "id"
    )
    conflict_cols = ", ".join(f'"{c}"' for c in key_cols)

    sql = f"""
        INSERT INTO {table_name} ({col_names})
        VALUES ({placeholders})
        ON CONFLICT({conflict_cols}) DO UPDATE SET {update_set}
    """

    values = [[row.get(c) for c in all_cols[:-1]] + [scraped_at] for row in rows]
    conn.executemany(sql, values)
    conn.commit()
    return len(rows)


def _import_csv(conn, csv_path: Path, data_type: str) -> int:
    """Read a CSV, create/update its table, and upsert all rows."""
    table_name, key_cols = _TABLE_CONFIG[data_type]
    scraped_at = now_iso()

    with csv_path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if reader.fieldnames is None:
            logger.warning("  %s has no headers — skipping", csv_path.name)
            return 0

        # Normalize column headers; skip the unnamed row-index column
        norm_map: dict[str, str] = {
            f: _normalize_col(f)
            for f in reader.fieldnames
            if _normalize_col(f)  # drop empty (unnamed index col)
        }
        all_norm_cols = list(norm_map.values())
        # Inject jersey_number column right after player for player tables
        if "player" in all_norm_cols:
            idx = all_norm_cols.index("player")
            all_norm_cols.insert(idx + 1, "jersey_number")

        rows = []
        for raw_row in reader:
            norm_row: dict[str, Any] = {}
            for orig, norm in norm_map.items():
                val = raw_row.get(orig, "")
                if norm not in _TEXT_COLS:
                    try:
                        norm_row[norm] = float(val) if val.strip() not in ("", "NA", "N/A", "-") else None
                    except ValueError:
                        norm_row[norm] = None
                else:
                    norm_row[norm] = val.strip() or None
            # Split "NN Name" player field into jersey_number + player name
            if "player" in norm_row and norm_row["player"]:
                parts = norm_row["player"].split(" ", 1)
                if len(parts) == 2:
                    norm_row["jersey_number"] = parts[0]
                    norm_row["player"] = parts[1]
                else:
                    norm_row["jersey_number"] = None
            rows.append(norm_row)

    if not rows:
        logger.info("  %s is empty — nothing to import", csv_path.name)
        return 0

    _ensure_table(conn, table_name, key_cols, all_norm_cols)
    return _upsert_rows(conn, table_name, key_cols, rows, scraped_at)
