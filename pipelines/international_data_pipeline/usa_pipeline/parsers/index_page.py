"""
Parser for USAU Team USA index pages.

Scrapes the five competition-type landing pages:
  - world-championships  (event_type = wugc)
  - u20                  (event_type = u20)
  - u24                  (event_type = u24)
  - world-games          (event_type = world_games)
  - beach                (event_type = wcbu)

Each page contains one or more <div class="division"> blocks, each with:
  - <div class="division-header"><h4>{Division}</h4></div>
  - <table class="results"> with rows: year | location | record | finish | View link

Returns a list of dicts ready for upsert_tournament().
"""
from __future__ import annotations

import logging
import re
from typing import Optional

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


def _division_slug(name: str) -> str:
    """'Men's Masters' -> 'mens_masters', 'U20 Boys' -> 'u20_boys'"""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def _parse_record(record_text: str) -> tuple[Optional[int], Optional[int]]:
    """'12-0' -> (12, 0), '' -> (None, None)"""
    m = re.match(r"(\d+)[–\-](\d+)", record_text.strip())
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


def _parse_finish(finish_td) -> Optional[str]:
    """Extract finish text from the finish <td> — e.g. '1st', '2nd'."""
    span = finish_td.find("span", class_="medal")
    if span:
        return span.get_text(strip=True)
    p = finish_td.find("p")
    if p:
        return p.get_text(strip=True) or None
    return finish_td.get_text(strip=True) or None


def parse_index_page(html: str, event_type: str, scraped_at: str) -> list[dict]:
    """
    Parse one index page and return a list of tournament dicts.

    Each dict has keys:
      tournament_key, event_type, division, year, location,
      wins, losses, finish, detail_url, scraped_at
    """
    soup = BeautifulSoup(html, "html.parser")
    results: list[dict] = []

    for div_block in soup.find_all("div", class_="division"):
        header = div_block.find("div", class_="division-header")
        h4 = header.find("h4") if header else None
        division = h4.get_text(strip=True) if h4 else "Unknown"

        table = div_block.find("table", class_="results")
        if not table:
            continue
        tbody = table.find("tbody")
        if not tbody:
            continue

        for tr in tbody.find_all("tr"):
            tds = {td.get("class", [""])[0]: td for td in tr.find_all("td")}

            year_td    = tds.get("year")
            loc_td     = tds.get("location")
            record_td  = tds.get("record")
            finish_td  = tds.get("finish")
            details_td = tds.get("details")

            if not year_td:
                continue

            year_text = year_td.find("p")
            year_text = year_text.get_text(strip=True) if year_text else ""
            if not year_text.isdigit():
                continue
            year = int(year_text)

            location = ""
            if loc_td:
                p = loc_td.find("p")
                location = p.get_text(strip=True) if p else loc_td.get_text(strip=True)

            wins, losses = None, None
            if record_td:
                p = record_td.find("p")
                record_text = p.get_text(strip=True) if p else ""
                wins, losses = _parse_record(record_text)

            finish = _parse_finish(finish_td) if finish_td else None

            detail_url = None
            if details_td:
                a = details_td.find("a", href=True)
                if a:
                    detail_url = a["href"]

            tournament_key = f"{event_type}_{_division_slug(division)}_{year}"

            results.append(
                {
                    "tournament_key": tournament_key,
                    "event_type":     event_type,
                    "division":       division,
                    "year":           year,
                    "location":       location or None,
                    "wins":           wins,
                    "losses":         losses,
                    "finish":         finish,
                    "detail_url":     detail_url,
                    "scraped_at":     scraped_at,
                }
            )

    logger.debug(
        "parse_index_page(%s): found %d tournament entries", event_type, len(results)
    )
    return results
