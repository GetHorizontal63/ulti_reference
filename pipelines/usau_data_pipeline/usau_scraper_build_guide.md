# USAU Historical Data Scraper — Comprehensive Design Document

## 1. Project Objective

Build a Python scraper to collect roster, game, and player-stats data from `play.usaultimate.org` for longitudinal player tracking across 11 competition brackets at USAU Nationals-level events, spanning seasons 2014–2025. The pipeline produces a normalized SQLite database suitable for cross-year player career analysis.

---

## 2. Target Scope

### 2.1 Divisions

| Division | Competition Level | Gender |
|---|---|---|
| Club Men | Club | Men |
| Club Women | Club | Women |
| Club Mixed | Club | Mixed |
| College Open | College | Men |
| College Women | College | Women |
| Youth U-20 Boys D1 | Youth | Men |
| Youth U-20 Boys D2 | Youth | Men |
| Youth U-20 Girls | Youth | Women |
| Youth U-17 Boys | Youth | Men |
| Youth U-17 Girls | Youth | Women |
| Youth U-20 Mixed | Youth | Mixed |

### 2.2 Event Filter

- **Event type:** Championship Tournament (`drpEventTypeId=8`)
- **Seasons:** 2014–2025 (`drpSeasonId` values 4–20)
- **Competition level IDs** (for `drpCompetitionLevelId`):

| Division | ID |
|---|---|
| Club Men | 21 |
| Club Women | 22 |
| Club Mixed | 7 |
| College Men | 27 |
| College Women | 28 |
| Youth U-20 Boys D1 | 23 |
| Youth U-20 Boys D2 | (verify at crawl time) |
| Youth U-20 Girls | 24 |
| Youth U-17 Boys | 25 |
| Youth U-17 Girls | 26 |
| Youth U-20 Mixed | 6 |

> Division IDs that aren't confirmed above must be verified at crawl time by inspecting the `drpCompetitionLevelId` select element on the tournament calendar page.

### 2.3 Geographic / Field Scope

Only teams appearing in the scraped Nationals events are in scope. No regular-season or regional data is collected unless it happens to appear in a team's game log on pages we already visit for other reasons.

---

## 3. Site Architecture

### 3.1 Layer 1 — Tournament Calendar

**URL:** `https://play.usaultimate.org/events/tournament/`

**Mechanism:** ASP.NET WebForms. The initial GET renders the search form with `__VIEWSTATE` and `__EVENTVALIDATION` tokens. Pagination and form submission both use `__doPostBack`, which POST-submits the form carrying those tokens. Tokens change on every response. Approximately 7,400 past events exist across ~370 pages at 20 events/page.

**Filter strategy:** Submit the search form with target `drpCompetitionLevelId`, `drpSeasonId=4..20`, and `drpEventTypeId=8`. This reduces pages to crawl to a manageable subset.

**Session requirements:** Must maintain a `requests.Session` across all POSTs. Extract `__VIEWSTATE` and `__EVENTVALIDATION` from each response before issuing the next request. Do **not** hardcode these tokens — they are dynamic.

**Data to extract per event row:**

| Field | Source |
|---|---|
| `event_slug` | `href` attribute of event link: `/events/{slug}/` → extract `{slug}` |
| `event_title` | Link text |
| `city`, `state` | Location cell text |
| `date_start`, `date_end` | Date cell text (parse "MMM D – D, YYYY" or similar) |
| `competition_groups` | Division + team count cell (e.g. "Club - Men (16 teams)") |
| `season_year` | Derived from `drpSeasonId` or parsed from event title/date |

**Pagination:** After extracting rows from a page, POST `__doPostBack('CT_Main_0_gvTournaments$ctl01$btnPageNext','')` (or whatever the next-page postback target is — inspect the actual HTML) carrying the latest VIEWSTATE tokens.

---

### 3.2 Layer 2 — Event Landing Page

**URL:** `https://play.usaultimate.org/events/{event_slug}/`

**Mechanism:** Plain GET. No POST needed.

**Data to extract:**

| Field | Source |
|---|---|
| `event_id` | Embedded in the `checkStandings` JS call: `event: 14412` |
| `event_group_id` | Also in JS: `eventGroup: 19538` |
| `city`, `state` | Event header / location metadata |
| `date_start`, `date_end` | Event date range in header |
| `divisions_present` | `<dt class="groupTitle">` elements listing available divisions |

**Schedule URL construction:** Do **not** POST the schedule buttons. Schedule URLs follow the pattern:

```
/events/{slug}/schedule/{Gender}/{CompetitionLevel}-{Gender}/
```

However, the gender and level URL segments have varied across years and divisions (e.g. College used `Open` before switching to `Men`; Youth uses `Boys`/`Girls` not `Men`/`Women`). Rather than maintaining a hardcoded mapping, **iterate through all candidate combinations** for every event and probe each URL. Record hits and misses in `scrape_log`. The full candidate matrix is defined in `config.py` (see Section 5.3).

---

### 3.3 Layer 3 — Division Schedule Page

**URL:** `https://play.usaultimate.org/events/{slug}/schedule/{Gender}/{CompetitionLevel}-{Gender}/`

**Mechanism:** Plain GET. All tabs (Pool Play, bracket rounds, placement brackets) are rendered in the DOM simultaneously with `display:none` on inactive tabs. **One GET retrieves everything.**

**Not-found detection:** The site does not always return HTTP 404 for missing schedule URLs. It may return HTTP 200 with a soft error page. Both must be treated as "not found":

