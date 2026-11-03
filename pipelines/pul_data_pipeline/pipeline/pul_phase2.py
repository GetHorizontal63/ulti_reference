"""
PUL Phase 2 — Populate master_players from pul_player_season_stats.

For every distinct player URL in pul_player_season_stats:
  1. Derive PUL_ID from the URL path slug
     - Strip the base URL, take the final path segment
     - Replace every run of %20/%22 (and combinations) with a single underscore
  2. Derive FirstName / LastName from the raw (percent-encoded) slug
     - FirstName: text before the first %20
     - LastName:  text after the last %20 (decode %22 groups away)
  3. Upsert into master_players via upsert_master_player_pul
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path
from urllib.parse import unquote
from pipelines.pul_data_pipeline.parsers.pul_player_table import _canonical_url, _canonical_name

_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_ROOT / "usau_data_pipeline"))

from db import upsert_master_player_pul  # noqa: E402

logger = logging.getLogger(__name__)


def _slug_from_url(url: str) -> str:
    """Convert a canonical player profile URL to a PUL_ID slug.

    https://pul-stats-hub.pages.dev/players/Eliana%20%22Ana%22%20Harnage
    → Eliana_Harnage
    https://pul-stats-hub.pages.dev/players/Katrina%20McGuire
    → Katrina_McGuire
    """
    canonical = _canonical_url(url)  # strip any nickname first
    path = canonical.rstrip("/").rsplit("/", 1)[-1]
    slug = path.replace("%20", "_")
    return slug


def _name_parts(raw_path: str) -> tuple[str, str, str]:
    """Return (full_name, first_name, last_name) from a raw percent-encoded path segment.

    Nicknames (quoted substrings) are stripped before parsing.
    """
    # Decode and strip nickname
    decoded = unquote(raw_path)
    full_name = _canonical_name(decoded)

    parts = full_name.split()
    first_name = parts[0] if parts else ""
    last_name  = parts[-1] if len(parts) > 1 else ""

    return full_name, first_name, last_name


def run_pul_phase2(conn) -> None:
    """Upsert every distinct PUL player into master_players."""
    logger.info("PUL Phase 2: populate master_players from pul_player_season_stats")

    rows = conn.execute(
        "SELECT DISTINCT player_url FROM pul_player_season_stats WHERE player_url != ''"
    ).fetchall()

    base = "https://pul-stats-hub.pages.dev/players/"
    inserted = 0
    updated = 0

    for (url,) in rows:
        if not url.startswith(base):
            logger.warning("  Unexpected URL format, skipping: %s", url)
            continue

        raw_segment = url[len(base):].rstrip("/")
        pul_id = _slug_from_url(url)
        full_name, first_name, last_name = _name_parts(raw_segment)

        existing = conn.execute(
            "SELECT ID FROM master_players WHERE PUL_ID = ?", (pul_id,)
        ).fetchone()

        upsert_master_player_pul(conn, pul_id, full_name, first_name, last_name)

        if existing:
            updated += 1
        else:
            inserted += 1

    logger.info(
        "PUL Phase 2 complete: %d inserted, %d updated in master_players",
        inserted,
        updated,
    )
