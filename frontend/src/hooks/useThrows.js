import { useEffect, useState } from 'react';

/**
 * Phase 1 data adapter: fetches manifest + season throw bundle from
 * static files under <BASE_URL>data/. Shaped so Phase 2 can swap the
 * implementation for an API call without changing consumers.
 *
 * Returned bundle shape mirrors the future API response:
 *   { items: Throw[], meta: { league, season, generated_at, ... } }
 */
export function useThrows({ league = 'UFA', season = null } = {}) {
  const [state, setState] = useState({
    status: 'loading',
    throws: [],
    players: [],
    teams: [],
    meta: null,
    seasons: [],          // [{id, year, throw_count, game_count}]
    activeSeason: null,   // resolved season number actually loaded
    games: [],            // game slugs in active season, sorted descending (latest first)
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const base = import.meta.env.BASE_URL ?? '/';
    const dataRoot = `${base}data/`;

    async function load() {
      try {
        const manifest = await fetchJson(`${dataRoot}manifest.json`);
        const leagueEntry = manifest.leagues?.[league];
        if (!leagueEntry) throw new Error(`League ${league} not in manifest`);
        if (leagueEntry.available === false) {
          if (cancelled) return;
          setState((s) => ({
            ...s,
            status: 'unavailable',
            throws: [], players: [], teams: [],
            meta: null,
            error: leagueEntry.reason ?? 'League data unavailable',
          }));
          return;
        }
        const files = leagueEntry.files;

        // Pick season: explicit prop wins; otherwise newest season in manifest
        // that actually has played throws (skip empty preseason bundles).
        const seasonsManifest = await fetchJson(`${dataRoot}${files.seasons}`);
        const seasonsList = (seasonsManifest.items ?? [])
          .slice()
          .sort((a, b) => b.year - a.year);
        let resolvedSeason = season;
        if (resolvedSeason == null) {
          const firstNonEmpty = seasonsList.find((s) => (s.throw_count ?? 0) > 0);
          resolvedSeason = (firstNonEmpty ?? seasonsList[0])?.year;
        }
        if (resolvedSeason == null) {
          throw new Error(`No seasons available for ${league}`);
        }
        const throwsPath = files.throws?.[String(resolvedSeason)];
        if (!throwsPath) {
          throw new Error(`No throws file for ${league} ${resolvedSeason}`);
        }

        const [throwsBundle, players, teams] = await Promise.all([
          fetchJson(`${dataRoot}${throwsPath}`),
          fetchJson(`${dataRoot}${files.players}`),
          fetchJson(`${dataRoot}${files.teams}`),
        ]);

        if (cancelled) return;
        // Only surface games that actually have throws so the default
        // selection is never an unplayed/preseason game.
        const playedSet = new Set();
        for (const t of throwsBundle.items ?? []) {
          if (t.game_id) playedSet.add(t.game_id);
        }
        // Newest game first. Slugs start with YYYY-MM-DD, so lexical desc works.
        const games = Array.from(playedSet).sort().reverse();
        setState({
          status: 'ready',
          throws: throwsBundle.items ?? [],
          players: players.items ?? [],
          teams: teams.items ?? [],
          meta: throwsBundle.meta ?? null,
          seasons: seasonsList,
          activeSeason: resolvedSeason,
          games,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState((s) => ({ ...s, status: 'error', error: err.message }));
      }
    }

    setState((s) => ({ ...s, status: 'loading' }));
    load();
    return () => { cancelled = true; };
  }, [league, season]);

  return state;
}

async function fetchJson(url) {
  // cache: 'no-store' avoids Chromium ERR_CACHE_READ_FAILURE on 304s when the
  // dev server is backed by a UNC/network path. Bundles are versioned via the
  // manifest so we don't rely on HTTP caching anyway.
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Fetch ${url} failed: ${r.status}`);
  return r.json();
}
