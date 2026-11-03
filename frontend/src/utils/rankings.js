/**
 * USAU Rankings Algorithm v2.0 — pure utility functions
 * All math lives here; no React imports.
 *
 * Formula source: official USAU algorithm description
 *   x = 125 + 475 * sin(min(1, (1−r)/0.5) * 0.4π) / sin(0.4π)
 *   where r = loserScore / (winnerScore − 1)
 */

const _SIN_04PI = Math.sin(0.4 * Math.PI); // ≈ 0.9511 — denominator, pre-computed

// ─────────────────────────────────────────────────────────────────────────────
// 1a. Rating Differential
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Compute the rating differential for a single game.
 * @param {number} winnerScore - Winning team's score
 * @param {number} loserScore  - Losing team's score
 * @returns {number} x — rating differential, clamped to [125, 600]
 */
export function computeX(winnerScore, loserScore) {
  if (winnerScore <= loserScore) throw new Error('Winner score must exceed loser score');

  // One-point game always returns 125
  if (winnerScore - loserScore === 1) return 125;

  // Blowout condition: winner ≥ 2× loser → max differential
  if (winnerScore >= 2 * loserScore) return 600;

  // Official USAU sine formula
  const r = loserScore / (winnerScore - 1);
  const t = Math.min(1, (1 - r) / 0.5);
  const x = 125 + 475 * Math.sin(t * 0.4 * Math.PI) / _SIN_04PI;
  return Math.min(600, Math.max(125, Math.round(x)));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1b. Score Weight
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Compute the score weight for a game.
 * Returns 1.0 if winning score >= 13 OR total score >= 19.
 * @param {number} W - winning score
 * @param {number} L - losing score
 * @returns {number} score weight in (0, 1]
 */
export function computeScoreWeight(W, L) {
  if (W >= 13 || W + L >= 19) return 1.0;
  const floor = Math.floor((W - 1) / 2);
  const effectiveL = Math.max(L, floor);
  return Math.sqrt((W + effectiveL) / 19);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1c. Date Weight
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Compute the date weight for a game.
 * Week 1 = the week containing Jan 1 of the season year.
 * Exponential interpolation from 0.5 (week 1) to 1.0 (lastRegularWeek).
 * Conference, Regional, and Sectional games are capped at lastRegularWeek weight (1.0).
 * @param {Date}   gameDate        - date the game was played
 * @param {Date}   seasonStart     - January 1 of the season year
 * @param {number} lastRegularWeek - week index of the last non-conf/regional tournament
 * @returns {number} date weight in [0.5, 1.0]
 */
export function computeDateWeight(gameDate, seasonStart, lastRegularWeek) {
  if (lastRegularWeek <= 1) return 1.0;
  const daysDiff = (gameDate - seasonStart) / (1000 * 60 * 60 * 24);
  let wi = Math.floor(daysDiff / 7) + 1;
  wi = Math.min(wi, lastRegularWeek);  // cap: conf/regional games get weight 1.0
  const k = Math.pow(2, 1 / (lastRegularWeek - 1));
  return 0.5 * Math.pow(k, wi - 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1d. Game Rating
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Compute the rating a team earns from a single game.
 * @param {boolean} won           - did this team win?
 * @param {number}  opponentRating
 * @param {number}  x             - rating differential from computeX()
 * @returns {number}
 */
export function computeGameRating(won, opponentRating, x) {
  return won ? opponentRating + x : opponentRating - x;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1e. Blowout Ignore Rule
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Determine if a game should be ignored for ratings purposes.
 * @param {number} winnerRating
 * @param {number} loserRating
 * @param {number} winnerScore
 * @param {number} loserScore
 * @param {number} winnerOtherResults - count of winner's other non-ignored games
 * @returns {boolean} true = ignore this game
 */
export function shouldIgnoreGame(winnerRating, loserRating, winnerScore, loserScore, winnerOtherResults) {
  const N = 5;
  return (
    winnerRating - loserRating > 600 &&
    winnerScore > 2 * loserScore + 1 &&
    winnerOtherResults >= N
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1f. Full Season Ratings (Iterative Solver)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Compute final ratings for all teams via iterative convergence.
 *
 * @param {Array}  games           - array of game objects:
 *   { id, winnerTeam, loserTeam, winnerScore, loserScore, gameDate: string }
 * @param {Date}   seasonStart     - January 1 of the season year
 * @param {number} lastRegularWeek - week index of the last non-conf/regional tournament
 * @param {number} iterations      - default 1000
 * @returns {Object} map of teamName → final rating
 */
export function computeSeasonRatings(games, seasonStart, lastRegularWeek, iterations = 1000) {
  return computeSeasonRatingsDetailed(games, seasonStart, lastRegularWeek, iterations).ratings;
}

/**
 * Same as computeSeasonRatings but also returns the final ignored game set.
 * Uses pre-indexed data structures for O(games × avg_wins) instead of O(games²).
 * @returns {{ ratings: Object, ignored: Set<string> }}
 */
export function computeSeasonRatingsDetailed(games, seasonStart, lastRegularWeek, iterations = 1000) {
  // Collect all teams
  const teams = new Set();
  games.forEach(g => { teams.add(g.winnerTeam); teams.add(g.loserTeam); });

  // Initialize all ratings to 1000
  let ratings = {};
  teams.forEach(t => { ratings[t] = 1000; });

  // Pre-index: games each team participates in (avoids O(games) scan per team per iter)
  const gamesByTeam = {};
  games.forEach(g => {
    (gamesByTeam[g.winnerTeam] ??= []).push(g);
    (gamesByTeam[g.loserTeam]  ??= []).push(g);
  });

  // Pre-index: win game IDs per winner team (for fast blowout-ignore counting)
  const winIdsByTeam = {};
  games.forEach(g => { (winIdsByTeam[g.winnerTeam] ??= []).push(g.id); });

  // Pre-compute per-game x / score-weight / date-weight (invariant across iterations)
  const preX  = {};
  const preSW = {};
  const preDW = {};
  games.forEach(g => {
    preX[g.id]  = computeX(g.winnerScore, g.loserScore);
    preSW[g.id] = computeScoreWeight(g.winnerScore, g.loserScore);
    preDW[g.id] = computeDateWeight(new Date(g.gameDate), seasonStart, lastRegularWeek);
  });

  let ignored = new Set();

  for (let iter = 0; iter < iterations; iter++) {
    ignored = new Set();

    // Blowout-ignore pass — O(games × avg_wins_per_team)
    games.forEach(g => {
      const teamWinIds = winIdsByTeam[g.winnerTeam] ?? [];
      let otherWins = 0;
      for (let i = 0; i < teamWinIds.length; i++) {
        const wid = teamWinIds[i];
        if (wid !== g.id && !ignored.has(wid)) otherWins++;
      }
      if (shouldIgnoreGame(
        ratings[g.winnerTeam], ratings[g.loserTeam],
        g.winnerScore, g.loserScore, otherWins,
      )) {
        ignored.add(g.id);
      }
    });

    // Rating computation pass — O(games) total across all teams
    const newRatings = {};
    teams.forEach(team => {
      let weightedSum = 0;
      let totalWeight = 0;
      const teamGames = gamesByTeam[team] ?? [];
      for (let i = 0; i < teamGames.length; i++) {
        const g = teamGames[i];
        if (ignored.has(g.id)) continue;
        const isWinner   = g.winnerTeam === team;
        const opponent   = isWinner ? g.loserTeam : g.winnerTeam;
        const gameRating = computeGameRating(isWinner, ratings[opponent], preX[g.id]);
        const weight     = preSW[g.id] * preDW[g.id];
        weightedSum += gameRating * weight;
        totalWeight += weight;
      }
      newRatings[team] = totalWeight > 0 ? weightedSum / totalWeight : 1000;
    });

    ratings = newRatings;
  }

  return { ratings, ignored };
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-team iterative solver (Tab 2 — opponent ratings are fixed inputs)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Compute a single team's rating given games with fixed opponent ratings.
 *
 * @param {Array}  games           - array of:
 *   { id, won: boolean, myScore, oppScore, weekIndex, oppRating }
 *   weekIndex is 0-based (0 = Jan 1 week).
 * @param {number} lastRegularWeek  - week index of the last non-conf/regional tournament (1-based)
 * @param {number} iterations
 * @returns {{ rating: number, gameBreakdowns: Array, ignoredIds: Set<string> }}
 */
export function computeTeamRating(games, lastRegularWeek, iterations = 100) {
  let rating = 1000;
  let ignoredIds = new Set();

  for (let iter = 0; iter < iterations; iter++) {
    ignoredIds = new Set();

    games.forEach(g => {
      const winnerScore = g.won ? g.myScore : g.oppScore;
      const loserScore  = g.won ? g.oppScore : g.myScore;
      if (winnerScore <= loserScore) return; // tie / invalid — skip

      if (g.won) {
        // My team won — check blowout ignore from my perspective
        const myOtherWins = games.filter(
          o => o.id !== g.id && o.won && !ignoredIds.has(o.id),
        ).length;
        if (shouldIgnoreGame(rating, g.oppRating, winnerScore, loserScore, myOtherWins)) {
          ignoredIds.add(g.id);
        }
      } else {
        // Opponent won — check from opponent's perspective
        // We don't know opponent's other results; assume ≥5 (conservative)
        if (shouldIgnoreGame(g.oppRating, rating, winnerScore, loserScore, 5)) {
          ignoredIds.add(g.id);
        }
      }
    });

    let weightedSum = 0;
    let totalWeight = 0;

    games.forEach(g => {
      if (ignoredIds.has(g.id)) return;
      const winnerScore = g.won ? g.myScore : g.oppScore;
      const loserScore  = g.won ? g.oppScore : g.myScore;
      if (winnerScore <= loserScore) return;

      const x          = computeX(winnerScore, loserScore);
      const gr         = computeGameRating(g.won, g.oppRating, x);
      const sw         = computeScoreWeight(winnerScore, loserScore);
      const _wi        = Math.min(g.weekIndex + 1, lastRegularWeek);
      const _k         = Math.pow(2, 1 / (lastRegularWeek - 1 || 1));
      const dw         = lastRegularWeek <= 1 ? 1.0 : 0.5 * Math.pow(_k, _wi - 1);
      const weight     = sw * dw;

      weightedSum += gr * weight;
      totalWeight += weight;
    });

    rating = totalWeight > 0 ? weightedSum / totalWeight : 1000;
  }

  // Build per-game breakdown using final converged rating
  const gameBreakdowns = games.map(g => {
    const winnerScore = g.won ? g.myScore : g.oppScore;
    const loserScore  = g.won ? g.oppScore : g.myScore;
    const valid       = winnerScore > loserScore;
    if (!valid) return { id: g.id, valid: false, ignored: ignoredIds.has(g.id) };

    const x          = computeX(winnerScore, loserScore);
    const gameRating = computeGameRating(g.won, g.oppRating, x);
    const scoreWeight = computeScoreWeight(winnerScore, loserScore);
    const _wi2        = Math.min(g.weekIndex + 1, lastRegularWeek);
    const _k2         = Math.pow(2, 1 / (lastRegularWeek - 1 || 1));
    const dateWeight  = lastRegularWeek <= 1 ? 1.0 : 0.5 * Math.pow(_k2, _wi2 - 1);

    return {
      id: g.id,
      valid: true,
      ignored: ignoredIds.has(g.id),
      x,
      gameRating,
      scoreWeight,
      dateWeight,
      weight: scoreWeight * dateWeight,
    };
  });

  return { rating, gameBreakdowns, ignoredIds };
}
