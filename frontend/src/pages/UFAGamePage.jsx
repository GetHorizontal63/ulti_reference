import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import LeagueShell from '../components/LeagueShell.jsx';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const ORANGE = '#EA6020';

const _UFA_LOGO_MAP = {
  hustle:'atl_hustle', sol:'atx_sol', glory:'bos_glory', hunters:'buf_hunters',
  flyers:'car_flyers', union:'chi_union', revolution:'cin_revolution', cranes:'clb_cranes',
  express:'clt_express', apex:'col_apex', summit:'col_summit', constitution:'ct_constitution',
  legion:'dal_legion', roughnecks:'dal_roughnecks', breeze:'dc_breeze', mechanix:'det_mechanix',
  havoc:'htx_havoc', alleycats:'ind_alleycats', aviators:'la_aviators', bighorns:'lv_bighorns',
  radicals:'mad_radicals', windchill:'mn_windchill', royal:'mtl_royal', nightwatch:'nas_nightwatch',
  hammerheads:'nj_hammerheads', empire:'nyc_empire', spiders:'oak_spiders', steel:'ore_steel',
  outlaws:'ott_outlaws', phoenix:'phi_phoenix', spinners:'phi_spinners', thunderbirds:'pit_thunderbirds',
  rampage:'ri_rampage', dragons:'roc_dragons', growlers:'sd_growlers', cascades:'sea_cascades',
  lions:'slc_lions', shred:'slc_shred', cannons:'tb_cannons', rush:'tor_rush',
};
function ufaLogo(teamId, year) {
  if (!teamId) return null;
  const resolved = (teamId === 'legion' && year && Number(year) <= 2021) ? 'roughnecks' : teamId;
  const slug = _UFA_LOGO_MAP[resolved];
  return slug ? `${BASE}/assets/png/UFA_teams/${slug}.png` : null;
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

function RosterTable({ gameId, teamId }) {
  const [rows,   setRows]   = useState(null);
  const [source, setSource] = useState(null);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    fetch(`/api/ufa/games/${encodeURIComponent(gameId)}/roster`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!cancelled && d) {
          setRows(d.teams?.[teamId] || []);
          setSource(d.source);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [gameId, teamId]);

  if (rows === null) return (
    <div style={{ padding: '32px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.4 }}>
      Loading…
    </div>
  );

  const totals = rows.reduce((acc, p) => {
    acc.goals      += p.goals      || 0;
    acc.assists    += p.assists    || 0;
    acc.throwaways += p.throwaways || 0;
    acc.blocks     += p.blocks     || 0;
    return acc;
  }, { goals: 0, assists: 0, throwaways: 0, blocks: 0 });

  const TF = { ...TD_ROSTER, fontWeight: 700, color: 'var(--t-primary)', borderTop: '2px solid var(--surf-border)', borderBottom: 'none', background: 'var(--card-bg)', position: 'sticky', bottom: 0 };

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
        {rows.length === 0 ? (
          <tr>
            <td colSpan={6} style={{ padding: '32px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.4 }}>
              No roster data
            </td>
          </tr>
        ) : rows.slice(0, 15).map((p, i) => (
          <tr key={p.player_id || i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(234,96,32,0.03)' }}>
            <td style={{ ...TD_ROSTER, textAlign: 'center', color: 'var(--t-muted)' }}>{p.number ?? '—'}</td>
            <td style={{ ...TD_ROSTER, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</td>
            <td style={{ ...TD_ROSTER, textAlign: 'center' }}>{p.goals}</td>
            <td style={{ ...TD_ROSTER, textAlign: 'center' }}>{p.assists}</td>
            <td style={{ ...TD_ROSTER, textAlign: 'center' }}>{p.throwaways}</td>
            <td style={{ ...TD_ROSTER, textAlign: 'center' }}>{p.blocks}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td style={{ ...TF, textAlign: 'center', color: 'var(--t-muted)', fontSize: 8 }}>—</td>
          <td style={{ ...TF, fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase' }}>Team Total</td>
          <td style={{ ...TF, textAlign: 'center' }}>{totals.goals}</td>
          <td style={{ ...TF, textAlign: 'center' }}>{totals.assists}</td>
          <td style={{ ...TF, textAlign: 'center' }}>{totals.throwaways}</td>
          <td style={{ ...TF, textAlign: 'center' }}>{totals.blocks}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/* ── Head-to-head panel ── */
function H2HPanel({ gameId, t1Id, t2Id, t1Name, t2Name, year }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    fetch(`/api/ufa/games/${encodeURIComponent(gameId)}/h2h`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [gameId]);

  const t1Nick = splitName(t1Name).nick || t1Id;
  const t2Nick = splitName(t2Name).nick || t2Id;

  if (!data) return (
    <div style={{ padding: '20px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.4 }}>
      Loading…
    </div>
  );
  if (data.games.length === 0) return (
    <div style={{ padding: '20px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.4 }}>
      First meeting
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Pinned: section label + record overview */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ padding: '10px 12px 4px', fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.6 }}>
          Head to Head
        </div>
        {/* Record — 3-equal-column grid, dash locked to center */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', padding: '4px 12px 10px', borderBottom: '1px solid var(--surf-border)', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t1Nick}</span>
            <span style={{ fontFamily: 'var(--font-h1)', fontSize: 20, fontWeight: 700, color: 'var(--t-primary)', letterSpacing: '2px', flexShrink: 0 }}>{data.team1_wins}</span>
          </div>
          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)', opacity: 0.5, flexShrink: 0 }}>–</span>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-h1)', fontSize: 20, fontWeight: 700, color: 'var(--t-primary)', letterSpacing: '2px', flexShrink: 0 }}>{data.team2_wins}</span>
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t2Nick}</span>
          </div>
        </div>
      </div>
      {/* Scrollable game rows — newest first, 3 equal columns */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }} className="orange-scroll">
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '33%' }} />{/* year */}
            <col style={{ width: '34%' }} />{/* score */}
            <col style={{ width: '33%' }} />{/* result */}
          </colgroup>
          <tbody>
          {[...data.games].reverse().map(g => {
            const t1IsHome = g.home_team_id === t1Id;
            const t1Score  = t1IsHome ? g.home_score : g.away_score;
            const t2Score  = t1IsHome ? g.away_score : g.home_score;
            const t1Won    = g.winner === t1Id;
            const isCur    = g.game_id === gameId;
            return (
              <tr key={g.game_id} style={{
                background: isCur ? 'rgba(234,96,32,0.07)' : 'transparent',
                borderLeft: isCur ? `3px solid ${ORANGE}` : '3px solid transparent',
              }}>
                <td style={{ padding: '7px 4px 7px 12px', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px', color: 'var(--t-muted)', whiteSpace: 'nowrap', textAlign: 'left' }}>{g.year}</td>
                <td style={{ padding: '7px 4px', fontFamily: 'var(--font-h1)', fontSize: 13, color: 'var(--t-primary)', letterSpacing: '1px', textAlign: 'center', whiteSpace: 'nowrap' }}>{t1Score} – {t2Score}</td>
                <td style={{ padding: '7px 12px 7px 4px', fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1px', textTransform: 'uppercase', color: g.winner == null ? 'var(--t-muted)' : t1Won ? ORANGE : 'var(--t-muted)', opacity: g.winner == null ? 0.3 : 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right' }}>
                  {g.winner == null ? '●' : t1Won ? `${t1Nick} W` : `${t2Nick} W`}
                </td>
              </tr>
            );
          })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function UFAGamePage() {
  const { gameId } = useParams();
  const [game,      setGame]     = useState(null);
  const [status,    setStatus]   = useState('loading');
  const [activeTab, setActiveTab] = useState('home');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetch(`/api/ufa/games/${encodeURIComponent(gameId)}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => { if (!cancelled) { setGame(d); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [gameId]);

  const _teamAbbr = (id, fallback) => {
    if (!id) return fallback;
    if (id === 'legion' && game?.year && Number(game.year) <= 2021) return 'ROUGHNECKS';
    return id.replace(/^ufa_/, '').replace(/_.*$/, '').toUpperCase();
  };
  const homeAbbr = _teamAbbr(game?.home_team_id, 'HOME');
  const awayAbbr = _teamAbbr(game?.away_team_id, 'AWAY');
  const home = splitName(game?.home_team);
  const away = splitName(game?.away_team);

  return (
    <LeagueShell league="ufa">
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
            {ufaLogo(game.home_team_id, game.year) && (
              <img src={ufaLogo(game.home_team_id, game.year)} alt="" aria-hidden="true" style={{
                position: 'absolute', left: '4%', top: '-42%', height: '184%', width: 'auto',
                objectFit: 'contain', objectPosition: 'center',
                opacity: 0.07, pointerEvents: 'none', userSelect: 'none',
              }} />
            )}
            {ufaLogo(game.away_team_id, game.year) && (
              <img src={ufaLogo(game.away_team_id, game.year)} alt="" aria-hidden="true" style={{
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
                {ufaLogo(game.home_team_id, game.year) && <img src={ufaLogo(game.home_team_id, game.year)} alt="" style={{ width: 56, height: 56, objectFit: 'contain', flexShrink: 0 }} />}
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
                {ufaLogo(game.away_team_id, game.year) && <img src={ufaLogo(game.away_team_id, game.year)} alt="" style={{ width: 56, height: 56, objectFit: 'contain' }} />}
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

              {/* Stats body — roster on top, H2H below */}
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ flexShrink: 0, overflow: 'auto', maxHeight: 566 }} className="orange-scroll">
                  <RosterTable gameId={gameId} teamId={activeTab === 'home' ? game.home_team_id : game.away_team_id} />
                </div>
                <div style={{ flex: 1, minHeight: 0, borderTop: '1px solid var(--nav-border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <H2HPanel
                    gameId={gameId}
                    t1Id={game.home_team_id} t2Id={game.away_team_id}
                    t1Name={game.home_team}  t2Name={game.away_team}
                    year={game.year}
                  />
                </div>
              </div>

            </div>{/* end right column */}

          </div>{/* end three-panel body */}

        </>)}

      </div>
    </LeagueShell>
  );
}