```python
SLUG_NOT_FOUND_MARKER = "Sorry, the page you requested could not be found."

def is_not_found(response):
    if response is None:
        return True
    if response.status_code == 404:
        return True
    if SLUG_NOT_FOUND_MARKER in response.text:
        return True
    return False
```

**Slug probing:** For each event, iterate through all candidate `(Gender, CompetitionLevel)` combinations defined in `config.py`. Fetch each candidate URL. On not-found (either HTTP 404 or soft error page), log as `skip` and continue to next candidate. On success (HTTP 200 without error marker and containing schedule content), parse and write data, then log as `success`. All results — hits and misses — are written to `scrape_log` for auditing what URL patterns actually exist across the dataset.

**Tab context:** Extract the tab label from `<ul class="tabsLeft tabs"> > li > a` text. The `rel` attribute of each tab's anchor (`rel="section_{id}_{type}_{group}"`) provides section identifiers. Use the tab label as `round_context` for games found in the corresponding section.



Selector: `div.pool`

Per pool:
- Pool name from `h3.col_title` text
- Per team row (skip header): team name and `EventTeamId` from `<a href="/events/teams/?EventTeamId=...">`, W-L record from `.WinLosePoints`

#### 3.3.2 Pool Schedule Tables

Selector: `table.global_table.scores_table`

Each table has a `<th colspan="8">Pool X Schedule & Scores</th>` header. Per game row (`<tr data-game="{numeric_id}">`):

| Field | Selector / Note |
|---|---|
| `numeric_game_id` | `data-game` attribute |
| `game_date` | `span[data-type="game-date"]` text |
| `game_time` | `span[data-type="game-time"]` text |
| `field` | Third `<td>` → `span` with broken attribute `data-type"game-field"=""` — select by position (index 2 within the row), not by attribute |
| `home_team_name`, `home_event_team_id` | `span[data-type="game-team-home"] a` — name from text, ID from `href` query param |
| `away_team_name`, `away_event_team_id` | `span[data-type="game-team-away"] a` |
| `home_score` | `span[data-type="game-score-home"]` text |
| `away_score` | `span[data-type="game-score-away"]` text |
| `status` | `span[data-type="game-status"]` text |
| `event_game_id` | `<a class="options editGame editPool" href="/teams/events/match_report/?EventGameId=...">` — extract token from href |
| `round_context` | Tab label of the containing section (e.g. "Pool Play") |
| `pool_name` | From preceding `table thead th` text ("Pool A Schedule & Scores" → "Pool A") |

> **Known HTML bug:** The `game-field` span has `data-type"game-field"=""` (missing `=` after `data-type`). Do NOT use `soup.find_all(attrs={"data-type": "game-field"})` — it won't match. Parse field by positional index of the `<td>` elements.

#### 3.3.3 Bracket Game Divs

Selector: `div.bracket_game` (has `id="game{numeric_id}"`)

Per bracket game div:

| Field | Selector |
|---|---|
| `numeric_game_id` | `div.bracket_game` `id` attribute, strip "game" prefix |
| `event_game_id` | `div.gameID_area a[href*="match_report"]` href query param |
| `round_label` | Parent `h4.col_title` text (e.g. "Final", "Semifinals", "Quarterfinals") |
| `home_team_name`, `home_event_team_id` | `div.top_area span[data-type="game-team-home"] a` |
| `away_team_name`, `away_event_team_id` | `div.btm_area span[data-type="game-team-away"] a` |
| `home_score` | `div.top_area span[data-type="game-score-home"]` |
| `away_score` | `div.btm_area span[data-type="game-score-away"]` |
| `field` | `p.location` text |
| `game_datetime` | `span.date` text (format: "MM/DD/YYYY HH:MM AM/PM") |
| `status` | `span.game-status` text |
| `winner_side` | CSS class on `top_area`/`btm_area`: `winner` or `loser` |
| `bracket_section` | `h3.slide_trigger a` text of the enclosing `div.mod_slide` (e.g. "National Championship", "Fifth Place Bracket") |
| `round_context` | Tab label of containing tab section |

#### 3.3.4 Crossover / Cluster Tables

Same structure as pool schedule tables (`<table class="global_table scores_table">`), distinguished by `thead th` text (e.g. "Crossovers"). Parse identically to pool tables. Set `round_context` from the tab label and `pool_name` to `None`.

#### 3.3.5 Team Harvest

From a single schedule page GET, collect all unique `EventTeamId` tokens encountered across pool standing tables, pool schedule rows, and bracket game divs. This is the complete team list for the event+division — no separate discovery step needed.

---

### 3.4 Layer 4 — Event Team Roster Page

**URL:** `https://play.usaultimate.org/events/teams/?EventTeamId={token}`

**Mechanism:** Plain GET.

**Data to extract:**

| Field | Source |
|---|---|
| `team_name` | `h4` in `.profile_area` |
| `city`, `state` | `#CT_Main_0_ucTeamDetails_dlCity` text |
| `competition_level` | `#CT_Main_0_ucTeamDetails_dlCompetitionLevel dd` |
| `gender_division` | `#CT_Main_0_ucTeamDetails_dlGenderDivision dd` |
| `coaches` | `#CT_Main_0_ucTeamDetails_dlHeadCoach dd` — parse each `<br>`-delimited entry; identify head coach from "(Head Coach)" suffix |
| `numeric_team_id` | Extract from right-rail game result links: `<a href="/events/teams/?EventTeamId=...">` — also check if a stable integer ID appears anywhere (it appears as `1262047` on the match report page; cross-reference via match report scrape) |

