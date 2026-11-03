import React, { useState, useMemo, useReducer, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import LeagueShell from '../components/LeagueShell.jsx';
import {
  computeX,
  computeScoreWeight,
  computeDateWeight,
  computeGameRating,
  computeTeamRating,
  computeSeasonRatingsDetailed,
} from '../utils/rankings.js';

const ORANGE = '#EA6020';

// ─── Shared micro-styles ─────────────────────────────────────────────────────
const LABEL = {
  fontFamily: 'var(--font-h2)',
  fontSize: 9,
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color: 'var(--t-muted)',
  marginBottom: 6,
  display: 'block',
};

const INPUT_STYLE = {
  background: 'var(--input-bg)',
  border: '1px solid var(--input-border)',
  color: 'var(--input-clr)',
  borderRadius: 6,
  padding: '8px 10px',
  fontFamily: 'var(--font-h2)',
  fontSize: 12,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const SURF_CARD = {
  background: 'var(--surf-bg-2)',
  border: '1px solid var(--surf-border)',
  borderRadius: 10,
  padding: '16px 20px',
};

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ ...SURF_CARD, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={LABEL}>{label}</span>
      <span style={{
        fontFamily: 'var(--font-h1)', fontWeight: 700,
        fontSize: '1.6rem', color: color || 'var(--t-primary)', lineHeight: 1,
      }}>{value}</span>
      {sub && <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)', marginTop: 2 }}>{sub}</span>}
    </div>
  );
}

function NumInput({ label, value, onChange, min, max, step = 1, width = 100 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <label style={LABEL}>{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(Number(e.target.value))}
        style={{ ...INPUT_STYLE, width }}
      />
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={LABEL}>{label}</span>
      <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: '1px solid var(--surf-border)', width: 'fit-content' }}>
        {[true, false].map(v => (
          <button
            key={String(v)}
            onClick={() => onChange(v)}
            style={{
              padding: '7px 18px',
              border: 'none',
              background: checked === v ? ORANGE : 'var(--surf-bg-2)',
              color: checked === v ? '#fff' : 'var(--t-muted)',
              fontFamily: 'var(--font-h2)',
              fontSize: 11,
              letterSpacing: '1px',
              cursor: 'pointer',
              transition: 'background .12s, color .12s',
            }}
          >
            {v ? 'Won' : 'Lost'}
          </button>
        ))}
      </div>
    </div>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{
      fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px',
      textTransform: 'uppercase', color: ORANGE, opacity: 0.8,
      marginBottom: 12, marginTop: 0,
    }}>
      {children}
    </div>
  );
}

function IconAdd() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2 3.5h9M5 3.5V2.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M3.5 3.5l.5 7a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5l.5-7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

// ─── Live Rankings (Club / College) ─────────────────────────────────────────
const TH_STYLE = {
  padding: '10px 16px',
  textAlign: 'left',
  fontFamily: 'var(--font-h2)',
  fontSize: 9,
  letterSpacing: '1.5px',
  textTransform: 'uppercase',
  color: 'var(--t-muted)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--surf-border)',
};

