import { useEffect, useState } from 'react';

const BASE = import.meta.env.BASE_URL ?? '/';
const DATA = `${BASE}data/ufa/`;

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Fetch ${url} failed: ${r.status}`);
  return r.json();
}

/**
 * Fetches a player's full throw history: data/ufa/players/<id>.json
 * Optionally filter to a specific game via `gameSlug`.
 *
 * Returns:
 *   status       'idle' | 'loading' | 'ready' | 'error'
 *   player       { id, display_name, team_id, ... }
 *   throws       all throws involving this player (or filtered to gameSlug)
 *   games        [{game_id, season, date, throw_count}] — full career game list
 *   seasons      unique season years this player has data for
 *   error        string | null
 */
export function usePlayer(playerId, gameSlug = null) {
  const [state, setState] = useState({
    status:  'idle',
    player:  null,
    throws:  [],
    games:   [],
    seasons: [],
    error:   null,
  });

  useEffect(() => {
    if (!playerId) {
      setState((s) => ({ ...s, status: 'idle', throws: [], player: null }));
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading', throws: [], error: null }));

    fetchJson(`${DATA}players/${playerId}.json`)
      .then((bundle) => {
        if (cancelled) return;
        const allThrows = bundle.items ?? [];
        const filtered  = gameSlug
          ? allThrows.filter((t) => t.game_id === gameSlug)
          : allThrows;
        const seasons = [...new Set((bundle.games ?? []).map((g) => g.season))].sort((a, b) => b - a);
        setState({
          status:  'ready',
          player:  bundle.player ?? null,
          throws:  filtered,
          games:   bundle.games  ?? [],
          seasons,
          error:   null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState((s) => ({ ...s, status: 'error', error: err.message }));
      });

    return () => { cancelled = true; };
  }, [playerId, gameSlug]);

  return state;
}