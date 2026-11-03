# Deploying ulti_reference

Production runs on **TrueNAS** (Docker via Portainer) behind a **Cloudflare
Tunnel**. Code lives on **GitHub** (`GetHorizontal63/ulti_reference`), and
GitHub Actions builds the Docker images. TrueNAS only pulls and runs them.

```
 Your PC (local disk)              GitHub                          TrueNAS
 ┌───────────────────┐  push   ┌──────────────────────────┐ pull  ┌─────────────────────────────────┐
 │ C:\dev\ulti_ref.. │ ──────► │ Actions: test → build    │ ────► │ web ─/api/→ api      cloudflared│
 │ vite + uvicorn    │         │ ghcr.io/gethorizontal63/ │       │  │           │          ▲       │
 │ DB = a backup copy│         │   ulti_reference-{api,   │       │  └─/data/    ▼          │ HTTPS │
 └───────────────────┘         │   worker,web}            │       │ worker ──► DATA_ROOT dataset    │
                               └──────────────────────────┘       └─────────────────────────────────┘
```

| Container | What it does |
|---|---|
| `web` | Nginx: serves the React build, serves `/data/` exports, proxies `/api/` to `api` |
| `api` | FastAPI. Not exposed to the LAN, only reachable through `web` |
| `worker` | Cron: DB backup at 03:30 UTC, `sync_all.py --run` (scrapers) at 04:00 UTC |
| `cloudflared` | Outbound tunnel to Cloudflare, so no router ports need opening |

All state lives in one TrueNAS dataset (`DATA_ROOT`), separate from the code.
It has the same layout as the repo's gitignored `data/` folder (see
[data/README.md](data/README.md)), and containers mount it at `/app/data`:

```
DATA_ROOT/
  db/ultimate.db     SQLite DB, ~1.3 GB (+ ultimate.db-wal / -shm)
  raw/  processed/   scraper working data (~9.5 GB)
  backups/           nightly DB copies (keeps 7)
  exports/           static JSON bundles served at /data/
  state/             whitelist.json (admin), news_cache.json
  logs/              scrape.log, sync_all.log, backup_db.log
```

---

## Part 1: Put the code on GitHub (one time)

`prod/` is the repo. It already has git initialized with `origin` set, and its
`.gitignore` keeps all of `data/` (DB, caches, exports, secrets) out.
**The GitHub repo is public**, so check `git status` before the first commit.

In PowerShell on your PC:

```powershell
cd Z:\Code_Server\Ultimate_Frisbee_Advanced_Analytics\prod

# Git refuses repos on network shares owned by another account; allow this one
git config --global --add safe.directory '%(prefix)///TRUENAS/Nomad_Data_Services/Code_Server/Ultimate_Frisbee_Advanced_Analytics/prod'

git add .
git status            # review: nothing under data/ except data/README.md
git commit -m "Initial import: app, pipelines, Docker + CI deployment"

# The GitHub repo already has a README; merge it, keeping our version
git pull origin main --allow-unrelated-histories -X ours --no-edit
git push -u origin main
```

Then do future development from a clone on your **local disk**, not the `Z:` share:

```powershell
git clone https://github.com/GetHorizontal63/ulti_reference.git C:\dev\ulti_reference
```

## Part 2: GitHub settings (one time)

1. **Actions → "Build & publish images"**: the push above starts it. Wait for
   it to go green (the worker image takes ~5 min because of Chromium).
   - If the push fails with a permissions error: **Settings → Actions →
     General → Workflow permissions →** "Read and write permissions".
2. **Make the images public**, so TrueNAS can pull them without logging in:
   your GitHub profile → **Packages** → each of `ulti_reference-api`,
   `ulti_reference-worker`, `ulti_reference-web` → **Package settings →
   Change visibility → Public**. The code is already public, so this exposes nothing new.
   - To keep them private instead, create a classic PAT with
     `read:packages` and add it in Portainer under **Registries → Add registry →
     GitHub**.

## Part 3: Prepare TrueNAS (one time)

### 3a. Create the dataset

TrueNAS UI → **Datasets → Add Dataset** (preset *Apps*), e.g.
`Nomad_Data_Services/apps/ulti_reference`. Its path is your **`DATA_ROOT`**,
e.g. `/mnt/Nomad_Data_Services/apps/ulti_reference`.

Then in **System → Shell**:

