import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import LeagueShell from '../components/LeagueShell.jsx';

const BASE   = import.meta.env.BASE_URL.replace(/\/$/, '');
const ORANGE = '#EA6020';

const ABBR_OVERRIDE = { CHA: 'clt', VEG: 'lv', MIN: 'mn', NY: 'nyc' };
function teamLogoSrc(abbr, slug) {
  if (!abbr || !slug) return null;
  const prefix = ABBR_OVERRIDE[abbr] ?? abbr.toLowerCase();
  return `${BASE}/assets/png/UFA_teams/${prefix}_${slug}.png`;
}

const TABS = [
  { key: 'player',    label: 'Player' },
  { key: 'team',      label: 'Team' },
  { key: 'franchise', label: 'Franchise' },
];

export default function UFAComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const VALID_TABS = new Set(['player', 'team', 'franchise']);
  const initialTab = VALID_TABS.has(searchParams.get('tab')) ? searchParams.get('tab') : 'player';
  const [tab, setTab] = useState(initialTab);

  function switchTab(key) {
    setTab(key);
    setSearchParams({ tab: key }, { replace: true });
  }

  return (
    <LeagueShell league="ufa">
        {/* ── Hero ── */}
        <div style={{ padding: '36px 32px 24px', position: 'relative', overflow: 'hidden', background: 'var(--card-bg)' }}>
          <img
            src={`${BASE}/assets/png/UFAIcon.png`}
            aria-hidden="true"
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', height: '180%', width: 'auto', opacity: 0.06, pointerEvents: 'none', zIndex: 0 }}
          />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: ORANGE, opacity: 0.7, marginBottom: 4 }}>
              Ultimate Frisbee Association
            </div>
            <h1 style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: 'clamp(1.4rem, 3vw, 2rem)', color: 'var(--t-primary)', margin: 0, letterSpacing: '-0.02em', textTransform: 'uppercase' }}>
              Compare
            </h1>
          </div>
        </div>

        {/* ── Tab content ── */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {tab === 'player'    && <PlayerComparePanel />}
          {tab === 'team'      && <TeamComparePanel />}
          {tab === 'franchise' && <FranchiseComparePanel />}
        </div>

    </LeagueShell>
  );
}

// ── Shared style constants ────────────────────────────────────────────────────

const TH = {
  padding: '7px 14px', fontFamily: 'var(--font-h2)', fontSize: 9,
  letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)',
  fontWeight: 400, whiteSpace: 'nowrap', textAlign: 'center',
};
const THL = { ...TH, textAlign: 'left' };
const TD = { padding: '6px 14px', fontFamily: 'var(--font-h2)', fontSize: 12, textAlign: 'center', whiteSpace: 'nowrap', background: 'inherit' };
const TDL = { ...TD, textAlign: 'left' };

const PLAYER_STAT_COLS = [
  { key: 'gp',             label: 'GP',    title: 'Games Played' },
  { key: 'goals',          label: 'G',     title: 'Goals' },
  { key: 'assists',        label: 'A',     title: 'Assists' },
  { key: 'hockey_assists', label: 'HA',    title: 'Hockey Assists' },
  { key: 'blocks',         label: 'B',     title: 'Blocks' },
  { key: 'plus_minus',     label: '+/-',   title: 'Plus/Minus' },
  { key: 'completions',    label: 'Cmp',   title: 'Completions' },
  { key: 'throw_attempts', label: 'Att',   title: 'Throw Attempts' },
  { key: 'completion_pct', label: 'Cmp%',  title: 'Completion %', suffix: '%' },
  { key: 'throwaways',     label: 'TA',    title: 'Throwaways', lowerIsBetter: true },
  { key: 'drops',          label: 'Drops', title: 'Drops', lowerIsBetter: true },
  { key: 'hucks_completed',label: 'Hk',    title: 'Hucks Completed', asterisk: true },
  { key: 'huck_pct',       label: 'Hk%',   title: 'Huck %', suffix: '%', asterisk: true },
  { key: 'edge_o',         label: 'EDGE-O', title: 'Offensive EDGE', decimals: 2, asterisk: true },
  { key: 'edge_b',         label: 'EDGE-B', title: 'Defensive EDGE', decimals: 2, asterisk: true },
  { key: 'edge',           label: 'EDGE',   title: 'Total EDGE', decimals: 2, asterisk: true },
];

