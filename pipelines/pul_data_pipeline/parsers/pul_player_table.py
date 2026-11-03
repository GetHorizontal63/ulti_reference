"""
PUL player table parser.

Takes a list of row dicts (scraped by Playwright from pul-stats-hub.pages.dev/players)
and normalises them into clean dicts ready for DB insertion.
"""
from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import unquote

logger = logging.getLogger(__name__)

IDENTITY_COLS = {"player_name", "player_url", "team"}

_HEADER_NORMALIZE = {
    "+/-":                "plus_minus",
    "2nd ast":            "second_ast",
    "poss. init.":        "poss_init",
    "throw. err":         "throw_err",
    "rec. err":           "rec_err",
    "throwing yards":     "throwing_yards",
    "throwing yards avg": "throwing_yards_avg",
    "catching yards":     "catching_yards",
    "catching yards avg": "catching_yards_avg",
    "games played":       "games_played",
    "total pts":          "total_pts",
    "o-pts":              "o_pts",
    "d-pts":              "d_pts",
}

_INT_COLS = {
    "games_played", "goals", "assists", "blocks", "turnovers",
    "touches", "o_pts", "d_pts", "total_pts",
    "throws", "catches", "second_ast", "poss_init",
    "throw_err", "rec_err",
}
_FLOAT_COLS = {
    "plus_minus",
    "throwing_yards", "throwing_yards_avg",
    "catching_yards", "catching_yards_avg",
}

_JERSEY_RE = re.compile(r"^#\d+\s*")


def _canonical_name(name: str) -> str:
    """Strip nickname substrings (quoted text) from a player display name.

    'Katrina "Kat" McGuire' -> 'Katrina McGuire'
    """
    return re.sub(r'\s*"[^"]*"\s*', " ", name).strip()


def _canonical_url(url: str) -> str:
    """Return the canonical player profile URL with any nickname stripped.

    https://pul-stats-hub.pages.dev/players/Katrina%20%22Kat%22%20McGuire
    -> https://pul-stats-hub.pages.dev/players/Katrina%20McGuire
    """
    base = "https://pul-stats-hub.pages.dev/players/"
    if not url.startswith(base):
        return url
    path = url[len(base):].rstrip("/")
    decoded = unquote(path)
    canonical = _canonical_name(decoded)
    return base + canonical.replace(" ", "%20")


def _normalize_header(text):
    clean = re.sub(r"[\u2191\u2193\u2195\n\r]+", "", text).strip()
    lower = clean.lower()
    if lower in _HEADER_NORMALIZE:
        return _HEADER_NORMALIZE[lower]
    slug = re.sub(r"[^a-z0-9]+", "_", lower).strip("_")
    return slug if slug else f"col_{abs(hash(text)) % 10000}"


def _coerce(key, value):
    v = value.strip().replace(",", "")
    if v in ("", "-", "N/A", "n/a"):
        return None
    if key in _INT_COLS:
        try:
            return int(v)
        except ValueError:
            return None
    if key in _FLOAT_COLS:
        try:
            return float(v.rstrip("%"))
        except ValueError:
            return None
    try:
        return float(v) if "." in v else int(v)
    except ValueError:
        return v


def _clean_player_name(raw_name, player_url):
    if player_url:
        segment = player_url.rstrip("/").rsplit("/", 1)[-1]
        decoded = unquote(segment)
        if decoded:
            return _canonical_name(decoded)
    return _canonical_name(_JERSEY_RE.sub("", raw_name).strip())


def parse_player_rows(raw_rows, season, scraped_at):
    out = []
    for raw in raw_rows:
        raw_name = raw.get("player_name", "").strip()
        player_url = raw.get("player_url", "").strip()
        row = {
            "player_name": _clean_player_name(raw_name, player_url),
            "player_url": _canonical_url(player_url) if player_url else player_url,
            "team": raw.get("team", "").strip(),
            "season": season,
            "scraped_at": scraped_at,
        }
        for raw_key, raw_val in raw.items():
            if raw_key in IDENTITY_COLS:
                continue
            col = _normalize_header(raw_key)
            row[col] = _coerce(col, str(raw_val))
        if not row["player_name"]:
            logger.debug("Skipping row with empty player_name: %s", raw)
            continue
        out.append(row)
    logger.info("  Parsed %d player rows for season %s", len(out), season)
    return out