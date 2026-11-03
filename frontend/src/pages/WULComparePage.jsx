import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import LeagueShell from '../components/LeagueShell.jsx';

const BASE    = import.meta.env.BASE_URL.replace(/\/$/, '');
const ORANGE  = '#EA6020';
const SLOTS   = 6;
const COL_W   = 160;
const LABEL_W = 130;

const ENTITY_COLORS = [ORANGE, '#3b82f6', '#22c55e', '#a855f7', '#f59e0b'];
function entityColor(i) { return ENTITY_COLORS[i % ENTITY_COLORS.length]; }

const TH  = { padding: '7px 14px', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 400, whiteSpace: 'nowrap', textAlign: 'center' };
const THL = { ...TH, textAlign: 'left' };
const TD  = { padding: '6px 14px', fontFamily: 'var(--font-h2)', fontSize: 12, textAlign: 'center', whiteSpace: 'nowrap', background: 'inherit' };
const TDL = { ...TD, textAlign: 'left' };

const PLAYER_STAT_COLS = [
  // Volume
  { key: 'gp',               label: 'GP',     title: 'Games Played' },
  { key: 'pp',               label: 'PP',     title: 'Points Played' },
  { key: 'opp',              label: 'OPP',    title: 'Offensive Points Played' },
  { key: 'dpp',              label: 'DPP',    title: 'Defensive Points Played' },
  // EDGE
  { key: 'edge',             label: 'EDGE',   title: 'Total EDGE', decimals: 2, asterisk: true },
  { key: 'edge_o',           label: 'EDGE-O', title: 'Offensive EDGE', decimals: 2, asterisk: true },
  { key: 'edge_b',           label: 'EDGE-B', title: 'Defensive EDGE', decimals: 2, asterisk: true },
  // Scoring
  { key: 'goals',            label: 'G',      title: 'Goals' },
  { key: 'assists',          label: 'A',      title: 'Assists' },
  { key: 'hockey_assists',   label: 'HA',     title: 'Hockey Assists' },
  { key: 'blocks',           label: 'B',      title: 'Blocks' },
  { key: 'plus_minus',       label: '+/-',    title: 'Plus/Minus' },
  // Throwing
  { key: 'touches',          label: 'Tch',    title: 'Touches' },
  { key: 'completions',      label: 'Com',    title: 'Completions' },
  { key: 'attempts',         label: 'Th',     title: 'Throws' },
  { key: 'completion_pct',   label: 'Com%',   title: 'Completion %', suffix: '%', decimals: 1 },
  // Receiving
  { key: 'targets',          label: 'Tgt',    title: 'Targets' },
  { key: 'receptions',       label: 'Rec',    title: 'Receptions' },
  // Yards
  { key: 'throwing_yards',   label: 'ThY',    title: 'Throwing Yards' },
  { key: 'receiving_yards',  label: 'RecY',   title: 'Receiving Yards' },
  { key: 'total_yards',      label: 'Y',      title: 'Total Yards' },
  { key: 'effective_yards',  label: 'EY',     title: 'Effective Yards' },
  // Hucks
  { key: 'hucks',            label: 'H',      title: 'Hucks' },
  { key: 'huck_completions', label: 'HCom',   title: 'Huck Completions' },
  { key: 'huck_receptions',  label: 'HRec',   title: 'Huck Receptions' },
  // Errors / turnovers
  { key: 'turnovers',        label: 'T',      title: 'Turnovers', lowerIsBetter: true },
  { key: 'throwing_errors',  label: 'ThEr',   title: 'Throwing Errors', lowerIsBetter: true },
  { key: 'receiving_errors', label: 'RecEr',  title: 'Receiving Errors', lowerIsBetter: true },
  { key: 'stalls',           label: 'S',      title: 'Stalls', lowerIsBetter: true },
];

