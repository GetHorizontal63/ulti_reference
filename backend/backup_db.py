"""
Consistent online backup of ultimate.db using SQLite's backup API (safe while
the API and scrapers are running — unlike copying the file, which can capture
a torn write or miss the -wal contents).

Writes data/backups/ultimate-YYYYMMDD.db and keeps the newest N copies.

Run:
  python backend/backup_db.py            (keep 7)
  python backend/backup_db.py --keep 14

Scheduled nightly by the backend container's cron (see Dockerfile).
Pair with TrueNAS periodic snapshots of the dataset for off-box history.
"""
from __future__ import annotations

import os
import argparse
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

ROOT       = Path(__file__).resolve().parent.parent
DB_PATH    = Path(os.environ.get("UFA_DB_PATH") or ROOT / "data" / "db" / "ultimate.db")
BACKUP_DIR = ROOT / "data" / "backups"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=int, default=7)
    args = ap.parse_args()

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    dest  = BACKUP_DIR / f"ultimate-{stamp}.db"
    tmp   = dest.with_suffix(".db.partial")

    src = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=60)
    dst = sqlite3.connect(tmp)
    try:
        src.backup(dst, pages=4096)
        ok = dst.execute("PRAGMA quick_check").fetchone()[0]
        if ok != "ok":
            raise RuntimeError(f"backup failed quick_check: {ok}")
    finally:
        dst.close()
        src.close()
    tmp.replace(dest)
    print(f"Backed up to {dest} ({dest.stat().st_size / 1e6:.0f} MB)")

    for old in sorted(BACKUP_DIR.glob("ultimate-*.db"))[:-args.keep]:
        old.unlink()
        print(f"Pruned {old.name}")


if __name__ == "__main__":
    main()
