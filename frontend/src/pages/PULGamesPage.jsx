import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LeagueShell from '../components/LeagueShell.jsx';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const PUL_LOGO_MAP = {
  ATL: 'atl_soul',
  ATX: 'atx_torch',
  COL: 'clb_pride',
  CLB: 'clb_pride',
  DC:  'dc_shadow',
  IND: 'ind_red',
  LA:  'la_astra',
  MED: 'med_revolution',
  MKE: 'mil_monarchs',
  MIN: 'mn_strike',
  NSH: 'nsh_nightshade',
  NY:  'nyc_gridlock',
  PHL: 'phi_surge',
  POR: 'pme_portlandrising',
  RAL: 'ral_radiance',
};
function pulLogo(teamId) {
  if (!teamId) return null;
  const slug = PUL_LOGO_MAP[teamId] || PUL_LOGO_MAP[teamId.toUpperCase()];
  if (!slug) return null;
  return `${BASE}/assets/png/PUL_teams/${slug}.png`;
}

const ORANGE = '#EA6020';

const WEST_TEAMS = new Set([]);
function teamConf(teamId) {
  if (!teamId) return null;
  return WEST_TEAMS.has(teamId) ? 'west' : 'east';
}
function gameConf(g) {
  const hc = teamConf(g.home_team_id);
  const ac = teamConf(g.away_team_id);
  if (hc === ac) return hc;   // same-conf game
  return 'pul';               // cross-conf (championship)
}

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
  background: 'var(--thead-bg)',
};

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

