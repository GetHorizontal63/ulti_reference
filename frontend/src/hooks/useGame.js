import { useEffect, useState } from 'react';

const BASE = import.meta.env.BASE_URL ?? '/';
const DATA = `${BASE}data/ufa/`;

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Fetch ${url} failed: ${r.status}`);
  return r.json();
}

/**
 * Fetches a single game bundle: data/ufa/games/<slug>.json
 * Returns { status, throws, meta, players, teams, error }
 */
export function useGame(slug) {
  const [state, setState] = useState({
    status: 'idle',
    throws: [],
    meta: null,
    players: [],
    teams: [],
    error: null,
  });

  useEffect(() => {
    if (!slug) {
      setState((s) => ({ ...s, status: 'idle', throws: [], meta: null }));
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading', throws: [], meta: null, error: null }));

    Promise.all([
      fetchJson(`${DATA}games/${slug}.json`),
      fetchJson(`${DATA}players.json`),
      fetchJson(`${DATA}teams.json`),
    ]).then(([game, players, teams]) => {
      if (cancelled) return;
      setState({
        status:  'ready',
        throws:  game.items    ?? [],
        meta:    game.meta     ?? null,
        players: players.items ?? [],
        teams:   teams.items   ?? [],
        error:   null,
      });
    }).catch((err) => {
      if (cancelled) return;
      setState((s) => ({ ...s, status: 'error', error: err.message }));
    });

    return () => { cancelled = true; };
  }, [slug]);

  return state;
}