**Roster table** — `#CT_Main_0_ucTeamDetails_gvList`:

Per player row (skip header):

| Column | Field |
|---|---|
| 0 | `jersey_number` |
| 1 | `player_name` |
| 2 | `pronouns` (may be empty) |
| 3 | `position` (may be empty/`&nbsp;`) |
| 4 | `height` (may be `&nbsp;`) |
| 5 | `tournament_goals` (span `lblPoints`) |
| 6 | `tournament_assists` (span `lblAssists`) |
| 7 | `tournament_ds` (span `lblDs`) |
| 8 | `tournament_turns` (span `lblTurns`) |

> Empty `<span>` elements (no text) mean zero-or-null — store as `NULL` or `0` (decided per data model section).

**Right-rail game log:** Skip. Redundant with schedule page data and out of scope for this pipeline.

---

### 3.5 Layer 5 — Match Report (Optional, Secondary Pass)

**URL:** `https://play.usaultimate.org/teams/events/match_report/?EventGameId={token}`

**Mechanism:** Plain GET.

**Condition:** Only scrape if match reports are in scope for the run. The `EventGameId` token is harvested in Layer 3. Not all events/years have match report data; absence should be handled gracefully (404 or empty stats tables).

**Data to extract:**

| Field | Source |
|---|---|
| `numeric_game_id` | `<input id="hdnEventGameId">` value |
| `numeric_home_team_id` | `<input id="hdnHomeTeamEventTeamId">` value |
| `numeric_away_team_id` | `<input id="hdnAwayTeamEventTeamId">` value |
| `game_status` | Text in `div#CT_Main_0_upMatchReport > div > p` (e.g. "Final") |
| `home_score` | `span#CT_Main_0_lblHomeScore` |
| `away_score` | `span#CT_Main_0_lblAwayScore` |
| `home_coach` | `span#CT_Main_0_lblHomeCoach` |
| `away_coach` | `span#CT_Main_0_lblAwayCoach` |

**Per-game player stats** — `#CT_Main_0_gvHomeList` and `#CT_Main_0_gvAwayList`:

Per player row:

| Column | Field |
|---|---|
| 0 | `#{jersey} PlayerName` — parse jersey and name |
| 1 | `goals` |
| 2 | `assists` |
| 3 | `ds` |
| 4 | `turns` |

> These are **per-game** stats, not tournament totals. This is the only source of game-level individual stats in the entire pipeline.

**Point progression** — `#CT_Main_0_gvGameSummary`: Skip. The running score progression is useful for future analysis but not required for the initial build.

**Right-rail leaderboards:** Skip. These are tournament-aggregate stats derivable from summing match report rows.

---

### 3.6 Layer 6 — Season Team Page (Reference Only)

**URL:** `https://play.usaultimate.org/teams/events/Eventteam/?TeamId={token}`

> Note the non-standard capitalization: `Eventteam`.

This page is **not part of the primary scrape pipeline**. It provides season-wide stats and a game log across all events for a franchise in a given year. It is useful for:
- Cross-referencing player stats across the full season
- Discovering the season-scoped `TeamId` token for a franchise

The `TeamId` token on this page is **different** from the `EventTeamId` token on the event roster page. The relationship between them is not directly exposed in the HTML; they must be cross-referenced via team name + season year.

This layer is deferred to a future enhancement.

---

## 4. Data Model

### 4.1 Table Definitions

