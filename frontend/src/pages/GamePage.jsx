import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useGame } from '../hooks/useGame.js';
import ShotChart, { OUTCOME_LIST } from '../components/ShotChart.jsx';
import { buildPossessions } from '../utils/buildPossessions.js';

const THROW_TYPES = ['pass', 'score', 'drop', 'throwaway', 'stall', 'callahan'];

const VIEWS = [
  { id: 'field',      label: 'Full Field'        },
  { id: 'los',        label: 'Line of Scrimmage' },
  { id: 'possession', label: 'Possession'         },
];

export default function GamePage() {
  const { slug } = useParams();
  const { status, throws, players, teams, meta, error } = useGame(slug);

  const [teamId,      setTeamId]      = useState(null);
  const [throwerId,   setThrowerId]   = useState(null);
  const [throwTypes,  setThrowTypes]  = useState(new Set(THROW_TYPES));
  const [view,        setView]        = useState('field');
  const [possession,  setPossession]  = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(true);

  // Reset filters when game changes.
  useEffect(() => {
    setTeamId(null);
    setThrowerId(null);
    setThrowTypes(new Set(THROW_TYPES));
    setView('field');
    setPossession(0);
  }, [slug]);

  // Auto-select first team when switching to possession view with no team.
  useEffect(() => {
    if (view === 'possession' && !teamId && teams.length > 0) {
      setTeamId(teams[0].id);
    }
    if (view === 'possession') setPossession(0);
  }, [view]);

  const teamsInGame = useMemo(() => {
    const ids = new Set(throws.map((t) => t.team_id).filter(Boolean));
    return teams.filter((t) => ids.has(t.id));
  }, [throws, teams]);

  const throwersInGame = useMemo(() => {
    const ids = new Set();
    for (const t of throws) {
      if (teamId && t.team_id !== teamId) continue;
      if (t.thrower_id)  ids.add(t.thrower_id);
      if (t.receiver_id) ids.add(t.receiver_id);
    }
    const lookup = new Map(players.map((p) => [p.id, p]));
    return Array.from(ids)
      .map((id) => lookup.get(id) ?? { id, display_name: id })
      .sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? ''));
  }, [throws, players, teamId]);

  const filtered = useMemo(() => throws.filter((t) => {
    if (teamId    && t.team_id    !== teamId)    return false;
    if (throwerId && t.thrower_id !== throwerId
                  && t.receiver_id !== throwerId) return false;
    if (!throwTypes.has(t.pbp_throw_type))       return false;
    return true;
  }), [throws, teamId, throwerId, throwTypes]);

  const possessions = useMemo(() => {
    const base = teamId ? throws.filter((t) => t.team_id === teamId) : throws;
    return buildPossessions(base);
  }, [throws, teamId]);

  const possessionThrows = useMemo(() => {
    if (view !== 'possession' || !possessions.length) return [];
    const idx = Math.min(possession, possessions.length - 1);
    return possessions[idx]?.throws ?? [];
  }, [view, possessions, possession]);

  useEffect(() => {
    setPossession((p) => Math.min(p, Math.max(0, possessions.length - 1)));
  }, [possessions]);

  const activeThrows = view === 'possession' ? possessionThrows : filtered;

  const summary = useMemo(() => {
    const TURNOVERS = new Set(['drop', 'throwaway', 'stall', 'callahan']);
    const total    = activeThrows.length;
    const scores   = activeThrows.filter((t) => t.pbp_throw_type === 'score').length;
    const turnovers = activeThrows.filter((t) => TURNOVERS.has(t.pbp_throw_type)).length;
    const completed = total - turnovers;
    return {
      total,
      scores,
      turnovers,
      completionPct: total ? `${Math.round((completed / total) * 100)}%` : '—',
    };
  }, [activeThrows]);

  const currentPossIdx = Math.min(possession, Math.max(0, possessions.length - 1));

  const gameLabel = (() => {
    if (meta) return `${meta.away} @ ${meta.home}`;
    const m = /^\d{4}-\d{2}-\d{2}-([A-Z]+)-([A-Z]+)$/.exec(slug ?? '');
    return m ? `${m[1]} @ ${m[2]}` : slug;
  })();

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0a0e14] text-slate-100">
      {/* Chart */}
      <div className="absolute inset-0">
        {status === 'ready' && activeThrows.length > 0 ? (
          <ShotChart
            throws={activeThrows}
            fullScreen
            view={view === 'possession' ? 'field' : view}
            selectedPlayerId={throwerId}
            isPossessionView={view === 'possession'}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
            {status === 'loading' ? 'Loading game…'
             : status === 'error' ? `Error: ${error}`
             : 'No throws match filters.'}
          </div>
        )}
      </div>

      {/* Top HUD */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start
                         justify-between gap-3 p-4">
        <div className="pointer-events-auto flex items-center gap-3">
          <Link to="/"
            className="rounded bg-[rgba(23,28,39,0.92)] px-3 py-2 text-[11px] font-bold
                       uppercase tracking-[0.15em] text-slate-300 shadow-lg backdrop-blur
                       hover:bg-[rgba(35,42,58,0.95)]">
            ← Home
          </Link>
          <div className="rounded bg-[rgba(23,28,39,0.92)] px-4 py-2 shadow-lg backdrop-blur">
            <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              UFA · {slug?.slice(0, 4)}
            </div>
            <div className="text-lg font-black uppercase tracking-[0.15em] text-white leading-none">
              {gameLabel}
            </div>
          </div>
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center gap-3
                        rounded bg-[rgba(23,28,39,0.92)] px-4 py-2 shadow-lg backdrop-blur">
          {OUTCOME_LIST.map((o) => (
            <span key={o.key}
                  className="inline-flex items-center gap-1.5 text-[11px] font-semibold
                             uppercase tracking-[0.12em] text-slate-200">
              <span className="inline-block h-3 w-3 rounded-full border-2"
                    style={{ borderColor: o.color, background: o.hollow ? 'transparent' : o.color }} />
              {o.label}
            </span>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className="pointer-events-auto rounded bg-[rgba(23,28,39,0.92)] px-3 py-2
                     text-[11px] font-bold uppercase tracking-[0.15em] text-slate-100
                     shadow-lg backdrop-blur hover:bg-[rgba(35,42,58,0.95)]"
        >
          {filtersOpen ? 'Hide filters' : 'Show filters'}
        </button>
      </header>

      {/* View toggle */}
      <div className="pointer-events-auto absolute right-4 top-20 z-10 flex overflow-hidden
                      rounded shadow-lg backdrop-blur">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            className={
              'px-3 py-2 text-[11px] font-bold uppercase tracking-[0.15em] '
              + (view === v.id
                ? 'bg-[#4a90d9] text-white'
                : 'bg-[rgba(23,28,39,0.92)] text-slate-200 hover:bg-[rgba(35,42,58,0.95)]')
            }
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Possession navigator */}
      {view === 'possession' && possessions.length > 0 && (
        <div className="pointer-events-auto absolute right-4 top-36 z-10 flex flex-col items-end gap-2">
          <div className="flex items-center gap-0 overflow-hidden rounded shadow-lg backdrop-blur">
            <button
              type="button"
              disabled={currentPossIdx === 0}
              onClick={() => setPossession((p) => Math.max(0, p - 1))}
              className="bg-[rgba(23,28,39,0.92)] px-3 py-2 text-[13px] font-black text-slate-100
                         hover:bg-[rgba(35,42,58,0.95)] disabled:opacity-30 disabled:cursor-not-allowed"
            >‹</button>
            <div className="bg-[rgba(23,28,39,0.92)] px-4 py-2 text-center">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Possession</div>
              <div className="font-mono text-sm font-black text-white leading-tight">
                {currentPossIdx + 1} / {possessions.length}
              </div>
            </div>
            <button
              type="button"
              disabled={currentPossIdx === possessions.length - 1}
              onClick={() => setPossession((p) => Math.min(possessions.length - 1, p + 1))}
              className="bg-[rgba(23,28,39,0.92)] px-3 py-2 text-[13px] font-black text-slate-100
                         hover:bg-[rgba(35,42,58,0.95)] disabled:opacity-30 disabled:cursor-not-allowed"
            >›</button>
          </div>
          {possessions[currentPossIdx] && (
            <div className="rounded bg-[rgba(23,28,39,0.92)] px-3 py-1.5 text-center shadow-lg backdrop-blur">
              <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">
                {possessions[currentPossIdx].teamId ?? '—'}
              </div>
              <div className="font-mono text-xs text-slate-300">
                {possessions[currentPossIdx].throws.length} throw{possessions[currentPossIdx].throws.length !== 1 ? 's' : ''}
                {' · '}
                {(() => {
                  const last = possessions[currentPossIdx].throws.at(-1);
                  const type = last?.pbp_throw_type;
                  if (type === 'score') return '✓ Score';
                  if (['drop','throwaway','stall','callahan'].includes(type)) return '✗ Turnover';
                  return 'In progress';
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Filter rail */}
      {filtersOpen && (
        <aside className="absolute left-4 top-24 z-10 w-[260px] rounded-lg
                          bg-[rgba(23,28,39,0.94)] p-4 shadow-xl backdrop-blur space-y-4">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-300">Filters</h2>

          {status !== 'ready' ? (
            <p className="text-xs text-slate-400">{status === 'loading' ? 'Loading…' : error}</p>
          ) : (
            <>
              <Field label="Team">
                <select
                  className="w-full rounded border border-slate-600 bg-[#0f1620] px-2 py-1 text-sm text-slate-100"
                  value={teamId ?? ''}
                  onChange={(e) => { setTeamId(e.target.value || null); setThrowerId(null); }}
                >
                  <option value="">All teams</option>
                  {teamsInGame.map((t) => (
                    <option key={t.id} value={t.id}>{t.name ?? t.abbrev ?? t.id}</option>
                  ))}
                </select>
              </Field>

              <Field label="Player">
                <select
                  className="w-full rounded border border-slate-600 bg-[#0f1620] px-2 py-1 text-sm text-slate-100"
                  value={throwerId ?? ''}
                  onChange={(e) => setThrowerId(e.target.value || null)}
                >
                  <option value="">All players</option>
                  {throwersInGame.map((p) => (
                    <option key={p.id} value={p.id}>{p.display_name}</option>
                  ))}
                </select>
              </Field>

              <Field label="Outcome">
                <div className="flex flex-wrap gap-2">
                  {THROW_TYPES.map((o) => {
                    const on = throwTypes.has(o);
                    return (
                      <button
                        key={o}
                        type="button"
                        onClick={() => {
                          const next = new Set(throwTypes);
                          on ? next.delete(o) : next.add(o);
                          setThrowTypes(next);
                        }}
                        className={
                          'rounded-full px-3 py-1 text-xs border transition-colors '
                          + (on
                            ? 'bg-[#4a90d9] text-white border-[#4a90d9]'
                            : 'bg-transparent text-slate-400 border-slate-600 hover:border-[#4a90d9]')
                        }
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
              </Field>
            </>
          )}
        </aside>
      )}

      {/* Stats footer */}
      <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-10
                         flex items-stretch border-t border-[#0a0f18] bg-[rgba(22,27,37,0.95)]">
        <div className="pointer-events-auto flex w-full items-center gap-6 px-6 py-3">
          <div className="flex flex-col">
            <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-500">
              {slug}
              {view === 'possession' && possessions.length > 0
                ? ` · Poss ${currentPossIdx + 1}/${possessions.length}`
                : ''}
            </span>
            <span className="font-mono text-xs text-slate-300">
              {activeThrows.length} throws
            </span>
          </div>
          <div className="grid flex-1 grid-cols-4 overflow-hidden rounded border border-[#263646]">
            {[
              ['Throws',       summary.total],
              ['Completion %', summary.completionPct],
              ['Scores',       summary.scores],
              ['Turnovers',    summary.turnovers],
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
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      {children}
    </label>
  );
}