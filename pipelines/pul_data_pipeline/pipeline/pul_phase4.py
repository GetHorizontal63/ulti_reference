"""
PUL Phase 4 — Per-game box scores from pul-stats-hub.pages.dev.

Step A – Discovery
  For each season (2022-2026), load the /results page and extract every
  /games/{year}/{round}/{matchup} link.  Rows are upserted into pul_game_index.

Step B – Scraping
  For each game in pul_game_index where has_stats=0, visits the game page:
    • If the page shows "check back soon / stats not available" → mark no_stats.
    • Otherwise:
        1. Reveal all table columns (same column-toggle pattern as Phase 1).
        2. Extract team-level stats → pul_team_game_stats.
        3. Extract per-player box scores → pul_player_game_stats.
        4. Mark has_stats=1 in pul_game_index.

Requires: playwright (pip install playwright && playwright install chromium)
"""
from __future__ import annotations

import logging
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import unquote

_ROOT = Path(__file__).resolve().parent.parent.parent
_USAU = _ROOT / "usau_data_pipeline"
sys.path.insert(0, str(_USAU))
sys.path.insert(0, str(Path(__file__).parent.parent))

from db import (  # noqa: E402
    now_iso,
    upsert_pul_game_index,
    mark_pul_game_scraped,
    log_pul_game,
    upsert_pul_team_game_stat,
    upsert_pul_player_game_stat,
)

logger = logging.getLogger(__name__)

PUL_BASE_URL  = "https://pul-stats-hub.pages.dev"
RESULTS_URL   = f"{PUL_BASE_URL}/results"
PUL_GAME_SEASONS = ["2026", "2025", "2024", "2023", "2022"]

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

# Stat label → DB column name
_TEAM_STAT_LABELS: dict[str, str] = {
    "COMPLETION %":   "completion_pct",
    "COMPLETED PASSES": "completed_passes",
    "PASS ATTEMPTS":  "pass_attempts",
    "BREAK GOALS":    "break_goals",
    "CLEAN HOLDS":    "clean_holds",
    "TURNOVERS":      "turnovers",
    "GOALS":          "goals",
    "HOLDS":          "holds",
    "BLOCKS":         "blocks",
    "HUCKS":          "hucks",
}

# Player stat column name patterns → DB column (checked against thead text)
_PLAYER_COL_MAP: dict[str, str] = {
    "goal":        "goals",
    "assist":      "assists",
    "block":       "blocks",
    "turnover":    "turnovers",
    "pass att":    "pass_attempts",
    "throw":       "pass_attempts",
    "complet":     "completions",
    "pts played":  "points_played",
    "pt played":   "points_played",
    "points play": "points_played",
    "+/-":         "plus_minus",
    "plus":        "plus_minus",
}


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run_pul_phase4(
    conn,
    dry_run: bool = False,
    force: bool = False,
    seasons: list[str] | None = None,
) -> None:
    """Discover game URLs and scrape per-game box scores."""
    target_seasons = seasons if seasons is not None else PUL_GAME_SEASONS
    logger.info("PUL Phase 4: game-level box scores (seasons=%s)", target_seasons)

    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout
    except ImportError:
        logger.error(
            "playwright is not installed.  Run:  pip install playwright && playwright install chromium"
        )
        return

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx     = browser.new_context(user_agent=_UA)
        page    = ctx.new_page()

        # ── Step A: Discover game URLs ────────────────────────────────────
        logger.info("  Phase 4A: discovering game URLs from results pages")
        total_discovered = 0
        for season in target_seasons:
            n = _discover_season(page, conn, season, dry_run)
            total_discovered += n
        logger.info("  Discovery complete: %d games upserted", total_discovered)

        if dry_run:
            browser.close()
            logger.info("PUL Phase 4 complete (dry-run)")
            return

        # ── Step B: Scrape game pages ─────────────────────────────────────
        logger.info("  Phase 4B: scraping game pages")
        query = (
            "SELECT id, season, game_slug, game_url FROM pul_game_index "
            "WHERE has_stats=0 ORDER BY season DESC, id"
        )
        if force:
            query = (
                "SELECT id, season, game_slug, game_url FROM pul_game_index "
                "ORDER BY season DESC, id"
            )
        pending = conn.execute(query).fetchall()
        logger.info("  %d game pages to scrape", len(pending))

        ok = skipped = errors = 0
        for game in pending:
            game_id   = game[0]
            season    = game[1]
            slug      = game[2]
            game_url  = game[3]
            try:
                result = _scrape_game_page(page, game_url, PWTimeout)
            except Exception as exc:
                logger.error("  [%s] %s error: %s", season, slug, exc)
                log_pul_game(conn, game_id, "error", str(exc))
                errors += 1
                continue

            if result is None:
                logger.info("  [%s] %s — no stats yet", season, slug)
                log_pul_game(conn, game_id, "no_stats")
                skipped += 1
                continue

            _persist_game_result(conn, game_id, result)
            ok += 1
            logger.info(
                "  [%s] %s → %d team rows, %d player rows",
                season, slug,
                len(result["team_stats"]),
                sum(len(t["rows"]) for t in result["player_tables"]),
            )

        browser.close()

    logger.info(
        "PUL Phase 4 complete: %d scraped, %d no-stats, %d errors",
        ok, skipped, errors,
    )


