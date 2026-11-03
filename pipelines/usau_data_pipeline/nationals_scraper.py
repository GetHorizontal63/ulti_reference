"""
scrape_usau_nationals.py

Scrapes team names and final finishes from USAU Nationals events (2014-2025)
for Club M/W/X and College D1/D3 M/W into usau_nationals table.

Club has no division (NULL). College uses division 1 or 3.
2020 omitted — no nationals held.

Usage:
    python scrape_usau_nationals.py --db "Z:/Code_Server/.../backend/ultimate.db"
    python scrape_usau_nationals.py --db "Z:/..." --dry-run
    python scrape_usau_nationals.py --db "Z:/..." --year 2024 --level club --dry-run --debug
"""

import argparse
import re
import sqlite3
import time
import logging

import requests
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
SLEEP       = 3.0
RETRY_SLEEP = 30.0
MAX_RETRIES = 2
BASE        = "https://play.usaultimate.org/events"

# ---------------------------------------------------------------------------
# Slug maps
# ---------------------------------------------------------------------------

CLUB_SLUGS = {
    2014: "USA-Ultimate-National-Championships",
    2015: "USA-Ultimate-National-Championships-2015",
    2016: "USA-Ultimate-National-Championships-2016",
    2017: "USA-Ultimate-National-Championships-2017",
    2018: "USA-Ultimate-National-Championships-2018",
    2019: "USA-Ultimate-National-Championships-2019",
    2021: "USA-Ultimate-National-Championships-2021",
    2022: "2022-usa-ultimate-national-championships",
    2023: "2023-USA-Ultimate-Club-Championships",
    2024: "2024-usa-ultimate-club-championships",
    2025: "2025-USA-Ultimate-Club-Nationals",
}

COLLEGE_D1_SLUGS = {
    2014: "usa-ultimate-d-i-college-championships",
    2015: "USA-Ultimate-D-I-College-Championships-2015",
    2016: "USA-Ultimate-D-I-College-Championships-2016",
    2017: "2017-USA-Ultimate-College-Championships",
    2018: "USA-Ultimate-D-I-College-Championships-2018",
    2019: "D-I-College-Championships-2019",
    2021: "USA-Ultimate-College-Championships-2021",
    2022: "2022-D-I-College-Championships",
    2023: "2023-USA-Ultimate-College-Championships",
    2024: "2024-USA-Ultimate-D-1-College-Championships",
    2025: "2025-USA-Ultimate-College-Championships",
    2026: "2026-D-I-College-Championships",
}

COLLEGE_D3_SLUGS = {
    2014: "usa-ultimate-d-iii-college-championships",
    2015: "USA-Ultimate-D-III-College-Championships-2015",
    2016: "USA-Ultimate-D-III-College-Championships-2016",
    2017: "USA-Ultimate-D-III-College-Championships-2017",
    2018: "USA-Ultimate-D-III-College-Championships-2018",
    2019: "D-III-College-Championships-2019",
    2021: "USA-Ultimate-College-Championships-2021",
    2022: "2022-D-III-College-Championships",
    2023: "2023-USA-Ultimate-D3-College-Championships",
    2024: "2024-USA-Ultimate-D-3-College-Championships",
    2025: "2025-USA-Ultimate-D3-College-Championships",
    2026: "2026-D-III-College-Championships",
}

# 2021 college uses sub-path suffixes after /schedule/{gender}/{division}/
# because D-I and D-III share the same event slug
COLLEGE_2021_SUFFIX = {
    ("1", "M"): "d_i_men/",
    ("1", "W"): "d_i_women/",
    ("3", "M"): "d_iii_men/",
    ("3", "W"): "d_iii_women/",
}

