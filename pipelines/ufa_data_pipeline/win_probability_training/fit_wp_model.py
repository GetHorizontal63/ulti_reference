"""
UFA Win Probability Model Fitter v3
=====================================
Features:
  1. Score differential × √(t/T)          [k1]
  2. Possession next point                 [k2]  +1 home O, -1 away O
  3. Momentum — last 5 points             [k3]  sum of +1 (home scored) / -1 (away scored)
  4. Line O-conversion rate               [k4]  mean C(7,5) subset rolling rate for O team,
                                                 expressed as home advantage:
                                                 home_o_rate - away_o_rate when known

Formula:
  WP = σ(k1·Δ·√(t/T) + k2·poss + k3·momentum + k4·line_edge)

Rolling rates are cross-season and computed strictly from prior games
(no lookahead). Subset fallback: if a 5-player subset has no history,
use the mean of individual player rolling rates for those 5 players.
If a player has no history, use the team rolling rate.

Usage:
    python fit_wp_model_v3.py --db /path/to/ultimate.db
"""

import argparse
import json
import sqlite3
from itertools import combinations

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss
import warnings
warnings.filterwarnings("ignore")

# ---------------------------------------------------------------------------
# SQL: pull everything we need at point level
# ---------------------------------------------------------------------------

SQL_POINTS = """
WITH period_boundaries AS (
    SELECT
        game_id,
        event_seq,
        ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY event_seq) AS period_num
    FROM ufa_game_events
    WHERE perspective = 'home' AND type IN (1, 2) AND time = 0
),

events_with_period AS (
    SELECT
        e.game_id, e.event_seq, e.type, e.time,
        MAX(pb.period_num) AS period
    FROM ufa_game_events e
    LEFT JOIN period_boundaries pb
        ON pb.game_id = e.game_id AND pb.event_seq <= e.event_seq
    WHERE e.perspective = 'home'
    GROUP BY e.game_id, e.event_seq, e.type, e.time
),

last_known_time AS (
    SELECT
        e.game_id, e.event_seq,
        MAX(e2.event_seq) AS time_source_seq
    FROM ufa_game_events e
    JOIN ufa_game_events e2
        ON e2.game_id = e.game_id
       AND e2.perspective = 'home'
       AND e2.event_seq <= e.event_seq
       AND e2.type IN (1, 2)
       AND e2.time IS NOT NULL
    WHERE e.perspective = 'home' AND e.type IN (19, 15)
    GROUP BY e.game_id, e.event_seq
),

score_events AS (
    SELECT
        e.game_id,
        e.event_seq,
        ewp.period,
        ts_src.time                                                      AS period_time,
        SUM(CASE WHEN e.type = 19 THEN 1 ELSE 0 END)
            OVER (PARTITION BY e.game_id ORDER BY e.event_seq
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)     AS home_score,
        SUM(CASE WHEN e.type = 15 THEN 1 ELSE 0 END)
            OVER (PARTITION BY e.game_id ORDER BY e.event_seq
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)     AS away_score,
        -- point index within game (1-based)
        ROW_NUMBER() OVER (PARTITION BY e.game_id ORDER BY e.event_seq) AS point_idx
    FROM ufa_game_events e
    JOIN events_with_period ewp
        ON ewp.game_id = e.game_id AND ewp.event_seq = e.event_seq
    JOIN last_known_time lkt
        ON lkt.game_id = e.game_id AND lkt.event_seq = e.event_seq
    JOIN ufa_game_events ts_src
        ON ts_src.game_id = e.game_id
       AND ts_src.perspective = 'home'
       AND ts_src.event_seq = lkt.time_source_seq
    WHERE e.perspective = 'home' AND e.type IN (19, 15)
),

period_offsets(period, offset_s) AS (
    VALUES (1,0),(2,720),(3,1440),(4,2160),(5,2880)
),

-- Most recent O-line before each score (type 2 or 25, home perspective)
-- We want the last line sub event <= score event_seq
last_o_line AS (
    SELECT
        se.game_id,
        se.event_seq AS score_seq,
        le.line      AS o_line_json,
        -- which team is on O: type 2 = home on O, type 1 = home on D
        -- we need the line sub type to know who it belongs to
        le.type      AS line_type
    FROM score_events se
    JOIN (
        SELECT game_id, event_seq, type, line,
               ROW_NUMBER() OVER (
                   PARTITION BY game_id
                   ORDER BY event_seq DESC
               ) AS rn
        FROM ufa_game_events
        WHERE perspective = 'home'
          AND type IN (1, 2, 25)
          AND line IS NOT NULL
    ) le ON le.game_id = se.game_id
         AND le.event_seq <= se.event_seq
         AND le.rn = 1
         -- but we need the LAST one per score, not globally last
         -- rewrite below
    WHERE 1=0  -- placeholder, real query below
),

-- Correct last line per score event
last_line_per_score AS (
    SELECT
        se.game_id,
        se.event_seq AS score_seq,
        (
            SELECT e2.line
            FROM ufa_game_events e2
            WHERE e2.game_id = se.game_id
              AND e2.perspective = 'home'
              AND e2.type IN (2, 25)   -- O-line events only (home perspective)
              AND e2.event_seq <= se.event_seq
              AND e2.line IS NOT NULL
            ORDER BY e2.event_seq DESC
            LIMIT 1
        ) AS home_o_line_json,
        (
            SELECT e2.line
            FROM ufa_game_events e2
            WHERE e2.game_id = se.game_id
              AND e2.perspective = 'away'
              AND e2.type IN (2, 25)
              AND e2.event_seq <= se.event_seq
              AND e2.line IS NOT NULL
            ORDER BY e2.event_seq DESC
            LIMIT 1
        ) AS away_o_line_json
    FROM score_events se
)

SELECT
    se.game_id,
    se.event_seq,
    se.period,
    se.period_time,
    po.offset_s + se.period_time                            AS elapsed_s,
    CASE WHEN se.period <= 4 THEN 2880.0 ELSE 3180.0 END   AS total_s,
    se.home_score,
    se.away_score,
    (se.home_score - se.away_score)                         AS delta,
    se.point_idx,
    -- scored: +1 home scored, -1 away scored (for momentum)
    CASE WHEN se.home_score > LAG(se.home_score, 1, 0)
                               OVER (PARTITION BY se.game_id ORDER BY se.event_seq)
         THEN 1 ELSE -1 END                                 AS point_scored_by,
    -- possession next point
    CASE
        WHEN pull.event_seq IS NOT NULL THEN -1
        ELSE 1
    END                                                     AS poss,
    -- O lines (JSON) — parsed in Python
    lls.home_o_line_json,
    lls.away_o_line_json,
    -- game metadata
    g.year,
    g.start_timestamp,
    -- parse home/away abbrev from game_id
    SUBSTR(se.game_id, LENGTH(se.game_id) - 2)              AS home_abbrev,
    SUBSTR(se.game_id,
           INSTR(SUBSTR(se.game_id, 12), '-') + 12,
           3)                                               AS away_abbrev,
    g.home_score                                            AS final_home,
    g.away_score                                            AS final_away,
    CASE WHEN g.home_score > g.away_score THEN 1 ELSE 0 END AS home_won
FROM score_events se
JOIN period_offsets po ON po.period = se.period
JOIN ufa_games g ON g.game_id = se.game_id
LEFT JOIN ufa_game_events pull
    ON pull.game_id     = se.game_id
   AND pull.perspective = 'home'
   AND pull.event_seq   = se.event_seq + 2
   AND pull.type        = 7
LEFT JOIN last_line_per_score lls
    ON lls.game_id = se.game_id AND lls.score_seq = se.event_seq
WHERE se.period <= 5
  AND se.period_time IS NOT NULL
  AND g.status = 'Final'
  AND g.home_score IS NOT NULL
  AND g.away_score IS NOT NULL
ORDER BY g.start_timestamp, se.game_id, se.event_seq
"""

