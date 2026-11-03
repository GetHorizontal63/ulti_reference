# UFA Player Data Scraper — Comprehensive Design Document

## 1. Project Objective

Build a Python scraper to collect player profiles and career statistics from `watchufa.com` for all ~3,900 players in the UFA (Ultimate Frisbee Association) league. The pipeline produces data suitable for longitudinal player career analysis and cross-referencing with USAU Nationals data in a shared SQLite database.

---

## 2. Site Overview

**Base URL:** `https://watchufa.com`  
**Platform:** Drupal 7  
**Pagination:** Clean URL query params (`?page=N`) — no POST, no VIEWSTATE, no session tokens required.  
**Stats rendering:** Svelte components rendered server-side into the HTML. Full stat tables are present in the raw HTTP response. **No JavaScript execution or headless browser needed.**

---

## 3. Site Architecture

### 3.1 Layer 1 — Player List (Paginated)

**URL pattern:** `https://watchufa.com/league/players?page={N}`

**Page range:** Pages 0–194 (195 pages × 20 rows = ~3,900 players). Confirm last page number at crawl time by reading `<a title="Go to last page" href="/league/players?page=194">` from the pager on page 0.

**Data per row:**

| Field | Selector | Notes |
|---|---|---|
| `player_slug` | `td.views-field-field-player-display-name a[href]` | Extract path segment: `/league/players/{slug}` → `{slug}` |
| `display_name` | Same `a` text | May include leading space — strip |
| `most_recent_team_name` | `td.views-field-field-team-display-name a` text | e.g. "Pittsburgh Thunderbirds 2017" |
| `most_recent_team_slug` | Same `a[href]` | Format `/{team_slug}/players/{player_slug}` → extract `{team_slug}` |
| `most_recent_team_year` | Parsed from team name string | Last 4 chars |

**Pager selector for last page detection:**
```python
last_page_a = soup.select_one('li.pager-last a')
last_page = int(parse_qs(urlparse(last_page_a['href']).query)['page'][0])
```

---

### 3.2 Layer 2 — Player Profile Page

**URL pattern:** `https://watchufa.com/league/players/{player_slug}`

**Mechanism:** Plain GET. All content including stats tables is server-side rendered.

#### 3.2.1 Profile Block

Selector: `div.audl-player-box`

| Field | Selector | Notes |
|---|---|---|
| `display_name` | `.audl-player-display-name` text | |
| `current_team_name` | `.audl-player-current-team-position` text | |
| `jersey_number` | `.audl-player-jersey-number` text | Strip `#` prefix |
| `team_slug` | CSS class on `div.audl-player-box` | e.g. class `thunderbirds` — extract non-`audl-player-box` class |
| `photo_url` | `div.audl-player-profile-image img[src]` | May be default no-image URL |
| `bio_text` | `.audl-player-bio` text | May be empty |

**Team slug extraction:**
```python
box = soup.find('div', class_='audl-player-box')
classes = [c for c in box['class'] if c != 'audl-player-box']
team_slug = classes[0] if classes else None
```

#### 3.2.2 Stats Tables

Selector: `#web-panel-player-stats`

The stats block contains two sections (Regular Season and Playoffs), each with an HTML `<table>`. Both are rendered in the raw HTML by Svelte — no JS execution needed.

**Section detection:**
```python
headers = soup.select('#web-panel-player-stats .svelte-player-stats-header')
# headers[0].text == "Regular Season"
# headers[1].text == "Playoffs"
tables = soup.select('#web-panel-player-stats .svelte-player-stats-table table')
# tables[0] = Regular Season, tables[1] = Playoffs
```

**Per stat row parsing:**

Columns in order (index 0–22):

| Index | Column Header | DB Field | Type | Notes |
|---|---|---|---|---|
| 0 | Year - Team | `season_year`, `team_abbr` | TEXT | "2017 - PIT" or "Career" |
| 1 | G | `games` | INT | |
| 2 | PP | `points_played` | INT | |
| 3 | M | `minutes` | INT | |
| 4 | AST | `assists` | INT | |
| 5 | GLS | `goals` | INT | |
| 6 | BLK | `blocks` | INT | |
| 7 | +/- | `plus_minus` | INT | |
| 8 | Cmp | `completions` | INT | |
| 9 | Cmp% | `completion_pct` | REAL | |
| 10 | TY | `throw_yards` | INT | `--` → NULL |
| 11 | RY | `receive_yards` | INT | `--` → NULL |
| 12 | HA | `hockey_assists` | INT | |
| 13 | T | `turnovers` | INT | |
| 14 | S | `stalls` | INT | |
| 15 | D | `drops` | INT | |
| 16 | C | `callahans` | INT | |
| 17 | Hck | `hucks` | INT | `--` → NULL |
| 18 | Hck% | `huck_pct` | REAL | `--` → NULL |
| 19 | OPP | `offensive_points_played` | INT | |
| 20 | DPP | `defensive_points_played` | INT | |
| 21 | Pul | `pulls` | INT | |
| 22 | Pul% | `pull_pct` | REAL | `--` → NULL |
| 23 | PH | `points_per_hour` | REAL | |