```sql
CREATE TABLE events (
    event_slug        TEXT PRIMARY KEY,
    event_title       TEXT NOT NULL,
    event_id          INTEGER,             -- from JS checkStandings call
    event_group_id    INTEGER,             -- from JS checkStandings call
    city              TEXT,
    state             TEXT,
    date_start        TEXT,               -- ISO 8601 date string
    date_end          TEXT,
    season_year       INTEGER NOT NULL,
    competition_level TEXT NOT NULL,      -- 'Club', 'College', 'Youth'
    gender            TEXT NOT NULL,      -- 'Men', 'Women', 'Mixed'
    division_label    TEXT,               -- 'Club-Men', 'College-Women', etc.
    scraped_at        TEXT
);

CREATE TABLE teams (
    event_team_id     TEXT PRIMARY KEY,   -- URL-encoded EventTeamId token
    numeric_team_id   INTEGER,            -- integer from hdnHomeTeamEventTeamId; may be null
    team_name         TEXT NOT NULL,
    city              TEXT,
    state             TEXT,
    competition_level TEXT,
    gender_division   TEXT,
    event_slug        TEXT REFERENCES events(event_slug),
    scraped_at        TEXT
);

CREATE TABLE team_coaches (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    event_team_id     TEXT REFERENCES teams(event_team_id),
    coach_name        TEXT NOT NULL,
    is_head_coach     INTEGER NOT NULL DEFAULT 0  -- boolean
);

CREATE TABLE players (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    event_team_id     TEXT NOT NULL REFERENCES teams(event_team_id),
    event_slug        TEXT NOT NULL REFERENCES events(event_slug),
    player_name       TEXT NOT NULL,
    jersey_number     TEXT,              -- stored as text; may be '0', '00', etc.
    pronouns          TEXT,
    position          TEXT,
    height            TEXT,
    -- Tournament-aggregate stats from event roster page
    tournament_goals  INTEGER,
    tournament_assists INTEGER,
    tournament_ds     INTEGER,
    tournament_turns  INTEGER,
    -- Player identity surrogate key (post-processing step)
    player_surrogate_id INTEGER REFERENCES player_identities(id),
    scraped_at        TEXT
);

CREATE TABLE player_identities (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_name    TEXT NOT NULL,
    first_seen_event  TEXT REFERENCES events(event_slug),
    first_seen_team   TEXT REFERENCES teams(event_team_id),
    notes             TEXT
);

CREATE TABLE games (
    event_game_id         TEXT PRIMARY KEY,  -- URL-encoded EventGameId token
    numeric_game_id       INTEGER,
    event_slug            TEXT NOT NULL REFERENCES events(event_slug),
    division_label        TEXT,
    round_context         TEXT,              -- tab label (e.g. 'Pool Play', '2025 Men's National Championship')
    bracket_section       TEXT,              -- sub-bracket within tab (e.g. 'National Championship', 'Fifth Place Bracket')
    round_label           TEXT,              -- column within bracket (e.g. 'Final', 'Semifinals', 'Quarterfinals')
    pool_name             TEXT,              -- 'Pool A', 'Pool B', etc.; NULL for bracket games
    game_date             TEXT,
    game_time             TEXT,
    game_datetime         TEXT,              -- combined ISO 8601 when available
    field                 TEXT,
    home_event_team_id    TEXT REFERENCES teams(event_team_id),
    away_event_team_id    TEXT REFERENCES teams(event_team_id),
    home_score            INTEGER,
    away_score            INTEGER,
    status                TEXT,
    has_match_report      INTEGER NOT NULL DEFAULT 0,  -- boolean
    match_report_scraped  INTEGER NOT NULL DEFAULT 0,
    scraped_at            TEXT
);

CREATE TABLE game_player_stats (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    event_game_id     TEXT NOT NULL REFERENCES games(event_game_id),
    event_team_id     TEXT NOT NULL REFERENCES teams(event_team_id),
    numeric_team_id   INTEGER,              -- from hdnHomeTeamEventTeamId / hdnAwayTeamEventTeamId
    player_name       TEXT NOT NULL,
    jersey_number     TEXT,
    goals             INTEGER,
    assists           INTEGER,
    ds                INTEGER,
    turns             INTEGER,
    -- FK to players table (post-processing join)
    player_id         INTEGER REFERENCES players(id),
    scraped_at        TEXT
);

CREATE TABLE scrape_log (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    url               TEXT NOT NULL,
    layer             TEXT NOT NULL,       -- 'calendar', 'event', 'schedule', 'roster', 'match_report'
    status            TEXT NOT NULL,       -- 'success', 'error', 'skip'
    http_status       INTEGER,
    detail            TEXT,               -- e.g. gender/level slug combination tried
    error_msg         TEXT,
    scraped_at        TEXT NOT NULL
);
```

### 4.2 Null vs. Zero for Stats

