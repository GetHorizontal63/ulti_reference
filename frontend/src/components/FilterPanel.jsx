import React from 'react';

// SVG event outcomes, verbatim from the UFA field-map legend.
const THROW_TYPES = [
  'pass', 'score', 'drop', 'throwaway', 'stall', 'callahan',
];

export default function FilterPanel({
  players, teams,
  seasons = [], games = [], activeSeason = null, onSeasonChange,
  filters, onChange,
}) {
  const set = (k, v) => onChange({ ...filters, [k]: v });

  // Cap the game list (sorted newest-first) but always keep the active
  // selection visible so users never lose their place.
  const MAX_GAMES = 200;
  const visibleGames = games.slice(0, MAX_GAMES);
  if (filters.gameId && !visibleGames.includes(filters.gameId)) {
    visibleGames.push(filters.gameId);
  }

  return (
    <div className="space-y-4">
      {seasons.length > 0 && (
        <Field label="Season">
          <select
            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            value={activeSeason ?? ''}
            onChange={(e) => onSeasonChange?.(Number(e.target.value))}
          >
            {seasons.map((s) => (
              <option key={s.id} value={s.year}>
                {s.year} · {s.game_count} games
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Game">
        <select
          className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          value={filters.gameId ?? ''}
          onChange={(e) => set('gameId', e.target.value || null)}
        >
          <option value="">All games in season</option>
          {visibleGames.map((g) => (
            <option key={g} value={g}>{formatGameLabel(g)}</option>
          ))}
        </select>
      </Field>

      <Field label="Team">
        <select
          className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          value={filters.teamId ?? ''}
          onChange={(e) => set('teamId', e.target.value || null)}
        >
          <option value="">All teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name ?? t.abbrev ?? t.id}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Thrower">
        <select
          className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          value={filters.throwerId ?? ''}
          onChange={(e) => set('throwerId', e.target.value || null)}
        >
          <option value="">All throwers</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>{p.display_name}</option>
          ))}
        </select>
      </Field>

      <Field label="Outcome">
        <div className="flex flex-wrap gap-2">
          {THROW_TYPES.map((o) => {
            const on = filters.throwTypes.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => {
                  const next = on
                    ? filters.throwTypes.filter((x) => x !== o)
                    : [...filters.throwTypes, o];
                  set('throwTypes', next);
                }}
                className={
                  'rounded-full px-3 py-1 text-xs border transition-colors ' +
                  (on
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-font border-slate-300 hover:border-primary')
                }
              >
                {o}
              </button>
            );
          })}
        </div>
      </Field>

    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">
        {label}
      </div>
      {children}
    </label>
  );
}

// Slug shape: YYYY-MM-DD-AWAY-HOME (e.g. 2025-07-26-MAD-MIN).
function formatGameLabel(slug) {
  const m = /^(\d{4})-(\d{2})-(\d{2})-([A-Z]+)-([A-Z]+)$/.exec(slug);
  if (!m) return slug;
  const [, , mm, dd, away, home] = m;
  return `${mm}/${dd} · ${away} @ ${home}`;
}
