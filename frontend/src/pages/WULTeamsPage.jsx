import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import LeagueShell from '../components/LeagueShell.jsx';

const ORANGE = '#EA6020';

const TH_BASE = {
  padding: '10px 16px',
  textAlign: 'left',
  fontFamily: 'var(--font-h2)',
  fontSize: 9,
  letterSpacing: '1.5px',
  textTransform: 'uppercase',
  cursor: 'pointer',
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

export default function WULTeamsPage() {
  const navigate = useNavigate();

  const [teams,    setTeams]    = useState([]);
  const [status,   setStatus]   = useState('loading');
  const [query,    setQuery]    = useState('');
  const [sortKey,  setSortKey]  = useState('team_name');
  const [sortDir,  setSortDir]  = useState(1);
  const [viewMode, setViewMode] = useState('grid');
  const [page,     setPage]     = useState(1);
  const [activeFilter, setActiveFilter] = useState('all');

  const PAGE_SIZE = viewMode === 'table' ? 25 : 16;

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetch('/api/wul/teams')
      .then(r => r.json())
      .then(d => { if (!cancelled) { setTeams(d.teams); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return teams
      .filter(t => {
        if (activeFilter === 'active') return !!t.active;
        if (activeFilter === 'inactive') return !t.active;
        return true;
      })
      .filter(t => !q || t.team_name?.toLowerCase().includes(q))
      .sort((a, b) => {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
        return String(av).localeCompare(String(bv)) * sortDir;
      });
  }, [teams, query, sortKey, sortDir, activeFilter]);

  useEffect(() => { setPage(1); }, [query, sortKey, sortDir, viewMode, activeFilter]);

  const totalPages    = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedFiltered = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(1); }
  }

  function SortTh({ label, field, style = {} }) {
    const active = sortKey === field;
    return (
      <th onClick={() => toggleSort(field)} style={{ ...TH_BASE, ...style, color: active ? ORANGE : 'var(--t-muted)' }}>
        {label}{active ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
      </th>
    );
  }

  return (
    <LeagueShell league="wul">
      {/* ── Header ── */}
      <div style={{ padding: '28px 32px 20px', borderBottom: '1px solid var(--nav-border)', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, background: 'var(--card-bg)', flexShrink: 0 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: ORANGE, opacity: 0.7, marginBottom: 6 }}>
            Western Ultimate League
          </div>
          <div style={{ fontFamily: 'var(--font-h1)', fontSize: 'clamp(1.5rem, 2.5vw, 2rem)', letterSpacing: '-0.02em', textTransform: 'uppercase', color: 'var(--t-primary)', marginBottom: 6 }}>
            WUL Teams
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)' }}>
            All franchises in WUL history.
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: '1px solid var(--surf-border)', flexShrink: 0 }}>
            {[['table', IconTable], ['grid', IconGrid]].map(([mode, Icon]) => (
              <button key={mode} onClick={() => setViewMode(mode)} title={mode === 'table' ? 'Table view' : 'Grid view'}
                style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: viewMode === mode ? ORANGE : 'var(--surf-bg-2)', color: viewMode === mode ? '#fff' : 'var(--t-muted)', cursor: 'pointer', transition: 'background .12s, color .12s' }}>
                <Icon size={15} />
              </button>
            ))}
          </div>
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search teams…"
            style={{ width: 240, height: 36, padding: '0 14px', borderRadius: 8, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--input-clr)', fontFamily: 'var(--font-body)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
          />
        </div>
      </div>

      {/* ── Filter bar ── */}
      <div style={{ padding: '8px 32px', borderBottom: '1px solid var(--nav-border)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap', background: 'var(--card-bg)' }}>
        {[['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']].map(([val, label]) => (
          <button key={val} onClick={() => setActiveFilter(val)}
            style={{ height: 28, padding: '0 12px', borderRadius: 14, border: activeFilter === val ? `1px solid ${ORANGE}` : '1px solid rgba(234,96,32,0.30)', background: activeFilter === val ? 'rgba(234,96,32,0.14)' : 'transparent', color: activeFilter === val ? ORANGE : 'var(--t-secondary)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '0.5px', cursor: 'pointer', transition: 'all .1s', whiteSpace: 'nowrap' }}
          >{label}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '0.5px', color: 'var(--t-secondary)' }}>
          {filtered.length} team{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── States + content ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {(status === 'loading' || status === 'error') && (
          <div style={{ flex: 1 }}>
            {status === 'loading' && <div style={{ padding: '64px 32px', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase' }}>Loading…</div>}
            {status === 'error' && <div style={{ padding: '64px 32px', textAlign: 'center', color: ORANGE, fontFamily: 'var(--font-body)', fontSize: 13 }}>Could not load teams.</div>}
          </div>
        )}

        {/* ── Table view ── */}
        {status === 'ready' && viewMode === 'table' && (
          <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <div style={{ padding: '16px 32px 24px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--surf-border)', tableLayout: 'fixed' }}>
                <colgroup>
                  <col /><col style={{ width: '14%' }} /><col style={{ width: '14%' }} /><col style={{ width: '10%' }} />
                </colgroup>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr style={{ background: 'var(--surf-bg-2)', borderBottom: '2px solid var(--surf-border)' }}>
                    <SortTh label="Team" field="team_name" style={{ paddingLeft: 20 }} />
                    <SortTh label="First Year" field="first_year" style={{ textAlign: 'center' }} />
                    <SortTh label="Latest Year" field="latest_year" style={{ textAlign: 'center' }} />
                    <SortTh label="Active" field="active" style={{ textAlign: 'center', paddingRight: 20 }} />
                  </tr>
                </thead>
                <tbody>
                  {pagedFiltered.map((t, i) => (
                    <tr key={t.franchise_id}
                      onClick={() => navigate(`/wul/teams/${t.franchise_id}`)}
                      style={{ borderBottom: '1px solid var(--surf-border)', background: i % 2 === 0 ? 'transparent' : 'var(--surf-bg-2)', cursor: 'pointer', transition: 'background .1s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(234,96,32,0.07)'}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--surf-bg-2)'}
                    >
                      <td style={{ padding: '10px 16px 10px 20px', fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: 13, color: 'var(--t-primary)' }}>{t.team_name}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)' }}>{t.first_year ?? '—'}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)' }}>{t.latest_year ?? '—'}</td>
                      <td style={{ padding: '10px 20px 10px 16px', textAlign: 'center' }}>
                        {t.active
                          ? <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: '#22c55e' }} />
                          : <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: 'var(--t-muted)', opacity: 0.4 }} />
                        }
                      </td>
                    </tr>
                  ))}
                  {pagedFiltered.length === 0 && (
                    <tr><td colSpan={4} style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>No teams match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Grid view ── */}
        {status === 'ready' && viewMode === 'grid' && (
          <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 32px', boxSizing: 'border-box' }}>
            {pagedFiltered.length === 0 ? (
              <div style={{ padding: '64px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>No teams match.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                {pagedFiltered.map((t, i) => (
                  <TeamCard key={t.franchise_id} team={t} rank={(page - 1) * PAGE_SIZE + i + 1}
                    onClick={() => navigate(`/wul/teams/${t.franchise_id}`)} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Pagination ── */}
        {status === 'ready' && totalPages > 1 && (
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 32px 14px', borderTop: '1px solid var(--nav-border)', background: 'var(--card-bg)' }}>
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-primary)' }}>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                style={{ height: 34, padding: '0 18px', borderRadius: 6, border: '1px solid var(--nav-border)', background: 'transparent', color: page === 1 ? 'var(--t-muted)' : 'var(--t-primary)', fontFamily: 'var(--font-h2)', fontSize: 12, cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                style={{ height: 34, padding: '0 18px', borderRadius: 6, border: `1px solid ${page === totalPages ? 'rgba(234,96,32,0.20)' : ORANGE}`, background: page === totalPages ? 'transparent' : ORANGE, color: page === totalPages ? 'var(--t-muted)' : '#fff', fontFamily: 'var(--font-h2)', fontSize: 12, cursor: page === totalPages ? 'default' : 'pointer', opacity: page === totalPages ? 0.4 : 1 }}>Next →</button>
            </div>
          </div>
        )}
      </div>
    </LeagueShell>
  );
}

function TeamCard({ team: t, rank, onClick }) {
  const [hov, setHov] = useState(false);
  const initials = t.team_name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 3).toUpperCase();

  return (
    <button onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{
        minHeight: 196,
        padding: '20px 22px 18px',
        borderRadius: 10,
        border: hov ? `1px solid ${ORANGE}` : '1px solid var(--card-border-clr)',
        background: hov ? 'color-mix(in srgb, var(--card-bg) 92%, #EA6020 8%)' : 'var(--card-bg)',
        boxShadow: hov ? '0 6px 24px rgba(0,0,0,0.16)' : '0 1px 4px rgba(0,0,0,0.07)',
        transform: hov ? 'translateY(-2px)' : 'none',
        transition: 'border-color .12s, background .12s, box-shadow .12s, transform .12s',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        position: 'relative', overflow: 'hidden',
        cursor: 'pointer', textAlign: 'left', width: '100%', boxSizing: 'border-box',
      }}
    >
      <div aria-hidden style={{ position: 'absolute', right: 14, bottom: 10, fontSize: 60, fontFamily: 'var(--font-h1)', fontWeight: 900, opacity: 0.08, color: 'var(--t-primary)', lineHeight: 1, pointerEvents: 'none', letterSpacing: '-0.04em' }}>
        {initials}
      </div>
      <div>
        <div style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: 6 }}>#{rank}</div>
        <div style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 18, textTransform: 'uppercase', letterSpacing: '-0.02em', color: 'var(--t-primary)', lineHeight: 1.2 }}>
          {t.team_name}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginTop: 16 }}>
        {t.first_year && (
          <div>
            <div style={{ fontFamily: 'var(--font-h1)', fontWeight: 900, fontSize: 32, color: 'var(--t-secondary)', lineHeight: 1 }}>{t.first_year}</div>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 7, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>est.</div>
          </div>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {t.latest_year && t.latest_year !== t.first_year && (
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>– {t.latest_year}</span>
          )}
          {t.active !== undefined && <ActiveBadge active={t.active} />}
        </div>
      </div>
    </button>
  );
}

function ActiveBadge({ active }) {
  return (
    <span style={{
      fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase',
      padding: '2px 7px', borderRadius: 4,
      background: active ? 'rgba(34,197,94,0.15)' : 'rgba(148,163,184,0.12)',
      color: active ? '#22c55e' : 'var(--t-muted)',
      border: active ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(148,163,184,0.2)',
      display: 'inline-block',
    }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function IconTable({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="2" width="14" height="2.5" rx="0.5" />
      <rect x="1" y="6.5" width="14" height="2" rx="0.5" />
      <rect x="1" y="10.5" width="14" height="2" rx="0.5" />
    </svg>
  );
}

function IconGrid({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}
