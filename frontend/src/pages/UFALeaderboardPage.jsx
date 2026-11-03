import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import LeagueShell from '../components/LeagueShell.jsx';

const ORANGE = '#EA6020';

const CACHE_KEY = 'ufa_leaderboard_state_v1';
function loadCache() {
  try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null') || {}; } catch { return {}; }
}

const LABEL = {
  fontFamily: 'var(--font-h2)',
  fontSize: 9,
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color: 'var(--t-muted)',
  marginBottom: 5,
  display: 'block',
};

const SEL_STYLE = {
  background: 'var(--input-bg)',
  border: '1px solid var(--input-border)',
  color: 'var(--input-clr)',
  borderRadius: 6,
  padding: '7px 10px',
  fontFamily: 'var(--font-h2)',
  fontSize: 12,
  outline: 'none',
  cursor: 'pointer',
};

function SortIcon({ dir }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" style={{ marginLeft: 4, opacity: 0.7 }}>
      {dir === 1
        ? <path d="M4 1L7 6H1z" />
        : <path d="M4 7L1 2H7z" />
      }
    </svg>
  );
}

const COLS = [
  { key: 'player_name',     label: 'Player',   align: 'left',   width: '18%' },
  { key: 'team_name',       label: 'Team',     align: 'left',   width: '14%' },
  { key: 'games_played',    label: 'GP',       align: 'center', width: '7%'  },
  { key: 'goals',           label: 'G',        align: 'center', width: '7%'  },
  { key: 'assists',         label: 'A',        align: 'center', width: '7%'  },
  { key: 'blocks',          label: 'D',        align: 'center', width: '7%'  },
  { key: 'throwaways',      label: 'T',        align: 'center', width: '7%'  },
  { key: 'completions',     label: 'Comp',     align: 'center', width: '7%'  },
  { key: 'throw_attempts',  label: 'Att',      align: 'center', width: '7%'  },
  { key: 'hucks_completed', label: 'Hucks',    align: 'center', width: '7%'  },
  { key: 'plus_minus',      label: '+/−',      align: 'center', width: '8%'  },
];