const FRANCHISE_STAT_COLS = [
  { key: 'seasons',        label: 'Seasons', title: 'Seasons Played' },
  { key: 'wins',           label: 'W',       title: 'All-Time Wins' },
  { key: 'losses',         label: 'L',       title: 'All-Time Losses', lowerIsBetter: true },
  { key: 'ties',           label: 'T',       title: 'All-Time Ties' },
  { key: 'win_pct',        label: 'Win%',    title: 'Win Percentage', suffix: '%' },
  { key: 'points_for',     label: 'PF',      title: 'Points Scored All-Time' },
  { key: 'points_against', label: 'PA',      title: 'Points Allowed All-Time', lowerIsBetter: true },
  { key: 'point_diff',     label: '+/-',     title: 'Point Differential' },
];

const SKIP_PG = new Set(['gp', 'completion_pct', 'pp', 'opp', 'dpp', 'edge', 'edge_o', 'edge_b']);

const TABS = [
  { key: 'player',    label: 'Player' },
  { key: 'franchise', label: 'Franchise' },
];
const VALID_TABS = new Set(TABS.map(t => t.key));

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WULComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const [tab, setTab] = useState(VALID_TABS.has(rawTab) ? rawTab : 'player');

  function switchTab(key) {
    setTab(key);
    setSearchParams({ tab: key }, { replace: true });
  }

  return (
    <LeagueShell league="wul">
      {/* Hero */}
      <div style={{ padding: '36px 32px 24px', position: 'relative', overflow: 'hidden', background: 'var(--card-bg)' }}>
        <img
          src={`${BASE}/assets/png/WULicon.png`}
          aria-hidden="true"
          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', height: '180%', width: 'auto', opacity: 0.06, pointerEvents: 'none', zIndex: 0 }}
          onError={e => { e.currentTarget.style.display = 'none'; }}
        />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: ORANGE, opacity: 0.7, marginBottom: 4 }}>
            Western Ultimate League
          </div>
          <h1 style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: 'clamp(1.4rem, 3vw, 2rem)', color: 'var(--t-primary)', margin: 0, letterSpacing: '-0.02em', textTransform: 'uppercase' }}>
            Compare
          </h1>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {tab === 'player'    && <PlayerComparePanel />}
        {tab === 'franchise' && <FranchiseComparePanel />}
      </div>
    </LeagueShell>
  );
}

// ── CompareTable ──────────────────────────────────────────────────────────────