function LiveRankingsTab({ division }) {
  const [optStatus,    setOptStatus]   = useState('loading');
  const [options,      setOptions]     = useState(null);
  const [year,         setYear]        = useState(null);
  const [gender,       setGender]      = useState(null);
  const [gamesStatus,  setGamesStatus] = useState('idle');
  const [gamesData,    setGamesData]   = useState(null);
  const [search,       setSearch]      = useState('');

  // Fetch options on mount / division change
  useEffect(() => {
    setOptStatus('loading');
    setOptions(null);
    setYear(null);
    setGender(null);
    setGamesData(null);
    setGamesStatus('idle');
    fetch(`/api/usau/rankings/options?division=${division}`)
      .then(r => r.json())
      .then(d => {
        setOptions(d);
        setOptStatus('ready');
        if (d.years.length > 0) {
          const y = d.years[0];
          setYear(y);
          const gs = d.genders[String(y)] ?? [];
          setGender(gs[0] ?? null);
        }
      })
      .catch(() => setOptStatus('error'));
  }, [division]);

  // Fetch games when year / gender change
  useEffect(() => {
    if (!year || !gender) return;
    setGamesStatus('loading');
    setGamesData(null);
    fetch(`/api/usau/rankings/games?division=${division}&year=${year}&gender=${encodeURIComponent(gender)}`)
      .then(r => r.json())
      .then(d => { setGamesData(d); setGamesStatus('ready'); })
      .catch(() => setGamesStatus('error'));
  }, [division, year, gender]);

  // Compute standings
  const { standings, gameCount } = useMemo(() => {
    if (!gamesData || gamesData.games.length === 0) return { standings: [], gameCount: 0 };
    const { ratings } = computeSeasonRatingsDetailed(gamesData.games, new Date(gamesData.seasonYear, 0, 1), gamesData.lastRegularWeek, 220);
    const stats = {};
    gamesData.games.forEach(g => {
      (stats[g.winnerTeam] ??= { w: 0, l: 0, gp: 0 }).w++;
      stats[g.winnerTeam].gp++;
      (stats[g.loserTeam] ??= { w: 0, l: 0, gp: 0 }).l++;
      stats[g.loserTeam].gp++;
    });
    const rows = Object.entries(ratings)
      .map(([team, rating]) => ({ team, rating: +rating.toFixed(3), ...(stats[team] ?? { w: 0, l: 0, gp: 0 }) }))
      .sort((a, b) => b.rating - a.rating);
    return { standings: rows, gameCount: gamesData.games.length };
  }, [gamesData]);

  const filtered = useMemo(() => {
    if (!search.trim()) return standings;
    const q = search.toLowerCase();
    return standings.filter(r => r.team.toLowerCase().includes(q));
  }, [standings, search]);

  const availableGenders = options ? (options.genders[String(year)] ?? []) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Controls */}
      <div style={{ ...SURF_CARD, display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label style={LABEL}>Season</label>
          <select value={year ?? ''}
            onChange={e => {
              const y = Number(e.target.value);
              setYear(y);
              const gs = options?.genders[String(y)] ?? [];
              setGender(gs[0] ?? null);
            }}
            disabled={optStatus !== 'ready'}
            style={{ ...INPUT_STYLE, width: 100, cursor: 'pointer' }}
          >
            {(options?.years ?? []).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div>
          <label style={LABEL}>Division</label>
          <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: '1px solid var(--surf-border)' }}>
            {(availableGenders.length ? availableGenders : ['Men', 'Women', 'Mixed']).map(g => (
              <button key={g} onClick={() => setGender(g)} style={{
                padding: '7px 16px', border: 'none',
                background: gender === g ? ORANGE : 'var(--surf-bg-2)',
                color: gender === g ? '#fff' : 'var(--t-muted)',
                fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '1px',
                cursor: 'pointer', transition: 'background .12s',
              }}>{g}</button>
            ))}
          </div>
        </div>

        <div style={{ marginLeft: 'auto' }}>
          <label style={LABEL}>Filter teams</label>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search team name…"
            style={{ ...INPUT_STYLE, width: 220 }} />
        </div>

        {gamesStatus === 'loading' && (
          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: ORANGE, alignSelf: 'center' }}>Loading…</span>
        )}
        {gamesData && gamesStatus === 'ready' && (
          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)', alignSelf: 'center' }}>
            {gameCount.toLocaleString()} games · {standings.length} teams · reg wk {gamesData.lastRegularWeek}
          </span>
        )}
      </div>

      {gamesStatus === 'error' && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: ORANGE, fontFamily: 'var(--font-body)', fontSize: 13 }}>Could not load game data.</div>
      )}
      {gamesStatus === 'loading' && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase' }}>Loading game data…</div>
      )}
      {gamesStatus === 'ready' && gamesData.games.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase' }}>No game results found for {gender} {year}.</div>
      )}

      {gamesStatus === 'ready' && filtered.length > 0 && (
        <div className="orange-scroll" style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: 'var(--font-h2)', fontSize: 12 }}>
            <thead>
              <tr>{['Rank', 'Team', 'Rating', 'W', 'L', 'GP'].map(h => <th key={h} style={TH_STYLE}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const rank = standings.indexOf(row) + 1;
                return (
                  <tr key={row.team} style={{ background: i % 2 === 0 ? 'var(--surf-bg)' : 'var(--surf-bg-2)', borderBottom: '1px solid var(--surf-border)' }}>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-h1)', fontWeight: rank <= 3 ? 700 : 400, color: rank <= 3 ? ORANGE : 'var(--t-muted)', fontSize: rank <= 3 ? '1.05rem' : '0.95rem' }}>{rank}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--t-primary)', fontWeight: 600 }}>{row.team}</td>
                    <td style={{ padding: '10px 16px', fontFamily: 'var(--font-h1)', fontWeight: 700, color: ORANGE }}>{row.rating.toFixed(3)}</td>
                    <td style={{ padding: '10px 16px', color: '#22c55e', fontWeight: 600 }}>{row.w}</td>
                    <td style={{ padding: '10px 16px', color: '#ef4444', fontWeight: 600 }}>{row.l}</td>
                    <td style={{ padding: '10px 16px', color: 'var(--t-muted)' }}>{row.gp}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {gamesStatus === 'ready' && standings.length > 0 && (
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)', lineHeight: 1.6 }}>
          Ratings computed via USAU Rankings Algorithm v2.0 — 50-iteration convergence, with score weight, date weight, and blowout-ignore rule.
        </div>
      )}
    </div>
  );
}

