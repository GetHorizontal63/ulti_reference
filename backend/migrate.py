"""
Apply numbered SQL migrations in backend/migrations/ to ultimate.db.

Each NNN_name.sql file runs once, in filename order, inside a transaction;
applied files are recorded in the schema_migrations table.

Run:
  python backend/migrate.py            apply pending migrations
  python backend/migrate.py --status   list applied / pending

Also invoked automatically on API startup (see api.py).
"""
from __future__ import annotations

import os
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
DB_PATH        = Path(os.environ.get("UFA_DB_PATH") or Path(__file__).resolve().parents[1] / "data" / "db" / "ultimate.db")


def _ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename   TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
    """)


def pending(conn: sqlite3.Connection) -> list[Path]:
    _ensure_table(conn)
    done = {r[0] for r in conn.execute("SELECT filename FROM schema_migrations")}
    return [p for p in sorted(MIGRATIONS_DIR.glob("*.sql")) if p.name not in done]


def apply_pending(conn: sqlite3.Connection) -> list[str]:
    applied = []
    for path in pending(conn):
        sql = path.read_text(encoding="utf-8")
        conn.execute("BEGIN IMMEDIATE")
        try:
            for stmt in sql.split(";"):
                if stmt.strip():
                    conn.execute(stmt)
            conn.execute(
                "INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)",
                (path.name, datetime.now(timezone.utc).isoformat(timespec="seconds")),
            )
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        applied.append(path.name)
    return applied


def main() -> None:
    if not DB_PATH.exists():
        sys.exit(f"DB not found: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH, timeout=60, isolation_level=None)
    conn.execute("PRAGMA busy_timeout=60000")
    try:
        if "--status" in sys.argv:
            todo = {p.name for p in pending(conn)}
            for p in sorted(MIGRATIONS_DIR.glob("*.sql")):
                print(f"  {'pending' if p.name in todo else 'applied'}  {p.name}")
            return
        applied = apply_pending(conn)
        print("Applied: " + ", ".join(applied) if applied else "Up to date.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
