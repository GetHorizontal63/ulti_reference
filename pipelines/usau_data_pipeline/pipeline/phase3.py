"""
Phase 3 — Division Schedule Pages.

Uses known gender/competition_level metadata from Phase 1 to generate targeted
URL candidates instead of probing all 36 combinations blindly.
  - Club/College events: 1 candidate each
  - Youth events: up to 6 candidates each
On a hit, parses all games and team stubs and writes them to the DB.
On a miss (404 or soft-404), logs a skip and moves on.

All outcomes are recorded in scrape_log for audit and resume support.
"""
import logging
import sqlite3
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

from pipelines.usau_data_pipeline.config import BASE_URL, DEFAULT_DB_PATH, GENDER_SEGMENTS, LEVEL_SEGMENTS
from pipelines.usau_data_pipeline.db import upsert_game, upsert_team_stub, update_event_ids, log_scrape, is_scrape_logged, now_iso
from pipelines.usau_data_pipeline.http_client import RateLimiter, create_session, get_with_retry
from pipelines.usau_data_pipeline.parsers.schedule import is_not_found, has_schedule_content, is_confirmed_no_schedule, parse_schedule_page, extract_event_ids

logger = logging.getLogger(__name__)

# Precise gender×level segments keyed by (competition_level, gender).
# All URL patterns verified against the live site (May 2026).
# Beach events always use Mixed/Beach-Mixed regardless of listed gender.
# Middle School Women, National Team, League, Convention have no schedule pages.
_TARGETED: dict = {
    # Club — WITH hyphen: Club-Men, Club-Women, Club-Mixed
    ("Club",    "Men"):   [("Men",   "Club-Men")],
    ("Club",    "Women"): [("Women", "Club-Women")],
    ("Club",    "Mixed"): [("Mixed", "Club-Mixed")],
    # College — NO hyphen: CollegeMen, CollegeWomen, CollegeMixed
    ("College", "Men"):   [("Men",   "CollegeMen")],
    ("College", "Women"): [("Women", "CollegeWomen")],
    ("College", "Mixed"): [("Mixed", "CollegeMixed")],
    # High School — WITH hyphen
    ("High School", "Men"):   [("Boys", "High-School-Boys"), ("Men", "High-School-Men"), ("Open", "High-School-Open")],
    ("High School", "Women"): [("Girls", "High-School-Girls"), ("Women", "High-School-Women")],
    ("High School", "Mixed"): [("Mixed", "High-School-Mixed")],
    # Masters — WITH hyphen
    ("Masters", "Men"):   [("Men",   "Masters-Men")],
    ("Masters", "Women"): [("Women", "Masters-Women")],
    ("Masters", "Mixed"): [("Mixed", "Masters-Mixed")],
    # Grand Masters
    ("Grand Masters", "Men"):   [("Men",   "Grand-Masters-Men")],
    ("Grand Masters", "Women"): [("Women", "Grand-Masters-Women")],
    ("Grand Masters", "Mixed"): [("Mixed", "Grand-Masters-Mixed")],
    # Great Grand Masters
    ("Great Grand Masters", "Men"):   [("Men",   "Great-Grand-Masters-Men")],
    ("Great Grand Masters", "Women"): [("Women", "Great-Grand-Masters-Women")],
    ("Great Grand Masters", "Mixed"): [("Mixed", "Great-Grand-Masters-Mixed")],
    # Beach — schedule URL is always Mixed/Beach-Mixed regardless of listed gender
    ("Beach", "Men"):   [("Mixed", "Beach-Mixed")],
    ("Beach", "Women"): [("Mixed", "Beach-Mixed")],
    ("Beach", "Mixed"): [("Mixed", "Beach-Mixed")],
    # Middle School
    ("Middle School", "Men"):   [("Boys", "Middle-School-Boys")],
    ("Middle School", "Women"): [("Girls", "Middle-School-Girls")],
    ("Middle School", "Mixed"): [("Mixed", "Middle-School-Mixed")],
    # Youth — URL segment varies by age group; probe all known variants
    ("Youth",   "Men"):   [
        ("Boys", "Youth-Club-U-20-Boys"), ("Boys", "Youth-U-20-Boys"),
        ("Boys", "Youth-Club-U-17-Boys"), ("Boys", "Youth-U-17-Boys"),
        ("Men",  "Youth-Club-U-20-Men"),  ("Men",  "Youth-U-20-Men"),
    ],
    ("Youth",   "Women"): [
        ("Girls",  "Youth-Club-U-20-Girls"), ("Girls",  "Youth-U-20-Girls"),
        ("Girls",  "Youth-Club-U-17-Girls"), ("Girls",  "Youth-U-17-Girls"),
        ("Women",  "Youth-Club-U-20-Women"), ("Women",  "Youth-U-20-Women"),
    ],
    ("Youth",   "Mixed"): [
        ("Mixed", "Youth-Club-U-20-Mixed"), ("Mixed", "Youth-U-20-Mixed"),
        ("Mixed", "Youth-Club-U-17-Mixed"), ("Mixed", "Youth-U-17-Mixed"),
    ],
    # National Team, League, Convention — no structured schedule pages; skip probing
    ("National Team", "Men"):   [],
    ("National Team", "Women"): [],
    ("National Team", "Mixed"): [],
    ("League",        "Men"):   [],
    ("League",        "Mixed"): [],
    ("Convention",    "Mixed"): [],
    # Unclassified — no competition_level/gender; no reliable schedule URL pattern
    (None, None):               [],
}