// ─── Tab 3: Game Calculator ───────────────────────────────────────────────────
function GameCalculator() {
  const [winnerScore, setWinnerScore] = useState(15);
  const [loserScore,  setLoserScore]  = useState(8);
  const [oppRating,   setOppRating]   = useState(1000);
  const [won,         setWon]         = useState(true);

  // Swap scores so winner > loser when toggling perspective
  const actualWinner = won ? winnerScore : loserScore;
  const actualLoser  = won ? loserScore  : winnerScore;

  const valid = actualWinner > actualLoser && actualLoser >= 0;
  const x          = valid ? computeX(actualWinner, actualLoser)              : null;
  const scoreWeight = valid ? computeScoreWeight(actualWinner, actualLoser)   : null;
  const gameRating  = valid && x != null ? computeGameRating(won, oppRating, x) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 780 }}>
      <div>
        <SectionHeader>Inputs</SectionHeader>
        <div style={{ ...SURF_CARD }}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <NumInput label="Winner Score" value={winnerScore} onChange={setWinnerScore} min={1} width={110} />
            <NumInput label="Loser Score"  value={loserScore}  onChange={setLoserScore}  min={0} width={110} />
            <NumInput label="Opponent Rating" value={oppRating} onChange={setOppRating} min={0} max={2500} width={140} />
            <Toggle label="Your Result" checked={won} onChange={setWon} />
          </div>
        </div>
      </div>

      {!valid && (
        <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: ORANGE, opacity: 0.8 }}>
          Winner score must be greater than loser score.
        </div>
      )}

      {valid && (
        <div>
          <SectionHeader>Results</SectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <StatCard
              label="Rating Differential (x)"
              value={x}
              sub="clamped to [125, 600]"
              color={ORANGE}
            />
            <StatCard
              label="Score Weight"
              value={scoreWeight?.toFixed(4)}
              sub={`${actualWinner + actualLoser} total pts · W≥13 or total≥19 → 1.0`}
            />
            <StatCard
              label="Game Rating Earned"
              value={gameRating != null ? Math.round(gameRating) : '—'}
              sub={`Opp: ${oppRating} ${won ? '+' : '−'} ${x}`}
              color={gameRating != null && gameRating >= oppRating ? '#22c55e' : '#ef4444'}
            />
          </div>
        </div>
      )}

      <div>
        <SectionHeader>Reference — Score Differential Table</SectionHeader>
        <div className="orange-scroll" style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-h2)', minWidth: 500 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                {['Winner', 'Loser', 'x (differential)', 'Score Weight'].map(h => (
                  <th key={h} style={{ padding: '8px 14px', textAlign: 'left', color: 'var(--t-muted)', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', fontSize: 9 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                [15,2],[15,4],[15,6],[15,8],[15,10],[15,12],[15,14],
                [13,5],[13,8],[13,10],[13,12],
                [11,7],[11,9],[11,10],
                [9,6],[9,7],[9,8],
              ].map(([w,l], i) => {
                let xVal, sw;
                try { xVal = computeX(w, l); sw = computeScoreWeight(w, l); } catch { return null; }
                const isActive = w === actualWinner && l === actualLoser;
                return (
                  <tr key={i} style={{
                    background: isActive ? 'rgba(234,96,32,0.10)' : i % 2 === 0 ? 'var(--surf-bg)' : 'var(--surf-bg-2)',
                    borderBottom: '1px solid var(--surf-border)',
                  }}>
                    <td style={{ padding: '7px 14px', color: 'var(--t-primary)' }}>{w}</td>
                    <td style={{ padding: '7px 14px', color: 'var(--t-primary)' }}>{l}</td>
                    <td style={{ padding: '7px 14px', color: isActive ? ORANGE : 'var(--t-primary)', fontWeight: isActive ? 700 : 400 }}>{xVal}</td>
                    <td style={{ padding: '7px 14px', color: 'var(--t-muted)' }}>{sw.toFixed(4)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Tab 2: Team Rating Calculator ───────────────────────────────────────────
function newGame() {
  return {
    id: crypto.randomUUID(),
    won: true,
    oppName: '',
    myScore: 15,
    oppScore: 8,
    weekIndex: 0,
    oppRating: 1000,
  };
}

function TeamRatingCalculator() {
  const [lastRegularWeek, setLastRegularWeek] = useState(13);
  const [games, setGames] = useState(() => [newGame()]);

  function updateGame(id, field, value) {
    setGames(prev => prev.map(g => g.id === id ? { ...g, [field]: value } : g));
  }

  function removeGame(id) {
    setGames(prev => prev.filter(g => g.id !== id));
  }

  const { rating, gameBreakdowns } = useMemo(() => {
    const valid = games.filter(g => {
      const w = g.won ? g.myScore : g.oppScore;
      const l = g.won ? g.oppScore : g.myScore;
      return w > l && l >= 0;
    });
    if (valid.length === 0) return { rating: 1000, gameBreakdowns: [] };
    return computeTeamRating(games, lastRegularWeek);
  }, [games, lastRegularWeek]);

  const wins   = games.filter(g => g.won).length;
  const losses = games.filter(g => !g.won).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Config */}
      <div style={{ ...SURF_CARD, display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <NumInput label="Last Regular Week" value={lastRegularWeek} onChange={setLastRegularWeek} min={1} max={52} width={140} />
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ textAlign: 'center' }}>
            <span style={LABEL}>Wins</span>
            <span style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: '1.4rem', color: '#22c55e' }}>{wins}</span>
          </div>
          <div style={{ textAlign: 'center' }}>
            <span style={LABEL}>Losses</span>
            <span style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: '1.4rem', color: '#ef4444' }}>{losses}</span>
          </div>
          <div style={{ textAlign: 'center' }}>
            <span style={LABEL}>Rating</span>
            <span style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: '1.4rem', color: ORANGE }}>{Math.round(rating)}</span>
          </div>
        </div>
      </div>

      {/* Game List */}
      <div>
        <SectionHeader>Game Log</SectionHeader>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {games.map((g, i) => {
            const bd = gameBreakdowns.find(b => b.id === g.id);
            const hasResult = bd?.valid;
            return (
              <div key={g.id} style={{
                ...SURF_CARD,
                padding: '12px 16px',
                opacity: bd?.ignored ? 0.55 : 1,
                borderColor: bd?.ignored ? 'var(--surf-border)' : hasResult ? 'var(--surf-border)' : 'var(--surf-border)',
              }}>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <span style={{ ...LABEL, marginBottom: 0, alignSelf: 'center', minWidth: 20, textAlign: 'right', color: 'var(--t-muted)' }}>{i + 1}</span>
                  <Toggle label="Result" checked={g.won} onChange={v => updateGame(g.id, 'won', v)} />
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <label style={LABEL}>Opponent</label>
                    <input
                      type="text"
                      value={g.oppName}
                      onChange={e => updateGame(g.id, 'oppName', e.target.value)}
                      placeholder="Opponent name"
                      style={{ ...INPUT_STYLE }}
                    />
                  </div>
                  <NumInput label="My Score"  value={g.myScore}  onChange={v => updateGame(g.id, 'myScore', v)}  min={0} width={80} />
                  <NumInput label="Opp Score" value={g.oppScore} onChange={v => updateGame(g.id, 'oppScore', v)} min={0} width={80} />
                  <NumInput label="Week (0-based)" value={g.weekIndex} onChange={v => updateGame(g.id, 'weekIndex', Math.min(v, lastRegularWeek - 1))} min={0} max={lastRegularWeek - 1} width={100} />
                  <NumInput label="Opp Rating" value={g.oppRating} onChange={v => updateGame(g.id, 'oppRating', v)} min={0} max={2500} width={100} />
                  {bd?.valid && (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)' }}>
                        x={bd.x} · sw={bd.scoreWeight.toFixed(3)} · dw={bd.dateWeight.toFixed(3)} · gr=<span style={{ color: bd.gameRating >= g.oppRating ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{Math.round(bd.gameRating)}</span>
                        {bd.ignored && <span style={{ color: ORANGE, marginLeft: 6 }}>⊘ ignored (blowout)</span>}
                      </span>
                    </div>
                  )}
                  <button
                    onClick={() => removeGame(g.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-muted)', padding: '4px 6px', borderRadius: 4, display: 'flex', alignItems: 'center' }}
                    title="Remove game"
                  >
                    <IconTrash />
                  </button>
                </div>
              </div>
            );
          })}
          <button
            onClick={() => setGames(prev => [...prev, newGame()])}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 16px', borderRadius: 8,
              border: `1px dashed ${ORANGE}88`,
              background: 'transparent', color: ORANGE,
              fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '1px',
              cursor: 'pointer', transition: 'background .12s',
              width: 'fit-content',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(234,96,32,0.07)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <IconAdd /> Add Game
          </button>
        </div>
      </div>

      {/* Breakdown Table */}
      {gameBreakdowns.some(b => b.valid) && (
        <div>
          <SectionHeader>Per-Game Breakdown</SectionHeader>
          <div className="orange-scroll" style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-h2)', width: '100%' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                  {['#', 'Opp', 'Score', 'Opp Rating', 'x', 'Game Rating', 'Score Wt', 'Date Wt', 'Combined Wt', ''].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--t-muted)', letterSpacing: '1px', textTransform: 'uppercase', fontSize: 9, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {games.map((g, i) => {
                  const bd = gameBreakdowns.find(b => b.id === g.id);
                  if (!bd?.valid) return null;
                  return (
                    <tr key={g.id} style={{
                      background: bd.ignored ? 'rgba(234,96,32,0.04)' : i % 2 === 0 ? 'var(--surf-bg)' : 'var(--surf-bg-2)',
                      borderBottom: '1px solid var(--surf-border)',
                      opacity: bd.ignored ? 0.55 : 1,
                    }}>
                      <td style={{ padding: '7px 12px', color: 'var(--t-muted)' }}>{i + 1}</td>
                      <td style={{ padding: '7px 12px', color: 'var(--t-primary)' }}>{g.oppName || '—'}</td>
                      <td style={{ padding: '7px 12px', color: g.won ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                        {g.won ? `W ${g.myScore}–${g.oppScore}` : `L ${g.myScore}–${g.oppScore}`}
                      </td>
                      <td style={{ padding: '7px 12px', color: 'var(--t-primary)' }}>{g.oppRating}</td>
                      <td style={{ padding: '7px 12px', color: ORANGE, fontWeight: 600 }}>{bd.x}</td>
                      <td style={{ padding: '7px 12px', color: bd.gameRating >= g.oppRating ? '#22c55e' : '#ef4444', fontWeight: 600 }}>{Math.round(bd.gameRating)}</td>
                      <td style={{ padding: '7px 12px', color: 'var(--t-primary)' }}>{bd.scoreWeight.toFixed(4)}</td>
                      <td style={{ padding: '7px 12px', color: 'var(--t-primary)' }}>{bd.dateWeight.toFixed(4)}</td>
                      <td style={{ padding: '7px 12px', color: 'var(--t-primary)' }}>{bd.weight.toFixed(4)}</td>
                      <td style={{ padding: '7px 12px', color: ORANGE, fontSize: 10 }}>{bd.ignored ? '⊘ blowout' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab 3: Season Rankings Table ─────────────────────────────────────────────
const SEASON_INIT = [
  { id: crypto.randomUUID(), winnerTeam: 'Team A', loserTeam: 'Team B', winnerScore: 15, loserScore: 8,  weekIndex: 0 },
  { id: crypto.randomUUID(), winnerTeam: 'Team C', loserTeam: 'Team A', winnerScore: 13, loserScore: 11, weekIndex: 1 },
  { id: crypto.randomUUID(), winnerTeam: 'Team B', loserTeam: 'Team C', winnerScore: 15, loserScore: 6,  weekIndex: 2 },
];

function seasonReducer(state, action) {
  switch (action.type) {
    case 'ADD':
      return [...state, {
        id: crypto.randomUUID(),
        winnerTeam: '', loserTeam: '',
        winnerScore: 15, loserScore: 8,
        weekIndex: 0,
      }];
    case 'UPDATE':
      return state.map(g => g.id === action.id ? { ...g, [action.field]: action.value } : g);
    case 'REMOVE':
      return state.filter(g => g.id !== action.id);
    case 'IMPORT':
      return action.games;
    case 'CLEAR':
      return [];
    default:
      return state;
  }
}

function SeasonRankingsTable() {
  const [lastRegularWeek, setLastRegularWeek] = useState(10);
  const [games, dispatch] = useReducer(seasonReducer, SEASON_INIT);
  const [view, setView] = useState('rankings'); // 'rankings' | 'gamelog'
  const fileRef = useRef(null);

  const validGames = games.filter(g =>
    g.winnerTeam.trim() && g.loserTeam.trim() &&
    g.winnerScore > g.loserScore && g.loserScore >= 0,
  );

  const { ratings, ignored } = useMemo(() => {
    if (validGames.length === 0) return { ratings: {}, ignored: new Set() };
    // Convert 0-based weekIndex to fake ISO dates (weekIndex 0 = Jan 1 of 2026)
    const seasonStart = new Date(2026, 0, 1);
    const fakeDated = validGames.map(g => ({
      ...g,
      gameDate: new Date(2026, 0, 1 + g.weekIndex * 7).toISOString(),
    }));
    return computeSeasonRatingsDetailed(fakeDated, seasonStart, lastRegularWeek);
  }, [validGames, lastRegularWeek]);

  // Build standings
  const standings = useMemo(() => {
    const teamStats = {};
    const ensureTeam = t => {
      if (!teamStats[t]) teamStats[t] = { wins: 0, losses: 0, games: 0 };
    };
    validGames.forEach(g => {
      ensureTeam(g.winnerTeam);
      ensureTeam(g.loserTeam);
      teamStats[g.winnerTeam].wins++;
      teamStats[g.winnerTeam].games++;
      teamStats[g.loserTeam].losses++;
      teamStats[g.loserTeam].games++;
    });
    return Object.entries(ratings)
      .map(([team, rating]) => ({
        team,
        rating: Math.round(rating),
        wins:   teamStats[team]?.wins   ?? 0,
        losses: teamStats[team]?.losses ?? 0,
        games:  teamStats[team]?.games  ?? 0,
      }))
      .sort((a, b) => b.rating - a.rating);
  }, [ratings, validGames]);

  function handleExport() {
    const blob = new Blob([JSON.stringify({ lastRegularWeek, games }, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'usau_season.json'; a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (Array.isArray(data.games)) dispatch({ type: 'IMPORT', games: data.games });
        if (typeof data.lastRegularWeek === 'number') setLastRegularWeek(data.lastRegularWeek);
        else if (typeof data.totalWeeks === 'number') setLastRegularWeek(data.totalWeeks); // compat
      } catch {}
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Config bar */}
      <div style={{ ...SURF_CARD, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <NumInput label="Last Regular Week" value={lastRegularWeek} onChange={setLastRegularWeek} min={1} max={52} width={140} />
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginLeft: 'auto' }}>
          {/* View toggle */}
          <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: '1px solid var(--surf-border)' }}>
            {[['rankings', 'Rankings'], ['gamelog', 'Game Log']].map(([v, l]) => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '7px 16px', border: 'none',
                background: view === v ? ORANGE : 'var(--surf-bg-2)',
                color: view === v ? '#fff' : 'var(--t-muted)',
                fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '1px',
                cursor: 'pointer', transition: 'background .12s',
              }}>{l}</button>
            ))}
          </div>
          <button onClick={handleExport} style={{
            padding: '7px 14px', borderRadius: 7, border: '1px solid var(--surf-border)',
            background: 'var(--surf-bg-2)', color: 'var(--t-muted)',
            fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '1px', cursor: 'pointer',
            transition: 'color .12s',
          }}
            onMouseEnter={e => e.currentTarget.style.color = ORANGE}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--t-muted)'}
          >Export JSON</button>
          <button onClick={() => fileRef.current?.click()} style={{
            padding: '7px 14px', borderRadius: 7, border: '1px solid var(--surf-border)',
            background: 'var(--surf-bg-2)', color: 'var(--t-muted)',
            fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '1px', cursor: 'pointer',
            transition: 'color .12s',
          }}
            onMouseEnter={e => e.currentTarget.style.color = ORANGE}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--t-muted)'}
          >Import JSON</button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleImport} />
          <button onClick={() => dispatch({ type: 'CLEAR' })} style={{
            padding: '7px 14px', borderRadius: 7, border: '1px solid rgba(239,68,68,0.3)',
            background: 'var(--surf-bg-2)', color: '#ef4444',
            fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '1px', cursor: 'pointer',
            opacity: 0.7, transition: 'opacity .12s',
          }}
            onMouseEnter={e => e.currentTarget.style.opacity = 1}
            onMouseLeave={e => e.currentTarget.style.opacity = 0.7}
          >Clear All</button>
        </div>
      </div>

      {/* Rankings view */}
      {view === 'rankings' && (
        <div>
          <SectionHeader>Standings — {standings.length} team{standings.length !== 1 ? 's' : ''}</SectionHeader>
          {standings.length === 0 ? (
            <div style={{ ...SURF_CARD, color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, textAlign: 'center', padding: '32px 20px' }}>
              Add games in the Game Log tab to compute rankings.
            </div>
          ) : (
            <div className="orange-scroll" style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-h2)', width: '100%' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                    {['Rank', 'Team', 'Rating', 'W', 'L', 'GP'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', color: 'var(--t-muted)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {standings.map((row, i) => (
                    <tr key={row.team} style={{
                      background: i % 2 === 0 ? 'var(--surf-bg)' : 'var(--surf-bg-2)',
                      borderBottom: '1px solid var(--surf-border)',
                    }}>
                      <td style={{ padding: '10px 16px', color: i < 3 ? ORANGE : 'var(--t-muted)', fontWeight: i < 3 ? 700 : 400, fontFamily: 'var(--font-h1)' }}>{i + 1}</td>
                      <td style={{ padding: '10px 16px', color: 'var(--t-primary)', fontWeight: 600 }}>{row.team}</td>
                      <td style={{ padding: '10px 16px', color: ORANGE, fontWeight: 700, fontFamily: 'var(--font-h1)' }}>{row.rating}</td>
                      <td style={{ padding: '10px 16px', color: '#22c55e', fontWeight: 600 }}>{row.wins}</td>
                      <td style={{ padding: '10px 16px', color: '#ef4444', fontWeight: 600 }}>{row.losses}</td>
                      <td style={{ padding: '10px 16px', color: 'var(--t-muted)' }}>{row.games}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Game Log view */}
      {view === 'gamelog' && (
        <div>
          <SectionHeader>Game Log — {games.length} game{games.length !== 1 ? 's' : ''}</SectionHeader>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {games.map((g, i) => {
              const isIgnored = ignored.has(g.id);
              const isValid   = g.winnerTeam.trim() && g.loserTeam.trim() && g.winnerScore > g.loserScore;
              return (
                <div key={g.id} style={{
                  ...SURF_CARD,
                  padding: '12px 16px',
                  opacity: isIgnored ? 0.55 : 1,
                  position: 'relative',
                }}>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <span style={{ ...LABEL, marginBottom: 0, alignSelf: 'center', minWidth: 20, textAlign: 'right', color: 'var(--t-muted)' }}>{i + 1}</span>
                    <div style={{ flex: '1 1 130px' }}>
                      <label style={LABEL}>Winner Team</label>
                      <input type="text" value={g.winnerTeam} onChange={e => dispatch({ type: 'UPDATE', id: g.id, field: 'winnerTeam', value: e.target.value })} placeholder="Winner" style={{ ...INPUT_STYLE }} />
                    </div>
                    <NumInput label="Winner Score" value={g.winnerScore} onChange={v => dispatch({ type: 'UPDATE', id: g.id, field: 'winnerScore', value: v })} min={1} width={90} />
                    <div style={{ flex: '1 1 130px' }}>
                      <label style={LABEL}>Loser Team</label>
                      <input type="text" value={g.loserTeam} onChange={e => dispatch({ type: 'UPDATE', id: g.id, field: 'loserTeam', value: e.target.value })} placeholder="Loser" style={{ ...INPUT_STYLE }} />
                    </div>
                    <NumInput label="Loser Score" value={g.loserScore} onChange={v => dispatch({ type: 'UPDATE', id: g.id, field: 'loserScore', value: v })} min={0} width={90} />
                    <NumInput label="Week (0-based)" value={g.weekIndex} onChange={v => dispatch({ type: 'UPDATE', id: g.id, field: 'weekIndex', value: Math.min(v, lastRegularWeek - 1) })} min={0} max={lastRegularWeek - 1} width={100} />
                    {!isValid && g.winnerTeam && g.loserTeam && (
                      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: '#ef4444', alignSelf: 'center' }}>Winner score must exceed loser score</span>
                    )}
                    {isIgnored && (
                      <span
                        title="Ignored: winner is rated 600+ pts higher, won by more than 2×+1 points, and has 5+ other results"
                        style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: ORANGE, alignSelf: 'center', cursor: 'help' }}
                      >⊘ ignored (blowout)</span>
                    )}
                    <button onClick={() => dispatch({ type: 'REMOVE', id: g.id })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--t-muted)', padding: '4px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', marginLeft: 'auto' }} title="Remove">
                      <IconTrash />
                    </button>
                  </div>
                </div>
              );
            })}
            <button
              onClick={() => dispatch({ type: 'ADD' })}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 16px', borderRadius: 8,
                border: `1px dashed ${ORANGE}88`,
                background: 'transparent', color: ORANGE,
                fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '1px',
                cursor: 'pointer', transition: 'background .12s',
                width: 'fit-content',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(234,96,32,0.07)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <IconAdd /> Add Game
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
const TOOLS = [
  { key: 'club',    label: 'Club',            sub: 'Club division — live season standings' },
  { key: 'college', label: 'College',          sub: 'College division — live season standings' },
  { key: 'game',    label: 'Game Calculator',  sub: 'Single-game differential' },
  { key: 'team',    label: 'Team Rating',      sub: 'Season rating for one team' },
];

export default function USAURankingsPage() {
  const [activeTab, setActiveTab] = useState('club');

  return (
    <LeagueShell league="usau">
        {/* ── Header ── */}
        <div style={{ padding: '28px 32px 0', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: ORANGE, opacity: 0.7, marginBottom: 6 }}>
            USA Ultimate
          </div>
          <h1 style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: 'clamp(1.5rem, 2.5vw, 2rem)', color: 'var(--t-primary)', margin: '0 0 4px', letterSpacing: '-0.02em', textTransform: 'uppercase', lineHeight: 1 }}>
            Rankings Calculator
          </h1>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)', margin: '0 0 20px' }}>
            USAU Rankings Algorithm v2.0 — live club & college standings from game results, plus single-game and team-rating calculators.
          </p>

          {/* Tab bar */}
          <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--nav-border)' }}>
            {TOOLS.map(t => {
              const active = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  style={{
                    padding: '12px 22px',
                    border: 'none',
                    borderBottom: active ? `2px solid ${ORANGE}` : '2px solid transparent',
                    background: 'transparent',
                    color: active ? ORANGE : 'var(--t-muted)',
                    fontFamily: 'var(--font-h2)',
                    fontSize: 11,
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    transition: 'color .12s, border-color .12s',
                    marginBottom: -1,
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--t-primary)'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--t-muted)'; }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Tab body ── */}
        <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '28px 32px 32px' }}>
          {activeTab === 'club'    && <LiveRankingsTab key="club"    division="club" />}
          {activeTab === 'college' && <LiveRankingsTab key="college" division="college" />}
          {activeTab === 'game'    && <GameCalculator />}
          {activeTab === 'team'    && <TeamRatingCalculator />}
        </div>

    </LeagueShell>
  );
}
