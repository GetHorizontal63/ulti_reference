"""
UltiAnalytics upload routes.

POST /api/ua/verify-team   — validate team credentials before showing the upload UI
POST /api/ua/submit        — accept a parsed .iexport payload and stage it for review

Auth model
----------
Each authorised team has a record in ua_authorized_teams containing:
  - team_cloud_id    (from .iexport teamJson.cloudId)
  - authorized_email (only uploads from this address are accepted)
  - upload_code_hash (SHA-256 of the team's private upload code)

The verify endpoint looks up the row by email, compares the code hash,
and returns the team identity.  The submit endpoint re-validates before
writing anything to the database.

Submission lifecycle
--------------------
  pending   → uploaded, awaiting viability review
  viable    → passed cross-check against USAU tournament records
  rejected  → failed viability check or duplicate
  approved  → admin approved; roster + stats are written to reporting tables
  withdrawn → retracted by team or admin
"""
from __future__ import annotations

import os
import hashlib
import hmac
import json
import logging
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

log     = logging.getLogger(__name__)
router  = APIRouter(prefix="/api/ua", tags=["ultianalytics"])

DB_PATH = Path(os.environ.get("UFA_DB_PATH") or Path(__file__).resolve().parents[1] / "data" / "db" / "ultimate.db")


# ── DB helpers ────────────────────────────────────────────────────────────────

@contextmanager
def _db() -> Generator[sqlite3.Connection, None, None]:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()


def _ensure_ua_tables(conn: sqlite3.Connection) -> None:
    """Idempotent — safe to call on every startup."""
    conn.executescript("""
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS ua_authorized_teams (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            team_cloud_id    TEXT NOT NULL UNIQUE,
            team_name        TEXT NOT NULL,
            authorized_email TEXT NOT NULL,
            upload_code_hash TEXT NOT NULL,
            division         TEXT,
            program_id       TEXT,
            active           INTEGER NOT NULL DEFAULT 1,
            created_at       TEXT NOT NULL DEFAULT (datetime('now')),
            notes            TEXT
        );

        CREATE TABLE IF NOT EXISTS ua_game_submissions (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            team_cloud_id    TEXT NOT NULL REFERENCES ua_authorized_teams(team_cloud_id),
            submitted_by     TEXT NOT NULL,
            submitted_at     TEXT NOT NULL DEFAULT (datetime('now')),
            file_hash        TEXT NOT NULL UNIQUE,
            game_date        TEXT,
            season           TEXT,
            opponent_name    TEXT,
            tournament_name  TEXT,
            score_us         INTEGER,
            score_them       INTEGER,
            raw_json         TEXT NOT NULL,
            status           TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','viable','rejected','approved','withdrawn')),
            viability_checked_at  TEXT,
            viability_notes       TEXT,
            usau_game_id          TEXT,
            approved_by      TEXT,
            approved_at      TEXT,
            rejection_reason TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ua_submissions_team   ON ua_game_submissions(team_cloud_id);
        CREATE INDEX IF NOT EXISTS idx_ua_submissions_status ON ua_game_submissions(status);
        CREATE INDEX IF NOT EXISTS idx_ua_submissions_date   ON ua_game_submissions(game_date);

        CREATE TABLE IF NOT EXISTS ua_game_roster (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id    INTEGER NOT NULL REFERENCES ua_game_submissions(id) ON DELETE CASCADE,
            player_name      TEXT NOT NULL,
            jersey_number    TEXT,
            position         TEXT,
            gender           TEXT,
            absent           INTEGER NOT NULL DEFAULT 0,
            usau_player_id   INTEGER,
            identity_confidence TEXT CHECK(identity_confidence IN ('exact','fuzzy','manual',NULL))
        );
        CREATE INDEX IF NOT EXISTS idx_ua_roster_submission ON ua_game_roster(submission_id);

        CREATE TABLE IF NOT EXISTS ua_game_player_stats (
            id                      INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id           INTEGER NOT NULL REFERENCES ua_game_submissions(id) ON DELETE CASCADE,
            roster_id               INTEGER NOT NULL REFERENCES ua_game_roster(id),
            goals                   INTEGER NOT NULL DEFAULT 0,
            assists                 INTEGER NOT NULL DEFAULT 0,
            hockey_assists          INTEGER NOT NULL DEFAULT 0,
            pass_attempts           INTEGER NOT NULL DEFAULT 0,
            completions             INTEGER NOT NULL DEFAULT 0,
            throwaways              INTEGER NOT NULL DEFAULT 0,
            pass_pct                REAL,
            drops                   INTEGER NOT NULL DEFAULT 0,
            blocks                  INTEGER NOT NULL DEFAULT 0,
            callahans               INTEGER NOT NULL DEFAULT 0,
            pulls                   INTEGER NOT NULL DEFAULT 0,
            pull_hangtime_avg_sec   REAL
        );
        CREATE INDEX IF NOT EXISTS idx_ua_stats_submission ON ua_game_player_stats(submission_id);

        CREATE TABLE IF NOT EXISTS ua_upload_audit_log (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            submission_id INTEGER NOT NULL REFERENCES ua_game_submissions(id),
            action        TEXT NOT NULL,
            actor         TEXT,
            detail        TEXT,
            at            TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_ua_audit_submission ON ua_upload_audit_log(submission_id);
    """)
    conn.commit()


