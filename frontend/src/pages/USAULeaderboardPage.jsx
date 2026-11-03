import React, { useState, useEffect, useRef, useMemo } from 'react';
import LeagueShell from '../components/LeagueShell.jsx';

const ORANGE = '#EA6020';

const CACHE_KEY = 'usau_leaderboard_state_v2';
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

const LEVEL_COLORS = {
  'College D1': '#2563EB',
  'College D3': '#7C3AED',
  'Club':       '#DC2626',
};

const DIV_COLORS = {
  Men:   '#1D4ED8',
  Women: '#BE185D',
  Mixed: '#065F46',
};

function LevelBadge({ level }) {
  const color = LEVEL_COLORS[level] || '#666';
  return (
    <span style={{
      background: color + '22',
      color,
      border: `1px solid ${color}44`,
      borderRadius: 4,
      padding: '2px 6px',
      fontFamily: 'var(--font-h2)',
      fontSize: 9,
      letterSpacing: '1px',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {level}
    </span>
  );
}

function DivBadge({ div }) {
  const color = DIV_COLORS[div] || '#666';
  return (
    <span style={{
      background: color + '18',
      color,
      border: `1px solid ${color}33`,
      borderRadius: 4,
      padding: '2px 6px',
      fontFamily: 'var(--font-h2)',
      fontSize: 9,
      letterSpacing: '1px',
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    }}>
      {div || '—'}
    </span>
  );
}

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

// ─── Main component ───────────────────────────────────────────────────────────
export default function USAULeaderboardPage() {
  const _c = useRef(loadCache()).current;

  const [year,     setYear]     = useState(_c.year     ?? '');
  const [level,    setLevel]    = useState(_c.level    ?? '');
  const [division, setDivision] = useState(_c.division ?? '');
  const [sortKey,  setSortKey]  = useState(_c.sortKey  ?? 'goals');
  const [sortDir,  setSortDir]  = useState(_c.sortDir  ?? -1);
  const [search,   setSearch]   = useState(_c.search   ?? '');
  const [limit,    setLimit]    = useState(_c.limit    ?? 200);

  const [data,   setData]   = useState(null);
  const [status, setStatus] = useState('idle');

  // Persist state
  useEffect(() => {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(
      { year, level, division, sortKey, sortDir, search, limit }
    ));
  }, [year, level, division, sortKey, sortDir, search, limit]);

  // Fetch data whenever filters change
  useEffect(() => {
    setStatus('loading');
    const params = new URLSearchParams({ sort: sortKey, limit });
    if (year)     params.set('year',     year);
    if (level)    params.set('level',    level);
    if (division) params.set('division', division);
    fetch(`/api/usau/leaderboard?${params}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => { setData(d); setStatus('ready'); })
      .catch(() => setStatus('error'));
  }, [year, level, division, sortKey, limit]);

  // Client-side sort + search
  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.players;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        p.player_name?.toLowerCase().includes(q) ||
        p.team?.toLowerCase().includes(q)
      );
    }
    const key = sortKey;
    return [...list].sort((a, b) => {
      const av = a[key] ?? 0, bv = b[key] ?? 0;
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

  const COLS = [
    { key: 'player_name', label: 'Player', align: 'left',   width: '10%' },
    { key: 'level',       label: 'Level',  align: 'center', width: '10%' },
    { key: 'division',    label: 'Div',    align: 'center', width: '10%' },
    { key: 'games',       label: 'GP',     align: 'center', width: '10%' },
    { key: 'goals',       label: 'G',      align: 'center', width: '10%' },
    { key: 'assists',     label: 'A',      align: 'center', width: '10%' },
    { key: 'blocks',      label: 'D',      align: 'center', width: '10%' },
    { key: 'turns',       label: 'T',      align: 'center', width: '10%' },
    { key: 'plus_minus',  label: '+/−',    align: 'center', width: '10%' },
  ];

  return (
    <LeagueShell league="usau">

      {/* ── Header ── */}
      <div style={{ padding: '28px 32px 0', flexShrink: 0, background: 'var(--card-bg)' }}>
        <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: ORANGE, opacity: 0.7, marginBottom: 6 }}>
          USAU Nationals
        </div>
        <h1 style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: 'clamp(1.5rem, 2.5vw, 2rem)', color: 'var(--t-primary)', margin: '0 0 4px', letterSpacing: '-0.02em', textTransform: 'uppercase', lineHeight: 1 }}>
          Player Leaderboard
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)', margin: '0 0 20px' }}>
          Cumulative stats from USAU Nationals match reports · +/− = Goals + Assists − Turnovers
        </p>

        {/* ── Filters ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', paddingBottom: 16, borderBottom: '1px solid var(--nav-border)' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={LABEL}>Year</span>
            <select value={year} onChange={e => setYear(e.target.value)} style={SEL_STYLE}>
              <option value="">All Years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={LABEL}>Level</span>
            <select value={level} onChange={e => setLevel(e.target.value)} style={SEL_STYLE}>
              <option value="">All Levels</option>
              <option value="D1">College D-I</option>
              <option value="D3">College D-III</option>
              <option value="Club">Club</option>
            </select>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={LABEL}>Division</span>
            <select value={division} onChange={e => setDivision(e.target.value)} style={SEL_STYLE}>
              <option value="">All Divisions</option>
              <option value="Men">Men</option>
              <option value="Women">Women</option>
              <option value="Mixed">Mixed</option>
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

      {/* ── Table area ── */}
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
            {/* Fixed header — not inside the scroll container */}
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700, tableLayout: 'fixed', flexShrink: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: '10%', padding: '9px 10px 9px 16px', textAlign: 'right', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', background: 'var(--thead-bg)', whiteSpace: 'nowrap' }}>#</th>
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
                  {/* Spacer matching scrollbar width */}
                  <th style={{ width: 6, padding: 0, background: 'var(--thead-bg)', flexShrink: 0 }} />
                </tr>
              </thead>
            </table>

            {/* Scrollable body — scrollbar stays below the header */}
            <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'scroll', overflowX: 'auto', background: 'var(--card-bg)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700, tableLayout: 'fixed' }}>
                <tbody>
                  {rows.map((p, i) => {
                    const pm = p.plus_minus ?? 0;
                    const rowBg = i % 2 === 0 ? 'var(--card-bg)' : 'var(--thead-bg)';
                    return (
                      <tr
                        key={`${p.player_name}|${i}`}
                        style={{ borderTop: '1px solid var(--surf-border)', background: rowBg }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--surf-bg-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = rowBg}
                      >
                        <td style={{ width: '10%', padding: '8px 10px 8px 16px', textAlign: 'right', fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)' }}>{i + 1}</td>
                        <td style={{ padding: '8px 12px', fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: 13, color: 'var(--t-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.player_name}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}><LevelBadge level={p.level} /></td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}><DivBadge div={p.division} /></td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 12, color: 'var(--t-muted)' }}>{p.games}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 13, color: sortKey === 'goals'     ? ORANGE : 'var(--t-primary)' }}>{p.goals}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 13, color: sortKey === 'assists'   ? ORANGE : 'var(--t-primary)' }}>{p.assists}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 13, color: sortKey === 'blocks'    ? ORANGE : 'var(--t-primary)' }}>{p.blocks}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 13, color: sortKey === 'turns'     ? ORANGE : 'var(--t-primary)' }}>{p.turns}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 13, color: sortKey === 'plus_minus' ? ORANGE : pm > 0 ? '#16A34A' : pm < 0 ? '#DC2626' : 'var(--t-muted)' }}>
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
