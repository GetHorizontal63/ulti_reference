"""
Possession Value (PV) Pipeline  — model-based approach
=======================================================
Computes per-throw Win Probability (WP) delta as the unit of value,
analogous to NFL Expected Points Added.

Key design:
  - WP model: polynomial Ridge on (fv_home_rel, score_diff, game_time_left)
    where fv_home_rel = fv_thrower if is_home_team else (1 - fv_thrower)
  - PV = (WP_after − WP_before) × team_sign  (no consecutive-row dependency)
  - WP_after determined by outcome type:
      COMPLETION  → model(fv_receiver, same_team, same_state)
      TURNOVER    → model(fv_opponent, other_team, same_state)
      SCORE(19)   → model(0.5, other_team, score_diff±1, same_time)
  - pv_above_field_expectation = pv − [cp·pv_if_completed + (1−cp)·pv_if_turnover]

Coordinate system (confirmed):
  - x: lateral yards, centre = 0  (±~27 yd half-width)
  - y: 0 = defending endzone, ≥100 = attacking goal  (Shownspace-normalised)
  - fv_thrower / fv_receiver: possessing-team scoring probability (0–1)
  - fv_opponent: opponent's scoring probability if they received disc here

Possession structure (confirmed):
  - possession_num  = position within the current point (1 = first possession)
  - possession_throw = throw index within that possession chain

Outputs
-------
  shownspace_throws  : pv, pv_above_field_expectation  (overwritten)
  field_value_grid   : (x INT, y INT, scoring_probability REAL)
  player_season_pv   : aggregated PV per player per season/team
  possession_summary : aggregated PV per possession chain
"""

import os
import sqlite3
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.special import expit, logit
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import PolynomialFeatures

# ── locate DB ──────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
DB_PATH = Path(os.environ.get("UFA_DB_PATH") or REPO_ROOT / "data" / "db" / "ultimate.db")


# ═══════════════════════════════════════════════════════════════════════════
# Step 1 – Field Value Grid
# ═══════════════════════════════════════════════════════════════════════════
def compute_field_value_grid(con: sqlite3.Connection) -> None:
    """
    Fit a degree-4 polynomial regression on existing fv_thrower values
    (Shownspace's scoring-probability surface) to produce a smooth
    1-yard-resolution grid stored in field_value_grid.

    Features: thrower_y (0-100), |thrower_x| (symmetric field).
    """
    print("Step 1: Building field_value_grid …")
    t0 = time.time()

    df = pd.read_sql_query(
        """
        SELECT thrower_x, thrower_y, fv_thrower
        FROM shownspace_throws
        WHERE fv_thrower IS NOT NULL
          AND thrower_y IS NOT NULL
          AND thrower_x IS NOT NULL
          AND thrower_y BETWEEN 0 AND 105
        """,
        con,
    )
    print(f"  Loaded {len(df):,} training rows")

    X = np.column_stack([df["thrower_y"].values, df["thrower_x"].abs().values])
    y = df["fv_thrower"].values

    model = make_pipeline(
        PolynomialFeatures(degree=4, include_bias=True),
        Ridge(alpha=1.0),
    )
    model.fit(X, y)
    r2 = model.score(X, y)
    print(f"  R² on training data: {r2:.4f}")

    # Generate 1-yard grid
    xs = np.arange(-25, 26, dtype=int)   # -25 … 25 lateral yards
    ys = np.arange(0, 101, dtype=int)    # 0 … 100 longitudinal yards
    grid_y, grid_x = np.meshgrid(ys, xs, indexing="ij")  # (101, 51)
    grid_x_flat = grid_x.ravel()
    grid_y_flat = grid_y.ravel()
    X_grid = np.column_stack([grid_y_flat, np.abs(grid_x_flat)])
    fv_pred = np.clip(model.predict(X_grid), 0.0, 1.0)

    con.execute("DROP TABLE IF EXISTS field_value_grid")
    con.execute(
        """
        CREATE TABLE field_value_grid (
            x INTEGER NOT NULL,
            y INTEGER NOT NULL,
            scoring_probability REAL NOT NULL,
            PRIMARY KEY (x, y)
        )
        """
    )
    rows = [
        (int(x), int(y), float(fv))
        for x, y, fv in zip(grid_x_flat, grid_y_flat, fv_pred)
    ]
    con.executemany("INSERT INTO field_value_grid VALUES (?,?,?)", rows)
    con.commit()
    print(f"  Stored {len(rows):,} grid points  [{time.time()-t0:.1f}s]")