def _schedule_url_candidates(event_slug: str, competition_level: str, gender: str) -> list:
    """
    Return (gender_seg, level_seg, url) tuples for this event.
    Falls back to the full 36-combo matrix only if metadata is unknown.
    """
    key = (competition_level, gender)
    pairs = _TARGETED.get(key)
    if pairs:
        return [
            (g, lv, f"{BASE_URL}/events/{event_slug}/schedule/{g}/{lv}/")
            for g, lv in pairs
        ]
    # Unknown metadata — fall back to brute-force scan
    logger.debug("Unknown (competition_level=%r, gender=%r) for %s — probing all 36",
                 competition_level, gender, event_slug)
    return [
        (g, lv, f"{BASE_URL}/events/{event_slug}/schedule/{g}/{lv}-{g}/")
        for g in GENDER_SEGMENTS
        for lv in LEVEL_SEGMENTS
    ]



# ---------------------------------------------------------------------------
# Event detail page discovery (groupButtons)
# ---------------------------------------------------------------------------

def _extract_anchor_schedule_urls(html: str) -> list:
    """Parse <dd class="groupButtons"> anchor links pointing to schedule pages."""
    from bs4 import BeautifulSoup as _BS
    soup = _BS(html, "lxml")
    urls = []
    for dd in soup.find_all("dd", class_="groupButtons"):
        for a in dd.find_all("a", href=True):
            href = a["href"]
            if "/schedule/" in href:
                full = (BASE_URL + href) if href.startswith("/") else href
                urls.append(full.rstrip("/") + "/")
    return list(dict.fromkeys(urls))


def _post_groupbuttons(session, action_url: str, html: str, rate_limiter) -> list:
    """
    POST each <input type="submit"> in <dd class="groupButtons"> and collect
    schedule URLs from the final (possibly redirected) response URL.
    Handles ASP.NET WebForms postback pattern.
    """
    from bs4 import BeautifulSoup as _BS
    soup = _BS(html, "lxml")
    form = soup.find("form", id="main")
    if not form:
        return []
    # Collect hidden fields required for ASP.NET postback validation
    hidden = {}
    for inp in form.find_all("input", attrs={"type": "hidden"}):
        n = inp.get("name")
        v = inp.get("value", "")
        if n:
            hidden[n] = v
    urls = []
    for dd in soup.find_all("dd", class_="groupButtons"):
        for btn in dd.find_all("input", attrs={"type": "submit"}):
            btn_name  = btn.get("name")
            btn_value = btn.get("value", "")
            if not btn_name:
                continue
            rate_limiter.wait()
            try:
                pr = session.post(
                    action_url,
                    data={**hidden, btn_name: btn_value},
                    allow_redirects=True,
                    timeout=20,
                )
                final = pr.url.rstrip("/") + "/"
                if pr.status_code == 200 and "/schedule/" in final:
                    urls.append(final)
                    logger.debug("  groupButton POST -> %s  (value=%r)", final, btn_value)
            except Exception as exc:
                logger.debug("  groupButton POST error (%r): %s", btn_value, exc)
    return list(dict.fromkeys(urls))


