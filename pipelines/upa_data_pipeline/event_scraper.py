#!/usr/bin/env python3
"""
scorereport.net event scraper — 25 parallel Playwright workers
Each worker owns a static partition of (year, division) combos.
Inserts valid events into usau_upa_events in Y:\\backend\\ultimate.db
"""

from pathlib import Path
import os
import re
import sqlite3
import time
import logging
import threading
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from itertools import product

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

# ── config ────────────────────────────────────────────────────────────────────
DB_PATH        = os.environ.get("UFA_DB_PATH") or str(Path(__file__).resolve().parents[2] / "data" / "db" / "ultimate.db")
BASE_URL       = "https://scorereport.net"
PAGE_TIMEOUT   = 15000  # ms
NUM_WORKERS    = 25

YEARS = list(range(2004, 2014))
DIVISIONS = [
    "college-open", "college-women",
    "open", "women", "mixed",
    "youth-girls", "youth-open", "youth-mixed",
]

DIV_MAP = {
    "college-open":  ("College",     "open"),
    "college-women": ("College",     "women"),
    "open":          ("Club",        "open"),
    "women":         ("Club",        "women"),
    "mixed":         ("Club",        "mixed"),
    "youth-girls":   ("High School", "girls"),
    "youth-open":    ("High School", "open"),
    "youth-mixed":   ("High School", "mixed"),
}

GENDER_MAP = {
    "open":   "Men",
    "women":  "Women",
    "mixed":  "Mixed",
    "girls":  "Girls",
}

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Fedora; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; WOW64; rv:121.0) Gecko/20100101 Firefox/121.0",
    "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36 Edg/115.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/111.0.0.0 Safari/537.36",
]

STATE_ABBREVS = {
    "AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California",
    "CO":"Colorado","CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia",
    "HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa",
    "KS":"Kansas","KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland",
    "MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi",
    "MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire",
    "NJ":"New Jersey","NM":"New Mexico","NY":"New York","NC":"North Carolina",
    "ND":"North Dakota","OH":"Ohio","OK":"Oklahoma","OR":"Oregon","PA":"Pennsylvania",
    "RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota","TN":"Tennessee",
    "TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington",
    "WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming","DC":"District of Columbia",
    "BC":"British Columbia","ON":"Ontario","QC":"Quebec","AB":"Alberta",
}

MONTH_MAP = {
    "january":1,"february":2,"march":3,"april":4,"may":5,"june":6,
    "july":7,"august":8,"september":9,"october":10,"november":11,"december":12,
}

# ── logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[logging.FileHandler("scrape_events.log")],
)
log = logging.getLogger(__name__)

# ── thread-safe DB writer ─────────────────────────────────────────────────────
db_lock = threading.Lock()

def get_conn():
    return sqlite3.connect(DB_PATH, check_same_thread=False)

def insert_event(conn, row):
    with db_lock:
        conn.execute("""
            INSERT OR IGNORE INTO usau_upa_events (
                event_slug, competition_group, event_title, event_url,
                source, event_type, event_id, event_group_id,
                city, state, date_start, date_end,
                season_year, competition_level, gender, division_label,
                event_year, division, scraped_at
            ) VALUES (
                :event_slug, :competition_group, :event_title, :event_url,
                :source, :event_type, :event_id, :event_group_id,
                :city, :state, :date_start, :date_end,
                :season_year, :competition_level, :gender, :division_label,
                :event_year, :division, :scraped_at
            )
        """, row)
        conn.commit()

# ── shared counters ───────────────────────────────────────────────────────────
counter_lock   = threading.Lock()
total_inserted = 0
total_skipped  = 0
total_errors   = 0

def inc(inserted=0, skipped=0, errors=0):
    global total_inserted, total_skipped, total_errors
    with counter_lock:
        total_inserted += inserted
        total_skipped  += skipped
        total_errors   += errors
        return total_inserted, total_skipped, total_errors

# ── parsers ───────────────────────────────────────────────────────────────────
def expand_state(abbr):
    return STATE_ABBREVS.get(abbr.strip().upper(), abbr.strip())