const FRANCHISE_STAT_COLS = [
  { key: 'seasons',        label: 'Seasons',  title: 'Seasons Played' },
  { key: 'wins',           label: 'W',        title: 'All-Time Wins' },
  { key: 'losses',         label: 'L',        title: 'All-Time Losses', lowerIsBetter: true },
  { key: 'ties',           label: 'T',        title: 'All-Time Ties' },
  { key: 'win_pct',        label: 'Win%',     title: 'Win Percentage', suffix: '%', computed: true },
  { key: 'points_for',     label: 'PF',       title: 'Points Scored All-Time' },
  { key: 'points_against', label: 'PA',       title: 'Points Allowed All-Time', lowerIsBetter: true },
  { key: 'point_diff',     label: '+/-',      title: 'Point Differential', computed: true },
  { key: 'avg_pf',         label: 'PF/Yr',   title: 'Avg Points Scored Per Season', computed: true, decimals: 1 },
  { key: 'avg_pa',         label: 'PA/Yr',   title: 'Avg Points Allowed Per Season', computed: true, decimals: 1, lowerIsBetter: true },
];

const TEAM_STAT_COLS = [
  { key: 'wins',        label: 'W',       title: 'Wins' },
  { key: 'losses',      label: 'L',       title: 'Losses', lowerIsBetter: true },
  { key: 'ties',        label: 'T',       title: 'Ties' },
  { key: 'win_pct',     label: 'Win%',    title: 'Win %', suffix: '%', computed: true },
  { key: 'standing',    label: 'Place',   title: 'Division Standing', lowerIsBetter: true },
  { key: 'total_goals', label: 'Team G',  title: 'Team Total Goals' },
  { key: 'total_assts', label: 'Team A',  title: 'Team Total Assists' },
  { key: 'total_blks',  label: 'Team B',  title: 'Team Total Blocks' },
  { key: 'avg_cmp',     label: 'Avg Cmp%',title: 'Avg Player Completion %', suffix: '%', computed: true, decimals: 1 },
];

// ── Generic comparison table ──────────────────────────────────────────────────

function EntityAvatar({ entity, size = 120 }) {
  const [err, setErr] = useState(false);
  const src = entity.photoUrl || entity.logoUrl;
  const isPlayer = !!entity.photoUrl;

  return (
    <div style={{
      position: 'relative', width: size, height: size,
      borderRadius: 8, overflow: 'hidden',
      background: `${entity.color}18`,
      border: `1px solid ${entity.color}44`,
      margin: '0 auto',
      flexShrink: 0,
    }}>
      {src && !err ? (
        <img
          src={src}
          alt={entity.name}
          onError={() => setErr(true)}
          style={{
            width: '100%', height: '100%',
            objectFit: isPlayer ? 'cover' : 'contain',
            objectPosition: isPlayer ? 'top center' : 'center',
            display: 'block',
          }}
        />
      ) : (
        <div style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.38, color: `${entity.color}66`,
          fontFamily: 'var(--font-h1)',
        }}>
          {entity.name?.[0] ?? '?'}
        </div>
      )}
      {/* Bottom vignette */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '55%',
        background: 'linear-gradient(to top, rgba(0,0,0,0.62) 0%, transparent 100%)',
        pointerEvents: 'none',
      }} />
      {/* Name overlay */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '0 6px 6px',
        fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px',
        textTransform: 'uppercase', fontWeight: 600,
        color: '#fff', textAlign: 'center',
        lineHeight: 1.2, textShadow: '0 1px 3px rgba(0,0,0,0.6)',
      }}>
        {entity.name}
      </div>
    </div>
  );
}

const COL_W = 160; // fixed px width per entity column
const LABEL_W = 130;
const SLOTS = 6;

