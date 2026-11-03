"""Stripe billing routes — checkout, billing portal, and webhook."""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel

from auth import get_current_user

router = APIRouter(prefix="/api/stripe", tags=["stripe"])

DB_PATH = Path(os.environ.get("UFA_DB_PATH") or Path(__file__).resolve().parents[1] / "data" / "db" / "ultimate.db")

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

# Individual price IDs
_PRICE_PRO_MONTHLY       = os.environ.get("STRIPE_PRICE_PRO_MONTHLY", "")
_PRICE_PRO_ANNUAL        = os.environ.get("STRIPE_PRICE_PRO_ANNUAL", "")
_PRICE_ANALYST_MONTHLY   = os.environ.get("STRIPE_PRICE_ANALYST_MONTHLY", "")
_PRICE_ANALYST_ANNUAL    = os.environ.get("STRIPE_PRICE_ANALYST_ANNUAL", "")
# Team org price IDs
_PRICE_COLLEGE_MONTHLY   = os.environ.get("STRIPE_PRICE_COLLEGE_MONTHLY", "")
_PRICE_COLLEGE_ANNUAL    = os.environ.get("STRIPE_PRICE_COLLEGE_ANNUAL", "")
_PRICE_CLUB_MONTHLY      = os.environ.get("STRIPE_PRICE_CLUB_MONTHLY", "")
_PRICE_CLUB_ANNUAL       = os.environ.get("STRIPE_PRICE_CLUB_ANNUAL", "")
_PRICE_PRO_TEAM_MONTHLY  = os.environ.get("STRIPE_PRICE_PRO_TEAM_MONTHLY", "")
_PRICE_PRO_TEAM_ANNUAL   = os.environ.get("STRIPE_PRICE_PRO_TEAM_ANNUAL", "")

# Map Stripe price IDs → tier name
_PRICE_TO_TIER: dict[str, str] = {}


def _build_price_map() -> None:
    """Called lazily so env vars are read at request time, not import time."""
    _PRICE_TO_TIER.clear()
    for price_id, tier in [
        (_PRICE_PRO_MONTHLY,      "pro"),
        (_PRICE_PRO_ANNUAL,       "pro"),
        (_PRICE_ANALYST_MONTHLY,  "analyst"),
        (_PRICE_ANALYST_ANNUAL,   "analyst"),
        (_PRICE_COLLEGE_MONTHLY,  "college_team"),
        (_PRICE_COLLEGE_ANNUAL,   "college_team"),
        (_PRICE_CLUB_MONTHLY,     "club_team"),
        (_PRICE_CLUB_ANNUAL,      "club_team"),
        (_PRICE_PRO_TEAM_MONTHLY, "pro_team"),
        (_PRICE_PRO_TEAM_ANNUAL,  "pro_team"),
    ]:
        if price_id:
            _PRICE_TO_TIER[price_id] = tier


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _get_or_create_customer(conn: sqlite3.Connection, user_id: int, email: str) -> str:
    """Return existing Stripe customer_id or create a new one."""
    row = conn.execute(
        "SELECT stripe_customer_id FROM auth_subscriptions WHERE user_id = ? AND stripe_customer_id IS NOT NULL LIMIT 1",
        (user_id,),
    ).fetchone()
    if row:
        return row["stripe_customer_id"]
    customer = stripe.Customer.create(email=email, metadata={"user_id": str(user_id)})
    return customer["id"]


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class CheckoutRequest(BaseModel):
    price_id: str
    success_url: str
    cancel_url: str


class PortalRequest(BaseModel):
    return_url: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/checkout")
def create_checkout(body: CheckoutRequest, user: dict = Depends(get_current_user)):
    _build_price_map()
    if body.price_id not in _PRICE_TO_TIER:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Unknown price ID.")
    if not stripe.api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Billing not configured.")

    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT email FROM auth_users WHERE id = ?", (user["id"],)
        ).fetchone()
        if not row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found.")
        customer_id = _get_or_create_customer(conn, user["id"], row["email"])
    finally:
        conn.close()

    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=[{"price": body.price_id, "quantity": 1}],
        success_url=body.success_url,
        cancel_url=body.cancel_url,
        metadata={"user_id": str(user["id"])},
    )
    return {"url": session["url"]}