def parse_location(soup):
    for tag in soup.find_all("span"):
        text = tag.get_text(strip=True)
        m = re.match(r"Location:\s*(.+),\s*([A-Z]{2})\s*$", text)
        if m:
            return m.group(1).strip(), expand_state(m.group(2))
    return None, None

def parse_dates(soup, year):
    enotes = soup.find("div", class_="enotes")
    if not enotes:
        return None, None
    raw = enotes.get_text(separator="\n").split("\n")[0].strip()
    m = re.match(r"(\w+)\s+(\d+)\s*(?:-\s*(?:(\w+)\s+)?(\d+))?", raw, re.IGNORECASE)
    if not m:
        return None, None
    start_month = MONTH_MAP.get(m.group(1).lower())
    end_month   = MONTH_MAP.get((m.group(3) or m.group(1)).lower())
    if not start_month or not end_month:
        return None, None
    start_day = int(m.group(2))
    end_day   = int(m.group(4)) if m.group(4) else start_day
    return f"{year}-{start_month:02d}-{start_day:02d}", f"{year}-{end_month:02d}-{end_day:02d}"

def parse_event(html, url, year, division, event_id):
    soup = BeautifulSoup(html, "html.parser")
    h2 = soup.find("h2")
    if not h2:
        return None
    event_title = h2.get_text(strip=True)
    if not event_title:
        return None
    comp_level, raw_gender = DIV_MAP[division]
    gender = GENDER_MAP[raw_gender]
    city, state = parse_location(soup)
    date_start, date_end = parse_dates(soup, year)
    return {
        "event_slug":        f"/{year}/{division}/event{event_id}",
        "competition_group": division,
        "event_title":       event_title,
        "event_url":         url,
        "source":            "upa",
        "event_type":        "tournament",
        "event_id":          event_id,
        "event_group_id":    None,
        "city":              city,
        "state":             state,
        "date_start":        date_start,
        "date_end":          date_end,
        "season_year":       year,
        "competition_level": comp_level,
        "gender":            gender,
        "division_label":    f"{comp_level}-{gender}",
        "event_year":        year,
        "division":          division,
        "scraped_at":        datetime.now(timezone.utc).isoformat(),
    }

# ── formatting ────────────────────────────────────────────────────────────────
def fmt_dur(s):
    h, r = divmod(int(s), 3600)
    m, _ = divmod(r, 60)
    sec  = s % 60
    if h: return f"{h}h {m}m {sec:.1f}s"
    if m: return f"{m}m {sec:.1f}s"
    return f"{sec:.3f}s"

def fmt_eta(elapsed, done, total):
    if done == 0:
        return "???"
    return fmt_dur((total - done) / (done / elapsed))

print_lock = threading.Lock()

def pprint(*args, **kwargs):
    with print_lock:
        print(*args, **kwargs, flush=True)

