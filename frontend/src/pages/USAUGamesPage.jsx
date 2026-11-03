import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import LeagueShell from '../components/LeagueShell.jsx';

const ORANGE = '#EA6020';
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';
const USAU_ICON = `${BASE}/assets/png/USAUicon.png`;
function usauLogo(filename) {
  if (!filename) return USAU_ICON;
  return `${BASE}/assets/png/USAU_teams/${filename}`;
}

const TH_BASE = {
  padding: '10px 12px',
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

const KNOWN_LEVELS = [
  'Club Men', 'Club Women', 'Club Mixed',
  'College D1 Men', 'College D1 Women',
];

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
  const homeLogo = usauLogo(g.home_logo);
  const awayLogo = usauLogo(g.away_logo);


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
      {g.home_logo && <img src={homeLogo} aria-hidden="true" alt="" style={{ position: 'absolute', top: '50%', left: '15%', transform: 'translate(-50%, -50%)', height: '160%', width: 'auto', opacity: 0.08, pointerEvents: 'none' }} onError={e => { e.currentTarget.style.display = 'none'; }} />}
      {g.away_logo && <img src={awayLogo} aria-hidden="true" alt="" style={{ position: 'absolute', top: '50%', left: '85%', transform: 'translate(-50%, -50%)', height: '160%', width: 'auto', opacity: 0.08, pointerEvents: 'none' }} onError={e => { e.currentTarget.style.display = 'none'; }} />}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(to right, transparent 20%, var(--card-bg) 43%, var(--card-bg) 57%, transparent 80%)', pointerEvents: 'none' }} />
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 2, background: 'linear-gradient(135deg, rgba(234,96,32,0.18) 0%, transparent 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', zIndex: 3, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#C04A10' }}>
            {g.year}{g.level ? ` · ${g.level}` : ''}
          </span>
          {g.round && (
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1px', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 99, background: ORANGE, border: `1px solid ${ORANGE}`, color: '#fff', whiteSpace: 'nowrap' }}>
              {g.round}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <div style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 17, color: '#C04A10', textTransform: 'uppercase', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{g.home_team}</div>
          </div>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 30, textAlign: 'right', fontSize: 25, color: 'rgba(234,96,32,0.5)', lineHeight: 1 }}>{winner === 'home' ? '◀' : ''}</span>
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 37, fontWeight: 700, color: '#C04A10', letterSpacing: '1px' }}>
              {g.home_score != null && g.away_score != null ? `${g.home_score}–${g.away_score}` : 'vs'}
            </span>
            <span style={{ width: 30, textAlign: 'left', fontSize: 25, color: 'rgba(234,96,32,0.5)', lineHeight: 1 }}>{winner === 'away' ? '▶' : ''}</span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
            <div style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 17, color: '#C04A10', textTransform: 'uppercase', letterSpacing: '-0.02em', lineHeight: 1.1 }}>{g.away_team}</div>
          </div>
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#C04A10', opacity: 0.55 }}>{g.date ?? ''}</div>
      </div>
    </button>
  );
}

/* ── Score progression sparkline ── */
function ProgressionChart({ points, homeTeam, awayTeam }) {
  if (!points || points.length === 0) return null;
  const W = 320, H = 80, PAD = 10;
  const maxScore = Math.max(...points.map(p => Math.max(p.home, p.away)), 1);
  const n = points.length;
  const xScale = (i) => PAD + (i / (n - 1 || 1)) * (W - PAD * 2);
  const yScale = (v) => H - PAD - (v / maxScore) * (H - PAD * 2);

  const homePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(p.home).toFixed(1)}`).join(' ');
  const awayPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(p.away).toFixed(1)}`).join(' ');

  const last = points[points.length - 1];
  const homeWin = last.home > last.away;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: homeWin ? ORANGE : 'var(--t-muted)' }}>{homeTeam}</span>
        <span style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: !homeWin ? ORANGE : 'var(--t-muted)' }}>{awayTeam}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
        {/* diagonal guide */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={PAD} stroke="var(--surf-border)" strokeWidth="1" strokeDasharray="3,3" />
        {/* away line */}
        <path d={awayPath} fill="none" stroke="var(--t-muted)" strokeWidth="1.5" strokeOpacity="0.5" />
        {/* home line */}
        <path d={homePath} fill="none" stroke={ORANGE} strokeWidth="2" />
        {/* end dots */}
        <circle cx={xScale(n - 1)} cy={yScale(last.home)} r="3.5" fill={ORANGE} />
        <circle cx={xScale(n - 1)} cy={yScale(last.away)} r="3.5" fill="var(--t-muted)" fillOpacity="0.6" />
      </svg>
    </div>
  );
}