@router.post("/portal")
def billing_portal(body: PortalRequest, user: dict = Depends(get_current_user)):
    if not stripe.api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Billing not configured.")

    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT stripe_customer_id FROM auth_subscriptions WHERE user_id = ? AND stripe_customer_id IS NOT NULL LIMIT 1",
            (user["id"],),
        ).fetchone()
        if not row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No active subscription found.")
        customer_id = row["stripe_customer_id"]
    finally:
        conn.close()

    portal = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=body.return_url,
    )
    return {"url": portal["url"]}


@router.post("/webhook", status_code=status.HTTP_204_NO_CONTENT)
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(None, alias="stripe-signature"),
):
    """Handle Stripe webhook events to keep subscription state in sync."""
    if not _WEBHOOK_SECRET:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="Webhook not configured.")

    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(payload, stripe_signature, _WEBHOOK_SECRET)
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid webhook signature.")

    _build_price_map()
    conn = _get_conn()
    try:
        if event["type"] == "checkout.session.completed":
            _handle_checkout_completed(conn, event["data"]["object"])
        elif event["type"] == "customer.subscription.updated":
            _handle_subscription_updated(conn, event["data"]["object"])
        elif event["type"] == "customer.subscription.deleted":
            _handle_subscription_deleted(conn, event["data"]["object"])
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Webhook handlers
# ---------------------------------------------------------------------------

def _handle_checkout_completed(conn: sqlite3.Connection, session: dict) -> None:
    user_id_str = (session.get("metadata") or {}).get("user_id")
    if not user_id_str:
        return
    user_id = int(user_id_str)
    customer_id: str = session.get("customer", "")
    subscription_id: str = session.get("subscription", "")

    if not subscription_id:
        return

    sub = stripe.Subscription.retrieve(subscription_id)
    price_id: str = sub["items"]["data"][0]["price"]["id"]
    tier = _PRICE_TO_TIER.get(price_id, "pro")
    period_end: str = str(sub["current_period_end"])
    sub_status: str = sub["status"]

    conn.execute(
        """
        INSERT INTO auth_subscriptions
            (user_id, tier, stripe_customer_id, stripe_subscription_id,
             stripe_price_id, status, current_period_end, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime(?, 'unixepoch'), datetime('now'))
        ON CONFLICT(stripe_subscription_id) DO UPDATE SET
            tier                   = excluded.tier,
            stripe_customer_id     = excluded.stripe_customer_id,
            stripe_price_id        = excluded.stripe_price_id,
            status                 = excluded.status,
            current_period_end     = excluded.current_period_end,
            updated_at             = datetime('now')
        """,
        (user_id, tier, customer_id, subscription_id, price_id, sub_status, period_end),
    )
    conn.commit()


def _handle_subscription_updated(conn: sqlite3.Connection, sub: dict) -> None:
    subscription_id: str = sub["id"]
    price_id: str = sub["items"]["data"][0]["price"]["id"]
    tier = _PRICE_TO_TIER.get(price_id, "pro")
    period_end: str = str(sub["current_period_end"])
    sub_status: str = sub["status"]

    conn.execute(
        """
        UPDATE auth_subscriptions SET
            tier               = ?,
            stripe_price_id    = ?,
            status             = ?,
            current_period_end = datetime(?, 'unixepoch'),
            updated_at         = datetime('now')
        WHERE stripe_subscription_id = ?
        """,
        (tier, price_id, sub_status, period_end, subscription_id),
    )
    conn.commit()


def _handle_subscription_deleted(conn: sqlite3.Connection, sub: dict) -> None:
    subscription_id: str = sub["id"]
    conn.execute(
        """
        UPDATE auth_subscriptions SET
            tier       = 'free',
            status     = 'canceled',
            updated_at = datetime('now')
        WHERE stripe_subscription_id = ?
        """,
        (subscription_id,),
    )
    conn.commit()
