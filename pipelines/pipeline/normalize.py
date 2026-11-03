"""Cross-league name + coordinate normalization helpers.

This module is intentionally minimal in Milestone 0. It will grow as the
full identity-resolution pipeline (build_guide.md §4b) is implemented.
"""
from __future__ import annotations

import re
import unicodedata


def normalize_name(name: str) -> str:
    """Lowercase, strip accents, collapse whitespace, remove punctuation."""
    if not name:
        return ""
    name = unicodedata.normalize("NFKD", name)
    name = "".join(c for c in name if not unicodedata.combining(c))
    name = name.lower()
    name = re.sub(r"[\.,]", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    return name


def normalize_to_attacking_direction(
    raw_x: float,
    raw_y: float,
    attacking_toward_top: bool,
    field_length: float = 120.0,
    field_width: float = 53.3,
) -> tuple[float, float]:
    """Map raw absolute field coordinates to the [0,1]^2 attacking system."""
    nx = max(0.0, min(1.0, raw_x / field_width))
    ny = max(0.0, min(1.0, raw_y / field_length))
    if not attacking_toward_top:
        ny = 1.0 - ny
    return nx, ny