# ---------------------------------------------------------------------------
# Step A helpers: game URL discovery
# ---------------------------------------------------------------------------

def _discover_season(page, conn, season: str, dry_run: bool) -> int:
    """Load the results page for a season and upsert all game URLs."""
    # The results page uses [data-season] sections — same pattern as /players/.
    url = f"{RESULTS_URL}?season={season}"
    logger.info("  Discovering games for season %s …", season)

    try:
        page.goto(url, wait_until="networkidle", timeout=60_000)
    except Exception as exc:
        logger.warning("  Could not load results page for %s: %s", season, exc)
        return 0

    page.wait_for_timeout(1000)

    # Collect all /games/{season}/... hrefs visible on the page
    raw_links: list[str] = page.evaluate(
        f"""() => {{
            const prefix = '/games/{season}/';
            return Array.from(document.querySelectorAll('a[href*="' + prefix + '"]'))
                .map(a => a.href)
                .filter((v, i, arr) => arr.indexOf(v) === i);
        }}"""
    )

    if not raw_links:
        # Fallback: try the plain /results page and pick this season's section
        try:
            page.goto(RESULTS_URL, wait_until="networkidle", timeout=60_000)
            page.wait_for_timeout(500)
            raw_links = page.evaluate(
                f"""() => {{
                    const prefix = '/games/{season}/';
                    return Array.from(document.querySelectorAll('a[href*="' + prefix + '"]'))
                        .map(a => a.href)
                        .filter((v, i, arr) => arr.indexOf(v) === i);
                }}"""
            )
        except Exception:
            pass

    if not raw_links:
        logger.info("  No game links found for season %s", season)
        return 0

    upserted = 0
    for href in raw_links:
        info = _parse_game_url(href)
        if not info:
            continue
        if not dry_run:
            upsert_pul_game_index(
                conn,
                season     = info["season"],
                round_     = info["round"],
                game_slug  = info["slug"],
                away_team  = info["away"],
                home_team  = info["home"],
                game_url   = href,
            )
        upserted += 1

    logger.info("  Season %s: %d games found", season, upserted)
    return upserted


def _parse_game_url(url: str) -> dict[str, str] | None:
    """Parse a PUL game URL into its components.

    Expected pattern:
      https://pul-stats-hub.pages.dev/games/2025/week-3/ATL%20%40%20DC
    Returns:
      {"season": "2025", "round": "week-3", "slug": "ATL @ DC",
       "away": "ATL", "home": "DC"}
    """
    m = re.search(r"/games/(\d{4})/([^/]+)/(.+)$", url)
    if not m:
        return None
    season = m.group(1)
    round_ = m.group(2)
    slug   = unquote(m.group(3)).strip()  # e.g. "ATL @ DC"

    # Parse away/home from slug like "ATL @ DC" or "DC @ ATL"
    parts = re.split(r"\s+@\s+", slug, maxsplit=1)
    if len(parts) == 2:
        away, home = parts[0].strip(), parts[1].strip()
    else:
        away, home = slug, slug

    return {"season": season, "round": round_, "slug": slug, "away": away, "home": home}


# ---------------------------------------------------------------------------
# Step B helpers: scraping game pages
# ---------------------------------------------------------------------------

