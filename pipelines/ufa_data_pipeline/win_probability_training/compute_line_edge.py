"""
compute_line_edge.py
====================
Computes rolling line-edge per score event and writes to the wp_line_edge table.

    line_edge (home perspective) = home_O_rate - away_O_rate
    line_edge (away perspective) = -(home_O_rate - away_O_rate)

where each rate is the average C(7,5)-subset O-conversion rate derived
from ALL PRIOR games (strict rolling — a game is excluded from its own
computation).

O-conversion rate for a line: across all O-points that line started
(in prior games), what fraction did they score?

Fallback chain (when a 5-player subset lacks MIN_SUBSET_PLAYS history):
  1. Average the individual player O-conversion rates for the 7 players
     (players with >= MIN_PLAYER_PLAYS O-point appearances)
  2. Team-level O-conversion rate for that franchise
  3. 0.5 (neutral, no history at all)

Usage:
    python compute_line_edge.py --db /path/to/ultimate.db [--reset]

Outputs:
    wp_line_edge(game_id TEXT, perspective TEXT, event_seq INTEGER, line_edge REAL)
    PRIMARY KEY (game_id, perspective, event_seq)

Re-run after scraping new games (--reset clears and recomputes everything).
"""

import argparse
import bisect
import json
import sqlite3
from collections import defaultdict
from itertools import combinations

# ── Thresholds ──────────────────────────────────────────────────────────────
MIN_SUBSET_PLAYS = 3   # 5-player subset needs >= this many prior O-points
MIN_PLAYER_PLAYS = 5   # player needs >= this many prior O-point appearances

# ── DDL ─────────────────────────────────────────────────────────────────────
DDL = """
CREATE TABLE IF NOT EXISTS wp_line_edge (
    game_id     TEXT    NOT NULL,
    perspective TEXT    NOT NULL,
    event_seq   INTEGER NOT NULL,
    line_edge   REAL    NOT NULL,
    PRIMARY KEY (game_id, perspective, event_seq)
)
"""

SCORE_TYPES = frozenset({19, 15})   # from home perspective: 19=home scored, 15=away scored


# ── Rate helpers ─────────────────────────────────────────────────────────────

def _team_rate(team_id: str, team_stats: dict) -> float:
    s = team_stats[team_id]
    return s[1] / s[0] if s[0] > 0 else 0.5


def compute_rate(line: list, subset_stats: dict, player_stats: dict,
                 team_stats: dict, team_id: str) -> float:
    """Estimate O-conversion rate for a 7-player line using rolling history."""
    if not line:
        return _team_rate(team_id, team_stats)

    n = min(len(line), 7)
    k = min(n, 5)  # subset size (5, or fewer if line has < 5 players)

    # C(n,k) subset rates
    subset_rates = []
    for combo in combinations(line[:n], k):
        s = subset_stats[frozenset(combo)]
        if s[0] >= MIN_SUBSET_PLAYS:
            subset_rates.append(s[1] / s[0])

    if subset_rates:
        return sum(subset_rates) / len(subset_rates)

    # Player-level fallback
    player_rates = []
    for slug in line[:n]:
        s = player_stats[slug]
        if s[0] >= MIN_PLAYER_PLAYS:
            player_rates.append(s[1] / s[0])
    if player_rates:
        return sum(player_rates) / len(player_rates)

    return _team_rate(team_id, team_stats)


def update_stats(line: list, scored: bool, team_id: str,
                 subset_stats: dict, player_stats: dict, team_stats: dict) -> None:
    """Record an O-point outcome into rolling history."""
    if not line:
        return
    n = min(len(line), 7)
    k = min(n, 5)
    for combo in combinations(line[:n], k):
        s = subset_stats[frozenset(combo)]
        s[0] += 1
        if scored:
            s[1] += 1
    for slug in line[:n]:
        s = player_stats[slug]
        s[0] += 1
        if scored:
            s[1] += 1
    s = team_stats[team_id]
    s[0] += 1
    if scored:
        s[1] += 1


# ── Per-game processor ───────────────────────────────────────────────────────

