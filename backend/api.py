"""
Ultimate Frisbee Analytics — backend API server.

Run:
  python backend/api.py           (dev, auto-reload)
  uvicorn backend.api:app         (production)

Endpoints:
  GET /api/ufa/players            player search index
  GET /api/ufa/players/{slug}     single player profile + season stats
"""
from __future__ import annotations

import os
import asyncio as _asyncio
import re
import sqlite3
import sys
import time
from contextlib import contextmanager
from datetime import date as _date
from pathlib import Path
from typing import Generator, List

import httpx
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

DB_PATH = Path(os.environ.get("UFA_DB_PATH") or Path(__file__).resolve().parents[1] / "data" / "db" / "ultimate.db")

app = FastAPI(title="UFA Analytics API", version="1.0.0")

# ── Shownspace field → SVG coordinate mapping ────────────────────────────────
# Raw field coords: X −26.67…26.67, Y 0…120
# SVG canvas:       X 5…205,       Y 5…455
_SVG_X0, _SVG_W_DATA = 5, 200
_SVG_Y0, _SVG_H_DATA = 5, 450
_FIELD_X_MIN, _FIELD_X_RANGE = -26.67, 53.34
_FIELD_Y_MIN, _FIELD_Y_RANGE = 0.0, 120.0

def _to_svg_x(x: float | None) -> float | None:
    if x is None:
        return None
    return _SVG_X0 + ((x - _FIELD_X_MIN) / _FIELD_X_RANGE) * _SVG_W_DATA

def _to_svg_y(y: float | None) -> float | None:
    if y is None:
        return None
    return _SVG_Y0 + ((y - _FIELD_Y_MIN) / _FIELD_Y_RANGE) * _SVG_H_DATA

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(","),
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)

# ── Sub-module routers (status + admin) ──────────────────────────────────────
_BACKEND_DIR = str(Path(__file__).resolve().parent)
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from status_routes  import router as _status_router   # noqa: E402
from admin_routes   import router as _admin_router    # noqa: E402
from ua_routes      import router as _ua_router       # noqa: E402
from auth_routes    import router as _auth_router     # noqa: E402
from stripe_routes  import router as _stripe_router   # noqa: E402

app.include_router(_status_router)
app.include_router(_admin_router)
app.include_router(_ua_router)
app.include_router(_auth_router)
app.include_router(_stripe_router)


@app.on_event("startup")
def _init_auth_tables() -> None:
    """Ensure auth/subscription tables exist on first boot."""
    import sys as _sys
    _ROOT = str(Path(__file__).resolve().parent.parent)
    if _ROOT not in _sys.path:
        _sys.path.insert(0, _ROOT)
    from pipelines.usau_data_pipeline.db import init_auth_db
    from migrate import apply_pending
    from ua_routes import init_ua_tables
    # sqlite3.connect() silently creates a missing file — a bad mount would
    # otherwise boot the site against an empty database.
    if not DB_PATH.exists():
        raise RuntimeError(f"Database not found at {DB_PATH} — check the volume mount")
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=60, isolation_level=None)
    try:
        conn.execute("PRAGMA busy_timeout=60000")
        init_auth_db(conn)
        init_ua_tables(conn)
        applied = apply_pending(conn)
        if applied:
            print(f"[startup] applied migrations: {', '.join(applied)}")
    finally:
        conn.close()


@app.get("/api/health")
def health():
    """Liveness check used by Docker healthcheck and Cloudflare tunnel monitors."""
    return {"status": "ok"}


# ── USAU feature flag ────────────────────────────────────────────────────────
# USAU data is hidden until there's a reliable cross-source player/team ID.
# The tables stay in the DB; set ENABLE_USAU=true to bring everything back.
ENABLE_USAU = os.environ.get("ENABLE_USAU", "").lower() in ("1", "true", "yes")
_USAU_PATH_RE = re.compile(r"^/api/(usau/|players/[^/]+/(usau_season_stats|videos)$)")


@app.middleware("http")
async def _hide_usau(request, call_next):
    if not ENABLE_USAU and _USAU_PATH_RE.match(request.url.path):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    return await call_next(request)


def _usau_id(row) -> str | None:
    """master_players.USAU_ID, or None while USAU is hidden."""
    return dict(row).get("USAU_ID") if ENABLE_USAU else None


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    # isolation_level=None → autocommit; prevents Python's implicit BEGIN from
    # raising SQLITE_LOCKED (which bypasses busy_timeout).
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
    finally:
        conn.close()


# ── /api/ufa/teams ───────────────────────────────────────────────────────────

@app.get("/api/ufa/teams")
def get_ufa_teams():
    """Return one record per franchise_id with latest-year metadata."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT
                f.franchise_id,
                f.team_name,
                f.team_slug,
                f.team_abbreviation,
                f.division,
                f.year,
                f.home_stadium,
                agg.latest_year,
                agg.first_year
            FROM ufa_franchises f
            JOIN (
                SELECT franchise_id,
                       MAX(year) AS latest_year,
                       MIN(year) AS first_year
                FROM ufa_franchises
                GROUP BY franchise_id
            ) agg ON agg.franchise_id = f.franchise_id
            WHERE f.year = agg.latest_year
            ORDER BY f.team_name
        """).fetchall()
    max_year = max((r["year"] for r in rows), default=0)
    return {
        "teams": [
            {
                "franchise_id":       r["franchise_id"],
                "team_name":          r["team_name"],
                "team_slug":          r["team_slug"],
                "team_abbreviation":  r["team_abbreviation"],
                "division":           r["division"],
                "year":               r["year"],
                "first_year":         r["first_year"],
                "latest_year":        r["latest_year"],
                "active":             r["year"] == max_year,
                "home_stadium":       r["home_stadium"],
            }
            for r in rows
        ]
    }


# ── /api/ufa/players ─────────────────────────────────────────────────────────

_standings_cache: dict = {"data": None, "ts": 0.0}
_pul_standings_cache: dict = {"data": None, "ts": 0.0}
_STANDINGS_TTL = 300  # 5 minutes

# ── Schedule cache ────────────────────────────────────────────────────────────
_schedule_cache: dict = {"data": None, "ts": 0.0}
_SCHEDULE_TTL = 300  # 5 minutes

_TEAMID_TO_ABBR: dict[str, str] = {
    "hustle":       "ATL",
    "bighorns":     "VEG",
    "empire":       "NY",
    "glory":        "BOS",
    "union":        "CHI",
    "windchill":    "MIN",
    "cascades":     "SEA",
    "legion":       "DAL",
    "roughnecks":   "DAL",
    "breeze":       "DC",
    "phoenix":      "PHI",
    "spinners":     "PHI",
    "thunderbirds": "PIT",
    "express":      "CLT",
    "radicals":     "MAD",
    "growlers":     "SD",
    "rush":         "TOR",
    "outlaws":      "OTT",
    "royal":        "MTL",
    "alleycats":    "IND",
    "flyers":       "CAR",
    "nightwatch":   "NAS",
    "mechanix":     "DET",
    "revolution":   "CIN",
    "aviators":     "LA",
    "apex":         "COL",
    "summit":       "COL",
    "spiders":      "OAK",
    "steel":        "ORE",
    "dragons":      "ROC",
    "cannons":      "TB",
    "hammerheads":  "NJ",
    "lions":        "SLC",
    "shred":        "SLC",
    "sol":          "ATX",
    "havoc":        "HTX",
}