**Career totals row detection:**
```python
first_td = row.find('td')
is_career = first_td.get('style', '') == 'text-align: center'
# or: first_td.text.strip() == 'Career'
```

Career rows are stored with `is_career_total = 1`. They are NOT skipped — they serve as a cross-check against summed per-season rows.

**Null handling:** `--` in any cell → store as `NULL`, not `0`.

```python
def parse_stat(text):
    t = text.strip()
    if t == '--' or t == '':
        return None
    try:
        return float(t) if '.' in t else int(t)
    except ValueError:
        return None
```

**Year/team parsing from first column:**
```python
def parse_year_team(text):
    t = text.strip()
    if t == 'Career':
        return None, None, True
    parts = t.split(' - ')
    year = int(parts[0]) if parts[0].isdigit() else None
    team_abbr = parts[1].strip() if len(parts) > 1 else None
    return year, team_abbr, False
```

---

## 4. Data Model

### 4.1 Tables

These tables live in the **shared database** alongside the USAU tables. All UFA tables are prefixed `ufa_` to avoid collision. The `data_source` field in the cross-reference identity table covers both systems.

```sql
CREATE TABLE IF NOT EXISTS ufa_players (
    player_slug         TEXT PRIMARY KEY,         -- URL slug, e.g. 'abuss'
    display_name        TEXT NOT NULL,
    current_team_name   TEXT,                     -- as of scrape time
    current_team_slug   TEXT,                     -- CSS class / team slug
    jersey_number       TEXT,
    photo_url           TEXT,
    bio_text            TEXT,
    most_recent_team_name TEXT,                   -- from player list page
    most_recent_team_year INTEGER,                -- parsed from team name
    -- Cross-reference to USAU player identity (post-processing)
    player_surrogate_id INTEGER REFERENCES player_identities(id),
    scraped_at          TEXT
);

CREATE TABLE IF NOT EXISTS ufa_player_season_stats (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    player_slug             TEXT NOT NULL REFERENCES ufa_players(player_slug),
    season_type             TEXT NOT NULL CHECK(season_type IN ('regular', 'playoffs')),
    is_career_total         INTEGER NOT NULL DEFAULT 0,
    season_year             INTEGER,              -- NULL for career totals
    team_abbr               TEXT,                 -- e.g. 'PIT', NULL for career totals
    -- Core counting stats
    games                   INTEGER,
    points_played           INTEGER,
    minutes                 INTEGER,
    assists                 INTEGER,
    goals                   INTEGER,
    blocks                  INTEGER,
    plus_minus              INTEGER,
    completions             INTEGER,
    completion_pct          REAL,
    throw_yards             INTEGER,              -- NULL if '--'
    receive_yards           INTEGER,              -- NULL if '--'
    hockey_assists          INTEGER,
    turnovers               INTEGER,
    stalls                  INTEGER,
    drops                   INTEGER,
    callahans               INTEGER,
    hucks                   INTEGER,              -- NULL if '--'
    huck_pct                REAL,                 -- NULL if '--'
    offensive_points_played INTEGER,
    defensive_points_played INTEGER,
    pulls                   INTEGER,
    pull_pct                REAL,                 -- NULL if '--'
    points_per_hour         REAL,
    scraped_at              TEXT
);

CREATE TABLE IF NOT EXISTS ufa_teams (
    team_slug       TEXT PRIMARY KEY,             -- e.g. 'thunderbirds'
    team_name       TEXT,                         -- e.g. 'Pittsburgh Thunderbirds'
    division        TEXT,                         -- 'East', 'West', 'Central', 'South'
    active          INTEGER DEFAULT 1             -- 0 for defunct franchises
);

CREATE TABLE IF NOT EXISTS ufa_scrape_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    url             TEXT NOT NULL,
    layer           TEXT NOT NULL,                -- 'player_list', 'player_profile'
    status          TEXT NOT NULL,                -- 'success', 'error', 'skip'
    http_status     INTEGER,
    error_msg       TEXT,
    scraped_at      TEXT NOT NULL
);
```

