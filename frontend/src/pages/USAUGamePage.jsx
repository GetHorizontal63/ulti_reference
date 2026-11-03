import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import LeagueShell from '../components/LeagueShell.jsx';

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';
const ORANGE = '#EA6020';

function usauLogo(filename) {
  if (!filename) return null;
  return `${BASE}/assets/png/USAU_teams/${filename}`;
}

/* ── Empty state placeholder ── */
function EmptyPanel({ label }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: 0.35 }}>
      <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>{label}</div>
    </div>
  );
}

/* ── Score progression chart ── */
function ProgressionChart({ points, homeTeam, awayTeam }) {
  if (!points || points.length === 0) return null;
  const W = 480, H = 100, PAD = 12;
  const maxScore = Math.max(...points.map(p => Math.max(p.home, p.away)), 1);
  const n = points.length;
  const xScale = (i) => PAD + (i / (n - 1 || 1)) * (W - PAD * 2);
  const yScale = (v) => H - PAD - (v / maxScore) * (H - PAD * 2);
  const homePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(p.home).toFixed(1)}`).join(' ');
  const awayPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(p.away).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  const homeWin = last.home > last.away;
  return (
    <div style={{ padding: '0 20px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: homeWin ? ORANGE : 'var(--t-muted)' }}>{homeTeam}</span>
        <span style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: !homeWin ? ORANGE : 'var(--t-muted)' }}>{awayTeam}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={PAD} stroke="var(--surf-border)" strokeWidth="1" strokeDasharray="3,3" />
        <path d={awayPath} fill="none" stroke="var(--t-muted)" strokeWidth="1.5" strokeOpacity="0.5" />
        <path d={homePath} fill="none" stroke={ORANGE} strokeWidth="2" />
        <circle cx={xScale(n - 1)} cy={yScale(last.home)} r="3.5" fill={ORANGE} />
        <circle cx={xScale(n - 1)} cy={yScale(last.away)} r="3.5" fill="var(--t-muted)" fillOpacity="0.6" />
      </svg>
    </div>
  );
}

/* ── Win probability chart ──
   Exact race-to-15 model: P(home wins) = P(Bin(r+s-1, 0.5) >= r)
   where r = 15 - home_score, s = 15 - away_score.
   Uses ResizeObserver so the SVG fills its flex container exactly. */
const TARGET = 15;

function useTeamColor(logoUrl, fallback) {
  const [color, setColor] = React.useState(fallback);
  React.useEffect(() => {
    if (!logoUrl) { setColor(fallback); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const sz = 64;
        const canvas = document.createElement('canvas');
        canvas.width = sz; canvas.height = sz;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, sz, sz);
        const { data } = ctx.getImageData(0, 0, sz, sz);
        const freq = {};
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
          if (a < 128) continue;           // transparent
          if (r > 200 && g > 200 && b > 200) continue;  // white / near-white
          if (r + g + b < 60) continue;    // near-black
          const key = `${r >> 4},${g >> 4},${b >> 4}`;
          freq[key] = (freq[key] || 0) + 1;
        }
        const best = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
        if (best) {
          const [r, g, b] = best[0].split(',').map(n => (parseInt(n) << 4) + 8);
          setColor(`rgb(${r},${g},${b})`);
        } else {
          setColor(fallback);
        }
      } catch { setColor(fallback); }
    };
    img.onerror = () => setColor(fallback);
    img.src = logoUrl;
  }, [logoUrl, fallback]);
  return color;
}
function raceWP(r, s) {
  if (r <= 0) return 1;
  if (s <= 0) return 0;
  const total = r + s - 1;
  // Pascal's triangle row for C(total, k)
  const c = Array(total + 1).fill(0);
  c[0] = 1;
  for (let i = 0; i < total; i++)
    for (let j = Math.min(i + 1, total); j >= 1; j--)
      c[j] += c[j - 1];
  let sum = 0;
  for (let k = r; k <= total; k++) sum += c[k];
  return sum / Math.pow(2, total);
}

function WinProbabilityChart({ points, homeTeam, awayTeam, homeLogo, awayLogo }) {
  const svgRef = useRef(null);
  const [dims, setDims] = useState(null);
  const homeColor = useTeamColor(homeLogo, ORANGE);
  const awayColor = useTeamColor(awayLogo, '#888888');

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setDims({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const noData = !points || points.length < 2;

  const wpData = noData ? [] : [
    { pt: 0, wp: 0.5 },
    ...points.map(p => ({
      pt: p.point,
      wp: raceWP(TARGET - p.home, TARGET - p.away),
    })),
  ];
  const lastWp = wpData.length ? wpData[wpData.length - 1].wp : 0.5;

  const stripParens = s => (s || '').replace(/\s*\(.*\)\s*$/, '').trim();
  const homeLabel = stripParens(homeTeam);
  const awayLabel = stripParens(awayTeam);

  const LOGO_SIZE = 64;
  const PL = 0, PR = 0, PT = 8, PB = 8;
  const W = dims?.w ?? 0;
  const H = dims?.h ?? 0;
  const plotW = W - PL - PR;
  const plotH = H - PT - PB;
  const maxPt = wpData.length ? wpData[wpData.length - 1].pt : 1;
  const xS = pt => PL + (pt / (maxPt || 1)) * plotW;
  const yS = v  => PT + (1 - v) * plotH;
  const y50 = yS(0.5);

  const linePath = dims && !noData ? wpData
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${xS(d.pt).toFixed(1)},${yS(d.wp).toFixed(1)}`)
    .join(' ') : '';
  const areaPath = linePath
    ? linePath + ` L${xS(maxPt).toFixed(1)},${y50.toFixed(1)} L${xS(0).toFixed(1)},${y50.toFixed(1)} Z`
    : '';

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <svg ref={svgRef} style={{ flex: 1, width: '100%', minHeight: 0, display: 'block', overflow: 'visible' }}>
        {dims && noData && (
          <text x={W / 2} y={H / 2} textAnchor="middle" dominantBaseline="middle"
            fontFamily="var(--font-h2)" fontSize={9} fill="var(--t-muted)" opacity={0.35}
            letterSpacing="2"
          >NO DATA AVAILABLE</text>
        )}
        {dims && !noData && (<>
          <defs>
            <clipPath id="wp-above">
              <rect x={PL} y={PT} width={plotW} height={Math.max(0, y50 - PT)} />
            </clipPath>
            <clipPath id="wp-below">
              <rect x={PL} y={y50} width={plotW} height={Math.max(0, PT + plotH - y50)} />
            </clipPath>
          </defs>

          {[0.25, 0.5, 0.75].map(v => (
            <line key={v} x1={PL} y1={yS(v)} x2={W - PR} y2={yS(v)}
              stroke="var(--surf-border)"
              strokeWidth={v === 0.5 ? 1.2 : 0.6}
              strokeDasharray={v === 0.5 ? '4,3' : '2,4'}
            />
          ))}

          <path d={areaPath} fill={homeColor} fillOpacity={0.2} clipPath="url(#wp-above)" />
          <path d={areaPath} fill={awayColor} fillOpacity={0.15} clipPath="url(#wp-below)" />
          <path d={linePath} fill="none" stroke={ORANGE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={xS(maxPt)} cy={yS(lastWp)} r="3.5" fill={ORANGE} />

          {/* team logos overlapping right edge of chart */}
          {(() => {
            const half = LOGO_SIZE / 2;
            const lx = W * 0.95 - LOGO_SIZE;
            const homeY = yS(0.75) - half;
            const awayY = yS(0.25) - half;
            return (<>
              {homeLogo
                ? <image href={homeLogo} x={lx} y={homeY} width={LOGO_SIZE} height={LOGO_SIZE} preserveAspectRatio="xMidYMid meet" opacity={0.85} />
                : <text x={lx} y={homeY + half} dominantBaseline="middle" fontFamily="var(--font-h2)" fontSize={9} letterSpacing="1" fill={ORANGE} opacity={0.9}>{homeLabel}</text>
              }
              {awayLogo
                ? <image href={awayLogo} x={lx} y={awayY} width={LOGO_SIZE} height={LOGO_SIZE} preserveAspectRatio="xMidYMid meet" opacity={0.85} />
                : <text x={lx} y={awayY + half} dominantBaseline="middle" fontFamily="var(--font-h2)" fontSize={9} letterSpacing="1" fill="var(--t-muted)" opacity={0.9}>{awayLabel}</text>
              }
            </>);
          })()}


        </>)}
      </svg>
    </div>
  );
}