function CompareTable({ cols, entities, slots = SLOTS, perGame = false }) {
  const padded = [...entities];
  while (padded.length < slots) padded.push(null);
  const totalW = LABEL_W + slots * COL_W;

  return (
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: totalW, tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: LABEL_W }} />
          {padded.map((_, i) => <col key={i} style={{ width: COL_W }} />)}
        </colgroup>
        <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
          <tr style={{ borderBottom: '1px solid var(--surf-border)', background: 'var(--card-bg)' }}>
            <th style={{ ...THL, verticalAlign: 'bottom', paddingBottom: 14, background: 'var(--card-bg)' }}>Stat</th>
            {padded.map((e, i) => (
              <th key={e ? e.id : `empty-${i}`} style={{ ...TH, padding: 0, verticalAlign: 'bottom', borderLeft: '1px solid var(--surf-border)', background: 'var(--card-bg)' }}>
                <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', overflow: 'hidden' }}>
                  {e ? (
                    e.photoUrl ? (
                      <>
                        <img src={e.photoUrl} alt={e.name}
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }}
                          onError={ev => { ev.currentTarget.style.display = 'none'; }}
                        />
                        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 55%)', pointerEvents: 'none' }} />
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0 8px 7px', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#fff', fontWeight: 600, textAlign: 'center', textShadow: '0 1px 4px rgba(0,0,0,0.7)' }}>
                          {e.name}
                        </div>
                      </>
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', padding: '0 8px 10px', boxSizing: 'border-box', background: `${entityColor(i)}10` }}>
                        <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '0.5px', color: entityColor(i), fontWeight: 700, textAlign: 'center' }}>{e.name}</span>
                        {e.sub && <span style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: 'var(--t-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginTop: 4 }}>{e.sub}</span>}
                      </div>
                    )
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: `${entityColor(i)}08`, border: `2px dashed ${entityColor(i)}30`, boxSizing: 'border-box' }}>
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
          <tr style={{ background: 'var(--surf-bg-2)', borderBottom: '1px solid var(--surf-border)' }}>
            <td style={{ ...TDL, color: 'var(--t-muted)', fontSize: 10, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Seasons</td>
            {padded.map((e, i) => {
              if (!e) return <td key={`es-${i}`} style={{ ...TD, borderLeft: '1px solid var(--surf-border)', color: 'var(--t-muted)', opacity: 0.25 }}>—</td>;
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
            const best = nums.length ? (col.lowerIsBetter ? Math.min(...nums) : Math.max(...nums)) : null;
            return (
              <tr key={col.key} style={{ background: ri % 2 === 0 ? 'var(--surf-bg)' : 'var(--surf-bg-2)', borderBottom: '1px solid var(--surf-border)' }}>
                <td style={{ ...TDL, color: 'var(--t-muted)', fontSize: 10, letterSpacing: '0.5px', textTransform: 'uppercase' }} title={col.title}>{col.label}</td>
                {padded.map((e, i) => {
                  if (!e) return <td key={`ev-${i}`} style={{ ...TD, borderLeft: '1px solid var(--surf-border)', color: 'var(--t-muted)', opacity: 0.25 }}>—</td>;
                  const v = e.data[col.key];
                  const isBest = v != null && v !== '' && v === best && nums.length > 1;
                  let display;
                  if (v == null) display = '—';
                  else if (col.decimals != null) display = `${Number(v).toFixed(col.decimals)}${col.suffix || ''}`;
                  else if (perGame && !SKIP_PG.has(col.key)) display = Number(v).toFixed(2);
                  else display = col.suffix ? `${v}${col.suffix}` : v;
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
  );
}

// ── PlayerSearch ──────────────────────────────────────────────────────────────

function PlayerSearch({ onSelect, selectedNames }) {
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
      fetch(`/api/wul/players/search?q=${encodeURIComponent(val)}`)
        .then(r => r.json())
        .then(d => { setResults(d.players || []); setOpen(true); })
        .catch(() => {});
    }, 220);
  }

  function pick(p) {
    onSelect(p);
    setQ(''); setResults([]); setOpen(false);
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: 220, flexShrink: 0 }}>
      <input value={q} onChange={e => handleInput(e.target.value)} onFocus={() => results.length && setOpen(true)}
        placeholder="Search WUL players…" className="search-input"
        style={{ width: '100%', boxSizing: 'border-box', height: 32, padding: '0 12px', lineHeight: '30px', borderRadius: 7, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--input-clr)', fontFamily: 'var(--font-h2)', fontSize: 12, outline: 'none' }}
      />
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'var(--card-bg)', border: '1px solid var(--surf-border)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', overflow: 'hidden', marginTop: 4 }}>
          {results.filter(r => !selectedNames.has(r.name)).map(r => (
            <div key={r.name} onMouseDown={() => pick(r)}
              style={{ padding: '9px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--surf-border)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--surf-bg-2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ fontFamily: 'var(--font-h2)', fontSize: 12, color: 'var(--t-primary)' }}>{r.name}</span>
              <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)' }}>{r.team}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PlayerChip ────────────────────────────────────────────────────────────────

function PlayerChip({ player, color, onRemove }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, background: '#ffffff', border: `1px solid ${color}66`, flexShrink: 0 }}>
      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color }}>{player.name}</span>
      <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: `${color}99`, fontFamily: 'var(--font-h2)', fontSize: 13, lineHeight: 1, padding: 0, display: 'flex' }}>×</button>
    </div>
  );
}

// ── FranchisePicker ───────────────────────────────────────────────────────────