# (competition_level, division, gender, url_gender, url_division, slug_map)
# division=None for Club
DIVISIONS = [
    ("Club",    None, "M", "Men",   "Club-Men",     CLUB_SLUGS),
    ("Club",    None, "W", "Women", "Club-Women",   CLUB_SLUGS),
    ("Club",    None, "X", "Mixed", "Club-Mixed",   CLUB_SLUGS),
    ("College", "1",  "M", "Men",   "CollegeMen",   COLLEGE_D1_SLUGS),
    ("College", "1",  "W", "Women", "CollegeWomen", COLLEGE_D1_SLUGS),
    ("College", "3",  "M", "Men",   "CollegeMen",   COLLEGE_D3_SLUGS),
    ("College", "3",  "W", "Women", "CollegeWomen", COLLEGE_D3_SLUGS),
]

YEARS = [y for y in range(2014, 2027) if y != 2020]

WORD_TO_NUM = {
    'first':1,'second':2,'third':3,'fourth':4,'fifth':5,'sixth':6,'seventh':7,
    'eighth':8,'ninth':9,'tenth':10,'eleventh':11,'twelfth':12,'thirteenth':13,
    'fourteenth':14,'fifteenth':15,'sixteenth':16,'seventeenth':17,'eighteenth':18,
    'nineteenth':19,'twentieth':20,
}

JUNK    = re.compile(r'^\d+-\d+$')
JUNK_NAMES = {"Team 1","Team 2","Team","Date","Time","Field","Score","Status","Options",""}


def extract_finish_num(title):
    t = title.strip().lower()
    t = re.sub(r'\(.*?\)', '', t)
    t = re.split(r'/', t)[-1].strip()
    m = re.search(r'\b(\d+)(st|nd|rd|th)\b', t)
    if m:
        return int(m.group(1))
    for word, num in WORD_TO_NUM.items():
        if word in t:
            return num
    if re.match(r'^final\s*$', t):
        return 1
    return None


def is_tied(title):
    return bool(re.search(r'\btie\b', title.lower()))


def get_bracket_info(wrpr_div):
    """Return (title, section_num) from a bracket_wrpr div.
    section_num is parsed from #N tokens embedded in the bracket text.
    """
    text = wrpr_div.get_text(separator="|", strip=True)
    parts = [p.strip() for p in text.split("|") if p.strip()]
    title = ""
    section_num = None
    for part in parts:
        if re.match(r'^#\d+$', part):
            section_num = int(part[1:])
        elif not title and not re.match(r'^G\d+$|^\d+$', part):
            title = part
    return title, section_num


def get_bracket_title(wrpr_div):
    title, _ = get_bracket_info(wrpr_div)
    return title


SECTION_FINISH = {
    16: {1: (1, 2, False), 2: (5, 6, True), 3: (9, 10, False), 4: (13, 14, False)},
    20: {1: (1, 2, False), 2: (5, 6, True), 3: (9, 10, False), 4: (13, 14, False), 5: (17, 18, True)},
}


def strip_seed(name):
    return re.sub(r'\s*\(\d+\)\s*$', '', name).strip()


def parse_bracket_game(div):
    text = div.get_text(separator="|", strip=True)
    parts = [p.strip() for p in text.split("|") if p.strip()]
    if parts and re.match(r'^G\d+$', parts[0]):
        parts = parts[1:]
    score_re = re.compile(r'^\d+$')
    for start in range(min(5, len(parts))):
        chunk = parts[start:start+4]
        if len(chunk) < 4:
            continue
        if (not score_re.match(chunk[0]) and score_re.match(chunk[1]) and
                not score_re.match(chunk[2]) and score_re.match(chunk[3])):
            t1, s1 = strip_seed(chunk[0]), chunk[1]
            t2, s2 = strip_seed(chunk[2]), chunk[3]
            if t1 and t2 and t1 not in JUNK_NAMES and t2 not in JUNK_NAMES:
                return t1, s1, t2, s2
        if (score_re.match(chunk[0]) and not score_re.match(chunk[1]) and
                score_re.match(chunk[2]) and not score_re.match(chunk[3])):
            s1, t1 = chunk[0], strip_seed(chunk[1])
            s2, t2 = chunk[2], strip_seed(chunk[3])
            if t1 and t2 and t1 not in JUNK_NAMES and t2 not in JUNK_NAMES:
                return t1, s1, t2, s2
    return None


