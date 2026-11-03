"""
MLU game-data ingestion pipeline
=================================
Fetches ALL data files from the jennybc/vanNH GitHub repo for every game in
mlu_games that has a gspread_name value, saves them locally under
2014_game_data/, and loads structured data into mlu_ tables in ultimate.db.

DB tables created / populated
──────────────────────────────
mlu_raw_gameplay        03_concat-google  *_gameplay-raw.tsv
mlu_raw_points          03_concat-google  *_points-raw.tsv
mlu_gameplay_clean      04_clean-game     *_gameplay-clean.tsv
mlu_gameplay_resolved   06_possess-game   *_gameplay-resolved.tsv
mlu_possessions         06_possess-game   *_possessions.tsv
mlu_points              06_possess-game   *_points-resolved.tsv
mlu_passes              07_pass-game      *_passes.tsv
mlu_passes_tally        07_pass-game      *_passes-tally.tsv
mlu_player_game_stats   07_pass-game      *_player-stats.tsv
mlu_raw_point_data      01_raw-google     *_point{NN}.txt  (per-point)
mlu_game_info           root              *_game-info.yaml + *_at-last-point.yaml

Downloaded locally but not stored in DB (logs / HTML reports)
──────────────────────────────────────────────────────────────
04_clean-game     *_gameplay-checks-log.txt
04_clean-game     *_gameplay-clean-log.txt
06_possess-game   *_gameplay-possessions-log.txt
07_pass-game      *_passes-log.txt
09_html           *_live-stats.html
09_html           *_live-stats.md
09_html           *_live-stats-log.txt
09_html           *_nowPlaying-log.txt

Usage:
  python ingest_game_data.py [--db PATH] [--out PATH] [--dry-run]
"""

import os
import argparse
import csv
import io
import re
import sqlite3
import time
import urllib.request
from pathlib import Path

# ── Configuration ─────────────────────────────────────────────────────────────

REPO_RAW = "https://raw.githubusercontent.com/jennybc/vanNH/master/games"

# (subfolder, filename_suffix, table_name)
TSV_FILES = [
    ("03_concat-google", "_gameplay-raw.tsv",    "mlu_raw_gameplay"),
    ("03_concat-google", "_points-raw.tsv",      "mlu_raw_points"),
    ("04_clean-game",    "_gameplay-clean.tsv",   "mlu_gameplay_clean"),
    ("06_possess-game",  "_gameplay-resolved.tsv","mlu_gameplay_resolved"),
    ("06_possess-game",  "_possessions.tsv",      "mlu_possessions"),
    ("06_possess-game",  "_points-resolved.tsv",  "mlu_points"),
    ("07_pass-game",     "_passes.tsv",           "mlu_passes"),
    ("07_pass-game",     "_passes-tally.tsv",     "mlu_passes_tally"),
    ("07_pass-game",     "_player-stats.tsv",     "mlu_player_game_stats"),
]

# (subfolder, filename_suffix)  — download to disk only, no DB table
DOWNLOAD_ONLY = [
    ("04_clean-game",   "_gameplay-checks-log.txt"),
    ("04_clean-game",   "_gameplay-clean-log.txt"),
    ("06_possess-game", "_gameplay-possessions-log.txt"),
    ("07_pass-game",    "_passes-log.txt"),
    ("09_html",         "_live-stats-log.txt"),
    ("09_html",         "_nowPlaying-log.txt"),
    ("09_html",         "_live-stats.html"),
    ("09_html",         "_live-stats.md"),
]