def process_game(game_id: str, home_team: str, away_team: str,
                 conn: sqlite3.Connection,
                 subset_stats: dict, player_stats: dict, team_stats: dict
                 ) -> tuple[list[tuple], list[tuple], list[tuple]]:
    """
    Returns:
        rows          — list of (game_id, perspective, event_seq, line_edge)
        home_o_outcomes — list of (line, scored) for each completed home O-point
        away_o_outcomes — list of (line, scored) for each completed away O-point
    """
    # Load both perspectives ordered by event_seq
    home_evts = conn.execute(
        "SELECT event_seq, type, line FROM ufa_game_events "
        "WHERE game_id=? AND perspective='home' ORDER BY event_seq",
        (game_id,)
    ).fetchall()
    away_evts = conn.execute(
        "SELECT event_seq, type, line FROM ufa_game_events "
        "WHERE game_id=? AND perspective='away' ORDER BY event_seq",
        (game_id,)
    ).fetchall()

    # ── Parse point-start events ────────────────────────────────────────────
    # home_pts[i] and away_pts[i] represent the same real-world point.
    # Invariant: home_pts[i].type + away_pts[i].type == 3
    #   (home type 2 ↔ away type 1, home type 1 ↔ away type 2)

    home_pts = [
        {"seq": r["event_seq"], "type": r["type"],
         "line": json.loads(r["line"]) if r["line"] else []}
        for r in home_evts if r["type"] in (1, 2)
    ]
    away_pts = [
        {"seq": r["event_seq"], "type": r["type"],
         "line": json.loads(r["line"]) if r["line"] else []}
        for r in away_evts if r["type"] in (1, 2)
    ]

    n_pts = min(len(home_pts), len(away_pts))
    home_pts_seqs = [p["seq"] for p in home_pts]

    # ── Score events ────────────────────────────────────────────────────────
    home_scores = [(r["event_seq"], r["type"]) for r in home_evts if r["type"] in SCORE_TYPES]
    away_scores = [(r["event_seq"], r["type"]) for r in away_evts if r["type"] in SCORE_TYPES]
    # Ordinal k from home ↔ ordinal k from away (same score, different seqs)

    home_scored_seqs = frozenset(seq for seq, t in home_scores if t == 19)
    away_scored_seqs = frozenset(seq for seq, t in home_scores if t == 15)

    # ── Compute line_edge per score event ───────────────────────────────────
    rows: list[tuple] = []

    for k, (h_seq, _) in enumerate(home_scores):
        # Locate which point this score belongs to (most recent point start ≤ h_seq)
        pt_idx = bisect.bisect_right(home_pts_seqs, h_seq) - 1
        if pt_idx < 0:
            continue

        # Most recent home O-line (type 2) at or before this point
        last_home_oline: list | None = None
        for i in range(pt_idx, -1, -1):
            if home_pts[i]["type"] == 2 and home_pts[i]["line"]:
                last_home_oline = home_pts[i]["line"]
                break

        # Most recent away O-line (type 2 in away perspective) at or before this point
        last_away_oline: list | None = None
        lim = min(pt_idx, len(away_pts) - 1)
        for i in range(lim, -1, -1):
            if away_pts[i]["type"] == 2 and away_pts[i]["line"]:
                last_away_oline = away_pts[i]["line"]
                break

        home_rate = compute_rate(last_home_oline or [], subset_stats, player_stats, team_stats, home_team)
        away_rate = compute_rate(last_away_oline or [], subset_stats, player_stats, team_stats, away_team)
        le = home_rate - away_rate

        rows.append((game_id, "home", h_seq, le))

        # Away-perspective row: negated line_edge, away event_seq
        if k < len(away_scores):
            rows.append((game_id, "away", away_scores[k][0], -le))

    # ── Collect O-point outcomes for updating rolling stats ─────────────────
    home_o_outcomes: list[tuple] = []
    away_o_outcomes: list[tuple] = []

    for i in range(n_pts):
        hp = home_pts[i]
        ap = away_pts[i]
        end_seq = home_pts[i + 1]["seq"] if i + 1 < len(home_pts) else float("inf")

        h_scored = any(s > hp["seq"] and s < end_seq for s in home_scored_seqs)
        a_scored = any(s > hp["seq"] and s < end_seq for s in away_scored_seqs)

        point_completed = h_scored or a_scored
        if not point_completed:
            continue  # skip incomplete/ambiguous points

        if hp["type"] == 2:                              # home O-point
            home_o_outcomes.append((hp["line"], h_scored))
        elif hp["type"] == 1 and ap["type"] == 2:        # away O-point
            away_o_outcomes.append((ap["line"], a_scored))

    return rows, home_o_outcomes, away_o_outcomes