def _url_to_gl_tuple(url: str) -> tuple:
    """Parse (gender_seg, level_seg, url) from a schedule URL."""
    try:
        parts = url.rstrip("/").split("/schedule/")
        segs  = parts[1].strip("/").split("/") if len(parts) == 2 else []
        g  = segs[0] if len(segs) > 0 else "Unknown"
        lv = segs[1] if len(segs) > 1 else "Unknown"
    except Exception:
        g, lv = "Unknown", "Unknown"
    return (g, lv, url)


def _discover_from_event_page(
    session, event_slug: str, conn, force: bool, rate_limiter,
) -> list:
    """
    Fetch /events/{slug}/, extract schedule URLs from groupButtons.
    Tries anchor <a href> links first (no extra requests), then falls back to
    POSTing each <input type="submit"> button to follow ASP.NET postback redirects.

    Returns list of (gender_seg, level_seg, url) tuples.
    Caches the check in scrape_log under layer='event_detail'.
    """
    event_url = f"{BASE_URL}/events/{event_slug}/"
    layer_key = "event_detail"

    if not force and is_scrape_logged(conn, event_url, layer_key):
        # Check if the prior result was a success (found links) or skip (page failed).
        # Return None for skip so the caller doesn't brute-force URL candidates.
        row = conn.execute(
            "SELECT status FROM scrape_log WHERE url=? AND detail=? ORDER BY id DESC LIMIT 1",
            (event_url, layer_key),
        ).fetchone()
        if row and row["status"] == "success":
            return []  # Page loaded fine but had no links we haven't already tried
        return None   # Page previously failed — don't probe URL candidates

    rate_limiter.wait()
    resp = get_with_retry(session, event_url, rate_limiter)
    if resp is None or resp.status_code != 200:
        log_scrape(conn, event_url, layer_key, "skip",
                   http_status=resp.status_code if resp else None,
                   detail=layer_key)
        # Return None (not []) so the caller knows the page itself failed
        # and skips URL candidate probing entirely.
        return None

    html = resp.text

    # 1) Anchor links — fast, no extra requests
    anchor_urls = _extract_anchor_schedule_urls(html)
    if anchor_urls:
        log_scrape(conn, event_url, layer_key, "success",
                   http_status=200, detail=layer_key)
        logger.debug("  event_detail anchors for %s: %s", event_slug, anchor_urls)
        return [_url_to_gl_tuple(u) for u in anchor_urls]

    # 2) Form POST buttons (ASP.NET postback -> redirect to schedule page)
    from bs4 import BeautifulSoup as _BS
    form = _BS(html, "lxml").find("form", id="main")
    if form:
        action = form.get("action", "")
        action_url = (BASE_URL + action) if action.startswith("/") else action
        if action_url:
            post_urls = _post_groupbuttons(session, action_url, html, rate_limiter)
            if post_urls:
                log_scrape(conn, event_url, layer_key, "success",
                           http_status=200, detail=layer_key)
                logger.debug("  event_detail POST urls for %s: %s",
                             event_slug, post_urls)
                return [_url_to_gl_tuple(u) for u in post_urls]

    log_scrape(conn, event_url, layer_key, "skip",
               http_status=200, detail=layer_key)
    return []