# Tables are created by api.py's startup hook (after it checks the DB exists),
# not at import time — importing must never create or touch the database.
def init_ua_tables(conn: sqlite3.Connection) -> None:
    _ensure_ua_tables(conn)


# ── Crypto helpers ────────────────────────────────────────────────────────────

def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _safe_eq(a: str, b: str) -> bool:
    """Constant-time string comparison to guard against timing attacks."""
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Pydantic models ───────────────────────────────────────────────────────────

class VerifyRequest(BaseModel):
    email:       str
    upload_code: str

    @field_validator("email")
    @classmethod
    def email_nonempty(cls, v: str) -> str:
        v = v.strip().lower()
        if not v:
            raise ValueError("email is required")
        return v

    @field_validator("upload_code")
    @classmethod
    def code_nonempty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("upload_code is required")
        return v


class SubmitRequest(BaseModel):
    email:       str
    upload_code: str
    payload:     dict[str, Any]   # full parsed iexport JSON from the frontend

    @field_validator("email")
    @classmethod
    def email_nonempty(cls, v: str) -> str:
        return v.strip().lower()


# ── Helper: look up + verify a team ──────────────────────────────────────────

def _verify_credentials(
    conn: sqlite3.Connection,
    email: str,
    upload_code: str,
) -> sqlite3.Row:
    """
    Look up the team by authorized_email, verify the code hash.
    Raises HTTP 401 on any failure (deliberately opaque).
    Returns the ua_authorized_teams row on success.
    """
    row = conn.execute(
        "SELECT * FROM ua_authorized_teams WHERE authorized_email = ? AND active = 1 LIMIT 1",
        (email.strip().lower(),),
    ).fetchone()

    _INVALID = HTTPException(status_code=401, detail="Invalid email or upload code.")

    if row is None:
        # Run the hash anyway to avoid a timing oracle on email existence
        _safe_eq(_sha256(upload_code), "0" * 64)
        raise _INVALID

    if not _safe_eq(_sha256(upload_code), row["upload_code_hash"]):
        raise _INVALID

    return row


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/verify-team")
async def verify_team(req: VerifyRequest) -> dict[str, Any]:
    """
    Validate team credentials.  Called BEFORE the upload UI is shown.
    Returns team identity on success; 401 on any failure.
    """
    with _db() as conn:
        team = _verify_credentials(conn, req.email, req.upload_code)

    return {
        "ok":            True,
        "team_cloud_id": team["team_cloud_id"],
        "team_name":     team["team_name"],
        "division":      team["division"],
    }


@router.post("/submit")
async def submit_game(req: SubmitRequest) -> dict[str, Any]:
    """
    Accept a parsed .iexport payload and stage it for admin review.

    Steps:
      1. Re-verify credentials (never trust a prior verify call).
      2. Confirm the payload's team_cloud_id matches the authorised team.
      3. Hash the payload JSON and reject exact duplicates.
      4. Insert ua_game_submissions (status = 'pending').
      5. Append to ua_upload_audit_log.
    """
    with _db() as conn:
        # 1. Re-verify
        team = _verify_credentials(conn, req.email, req.upload_code)

        # 2. Match payload team to authorised team
        payload_cloud_id = (req.payload.get("game") or {}).get("team_cloud_id") or ""
        if payload_cloud_id != team["team_cloud_id"]:
            raise HTTPException(
                status_code=422,
                detail="Payload team_cloud_id does not match your authorised team.",
            )

        # 3. Dedup by content hash
        raw_str   = json.dumps(req.payload, separators=(",", ":"), sort_keys=True)
        file_hash = _sha256(raw_str)

        existing = conn.execute(
            "SELECT id, status FROM ua_game_submissions WHERE file_hash = ? LIMIT 1",
            (file_hash,),
        ).fetchone()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"This game has already been submitted "
                    f"(submission #{existing['id']}, status: {existing['status']})."
                ),
            )

        # 4. Extract headline fields for quick browsing in the admin panel
        game         = req.payload.get("game") or {}
        submitted_at = _now()

        cursor = conn.execute(
            """INSERT INTO ua_game_submissions
                   (team_cloud_id, submitted_by, submitted_at, file_hash,
                    game_date, season, opponent_name, tournament_name,
                    score_us, score_them, raw_json, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')""",
            (
                team["team_cloud_id"],
                req.email,
                submitted_at,
                file_hash,
                game.get("date"),
                game.get("season"),
                game.get("opponent"),
                game.get("tournament") or None,
                game.get("score_us"),
                game.get("score_them"),
                raw_str,
            ),
        )
        submission_id = cursor.lastrowid

        # 5. Audit trail
        conn.execute(
            """INSERT INTO ua_upload_audit_log (submission_id, action, actor, detail, at)
               VALUES (?, 'submitted', ?, ?, ?)""",
            (
                submission_id,
                req.email,
                f"{game.get('date')} · {game.get('team_name')} vs {game.get('opponent')}",
                submitted_at,
            ),
        )
        conn.commit()

    log.info("UA submission #%d received from %s (%s)", submission_id, req.email, game.get("date"))

    return {
        "ok":            True,
        "submission_id": submission_id,
        "status":        "pending",
    }
