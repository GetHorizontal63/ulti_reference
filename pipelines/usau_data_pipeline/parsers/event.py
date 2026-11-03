"""
Phase 2 parser: USAU event landing page.

Extracts event_id and event_group_id from the embedded checkStandings JS call,
plus any city/state and division metadata available in the page header.
"""
import re
import logging
from typing import Optional

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


def parse_event_landing(html: str) -> dict:
    """
    Parse an event landing page.
    Returns a dict with: event_id, event_group_id, city, state, divisions_present.
    All keys are present; values may be None if not found.
    """
    result: dict = {
        "event_id":         None,
        "event_group_id":   None,
        "city":             None,
        "state":            None,
        "divisions_present": [],
    }

    # --- JS extraction --------------------------------------------------
    # The checkStandings call looks like:  { event: 14412, eventGroup: 19538, ... }
    event_id_m      = re.search(r"\bevent\s*:\s*(\d+)", html)
    event_group_id_m = re.search(r"\beventGroup\s*:\s*(\d+)", html)

    if event_id_m:
        result["event_id"] = int(event_id_m.group(1))
    if event_group_id_m:
        result["event_group_id"] = int(event_group_id_m.group(1))

    soup = BeautifulSoup(html, "lxml")

    # --- Location -------------------------------------------------------
    # Try several known selectors; take the first match
    for sel in (
        "#CT_Main_0_dlLocation dd",
        ".event-location",
        ".location",
        "dd.location",
    ):
        el = soup.select_one(sel)
        if el:
            loc = el.get_text(strip=True)
            if "," in loc:
                parts = loc.split(",", 1)
                result["city"]  = parts[0].strip() or None
                result["state"] = parts[1].strip() or None
            break

    # --- Divisions present -----------------------------------------------
    divisions = []
    for dt in soup.find_all("dt", class_="groupTitle"):
        text = dt.get_text(strip=True)
        if text:
            divisions.append(text)
    result["divisions_present"] = divisions

    return result
