"""
Admin routes for the Analytics API.

All endpoints require:
  1. Client IP whose SHA-256 hash is present in backend/whitelist.json
     OR whose IP falls within an allowed CIDR range (e.g. 100.64.0.0/10 for Tailscale)
  2. X-Admin-Token header whose SHA-256 hash matches whitelist.token_hash

Run backend/admin_setup.py once to bootstrap the whitelist.

Endpoints:
  POST   /api/admin/verify                  — validate IP + token
  GET    /api/admin/whitelist               — list stored IP hashes and CIDRs
  POST   /api/admin/whitelist               — add IP (plain text → hashed server-side)
  DELETE /api/admin/whitelist/{ip_hash}     — remove an IP hash
  POST   /api/admin/whitelist/cidr          — add a CIDR range
  DELETE /api/admin/whitelist/cidr          — remove a CIDR range (?cidr=)
  GET    /api/admin/sync/status           — current background sync state
  POST   /api/admin/sync/run             — run sync_all.py (non-blocking)
  GET    /api/admin/logs                  — recent scrape log entries from DB
  GET    /api/admin/validate              — run data-validation checks
  POST   /api/admin/rescrape             — trigger targeted rescrape via sync_all.py
  GET    /api/admin/tables               — list all DB tables with row counts
  GET    /api/admin/table/{name}         — browse table rows (paginated)
  PATCH  /api/admin/table/{name}/{rowid} — update a single row
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import logging
import os
import re as _re
import sqlite3
import subprocess
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# Tailscale assigns IPs from the CGNAT range 100.64.0.0/10
TAILSCALE_CIDR = "100.64.0.0/10"

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/admin", tags=["admin"])
log    = logging.getLogger(__name__)

WHITELIST_PATH = Path(os.environ.get("UFA_STATE_DIR") or Path(__file__).resolve().parents[1] / "data" / "state") / "whitelist.json"
DB_PATH        = Path(os.environ.get("UFA_DB_PATH") or Path(__file__).resolve().parents[1] / "data" / "db" / "ultimate.db")
ROOT           = Path(__file__).resolve().parent.parent
SYNC_SCRIPT    = ROOT / "sync_all.py"
PYTHON_EXE     = sys.executable

# ── Whitelist helpers ─────────────────────────────────────────────────────────

def _load_wl() -> dict:
    if not WHITELIST_PATH.exists():
        return {"ip_hashes": [], "token_hash": ""}
    with open(WHITELIST_PATH) as f:
        return json.load(f)


def _save_wl(data: dict) -> None:
    with open(WHITELIST_PATH, "w") as f:
        json.dump(data, f, indent=2)


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _ip_in_cidrs(ip: str, cidrs: list[str]) -> bool:
    """Return True if ip falls within any of the given CIDR ranges."""
    if not cidrs or not ip:
        return False
    try:
        addr = ipaddress.ip_address(ip)
        return any(addr in ipaddress.ip_network(c, strict=False) for c in cidrs)
    except ValueError:
        return False


# Peers allowed to tell us the real client IP via X-Real-IP: localhost and the
# Docker bridge range (the Nginx container). Nginx derives X-Real-IP from
# CF-Connecting-IP using its realip module, so the value can't be spoofed by
# the client. X-Forwarded-For is never trusted — clients control its first hop.
_TRUSTED_PROXY_CIDRS = os.environ.get(
    "TRUSTED_PROXY_CIDRS", "127.0.0.0/8,::1/128,172.16.0.0/12"
).split(",")


def _client_ip(request: Request) -> str:
    peer = request.client.host if request.client else ""
    if _ip_in_cidrs(peer, _TRUSTED_PROXY_CIDRS):
        real_ip = request.headers.get("X-Real-IP", "").strip()
        if real_ip:
            return real_ip
    return peer


def _is_tailscale_ip(ip: str) -> bool:
    return _ip_in_cidrs(ip, [TAILSCALE_CIDR])


# ── Auth dependency ───────────────────────────────────────────────────────────

async def require_admin(
    request:       Request,
    x_admin_token: Optional[str] = Header(None),
) -> str:
    """Validates IP (hash list or CIDR) + token. Returns the resolved client IP on success."""
    wl = _load_wl()

    ip      = _client_ip(request)
    ip_hash = _sha256(ip)

    in_hash_list = ip_hash in wl.get("ip_hashes", [])
    in_cidr      = _ip_in_cidrs(ip, wl.get("allowed_cidrs", []))

    if not in_hash_list and not in_cidr:
        raise HTTPException(
            status_code=403,
            detail={"code": 4403, "message": f"IP not authorized ({ip})"},
        )

    stored_token_hash = wl.get("token_hash", "")
    if not stored_token_hash:
        raise HTTPException(
            status_code=403,
            detail={"code": 4401, "message": "Admin token not configured — run admin_setup.py"},
        )
    if not x_admin_token:
        raise HTTPException(
            status_code=403,
            detail={"code": 4401, "message": "X-Admin-Token header required"},
        )
    if not hmac.compare_digest(_sha256(x_admin_token), stored_token_hash):
        raise HTTPException(
            status_code=403,
            detail={"code": 4402, "message": "Invalid admin token"},
        )

    return ip


# ── Verify ────────────────────────────────────────────────────────────────────

@router.post("/verify")
async def verify(ip: str = Depends(require_admin)):
    """Return 200 if the caller is authorized (IP + token check passed)."""
    return {"authenticated": True, "ip": ip}


# ── Whitelist management ──────────────────────────────────────────────────────

class AddIPRequest(BaseModel):
    ip: str  # plain IP — hashed server-side


class AddCIDRRequest(BaseModel):
    cidr: str  # e.g. "100.64.0.0/10"


@router.get("/whitelist")
async def list_whitelist(ip: str = Depends(require_admin)):
    wl = _load_wl()
    return {
        "ip_hashes":          wl.get("ip_hashes", []),
        "allowed_cidrs":      wl.get("allowed_cidrs", []),
        "token_hash_set":     bool(wl.get("token_hash")),
        "caller_ip":          ip,
        "caller_is_tailscale": _is_tailscale_ip(ip),
    }


@router.post("/whitelist")
async def add_to_whitelist(body: AddIPRequest, ip: str = Depends(require_admin)):
    wl       = _load_wl()
    new_hash = _sha256(body.ip)
    if new_hash not in wl.setdefault("ip_hashes", []):
        wl["ip_hashes"].append(new_hash)
        _save_wl(wl)
    return {"added": new_hash, "ip_hashes": wl["ip_hashes"]}


@router.delete("/whitelist/{ip_hash}")
async def remove_from_whitelist(ip_hash: str, ip: str = Depends(require_admin)):
    wl     = _load_wl()
    before = len(wl.get("ip_hashes", []))
    wl["ip_hashes"] = [h for h in wl.get("ip_hashes", []) if h != ip_hash]
    _save_wl(wl)
    return {"removed": before - len(wl["ip_hashes"]), "ip_hashes": wl["ip_hashes"]}


@router.post("/whitelist/cidr")
async def add_cidr(body: AddCIDRRequest, ip: str = Depends(require_admin)):
    """Add a CIDR range to the allowlist (e.g. 100.64.0.0/10 for all Tailscale)."""
    try:
        ipaddress.ip_network(body.cidr, strict=False)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid CIDR: {exc}")
    wl = _load_wl()
    wl.setdefault("allowed_cidrs", [])
    if body.cidr not in wl["allowed_cidrs"]:
        wl["allowed_cidrs"].append(body.cidr)
        _save_wl(wl)
    return {"added": body.cidr, "allowed_cidrs": wl["allowed_cidrs"]}


from fastapi import Query as _Query  # noqa: E402


@router.delete("/whitelist/cidr")
async def remove_cidr(
    cidr: str = _Query(..., description="CIDR range to remove, e.g. 100.64.0.0/10"),
    ip:   str = Depends(require_admin),
):
    """Remove a CIDR range from the allowlist."""
    wl     = _load_wl()
    before = len(wl.get("allowed_cidrs", []))
    wl["allowed_cidrs"] = [c for c in wl.get("allowed_cidrs", []) if c != cidr]
    _save_wl(wl)
    return {"removed": before - len(wl["allowed_cidrs"]), "allowed_cidrs": wl["allowed_cidrs"]}


# ── Sync control ──────────────────────────────────────────────────────────────

_sync_lock  = threading.Lock()
_sync_state: dict[str, Any] = {
    "running":     False,
    "output":      [],
    "exit_code":   None,
    "started_at":  None,
    "finished_at": None,
}

_ALLOWED_SYNC_ARGS = frozenset({
    "--run", "--check-only", "--force",
    "--ufa-only", "--usau-only", "--pul-only", "--wul-only",
})


class SyncRunRequest(BaseModel):
    args: list[str] = ["--run"]


@router.get("/sync/status")
async def sync_status(ip: str = Depends(require_admin)):
    return dict(_sync_state)


@router.post("/sync/run")
async def run_sync(body: SyncRunRequest, ip: str = Depends(require_admin)):
    if _sync_state["running"]:
        raise HTTPException(status_code=409, detail="Sync already running")
    if not SYNC_SCRIPT.exists():
        raise HTTPException(status_code=500, detail=f"sync_all.py not found at {SYNC_SCRIPT}")

    disallowed = [a for a in body.args if a not in _ALLOWED_SYNC_ARGS]
    if disallowed:
        raise HTTPException(status_code=400, detail=f"Disallowed arguments: {disallowed}")

    cmd = [PYTHON_EXE, str(SYNC_SCRIPT)] + body.args

    def _run() -> None:
        _sync_state.update({
            "running":     True,
            "output":      [],
            "exit_code":   None,
            "started_at":  datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
        })
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=str(ROOT),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            for line in proc.stdout:
                _sync_state["output"].append(line.rstrip())
                if len(_sync_state["output"]) > 2_000:   # cap memory
                    _sync_state["output"] = _sync_state["output"][-2_000:]
            proc.wait()
            _sync_state["exit_code"] = proc.returncode
        except Exception as exc:
            _sync_state["output"].append(f"ERROR: {exc}")
            _sync_state["exit_code"] = -1
        finally:
            _sync_state["running"]     = False
            _sync_state["finished_at"] = datetime.now(timezone.utc).isoformat()

    threading.Thread(target=_run, daemon=True).start()
    return {"started": True, "cmd": cmd}


# ── Scraper logs ──────────────────────────────────────────────────────────────

_LOG_QUERIES: list[tuple[str, str]] = [
    (
        "ufa",
        "SELECT year, data_type, status, detail, scraped_at "
        "FROM ufa_scrape_log ORDER BY scraped_at DESC LIMIT ?",
    ),
    (
        "wul",
        "SELECT year, data_type, status, detail, scraped_at "
        "FROM wul_scrape_log ORDER BY scraped_at DESC LIMIT ?",
    ),
    (
        "pul",
        "SELECT season AS year, NULL AS data_type, status, detail, scraped_at "
        "FROM pul_scrape_log ORDER BY scraped_at DESC LIMIT ?",
    ),
]


@router.get("/logs")
async def get_logs(
    league: Optional[str] = None,
    limit:  int            = 200,
    ip:     str            = Depends(require_admin),
):
    """Return recent scrape log entries from the database across all leagues."""
    if limit > 2_000:
        limit = 2_000
    results: list[dict] = []
    try:
        with sqlite3.connect(DB_PATH, timeout=5) as conn:
            conn.row_factory = sqlite3.Row
            for tbl_league, query in _LOG_QUERIES:
                if league and league != tbl_league:
                    continue
                try:
                    rows = conn.execute(query, (limit,)).fetchall()
                    for r in rows:
                        results.append({"league": tbl_league, **dict(r)})
                except sqlite3.OperationalError:
                    pass  # table may not exist yet
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    results.sort(key=lambda r: r.get("scraped_at") or "", reverse=True)
    return {"logs": results[:limit]}


# ── Data validation ───────────────────────────────────────────────────────────

_VALIDATION_CHECKS: list[tuple[str, str, bool]] = [
    # (label, sql, lower_is_better)
    ("UFA Final games with null scores",
     "SELECT COUNT(*) FROM ufa_games WHERE home_score IS NULL AND game_status='Final'",
     True),
    ("UFA Final games with no winner",
     "SELECT COUNT(*) FROM ufa_games WHERE game_status='Final' AND winner_id IS NULL",
     True),
    ("Master players with empty name",
     "SELECT COUNT(*) FROM master_players WHERE full_name IS NULL OR full_name=''",
     True),
    ("UFA player-season stats orphans",
     """SELECT COUNT(*) FROM ufa_player_season_stats s
        WHERE NOT EXISTS (SELECT 1 FROM master_players p WHERE p.id = s.player_id)""",
     True),
    ("UFA games (total)",
     "SELECT COUNT(*) FROM ufa_games",
     False),
    ("Master players (total)",
     "SELECT COUNT(*) FROM master_players",
     False),
    ("UFA player-season stats (total)",
     "SELECT COUNT(*) FROM ufa_player_season_stats",
     False),
    ("PUL player-season stats (total)",
     "SELECT COUNT(*) FROM pul_player_season_stats",
     False),
    ("WUL games (total)",
     "SELECT COUNT(*) FROM wul_games",
     False),
]


@router.get("/validate")
async def validate_data(ip: str = Depends(require_admin)):
    """Run quick data-validation checks against the database."""
    checks = []
    try:
        with sqlite3.connect(DB_PATH, timeout=5) as conn:
            for label, sql, lower_is_better in _VALIDATION_CHECKS:
                try:
                    count = conn.execute(sql).fetchone()[0]
                    ok    = (count == 0) if lower_is_better else None
                    checks.append({"check": label, "count": count, "ok": ok})
                except sqlite3.OperationalError as exc:
                    checks.append({"check": label, "count": None, "ok": False, "error": str(exc)})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    return {"checks": checks, "checked_at": datetime.now(timezone.utc).isoformat()}


# ── Force rescrape ────────────────────────────────────────────────────────────

_LEAGUE_ARG_MAP: dict[str, str] = {
    "ufa":  "--ufa-only",
    "pul":  "--pul-only",
    "wul":  "--wul-only",
    "usau": "--usau-only",
}


class RescrapeRequest(BaseModel):
    league:   str        # ufa | pul | wul | usau
    seasons:  list[int]  = []
    game_ids: list[str]  = []
    force:    bool       = True


@router.post("/rescrape")
async def force_rescrape(body: RescrapeRequest, ip: str = Depends(require_admin)):
    if body.league not in _LEAGUE_ARG_MAP:
        raise HTTPException(status_code=400, detail=f"Unknown league: {body.league}")
    if _sync_state["running"]:
        raise HTTPException(status_code=409, detail="Sync already running — wait for it to finish")

    args = ["--run", _LEAGUE_ARG_MAP[body.league]]
    if body.force:
        args.append("--force")

    cmd = [PYTHON_EXE, str(SYNC_SCRIPT)] + args
    header = (
        f"[rescrape] league={body.league}"
        + (f" seasons={body.seasons}" if body.seasons else "")
        + (f" game_ids={body.game_ids}" if body.game_ids else "")
    )

    def _run() -> None:
        _sync_state.update({
            "running":     True,
            "output":      [header],
            "exit_code":   None,
            "started_at":  datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
        })
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=str(ROOT),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            for line in proc.stdout:
                _sync_state["output"].append(line.rstrip())
                if len(_sync_state["output"]) > 2_000:
                    _sync_state["output"] = _sync_state["output"][-2_000:]
            proc.wait()
            _sync_state["exit_code"] = proc.returncode
        except Exception as exc:
            _sync_state["output"].append(f"ERROR: {exc}")
            _sync_state["exit_code"] = -1
        finally:
            _sync_state["running"]     = False
            _sync_state["finished_at"] = datetime.now(timezone.utc).isoformat()

    threading.Thread(target=_run, daemon=True).start()
    return {"started": True, "league": body.league, "cmd": cmd}


# ── DB table browser ──────────────────────────────────────────────────────────

_BLOCKLIST_PREFIXES = ("sqlite_",)


def _table_allowed(name: str) -> bool:
    return not any(name.startswith(p) for p in _BLOCKLIST_PREFIXES)


def _validated_table(name: str, conn: sqlite3.Connection) -> str:
    """Raise 404 if table does not exist or is blocked. Returns validated name."""
    if not _table_allowed(name):
        raise HTTPException(status_code=403, detail="Table not accessible")
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?",
        (name,),
    ).fetchone()
    if not exists:
        raise HTTPException(status_code=404, detail=f"Table '{name}' not found")
    return name


@router.get("/tables")
async def list_tables(ip: str = Depends(require_admin)):
    """List all DB tables and views with row counts."""
    try:
        with sqlite3.connect(DB_PATH, timeout=5) as conn:
            rows = conn.execute(
                "SELECT name, type FROM sqlite_master "
                "WHERE type IN ('table','view') ORDER BY name"
            ).fetchall()
            tables = []
            for name, ttype in rows:
                if _table_allowed(name):
                    count = conn.execute(f"SELECT COUNT(*) FROM [{name}]").fetchone()[0]
                    tables.append({"name": name, "type": ttype, "row_count": count})
        return {"tables": tables}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/table/{table_name}")
async def browse_table(
    table_name: str,
    page:       int           = 0,
    page_size:  int           = 50,
    search:     Optional[str] = None,
    ip:         str           = Depends(require_admin),
):
    """Browse table rows with pagination."""
    if page_size > 200:
        page_size = 200
    try:
        with sqlite3.connect(DB_PATH, timeout=5) as conn:
            conn.row_factory = sqlite3.Row
            _validated_table(table_name, conn)

            cols     = conn.execute(f"PRAGMA table_info([{table_name}])").fetchall()
            col_names = [c["name"] for c in cols]
            offset   = page * page_size
            rows     = conn.execute(
                f"SELECT rowid AS _rowid, * FROM [{table_name}] LIMIT ? OFFSET ?",
                (page_size, offset),
            ).fetchall()
            total = conn.execute(f"SELECT COUNT(*) FROM [{table_name}]").fetchone()[0]

        return {
            "table":     table_name,
            "columns":   col_names,
            "rows":      [dict(r) for r in rows],
            "page":      page,
            "page_size": page_size,
            "total":     total,
        }
    except HTTPException:
        raise
    except sqlite3.OperationalError as exc:
        raise HTTPException(status_code=404, detail=f"Table error: {exc}")


class RowUpdateRequest(BaseModel):
    updates: dict[str, Any]  # column → new value


@router.patch("/table/{table_name}/{rowid}")
async def update_row(
    table_name: str,
    rowid:      int,
    body:       RowUpdateRequest,
    ip:         str = Depends(require_admin),
):
    """Update a single row by rowid."""
    if not body.updates:
        raise HTTPException(status_code=400, detail="No updates provided")
    try:
        with sqlite3.connect(DB_PATH, timeout=5) as conn:
            _validated_table(table_name, conn)

            # Validate column names to prevent injection
            valid_cols = {c[1] for c in conn.execute(f"PRAGMA table_info([{table_name}])").fetchall()}
            for col in body.updates:
                if col not in valid_cols:
                    raise HTTPException(status_code=400, detail=f"Unknown column: {col}")

            set_clause = ", ".join(f"[{col}] = ?" for col in body.updates)
            values     = [*body.updates.values(), rowid]
            conn.execute(
                f"UPDATE [{table_name}] SET {set_clause} WHERE rowid = ?",
                values,
            )
            conn.commit()
        return {"updated": True, "rowid": rowid}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Blog admin ────────────────────────────────────────────────────────────────

class BlogPostCreate(BaseModel):
    post_id:         Optional[str] = None
    title:           str
    subtitle:        str = ""
    author:          str = ""
    category:        str = ""
    tags:            str = ""
    body:            str = ""
    summary:         str = ""
    cover_image_url: str = ""
    featured:        int = 0
    published:       int = 0
    published_at:    Optional[str] = None


class BlogPostUpdate(BaseModel):
    title:           str
    subtitle:        str = ""
    author:          str = ""
    category:        str = ""
    tags:            str = ""
    body:            str = ""
    summary:         str = ""
    cover_image_url: str = ""
    featured:        int = 0
    published:       int = 0
    published_at:    Optional[str] = None


# NOTE: /blog/tags must be defined before /blog/{post_id} to avoid route shadowing
@router.get("/blog/tags")
async def admin_blog_tags(ip: str = Depends(require_admin)):
    """Return sorted list of all unique tags used across blog posts."""
    with sqlite3.connect(DB_PATH, timeout=5) as conn:
        rows = conn.execute(
            "SELECT tags FROM blog WHERE tags IS NOT NULL AND tags != ''"
        ).fetchall()
    tag_set: set[str] = set()
    for (raw,) in rows:
        for t in raw.split(","):
            t = t.strip()
            if t:
                tag_set.add(t)
    return sorted(tag_set, key=str.lower)


@router.get("/blog")
async def admin_list_blog(ip: str = Depends(require_admin)):
    """List all blog posts (including drafts), newest first."""
    with sqlite3.connect(DB_PATH, timeout=5) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """SELECT post_id, title, subtitle, author, category, tags,
                      summary, cover_image_url, featured, published,
                      published_at, created_at, updated_at
               FROM blog
               ORDER BY created_at DESC"""
        ).fetchall()
    return [dict(r) for r in rows]


@router.get("/blog/{post_id}")
async def admin_get_blog(post_id: str, ip: str = Depends(require_admin)):
    """Fetch a single post including full body (drafts accessible)."""
    with sqlite3.connect(DB_PATH, timeout=5) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT * FROM blog WHERE post_id = ?", (post_id,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Post not found")
    return dict(row)


@router.post("/blog")
async def admin_create_blog(body: BlogPostCreate, ip: str = Depends(require_admin)):
    """Create a new blog post. Auto-generates post_id from title if omitted."""
    now = datetime.now(timezone.utc).isoformat()
    pid = (body.post_id or "").strip()
    if not pid:
        pid = _re.sub(r"[^a-z0-9]+", "-", body.title.lower()).strip("-")[:80]
        if not pid:
            pid = f"post-{int(datetime.now().timestamp())}"
    pub_at = body.published_at or (now if body.published else None)
    try:
        with sqlite3.connect(DB_PATH, timeout=5) as conn:
            conn.execute(
                """INSERT INTO blog
                   (post_id, title, subtitle, author, category, tags,
                    body, summary, cover_image_url, featured, published,
                    published_at, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (pid, body.title, body.subtitle, body.author,
                 body.category, body.tags, body.body, body.summary,
                 body.cover_image_url, body.featured, body.published,
                 pub_at, now, now),
            )
            conn.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail=f"post_id '{pid}' already exists")
    return {"post_id": pid, "created": True}