```bash
DATA_ROOT=/mnt/Nomad_Data_Services/apps/ulti_reference   # ← your path
mkdir -p $DATA_ROOT/{db,raw,processed,backups,exports,state,logs}
```

**Data Protection → Periodic Snapshot Tasks → Add**: this dataset, e.g.
hourly (keep 2 days) + daily (keep 30 days). Snapshots plus the nightly
`backups/` copies are your backup. Replicate them off the box if you can.

### 3b. Load the data into the dataset

`prod/data/` already holds a full copy of everything in the dataset layout:
DB, scraper caches, exports, model CSVs, whitelist and news cache. The **live**
DB may have changed since that copy was taken, so stop the old stack first and
take the DB from its live location:

```bash
WS=/mnt/Nomad_Data_Services/Code_Server/Ultimate_Frisbee_Advanced_Analytics   # ← old workspace
DATA_ROOT=/mnt/Nomad_Data_Services/apps/ulti_reference

# 1. Stop the old stack (Portainer → Stacks → ufa-analytics → Stop) so nothing writes.

# 2. Everything except the DB, from the prepared copy
rsync -a --exclude 'db/ultimate.db*' $WS/prod/data/ $DATA_ROOT/

# 3. The DB from its live location. Copy the -wal/-shm files with it if they
#    exist; they may hold recent writes.
cp -a $WS/backend/ultimate.db* $DATA_ROOT/db/

ls -lh $DATA_ROOT/db
```

The originals in the old workspace stay where they are, so you can fall back.