def run_phase3(
    conn: sqlite3.Connection,
    force: bool = False,
    dry_run: bool = False,
    workers: int = 2,
    season_years: list | None = None,
) -> None:
    # ── Build work items: one per unique slug (collects all combos for that slug) ──
    if season_years:
        placeholders = ",".join("?" * len(season_years))
        rows = conn.execute(
            f"SELECT DISTINCT event_slug, competition_level, gender FROM events"
            f" WHERE season_year IN ({placeholders})",
            season_years,
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT DISTINCT event_slug, competition_level, gender FROM events"
        ).fetchall()
    logger.info("Phase 3: %d event/level/gender combos across %d workers",
                len(rows), workers)

    by_slug: dict = defaultdict(list)
    for r in rows:
        by_slug[r["event_slug"]].append((r["competition_level"] or "", r["gender"] or ""))

    write_lock = threading.Lock()

    def _process_slug(event_slug: str, combos: list) -> tuple:
        """Worker: fetch event detail + probe all URL candidates for this slug."""
        if "cancelled" in event_slug.lower():
            return event_slug, 0, 0

        # Each worker gets its own DB connection, HTTP session, and rate limiter
        wconn    = __import__("sqlite3").connect(str(DEFAULT_DB_PATH))
        wconn.row_factory = __import__("sqlite3").Row
        wconn.execute("PRAGMA journal_mode=WAL")
        wconn.execute("PRAGMA foreign_keys=ON")
        wconn.execute("PRAGMA busy_timeout=10000")  # wait up to 10s on write contention
        session      = create_session()
        rate_limiter = RateLimiter()

        total_games = 0
        total_teams = 0
        found_any   = False

        try:
            # ── Event detail page: discover groupButtons schedule URLs once ──
            extra = [] if dry_run else _discover_from_event_page(session, event_slug, wconn, force, rate_limiter)
            if extra is None:
                # Page itself failed — skip URL probing entirely
                return event_slug, 0, 0

            # Build candidate set: discovered URLs first, then targeted fallbacks
            extra_urls = {url for _, _, url in extra}
            candidates = list(extra)
            seen_urls  = set(extra_urls)

            for comp_level, gender in combos:
                for g, lv, u in _schedule_url_candidates(event_slug, comp_level, gender):
                    if u not in seen_urls:
                        candidates.append((g, lv, u))
                        seen_urls.add(u)

            # ── Probe each candidate URL ──
            probed_any = False  # True once we make at least one HTTP request
            for gender_seg, level, url in candidates:
                detail = f"{gender_seg}/{level}"

                with write_lock:
                    already = is_scrape_logged(wconn, url, detail)
                if not force and already:
                    continue

                probed_any = True
                if dry_run:
                    logger.info("  [DRY RUN] Would probe %s", url)
                    continue

                resp = get_with_retry(session, url, rate_limiter)

                if is_not_found(resp) or not has_schedule_content(resp):
                    with write_lock:
                        log_scrape(wconn, url, "schedule", "skip",
                                   http_status=resp.status_code if resp else None,
                                   detail=detail)
                    if is_confirmed_no_schedule(resp):
                        break
                    continue

                # ── Valid schedule page ──
                with write_lock:
                    log_scrape(wconn, url, "schedule", "success",
                               http_status=200, detail=detail)
                found_any = True
                logger.info("  Schedule hit: %s  [%s]", event_slug, detail)

                eid, egid = extract_event_ids(resp.text)
                if eid:
                    with write_lock:
                        update_event_ids(wconn, event_slug, eid, egid, now_iso())

                try:
                    games, team_ids = parse_schedule_page(
                        resp.text, event_slug, gender_seg, level
                    )
                    scraped_at = now_iso()
                    with write_lock:
                        for etid, team_name in team_ids:
                            upsert_team_stub(wconn, etid, event_slug, team_name or None)
                        for game in games:
                            game["scraped_at"] = scraped_at
                            upsert_game(wconn, game)
                    total_games += len(games)
                    total_teams += len(team_ids)
                    logger.info("    %d games, %d teams", len(games), len(team_ids))
                except Exception as exc:
                    logger.error("  Parse error for %s [%s]: %s", event_slug, detail, exc)

        finally:
            wconn.close()

        # Only warn if we actually probed URLs this run and still found nothing,
        # or if there were no candidates at all (unrecognised event type).
        # Silently skip events whose candidates are all already logged from prior runs.
        if not found_any and not dry_run and (probed_any or not candidates):
            logger.warning("  No schedule URLs found for event: %s", event_slug)

        return event_slug, total_games, total_teams

    # ── Dispatch work across thread pool ──
    total_games = 0
    total_teams = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_process_slug, slug, combos): slug
            for slug, combos in by_slug.items()
        }
        for fut in as_completed(futures):
            try:
                _, g, t = fut.result()
                total_games += g
                total_teams += t
            except Exception as exc:
                logger.error("Worker error for %s: %s", futures[fut], exc)

    logger.info("Phase 3 complete: %d games, %d teams", total_games, total_teams)