def _scrape_game_page(page, game_url: str, PWTimeout) -> dict[str, Any] | None:
    """Visit a game page and return extracted data, or None if no stats."""
    page.goto(game_url, wait_until="networkidle", timeout=60_000)
    page.wait_for_timeout(600)

    # Check for "no stats yet" message
    no_stats_msg = page.evaluate(
        """() => {
            const t = document.body.innerText || '';
            return /check back soon|within 48 hours|stats not available/i.test(t);
        }"""
    )
    if no_stats_msg:
        return None

    # Check that at least one table is present
    has_table = page.evaluate(
        "() => document.querySelectorAll('table').length > 0"
    )
    if not has_table:
        return None

    # Expand all column-visibility panels (one per player table)
    _expand_all_columns(page)

    # Extract game date from the page
    game_date = page.evaluate(
        r"""() => {
            const m = (document.body.innerText || '').match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/);
            return m ? m[1] : null;
        }"""
    )

    # Extract scores: "8–19" or "22 – 14"
    scores = page.evaluate(
        r"""() => {
            const m = (document.body.innerText || '')
                .match(/(\d+)\s*[\u2013\u2014\-]\s*(\d+)/);
            if (!m) return [null, null];
            return [parseInt(m[1]), parseInt(m[2])];
        }"""
    )
    score_away, score_home = scores if scores else [None, None]

    # Extract team stats (comparison section)
    team_stats = _extract_team_stats(page)

    # Extract player tables
    player_tables = _extract_player_tables(page)

    return {
        "game_date":    game_date,
        "score_away":   score_away,
        "score_home":   score_home,
        "team_stats":   team_stats,   # list of {team, goals, break_goals, ...}
        "player_tables": player_tables,  # list of {team, headers, rows}
    }


def _expand_all_columns(page) -> None:
    """Click every 'Toggle column visibility' + 'Show all' on the page."""
    # Open every column panel at once
    page.evaluate(
        """() => {
            document.querySelectorAll('button[aria-label="Toggle column visibility"]')
                .forEach(b => b.click());
        }"""
    )
    page.wait_for_timeout(500)
    # Click every "Show all" button
    page.evaluate(
        """() => {
            document.querySelectorAll('button')
                .forEach(b => { if (b.textContent.trim() === 'Show all') b.click(); });
        }"""
    )
    page.wait_for_timeout(700)


def _extract_team_stats(page) -> list[dict[str, Any]]:
    """Extract team-level stats from the comparison section."""
    raw = page.evaluate(
        r"""() => {
            // Collect all visible text lines near the TEAM STATS heading
            const heading = Array.from(document.querySelectorAll('h2, h3'))
                .find(h => /^TEAM STATS$/i.test(h.textContent.trim()));
            if (!heading) return null;

            // Walk the parent container and collect text tokens
            const container = heading.closest('section, article, div, main') || heading.parentElement;
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
            const tokens = [];
            let node;
            while ((node = walker.nextNode())) {
                const t = node.textContent.trim();
                if (t) tokens.push(t);
            }
            return tokens.join('\n');
        }"""
    )
    if not raw:
        return []

    # Sort labels longest-first to avoid partial matches
    labels = sorted(_TEAM_STAT_LABELS_PY.keys(), key=len, reverse=True)
    away_stats: dict[str, Any] = {}
    home_stats: dict[str, Any] = {}

    for label in labels:
        # Pattern: optional_pct_prefix  val1  LABEL  val2  optional_pct
        pattern = (
            rf"([\d.]+%?)\s+{re.escape(label)}\s+([\d.]+%?)"
        )
        m = re.search(pattern, raw, re.IGNORECASE)
        if not m:
            continue
        key = _TEAM_STAT_LABELS_PY[label]
        v1, v2 = _parse_stat_val(m.group(1)), _parse_stat_val(m.group(2))
        away_stats[key] = v1
        home_stats[key] = v2

    return [away_stats, home_stats]  # index 0 = away, 1 = home