# Columns we extract from each TSV table.
# For TSVs with dynamic team-score columns (e.g. mlu_points) we keep only
# the fixed columns listed here.
COLUMNS = {
    "mlu_raw_gameplay": ["point", "Offense", "Defense"],
    "mlu_raw_points": [
        "point", "Pulling.team", "Period",
        "Clock.before.point", "Clock.after.point",
    ],
    "mlu_gameplay_clean": [
        "point", "event", "pull_pnum", "pull_code", "recv_pnum", "recv_code",
    ],
    "mlu_gameplay_resolved": [
        "period", "point", "pull_team", "event",
        "poss_abs", "poss_rel", "poss_team", "pl_team", "pl_pnum", "pl_code",
    ],
    "mlu_possessions": [
        "period", "point", "pull_team", "event",
        "poss_abs", "poss_rel", "poss_team", "pl_team", "pl_pnum", "pl_code",
        "n_events", "huck", "score", "scor_team", "who", "a_code", "b_code",
    ],
    "mlu_points": [
        "point", "period", "clk_before", "clk_after",
        "pull_team", "n_poss", "scor_team", "h_or_b", "pt_dur", "pt_dur_txt",
    ],
    "mlu_passes": [
        "poss_abs", "poss_rel", "point", "beg_event", "end_event",
        "desc", "n_inn", "beg_code", "beg_plyr", "innards",
        "end_code", "end_plyr", "wl", "pclass",
    ],
    "mlu_passes_tally": ["desc", "n_inn", "Freq"],
    "mlu_player_game_stats": [
        "game", "player", "last", "points", "comp_pct",
        "goals", "assists", "throws", "completions", "catches",
        "def", "drop", "team", "number",
    ],
}

# TSV header → safe DB column name mapping (SQL reserved words / duplicates)
TSV_TO_DB = {
    "drop":             "drop_count",   # reserved word in some dialects
    "Offense":          "offense",
    "Defense":          "defense",
    "Pulling.team":     "pulling_team",
    "Period":           "period",
    "Clock.before.point": "clk_before",
    "Clock.after.point":  "clk_after",
    "Freq":             "freq",
}

# ── Schema ────────────────────────────────────────────────────────────────────

