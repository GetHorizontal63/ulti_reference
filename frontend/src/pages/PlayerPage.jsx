import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePlayer } from '../hooks/usePlayer.js';
import ShotChart, { OUTCOME_LIST } from '../components/ShotChart.jsx';

const THROW_TYPES = ['pass', 'score', 'drop', 'throwaway', 'stall', 'callahan'];

const VIEWS = [
  { id: 'field', label: 'Full Field'        },
  { id: 'los',   label: 'Line of Scrimmage' },
];

export default function PlayerPage() {
  const { id } = useParams();
  const [activeGame,   setActiveGame]   = useState(null);
  const [activeSeason, setActiveSeason] = useState(null);
  const [throwTypes,   setThrowTypes]   = useState(new Set(THROW_TYPES));
  const [view,         setView]         = useState('field');

  const { status, player, throws, games, seasons, error } = usePlayer(id, activeGame);

  const filteredBySeason = useMemo(() => {
    if (activeGame)     return throws;
    if (!activeSeason)  return throws;
    return throws.filter((t) => t.game_id?.startsWith(String(activeSeason)));
  }, [throws, activeGame, activeSeason]);

  const filteredByType = useMemo(() =>
    filteredBySeason.filter((t) => throwTypes.has(t.pbp_throw_type)),
  [filteredBySeason, throwTypes]);

  const gamesInSeason = useMemo(() => {
    const year = activeSeason ?? seasons[0];
    if (!year) return games;
    return games.filter((g) => g.season === year);
  }, [games, seasons, activeSeason]);

  const summary = useMemo(() => {
    const TURNOVERS = new Set(['drop', 'throwaway', 'stall', 'callahan']);
    const total     = filteredByType.length;
    const scores    = filteredByType.filter((t) => t.pbp_throw_type === 'score').length;
    const turnovers = filteredByType.filter((t) => TURNOVERS.has(t.pbp_throw_type)).length;
    return {
      total, scores, turnovers,
      completionPct: total ? `${Math.round(((total - turnovers) / total) * 100)}%` : '—',
    };
  }, [filteredByType]);

  const pageTitle = player?.display_name ?? `Player ${id}`;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0a0e14] text-slate-100 flex flex-col">
      {/* Top bar */}
      <header className="z-10 border-b border-[#1a2535] px-4 py-3 flex items-center gap-3 shrink-0">
        <Link to="/"
          className="rounded bg-[rgba(23,28,39,0.92)] px-3 py-2 text-[11px] font-bold
                     uppercase tracking-[0.15em] text-slate-300 shadow hover:bg-[rgba(35,42,58,0.95)]">
          ← Home
        </Link>
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-400">UFA · Player</div>
          <div className="text-lg font-black uppercase tracking-[0.1em] text-white leading-none">
            {pageTitle}
            {player?.team_id && (
              <span className="ml-2 text-sm font-normal text-slate-400">{player.team_id}</span>
            )}
          </div>
        </div>

        <div className="ml-auto flex overflow-hidden rounded shadow backdrop-blur">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => setView(v.id)}
              className={
                'px-3 py-2 text-[11px] font-bold uppercase tracking-[0.15em] '
                + (view === v.id
                  ? 'bg-[#4a90d9] text-white'
                  : 'bg-[rgba(23,28,39,0.92)] text-slate-200 hover:bg-[rgba(35,42,58,0.95)]')
              }>
              {v.label}
            </button>
          ))}
        </div>

        <div className="hidden lg:flex flex-wrap items-center gap-3
                        rounded bg-[rgba(23,28,39,0.92)] px-3 py-2 shadow backdrop-blur">
          {OUTCOME_LIST.map((o) => (
            <span key={o.key} className="inline-flex items-center gap-1.5 text-[11px] font-semibold
                                         uppercase tracking-[0.1em] text-slate-200">
              <span className="inline-block h-3 w-3 rounded-full border-2"
                    style={{ borderColor: o.color, background: o.hollow ? 'transparent' : o.color }} />
              {o.label}
            </span>
          ))}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 border-r border-[#1a2535] flex flex-col overflow-hidden shrink-0">
          {/* Season selector */}
          <div className="px-3 py-3 border-b border-[#1a2535]">
            <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-2">Season</div>
            <div className="flex flex-wrap gap-1">
              <button type="button"
                onClick={() => { setActiveSeason(null); setActiveGame(null); }}
                className={'rounded px-2 py-1 text-xs font-semibold transition-colors '
                  + (!activeSeason ? 'bg-[#4a90d9] text-white' : 'text-slate-300 hover:bg-[#1a2535]')}>
                All
              </button>
              {seasons.map((y) => (
                <button key={y} type="button"
                  onClick={() => { setActiveSeason(y); setActiveGame(null); }}
                  className={'rounded px-2 py-1 text-xs font-semibold transition-colors '
                    + (activeSeason === y ? 'bg-[#4a90d9] text-white' : 'text-slate-300 hover:bg-[#1a2535]')}>
                  {y}
                </button>
              ))}
            </div>
          </div>

          {/* Game list */}
          <div className="flex-1 overflow-y-auto py-2">
            <button type="button"
              onClick={() => setActiveGame(null)}
              className={'w-full text-left px-3 py-2 text-xs font-semibold transition-colors '
                + (!activeGame ? 'bg-[#1a2535] text-white' : 'text-slate-400 hover:bg-[#1a2535]')}>
              All games <span className="opacity-60">({gamesInSeason.length})</span>
            </button>
            {gamesInSeason.map((g) => {
              const m = /^\d{4}-\d{2}-\d{2}-([A-Z]+)-([A-Z]+)$/.exec(g.game_id);
              const label = m ? `${m[1]} @ ${m[2]}` : g.game_id;
              return (
                <button key={g.game_id} type="button"
                  onClick={() => setActiveGame(g.game_id)}
                  className={'w-full text-left px-3 py-2 transition-colors '
                    + (activeGame === g.game_id ? 'bg-[#1a2535]' : 'hover:bg-[#111824]')}>
                  <div className="text-[10px] text-slate-500">{g.date}</div>
                  <div className="text-xs font-semibold text-slate-200">{label}</div>
                  <div className="text-[10px] text-slate-500">{g.throw_count} throws</div>
                </button>
              );
            })}
          </div>

          {/* Outcome toggles */}
          <div className="border-t border-[#1a2535] px-3 py-3">
            <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-2">Outcome</div>
            <div className="flex flex-wrap gap-1">
              {THROW_TYPES.map((o) => {
                const on = throwTypes.has(o);
                return (
                  <button key={o} type="button"
                    onClick={() => {
                      const next = new Set(throwTypes);
                      on ? next.delete(o) : next.add(o);
                      setThrowTypes(next);
                    }}
                    className={'rounded-full px-2 py-0.5 text-[10px] border transition-colors '
                      + (on
                        ? 'bg-[#4a90d9] text-white border-[#4a90d9]'
                        : 'bg-transparent text-slate-400 border-slate-600 hover:border-[#4a90d9]')}>
                    {o}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Chart */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 relative">
            {status === 'ready' && filteredByType.length > 0 ? (
              <ShotChart throws={filteredByType} fullScreen view={view} selectedPlayerId={id} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
                {status === 'loading' ? 'Loading player data…'
                 : status === 'error'  ? `Error: ${error}`
                 : 'No throws match filters.'}
              </div>
            )}
          </div>

          <footer className="z-10 border-t border-[#0a0f18] bg-[rgba(22,27,37,0.95)] shrink-0">
            <div className="flex w-full items-center gap-6 px-6 py-3">
              <div className="flex flex-col">
                <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  {pageTitle}
                  {activeGame ? ` · ${activeGame}` : activeSeason ? ` · ${activeSeason}` : ' · All seasons'}
                </span>
                <span className="font-mono text-xs text-slate-300">{filteredByType.length} throws</span>
              </div>
              <div className="grid flex-1 grid-cols-4 overflow-hidden rounded border border-[#263646]">
                {[
                  ['Throws', summary.total],
                  ['Completion %', summary.completionPct],
                  ['Scores', summary.scores],
                  ['Turnovers', summary.turnovers],
                ].map(([label, value]) => (
                  <div key={label}
                       className="border-r border-[#263646] bg-[#121820] px-4 py-1.5 text-center last:border-r-0">
                    <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#486080]">{label}</div>
                    <div className="text-2xl font-black leading-tight text-white">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}