def format_finish(n, tied=False):
    return f"T{n}" if tied else f"{n:02d}"


def finish_sort_key(f):
    if not f:
        return 999
    m = re.match(r'T?(\d+)', str(f))
    return int(m.group(1)) if m else 999


def parse_finishes(soup, field_size, url=""):
    finishes  = {}
    all_teams = set()

    for table in soup.find_all("table"):
        headers = [th.get_text(strip=True).lower() for th in table.find_all("th")]
        t1_idx  = next((i for i, h in enumerate(headers) if h == "team 1"), None)
        t2_idx  = next((i for i, h in enumerate(headers) if h == "team 2"), None)
        tm_idx  = next((i for i, h in enumerate(headers) if h == "team"), None)
        for tr in table.find_all("tr")[1:]:
            cells = [td.get_text(strip=True) for td in tr.find_all(["td","th"])]
            for idx in [x for x in [t1_idx, t2_idx] if x is not None]:
                if len(cells) > idx:
                    n = strip_seed(cells[idx])
                    if n and n not in JUNK_NAMES and not JUNK.match(n):
                        all_teams.add(n)
            if tm_idx is not None and len(cells) > tm_idx:
                n = strip_seed(cells[tm_idx])
                if n and n not in JUNK_NAMES and not JUNK.match(n):
                    all_teams.add(n)

    all_wrprs = soup.find_all("div", class_="bracket_wrpr")

    def count_games(wrpr):
        return len(wrpr.find_all("div", class_=re.compile(r"bracket_game")))

    # Step 1: for each bracket, extract the labeled finish number if present
    # Step 2: collect all labeled finishes to know what placements are accounted for
    # Step 3: for unlabeled brackets (title="Final" with no number), infer placement
    #         from what's missing — championship is always the bracket with most games

    # Full placement set for field size
    all_placements = list(range(1, field_size + 1, 2))  # 1,3,5,7,9,11,13,15,(17,19) odd starts
    # Actually placements that need a bracket game: 1,5,9,13,(17) for 16-team
    # Each bracket covers 2 placements (winner/loser) except tied pairs cover 4
    # Simpler: just track which finish_nums are labeled vs unlabeled

    labeled_finishes = {}   # finish_num -> list of wrpr divs with that label
    unlabeled = []          # wrpr divs with no extractable finish number

    for wrpr in all_wrprs:
        title, _ = get_bracket_info(wrpr)
        fn = extract_finish_num(title)
        # Only treat as labeled if the title has an EXPLICIT placement number
        # Bare "Final" (which maps to 1) is ambiguous — treat as unlabeled
        is_bare_final = (title.strip().lower() in ('final', ''))
        if fn is not None and not is_bare_final:
            labeled_finishes.setdefault(fn, []).append(wrpr)
        else:
            unlabeled.append(wrpr)

    # Count labeled brackets per finish for tied logic
    bracket_count = {fn: len(lst) for fn, lst in labeled_finishes.items()}

    # Assign finish numbers to unlabeled brackets
    # Labeled finishes cover certain placements; gaps are filled by unlabeled brackets
    # For a 16-team field, championship bracket covers 1/2, so finish=1 is a gap
    # For a 20-team field same applies
    # The unlabeled bracket with the MOST games = championship (finish=1)
    # Remaining unlabeled brackets sorted by game count descending fill next gaps
    labeled_placement_nums = set(labeled_finishes.keys())

    # Possible bracket start placements in order: 1, then go up by 2 past labeled ones
    # e.g. if 5,9,13 are labeled, gaps are 1 (and maybe 17)
    # We just need to find which odd-numbered placements aren't covered
    candidate_placements = []
    for p in [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]:
        if p > field_size:
            break
        if p not in labeled_placement_nums:
            candidate_placements.append(p)

    unlabeled_sorted = sorted(unlabeled, key=count_games, reverse=True)
    unlabeled_finish_map = {}
    for i, wrpr in enumerate(unlabeled_sorted):
        if i < len(candidate_placements):
            unlabeled_finish_map[id(wrpr)] = candidate_placements[i]

    for wrpr in all_wrprs:
        title, _ = get_bracket_info(wrpr)
        is_bare_final = (title.strip().lower() in ('final', ''))
        finish_num = extract_finish_num(title) if not is_bare_final else None
        tied       = is_tied(title)

        if finish_num is None:
            finish_num = unlabeled_finish_map.get(id(wrpr))
            if finish_num is None:
                log.debug(f"  Cannot resolve bracket: title='{title}'")
                continue
            # Championship (finish=1) is never tied
            if finish_num == 1:
                tied = False

        n_brackets = bracket_count.get(finish_num, 1)
        terminal_games = [
            d for d in wrpr.find_all("div", class_=re.compile(r"bracket_game"))
            if "has_next" not in " ".join(d.get("class", []))
        ]

        for game_div in terminal_games:
            parsed = parse_bracket_game(game_div)
            if not parsed:
                continue
            t1, s1, t2, s2 = parsed
            all_teams.update([t1, t2])
            try:
                score1, score2 = int(s1), int(s2)
            except ValueError:
                continue

            if score1 == score2:
                finishes[t1] = format_finish(finish_num, tied=True)
                finishes[t2] = format_finish(finish_num, tied=True)
            else:
                winner, loser = (t1, t2) if score1 > score2 else (t2, t1)
                if tied and n_brackets > 1:
                    finishes[winner] = format_finish(finish_num, tied=True)
                    finishes[loser]  = format_finish(finish_num + n_brackets, tied=True)
                else:
                    finishes[winner] = format_finish(finish_num)
                    finishes[loser]  = format_finish(finish_num + 1)

    fallback = "T17" if field_size == 20 else "T13"
    for team in all_teams:
        if team not in finishes and len(team) > 1 and not JUNK.match(team):
            finishes[team] = fallback
            log.debug(f"  Fallback {fallback}: {team}")

    if not finishes:
        log.warning(f"  No finishes parsed{' ' + url if url else ''}")
        return []

    return [
        {"team_name": name, "city": None, "state": None, "finish": finish}
        for name, finish in sorted(finishes.items(), key=lambda x: finish_sort_key(x[1]))
    ]


