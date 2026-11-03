# ── Worker image ──────────────────────────────────────────────────────────────
# Cron + scrapers (Playwright/Chromium) + nightly DB backup. The only container
# that does bulk writes to the DB. Built by CI and pushed to
# ghcr.io/gethorizontal63/ulti_reference-worker. Build context: repo root.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

RUN apt-get update && apt-get install -y --no-install-recommends cron ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY docker/requirements-worker.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt \
    && playwright install --with-deps chromium

COPY sync_all.py ./
COPY backend/    backend/
COPY pipelines/  pipelines/

# Cron jobs (UTC). Cron starts jobs with an empty environment, so each job
# sources /etc/ufa.env, which the entrypoint writes from the container env.
# Full interpreter path: cron's PATH doesn't include /usr/local/bin.
RUN printf '%s\n' \
      '30 3 * * * root . /etc/ufa.env; cd /app && /usr/local/bin/python backend/backup_db.py >> "$UFA_LOG_DIR/backup_db.log" 2>&1' \
      '0 4 * * * root . /etc/ufa.env; cd /app && /usr/local/bin/python sync_all.py --run >> "$UFA_LOG_DIR/sync_all.log" 2>&1' \
    > /etc/cron.d/ulti-reference \
    && chmod 0644 /etc/cron.d/ulti-reference

COPY docker/worker-entrypoint.sh /usr/local/bin/worker-entrypoint.sh
RUN chmod +x /usr/local/bin/worker-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/worker-entrypoint.sh"]
