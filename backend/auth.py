"""JWT auth utilities and FastAPI tier dependency helpers."""
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext

_SECRET: str = os.environ.get("JWT_SECRET", "")
if not _SECRET or _SECRET == "CHANGE_ME_IN_PRODUCTION":
    # Never sign tokens with a guessable default. A per-process random secret
    # keeps local dev working; tokens just stop validating after a restart.
    logging.getLogger(__name__).warning(
        "JWT_SECRET not set — using a random per-process secret (dev only)"
    )
    _SECRET = secrets.token_urlsafe(64)
_ALGO: str = "HS256"
_EXPIRE_DAYS: int = 7

# Individual:  free < pro < analyst
# Team org:     hs_team < college_team < club_team < pro_team
# college_team includes analyst-level individual access; club/pro_team exceed it
TIER_RANK: dict[str, int] = {
    "free":         0,
    "pro":          1,
    "analyst":      2,
    "hs_team":      1,   # free team tier, similar access to individual pro
    "college_team": 3,   # $29/mo — individual analyst + team scouting
    "club_team":    4,   # $79/mo
    "pro_team":     5,   # $199/mo
}

_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
_bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    return _pwd_ctx.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_ctx.verify(plain, hashed)


# ---------------------------------------------------------------------------
# Token helpers
# ---------------------------------------------------------------------------

def create_token(user_id: int, tier: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=_EXPIRE_DAYS)
    return jwt.encode(
        {"sub": str(user_id), "tier": tier, "exp": exp},
        _SECRET,
        algorithm=_ALGO,
    )


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, _SECRET, algorithms=[_ALGO])
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """Require a valid JWT; returns {'id': int, 'tier': str}."""
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = _decode_token(creds.credentials)
    return {"id": int(payload["sub"]), "tier": payload.get("tier", "free")}


def get_current_user_optional(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict | None:
    """Like get_current_user but returns None instead of raising for missing/bad token."""
    if not creds:
        return None
    try:
        payload = _decode_token(creds.credentials)
        return {"id": int(payload["sub"]), "tier": payload.get("tier", "free")}
    except HTTPException:
        return None


def require_tier(min_tier: str):
    """Return a FastAPI dependency that enforces a minimum subscription tier."""
    def _dep(user: dict = Depends(get_current_user)) -> dict:
        if TIER_RANK.get(user["tier"], 0) < TIER_RANK[min_tier]:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail=f"This feature requires a '{min_tier}' subscription.",
            )
        return user
    return _dep