# ── Main ─────────────────────────────────────────────────────────────────────

def main(db_path: str, reset: bool = False) -> None:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    con.execute(DDL)
    con.commit()

    if reset:
        con.execute("DELETE FROM wp_line_edge")
        con.commit()
        print("Cleared wp_line_edge.")

    games = con.execute(
        "SELECT game_id, home_team_id, away_team_id FROM ufa_games "
        "WHERE status='Final' ORDER BY start_timestamp"
    ).fetchall()
    print(f"Processing {len(games):,} games in chronological order...")

    # Rolling stats: [plays, conversions]
    subset_stats: dict = defaultdict(lambda: [0, 0])
    player_stats: dict = defaultdict(lambda: [0, 0])
    team_stats:   dict = defaultdict(lambda: [0, 0])

    batch: list[tuple] = []
    FLUSH_EVERY = 200

    for g_idx, game in enumerate(games):
        rows, home_o, away_o = process_game(
            game["game_id"], game["home_team_id"], game["away_team_id"],
            con, subset_stats, player_stats, team_stats,
        )
        batch.extend(rows)

        # Update rolling stats AFTER computing this game's line_edges
        for line, scored in home_o:
            update_stats(line, scored, game["home_team_id"],
                         subset_stats, player_stats, team_stats)
        for line, scored in away_o:
            update_stats(line, scored, game["away_team_id"],
                         subset_stats, player_stats, team_stats)

        if (g_idx + 1) % FLUSH_EVERY == 0:
            con.executemany(
                "INSERT OR REPLACE INTO wp_line_edge"
                "(game_id, perspective, event_seq, line_edge) VALUES (?,?,?,?)",
                batch,
            )
            con.commit()
            batch.clear()
            print(f"  {g_idx + 1}/{len(games)} games processed...")

    if batch:
        con.executemany(
            "INSERT OR REPLACE INTO wp_line_edge"
            "(game_id, perspective, event_seq, line_edge) VALUES (?,?,?,?)",
            batch,
        )
        con.commit()

    # ── Summary ──────────────────────────────────────────────────────────────
    total_rows = con.execute("SELECT COUNT(*) FROM wp_line_edge").fetchone()[0]
    total_score_home = con.execute(
        "SELECT COUNT(*) FROM ufa_game_events WHERE type IN (19,15) AND perspective='home'"
    ).fetchone()[0]
    covered_home = con.execute(
        "SELECT COUNT(*) FROM wp_line_edge WHERE perspective='home'"
    ).fetchone()[0]
    avg_abs = con.execute(
        "SELECT AVG(ABS(line_edge)) FROM wp_line_edge WHERE perspective='home'"
    ).fetchone()[0] or 0.0

    print(f"\nDone.  {total_rows:,} total rows written to wp_line_edge.")
    print(f"  Home score events : {total_score_home:,}")
    print(f"  Covered (home)    : {covered_home:,}  ({100 * covered_home / max(total_score_home, 1):.1f}%)")
    print(f"  Mean |line_edge|  : {avg_abs:.4f}")

    # Distribution of fallback tier (rough — check how many are at exactly 0.0)
    zero = con.execute(
        "SELECT COUNT(*) FROM wp_line_edge WHERE perspective='home' AND line_edge=0.0"
    ).fetchone()[0]
    print(f"  Rows at 0.0 (no history both sides): {zero:,}")

    con.close()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Compute rolling line-edge per score event")
    p.add_argument("--db",    required=True, help="Path to ultimate.db")
    p.add_argument("--reset", action="store_true",
                   help="Clear existing rows and recompute from scratch")
    args = p.parse_args()
    main(args.db, args.reset)
