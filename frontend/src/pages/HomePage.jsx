import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSeasons } from '../hooks/useSeasons.js';

export default function HomePage() {
  const { status, seasons, players, error } = useSeasons();
  const navigate = useNavigate();
  const [activeSeason, setActiveSeason] = useState(null);
  const [playerSearch, setPlayerSearch] = useState('');
  const [tab, setTab] = useState('games');

  const season = useMemo(() => {
    if (!seasons.length) return null;
    const year = activeSeason ?? seasons[0]?.year;
    return seasons.find((s) => s.year === year) ?? seasons[0];
  }, [seasons, activeSeason]);

  const filteredPlayers = useMemo(() => {
    if (!playerSearch.trim()) return players;
    const q = playerSearch.toLowerCase();
    return players.filter((p) => (p.display_name ?? '').toLowerCase().includes(q));
  }, [players, playerSearch]);

  return (
    <div className="min-h-screen bg-[#0a0e14] text-slate-100 flex flex-col">
      <header className="border-b border-[#1a2535] px-6 py-4 flex items-center gap-4">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="text-slate-500 hover:text-slate-200 transition-colors text-lg leading-none mr-1"
          title="Back to league select"
        >
          ‹
        </button>
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-400">
            UFA · Next Gen
          </div>
          <div className="text-xl font-black uppercase tracking-[0.15em] text-white leading-none">
            Throw Chart
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Season sidebar */}
        <aside className="w-48 border-r border-[#1a2535] flex flex-col py-4 px-3 gap-1 shrink-0">
          <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-2 px-1">
            Season
          </div>
          {status === 'loading' && <div className="text-xs text-slate-500 px-1">Loading…</div>}
          {seasons.map((s) => (
            <button
              key={s.year}
              type="button"
              onClick={() => setActiveSeason(s.year)}
              className={
                'rounded px-3 py-2 text-left text-sm font-semibold transition-colors '
                + (season?.year === s.year
                  ? 'bg-[#4a90d9] text-white'
                  : 'text-slate-300 hover:bg-[#1a2535]')
              }
            >
              {s.year}
              <span className="ml-1 text-[10px] font-normal opacity-60">({s.game_count}g)</span>
            </button>
          ))}
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex border-b border-[#1a2535] px-6">
            {[{ id: 'games', label: 'Games' }, { id: 'players', label: 'Players' }].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={
                  'px-4 py-3 text-[11px] font-bold uppercase tracking-[0.15em] border-b-2 transition-colors '
                  + (tab === t.id
                    ? 'border-[#4a90d9] text-white'
                    : 'border-transparent text-slate-400 hover:text-slate-200')
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {status === 'error' && <div className="text-sm text-red-400">Error: {error}</div>}

            {tab === 'games' && season && (
              <div>
                <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  {season.year} · {season.game_count} games
                </div>
                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {(season.games ?? []).map((g) => (
                    <Link
                      key={g.game_id}
                      to={`/game/${g.game_id}`}
                      className="rounded-lg border border-[#1a2535] bg-[#0f1620] px-4 py-3
                                 hover:border-[#4a90d9] hover:bg-[#121e2e] transition-colors"
                    >
                      <div className="text-[10px] text-slate-500 mb-1">{g.date}</div>
                      <div className="font-bold text-white">
                        {g.away} <span className="text-slate-400 font-normal">@</span> {g.home}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-1">{g.throw_count} throws</div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {tab === 'players' && (
              <div>
                <input
                  type="text"
                  placeholder="Search players…"
                  value={playerSearch}
                  onChange={(e) => setPlayerSearch(e.target.value)}
                  className="mb-4 w-full max-w-sm rounded border border-[#1a2535] bg-[#0f1620]
                             px-3 py-2 text-sm text-slate-100 placeholder-slate-500
                             focus:border-[#4a90d9] focus:outline-none"
                />
                <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                  {filteredPlayers.slice(0, 200).map((p) => (
                    <Link
                      key={p.id}
                      to={`/player/${p.id}`}
                      className="rounded-lg border border-[#1a2535] bg-[#0f1620] px-3 py-2
                                 hover:border-[#4a90d9] hover:bg-[#121e2e] transition-colors"
                    >
                      <div className="font-semibold text-sm text-white truncate">{p.display_name}</div>
                      <div className="text-[10px] text-slate-500">{p.team_id}</div>
                    </Link>
                  ))}
                  {filteredPlayers.length > 200 && (
                    <div className="text-xs text-slate-500 col-span-full mt-1">
                      Showing 200 of {filteredPlayers.length} — refine search
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}