# ═══════════════════════════════════════════════════════════════════════════
# Step 2a – Fit WP model
# ═══════════════════════════════════════════════════════════════════════════
def fit_wp_model(con: sqlite3.Connection):
    """
    Fit win_prob ~ poly3(fv_home_rel, score_diff, game_time_left) with Ridge.

    fv_home_rel = fv_thrower if is_home_team == 1 else (1 − fv_thrower).
    Higher fv_home_rel always means a better position for the home team,
    regardless of who currently has the disc.
    """
    print("Step 2a: Fitting WP model …")
    t0 = time.time()

    df = pd.read_sql_query(
        """
        SELECT fv_thrower, is_home_team, score_diff, game_time_left, win_prob
        FROM shownspace_throws
        WHERE win_prob IS NOT NULL
          AND fv_thrower IS NOT NULL
          AND score_diff IS NOT NULL
          AND game_time_left IS NOT NULL
        """,
        con,
    )

    df["fv_home_rel"] = np.where(
        df["is_home_team"] == 1, df["fv_thrower"], 1.0 - df["fv_thrower"]
    )
    # urgency captures "scores behind per remaining time" — the key end-game
    # cliff that degree-3 poly on raw features can't express on its own.
    df["urgency"] = df["score_diff"] / (df["game_time_left"].clip(lower=0) + 1.0)

    X = df[["fv_home_rel", "score_diff", "game_time_left", "urgency"]].values
    y = df["win_prob"].values

    # Fit in logit (log-odds) space so the polynomial operates on an unbounded
    # target.  Linear regression on raw probabilities extrapolates past 0/1 and
    # distorts predictions at mid-game states when score_diff is large.
    y_logit = logit(np.clip(y, 1e-4, 1.0 - 1e-4))

    # Up-weight endgame rows — they're sparse but critical for PV accuracy
    weights = np.where(df["game_time_left"] < 120, 10.0,
              np.where(df["game_time_left"] < 600,  3.0, 1.0))

    model = make_pipeline(
        PolynomialFeatures(degree=3, include_bias=True),
        Ridge(alpha=1.0),
    )
    model.fit(X, y_logit, ridge__sample_weight=weights)

    # Report R² on the original probability scale for interpretability
    y_hat_prob = expit(model.predict(X))
    ss_res = float(np.sum((y - y_hat_prob) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2_prob = 1.0 - ss_res / ss_tot
    print(f"  WP model R² = {r2_prob:.4f} on {len(df):,} rows (logit-space fit)  [{time.time()-t0:.1f}s]")
    return model


# ═══════════════════════════════════════════════════════════════════════════
# Step 2b – Per-throw PV
# ═══════════════════════════════════════════════════════════════════════════
def add_pv_columns(con: sqlite3.Connection) -> None:
    """Add PV columns to shownspace_throws (no-op if they already exist)."""
    for col, dtype in [
        ("pv", "REAL"),
        ("pv_above_field_expectation", "REAL"),
    ]:
        try:
            con.execute(f"ALTER TABLE shownspace_throws ADD COLUMN {col} {dtype}")
        except sqlite3.OperationalError:
            pass  # column already exists
    con.commit()


def compute_pv(con: sqlite3.Connection, wp_model) -> pd.DataFrame:
    """
    Vectorised model-based PV computation — no consecutive-row dependency.

    For each throw, WP_after is predicted at the OUTCOME field position via
    the fitted WP model, so interleaved home/away events cannot corrupt results.

    Outcome logic:
      COMPLETION  (turnover=0, drop=0, stall=0, type≠19)
                  → WP_after = model(fv_receiver, same_team, same_score, same_time)
      TURNOVER    (turnover=1 or dropped=1 or stall=1)
                  → opponent gets disc at fv_opponent
                  → WP_after = model(fv_opponent, other_team, same_score, same_time)
      SCORE       (source_event_type=19)
                  → score_diff ±1, opponent receives pull ≈ midfield (fv=0.5)
                  → WP_after = model(0.5, other_team, new_score_diff, same_time)

    pv_above_field_expectation = pv − [cp·pv_if_completed + (1−cp)·pv_if_turnover]
    (positive = beat completion-probability expectation; stored in existing column)
    """
    print("Step 2b: Computing per-throw PV (model-based) …")
    t0 = time.time()

    df = pd.read_sql_query(
        """
        SELECT id, is_home_team, win_prob,
               source_event_type, turnover, dropped_throw, stall,
               fv_thrower, fv_receiver, fv_opponent, receiver_y,
               score_diff, game_time_left, cp
        FROM shownspace_throws
        WHERE win_prob IS NOT NULL
          AND fv_thrower IS NOT NULL
          AND score_diff IS NOT NULL
          AND game_time_left IS NOT NULL
        """,
        con,
    )
    print(f"  Loaded {len(df):,} rows")

    # ── raw arrays ──────────────────────────────────────────────────────
    is_home   = df["is_home_team"].values.astype(float)
    fv_throw  = df["fv_thrower"].values
    fv_rec    = df["fv_receiver"].fillna(df["fv_thrower"]).values
    fv_opp    = df["fv_opponent"].fillna(1.0 - df["fv_thrower"]).values
    sd        = df["score_diff"].values
    tl        = df["game_time_left"].fillna(0.0).values
    cp_val    = df["cp"].fillna(0.85).values  # fallback 85 % if missing

    # ── outcome masks ────────────────────────────────────────────────────
    # A throw scores whenever the receiver is past the goal line (y ≥ 100),
    # regardless of event type (type=19 is the primary score event, but
    # type=22 "turnovers" that land in the endzone are also scores).
    recv_y = df["receiver_y"].fillna(0.0).values
    is_score    = (recv_y >= 100.0)
    is_turnover = (
        ((df["turnover"] == 1) | (df["dropped_throw"] == 1) | (df["stall"] == 1)).values
        & ~is_score  # endzone catches are scores, not turnovers
    )
    is_completion = ~is_score & ~is_turnover

    # ── helper: fv → fv_home_rel ─────────────────────────────────────────
    def fv_hr(fv: np.ndarray, home_has_disc: np.ndarray) -> np.ndarray:
        return np.where(home_has_disc == 1, fv, 1.0 - fv)

    # ── fv_home_rel at each outcome type ─────────────────────────────────
    # Completion: same team, disc at receiver position
    fv_hr_compl = fv_hr(fv_rec, is_home)
    # Turnover: new_is_home = 1−is_home; opponent fv = fv_opponent
    fv_hr_turn  = fv_hr(fv_opp, 1.0 - is_home)
    # Score: opponent receives pull, fv ≈ 0.5; fv_hr(0.5, anything) = 0.5
    fv_hr_score = np.full(len(df), 0.5)

    # ── game state at outcome ────────────────────────────────────────────
    sd_after = np.where(is_score, sd + np.where(is_home == 1, 1, -1), sd)

    fv_hr_after = np.where(
        is_completion, fv_hr_compl,
        np.where(is_turnover, fv_hr_turn, fv_hr_score),
    )

    # ── WP predictions (vectorised) ───────────────────────────────────
    poly  = wp_model.named_steps["polynomialfeatures"]
    ridge = wp_model.named_steps["ridge"]

    def wp_predict(fv_hr_vec, sd_vec, tl_vec):
        urgency = sd_vec / (np.clip(tl_vec, 0, None) + 1.0)
        X = np.column_stack([fv_hr_vec, sd_vec, tl_vec, urgency])
        return np.clip(expit(ridge.predict(poly.transform(X))), 0.0, 1.0)

    # Use our model for wp_before too — avoids calibration mismatch with
    # Shownspace's raw win_prob column (which is a different model).
    fv_hr_before = fv_hr(fv_throw, is_home)
    wp_before    = wp_predict(fv_hr_before, sd, tl)

    wp_after = wp_predict(fv_hr_after, sd_after, tl)

    # ── PV from thrower's perspective ─────────────────────────────────
    team_sign = np.where(is_home == 1, 1.0, -1.0)
    pv = (wp_after - wp_before) * team_sign

    # ── CP-weighted expected PV ──────────────────────────────────────────
    wp_if_compl = wp_predict(fv_hr_compl, sd, tl)
    wp_if_turn  = wp_predict(fv_hr_turn,  sd, tl)
    pv_if_compl = (wp_if_compl - wp_before) * team_sign
    pv_if_turn  = (wp_if_turn  - wp_before) * team_sign
    expected_pv = cp_val * pv_if_compl + (1.0 - cp_val) * pv_if_turn
    pv_above    = pv - expected_pv

    print(
        f"  PV: mean={pv.mean():.5f}  std={pv.std():.4f}"
        f"  above: mean={pv_above.mean():.5f}  [{time.time()-t0:.1f}s]"
    )

    # ── bulk-update DB ────────────────────────────────────────────────────
    print("  Writing to DB …")
    tmp = pd.DataFrame(
        {"id": df["id"].values, "pv": pv, "pv_above_field_expectation": pv_above}
    )
    tmp.to_sql("_pv_tmp", con, if_exists="replace", index=False)
    con.execute("CREATE INDEX IF NOT EXISTS _pv_tmp_id ON _pv_tmp(id)")
    con.execute(
        """
        UPDATE shownspace_throws
        SET pv = (
                SELECT pv FROM _pv_tmp WHERE _pv_tmp.id = shownspace_throws.id
            ),
            pv_above_field_expectation = (
                SELECT pv_above_field_expectation
                FROM _pv_tmp
                WHERE _pv_tmp.id = shownspace_throws.id
            )
        WHERE id IN (SELECT id FROM _pv_tmp)
        """
    )
    con.execute("DROP TABLE IF EXISTS _pv_tmp")
    con.commit()
    print(f"  Updated {len(df):,} rows  [{time.time()-t0:.1f}s]")
    return df


# ═══════════════════════════════════════════════════════════════════════════
# Step 3 – Player Season PV
# ═══════════════════════════════════════════════════════════════════════════
def build_player_season_pv(con: sqlite3.Connection) -> None:
    """
    Aggregate PV by player (slug), season (year), and team.

    Thrower PV: all throw attempts (completions + turnovers).
    Receiver PV: completions only.
    vae = pv_above_field_expectation sum (beat-CP-expectation metric).
    """
    print("Step 3: Building player_season_pv …")
    t0 = time.time()

    # ── throws (all attempts) ────────────────────────────────────────────
    thr = pd.read_sql_query(
        """
        SELECT t.thrower                                                         AS player,
               g.year                                                            AS season,
               CASE WHEN t.is_home_team = 1
                    THEN g.home_team_id
                    ELSE g.away_team_id END                                      AS team_id,
               t.pv,
               t.pv_above_field_expectation                                     AS pv_above,
               CASE WHEN t.turnover=0 AND t.dropped_throw=0 AND t.stall=0
                    THEN 1 ELSE 0 END                                            AS completed
        FROM shownspace_throws t
        JOIN shownspace_games g ON t.game_id = g.game_id
        WHERE t.pv IS NOT NULL AND t.thrower IS NOT NULL
        """,
        con,
    )

    thr_agg = (
        thr.groupby(["player", "season", "team_id"])
        .agg(
            throw_attempts=("pv",       "count"),
            completions   =("completed","sum"),
            throws_pv_sum =("pv",       "sum"),
            thrower_vae   =("pv_above", "sum"),
        )
        .reset_index()
    )

    # ── catches (completions only) ───────────────────────────────────────
    rec = pd.read_sql_query(
        """
        SELECT t.receiver                                                         AS player,
               g.year                                                             AS season,
               CASE WHEN t.is_home_team = 1
                    THEN g.home_team_id
                    ELSE g.away_team_id END                                       AS team_id,
               t.pv,
               t.pv_above_field_expectation                                      AS pv_above
        FROM shownspace_throws t
        JOIN shownspace_games g ON t.game_id = g.game_id
        WHERE t.pv IS NOT NULL
          AND t.receiver IS NOT NULL
          AND t.turnover = 0
          AND t.dropped_throw = 0
          AND t.stall = 0
        """,
        con,
    )

    rec_agg = (
        rec.groupby(["player", "season", "team_id"])
        .agg(
            catches        =("pv",       "count"),
            catches_pv_sum =("pv",       "sum"),
            receiver_vae   =("pv_above", "sum"),
        )
        .reset_index()
    )

    # ── merge ────────────────────────────────────────────────────────────
    pv = thr_agg.merge(rec_agg, on=["player", "season", "team_id"], how="outer")
    pv = pv.fillna(
        {
            "throw_attempts": 0,
            "completions": 0,
            "throws_pv_sum": 0.0,
            "thrower_vae": 0.0,
            "catches": 0,
            "catches_pv_sum": 0.0,
            "receiver_vae": 0.0,
        }
    )
    pv["total_pv"] = pv["throws_pv_sum"] + pv["catches_pv_sum"]
    throws  = pv["throw_attempts"]
    touches = throws + pv["catches"]
    pv["per_throw_pv"] = np.where(throws  > 0, pv["throws_pv_sum"] / throws,  0.0)
    pv["per_touch_pv"] = np.where(touches > 0, pv["total_pv"]      / touches, 0.0)

    # ── store ────────────────────────────────────────────────────────────
    con.execute("DROP TABLE IF EXISTS player_season_pv")
    con.execute(
        """
        CREATE TABLE player_season_pv (
            player          TEXT    NOT NULL,
            season          INTEGER NOT NULL,
            team_id         TEXT    NOT NULL,
            throw_attempts  INTEGER,
            completions     INTEGER,
            throws_pv_sum   REAL,
            thrower_vae     REAL,
            catches         INTEGER,
            catches_pv_sum  REAL,
            receiver_vae    REAL,
            total_pv        REAL,
            per_throw_pv    REAL,
            per_touch_pv    REAL,
            PRIMARY KEY (player, season, team_id)
        )
        """
    )
    pv.to_sql("player_season_pv", con, if_exists="append", index=False, method="multi", chunksize=2000)
    con.commit()
    print(f"  Stored {len(pv):,} player-season rows  [{time.time()-t0:.1f}s]")


# ═══════════════════════════════════════════════════════════════════════════
# Step 4 – Possession Summary
# ═══════════════════════════════════════════════════════════════════════════
def build_possession_summary(con: sqlite3.Connection) -> None:
    """
    One row per unique possession chain.

    possession_num = which possession within the current point (1 = first,
    2 = after the first turnover, …).  The same possession_num repeats in
    each point, so we detect chain boundaries by watching possession_throw
    reset in the derived_sort_timestamp-ordered sequence.
    """
    print("Step 4: Building possession_summary …")
    t0 = time.time()

    df = pd.read_sql_query(
        """
        SELECT t.id,
               t.game_id,
               t.is_home_team,
               CASE WHEN t.is_home_team = 1
                    THEN g.home_team_id
                    ELSE g.away_team_id END     AS team_id,
               g.year                           AS season,
               t.possession_num,
               t.possession_throw,
               t.derived_sort_timestamp,
               t.thrower_x,
               t.thrower_y,
               t.receiver_y,
               t.fv_thrower,
               t.source_event_type,
               t.turnover,
               t.dropped_throw,
               t.stall,
               t.pv
        FROM shownspace_throws t
        JOIN shownspace_games   g ON t.game_id = g.game_id
        WHERE t.pv IS NOT NULL
          AND t.possession_throw > 0
        ORDER BY t.game_id, t.is_home_team, t.derived_sort_timestamp
        """,
        con,
    )
    print(f"  Loaded {len(df):,} throws for possession reconstruction")

    # ── detect possession chain boundaries ───────────────────────────────
    grp = ["game_id", "is_home_team"]
    df["_prev_pt"] = df.groupby(grp)["possession_throw"].shift(1)
    df["_prev_pn"] = df.groupby(grp)["possession_num"].shift(1)

    # New chain: possession_num changes OR possession_throw resets to 1
    df["_new_chain"] = (
        (df["possession_num"] != df["_prev_pn"].fillna(-1))
        | (
            (df["possession_throw"] == 1)
            & df["_prev_pt"].notna()
            & (df["_prev_pt"] > 1)
        )
    ).astype(int)

    df["block_id"] = df.groupby(grp)["_new_chain"].cumsum()

    # ── aggregate per possession chain ───────────────────────────────────
    chain_key = ["game_id", "is_home_team", "team_id", "season", "possession_num", "block_id"]

    first = (
        df.groupby(chain_key, sort=False)
        .first()
        .reset_index()
        [chain_key + ["thrower_x", "thrower_y", "fv_thrower"]]
        .rename(columns={"thrower_x": "entry_x", "thrower_y": "entry_y",
                         "fv_thrower": "entry_field_value"})
    )
    last = (
        df.groupby(chain_key, sort=False)
        .last()
        .reset_index()
        [chain_key + ["source_event_type", "receiver_y", "turnover", "dropped_throw", "stall"]]
    )
    agg = (
        df.groupby(chain_key, sort=False)
        .agg(throws_in_possession=("pv", "count"), total_pv=("pv", "sum"))
        .reset_index()
    )

    summary = first.merge(last, on=chain_key).merge(agg, on=chain_key)
    summary["entry_dist_to_endzone"] = np.maximum(
        0.0, 100.0 - summary["entry_y"].fillna(100)
    )
    # Score: type-19 OR endzone catch (receiver_y >= 100) — matches compute_pv logic
    is_score = (summary["source_event_type"] == 19) | (summary["receiver_y"].fillna(0) >= 100.0)
    summary["outcome"] = np.where(
        is_score, "score",
        np.where(
            (summary["turnover"] == 1) | (summary["dropped_throw"] == 1), "turnover",
            np.where(summary["stall"] == 1, "stall", "point_end"),
        ),
    )
    summary["possession_uid"] = (
        summary["game_id"].astype(str) + "_"
        + summary["team_id"].astype(str) + "_"
        + summary["possession_num"].astype(str) + "_"
        + summary["block_id"].astype(str)
    )

    # ── write possession_uid back to shownspace_throws for joins ─────────
    chain_key_cols = ["game_id", "is_home_team", "team_id", "season", "possession_num", "block_id"]
    throw_uid = df[["id"] + chain_key_cols].copy()
    throw_uid["possession_uid"] = (
        throw_uid["game_id"].astype(str) + "_"
        + throw_uid["team_id"].astype(str) + "_"
        + throw_uid["possession_num"].astype(str) + "_"
        + throw_uid["block_id"].astype(str)
    )
    throw_uid[["id", "possession_uid"]].to_sql(
        "_puid_tmp", con, if_exists="replace", index=False
    )
    con.execute("CREATE INDEX IF NOT EXISTS _puid_tmp_id ON _puid_tmp(id)")
    existing_cols = [r[1] for r in con.execute("PRAGMA table_info(shownspace_throws)").fetchall()]
    if "possession_uid" not in existing_cols:
        con.execute("ALTER TABLE shownspace_throws ADD COLUMN possession_uid TEXT")
    con.execute("""
        UPDATE shownspace_throws
        SET possession_uid = (SELECT possession_uid FROM _puid_tmp WHERE _puid_tmp.id = shownspace_throws.id)
        WHERE id IN (SELECT id FROM _puid_tmp)
    """)
    con.execute("DROP TABLE IF EXISTS _puid_tmp")
    con.commit()

    summary["pv_above_entry_expectation"] = (
        summary["total_pv"] - (summary["entry_field_value"].fillna(0.5) - 0.5)
    )

    out = summary[
        [
            "possession_uid", "game_id", "season", "team_id", "is_home_team",
            "possession_num", "block_id",
            "entry_x", "entry_y", "entry_dist_to_endzone", "entry_field_value",
            "outcome", "throws_in_possession", "total_pv", "pv_above_entry_expectation",
        ]
    ]

    con.execute("DROP TABLE IF EXISTS possession_summary")
    con.execute(
        """
        CREATE TABLE possession_summary (
            possession_uid              TEXT PRIMARY KEY,
            game_id                     TEXT,
            season                      INTEGER,
            team_id                     TEXT,
            is_home_team                INTEGER,
            possession_num              INTEGER,
            block_id                    INTEGER,
            entry_x                     REAL,
            entry_y                     REAL,
            entry_dist_to_endzone       REAL,
            entry_field_value           REAL,
            outcome                     TEXT,
            throws_in_possession        INTEGER,
            total_pv                    REAL,
            pv_above_entry_expectation  REAL
        )
        """
    )
    out.to_sql(
        "possession_summary", con, if_exists="append",
        index=False, method="multi", chunksize=2000,
    )
    con.commit()
    n = con.execute("SELECT COUNT(*) FROM possession_summary").fetchone()[0]
    avg = con.execute("SELECT AVG(throws_in_possession) FROM possession_summary").fetchone()[0]
    outcomes = con.execute(
        "SELECT outcome, COUNT(*) FROM possession_summary GROUP BY outcome"
    ).fetchall()
    print(f"  Stored {n:,} possession chains  (avg {avg:.1f} throws/possession)  [{time.time()-t0:.1f}s]")
    print(f"  Outcomes: {dict(outcomes)}")


# ═══════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════
def main() -> None:
    if not DB_PATH.exists():
        print(f"ERROR: database not found at {DB_PATH}", file=sys.stderr)
        sys.exit(1)

    print(f"Connecting to {DB_PATH}")
    con = sqlite3.connect(str(DB_PATH))
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")

    t_total = time.time()

    compute_field_value_grid(con)
    wp_model = fit_wp_model(con)
    add_pv_columns(con)
    compute_pv(con, wp_model)
    build_player_season_pv(con)
    build_possession_summary(con)

    con.close()
    print(f"\nAll done in {time.time()-t_total:.1f}s")


if __name__ == "__main__":
    main()
