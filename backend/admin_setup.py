"""
Admin whitelist setup utility.

Run this script once (locally) to configure the admin access list.

Usage:
    python backend/admin_setup.py

    # Allow all Tailscale IPs (100.64.0.0/10):
    python backend/admin_setup.py --allow-tailscale

    # Add a specific Tailscale (or other) IP:
    python backend/admin_setup.py --add-ip 100.x.y.z

    # Add a custom CIDR range:
    python backend/admin_setup.py --add-cidr 100.100.0.0/24

    # Remove a CIDR range:
    python backend/admin_setup.py --remove-cidr 100.64.0.0/10

    # Reset token:
    python backend/admin_setup.py --reset-token

    # Print hash of a value (useful for debugging):
    python backend/admin_setup.py --hash 100.x.y.z
"""
from __future__ import annotations

import os
import argparse
import getpass
import hashlib
import ipaddress
import json
from pathlib import Path

WHITELIST_PATH   = Path(os.environ.get("UFA_STATE_DIR") or Path(__file__).resolve().parents[1] / "data" / "state") / "whitelist.json"
TAILSCALE_CIDR   = "100.64.0.0/10"


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def is_tailscale(ip: str) -> bool:
    try:
        return ipaddress.ip_address(ip) in ipaddress.ip_network(TAILSCALE_CIDR, strict=False)
    except ValueError:
        return False


def load() -> dict:
    if WHITELIST_PATH.exists():
        with open(WHITELIST_PATH) as f:
            return json.load(f)
    return {"ip_hashes": [], "allowed_cidrs": [], "token_hash": ""}


def save(data: dict) -> None:
    # Ensure allowed_cidrs key always present
    data.setdefault("allowed_cidrs", [])
    with open(WHITELIST_PATH, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Saved → {WHITELIST_PATH}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage the admin IP/CIDR whitelist.")
    parser.add_argument("--add-ip",          metavar="IP",   help="Add a specific IP address (hashed server-side)")
    parser.add_argument("--remove-ip",       metavar="HASH", help="Remove an IP hash from the whitelist")
    parser.add_argument("--allow-tailscale", action="store_true", help=f"Allow all Tailscale IPs ({TAILSCALE_CIDR})")
    parser.add_argument("--add-cidr",        metavar="CIDR", help="Allow a custom CIDR range")
    parser.add_argument("--remove-cidr",     metavar="CIDR", help="Remove a CIDR range")
    parser.add_argument("--reset-token",     action="store_true", help="Set / reset the admin token")
    parser.add_argument("--hash",            metavar="VALUE", help="Print SHA-256 of VALUE and exit")
    parser.add_argument("--show",            action="store_true", help="Show current whitelist state")
    args = parser.parse_args()

    if args.hash:
        print(sha256(args.hash))
        return

    wl = load()

    if args.show:
        print(f"IP hashes ({len(wl.get('ip_hashes', []))}):")
        for h in wl.get("ip_hashes", []):
            print(f"  {h}")
        cidrs = wl.get("allowed_cidrs", [])
        print(f"\nAllowed CIDRs ({len(cidrs)}):")
        for c in cidrs:
            ts = "  ← Tailscale" if c == TAILSCALE_CIDR else ""
            print(f"  {c}{ts}")
        print(f"\nToken hash set: {bool(wl.get('token_hash'))}")
        return

    if args.add_ip:
        ts_note = "  (Tailscale IP)" if is_tailscale(args.add_ip) else ""
        h = sha256(args.add_ip)
        if h not in wl.setdefault("ip_hashes", []):
            wl["ip_hashes"].append(h)
            print(f"Added IP {args.add_ip!r}{ts_note}  →  {h}")
        else:
            print(f"IP {args.add_ip!r} already in whitelist.")
        save(wl)
        return

    if args.remove_ip:
        before = len(wl.get("ip_hashes", []))
        wl["ip_hashes"] = [h for h in wl.get("ip_hashes", []) if h != args.remove_ip]
        print(f"Removed {before - len(wl['ip_hashes'])} hash(es).")
        save(wl)
        return

    if args.allow_tailscale:
        wl.setdefault("allowed_cidrs", [])
        if TAILSCALE_CIDR not in wl["allowed_cidrs"]:
            wl["allowed_cidrs"].append(TAILSCALE_CIDR)
            print(f"Allowed all Tailscale IPs via CIDR {TAILSCALE_CIDR}")
        else:
            print(f"Tailscale CIDR {TAILSCALE_CIDR} already present.")
        save(wl)
        return

    if args.add_cidr:
        try:
            ipaddress.ip_network(args.add_cidr, strict=False)
        except ValueError as exc:
            print(f"Error: invalid CIDR — {exc}")
            return
        wl.setdefault("allowed_cidrs", [])
        if args.add_cidr not in wl["allowed_cidrs"]:
            wl["allowed_cidrs"].append(args.add_cidr)
            print(f"Added CIDR {args.add_cidr!r}")
        else:
            print(f"CIDR {args.add_cidr!r} already present.")
        save(wl)
        return

    if args.remove_cidr:
        before = len(wl.get("allowed_cidrs", []))
        wl["allowed_cidrs"] = [c for c in wl.get("allowed_cidrs", []) if c != args.remove_cidr]
        print(f"Removed {before - len(wl['allowed_cidrs'])} CIDR(s).")
        save(wl)
        return

    if args.reset_token:
        token = getpass.getpass("New admin token (input hidden): ")
        if not token.strip():
            print("Error: token cannot be empty.")
            return
        wl["token_hash"] = sha256(token.strip())
        print("Token hash updated.")
        save(wl)
        return

    # ── Interactive first-time setup ──────────────────────────────────────────
    print("=== Ultimate Reference — Admin Setup ===\n")
    print("All values are stored as SHA-256 hashes — plain text is never saved.\n")

    print("IP Authorization — choose one:")
    print("  1) Allow all Tailscale IPs automatically (100.64.0.0/10)")
    print("  2) Enter specific Tailscale (or other) IP addresses")
    print("  3) Both\n")
    choice = input("Choice [1/2/3]: ").strip()

    wl.setdefault("ip_hashes", [])
    wl.setdefault("allowed_cidrs", [])

    if choice in {"1", "3"}:
        if TAILSCALE_CIDR not in wl["allowed_cidrs"]:
            wl["allowed_cidrs"].append(TAILSCALE_CIDR)
        print(f"→ Added Tailscale CIDR: {TAILSCALE_CIDR}")

    if choice in {"2", "3"}:
        while True:
            ip_input = input("Enter an IP to whitelist (leave blank to stop): ").strip()
            if not ip_input:
                break
            ts_note = "  (Tailscale)" if is_tailscale(ip_input) else ""
            h = sha256(ip_input)
            if h not in wl["ip_hashes"]:
                wl["ip_hashes"].append(h)
            print(f"  → {ip_input}{ts_note}  →  {h}")

    print()
    token = getpass.getpass("Enter a secret admin token (input hidden): ")
    if not token.strip():
        print("Error: token cannot be empty.")
        return

    wl["token_hash"] = sha256(token.strip())

    save(wl)
    print("\nSetup complete. Keep your token secret.")
    print("Run this script again to add more IPs or CIDRs.")


if __name__ == "__main__":
    main()
