import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import LeagueShell from '../components/LeagueShell.jsx';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const ORANGE = '#EA6020';

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

function splitName(full) {
  if (!full) return { city: '', nick: '' };
  const parts = full.trim().split(' ');
  return { city: parts.slice(0, -1).join(' '), nick: parts[parts.length - 1] };
}

/* ── Empty state placeholder ── */
function EmptyPanel({ label }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: 0.35 }}>
      <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>{label}</div>
    </div>
  );
}

/* ── Roster table ── */
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

function RosterTable() {
  // Placeholder — no data yet
  return (
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
          <th style={{ ...TH_ROSTER, textAlign: 'center' }}>T</th>
          <th style={{ ...TH_ROSTER, textAlign: 'center' }}>B</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colSpan={6} style={{ padding: '32px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.4 }}>
            No roster data
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export default function PULGamePage() {
  const { gameId } = useParams();
  const [game,      setGame]     = useState(null);
  const [status,    setStatus]   = useState('loading');
  const [activeTab, setActiveTab] = useState('home');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetch(`/api/pul/games/${encodeURIComponent(gameId)}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => { if (!cancelled) { setGame(d); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [gameId]);

  const homeAbbr = game?.home_team_id?.replace(/^pul_/, '').replace(/_.*$/, '').toUpperCase() ?? 'HOME';
  const awayAbbr = game?.away_team_id?.replace(/^pul_/, '').replace(/_.*$/, '').toUpperCase() ?? 'AWAY';
  const home = splitName(game?.home_team);
  const away = splitName(game?.away_team);

  return (
    <LeagueShell league="pul">
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--card-bg)' }}>
        {/* ── States ── */}
        {status === 'loading' && (
          <div style={{ padding: '64px 32px', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase' }}>Loading…</div>
        )}
        {status === 'error' && (
          <div style={{ padding: '64px 32px', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>Game not found.</div>
        )}

        {status === 'ready' && game && (<>

          {/* ── Header ── */}
          {/* ── Header ── */}
          <div style={{ position: 'relative', padding: '32px 40px 60px', borderBottom: '1px solid var(--nav-border)', flexShrink: 0, overflow: 'hidden' }}>
            {/* Background logos — bleed top/bottom, show middle 85% */}
            {pulLogo(game.home_team_id) && (
              <img src={pulLogo(game.home_team_id)} alt="" aria-hidden="true" style={{
                position: 'absolute', left: '4%', top: '-42%', height: '184%', width: 'auto',
                objectFit: 'contain', objectPosition: 'center',
                opacity: 0.07, pointerEvents: 'none', userSelect: 'none',
              }} />
            )}
            {pulLogo(game.away_team_id) && (
              <img src={pulLogo(game.away_team_id)} alt="" aria-hidden="true" style={{
                position: 'absolute', right: '4%', top: '-42%', height: '184%', width: 'auto',
                objectFit: 'contain', objectPosition: 'center',
                opacity: 0.07, pointerEvents: 'none', userSelect: 'none',
              }} />
            )}

            {/* Centered metadata stack */}
            <div style={{ position: 'relative', textAlign: 'center', marginBottom: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              {game.year && <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', color: 'var(--orange)', opacity: 0.9 }}>{game.year}</div>}
              {(game.week != null || game.date) && <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>{game.week != null ? `Week ${game.week}` : ''}{game.week != null && game.date ? ' · ' : ''}{game.date ?? ''}</div>}
              {home.city && <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.7 }}>{home.city}</div>}
            </div>

            {/* Teams + score row — flex-end so nickname bottoms align with score number bottom */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-end', gap: 0 }}>
              {/* Home */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 16 }}>
                {pulLogo(game.home_team_id) && <img src={pulLogo(game.home_team_id)} alt="" style={{ width: 56, height: 56, objectFit: 'contain', flexShrink: 0 }} />}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>{home.city}</div>
                  <div style={{ fontFamily: 'var(--font-h1)', fontSize: 'clamp(1.5rem,2.8vw,2.2rem)', letterSpacing: '-0.03em', textTransform: 'uppercase', color: 'var(--t-primary)', lineHeight: 1 }}>{home.nick}</div>
                </div>
              </div>
              {/* Score */}
              <div style={{ display: 'flex', alignItems: 'center', padding: '0 32px' }}>
                <div style={{ fontFamily: 'var(--font-h1)', fontSize: 'clamp(2rem,3.5vw,3rem)', fontWeight: 700, color: 'var(--t-primary)', letterSpacing: '4px', lineHeight: 1 }}>
                  {game.home_score ?? '—'} – {game.away_score ?? '—'}
                </div>
              </div>
              {/* Away */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>{away.city}</div>
                  <div style={{ fontFamily: 'var(--font-h1)', fontSize: 'clamp(1.5rem,2.8vw,2.2rem)', letterSpacing: '-0.03em', textTransform: 'uppercase', color: 'var(--t-primary)', lineHeight: 1 }}>{away.nick}</div>
                </div>
                {pulLogo(game.away_team_id) && <img src={pulLogo(game.away_team_id)} alt="" style={{ width: 56, height: 56, objectFit: 'contain' }} />}
              </div>
            </div>
            {/* Status badge — anchored to header bottom, never affects row height */}
            <span style={{ position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)', fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '2px', textTransform: 'uppercase', padding: '4px 12px', borderRadius: 99, background: 'var(--surf-bg-2)', border: '1px solid var(--surf-border)', color: 'var(--t-muted)', whiteSpace: 'nowrap' }}>
              {game.status}
            </span>
          </div>

          {/* ── Three-panel body ── */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 0, overflow: 'hidden' }}>

            {/* ── Left column: video + box score ── */}
            <div style={{ width: '76%', minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--nav-border)' }}>

              {/* Video panel */}
              <div style={{ borderBottom: '1px solid var(--nav-border)', flexShrink: 0 }}>
                <div style={{ padding: '12px 20px 8px', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>
                  Game Film
                </div>
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

              {/* Box score panel */}
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: '12px 20px 8px', flexShrink: 0, fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>
                  Box Score
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }} className="orange-scroll">
                  <EmptyPanel label="Box Score Not Yet Available" />
                </div>
              </div>

            </div>{/* end left column */}

            {/* ── Right column: player stats ── */}
            <div style={{ width: '24%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>

              {/* Tab header */}
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--nav-border)' }}>
                {[['home', home], ['away', away]].map(([key, split]) => {
                  const active = activeTab === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setActiveTab(key)}
                      style={{
                        flex: 1,
                        padding: '14px 16px',
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
                      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.7 }}>{split.city}</span>
                      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 13, letterSpacing: '1.5px', textTransform: 'uppercase', color: active ? ORANGE : 'var(--t-muted)', fontWeight: active ? 700 : 400 }}>{split.nick}</span>
                    </button>
                  );
                })}
              </div>

              {/* Stats body */}
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ flexShrink: 0, overflow: 'auto', maxHeight: 566 }} className="orange-scroll">
                  <RosterTable teamId={activeTab === 'home' ? game.home_team_id : game.away_team_id} />
                </div>
              </div>

            </div>{/* end right column */}

          </div>{/* end three-panel body */}

        </>)}

      </div>
    </LeagueShell>
  );
}