### 4.2 Shared Cross-Reference

The existing `player_identities` table in the shared DB covers both USAU and UFA players. Add a `data_source` column to the existing `players` table (USAU) and link `ufa_players.player_surrogate_id` to the same identity table. Cross-source identity resolution (matching "Aaron Buss" in UFA to "Aaron Buss" in USAU Club data) runs as a separate post-processing step.

---

## 5. Scraping Pipeline

### 5.1 Phases

```
Phase 1: Player list crawl — paginate all 195 pages, collect slugs
Phase 2: Player profile scrape — fetch each /league/players/{slug}
Phase 3: Post-processing — cross-reference with USAU player_identities
```

### 5.2 Phase 1 — Player List Crawl

```python
BASE_URL = "https://watchufa.com"

def scrape_player_list(session, db, rate_limiter):
    # Determine last page
    resp = get_with_retry(session, f"{BASE_URL}/league/players", rate_limiter)
    soup = BeautifulSoup(resp.text, 'lxml')
    last_a = soup.select_one('li.pager-last a')
    last_page = int(parse_qs(urlparse(last_a['href']).query)['page'][0])
    
    for page_num in range(last_page + 1):
        # Resume: check if page already logged as success
        if db_page_already_scraped(db, page_num):
            continue
        
        url = f"{BASE_URL}/league/players?page={page_num}"
        resp = get_with_retry(session, url, rate_limiter)
        if resp is None:
            log_ufa(db, url, 'player_list', 'error')
            continue
        
        soup = BeautifulSoup(resp.text, 'lxml')
        rows = soup.select('table.views-table tbody tr')
        
        for row in rows:
            name_a = row.select_one('td.views-field-field-player-display-name a')
            team_a = row.select_one('td.views-field-field-team-display-name a')
            if not name_a:
                continue
            
            player_slug = name_a['href'].rstrip('/').split('/')[-1]
            display_name = name_a.get_text(strip=True)
            
            team_text = team_a.get_text(strip=True) if team_a else None
            team_href = team_a['href'] if team_a else None
            team_slug = team_href.split('/')[1] if team_href else None
            team_year = int(team_text[-4:]) if team_text and team_text[-4:].isdigit() else None
            
            db_upsert_player_stub(db, {
                'player_slug': player_slug,
                'display_name': display_name,
                'most_recent_team_name': team_text,
                'most_recent_team_slug': team_slug,
                'most_recent_team_year': team_year,
            })
        
        log_ufa(db, url, 'player_list', 'success')
```

### 5.3 Phase 2 — Player Profile Scrape

For each `player_slug` in `ufa_players` where `scraped_at IS NULL`:

