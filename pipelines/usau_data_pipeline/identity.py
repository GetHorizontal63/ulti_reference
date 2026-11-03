"""
Phase 6 — Player Identity Resolution (post-processing).

Runs after Phase 4 (and optionally Phase 5) to build the player_identities
table and assign player_surrogate_id back to the players table.

Steps:
  1. Normalize all player names (lowercase, strip punctuation/suffixes).
  2. Exact-match pass: create one player_identities row per unique normalized name.
  3. Fuzzy-match pass (requires rapidfuzz): flag near-duplicate names for review.
  4. Write review_queue.csv for manual adjudication.

Usage:
  from identity import run_phase6
  run_phase6(conn, review_csv_path)
"""
import csv
import logging
import re
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

try:
    from rapidfuzz import fuzz, process as rf_process
    _RAPIDFUZZ_AVAILABLE = True
except ImportError:
    _RAPIDFUZZ_AVAILABLE = False
    logger.warning("rapidfuzz not installed — fuzzy name matching disabled (pip install rapidfuzz)")

# Fuzzy score threshold: pairs above this are written to review_queue.csv
FUZZY_THRESHOLD = 85  # 0–100 scale


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_phase6(conn: sqlite3.Connection, review_csv_path: Path) -> None:
    logger.info("Phase 6: Player identity resolution")

    players = conn.execute(
        "SELECT id, player_name, event_team_id, event_slug FROM players ORDER BY player_name"
    ).fetchall()
    logger.info("  %d player records loaded", len(players))

    # --- Build name groups -----------------------------------------------
    name_groups: dict[str, list] = {}
    for p in players:
        norm = normalize_name(p["player_name"])
        if norm:
            name_groups.setdefault(norm, []).append(p)

    identity_map: dict[str, int] = {}  # normalized_name -> identity_id

    # --- Exact-match pass ------------------------------------------------
    for norm_name, group in name_groups.items():
        existing = conn.execute(
            "SELECT id FROM player_identities WHERE canonical_name=?", (norm_name,)
        ).fetchone()

        if existing:
            identity_id = existing["id"]
        else:
            canonical = _most_common_name([p["player_name"] for p in group])
            first_p   = group[0]
            cursor = conn.execute(
                "INSERT INTO player_identities (canonical_name, first_seen_event, first_seen_team) "
                "VALUES (?, ?, ?)",
                (canonical, first_p["event_slug"], first_p["event_team_id"]),
            )
            conn.commit()
            identity_id = cursor.lastrowid

        identity_map[norm_name] = identity_id

        for p in group:
            conn.execute(
                "UPDATE players SET player_surrogate_id=? WHERE id=?",
                (identity_id, p["id"]),
            )
    conn.commit()
    logger.info("  Created/matched %d player identities", len(identity_map))

    # --- Fuzzy-match pass (writes review CSV) ----------------------------
    review_queue: list[dict] = []

    if _RAPIDFUZZ_AVAILABLE:
        norm_names    = list(name_groups.keys())
        reviewed_pairs: set = set()

        for name_a in norm_names:
            matches = rf_process.extract(
                name_a,
                norm_names,
                scorer=fuzz.ratio,
                limit=10,
                score_cutoff=75,
            )
            for match_name, score, _ in matches:
                if match_name == name_a:
                    continue
                pair = tuple(sorted([name_a, match_name]))
                if pair in reviewed_pairs:
                    continue
                reviewed_pairs.add(pair)

                if score >= FUZZY_THRESHOLD:
                    review_queue.append({
                        "name_a":      name_a,
                        "name_b":      match_name,
                        "score":       score,
                        "action":      "review",
                        "identity_a":  identity_map.get(name_a),
                        "identity_b":  identity_map.get(match_name),
                    })

    if review_queue:
        review_csv_path.parent.mkdir(parents=True, exist_ok=True)
        with open(review_csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=["name_a", "name_b", "score", "action", "identity_a", "identity_b"],
            )
            writer.writeheader()
            writer.writerows(review_queue)
        logger.info("  %d fuzzy-match candidates written to %s", len(review_queue), review_csv_path)
    else:
        logger.info("  No fuzzy-match candidates found (or rapidfuzz unavailable)")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def normalize_name(name: str) -> str:
    """Lowercase and strip punctuation/suffixes for comparison."""
    if not name:
        return ""
    name = name.lower().strip()
    # Strip common name suffixes
    name = re.sub(r"\b(jr\.?|sr\.?|ii|iii|iv)\b", "", name)
    # Remove apostrophes, hyphens, periods (treat as word separators)
    name = re.sub(r"['\-\.]", " ", name)
    # Collapse whitespace
    name = re.sub(r"\s+", " ", name).strip()
    return name


def _most_common_name(names: list) -> str:
    """Return the most frequently occurring string from a list."""
    if not names:
        return ""
    return Counter(names).most_common(1)[0][0]