export default function PULGamesPage() {
  const navigate = useNavigate();

  const scrollRef = useRef(null);
  const [scrollbarW, setScrollbarW] = useState(0);
  useEffect(() => {
    if (scrollRef.current) setScrollbarW(scrollRef.current.offsetWidth - scrollRef.current.clientWidth);
  });

  const [games,    setGames]    = useState([]);
  const [status,   setStatus]   = useState('loading');
  const [query,    setQuery]    = useState('');
  const [sortKey,  setSortKey]  = useState('timestamp');
  const [sortDir,  setSortDir]  = useState(1);
  const [viewMode, setViewMode] = useState('table');
  const [page,         setPage]         = useState(0);
  const [selectedGame, setSelectedGame] = useState(null);

  // Reset to page 0 whenever filter, sort or view changes
  useEffect(() => { setPage(0); }, [query, sortKey, sortDir, viewMode]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetch('/api/pul/games')
      .then(r => r.json())
      .then(d => { if (!cancelled) { setGames(d.games || []); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const TODAY = new Date().toISOString().split('T')[0];
    const q = query.toLowerCase().trim();
    if (!q) return [...games].filter(g => { const ts = g.timestamp || g.date; return !ts || ts.slice(0, 10) <= TODAY; }).sort((a, b) => {
      const av = a[sortKey] ?? ''; const bv = b[sortKey] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });

    let rest = q;
    let confFilter = null;
    let weekFilter = null;
    let yearFilter = null;

    // ── year/season ──────────────────────────────────────────────
    const yearMatch = rest.match(/\bseason\s*(\d{4})\b|\b(20\d{2})\b|'(\d{2})\b/);
    if (yearMatch) {
      const y = yearMatch[1] ?? yearMatch[2] ?? (yearMatch[3] ? '20' + yearMatch[3] : null);
      if (y) { yearFilter = parseInt(y, 10); rest = rest.replace(yearMatch[0], '').trim(); }
    }

    // ── conf/division ─────────────────────────────────────────────
    const confMatch = rest.match(/\b(west|wcf|east|ecf|pul)\b/);
    if (confMatch) {
      const kw = confMatch[1];
      confFilter = (kw === 'west' || kw === 'wcf') ? 'west' : (kw === 'east' || kw === 'ecf') ? 'east' : 'pul';
      rest = rest.replace(confMatch[0], '').trim();
    }

    // ── week ─────────────────────────────────────────────────────
    const weekMatch = rest.match(/\b(?:week|wk|w)\s*(\d+)\b|^(\d+)$/);
    if (weekMatch) {
      weekFilter = parseInt(weekMatch[1] ?? weekMatch[2], 10);
      rest = rest.replace(weekMatch[0], '').trim();
    }

    // ── partial-keyword guard ─────────────────────────────────────
    const KEYWORDS = ['west', 'wcf', 'east', 'ecf', 'pul', 'week', 'wk', 'season'];
    const isPartialKeyword = rest.length > 0 && KEYWORDS.some(kw => kw.startsWith(rest));

    // ── two-team matchup search ───────────────────────────────────
    const tokens = rest.trim().split(/\s+/).filter(Boolean);
    const isTwoTeam = tokens.length >= 2;

    return games
      .filter(g => {
        const ts = g.timestamp || g.date;
        if (ts && ts.slice(0, 10) > TODAY) return false;
        if (yearFilter !== null && g.year !== yearFilter) return false;
        if (confFilter !== null && gameConf(g) !== confFilter) return false;
        if (weekFilter !== null && g.week !== weekFilter) return false;
        if (rest && !isPartialKeyword) {
          const home = (g.home_team || '').toLowerCase();
          const away = (g.away_team || '').toLowerCase();
          const haystack = [g.home_team, g.away_team, g.date, g.week != null ? String(g.week).replace(/-/g, ' ') : null].filter(Boolean).join(' ').toLowerCase();
          if (isTwoTeam) {
            const [t1, t2] = [tokens.slice(0, Math.ceil(tokens.length / 2)).join(' '), tokens.slice(Math.ceil(tokens.length / 2)).join(' ')];
            const teamMatch = (home.includes(t1) && away.includes(t2)) || (home.includes(t2) && away.includes(t1));
            if (!teamMatch && !haystack.includes(rest)) return false;
          } else {
            if (!haystack.includes(rest)) return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        const av = a[sortKey] ?? ''; const bv = b[sortKey] ?? '';
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
        return String(av).localeCompare(String(bv)) * sortDir;
      });
  }, [games, query, sortKey, sortDir]);

  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (!autoSelectedRef.current && filtered.length > 0) {
      setSelectedGame(filtered[0]);
      autoSelectedRef.current = true;
    }
  }, [filtered]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(-1); }
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
    <LeagueShell league="pul">
        {/* ── Header ── */}
        <div style={{ padding: '28px 32px 20px', borderBottom: '1px solid var(--nav-border)', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, flexShrink: 0, background: 'var(--card-bg)' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--orange)', opacity: 0.7, marginBottom: 6 }}>
              Premier Ultimate League
            </div>
            <div style={{ fontFamily: 'var(--font-h1)', fontSize: 'clamp(1.5rem, 2.5vw, 2rem)', letterSpacing: '-0.02em', textTransform: 'uppercase', color: 'var(--t-primary)', marginBottom: 6 }}>
              Game Center
            </div>
          </div>

          {/* View toggle + search stacked */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            {/* View mode toggle */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: '1px solid var(--surf-border)', flexShrink: 0 }}>
                {[['table', IconTable], ['grid', IconGrid]].map(([mode, Icon]) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    title={mode === 'table' ? 'Table view' : 'Grid view'}
                    style={{
                      width: 34, height: 34,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: 'none',
                      background: viewMode === mode ? ORANGE : 'var(--surf-bg-2)',
                      color: viewMode === mode ? '#fff' : 'var(--t-muted)',
                      cursor: 'pointer',
                      transition: 'background .12s, color .12s',
                    }}
                  >
                    <Icon size={15} />
                  </button>
                ))}
              </div>
            </div>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search teams, west, east, week 3…"
              style={{
                width: 280,
                height: 36,
                padding: '0 14px',
                borderRadius: 8,
                border: '1px solid var(--input-border)',
                background: 'var(--input-bg)',
                color: 'var(--input-clr)',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>

          {/* ── Left: Games list (2/3) ── */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'clip', borderRight: '1px solid var(--nav-border)' }}>
            {status === 'loading' && (
              <div style={{ padding: '48px 0', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>Loading…</div>
            )}
            {status === 'error' && (
              <div style={{ padding: '48px 0', textAlign: 'center', fontFamily: 'var(--font-body)', color: 'var(--t-muted)' }}>Could not load PUL games.</div>
            )}
            {status === 'ready' && games.length === 0 && (
              <div style={{ padding: '64px 0', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>No games available yet.</div>
            )}

            {/* ── Fixed table header (outside scroll area) ── */}
            {status === 'ready' && games.length > 0 && viewMode === 'table' && (
              <div style={{ flexShrink: 0, marginTop: 16, paddingLeft: 24, paddingRight: 24 + scrollbarW }}>
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: 38 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 68 }} />
                    <col style={{ width: 46 }} />
                    <col style={{ width: 55 }} />
                    <col style={{ width: 46 }} />
                  </colgroup>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                      <SortTh label="Year"  field="year"       />
                      <SortTh label="Week"  field="week"       />
                      <SortTh label="Date"  field="date"       style={{ textAlign: 'right' }} />
                      <SortTh label="Home"  field="home_team"  style={{ textAlign: 'center' }} />
                      <SortTh label="Score" field="home_score" style={{ textAlign: 'center' }} />
                      <SortTh label="Away"  field="away_team"  style={{ textAlign: 'center' }} />
                    </tr>
                  </thead>
                </table>
              </div>
            )}

            {/* ── Table view — 50 per page ── */}
            {status === 'ready' && games.length > 0 && viewMode === 'table' && (() => {
              const PAGE_SIZE = 50;
              const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
              const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
              return (
                <>
                  <div ref={scrollRef} className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'scroll', overflowX: 'auto', paddingLeft: 24, paddingRight: 24, paddingBottom: 8 }}>
                    <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: 38 }} />
                        <col style={{ width: 80 }} />
                        <col style={{ width: 68 }} />
                        <col style={{ width: 46 }} />
                        <col style={{ width: 55 }} />
                        <col style={{ width: 46 }} />
                      </colgroup>
                      <tbody>
                        {slice.map((g, i) => {
                          const isSel = selectedGame?.game_id === g.game_id;
                          const cellMuted = isSel ? 'rgba(255,255,255,0.8)' : 'var(--t-muted)';
                          const cellPrimary = isSel ? 'white' : 'var(--t-primary)';
                          return (
                            <tr
                              key={g.game_id}
                              style={{ borderBottom: '1px solid var(--surf-border)', background: isSel ? ORANGE : 'var(--card-bg)', cursor: 'pointer', transition: 'background .1s, box-shadow .1s', boxShadow: 'none' }}
                              onClick={() => setSelectedGame(g)}
                              onMouseEnter={e => { if (!isSel) e.currentTarget.style.boxShadow = 'inset 0 0 0 1000px rgba(234,96,32,0.22)'; }}
                              onMouseLeave={e => { if (!isSel) e.currentTarget.style.boxShadow = 'none'; }}
                            >
                              <td style={{ padding: '10px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, color: cellMuted }}>{g.year ?? '—'}</td>
                              <td style={{ padding: '10px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, color: cellMuted, whiteSpace: 'nowrap' }}>{g.week != null ? (/^\d+$/.test(String(g.week)) ? String(g.week) : String(g.week).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())) : '—'}</td>
                              <td style={{ padding: '8px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, color: cellMuted, whiteSpace: 'nowrap', textAlign: 'right' }}>{fmtDate(g.date)}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center', verticalAlign: 'middle' }}>
                                {pulLogo(g.home_team_id) && <img src={pulLogo(g.home_team_id)} alt={g.home_team ?? ''} title={g.home_team ?? ''} style={{ height: 26, width: 'auto', maxWidth: 36, objectFit: 'contain', display: 'block', margin: '0 auto' }} onError={e => { e.currentTarget.style.display='none'; }} />}
                              </td>
                              <td style={{ padding: '8px 12px', fontFamily: 'var(--font-h2)', fontSize: 13, color: cellPrimary, textAlign: 'center', letterSpacing: '1px', fontWeight: 600, whiteSpace: 'nowrap' }}>{g.home_score != null && g.away_score != null ? `${g.home_score} – ${g.away_score}` : '—'}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center', verticalAlign: 'middle' }}>
                                {pulLogo(g.away_team_id) && <img src={pulLogo(g.away_team_id)} alt={g.away_team ?? ''} title={g.away_team ?? ''} style={{ height: 26, width: 'auto', maxWidth: 36, objectFit: 'contain', display: 'block', margin: '0 auto' }} onError={e => { e.currentTarget.style.display='none'; }} />}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Pager page={page} totalPages={totalPages} onPage={setPage} total={filtered.length} pageSize={PAGE_SIZE} scrollbarW={scrollbarW} />
                </>
              );
            })()}

            {/* ── Grid view — 15 per page, 2 cols ── */}
            {status === 'ready' && games.length > 0 && viewMode === 'grid' && (() => {
              const PAGE_SIZE = 15;
              const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
              const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
              return (
                <>
                  <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px 8px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
                      {slice.map(g => (
                        <GameCard key={g.game_id} game={g} selected={selectedGame?.game_id === g.game_id} onClick={() => setSelectedGame(g)} />
                      ))}
                    </div>
                  </div>
                  <Pager page={page} totalPages={totalPages} onPage={setPage} total={filtered.length} pageSize={PAGE_SIZE} />
                </>
              );
            })()}
          </div>

          {/* ── Right: Game detail panel (1/3) ── */}
          <div style={{ flex: 2, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 16 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--card-bg)', borderRadius: 4 }}>
              {selectedGame
                ? <GameDetail game={selectedGame} />
                : (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
                    <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.5 }}>Select a game to preview</div>
                  </div>
                )
              }
            </div>
          </div>
        </div>
    </LeagueShell>
  );
}

function Pager({ page, totalPages, onPage, total, pageSize, scrollbarW = 0 }) {
  if (totalPages <= 1) return null;
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `10px ${24 + scrollbarW}px 14px 24px` }}>
      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#fff' }}>
        {start}–{end} of {total}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => onPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ height: 28, padding: '0 12px', borderRadius: 4, border: `1px solid ${ORANGE}`, background: 'var(--card-bg)', color: ORANGE, fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1px', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>← Prev</button>
        <button onClick={() => onPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} style={{ height: 28, padding: '0 12px', borderRadius: 4, border: `1px solid ${ORANGE}`, background: 'var(--card-bg)', color: ORANGE, fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1px', cursor: page === totalPages - 1 ? 'default' : 'pointer', opacity: page === totalPages - 1 ? 0.4 : 1 }}>Next →</button>
      </div>
    </div>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return `${dt.getMonth()+1}/${dt.getDate()}/${String(dt.getFullYear()).slice(2)}`;
}

function splitName(full) {
  if (!full) return { city: '', nick: '' };
  const parts = full.trim().split(' ');
  if (parts.length === 1) return { city: '', nick: full };
  return { city: parts.slice(0, -1).join(' '), nick: parts[parts.length - 1] };
}

function GameCard({ game: g, onClick, selected = false }) {
  const [hov, setHov] = useState(false);
  const winner = g.home_score != null && g.away_score != null
    ? (g.home_score > g.away_score ? 'home' : g.away_score > g.home_score ? 'away' : 'tie')
    : null;
  const homeLogo = pulLogo(g.home_team_id);
  const awayLogo = pulLogo(g.away_team_id);
  const home = splitName(g.home_team);
  const away = splitName(g.away_team);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        textAlign: 'left',
        padding: '18px 16px',
        borderRadius: 4,
        border: hov && !selected ? '1px solid rgba(234,96,32,0.6)' : '1px solid var(--surf-border)',
        background: 'var(--card-bg)',
        boxShadow: selected ? `inset 0 0 0 3px ${ORANGE}` : 'none',
        cursor: 'pointer',
        transition: 'border-color .12s, filter .12s, box-shadow .12s',
        filter: hov ? 'brightness(1.08)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: '100%',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
        minHeight: 110,
      }}
    >
      {/* Home logo watermark — left side */}
      {homeLogo && (
        <img src={homeLogo} aria-hidden="true" alt=""
          style={{ position: 'absolute', top: '50%', left: '15%', transform: 'translate(-50%, -50%)', height: '160%', width: 'auto', opacity: 0.08, pointerEvents: 'none' }}
          onError={e => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      {/* Away logo watermark — right side */}
      {awayLogo && (
        <img src={awayLogo} aria-hidden="true" alt=""
          style={{ position: 'absolute', top: '50%', left: '85%', transform: 'translate(-50%, -50%)', height: '160%', width: 'auto', opacity: 0.08, pointerEvents: 'none' }}
          onError={e => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      {/* Center gradient mask — blocks logos from bleeding into the score area */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(to right, transparent 20%, var(--card-bg) 43%, var(--card-bg) 57%, transparent 80%)', pointerEvents: 'none' }} />
      {/* Orange tint — above mask, below content */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'linear-gradient(135deg, rgba(234,96,32,0.18) 0%, transparent 100%)', pointerEvents: 'none' }} />

      {/* Content sits above watermarks */}
      <div style={{ position: 'relative', zIndex: 3, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Meta row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#C04A10' }}>
            {g.year}{g.week != null ? ` · ${/^\d+$/.test(String(g.week)) ? g.week : String(g.week).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}` : ''}
          </span>
          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 99, background: ORANGE, border: `1px solid ${ORANGE}`, color: '#fff' }}>
            {g.status}
          </span>
        </div>

        {/* Matchup */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>

          {/* Home */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', color: '#C04A10', opacity: 0.65 }}>
              {home.city}
            </div>
            <div style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 17, color: '#C04A10', textTransform: 'uppercase', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              {home.nick}
            </div>
          </div>

          {/* Score + winner arrow — arrow on the winning side, score always centered */}
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 30, textAlign: 'right', fontSize: 25, color: 'rgba(234,96,32,0.5)', lineHeight: 1 }}>
              {winner === 'home' ? '◀' : ''}
            </span>
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 37, fontWeight: 700, color: '#C04A10', letterSpacing: '1px' }}>
              {g.home_score != null && g.away_score != null ? `${g.home_score}–${g.away_score}` : 'vs'}
            </span>
            <span style={{ width: 30, textAlign: 'left', fontSize: 25, color: 'rgba(234,96,32,0.5)', lineHeight: 1 }}>
              {winner === 'away' ? '▶' : ''}
            </span>
          </div>

          {/* Away */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', color: '#C04A10', opacity: 0.65 }}>
              {away.city}
            </div>
            <div style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 17, color: '#C04A10', textTransform: 'uppercase', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              {away.nick}
            </div>
          </div>

        </div>

        {/* Date */}
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#C04A10', opacity: 0.55 }}>
          {g.date ?? ''}
        </div>

      </div>
    </button>
  );
}

function GameDetail({ game: g }) {
  const winner = g.home_score != null && g.away_score != null
    ? (g.home_score > g.away_score ? 'home' : g.away_score > g.home_score ? 'away' : 'tie')
    : null;
  const homeLogo = pulLogo(g.home_team_id);
  const awayLogo = pulLogo(g.away_team_id);
  const home = splitName(g.home_team);
  const away = splitName(g.away_team);
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Match header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--surf-border)', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
        {homeLogo && <img src={homeLogo} aria-hidden alt="" style={{ position: 'absolute', top: '50%', left: '10%', transform: 'translate(-50%,-50%)', height: '150%', width: 'auto', opacity: 0.06, pointerEvents: 'none' }} onError={e => e.currentTarget.style.display='none'} />}
        {awayLogo && <img src={awayLogo} aria-hidden alt="" style={{ position: 'absolute', top: '50%', left: '90%', transform: 'translate(-50%,-50%)', height: '150%', width: 'auto', opacity: 0.06, pointerEvents: 'none' }} onError={e => e.currentTarget.style.display='none'} />}
        <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: ORANGE, opacity: 0.8, marginBottom: 12, position: 'relative', zIndex: 1 }}>
          {g.year}{g.week != null ? ` · ${/^\d+$/.test(String(g.week)) ? 'Week ' + g.week : String(g.week).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}` : ''}{g.date ? ` · ${g.date}` : ''}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative', zIndex: 1 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>{home.city}</div>
            <div style={{ fontFamily: 'var(--font-h1)', fontSize: 16, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '-0.02em', color: winner === 'home' ? ORANGE : 'var(--t-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{home.nick}</div>
          </div>
          <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 80 }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 28, fontWeight: 700, color: 'var(--t-primary)', letterSpacing: '2px', lineHeight: 1 }}>
              {g.home_score != null && g.away_score != null ? `${g.home_score}–${g.away_score}` : 'vs'}
            </div>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '2px', color: 'var(--t-muted)', textTransform: 'uppercase', marginTop: 2 }}>{g.status ?? 'final'}</div>
          </div>
          <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>{away.city}</div>
            <div style={{ fontFamily: 'var(--font-h1)', fontSize: 16, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '-0.02em', color: winner === 'away' ? ORANGE : 'var(--t-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{away.nick}</div>
          </div>
        </div>
      </div>
      {/* Details */}
      <div className="orange-scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 20%' }}>
        {[
          ['Date', g.date],
          ['Time', g.time],
          ['Season', g.year],
          ['Week', g.week != null ? (/^\d+$/.test(String(g.week)) ? 'Week ' + g.week : String(g.week).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())) : null],
          ['Status', g.status],
          ['Venue', g.venue],
          ['Location', g.location],
        ].filter(([, v]) => v != null).map(([label, val]) => (
          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0', borderBottom: '1px solid var(--surf-border)' }}>
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>{label}</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-primary)' }}>{val}</span>
          </div>
        ))}
      </div>
      {/* See More */}
      <div style={{ padding: '10px 24px 14px', borderTop: '1px solid var(--surf-border)', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
        <Link to={`/pul/games/${g.game_id}`} style={{ textDecoration: 'none' }}>
          <button style={{ height: 32, padding: '0 16px', borderRadius: 6, border: `1px solid ${ORANGE}`, background: ORANGE, color: '#fff', fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1px', cursor: 'pointer' }}>See More →</button>
        </Link>
      </div>
    </div>
  );
}
