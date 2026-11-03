import React, { useState, useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import LeagueShell from '../components/LeagueShell.jsx';

const ORANGE = '#EA6020';

const STAT_COLS = [
  { key: 'games_played',    label: 'GP' },
  { key: 'goals',           label: 'G' },
  { key: 'assists',         label: 'A' },
  { key: 'hockey_assists',  label: 'HA' },
  { key: 'blocks',          label: 'B' },
  { key: 'turnovers',       label: 'TO' },
  { key: 'plus_minus',      label: '+/−', decimals: 1 },
  { key: 'touches',         label: 'Tch' },
  { key: 'throwing_yards',  label: 'ThY' },
  { key: 'catching_yards',  label: 'ReY' },
  { key: 'throw_err',       label: 'ThE' },
  { key: 'rec_err',         label: 'ReE' },
];

const TD  = { padding: '6px 14px', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-secondary)', whiteSpace: 'nowrap' };
const TH  = { padding: '8px 14px', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', whiteSpace: 'nowrap', textAlign: 'right' };

function fmt(val, col) {
  if (val == null) return '—';
  if (col.decimals != null) return Number(val).toFixed(col.decimals);
  return typeof val === 'number' ? val : val;
}

export default function PULTeamPage() {
  const { teamName } = useParams();
  const decodedName = decodeURIComponent(teamName);

  const [data,   setData]   = useState(null);
  const [status, setStatus] = useState('loading');
  const [tab,    setTab]    = useState('overview');
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [sortKey, setSortKey] = useState('goals');
  const [sortDir, setSortDir] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetch(`/api/pul/teams/${encodeURIComponent(decodedName)}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => {
        if (cancelled) return;
        setData(d);
        setStatus('ready');
        const seasons = d.seasons || [];
        if (seasons.length) setSelectedSeason(seasons[seasons.length - 1].season);
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [decodedName]);

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'roster',   label: 'Roster' },
  ];

  const seasonOptions = useMemo(() => {
    if (!data?.seasons) return [];
    return [...data.seasons].reverse().map(s => s.season);
  }, [data]);

  const rosterForSeason = useMemo(() => {
    if (!data?.roster || !selectedSeason) return [];
    return data.roster.filter(r => r.season === selectedSeason);
  }, [data, selectedSeason]);

  const sortedRoster = useMemo(() => {
    return [...rosterForSeason].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      return (av - bv) * sortDir;
    });
  }, [rosterForSeason, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(-1); }
  }

  if (status === 'loading') return (
    <PageShell teamName={decodedName}>
      <div style={{ padding: '64px 40px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>Loading…</div>
    </PageShell>
  );
  if (status === 'error') return (
    <PageShell teamName={decodedName}>
      <div style={{ padding: '64px 40px', textAlign: 'center', fontFamily: 'var(--font-body)', color: 'var(--t-muted)' }}>Could not load team data.</div>
    </PageShell>
  );

  const { seasons } = data;

  return (
    <PageShell teamName={decodedName}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--nav-border)', padding: '0 40px', flexShrink: 0 }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase',
              padding: '14px 18px', border: 'none', background: 'none', cursor: 'pointer',
              color: tab === t.key ? ORANGE : 'var(--t-muted)',
              borderBottom: tab === t.key ? `2px solid ${ORANGE}` : '2px solid transparent',
              marginBottom: -1, transition: 'color .13s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '28px 40px' }}>
        {tab === 'overview' && (
          <div>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: 16 }}>Season Summary</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 500 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                    {['Season', 'Players', 'Total GP', 'Goals', 'Assists', 'Blocks', 'Turnovers', 'ThY', 'ReY'].map(h => (
                      <th key={h} style={{ ...TH, textAlign: h === 'Season' ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...seasons].reverse().map((s, i) => (
                    <tr key={s.season} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--surf-bg-2)' }}>
                      <td style={{ ...TD, textAlign: 'left', color: 'var(--t-primary)', fontWeight: 500 }}>{s.season}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>{s.players}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>{s.total_gp}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>{s.goals}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>{s.assists}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>{s.blocks}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>{s.turnovers}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>{s.throwing_yards != null ? Math.round(s.throwing_yards) : '—'}</td>
                      <td style={{ ...TD, textAlign: 'right' }}>{s.catching_yards != null ? Math.round(s.catching_yards) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'roster' && (
          <div>
            {/* Season selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>Season:</span>
              <select
                className="orange-scroll"
                value={selectedSeason || ''}
                onChange={e => setSelectedSeason(e.target.value)}
                style={{ fontFamily: 'var(--font-h2)', fontSize: 10, padding: '4px 10px', borderRadius: 6, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--input-clr)', cursor: 'pointer' }}
              >
                {seasonOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>{sortedRoster.length} players</span>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 700 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                    <th style={{ ...TH, textAlign: 'left', cursor: 'default' }}>Player</th>
                    {STAT_COLS.map(col => (
                      <th
                        key={col.key}
                        onClick={() => toggleSort(col.key)}
                        style={{ ...TH, cursor: 'pointer', color: sortKey === col.key ? ORANGE : 'var(--t-muted)' }}
                      >
                        {col.label}{sortKey === col.key ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRoster.map((p, i) => (
                    <tr key={`${p.player_name}-${i}`} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--surf-bg-2)' }}>
                      <td style={{ ...TD, textAlign: 'left', color: 'var(--t-primary)', fontWeight: 500, minWidth: 160 }}>
                        {p.player_url ? (
                          <a href={p.player_url} target="_blank" rel="noreferrer" style={{ color: ORANGE, textDecoration: 'none' }}>{p.player_name}</a>
                        ) : p.player_name}
                      </td>
                      {STAT_COLS.map(col => (
                        <td key={col.key} style={{ ...TD, textAlign: 'right' }}>{fmt(p[col.key], col)}</td>
                      ))}
                    </tr>
                  ))}
                  {sortedRoster.length === 0 && (
                    <tr><td colSpan={STAT_COLS.length + 1} style={{ ...TD, textAlign: 'center', color: 'var(--t-muted)', padding: '32px' }}>No data for this season.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}

function PageShell({ teamName, children }) {
  return (
    <LeagueShell league="pul">
      {teamName && (
        <div style={{ padding: '24px 40px 20px', borderBottom: '1px solid var(--nav-border)', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--orange)', marginBottom: 6 }}>
            Premier Ultimate League
          </div>
          <h1 style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: '1.8rem', color: 'var(--t-primary)', margin: 0, letterSpacing: '-0.03em', textTransform: 'uppercase' }}>
            {teamName}
          </h1>
        </div>
      )}
      {children}
    </LeagueShell>
  );
}