CREATE_STATEMENTS = {
    "mlu_raw_gameplay": """
        CREATE TABLE IF NOT EXISTS mlu_raw_gameplay (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            gspread_name TEXT NOT NULL,
            point        INTEGER,
            offense      TEXT,
            defense      TEXT
        )""",
    "mlu_raw_points": """
        CREATE TABLE IF NOT EXISTS mlu_raw_points (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            gspread_name TEXT NOT NULL,
            point        INTEGER,
            pulling_team TEXT,
            period       INTEGER,
            clk_before   TEXT,
            clk_after    TEXT
        )""",
    "mlu_gameplay_clean": """
        CREATE TABLE IF NOT EXISTS mlu_gameplay_clean (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            gspread_name TEXT NOT NULL,
            point        INTEGER,
            event        INTEGER,
            pull_pnum    TEXT,
            pull_code    TEXT,
            recv_pnum    TEXT,
            recv_code    TEXT
        )""",
    "mlu_gameplay_resolved": """
        CREATE TABLE IF NOT EXISTS mlu_gameplay_resolved (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            gspread_name TEXT NOT NULL,
            period       INTEGER,
            point        INTEGER,
            pull_team    TEXT,
            event        INTEGER,
            poss_abs     INTEGER,
            poss_rel     INTEGER,
            poss_team    TEXT,
            pl_team      TEXT,
            pl_pnum      TEXT,
            pl_code      TEXT
        )""",
    "mlu_possessions": """
        CREATE TABLE IF NOT EXISTS mlu_possessions (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            gspread_name TEXT NOT NULL,
            period       INTEGER,
            point        INTEGER,
            pull_team    TEXT,
            event        INTEGER,
            poss_abs     INTEGER,
            poss_rel     INTEGER,
            poss_team    TEXT,
            pl_team      TEXT,
            pl_pnum      TEXT,
            pl_code      TEXT,
            n_events     INTEGER,
            huck         TEXT,
            score        TEXT,
            scor_team    TEXT,
            who          TEXT,
            a_code       TEXT,
            b_code       TEXT
        )""",
    "mlu_points": """
        CREATE TABLE IF NOT EXISTS mlu_points (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            gspread_name TEXT NOT NULL,
            point        INTEGER,
            period       INTEGER,
            clk_before   TEXT,
            clk_after    TEXT,
            pull_team    TEXT,
            n_poss       TEXT,
            scor_team    TEXT,
            h_or_b       TEXT,
            pt_dur       TEXT,
            pt_dur_txt   TEXT
        )""",
    "mlu_passes": """
        CREATE TABLE IF NOT EXISTS mlu_passes (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            gspread_name TEXT NOT NULL,
            poss_abs     INTEGER,
            poss_rel     INTEGER,
            point        INTEGER,
            beg_event    INTEGER,
            end_event    INTEGER,
            pass_desc    TEXT,
            n_inn        INTEGER,
            beg_code     TEXT,
            beg_plyr     TEXT,
            innards      TEXT,
            end_code     TEXT,
            end_plyr     TEXT,
            wl           TEXT,
            pclass       TEXT
        )""",
    "mlu_passes_tally": """
        CREATE TABLE IF NOT EXISTS mlu_passes_tally (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            gspread_name TEXT NOT NULL,
            pass_desc    TEXT,
            n_inn        INTEGER,
            freq         INTEGER
        )""",
    "mlu_player_game_stats": """
        CREATE TABLE IF NOT EXISTS mlu_player_game_stats (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            gspread_name TEXT NOT NULL,
            game         TEXT,
            player       TEXT,
            last         TEXT,
            points       INTEGER,
            comp_pct     REAL,
            goals        INTEGER,
            assists      INTEGER,
            throws       INTEGER,
            completions  INTEGER,
            catches      INTEGER,
            def_count    INTEGER,
            drop_count   INTEGER,
            team         TEXT,
            number       TEXT
        )""",
    # Per-point raw text files stored as structured rows
    "mlu_raw_point_data": """
        CREATE TABLE IF NOT EXISTS mlu_raw_point_data (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            gspread_name TEXT NOT NULL,
            point_num    INTEGER,
            pull_team    TEXT,
            period       TEXT,
            clk_before   TEXT,
            clk_after    TEXT,
            row_num      INTEGER,
            offense      TEXT,
            defense      TEXT
        )""",
    # One row per game combining _game-info.yaml + _at-last-point.yaml
    "mlu_game_info": """
        CREATE TABLE IF NOT EXISTS mlu_game_info (
            gspread_name  TEXT PRIMARY KEY,
            game_status   TEXT,
            last_point    INTEGER,
            last_period   INTEGER,
            last_clk_before TEXT,
            last_clk_after  TEXT,
            last_pull_team  TEXT,
            last_scor_team  TEXT,
            last_pt_dur     REAL,
            last_pt_dur_txt TEXT
        )""",
}

# special-cased DB column names for 'desc' and 'def' columns
_PASS_COL_MAP  = {"desc": "pass_desc"}
_STATS_COL_MAP = {"def": "def_count", "drop": "drop_count"}

# ── Helpers ───────────────────────────────────────────────────────────────────

def fetch_url(url: str, retries: int = 3, delay: float = 1.5):
    """Return (text, bytes) tuple or (None, None) on 404."""
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                raw = resp.read()
                return raw.decode("utf-8", errors="replace"), raw
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None, None
            if attempt < retries - 1:
                time.sleep(delay)
        except Exception:
            if attempt < retries - 1:
                time.sleep(delay)
    return None, None


def fetch_text(url: str) -> str | None:
    text, _ = fetch_url(url)
    return text


def get_or_cache(url: str, local_path: Path):
    """Return text from cache or fetch+save. Returns None if not found."""
    if local_path.exists():
        return local_path.read_text(encoding="utf-8", errors="replace"), True
    text, raw = fetch_url(url)
    if text is None:
        return None, False
    local_path.parent.mkdir(parents=True, exist_ok=True)
    local_path.write_bytes(raw)
    return text, False