function FranchisePicker({ value, onChange, teams, label }) {
  return (
    <div style={{ position: 'relative', width: 220, flexShrink: 0 }}>
      <select className={`orange-scroll${value ? '' : ' ctrl-placeholder'}`} value={value || ''} onChange={e => onChange(e.target.value || null)}
        style={{ width: '100%', boxSizing: 'border-box', height: 32, padding: '0 12px', lineHeight: '30px', borderRadius: 7, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--input-clr)', fontFamily: 'var(--font-h2)', fontSize: 12, outline: 'none', appearance: 'none' }}
      >
        <option value="">{label || 'Select franchise…'}</option>
        {teams.map(t => <option key={t.franchise_id} value={t.franchise_id}>{t.team_name}</option>)}
      </select>
    </div>
  );
}

// ── EmptyPrompt ───────────────────────────────────────────────────────────────

function EmptyPrompt({ children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 220, gap: 10, opacity: 0.45 }}>
      <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', textAlign: 'center', lineHeight: 1.7 }}>{children}</div>
    </div>
  );
}

// ── SubModeBar ────────────────────────────────────────────────────────────────

const PLAYER_MODES = [{ key: 'pvp', label: 'Player vs Player' }];

function SubModeBar({ modes, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 24 }}>
      {modes.map(m => (
        <button key={m.key} onClick={() => onChange(m.key)}
          style={{ padding: '6px 16px', background: active === m.key ? `${ORANGE}18` : 'var(--surf-bg)', border: `1px solid ${active === m.key ? ORANGE : 'var(--surf-border)'}`, borderRadius: 20, fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase', color: active === m.key ? ORANGE : 'var(--t-muted)', cursor: 'pointer' }}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

// ── PlayerComparePanel ────────────────────────────────────────────────────────

function PlayerComparePanel() {
  const [mode, setMode] = useState('pvp');
  const [selected, setSelected] = useState([]);
  const [yearFilter, setYearFilter] = useState(null);
  const [perGame, setPerGame] = useState(false);
  const [compareData, setCompareData] = useState(null);
  const [loading, setLoading] = useState(false);

  const selectedNames = useMemo(() => new Set(selected.map(p => p.name)), [selected]);

  useEffect(() => {
    if (!selected.length) { setCompareData(null); return; }
    setLoading(true);
    const ids = selected.map(p => encodeURIComponent(p.name)).join(',');
    fetch(`/api/wul/compare/players?ids=${ids}`)
      .then(r => r.json())
      .then(d => { setCompareData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [selected]);

  useEffect(() => { setYearFilter(null); }, [selected]);

  const availYears = useMemo(() => {
    if (!compareData) return [];
    const ys = new Set();
    (compareData.players || []).forEach(p => (p.seasons || []).forEach(s => ys.add(s.year)));
    return [...ys].sort((a, b) => b - a);
  }, [compareData]);

  const entities = useMemo(() => {
    if (!compareData) return [];
    return (compareData.players || []).map((p, i) => {
      const data = yearFilter ? (p.seasons.find(s => s.year === yearFilter) || {}) : p.career;
      const seasonYears = [...new Set((p.seasons || []).map(s => s.year))].sort((a, b) => a - b);
      return { id: p.id, name: p.name, sub: p.team, color: entityColor(i), photoUrl: p.photo_url || null, data: data || {}, seasonYears };
    });
  }, [compareData, yearFilter]);

  const displayEntities = useMemo(() => {
    if (!perGame) return entities;
    return entities.map(e => {
      const gp = e.data.gp;
      if (!gp) return e;
      const pgData = Object.fromEntries(
        Object.entries(e.data).map(([k, v]) => [k, SKIP_PG.has(k) || v == null ? v : Math.round(v / gp * 100) / 100])
      );
      return { ...e, data: pgData };
    });
  }, [entities, perGame]);

  function addPlayer(p) {
    if (selected.length >= SLOTS || selectedNames.has(p.name)) return;
    setSelected(prev => [...prev, p]);
  }
  function removePlayer(name) { setSelected(prev => prev.filter(p => p.name !== name)); }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '28px 32px 0', flexShrink: 0, background: 'var(--card-bg)' }}>
      {/* Top row: search fields left, mode buttons right */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <PlayerSearch onSelect={addPlayer} selectedNames={selectedNames} />
          <select className="orange-scroll" value={yearFilter || ''} onChange={e => setYearFilter(e.target.value ? Number(e.target.value) : null)}
            disabled={!availYears.length}
            style={{ flex: 'none', background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-clr)', fontFamily: 'var(--font-h2)', fontSize: 12, height: 32, padding: '0 12px', borderRadius: 7, outline: 'none', boxSizing: 'border-box', appearance: 'none', opacity: availYears.length ? 1 : 0.4 }}
          >
            <option value="">All Seasons</option>
            {availYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {PLAYER_MODES.map(m => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
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
          {yearFilter ? `${yearFilter} Season` : 'Career Totals'}
        </div>
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--surf-border)' }}>
          {[{ v: false, label: 'Total' }, { v: true, label: 'Per Game' }].map(opt => (
            <button key={String(opt.v)} onClick={() => setPerGame(opt.v)}
              style={{ width: 72, padding: '4px 0', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', background: perGame === opt.v ? ORANGE : 'var(--card-bg)', color: perGame === opt.v ? '#fff' : 'var(--t-muted)', transition: 'background 0.15s, color 0.15s' }}
            >{opt.label}</button>
          ))}
        </div>
      </div>

      {/* Only the table rows scroll */}
      <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 32px 32px' }}>
        <div style={{ border: '1px solid var(--surf-border)', borderRadius: 4, overflow: 'clip', background: 'var(--card-bg)', opacity: loading ? 0.45 : 1, transition: 'opacity 0.2s' }}>
          <CompareTable cols={PLAYER_STAT_COLS} entities={displayEntities} perGame={!!perGame} />
        </div>
      </div>
    </div>
  );
}

// ── FranchiseComparePanel ─────────────────────────────────────────────────────

function FranchiseComparePanel() {
  const [allTeams, setAllTeams] = useState([]);
  const [fA, setFA] = useState(null);
  const [fB, setFB] = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/wul/teams').then(r => r.json()).then(d => setAllTeams(d.teams || [])).catch(() => {});
  }, []);

  useEffect(() => {
    const fids = [fA, fB].filter(Boolean);
    if (fids.length < 2) { setCompareData(null); return; }
    setLoading(true);
    fetch(`/api/wul/compare/franchises?ids=${fids.join(',')}`)
      .then(r => r.json())
      .then(d => { setCompareData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [fA, fB]);

  function enrich(f) {
    const gp = (f.wins || 0) + (f.losses || 0) + (f.ties || 0);
    return { ...f, win_pct: gp ? Math.round(f.wins / gp * 1000) / 10 : null, point_diff: (f.points_for || 0) - (f.points_against || 0) };
  }

  const entities = (compareData?.franchises || []).map((f, i) => ({
    id: f.franchise_id,
    name: f.name,
    sub: f.first_year && f.latest_year ? `${f.first_year}–${f.latest_year}` : null,
    color: entityColor(i),
    photoUrl: null,
    data: enrich(f),
    seasonYears: f.first_year && f.latest_year ? [f.first_year, f.latest_year] : [],
  }));

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '28px 32px 0', flexShrink: 0, background: 'var(--card-bg)' }}>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 24 }}>
        <FranchisePicker value={fA} onChange={setFA} teams={allTeams} label="Franchise A" />
        <FranchisePicker value={fB} onChange={setFB} teams={allTeams} label="Franchise B" />
      </div>
      </div>
      <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 32px 32px' }}>
      {(!fA || !fB) && <EmptyPrompt>Select two WUL franchises to compare</EmptyPrompt>}

      {fA && fB && (
        <div style={{ opacity: loading ? 0.45 : 1, transition: 'opacity 0.2s' }}>
          <div style={{ border: '1px solid var(--surf-border)', borderRadius: 4, overflow: 'clip' }}>
            <CompareTable cols={FRANCHISE_STAT_COLS} entities={entities} slots={2} />
          </div>

          {!loading && entities.length === 2 && (
            <div style={{ marginTop: 28 }}>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: 14 }}>All-Time Career Leaders</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
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
                                  <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-secondary)' }}>{l.name}</div>
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
          )}
        </div>
      )}
      </div>
    </div>
  );
}