def _extract_player_tables(page) -> list[dict[str, Any]]:
    """Extract per-player box-score tables from the rendered page."""
    return page.evaluate(
        r"""() => {
            const results = [];
            const tables = Array.from(document.querySelectorAll('table'));

            for (const table of tables) {
                // Column headers from thead
                const thCells = Array.from(table.querySelectorAll('thead th, thead td'));
                if (thCells.length < 3) continue;
                const headers = thCells.map(th => th.textContent.trim());

                // Skip tables that don't look like player stats
                const isPlayerTable = headers.some(h =>
                    /^(goal|assist|block|turn)/i.test(h.trim())
                );
                if (!isPlayerTable) continue;

                // Find the nearest preceding heading as the team name
                let teamName = null;
                let el = table.closest('section, article') || table.parentElement;
                while (el && el !== document.body) {
                    const h = el.querySelector(':scope > h2, :scope > h3, :scope > h4');
                    if (h) { teamName = h.textContent.trim(); break; }
                    // Also check previous siblings at this level
                    let sib = table.previousElementSibling;
                    while (sib) {
                        if (/^H[2-4]$/.test(sib.tagName)) {
                            teamName = sib.textContent.trim(); break;
                        }
                        sib = sib.previousElementSibling;
                    }
                    if (teamName) break;
                    el = el.parentElement;
                }

                // Player rows
                const rows = [];
                for (const tr of table.querySelectorAll('tbody tr')) {
                    const cells = Array.from(tr.querySelectorAll('td'));
                    if (cells.length === 0) continue;
                    const firstTxt = cells[0].textContent.trim();
                    const m = firstTxt.match(/^#?(\S+)\s+([\s\S]+)$/);
                    rows.push({
                        jersey: m ? m[1] : '',
                        name:   m ? m[2].trim() : firstTxt,
                        values: cells.slice(1).map(td => td.textContent.trim()),
                    });
                }

                if (rows.length > 0) {
                    results.push({
                        team:    teamName,
                        headers: headers.slice(1),  // drop the player-name column
                        rows,
                    });
                }
            }
            return results;
        }"""
    )


# ---------------------------------------------------------------------------
# Persist extracted data into the DB
# ---------------------------------------------------------------------------

def _persist_game_result(conn, game_id: int, result: dict) -> None:
    """Write team stats + player stats rows; mark the game as scraped."""
    # Update header fields (date, scores)
    conn.execute(
        "UPDATE pul_game_index SET game_date=?, score_away=?, score_home=? WHERE id=?",
        (result["game_date"], result["score_away"], result["score_home"], game_id),
    )

    # Get the game row for away/home team names
    game_row = conn.execute(
        "SELECT away_team, home_team FROM pul_game_index WHERE id=?", (game_id,)
    ).fetchone()
    team_order = [game_row[0], game_row[1]] if game_row else [None, None]

    # Team stats (index 0 = away, 1 = home)
    for i, ts in enumerate(result["team_stats"][:2]):
        if not ts:
            continue
        team_name = ts.pop("team", None) or (team_order[i] if i < len(team_order) else None)
        if team_name:
            ts["team"] = team_name
            upsert_pul_team_game_stat(conn, game_id, ts)

    # Player stats
    for table in result["player_tables"]:
        team = table.get("team") or ""
        headers = table.get("headers", [])
        col_map = _map_player_columns(headers)
        for prow in table.get("rows", []):
            record: dict[str, Any] = {
                "team":          team,
                "player_name":   prow["name"],
                "jersey_number": prow["jersey"],
            }
            for idx, val_str in enumerate(prow["values"]):
                if idx >= len(headers):
                    break
                db_col = col_map.get(idx)
                val    = _parse_stat_val(val_str)
                if db_col:
                    record[db_col] = val
                else:
                    # Store unknown columns in extra_stats
                    record[headers[idx]] = val
            upsert_pul_player_game_stat(conn, game_id, record)

    mark_pul_game_scraped(conn, game_id, has_stats=1)
    log_pul_game(conn, game_id, "success")


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

# Module-level copy of the label map so it can be used in plain Python (not JS)
_TEAM_STAT_LABELS_PY = _TEAM_STAT_LABELS


def _map_player_columns(headers: list[str]) -> dict[int, str]:
    """Return {column_index: db_column_name} for a list of table header strings."""
    result: dict[int, str] = {}
    for i, h in enumerate(headers):
        h_lower = h.lower()
        for pattern, db_col in _PLAYER_COL_MAP.items():
            if pattern in h_lower:
                result[i] = db_col
                break
    return result


def _parse_stat_val(s: str) -> int | float | None:
    """Convert a stat string like '86.4%', '+3', '-2', '228' to a number."""
    if not s:
        return None
    s = s.strip().rstrip("%").replace("+", "")
    try:
        f = float(s)
        return int(f) if f == int(f) else f
    except ValueError:
        return None