def parse_tsv(text: str, wanted_cols: list[str]) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    return [{col: (row.get(col) or "") for col in wanted_cols} for row in reader]


def col_map(table: str, tsv_col: str) -> str:
    """Map a TSV column name to its DB-safe equivalent."""
    if table == "mlu_passes":
        return _PASS_COL_MAP.get(tsv_col, TSV_TO_DB.get(tsv_col, tsv_col))
    if table == "mlu_passes_tally":
        return _PASS_COL_MAP.get(tsv_col, TSV_TO_DB.get(tsv_col, tsv_col))
    if table == "mlu_player_game_stats":
        return _STATS_COL_MAP.get(tsv_col, TSV_TO_DB.get(tsv_col, tsv_col))
    return TSV_TO_DB.get(tsv_col, tsv_col)


def insert_tsv_rows(conn, table: str, gspread_name: str, rows: list[dict]) -> int:
    if not rows:
        return 0
    wanted = COLUMNS[table]
    db_cols = ["gspread_name"] + [col_map(table, c) for c in wanted]
    ph = ", ".join(["?"] * len(db_cols))
    sql = f"INSERT INTO {table} ({', '.join(db_cols)}) VALUES ({ph})"
    values = [tuple([gspread_name] + [(row.get(c) or "") for c in wanted])
              for row in rows]
    conn.executemany(sql, values)
    conn.commit()
    return len(values)


# ── Per-point raw file parser ─────────────────────────────────────────────────

def parse_raw_point_file(text: str) -> dict:
    """
    Parse a _pointNN.txt file.
    Returns a dict with keys: pull_team, period, clk_before, clk_after, rows.
    rows is a list of (offense, defense) string tuples.
    """
    header = {}
    data_rows = []
    lines = text.splitlines()
    in_data = False
    for line in lines:
        if not in_data:
            if line.startswith("Offense\t") or line == "Offense\tDefense":
                in_data = True
                continue
            m = re.match(r"^(.+?):\s*(.*)$", line)
            if m:
                header[m.group(1).strip().lower()] = m.group(2).strip()
        else:
            parts = line.split("\t")
            off = parts[0].strip() if len(parts) > 0 else ""
            dfe = parts[1].strip() if len(parts) > 1 else ""
            data_rows.append((off, dfe))

    return {
        "pull_team":  header.get("pulling team", ""),
        "period":     header.get("period", ""),
        "clk_before": header.get("clock before point", ""),
        "clk_after":  header.get("clock after point", ""),
        "rows":       data_rows,
    }


def insert_raw_point_rows(conn, gspread_name: str, point_num: int,
                           parsed: dict) -> int:
    sql = """INSERT INTO mlu_raw_point_data
             (gspread_name, point_num, pull_team, period, clk_before, clk_after,
              row_num, offense, defense)
             VALUES (?,?,?,?,?,?,?,?,?)"""
    values = [
        (gspread_name, point_num,
         parsed["pull_team"], parsed["period"],
         parsed["clk_before"], parsed["clk_after"],
         i + 1, off, dfe)
        for i, (off, dfe) in enumerate(parsed["rows"])
    ]
    if values:
        conn.executemany(sql, values)
        conn.commit()
    return len(values)


# ── YAML parser (handles R-generated YAML quirks) ────────────────────────────