# ---------------------------------------------------------------------------
# SQL: pull all O-point outcomes for rolling rate computation
# ---------------------------------------------------------------------------

SQL_O_POINTS = """
WITH period_boundaries AS (
    SELECT game_id, event_seq,
           ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY event_seq) AS period_num
    FROM ufa_game_events
    WHERE perspective = 'home' AND type IN (1,2) AND time = 0
),

-- Each O-point start from home perspective (type 2)
o_point_starts AS (
    SELECT
        e.game_id,
        e.event_seq,
        e.line AS o_line_json,
        'home' AS o_team
    FROM ufa_game_events e
    WHERE e.perspective = 'home' AND e.type = 2 AND e.line IS NOT NULL
    UNION ALL
    -- Away O-points: type 2 in away perspective
    SELECT
        e.game_id,
        e.event_seq,
        e.line AS o_line_json,
        'away' AS o_team
    FROM ufa_game_events e
    WHERE e.perspective = 'away' AND e.type = 2 AND e.line IS NOT NULL
),

-- Most recent line sub (type 2 or 25) for each O-point before next score
last_line_for_o_point AS (
    SELECT
        ops.game_id,
        ops.event_seq AS o_start_seq,
        ops.o_team,
        -- last type 2 or 25 line before the next score event
        (
            SELECT e2.line
            FROM ufa_game_events e2
            WHERE e2.game_id = ops.game_id
              AND e2.perspective = ops.o_team
              AND e2.type IN (2, 25)
              AND e2.line IS NOT NULL
              AND e2.event_seq >= ops.event_seq
              AND e2.event_seq < COALESCE((
                  SELECT MIN(e3.event_seq)
                  FROM ufa_game_events e3
                  WHERE e3.game_id = ops.game_id
                    AND e3.perspective = ops.o_team
                    AND e3.type IN (19, 15)
                    AND e3.event_seq > ops.event_seq
              ), 999999)
            ORDER BY e2.event_seq DESC
            LIMIT 1
        ) AS final_line_json,
        -- did the O team score? type 19 = home scored, type 15 = away scored
        CASE
            WHEN ops.o_team = 'home' THEN (
                SELECT CASE WHEN e4.type = 19 THEN 1 ELSE 0 END
                FROM ufa_game_events e4
                WHERE e4.game_id = ops.game_id
                  AND e4.perspective = 'home'
                  AND e4.type IN (19, 15)
                  AND e4.event_seq > ops.event_seq
                ORDER BY e4.event_seq ASC
                LIMIT 1
            )
            ELSE (
                SELECT CASE WHEN e4.type = 15 THEN 1 ELSE 0 END
                FROM ufa_game_events e4
                WHERE e4.game_id = ops.game_id
                  AND e4.perspective = 'away'
                  AND e4.type IN (19, 15)
                  AND e4.event_seq > ops.event_seq
                ORDER BY e4.event_seq ASC
                LIMIT 1
            )
        END AS o_scored
    FROM o_point_starts ops
)

SELECT
    lfo.game_id,
    lfo.o_team,
    COALESCE(lfo.final_line_json, ops.o_line_json) AS line_json,
    lfo.o_scored,
    g.start_timestamp,
    g.year,
    SUBSTR(lfo.game_id, LENGTH(lfo.game_id) - 2)   AS home_abbrev,
    SUBSTR(lfo.game_id,
           INSTR(SUBSTR(lfo.game_id, 12), '-') + 12,
           3)                                       AS away_abbrev
FROM last_line_for_o_point lfo
JOIN o_point_starts ops
    ON ops.game_id = lfo.game_id AND ops.event_seq = lfo.o_start_seq
    AND ops.o_team = lfo.o_team
JOIN ufa_games g ON g.game_id = lfo.game_id
WHERE lfo.o_scored IS NOT NULL
  AND g.status = 'Final'
ORDER BY g.start_timestamp, lfo.game_id
"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

PERIOD_LABELS = {1: "Q1", 2: "Q2", 3: "Q3", 4: "Q4", 5: "OT1"}
MIN_SUBSET_OBS = 3   # minimum prior appearances for a subset rate to be used
MIN_PLAYER_OBS = 3   # minimum prior appearances for a player rate to be used


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-np.clip(x, -500, 500)))


def fit_model(X: np.ndarray, y: np.ndarray):
    m = LogisticRegression(fit_intercept=False, max_iter=2000, solver="lbfgs")
    m.fit(X, y)
    return m.coef_[0].tolist()


def print_calibration(label, y_true, y_prob, n_bins=10):
    prob_true, prob_pred = calibration_curve(
        y_true, y_prob, n_bins=n_bins, strategy="quantile"
    )
    print(f"\n  [{label}]")
    print(f"    Log-loss   : {log_loss(y_true, y_prob):.4f}")
    print(f"    Brier score: {brier_score_loss(y_true, y_prob):.4f}")
    print(f"    Accuracy   : {((y_prob >= 0.5) == y_true).mean():.3f}")
    return prob_true, prob_pred


def parse_line(json_str):
    """Parse line JSON to frozenset of player slugs, or None."""
    if not json_str:
        return None
    try:
        slugs = json.loads(json_str)
        if isinstance(slugs, list) and len(slugs) >= 5:
            return slugs
    except Exception:
        pass
    return None


def get_subsets(slugs):
    """Return all C(n,5) 5-player frozensets from a list of slugs."""
    if slugs is None or len(slugs) < 5:
        return []
    return [frozenset(c) for c in combinations(slugs, 5)]


# ---------------------------------------------------------------------------
# Rolling rate builder
# ---------------------------------------------------------------------------

def build_rolling_rates(o_points: pd.DataFrame):
    """
    Given a DataFrame of O-point outcomes (one row per O-point, sorted by
    start_timestamp then game_id), build rolling lookup tables:
      - subset_rates: {frozenset_of_5_slugs: (cumulative_scored, cumulative_attempts)}
      - player_rates: {slug: (scored, attempts)}
      - team_rates:   {team_abbrev: (scored, attempts)}

    Returns a list parallel to o_points rows, each element being a dict of
    rates computed from all PRIOR rows (strict rolling — current row excluded).
    """
    # We'll accumulate as we go
    subset_acc = {}   # frozenset -> [scored, attempts]
    player_acc = {}   # slug -> [scored, attempts]
    team_acc   = {}   # abbrev -> [scored, attempts]

    # Store the snapshot BEFORE each row for use as the prior rate
    prior_subset = []
    prior_player  = []
    prior_team    = []

    for _, row in o_points.iterrows():
        slugs   = parse_line(row["line_json"])
        scored  = int(row["o_scored"]) if pd.notna(row["o_scored"]) else None
        o_team  = row["o_team"]
        abbrev  = row["home_abbrev"] if o_team == "home" else row["away_abbrev"]

        # Snapshot current state BEFORE updating
        prior_subset.append(dict(subset_acc))
        prior_player.append(dict(player_acc))
        prior_team.append(dict(team_acc))

        # Update accumulators
        if scored is not None:
            # team
            if abbrev not in team_acc:
                team_acc[abbrev] = [0, 0]
            team_acc[abbrev][0] += scored
            team_acc[abbrev][1] += 1

            # players
            if slugs:
                for slug in slugs:
                    if slug not in player_acc:
                        player_acc[slug] = [0, 0]
                    player_acc[slug][0] += scored
                    player_acc[slug][1] += 1

                # subsets
                for subset in get_subsets(slugs):
                    if subset not in subset_acc:
                        subset_acc[subset] = [0, 0]
                    subset_acc[subset][0] += scored
                    subset_acc[subset][1] += 1

    return prior_subset, prior_player, prior_team


def lookup_line_rate(slugs, subset_snap, player_snap, team_snap, team_abbrev):
    """
    Given a line (list of slugs) and rate snapshots at the time of this event,
    return the O-conversion rate estimate for this line.
    Falls back: subset → player mean → team rate → 0.5 (uninformative prior).
    """
    if slugs is None or len(slugs) < 5:
        # fall back to team
        if team_abbrev in team_snap and team_snap[team_abbrev][1] >= MIN_PLAYER_OBS:
            s, a = team_snap[team_abbrev]
            return s / a
        return 0.5

    subsets = get_subsets(slugs)
    subset_rates = []
    for ss in subsets:
        if ss in subset_snap and subset_snap[ss][1] >= MIN_SUBSET_OBS:
            s, a = subset_snap[ss]
            subset_rates.append(s / a)

    if len(subset_rates) >= 5:  # at least 5 of 21 subsets have history
        return float(np.mean(subset_rates))

    # Fall back to player means
    player_rates = []
    for slug in slugs:
        if slug in player_snap and player_snap[slug][1] >= MIN_PLAYER_OBS:
            s, a = player_snap[slug]
            player_rates.append(s / a)

    if player_rates:
        return float(np.mean(player_rates))

    # Fall back to team
    if team_abbrev in team_snap and team_snap[team_abbrev][1] >= MIN_PLAYER_OBS:
        s, a = team_snap[team_abbrev]
        return s / a

    return 0.5  # uninformative prior


# ---------------------------------------------------------------------------
# Momentum
# ---------------------------------------------------------------------------

def compute_momentum(df: pd.DataFrame, window: int = 5) -> pd.Series:
    """
    For each score event, compute momentum as the sum of the last `window`
    point_scored_by values (+1 home, -1 away) PRIOR to this point.
    The current point is excluded.
    """
    momentum = []
    for game_id, grp in df.groupby("game_id", sort=False):
        scored_by = grp["point_scored_by"].tolist()
        for i in range(len(scored_by)):
            window_vals = scored_by[max(0, i - window):i]
            momentum.append(sum(window_vals))
    return pd.Series(momentum, index=df.index)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(db_path: str, out_csv: str, out_png: str):
    print(f"Connecting to {db_path} ...")
    con = sqlite3.connect(db_path)

    print("Fetching score events ...")
    df = pd.read_sql_query(SQL_POINTS, con)

    print("Fetching O-point history for rolling rates ...")
    o_pts = pd.read_sql_query(SQL_O_POINTS, con)
    con.close()

    print(f"Score events : {len(df):,}")
    print(f"O-point rows : {len(o_pts):,}")

    # --- build rolling rate tables -----------------------------------------
    print("Building rolling O-conversion rates ...")
    o_pts = o_pts.sort_values(["start_timestamp", "game_id"]).reset_index(drop=True)
    prior_subset, prior_player, prior_team = build_rolling_rates(o_pts)

    # Map game_id → index of LAST o_point row before this game starts
    # (we need to find, for each score event, which snapshot applies)
    # Build a per-game snapshot: use the state after all prior games' O-points
    game_order = o_pts.drop_duplicates("game_id", keep="first")[["game_id", "start_timestamp"]]
    game_order = game_order.sort_values("start_timestamp").reset_index(drop=True)

    # For each game, the applicable snapshot is the one at the index of
    # the first o_point row for that game (prior rows = prior games)
    game_first_idx = o_pts.groupby("game_id").apply(lambda x: x.index[0]).to_dict()

    # For a game not in o_pts at all (no O-points scraped), use empty snapshot
    def get_snaps_for_game(game_id):
        idx = game_first_idx.get(game_id, None)
        if idx is None or idx == 0:
            return {}, {}, {}
        return prior_subset[idx], prior_player[idx], prior_team[idx]

    # --- compute line_edge feature -----------------------------------------
    print("Computing line O-conversion edge ...")
    line_edge = []
    for _, row in df.iterrows():
        ss, ps, ts = get_snaps_for_game(row["game_id"])

        home_slugs = parse_line(row["home_o_line_json"])
        away_slugs = parse_line(row["away_o_line_json"])

        home_rate = lookup_line_rate(home_slugs, ss, ps, ts, row["home_abbrev"])
        away_rate = lookup_line_rate(away_slugs, ss, ps, ts, row["away_abbrev"])

        # line_edge = home O-rate minus away O-rate
        # positive = home line historically better on O
        line_edge.append(home_rate - away_rate)

    df["line_edge"] = line_edge

    # --- momentum -----------------------------------------------------------
    print("Computing momentum ...")
    df = df.sort_values(["start_timestamp", "game_id", "event_seq"]).reset_index(drop=True)
    df["momentum"] = compute_momentum(df, window=5)

    # --- core features ------------------------------------------------------
    df["progress"]  = np.sqrt(df["elapsed_s"] / df["total_s"])
    df["f_score"]   = df["delta"] * df["progress"]
    df["f_poss"]    = df["poss"].astype(float)
    df["f_momentum"] = df["momentum"].astype(float)
    df["f_line"]    = df["line_edge"].astype(float)

    # --- filter for fitting -------------------------------------------------
    df_valid = df[df["elapsed_s"] < df["total_s"]].copy()
    fit_df   = df_valid[df_valid["delta"] != 0].copy()
    print(f"Fit rows (non-tied, elapsed < total): {len(fit_df):,}")
    print(f"Games represented: {fit_df['game_id'].nunique():,}")

    y = fit_df["home_won"].values.astype(int)

    # --- fit models ---------------------------------------------------------
    features = {
        "v2 (score + poss)":            ["f_score", "f_poss"],
        "v3a (+ momentum)":             ["f_score", "f_poss", "f_momentum"],
        "v3b (+ line edge)":            ["f_score", "f_poss", "f_line"],
        "v3 (+ momentum + line edge)":  ["f_score", "f_poss", "f_momentum", "f_line"],
    }

    results = {}
    print("\n========== FITTED COEFFICIENTS ==========")
    for label, cols in features.items():
        X = fit_df[cols].values
        coefs = fit_model(X, y)
        wp = sigmoid(X @ np.array(coefs))
        bs = brier_score_loss(y, wp)
        ll = log_loss(y, wp)
        acc = ((wp >= 0.5) == y).mean()
        results[label] = {"coefs": coefs, "cols": cols, "wp": wp, "bs": bs}
        print(f"\n  [{label}]")
        for col, c in zip(cols, coefs):
            print(f"    {col:<15}: {c:.4f}")
        print(f"    Log-loss={ll:.4f}  Brier={bs:.4f}  Acc={acc:.3f}")

    # --- improvement table --------------------------------------------------
    base_bs = results["v2 (score + poss)"]["bs"]
    print("\n========== BRIER IMPROVEMENT vs v2 ==========")
    for label, res in results.items():
        delta = (base_bs - res["bs"]) / base_bs * 100
        print(f"  {label:<40}: {delta:+.2f}%")

    # --- by-period for full v3 ----------------------------------------------
    best = "v3 (+ momentum + line edge)"
    best_coefs = np.array(results[best]["coefs"])
    best_cols  = results[best]["cols"]
    fit_df = fit_df.copy()
    fit_df["wp_v2"] = results["v2 (score + poss)"]["wp"]
    fit_df["wp_v3"] = results[best]["wp"]

    print("\n========== ACCURACY BY PERIOD (v2 vs v3) ==========")
    for period, grp in fit_df.groupby("period"):
        y_p  = grp["home_won"].values
        a2   = ((grp["wp_v2"].values >= 0.5) == y_p).mean()
        a3   = ((grp["wp_v3"].values >= 0.5) == y_p).mean()
        bs2  = brier_score_loss(y_p, grp["wp_v2"].values)
        bs3  = brier_score_loss(y_p, grp["wp_v3"].values)
        print(f"  {PERIOD_LABELS.get(period, f'P{period}'):>4}  n={len(grp):>5,}  "
              f"v2 acc={a2:.3f} BS={bs2:.4f}  "
              f"v3 acc={a3:.3f} BS={bs3:.4f}")

    # --- line edge coverage -------------------------------------------------
    known = (df["line_edge"] != 0.0).sum()
    print(f"\nLine edge non-zero (has prior history): {known:,} / {len(df):,} "
          f"({known/len(df):.1%})")

    # --- write CSV ----------------------------------------------------------
    df_valid["wp_v2"] = sigmoid(
        df_valid[["f_score", "f_poss"]].values
        @ np.array(results["v2 (score + poss)"]["coefs"])
    )
    df_valid["wp_v3"] = sigmoid(
        df_valid[best_cols].values @ best_coefs
    )
    df_valid.to_csv(out_csv, index=False)
    print(f"\nCSV written → {out_csv}  ({len(df_valid):,} rows)")

    # --- reliability diagram ------------------------------------------------
    fig, axes = plt.subplots(1, 2, figsize=(13, 5))
    fig.suptitle("UFA Win Probability — v2 vs v3 Reliability", fontsize=13)

    for ax, label, wp_col in zip(axes,
        ["v2 (score + poss)", best],
        ["wp_v2", "wp_v3"]
    ):
        y_p = fit_df["home_won"].values
        wp  = fit_df[wp_col].values
        pt, pp = calibration_curve(y_p, wp, n_bins=10, strategy="quantile")
        bs = brier_score_loss(y_p, wp)
        ax.plot([0, 1], [0, 1], "k--", lw=1, label="Perfect")
        ax.plot(pp, pt, "o-", lw=2, label=f"BS={bs:.4f}")
        ax.set_title(label, fontsize=10)
        ax.set_xlabel("Mean predicted WP")
        ax.set_ylabel("Fraction of home wins")
        ax.legend(fontsize=9)
        ax.set_xlim(0, 1); ax.set_ylim(0, 1)
        ax.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(out_png, dpi=150)
    print(f"Calibration plot → {out_png}")

    # --- final model --------------------------------------------------------
    print(f"\n========== FINAL MODEL (v3) ==========")
    print(f"  WP = σ(", end="")
    terms = [f"{c:.4f}·{n}" for c, n in zip(best_coefs, best_cols)]
    print("  +  ".join(terms) + ")")
    print(f"  where:")
    print(f"    f_score    = Δ · √(t/T)")
    print(f"    f_poss     = +1 (home O next), -1 (away O next)")
    print(f"    f_momentum = sum of last 5 point outcomes (+1 home, -1 away)")
    print(f"    f_line     = home_o_rate - away_o_rate (rolling C(7,5) subset mean)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fit UFA WP model v3")
    parser.add_argument("--db", required=True)
    parser.add_argument("--out-csv", default="wp_model_v3_results.csv")
    parser.add_argument("--out-png", default="wp_calibration_v3.png")
    args = parser.parse_args()
    main(args.db, args.out_csv, args.out_png)