export default function UFALeaderboardPage() {
  const _c = useRef(loadCache()).current;

  const [year,    setYear]    = useState(_c.year    ?? '');
  const [sortKey, setSortKey] = useState(_c.sortKey ?? 'goals');
  const [sortDir, setSortDir] = useState(_c.sortDir ?? -1);
  const [search,  setSearch]  = useState(_c.search  ?? '');
  const [limit,   setLimit]   = useState(_c.limit   ?? 200);

  const [data,   setData]   = useState(null);
  const [status, setStatus] = useState('idle');

  // Persist state
  useEffect(() => {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ year, sortKey, sortDir, search, limit }));
  }, [year, sortKey, sortDir, search, limit]);

  // Fetch data whenever filters change
  useEffect(() => {
    setStatus('loading');
    const params = new URLSearchParams({ sort: sortKey, limit });
    if (year) params.set('year', year);
    fetch(`/api/ufa/leaderboard?${params}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => { setData(d); setStatus('ready'); })
      .catch(() => setStatus('error'));
  }, [year, sortKey, limit]);

  // Client-side sort + search
  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.players;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        p.player_name?.toLowerCase().includes(q) ||
        p.team_name?.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
      if (typeof av === 'number') return sortDir * (bv - av);
      return sortDir * String(bv).localeCompare(String(av));
    });
  }, [data, search, sortKey, sortDir]);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d * -1);
    } else {
      setSortKey(key);
      setSortDir(-1);
    }
  }

  const years = data?.years ?? [];

  return (
    <LeagueShell league="ufa">

      {/* Header */}
      <div style={{ padding: '28px 32px 0', flexShrink: 0, background: 'var(--card-bg)' }}>
        <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: ORANGE, opacity: 0.7, marginBottom: 6 }}>
          UFA
        </div>
        <h1 style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: 'clamp(1.5rem, 2.5vw, 2rem)', color: 'var(--t-primary)', margin: '0 0 4px', letterSpacing: '-0.02em', textTransform: 'uppercase', lineHeight: 1 }}>
          Player Leaderboard
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)', margin: '0 0 20px' }}>
          Season statistics for all UFA players · +/− = Goals + Assists − Throwaways
        </p>

        {/* Filters */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', paddingBottom: 16, borderBottom: '1px solid var(--nav-border)' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={LABEL}>Season</span>
            <select value={year} onChange={e => setYear(e.target.value)} style={SEL_STYLE}>
              <option value="">All Seasons</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={LABEL}>Show</span>
            <select value={limit} onChange={e => setLimit(Number(e.target.value))} style={SEL_STYLE}>
              <option value={100}>Top 100</option>
              <option value={200}>Top 200</option>
              <option value={500}>Top 500</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 160 }}>
            <span style={LABEL}>Search</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Player or team…"
              style={{ ...SEL_STYLE, width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          {status === 'ready' && (
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)', paddingBottom: 8 }}>
              {rows.length} player{rows.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Table area */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '20px 32px 24px', overflow: 'hidden' }}>
        {status === 'error' && (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--t-muted)', marginTop: 0 }}>
            Failed to load leaderboard data.
          </p>
        )}
        {status === 'loading' && (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--t-muted)', marginTop: 0 }}>
            Loading…
          </p>
        )}
        {status === 'ready' && rows.length === 0 && !search && (
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--t-muted)', marginTop: 0 }}>
            No data for the selected filters.
          </p>
        )}

        {status === 'ready' && (rows.length > 0 || search) && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', border: '1px solid var(--surf-border)', borderRadius: 6, overflow: 'hidden' }}>
            {/* Fixed header */}
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800, tableLayout: 'fixed', flexShrink: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: '5%', padding: '9px 10px 9px 16px', textAlign: 'right', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', background: 'var(--thead-bg)', whiteSpace: 'nowrap' }}>#</th>
                  {COLS.map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      style={{
                        width: col.width,
                        padding: '9px 12px',
                        textAlign: col.align,
                        fontFamily: 'var(--font-h2)', fontSize: 9,
                        letterSpacing: '1.5px', textTransform: 'uppercase',
                        color: sortKey === col.key ? ORANGE : 'var(--t-muted)',
                        background: 'var(--thead-bg)',
                        cursor: 'pointer', userSelect: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {col.label}{sortKey === col.key && <SortIcon dir={sortDir} />}
                    </th>
                  ))}
                  {/* Spacer for scrollbar */}
                  <th style={{ width: 6, padding: 0, background: 'var(--thead-bg)' }} />
                </tr>
              </thead>
            </table>

            {/* Scrollable body */}
            <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'scroll', overflowX: 'auto', background: 'var(--card-bg)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 800, tableLayout: 'fixed' }}>
                <tbody>
                  {rows.map((p, i) => {
                    const pm = p.plus_minus ?? 0;
                    const rowBg = i % 2 === 0 ? 'var(--card-bg)' : 'var(--thead-bg)';
                    const playerLink = p.master_id ? `/players/${p.master_id}` : null;
                    return (
                      <tr
                        key={`${p.player_name}|${i}`}
                        style={{ borderTop: '1px solid var(--surf-border)', background: rowBg }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--surf-bg-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = rowBg}
                      >
                        <td style={{ width: '5%', padding: '8px 10px 8px 16px', textAlign: 'right', fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)' }}>{i + 1}</td>
                        <td style={{ width: '18%', padding: '8px 12px', fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: 13, color: 'var(--t-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {playerLink
                            ? <Link to={playerLink} style={{ color: 'inherit', textDecoration: 'none' }} onMouseEnter={e => e.currentTarget.style.color = ORANGE} onMouseLeave={e => e.currentTarget.style.color = 'inherit'}>{p.player_name}</Link>
                            : p.player_name
                          }
                        </td>
                        <td style={{ width: '14%', padding: '8px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.team_name}</td>
                        <td style={{ width: '7%',  padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 12, color: 'var(--t-muted)' }}>{p.games_played}</td>
                        <td style={{ width: '7%',  padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 13, color: sortKey === 'goals'           ? ORANGE : 'var(--t-primary)' }}>{p.goals}</td>
                        <td style={{ width: '7%',  padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 13, color: sortKey === 'assists'         ? ORANGE : 'var(--t-primary)' }}>{p.assists}</td>
                        <td style={{ width: '7%',  padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 13, color: sortKey === 'blocks'          ? ORANGE : 'var(--t-primary)' }}>{p.blocks}</td>
                        <td style={{ width: '7%',  padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 13, color: sortKey === 'throwaways'      ? ORANGE : 'var(--t-primary)' }}>{p.throwaways}</td>
                        <td style={{ width: '7%',  padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 12, color: sortKey === 'completions'     ? ORANGE : 'var(--t-muted)' }}>{p.completions}</td>
                        <td style={{ width: '7%',  padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 12, color: sortKey === 'throw_attempts'  ? ORANGE : 'var(--t-muted)' }}>{p.throw_attempts}</td>
                        <td style={{ width: '7%',  padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 12, color: sortKey === 'hucks_completed' ? ORANGE : 'var(--t-muted)' }}>{p.hucks_completed}</td>
                        <td style={{ width: '8%',  padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 13, color: sortKey === 'plus_minus' ? ORANGE : pm > 0 ? '#16A34A' : pm < 0 ? '#DC2626' : 'var(--t-muted)' }}>
                          {pm > 0 ? `+${pm}` : pm}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length === 0 && search && (
                <div style={{ padding: '24px 32px', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--t-muted)' }}>
                  No players match "{search}"
                </div>
              )}
            </div>
          </div>
        )}
      </div>

    </LeagueShell>
  );
}