def parse_game_yaml(info_text: str | None, alp_text: str | None) -> dict:
    """
    Extract fields from _game-info.yaml and _at-last-point.yaml.
    Uses simple regex; handles .na.integer / .na.character R NA values.
    """
    def get_val(text: str, key: str) -> str:
        if not text:
            return ""
        m = re.search(rf"^{re.escape(key)}:\s*(.+)$", text, re.MULTILINE)
        if not m:
            return ""
        v = m.group(1).strip().strip("'\"")
        return "" if v.startswith(".na") else v

    game_status = get_val(info_text or "", "game_status")

    last_point    = get_val(alp_text or "", "point")
    last_period   = get_val(alp_text or "", "period")
    last_clk_bef  = get_val(alp_text or "", "clk_before")
    last_clk_aft  = get_val(alp_text or "", "clk_after")
    last_scor     = get_val(alp_text or "", "scor_team")
    last_pt_dur   = get_val(alp_text or "", "pt_dur")
    last_pt_txt   = get_val(alp_text or "", "pt_dur_txt")

    # pull_team spans two lines in R YAML: "pull_team:\nnykRM"
    last_pull = ""
    if alp_text:
        m = re.search(r"pull_team:\s*\n(\S+)", alp_text)
        if m:
            last_pull = m.group(1).strip()

    return {
        "game_status":    game_status,
        "last_point":     last_point,
        "last_period":    last_period,
        "last_clk_before": last_clk_bef,
        "last_clk_after":  last_clk_aft,
        "last_pull_team":  last_pull,
        "last_scor_team":  last_scor,
        "last_pt_dur":     last_pt_dur,
        "last_pt_dur_txt": last_pt_txt,
    }


def upsert_game_info(conn, gspread_name: str, info: dict) -> None:
    conn.execute(
        """INSERT INTO mlu_game_info
           (gspread_name, game_status, last_point, last_period,
            last_clk_before, last_clk_after, last_pull_team,
            last_scor_team, last_pt_dur, last_pt_dur_txt)
           VALUES (?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(gspread_name) DO UPDATE SET
             game_status=excluded.game_status,
             last_point=excluded.last_point,
             last_period=excluded.last_period,
             last_clk_before=excluded.last_clk_before,
             last_clk_after=excluded.last_clk_after,
             last_pull_team=excluded.last_pull_team,
             last_scor_team=excluded.last_scor_team,
             last_pt_dur=excluded.last_pt_dur,
             last_pt_dur_txt=excluded.last_pt_dur_txt""",
        (gspread_name,
         info["game_status"], info["last_point"], info["last_period"],
         info["last_clk_before"], info["last_clk_after"],
         info["last_pull_team"], info["last_scor_team"],
         info["last_pt_dur"], info["last_pt_dur_txt"]),
    )
    conn.commit()


# ── Setup / teardown ──────────────────────────────────────────────────────────

def create_tables(conn: sqlite3.Connection) -> None:
    # Drop all mlu_ tables first so schema changes always take effect
    for table in CREATE_STATEMENTS:
        conn.execute(f"DROP TABLE IF EXISTS {table}")
    conn.commit()
    for ddl in CREATE_STATEMENTS.values():
        ddl_clean = ddl.replace("CREATE TABLE IF NOT EXISTS", "CREATE TABLE")
        conn.execute(ddl_clean)
    conn.commit()


