"""Authentication and user-account routes."""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from auth import (
    create_token,
    get_current_user,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

DB_PATH = Path(os.environ.get("UFA_DB_PATH") or Path(__file__).resolve().parents[1] / "data" / "db" / "ultimate.db")


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    display_name: str | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TIER_RANK_LOCAL = {
    "free": 0, "pro": 1, "analyst": 2,
    "hs_team": 1, "college_team": 3, "club_team": 4, "pro_team": 5,
}


def _user_tier(conn: sqlite3.Connection, user_id: int) -> str:
    """Return the highest active tier across individual + org-team memberships."""
    # Direct individual subscriptions
    ind_rows = conn.execute(
        """
        SELECT tier FROM auth_subscriptions
        WHERE user_id = ? AND org_team_id IS NULL
          AND status IN ('active', 'trialing')
        """,
        (user_id,),
    ).fetchall()
    # Team org subscriptions the user belongs to
    team_rows = conn.execute(
        """
        SELECT s.tier FROM auth_subscriptions s
        JOIN auth_org_members m ON m.org_team_id = s.org_team_id
        WHERE m.user_id = ? AND s.status IN ('active', 'trialing')
        """,
        (user_id,),
    ).fetchall()
    all_tiers = [r["tier"] for r in ind_rows] + [r["tier"] for r in team_rows]
    if not all_tiers:
        return "free"
    return max(all_tiers, key=lambda t: _TIER_RANK_LOCAL.get(t, 0))


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest):
    conn = _get_conn()
    try:
        existing = conn.execute(
            "SELECT id FROM auth_users WHERE email = ?", (body.email,)
        ).fetchone()
        if existing:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Email already registered.")

        pw_hash = hash_password(body.password)
        cur = conn.execute(
            "INSERT INTO auth_users (email, password_hash, display_name) VALUES (?, ?, ?)",
            (body.email, pw_hash, body.display_name),
        )
        conn.commit()
        user_id: int = cur.lastrowid  # type: ignore[assignment]
        token = create_token(user_id, "free")
        return {
            "token": token,
            "user": {"id": user_id, "email": body.email, "display_name": body.display_name, "tier": "free"},
        }
    finally:
        conn.close()


@router.post("/login")
def login(body: LoginRequest):
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT id, password_hash, display_name FROM auth_users WHERE email = ?",
            (body.email,),
        ).fetchone()
        if not row or not verify_password(body.password, row["password_hash"]):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")

        user_id: int = row["id"]
        tier = _user_tier(conn, user_id)
        token = create_token(user_id, tier)
        return {
            "token": token,
            "user": {"id": user_id, "email": body.email, "display_name": row["display_name"], "tier": tier},
        }
    finally:
        conn.close()


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT id, email, display_name, created_at FROM auth_users WHERE id = ?",
            (user["id"],),
        ).fetchone()
        if not row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found.")
        tier = _user_tier(conn, user["id"])
        return {
            "id": row["id"],
            "email": row["email"],
            "display_name": row["display_name"],
            "created_at": row["created_at"],
            "tier": tier,
        }
    finally:
        conn.close()


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout():
    """JWT is stateless — client simply discards the token."""
    return