```python
def scrape_player_profile(session, db, player_slug, rate_limiter):
    url = f"{BASE_URL}/league/players/{player_slug}"
    resp = get_with_retry(session, url, rate_limiter)
    
    if resp is None or resp.status_code == 404:
        log_ufa(db, url, 'player_profile', 'skip')
        return
    
    soup = BeautifulSoup(resp.text, 'lxml')
    
    # Profile block
    box = soup.find('div', class_='audl-player-box')
    if not box:
        log_ufa(db, url, 'player_profile', 'error', error_msg='No player box found')
        return
    
    team_classes = [c for c in box.get('class', []) if c != 'audl-player-box']
    team_slug = team_classes[0] if team_classes else None
    
    profile = {
        'player_slug': player_slug,
        'display_name': text_or_none(box, '.audl-player-display-name'),
        'current_team_name': text_or_none(box, '.audl-player-current-team-position'),
        'jersey_number': strip_hash(text_or_none(box, '.audl-player-jersey-number')),
        'current_team_slug': team_slug,
        'photo_url': img_src(box, '.audl-player-profile-image img'),
        'bio_text': text_or_none(box, '.audl-player-bio'),
    }
    db_update_player(db, profile)
    
    # Stats tables
    stat_headers = soup.select('#web-panel-player-stats .svelte-player-stats-header')
    stat_tables = soup.select('#web-panel-player-stats .svelte-player-stats-table table')
    
    season_type_map = {0: 'regular', 1: 'playoffs'}
    
    for table_idx, table in enumerate(stat_tables):
        season_type = season_type_map.get(table_idx, 'regular')
        rows = table.select('tbody tr')
        
        for row in rows:
            cells = row.find_all('td')
            if len(cells) < 23:
                continue
            
            year, team_abbr, is_career = parse_year_team(cells[0].get_text())
            
            stat_row = {
                'player_slug': player_slug,
                'season_type': season_type,
                'is_career_total': 1 if is_career else 0,
                'season_year': year,
                'team_abbr': team_abbr,
                'games':                   parse_stat(cells[1].get_text()),
                'points_played':           parse_stat(cells[2].get_text()),
                'minutes':                 parse_stat(cells[3].get_text()),
                'assists':                 parse_stat(cells[4].get_text()),
                'goals':                   parse_stat(cells[5].get_text()),
                'blocks':                  parse_stat(cells[6].get_text()),
                'plus_minus':              parse_stat(cells[7].get_text()),
                'completions':             parse_stat(cells[8].get_text()),
                'completion_pct':          parse_stat(cells[9].get_text()),
                'throw_yards':             parse_stat(cells[10].get_text()),
                'receive_yards':           parse_stat(cells[11].get_text()),
                'hockey_assists':          parse_stat(cells[12].get_text()),
                'turnovers':               parse_stat(cells[13].get_text()),
                'stalls':                  parse_stat(cells[14].get_text()),
                'drops':                   parse_stat(cells[15].get_text()),
                'callahans':               parse_stat(cells[16].get_text()),
                'hucks':                   parse_stat(cells[17].get_text()),
                'huck_pct':                parse_stat(cells[18].get_text()),
                'offensive_points_played': parse_stat(cells[19].get_text()),
                'defensive_points_played': parse_stat(cells[20].get_text()),
                'pulls':                   parse_stat(cells[21].get_text()),
                'pull_pct':                parse_stat(cells[22].get_text()),
                'points_per_hour':         parse_stat(cells[23].get_text()) if len(cells) > 23 else None,
            }
            db_insert_stat_row(db, stat_row)
    
    db_mark_player_scraped(db, player_slug)
    log_ufa(db, url, 'player_profile', 'success')
```

### 5.4 Phase 3 — Cross-Reference with USAU

Post-processing step run after both USAU and UFA scrapes are complete.

1. Load all `(display_name, ufa_player_slug)` from `ufa_players`.
2. Load all `(player_name, player_surrogate_id)` from `player_identities`.
3. Exact name match → assign `player_surrogate_id` to `ufa_players` row.
4. Near-match (edit distance ≤ 2 after normalization) → add to `review_queue.csv`.
5. No match → create new `player_identities` record with `data_source='ufa'`.

---

## 6. HTTP Client

Reuse the same `RateLimiter`, `get_with_retry`, and `HEADERS` from the USAU scraper (`http_client.py`). UFA is a standard Drupal site with no rate limiting observed, but maintain 1.5s minimum delay out of courtesy.

**No special session handling needed** — no cookies, no VIEWSTATE, no authentication.

---

## 7. Parser Helpers

```python
def text_or_none(soup_element, selector):
    el = soup_element.select_one(selector)
    if not el:
        return None
    t = el.get_text(strip=True)
    return t if t else None

def strip_hash(text):
    if text is None:
        return None
    return text.lstrip('#').strip()

def img_src(soup_element, selector):
    img = soup_element.select_one(selector)
    return img['src'] if img and img.get('src') else None

def parse_stat(text):
    t = text.strip() if text else ''
    if t in ('--', '', 'N/A'):
        return None
    try:
        if '.' in t:
            return float(t)
        return int(t)
    except ValueError:
        return None

def parse_year_team(text):
    """Parse '2017 - PIT' into (2017, 'PIT', False) or 'Career' into (None, None, True)."""
    t = text.strip()
    if t.lower() == 'career':
        return None, None, True
    parts = t.split(' - ', 1)
    try:
        year = int(parts[0].strip())
    except (ValueError, IndexError):
        year = None
    team_abbr = parts[1].strip() if len(parts) > 1 else None
    return year, team_abbr, False
```

---

## 8. CLI Interface

The UFA scraper runs as a separate entry point but shares the same DB file:

