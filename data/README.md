# data/

Runtime data. Everything here except this file is gitignored. The folder has
the same layout as the production TrueNAS dataset (`DATA_ROOT`), which the
containers mount at `/app/data`. Code finds these paths by default when the
`UFA_*` environment variables are unset.

| Path | Contents | Written by |
|---|---|---|
| `db/ultimate.db` | SQLite database (+ `-wal`/`-shm` while in use) | API, worker |
| `db/legacy/` | old standalone DBs kept for reference | — |
| `raw/` | scraper caches (UFA HTML/API JSON, WUL CSVs, MLU 2014 source files) | worker |
| `processed/` | normalized per-game JSON consumed by the exporters | worker |
| `exports/` | static JSON bundles the site loads from `/data/` | `pipelines/pipeline/export_*.py` |
| `backups/` | nightly `backend/backup_db.py` copies (keeps 7) | worker cron |
| `state/` | `whitelist.json` (admin), `news_cache.json` | API |
| `logs/` | scrape, sync and backup logs | API, worker |
| `*.csv` | win-probability model results | `pipelines/ufa_data_pipeline/win_probability_training` |

To get a working copy for local development, copy the newest file from the
production `backups/` folder to `db/ultimate.db`. Don't point local tools at the
live production DB over SMB.