Player stat fields in `players` and `game_player_stats` use `NULL` (not `0`) when the source HTML contains an empty `<span>`. A player with `NULL` goals played in the event but had no goals recorded (which may mean they didn't appear in a game with stats, not that they scored zero). This distinction matters for analysis. Store `0` only when the source explicitly shows `0`.

### 4.3 Player Identity Resolution (Post-Processing)

No player-level IDs exist anywhere in the site. Player identity across years is resolved via the `player_identities` table, populated in a separate post-processing step after all raw data is scraped:

1. **Exact name match** across events: same `player_name` string → likely same person. Assign shared `player_surrogate_id`.
2. **Fuzzy match** for name variations (nicknames, hyphenation changes, typos): use `rapidfuzz` with blocking by first initial + height when available.
3. **Manual review queue**: cases where fuzzy match confidence is below threshold are written to a CSV for human review.

Expected noise: ~5–10% of player appearances will require manual resolution.

---

## 5. Scraping Pipeline

### 5.1 Phases

```
Phase 0: Bootstrap / setup
Phase 1: Event discovery (tournament calendar)
Phase 2: Event landing pages
Phase 3: Schedule pages (games + teams)
Phase 4: Event team roster pages
Phase 5: Match report pages (optional)
Phase 6: Post-processing (player identity resolution)
```

Phases 1–4 are the **primary pipeline** and must be completed before Phase 5 begins. Phase 5 can be run independently and incrementally.

### 5.2 Phase 0 — Setup

```python
import requests
import sqlite3
import time
import logging
from pathlib import Path
from bs4 import BeautifulSoup
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

BASE_URL = "https://play.usaultimate.org"
DB_PATH = Path("usau_data.db")
LOG_PATH = Path("scrape.log")

RATE_LIMIT_SECONDS = 1.5       # minimum delay between requests
RATE_LIMIT_JITTER = 0.5        # add random(0, JITTER) on top
REQUEST_TIMEOUT = 30
MAX_RETRIES = 3
RETRY_BACKOFF = [5, 15, 45]    # seconds between retries

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; research scraper; contact: you@example.com)",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}
```

Initialize the database (run `CREATE TABLE IF NOT EXISTS` for all tables above). Initialize a `requests.Session` with the headers above.

### 5.3 Phase 1 — Event Discovery

For each target `(competition_level_id, season_id)` pair:

1. GET `https://play.usaultimate.org/events/tournament/` — extract initial `__VIEWSTATE`, `__EVENTVALIDATION`.
2. POST with form data:
   ```
   __EVENTTARGET=
   __EVENTARGUMENT=
   __VIEWSTATE={value}
   __EVENTVALIDATION={value}
   CT_Main_0$drpCompetitionLevelId={level_id}
   CT_Main_0$drpSeasonId={season_id}
   CT_Main_0$drpEventTypeId=8
   CT_Main_0$btnSearch=Search
   ```
3. Parse result page for event rows. Extract `event_slug`, `title`, location, dates, competition groups.
4. Insert or ignore into `events` table.
5. Extract next-page postback target from pagination controls (if present).
6. While next page exists: re-POST carrying updated VIEWSTATE tokens + `__EVENTTARGET={next_page_target}`.
7. Rate-limit between all requests.

**Resume capability:** Before POSTing for a `(level_id, season_id)` pair, check if `events` table already has rows for that season + division. If fully covered, skip.

### 5.4 Phase 2 — Event Landing Pages

For each `event_slug` in the `events` table where `event_id IS NULL`:

1. GET `https://play.usaultimate.org/events/{event_slug}/`
2. Extract `event_id` and `event_group_id` from the embedded JS `checkStandings` call via regex: `event:\s*(\d+)` and `eventGroup:\s*(\d+)`.
3. Extract city, state, date range, and confirm which divisions are present.
4. UPDATE `events` row.

**Skip condition:** If `event_id` is already populated, skip.

### 5.3 Phase 3 — Schedule Pages

#### 5.3.1 Candidate URL Matrix

Defined in `config.py`. Every combination of gender segment × level segment is tried for every event:

```python
# All known gender URL segments across all years and divisions
GENDER_SEGMENTS = [
    "Men",
    "Women",
    "Mixed",
    "Boys",
    "Girls",
    "Open",       # College division pre-rename
]

# All known competition level URL segments
LEVEL_SEGMENTS = [
    "Club",
    "College",
    "Youth-Club-U-20",
    "Youth-Club-U-17",
    "Youth-U-20",       # alternate format, verify
    "Youth-U-17",       # alternate format, verify
]

def schedule_url_candidates(base_url, event_slug):
    """Generate all (gender, level, url) candidates for an event."""
    candidates = []
    for gender in GENDER_SEGMENTS:
        for level in LEVEL_SEGMENTS:
            url = f"{base_url}/events/{event_slug}/schedule/{gender}/{level}-{gender}/"
            candidates.append((gender, level, url))
    return candidates  # 36 combinations
```

#### 5.3.2 Not-Found Detection

```python
SLUG_NOT_FOUND_MARKER = "Sorry, the page you requested could not be found."

def is_not_found(response):
    if response is None:
        return True
    if response.status_code == 404:
        return True
    if SLUG_NOT_FOUND_MARKER in response.text:
        return True
    return False

def has_schedule_content(response):
    """Confirm the page actually contains schedule data, not just a valid shell."""
    return (
        'class="tabsLeft tabs"' in response.text
        or 'data-game=' in response.text
        or 'class="bracket_game"' in response.text
    )
```

#### 5.3.3 Probe and Parse Loop

For each `events` row:

```python
for event_slug in pending_events:
    found_any = False
    for gender, level, url in schedule_url_candidates(BASE_URL, event_slug):
        resp = get_with_retry(session, url, rate_limiter)
        
        if is_not_found(resp) or not has_schedule_content(resp):
            log_scrape(db, url, 'schedule', 'skip',
                       http_status=resp.status_code if resp else None,
                       detail=f"{gender}/{level}")
            continue
        
        # Valid schedule page found
        log_scrape(db, url, 'schedule', 'success',
                   http_status=200,
                   detail=f"{gender}/{level}")
        found_any = True
        
        soup = BeautifulSoup(resp.text, 'lxml')
        games, team_ids = parse_schedule_page(soup, event_slug, gender, level)
        
        db_upsert_games(db, games)
        db_upsert_teams_stub(db, team_ids, event_slug)
    
    if not found_any:
        logging.warning(f"No schedule URLs found for event: {event_slug}")
```

**Volume note:** 36 candidates × ~150 events = up to 5,400 probes in the worst case. In practice the majority return not-found quickly. At 1.5s/request worst-case is ~2.25 hours; realistically ~30–45 minutes since most probes will 404 fast. The `scrape_log` table accumulates the full hit/miss record, enabling post-run analysis of which URL patterns are actually in use across years.

**Resume:** Before probing, check `scrape_log` — if a `(event_slug, gender, level)` combination already has a `success` or `skip` entry, skip it unless `--force` is set.



### 5.4 Phase 4 — Event Team Roster Pages

For each `event_team_id` in the `teams` table where `scraped_at IS NULL`:

1. Decode the `EventTeamId` token and construct URL:
   ```python
   url = f"{BASE_URL}/events/teams/?EventTeamId={event_team_id}"
   ```
2. GET the page.
3. Parse team metadata and update `teams` row.
4. Parse roster table → write rows to `players` table.
5. Write coach rows to `team_coaches`.
6. Mark `scraped_at` on team row.

**Rate-limit:** Apply standard delay. This phase generates the most requests (one per team per event). For 11 divisions × 12 years × ~16 teams = ~2,100 team pages.

### 5.5 Phase 5 — Match Report Pages (Optional)

Enabled by CLI flag `--match-reports`.

For each `games` row where `has_match_report=1` and `match_report_scraped=0`:

1. GET `https://play.usaultimate.org/teams/events/match_report/?EventGameId={event_game_id}`
2. On 404 or empty stats tables: mark `match_report_scraped=1`, log skip, continue.
3. Extract `numeric_game_id`, `numeric_home_team_id`, `numeric_away_team_id` from hidden inputs.
4. Update `games` row with numeric IDs.
5. Parse `#CT_Main_0_gvHomeList` and `#CT_Main_0_gvAwayList` → write rows to `game_player_stats`.
6. Mark `match_report_scraped=1`.

**Volume estimate:** ~50 games/event × 132 events ≈ 6,600 match report requests. At 1.5s/request ≈ 2.75 hours for this phase alone.

---

## 6. HTTP Client Implementation

### 6.1 Rate Limiting

```python
import time, random

class RateLimiter:
    def __init__(self, min_delay=1.5, jitter=0.5):
        self.min_delay = min_delay
        self.jitter = jitter
        self._last_request = 0.0

    def wait(self):
        elapsed = time.monotonic() - self._last_request
        delay = self.min_delay + random.uniform(0, self.jitter)
        if elapsed < delay:
            time.sleep(delay - elapsed)
        self._last_request = time.monotonic()
```

### 6.2 Retry Logic

```python
def get_with_retry(session, url, rate_limiter, max_retries=3):
    for attempt in range(max_retries):
        rate_limiter.wait()
        try:
            resp = session.get(url, timeout=30, headers=HEADERS)
            if resp.status_code == 200:
                return resp
            if resp.status_code == 404:
                return None   # caller handles 404 as skip
            if resp.status_code in (429, 503):
                wait = RETRY_BACKOFF[attempt]
                logging.warning(f"Rate limited on {url}, waiting {wait}s")
                time.sleep(wait)
                continue
            resp.raise_for_status()
        except requests.RequestException as e:
            if attempt == max_retries - 1:
                logging.error(f"Failed {url}: {e}")
                return None
            time.sleep(RETRY_BACKOFF[attempt])
    return None

def post_with_retry(session, url, data, rate_limiter, max_retries=3):
    # Same pattern but with session.post(url, data=data, ...)
    pass
```

### 6.3 VIEWSTATE Extraction

```python
def extract_asp_tokens(soup):
    vs = soup.find('input', {'id': '__VIEWSTATE'})
    ev = soup.find('input', {'id': '__EVENTVALIDATION'})
    return {
        '__VIEWSTATE': vs['value'] if vs else '',
        '__EVENTVALIDATION': ev['value'] if ev else '',
        '__EVENTTARGET': '',
        '__EVENTARGUMENT': '',
    }
```

### 6.4 EventTeamId Token Handling

The `EventTeamId` tokens are URL-encoded Base64 strings (e.g. `ljDHY8fYBoVH1RmKfVxfemxD0oCzWc5FIlvTwh41DPo%3d`). Store them **URL-encoded** as the primary key in the database, since that is how the site uses them. When constructing URLs, use `requests` params or manually encode — do not double-encode.

```python
from urllib.parse import unquote, quote

def extract_event_team_id(href):
    # href = "/events/teams/?EventTeamId=ljDHY8fY...%3d"
    qs = parse_qs(urlparse(href).query)
    return qs.get('EventTeamId', [None])[0]  # returns URL-encoded token
```

---

## 7. HTML Parsing Helpers

### 7.1 Pool Table Parser

```python
def parse_pool_schedule_table(table, tab_label, event_slug):
    """Parse a <table class="global_table scores_table"> into game dicts."""
    header = table.find('thead').get_text(strip=True)  # "Pool A Schedule & Scores"
    pool_name = header.replace('Schedule & Scores', '').replace('&', '&').strip()
    
    games = []
    for row in table.find('tbody').find_all('tr', attrs={'data-game': True}):
        cells = row.find_all('td')
        game_date = cells[0].get_text(strip=True)
        game_time = cells[1].get_text(strip=True)
        field = cells[2].get_text(strip=True)
        
        home_a = cells[3].find('a')
        away_a = cells[4].find('a')
        home_name = home_a.get_text(strip=True) if home_a else None
        away_name = away_a.get_text(strip=True) if away_a else None
        home_etid = extract_event_team_id(home_a['href']) if home_a else None
        away_etid = extract_event_team_id(away_a['href']) if away_a else None
        
        score_spans = cells[5].find_all('span', class_='adjust-data')
        home_score = score_spans[0].get_text(strip=True) if len(score_spans) > 0 else None
        away_score = score_spans[1].get_text(strip=True) if len(score_spans) > 1 else None
        
        status = cells[6].get_text(strip=True)
        
        report_a = cells[7].find('a', href=lambda h: h and 'match_report' in h)
        egid = extract_event_game_id(report_a['href']) if report_a else None
        
        games.append({
            'numeric_game_id': int(row['data-game']),
            'event_game_id': egid,
            'event_slug': event_slug,
            'pool_name': pool_name,
            'round_context': tab_label,
            'game_date': game_date,
            'game_time': game_time,
            'field': field,
            'home_event_team_id': home_etid,
            'away_event_team_id': away_etid,
            'home_score': int(home_score) if home_score and home_score.isdigit() else None,
            'away_score': int(away_score) if away_score and away_score.isdigit() else None,
            'status': status,
            'has_match_report': 1 if egid else 0,
        })
    return games
```

### 7.2 Bracket Game Parser

```python
def parse_bracket_game(div, tab_label, bracket_section, round_label, event_slug):
    game_id = int(div['id'].replace('game', ''))
    
    report_a = div.select_one('div.gameID_area a[href*="match_report"]')
    egid = extract_event_game_id(report_a['href']) if report_a else None
    
    top = div.find('div', class_='top_area')
    btm = div.find('div', class_='btm_area')
    
    home_a = top.select_one('span[data-type="game-team-home"] a') if top else None
    away_a = btm.select_one('span[data-type="game-team-away"] a') if btm else None
    
    home_score_span = top.select_one('span[data-type="game-score-home"]') if top else None
    away_score_span = btm.select_one('span[data-type="game-score-away"]') if btm else None
    
    field_p = div.find('p', class_='location')
    date_span = div.find('span', class_='date')
    status_span = div.find('span', class_='game-status')
    
    return {
        'numeric_game_id': game_id,
        'event_game_id': egid,
        'event_slug': event_slug,
        'pool_name': None,
        'round_context': tab_label,
        'bracket_section': bracket_section,
        'round_label': round_label,
        'game_date': None,
        'game_time': None,
        'game_datetime': date_span.get_text(strip=True) if date_span else None,
        'field': field_p.get_text(strip=True) if field_p else None,
        'home_event_team_id': extract_event_team_id(home_a['href']) if home_a else None,
        'away_event_team_id': extract_event_team_id(away_a['href']) if away_a else None,
        'home_team_name': home_a.get_text(strip=True) if home_a else None,
        'away_team_name': away_a.get_text(strip=True) if away_a else None,
        'home_score': int(home_score_span.get_text(strip=True)) if home_score_span and home_score_span.get_text(strip=True).isdigit() else None,
        'away_score': int(away_score_span.get_text(strip=True)) if away_score_span and away_score_span.get_text(strip=True).isdigit() else None,
        'status': status_span.get_text(strip=True) if status_span else None,
        'has_match_report': 1 if egid else 0,
    }
```

### 7.3 Roster Parser

```python
def parse_roster_table(soup):
    """Parse #CT_Main_0_ucTeamDetails_gvList into list of player dicts."""
    table = soup.find('table', id='CT_Main_0_ucTeamDetails_gvList')
    if not table:
        return []
    
    players = []
    for row in table.find('tbody').find_all('tr', class_=['row', 'alt']):
        cells = row.find_all('td')
        if len(cells) < 9:
            continue
        
        def cell_text(idx):
            t = cells[idx].get_text(strip=True)
            return t if t and t != '\xa0' else None
        
        def stat_span(span_id_suffix):
            span = row.find('span', id=lambda x: x and x.endswith(span_id_suffix))
            if not span:
                return None
            t = span.get_text(strip=True)
            return int(t) if t.isdigit() else None
        
        players.append({
            'jersey_number': cell_text(0),
            'player_name': cell_text(1),
            'pronouns': cell_text(2),
            'position': cell_text(3),
            'height': cell_text(4),
            'tournament_goals': stat_span('lblPoints'),
            'tournament_assists': stat_span('lblAssists'),
            'tournament_ds': stat_span('lblDs'),
            'tournament_turns': stat_span('lblTurns'),
        })
    return players
```

### 7.4 Match Report Stats Parser

```python
def parse_match_report_stats(soup, event_game_id, event_team_id):
    """Parse one team's per-game stats from match report gvHomeList or gvAwayList."""
    stats = []
    for row in soup.find('tbody').find_all('tr', class_=['row', 'alt']):
        cells = row.find_all('td')
        if len(cells) < 5:
            continue
        
        raw_name = cells[0].get_text(strip=True)
        # Format: "#02 Isaac Lee" or "#0 Jeremy Langdon"
        parts = raw_name.split(' ', 1)
        jersey = parts[0].lstrip('#') if parts[0].startswith('#') else None
        name = parts[1] if len(parts) > 1 else raw_name
        
        def stat(idx):
            t = cells[idx].get_text(strip=True)
            return int(t) if t.isdigit() else None
        
        stats.append({
            'event_game_id': event_game_id,
            'event_team_id': event_team_id,
            'jersey_number': jersey,
            'player_name': name,
            'goals': stat(1),
            'assists': stat(2),
            'ds': stat(3),
            'turns': stat(4),
        })
    return stats
```

---

## 8. CLI Interface

```
usau_scraper.py [OPTIONS]

Options:
  --divisions TEXT       Comma-separated division labels to scrape
                         Default: all 11 divisions
  --seasons TEXT         Comma-separated years (2014-2025)
                         Default: all years
  --phases TEXT          Comma-separated phases to run (1,2,3,4,5)
                         Default: 1,2,3,4
  --match-reports        Enable Phase 5 (match report scraping)
  --force                Re-scrape already-completed items
  --db PATH              Database path (default: usau_data.db)
  --log-level TEXT       DEBUG, INFO, WARNING (default: INFO)
  --dry-run              Print URLs that would be fetched; no HTTP requests

Examples:
  # Full pipeline, all divisions, all years
  python usau_scraper.py

  # Only Club Men and Club Women, 2020-2025
  python usau_scraper.py --divisions Club-Men,Club-Women --seasons 2020,2021,2022,2023,2024,2025

  # Run match reports for already-scraped events
  python usau_scraper.py --phases 5 --match-reports
```

---

## 9. Error Handling and Resilience

### 9.1 Resumability

Every write to the database is the resume checkpoint. At the start of each phase, query the database to determine what has already been completed. Never re-scrape a record unless `--force` is passed.

### 9.2 Error Categories

| Error | Behavior |
|---|---|
| 404 | Log as `skip` in `scrape_log`. Continue pipeline. |
| 429 / 503 | Exponential backoff with retry. After 3 failures, log as `error` and skip. |
| Timeout | Retry up to 3 times. Log as `error` if all fail. |
| Parse failure (missing expected element) | Log warning with URL and element name. Write partial data if possible; mark `scraped_at` with error flag. Continue. |
| Database error | Log as critical. Re-raise — do not continue silently on DB corruption. |

### 9.3 Integrity Checks

After Phase 3 for each event, verify:
- Number of games parsed matches expected structure (e.g. a 16-team pool-play tournament should have at least 24 pool games).
- Every `EventTeamId` found in game rows has a corresponding `teams` entry.
- Log warnings for anomalies but do not abort.

---

## 10. Rate Limiting Strategy

| Phase | Requests | Estimated volume | Time at 1.5s/req |
|---|---|---|---|
| 1 (Calendar) | Per division per page | ~100–200 POSTs | ~5 min |
| 2 (Landing) | Per event | ~150 GETs | ~4 min |
| 3 (Schedule probes) | 36 candidates × ~150 events | ~5,400 GETs (most are fast not-founds) | ~30–45 min |
| 4 (Roster) | Per team | ~2,100 GETs | ~53 min |
| 5 (Match report) | Per game | ~6,600 GETs | ~165 min |

**Total Phase 1–4:** ~1.5 hours  
**Total Phase 1–5:** ~4.5 hours

These are conservative estimates. Actual runtime depends on connection quality and server response time. Phase 5 should be run as a separate overnight job.

---

## 11. Project Structure

```
usau_scraper/
├── usau_scraper.py          # CLI entry point
├── db.py                    # Database init, upsert helpers, scrape_log writes
├── http_client.py           # Session, rate limiter, retry logic
├── parsers/
│   ├── calendar.py          # Phase 1: tournament calendar POST parsing
│   ├── event.py             # Phase 2: event landing page parsing
│   ├── schedule.py          # Phase 3: schedule page parsing (all game types)
│   ├── roster.py            # Phase 4: event team roster parsing
│   └── match_report.py      # Phase 5: match report parsing
├── pipeline/
│   ├── phase1.py            # Phase 1 orchestration
│   ├── phase2.py
│   ├── phase3.py
│   ├── phase4.py
│   └── phase5.py
├── config.py                # Division configs, URL patterns, filter IDs
├── identity.py              # Phase 6: player identity resolution (post-processing)
├── requirements.txt
└── README.md
```

### 11.1 Requirements

```
requests>=2.31.0
beautifulsoup4>=4.12.0
lxml>=4.9.0          # faster BS4 parser
rapidfuzz>=3.0.0     # for Phase 6 fuzzy name matching
click>=8.1.0         # CLI
```

---

## 12. Known Site Quirks and Gotchas

| Quirk | Notes |
|---|---|
| `game-field` broken attribute | `data-type"game-field"=""` — missing `=`. Parse field by cell position index 2, not by attribute. |
| VIEWSTATE changes every response | Must re-extract from each response before next POST. |
| All schedule tabs in DOM at page load | No AJAX needed for tab content. One GET = all rounds. |
| `EventTeamId` vs. `TeamId` | Two different token spaces. `EventTeamId` is event-scoped; `TeamId` is season-scoped. They are not interchangeable. |
| `EventTeamId` URL-encoding | Store as-is (URL-encoded). Don't double-encode when building URLs. |
| Integer team IDs | Only available from match report page hidden inputs. Cross-reference with `event_team_id` via the numeric game ID. |
| Roster stats may be empty spans | Empty `<span>` = NULL, not zero. |
| Soft 404 error page | Site returns HTTP 200 with a "Sorry, the page you requested could not be found." HTML body instead of a true 404. Must check response text, not just status code. |
| Gender URL segments vary by division and year | Youth uses `Boys`/`Girls` not `Men`/`Women`. College used `Open` before renaming to `Men`. Solve by iterating all 36 candidate combinations and logging hits/misses. |
| Older events (pre-2018) | Match reports and per-game stats may be sparse or absent. Handle gracefully. |
| ASP.NET ScriptResource URLs | These change but are irrelevant — ignore them. |
| `section_28997_1_19538` section IDs | The middle number (`1`, `2`, `3`) may encode section type. Not needed for parsing but useful if distinguishing pool vs. bracket sections algorithmically. |

---

## 13. Post-Processing — Player Identity Resolution

Implemented in `identity.py`, run after Phase 4 (or Phase 5):

1. Load all `(player_name, event_team_id, season_year)` tuples from `players`.
2. Build candidate pairs: same name across different years.
3. For exact matches: create or merge `player_identities` record.
4. For near-matches (edit distance ≤ 2 after normalization): flag for review.
5. Name normalization: lowercase, strip punctuation, collapse whitespace, strip suffixes ("Jr.", "Sr.", "II").
6. Write `player_surrogate_id` back to `players` rows.
7. Output `review_queue.csv` for manual adjudication of ambiguous cases.

---

## 14. Deliverables

| Artifact | Description |
|---|---|
| `usau_data.db` | SQLite database with all scraped data |
| `scrape.log` | Full log of all HTTP requests and outcomes |
| `review_queue.csv` | Players requiring manual identity resolution |
| `usau_scraper/` | Complete Python scraper codebase |

---

*Document version: 1.1 — updated schedule URL strategy to probe all gender/level combinations; added soft-404 detection; corrected Youth gender terminology (Boys/Girls/Mixed); updated rate limiting estimates.*