```
ufa_scraper.py [OPTIONS]

Options:
  --phases TEXT      Comma-separated phases to run (1,2,3)
                     Default: 1,2
  --db PATH          Database path (default: usau_data.db — shared with USAU scraper)
  --force            Re-scrape already-completed items
  --log-level TEXT   DEBUG, INFO, WARNING (default: INFO)
  --dry-run          Print URLs that would be fetched; no HTTP requests

Examples:
  # Full pipeline
  python ufa_scraper.py

  # Re-scrape profiles only (e.g. after schema change)
  python ufa_scraper.py --phases 2 --force

  # Use separate DB
  python ufa_scraper.py --db ufa_only.db
```

---

## 9. Rate Limiting and Volume

| Phase | Requests | Volume | Time at 1.5s/req |
|---|---|---|---|
| 1 (Player list) | One per page | 195 GETs | ~5 min |
| 2 (Player profiles) | One per player | ~3,900 GETs | ~98 min |

**Total:** ~1.75 hours. Run Phase 1 first to populate stubs, then Phase 2 incrementally.

---

## 10. Project Structure

```
usau_scraper/
├── usau_scraper.py          # USAU CLI entry point (existing)
├── ufa_scraper.py           # UFA CLI entry point (new)
├── db.py                    # Shared DB init — creates both USAU and UFA tables
├── http_client.py           # Shared session, rate limiter, retry logic
├── parsers/
│   ├── ...                  # Existing USAU parsers
│   ├── ufa_player_list.py   # Phase 1: paginated player list
│   └── ufa_player_profile.py # Phase 2: player profile + stats tables
├── pipeline/
│   ├── ...                  # Existing USAU phases
│   ├── ufa_phase1.py
│   ├── ufa_phase2.py
│   └── ufa_phase3.py
├── config.py                # Shared config — add UFA_BASE_URL
├── identity.py              # Extended for cross-source (USAU + UFA) resolution
├── requirements.txt
└── README.md
```

---

## 11. Known Site Quirks and Gotchas

| Quirk | Notes |
|---|---|
| Stats rendered by Svelte but server-side | Tables are in raw HTML. No headless browser or JS execution needed. |
| `--` in stat cells | Means no data recorded, not zero. Store as NULL. |
| Career totals row | Detected by `text-align: center` style on first `<td>` or text "Career". Store with `is_career_total=1`. |
| Leading space in display names | Player list `<a>` text often starts with a space. Always `.strip()`. |
| Team slug from CSS class | The team affiliation on the profile box is encoded as a CSS class (e.g. `thunderbirds`). Extract all classes that aren't `audl-player-box`. |
| Duplicate player slugs | Two "Aaron Richards" exist as `arichards` and `arichards1`. Slugs are unique; display names are not. Use slug as PK. |
| Players with no stats | Some players have a profile box but empty stats tables (retired early, limited appearances). Handle gracefully — insert player row with no stat rows. |
| Stats table column count | Some older player records may have fewer columns if certain stats weren't tracked in early seasons (TY, RY, Hck columns show `--` for pre-2018 data). Always check `len(cells)` before indexing. |
| `most_recent_team_year` in player list | Parsed from the trailing 4 digits of the team name string ("Pittsburgh Thunderbirds 2017" → 2017). Validate it's a plausible year before storing. |
| Page count may change | If active season is in progress, new players may be added. Re-run Phase 1 before Phase 2 to catch additions. |

---

## 12. Cross-Source Identity Resolution (USAU + UFA)

After both USAU and UFA scrapes complete, `identity.py` runs a combined resolution pass:

1. Collect all names from `players` (USAU) and `ufa_players` (UFA).
2. For each UFA player not yet linked (`player_surrogate_id IS NULL`):
   a. Exact match against `player_identities.canonical_name` → link.
   b. Fuzzy match (rapidfuzz, threshold 90) → flag for review.
   c. No match → create new `player_identities` row with `data_source='ufa'`.
3. Output `cross_source_review.csv` for cases requiring manual adjudication.

High-value cross-references expected: players like Mac Hecht, Jimmy Mickle, Tobe Decraene, and others who appear in both USAU Club Nationals data and UFA records.

---

## 13. Deliverables

| Artifact | Description |
|---|---|
| `usau_data.db` | Shared SQLite database — USAU tables + UFA tables |
| `ufa_scrape.log` | Full log of all HTTP requests and outcomes |
| `cross_source_review.csv` | USAU–UFA player matches requiring manual review |

---

*Document version: 1.0 — covers player list pagination and player profile/stats pages from watchufa.com.*