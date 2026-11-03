# ── API image ─────────────────────────────────────────────────────────────────
# FastAPI only — no scrapers, no Chromium. Built by CI and pushed to
# ghcr.io/gethorizontal63/ulti_reference-api. Build context: repo root.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

COPY docker/requirements-api.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# api.py imports the shared schema helpers from pipelines/usau_data_pipeline
COPY backend/   backend/
COPY pipelines/ pipelines/

EXPOSE 8000
CMD ["uvicorn", "backend.api:app", "--host", "0.0.0.0", "--port", "8000"]