def fetch_with_retry(session, url):
    for attempt in range(MAX_RETRIES + 1):
        try:
            r = session.get(url, headers=HEADERS, timeout=20)
            if r.status_code == 404:
                log.warning(f"  404: {url}")
                return None
            if r.status_code == 500:
                if attempt < MAX_RETRIES:
                    log.warning(f"  500 on attempt {attempt+1}, sleeping {RETRY_SLEEP}s: {url}")
                    time.sleep(RETRY_SLEEP)
                    continue
                else:
                    log.error(f"  500 after {MAX_RETRIES+1} attempts: {url}")
                    return None
            r.raise_for_status()
            return r
        except requests.exceptions.RequestException as e:
            if attempt < MAX_RETRIES:
                log.warning(f"  Error attempt {attempt+1}: {e}, retrying...")
                time.sleep(RETRY_SLEEP)
            else:
                log.error(f"  Failed after retries: {e}")
                return None
    return None


def scrape_schedule_page(session, slug, url_gender, url_division, field_size, suffix=""):
    url = f"{BASE}/{slug}/schedule/{url_gender}/{url_division}/{suffix}"
    log.debug(f"  GET {url}")
    time.sleep(SLEEP)
    r = fetch_with_retry(session, url)
    if r is None:
        return []
    return parse_finishes(BeautifulSoup(r.text, "html.parser"), field_size, url)