@router.put("/blog/{post_id}")
async def admin_update_blog(
    post_id: str,
    body:    BlogPostUpdate,
    ip:      str = Depends(require_admin),
):
    """Update an existing blog post."""
    now = datetime.now(timezone.utc).isoformat()
    pub_at = body.published_at or (now if body.published else None)
    with sqlite3.connect(DB_PATH, timeout=5) as conn:
        res = conn.execute(
            """UPDATE blog
               SET title=?, subtitle=?, author=?, category=?, tags=?,
                   body=?, summary=?, cover_image_url=?, featured=?,
                   published=?, published_at=?, updated_at=?
               WHERE post_id=?""",
            (body.title, body.subtitle, body.author, body.category,
             body.tags, body.body, body.summary, body.cover_image_url,
             body.featured, body.published, pub_at, now, post_id),
        )
        conn.commit()
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Post not found")
    return {"updated": True}


@router.delete("/blog/{post_id}")
async def admin_delete_blog(post_id: str, ip: str = Depends(require_admin)):
    """Hard-delete a blog post."""
    with sqlite3.connect(DB_PATH, timeout=5) as conn:
        res = conn.execute("DELETE FROM blog WHERE post_id = ?", (post_id,))
        conn.commit()
        if res.rowcount == 0:
            raise HTTPException(status_code=404, detail="Post not found")
    return {"deleted": True}