def clear_game(conn: sqlite3.Connection, gspread_name: str) -> None:
    """Remove existing rows for this game so re-runs are idempotent."""
    for table in CREATE_STATEMENTS:
        if table == "mlu_game_info":
            conn.execute("DELETE FROM mlu_game_info WHERE gspread_name = ?",
                         (gspread_name,))
        else:
            conn.execute(f"DELETE FROM {table} WHERE gspread_name = ?",
                         (gspread_name,))
    conn.commit()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    here = Path(__file__).parent
    default_db  = os.environ.get("UFA_DB_PATH") or here.parent.parent / "data" / "db" / "ultimate.db"
    default_out = here.parent.parent / "data" / "raw" / "mlu" / "2014_game_data"

    parser = argparse.ArgumentParser(description="Ingest all MLU game data from GitHub")
    parser.add_argument("--db",      default=str(default_db))
    parser.add_argument("--out",     default=str(default_out))
    parser.add_argument("--dry-run", action="store_true",
                        help="Download and parse but do not write to DB")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row
    if not args.dry_run:
        create_tables(conn)

    games = conn.execute(
        "SELECT gspread_name FROM mlu_games "
        "WHERE gspread_name IS NOT NULL AND gspread_name != '' "
        "ORDER BY gspread_name"
    ).fetchall()
    print(f"Found {len(games)} games with gspread_name.\n")

    totals = {t: 0 for t in CREATE_STATEMENTS}
    files_skipped = 0

    for g_row in games:
        game_id = g_row["gspread_name"]
        print(f"{'─'*64}\n{game_id}")
        game_dir = out_dir / game_id
        game_dir.mkdir(parents=True, exist_ok=True)

        if not args.dry_run:
            clear_game(conn, game_id)

        # ── 1. TSV files ──────────────────────────────────────────────────
        for subfolder, suffix, table in TSV_FILES:
            filename = f"{game_id}{suffix}"
            local = game_dir / filename
            url = f"{REPO_RAW}/{game_id}/{subfolder}/{filename}"
            text, cached = get_or_cache(url, local)
            tag = "cache" if cached else "fetch"
            if text is None:
                print(f"  [skip ] {filename}")
                files_skipped += 1
                continue
            print(f"  [{tag} ] {filename}")
            rows = parse_tsv(text, COLUMNS[table])
            if rows and not args.dry_run:
                n = insert_tsv_rows(conn, table, game_id, rows)
                totals[table] += n
                print(f"           → {n:,} rows → {table}")
            elif rows:
                print(f"           → {len(rows):,} rows (dry-run)")

        # ── 2. Per-point raw .txt files (01_raw-google) ───────────────────
        pt = 1
        point_rows_total = 0
        while True:
            filename = f"{game_id}_point{pt:02d}.txt"
            local = game_dir / filename
            url = f"{REPO_RAW}/{game_id}/01_raw-google/{filename}"
            text, cached = get_or_cache(url, local)
            if text is None:
                break   # no more points
            tag = "cache" if cached else "fetch"
            print(f"  [{tag} ] {filename}")
            parsed = parse_raw_point_file(text)
            if not args.dry_run:
                n = insert_raw_point_rows(conn, game_id, pt, parsed)
                point_rows_total += n
                totals["mlu_raw_point_data"] += n
            pt += 1
        if point_rows_total:
            print(f"           → {point_rows_total:,} rows → mlu_raw_point_data")

        # ── 3. YAML files (root level) ────────────────────────────────────
        info_text = alp_text = None
        for yaml_suffix in ("_game-info.yaml", "_at-last-point.yaml"):
            filename = f"{game_id}{yaml_suffix}"
            local = game_dir / filename
            url = f"{REPO_RAW}/{game_id}/{filename}"
            text, cached = get_or_cache(url, local)
            tag = "cache" if cached else "fetch"
            if text is None:
                print(f"  [skip ] {filename}")
                files_skipped += 1
            else:
                print(f"  [{tag} ] {filename}")
                if yaml_suffix == "_game-info.yaml":
                    info_text = text
                else:
                    alp_text = text
        if not args.dry_run:
            info = parse_game_yaml(info_text, alp_text)
            upsert_game_info(conn, game_id, info)
            totals["mlu_game_info"] += 1

        # ── 4. Download-only files ────────────────────────────────────────
        for subfolder, suffix in DOWNLOAD_ONLY:
            filename = f"{game_id}{suffix}"
            local = game_dir / filename
            url = f"{REPO_RAW}/{game_id}/{subfolder}/{filename}"
            text, cached = get_or_cache(url, local)
            tag = "cache" if cached else "fetch"
            if text is None:
                files_skipped += 1
            else:
                print(f"  [{tag} ] {filename}  (file only)")

    conn.close()

    print(f"\n{'='*64}")
    print("Ingestion complete.")
    if not args.dry_run:
        for table, count in totals.items():
            print(f"  {table:<30} {count:>7,} rows")
    print(f"  Files not found (404):         {files_skipped:>7,}")


if __name__ == "__main__":
    main()