def build_usau_team_id(comp_level, division, gender, team_name):
    prefix = "usau_S" if comp_level == "Club" else "usau_A"
    slug = re.sub(r'[^a-z0-9]+', '-', team_name.lower()).strip('-')
    return f"{prefix}_{gender}_{slug}"



def upsert_team(conn, row, dry_run=False):
    sql = """
        INSERT INTO usau_nationals
            (usau_team_id, school_name, team_name, competition_level, division,
             gender, city, state, year, finish, spirit_award)
        VALUES
            (:usau_team_id, :school_name, :team_name, :competition_level, :division,
             :gender, :city, :state, :year, :finish, 0)
        ON CONFLICT(usau_team_id, year) DO UPDATE SET
            team_name         = excluded.team_name,
            competition_level = excluded.competition_level,
            division          = excluded.division,
            gender            = excluded.gender,
            city              = COALESCE(excluded.city,   usau_nationals.city),
            state             = COALESCE(excluded.state,  usau_nationals.state),
            finish            = COALESCE(excluded.finish, usau_nationals.finish)
    """
    if dry_run:
        log.info(f"  [DRY RUN] {str(row['finish']):>5}  {row['team_name']}")
        return
    conn.execute(sql, row)
    # Backfill city/state from usau_teams if available
    conn.execute("""
        UPDATE usau_nationals
        SET city  = COALESCE((SELECT city  FROM usau_teams WHERE usau_teams.usau_team_id = usau_nationals.usau_team_id), city),
            state = COALESCE((SELECT state FROM usau_teams WHERE usau_teams.usau_team_id = usau_nationals.usau_team_id), state)
        WHERE usau_team_id = :usau_team_id AND year = :year
    """, {"usau_team_id": row["usau_team_id"], "year": row["year"]})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db",      required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--year",    type=int)
    parser.add_argument("--level",   choices=["club", "college"])
    parser.add_argument("--debug",   action="store_true")
    args = parser.parse_args()

    if args.debug:
        log.setLevel(logging.DEBUG)

    years     = [args.year] if args.year else YEARS
    divisions = DIVISIONS
    if args.level == "club":
        divisions = [d for d in DIVISIONS if d[0] == "Club"]
    elif args.level == "college":
        divisions = [d for d in DIVISIONS if d[0] == "College"]

    conn = sqlite3.connect(args.db, timeout=30, isolation_level=None)
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA journal_mode=WAL")
    session = requests.Session()
    total_upserted = total_skipped = 0

    for year in years:
        for (comp_level, division, gender, url_gender, url_div, slug_map) in divisions:
            slug = slug_map.get(year)
            if not slug:
                continue

            # 2021 college uses sub-path suffixes
            suffix = ""
            if comp_level == "College" and year == 2021:
                suffix = COLLEGE_2021_SUFFIX.get((division, gender), "")

            field_size = 16 if division == "3" else 20
            log.info(f"Scraping {year} {comp_level} {('D'+division) if division else ''} {gender}")

            try:
                teams = scrape_schedule_page(session, slug, url_gender, url_div, field_size, suffix)
            except Exception as e:
                log.error(f"  Failed: {e}")
                total_skipped += 1
                continue

            if not teams:
                total_skipped += 1
                continue

            for t in teams:
                row = {
                    "usau_team_id":      build_usau_team_id(comp_level, division, gender, t["team_name"]),
                    "school_name":       t["team_name"] if comp_level == "College" else None,
                    "team_name":         t["team_name"],
                    "competition_level": comp_level,
                    "division":          division,
                    "gender":            gender,
                    "city":              t.get("city"),
                    "state":             t.get("state"),
                    "year":              year,
                    "finish":            t.get("finish"),
                }
                upsert_team(conn, row, dry_run=args.dry_run)
                total_upserted += 1

            if not args.dry_run:
                conn.commit()

            log.info(f"  {len(teams)} teams")

    conn.close()
    log.info(f"Done. Upserted={total_upserted} Skipped={total_skipped}")


if __name__ == "__main__":
    main()