/* ── Box score table ── */
const COL_W = '11%';
const TH_ROSTER = {
  padding: '8px 6px',
  fontFamily: 'var(--font-h2)',
  fontSize: 8,
  letterSpacing: '1.5px',
  textTransform: 'uppercase',
  color: 'var(--t-muted)',
  borderBottom: '1px solid var(--surf-border)',
  whiteSpace: 'nowrap',
};
const TD_ROSTER = {
  padding: '9px 6px',
  fontFamily: 'var(--font-h2)',
  fontSize: 10,
  color: 'var(--t-secondary)',
  borderBottom: '1px solid var(--surf-border)',
  whiteSpace: 'nowrap',
};

function BoxScoreTable({ gameId, filterTeam = null }) {
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

  if (data === null) return (
    <div style={{ padding: '32px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.4 }}>
      Loading...
    </div>
  );

  const entries = Object.entries(data?.teams ?? {})
    .filter(([, team]) => !filterTeam || team.team_name === filterTeam);

  if (entries.length === 0) return (
    <div style={{ padding: '32px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.4 }}>
      No data
    </div>
  );

  const TF = { ...TD_ROSTER, fontWeight: 700, color: 'var(--t-primary)', borderTop: '2px solid var(--surf-border)', borderBottom: 'none', background: 'var(--card-bg)', position: 'sticky', bottom: 0 };

  return (
    <>
      {entries.map(([tid, team]) => {
        const rows = [...team.players].sort((a, b) => (b.goals + b.assists) - (a.goals + a.assists));
        const totals = rows.reduce((acc, p) => {
          acc.goals += p.goals || 0; acc.assists += p.assists || 0;
          acc.blocks += p.blocks || 0; acc.turnovers += p.turnovers || 0;
          return acc;
        }, { goals: 0, assists: 0, blocks: 0, turnovers: 0 });
        return (
          <div key={tid} style={{ marginBottom: filterTeam ? 0 : 20 }}>
            {!filterTeam && (
              <div style={{ padding: '10px 12px 4px', fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '2px', textTransform: 'uppercase', color: ORANGE }}>{team.team_name}</div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: COL_W }} />
                <col />
                <col style={{ width: COL_W }} />
                <col style={{ width: COL_W }} />
                <col style={{ width: COL_W }} />
                <col style={{ width: COL_W }} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...TH_ROSTER, textAlign: 'center' }}>#</th>
                  <th style={{ ...TH_ROSTER }}>Name</th>
                  <th style={{ ...TH_ROSTER, textAlign: 'center' }}>G</th>
                  <th style={{ ...TH_ROSTER, textAlign: 'center' }}>A</th>
                  <th style={{ ...TH_ROSTER, textAlign: 'center' }}>D</th>
                  <th style={{ ...TH_ROSTER, textAlign: 'center' }}>T</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '32px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.4 }}>
                      No data
                    </td>
                  </tr>
                ) : rows.map((p, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(234,96,32,0.03)' }}>
                    <td style={{ ...TD_ROSTER, textAlign: 'center', color: 'var(--t-muted)' }}>{p.number ?? '-'}</td>
                    <td style={{ ...TD_ROSTER, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</td>
                    <td style={{ ...TD_ROSTER, textAlign: 'center' }}>{p.goals}</td>
                    <td style={{ ...TD_ROSTER, textAlign: 'center' }}>{p.assists}</td>
                    <td style={{ ...TD_ROSTER, textAlign: 'center' }}>{p.blocks}</td>
                    <td style={{ ...TD_ROSTER, textAlign: 'center' }}>{p.turnovers}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ ...TF, textAlign: 'center', color: 'var(--t-muted)', fontSize: 8 }}>-</td>
                  <td style={{ ...TF, fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase' }}>Team Total</td>
                  <td style={{ ...TF, textAlign: 'center' }}>{totals.goals}</td>
                  <td style={{ ...TF, textAlign: 'center' }}>{totals.assists}</td>
                  <td style={{ ...TF, textAlign: 'center' }}>{totals.blocks}</td>
                  <td style={{ ...TF, textAlign: 'center' }}>{totals.turnovers}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}
    </>
  );
}

export default function USAUGamePage() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const [game,        setGame]        = useState(null);
  const [status,      setStatus]      = useState('loading');
  const [progression, setProgression] = useState(null);
  const [activeTab,   setActiveTab]   = useState('home');

  useEffect(() => {
    if (!gameId) { setStatus('error'); return; }
    let cancelled = false;
    setStatus('loading');
    fetch(`/api/usau/games/${encodeURIComponent(gameId)}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => { if (!cancelled) { setGame(d); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [gameId]);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    fetch(`/api/usau/games/${encodeURIComponent(gameId)}/progression`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setProgression(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [gameId]);

  const homeLogo = usauLogo(game?.home_logo);
  const awayLogo = usauLogo(game?.away_logo);

  // Detect if the progression table has home/away swapped vs the game record.
  // Compare the last point's scores against the authoritative game scores.
  const _lastPt = progression?.points?.[progression.points.length - 1];
  const _progSwapped = _lastPt && game && _lastPt.home !== _lastPt.away &&
    Number(_lastPt.home) === Number(game.away_score) &&
    Number(_lastPt.away) === Number(game.home_score);
  const chartHomeLogo = _progSwapped ? awayLogo : homeLogo;
  const chartAwayLogo = _progSwapped ? homeLogo : awayLogo;
  const chartHomeTeam = _progSwapped ? game?.away_team : game?.home_team;
  const chartAwayTeam = _progSwapped ? game?.home_team : game?.away_team;

  return (
    <LeagueShell league="usau">
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--card-bg)' }}>

        {status === 'loading' && (
          <div style={{ padding: '64px 32px', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase' }}>Loading...</div>
        )}
        {status === 'error' && (
          <div style={{ padding: '64px 32px', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>Game not found.</div>
        )}

        {status === 'ready' && game && (<>

          {/* Header */}
          <div style={{ position: 'relative', padding: '32px 40px 60px', borderBottom: '1px solid var(--nav-border)', flexShrink: 0, overflow: 'hidden' }}>
            <button onClick={() => navigate('/usau/games')} style={{ position: 'absolute', top: 14, left: 20, background: 'none', border: 'none', padding: 0, fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: ORANGE, opacity: 0.7, cursor: 'pointer', zIndex: 1 }}>
              &lt;- Game Center
            </button>
            {homeLogo && (
              <img src={homeLogo} alt="" aria-hidden="true" style={{
                position: 'absolute', left: '4%', top: '-42%', height: '184%', width: 'auto',
                objectFit: 'contain', objectPosition: 'center',
                opacity: 0.07, pointerEvents: 'none', userSelect: 'none',
              }} onError={e => e.currentTarget.style.display = 'none'} />
            )}
            {awayLogo && (
              <img src={awayLogo} alt="" aria-hidden="true" style={{
                position: 'absolute', right: '4%', top: '-42%', height: '184%', width: 'auto',
                objectFit: 'contain', objectPosition: 'center',
                opacity: 0.07, pointerEvents: 'none', userSelect: 'none',
              }} onError={e => e.currentTarget.style.display = 'none'} />
            )}

            <div style={{ position: 'relative', textAlign: 'center', marginBottom: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              {game.year && <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', color: 'var(--orange)', opacity: 0.9 }}>{game.year}</div>}
              {(game.level || game.date || game.round) && (
                <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>
                  {[game.level, game.date, game.round].filter(Boolean).join(' - ')}
                </div>
              )}
            </div>

            <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 0 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 16 }}>
                {homeLogo && <img src={homeLogo} alt="" style={{ width: 56, height: 56, objectFit: 'contain', flexShrink: 0 }} onError={e => e.currentTarget.style.display = 'none'} />}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontFamily: 'var(--font-h1)', fontSize: 'clamp(1.5rem,2.8vw,2.2rem)', letterSpacing: '-0.03em', textTransform: 'uppercase', color: 'var(--t-primary)', lineHeight: 1 }}>{game.home_team}</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', padding: '0 32px' }}>
                <div style={{ fontFamily: 'var(--font-h1)', fontSize: 'clamp(2rem,3.5vw,3rem)', fontWeight: 700, color: 'var(--t-primary)', letterSpacing: '4px', lineHeight: 1 }}>
                  {game.home_score ?? '-'} - {game.away_score ?? '-'}
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <div style={{ fontFamily: 'var(--font-h1)', fontSize: 'clamp(1.5rem,2.8vw,2.2rem)', letterSpacing: '-0.03em', textTransform: 'uppercase', color: 'var(--t-primary)', lineHeight: 1 }}>{game.away_team}</div>
                </div>
                {awayLogo && <img src={awayLogo} alt="" style={{ width: 56, height: 56, objectFit: 'contain' }} onError={e => e.currentTarget.style.display = 'none'} />}
              </div>
            </div>

            <span style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '2px', textTransform: 'uppercase', padding: '4px 12px', borderRadius: 99, background: 'var(--surf-bg-2)', border: '1px solid var(--surf-border)', color: 'var(--t-muted)', whiteSpace: 'nowrap' }}>
              Final
            </span>
          </div>

          {/* Three-panel body */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 0, overflow: 'hidden' }}>

            {/* Left column: game film + box score */}
            <div style={{ width: '76%', minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--nav-border)' }}>

              <div style={{ borderBottom: '1px solid var(--nav-border)', flexShrink: 0 }}>
                {game.youtube_slug ? (
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', overflow: 'hidden' }}>
                    <iframe
                      src={`https://www.youtube.com/embed/${game.youtube_slug}?autoplay=1`}
                      title="Game Film"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
                    />
                  </div>
                ) : (
                  <div style={{ width: '100%', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.35 }}>
                    <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>No Film Available</div>
                  </div>
                )}
              </div>

            </div>

            {/* Right column: per-team tabbed stats */}
            <div style={{ width: '24%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>

              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--nav-border)' }}>
                {[['home', game.home_team || 'Home'], ['away', game.away_team || 'Away']].map(([key, label]) => {
                  const active = activeTab === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      style={{
                        flex: 1,
                        padding: '14px 8px',
                        border: 'none',
                        borderBottom: active ? `2px solid ${ORANGE}` : '2px solid transparent',
                        background: 'transparent',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 2,
                        transition: 'border-color .12s',
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase', color: active ? ORANGE : 'var(--t-muted)', fontWeight: active ? 700 : 400 }}>{label}</span>
                    </button>
                  );
                })}
              </div>

              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ flexShrink: 0, overflow: 'auto', maxHeight: 500 }} className="orange-scroll">
                  <BoxScoreTable gameId={gameId} filterTeam={activeTab === 'home' ? game.home_team : game.away_team} />
                </div>
                <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid var(--nav-border)', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', inset: 0 }}>
                    <WinProbabilityChart
                      points={progression?.points || []}
                      homeTeam={chartHomeTeam}
                      awayTeam={chartAwayTeam}
                      homeLogo={chartHomeLogo}
                      awayLogo={chartAwayLogo}
                    />
                  </div>
                  <div style={{ position: 'absolute', top: 10, left: 12, fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', pointerEvents: 'none' }}>Win Probability</div>
                </div>
              </div>

            </div>

          </div>

        </>)}

      </div>
    </LeagueShell>
  );
}