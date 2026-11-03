import { useEffect, useState } from 'react';

const BASE = import.meta.env.BASE_URL ?? '/';
const DATA = `${BASE}data/ufa/`;

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Fetch ${url} failed: ${r.status}`);
  return r.json();
}

/**
 * Fetches the seasons index: data/ufa/seasons.json
 * Returns:
 *   status   'loading' | 'ready' | 'error'
 *   seasons  [{id, year, game_count, throw_count, games: [{game_id, date, away, home, ...}]}]
 *   players  [{id, display_name, team_id, ...}]
 *   teams    [{id, abbrev}]
 *   error    string | null
 */
export function useSeasons() {
  const [state, setState] = useState({
    status:  'loading',
    seasons: [],
    players: [],
    teams:   [],
    error:   null,
  });

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetchJson(`${DATA}seasons.json`),
      fetchJson(`${DATA}players.json`),
      fetchJson(`${DATA}teams.json`),
    ]).then(([seasons, players, teams]) => {
      if (cancelled) return;
      setState({
        status:  'ready',
        seasons: seasons.items ?? [],
        players: players.items ?? [],
        teams:   teams.items   ?? [],
        error:   null,
      });
    }).catch((err) => {
      if (cancelled) return;
      setState((s) => ({ ...s, status: 'error', error: err.message }));
    });

    return () => { cancelled = true; };
  }, []);

  return state;
}