@app.get("/api/ufa/schedule")
def get_ufa_schedule():
    """Fetch current-week games from the same ufastats API that powers watchufa.com."""
    import time as _time
    now = _time.time()
    if _schedule_cache["data"] and now - _schedule_cache["ts"] < _SCHEDULE_TTL:
        return _schedule_cache["data"]

    try:
        resp = httpx.get(
            "https://www.backend.ufastats.com/web-v1/games?current",
            headers={"User-Agent": "Mozilla/5.0 (compatible; UltimateReference/1.0)"},
            follow_redirects=True,
            timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json().get("games", [])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch schedule: {e}")

    games = []
    for g in rows:
        # Parse startTimestamp → human-readable date label
        date_text = ""
        time_text = ""
        ts = g.get("startTimestamp", "")
        if ts:
            from datetime import datetime as _dt
            try:
                # Strip timezone offset so fromisoformat works on Python 3.7+
                dt = _dt.fromisoformat(ts[:19])
                tz = g.get("startTimezone", "")
                date_text = dt.strftime("%m/%d")
                time_text = dt.strftime("%I:%M %p").lstrip("0") + (f" {tz}" if tz else "")
            except Exception:
                date_text = ts[:10]
                time_text = ""

        games.append({
            "away":       _TEAMID_TO_ABBR.get(g.get("awayTeamID", ""), g.get("awayTeamID", "").upper()[:3]),
            "home":       _TEAMID_TO_ABBR.get(g.get("homeTeamID", ""), g.get("homeTeamID", "").upper()[:3]),
            "awayTeamID": g.get("awayTeamID", ""),
            "homeTeamID": g.get("homeTeamID", ""),
            "awayName":   g.get("awayTeamName", ""),
            "homeName":   g.get("homeTeamName", ""),
            "awayScore":  g.get("awayScore", 0),
            "homeScore":  g.get("homeScore", 0),
            "status":     g.get("status", ""),
            "dateText":   date_text,
            "timeText":   time_text,
            "startTimestamp": g.get("startTimestamp", ""),
            "week":       g.get("week", ""),
            "streamingURL": g.get("streamingURL", ""),
        })

    from datetime import timezone as _tz
    games.sort(key=lambda g: _dt.fromisoformat(g["startTimestamp"]).astimezone(_tz.utc) if g["startTimestamp"] else _dt.min.replace(tzinfo=_tz.utc))
    result = {"games": games, "year": _date.today().year}
    _schedule_cache["data"] = result
    _schedule_cache["ts"]   = now
    return result

@app.get("/api/ufa/standings")
def get_ufa_standings():
    import time as _time
    now = _time.time()
    if _standings_cache["data"] and now - _standings_cache["ts"] < _STANDINGS_TTL:
        return _standings_cache["data"]
    try:
        resp = httpx.get(
            "https://www.backend.ufastats.com/web-v1/standings",
            headers={"User-Agent": "Mozilla/5.0 (compatible; UltimateReference/1.0)"},
            follow_redirects=True,
            timeout=10,
        )
        resp.raise_for_status()
        rows = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch standings: {e}")

    # Group into divisions, preserving order
    divisions_map: dict = {}
    divisions_order: list = []
    for row in rows:
        did = row.get("divisionID", "")
        if did not in divisions_map:
            divisions_map[did] = {
                "division": row.get("divisionName", did).upper(),
                "teams": [],
            }
            divisions_order.append(did)
        divisions_map[did]["teams"].append({
            "name":      row.get("teamName", ""),
            "teamID":    row.get("teamID", ""),
            "wins":      row.get("wins", 0),
            "losses":    row.get("losses", 0),
            "ties":      row.get("ties", 0),
            "pointDiff": row.get("pointDiff", 0),
            "icon":      f"https://watchufa.com/sites/default/files/styles/thumbnail/public/teams/{row.get('teamID','')}/{row.get('teamID','')}_thumbnail.png",
        })

    result = {"divisions": [divisions_map[d] for d in divisions_order]}
    _standings_cache["data"] = result
    _standings_cache["ts"]   = now
    return result


@app.get("/api/ufa/records/{franchise_id}")
def get_ufa_records(franchise_id: str):
    """Return best single-season and career franchise records from local DB."""
    STATS = [
        ("assists",         "Assists"),
        ("goals",           "Goals"),
        ("blocks",          "Blocks"),
        ("completions",     "Completions"),
        ("throw_attempts",  "Throws Attempted"),
        ("hockey_assists",  "Hockey Assists"),
        ("hucks_completed", "Hucks Completed"),
        ("catches",         "Catches"),
        ("yards_received",  "Yards Received"),
        ("yards_thrown",    "Yards Thrown"),
        ("plus_minus",      "Plus / Minus"),
        ("callahans",       "Callahans"),
        ("points_played",   "Points Played"),
        ("games_played",    "Games Played"),
    ]
    with get_db() as conn:
        # Validate franchise exists
        slugs_rows = conn.execute(
            "SELECT DISTINCT team_slug FROM ufa_franchises WHERE franchise_id = ?",
            (franchise_id,)
        ).fetchall()
        if not slugs_rows:
            raise HTTPException(status_code=404, detail="Franchise not found")
        slugs = [r["team_slug"] for r in slugs_rows]
        placeholders = ",".join("?" * len(slugs))

        single_season = []
        career = []
        rookie_season = []

        for col, label in STATS:
            # Best single season
            row = conn.execute(f"""
                SELECT s.player_id, p.display_name, m.ID AS master_id, s.year, s.{col} AS cnt
                FROM ufa_player_season_stats s
                LEFT JOIN ufa_players p ON p.player_slug = s.player_id
                LEFT JOIN master_players m ON m.UFA_ID = s.player_id
                WHERE s.team_id IN ({placeholders})
                  AND s.{col} IS NOT NULL
                ORDER BY s.{col} DESC, s.year ASC
                LIMIT 1
            """, slugs).fetchone()
            if row and row["cnt"]:
                single_season.append({
                    "stat":      label,
                    "player":    row["display_name"] or row["player_id"],
                    "player_id": row["master_id"],
                    "count":     row["cnt"],
                    "year":      row["year"],
                })

            # Best single rookie season (player's first year in the league ever)
            row = conn.execute(f"""
                SELECT s.player_id, p.display_name, m.ID AS master_id, s.year, s.{col} AS cnt
                FROM ufa_player_season_stats s
                LEFT JOIN ufa_players p ON p.player_slug = s.player_id
                LEFT JOIN master_players m ON m.UFA_ID = s.player_id
                WHERE s.team_id IN ({placeholders})
                  AND s.{col} IS NOT NULL
                  AND s.year = (
                      SELECT MIN(r.year) FROM ufa_player_season_stats r
                      WHERE r.player_id = s.player_id
                  )
                ORDER BY s.{col} DESC, s.year ASC
                LIMIT 1
            """, slugs).fetchone()
            if row and row["cnt"]:
                rookie_season.append({
                    "stat":      label,
                    "player":    row["display_name"] or row["player_id"],
                    "player_id": row["master_id"],
                    "count":     row["cnt"],
                    "year":      row["year"],
                })

            # Career total
            row = conn.execute(f"""
                SELECT s.player_id, p.display_name, m.ID AS master_id, SUM(s.{col}) AS cnt
                FROM ufa_player_season_stats s
                LEFT JOIN ufa_players p ON p.player_slug = s.player_id
                LEFT JOIN master_players m ON m.UFA_ID = s.player_id
                WHERE s.team_id IN ({placeholders})
                  AND s.{col} IS NOT NULL
                GROUP BY s.player_id, p.display_name, m.ID
                ORDER BY cnt DESC
                LIMIT 1
            """, slugs).fetchone()
            if row and row["cnt"]:
                career.append({
                    "stat":      label,
                    "player":    row["display_name"] or row["player_id"],
                    "player_id": row["master_id"],
                    "count":     row["cnt"],
                })

    return {"franchise_id": franchise_id, "single_season": single_season, "rookie_season": rookie_season, "career": career}


@app.get("/api/ufa/franchise/{franchise_id}/seasons")
def get_ufa_franchise_seasons(franchise_id: str):
    """Return a past-season view for one franchise: years, standings snapshot, game log."""
    with get_db() as conn:
        # All slugs this franchise has used
        slugs_rows = conn.execute(
            "SELECT DISTINCT team_slug, year FROM ufa_franchises WHERE franchise_id = ? ORDER BY year",
            (franchise_id,)
        ).fetchall()
        if not slugs_rows:
            raise HTTPException(status_code=404, detail="Franchise not found")

        # year → slug mapping (most-recent slug wins for a year)
        year_slug = {r["year"]: r["team_slug"] for r in slugs_rows}
        all_slugs  = list({r["team_slug"] for r in slugs_rows})
        all_years  = sorted(year_slug.keys())

        slug_ph = ",".join("?" * len(all_slugs))

        # Per-year team-season records (W-L-T, standing, division)
        ts_rows = conn.execute(f"""
            SELECT ts.year, ts.team_id, ts.wins, ts.losses, ts.ties,
                   ts.standing, ts.division_id, ts.division_name, ts.city, ts.full_name
            FROM ufa_team_seasons ts
            WHERE ts.team_id IN ({slug_ph})
            ORDER BY ts.year
        """, all_slugs).fetchall()
        team_seasons = {r["year"]: dict(r) for r in ts_rows}

        # All games involving this franchise (any of its slugs)
        games_rows = conn.execute(f"""
            SELECT g.game_id, g.year,
                   g.away_team_id, g.home_team_id,
                   g.away_score, g.home_score,
                   g.status, g.start_timestamp, g.week
            FROM ufa_games g
            WHERE (g.away_team_id IN ({slug_ph}) OR g.home_team_id IN ({slug_ph}))
              AND g.status = 'Final'
            ORDER BY g.start_timestamp ASC, g.game_id ASC
        """, all_slugs + all_slugs).fetchall()

        # Build per-year game log with running record
        from collections import defaultdict
        games_by_year: dict = defaultdict(list)
        for g in games_rows:
            games_by_year[g["year"]].append(g)

        seasons_out = []
        for year in all_years:
            slug = year_slug[year]
            ts   = team_seasons.get(year, {})

            # Division standings for that year/division
            div_id = ts.get("division_id")
            if div_id:
                div_rows = conn.execute("""
                    SELECT ts2.team_id, ts2.full_name, ts2.abbrev, ts2.wins, ts2.losses,
                           ts2.ties, ts2.standing
                    FROM ufa_team_seasons ts2
                    WHERE ts2.year = ? AND ts2.division_id = ?
                    ORDER BY ts2.standing ASC, ts2.wins DESC
                """, (year, div_id)).fetchall()
                standings = [dict(r) for r in div_rows]
            else:
                standings = []

            # Game log with running W-L after each game
            w, l, t = 0, 0, 0
            game_log = []
            for g in games_by_year.get(year, []):
                is_home = (g["home_team_id"] == slug)
                team_score = g["home_score"] if is_home else g["away_score"]
                opp_score  = g["away_score"]  if is_home else g["home_score"]
                opp_slug   = g["away_team_id"] if is_home else g["home_team_id"]

                # Lookup opponent abbreviation
                opp_ts = conn.execute(
                    "SELECT abbrev, full_name FROM ufa_team_seasons WHERE team_id=? AND year=?",
                    (opp_slug, year)
                ).fetchone()
                opp_name = (opp_ts["abbrev"] or opp_ts["full_name"]) if opp_ts else opp_slug

                if team_score > opp_score:
                    w += 1; result = "W"
                elif team_score < opp_score:
                    l += 1; result = "L"
                else:
                    t += 1; result = "T"

                game_log.append({
                    "game_id":    g["game_id"],
                    "date":       (g["start_timestamp"] or "")[:10],
                    "opponent":   opp_name,
                    "opp_slug":   opp_slug,
                    "home":       is_home,
                    "team_score": team_score,
                    "opp_score":  opp_score,
                    "result":     result,
                    "record":     f"{w}-{l}" + (f"-{t}" if t else ""),
                    "week":       g["week"],
                })

            seasons_out.append({
                "year":     year,
                "slug":     slug,
                "wins":     ts.get("wins"),
                "losses":   ts.get("losses"),
                "ties":     ts.get("ties"),
                "standing": ts.get("standing"),
                "division": ts.get("division_name"),
                "standings": standings,
                "games":    game_log,
            })

    return {"franchise_id": franchise_id, "seasons": seasons_out}


@app.get("/api/ufa/franchise/{franchise_id}/roster/{year}")
def get_ufa_franchise_roster(franchise_id: str, year: int):
    """Return roster for a specific franchise-year, joined to master_players for link ID."""
    with get_db() as conn:
        slug_row = conn.execute(
            "SELECT team_slug FROM ufa_franchises WHERE franchise_id=? AND year=?",
            (franchise_id, year)
        ).fetchone()
        if not slug_row:
            raise HTTPException(status_code=404, detail="Season not found")
        slug = slug_row["team_slug"]

        rows = conn.execute("""
            SELECT s.player_id, p.display_name, m.ID AS master_id,
                   s.games_played, s.goals, s.assists, s.hockey_assists, s.blocks,
                   s.completions, s.throw_attempts, s.throwaways,
                   s.hucks_attempted, s.hucks_completed,
                   s.drops, s.callahans,
                   s.o_points_played, s.d_points_played,
                   s.plus_minus, s.points_played
            FROM ufa_player_season_stats s
            LEFT JOIN ufa_players p ON p.player_slug = s.player_id
            LEFT JOIN master_players m ON m.UFA_ID = s.player_id
            WHERE s.team_id = ? AND s.year = ?
            ORDER BY p.display_name ASC
        """, (slug, year)).fetchall()

        def _pct(num, den):
            return round(num / den * 100, 1) if den else None

        roster = [{
            "player_id":       r["player_id"],
            "display_name":    r["display_name"] or r["player_id"],
            "master_id":       r["master_id"],
            "gp":              r["games_played"],
            "goals":           r["goals"],
            "assists":         r["assists"],
            "hockey_assists":  r["hockey_assists"],
            "blocks":          r["blocks"],
            "completions":     r["completions"],
            "throw_attempts":  r["throw_attempts"],
            "completion_pct":  _pct(r["completions"], r["throw_attempts"]),
            "throwaways":      r["throwaways"],
            "hucks_attempted": r["hucks_attempted"],
            "hucks_completed": r["hucks_completed"],
            "huck_pct":        _pct(r["hucks_completed"], r["hucks_attempted"]),
            "drops":           r["drops"],
            "callahans":       r["callahans"],
            "o_pts":           r["o_points_played"],
            "d_pts":           r["d_points_played"],
            "plus_minus":      r["plus_minus"],
            "pts_played":      r["points_played"],
        } for r in rows]

    return {"franchise_id": franchise_id, "year": year, "slug": slug, "roster": roster}


@app.get("/api/ufa/franchise/{franchise_id}/games")
def get_ufa_franchise_games(franchise_id: str):
    """Return all games for a franchise across all years with opponent info."""
    with get_db() as conn:
        slugs_rows = conn.execute(
            "SELECT DISTINCT team_slug, year FROM ufa_franchises WHERE franchise_id = ? ORDER BY year",
            (franchise_id,)
        ).fetchall()
        if not slugs_rows:
            raise HTTPException(status_code=404, detail="Franchise not found")

        year_slug = {r["year"]: r["team_slug"] for r in slugs_rows}
        all_slugs = list({r["team_slug"] for r in slugs_rows})
        slug_ph   = ",".join("?" * len(all_slugs))

        games_rows = conn.execute(f"""
            SELECT g.game_id, g.year,
                   g.away_team_id, g.home_team_id,
                   g.away_score, g.home_score,
                   g.status, g.start_timestamp, g.week
            FROM ufa_games g
            WHERE (g.away_team_id IN ({slug_ph}) OR g.home_team_id IN ({slug_ph}))
              AND g.status = 'Final'
            ORDER BY g.start_timestamp ASC, g.game_id ASC
        """, all_slugs + all_slugs).fetchall()

        games_out = []
        for g in games_rows:
            year  = g["year"]
            slug  = year_slug.get(year, all_slugs[-1])
            is_home    = g["home_team_id"] == slug
            team_score = g["home_score"] if is_home else g["away_score"]
            opp_score  = g["away_score"]  if is_home else g["home_score"]
            opp_slug   = g["away_team_id"] if is_home else g["home_team_id"]

            opp_ts = conn.execute(
                "SELECT abbrev, full_name FROM ufa_team_seasons WHERE team_id=? AND year=?",
                (opp_slug, year)
            ).fetchone()
            opp_abbrev = (opp_ts["abbrev"] or opp_ts["full_name"]) if opp_ts else opp_slug.upper()
            opp_full   = opp_ts["full_name"] if opp_ts else opp_slug

            # franchise_id for opponent
            opp_fran = conn.execute(
                "SELECT franchise_id FROM ufa_franchises WHERE team_slug=? ORDER BY year DESC LIMIT 1",
                (opp_slug,)
            ).fetchone()

            result = "W" if team_score > opp_score else ("L" if team_score < opp_score else "T")
            games_out.append({
                "game_id":         g["game_id"],
                "year":            year,
                "date":            (g["start_timestamp"] or "")[:10],
                "week":            g["week"],
                "home":            is_home,
                "team_score":      team_score,
                "opp_score":       opp_score,
                "result":          result,
                "team_id":         slug,        # exact ID used in throw data
                "opp_slug":        opp_slug,
                "opp_abbrev":      opp_abbrev,
                "opp_full":        opp_full,
                "opp_franchise_id": opp_fran["franchise_id"] if opp_fran else None,
            })

    return {"franchise_id": franchise_id, "games": games_out}


@app.get("/api/ufa/games/{game_id}/events")
def get_game_events(game_id: str, franchise_id: str = Query(None)):
    """Return structured play-by-play events for a game from the requesting team's perspective."""
    with get_db() as conn:
        game = conn.execute(
            "SELECT * FROM ufa_games WHERE game_id = ?", (game_id,)
        ).fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")

        # Determine which side we are
        perspective = "home"
        team_slug   = game["home_team_id"]
        opp_slug    = game["away_team_id"]

        if franchise_id:
            franchise_slugs = {
                r["team_slug"] for r in conn.execute(
                    "SELECT DISTINCT team_slug FROM ufa_franchises WHERE franchise_id = ?",
                    (franchise_id,)
                ).fetchall()
            }
            if game["away_team_id"] in franchise_slugs:
                perspective = "away"
                team_slug   = game["away_team_id"]
                opp_slug    = game["home_team_id"]

        opp_perspective = "away" if perspective == "home" else "home"
        year = game["year"]

        def get_abbrev(slug):
            ts = conn.execute(
                "SELECT abbrev FROM ufa_team_seasons WHERE team_id = ? AND year = ?",
                (slug, year)
            ).fetchone()
            if ts and ts["abbrev"]:
                return ts["abbrev"]
            f = conn.execute(
                "SELECT team_abbreviation FROM ufa_franchises WHERE team_slug = ? ORDER BY ABS(year - ?) LIMIT 1",
                (slug, year)
            ).fetchone()
            return f["team_abbreviation"] if f else slug.upper()

        team_abbrev = get_abbrev(team_slug)
        opp_abbrev  = get_abbrev(opp_slug)

        # Player name lookup (slug → display_name)
        player_names: dict[str, str] = {
            r["player_slug"]: r["display_name"]
            for r in conn.execute("SELECT player_slug, display_name FROM ufa_players").fetchall()
        }

        # Event type name lookup
        type_names: dict[int, str] = {
            r["type"]: r["name"]
            for r in conn.execute("SELECT type, name FROM ufa_game_events_dictionary").fetchall()
        }

        def resolve(slug: str | None) -> str | None:
            if not slug:
                return None
            return player_names.get(slug, slug)

        # Each regulation quarter = 720 s, OT = 600 s.
        # period_offset is the cumulative seconds elapsed BEFORE the current period.
        # time values on point-start events (type 1/2) are clock-seconds into their period.
        PERIOD_END_OFFSETS: dict[int, int] = {
            28: 720,   # after Q1 → Q2 starts at 720 s
            29: 1440,  # after Q2 (halftime) → Q3 starts at 1440 s
            30: 2160,  # after Q3 → Q4 starts at 2160 s
            31: 2880,  # after regulation → OT1 starts at 2880 s
            32: 3480,  # after OT1 → OT2 starts at 3480 s
            33: 4080,  # after OT2
        }
        PERIOD_TYPES = {28: "q1", 29: "half", 30: "q3", 31: "reg", 32: "ot1", 33: "ot2"}

        # Load pre-computed line_edge values (game_id, perspective, event_seq → line_edge).
        # Returns empty dict if the wp_line_edge table hasn't been populated yet.
        def load_le_map(persp: str) -> dict[int, float]:
            try:
                rows = conn.execute(
                    "SELECT event_seq, line_edge FROM wp_line_edge WHERE game_id=? AND perspective=?",
                    (game_id, persp),
                ).fetchall()
                return {r["event_seq"]: r["line_edge"] for r in rows}
            except Exception:
                return {}

        le_map: dict[str, dict[int, float]] = {
            perspective:     load_le_map(perspective),
            opp_perspective: load_le_map(opp_perspective),
        }

        def fetch_and_serialize(persp: str) -> list[dict]:
            rows = conn.execute(
                """SELECT event_seq, type, time,
                          thrower, thrower_x, thrower_y,
                          receiver, receiver_x, receiver_y,
                          turnover_x, turnover_y,
                          defender, puller, pull_x, pull_y
                   FROM ufa_game_events
                   WHERE game_id = ? AND perspective = ?
                   ORDER BY event_seq""",
                (game_id, persp)
            ).fetchall()
            result = []
            period_offset = 0
            for r in rows:
                t = r["type"]
                # Compute absolute time: only defined for events that carry a time value
                abs_time = None
                if r["time"] is not None:
                    abs_time = period_offset + r["time"]
                # After a period-end event, advance the offset for the next period
                if t in PERIOD_END_OFFSETS:
                    period_offset = PERIOD_END_OFFSETS[t]
                result.append({
                    "seq":           r["event_seq"],
                    "type":          t,
                    "type_name":     type_names.get(t, str(t)),
                    "time":          r["time"],
                    "absolute_time": abs_time,
                    "line_edge":     le_map[persp].get(r["event_seq"]),  # None if not computed yet
                    "thrower":       resolve(r["thrower"]),
                    "thrower_slug":  r["thrower"],
                    "thrower_x":     r["thrower_x"],
                    "thrower_y":     r["thrower_y"],
                    "receiver":      resolve(r["receiver"]),
                    "receiver_slug": r["receiver"],
                    "receiver_x":    r["receiver_x"],
                    "receiver_y":    r["receiver_y"],
                    "turnover_x":    r["turnover_x"],
                    "turnover_y":    r["turnover_y"],
                    "defender":      resolve(r["defender"]),
                    "defender_slug": r["defender"],
                    "puller":        resolve(r["puller"]),
                    "pull_x":        r["pull_x"],
                    "pull_y":        r["pull_y"],
                })
            return result

        team_events = fetch_and_serialize(perspective)
        opp_events  = fetch_and_serialize(opp_perspective)

        # Period breaks with their fixed absolute end times
        period_breaks = [
            {
                "seq":           e["seq"],
                "label":         PERIOD_TYPES[e["type"]],
                "absolute_time": PERIOD_END_OFFSETS[e["type"]],
            }
            for e in team_events
            if e["type"] in PERIOD_TYPES
        ]

        # Total game time = the last period-end absolute time seen (defaults to 2880 = full regulation)
        last_break_type = next(
            (e["type"] for e in reversed(team_events) if e["type"] in PERIOD_END_OFFSETS),
            31  # fallback: assume regulation
        )
        total_game_time = PERIOD_END_OFFSETS[last_break_type]

        # ── Shownspace enrichment ────────────────────────────────────────────
        ss_throws: list[dict]  = []
        ss_pulls:  list[dict]  = []
        ss_player_stats: dict  = {"team": [], "opp": []}
        ss_wp_timeline:  list[dict] = []
        ss_links:  dict        = {"yt_highlights": None, "yt_full": None, "watchufa_full": None}
        ss_is_home_team: bool | None = None

        ss_game = conn.execute(
            "SELECT home_team_id, away_team_id FROM shownspace_games WHERE game_id = ?",
            (game_id,)
        ).fetchone()

        if ss_game:
            ss_is_home_team = (ss_game["home_team_id"] == team_slug)

            # Throws (completed passes + goals) and blocks (turnovers) combined
            throw_rows = conn.execute("""
                SELECT thrower, thrower_x, thrower_y, receiver, receiver_x, receiver_y,
                       NULL AS turnover_x, NULL AS turnover_y,
                       turnover, dropped_throw, stall, is_home_team
                FROM shownspace_throws WHERE game_id = ?
                UNION ALL
                SELECT thrower, thrower_x, thrower_y, receiver, receiver_x, receiver_y,
                       turnover_x, turnover_y,
                       turnover, dropped_throw, stall, is_home_team
                FROM shownspace_blocks WHERE game_id = ?
            """, (game_id, game_id)).fetchall()

            ss_throws = [
                {
                    "thrower":       r["thrower"],
                    "thrower_x":     r["thrower_x"],
                    "thrower_y":     r["thrower_y"],
                    "receiver":      r["receiver"],
                    "receiver_x":    r["receiver_x"],
                    "receiver_y":    r["receiver_y"],
                    "turnover_x":    r["turnover_x"],
                    "turnover_y":    r["turnover_y"],
                    "turnover":      r["turnover"],
                    "dropped_throw": r["dropped_throw"],
                    "stall":         r["stall"],
                    "is_home_team":  r["is_home_team"],
                }
                for r in throw_rows
            ]

            # Pulls
            pull_rows = conn.execute(
                "SELECT puller, pull_x, pull_y, is_home_team FROM shownspace_pulls WHERE game_id = ?",
                (game_id,)
            ).fetchall()
            ss_pulls = [
                {
                    "puller":       r["puller"],
                    "pull_x":       r["pull_x"],
                    "pull_y":       r["pull_y"],
                    "is_home_team": r["is_home_team"],
                }
                for r in pull_rows
            ]

            # Player stats — split into team vs opp by team_id
            ps_rows = conn.execute("""
                SELECT player_id, full_name, team_id,
                       goals, assists, blocks, turnovers,
                       completions, throw_attempts, completion_percentage,
                       cpoe, total_aec, player_impact, seconds_played
                FROM shownspace_player_stats
                WHERE game_id = ?
                ORDER BY (goals + assists) DESC
            """, (game_id,)).fetchall()

            ps_team, ps_opp = [], []
            for r in ps_rows:
                row = {
                    "id":                    r["player_id"],
                    "name":                  r["full_name"],
                    "team_id":               r["team_id"],
                    "goals":                 r["goals"] or 0,
                    "assists":               r["assists"] or 0,
                    "turns":                 r["turnovers"] or 0,
                    "blocks":                r["blocks"] or 0,
                    "completions":           r["completions"],
                    "throw_attempts":        r["throw_attempts"],
                    "completion_percentage": r["completion_percentage"],
                    "cpoe":                  r["cpoe"],
                    "total_aec":             r["total_aec"],
                    "player_impact":         r["player_impact"],
                    "seconds_played":        r["seconds_played"],
                }
                (ps_team if r["team_id"] == team_slug else ps_opp).append(row)
            ss_player_stats = {"team": ps_team, "opp": ps_opp}

            # Win-prob timeline from shownspace throws (for per-score substitution)
            wp_rows = conn.execute("""
                SELECT global_event_seq, win_prob, game_time_left
                FROM shownspace_throws
                WHERE game_id = ? AND win_prob IS NOT NULL AND game_time_left IS NOT NULL
                ORDER BY global_event_seq
            """, (game_id,)).fetchall()
            ss_wp_timeline = [
                {"seq": r["global_event_seq"], "wp": r["win_prob"], "gtl": r["game_time_left"]}
                for r in wp_rows
            ]

            # Game links
            links_row = conn.execute(
                "SELECT yt_highlights, yt_full, watchufa_full FROM shownspace_game_links WHERE game_id = ?",
                (game_id,)
            ).fetchone()
            if links_row:
                ss_links = {
                    "yt_highlights": links_row["yt_highlights"],
                    "yt_full":       links_row["yt_full"],
                    "watchufa_full": links_row["watchufa_full"],
                }

        return {
            "game_id":                game_id,
            "perspective":            perspective,
            "team_slug":              team_slug,
            "opp_slug":               opp_slug,
            "team_abbrev":            team_abbrev,
            "opp_abbrev":             opp_abbrev,
            "period_breaks":          period_breaks,
            "total_events":           len(team_events),
            "total_game_time":        total_game_time,
            "team_events":            team_events,
            "opp_events":             opp_events,
            # Shownspace enrichment
            "shownspace_throws":      ss_throws,
            "shownspace_pulls":       ss_pulls,
            "player_stats":           ss_player_stats,
            "shownspace_wp_timeline": ss_wp_timeline,
            "links":                  ss_links,
            "ss_is_home_team":        ss_is_home_team,
        }


# ── /api/ufa/leaderboard ─────────────────────────────────────────────────────

@app.get("/api/ufa/leaderboard")
def get_ufa_leaderboard(
    year:  int | None = Query(None),
    team:  str | None = Query(None, description="franchise_id filter"),
    sort:  str        = Query("goals"),
    limit: int        = Query(200),
):
    """Aggregated player leaderboard from ufa_player_season_stats."""
    VALID_SORTS = {"goals", "assists", "blocks", "throwaways", "plus_minus",
                   "games_played", "completions", "throw_attempts", "hucks_completed"}
    if sort not in VALID_SORTS:
        sort = "goals"
    limit = min(max(1, limit), 500)

    wheres = ["s.player_id IS NOT NULL"]
    params: list = []

    if year:
        wheres.append("s.year = ?")
        params.append(year)

    if team:
        # team is franchise_id — resolve to all slugs for that franchise
        pass  # handled below with a sub-select

    where_sql = "WHERE " + " AND ".join(wheres)

    with get_db() as conn:
        # Build the team filter sub-select if needed
        team_join = ""
        if team:
            team_join = """
            JOIN ufa_franchises filt
              ON filt.team_slug = s.team_id
             AND filt.franchise_id = ?
             AND filt.year = s.year
            """
            params = [team] + params  # prepend so positional order matches

        rows = conn.execute(f"""
            SELECT
                p.display_name                                   AS player_name,
                m.ID                                             AS master_id,
                COALESCE(
                    (SELECT f2.team_name FROM ufa_franchises f2
                     WHERE f2.team_slug = MAX(s.team_id) AND f2.year = MAX(s.year)
                     LIMIT 1),
                    MAX(s.team_id)
                )                                                AS team_name,
                MAX(s.year)                                      AS latest_year,
                SUM(s.games_played)                              AS games_played,
                SUM(COALESCE(s.goals,          0))               AS goals,
                SUM(COALESCE(s.assists,        0))               AS assists,
                SUM(COALESCE(s.blocks,         0))               AS blocks,
                SUM(COALESCE(s.throwaways,     0))               AS throwaways,
                SUM(COALESCE(s.plus_minus,     0))               AS plus_minus,
                SUM(COALESCE(s.completions,    0))               AS completions,
                SUM(COALESCE(s.throw_attempts, 0))               AS throw_attempts,
                SUM(COALESCE(s.hucks_completed,0))               AS hucks_completed
            FROM ufa_player_season_stats s
            LEFT JOIN ufa_players p    ON p.player_slug = s.player_id
            LEFT JOIN master_players m ON m.UFA_ID      = s.player_id
            {team_join}
            {where_sql}
            GROUP BY s.player_id
            HAVING SUM(s.games_played) >= 1
            ORDER BY {sort} DESC
            LIMIT {int(limit)}
        """, params).fetchall()

        year_rows = conn.execute("""
            SELECT DISTINCT year FROM ufa_player_season_stats
            WHERE year IS NOT NULL
            ORDER BY year DESC
        """).fetchall()

        team_rows = conn.execute("""
            SELECT f.franchise_id, f.team_name, f.team_slug, f.year
            FROM ufa_franchises f
            ORDER BY f.team_name, f.year
        """).fetchall()

    return {
        "players": [dict(r) for r in rows],
        "years":   [r["year"] for r in year_rows],
        "teams":   [dict(r) for r in team_rows],
    }


# ── /api/ufa/throws/{team_id}/{year} ─────────────────────────────────────────

@app.get("/api/ufa/throws/{team_id}/{year}")
def get_team_throws(team_id: str, year: int):
    """Return SVG-mapped throw data for a team-year from shownspace.

    team_id must be the shownspace/UFA team slug (e.g. 'cascades', 'radicals').
    Returns items (throws + blocks, SVG-coordinate mapped) and hold_time per player.
    """
    with get_db() as conn:
        # Build player name lookup for this year from shownspace_player_stats
        name_rows = conn.execute(
            "SELECT DISTINCT player_id, full_name FROM shownspace_player_stats WHERE year = ?",
            (year,)
        ).fetchall()
        name_lookup: dict[str, str] = {
            r["player_id"]: r["full_name"]
            for r in name_rows
            if r["player_id"] and r["full_name"]
        }

        # Throws (completed passes + goals) for the team
        throws_rows = conn.execute("""
            SELECT t.game_id,
                   t.thrower     AS thrower_id,
                   t.thrower_x,
                   t.thrower_y,
                   t.receiver    AS receiver_id,
                   t.receiver_x,
                   t.receiver_y,
                   NULL          AS turnover_x,
                   NULL          AS turnover_y,
                   t.turnover,
                   t.dropped_throw,
                   t.stall,
                   t.is_home_team,
                   t.source_event_type,
                   CASE
                       WHEN t.source_event_type = 19 THEN 'score'
                       WHEN t.dropped_throw = 1     THEN 'drop'
                       WHEN t.stall = 1             THEN 'stall'
                       WHEN t.turnover = 1          THEN 'throwaway'
                       ELSE                              'pass'
                   END AS pbp_throw_type,
                   g.year,
                   CASE WHEN t.is_home_team = 1 THEN g.away_team_id ELSE g.home_team_id END AS opponent_id
            FROM shownspace_throws t
            JOIN shownspace_games g ON t.game_id = g.game_id
            WHERE g.year = ?
              AND (
                    (t.is_home_team = 1 AND g.home_team_id = ?)
                 OR (t.is_home_team = 0 AND g.away_team_id = ?)
              )

            UNION ALL

            SELECT b.game_id,
                   b.thrower     AS thrower_id,
                   b.thrower_x,
                   b.thrower_y,
                   b.receiver    AS receiver_id,
                   COALESCE(b.receiver_x, b.turnover_x) AS receiver_x,
                   COALESCE(b.receiver_y, b.turnover_y) AS receiver_y,
                   b.turnover_x,
                   b.turnover_y,
                   b.turnover,
                   b.dropped_throw,
                   b.stall,
                   b.is_home_team,
                   b.source_event_type,
                   CASE
                       WHEN b.dropped_throw = 1 THEN 'drop'
                       WHEN b.stall = 1         THEN 'stall'
                       ELSE                          'throwaway'
                   END AS pbp_throw_type,
                   g.year,
                   CASE WHEN b.is_home_team = 1 THEN g.away_team_id ELSE g.home_team_id END AS opponent_id
            FROM shownspace_blocks b
            JOIN shownspace_games g ON b.game_id = g.game_id
            WHERE g.year = ?
              AND (
                    (b.is_home_team = 1 AND g.home_team_id = ?)
                 OR (b.is_home_team = 0 AND g.away_team_id = ?)
              )
        """, (year, team_id, team_id, year, team_id, team_id)).fetchall()

        items = []
        for r in throws_rows:
            items.append({
                "game_id":        r["game_id"],
                "thrower_id":     r["thrower_id"],
                "thrower_name":   name_lookup.get(r["thrower_id"]) if r["thrower_id"] else None,
                "receiver_id":    r["receiver_id"],
                "receiver_name":  name_lookup.get(r["receiver_id"]) if r["receiver_id"] else None,
                "svg_throw_x":    _to_svg_x(r["thrower_x"]),
                "svg_throw_y":    _to_svg_y(r["thrower_y"]),
                "svg_recv_x":     _to_svg_x(r["receiver_x"]),
                "svg_recv_y":     _to_svg_y(r["receiver_y"]),
                "turnover_x":     _to_svg_x(r["turnover_x"]),
                "turnover_y":     _to_svg_y(r["turnover_y"]),
                "pbp_throw_type": r["pbp_throw_type"],
                "team_id":        team_id,
                "year":           r["year"],
                "opponent_id":    r["opponent_id"],
            })

        # Normalize attack direction: shownspace stores throws so the offense always
        # attacks toward the HIGH Y end zone (Y→120).  Our visualisations (CompletionRateMap,
        # ReceiverHeatMap) were built expecting the team to attack the TOP end zone (low SVG Y).
        # Flip every Y: flipped_svg_y = (SVG_Y0*2 + SVG_H_DATA) - svg_y  =  460 - svg_y
        _SVG_Y_FLIP = _SVG_Y0 * 2 + _SVG_H_DATA  # = 460
        for it in items:
            for key in ("svg_throw_y", "svg_recv_y", "turnover_y"):
                if it[key] is not None:
                    it[key] = _SVG_Y_FLIP - it[key]

        # Per-player average hold time (requires source_timestamp to be populated)
        hold_rows = conn.execute("""
            SELECT t.thrower,
                   AVG(t.source_timestamp - prev.source_timestamp) AS avg_hold_seconds,
                   COUNT(*) AS throw_count
            FROM shownspace_throws t
            JOIN shownspace_throws prev
                ON  t.game_id          = prev.game_id
                AND t.possession_num   = prev.possession_num
                AND t.possession_throw = prev.possession_throw + 1
            JOIN shownspace_games g ON t.game_id = g.game_id
            WHERE g.year = ?
              AND (
                    (t.is_home_team = 1 AND g.home_team_id = ?)
                 OR (t.is_home_team = 0 AND g.away_team_id = ?)
              )
              AND (t.source_timestamp - prev.source_timestamp) BETWEEN 0 AND 30
            GROUP BY t.thrower
            HAVING throw_count >= 5
            ORDER BY avg_hold_seconds ASC
        """, (year, team_id, team_id)).fetchall()

        hold_time = [
            {
                "player_id":         r["thrower"],
                "player_name":       name_lookup.get(r["thrower"]),
                "avg_hold_seconds":  r["avg_hold_seconds"],
                "throw_count":       r["throw_count"],
            }
            for r in hold_rows
        ]

        # League-wide receiver coords for heatmap normalization (all teams, same year)
        league_rows = conn.execute("""
            SELECT t.receiver_x, t.receiver_y
            FROM shownspace_throws t
            JOIN shownspace_games g ON t.game_id = g.game_id
            WHERE g.year = ?
              AND t.receiver_x IS NOT NULL AND t.receiver_y IS NOT NULL
            UNION ALL
            SELECT b.receiver_x, b.receiver_y
            FROM shownspace_blocks b
            JOIN shownspace_games g ON b.game_id = g.game_id
            WHERE g.year = ?
              AND b.receiver_x IS NOT NULL AND b.receiver_y IS NOT NULL
        """, (year, year)).fetchall()

        league_items = []
        for r in league_rows:
            raw_y = _to_svg_y(r["receiver_y"])
            league_items.append({
                "svg_recv_x": _to_svg_x(r["receiver_x"]),
                "svg_recv_y": (_SVG_Y_FLIP - raw_y) if raw_y is not None else None,
            })

    return {"items": items, "hold_time": hold_time, "league_items": league_items}


# ── /api/players/{player_id}/throws ──────────────────────────────────────────

@app.get("/api/players/{player_id}/throws")
def get_player_throws(player_id: str, year: int | None = Query(None)):
    """Return SVG-mapped throw data for a single player across all (or one) year."""
    with get_db() as conn:
        mp = conn.execute(
            "SELECT ID, UFA_ID FROM master_players WHERE ID = ?", (player_id,)
        ).fetchone()
        if not mp:
            raise HTTPException(status_code=404, detail="Player not found")

        ufa_id = mp["UFA_ID"]
        if not ufa_id:
            raise HTTPException(status_code=404, detail="No UFA data for this player")

        name_rows = conn.execute(
            "SELECT DISTINCT player_id, full_name FROM shownspace_player_stats"
        ).fetchall()
        name_lookup: dict[str, str] = {
            r["player_id"]: r["full_name"]
            for r in name_rows
            if r["player_id"] and r["full_name"]
        }

        year_rows = conn.execute("""
            SELECT DISTINCT g.year FROM shownspace_throws t
            JOIN shownspace_games g ON g.game_id = t.game_id
            WHERE t.thrower = ? OR t.receiver = ?
            UNION
            SELECT DISTINCT g.year FROM shownspace_blocks b
            JOIN shownspace_games g ON g.game_id = b.game_id
            WHERE b.thrower = ?
            ORDER BY year DESC
        """, (ufa_id, ufa_id, ufa_id)).fetchall()
        years = [r["year"] for r in year_rows]

        year_filter = "AND g.year = ?" if year is not None else ""
        yp = [year] if year is not None else []

        throws_rows = conn.execute(f"""
            SELECT t.game_id, g.year,
                   t.thrower     AS thrower_id,
                   t.thrower_x,  t.thrower_y,
                   t.receiver    AS receiver_id,
                   t.receiver_x, t.receiver_y,
                   NULL          AS turnover_x,
                   NULL          AS turnover_y,
                   t.dropped_throw, t.stall, t.turnover,
                   t.source_event_type,
                   CASE
                       WHEN t.source_event_type = 19 THEN 'score'
                       WHEN t.dropped_throw = 1      THEN 'drop'
                       WHEN t.stall = 1              THEN 'stall'
                       WHEN t.turnover = 1           THEN 'throwaway'
                       ELSE                               'pass'
                   END AS pbp_throw_type
            FROM shownspace_throws t
            JOIN shownspace_games g ON g.game_id = t.game_id
            WHERE (t.thrower = ? OR t.receiver = ?)
            {year_filter}

            UNION ALL

            SELECT b.game_id, g.year,
                   b.thrower     AS thrower_id,
                   b.thrower_x,  b.thrower_y,
                   b.receiver    AS receiver_id,
                   COALESCE(b.receiver_x, b.turnover_x) AS receiver_x,
                   COALESCE(b.receiver_y, b.turnover_y) AS receiver_y,
                   b.turnover_x, b.turnover_y,
                   b.dropped_throw, b.stall, b.turnover,
                   b.source_event_type,
                   CASE
                       WHEN b.dropped_throw = 1 THEN 'drop'
                       WHEN b.stall = 1         THEN 'stall'
                       ELSE                          'throwaway'
                   END AS pbp_throw_type
            FROM shownspace_blocks b
            JOIN shownspace_games g ON g.game_id = b.game_id
            WHERE b.thrower = ?
            {year_filter}
        """, [ufa_id, ufa_id] + yp + [ufa_id] + yp).fetchall()

        _SVG_Y_FLIP = _SVG_Y0 * 2 + _SVG_H_DATA  # 460

        items = []
        for r in throws_rows:
            items.append({
                "game_id":        r["game_id"],
                "year":           r["year"],
                "thrower_id":     r["thrower_id"],
                "thrower_name":   name_lookup.get(r["thrower_id"]) if r["thrower_id"] else None,
                "receiver_id":    r["receiver_id"],
                "receiver_name":  name_lookup.get(r["receiver_id"]) if r["receiver_id"] else None,
                "svg_throw_x":    _to_svg_x(r["thrower_x"]),
                "svg_throw_y":    _to_svg_y(r["thrower_y"]),
                "svg_recv_x":     _to_svg_x(r["receiver_x"]),
                "svg_recv_y":     _to_svg_y(r["receiver_y"]),
                "turnover_x":     _to_svg_x(r["turnover_x"]),
                "turnover_y":     _to_svg_y(r["turnover_y"]),
                "pbp_throw_type": r["pbp_throw_type"],
            })

        for it in items:
            for key in ("svg_throw_y", "svg_recv_y", "turnover_y"):
                if it[key] is not None:
                    it[key] = _SVG_Y_FLIP - it[key]

        league_year_param = year if year is not None else (years[0] if years else None)
        league_items = []
        if league_year_param is not None:
            league_rows = conn.execute("""
                SELECT t.receiver_x, t.receiver_y
                FROM shownspace_throws t
                JOIN shownspace_games g ON g.game_id = t.game_id
                WHERE g.year = ?
                  AND t.receiver_x IS NOT NULL AND t.receiver_y IS NOT NULL
                UNION ALL
                SELECT b.receiver_x, b.receiver_y
                FROM shownspace_blocks b
                JOIN shownspace_games g ON g.game_id = b.game_id
                WHERE g.year = ?
                  AND b.receiver_x IS NOT NULL AND b.receiver_y IS NOT NULL
            """, (league_year_param, league_year_param)).fetchall()
            for r in league_rows:
                raw_y = _to_svg_y(r["receiver_y"])
                league_items.append({
                    "svg_recv_x": _to_svg_x(r["receiver_x"]),
                    "svg_recv_y": (_SVG_Y_FLIP - raw_y) if raw_y is not None else None,
                })

    return {"items": items, "league_items": league_items, "years": years}


# ── /api/ufa/xgoal ───────────────────────────────────────────────────────────

@app.get("/api/ufa/xgoal")
def get_league_xgoal(year_min: int = 2021, year_max: int = None):
    """Return all terminal throw origins (scores + turnovers/blocks) across ALL
    teams for the given year range.  Used by the frontend for league-wide xG
    heat-map computation — only svg_throw_x/y and pbp_throw_type are returned."""
    if year_max is None:
        year_max = year_min
    years = list(range(int(year_min), int(year_max) + 1))
    placeholders = ",".join("?" * len(years))

    with get_db() as conn:
        rows = conn.execute(f"""
            SELECT t.thrower_x, t.thrower_y,
                   CASE
                       WHEN t.source_event_type = 19 THEN 'score'
                       WHEN t.dropped_throw = 1      THEN 'drop'
                       WHEN t.stall = 1              THEN 'stall'
                       WHEN t.turnover = 1           THEN 'throwaway'
                   END AS pbp_throw_type
            FROM shownspace_throws t
            JOIN shownspace_games g ON t.game_id = g.game_id
            WHERE g.year IN ({placeholders})
              AND t.thrower_x IS NOT NULL AND t.thrower_y IS NOT NULL
              AND (
                    t.source_event_type = 19
                 OR t.dropped_throw = 1
                 OR t.stall = 1
                 OR t.turnover = 1
              )
            UNION ALL
            SELECT b.thrower_x, b.thrower_y,
                   CASE
                       WHEN b.dropped_throw = 1 THEN 'drop'
                       WHEN b.stall = 1         THEN 'stall'
                       ELSE                          'throwaway'
                   END AS pbp_throw_type
            FROM shownspace_blocks b
            JOIN shownspace_games g ON b.game_id = g.game_id
            WHERE g.year IN ({placeholders})
              AND b.thrower_x IS NOT NULL AND b.thrower_y IS NOT NULL
        """, years + years).fetchall()

    _SVG_Y_FLIP = _SVG_Y0 * 2 + _SVG_H_DATA  # 460 — same flip as per-team endpoint
    items = []
    for r in rows:
        tx = _to_svg_x(r["thrower_x"])
        ty = _to_svg_y(r["thrower_y"])
        if tx is None or ty is None:
            continue
        items.append({
            "svg_throw_x":    tx,
            "svg_throw_y":    _SVG_Y_FLIP - ty,
            "pbp_throw_type": r["pbp_throw_type"],
        })
    return {"items": items}


# ── /api/players/{player_id}/season_stats ────────────────────────────────────

def _safe_div(num, den):
    """Return num/den or None if den is None/0."""
    if den is None or den == 0 or num is None:
        return None
    return num / den

def _pct2(num, den):
    p = _safe_div(num, den)
    return round(p * 100, 1) if p is not None else None

@app.get("/api/players/{player_id}/season_stats")
def get_player_season_stats(player_id: str):
    """Aggregate per-season and career stats from shownspace + ufa_player_season_stats."""
    with get_db() as conn:
        mp = conn.execute(
            "SELECT * FROM master_players WHERE ID = ?", (player_id,)
        ).fetchone()
        if not mp:
            raise HTTPException(status_code=404, detail="Player not found")

        ufa_id = mp["UFA_ID"]
        if not ufa_id:
            return {"seasons": [], "career": None, "source": "none"}

        # ── Aggregate shownspace per year ────────────────────────────────────
        ss_rows = conn.execute("""
            SELECT
                p.year,
                p.team_id,
                COALESCE(t.team_name, p.team_id) AS team_name,
                COUNT(DISTINCT p.game_id)                                   AS gp_ss,
                SUM(p.goals)                                                AS goals,
                SUM(p.assists)                                              AS assists,
                SUM(p.hockey_assists)                                       AS hockey_assists,
                SUM(p.blocks)                                               AS blocks,
                SUM(p.completions)                                          AS completions,
                SUM(p.throw_attempts)                                       AS throw_attempts,
                SUM(p.throwaways)                                           AS throwaways,
                SUM(p.o_points_played)                                      AS o_points_played,
                SUM(p.d_points_played)                                      AS d_points_played,
                SUM(p.offensive_possessions)                                AS o_poss,
                SUM(p.offensive_possessions_involved)                       AS o_poss_inv,
                SUM(p.defensive_possessions)                                AS d_poss,
                SUM(p.hucks_thrown)                                         AS hucks_thrown,
                SUM(p.hucks_completed)                                      AS hucks_completed,
                SUM(p.hucks_caught)                                         AS hucks_caught,
                SUM(p.total_aec)                                            AS total_aec,
                SUM(p.thrower_aec)                                          AS thrower_aec,
                SUM(p.receiver_aec)                                         AS receiver_aec,
                SUM(p.lag_contribution)                                     AS lag_contribution,
                SUM(COALESCE(p.cpoe_attempts, 0))                           AS cpoe_attempts,
                SUM(COALESCE(p.cpoe_completions, 0))                        AS cpoe_completions,
                SUM(COALESCE(p.cpoe,    0) * COALESCE(p.cpoe_attempts, 0)) AS cpoe_wsum,
                SUM(COALESCE(p.xcp,     0) * COALESCE(p.throw_attempts, 0)) AS xcp_wsum,
                SUM(COALESCE(p.oe,      0) * COALESCE(p.o_points_played, 0)) AS oe_wsum,
                SUM(COALESCE(p.de,      0) * COALESCE(p.d_points_played, 0)) AS de_wsum,
                SUM(COALESCE(p.team_total_aec,     0))                      AS team_total_aec_sum,
                SUM(COALESCE(p.total_possession_aec, 0))                    AS total_poss_aec_sum
            FROM shownspace_player_stats p
            LEFT JOIN ufa_teams t ON t.team_slug = p.team_id
            WHERE p.player_id = ?
            GROUP BY p.year
            ORDER BY p.year DESC
        """, (ufa_id,)).fetchall()

        # ── Official GP from ufa_player_season_stats ─────────────────────────
        gp_rows = {
            r["year"]: r["games_played"]
            for r in conn.execute(
                "SELECT year, games_played FROM ufa_player_season_stats WHERE player_id = ?",
                (ufa_id,)
            ).fetchall()
        }

        # ── League percentiles (season-level) ────────────────────────────────
        _player_years = [dict(r)["year"] for r in ss_rows if dict(r).get("year")]
        _pctiles_by_year: dict = {}
        if _player_years:
            _ph = ",".join("?" * len(_player_years))
            _pctile_rows = conn.execute(f"""
                WITH agg AS (
                    SELECT s.player_id, s.year,
                        SUM(s.goals)                    AS goals,
                        SUM(s.assists)                  AS assists,
                        SUM(s.hockey_assists)           AS hockey_assists,
                        SUM(s.blocks)                   AS blocks,
                        SUM(s.completions)              AS completions,
                        SUM(s.throw_attempts)           AS throw_attempts,
                        SUM(s.throwaways)               AS throwaways,
                        SUM(s.hucks_thrown)             AS hucks_thrown,
                        SUM(s.hucks_caught)             AS hucks_caught,
                        SUM(s.hucks_completed)          AS hucks_completed,
                        SUM(s.total_aec)                AS total_aec,
                        SUM(s.thrower_aec)              AS thrower_aec,
                        SUM(s.receiver_aec)             AS receiver_aec,
                        SUM(s.lag_contribution)         AS lag_contribution,
                        SUM(s.o_points_played)          AS o_pts,
                        SUM(s.d_points_played)          AS d_pts,
                        SUM(s.offensive_possessions)    AS o_poss,
                        SUM(s.defensive_possessions)    AS d_poss,
                        SUM(s.offensive_possessions_involved) AS o_poss_inv,
                        SUM(COALESCE(s.cpoe_attempts,0))     AS cpoe_att,
                        CASE WHEN SUM(s.throw_attempts) > 0
                            THEN SUM(s.completions)*100.0/SUM(s.throw_attempts) END AS cp_pct,
                        CASE WHEN SUM(s.hucks_thrown) > 0
                            THEN SUM(s.hucks_completed)*100.0/SUM(s.hucks_thrown) END AS hu_cp_pct,
                        CASE WHEN SUM(s.throw_attempts) > 0
                            THEN SUM(s.hucks_thrown)*100.0/SUM(s.throw_attempts) END AS hu_ap_pct,
                        CASE WHEN SUM(s.throw_attempts) > 0
                            THEN SUM(COALESCE(s.xcp,0)*COALESCE(s.throw_attempts,0))*100.0
                                 /SUM(s.throw_attempts) END AS xcp,
                        CASE WHEN SUM(COALESCE(s.cpoe_attempts,0)) > 0
                            THEN SUM(COALESCE(s.cpoe,0)*COALESCE(s.cpoe_attempts,0))
                                 /SUM(COALESCE(s.cpoe_attempts,0)) END AS cpoe,
                        CASE WHEN SUM(s.o_points_played) > 0
                            THEN SUM(COALESCE(s.oe,0)*s.o_points_played)/SUM(s.o_points_played) END AS oe,
                        CASE WHEN SUM(s.d_points_played) > 0
                            THEN SUM(COALESCE(s.de,0)*s.d_points_played)/SUM(s.d_points_played) END AS de,
                        CASE WHEN SUM(s.offensive_possessions) > 0
                            THEN SUM(s.offensive_possessions_involved)*100.0
                                 /SUM(s.offensive_possessions) END AS oi_pct,
                        CASE WHEN SUM(s.team_total_aec) > 0
                            THEN SUM(s.total_aec)*100.0/SUM(s.team_total_aec) END AS pi_t,
                        CASE WHEN SUM(s.total_possession_aec) > 0
                            THEN SUM(s.total_aec)*100.0/SUM(s.total_possession_aec) END AS pi_p
                    FROM shownspace_player_stats s
                    WHERE s.year IN ({_ph})
                    GROUP BY s.player_id, s.year
                    HAVING SUM(s.o_points_played)+SUM(s.d_points_played) >= 10
                ),
                ranked AS (
                    SELECT player_id, year,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY goals)              *100 AS INT) AS goals_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY assists)            *100 AS INT) AS assists_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY hockey_assists)     *100 AS INT) AS hockey_assists_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY blocks)             *100 AS INT) AS blocks_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY completions)        *100 AS INT) AS completions_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY throwaways DESC)    *100 AS INT) AS throwaways_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY cp_pct)             *100 AS INT) AS cp_pct_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY hucks_thrown)       *100 AS INT) AS hucks_thrown_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY hucks_caught)       *100 AS INT) AS hucks_caught_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY hu_cp_pct)          *100 AS INT) AS hu_cp_pct_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY hu_ap_pct)          *100 AS INT) AS hu_ap_pct_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY xcp)                *100 AS INT) AS xcp_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY cpoe)               *100 AS INT) AS cpoe_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY oe)                 *100 AS INT) AS oe_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY de)                 *100 AS INT) AS de_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY oi_pct)             *100 AS INT) AS oi_pct_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY total_aec)          *100 AS INT) AS total_aec_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY thrower_aec)        *100 AS INT) AS thrower_aec_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY receiver_aec)       *100 AS INT) AS receiver_aec_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY lag_contribution)   *100 AS INT) AS lag_contribution_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY pi_t)               *100 AS INT) AS pi_t_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY pi_p)               *100 AS INT) AS pi_p_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY o_pts)              *100 AS INT) AS o_pts_pctile,
                        CAST(PERCENT_RANK() OVER (PARTITION BY year ORDER BY d_pts)              *100 AS INT) AS d_pts_pctile
                    FROM agg
                )
                SELECT * FROM ranked WHERE player_id = ?
            """, _player_years + [ufa_id]).fetchall()
            for _pr in _pctile_rows:
                _pctiles_by_year[dict(_pr)["year"]] = dict(_pr)

        # ── EDGE stats (2021+, requires coordinate data) ─────────────────────
        from collections import defaultdict
        all_edge_rows = conn.execute(f"""
            WITH player_games AS (
                SELECT DISTINCT g.game_id, g.year,
                    CASE WHEN g.home_team_id = s.team_id THEN 'home' ELSE 'away' END AS player_side
                FROM ufa_games g
                JOIN ufa_player_season_stats s ON s.year = g.year AND s.player_id = :slug
                WHERE LOWER(g.status) IN ('final', 'complete', 'completed')
                  AND g.year >= 2021
                  AND (g.home_team_id = s.team_id OR g.away_team_id = s.team_id)
            )
            SELECT pg.year, {_EDGE_SELECT}
            FROM player_games pg
            JOIN ufa_game_events e ON e.game_id = pg.game_id
            GROUP BY pg.game_id, pg.year
        """, {"slug": ufa_id}).fetchall()

        edge_by_year = defaultdict(list)
        for _er in all_edge_rows:
            _d = dict(_er)
            edge_by_year[_d["year"]].append(_d)

        def _build_row(r):
            d = dict(r)
            ta   = d.get("throw_attempts") or 0
            comp = d.get("completions")    or 0
            hu_t = d.get("hucks_thrown")   or 0
            hu_c = d.get("hucks_completed") or 0
            op   = d.get("o_points_played") or 0
            dp   = d.get("d_points_played") or 0
            cpoe_a = d.get("cpoe_attempts") or 0
            team_aec = d.get("team_total_aec_sum") or 0
            poss_aec = d.get("total_poss_aec_sum") or 0
            t_aec = d.get("total_aec") or 0

            return {
                "year":          d.get("year"),
                "team_name":     d.get("team_name"),
                "team_id":       d.get("team_id"),
                # Usage
                "gp":            gp_rows.get(d.get("year")) or d.get("gp_ss"),
                "o_pts":         op,
                "d_pts":         dp,
                "o_poss":        d.get("o_poss"),
                "d_poss":        d.get("d_poss"),
                "oi_pct":        _pct2(d.get("o_poss_inv"), d.get("o_poss")),
                # Box score
                "goals":         d.get("goals"),
                "assists":       d.get("assists"),
                "hockey_assists":d.get("hockey_assists"),
                "blocks":        d.get("blocks"),
                "completions":   comp,
                "throw_attempts":ta,
                "throwaways":    d.get("throwaways"),
                "cp_pct":        _pct2(comp, ta),
                # Throwing
                "hucks_thrown":  hu_t,
                "hucks_completed":hu_c,
                "hucks_caught":  d.get("hucks_caught"),
                "hu_cp_pct":     _pct2(hu_c, hu_t),
                "hu_ap_pct":     _pct2(hu_t, ta),
                "xcp":           round(_safe_div(d.get("xcp_wsum"), ta) * 100, 1) if ta else None,
                "cpoe":          round(_safe_div(d.get("cpoe_wsum"), cpoe_a) * 100, 1) if cpoe_a else None,
                # Contribution
                "total_aec":     round(t_aec, 2) or None,
                "thrower_aec":   round(d.get("thrower_aec") or 0, 2) or None,
                "receiver_aec":  round(d.get("receiver_aec") or 0, 2) or None,
                "lag_contribution": round(d.get("lag_contribution") or 0, 2) or None,
                "pi_t":          round(_safe_div(t_aec, team_aec) * 100, 1) if team_aec else None,
                "pi_p":          round(_safe_div(t_aec, poss_aec) * 100, 1) if poss_aec else None,
                # Efficiency
                "oe":            round(_safe_div(d.get("oe_wsum"), op) * 100, 1) if op else None,
                "de":            round(_safe_div(d.get("de_wsum"), dp) * 100, 1) if dp else None,
            }

        seasons = []
        for _r in ss_rows:
            _row = _build_row(_r)
            _yr  = _row["year"]
            if _yr and _yr >= 2021 and _yr in edge_by_year:
                _eo, _eb, _et = _compute_edge(edge_by_year[_yr])
                _row["edge_o"] = _eo
                _row["edge_b"] = _eb
                _row["edge"]   = _et
            else:
                _row["edge_o"] = None
                _row["edge_b"] = None
                _row["edge"]   = None
            # attach percentiles
            _p = _pctiles_by_year.get(_yr, {})
            for _k in ("goals","assists","hockey_assists","blocks","completions","throwaways",
                       "cp_pct","hucks_thrown","hucks_caught","hu_cp_pct","hu_ap_pct",
                       "xcp","cpoe","oe","de","oi_pct","total_aec","thrower_aec",
                       "receiver_aec","lag_contribution","pi_t","pi_p","o_pts","d_pts"):
                _row[f"{_k}_pctile"] = _p.get(f"{_k}_pctile")
            seasons.append(_row)

        # ── Career totals ────────────────────────────────────────────────────
        if seasons:
            def _sum(key):
                return sum(s[key] or 0 for s in seasons) or None

            tot_ta   = _sum("throw_attempts")  or 0
            tot_comp = _sum("completions")      or 0
            tot_hu_t = _sum("hucks_thrown")     or 0
            tot_hu_c = _sum("hucks_completed")  or 0
            tot_op   = _sum("o_pts")            or 0
            tot_dp   = _sum("d_pts")            or 0
            tot_oi_n = sum((s.get("o_poss_inv") or 0) for s in [dict(r) for r in ss_rows])
            tot_oi_d = sum((s.get("o_poss")     or 0) for s in [dict(r) for r in ss_rows])
            tot_cpoe_a = sum((dict(r).get("cpoe_attempts") or 0) for r in ss_rows)

            xcp_n, xcp_d = sum(dict(r).get("xcp_wsum") or 0 for r in ss_rows), tot_ta
            cpoe_n       = sum(dict(r).get("cpoe_wsum") or 0 for r in ss_rows)
            oe_n, oe_d   = sum(dict(r).get("oe_wsum")  or 0 for r in ss_rows), tot_op
            de_n, de_d   = sum(dict(r).get("de_wsum")  or 0 for r in ss_rows), tot_dp
            tot_total_aec    = sum(dict(r).get("total_aec")           or 0 for r in ss_rows)
            tot_team_aec     = sum(dict(r).get("team_total_aec_sum")  or 0 for r in ss_rows)
            tot_poss_aec     = sum(dict(r).get("total_poss_aec_sum")  or 0 for r in ss_rows)

            career = {
                "year":          "Career",
                "team_name":     None,
                "team_id":       None,
                "gp":            sum(s["gp"] or 0 for s in seasons) or None,
                "o_pts":         tot_op or None,
                "d_pts":         tot_dp or None,
                "o_poss":        _sum("o_poss"),
                "d_poss":        _sum("d_poss"),
                "oi_pct":        _pct2(tot_oi_n, tot_oi_d),
                "goals":         _sum("goals"),
                "assists":       _sum("assists"),
                "hockey_assists":_sum("hockey_assists"),
                "blocks":        _sum("blocks"),
                "completions":   tot_comp or None,
                "throw_attempts":tot_ta or None,
                "throwaways":    _sum("throwaways"),
                "cp_pct":        _pct2(tot_comp, tot_ta),
                "hucks_thrown":  tot_hu_t or None,
                "hucks_completed":tot_hu_c or None,
                "hucks_caught":  _sum("hucks_caught"),
                "hu_cp_pct":     _pct2(tot_hu_c, tot_hu_t),
                "hu_ap_pct":     _pct2(tot_hu_t, tot_ta),
                "xcp":           round(_safe_div(xcp_n, xcp_d) * 100, 1) if xcp_d else None,
                "cpoe":          round(_safe_div(cpoe_n, tot_cpoe_a) * 100, 1) if tot_cpoe_a else None,
                "total_aec":     round(tot_total_aec, 2) or None,
                "thrower_aec":   round(_sum("thrower_aec") or 0, 2) or None,
                "receiver_aec":  round(_sum("receiver_aec") or 0, 2) or None,
                "lag_contribution": round(_sum("lag_contribution") or 0, 2) or None,
                "pi_t":          round(_safe_div(tot_total_aec, tot_team_aec) * 100, 1) if tot_team_aec else None,
                "pi_p":          round(_safe_div(tot_total_aec, tot_poss_aec) * 100, 1) if tot_poss_aec else None,
                "oe":            round(_safe_div(oe_n, oe_d) * 100, 1) if oe_d else None,
                "de":            round(_safe_div(de_n, de_d) * 100, 1) if de_d else None,
            }
            _ce_o, _ce_b, _ce_t = _compute_edge([dict(r) for r in all_edge_rows])
            career["edge_o"] = _ce_o
            career["edge_b"] = _ce_b
            career["edge"]   = _ce_t
        else:
            career = None

        return {"seasons": seasons, "career": career, "source": "shownspace"}


@app.get("/api/ufa/players")
def list_players(
    q:         str  | None = Query(None, description="Name or team search"),
    league:    str  | None = Query(None),
    year_from: int  | None = Query(None, alias="yearFrom"),
    year_to:   int  | None = Query(None, alias="yearTo"),
    limit:     int         = Query(200, le=500),
    offset:    int         = Query(0, ge=0),
):
    with get_db() as conn:
        where_clauses = []
        having_clauses = []
        params: list = []

        if q:
            where_clauses.append(
                "(p.display_name LIKE ? OR p.current_team_name LIKE ? OR p.most_recent_team_name LIKE ?)"
            )
            like = f"%{q}%"
            params += [like, like, like]

        # UFA is the only league we have here; filter if explicitly requested
        if league and league.upper() != "ALL":
            if league.upper() != "UFA":
                return {"count": 0, "players": []}

        having_params: list = []
        if year_from is not None:
            having_clauses.append("(MAX(s.year) IS NULL OR MAX(s.year) >= ?)")
            having_params.append(year_from)

        if year_to is not None:
            having_clauses.append("(MIN(s.year) IS NULL OR MIN(s.year) <= ?)")
            having_params.append(year_to)

        where_sql  = ("WHERE "  + " AND ".join(where_clauses))  if where_clauses  else ""
        having_sql = ("HAVING " + " AND ".join(having_clauses)) if having_clauses else ""

        sql = f"""
            SELECT
                p.player_slug,
                p.display_name,
                p.jersey_number,
                COALESCE(p.current_team_name, p.most_recent_team_name) AS team_name,
                p.photo_url,
                MIN(s.year) AS year_start,
                MAX(s.year) AS year_end
            FROM ufa_players p
            LEFT JOIN ufa_player_season_stats s ON s.player_id = p.player_slug
            {where_sql}
            GROUP BY p.player_slug
            {having_sql}
            ORDER BY p.display_name COLLATE NOCASE
            LIMIT ? OFFSET ?
        """
        all_params = params + having_params + [limit, offset]
        rows = conn.execute(sql, all_params).fetchall()

        max_year = conn.execute(
            "SELECT MAX(year) FROM ufa_player_season_stats"
        ).fetchone()[0] or 2026

        players = []
        for r in rows:
            year_end   = r["year_end"]
            year_start = r["year_start"]
            active     = year_end == max_year if year_end else False
            players.append({
                "slug":      r["player_slug"],
                "name":      r["display_name"],
                "number":    r["jersey_number"],
                "leagues":   ["UFA"],
                "levels":    ["Pro"],
                "teams":     [r["team_name"]] if r["team_name"] else [],
                "active":    active,
                "yearStart": year_start,
                "yearEnd":   year_end,
                "photoUrl":  r["photo_url"],
            })

        # total count for pagination
        count_sql = f"""
            SELECT COUNT(*) FROM (
                SELECT p.player_slug
                FROM ufa_players p
                LEFT JOIN ufa_player_season_stats s ON s.player_id = p.player_slug
                {where_sql}
                GROUP BY p.player_slug
                {having_sql}
            )
        """
        total = conn.execute(count_sql, params + having_params).fetchone()[0]

        return {"count": total, "players": players}


# ── /api/players (master_players) ────────────────────────────────────────────

_MASTER_SQL = """
    WITH ufa_sum AS (
        SELECT player_id, MIN(year) AS y_start, MAX(year) AS y_end
        FROM ufa_player_season_stats GROUP BY player_id
    ),
    pul_sum AS (
        SELECT player_name,
               MIN(CAST(season AS INTEGER)) AS y_start,
               MAX(CAST(season AS INTEGER)) AS y_end
        FROM pul_player_season_stats WHERE season != 'career'
        GROUP BY player_name
    ),
    pul_latest AS (
        SELECT player_name, team
        FROM (
            SELECT player_name, team,
                   ROW_NUMBER() OVER (PARTITION BY player_name ORDER BY season DESC) AS rn
            FROM pul_player_season_stats WHERE season != 'career'
        ) WHERE rn = 1
    ),
    wul_sum AS (
        SELECT player,
               MIN(CAST(SUBSTR(season, 1, 4) AS INTEGER)) AS y_start,
               MAX(CAST(SUBSTR(season, 1, 4) AS INTEGER)) AS y_end
        FROM wul_player_game_stats
        GROUP BY player
    ),
    wul_latest AS (
        SELECT player, team
        FROM (
            SELECT player, team,
                   ROW_NUMBER() OVER (PARTITION BY player ORDER BY season DESC, date DESC) AS rn
            FROM wul_player_game_stats
        ) WHERE rn = 1
    )
    SELECT
        mp.ID,
        mp.Name,
        mp.UFA_ID,
        mp.PUL_ID,
        mp.WUL_ID,
        mp.USAU_ID,
        mp.International_ID,
        up.jersey_number,
        COALESCE(up.photo_url, mp.PUL_photo_url) AS photo_url,
        COALESCE(up.current_team_name, up.most_recent_team_name) AS ufa_team,
        us.y_start  AS ufa_y_start,
        us.y_end    AS ufa_y_end,
        ps.y_start  AS pul_y_start,
        ps.y_end    AS pul_y_end,
        pl.team     AS pul_team,
        ws.y_start  AS wul_y_start,
        ws.y_end    AS wul_y_end,
        wl.team     AS wul_team
    FROM master_players mp
    LEFT JOIN ufa_players up  ON up.player_slug = mp.UFA_ID
    LEFT JOIN ufa_sum us      ON us.player_id   = mp.UFA_ID
    LEFT JOIN pul_sum ps      ON ps.player_name = mp.Name AND mp.PUL_ID IS NOT NULL
    LEFT JOIN pul_latest pl   ON pl.player_name = mp.Name AND mp.PUL_ID IS NOT NULL
    LEFT JOIN wul_sum ws      ON ws.player      = mp.Name AND mp.WUL_ID IS NOT NULL
    LEFT JOIN wul_latest wl   ON wl.player      = mp.Name AND mp.WUL_ID IS NOT NULL
    WHERE (mp.UFA_ID IS NOT NULL OR mp.PUL_ID IS NOT NULL OR mp.International_ID IS NOT NULL OR mp.WUL_ID IS NOT NULL OR mp.USAU_ID IS NOT NULL)
"""


@app.get("/api/players")
def list_players_master(
    q:         str  | None = Query(None),
    league:    str  | None = Query(None),
    year_from: int  | None = Query(None, alias="yearFrom"),
    year_to:   int  | None = Query(None, alias="yearTo"),
    limit:     int         = Query(200, le=500),
    offset:    int         = Query(0, ge=0),
):
    with get_db() as conn:
        sql = _MASTER_SQL
        params: list = []
        extra: list[str] = []

        if q:
            extra.append("mp.Name LIKE ?")
            params.append(f"%{q}%")

        if league and league.upper() not in ("ALL", ""):
            if league.upper() == "UFA":
                extra.append("mp.UFA_ID IS NOT NULL")
            elif league.upper() == "PUL":
                extra.append("mp.PUL_ID IS NOT NULL")
            elif league.upper() == "WUL":
                extra.append("mp.WUL_ID IS NOT NULL")
            elif league.upper() == "INTERNATIONAL":
                extra.append("mp.International_ID IS NOT NULL")
            else:
                return {"count": 0, "players": []}

        if extra:
            sql += " AND " + " AND ".join(extra)

        sql += " ORDER BY mp.Name COLLATE NOCASE"

        rows = conn.execute(sql, params).fetchall()

        max_ufa_year = conn.execute(
            "SELECT MAX(year) FROM ufa_player_season_stats"
        ).fetchone()[0] or 2026

        players = []
        for r in rows:
            ufa_ys, ufa_ye = r["ufa_y_start"], r["ufa_y_end"]
            pul_ys, pul_ye = r["pul_y_start"], r["pul_y_end"]
            wul_ys, wul_ye = r["wul_y_start"], r["wul_y_end"]

            y_starts = [v for v in [ufa_ys, pul_ys, wul_ys] if v is not None]
            y_ends   = [v for v in [ufa_ye, pul_ye, wul_ye] if v is not None]
            y_start  = min(y_starts) if y_starts else None
            y_end    = max(y_ends)   if y_ends   else None

            if year_from is not None and (y_end   is None or y_end   < year_from):
                continue
            if year_to   is not None and (y_start is None or y_start > year_to):
                continue

            leagues = []
            if r["UFA_ID"]: leagues.append("UFA")
            if r["PUL_ID"]: leagues.append("PUL")
            if r["WUL_ID"]: leagues.append("WUL")
            if r["International_ID"]: leagues.append("International")
            if _usau_id(r): leagues.append("USAU")
            if not leagues:
                continue  # USAU-only player while USAU is hidden

            team   = r["ufa_team"] or r["pul_team"] or r["wul_team"]
            active = (ufa_ye == max_ufa_year) or (pul_ye is not None and pul_ye >= 2026) or (wul_ye is not None and wul_ye >= 2026)

            players.append({
                "id":             r["ID"],
                "name":           r["Name"],
                "number":         r["jersey_number"],
                "leagues":        leagues,
                "teams":          [team] if team else [],
                "active":         active,
                "yearStart":      y_start,
                "yearEnd":        y_end,
                "photoUrl":       r["photo_url"],
                "ufa_id":         r["UFA_ID"],
                "pul_id":         r["PUL_ID"],
                "wul_id":         r["WUL_ID"],
                "usau_id":        _usau_id(r),
                "internationalId": r["International_ID"],
            })

        total = len(players)
        return {"count": total, "players": players[offset: offset + limit]}


# ── /api/players/random ───────────────────────────────────────────────────────

@app.get("/api/players/random")
def get_random_player():
    """Return one random player with career stat totals for the spotlight widget."""
    with get_db() as conn:
        mp = conn.execute("""
            SELECT mp.*, up.photo_url AS ufa_photo, up.current_team_name, up.most_recent_team_name,
                   up.jersey_number, up.bio_text, up.display_name
            FROM master_players mp
            LEFT JOIN ufa_players up ON up.player_slug = mp.UFA_ID
            WHERE (up.photo_url IS NOT NULL AND up.photo_url NOT LIKE '%no_image%')
               OR mp.PUL_photo_url IS NOT NULL
            ORDER BY RANDOM()
            LIMIT 1
        """).fetchone()

        if not mp:
            raise HTTPException(status_code=404, detail="No players found")

        player_id = mp["ID"]
        ufa_id    = mp["UFA_ID"]

        photo = (mp["ufa_photo"] if mp["ufa_photo"] and "no_image" not in mp["ufa_photo"] else None) or mp["PUL_photo_url"]

        leagues: list[str] = []
        if mp["UFA_ID"]:         leagues.append("UFA")
        if mp["PUL_ID"]:         leagues.append("PUL")
        if mp["WUL_ID"]:         leagues.append("WUL")
        if mp["International_ID"]: leagues.append("International")
        if _usau_id(mp): leagues.append("USAU")

        team = mp["current_team_name"] or mp["most_recent_team_name"]

        career: dict = {}
        seasons: list = []

        # ── UFA (shownspace) ────────────────────────────────────────────────
        if ufa_id:
            row = conn.execute("""
                SELECT
                    COUNT(DISTINCT game_id)  AS gp,
                    SUM(goals)               AS goals,
                    SUM(assists)             AS assists,
                    SUM(blocks)              AS blocks,
                    SUM(throw_attempts)      AS throws,
                    SUM(completions)         AS completions,
                    SUM(throwaways)          AS throwaways,
                    SUM(hucks_thrown)        AS hucks_thrown,
                    SUM(hucks_completed)     AS hucks_completed,
                    SUM(total_aec)           AS total_aec,
                    SUM(o_points_played)     AS o_pts,
                    SUM(d_points_played)     AS d_pts
                FROM shownspace_player_stats
                WHERE player_id = ?
            """, (ufa_id,)).fetchone()
            if row and row["gp"]:
                career = {
                    "gp":              row["gp"],
                    "goals":           row["goals"] or 0,
                    "assists":         row["assists"] or 0,
                    "blocks":          row["blocks"] or 0,
                    "throws":          row["throws"] or 0,
                    "completions":     row["completions"] or 0,
                    "throwaways":      row["throwaways"] or 0,
                    "hucks_thrown":    row["hucks_thrown"] or 0,
                    "hucks_completed": row["hucks_completed"] or 0,
                    "total_aec":       round(row["total_aec"] or 0, 2),
                }

            season_rows = conn.execute("""
                SELECT
                    p.year,
                    COALESCE(t.team_name, p.team_id) AS team_name,
                    COUNT(DISTINCT p.game_id)         AS gp,
                    SUM(p.goals)                      AS goals,
                    SUM(p.assists)                    AS assists,
                    SUM(p.blocks)                     AS blocks,
                    SUM(p.throw_attempts)             AS throws,
                    SUM(p.completions)                AS completions,
                    SUM(p.hucks_thrown)               AS hucks_thrown,
                    SUM(p.total_aec)                  AS total_aec
                FROM shownspace_player_stats p
                LEFT JOIN ufa_teams t ON t.team_slug = p.team_id
                WHERE p.player_id = ?
                GROUP BY p.year
                ORDER BY p.year DESC
                LIMIT 5
            """, (ufa_id,)).fetchall()
            for r in season_rows:
                seasons.append({
                    "league":    "UFA",
                    "year":      r["year"],
                    "team":      r["team_name"],
                    "gp":        r["gp"] or 0,
                    "goals":     r["goals"] or 0,
                    "assists":   r["assists"] or 0,
                    "blocks":    r["blocks"] or 0,
                    "comp_pct":  round((r["completions"] / r["throws"]) * 100, 1) if (r["throws"] or 0) > 0 else None,
                    "hucks":     r["hucks_thrown"] or 0,
                    "aec":       round(r["total_aec"] or 0, 2),
                })

        # ── PUL ─────────────────────────────────────────────────────────────
        pul_id = mp["PUL_ID"]
        if pul_id:
            pul_rows = conn.execute("""
                SELECT season, team, games_played, goals, assists, blocks, turnovers
                FROM pul_player_season_stats
                WHERE player_name = ? AND season != 'career'
                ORDER BY season DESC LIMIT 5
            """, (mp["Name"],)).fetchall()
            for r in pul_rows:
                seasons.append({
                    "league":    "PUL",
                    "year":      r["season"],
                    "team":      r["team"],
                    "gp":        r["games_played"] or 0,
                    "goals":     r["goals"] or 0,
                    "assists":   r["assists"] or 0,
                    "blocks":    r["blocks"] or 0,
                    "comp_pct":  None,
                    "hucks":     None,
                    "aec":       None,
                })

        # ── WUL ─────────────────────────────────────────────────────────────
        wul_id = mp["WUL_ID"]
        if wul_id:
            wul_name = mp["Name"]
            wul_rows = conn.execute("""
                SELECT CAST(SUBSTR(season, 1, 4) AS INTEGER) AS year,
                       team,
                       COUNT(DISTINCT date)  AS gp,
                       ROUND(SUM(g), 0)  AS goals,
                       ROUND(SUM(a), 0)  AS assists,
                       ROUND(SUM(b), 0)  AS blocks
                FROM wul_player_game_stats
                WHERE player = ?
                GROUP BY year, team ORDER BY year DESC LIMIT 5
            """, (wul_name,)).fetchall()
            if not wul_rows:
                wul_display = " ".join(w.capitalize() for w in wul_id.split("-"))
                if wul_display != wul_name:
                    wul_rows = conn.execute("""
                        SELECT CAST(SUBSTR(season, 1, 4) AS INTEGER) AS year,
                               team,
                               COUNT(DISTINCT date)  AS gp,
                               ROUND(SUM(g), 0)  AS goals,
                               ROUND(SUM(a), 0)  AS assists,
                               ROUND(SUM(b), 0)  AS blocks
                        FROM wul_player_game_stats
                        WHERE player = ?
                        GROUP BY year, team ORDER BY year DESC LIMIT 5
                    """, (wul_display,)).fetchall()
            for r in wul_rows:
                seasons.append({
                    "league":    "WUL",
                    "year":      r["year"],
                    "team":      r["team"],
                    "gp":        r["gp"] or 0,
                    "goals":     r["goals"] or 0,
                    "assists":   r["assists"] or 0,
                    "blocks":    r["blocks"] or 0,
                    "comp_pct":  None,
                    "hucks":     None,
                    "aec":       None,
                })

        # sort all seasons newest first
        seasons.sort(key=lambda s: (str(s["year"]) if s["year"] else ""), reverse=True)
        seasons = seasons[:5]

        # ── Career totals fallback for PUL / WUL-only players ───────────────
        if not career:
            pul_id2 = mp["PUL_ID"]
            if pul_id2:
                row = conn.execute("""
                    SELECT COALESCE(SUM(games_played), 0) AS gp,
                           COALESCE(SUM(goals),        0) AS goals,
                           COALESCE(SUM(assists),      0) AS assists,
                           COALESCE(SUM(blocks),       0) AS blocks
                    FROM pul_player_season_stats
                    WHERE player_name = ? AND season != 'career'
                """, (mp["Name"],)).fetchone()
                if row and row["gp"] > 0:
                    career = {
                        "gp": row["gp"], "goals": row["goals"],
                        "assists": row["assists"], "blocks": row["blocks"],
                        "throws": None, "completions": None, "throwaways": None,
                        "hucks_thrown": None, "hucks_completed": None, "total_aec": None,
                    }
            if not career:
                wul_id2 = mp["WUL_ID"]
                if wul_id2:
                    wul_n = mp["Name"]
                    row = conn.execute("""
                        SELECT COUNT(DISTINCT date) AS gp,
                               ROUND(SUM(g), 0) AS goals,
                               ROUND(SUM(a), 0) AS assists,
                               ROUND(SUM(b), 0) AS blocks
                        FROM wul_player_game_stats WHERE player = ?
                    """, (wul_n,)).fetchone()
                    if not (row and row["gp"] and row["gp"] > 0):
                        wul_n = " ".join(w.capitalize() for w in wul_id2.split("-"))
                        row = conn.execute("""
                            SELECT COUNT(DISTINCT date) AS gp,
                                   ROUND(SUM(g), 0) AS goals,
                                   ROUND(SUM(a), 0) AS assists,
                                   ROUND(SUM(b), 0) AS blocks
                            FROM wul_player_game_stats WHERE player = ?
                        """, (wul_n,)).fetchone()
                    if row and row["gp"] and row["gp"] > 0:
                        career = {
                            "gp": row["gp"], "goals": row["goals"],
                            "assists": row["assists"], "blocks": row["blocks"],
                            "throws": None, "completions": None, "throwaways": None,
                            "hucks_thrown": None, "hucks_completed": None, "total_aec": None,
                        }

        return {
            "id":           player_id,
            "name":         mp["display_name"] or mp["Name"],
            "number":       mp["jersey_number"],
            "photo_url":    photo,
            "leagues":      leagues,
            "team":         team,
            "bio":          mp["bio_text"],
            "career":       career,
            "seasons":      seasons,
        }


# ── /api/players/{id} ────────────────────────────────────────────────────────

@app.get("/api/players/{player_id}")
def get_player_master(player_id: str):
    with get_db() as conn:
        mp = conn.execute(
            "SELECT * FROM master_players WHERE ID = ?", (player_id,)
        ).fetchone()

        if not mp:
            raise HTTPException(status_code=404, detail="Player not found")

        player: dict = {
            "id":         mp["ID"],
            "name":       mp["Name"],
            "first_name": mp["FirstName"],
            "last_name":  mp["LastName"],
            "ufa_id":     mp["UFA_ID"],
            "pul_id":     mp["PUL_ID"],
            "wul_id":     mp["WUL_ID"],
            "usau_id":    _usau_id(mp),
            "photo_url":  mp["PUL_photo_url"] if not mp["UFA_ID"] else None,
        }

        ufa_stats:    list = []
        pul_stats:    list = []
        wul_stats:    list = []
        usau_history: list = []

        if mp["UFA_ID"]:
            ufa_row = conn.execute(
                "SELECT * FROM ufa_players WHERE player_slug = ?", (mp["UFA_ID"],)
            ).fetchone()
            if ufa_row:
                ufa_photo = ufa_row["photo_url"]
                if ufa_photo and "no_image" in ufa_photo:
                    ufa_photo = None
                player.update({
                    "display_name":           ufa_row["display_name"],
                    "jersey_number":          ufa_row["jersey_number"],
                    "photo_url":              ufa_photo or mp["PUL_photo_url"],
                    "current_team_name":      ufa_row["current_team_name"] or ufa_row["most_recent_team_name"],
                    "current_team_slug":      dict(ufa_row).get("current_team_slug") or dict(ufa_row).get("most_recent_team_slug"),
                    "most_recent_team_year":  dict(ufa_row).get("most_recent_team_year"),
                    "player_slug":            ufa_row["player_slug"],
                    "bio_text":               dict(ufa_row).get("bio_text"),
                })
            ufa_stats = [
                dict(s) for s in conn.execute(
                    """SELECT s.*, t.team_name
                       FROM ufa_player_season_stats s
                       LEFT JOIN ufa_teams t ON t.team_slug = s.team_id
                       WHERE s.player_id = ? ORDER BY s.year""",
                    (mp["UFA_ID"],),
                ).fetchall()
            ]

        if mp["PUL_ID"]:
            pul_stats = [
                dict(s) for s in conn.execute(
                    """SELECT * FROM pul_player_season_stats
                       WHERE player_name = ? ORDER BY
                       CASE season WHEN 'career' THEN '9999' ELSE season END""",
                    (mp["Name"],),
                ).fetchall()
            ]

        if mp["WUL_ID"]:
            _WUL_AGG = """
                SELECT
                    CAST(SUBSTR(season, 1, 4) AS INTEGER) AS year,
                    team,
                    COUNT(DISTINCT date) AS games_played,
                    ROUND(SUM(g),    0) AS g,
                    ROUND(SUM(a),    0) AS a,
                    ROUND(SUM(b),    0) AS b,
                    ROUND(SUM(th),   0) AS th,
                    ROUND(SUM(ther), 0) AS ther,
                    ROUND(SUM(thy),  0) AS thy,
                    ROUND(SUM(recy), 0) AS recy
                FROM wul_player_game_stats
                WHERE player = ?
                GROUP BY year, team
                ORDER BY year
            """
            wul_rows = conn.execute(_WUL_AGG, (mp["Name"],)).fetchall()
            wul_stats = [dict(r) for r in wul_rows]
            # Handle alias cases where WUL display name differs from master name
            if not wul_stats:
                wul_name_from_slug = " ".join(w.capitalize() for w in mp["WUL_ID"].split("-"))
                if wul_name_from_slug != mp["Name"]:
                    wul_rows2 = conn.execute(_WUL_AGG, (wul_name_from_slug,)).fetchall()
                    wul_stats = [dict(r) for r in wul_rows2]

        international: list = []
        intl_id = dict(mp).get("International_ID")

        usau_id = _usau_id(mp)
        if usau_id:
            usau_history = [
                dict(r) for r in conn.execute(
                    """SELECT DISTINCT
                           e.season_year        AS year,
                           ut.team_name,
                           ut.competition_level,
                           ut.gender_division,
                           ut.city,
                           ut.state,
                           ut.usau_team_id,
                           ut.logo_filename
                       FROM usau_player_ids uid
                       JOIN players p       ON p.player_name   = uid.player_name COLLATE NOCASE
                                           AND p.jersey_number = uid.jersey_number
                       JOIN usau_event_teams et ON et.event_team_id = p.event_team_id
                                               AND et.event_slug    = p.event_slug
                       JOIN usau_teams ut   ON ut.usau_team_id = et.usau_team_id
                       JOIN events e        ON e.event_slug    = p.event_slug
                       WHERE uid.usau_player_id = ?
                       ORDER BY year, ut.team_name""",
                    (usau_id,),
                ).fetchall()
            ]

        if intl_id:
            rows = conn.execute(
                """SELECT
                       t.tournament_key, t.event_type, t.division, t.year,
                       t.location, t.finish,
                       t.wins, t.losses,
                       r.role,
                       GROUP_CONCAT(
                           g.round || '|' || g.opponent || '|' ||
                           g.usa_score || '|' || g.opp_score || '|' || g.result,
                           '~'
                       ) AS games_concat
                   FROM international_roster r
                   JOIN international_tournaments t ON t.id = r.tournament_id
                   LEFT JOIN international_games g  ON g.tournament_id = t.id
                   WHERE r.canonical_id = ?
                   GROUP BY t.id
                   ORDER BY t.year DESC, t.tournament_key""",
                (intl_id,),
            ).fetchall()
            for row in rows:
                games = []
                if row["games_concat"]:
                    for entry in row["games_concat"].split("~"):
                        parts = entry.split("|")
                        if len(parts) == 5:
                            games.append({
                                "round":     parts[0],
                                "opponent":  parts[1],
                                "usa_score": int(parts[2]) if parts[2].isdigit() else None,
                                "opp_score": int(parts[3]) if parts[3].isdigit() else None,
                                "result":    parts[4],
                            })
                international.append({
                    "tournament_key": row["tournament_key"],
                    "event_type":     row["event_type"],
                    "division":       row["division"],
                    "year":           row["year"],
                    "location":       row["location"],
                    "finish":         row["finish"],
                    "wins":           row["wins"],
                    "losses":         row["losses"],
                    "role":           row["role"],
                    "games":          games,
                })

        return {"player": player, "ufaStats": ufa_stats, "pulStats": pul_stats, "wulStats": wul_stats, "usauHistory": usau_history, "international": international}


# ── /api/players/{id}/usau_season_stats ──────────────────────────────────────

@app.get("/api/players/{player_id}/usau_season_stats")
def get_player_usau_season_stats(player_id: str):
    """Aggregate per-season USAU nationals stats (G, A, D, T) from match reports."""
    with get_db() as conn:
        mp = conn.execute(
            "SELECT USAU_ID FROM master_players WHERE ID = ?", (player_id,)
        ).fetchone()
        if not mp or not mp["USAU_ID"]:
            return {"seasons": [], "career": None}

        usau_id = mp["USAU_ID"]

        rows = conn.execute("""
            SELECT
                e.season_year                              AS year,
                CASE
                    WHEN et.competition_level = 'College'  THEN 'College'
                    WHEN et.competition_level = 'Club'     THEN 'Club'
                    WHEN g.event_slug LIKE '%College%'     THEN 'College'
                    WHEN g.event_slug LIKE '%college%'     THEN 'College'
                    ELSE 'Club'
                END                                        AS level,
                COUNT(DISTINCT ns.event_game_id)           AS gp,
                COALESCE(SUM(ns.goals),     0)             AS goals,
                COALESCE(SUM(ns.assists),   0)             AS assists,
                COALESCE(SUM(ns.ds),        0)             AS blocks,
                COALESCE(SUM(ns.turns),     0)             AS throwaways
            FROM usau_nationals_player_stats ns
            JOIN games g              ON g.event_game_id  = ns.event_game_id
            JOIN (SELECT event_slug, season_year FROM events GROUP BY event_slug) e
                                      ON e.event_slug     = g.event_slug
            JOIN usau_event_teams et  ON et.event_team_id = ns.event_team_id
            WHERE ns.player_name COLLATE NOCASE IN (
                SELECT player_name FROM usau_player_ids WHERE usau_player_id = ?
            )
            AND (et.competition_level IN ('Club', 'College')
                 OR et.competition_level IS NULL
                 OR et.competition_level = '')
            GROUP BY e.season_year, level
            ORDER BY e.season_year, level
        """, (usau_id,)).fetchall()

        seasons = [dict(r) for r in rows]

        if seasons:
            career = {
                "year":       "Career",
                "level":      None,
                "gp":         sum(r["gp"]         for r in seasons),
                "goals":      sum(r["goals"]       for r in seasons),
                "assists":    sum(r["assists"]      for r in seasons),
                "blocks":     sum(r["blocks"]       for r in seasons),
                "throwaways": sum(r["throwaways"]   for r in seasons),
            }
        else:
            career = None

        return {"seasons": seasons, "career": career}


# ── /api/players/{id}/videos ─────────────────────────────────────────────────

@app.get("/api/players/{player_id}/videos")
def get_player_videos(player_id: str):
    with get_db() as conn:
        mp = conn.execute(
            "SELECT USAU_ID FROM master_players WHERE ID = ?", (player_id,)
        ).fetchone()
        if not mp or not mp["USAU_ID"]:
            return {"videos": []}
        rows = conn.execute(
            """SELECT usau_id, award, year, nomination_video_url
               FROM usau_nomination_videos
               WHERE usau_id = ?
               ORDER BY year DESC""",
            (mp["USAU_ID"],),
        ).fetchall()
        return {"videos": [dict(r) for r in rows]}


# ── /api/players/{id}/accolades ──────────────────────────────────────────────

@app.get("/api/players/{player_id}/accolades")
def get_player_accolades(player_id: str):
    with get_db() as conn:
        rows = conn.execute(
            """SELECT year, league, accolade, awarding_body, award_url, team_id, gender, division
               FROM accolades
               WHERE id = ? AND (? OR league != 'USAU')
               ORDER BY year DESC, awarding_body, accolade""",
            (player_id, ENABLE_USAU),
        ).fetchall()
        return {"accolades": [dict(r) for r in rows]}


# ── /api/usau/rankings ────────────────────────────────────────────────────────

@app.get("/api/usau/rankings/options")
def get_usau_rankings_options(division: str = Query(...)):
    """Return available season years and gender divisions for rankings."""
    level = "Club" if division.lower() == "club" else "College"
    with get_db() as conn:
        rows = conn.execute("""
            SELECT DISTINCT e.season_year, et.gender_division
            FROM usau_event_teams et
            JOIN events e ON e.event_slug = et.event_slug
            WHERE et.competition_level = ?
              AND et.gender_division IS NOT NULL
              AND et.gender_division != ''
              AND e.season_year IS NOT NULL
            ORDER BY e.season_year DESC, et.gender_division
        """, (level,)).fetchall()

    years_set: set = set()
    genders_by_year: dict = {}
    for r in rows:
        yr = r["season_year"]
        gd = r["gender_division"]
        years_set.add(yr)
        genders_by_year.setdefault(yr, [])
        if gd not in genders_by_year[yr]:
            genders_by_year[yr].append(gd)

    gender_order = ["Men", "Women", "Mixed", "Boys", "Girls"]
    for yr in genders_by_year:
        genders_by_year[yr].sort(
            key=lambda g: gender_order.index(g) if g in gender_order else 99
        )

    years = sorted(years_set, reverse=True)
    return {"years": years, "genders": {str(k): v for k, v in genders_by_year.items()}}


@app.get("/api/usau/rankings/games")
def get_usau_rankings_games(
    division: str = Query(...),
    year:     int = Query(...),
    gender:   str = Query(...),
):
    """Return all scored games for a given division/year/gender for client-side rankings."""
    from datetime import datetime as _dt
    level = "Club" if division.lower() == "club" else "College"

    with get_db() as conn:
        # All event_team_ids matching this division / year / gender
        et_rows = conn.execute("""
            SELECT et.event_team_id,
                   COALESCE(
                       ut.team_name || COALESCE(' ' || ut.b_team_suffix, ''),
                       et.team_name
                   ) AS display_name,
                   COALESCE(et.usau_team_id, et.event_team_id) AS group_id
            FROM usau_event_teams et
            JOIN events e ON e.event_slug = et.event_slug
            LEFT JOIN usau_teams ut ON ut.usau_team_id = et.usau_team_id
            WHERE e.season_year = ?
              AND et.competition_level = ?
              AND et.gender_division   = ?
              AND et.team_name != ''
        """, (year, level, gender)).fetchall()

        if not et_rows:
            return {"games": [], "seasonYear": year, "lastRegularWeek": 1}

        # Build event_team_id → canonical group + display name
        et_to_group: dict = {}
        group_to_name: dict = {}
        for r in et_rows:
            et_to_group[r["event_team_id"]] = r["group_id"]
            gid = r["group_id"]
            if gid not in group_to_name:
                group_to_name[gid] = r["display_name"]

        et_ids = list(et_to_group.keys())
        if not et_ids:
            return {"games": [], "seasonYear": year, "lastRegularWeek": 1}

        ph = ",".join("?" * len(et_ids))
        game_rows = conn.execute(f"""
            SELECT event_game_id, home_event_team_id, away_event_team_id,
                   home_score, away_score, game_date
            FROM games
            WHERE home_event_team_id IN ({ph})
              AND away_event_team_id IN ({ph})
              AND home_score IS NOT NULL
              AND away_score IS NOT NULL
              AND home_score != away_score
        """, et_ids + et_ids).fetchall()

    if not game_rows:
        return {"games": [], "seasonYear": year, "lastRegularWeek": 1}

    # Compute lastRegularWeek: last week (from Jan 1) of the latest non-conf/regional/sectional/national event
    season_start = _dt(year, 1, 1)
    with get_db() as conn2:
        reg_row = conn2.execute("""
            SELECT MAX(date_end) AS last_regular_end
            FROM events
            WHERE season_year = ?
              AND competition_level LIKE ?
              AND event_title NOT LIKE '%Regional%'
              AND event_title NOT LIKE '%Conference%'
              AND event_title NOT LIKE '%Sectional%'
              AND event_title NOT LIKE '%National%'
              AND event_title NOT LIKE '%-cancelled%'
              AND event_title NOT LIKE '%cancelled-%'
              AND LOWER(event_title) NOT LIKE '%cancel%'
        """, (year, f"%{level}%")).fetchone()
    last_regular_end = reg_row["last_regular_end"] if reg_row else None
    if last_regular_end:
        for fmt in ("%Y-%m-%d", "%m/%d/%Y"):
            try:
                last_reg_dt = _dt.strptime(last_regular_end.strip(), fmt)
                break
            except ValueError:
                last_reg_dt = None
        days_to_last = (last_reg_dt - season_start).days if last_reg_dt else 0
        last_regular_week = max(1, (days_to_last // 7) + 1)
    else:
        last_regular_week = 1

    games_out = []
    for r in game_rows:
        home_group = et_to_group.get(r["home_event_team_id"])
        away_group = et_to_group.get(r["away_event_team_id"])
        if not home_group or not away_group or home_group == away_group:
            continue

        home_name = group_to_name.get(home_group, r["home_event_team_id"])
        away_name = group_to_name.get(away_group, r["away_event_team_id"])
        hs, as_ = r["home_score"], r["away_score"]

        if hs > as_:
            w_team, w_score, l_team, l_score = home_name, hs, away_name, as_
        else:
            w_team, w_score, l_team, l_score = away_name, as_, home_name, hs

        games_out.append({
            "id":          r["event_game_id"],
            "winnerTeam":  w_team,
            "loserTeam":   l_team,
            "winnerScore": w_score,
            "loserScore":  l_score,
            "gameDate":    r["game_date"] or "",
        })

    return {"games": games_out, "seasonYear": year, "lastRegularWeek": last_regular_week}


# ── /api/usau/programs ────────────────────────────────────────────────────────

@app.get("/api/usau/programs")
def list_usau_programs(
    q:      str | None  = Query(None),
    level:  List[str]   = Query(default=[]),
    region: str | None  = Query(None),
    limit:  int         = Query(100, le=500),
    offset: int         = Query(0, ge=0),
):
    with get_db() as conn:
        where = []
        params: list = []
        if q:
            where.append("(p.canonical_name LIKE ? OR p.short_name LIKE ? OR p.city LIKE ? OR p.state LIKE ?)")
            like = f"%{q}%"
            params += [like, like, like, like]
        if level:
            placeholders = ','.join('?' * len(level))
            where.append(f"p.competition_level IN ({placeholders})")
            params += level
        if region:
            # For Kansas club programs, cities in KC/Topeka/Lawrence → North Central; rest → South Central
            # For Ontario college programs, Toronto/Ottawa/London → Metro East; rest → North Central
            # Michigan Upper Peninsula → North Central (all levels)
            where.append("""
                (
                  CASE
                    WHEN p.state = 'Michigan'
                         AND p.city IN ('Houghton','Hancock','Marquette','Sault Ste. Marie',
                                        'Escanaba','Iron Mountain','Ironwood','Menominee',
                                        'Calumet','Munising','Newberry','St. Ignace',
                                        'Gladstone','Ishpeming','Negaunee','Gwinn',
                                        'Crystal Falls','Iron River','Wakefield','Bessemer',
                                        'Ontonagon','Baraga')
                      THEN 'North Central'
                    WHEN p.state = 'Kansas' AND p.competition_level = 'Club'
                         AND p.city IN ('Kansas City', 'Topeka', 'Lawrence')
                      THEN 'North Central'
                    WHEN p.state = 'Kansas' AND p.competition_level = 'Club'
                      THEN 'South Central'
                    WHEN p.state = 'Ontario'
                         AND p.competition_level NOT IN ('Club', 'Youth Club U-20')
                         AND p.city IN ('Toronto', 'Ottawa', 'London')
                      THEN 'Metro East'
                    WHEN p.competition_level IN ('Club', 'Youth Club U-20')
                      THEN (SELECT r.club_region FROM usau_regions r WHERE r.state = p.state)
                    ELSE
                      (SELECT r.college_region FROM usau_regions r WHERE r.state = p.state)
                  END
                ) = ?
            """)
            params.append(region)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        rows = conn.execute(f"""
            SELECT
                p.*,
                COUNT(DISTINCT t.usau_team_id) AS team_count,
                n.natl_breakdown,
                CASE
                  WHEN p.state = 'Michigan'
                       AND p.city IN ('Houghton','Hancock','Marquette','Sault Ste. Marie',
                                      'Escanaba','Iron Mountain','Ironwood','Menominee',
                                      'Calumet','Munising','Newberry','St. Ignace',
                                      'Gladstone','Ishpeming','Negaunee','Gwinn',
                                      'Crystal Falls','Iron River','Wakefield','Bessemer',
                                      'Ontonagon','Baraga')
                    THEN 'North Central'
                  WHEN p.state = 'Kansas' AND p.competition_level = 'Club'
                       AND p.city IN ('Kansas City', 'Topeka', 'Lawrence')
                    THEN 'North Central'
                  WHEN p.state = 'Kansas' AND p.competition_level = 'Club'
                    THEN 'South Central'
                  WHEN p.state = 'Ontario'
                       AND p.competition_level NOT IN ('Club', 'Youth Club U-20')
                       AND p.city IN ('Toronto', 'Ottawa', 'London')
                    THEN 'Metro East'
                  WHEN p.competition_level IN ('Club', 'Youth Club U-20')
                    THEN (SELECT r.club_region FROM usau_regions r WHERE r.state = p.state)
                  ELSE
                    (SELECT r.college_region FROM usau_regions r WHERE r.state = p.state)
                END AS effective_region,
                gc.gender_codes,
                ndl.natl_div_levels,
                COALESCE(
                    MAX(CASE WHEN t.logo_filename LIKE '%.png' OR t.logo_filename LIKE '%.webp' THEN t.logo_filename END),
                    el.event_logo
                ) AS team_logo_filename
            FROM usau_programs p
            LEFT JOIN usau_teams t ON t.program_id = p.program_id
            LEFT JOIN (
                SELECT et.city, et.state, et.competition_level,
                       MIN(CASE WHEN t2.logo_filename LIKE '%.png' OR t2.logo_filename LIKE '%.webp' THEN t2.logo_filename END) AS event_logo
                FROM usau_event_teams et
                JOIN usau_teams t2 ON t2.usau_team_id = et.usau_team_id
                WHERE t2.logo_filename IS NOT NULL
                GROUP BY et.city, et.state, et.competition_level
            ) el ON el.city = p.city AND el.state = p.state AND el.competition_level = p.competition_level
            LEFT JOIN (
                SELECT program_id,
                       json_group_array(json_object('g', gender, 'd', division, 'a', appearances, 't', titles, 'r', runner_ups, 'sf', semis, 'ly', last_title_yr, 'ry', last_runner_up_yr, 'sy', last_semi_yr, 'ay', last_app_yr)) AS natl_breakdown
                FROM (
                    SELECT ut.program_id,
                           COALESCE(un.gender, '')   AS gender,
                           COALESCE(un.division, '') AS division,
                           COUNT(*)                                                        AS appearances,
                           SUM(CASE WHEN un.finish = '01' THEN 1 ELSE 0 END)              AS titles,
                           SUM(CASE WHEN un.finish = '02' THEN 1 ELSE 0 END)              AS runner_ups,
                           SUM(CASE WHEN un.finish IN ('01','02','03','04','T3') THEN 1 ELSE 0 END) AS semis,
                           MAX(CASE WHEN un.finish = '01' THEN un.year ELSE NULL END)     AS last_title_yr,
                           MAX(CASE WHEN un.finish = '02' THEN un.year ELSE NULL END)     AS last_runner_up_yr,
                           MAX(CASE WHEN un.finish IN ('01','02','03','04','T3') THEN un.year ELSE NULL END) AS last_semi_yr,
                           MAX(un.year)                                                   AS last_app_yr
                    FROM usau_nationals un
                    JOIN usau_teams ut ON ut.usau_team_id = un.usau_team_id
                    GROUP BY ut.program_id, COALESCE(un.gender, ''), COALESCE(un.division, '')
                )
                GROUP BY program_id
            ) n ON n.program_id = p.program_id
            LEFT JOIN (
                SELECT program_id, GROUP_CONCAT(DISTINCT gender_code) AS gender_codes
                FROM usau_teams
                GROUP BY program_id
            ) gc ON gc.program_id = p.program_id
            LEFT JOIN (
                SELECT ut.program_id, GROUP_CONCAT(DISTINCT un.division) AS natl_div_levels
                FROM usau_nationals un
                JOIN usau_teams ut ON ut.usau_team_id = un.usau_team_id
                WHERE un.division IS NOT NULL AND un.division != ''
                GROUP BY ut.program_id
            ) ndl ON ndl.program_id = p.program_id
            {where_sql}
            GROUP BY p.program_id
            ORDER BY p.canonical_name COLLATE NOCASE
            LIMIT ? OFFSET ?
        """, params + [limit, offset]).fetchall()
        total = conn.execute(
            f"SELECT COUNT(*) FROM usau_programs p {where_sql}", params
        ).fetchone()[0]
        return {"count": total, "programs": [dict(r) for r in rows]}


@app.get("/api/usau/programs/{program_id}")
def get_usau_program(program_id: str):
    with get_db() as conn:
        prog = conn.execute(
            "SELECT * FROM usau_programs WHERE program_id = ?", (program_id,)
        ).fetchone()
        if not prog:
            raise HTTPException(status_code=404, detail="Program not found")

        teams = conn.execute("""
            SELECT
                t.*,
                COUNT(DISTINCT et.event_team_id) AS event_appearances,
                MIN(e.season_year)               AS first_year,
                MAX(e.season_year)               AS last_year
            FROM usau_teams t
            LEFT JOIN usau_event_teams et ON et.usau_team_id = t.usau_team_id
            LEFT JOIN events e            ON e.event_slug    = et.event_slug
            WHERE t.program_id = ?
            GROUP BY t.usau_team_id
            ORDER BY t.gender_division, t.is_b_team, t.team_name
        """, (program_id,)).fetchall()

        # All events this program has appeared in
        events = conn.execute("""
            SELECT DISTINCT
                e.event_slug, e.event_title, e.season_year,
                e.competition_level, e.gender, e.city, e.state,
                e.date_start, e.date_end
            FROM events e
            JOIN usau_event_teams et ON et.event_slug = e.event_slug
            JOIN usau_teams t        ON t.usau_team_id = et.usau_team_id
            WHERE t.program_id = ?
            ORDER BY e.season_year DESC, e.event_title
        """, (program_id,)).fetchall()

        # Players ever on a team in this program
        players = conn.execute("""
            SELECT DISTINCT
                uid.usau_player_id,
                p.player_name,
                p.jersey_number,
                t.team_name,
                t.gender_division,
                e.season_year
            FROM usau_teams t
            JOIN usau_event_teams et ON et.usau_team_id = t.usau_team_id
            JOIN players p           ON p.event_team_id = et.event_team_id
                                    AND p.event_slug    = et.event_slug
            LEFT JOIN usau_player_ids uid ON uid.player_name = p.player_name COLLATE NOCASE
                                         AND uid.jersey_number = p.jersey_number
            JOIN events e            ON e.event_slug = p.event_slug
            WHERE t.program_id = ?
            ORDER BY e.season_year DESC, p.player_name COLLATE NOCASE
        """, (program_id,)).fetchall()

        return {
            "program": dict(prog),
            "teams":   [dict(t) for t in teams],
            "events":  [dict(e) for e in events],
            "players": [dict(p) for p in players],
            "natl_appearances": conn.execute("""
                SELECT COUNT(*) FROM usau_nationals un
                JOIN usau_teams ut ON ut.usau_team_id = un.usau_team_id
                WHERE ut.program_id = ?
            """, (program_id,)).fetchone()[0],
            "natl_titles": conn.execute("""
                SELECT COUNT(*) FROM usau_nationals un
                JOIN usau_teams ut ON ut.usau_team_id = un.usau_team_id
                WHERE ut.program_id = ? AND un.finish = '01'
            """, (program_id,)).fetchone()[0],
        }


# ── /api/usau/teams/{team_id}/seasons ────────────────────────────────────────

@app.get("/api/usau/teams/{team_id}/seasons")
def get_usau_team_seasons(team_id: str):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT DISTINCT e.season_year
            FROM usau_event_teams et
            JOIN events e ON e.event_slug = et.event_slug
            WHERE et.usau_team_id = ?
              AND e.season_year IS NOT NULL
            ORDER BY e.season_year DESC
        """, (team_id,)).fetchall()
        return [r[0] for r in rows]


# ── /api/usau/teams/{team_id}/season/{year} ───────────────────────────────────

@app.get("/api/usau/teams/{team_id}/season/{year}")
def get_usau_team_season(team_id: str, year: int):
    with get_db() as conn:
        # All event_team_ids for this team in this season
        et_rows = conn.execute("""
            SELECT et.event_team_id, e.event_slug, e.event_title,
                   e.date_start, e.date_end, e.city, e.state
            FROM usau_event_teams et
            JOIN events e ON e.event_slug = et.event_slug
            WHERE et.usau_team_id = ? AND e.season_year = ?
        """, (team_id, year)).fetchall()

        et_id_set = {r[0] for r in et_rows}

        # Games where this team appeared (home or away), scores complete
        games = conn.execute("""
            SELECT home_event_team_id, away_event_team_id,
                   home_score, away_score
            FROM games
            WHERE (home_event_team_id IN ({placeholders})
                OR away_event_team_id IN ({placeholders}))
              AND home_score IS NOT NULL
              AND away_score IS NOT NULL
        """.format(placeholders=','.join('?' * len(et_id_set))),
            list(et_id_set) + list(et_id_set)
        ).fetchall()

        wins = losses = ties = 0
        pf = pa = 0
        for home_et, away_et, hs, as_ in games:
            if home_et in et_id_set:
                ts, os = hs, as_
            else:
                ts, os = as_, hs
            pf += ts; pa += os
            if ts > os:   wins   += 1
            elif ts < os: losses += 1
            else:         ties   += 1

        played = wins + losses + ties
        win_pct = round(wins / played, 4) if played else None
        pt_diff = pf - pa if played else None
        pyth = round(pf**2 / (pf**2 + pa**2), 4) if (pf + pa) > 0 else None

        # Build a map of event_slug → our event_team_ids for that event
        slug_to_our_etids = {}
        for r in et_rows:
            slug = r[1]
            etid = r[0]
            slug_to_our_etids.setdefault(slug, set()).add(etid)

        # Tournaments (distinct events) with per-game breakdown, sorted newest first
        tournaments = []
        seen_slugs = set()
        for r in et_rows:
            slug = r[1]
            if slug in seen_slugs:
                continue
            seen_slugs.add(slug)

            our_etids = slug_to_our_etids[slug]
            ph = ','.join('?' * len(our_etids))
            game_rows = conn.execute(f"""
                SELECT g.home_event_team_id, g.away_event_team_id,
                       g.home_score, g.away_score,
                       g.game_date, g.game_time,
                       h.team_name, a.team_name
                FROM games g
                JOIN usau_event_teams h ON h.event_team_id = g.home_event_team_id
                JOIN usau_event_teams a ON a.event_team_id = g.away_event_team_id
                WHERE g.event_slug = ?
                  AND (g.home_event_team_id IN ({ph})
                    OR g.away_event_team_id IN ({ph}))
                  AND g.home_score IS NOT NULL
                  AND g.away_score IS NOT NULL
                ORDER BY
                    SUBSTR(g.game_date, 7, 4) || SUBSTR(g.game_date, 1, 2) || SUBSTR(g.game_date, 4, 2),
                    g.game_time
            """, [slug] + list(our_etids) + list(our_etids)).fetchall()

            games_out = []
            for home_et, away_et, hs, as_, gdate, gtime, hname, aname in game_rows:
                if home_et in our_etids:
                    our_name, our_score, opp_name, opp_score = hname, hs, aname, as_
                else:
                    our_name, our_score, opp_name, opp_score = aname, as_, hname, hs
                games_out.append({
                    "our_name":   our_name,
                    "our_score":  our_score,
                    "opp_name":   opp_name,
                    "opp_score":  opp_score,
                    "game_date":  gdate,
                    "game_time":  gtime,
                })

            tournaments.append({
                "event_slug":  slug,
                "event_title": r[2],
                "date_start":  r[3],
                "date_end":    r[4],
                "city":        r[5],
                "state":       r[6],
                "games":       games_out,
            })

        # Sort tournaments newest first
        tournaments.sort(key=lambda t: t["date_start"] or "", reverse=True)

        # Roster for this season
        roster_raw = conn.execute("""
            SELECT DISTINCT
                p.player_name,
                p.jersey_number,
                COALESCE(p.usau_player_id, uid.usau_player_id) AS resolved_usau_id,
                mp.ID AS master_id
            FROM usau_event_teams et
            JOIN players p ON p.event_team_id = et.event_team_id
                           AND p.event_slug   = et.event_slug
            LEFT JOIN usau_player_ids uid
                   ON p.usau_player_id IS NULL
                  AND uid.player_name    = p.player_name    COLLATE NOCASE
                  AND uid.jersey_number  = p.jersey_number
            LEFT JOIN master_players mp
                   ON mp.USAU_ID = COALESCE(p.usau_player_id, uid.usau_player_id)
            WHERE et.usau_team_id = ?
              AND et.event_slug IN (
                  SELECT event_slug FROM events
                  WHERE season_year = ?
              )
            ORDER BY p.player_name COLLATE NOCASE
        """, (team_id, year)).fetchall()

        # Deduplicate by name, picking the best jersey number
        def _jersey_score(j):
            if j is None:
                return 0
            stripped = j.lstrip('0') or '0'
            if stripped == '0':
                return 1   # literally zero
            if j != stripped:
                return 2   # has leading zero
            return 3       # clean number

        seen = {}
        for name, jersey, pid, master_id in roster_raw:
            key = name.lower() if name else ''
            score = _jersey_score(jersey)
            if key not in seen:
                seen[key] = (name, jersey, pid, master_id, score)
            else:
                cur = seen[key]
                better_jersey = score > cur[4]
                same_jersey   = score == cur[4]
                better_pid    = pid is not None and cur[2] is None
                if better_jersey or (same_jersey and better_pid):
                    seen[key] = (name, jersey, pid, master_id, score)

        roster = [{"player_name": v[0], "jersey_number": v[1], "usau_player_id": v[2], "master_id": v[3]}
                  for v in seen.values()]

        return {
            "year":         year,
            "wins":         wins,
            "losses":       losses,
            "ties":         ties,
            "points_for":   pf,
            "points_against": pa,
            "win_pct":      win_pct,
            "point_diff":   pt_diff,
            "pythagorean":  pyth,
            "tournaments":  tournaments,
            "roster":       roster,
        }


# ── /api/usau/teams/{team_id}/history ────────────────────────────────────────

@app.get("/api/usau/teams/{team_id}/history")
def get_usau_team_history(team_id: str, extra_ids: str | None = Query(None)):
    with get_db() as conn:
        # Build the full list of team_ids to aggregate
        all_team_ids = [team_id]
        if extra_ids:
            all_team_ids += [tid.strip() for tid in extra_ids.split(',') if tid.strip()]
        all_team_ids = list(dict.fromkeys(all_team_ids))  # dedupe, preserve order

        # All event_team_ids for all requested teams (all seasons)
        tid_ph = ','.join('?' * len(all_team_ids))
        et_rows = conn.execute(f"""
            SELECT et.event_team_id, e.season_year
            FROM usau_event_teams et
            JOIN events e ON e.event_slug = et.event_slug
            WHERE et.usau_team_id IN ({tid_ph})
        """, all_team_ids).fetchall()

        our_etids = [r[0] for r in et_rows]
        if not our_etids:
            return {
                "wins": 0, "losses": 0, "ties": 0, "win_pct": None,
                "points_for": 0, "points_against": 0, "point_diff": 0,
                "pythagorean": None, "first_season": None, "last_season": None,
                "seasons_played": 0, "seasons": [], "rivals": [],
            }

        # etid → season_year
        etid_to_year = {r[0]: r[1] for r in et_rows}
        our_etid_set = set(our_etids)
        ph = ','.join('?' * len(our_etids))

        # All games for this team
        game_rows = conn.execute(f"""
            SELECT home_event_team_id, away_event_team_id, home_score, away_score
            FROM games
            WHERE (home_event_team_id IN ({ph}) OR away_event_team_id IN ({ph}))
              AND home_score IS NOT NULL AND away_score IS NOT NULL
        """, our_etids + our_etids).fetchall()

        # Overall stats + per-season breakdown
        season_stats: dict = {}
        wins = losses = ties = pf = pa = 0

        for home_et, away_et, hs, as_ in game_rows:
            if home_et in our_etid_set:
                ts, os_, our_et = hs, as_, home_et
            else:
                ts, os_, our_et = as_, hs, away_et
            pf += ts; pa += os_
            if ts > os_:   wins   += 1
            elif ts < os_: losses += 1
            else:          ties   += 1

            yr = etid_to_year.get(our_et)
            if yr is not None:
                if yr not in season_stats:
                    season_stats[yr] = {"year": yr, "wins": 0, "losses": 0, "ties": 0,
                                        "points_for": 0, "points_against": 0}
                s = season_stats[yr]
                s["points_for"] += ts; s["points_against"] += os_
                if ts > os_:   s["wins"]   += 1
                elif ts < os_: s["losses"] += 1
                else:          s["ties"]   += 1

        played = wins + losses + ties
        win_pct = round(wins / played, 4) if played else None
        pt_diff = pf - pa if played else None
        pyth = round(pf**2 / (pf**2 + pa**2), 4) if (pf + pa) > 0 else None

        seasons_list = sorted(season_stats.values(), key=lambda s: s["year"], reverse=True)
        for s in seasons_list:
            gp = s["wins"] + s["losses"] + s["ties"]
            s["win_pct"] = round(s["wins"] / gp, 4) if gp else None
            s["point_diff"] = s["points_for"] - s["points_against"]

        all_years = sorted(season_stats.keys())
        first_season = all_years[0] if all_years else None
        last_season  = all_years[-1] if all_years else None

        # Home program region
        home_region_row = conn.execute("""
            SELECT CASE
                        WHEN p.state = 'Michigan'
                             AND p.city IN ('Houghton','Hancock','Marquette','Sault Ste. Marie',
                                            'Escanaba','Iron Mountain','Ironwood','Menominee',
                                            'Calumet','Munising','Newberry','St. Ignace',
                                            'Gladstone','Ishpeming','Negaunee','Gwinn',
                                            'Crystal Falls','Iron River','Wakefield','Bessemer',
                                            'Ontonagon','Baraga')
                        THEN 'North Central'
                        WHEN p.competition_level = 'Club'
                        THEN (SELECT r.club_region    FROM usau_regions r WHERE r.state = p.state)
                        WHEN p.state = 'Ontario' AND p.city IN ('Toronto', 'Ottawa', 'London')
                        THEN 'Metro East'
                        ELSE (SELECT r.college_region FROM usau_regions r WHERE r.state = p.state)
                   END
            FROM usau_teams ut
            JOIN usau_programs p ON p.program_id = ut.program_id
            WHERE ut.usau_team_id = ?
            LIMIT 1
        """, [team_id]).fetchone()
        home_region = home_region_row[0] if home_region_row else None

        # Rivals: fetch individual games with date so we can compute first/last/streak
        rival_games_detailed = conn.execute(f"""
            SELECT
                CASE WHEN home_event_team_id IN ({ph}) THEN away_event_team_id
                     ELSE home_event_team_id END AS opp_etid,
                CASE WHEN home_event_team_id IN ({ph}) THEN home_score ELSE away_score END AS our_score,
                CASE WHEN home_event_team_id IN ({ph}) THEN away_score ELSE home_score END AS opp_score,
                game_date
            FROM games
            WHERE (home_event_team_id IN ({ph}) OR away_event_team_id IN ({ph}))
              AND home_score IS NOT NULL AND away_score IS NOT NULL
            ORDER BY
                SUBSTR(game_date, 7, 4) || SUBSTR(game_date, 1, 2) || SUBSTR(game_date, 4, 2),
                game_time
        """, our_etids * 5).fetchall()

        # Map opp event_team_id → usau_team_id + program info
        opp_etids = list({r[0] for r in rival_games_detailed})
        if opp_etids:
            opp_ph = ','.join('?' * len(opp_etids))
            opp_rows = conn.execute(f"""
                SELECT et.event_team_id, et.usau_team_id, ut.team_name,
                       ut.program_id, p.canonical_name, ut.gender_division,
                       ut.b_team_suffix,
                       CASE
                            WHEN p.state = 'Michigan'
                                 AND p.city IN ('Houghton','Hancock','Marquette','Sault Ste. Marie',
                                                'Escanaba','Iron Mountain','Ironwood','Menominee',
                                                'Calumet','Munising','Newberry','St. Ignace',
                                                'Gladstone','Ishpeming','Negaunee','Gwinn',
                                                'Crystal Falls','Iron River','Wakefield','Bessemer',
                                                'Ontonagon','Baraga')
                            THEN 'North Central'
                            WHEN p.competition_level = 'Club'
                            THEN (SELECT r.club_region    FROM usau_regions r WHERE r.state = p.state)
                            WHEN p.state = 'Ontario' AND p.city IN ('Toronto', 'Ottawa', 'London')
                            THEN 'Metro East'
                            ELSE (SELECT r.college_region FROM usau_regions r WHERE r.state = p.state)
                       END AS opp_region
                FROM usau_event_teams et
                JOIN usau_teams ut ON ut.usau_team_id = et.usau_team_id
                LEFT JOIN usau_programs p ON p.program_id = ut.program_id
                WHERE et.event_team_id IN ({opp_ph})
            """, opp_etids).fetchall()
        else:
            opp_rows = []

        etid_to_opp = {r[0]: {"usau_team_id": r[1], "team_name": r[2],
                                "program_id": r[3], "program_name": r[4],
                                "gender_division": r[5], "b_team_suffix": r[6],
                                "region": r[7]}
                       for r in opp_rows}

        # Aggregate per rival_team_id, keeping ordered game list for derived stats
        rival_agg: dict = {}
        rival_game_list: dict = {}  # tid → list of (our_score, opp_score, date) oldest→newest

        for opp_etid, our_score, opp_score, game_date in rival_games_detailed:
            info = etid_to_opp.get(opp_etid)
            if not info:
                continue
            tid = info["usau_team_id"]
            if tid not in rival_agg:
                rival_agg[tid] = {**info, "games_played": 0, "wins": 0,
                                  "losses": 0, "ties": 0,
                                  "points_for": 0, "points_against": 0,
                                  "same_region": (home_region is not None and info.get("region") == home_region)}
                rival_game_list[tid] = []
            a = rival_agg[tid]
            a["games_played"] += 1
            a["points_for"]   += our_score
            a["points_against"] += opp_score
            if our_score > opp_score:   a["wins"]   += 1
            elif our_score < opp_score: a["losses"] += 1
            else:                       a["ties"]   += 1
            rival_game_list[tid].append((our_score, opp_score, game_date))

        all_rivals_sorted = sorted(rival_agg.values(),
                                    key=lambda x: x["games_played"], reverse=True)
        rivals_all = all_rivals_sorted[:3]
        rivals_in  = [r for r in all_rivals_sorted if     r["same_region"]][:3]
        rivals_out = [r for r in all_rivals_sorted if not r["same_region"]][:3]
        rivals_to_enrich = {r["usau_team_id"]: r for r in rivals_all + rivals_in + rivals_out}.values()

        def _game_result(ts, os_):
            return "W" if ts > os_ else ("L" if ts < os_ else "T")

        for r in rivals_to_enrich:
            tid = r["usau_team_id"]
            gp = r["games_played"]
            r["win_pct"]    = round(r["wins"] / gp, 4) if gp else None
            r["point_diff"] = r["points_for"] - r["points_against"]

            games_chrono = rival_game_list.get(tid, [])  # oldest → newest

            # First & last matchup
            if games_chrono:
                fs, fo, fd = games_chrono[0]
                ls, lo, ld = games_chrono[-1]
                r["first_game"] = {"our_score": fs, "opp_score": fo,
                                   "date": fd, "result": _game_result(fs, fo)}
                r["last_game"]  = {"our_score": ls, "opp_score": lo,
                                   "date": ld, "result": _game_result(ls, lo)}
            else:
                r["first_game"] = r["last_game"] = None

            # Current streak (count from most recent backward)
            streak_type = None
            streak_count = 0
            for ts, os_, _ in reversed(games_chrono):
                res = _game_result(ts, os_)
                if streak_type is None:
                    streak_type = res
                    streak_count = 1
                elif res == streak_type:
                    streak_count += 1
                else:
                    break
            r["streak"] = {"type": streak_type, "count": streak_count} if streak_type else None

            # Biggest win / biggest loss
            best_margin = None; best_game = None
            worst_margin = None; worst_game = None
            for ts, os_, gd in games_chrono:
                margin = ts - os_
                if best_margin is None or margin > best_margin:
                    best_margin = margin
                    best_game = {"our_score": ts, "opp_score": os_, "date": gd, "margin": margin}
                if worst_margin is None or margin < worst_margin:
                    worst_margin = margin
                    worst_game = {"our_score": ts, "opp_score": os_, "date": gd, "margin": margin}
            r["biggest_win"]  = best_game  if (best_margin  is not None and best_margin  > 0) else None
            r["biggest_loss"] = worst_game if (worst_margin is not None and worst_margin < 0) else None

        return {
            "wins":           wins,
            "losses":         losses,
            "ties":           ties,
            "win_pct":        win_pct,
            "points_for":     pf,
            "points_against": pa,
            "point_diff":     pt_diff,
            "pythagorean":    pyth,
            "first_season":   first_season,
            "last_season":    last_season,
            "seasons_played": len(all_years),
            "seasons":        seasons_list,
            "home_region":    home_region,
            "rivals":         rivals_all,
            "rivals_in":      rivals_in,
            "rivals_out":     rivals_out,
        }


# ── /api/usau/upcoming-events ─────────────────────────────────────────────────

_SCRAPE_YEAR = 2026
_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
_SCRAPE_SOURCES = [
    ("https://usaultimate.org/club/schedule/",    "Club"),
    ("https://usaultimate.org/college/schedule/", "College"),
    ("https://usaultimate.org/youth/club-events/","Youth"),
]
_events_cache: dict = {"ts": 0.0, "data": []}
_CACHE_TTL = 3600  # 1 hour


def _parse_event_date(raw: str) -> _date | None:
    raw = raw.strip()
    # Cross-month: "7/31 – 8/2"
    m = re.match(r'(\d{1,2})/(\d{1,2})\s*[–\-]\s*(\d{1,2})/(\d{1,2})', raw)
    if m:
        try: return _date(_SCRAPE_YEAR, int(m.group(1)), int(m.group(2)))
        except ValueError: return None
    # Single-month range: "5/16-18"
    m = re.match(r'(\d{1,2})/(\d{1,2})-(\d{1,2})', raw)
    if m:
        try: return _date(_SCRAPE_YEAR, int(m.group(1)), int(m.group(2)))
        except ValueError: return None
    # Single day: "8/1"
    m = re.match(r'(\d{1,2})/(\d{1,2})$', raw)
    if m:
        try: return _date(_SCRAPE_YEAR, int(m.group(1)), int(m.group(2)))
        except ValueError: return None
    return None


def _parse_event_end_date(raw: str) -> _date | None:
    """Return the end date of an event range, or the start date for single-day events."""
    raw = raw.strip()
    # Cross-month: "7/31 – 8/2"
    m = re.match(r'(\d{1,2})/(\d{1,2})\s*[–\-]\s*(\d{1,2})/(\d{1,2})', raw)
    if m:
        try: return _date(_SCRAPE_YEAR, int(m.group(3)), int(m.group(4)))
        except ValueError: return None
    # Single-month range: "5/16-18"
    m = re.match(r'(\d{1,2})/(\d{1,2})-(\d{1,2})', raw)
    if m:
        try: return _date(_SCRAPE_YEAR, int(m.group(1)), int(m.group(3)))
        except ValueError: return None
    # Single day: "8/1"
    m = re.match(r'(\d{1,2})/(\d{1,2})$', raw)
    if m:
        try: return _date(_SCRAPE_YEAR, int(m.group(1)), int(m.group(2)))
        except ValueError: return None
    return None


def _fmt_event_date(raw: str) -> str:
    raw = raw.strip()
    m = re.match(r'(\d{1,2})/(\d{1,2})\s*[–\-]\s*(\d{1,2})/(\d{1,2})', raw)
    if m:
        m1, d1, m2, d2 = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
        return f"{_MONTHS[m1-1]} {d1}–{_MONTHS[m2-1]} {d2}"
    m = re.match(r'(\d{1,2})/(\d{1,2})-(\d{1,2})', raw)
    if m:
        mo, d1, d2 = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return f"{_MONTHS[mo-1]} {d1}–{d2}"
    m = re.match(r'(\d{1,2})/(\d{1,2})$', raw)
    if m:
        mo, day = int(m.group(1)), int(m.group(2))
        return f"{_MONTHS[mo-1]} {day}"
    return raw


def _parse_schedule_page(html: str, source: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []
    date_re = re.compile(r'\d{1,2}/')
    age_re  = re.compile(r'^U\d+$', re.IGNORECASE)
    skip_vals = {"Link", "Full Results", ""}

    def strip_label(text: str) -> str:
        """Remove 'Label: ' prefix if present, e.g. 'Date: 6/6-7' → '6/6-7'."""
        if ': ' in text:
            return text.split(': ', 1)[1].strip()
        return text.strip()

    for table in soup.find_all("table"):
        for tr in table.find_all("tr"):
            cells = [strip_label(td.get_text(" ", strip=True)) for td in tr.find_all("td")]
            if len(cells) < 4 or not date_re.match(cells[0]):
                continue
            # Youth pages have an extra age-group column: date | gender | age | name | location
            if source == "Youth" and len(cells) >= 5 and age_re.match(cells[2]):
                name, location = cells[3], cells[4]
            else:
                name, location = cells[2], cells[3]
            name = name.strip()
            if name in skip_vals:
                continue
            # For College, prefix name with D-I / D-III so they stay distinct after dedup
            if source == "College":
                div_cell = cells[1] if len(cells) > 1 else ""
                if div_cell.startswith("D-III"):
                    name = f"D-III {name}"
                elif div_cell.startswith("D-I"):
                    name = f"D-I {name}"
            rows.append({"date_raw": cells[0].strip(), "name": name,
                         "location": location.strip(), "source": source})
    return rows


@app.get("/api/usau/upcoming-events")
async def get_upcoming_events():
    now = time.time()
    if now - _events_cache["ts"] < _CACHE_TTL and _events_cache["data"]:
        return _events_cache["data"]

    today = _date.today()
    all_raw: list[dict] = []
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        for url, source in _SCRAPE_SOURCES:
            try:
                resp = await client.get(url, headers={"User-Agent": ua})
                resp.raise_for_status()
                all_raw.extend(_parse_schedule_page(resp.text, source))
            except Exception:
                continue

    # Parse dates, keep only upcoming, sort
    dated = [(ev, _parse_event_date(ev["date_raw"]), _parse_event_end_date(ev["date_raw"])) for ev in all_raw]
    dated = [(ev, d_s) for ev, d_s, d_e in dated
             if d_s is not None and (d_s >= today or (d_e is not None and d_e >= today))]
    dated.sort(key=lambda x: x[1])

    # Collapse same event name → one card (first occurrence wins for date/location)
    by_name: dict[str, dict] = {}
    for ev, d in dated:
        name = ev["name"]
        if name not in by_name:
            by_name[name] = {
                "name":      name,
                "location":  ev["location"],
                "date":      _fmt_event_date(ev["date_raw"]),
                "division":  ev["source"],
                "sort_date": d.isoformat(),
            }

    result = list(by_name.values())[:15]
    _events_cache["ts"]   = now
    _events_cache["data"] = result
    return result


@app.get("/api/blog")
def list_blog_posts(
    limit: int = Query(20, le=50),
    featured_only: bool = Query(False, alias="featuredOnly"),
):
    with get_db() as conn:
        where = "WHERE published = 1"
        if featured_only:
            where += " AND featured = 1"
        rows = conn.execute(
            f"""SELECT post_id, title, subtitle, author, category, tags,
                       summary, cover_image_url, featured,
                       published_at, created_at
                FROM blog
                {where}
                ORDER BY featured DESC, published_at DESC
                LIMIT ?""",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


@app.get("/api/blog/{post_id}")
def get_blog_post(post_id: str):
    with get_db() as conn:
        row = conn.execute(
            """SELECT post_id, title, subtitle, author, category, tags,
                      body, summary, cover_image_url, featured,
                      published, published_at, created_at, updated_at
               FROM blog
               WHERE post_id = ? AND published = 1""",
            (post_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Post not found")
        return dict(row)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", app_dir=str(Path(__file__).parent),
                host="127.0.0.1", port=8000, reload=True)


# ── Compare endpoints ─────────────────────────────────────────────────────────

def _compute_edge(game_rows):
    """Compute EDGE-O, EDGE-B, EDGE from a list of per-game stat dicts.
    Each dict must have: g_goals, g_turns, g_yards, p_goals, p_assists,
    p_yards, p_trns, p_blk.
    Games with no yard data (pre-2021 / missing coords) are skipped.
    """
    edge_o_total = 0.0
    edge_b_total = 0.0
    for row in game_rows:
        g_goals = row["g_goals"] or 0.0
        g_turns = row["g_turns"] or 0.0
        g_yards = row["g_yards"] or 0.0
        if g_yards == 0 or (g_goals + g_turns) == 0:
            continue  # no coordinate data or no possessions
        se = g_goals / (g_goals + g_turns)
        g_scores = g_goals * 2  # goals + assists (one assist per goal)
        gross = g_goals + g_turns * se
        yardage_coeff = (gross * 0.70) / (2.0 * g_yards)
        scoring_coeff = (gross * 0.30) / (2.0 * g_scores) if g_scores else 0.0
        p_asg  = (row["p_goals"] or 0.0) + (row["p_assists"] or 0.0)
        p_yds  = row["p_yards"] or 0.0
        p_trns = row["p_trns"] or 0.0
        p_blk  = row["p_blk"] or 0.0
        edge_o = (p_yds * yardage_coeff) + (p_asg * scoring_coeff) - (p_trns * se)
        edge_b = p_blk * se
        edge_o_total += edge_o
        edge_b_total += edge_b
    edge = edge_o_total + edge_b_total
    return round(edge_o_total, 2), round(edge_b_total, 2), round(edge, 2)


_EDGE_SELECT = """
    SUM(CASE WHEN e.type=19  AND e.perspective=pg.player_side THEN 1.0 ELSE 0 END) AS g_goals,
    SUM(CASE WHEN e.type IN (22,20) AND e.perspective=pg.player_side THEN 1.0 ELSE 0 END) AS g_turns,
    SUM(CASE WHEN e.type IN (18,19) AND e.perspective=pg.player_side
                 AND e.thrower_x IS NOT NULL AND e.receiver_x IS NOT NULL
             THEN SQRT((e.receiver_x-e.thrower_x)*(e.receiver_x-e.thrower_x)
                     + (e.receiver_y-e.thrower_y)*(e.receiver_y-e.thrower_y))
             ELSE 0 END) AS g_yards,
    SUM(CASE WHEN e.type=19 AND e.receiver=:slug AND e.perspective=pg.player_side THEN 1.0 ELSE 0 END) AS p_goals,
    SUM(CASE WHEN e.type=19 AND e.thrower=:slug  AND e.perspective=pg.player_side THEN 1.0 ELSE 0 END) AS p_assists,
    SUM(CASE WHEN e.type IN (18,19) AND e.thrower=:slug AND e.perspective=pg.player_side
                 AND e.thrower_x IS NOT NULL AND e.receiver_x IS NOT NULL
             THEN SQRT((e.receiver_x-e.thrower_x)*(e.receiver_x-e.thrower_x)
                     + (e.receiver_y-e.thrower_y)*(e.receiver_y-e.thrower_y))
             ELSE 0 END) AS p_yards,
    SUM(CASE WHEN (e.type=22 AND e.thrower=:slug OR e.type=20 AND e.receiver=:slug)
                  AND e.perspective=pg.player_side THEN 1.0 ELSE 0 END) AS p_trns,
    SUM(CASE WHEN e.type=11 AND e.defender=:slug AND e.perspective=pg.player_side THEN 1.0 ELSE 0 END) AS p_blk
"""


@app.get("/api/ufa/compare/players")
def compare_ufa_players(ids: str = Query(...)):
    """Career + per-season stats for up to 6 comma-separated UFA player slugs."""
    slugs = [s.strip() for s in ids.split(",") if s.strip()][:6]
    if not slugs:
        raise HTTPException(status_code=422, detail="ids required")

    def _pct(n, d):
        return round(n / d * 100, 1) if d else None

    with get_db() as conn:
        players = []
        for slug in slugs:
            p_row = conn.execute(
                "SELECT display_name, photo_url FROM ufa_players WHERE player_slug=?", (slug,)
            ).fetchone()
            m_row = conn.execute(
                "SELECT ID FROM master_players WHERE UFA_ID=?", (slug,)
            ).fetchone()
            season_rows = conn.execute("""
                SELECT s.year, s.team_id,
                       COALESCE(t.team_name, s.team_id) AS team_name,
                       s.games_played AS gp,
                       s.goals, s.assists, s.hockey_assists, s.blocks,
                       s.completions, s.throw_attempts, s.throwaways,
                       s.hucks_attempted, s.hucks_completed,
                       s.drops, s.callahans, s.plus_minus, s.points_played
                FROM ufa_player_season_stats s
                LEFT JOIN ufa_teams t ON t.team_slug = s.team_id
                WHERE s.player_id = ?
                ORDER BY s.year
            """, (slug,)).fetchall()

            seasons = []
            for s in season_rows:
                d = dict(s)
                d["completion_pct"] = _pct(d["completions"], d["throw_attempts"])
                d["huck_pct"] = _pct(d["hucks_completed"], d["hucks_attempted"])
                seasons.append(d)

            _SUM_KEYS = ["gp", "goals", "assists", "hockey_assists", "blocks",
                         "completions", "throw_attempts", "throwaways",
                         "hucks_attempted", "hucks_completed", "drops",
                         "callahans", "plus_minus", "points_played"]
            career = {k: (sum(s[k] for s in seasons if s[k] is not None) or None) for k in _SUM_KEYS}
            career["completion_pct"] = _pct(career["completions"], career["throw_attempts"])
            career["huck_pct"]       = _pct(career["hucks_completed"], career["hucks_attempted"])

            # EDGE stats (2021+ only — yards require coordinate data)
            # Fetch all per-game rows with year so we can compute both career and per-season EDGE
            all_edge_rows = conn.execute(f"""
                WITH player_games AS (
                    SELECT DISTINCT g.game_id, g.year,
                        CASE WHEN g.home_team_id = s.team_id THEN 'home' ELSE 'away' END AS player_side
                    FROM ufa_games g
                    JOIN ufa_player_season_stats s ON s.year = g.year AND s.player_id = :slug
                    WHERE LOWER(g.status) IN ('final', 'complete', 'completed')
                      AND g.year >= 2021
                      AND (g.home_team_id = s.team_id OR g.away_team_id = s.team_id)
                )
                SELECT pg.year, {_EDGE_SELECT}
                FROM player_games pg
                JOIN ufa_game_events e ON e.game_id = pg.game_id
                GROUP BY pg.game_id, pg.year
            """, {"slug": slug}).fetchall()

            # Group rows by year for per-season EDGE
            from collections import defaultdict
            edge_by_year = defaultdict(list)
            for row in all_edge_rows:
                d = dict(row)
                edge_by_year[d["year"]].append(d)

            e_o, e_b, e_t = _compute_edge([dict(r) for r in all_edge_rows])
            career["edge_o"] = e_o
            career["edge_b"] = e_b
            career["edge"]   = e_t

            # Back-fill EDGE into each season
            for s in seasons:
                yr = s["year"]
                if yr >= 2021 and yr in edge_by_year:
                    s_o, s_b, s_t = _compute_edge(edge_by_year[yr])
                    s["edge_o"] = s_o
                    s["edge_b"] = s_b
                    s["edge"]   = s_t
                else:
                    s["edge_o"] = None
                    s["edge_b"] = None
                    s["edge"]   = None

            photo = p_row["photo_url"] if p_row else None
            if photo and "no_image" in photo:
                photo = None

            players.append({
                "slug":      slug,
                "name":      p_row["display_name"] if p_row else slug,
                "master_id": m_row["ID"] if m_row else None,
                "photo_url": photo,
                "career":    career,
                "seasons":   seasons,
            })
    return {"players": players}


@app.get("/api/ufa/compare/players/vs_franchise")
def compare_players_vs_franchise(ids: str = Query(...), franchise_id: str = Query(...)):
    """Stats for players in games played AGAINST the given franchise (from game events)."""
    slugs = [s.strip() for s in ids.split(",") if s.strip()][:6]
    if not slugs:
        raise HTTPException(status_code=422, detail="ids required")

    def _pct(n, d):
        return round(n / d * 100, 1) if d else None

    with get_db() as conn:
        players = []
        for slug in slugs:
            p_row = conn.execute(
                "SELECT display_name, photo_url FROM ufa_players WHERE player_slug=?", (slug,)
            ).fetchone()
            m_row = conn.execute(
                "SELECT ID FROM master_players WHERE UFA_ID=?", (slug,)
            ).fetchone()

            # Aggregate game-event stats for games played against the franchise
            row = conn.execute("""
                WITH
                franchise_teams AS (
                    SELECT year, team_slug FROM ufa_franchises WHERE franchise_id = ?
                ),
                player_teams AS (
                    SELECT year, team_id FROM ufa_player_season_stats WHERE player_id = ?
                ),
                relevant_games AS (
                    SELECT g.game_id,
                        CASE WHEN g.home_team_id = pt.team_id THEN 'home' ELSE 'away' END AS player_side
                    FROM ufa_games g
                    JOIN player_teams pt ON pt.year = g.year
                    JOIN franchise_teams ft ON ft.year = g.year
                    WHERE ((g.away_team_id = pt.team_id AND g.home_team_id = ft.team_slug)
                       OR  (g.home_team_id = pt.team_id AND g.away_team_id = ft.team_slug))
                      AND LOWER(g.status) IN ('final', 'complete', 'completed')
                )
                SELECT
                    COUNT(DISTINCT rg.game_id)                                                            AS gp,
                    SUM(CASE WHEN e.type=19  AND e.receiver=?  AND e.perspective=rg.player_side THEN 1 ELSE 0 END) AS goals,
                    SUM(CASE WHEN e.type=19  AND e.thrower=?   AND e.perspective=rg.player_side THEN 1 ELSE 0 END) AS assists,
                    SUM(CASE WHEN e.type IN (18,19) AND e.thrower=? AND e.perspective=rg.player_side THEN 1 ELSE 0 END) AS completions,
                    SUM(CASE WHEN e.type IN (18,19,20,22,23,24) AND e.thrower=? AND e.perspective=rg.player_side THEN 1 ELSE 0 END) AS throw_attempts,
                    SUM(CASE WHEN e.type=22  AND e.thrower=?   AND e.perspective=rg.player_side THEN 1 ELSE 0 END) AS throwaways,
                    SUM(CASE WHEN e.type=20  AND e.receiver=?  AND e.perspective=rg.player_side THEN 1 ELSE 0 END) AS drops,
                    SUM(CASE WHEN e.type=11  AND e.defender=?  AND e.perspective=rg.player_side THEN 1 ELSE 0 END) AS blocks
                FROM relevant_games rg
                JOIN ufa_game_events e ON e.game_id = rg.game_id
            """, (franchise_id, slug, slug, slug, slug, slug, slug, slug, slug)).fetchone()

            career = dict(row) if row else {}
            career["completion_pct"] = _pct(career.get("completions"), career.get("throw_attempts"))
            career["hockey_assists"] = None
            career["plus_minus"]     = None
            career["hucks_completed"] = None
            career["huck_pct"]        = None

            # EDGE stats vs franchise (2021+ only)
            edge_rows = conn.execute(f"""
                WITH
                franchise_teams AS (
                    SELECT year, team_slug FROM ufa_franchises WHERE franchise_id = :fid
                ),
                player_teams AS (
                    SELECT year, team_id FROM ufa_player_season_stats WHERE player_id = :slug
                ),
                player_games AS (
                    SELECT g.game_id,
                        CASE WHEN g.home_team_id = pt.team_id THEN 'home' ELSE 'away' END AS player_side
                    FROM ufa_games g
                    JOIN player_teams pt ON pt.year = g.year
                    JOIN franchise_teams ft ON ft.year = g.year
                    WHERE ((g.away_team_id = pt.team_id AND g.home_team_id = ft.team_slug)
                       OR  (g.home_team_id = pt.team_id AND g.away_team_id = ft.team_slug))
                      AND LOWER(g.status) IN ('final', 'complete', 'completed')
                      AND g.year >= 2021
                )
                SELECT {_EDGE_SELECT}
                FROM player_games pg
                JOIN ufa_game_events e ON e.game_id = pg.game_id
                GROUP BY pg.game_id
            """, {"fid": franchise_id, "slug": slug}).fetchall()
            e_o, e_b, e_t = _compute_edge([dict(r) for r in edge_rows])
            career["edge_o"] = e_o
            career["edge_b"] = e_b
            career["edge"]   = e_t

            photo = p_row["photo_url"] if p_row else None
            if photo and "no_image" in photo:
                photo = None

            players.append({
                "slug":      slug,
                "name":      p_row["display_name"] if p_row else slug,
                "master_id": m_row["ID"] if m_row else None,
                "photo_url": photo,
                "career":    career,
                "seasons":   [],
            })
    return {"players": players}


@app.get("/api/ufa/compare/franchises")
def compare_ufa_franchises(ids: str = Query(...)):
    """All-time aggregates for up to 6 comma-separated franchise_ids."""
    fids = [s.strip() for s in ids.split(",") if s.strip()][:6]
    if not fids:
        raise HTTPException(status_code=422, detail="ids required")

    with get_db() as conn:
        results = []
        for fid in fids:
            info_row = conn.execute("""
                SELECT team_name, team_slug, team_abbreviation,
                       MIN(year) AS first_year, MAX(year) AS latest_year
                FROM ufa_franchises WHERE franchise_id = ?
                GROUP BY franchise_id
            """, (fid,)).fetchone()
            if not info_row:
                continue

            slug_rows = conn.execute(
                "SELECT DISTINCT team_slug FROM ufa_franchises WHERE franchise_id=?", (fid,)
            ).fetchall()
            slugs    = [r["team_slug"] for r in slug_rows]
            slug_set = set(slugs)
            slug_ph  = ",".join("?" * len(slugs))

            ts_rows = conn.execute(f"""
                SELECT year, wins, losses, ties
                FROM ufa_team_seasons WHERE team_id IN ({slug_ph})
            """, slugs).fetchall()

            total_w = sum(r["wins"] or 0 for r in ts_rows)
            total_l = sum(r["losses"] or 0 for r in ts_rows)
            total_t = sum(r["ties"] or 0 for r in ts_rows)
            seasons_played = len(set(r["year"] for r in ts_rows))

            game_rows = conn.execute(f"""
                SELECT away_team_id, home_team_id, away_score, home_score
                FROM ufa_games
                WHERE (away_team_id IN ({slug_ph}) OR home_team_id IN ({slug_ph}))
                  AND status='Final' AND away_score IS NOT NULL AND home_score IS NOT NULL
            """, slugs + slugs).fetchall()

            pf = pa = 0
            for g in game_rows:
                if g["home_team_id"] in slug_set:
                    pf += g["home_score"]; pa += g["away_score"]
                else:
                    pf += g["away_score"]; pa += g["home_score"]

            leaders = {}
            for col in ("goals", "assists", "blocks"):
                row = conn.execute(f"""
                    SELECT p.display_name, m.ID AS master_id, SUM(s.{col}) AS total
                    FROM ufa_player_season_stats s
                    LEFT JOIN ufa_players p ON p.player_slug = s.player_id
                    LEFT JOIN master_players m ON m.UFA_ID = s.player_id
                    WHERE s.team_id IN ({slug_ph}) AND s.{col} IS NOT NULL
                    GROUP BY s.player_id ORDER BY total DESC LIMIT 1
                """, slugs).fetchone()
                leaders[col] = {
                    "name": row["display_name"], "master_id": row["master_id"], "total": row["total"]
                } if row and row["total"] else None

            results.append({
                "franchise_id": fid,
                "name":         info_row["team_name"],
                "abbr":         info_row["team_abbreviation"],
                "slug":         info_row["team_slug"],
                "first_year":   info_row["first_year"],
                "latest_year":  info_row["latest_year"],
                "seasons":      seasons_played,
                "wins":         total_w,
                "losses":       total_l,
                "ties":         total_t,
                "points_for":   pf,
                "points_against": pa,
                "career_leaders": leaders,
            })
    return {"franchises": results}


def get_player(slug: str):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM ufa_players WHERE player_slug = ?", (slug,)
        ).fetchone()

        if not row:
            raise HTTPException(status_code=404, detail="Player not found")

        stats = conn.execute(
            """SELECT s.*, t.team_name AS team_name
               FROM ufa_player_season_stats s
               LEFT JOIN ufa_teams t ON t.team_slug = s.team_id
               WHERE s.player_id = ?
               ORDER BY s.year""",
            (slug,),
        ).fetchall()

        return {
            "player": dict(row),
            "seasonStats": [dict(s) for s in stats],
        }


# ══════════════════════════════════════════════════════════════════════════════
# WUL  (Women's Ultimate League)
# ══════════════════════════════════════════════════════════════════════════════

def _wul_season_year(season: str) -> int:
    """Extract the year integer from a WUL season string like '2024 Regular Season'."""
    try:
        return int(season.split()[0])
    except (IndexError, ValueError):
        return 0


@app.get("/api/wul/teams")
def get_wul_teams():
    """Return all WUL franchises with season year range."""
    with get_db() as conn:
        teams = conn.execute("SELECT franchise_id, team_name, active FROM wul_teams ORDER BY team_name").fetchall()
        aliases = conn.execute("SELECT alias_name, franchise_id FROM wul_team_name_aliases").fetchall()
        alias_map: dict[str, str] = {r["alias_name"]: r["franchise_id"] for r in aliases}

        year_rows = conn.execute(
            "SELECT team, season FROM wul_player_game_stats GROUP BY team, season"
        ).fetchall()

    fid_years: dict[str, list[int]] = {}
    for r in year_rows:
        fid = alias_map.get(r["team"])
        if fid is None:
            continue
        yr = _wul_season_year(r["season"])
        if yr:
            fid_years.setdefault(fid, []).append(yr)

    result = []
    for t in teams:
        fid = t["franchise_id"]
        years = fid_years.get(fid, [])
        result.append({
            "franchise_id": fid,
            "team_name":    t["team_name"],
            "active":       bool(t["active"]),
            "first_year":   min(years) if years else None,
            "latest_year":  max(years) if years else None,
        })
    return {"teams": result}


@app.get("/api/wul/teams/{franchise_id}")
def get_wul_team(franchise_id: str):
    """Return WUL team details + aggregated season stats."""
    with get_db() as conn:
        team_row = conn.execute(
            "SELECT franchise_id, team_name, active FROM wul_teams WHERE franchise_id = ?",
            (franchise_id,)
        ).fetchone()
        if not team_row:
            raise HTTPException(status_code=404, detail="WUL team not found")

        aliases = conn.execute(
            "SELECT alias_name FROM wul_team_name_aliases WHERE franchise_id = ?",
            (franchise_id,)
        ).fetchall()
        alias_names = [r["alias_name"] for r in aliases]

        if not alias_names:
            return {"team": dict(team_row), "seasons": [], "roster": []}

        placeholders = ",".join("?" * len(alias_names))

        team_games = conn.execute(
            f"""SELECT season, team,
                   SUM(g) AS goals_for, SUM(ga) AS goals_against,
                   SUM(CASE WHEN g > ga THEN 1 ELSE 0 END) AS wins,
                   SUM(CASE WHEN g < ga THEN 1 ELSE 0 END) AS losses,
                   COUNT(*) AS games_played,
                   SUM(com) AS completions, SUM(y) AS yards,
                   SUM(b) AS blocks, SUM(t) AS turnovers
               FROM wul_team_game_stats
               WHERE team IN ({placeholders})
               GROUP BY season
               ORDER BY season""",
            alias_names
        ).fetchall()

        roster = conn.execute(
            f"""SELECT player, season,
                   SUM(g) AS goals, SUM(a) AS assists, SUM(ha) AS hockey_assists,
                   SUM(b) AS blocks, SUM(t) AS turnovers,
                   SUM(thy) AS throwing_yards, SUM(recy) AS receiving_yards,
                   SUM(y) AS total_yards,
                   SUM(com) AS completions, SUM(tgt) AS attempts,
                   SUM(plus_minus) AS plus_minus,
                   COUNT(*) AS games_played
               FROM wul_player_game_stats
               WHERE team IN ({placeholders})
               GROUP BY player, season
               ORDER BY season, player""",
            alias_names
        ).fetchall()

    seasons_out = []
    for r in team_games:
        seasons_out.append({
            "season":        r["season"],
            "games_played":  r["games_played"],
            "wins":          r["wins"],
            "losses":        r["losses"],
            "goals_for":     r["goals_for"],
            "goals_against": r["goals_against"],
            "completions":   r["completions"],
            "yards":         r["yards"],
            "blocks":        r["blocks"],
            "turnovers":     r["turnovers"],
        })

    roster_out = []
    for r in roster:
        atts = r["attempts"] or 0
        comps = r["completions"] or 0
        roster_out.append({
            "player":          r["player"],
            "season":          r["season"],
            "games_played":    r["games_played"],
            "goals":           r["goals"],
            "assists":         r["assists"],
            "hockey_assists":  r["hockey_assists"],
            "blocks":          r["blocks"],
            "turnovers":       r["turnovers"],
            "throwing_yards":  r["throwing_yards"],
            "receiving_yards": r["receiving_yards"],
            "total_yards":     r["total_yards"],
            "completions":     comps,
            "attempts":        atts,
            "completion_pct":  round(comps / atts * 100, 1) if atts else None,
            "plus_minus":      r["plus_minus"],
        })

    return {
        "team":    {**dict(team_row), "aliases": alias_names},
        "seasons": seasons_out,
        "roster":  roster_out,
    }


@app.get("/api/wul/standings")
def get_wul_standings():
    """Return WUL standings from wul_team_game_stats, latest Regular Season, grouped by conference."""
    # 2026 conference structure (keyed by DB franchise_id = wul_01..wul_08)
    _WUL_CONFERENCES: dict[str, str] = {
        "wul_03": "Northwest",  # Colorado Alpenglow
        "wul_05": "Northwest",  # Oregon Soar
        "wul_07": "Northwest",  # Seattle Tempest
        "wul_08": "Northwest",  # Utah Wild
        "wul_01": "Southwest",  # Arizona Sidewinders
        "wul_02": "Southwest",  # Bay Area Falcons (SF Falcons)
        "wul_04": "Southwest",  # Los Angeles Astra
        "wul_06": "Southwest",  # San Diego Super Bloom
    }
    # Logo slugs (keyed by DB franchise_id)
    _WUL_LOGO_SLUGS: dict[str, str] = {
        "wul_01": "ari_sidewinders",
        "wul_02": "sf_falcons",
        "wul_03": "col_alpenglow",
        "wul_04": "la_astra",
        "wul_05": "ore_soar",
        "wul_06": "sd_superbloom",
        "wul_07": "sea_tempest",
        "wul_08": "uth_wild",
    }

    with get_db() as conn:
        latest = conn.execute(
            """SELECT season FROM wul_team_game_stats
               WHERE season LIKE '% Regular Season'
               ORDER BY season DESC LIMIT 1"""
        ).fetchone()
        if not latest:
            return {"season": None, "divisions": []}
        season = latest["season"]

        rows = conn.execute(
            """SELECT team,
                   SUM(CASE WHEN g > ga THEN 1 ELSE 0 END) AS wins,
                   SUM(CASE WHEN g < ga THEN 1 ELSE 0 END) AS losses,
                   SUM(g) AS points_for,
                   SUM(ga) AS points_against,
                   COUNT(*) AS games_played
               FROM wul_team_game_stats
               WHERE season = ?
               GROUP BY team
               ORDER BY wins DESC, points_for DESC""",
            (season,)
        ).fetchall()

        aliases = conn.execute("SELECT alias_name, franchise_id FROM wul_team_name_aliases").fetchall()
        alias_map = {r["alias_name"]: r["franchise_id"] for r in aliases}

    # Group by conference
    conferences: dict[str, list] = {"Northwest": [], "Southwest": [], "Other": []}
    for r in rows:
        fid = alias_map.get(r["team"])
        conf = _WUL_CONFERENCES.get(fid, "Other") if fid else "Other"
        conferences[conf].append({
            "team":         r["team"],
            "franchise_id": fid,
            "logo_slug":    _WUL_LOGO_SLUGS.get(fid) if fid else None,
            "wins":         r["wins"],
            "losses":       r["losses"],
            "games_played": r["games_played"],
            "point_diff":   (r["points_for"] or 0) - (r["points_against"] or 0),
        })

    divisions = [
        {"division": name, "teams": teams}
        for name, teams in conferences.items()
        if teams
    ]
    return {"season": season, "divisions": divisions}


@app.get("/api/wul/games")
def get_wul_games():
    """Return all WUL games from wul_games."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT game_id, year, date, season,
                      home_team, away_team,
                      home_team_id, away_team_id,
                      home_score, away_score, status
               FROM wul_games
               ORDER BY date DESC"""
        ).fetchall()

    games = []
    for r in rows:
        games.append({
            "game_id":      r["game_id"],
            "year":         r["year"],
            "week":         None,
            "date":         r["date"],
            "time":         None,
            "timestamp":    r["date"],   # ISO date sorts correctly as a proxy timestamp
            "season":       r["season"],
            "home_team":    r["home_team"],
            "away_team":    r["away_team"],
            "home_team_id": r["home_team_id"],
            "away_team_id": r["away_team_id"],
            "home_score":   r["home_score"],
            "away_score":   r["away_score"],
            "status":       r["status"],
        })
    return {"games": games}


@app.get("/api/wul/games/{game_id}")
def get_wul_game(game_id: str):
    """Return a single WUL game record with YouTube slug from game_urls."""
    with get_db() as conn:
        row = conn.execute(
            """SELECT game_id, year, date, season,
                      home_team, away_team,
                      home_team_id, away_team_id,
                      home_score, away_score, status
               FROM wul_games WHERE game_id = ?""",
            (game_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="WUL game not found")
        url_row = conn.execute(
            "SELECT site, slug FROM game_urls WHERE game_id = ? AND league = 'wul' LIMIT 1",
            (game_id,)
        ).fetchone()

    youtube_slug = None
    if url_row and url_row["site"] == "youtube":
        youtube_slug = url_row["slug"]

    return {
        "game_id":      row["game_id"],
        "year":         row["year"],
        "week":         None,
        "date":         row["date"],
        "time":         None,
        "timestamp":    row["date"],
        "season":       row["season"],
        "home_team":    row["home_team"],
        "away_team":    row["away_team"],
        "home_team_id": row["home_team_id"],
        "away_team_id": row["away_team_id"],
        "home_score":   row["home_score"],
        "away_score":   row["away_score"],
        "status":       row["status"],
        "youtube_slug": youtube_slug,
    }


@app.get("/api/wul/games/{game_id}/players")
def get_wul_game_players(game_id: str):
    """Return player stats for both teams in a WUL game."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT player, jersey_number, team,
                      g, a, ha, b, t,
                      thy, recy, y,
                      plus_minus, pp, opp, dpp
               FROM wul_player_game_stats
               WHERE wul_game_id = ?
               ORDER BY team, player""",
            (game_id,)
        ).fetchall()

    players = []
    for r in rows:
        players.append({
            "player":         r["player"],
            "jersey_number":  r["jersey_number"],
            "team":           r["team"],
            "goals":          r["g"],
            "assists":        r["a"],
            "hockey_assists":  r["ha"],
            "blocks":         r["b"],
            "turnovers":      r["t"],
            "throwing_yards": r["thy"],
            "receiving_yards": r["recy"],
            "total_yards":    r["y"],
            "plus_minus":     r["plus_minus"],
            "pp":             r["pp"],
        })
    return {"players": players}


@app.get("/api/wul/games/{game_id}/h2h")
def get_wul_game_h2h(game_id: str):
    """Return head-to-head record between the two teams up to and including this game."""
    with get_db() as conn:
        game = conn.execute(
            "SELECT home_team_id, away_team_id, date FROM wul_games WHERE game_id = ?",
            (game_id,)
        ).fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")

        t1 = game["home_team_id"]
        t2 = game["away_team_id"]
        date = game["date"]

        rows = conn.execute(
            """SELECT game_id, year, date,
                      home_team_id, away_team_id,
                      home_score, away_score
               FROM wul_games
               WHERE ((home_team_id = ? AND away_team_id = ?)
                   OR (home_team_id = ? AND away_team_id = ?))
                 AND home_score IS NOT NULL AND away_score IS NOT NULL
                 AND date <= ?
               ORDER BY date""",
            (t1, t2, t2, t1, date)
        ).fetchall()

    t1_wins = 0
    t2_wins = 0
    games_out = []
    for r in rows:
        hs  = r["home_score"]
        as_ = r["away_score"]
        winner = r["home_team_id"] if hs > as_ else (r["away_team_id"] if as_ > hs else None)
        if winner == t1:   t1_wins += 1
        elif winner == t2: t2_wins += 1
        games_out.append({
            "game_id":      r["game_id"],
            "year":         r["year"],
            "date":         r["date"],
            "home_team_id": r["home_team_id"],
            "away_team_id": r["away_team_id"],
            "home_score":   hs,
            "away_score":   as_,
            "winner":       winner,
        })

    return {
        "team1":      t1,
        "team2":      t2,
        "team1_wins": t1_wins,
        "team2_wins": t2_wins,
        "games":      games_out,
    }


@app.get("/api/wul/players/search")
def search_wul_players(q: str = Query(default="", max_length=100)):
    """Search WUL players by name."""
    with get_db() as conn:
        if q.strip():
            rows = conn.execute(
                """SELECT DISTINCT player, team FROM wul_player_game_stats
                   WHERE player LIKE ?
                   ORDER BY player LIMIT 30""",
                (f"%{q}%",)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT DISTINCT player, team FROM wul_player_game_stats ORDER BY player LIMIT 50"
            ).fetchall()
    return {"players": [{"name": r["player"], "team": r["team"]} for r in rows]}


@app.get("/api/wul/compare/players")
def compare_wul_players(ids: str = Query(..., description="Comma-separated player names")):
    """Compare WUL players by aggregating per-game stats into career + seasons."""
    names = [n.strip() for n in ids.split(",") if n.strip()][:6]
    if not names:
        raise HTTPException(status_code=400, detail="No player names provided")

    with get_db() as conn:
        results = []
        for name in names:
            career_row = conn.execute(
                """SELECT player,
                       COUNT(*) AS gp,
                       SUM(pp) AS pp, SUM(opp) AS opp, SUM(dpp) AS dpp,
                       SUM(opos) AS opos, SUM(dpos) AS dpos,
                       SUM(plus_minus) AS plus_minus,
                       SUM(p.g) AS goals, SUM(a) AS assists, SUM(ha) AS hockey_assists,
                       SUM(p.b) AS blocks, SUM(s) AS stalls, SUM(p.t) AS turnovers,
                       SUM(thy) AS throwing_yards, SUM(recy) AS receiving_yards,
                       SUM(p.y) AS total_yards, SUM(ey) AS effective_yards,
                       SUM(ther) AS throwing_errors, SUM(recer) AS receiving_errors,
                       SUM(so) AS stalled_out,
                       SUM(th) AS attempts, SUM(com) AS completions,
                       SUM(tgt) AS targets, SUM(rec) AS receptions, SUM(tch) AS touches,
                       SUM(h) AS hucks, SUM(hcom) AS huck_completions, SUM(hrec) AS huck_receptions
                   FROM wul_player_game_stats p
                   WHERE player = ?""",
                (name,)
            ).fetchone()

            if not career_row or career_row["gp"] == 0:
                continue

            teams_rows = conn.execute(
                """SELECT DISTINCT team, season FROM wul_player_game_stats
                   WHERE player = ? ORDER BY season DESC""",
                (name,)
            ).fetchall()
            team_name = teams_rows[0]["team"] if teams_rows else ""

            # Per-game rows with team context for EDGE calculation
            edge_game_rows = conn.execute(
                """SELECT CAST(substr(p.season, 1, 4) AS INTEGER) AS year,
                       p.g  AS p_goals,   p.a   AS p_assists,
                       p.thy AS p_yards,   p.t   AS p_trns,   p.b AS p_blk,
                       t.g  AS g_goals,   t.t   AS g_turns,  t.y AS g_yards
                   FROM wul_player_game_stats p
                   JOIN wul_team_game_stats t
                     ON t.season = p.season AND t.date = p.date AND t.team = p.team
                   WHERE p.player = ?""",
                (name,)
            ).fetchall()
            edge_game_dicts = [dict(r) for r in edge_game_rows]

            # Career EDGE
            c_edge_o, c_edge_b, c_edge = _compute_edge(edge_game_dicts)

            # Per-season EDGE
            from collections import defaultdict as _dd
            by_year = _dd(list)
            for g in edge_game_dicts:
                by_year[g["year"]].append(g)

            gp   = career_row["gp"] or 0
            atts = career_row["attempts"] or 0
            comps = career_row["completions"] or 0
            career = {
                "gp":               gp,
                "pp":               career_row["pp"],
                "opp":              career_row["opp"],
                "dpp":              career_row["dpp"],
                "opos":             career_row["opos"],
                "dpos":             career_row["dpos"],
                "plus_minus":       career_row["plus_minus"],
                "goals":            career_row["goals"],
                "assists":          career_row["assists"],
                "hockey_assists":   career_row["hockey_assists"],
                "blocks":           career_row["blocks"],
                "stalls":           career_row["stalls"],
                "turnovers":        career_row["turnovers"],
                "throwing_yards":   career_row["throwing_yards"],
                "receiving_yards":  career_row["receiving_yards"],
                "total_yards":      career_row["total_yards"],
                "effective_yards":  career_row["effective_yards"],
                "throwing_errors":  career_row["throwing_errors"],
                "receiving_errors": career_row["receiving_errors"],
                "stalled_out":      career_row["stalled_out"],
                "attempts":         atts,
                "completions":      comps,
                "completion_pct":   round(comps / atts * 100, 1) if atts else None,
                "targets":          career_row["targets"],
                "receptions":       career_row["receptions"],
                "touches":          career_row["touches"],
                "hucks":            career_row["hucks"],
                "huck_completions": career_row["huck_completions"],
                "huck_receptions":  career_row["huck_receptions"],
                "edge_o":           c_edge_o,
                "edge_b":           c_edge_b,
                "edge":             c_edge,
            }

            season_rows = conn.execute(
                """SELECT CAST(substr(season, 1, 4) AS INTEGER) AS year,
                       COUNT(*) AS gp,
                       SUM(pp) AS pp, SUM(opp) AS opp, SUM(dpp) AS dpp,
                       SUM(opos) AS opos, SUM(dpos) AS dpos,
                       SUM(plus_minus) AS plus_minus,
                       SUM(g) AS goals, SUM(a) AS assists, SUM(ha) AS hockey_assists,
                       SUM(b) AS blocks, SUM(s) AS stalls, SUM(t) AS turnovers,
                       SUM(thy) AS throwing_yards, SUM(recy) AS receiving_yards,
                       SUM(y) AS total_yards, SUM(ey) AS effective_yards,
                       SUM(ther) AS throwing_errors, SUM(recer) AS receiving_errors,
                       SUM(so) AS stalled_out,
                       SUM(th) AS attempts, SUM(com) AS completions,
                       SUM(tgt) AS targets, SUM(rec) AS receptions, SUM(tch) AS touches,
                       SUM(h) AS hucks, SUM(hcom) AS huck_completions, SUM(hrec) AS huck_receptions
                   FROM wul_player_game_stats
                   WHERE player = ?
                   GROUP BY CAST(substr(season, 1, 4) AS INTEGER)
                   ORDER BY year""",
                (name,)
            ).fetchall()

            seasons = []
            for s in season_rows:
                s_atts  = s["attempts"] or 0
                s_comps = s["completions"] or 0
                yr = s["year"]
                s_edge_o, s_edge_b, s_edge = _compute_edge(by_year.get(yr, []))
                seasons.append({
                    "year":             yr,
                    "gp":               s["gp"],
                    "pp":               s["pp"],
                    "opp":              s["opp"],
                    "dpp":              s["dpp"],
                    "opos":             s["opos"],
                    "dpos":             s["dpos"],
                    "plus_minus":       s["plus_minus"],
                    "goals":            s["goals"],
                    "assists":          s["assists"],
                    "hockey_assists":   s["hockey_assists"],
                    "blocks":           s["blocks"],
                    "stalls":           s["stalls"],
                    "turnovers":        s["turnovers"],
                    "throwing_yards":   s["throwing_yards"],
                    "receiving_yards":  s["receiving_yards"],
                    "total_yards":      s["total_yards"],
                    "effective_yards":  s["effective_yards"],
                    "throwing_errors":  s["throwing_errors"],
                    "receiving_errors": s["receiving_errors"],
                    "stalled_out":      s["stalled_out"],
                    "attempts":         s_atts,
                    "completions":      s_comps,
                    "completion_pct":   round(s_comps / s_atts * 100, 1) if s_atts else None,
                    "targets":          s["targets"],
                    "receptions":       s["receptions"],
                    "touches":          s["touches"],
                    "hucks":            s["hucks"],
                    "huck_completions": s["huck_completions"],
                    "huck_receptions":  s["huck_receptions"],
                    "edge_o":           s_edge_o,
                    "edge_b":           s_edge_b,
                    "edge":             s_edge,
                })

            photo_row = conn.execute(
                "SELECT PUL_photo_url FROM master_players WHERE Name = ? LIMIT 1", (name,)
            ).fetchone()
            results.append({
                "id":        name,
                "name":      name,
                "team":      team_name,
                "photo_url": photo_row["PUL_photo_url"] if photo_row else None,
                "career":    career,
                "seasons":   seasons,
            })

    return {"players": results}


@app.get("/api/wul/compare/franchises")
def compare_wul_franchises(ids: str = Query(..., description="Comma-separated franchise_ids")):
    """Compare WUL franchises all-time using wul_team_game_stats + wul_player_game_stats."""
    franchise_ids = [f.strip() for f in ids.split(",") if f.strip()][:2]
    if not franchise_ids:
        raise HTTPException(status_code=400, detail="No franchise ids provided")

    with get_db() as conn:
        all_aliases = conn.execute(
            "SELECT alias_name, franchise_id FROM wul_team_name_aliases"
        ).fetchall()
        alias_map = {}
        for r in all_aliases:
            alias_map.setdefault(r["franchise_id"], []).append(r["alias_name"])

        results = []
        for fid in franchise_ids:
            team_row = conn.execute(
                "SELECT franchise_id, team_name FROM wul_teams WHERE franchise_id = ?", (fid,)
            ).fetchone()
            if not team_row:
                continue

            alias_names = alias_map.get(fid, [])
            if not alias_names:
                continue

            placeholders = ",".join("?" * len(alias_names))

            game_rows = conn.execute(
                f"""SELECT g, ga, season FROM wul_team_game_stats
                    WHERE team IN ({placeholders})""",
                alias_names
            ).fetchall()

            wins   = sum(1 for r in game_rows if (r["g"] or 0) > (r["ga"] or 0))
            losses = sum(1 for r in game_rows if (r["g"] or 0) < (r["ga"] or 0))
            ties   = sum(1 for r in game_rows if (r["g"] or 0) == (r["ga"] or 0))
            points_for     = sum(r["g"]  or 0 for r in game_rows)
            points_against = sum(r["ga"] or 0 for r in game_rows)

            season_years = set()
            for r in game_rows:
                yr = _wul_season_year(r["season"])
                if yr:
                    season_years.add(yr)

            player_rows = conn.execute(
                f"""SELECT player,
                       SUM(g) AS goals, SUM(a) AS assists, SUM(b) AS blocks
                   FROM wul_player_game_stats
                   WHERE team IN ({placeholders})
                   GROUP BY player""",
                alias_names
            ).fetchall()

            def find_leader(stat_key):
                best = max(player_rows, key=lambda r: r[stat_key] or 0, default=None)
                if not best or not (best[stat_key] or 0):
                    return None
                return {"name": best["player"], "total": best[stat_key]}

            results.append({
                "franchise_id":   fid,
                "name":           team_row["team_name"],
                "first_year":     min(season_years) if season_years else None,
                "latest_year":    max(season_years) if season_years else None,
                "wins":           wins,
                "losses":         losses,
                "ties":           ties,
                "points_for":     points_for,
                "points_against": points_against,
                "seasons":        len(season_years),
                "career_leaders": {
                    "goals":   find_leader("goals"),
                    "assists": find_leader("assists"),
                    "blocks":  find_leader("blocks"),
                },
            })

    return {"franchises": results}


# ══════════════════════════════════════════════════════════════════════════════
# PUL  (Premier Ultimate League)
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/pul/teams")
def get_pul_teams():
    """Return all PUL teams with season year range from pul_player_season_stats."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT team, season FROM pul_player_season_stats GROUP BY team, season ORDER BY team, season"""
        ).fetchall()

    teams: dict[str, dict] = {}
    for r in rows:
        t = r["team"]
        try:
            yr = int(r["season"])
        except (ValueError, TypeError):
            continue
        if t not in teams:
            teams[t] = {"team_name": t, "first_year": yr, "latest_year": yr}
        else:
            teams[t]["first_year"] = min(teams[t]["first_year"], yr)
            teams[t]["latest_year"] = max(teams[t]["latest_year"], yr)

    result = sorted(teams.values(), key=lambda x: x["team_name"])
    return {"teams": result}


@app.get("/api/pul/teams/{team_name}")
def get_pul_team(team_name: str):
    """Return PUL team roster and per-season stats."""
    with get_db() as conn:
        exists = conn.execute(
            "SELECT 1 FROM pul_player_season_stats WHERE team = ? LIMIT 1",
            (team_name,)
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="PUL team not found")

        season_rows = conn.execute(
            """SELECT season,
                   COUNT(DISTINCT player_name) AS players,
                   SUM(games_played) AS total_gp,
                   SUM(goals) AS goals, SUM(assists) AS assists,
                   SUM(blocks) AS blocks, SUM(turnovers) AS turnovers,
                   SUM(throwing_yards) AS throwing_yards,
                   SUM(catching_yards) AS catching_yards
               FROM pul_player_season_stats
               WHERE team = ?
               GROUP BY season
               ORDER BY season""",
            (team_name,)
        ).fetchall()

        roster_rows = conn.execute(
            """SELECT player_name, player_url, season,
                   games_played, goals, assists, blocks, turnovers, touches,
                   plus_minus, throwing_yards, catching_yards,
                   second_ast AS hockey_assists, throw_err, rec_err
               FROM pul_player_season_stats
               WHERE team = ?
               ORDER BY season, goals DESC""",
            (team_name,)
        ).fetchall()

    return {
        "team":    {"team_name": team_name},
        "seasons": [dict(r) for r in season_rows],
        "roster":  [dict(r) for r in roster_rows],
    }


@app.get("/api/pul/standings")
def get_pul_standings():
    """Scrape live PUL standings from pul-stats-hub.pages.dev/standings/."""
    import time as _time
    now = _time.time()
    if _pul_standings_cache["data"] and now - _pul_standings_cache["ts"] < _STANDINGS_TTL:
        return _pul_standings_cache["data"]

    try:
        resp = httpx.get(
            "https://pul-stats-hub.pages.dev/standings/",
            headers={"User-Agent": "Mozilla/5.0 (compatible; UltimateReference/1.0)"},
            follow_redirects=True,
            timeout=10,
        )
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not fetch PUL standings: {e}")

    soup = BeautifulSoup(resp.text, "html.parser")

    # Season label from the first h1 containing "Standings"
    season_h1 = soup.find("h1")
    season_label = season_h1.get_text(separator=" ", strip=True) if season_h1 else "2026 PUL Season"

    def _has_hidden_ancestor(tag) -> bool:
        for parent in tag.parents:
            if parent.name and "hidden" in parent.get("class", []):
                return True
        return False

    divisions = []
    for h2 in soup.find_all("h2"):
        div_name = h2.get_text(strip=True)
        if "DIVISION" not in div_name.upper():
            continue
        if _has_hidden_ancestor(h2):
            continue  # belongs to a past season tab, skip
        table = h2.find_next("table")
        if not table:
            continue
        teams = []
        for tr in table.find_all("tr"):
            tds = tr.find_all("td")
            if len(tds) < 4:
                continue
            try:
                # cols: rank | name | W | L | pct | streak | PF | PA | diff | rating
                name = tds[1].get_text(separator=" ", strip=True)
                # name may duplicate e.g. "Philadelphia Surge Philadelphia Surge" — take first half
                words = name.split()
                half = len(words) // 2
                if half and words[:half] == words[half:]:
                    name = " ".join(words[:half])
                wins   = int(tds[2].get_text(strip=True))
                losses = int(tds[3].get_text(strip=True))
                pf     = int(tds[6].get_text(strip=True)) if len(tds) > 6 else 0
                pa     = int(tds[7].get_text(strip=True)) if len(tds) > 7 else 0
                teams.append({"team": name, "wins": wins, "losses": losses, "point_diff": pf - pa})
            except (ValueError, IndexError):
                continue
        if teams:
            label = div_name.replace(" DIVISION", "").replace(" Division", "").strip()
            divisions.append({"division": label, "teams": teams})

    result = {"season": season_label, "divisions": divisions}
    _pul_standings_cache["data"] = result
    _pul_standings_cache["ts"]   = now
    return result


@app.get("/api/pul/players/search")
def search_pul_players(q: str = Query(default="", max_length=100)):
    """Search PUL players by name."""
    with get_db() as conn:
        if q.strip():
            rows = conn.execute(
                """SELECT DISTINCT player_name, team FROM pul_player_season_stats
                   WHERE player_name LIKE ?
                   ORDER BY player_name LIMIT 30""",
                (f"%{q}%",)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT DISTINCT player_name, team FROM pul_player_season_stats ORDER BY player_name LIMIT 50"
            ).fetchall()
    return {"players": [{"name": r["player_name"], "team": r["team"]} for r in rows]}


@app.get("/api/pul/compare/players")
def compare_pul_players(ids: str = Query(..., description="Comma-separated player names")):
    """Compare PUL players using pul_player_season_stats."""
    names = [n.strip() for n in ids.split(",") if n.strip()][:6]
    if not names:
        raise HTTPException(status_code=400, detail="No player names provided")

    with get_db() as conn:
        results = []
        for name in names:
            all_rows = conn.execute(
                """SELECT season, team, games_played, goals, assists, blocks, turnovers,
                       touches, o_pts, d_pts, plus_minus,
                       throws, catches, second_ast AS hockey_assists,
                       throw_err, rec_err, throwing_yards, catching_yards
                   FROM pul_player_season_stats
                   WHERE player_name = ?
                   ORDER BY season""",
                (name,)
            ).fetchall()

            if not all_rows:
                continue

            # Separate numeric-year seasons from the pre-aggregated "career" row
            season_rows = [r for r in all_rows if str(r["season"]).isdigit()]
            if not season_rows:
                continue

            team_name = season_rows[-1]["team"]

            # Recompute career totals from individual seasons (avoids using the pre-scraped
            # "career" row which would double-count if included)
            def _sum(key): return sum(r[key] or 0 for r in season_rows)

            total_throws = _sum("throws")
            total_catches = _sum("catches")

            career = {
                "gp":              _sum("games_played"),
                "goals":           _sum("goals"),
                "assists":         _sum("assists"),
                "hockey_assists":  _sum("hockey_assists"),
                "blocks":          _sum("blocks"),
                "turnovers":       _sum("turnovers"),
                "touches":         _sum("touches"),
                "o_pts":           _sum("o_pts"),
                "d_pts":           _sum("d_pts"),
                "plus_minus":      _sum("plus_minus"),
                "throwing_yards":  _sum("throwing_yards"),
                "receiving_yards": _sum("catching_yards"),
                "throws":          total_throws,
                "catches":         total_catches,
                "throw_err":       _sum("throw_err"),
                "rec_err":         _sum("rec_err"),
            }

            seasons = []
            for s in season_rows:
                seasons.append({
                    "year":            int(s["season"]),
                    "gp":              s["games_played"],
                    "goals":           s["goals"],
                    "assists":         s["assists"],
                    "hockey_assists":  s["hockey_assists"],
                    "blocks":          s["blocks"],
                    "turnovers":       s["turnovers"],
                    "touches":         s["touches"],
                    "o_pts":           s["o_pts"],
                    "d_pts":           s["d_pts"],
                    "plus_minus":      s["plus_minus"],
                    "throwing_yards":  s["throwing_yards"],
                    "receiving_yards": s["catching_yards"],
                    "throws":          s["throws"],
                    "catches":         s["catches"],
                    "throw_err":       s["throw_err"],
                    "rec_err":         s["rec_err"],
                })

            photo_row = conn.execute(
                "SELECT PUL_photo_url FROM master_players WHERE Name = ? LIMIT 1", (name,)
            ).fetchone()
            results.append({
                "id":        name,
                "name":      name,
                "team":      team_name,
                "photo_url": photo_row["PUL_photo_url"] if photo_row else None,
                "career":    career,
                "seasons":   seasons,
            })

    return {"players": results}


@app.get("/api/pul/compare/teams")
def compare_pul_teams(
    ids: str = Query(..., description="Comma-separated team names"),
    season: int = Query(..., description="Season year"),
):
    """Compare PUL teams for a given season by aggregating player stats."""
    names = [n.strip() for n in ids.split(",") if n.strip()][:2]
    if not names:
        raise HTTPException(status_code=400, detail="No team names provided")

    with get_db() as conn:
        results = []
        for name in names:
            row = conn.execute(
                """SELECT
                       COUNT(DISTINCT player_name) AS players,
                       SUM(games_played)            AS total_gp,
                       SUM(goals)                   AS goals,
                       SUM(assists)                 AS assists,
                       SUM(second_ast)              AS hockey_assists,
                       SUM(blocks)                  AS blocks,
                       SUM(turnovers)               AS turnovers,
                       SUM(throwing_yards)          AS throwing_yards,
                       SUM(catching_yards)          AS catching_yards,
                       SUM(throws)                  AS throws,
                       SUM(catches)                 AS catches,
                       SUM(throw_err)               AS throw_err,
                       SUM(rec_err)                 AS rec_err
                   FROM pul_player_season_stats
                   WHERE team = ? AND season = ?""",
                (name, str(season)),
            ).fetchone()

            if not row or not row["total_gp"]:
                continue

            results.append({
                "team_name":      name,
                "season":         season,
                "players":        row["players"],
                "total_gp":       row["total_gp"],
                "goals":          row["goals"],
                "assists":        row["assists"],
                "hockey_assists": row["hockey_assists"],
                "blocks":         row["blocks"],
                "turnovers":      row["turnovers"],
                "throwing_yards": row["throwing_yards"],
                "catching_yards": row["catching_yards"],
                "throws":         row["throws"],
                "catches":        row["catches"],
                "throw_err":      row["throw_err"],
                "rec_err":        row["rec_err"],
            })

    return {"teams": results}


@app.get("/api/pul/compare/franchises")
def compare_pul_franchises(ids: str = Query(..., description="Comma-separated team names")):
    """Compare PUL franchises all-time by aggregating all season stats."""
    names = [n.strip() for n in ids.split(",") if n.strip()][:2]
    if not names:
        raise HTTPException(status_code=400, detail="No team names provided")

    with get_db() as conn:
        results = []
        for name in names:
            agg = conn.execute(
                """SELECT
                       COUNT(DISTINCT season)              AS seasons,
                       SUM(goals)                          AS goals,
                       SUM(assists)                        AS assists,
                       SUM(second_ast)                     AS hockey_assists,
                       SUM(blocks)                         AS blocks,
                       SUM(turnovers)                      AS turnovers,
                       SUM(throwing_yards)                 AS throwing_yards,
                       SUM(catching_yards)                 AS catching_yards,
                       MIN(CAST(season AS INTEGER))        AS first_year,
                       MAX(CAST(season AS INTEGER))        AS latest_year
                   FROM pul_player_season_stats
                   WHERE team = ? AND season != 'career'""",
                (name,),
            ).fetchone()

            if not agg or not agg["seasons"]:
                continue

            leaders = {}
            for stat in ("goals", "assists", "blocks"):
                leader = conn.execute(
                    f"""SELECT player_name, SUM({stat}) AS total
                           FROM pul_player_season_stats
                           WHERE team = ? AND season != 'career'
                           GROUP BY player_name
                           ORDER BY total DESC LIMIT 1""",
                    (name,),
                ).fetchone()
                leaders[stat] = (
                    {"name": leader["player_name"], "total": leader["total"]}
                    if leader and leader["total"] else None
                )

            results.append({
                "franchise_name":  name,
                "first_year":      agg["first_year"],
                "latest_year":     agg["latest_year"],
                "seasons":         agg["seasons"],
                "goals":           agg["goals"],
                "assists":         agg["assists"],
                "hockey_assists":  agg["hockey_assists"],
                "blocks":          agg["blocks"],
                "turnovers":       agg["turnovers"],
                "throwing_yards":  agg["throwing_yards"],
                "catching_yards":  agg["catching_yards"],
                "career_leaders":  leaders,
            })

    return {"franchises": results}


# ══════════════════════════════════════════════════════════════════════════════
# MLU  (Major League Ultimate) — stub endpoints (no DB tables yet)
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/mlu/teams")
def get_mlu_teams():
    """Return all MLU teams from mlu_teams, with year ranges from mlu_games."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT
                t.team_slug,
                t.team_name,
                t.division,
                t.active,
                MIN(g.year) AS first_year,
                MAX(g.year) AS latest_year
            FROM mlu_teams t
            LEFT JOIN (
                SELECT home_team_id AS team_slug, year FROM mlu_games
                UNION ALL
                SELECT away_team_id AS team_slug, year FROM mlu_games
            ) g ON g.team_slug = t.team_slug
            GROUP BY t.team_slug
            ORDER BY t.team_name
        """).fetchall()
    return {
        "teams": [
            {
                "franchise_id": r["team_slug"],
                "team_name":    r["team_name"],
                "division":     r["division"],
                "active":       bool(r["active"]),
                "first_year":   r["first_year"],
                "latest_year":  r["latest_year"],
            }
            for r in rows
        ]
    }


@app.get("/api/mlu/teams/{franchise_id}")
def get_mlu_team(franchise_id: str):
    """Return MLU team detail. Stub — 404 until DB tables exist."""
    raise HTTPException(status_code=404, detail="MLU team data not yet available")


@app.get("/api/mlu/standings")
def get_mlu_standings():
    """Return latest MLU standings. Stub — returns empty until DB tables exist."""
    return {"season": "", "teams": []}


@app.get("/api/mlu/players/search")
def search_mlu_players(q: str = Query("", description="Player name query")):
    """Search MLU players. Stub — returns empty list until DB tables exist."""
    return {"players": []}


@app.get("/api/mlu/compare/players")
def compare_mlu_players(ids: str = Query(..., description="Comma-separated player names")):
    """Compare MLU players. Stub — returns empty list until DB tables exist."""
    return {"players": []}


@app.get("/api/mlu/compare/franchises")
def compare_mlu_franchises(ids: str = Query(..., description="Comma-separated franchise_ids")):
    """Compare MLU franchises. Stub — returns empty list until DB tables exist."""
    return {"franchises": []}


@app.get("/api/mlu/games")
def get_mlu_games(limit: int = Query(100, le=500)):
    """Return MLU historical games with team names, newest first."""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT
                g.game_id,
                g.year,
                g.week,
                g.week_label,
                g.start_timestamp,
                g.away_team_id,
                g.home_team_id,
                g.away_score,
                g.home_score,
                g.status,
                ht.team_name AS home_team_name,
                at.team_name AS away_team_name
            FROM mlu_games g
            LEFT JOIN mlu_teams ht ON ht.team_slug = g.home_team_id
            LEFT JOIN mlu_teams at ON at.team_slug = g.away_team_id
            WHERE g.home_score IS NOT NULL AND g.away_score IS NOT NULL
            ORDER BY g.start_timestamp DESC
            LIMIT ?
        """, (limit,)).fetchall()
        return [dict(r) for r in rows]


_MLU_TEAM_NAMES = {
    "mlu_bos_whitecaps":   "Boston Whitecaps",
    "mlu_dc_current":      "DC Current",
    "mlu_nyc_rumble":      "New York Rumble",
    "mlu_pdx_stags":       "Portland Stags",
    "mlu_phi_spinners":    "Philadelphia Spinners",
    "mlu_sea_rainmakers":  "Seattle Rainmakers",
    "mlu_sf_dogfish":      "San Francisco Dogfish",
    "mlu_van_nighthawks":  "Vancouver Nighthawks",
}

def _mlu_team_name(slug: str) -> str:
    return _MLU_TEAM_NAMES.get(slug, slug)

def _mlu_format_date(ts: str) -> str:
    if not ts:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(ts).strftime("%b %d, %Y")
    except Exception:
        return ts

def _mlu_format_time(ts: str) -> str:
    if not ts:
        return None
    try:
        from datetime import datetime
        dt = datetime.fromisoformat(ts)
        return dt.strftime("%I:%M %p").lstrip('0')
    except Exception:
        return None


@app.get("/api/mlu/games/{game_id}")
def get_mlu_game(game_id: str):
    """Return MLU game detail."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM mlu_games WHERE game_id = ?", (game_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Game not found")
        url_row = conn.execute(
            "SELECT site, slug FROM game_urls WHERE game_id = ? AND league = 'mlu' LIMIT 1",
            (game_id,)
        ).fetchone()
    youtube_slug = None
    if url_row and url_row["site"] == "youtube":
        youtube_slug = url_row["slug"]
    return {
        "game_id":       row["game_id"],
        "year":          row["year"],
        "week":          row["week"],
        "date":          _mlu_format_date(row["start_timestamp"]),
        "time":          _mlu_format_time(row["start_timestamp"]),
        "home_team":     _mlu_team_name(row["home_team_id"]),
        "away_team":     _mlu_team_name(row["away_team_id"]),
        "home_team_id":  row["home_team_id"],
        "away_team_id":  row["away_team_id"],
        "home_score":    row["home_score"],
        "away_score":    row["away_score"],
        "status":        row["status"],
        "streaming_url": row["streaming_url"],
        "youtube_slug":  youtube_slug,
    }


# ── UFA Game Center ────────────────────────────────────────────────────────

def _ufa_format_date(ts: str):
    if not ts:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(ts).strftime("%b %d, %Y")
    except Exception:
        return ts

def _ufa_format_time(ts: str):
    if not ts:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(ts).strftime("%I:%M %p").lstrip('0')
    except Exception:
        return None


@app.get("/api/ufa/games")
def get_ufa_games():
    """Return all UFA games with team full names resolved from ufa_team_seasons."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT g.game_id, g.year, g.week, g.start_timestamp,
                      g.home_team_id, g.away_team_id,
                      g.home_score, g.away_score, g.status,
                      ht.full_name AS home_team,
                      at.full_name AS away_team
               FROM ufa_games g
               LEFT JOIN (
                   SELECT team_id, full_name
                   FROM ufa_team_seasons
                   WHERE (team_id, year) IN (
                       SELECT team_id, MAX(year) FROM ufa_team_seasons GROUP BY team_id
                   )
               ) ht ON ht.team_id = g.home_team_id
               LEFT JOIN (
                   SELECT team_id, full_name
                   FROM ufa_team_seasons
                   WHERE (team_id, year) IN (
                       SELECT team_id, MAX(year) FROM ufa_team_seasons GROUP BY team_id
                   )
               ) at ON at.team_id = g.away_team_id
               ORDER BY g.start_timestamp DESC"""
        ).fetchall()

    games = []
    for r in rows:
        yr = r["year"]
        games.append({
            "game_id":      r["game_id"],
            "year":         yr,
            "week":         r["week"].removeprefix("week-") if r["week"] else r["week"],
            "date":         _ufa_format_date(r["start_timestamp"]),
            "time":         _ufa_format_time(r["start_timestamp"]),
            "timestamp":    r["start_timestamp"],
            "home_team":    "Dallas Roughnecks" if r["home_team_id"] == "legion" and yr and int(yr) <= 2021 else (r["home_team"] or r["home_team_id"]),
            "away_team":    "Dallas Roughnecks" if r["away_team_id"] == "legion" and yr and int(yr) <= 2021 else (r["away_team"] or r["away_team_id"]),
            "home_team_id": r["home_team_id"],
            "away_team_id": r["away_team_id"],
            "home_score":   r["home_score"],
            "away_score":   r["away_score"],
            "status":       r["status"],
        })
    return {"games": games}


@app.get("/api/ufa/games/{game_id}")
def get_ufa_game(game_id: str):
    """Return UFA game detail with team names and YouTube slug from game_urls."""
    with get_db() as conn:
        row = conn.execute(
            """SELECT g.*,
                      ht.full_name AS home_team,
                      at.full_name AS away_team
               FROM ufa_games g
               LEFT JOIN (
                   SELECT team_id, full_name
                   FROM ufa_team_seasons
                   WHERE (team_id, year) IN (
                       SELECT team_id, MAX(year) FROM ufa_team_seasons GROUP BY team_id
                   )
               ) ht ON ht.team_id = g.home_team_id
               LEFT JOIN (
                   SELECT team_id, full_name
                   FROM ufa_team_seasons
                   WHERE (team_id, year) IN (
                       SELECT team_id, MAX(year) FROM ufa_team_seasons GROUP BY team_id
                   )
               ) at ON at.team_id = g.away_team_id
               WHERE g.game_id = ?""",
            (game_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Game not found")
        url_row = conn.execute(
            "SELECT site, slug FROM game_urls WHERE game_id = ? AND league = 'ufa' LIMIT 1",
            (game_id,)
        ).fetchone()

    youtube_slug = None
    if url_row and url_row["site"] == "youtube":
        youtube_slug = url_row["slug"]

    yr2 = row["year"]
    return {
        "game_id":       row["game_id"],
        "year":          yr2,
        "week":          row["week"].removeprefix("week-") if row["week"] else row["week"],
        "date":          _ufa_format_date(row["start_timestamp"]),
        "time":          _ufa_format_time(row["start_timestamp"]),
        "home_team":     "Dallas Roughnecks" if row["home_team_id"] == "legion" and yr2 and int(yr2) <= 2021 else (row["home_team"] or row["home_team_id"]),
        "away_team":     "Dallas Roughnecks" if row["away_team_id"] == "legion" and yr2 and int(yr2) <= 2021 else (row["away_team"] or row["away_team_id"]),
        "home_team_id":  row["home_team_id"],
        "away_team_id":  row["away_team_id"],
        "home_score":    row["home_score"],
        "away_score":    row["away_score"],
        "status":        row["status"],
        "streaming_url": row["streaming_url"],
        "youtube_slug":  youtube_slug,
    }


@app.get("/api/ufa/games/{game_id}/roster")
def get_ufa_game_roster(game_id: str):
    """Return per-team player stats for a game.

    Primary source: shownspace_player_stats (has jersey number + rich stats).
    Fallback: aggregate ufa_game_events (goals = receiver on score events,
    assists = thrower on score events, blocks = defender on block events,
    throwaways = type in ('Throwaway','Stall')).
    """
    with get_db() as conn:
        rows = conn.execute(
            """SELECT player_id, full_name, first_name, last_name,
                      team_id, jersey_number,
                      goals, assists, blocks, throwaways
               FROM shownspace_player_stats
               WHERE game_id = ?
               ORDER BY team_id, CAST(jersey_number AS INTEGER), full_name""",
            (game_id,)
        ).fetchall()

        if rows:
            result = {}
            for r in rows:
                tid = r["team_id"] or "unknown"
                result.setdefault(tid, []).append({
                    "player_id":     r["player_id"],
                    "name":          r["full_name"] or f"{r['first_name'] or ''} {r['last_name'] or ''}".strip(),
                    "number":        r["jersey_number"],
                    "goals":         r["goals"] or 0,
                    "assists":       r["assists"] or 0,
                    "blocks":        r["blocks"] or 0,
                    "throwaways":    r["throwaways"] or 0,
                })
            return {"source": "shownspace", "teams": result}

        # ── Fallback: derive from play-by-play ──────────────────────────────
        game = conn.execute(
            "SELECT home_team_id, away_team_id FROM ufa_games WHERE game_id = ?",
            (game_id,)
        ).fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")

        events = conn.execute(
            """SELECT type, thrower, receiver, defender, perspective
               FROM ufa_game_events
               WHERE game_id = ?""",
            (game_id,)
        ).fetchall()

        if not events:
            return {"source": "none", "teams": {}}

        # Build stats per player per team from one perspective's events only
        # Use home perspective if available, else first available
        persp_set = {e["perspective"] for e in events}
        use_persp = game["home_team_id"] if game["home_team_id"] in persp_set else next(iter(persp_set))

        from collections import defaultdict
        stats: dict[str, dict] = defaultdict(lambda: {"goals": 0, "assists": 0, "blocks": 0, "throwaways": 0, "team_id": None})

        team_ids = {game["home_team_id"], game["away_team_id"]}
        for e in events:
            t = e["type"]
            if t == "Goal":
                if e["receiver"]:
                    s = stats[e["receiver"]]
                    s["goals"] += 1
                    if e["perspective"]: s["team_id"] = e["perspective"]
                if e["thrower"]:
                    s = stats[e["thrower"]]
                    s["assists"] += 1
                    if e["perspective"]: s["team_id"] = e["perspective"]
            elif t in ("Block", "D"):
                if e["defender"]:
                    s = stats[e["defender"]]
                    s["blocks"] += 1
                    if e["perspective"]: s["team_id"] = e["perspective"]
            elif t in ("Throwaway", "Stall"):
                if e["thrower"]:
                    s = stats[e["thrower"]]
                    s["throwaways"] += 1
                    if e["perspective"]: s["team_id"] = e["perspective"]

        # Resolve display names from ufa_players
        slug_names = {
            r["player_slug"]: r["display_name"]
            for r in conn.execute("SELECT player_slug, display_name FROM ufa_players").fetchall()
        }

        result = {}
        for slug, s in stats.items():
            tid = s["team_id"] or "unknown"
            result.setdefault(tid, []).append({
                "player_id":  slug,
                "name":       slug_names.get(slug, slug),
                "number":     None,
                "goals":      s["goals"],
                "assists":    s["assists"],
                "blocks":     s["blocks"],
                "throwaways": s["throwaways"],
            })
        # Sort each team's roster by goals desc
        for tid in result:
            result[tid].sort(key=lambda p: (-p["goals"], -p["assists"], p["name"] or ""))

        return {"source": "events", "teams": result}


@app.get("/api/ufa/games/{game_id}/summary")
def get_ufa_game_summary(game_id: str):
    """Return aggregated game summary: quarter scores, team stats, top players."""
    with get_db() as conn:
        game = conn.execute(
            "SELECT home_team_id, away_team_id FROM ufa_games WHERE game_id = ?", (game_id,)
        ).fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")

        home_id = game["home_team_id"]
        away_id = game["away_team_id"]

        # ── Quarter scores from play-by-play ─────────────────────────────────
        PERIOD_END_TYPES = {28, 29, 30, 31, 32, 33}
        PERIOD_NEXT = {28: "Q2", 29: "Q3", 30: "Q4", 31: "OT1", 32: "OT2"}
        PERIOD_ORDER = ["Q1", "Q2", "Q3", "Q4", "OT1", "OT2"]

        def quarter_goals(perspective: str) -> dict:
            events = conn.execute(
                "SELECT type FROM ufa_game_events WHERE game_id=? AND perspective=? ORDER BY event_seq",
                (game_id, perspective),
            ).fetchall()
            cur = "Q1"
            goals: dict[str, int] = {}
            for e in events:
                t = e["type"]
                if t == 19:
                    goals[cur] = goals.get(cur, 0) + 1
                elif t in PERIOD_END_TYPES:
                    if cur not in goals:
                        goals[cur] = 0
                    cur = PERIOD_NEXT.get(t, cur)
            return goals

        home_q = quarter_goals("home")
        away_q = quarter_goals("away")

        all_periods = sorted(
            set(list(home_q.keys()) + list(away_q.keys())),
            key=lambda p: PERIOD_ORDER.index(p) if p in PERIOD_ORDER else 99,
        )
        quarters = [
            {"label": p, "home": home_q.get(p, 0), "away": away_q.get(p, 0)}
            for p in all_periods
        ]

        # ── Team stats from shownspace (aggregate player stats per team) ──────
        ps_agg = conn.execute(
            """SELECT team_id,
                      CASE WHEN team_id = ? THEN 1 ELSE 0 END AS is_home,
                      SUM(goals)             AS goals,
                      SUM(assists)           AS assists,
                      SUM(blocks)            AS blocks,
                      SUM(turnovers)         AS turnovers,
                      SUM(completions)       AS completions,
                      SUM(throw_attempts)    AS throw_attempts,
                      SUM(hucks_thrown)      AS hucks_thrown,
                      SUM(hucks_completed)   AS hucks_completed
               FROM shownspace_player_stats
               WHERE game_id = ?
               GROUP BY team_id""",
            (home_id, game_id),
        ).fetchall()

        has_shownspace = bool(ps_agg)

        # Also try to get holds/breaks from shownspace_team_stats
        ts_extra_map: dict[str, dict] = {}
        try:
            ts_rows = conn.execute(
                """WITH ranked AS (
                       SELECT *,
                              ROW_NUMBER() OVER (
                                  PARTITION BY team_id
                                  ORDER BY CASE WHEN line_type IS NULL THEN 0
                                                WHEN line_type = 'all'  THEN 1
                                                ELSE 2 END
                              ) AS rn
                       FROM shownspace_team_stats WHERE game_id = ?
                   )
                   SELECT team_id, is_home, holds, clean_holds, breaks,
                          hold_percent, break_percent,
                          offensive_possessions, defensive_possessions
                   FROM ranked WHERE rn = 1""",
                (game_id,),
            ).fetchall()
            for r in ts_rows:
                ts_extra_map[r["team_id"]] = dict(r)
        except Exception:
            pass

        team_stats: dict[str, dict] = {}
        for r in ps_agg:
            tid = r["team_id"]
            key = "home" if r["is_home"] else "away"
            ta   = r["throw_attempts"] or 0
            comp = r["completions"]    or 0
            hu_t = r["hucks_thrown"]   or 0
            hu_c = r["hucks_completed"] or 0
            ex   = ts_extra_map.get(tid, {})
            hp   = ex.get("hold_percent")
            bp   = ex.get("break_percent")
            team_stats[key] = {
                "team_id":        tid,
                "goals":          r["goals"]    or 0,
                "assists":        r["assists"]  or 0,
                "blocks":         r["blocks"]   or 0,
                "turnovers":      r["turnovers"] or 0,
                "completions":    comp,
                "throw_attempts": ta,
                "completion_pct": round(comp / ta * 100, 1) if ta else None,
                "hucks_thrown":   hu_t,
                "hucks_completed": hu_c,
                "huck_pct":       round(hu_c / hu_t * 100, 1) if hu_t else None,
                "holds":          ex.get("holds"),
                "breaks":         ex.get("breaks"),
                "o_possessions":  ex.get("offensive_possessions"),
                "hold_pct":       round(hp * 100, 1) if hp is not None else None,
                "break_pct":      round(bp * 100, 1) if bp is not None else None,
            }

        # ── Top players ───────────────────────────────────────────────────────
        ps_rows = conn.execute(
            """SELECT player_id, full_name, team_id, goals, assists, blocks,
                      turnovers, completions, throw_attempts
               FROM shownspace_player_stats
               WHERE game_id = ?
               ORDER BY (COALESCE(goals, 0) + COALESCE(assists, 0)) DESC,
                        COALESCE(blocks, 0) DESC""",
            (game_id,),
        ).fetchall()

        top_home: list[dict] = []
        top_away: list[dict] = []
        for r in ps_rows:
            ta_p   = r["throw_attempts"] or 0
            comp_p = r["completions"]    or 0
            p = {
                "name":           r["full_name"],
                "goals":          r["goals"]     or 0,
                "assists":        r["assists"]   or 0,
                "blocks":         r["blocks"]    or 0,
                "turnovers":      r["turnovers"] or 0,
                "completion_pct": round(comp_p / ta_p * 100, 1) if ta_p else None,
            }
            if r["team_id"] == home_id:
                if len(top_home) < 6:
                    top_home.append(p)
            else:
                if len(top_away) < 6:
                    top_away.append(p)

        return {
            "has_events":    bool(quarters),
            "has_shownspace": has_shownspace,
            "home_team_id":  home_id,
            "away_team_id":  away_id,
            "quarters":      quarters,
            "team_stats":    team_stats,
            "top_players":   {"home": top_home, "away": top_away},
        }


@app.get("/api/ufa/games/{game_id}/h2h")
def get_ufa_game_h2h(game_id: str):
    """Return head-to-head record between the two teams up to and including this game."""
    with get_db() as conn:
        game = conn.execute(
            "SELECT home_team_id, away_team_id, start_timestamp, year FROM ufa_games WHERE game_id = ?",
            (game_id,)
        ).fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")

        t1 = game["home_team_id"]
        t2 = game["away_team_id"]
        ts = game["start_timestamp"]

        rows = conn.execute(
            """SELECT g.game_id, g.year, g.start_timestamp,
                      g.home_team_id, g.away_team_id,
                      g.home_score, g.away_score
               FROM ufa_games g
               WHERE ((g.home_team_id = ? AND g.away_team_id = ?)
                   OR (g.home_team_id = ? AND g.away_team_id = ?))
                 AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
                 AND g.start_timestamp <= ?
               ORDER BY g.start_timestamp""",
            (t1, t2, t2, t1, ts)
        ).fetchall()

    t1_wins = 0
    t2_wins = 0
    games_out = []
    for r in rows:
        hs = r["home_score"]
        as_ = r["away_score"]
        winner = r["home_team_id"] if hs > as_ else (r["away_team_id"] if as_ > hs else None)
        if winner == t1:
            t1_wins += 1
        elif winner == t2:
            t2_wins += 1
        games_out.append({
            "game_id":      r["game_id"],
            "year":         r["year"],
            "date":         _ufa_format_date(r["start_timestamp"]),
            "home_team_id": r["home_team_id"],
            "away_team_id": r["away_team_id"],
            "home_score":   hs,
            "away_score":   as_,
            "winner":       winner,
        })

    return {
        "team1":      t1,
        "team2":      t2,
        "team1_wins": t1_wins,
        "team2_wins": t2_wins,
        "games":      games_out,
    }


# ── /api/usau/tournaments ─────────────────────────────────────────────────────
_DIV_ORDER = ['M', 'S', 'A', 'B', 'C', 'D', 'X']

def _div_abbrev(label: str) -> str:
    dl = label.lower().replace('-', ' ')
    if 'beach' in dl:                                                         return 'X'
    if 'great grand' in dl or 'grandmaster' in dl or 'grand master' in dl or 'master' in dl: return 'M'
    if 'middle school' in dl or 'middle' in dl:                               return 'D'
    if 'high school' in dl:                                                   return 'C'
    if 'ycc' in dl or 'youth club' in dl or 'youth' in dl:                   return 'B'
    if 'college' in dl or 'collegiate' in dl:                                 return 'A'
    return 'S'

def _divisions_str(raw: str | None) -> str:
    if not raw:
        return ''
    codes = sorted(
        {_div_abbrev(d.strip()) for d in raw.split(',') if d.strip()},
        key=lambda c: _DIV_ORDER.index(c) if c in _DIV_ORDER else 99
    )
    return ''.join(codes)


@app.get("/api/usau/tournaments")
def get_usau_tournaments(
    q:     str = Query(""),
    year:  int = Query(None),
    level: str = Query(""),
    page:  int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=2000),
):
    """Return paginated list of tournaments from the events table, with game count."""
    wheres = ["1=1"]
    params: list = []

    if q:
        wheres.append("(e.event_title LIKE ? OR e.city LIKE ? OR e.state LIKE ?)")
        like = f"%{q}%"
        params += [like, like, like]
    if year:
        wheres.append("e.season_year = ?")
        params.append(year)
    if level:
        wheres.append("e.competition_level = ?")
        params.append(level)

    # Only show tournaments that have already ended (or started, if no end date is stored)
    wheres.append("COALESCE(e.date_end, e.date_start, '1900-01-01') <= DATE('now')")

    where_sql = " AND ".join(wheres)

    with get_db() as conn:
        total_row = conn.execute(
            f"""SELECT COUNT(DISTINCT e.event_slug)
                FROM events e
                WHERE {where_sql}""",
            params,
        ).fetchone()
        total = total_row[0] if total_row else 0

        rows = conn.execute(
            f"""SELECT
                    e.event_slug,
                    MAX(e.event_title)      AS event_title,
                    MAX(e.date_start)       AS date_start,
                    MAX(e.date_end)         AS date_end,
                    MAX(e.city)             AS city,
                    MAX(e.state)            AS state,
                    MAX(e.season_year)      AS season_year,
                    MAX(e.competition_level) AS competition_level,
                    MAX(e.event_url)        AS event_url,
                    GROUP_CONCAT(DISTINCT e.gender) AS genders,
                    COUNT(DISTINCT g.event_game_id) AS game_count,
                    GROUP_CONCAT(DISTINCT g.division_label) AS raw_division_labels,
                    COUNT(DISTINCT et.event_team_id) AS team_count
                FROM events e
                LEFT JOIN games g ON g.event_slug = e.event_slug
                LEFT JOIN usau_event_teams et ON et.event_slug = e.event_slug
                WHERE {where_sql}
                GROUP BY e.event_slug
                ORDER BY MAX(e.date_start) DESC NULLS LAST, e.event_slug DESC
                LIMIT ? OFFSET ?""",
            params + [limit, page * limit],
        ).fetchall()

        # Distinct years for filter dropdown
        year_rows = conn.execute(
            "SELECT DISTINCT season_year FROM events WHERE season_year IS NOT NULL ORDER BY season_year DESC"
        ).fetchall()

        # Distinct competition levels
        level_rows = conn.execute(
            "SELECT DISTINCT competition_level FROM events WHERE competition_level IS NOT NULL ORDER BY competition_level"
        ).fetchall()

    return {
        "total":    total,
        "page":     page,
        "limit":    limit,
        "tournaments": [
            {
                "event_slug":        r["event_slug"],
                "event_title":       r["event_title"],
                "date_start":        r["date_start"],
                "date_end":          r["date_end"],
                "city":              r["city"],
                "state":             r["state"],
                "season_year":       r["season_year"],
                "competition_level": r["competition_level"],
                "event_url":         r["event_url"],
                "genders":           r["genders"],
                "game_count":        r["game_count"],
                "team_count":        r["team_count"],
                "divisions":         _divisions_str(r["raw_division_labels"]),
            }
            for r in rows
        ],
        "years":  [r["season_year"] for r in year_rows],
        "levels": [r["competition_level"] for r in level_rows],
    }


@app.get("/api/usau/tournament/{event_slug}/games")
def get_usau_tournament_games(event_slug: str):
    """Return all games for a specific tournament (event_slug)."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT g.event_game_id, g.event_slug, g.division_label,
                      g.home_event_team_id, g.away_event_team_id,
                      ht.team_name AS home_team, at2.team_name AS away_team,
                      hut.logo_filename AS home_logo, aut.logo_filename AS away_logo,
                      g.home_score, g.away_score, g.game_date, g.game_time,
                      g.round_label, g.pool_name, g.bracket_section, g.round_context, g.field,
                      g.has_match_report
               FROM games g
               LEFT JOIN usau_event_teams ht  ON ht.event_team_id  = g.home_event_team_id
               LEFT JOIN usau_event_teams at2 ON at2.event_team_id = g.away_event_team_id
               LEFT JOIN usau_teams hut ON hut.usau_team_id = ht.usau_team_id
               LEFT JOIN usau_teams aut ON aut.usau_team_id = at2.usau_team_id
               WHERE g.event_slug = ?
               ORDER BY g.game_date, g.game_time""",
            (event_slug,),
        ).fetchall()

    games = []
    for r in rows:
        home = _usau_strip_seed(r["home_team"])
        away = _usau_strip_seed(r["away_team"])
        round_disp = r["round_label"] or r["round_context"]
        games.append({
            "game_id":        r["event_game_id"],
            "event_slug":     r["event_slug"],
            "division_label": r["division_label"],
            "date":           r["game_date"],
            "time":           r["game_time"],
            "home_team":      home,
            "away_team":      away,
            "home_logo":      r["home_logo"],
            "away_logo":      r["away_logo"],
            "home_score":     r["home_score"],
            "away_score":     r["away_score"],
            "round":          round_disp,
            "round_context":  r["round_context"],
            "bracket_section": r["bracket_section"],
            "pool":           r["pool_name"],
            "field":          r["field"],
            "has_match_report": bool(r["has_match_report"]),
        })

    return {"games": games}


@app.get("/api/usau/tournament/{event_slug}/nationals")
def get_tournament_nationals_finishers(event_slug: str, division_label: str = Query("")):
    """Return historical finish data from usau_nationals for the year/level/division of a tournament."""
    year = _usau_year_from_slug(event_slug)
    if not year:
        return {"finishers": []}

    slug_lower = event_slug.lower()
    is_d3 = "d-iii" in slug_lower or "d3" in slug_lower or "d-3" in slug_lower
    d = (division_label or "").lower()

    if "mixed" in d:
        gender, comp_level, div = "X", "Club", None
    elif "women" in d or "female" in d:
        gender = "W"
        if "college" in d or "d-i" in d or "d1" in d or "collegiate" in d:
            comp_level, div = "College", "3" if is_d3 else "1"
        else:
            comp_level, div = "Club", None
    elif "men" in d:
        gender = "M"
        if "college" in d or "d-i" in d or "d1" in d or "collegiate" in d:
            comp_level, div = "College", "3" if is_d3 else "1"
        else:
            comp_level, div = "Club", None
    else:
        return {"finishers": []}

    div_clause = "AND un.division = ?" if div is not None else "AND (un.division IS NULL OR un.division = '')"
    params = [year, comp_level, gender]
    if div is not None:
        params.append(div)

    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT un.finish, un.team_name, ut.logo_filename
               FROM usau_nationals un
               LEFT JOIN usau_teams ut ON ut.usau_team_id = un.usau_team_id
               WHERE un.year = ? AND un.competition_level = ? AND un.gender = ?
                 {div_clause}""",
            params,
        ).fetchall()

    def _finish_num(f):
        if not f:
            return None
        m = re.match(r"T?(\d+)", str(f))
        return int(m.group(1)) if m else None

    finishers = []
    for r in rows:
        n = _finish_num(r["finish"])
        if n is None or n > 16:
            continue
        finishers.append({"place": n, "team": r["team_name"], "logo": r["logo_filename"]})

    finishers.sort(key=lambda x: x["place"])
    return {"finishers": finishers}


# ── /api/usau/games ───────────────────────────────────────────────────────────

_USAU_NATIONALS_SLUG_PATTERNS = re.compile(
    r"national|college.champion|club.champion", re.IGNORECASE
)
_SEED_STRIP_RE = re.compile(r"\s*\(\d+\)\s*$")

def _usau_strip_seed(name: str | None) -> str | None:
    if not name:
        return name
    return _SEED_STRIP_RE.sub("", name).strip()

def _usau_year_from_slug(slug: str | None) -> int | None:
    if not slug:
        return None
    m = re.search(r"\b(20\d{2})\b", slug)
    return int(m.group(1)) if m else None

def _usau_level_from_division(division_label: str | None, event_slug: str | None = None) -> str | None:
    """Convert division_label (+ optional event_slug) → human level string."""
    if not division_label:
        return None
    d = division_label.replace("-", " ").lower()
    slug = (event_slug or "").lower()
    is_d3 = "d-iii" in slug or "d3" in slug or "d-3" in slug
    if "mixed" in d:
        return "Club Mixed"
    if "women" in d or "female" in d:
        if "college" in d or "d-i" in d or "d1" in d or "collegiate" in d:
            return "College D3 Women" if is_d3 else "College D1 Women"
        return "Club Women"
    if "men" in d or "male" in d:
        if "college" in d or "d-i" in d or "d1" in d or "collegiate" in d:
            return "College D3 Men" if is_d3 else "College D1 Men"
        return "Club Men"
    return division_label


# ── /api/usau/leaderboard ─────────────────────────────────────────────────────

@app.get("/api/usau/leaderboard")
def get_usau_leaderboard(
    year:     int = Query(None),
    level:    str = Query(""),      # "D1", "D3", "Club"
    division: str = Query(""),      # "Men", "Women", "Mixed"
    sort:     str = Query("goals"),
    limit:    int = Query(200),
):
    """Aggregated player leaderboard from usau_nationals_player_stats."""
    VALID_SORTS = {"goals", "assists", "blocks", "turns", "plus_minus", "games"}
    if sort not in VALID_SORTS:
        sort = "goals"
    limit = min(max(1, limit), 500)

    level_sql = ""
    if level == "D1":
        level_sql = "AND et.competition_level = 'College' AND g.event_slug NOT LIKE '%D-III%' AND g.event_slug NOT LIKE '%D-3%'"
    elif level == "D3":
        level_sql = "AND (g.event_slug LIKE '%D-III%' OR g.event_slug LIKE '%D-3%')"
    elif level == "Club":
        level_sql = "AND et.competition_level = 'Club'"

    wheres = ["ps.event_team_id IS NOT NULL"]
    params: list = []
    if year:
        wheres.append("sy.season_year = ?")
        params.append(year)
    if division:
        wheres.append("et.gender_division = ?")
        params.append(division)
    where_sql = "WHERE " + " AND ".join(wheres)

    with get_db() as conn:
        rows = conn.execute(f"""
            WITH slug_years AS (
                SELECT event_slug, MAX(season_year) AS season_year
                FROM events GROUP BY event_slug
            )
            SELECT
                ps.player_name,
                SUBSTR(MAX(sy.season_year || '|' ||
                    CASE
                        WHEN g.event_slug LIKE '%D-III%'
                          OR g.event_slug LIKE '%D-3%'  THEN 'College D3'
                        WHEN et.competition_level = 'College' THEN 'College D1'
                        ELSE 'Club'
                    END), 6)                                AS level,
                SUBSTR(MAX(sy.season_year || '|' || COALESCE(et.gender_division, '')), 6)
                                                            AS division,
                SUBSTR(MAX(sy.season_year || '|' || COALESCE(et.team_name, '')), 6)
                                                            AS team,
                MAX(sy.season_year)                         AS latest_year,
                COUNT(DISTINCT ps.event_game_id)            AS games,
                SUM(COALESCE(ps.goals,   0))                AS goals,
                SUM(COALESCE(ps.assists, 0))                AS assists,
                SUM(COALESCE(ps.ds,      0))                AS blocks,
                SUM(COALESCE(ps.turns,   0))                AS turns,
                SUM(COALESCE(ps.goals,0) + COALESCE(ps.assists,0)
                    - COALESCE(ps.turns,0))                 AS plus_minus
            FROM usau_nationals_player_stats ps
            JOIN games g              ON g.event_game_id   = ps.event_game_id
            LEFT JOIN usau_event_teams et ON et.event_team_id = ps.event_team_id
            JOIN slug_years sy         ON sy.event_slug     = g.event_slug
            {where_sql}
            {level_sql}
            GROUP BY ps.player_name
            HAVING games >= 1
            ORDER BY {sort} DESC
            LIMIT {int(limit)}
        """, params).fetchall()

        year_rows = conn.execute("""
            SELECT DISTINCT sy.season_year AS year
            FROM usau_nationals_player_stats ps
            JOIN games g ON g.event_game_id = ps.event_game_id
            JOIN (SELECT event_slug, MAX(season_year) AS season_year
                  FROM events GROUP BY event_slug) sy ON sy.event_slug = g.event_slug
            WHERE sy.season_year IS NOT NULL
            ORDER BY year DESC
        """).fetchall()

    return {
        "players": [dict(r) for r in rows],
        "years":   [r["year"] for r in year_rows],
    }


@app.get("/api/usau/games")
def get_usau_games():
    """Return all USAU nationals games from the games table with team names."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT g.event_game_id, g.event_slug, g.division_label,
                      g.home_event_team_id, g.away_event_team_id,
                      ht.team_name AS home_team, at2.team_name AS away_team,
                      hut.logo_filename AS home_logo, aut.logo_filename AS away_logo,
                      g.home_score, g.away_score, g.game_date, g.game_time,
                      g.round_label, g.pool_name, g.bracket_section, g.round_context, g.field,
                      g.has_match_report
               FROM games g
               LEFT JOIN usau_event_teams ht  ON ht.event_team_id  = g.home_event_team_id
               LEFT JOIN usau_event_teams at2 ON at2.event_team_id = g.away_event_team_id
               LEFT JOIN usau_teams hut ON hut.usau_team_id = ht.usau_team_id
               LEFT JOIN usau_teams aut ON aut.usau_team_id = at2.usau_team_id
               ORDER BY g.event_slug DESC, g.game_date, g.game_time"""
        ).fetchall()

    games = []
    for r in rows:
        slug = r["event_game_id"] or ""
        event_slug = r["event_slug"] or ""
        # Filter to nationals / championships events only
        if not _USAU_NATIONALS_SLUG_PATTERNS.search(event_slug):
            continue
        year = _usau_year_from_slug(event_slug)
        home = _usau_strip_seed(r["home_team"])
        away = _usau_strip_seed(r["away_team"])
        round_disp = r["round_label"] if r["round_context"] == "Championship Bracket" else r["round_context"]
        games.append({
            "game_id":       r["event_game_id"],
            "event_slug":    event_slug,
            "year":          year,
            "level":         _usau_level_from_division(r["division_label"], r["event_slug"]),
            "division_label": r["division_label"],
            "date":          r["game_date"],
            "time":          r["game_time"],
            "home_team":     home,
            "away_team":     away,
            "home_team_id":  r["home_event_team_id"],
            "away_team_id":  r["away_event_team_id"],
            "home_logo":     r["home_logo"],
            "away_logo":     r["away_logo"],
            "home_score":    r["home_score"],
            "away_score":    r["away_score"],
            "round":         round_disp,
            "pool":          r["pool_name"],
            "has_progression": False,  # enriched below
        })

    # Mark which games have progression data
    if games:
        with get_db() as conn:
            prog_ids = {r[0] for r in conn.execute(
                "SELECT DISTINCT game_id FROM usau_nationals_game_progression"
            ).fetchall()}
        for g in games:
            g["has_progression"] = g["game_id"] in prog_ids

    return {"games": games}


@app.get("/api/usau/games/{game_id}")
def get_usau_game(game_id: str):
    """Return USAU game detail."""
    with get_db() as conn:
        row = conn.execute(
            """SELECT g.event_game_id, g.event_slug, g.division_label,
                      g.home_event_team_id, g.away_event_team_id,
                      ht.team_name AS home_team, at2.team_name AS away_team,
                      hut.logo_filename AS home_logo, aut.logo_filename AS away_logo,
                      g.home_score, g.away_score, g.game_date, g.game_time,
                      g.round_label, g.pool_name, g.bracket_section, g.round_context, g.field,
                      g.has_match_report, g.match_report_url
               FROM games g
               LEFT JOIN usau_event_teams ht  ON ht.event_team_id  = g.home_event_team_id
               LEFT JOIN usau_event_teams at2 ON at2.event_team_id = g.away_event_team_id
               LEFT JOIN usau_teams hut ON hut.usau_team_id = ht.usau_team_id
               LEFT JOIN usau_teams aut ON aut.usau_team_id = at2.usau_team_id
               WHERE g.event_game_id = ?""",
            (game_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Game not found")
        url_row = conn.execute(
            "SELECT site, slug FROM game_urls WHERE game_id = ? AND league = 'usau' LIMIT 1",
            (game_id,)
        ).fetchone()

    youtube_slug = None
    if url_row and url_row["site"] == "youtube":
        youtube_slug = url_row["slug"]

    event_slug = row["event_slug"] or ""
    year = _usau_year_from_slug(event_slug)
    home = _usau_strip_seed(row["home_team"])
    away = _usau_strip_seed(row["away_team"])
    round_disp = row["round_label"] if row["round_context"] == "Championship Bracket" else row["round_context"]

    return {
        "game_id":        row["event_game_id"],
        "event_slug":     event_slug,
        "year":           year,
        "level":          _usau_level_from_division(row["division_label"], event_slug),
        "date":           row["game_date"],
        "time":           row["game_time"],
        "home_team":      home,
        "away_team":      away,
        "home_team_id":   row["home_event_team_id"],
        "away_team_id":   row["away_event_team_id"],
        "home_logo":      row["home_logo"],
        "away_logo":      row["away_logo"],
        "home_score":     row["home_score"],
        "away_score":     row["away_score"],
        "round":          round_disp,
        "pool":           row["pool_name"],
        "match_report_url": row["match_report_url"],
        "youtube_slug":   youtube_slug,
    }


@app.get("/api/usau/games/{game_id}/progression")
def get_usau_game_progression(game_id: str):
    """Return point-by-point score progression for a game."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT point, home_score, away_score, home_team_name, away_team_name
               FROM usau_nationals_game_progression
               WHERE game_id = ?
               ORDER BY point""",
            (game_id,)
        ).fetchall()
        if not rows:
            return {"points": [], "home_team": None, "away_team": None}
        home_name = _usau_strip_seed(rows[0]["home_team_name"])
        away_name = _usau_strip_seed(rows[0]["away_team_name"])
    return {
        "home_team": home_name,
        "away_team": away_name,
        "points": [
            {"point": r["point"], "home": r["home_score"], "away": r["away_score"]}
            for r in rows
        ],
    }


@app.get("/api/usau/games/{game_id}/box_score")
def get_usau_game_box_score(game_id: str):
    """Return per-team player stats for a USAU game.

    Primary source: usau_nationals_player_stats (has event_team_id).
    Fallback: usau_nationals_box_scores (uniform_number + G/A/B/T, no team id).
    """
    with get_db() as conn:
        # Primary: usau_nationals_player_stats
        rows = conn.execute(
            """SELECT ps.event_team_id, ps.player_name, ps.jersey_number,
                      ps.goals, ps.assists, ps.ds AS blocks, ps.turns AS turnovers,
                      et.team_name
               FROM usau_nationals_player_stats ps
               LEFT JOIN usau_event_teams et ON et.event_team_id = ps.event_team_id
               WHERE ps.event_game_id = ?
               ORDER BY et.team_name, CAST(ps.jersey_number AS INTEGER), ps.player_name""",
            (game_id,)
        ).fetchall()

        if rows:
            teams: dict = {}
            for r in rows:
                tid = r["event_team_id"] or "unknown"
                tname = _usau_strip_seed(r["team_name"]) or tid
                if tid not in teams:
                    teams[tid] = {"team_name": tname, "players": []}
                teams[tid]["players"].append({
                    "name":       r["player_name"],
                    "number":     r["jersey_number"],
                    "goals":      r["goals"] or 0,
                    "assists":    r["assists"] or 0,
                    "blocks":     r["blocks"] or 0,
                    "turnovers":  r["turnovers"] or 0,
                })
            return {"source": "player_stats", "teams": teams}

        # Fallback: usau_nationals_box_scores
        rows2 = conn.execute(
            """SELECT bs.player_name, bs.uniform_number,
                      bs.goals, bs.assists, bs.blocks, bs.turnovers
               FROM usau_nationals_box_scores bs
               WHERE bs.game_id = ?
               ORDER BY CAST(bs.uniform_number AS INTEGER), bs.player_name""",
            (game_id,)
        ).fetchall()

        if rows2:
            # Try to get home/away team names from game_progression
            prog = conn.execute(
                """SELECT DISTINCT home_team_name, away_team_name,
                          home_event_team_id, away_event_team_id
                   FROM usau_nationals_game_progression
                   WHERE game_id = ? LIMIT 1""",
                (game_id,)
            ).fetchone()
            home_tid = prog["home_event_team_id"] if prog else "home"
            away_tid = prog["away_event_team_id"] if prog else "away"
            home_name = _usau_strip_seed(prog["home_team_name"]) if prog else "Home"
            away_name = _usau_strip_seed(prog["away_team_name"]) if prog else "Away"
            # box_scores has no team assignment — return as single group
            players = [{
                "name":      r["player_name"],
                "number":    r["uniform_number"],
                "goals":     r["goals"] or 0,
                "assists":   r["assists"] or 0,
                "blocks":    r["blocks"] or 0,
                "turnovers": r["turnovers"] or 0,
            } for r in rows2]
            return {
                "source": "box_scores",
                "teams": {
                    "all": {"team_name": f"{home_name} + {away_name}", "players": players}
                },
            }

    return {"source": "none", "teams": {}}


# ── /api/news ─────────────────────────────────────────────────────────────────
import xml.etree.ElementTree as _ET
import json as _json
from pathlib import Path as _CachePath

_FEED_BASE      = "https://ultiworld.com/feed/"
_BATCH_SIZE     = 10    # pages fetched in parallel per batch
_MAX_PAGES      = 100   # scan up to 1000 articles to fill all divisions
_REFRESH_SECS   = 900   # re-scan every 15 min in background
_CACHE_FILE     = _CachePath(os.environ.get("UFA_STATE_DIR") or _CachePath(__file__).resolve().parents[1] / "data" / "state") / "news_cache.json"

# Tags checked in PRIORITY ORDER — first match wins, article goes to that
# division only.  College first: cross-tagged articles (e.g. "UFA players
# at D-I Nationals") are about college, not pro.
_DIV_PRIORITY = ["college", "youth", "pro", "club"]

# ALL tags use exact equality against lowercased Ultiworld category names.
# Confirmed from live feed inspection — no substring guessing.
_DIV_EXACT: dict[str, frozenset] = {
    "pro": frozenset({
        "ufa", "ufa 2026", "pul", "pul 2026", "wul", "wul 2026",
        "buzzer beater", "buzzer beater 2026",
        "premier ultimate league", "premier ultimate league 2026",
        "western ultimate league", "western ultimate league 2026",
    }),
    "youth": frozenset({
        "high school", "high school national invite",
        "usau-high-school", "usau youth", "usau youth club",
        "u20", "u24", "junior",
    }),
    "college": frozenset({
        "college", "diii", "college championships",
        "d-i college championships", "d-iii college championships",
        "2026 d-i college championships", "2026 d-iii college championships",
        "college regionals 2026", "college power rankings",
        "college power rankings 2026", "2026 college ultimate",
        "college ultimate",
    }),
    "club": frozenset({
        "usau club", "usau-club",
        "europe", "eurozone",
        "wfdf", "wucc", "wbuc 2025", "xeucf",
    }),
}

_FEED_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
}

# In-memory cache — pre-populated from disk on startup, refreshed in background
_NEWS_CACHE: dict[str, list] = {d: [] for d in _DIV_PRIORITY}


def _load_disk_cache() -> None:
    try:
        data = _json.loads(_CACHE_FILE.read_text())
        for div in _DIV_PRIORITY:
            if div in data and data[div]:
                _NEWS_CACHE[div] = data[div]
    except Exception:
        pass


def _save_disk_cache() -> None:
    try:
        _CACHE_FILE.write_text(_json.dumps(_NEWS_CACHE, indent=2))
    except Exception:
        pass


def _parse_feed_items(xml_bytes: bytes) -> list[dict]:
    root = _ET.fromstring(xml_bytes)
    ns_dc = "{http://purl.org/dc/elements/1.1/}creator"
    items = []
    for item in root.findall(".//item"):
        def _t(tag: str, _i=item) -> str:
            el = _i.find(tag)
            return (el.text or "").strip() if el is not None else ""
        author_el = item.find("author") or item.find(ns_dc)
        cats = [c.text.strip().lower() for c in item.findall("category") if c.text]
        items.append({
            "title":      _t("title"),
            "link":       _t("link"),
            "pubDate":    _t("pubDate"),
            "author":     (author_el.text or "").strip() if author_el is not None else "",
            "categories": cats,
        })
    return items


# Simple title-word checks — first match wins.
# "college" in title → college. "ufa/wul/pul" in title → pro. etc.
_TITLE_WORDS: list[tuple[str, list[str]]] = [
    ("college", ["college"]),
    ("youth",   ["high school", "u20", "u24", "junior nationals", "ycc"]),
    ("pro",     ["ufa", "pul", "wul", "buzzer beater", "better box score"]),
    ("club",    ["club"]),
]


def _classify(item: dict) -> str | None:
    """Title first, category tags second. First match wins."""
    title = item["title"].lower()
    for div, words in _TITLE_WORDS:
        if any(w in title for w in words):
            return div
    cats = set(item["categories"])
    for div in _DIV_PRIORITY:
        if cats & _DIV_EXACT[div]:
            return div
    return None


async def _do_refresh() -> None:
    """Scan feed pages in parallel batches; assign each article to exactly one
    division (first match by priority wins) until all divisions have 5."""
    found: dict[str, list] = {d: [] for d in _DIV_PRIORITY}
    seen: set[str] = set()
    page = 1
    async with httpx.AsyncClient(timeout=12, follow_redirects=True) as client:
        while any(len(found[d]) < 10 for d in _DIV_PRIORITY) and page <= _MAX_PAGES:
            batch = range(page, min(page + _BATCH_SIZE, _MAX_PAGES + 1))
            responses = await _asyncio.gather(
                *[client.get(f"{_FEED_BASE}?paged={p}", headers=_FEED_HEADERS)
                  for p in batch],
                return_exceptions=True,
            )
            got_any = False
            for resp in responses:
                if isinstance(resp, Exception):
                    continue
                try:
                    items = _parse_feed_items(resp.content)
                    if not items:
                        continue
                    got_any = True
                    for item in items:
                        link = item["link"]
                        if link in seen:
                            continue
                        seen.add(link)
                        div = _classify(item)
                        if div and len(found[div]) < 10:
                            found[div].append(item)
                except Exception:
                    pass
            if not got_any:
                break
            page += _BATCH_SIZE

    changed = False
    for div in _DIV_PRIORITY:
        if found[div]:
            _NEWS_CACHE[div] = [
                {"title": i["title"], "link": i["link"],
                 "pubDate": i["pubDate"], "author": i["author"]}
                for i in found[div][:10]
            ]
            changed = True
    if changed:
        _save_disk_cache()


async def _refresh_loop() -> None:
    while True:
        try:
            await _do_refresh()
        except Exception:
            pass
        await _asyncio.sleep(_REFRESH_SECS)


@app.on_event("startup")
async def _news_startup() -> None:
    _load_disk_cache()                          # serve from disk immediately
    _asyncio.create_task(_refresh_loop())       # keep refreshing in background


@app.get("/api/news")
async def get_news(division: str = Query(...)):
    div = division.lower()
    if div not in _DIV_EXACT:
        raise HTTPException(status_code=400, detail=f"Unknown division '{div}'")
    return {"items": _NEWS_CACHE.get(div, [])}


@app.get("/api/news/recent")
async def get_news_recent(limit: int = Query(default=5, ge=1, le=20)):
    """Return the N most recent articles across all divisions, deduped by link."""
    from email.utils import parsedate_to_datetime
    seen: set[str] = set()
    all_items: list[dict] = []
    for div in _DIV_PRIORITY:
        for item in _NEWS_CACHE.get(div, []):
            if item["link"] not in seen:
                seen.add(item["link"])
                all_items.append(item)
    # Sort by pubDate descending
    def _ts(item: dict) -> float:
        try:
            return parsedate_to_datetime(item["pubDate"]).timestamp()
        except Exception:
            return 0.0
    all_items.sort(key=_ts, reverse=True)
    return {"items": all_items[:limit]}


# ── /api/usau/games ───────────────────────────────────────────────────────────

_USAU_NATIONALS_SLUG_PATTERNS = re.compile(
    r"national|college.champion|club.champion", re.IGNORECASE
)
_SEED_STRIP_RE = re.compile(r"\s*\(\d+\)\s*$")

def _usau_strip_seed(name):
    if not name:
        return name
    return _SEED_STRIP_RE.sub("", name).strip()

def _usau_year_from_slug(slug):
    if not slug:
        return None
    m = re.search(r"\b(20\d{2})\b", slug)
    return int(m.group(1)) if m else None

def _usau_level_from_division(division_label, event_slug=None):
    if not division_label:
        return None
    d = division_label.replace("-", " ").lower()
    slug = (event_slug or "").lower()
    is_d3 = "d-iii" in slug or "d3" in slug or "d-3" in slug
    if "mixed" in d:
        return "Club Mixed"
    if "women" in d or "female" in d:
        if "college" in d or "d-i" in d or "d1" in d or "collegiate" in d:
            return "College D3 Women" if is_d3 else "College D1 Women"
        return "Club Women"
    if "men" in d or "male" in d:
        if "college" in d or "d-i" in d or "d1" in d or "collegiate" in d:
            return "College D3 Men" if is_d3 else "College D1 Men"
        return "Club Men"
    return division_label


# ── /api/usau/official-rankings ──────────────────────────────────────────────

_OFF_RNKS_CACHE: dict | None = None
_OFF_RNKS_TS:    float       = 0.0
_OFF_RNKS_TTL:   float       = 12 * 3600  # refresh every 12 h


def _apos_norm(s: str) -> str:
    """Collapse curly/special apostrophes to a plain straight apostrophe."""
    return s.replace('\u2019', "'").replace('\u2018', "'").replace('\u02bc', "'")


def _scrape_usau_off_rnks(url: str, div_specs: list, limit: int):
    """Scrape one USAU rankings page and return (divisions_list, updated_str).

    div_specs: list of (html_heading_text, display_name) tuples.
    The heading text must use straight apostrophes; curly apostrophes on the
    live page are normalised before comparison.
    """
    resp = httpx.get(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; UltiRef/1.0)"},
        timeout=15.0,
        follow_redirects=True,
    )
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # "Last Modified / Last updated" date
    updated = None
    for el in soup.find_all(string=re.compile(r"Last (?:Modified|updated):", re.I)):
        m = re.search(r"Last (?:Modified|updated):\s*(.+)", str(el), re.I)
        if m:
            updated = m.group(1).strip()
            break

    divisions = []
    for search_text, display_name in div_specs:
        heading = None
        search_upper = _apos_norm(search_text.upper())

        # 1. Exact match in h2/h3/h4 (normalise curly apostrophes first)
        for tag in soup.find_all(["h2", "h3", "h4"]):
            t = _apos_norm(" ".join(tag.get_text().split()).upper())
            if t == search_upper:
                heading = tag
                break
        # 2. Fallback: heading text contains search_text
        if heading is None:
            for tag in soup.find_all(["h2", "h3", "h4"]):
                t = _apos_norm(" ".join(tag.get_text().split()).upper())
                if search_upper in t:
                    heading = tag
                    break

        teams = []
        if heading is not None:
            # Collect ALL headings with this normalised text — the page has two
            # passes: bid-allocation section first, then the actual ranked table.
            all_headings = [
                tag for tag in soup.find_all(["h2", "h3", "h4"])
                if _apos_norm(" ".join(tag.get_text().split()).upper()) == search_upper
            ]
            if not all_headings:
                all_headings = [heading]

            for h in all_headings:
                for sib in h.find_all_next():
                    if sib.name == "table":
                        parsed = []
                        for row in sib.find_all("tr"):
                            tds = row.find_all("td")
                            if len(tds) < 2:
                                continue
                            try:
                                rank = int(tds[0].get_text(strip=True))
                            except ValueError:
                                continue
                            if rank > limit:
                                continue
                            name = tds[1].get_text(strip=True)
                            rating_td = row.find("td", class_="rating")
                            rating = None
                            if rating_td:
                                try:
                                    rating = float(rating_td.get_text(strip=True).replace(",", ""))
                                except ValueError:
                                    pass
                            parsed.append({"rank": rank, "name": name, "rating": rating})
                        if parsed:
                            teams = parsed
                            break   # found a table with actual teams
                        break       # empty table — try next heading occurrence
                    # Stop at a *different* (non-matching) h2/h3
                    if sib.name in ("h2", "h3") and sib is not h:
                        if _apos_norm(" ".join(sib.get_text().split()).upper()) != search_upper:
                            break
                if teams:
                    break  # got teams; no need to try later headings

        teams.sort(key=lambda t: t["rank"])
        divisions.append({"name": display_name, "teams": teams})

    return divisions, updated


@app.get("/api/usau/official-rankings")
def get_usau_official_rankings():
    """Return USAU official Club + College rankings scraped from usaultimate.org.

    Results are cached for 12 hours; stale data is returned on fetch error.
    """
    global _OFF_RNKS_CACHE, _OFF_RNKS_TS
    now = time.time()
    if _OFF_RNKS_CACHE is not None and now - _OFF_RNKS_TS < _OFF_RNKS_TTL:
        return _OFF_RNKS_CACHE

    try:
        club_divs, club_upd = _scrape_usau_off_rnks(
            "https://usaultimate.org/club/rankings/",
            [("MEN'S", "Men"), ("MIXED", "Mixed"), ("WOMEN", "Women")],
            25,
        )
        col_divs, col_upd = _scrape_usau_off_rnks(
            "https://usaultimate.org/college/rankings/",
            [
                ("D-I MEN'S",     "D-I Men"),
                ("D-I WOMEN'S",   "D-I Women"),
                ("D-III MEN'S",   "D-III Men"),
                ("D-III WOMEN'S", "D-III Women"),
            ],
            20,
        )
        data: dict = {
            "club":      {"updated": club_upd, "divisions": club_divs},
            "college":   {"updated": col_upd,  "divisions": col_divs},
            "cached_at": int(now),
        }
        _OFF_RNKS_CACHE = data
        _OFF_RNKS_TS    = now
        return data
    except Exception as exc:
        if _OFF_RNKS_CACHE is not None:
            return _OFF_RNKS_CACHE
        raise HTTPException(status_code=503, detail=f"Rankings unavailable: {exc}")


# ── /api/ufa/player-pv ───────────────────────────────────────────────────────

@app.get("/api/ufa/player-pv")
def get_player_pv(season: int = None, min_throws: int = 50):
    """Return player PV aggregates from player_season_pv.

    Query params:
      season     – filter to one year (omit for all years)
      min_throws – minimum throw_attempts threshold (default 50)
    """
    with get_db() as conn:
        if season is not None:
            rows = conn.execute(
                """
                SELECT player, season, team_id,
                       throw_attempts, completions,
                       throws_pv_sum, thrower_vae,
                       catches, catches_pv_sum, receiver_vae,
                       total_pv, per_throw_pv, per_touch_pv
                FROM player_season_pv
                WHERE season = ? AND throw_attempts >= ?
                ORDER BY per_throw_pv DESC
                """,
                (season, min_throws),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT player, season, team_id,
                       throw_attempts, completions,
                       throws_pv_sum, thrower_vae,
                       catches, catches_pv_sum, receiver_vae,
                       total_pv, per_throw_pv, per_touch_pv
                FROM player_season_pv
                WHERE throw_attempts >= ?
                ORDER BY season DESC, per_throw_pv DESC
                """,
                (min_throws,),
            ).fetchall()

    return {"items": [dict(r) for r in rows]}


# ── /api/ufa/field-value-grid ─────────────────────────────────────────────────

@app.get("/api/ufa/field-value-grid")
def get_field_value_grid():
    """Return the pre-computed field-value grid for heatmap visualisation.

    Each row: { thrower_x, thrower_y, fv_predicted }
    Coordinates are in Shownspace units (y=0 defending endzone, y=100 attacking).
    """
    with get_db() as conn:
        rows = conn.execute(
            "SELECT x AS thrower_x, y AS thrower_y, scoring_probability AS fv_predicted FROM field_value_grid"
        ).fetchall()
    return {"items": [dict(r) for r in rows]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", app_dir=str(Path(__file__).parent),
                host="127.0.0.1", port=8000, reload=True)