# ── worker ────────────────────────────────────────────────────────────────────
def worker(worker_id: int, combos: list, conn, run_start: float, global_total: int):
    """Each worker owns a list of (year, division) tuples and scrapes all 9999 event IDs for each."""
    ua = USER_AGENTS[worker_id % len(USER_AGENTS)]
    w_inserted = 0
    w_skipped  = 0
    w_errors   = 0
    global_done_local = 0  # local count for ETA (approximated)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(user_agent=ua)
        page    = context.new_page()

        for year, division in combos:
            div_inserted = 0
            div_skipped  = 0
            div_start    = time.time()

            pprint(f"\n  W{worker_id:02d} ▶ {year}/{division}")

            for event_num in range(1, 10000):
                req_start = time.time()
                url       = f"{BASE_URL}/{year}/{division}/event{event_num:04d}"

                try:
                    page.goto(url, wait_until="networkidle", timeout=PAGE_TIMEOUT)
                    html = page.content()
                except PlaywrightTimeout:
                    w_errors += 1
                    inc(errors=1)
                    pprint(f"  W{worker_id:02d} [{event_num:>4}/9999] TIMEOUT {fmt_dur(time.time()-req_start):>10} | {year}/{division}")
                    continue
                except Exception as e:
                    w_errors += 1
                    inc(errors=1)
                    pprint(f"  W{worker_id:02d} [{event_num:>4}/9999] ERROR   {fmt_dur(time.time()-req_start):>10} | {e}")
                    continue

                elapsed_req = time.time() - req_start
                elapsed_run = time.time() - run_start

                # Empty SPA shell = no event
                if '<div id="app"></div>' in html:
                    div_skipped += 1
                    w_skipped   += 1
                    ti, ts, te   = inc(skipped=1)
                    pprint(
                        f"  W{worker_id:02d} [{event_num:>4}/9999] EMPTY   {elapsed_req:>8.3f}s"
                        f" | {year}/{division}"
                        f" | skipped={div_skipped:<5} found={div_inserted:<4}"
                    )
                    continue

                row = parse_event(html, url, year, division, f"{event_num:04d}")

                if row is None:
                    div_skipped += 1
                    w_skipped   += 1
                    ti, ts, te   = inc(skipped=1)
                    pprint(
                        f"  W{worker_id:02d} [{event_num:>4}/9999] NO-H2   {elapsed_req:>8.3f}s"
                        f" | {year}/{division}"
                        f" | skipped={div_skipped:<5} found={div_inserted:<4}"
                    )
                    continue

                insert_event(conn, row)
                div_inserted += 1
                w_inserted   += 1
                ti, ts, te    = inc(inserted=1)

                pprint(
                    f"  W{worker_id:02d} [{event_num:>4}/9999] INSERT  {elapsed_req:>8.3f}s"
                    f" | {row['event_title'][:45]}\n"
                    f"              {url}\n"
                    f"              {row['city']}, {row['state']}  {row['date_start']} to {row['date_end']}\n"
                    f"              global inserted={ti}"
                )
                log.info(f"W{worker_id:02d} inserted {row['event_title']} ({url})")

            pprint(
                f"  W{worker_id:02d} ✓ {year}/{division} done in {fmt_dur(time.time()-div_start)}"
                f" | inserted={div_inserted} skipped={div_skipped}"
            )

        browser.close()

    return w_inserted, w_skipped, w_errors


# ── partition ─────────────────────────────────────────────────────────────────
def partition(combos, n):
    """Distribute combos across n workers as evenly as possible."""
    combos = list(combos)
    k, rem = divmod(len(combos), n)
    chunks = []
    i = 0
    for worker_id in range(n):
        size = k + (1 if worker_id < rem else 0)
        chunks.append(combos[i:i+size])
        i += size
    return chunks


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    conn         = get_conn()
    all_combos   = list(product(YEARS, DIVISIONS))   # 80 combos total
    chunks       = partition(all_combos, NUM_WORKERS)
    global_total = len(all_combos) * 9999
    run_start    = time.time()

    print(f"\n{'='*70}")
    print(f"  scorereport.net event scraper")
    print(f"  {NUM_WORKERS} workers | {len(all_combos)} combos | {global_total:,} URLs")
    print(f"{'='*70}\n")

    for i, chunk in enumerate(chunks):
        print(f"  W{i:02d}: {[f'{y}/{d}' for y,d in chunk]}")
    print()

    with ThreadPoolExecutor(max_workers=NUM_WORKERS) as executor:
        futures = {
            executor.submit(worker, wid, chunk, conn, run_start, global_total): wid
            for wid, chunk in enumerate(chunks)
        }
        for future in as_completed(futures):
            wid = futures[future]
            try:
                ins, skp, err = future.result()
                pprint(f"\n  W{wid:02d} COMPLETE | inserted={ins} skipped={skp} errors={err}")
            except Exception as e:
                pprint(f"\n  W{wid:02d} CRASHED  | {e}")
                log.exception(f"W{wid} crashed")

    elapsed = time.time() - run_start
    print(f"\n{'='*70}")
    print(f"  DONE in {fmt_dur(elapsed)}")
    print(f"  Inserted : {total_inserted}")
    print(f"  Skipped  : {total_skipped}")
    print(f"  Errors   : {total_errors}")
    print(f"{'='*70}")
    conn.close()


if __name__ == "__main__":
    main()