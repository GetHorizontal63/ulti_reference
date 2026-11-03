# ulti_reference

Multi-league Ultimate Frisbee analytics for UFA, PUL, WUL, MLU and international
play: player and team pages, game box scores, throw charts and comparisons.

## Layout

The repo splits into the three things that get deployed (site, API, worker),
plus a local data folder:

| Folder | What it is | Ships as |
|---|---|---|
| `frontend/` | React + Vite + Tailwind + D3/three.js single-page app, Nginx config | `ulti_reference-web` image |
| `backend/` | FastAPI app (`api.py` + routers), `migrations/`, `backup_db.py`, `admin_setup.py` | `ulti_reference-api` image |
| `pipelines/` + `sync_all.py` | Scrapers and ingest jobs, one folder per source, run nightly by `sync_all.py` | `ulti_reference-worker` image |
| `docker/` | API and worker Dockerfiles, requirements | |
| `data/` | **Gitignored.** DB, scraper caches, exports, backups ([data/README.md](data/README.md)) | TrueNAS dataset |
| `tests/` | API smoke tests (run in CI) | |
| `docs/` | Data source credits | |

## Local development

```bash
python -m venv .venv && . .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r docker/requirements-api.txt -r docker/requirements-worker.txt pytest
# data/db/ultimate.db must exist (copy the newest production backup there)
uvicorn backend.api:app --reload --port 8000

cd frontend && npm install && npm run dev              # http://localhost:5173
pytest tests/
```

## Deployment

See [DEPLOY.md](DEPLOY.md). GitHub Actions builds the three images, and TrueNAS
runs them behind a Cloudflare Tunnel with `data/` on a dataset.

Data sources are credited in [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).