/* ── Box score mini table ── */
function BoxScoreMini({ gameId }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    fetch(`/api/usau/games/${encodeURIComponent(gameId)}/box_score`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [gameId]);

  if (!data || !data.teams || Object.keys(data.teams).length === 0) return null;

  const TH = { padding: '6px 6px', fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', borderBottom: '1px solid var(--surf-border)', whiteSpace: 'nowrap' };
  const TD = { padding: '6px 6px', fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-secondary)', borderBottom: '1px solid var(--surf-border)', whiteSpace: 'nowrap' };

  return (
    <div>
      {Object.entries(data.teams).map(([tid, team]) => {
        const top = [...team.players].sort((a, b) => (b.goals + b.assists) - (a.goals + a.assists)).slice(0, 7);
        return (
          <div key={tid} style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: ORANGE, marginBottom: 4 }}>{team.team_name}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup><col /><col style={{ width: 28 }} /><col style={{ width: 28 }} /><col style={{ width: 28 }} /><col style={{ width: 28 }} /><col style={{ width: 32 }} /></colgroup>
              <thead><tr>
                <th style={{ ...TH, textAlign: 'left' }}>Name</th>
                <th style={{ ...TH, textAlign: 'center' }}>G</th>
                <th style={{ ...TH, textAlign: 'center' }}>A</th>
                <th style={{ ...TH, textAlign: 'center' }}>D</th>
                <th style={{ ...TH, textAlign: 'center' }}>T</th>
                <th style={{ ...TH, textAlign: 'center' }}>+/-</th>
              </tr></thead>
              <tbody>
                {top.map((p, i) => {
                  const pm = (p.goals || 0) + (p.assists || 0) + (p.blocks || 0) - (p.turnovers || 0);
                  return (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(234,96,32,0.03)' }}>
                      <td style={{ ...TD, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</td>
                      <td style={{ ...TD, textAlign: 'center' }}>{p.goals}</td>
                      <td style={{ ...TD, textAlign: 'center' }}>{p.assists}</td>
                      <td style={{ ...TD, textAlign: 'center' }}>{p.blocks}</td>
                      <td style={{ ...TD, textAlign: 'center' }}>{p.turnovers}</td>
                      <td style={{ ...TD, textAlign: 'center', color: pm > 0 ? ORANGE : pm < 0 ? 'var(--t-muted)' : 'var(--t-secondary)', fontWeight: pm !== 0 ? 700 : 400 }}>{pm > 0 ? `+${pm}` : pm}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/* ── Team stats comparison ── */
function TeamStatsMini({ gameId, homeTeamId, awayTeamId, homeTeam, awayTeam }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    fetch(`/api/usau/games/${encodeURIComponent(gameId)}/box_score`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [gameId]);

  if (!data || !data.teams) return null;
  const homeData = data.teams[homeTeamId];
  const awayData = data.teams[awayTeamId];
  if (!homeData || !awayData) return null;

  const agg = (team) => team.players.reduce(
    (acc, p) => ({ g: acc.g + (p.goals||0), a: acc.a + (p.assists||0), d: acc.d + (p.blocks||0), t: acc.t + (p.turnovers||0) }),
    { g: 0, a: 0, d: 0, t: 0 }
  );
  const home = agg(homeData);
  const away = agg(awayData);
  home.uft = Math.max(0, home.t - away.d);
  away.uft = Math.max(0, away.t - home.d);

  const STAT_ROWS = [
    { key: 'd',   label: 'Blocks',         higher: true },
    { key: 't',   label: 'Turnovers',      higher: false },
    { key: 'uft', label: 'Unforced Turns', higher: false },
  ];
  const LABEL = { fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)' };
  const VAL   = { fontFamily: 'var(--font-h2)', fontSize: 20, fontWeight: 700, lineHeight: 1, textAlign: 'center' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ ...LABEL, color: 'var(--t-secondary)', maxWidth: '42%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{homeTeam || homeData.team_name}</span>
        <span style={{ ...LABEL, color: 'var(--t-secondary)', maxWidth: '42%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>{awayTeam || awayData.team_name}</span>
      </div>
      {STAT_ROWS.map(({ key, label, higher }) => {
        const hv = home[key], av = away[key];
        const homeBetter = higher ? hv > av : hv < av;
        const awayBetter = higher ? av > hv : av < hv;
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--surf-border)' }}>
            <div style={{ flex: 1, ...VAL, color: homeBetter ? ORANGE : 'var(--t-secondary)' }}>{hv}</div>
            <div style={{ width: 96, textAlign: 'center', ...LABEL }}>{label}</div>
            <div style={{ flex: 1, ...VAL, color: awayBetter ? ORANGE : 'var(--t-secondary)' }}>{av}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Game detail panel (right side) ── */
function GameDetail({ game: g }) {
  const navigate = useNavigate();
  const winner = g.home_score != null && g.away_score != null
    ? (g.home_score > g.away_score ? 'home' : g.away_score > g.home_score ? 'away' : 'tie')
    : null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Match header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--surf-border)', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
        {g.home_logo && <img src={usauLogo(g.home_logo)} aria-hidden alt="" style={{ position: 'absolute', top: '50%', left: '10%', transform: 'translate(-50%,-50%)', height: '150%', width: 'auto', opacity: 0.06, pointerEvents: 'none' }} onError={e => e.currentTarget.style.display='none'} />}
        {g.away_logo && <img src={usauLogo(g.away_logo)} aria-hidden alt="" style={{ position: 'absolute', top: '50%', left: '90%', transform: 'translate(-50%,-50%)', height: '150%', width: 'auto', opacity: 0.06, pointerEvents: 'none' }} onError={e => e.currentTarget.style.display='none'} />}
        <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: ORANGE, opacity: 0.8, marginBottom: 12, position: 'relative', zIndex: 1 }}>
          {g.year}{g.level ? ` · ${g.level}` : ''}{g.date ? ` · ${g.date}` : ''}{g.round ? ` · ${g.round}` : ''}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative', zIndex: 1 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-h1)', fontSize: 16, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '-0.02em', color: winner === 'home' ? ORANGE : 'var(--t-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.home_team}</div>
          </div>
          <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 80 }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 28, fontWeight: 700, color: 'var(--t-primary)', letterSpacing: '2px', lineHeight: 1 }}>
              {g.home_score != null && g.away_score != null ? `${g.home_score}–${g.away_score}` : 'vs'}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-h1)', fontSize: 16, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '-0.02em', color: winner === 'away' ? ORANGE : 'var(--t-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.away_team}</div>
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="orange-scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

        {/* View full game button */}
        <button
          onClick={() => navigate(`/usau/games/${encodeURIComponent(g.game_id)}`)}
          style={{ width: '100%', marginBottom: 18, padding: '9px 0', borderRadius: 6, border: `1px solid ${ORANGE}`, background: 'transparent', color: ORANGE, fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer', transition: 'background .12s' }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(234,96,32,0.1)'}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          View Full Game →
        </button>

        {/* Team stats */}
        {g.has_progression && (
          <div style={{ marginBottom: 22 }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: ORANGE, marginBottom: 10 }}>Team Stats</div>
            <TeamStatsMini
              gameId={g.game_id}
              homeTeamId={g.home_team_id}
              awayTeamId={g.away_team_id}
              homeTeam={g.home_team}
              awayTeam={g.away_team}
            />
          </div>
        )}

        {/* Box score */}
        {g.has_progression && (
          <div>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: ORANGE, marginBottom: 10 }}>Box Score</div>
            <BoxScoreMini gameId={g.game_id} />
          </div>
        )}

        {!g.has_progression && (
          <div style={{ textAlign: 'center', padding: '24px 0', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.4 }}>
            No detailed data available
          </div>
        )}
      </div>
    </div>
  );
}

function Pager({ page, totalPages, onPage, total, pageSize, scrollbarW = 0 }) {
  if (total === 0) return null;
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `10px ${24 + scrollbarW}px 14px 24px` }}>
      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>
        {start}–{end} of {total}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => onPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ height: 28, padding: '0 12px', borderRadius: 4, border: `1px solid ${ORANGE}`, background: 'var(--card-bg)', color: ORANGE, fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1px', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>← Prev</button>
        <button onClick={() => onPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1} style={{ height: 28, padding: '0 12px', borderRadius: 4, border: `1px solid ${ORANGE}`, background: 'var(--card-bg)', color: ORANGE, fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1px', cursor: page === totalPages - 1 ? 'default' : 'pointer', opacity: page === totalPages - 1 ? 0.4 : 1 }}>Next →</button>
      </div>
    </div>
  );
}

const CACHE_KEY = 'usau_games_view_state';
function loadCache() {
  try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null') || {}; } catch { return {}; }
}

export default function USAUGamesPage() {
  const navigate = useNavigate();
  const scrollRef = useRef(null);
  const [scrollbarW, setScrollbarW] = useState(0);
  useEffect(() => {
    if (scrollRef.current) setScrollbarW(scrollRef.current.offsetWidth - scrollRef.current.clientWidth);
  });

  const _c = useRef(loadCache()).current;

  const [games,    setGames]    = useState([]);
  const [status,   setStatus]   = useState('loading');
  const [query,    setQuery]    = useState(_c.query    ?? '');
  const [levelFilter, setLevelFilter] = useState(_c.levelFilter ?? '');
  const [yearFilter,  setYearFilter]  = useState(_c.yearFilter  ?? '');
  const [sortKey,  setSortKey]  = useState(_c.sortKey  ?? '');
  const [sortDir,  setSortDir]  = useState(_c.sortDir  ?? 1);
  const [viewMode, setViewMode] = useState(_c.viewMode ?? 'table');
  const [page,         setPage]         = useState(_c.page         ?? 0);
  const [selectedGame, setSelectedGame] = useState(_c.selectedGame ?? null);

  // Persist filter/view state to sessionStorage whenever it changes
  useEffect(() => {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(
      { query, levelFilter, yearFilter, sortKey, sortDir, viewMode, page, selectedGame }
    ));
  }, [query, levelFilter, yearFilter, sortKey, sortDir, viewMode, page, selectedGame]);

  const _mounted = useRef(false);
  useEffect(() => {
    if (!_mounted.current) { _mounted.current = true; return; }
    setPage(0);
  }, [query, levelFilter, yearFilter, sortKey, sortDir, viewMode]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetch('/api/usau/games')
      .then(r => r.json())
      .then(d => { if (!cancelled) { setGames(d.games || []); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, []);

  const years = useMemo(() => [...new Set(games.map(g => g.year).filter(Boolean))].sort((a, b) => b - a), [games]);
  const levels = useMemo(() => [...new Set(games.map(g => g.level).filter(Boolean))].sort(), [games]);

  const filtered = useMemo(() => {
    const TODAY = new Date().toISOString().split('T')[0];
    const q = query.toLowerCase().trim();
    return games
      .filter(g => {
        if (g.date && /^\d{4}-\d{2}-\d{2}$/.test(g.date) && g.date > TODAY) return false;
        if (yearFilter && String(g.year) !== yearFilter) return false;
        if (levelFilter && g.level !== levelFilter) return false;
        if (q) {
          const haystack = [g.home_team, g.away_team, g.round, g.pool, g.date].filter(Boolean).join(' ').toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const av = a[sortKey] ?? ''; const bv = b[sortKey] ?? '';
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
        return String(av).localeCompare(String(bv)) * sortDir;
      });
  }, [games, query, levelFilter, yearFilter, sortKey, sortDir]);

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

  const selStyle = { height: 32, padding: '0 10px', borderRadius: 6, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--input-clr)', fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1px', outline: 'none', cursor: 'pointer' };

  return (
    <LeagueShell league="usau">
      {/* ── Header ── */}
      <div style={{ padding: '28px 32px 20px', borderBottom: '1px solid var(--nav-border)', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, flexShrink: 0, background: 'var(--card-bg)' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--orange)', opacity: 0.7, marginBottom: 6 }}>USA Ultimate</div>
          <div style={{ fontFamily: 'var(--font-h1)', fontSize: 'clamp(1.5rem, 2.5vw, 2rem)', letterSpacing: '-0.02em', textTransform: 'uppercase', color: 'var(--t-primary)', marginBottom: 6 }}>
            Game Center
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {/* View toggle */}
            <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: '1px solid var(--surf-border)', flexShrink: 0 }}>
              {[['table', IconTable], ['grid', IconGrid]].map(([mode, Icon]) => (
                <button key={mode} onClick={() => setViewMode(mode)} title={mode === 'table' ? 'Table view' : 'Grid view'}
                  style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: viewMode === mode ? ORANGE : 'var(--surf-bg-2)', color: viewMode === mode ? '#fff' : 'var(--t-muted)', cursor: 'pointer', transition: 'background .12s, color .12s' }}>
                  <Icon size={15} />
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {/* Year filter */}
            <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} style={selStyle}>
              <option value="">All Years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            {/* Level filter */}
            <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)} style={selStyle}>
              <option value="">All Divisions</option>
              {levels.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search teams, round…"
              style={{ width: 260, height: 36, padding: '0 14px', borderRadius: 8, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--input-clr)', fontFamily: 'var(--font-body)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>

        {/* ── Left: Games list ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'clip', borderRight: '1px solid var(--nav-border)' }}>
          {status === 'loading' && (
            <div style={{ padding: '48px 0', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>Loading…</div>
          )}
          {status === 'error' && (
            <div style={{ padding: '48px 0', textAlign: 'center', fontFamily: 'var(--font-body)', color: 'var(--t-muted)' }}>Could not load USAU games.</div>
          )}
          {status === 'ready' && games.length === 0 && (
            <div style={{ padding: '64px 0', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>No games found.</div>
          )}

          {/* ── Fixed table header ── */}
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
                    <SortTh label="Year"  field="year" />
                    <SortTh label="Round" field="round" />
                    <SortTh label="Date"  field="date"  style={{ textAlign: 'right' }} />
                    <SortTh label="Home"  field="home_team"  style={{ textAlign: 'center' }} />
                    <SortTh label="Score" field="home_score" style={{ textAlign: 'center' }} />
                    <SortTh label="Away"  field="away_team"  style={{ textAlign: 'center' }} />
                  </tr>
                </thead>
              </table>
            </div>
          )}

          {/* ── Table view ── */}
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
                        const cellMuted   = isSel ? 'rgba(255,255,255,0.8)' : 'var(--t-muted)';
                        const cellPrimary = isSel ? 'white' : 'var(--t-primary)';
                        return (
                          <tr
                            key={g.game_id}
                            style={{ borderBottom: '1px solid var(--surf-border)', background: isSel ? ORANGE : 'var(--card-bg)', cursor: 'pointer', transition: 'background .1s' }}
                            onClick={() => setSelectedGame(g)}
                            onMouseEnter={e => { if (!isSel) e.currentTarget.style.boxShadow = 'inset 0 0 0 1000px rgba(234,96,32,0.22)'; }}
                            onMouseLeave={e => { if (!isSel) e.currentTarget.style.boxShadow = 'none'; }}
                          >
                            <td style={{ padding: '10px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, color: cellMuted }}>{g.year ?? '—'}</td>
                            <td style={{ padding: '10px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, color: cellMuted, whiteSpace: 'nowrap' }}>{g.round ?? '—'}</td>
                            <td style={{ padding: '8px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, color: cellMuted, whiteSpace: 'nowrap', textAlign: 'right' }}>{g.date ?? '—'}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'center', verticalAlign: 'middle' }}><img src={usauLogo(g.home_logo)} alt={g.home_team ?? ''} title={g.home_team ?? ''} style={{ height: 26, width: 'auto', maxWidth: 36, objectFit: 'contain', display: 'block', margin: '0 auto' }} onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = USAU_ICON; }} /></td>
                            <td style={{ padding: '8px 12px', fontFamily: 'var(--font-h2)', fontSize: 13, color: cellPrimary, textAlign: 'center', letterSpacing: '1px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                              {g.home_score != null && g.away_score != null ? `${g.home_score} – ${g.away_score}` : '—'}
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'center', verticalAlign: 'middle' }}><img src={usauLogo(g.away_logo)} alt={g.away_team ?? ''} title={g.away_team ?? ''} style={{ height: 26, width: 'auto', maxWidth: 36, objectFit: 'contain', display: 'block', margin: '0 auto' }} onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = USAU_ICON; }} /></td>
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

          {/* ── Grid view ── */}
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

        {/* ── Right: Game detail panel ── */}
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