> **Never open the live DB over SMB** (`Z:\`, `\\TRUENAS\...`). SQLite's WAL
> mode doesn't work over network filesystems, and two machines writing at
> once can corrupt it. For local analysis, copy a file from `backups/`.

### 3c. Point Cloudflare at the new web container

Cloudflare **Zero Trust → Networks → Tunnels →** your tunnel **→ Public Hostname**:
change the service from `http://frontend:80` to **`http://web:80`**.
The tunnel token stays the same.

## Part 4: Deploy the stack in Portainer

1. **Stacks → Add stack**, name `ulti-reference`.
2. Build method **Repository**:
   - URL `https://github.com/GetHorizontal63/ulti_reference`, reference `refs/heads/main`, compose path `docker-compose.yml`.
   - Turn on **GitOps updates** (polling, e.g. every 5 min) if you want stack changes to apply automatically.

   You can also use **Web editor** and paste `docker-compose.yml` instead.
3. **Environment variables**:

   | Name | Value |
   |---|---|
   | `DATA_ROOT` | `/mnt/Nomad_Data_Services/apps/ulti_reference` |
   | `JWT_SECRET` | output of `openssl rand -base64 48`. Keep it stable; changing it logs everyone out |
   | `CORS_ORIGINS` | `https://yourdomain.com` |
   | `CLOUDFLARE_TUNNEL_TOKEN` | from Cloudflare (same as before) |
   | `STRIPE_*` | only if billing is live |

4. **Deploy the stack**. The first start of `api` builds DB indexes and can take a
   few minutes, during which `web` and `worker` wait for it to report healthy.
5. Once it's up, delete the old `ufa-analytics` stack.

### Verify

```
http://<truenas>:3000                 the site (LAN)
http://<truenas>:3000/api/health      {"status":"ok"}
https://yourdomain.com                public site via Cloudflare
```

In Portainer, all four containers should be green, and `api` should say *healthy*.

---

## Day-to-day

### Ship a change
Push to `main`. CI tests, then publishes new `:latest` images. Then pull them on TrueNAS:
- Portainer → Stacks → `ulti-reference` → **Pull and redeploy**, or
- from the TrueNAS shell: `docker compose -p ulti-reference pull && docker compose -p ulti-reference up -d`.

### Roll back
Every image is also tagged with its commit SHA. Set the stack variable
`IMAGE_TAG=<sha>` (from the Actions run or `git log`) and redeploy. Clear it to
return to `latest`.

### Database changes
Add a numbered file to `backend/migrations/` (e.g. `002_add_x.sql`). The API
applies pending migrations on startup and records them in `schema_migrations`.
To check by hand: `docker exec ulti-reference-api-1 python backend/migrate.py --status`.

### Logs
`DATA_ROOT/logs/` holds `sync_all.log`, `backup_db.log` and `scrape.log`. API logs are under
Portainer → Containers → `api` → Logs.

### Run the scrapers now
```bash
docker exec -it ulti-reference-worker-1 python sync_all.py            # gap report only
docker exec -it ulti-reference-worker-1 python sync_all.py --run      # fill gaps
```

### Regenerate the static bundles
```bash
docker exec -it ulti-reference-worker-1 python -m pipelines.pipeline.export_static_bundle
```
Output goes to `DATA_ROOT/exports/`, which `web` serves live at `/data/`.

### Admin access
Set or rotate the admin token and IP whitelist (writes `DATA_ROOT/state/whitelist.json`):
```bash
docker exec -it ulti-reference-api-1 python backend/admin_setup.py
```

### Restore a backup
Stop the stack, then
`cp DATA_ROOT/backups/ultimate-YYYYMMDD.db DATA_ROOT/db/ultimate.db && rm -f DATA_ROOT/db/ultimate.db-wal DATA_ROOT/db/ultimate.db-shm`,
then start the stack. You can also roll back the whole dataset to a TrueNAS snapshot.

---

## Local development

```powershell
cd C:\dev\ulti_reference
copy \\TRUENAS\...\apps\ulti_reference\backups\ultimate-YYYYMMDD.db data\db\ultimate.db

python -m venv .venv; .venv\Scripts\activate
pip install -r docker\requirements-api.txt -r docker\requirements-worker.txt pytest
uvicorn backend.api:app --reload --port 8000        # terminal 1

cd frontend; npm install; npm run dev                # terminal 2 → http://localhost:5173
pytest tests/                                        # smoke tests (what CI runs)
```

With no variables set, every script uses the repo's `data/` folder
(`data/db/ultimate.db`, `data/exports/`, …), and `npm run dev` serves
`data/exports/` at `/data/` the same way Nginx does. These variables override
those paths; the containers set them to `/app/data/...`:

| Variable | Used for |
|---|---|
| `UFA_DB_PATH` | SQLite file |
| `UFA_STATE_DIR` | `whitelist.json`, `news_cache.json` |
| `UFA_LOG_DIR` | scraper and cron logs |
| `UFA_EXPORT_DIR` | static JSON bundles |
| `ENABLE_USAU` / `VITE_ENABLE_USAU` | USAU feature switch (below) |

---

## USAU data is hidden

USAU pages, nav links, API endpoints and the nightly USAU scrape are switched
off until there's a common player/team ID to link it reliably. **The USAU tables
stay in the database untouched.** To bring it back:

1. GitHub **Settings → Secrets and variables → Actions → Variables**: add
   `ENABLE_USAU` = `true`, then re-run "Build & publish images" (the web image
   bakes the flag in at build time).
2. Portainer stack variable `ENABLE_USAU=true`, then **Pull and redeploy**.

Locally: `$env:ENABLE_USAU='true'` for the API and `$env:VITE_ENABLE_USAU='true'`
for `npm run dev`. To run a USAU scrape manually while it's hidden:
`python sync_all.py --run --league usau`.

---

## Optional: GitHub Pages mirror

Production doesn't need this. To publish a static copy of the frontend that
calls the TrueNAS API:

1. **Settings → Pages → Source: GitHub Actions**
2. **Settings → Secrets and variables → Actions → Variables**: `API_BASE_URL` = `https://yourdomain.com`
3. Add `https://gethorizontal63.github.io` to the stack's `CORS_ORIGINS` (comma-separated)
4. **Actions → "Deploy Pages (optional mirror)" → Run workflow**

The UFA throw explorer needs the `/data/` exports, so it's empty on Pages.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| `api` unhealthy / restarting | Logs say `Database not found at /app/data/db/ultimate.db`: `DATA_ROOT` is wrong or the DB isn't in `DATA_ROOT/db/` |
| Pull fails: `denied` / `unauthorized` | Packages are still private (Part 2, step 2) |
| Site loads, API calls fail | `api` healthy? `CORS_ORIGINS` matches the domain exactly (no trailing slash)? |
| Throw explorer or player JSON 404s | `DATA_ROOT/exports/` is empty; re-run the rsync in Part 3b or regenerate them |
| Admin page "IP not authorized" | Run `admin_setup.py` (above); behind Cloudflare the real IP comes from `CF-Connecting-IP` |
| Tunnel shows Degraded | `cloudflared` logs; the public hostname must point at `http://web:80` |
| Nightly sync didn't run | `DATA_ROOT/logs/sync_all.log`; `docker exec ulti-reference-worker-1 cat /etc/cron.d/ulti-reference` |
