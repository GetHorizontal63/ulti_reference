"""
Status check routes for the Analytics API.

GET /api/status  — returns health of all monitored services (cached 60 s)

Custom site status codes:
  2000  Operational            — service responding normally
  2001  Operational (Slow)     — responded but >3 s
  4001  No Response            — timeout or connection refused
  4002  HTTP Error             — service returned non-2xx (excl. 429)
  4003  Database Offline       — cannot connect/query SQLite
  4004  Rate Limited           — service returned 429
  4005  SSL / TLS Error        — certificate or TLS handshake failure
  4006  DNS / Host Error       — cannot resolve hostname
"""
from __future__ import annotations

import os
import asyncio
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter

router = APIRouter(tags=["status"])

# ── Status code definitions ───────────────────────────────────────────────────

STATUS_CODE_LABELS: dict[int, str] = {
    2000: "Operational",
    2001: "Operational (Slow)",
    4001: "No Response",
    4002: "HTTP Error",
    4003: "Database Offline",
    4004: "Rate Limited",
    4005: "SSL / TLS Error",
    4006: "DNS / Host Error",
}

DB_PATH = Path(os.environ.get("UFA_DB_PATH") or Path(__file__).resolve().parents[1] / "data" / "db" / "ultimate.db")

_SLOW_MS = 3_000  # ms threshold for "slow" classification

# ── Service registry ──────────────────────────────────────────────────────────

_SERVICES: list[dict[str, Any]] = [
    {
        "id":          "api",
        "name":        "Analytics API",
        "description": "Backend FastAPI service",
        "type":        "self",
    },
    {
        "id":          "database",
        "name":        "Database",
        "description": "SQLite data store",
        "type":        "db",
    },
    {
        "id":          "ufa_api",
        "name":        "UFA API",
        "description": "ufastats.com backend",
        "type":        "http",
        "url":         "https://www.backend.ufastats.com/api/v1/games?limit=1",
        "timeout":     8.0,
    },
    {
        "id":          "pul_stats",
        "name":        "PUL Stats Hub",
        "description": "pul-stats-hub.pages.dev",
        "type":        "http",
        "url":         "https://pul-stats-hub.pages.dev/",
        "timeout":     8.0,
    },
    {
        "id":          "wul_stats",
        "name":        "WUL Stats App",
        "description": "westernultimateleague.shinyapps.io/stats",
        "type":        "http",
        "url":         "https://westernultimateleague.shinyapps.io/stats/",
        "timeout":     12.0,
    },
    {
        "id":          "usau",
        "name":        "USAU Site",
        "description": "usaultimate.org",
        "type":        "http",
        "url":         "https://www.usaultimate.org/",
        "timeout":     8.0,
    },
]

# ── Internal helpers ──────────────────────────────────────────────────────────

def _result(svc: dict, code: int, elapsed_ms: int | None, detail: str = "") -> dict:
    label = STATUS_CODE_LABELS.get(code, "Unknown")
    if code < 4000:
        status = "operational" if code == 2000 else "degraded"
    elif code in {4004}:
        status = "degraded"   # rate-limited = service is up but throttling us
    else:
        status = "down"
    return {
        "id":          svc["id"],
        "name":        svc["name"],
        "description": svc["description"],
        "status":      status,
        "code":        code,
        "message":     label + (f" — {detail}" if detail else ""),
        "response_ms": elapsed_ms,
        "checked_at":  datetime.now(timezone.utc).isoformat(),
    }


async def _check_http(svc: dict) -> dict:
    url     = svc["url"]
    timeout = svc.get("timeout", 8.0)
    start   = time.monotonic()
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=timeout,
        ) as client:
            resp = await client.get(
                url,
                headers={"User-Agent": "UltimateReference-StatusCheck/1.0"},
            )
        elapsed_ms = int((time.monotonic() - start) * 1000)

        if resp.status_code == 429:
            return _result(svc, 4004, elapsed_ms)
        if resp.status_code >= 400:
            return _result(svc, 4002, elapsed_ms, f"HTTP {resp.status_code}")
        if elapsed_ms > _SLOW_MS:
            return _result(svc, 2001, elapsed_ms)
        return _result(svc, 2000, elapsed_ms)

    except (httpx.ConnectTimeout, httpx.ReadTimeout, httpx.PoolTimeout):
        return _result(svc, 4001, None, "Timeout")
    except httpx.ConnectError as exc:
        msg = str(exc).lower()
        if "ssl" in msg or "certificate" in msg or "tls" in msg:
            return _result(svc, 4005, None, "SSL / TLS error")
        if "getaddrinfo" in msg or "nodename" in msg or "name or service" in msg:
            return _result(svc, 4006, None, "DNS error")
        return _result(svc, 4001, None, "Connection refused")
    except httpx.InvalidURL:
        return _result(svc, 4006, None, "Invalid URL")
    except Exception as exc:
        return _result(svc, 4001, None, str(exc)[:100])


def _check_db() -> dict:
    svc   = next(s for s in _SERVICES if s["id"] == "database")
    start = time.monotonic()
    try:
        conn = sqlite3.connect(DB_PATH, timeout=5)
        conn.execute("SELECT 1").fetchone()
        conn.close()
        elapsed_ms = int((time.monotonic() - start) * 1000)
        if elapsed_ms > _SLOW_MS:
            return _result(svc, 2001, elapsed_ms)
        return _result(svc, 2000, elapsed_ms)
    except Exception as exc:
        return _result(svc, 4003, None, str(exc)[:100])


async def _run_all_checks() -> dict:
    now_iso = datetime.now(timezone.utc).isoformat()

    # API is always "operational" if this endpoint responds
    api_svc = next(s for s in _SERVICES if s["id"] == "api")
    api_result = {
        "id":          "api",
        "name":        api_svc["name"],
        "description": api_svc["description"],
        "status":      "operational",
        "code":        2000,
        "message":     "Operational",
        "response_ms": 0,
        "checked_at":  now_iso,
    }

    # DB check runs in a thread-pool executor (blocking sqlite3 call)
    loop      = asyncio.get_event_loop()
    db_result = await loop.run_in_executor(None, _check_db)

    # HTTP checks run in parallel
    http_svcs    = [s for s in _SERVICES if s["type"] == "http"]
    http_results = await asyncio.gather(*[_check_http(s) for s in http_svcs])

    all_results = [api_result, db_result, *http_results]

    # Derive overall status
    codes = [r["code"] for r in all_results]
    if all(c < 4000 for c in codes):
        overall      = "operational"
        overall_code = 2000
    elif any(c in {4001, 4003} for c in codes):
        overall      = "outage"
        overall_code = max(codes)
    else:
        overall      = "degraded"
        overall_code = max(codes)

    return {
        "overall":         overall,
        "overall_code":    overall_code,
        "overall_message": STATUS_CODE_LABELS.get(overall_code, "Unknown"),
        "checked_at":      now_iso,
        "services":        all_results,
        "status_codes":    STATUS_CODE_LABELS,
    }


# ── Cache ─────────────────────────────────────────────────────────────────────

_cache: dict[str, Any] = {"data": None, "ts": 0.0}
_CACHE_TTL = 60.0  # seconds


# ── Route ─────────────────────────────────────────────────────────────────────

@router.get("/api/status")
async def get_status():
    """Check health of all monitored services. Results cached for 60 seconds."""
    now = time.monotonic()
    if _cache["data"] is not None and (now - _cache["ts"]) < _CACHE_TTL:
        return _cache["data"]

    result        = await _run_all_checks()
    _cache["data"] = result
    _cache["ts"]   = now
    return result