function CompareTable({ cols, entities, slots = SLOTS, isPlayer = false, perGame = false }) {
  // Pad to `slots` so column widths never shift
  const padded = [...entities];
  while (padded.length < slots) padded.push(null);

  const hasImages = entities.some(e => e.photoUrl || e.logoUrl);
  const totalW = LABEL_W + slots * COL_W;

  return (
    <>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: totalW, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: LABEL_W }} />
          {padded.map((_, i) => <col key={i} style={{ width: COL_W }} />)}
        </colgroup>
        <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
          <tr style={{ borderBottom: '1px solid var(--surf-border)', background: 'var(--card-bg)' }}>
            <th style={{ ...THL, verticalAlign: 'bottom', paddingBottom: 14, background: 'var(--card-bg)' }}>Stat</th>
            {padded.map((e, i) => (
              <th key={e ? e.id : `empty-${i}`} style={{
                ...TH, padding: 0,
                verticalAlign: 'bottom', borderLeft: '1px solid var(--surf-border)', background: 'var(--card-bg)',
              }}>
                {/* aspectRatio:'1' on the inner div makes it always as tall as its own width */}
                <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', overflow: 'hidden' }}>
                  {e ? (
                    <>
                      {hasImages && e.photoUrl && (
                        <>
                          <img
                            src={e.photoUrl}
                            alt={e.name}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
                            onError={ev => { ev.currentTarget.style.display = 'none'; }}
                          />
                          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 55%)', pointerEvents: 'none' }} />
                          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 8px 7px', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#fff', fontWeight: 600, textAlign: 'center', textShadow: '0 1px 4px rgba(0,0,0,0.7)' }}>
                            {e.name}
                          </div>
                        </>
                      )}
                      {(!hasImages || !e.photoUrl) && (
                        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', padding: '0 8px 10px', boxSizing: 'border-box' }}>
                          <Link
                            to={e.href || '#'}
                            style={{ color: e.color, textDecoration: 'none', display: 'block', fontSize: 11, letterSpacing: '0.5px', textTransform: 'none', fontWeight: 700 }}
                            onClick={e.href ? undefined : ev => ev.preventDefault()}
                          >
                            {e.name}
                          </Link>
                          {e.sub && <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--t-muted)', fontWeight: 400, letterSpacing: 0, textTransform: 'none', marginTop: 4 }}>{e.sub}</div>}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{
                      width: '100%', height: '100%',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
                      background: `${entityColor(i)}08`,
                      border: `2px dashed ${entityColor(i)}30`,
                      boxSizing: 'border-box',
                    }}>
                      <span style={{ fontSize: 28, color: `${entityColor(i)}40`, lineHeight: 1 }}>+</span>
                      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: `${entityColor(i)}40`, letterSpacing: '1px', textTransform: 'uppercase' }}>Add Player</span>
                    </div>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Seasons row — row 0, use surf-bg-2 so GP (ri=0, surf-bg) alternates correctly */}
          <tr style={{ background: 'var(--surf-bg-2)', borderBottom: '1px solid var(--surf-border)' }}>
            <td style={{ ...TDL, color: 'var(--t-muted)', fontSize: 10, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Seasons</td>
            {padded.map((e, i) => {
              if (!e) return <td key={`empty-seasons-${i}`} style={{ ...TD, borderLeft: '1px solid var(--surf-border)', color: 'var(--t-muted)', opacity: 0.25 }}>—</td>;
              const ys = e.seasonYears;
              let label = '—';
              if (ys && ys.length === 1) label = String(ys[0]);
              else if (ys && ys.length > 1) label = `${ys[0]}–${ys[ys.length - 1]}`;
              return <td key={e.id} style={{ ...TD, borderLeft: '1px solid var(--surf-border)', color: 'var(--t-primary)' }}>{label}</td>;
            })}
          </tr>
          {cols.map((col, ri) => {
            const vals = entities.map(e => e.data[col.key]);
            const nums = vals.filter(v => v != null && v !== '');
            const best = nums.length
              ? (col.lowerIsBetter ? Math.min(...nums) : Math.max(...nums))
              : null;
            return (
              <tr key={col.key} style={{ background: ri % 2 === 0 ? 'var(--surf-bg)' : 'var(--surf-bg-2)', borderBottom: '1px solid var(--surf-border)' }}>
                <td style={{ ...TDL, color: 'var(--t-muted)', fontSize: 10, letterSpacing: '0.5px', textTransform: 'uppercase' }} title={col.title}>
                  {col.label}{col.asterisk && <sup style={{ color: ORANGE, fontWeight: 700 }}>*</sup>}
                </td>
                {padded.map((e, i) => {
                  if (!e) return <td key={`empty-${i}`} style={{ ...TD, borderLeft: '1px solid var(--surf-border)', color: 'var(--t-muted)', opacity: 0.25 }}>—</td>;
                  const v = e.data[col.key];
                  const isBest = v != null && v !== '' && v === best;
                  let display = v == null ? '—' : col.suffix ? `${v}${col.suffix}` : v;
                  if (col.decimals && v != null) display = `${Number(v).toFixed(col.decimals)}${col.suffix || ''}`;
                  else if (perGame && v != null && col.key !== 'gp') display = `${Number(v).toFixed(2)}${col.suffix || ''}`;
                  return (
                    <td key={e.id} style={{ ...TD, borderLeft: '1px solid var(--surf-border)', color: isBest ? ORANGE : 'var(--t-primary)', fontWeight: isBest ? 700 : 400 }}>
                      {display}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    {cols.some(c => c.asterisk) && (
      <div style={{ borderTop: '1px solid var(--surf-border)', padding: '6px 14px', fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--t-muted)', display: 'flex', alignItems: 'center', gap: 4, background: 'var(--card-bg)' }}>
        <span style={{ color: ORANGE, fontWeight: 700, fontSize: 11 }}>*</span>
        Due to data limitations from the AUDL/UFA, these stats are only available from 2021 onward.
      </div>
    )}
    </>
  );
}

// ── Player search with debounced autocomplete ─────────────────────────────────

function PlayerSearch({ onSelect, selectedSlugs }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    function close(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function handleInput(val) {
    setQ(val);
    clearTimeout(timer.current);
    if (!val.trim()) { setResults([]); setOpen(false); return; }
    timer.current = setTimeout(() => {
      fetch(`/api/ufa/players?q=${encodeURIComponent(val)}&limit=8`)
        .then(r => r.json())
        .then(d => { setResults(d.players || []); setOpen(true); })
        .catch(() => {});
    }, 220);
  }

  function pick(p) {
    onSelect({ slug: p.slug, name: p.name, yearStart: p.yearStart, yearEnd: p.yearEnd });
    setQ('');
    setResults([]);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: 220, flexShrink: 0 }}>
      <input
        value={q}
        onChange={e => handleInput(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder="Search players…"
        className="search-input"
        style={{
          width: '100%', boxSizing: 'border-box',
          height: 32, padding: '0 12px', lineHeight: '30px',
          borderRadius: 7,
          border: '1px solid var(--input-border)', background: 'var(--input-bg)',
          color: 'var(--input-clr)', fontFamily: 'var(--font-h2)',
          fontSize: 12, outline: 'none',
        }}
      />
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: 'var(--card-bg)', border: '1px solid var(--surf-border)',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          overflow: 'hidden', marginTop: 4,
        }}>
          {results.filter(r => !selectedSlugs.has(r.slug)).map(r => (
            <div
              key={r.slug}
              onMouseDown={() => pick(r)}
              style={{
                padding: '9px 14px', cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                borderBottom: '1px solid var(--surf-border)',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surf-bg-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ fontFamily: 'var(--font-h2)', fontSize: 12, color: 'var(--t-primary)' }}>{r.name}</span>
              <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)' }}>
                {r.yearStart}–{r.yearEnd ?? 'pres'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PlayerChip({ player, color, onRemove }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 20,
      background: '#ffffff', border: `1px solid ${color}66`,
      flexShrink: 0,
    }}>
      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color }}>{player.name}</span>
      <button
        onClick={onRemove}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: `${color}99`, fontFamily: 'var(--font-h2)', fontSize: 13,
          lineHeight: 1, padding: 0, display: 'flex',
        }}
      >×</button>
    </div>
  );
}

// ── Franchise picker ──────────────────────────────────────────────────────────

function FranchisePicker({ value, onChange, teams, yearValue, onYearChange, showYear }) {
  const team = teams.find(t => t.franchise_id === value);
  const years = useMemo(() => {
    if (!team) return [];
    const ys = [];
    for (let y = team.latest_year; y >= (team.first_year ?? team.year); y--) {
      if (y !== 2020) ys.push(y);
    }
    return ys;
  }, [team]);

  return (
    <div style={{ position: 'relative', width: 220, flexShrink: 0 }}>
      <select
        className={`orange-scroll${value ? '' : ' ctrl-placeholder'}`}
        value={value || ''}
        onChange={e => onChange(e.target.value || null)}
        style={{
          width: '100%', boxSizing: 'border-box',
          height: 32, padding: '0 12px', lineHeight: '30px',
          borderRadius: 7,
          border: '1px solid var(--input-border)', background: 'var(--input-bg)',
          color: 'var(--input-clr)', fontFamily: 'var(--font-h2)',
          fontSize: 12, outline: 'none', appearance: 'none',
        }}
      >
        <option value="">Select franchise…</option>
        {teams.map(t => <option key={t.franchise_id} value={t.franchise_id}>{t.team_name}</option>)}
      </select>
      {showYear && team && years.length > 0 && (
        <select
          className="orange-scroll"
          value={yearValue || ''}
          onChange={e => onYearChange(Number(e.target.value))}
          style={{
            background: 'var(--input-bg)', border: '1px solid var(--input-border)',
            color: 'var(--input-clr)', fontFamily: 'var(--font-h2)', fontSize: 12,
            padding: '7px 10px', borderRadius: 7, outline: 'none', cursor: 'pointer',
          }}
        >
          {years.map(y => <option key={y} value={y}>{y} Season</option>)}
        </select>
      )}
    </div>
  );
}

// ── Sub-mode bar (inside a tab) ───────────────────────────────────────────────

function SubModeBar({ modes, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
      {modes.map(m => (
        <button
          key={m.key}
          onClick={() => onChange(m.key)}
          style={{
            padding: '6px 16px',
            background: active === m.key ? `${ORANGE}18` : 'var(--surf-bg)',
            border: `1px solid ${active === m.key ? ORANGE : 'var(--surf-border)'}`,
            borderRadius: 20,
            fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1px',
            textTransform: 'uppercase',
            color: active === m.key ? ORANGE : 'var(--t-muted)',
            cursor: 'pointer',
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

// ── Entity colours ────────────────────────────────────────────────────────────

const ENTITY_COLORS = [ORANGE, '#3b82f6', '#22c55e', '#a855f7', '#f59e0b'];

function entityColor(i) { return ENTITY_COLORS[i % ENTITY_COLORS.length]; }

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyPrompt({ children }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: 220, gap: 10, opacity: 0.45,
    }}>
      <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', textAlign: 'center' }}>
        {children}
      </div>
    </div>
  );
}

// ── Player Compare Panel ──────────────────────────────────────────────────────

const PLAYER_MODES = [
  { key: 'pvp', label: 'Player vs Player' },
  { key: 'pvf', label: 'Player vs Franchise' },
];

function PlayerComparePanel() {
  const [mode, setMode] = useState('pvp');
  const [selected, setSelected] = useState([]); // [{slug, name}]
  const [franchise, setFranchise] = useState(null);
  const [yearFilter, setYearFilter] = useState(null); // null = career, or number
  const [perGame, setPerGame] = useState(false);
  const [allTeams, setAllTeams] = useState([]);
  const [compareData, setCompareData] = useState(null);
  const [vsData, setVsData] = useState(null); // vs-franchise event-based stats
  const [loading, setLoading] = useState(false);

  // Load team list once
  useEffect(() => {
    fetch('/api/ufa/teams').then(r => r.json()).then(d => setAllTeams(d.teams || [])).catch(() => {});
  }, []);

  // Fetch career/season compare data (pvp mode)
  useEffect(() => {
    if (!selected.length) { setCompareData(null); return; }
    setLoading(true);
    fetch(`/api/ufa/compare/players?ids=${selected.map(p => p.slug).join(',')}`)
      .then(r => r.json())
      .then(d => { setCompareData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [selected]);

  // Fetch vs-franchise stats from game events
  useEffect(() => {
    if (mode !== 'pvf' || !franchise || !selected.length) { setVsData(null); return; }
    setLoading(true);
    const ids = selected.map(p => p.slug).join(',');
    fetch(`/api/ufa/compare/players/vs_franchise?ids=${ids}&franchise_id=${encodeURIComponent(franchise)}`)
      .then(r => r.json())
      .then(d => { setVsData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [mode, franchise, selected]);

  // Derive available years for year filter (pvp only)
  const availYears = useMemo(() => {
    if (!compareData) return [];
    const ys = new Set();
    compareData.players.forEach(p => p.seasons.forEach(s => ys.add(s.year)));
    return [...ys].sort((a, b) => b - a);
  }, [compareData]);

  // Compute each entity's stat block
  const entities = useMemo(() => {
    // pvf: use vsData when franchise is selected
    const source = (mode === 'pvf' && franchise && vsData) ? vsData : compareData;
    if (!source) return [];
    return source.players.map((p, i) => {
      let data;
      if (mode === 'pvf' && franchise && vsData) {
        data = p.career; // vsData career = aggregated vs-franchise stats
      } else if (yearFilter) {
        const seas = p.seasons.find(s => s.year === yearFilter);
        data = seas || {};
      } else {
        data = p.career;
      }
      const franchiseName = mode === 'pvf' && franchise
        ? allTeams.find(t => t.franchise_id === franchise)?.team_name
        : null;
      // Collect the years this player has data for (from compareData always)
      const sourcePlayer = compareData?.players.find(cp => cp.slug === p.slug);
      const seasonYears = sourcePlayer ? sourcePlayer.seasons.map(s => s.year).sort((a, b) => a - b) : [];
      return {
        id: p.slug,
        name: p.name,
        href: p.master_id ? `/players/${p.master_id}` : null,
        color: entityColor(i),
        sub: franchiseName,
        photoUrl: p.photo_url || null,
        data: data || {},
        seasonYears,
      };
    });
  }, [compareData, vsData, yearFilter, mode, franchise, allTeams]);

  // Apply per-game transform after entities are built
  // All stat keys except gp and pre-computed rates (pct already per-possession)
  const SKIP_PG = new Set(['gp', 'completion_pct', 'huck_pct']);
  const displayEntities = useMemo(() => {
    if (!perGame) return entities;
    return entities.map(e => {
      const gp = e.data.gp;
      if (!gp) return e;
      const pgData = { ...e.data };
      Object.keys(pgData).forEach(k => {
        if (!SKIP_PG.has(k) && pgData[k] != null) {
          pgData[k] = Math.round(pgData[k] / gp * 100) / 100;
        }
      });
      return { ...e, data: pgData };
    });
  }, [entities, perGame]);

  const selectedSlugs = useMemo(() => new Set(selected.map(p => p.slug)), [selected]);

  function addPlayer(p) {
    if (selected.length >= SLOTS || selectedSlugs.has(p.slug)) return;
    setSelected(prev => [...prev, p]);
  }
  function removePlayer(slug) { setSelected(prev => prev.filter(p => p.slug !== slug)); }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '28px 32px 0', flexShrink: 0, background: 'var(--card-bg)' }}>
      {/* Top row: search fields left, mode buttons right */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <PlayerSearch onSelect={addPlayer} selectedSlugs={selectedSlugs} />
          {mode === 'pvf' && (
            <FranchisePicker
              value={franchise} onChange={setFranchise}
              teams={allTeams}
            />
          )}
          {mode === 'pvp' && (
            <select
              className="orange-scroll"
              value={yearFilter || ''}
              onChange={e => setYearFilter(e.target.value ? Number(e.target.value) : null)}
              disabled={availYears.length === 0}
              style={{
                flex: 'none',
                background: 'var(--input-bg)', border: '1px solid var(--input-border)',
                color: 'var(--input-clr)', fontFamily: 'var(--font-h2)', fontSize: 12,
                height: 32, padding: '0 12px', lineHeight: '30px',
                borderRadius: 7, outline: 'none',
                boxSizing: 'border-box', appearance: 'none',
                opacity: availYears.length === 0 ? 0.4 : 1,
              }}
            >
              <option value="">All Seasons</option>
              {availYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {PLAYER_MODES.map(m => (
            <button
              key={m.key}
              onClick={() => { setMode(m.key); setFranchise(null); }}
              style={{
                padding: '6px 16px',
                background: mode === m.key ? `${ORANGE}18` : 'var(--surf-bg)',
                border: `1px solid ${mode === m.key ? ORANGE : 'var(--surf-border)'}`,
                borderRadius: 20,
                fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1px',
                textTransform: 'uppercase',
                color: mode === m.key ? ORANGE : 'var(--t-muted)',
                cursor: 'pointer',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      </div>

      {/* Label + toggle — fixed, never scrolls */}
      <div style={{ padding: '12px 32px 8px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: loading ? 0.45 : 1, transition: 'opacity 0.2s' }}>
        <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: '#ffffff' }}>
          {yearFilter ? `${yearFilter} Season` : (mode === 'pvf' ? 'Career vs Franchise' : 'Career Totals')}
        </div>
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--surf-border)' }}>
          {[{ key: false, label: 'Total' }, { key: true, label: 'Per Game' }].map(opt => (
            <button
              key={String(opt.key)}
              onClick={() => setPerGame(opt.key)}
              style={{
                width: 72, padding: '4px 0', border: 'none', cursor: 'pointer',
                fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase',
                background: perGame === opt.key ? ORANGE : 'var(--card-bg)',
                color: perGame === opt.key ? '#fff' : 'var(--t-muted)',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Only the table rows scroll */}
      <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 32px 32px' }}>
        <div style={{ border: '1px solid var(--surf-border)', borderRadius: 4, overflow: 'clip', background: 'var(--card-bg)', opacity: loading ? 0.45 : 1, transition: 'opacity 0.2s' }}>
          <CompareTable cols={PLAYER_STAT_COLS} entities={displayEntities} isPlayer perGame={!!perGame} />
        </div>
      </div>
    </div>
  );
}

// ── Team Compare Panel ────────────────────────────────────────────────────────

const TEAM_MODES = [
  { key: 'same', label: 'Same Year' },
  { key: 'diff', label: 'Different Years' },
];

function TeamComparePanel() {
  const [mode, setMode] = useState('same');
  const [allTeams, setAllTeams] = useState([]);
  const [sharedYear, setSharedYear] = useState(2024);
  const [fA, setFA] = useState(null); const [yA, setYA] = useState(2024);
  const [fB, setFB] = useState(null); const [yB, setYB] = useState(2024);
  const [dataA, setDataA] = useState(null);
  const [dataB, setDataB] = useState(null);
  const [rosterA, setRosterA] = useState(null);
  const [rosterB, setRosterB] = useState(null);

  useEffect(() => {
    fetch('/api/ufa/teams').then(r => r.json()).then(d => {
      const teams = d.teams || [];
      setAllTeams(teams);
      // Default to 2024 since most franchises have it
      setSharedYear(2024); setYA(2024); setYB(2024);
    }).catch(() => {});
  }, []);

  // Compute actual year per team based on mode
  const yearA = mode === 'same' ? sharedYear : yA;
  const yearB = mode === 'same' ? sharedYear : yB;

  // Fetch season + roster for A
  useEffect(() => { if (!fA) { setDataA(null); setRosterA(null); return; }
    Promise.all([
      fetch(`/api/ufa/franchise/${fA}/seasons`).then(r => r.json()),
      fetch(`/api/ufa/franchise/${fA}/roster/${yearA}`).then(r => r.json()).catch(() => ({ roster: [] })),
    ]).then(([seasons, roster]) => {
      const s = seasons.seasons?.find(s => s.year === yearA);
      setDataA(s || null);
      setRosterA(roster.roster || []);
    }).catch(() => {});
  }, [fA, yearA]);

  // Fetch season + roster for B
  useEffect(() => { if (!fB) { setDataB(null); setRosterB(null); return; }
    Promise.all([
      fetch(`/api/ufa/franchise/${fB}/seasons`).then(r => r.json()),
      fetch(`/api/ufa/franchise/${fB}/roster/${yearB}`).then(r => r.json()).catch(() => ({ roster: [] })),
    ]).then(([seasons, roster]) => {
      const s = seasons.seasons?.find(s => s.year === yearB);
      setDataB(s || null);
      setRosterB(roster.roster || []);
    }).catch(() => {});
  }, [fB, yearB]);

  function rosterStats(roster) {
    if (!roster || !roster.length) return {};
    const _sum = k => roster.reduce((acc, p) => acc + (p[k] || 0), 0);
    const validCmp = roster.filter(p => (p.throw_attempts || 0) >= 10);
    const avgCmp = validCmp.length
      ? Math.round(validCmp.reduce((a, p) => a + (p.completion_pct || 0), 0) / validCmp.length * 10) / 10
      : null;
    return {
      total_goals: _sum('goals'), total_assts: _sum('assists'),
      total_blks: _sum('blocks'), avg_cmp: avgCmp,
    };
  }

  function teamData(season, rStats) {
    if (!season) return {};
    const gp = (season.wins || 0) + (season.losses || 0) + (season.ties || 0);
    return {
      wins: season.wins, losses: season.losses, ties: season.ties,
      win_pct: gp ? Math.round(season.wins / gp * 1000) / 10 : null,
      standing: season.standing,
      ...rStats,
    };
  }

  const teamA = allTeams.find(t => t.franchise_id === fA);
  const teamB = allTeams.find(t => t.franchise_id === fB);
  const dataAFull = teamData(dataA, rosterStats(rosterA));
  const dataBFull = teamData(dataB, rosterStats(rosterB));

  // Always 2 slots; unfilled = null so CompareTable shows placeholder column
  const entities = [
    fA && dataA ? { id: 'a', name: teamA?.team_name || 'Team A', sub: String(yearA), href: `/ufa/teams/${fA}`, color: entityColor(0), logoUrl: teamLogoSrc(teamA?.team_abbreviation, dataA?.slug), data: dataAFull } : null,
    fB && dataB ? { id: 'b', name: teamB?.team_name || 'Team B', sub: String(yearB), href: `/ufa/teams/${fB}`, color: entityColor(1), logoUrl: teamLogoSrc(teamB?.team_abbreviation, dataB?.slug), data: dataBFull } : null,
  ];

  const loadingAny = fA && !dataA || fB && !dataB;
  const YEAR_OPTS = [];
  for (let y = 2026; y >= 2012; y--) { if (y !== 2020) YEAR_OPTS.push(y); }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '28px 32px 0', flexShrink: 0, background: 'var(--card-bg)' }}>
      <SubModeBar modes={TEAM_MODES} active={mode} onChange={m => setMode(m)} />

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 24, alignItems: 'flex-end' }}>
        {mode === 'same' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>Season</div>
            <select value={sharedYear} onChange={e => setSharedYear(Number(e.target.value))}
              style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-clr)', fontFamily: 'var(--font-h2)', fontSize: 12, padding: '7px 10px', borderRadius: 7, outline: 'none', cursor: 'pointer' }}
            >
              {YEAR_OPTS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}
        <FranchisePicker value={fA} onChange={setFA} teams={allTeams} label="Team A"
          yearValue={yA} onYearChange={setYA} showYear={mode === 'diff'} />
        <FranchisePicker value={fB} onChange={setFB} teams={allTeams} label="Team B"
          yearValue={yB} onYearChange={setYB} showYear={mode === 'diff'} />
      </div>
      </div>
      <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 32px 32px' }}>
      <div style={{ border: '1px solid var(--surf-border)', borderRadius: 4, overflow: 'clip', opacity: loadingAny ? 0.45 : 1, transition: 'opacity 0.2s' }}>
        <CompareTable cols={TEAM_STAT_COLS} entities={entities} slots={2} />
      </div>
      </div>
    </div>
  );
}

// ── Franchise Compare Panel ───────────────────────────────────────────────────

function FranchiseComparePanel() {
  const [allTeams, setAllTeams] = useState([]);
  const [fA, setFA] = useState(null);
  const [fB, setFB] = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/ufa/teams').then(r => r.json()).then(d => setAllTeams(d.teams || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const fids = [fA, fB].filter(Boolean);
    if (fids.length < 2) { setCompareData(null); return; }
    setLoading(true);
    fetch(`/api/ufa/compare/franchises?ids=${fids.join(',')}`)
      .then(r => r.json())
      .then(d => { setCompareData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [fA, fB]);

  function enrichedData(f) {
    if (!f) return {};
    const gp = (f.wins || 0) + (f.losses || 0) + (f.ties || 0);
    return {
      ...f,
      win_pct: gp ? Math.round(f.wins / gp * 1000) / 10 : null,
      point_diff: (f.points_for || 0) - (f.points_against || 0),
      avg_pf: f.seasons ? Math.round((f.points_for || 0) / f.seasons * 10) / 10 : null,
      avg_pa: f.seasons ? Math.round((f.points_against || 0) / f.seasons * 10) / 10 : null,
    };
  }

  const entities = compareData?.franchises?.map((f, i) => ({
    id: f.franchise_id,
    name: f.name,
    sub: `${f.first_year}–${f.latest_year}`,
    href: `/ufa/teams/${f.franchise_id}`,
    color: entityColor(i),
    logoUrl: teamLogoSrc(f.abbr, f.slug),
    data: enrichedData(f),
  })) || [];

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '28px 32px 0', flexShrink: 0, background: 'var(--card-bg)' }}>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 24 }}>
        <FranchisePicker value={fA} onChange={setFA} teams={allTeams} label="Franchise A" />
        <FranchisePicker value={fB} onChange={setFB} teams={allTeams} label="Franchise B" />
      </div>
      </div>
      <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 32px 32px' }}>

      <div style={{ border: '1px solid var(--surf-border)', borderRadius: 4, overflow: 'clip', opacity: loading ? 0.45 : 1, transition: 'opacity 0.2s' }}>
        <CompareTable cols={FRANCHISE_STAT_COLS} entities={entities} slots={2} />
      </div>

      {!loading && entities.length === 2 && (
        <>
          {/* Career leaders */}
          <div style={{ marginTop: 28 }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: 14 }}>All-Time Career Leaders</div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${entities.length}, 1fr)`, gap: 16 }}>
              {entities.map(e => {
                const leaders = compareData.franchises.find(f => f.franchise_id === e.id)?.career_leaders || {};
                return (
                  <div key={e.id} style={{ border: '1px solid var(--surf-border)', borderRadius: 4, padding: '16px 18px', background: 'var(--surf-bg)' }}>
                    <div style={{ fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', color: e.color, marginBottom: 12 }}>{e.name}</div>
                    {['goals', 'assists', 'blocks'].map(stat => {
                      const l = leaders[stat];
                      return (
                        <div key={stat} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--surf-border)' }}>
                          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>{stat}</span>
                          <div style={{ textAlign: 'right' }}>
                            {l ? (
                              <>
                                <div style={{ fontFamily: 'var(--font-h1)', fontSize: 16, fontWeight: 700, color: e.color, lineHeight: 1 }}>{l.total}</div>
                                <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-secondary)' }}>
                                  {l.master_id ? <Link to={`/players/${l.master_id}`} style={{ color: 'var(--t-secondary)', textDecoration: 'none' }}>{l.name}</Link> : l.name}
                                </div>
                              </>
                            ) : <span style={{ color: 'var(--t-muted)' }}>—</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
