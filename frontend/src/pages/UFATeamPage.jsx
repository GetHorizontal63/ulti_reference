import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { OUTCOME_LIST } from '../components/ShotChart.jsx';
import LeagueShell from '../components/LeagueShell.jsx';

const BASE   = import.meta.env.BASE_URL.replace(/\/$/, '');
const ORANGE = '#EA6020';

const ABBR_PREFIX_OVERRIDE = {
  CHA: 'clt',
  VEG: 'lv',
  MIN: 'mn',
  NY:  'nyc',
};

function teamLogoSrc(abbr, slug) {
  const prefix = ABBR_PREFIX_OVERRIDE[abbr] ?? abbr.toLowerCase();
  return `${BASE}/assets/png/UFA_teams/${prefix}_${slug}.png`;
}

const TABS = [
  { key: 'overview',  label: 'Overview' },
  { key: 'seasons',   label: 'Past Seasons' },
  { key: 'records',   label: 'Team Records' },
  // { key: 'games',     label: 'Game Viewer' },
];



export default function UFATeamPage() {
  const { franchiseId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [team,        setTeam]       = useState(null);
  const [allTeams,    setAllTeams]   = useState([]);
  const [status,      setStatus]     = useState('loading');
  const VALID_TABS = new Set(['overview', 'seasons', 'records', 'games']);
  const initialTab = VALID_TABS.has(searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
  const [tab,         setTab]        = useState(initialTab);
  const [seasonYear,  setSeasonYear] = useState(null);
  const [availYears,  setAvailYears] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetch('/api/ufa/teams')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        const found = d.teams.find(t => String(t.franchise_id) === String(franchiseId));
        setAllTeams(d.teams);
        if (found) {
          setTeam(found);
          setAllTeams(d.teams);
          setStatus('ready');
          // Build available past years (all years except current)
          const fy = found.first_year ?? found.year;
          const ly = found.latest_year ?? found.year;
          const years = [];
          for (let y = ly; y >= fy; y--) years.push(y);
          const currentYear = new Date().getFullYear();
          const pastYears = years.filter(y => y < currentYear && y !== 2020);
          setAvailYears(pastYears);
          if (pastYears.length > 0) setSeasonYear(pastYears[0]);
        } else setStatus('error');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [franchiseId]);

  const logoSrc = team ? teamLogoSrc(team.team_abbreviation, team.team_slug) : null;

  return (
    <LeagueShell league="ufa">
        {/* ── States ── */}
        {status === 'loading' && (
          <div style={{ padding: '64px 32px', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase' }}>
            Loading…
          </div>
        )}
        {status === 'error' && (
          <div style={{ padding: '64px 32px', textAlign: 'center', color: ORANGE, fontSize: 13, fontFamily: 'var(--font-body)' }}>
            Team not found.
          </div>
        )}

        {/* ── Content ── */}
        {status === 'ready' && team && (
          <>
            {/* ── Hero ── */}
            <div style={{ padding: '36px 32px 24px', display: 'flex', gap: 28, alignItems: 'flex-start', position: 'relative', overflow: 'hidden' }}>
              {/* Watermark */}
              {logoSrc && (
                <img
                  src={logoSrc}
                  aria-hidden="true"
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', height: '180%', width: 'auto', opacity: 0.08, pointerEvents: 'none', zIndex: 0 }}
                  onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = `${BASE}/assets/png/UFAIcon.png`; }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1, display: 'flex', gap: 24, alignItems: 'center' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: ORANGE, opacity: 0.7, marginBottom: 4 }}>
                    {team.division} Division · {team.team_abbreviation}
                  </div>
                  <h1 style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: 'clamp(1.4rem, 3vw, 2rem)', color: 'var(--t-primary)', margin: 0, letterSpacing: '-0.02em', textTransform: 'uppercase' }}>
                    {team.team_name}
                  </h1>
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <ActiveBadge active={team.active} />
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>
                      {team.first_year && team.latest_year && team.first_year !== team.latest_year
                        ? `${team.first_year} – ${team.latest_year}`
                        : team.first_year}
                    </span>
                    {team.home_stadium && (
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>
                        · {team.home_stadium}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Tab strip ── */}
            <div style={{ padding: '0 32px', borderBottom: '1px solid var(--nav-border)', display: 'flex', alignItems: 'center', gap: 0 }}>
              {TABS.map(t => (
                <button
                  key={t.key}
                  onClick={() => { setTab(t.key); setSearchParams({ tab: t.key }, { replace: true }); }}
                  style={{
                    padding: '12px 20px',
                    background: 'none',
                    border: 'none',
                    borderBottom: tab === t.key ? `2px solid ${ORANGE}` : '2px solid transparent',
                    fontFamily: 'var(--font-h2)',
                    fontSize: 11,
                    letterSpacing: '1.2px',
                    textTransform: 'uppercase',
                    color: tab === t.key ? ORANGE : 'var(--t-muted)',
                    cursor: 'pointer',
                    transition: 'color .15s',
                    marginBottom: -1,
                  }}
                >
                  {t.label}
                </button>
              ))}
              {/* Year selector — far right, only on Past Seasons tab */}
              {availYears.length > 0 && tab === 'seasons' && (
                <div style={{ marginLeft: 'auto' }}>
                  <select
                    value={seasonYear ?? ''}
                    onChange={e => setSeasonYear(Number(e.target.value))}
                    style={{
                      background: 'var(--input-bg)',
                      border: '1px solid var(--input-border)',
                      color: 'var(--input-clr)',
                      fontFamily: 'var(--font-h2)',
                      fontSize: 11,
                      letterSpacing: '1px',
                      padding: '5px 10px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      outline: 'none',
                    }}
                  >
                    {availYears.map(y => (
                      <option key={y} value={y}>{y} Season</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* ── Tab content ── */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {tab === 'overview' && (
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 0 }} className="orange-scroll">
                  <OverviewPanel
                    franchiseId={franchiseId}
                    onYearClick={year => { setSeasonYear(year); setTab('seasons'); setSearchParams({ tab: 'seasons' }, { replace: true }); }}
                  />
                </div>
              )}
              {tab === 'records' && (
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '32px', boxSizing: 'border-box' }} className="orange-scroll">
                  <RecordsPanel franchiseId={franchiseId} teamSlug={team.team_slug} />
                </div>
              )}
              {tab === 'seasons' && (
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} className="orange-scroll">
                  <PastSeasonsPanel
                    franchiseId={franchiseId}
                    year={seasonYear}
                    teamSlug={team.team_slug}
                    currentTeamId={team.team_abbreviation}
                  />
                </div>
              )}
              {tab === 'games' && (
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                  <GameViewerPanel
                    franchiseId={franchiseId}
                    teamAbbr={team.team_abbreviation}
                    teamName={team.team_name}
                  />
                </div>
              )}
              {tab !== 'overview' && tab !== 'records' && tab !== 'seasons' && tab !== 'games' && (
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '32px', boxSizing: 'border-box' }} className="orange-scroll">
                  <ComingSoon tab={tab} />
                </div>
              )}
            </div>
          </>
        )}
    </LeagueShell>
  );
}

// ── Past Seasons ─────────────────────────────────────────────────────────────

function PastSeasonsPanel({ franchiseId, year, teamSlug, currentTeamId }) {
  const [seasons,         setSeasons]         = useState(null);
  const [roster,          setRoster]          = useState(null);
  const [status,          setStatus]          = useState('loading');
  const [selectedGameId,  setSelectedGameId]  = useState(null);
  const [selectedOpponent, setSelectedOpponent] = useState(null);

  // Fetch all seasons data once
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetch(`/api/ufa/franchise/${franchiseId}/seasons`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => { if (!cancelled) { setSeasons(d.seasons); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [franchiseId]);

  // Reset filters when year changes
  useEffect(() => { setSelectedGameId(null); setSelectedOpponent(null); }, [year]);

  // Opponent game id set — computed from seasons data so must be a useMemo (before early returns)
  const opponentGameIds = useMemo(() => {
    if (!selectedOpponent || !seasons) return null;
    const s = seasons.find(s => s.year === year);
    if (!s) return null;
    return new Set(s.games.filter(g => g.opp_slug === selectedOpponent).map(g => g.game_id));
  }, [seasons, year, selectedOpponent]);

  // Fetch roster whenever year changes
  useEffect(() => {
    if (!year) return;
    let cancelled = false;
    setRoster(null);
    fetch(`/api/ufa/franchise/${franchiseId}/roster/${year}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setRoster(d?.roster ?? []); })
      .catch(() => { if (!cancelled) setRoster([]); });
    return () => { cancelled = true; };
  }, [franchiseId, year]);

  if (status === 'loading') return (
    <div style={{ textAlign: 'center', padding: '48px 0', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>Loading…</div>
  );
  if (status === 'error') return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: ORANGE, fontFamily: 'var(--font-body)', fontSize: 13 }}>Could not load season data.</div>
  );
  if (!year || !seasons) return null;

  const season = seasons.find(s => s.year === year);
  if (!season) return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>No data for {year}.</div>
  );

  // ── Legacy layout for 2012–2019 (no shownspace throw data) ──────────────────
  if (year < 2021) {
    const thStyle = { padding: '7px 10px', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 400, textAlign: 'center', whiteSpace: 'nowrap' };
    const thL = { ...thStyle, textAlign: 'left' };
    const tdStyle = { padding: '7px 10px', fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)', textAlign: 'center', whiteSpace: 'nowrap' };
    const tdL = { ...tdStyle, textAlign: 'left' };

    // Stat leaders derived from roster
    const leaders = roster && roster.length > 0 ? (() => {
      const byGoals   = [...roster].sort((a,b) => (b.goals   ?? -1) - (a.goals   ?? -1))[0];
      const byAssists = [...roster].sort((a,b) => (b.assists ?? -1) - (a.assists ?? -1))[0];
      const byBlocks  = [...roster].sort((a,b) => (b.blocks  ?? -1) - (a.blocks  ?? -1))[0];
      const byPM      = [...roster].sort((a,b) => (b.plus_minus ?? -999) - (a.plus_minus ?? -999))[0];
      const byCmp     = [...roster.filter(p => (p.throw_attempts ?? 0) >= 20)]
                          .sort((a,b) => (b.completion_pct ?? 0) - (a.completion_pct ?? 0))[0];
      return [
        { label: 'Goals',       player: byGoals,   value: byGoals?.goals },
        { label: 'Assists',     player: byAssists, value: byAssists?.assists },
        { label: 'Blocks',      player: byBlocks,  value: byBlocks?.blocks },
        { label: '+/-',         player: byPM,      value: byPM?.plus_minus != null ? (byPM.plus_minus > 0 ? `+${byPM.plus_minus}` : byPM.plus_minus) : null },
        { label: 'Cmp%',        player: byCmp,     value: byCmp?.completion_pct != null ? `${byCmp.completion_pct}%` : null },
      ];
    })() : [];

    // Sort roster by goals desc for display
    const sortedRoster = roster ? [...roster].sort((a,b) => ((b.goals??0)+(b.assists??0)+(b.blocks??0)) - ((a.goals??0)+(a.assists??0)+(a.blocks??0))) : null;

    return (
      <div style={{ padding: '24px 32px 32px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Stat leader chips ── */}
        {leaders.length > 0 && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {leaders.map(({ label, player, value }) => (
              <div key={label} style={{ flex: '1 1 140px', minWidth: 130, border: '1px solid var(--surf-border)', borderRadius: 10, padding: '12px 16px', background: 'var(--surf-bg)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>{label} Leader</div>
                <div style={{ fontFamily: 'var(--font-h1)', fontSize: 20, fontWeight: 700, color: ORANGE, lineHeight: 1 }}>{value ?? '—'}</div>
                <div style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {player?.master_id
                    ? <Link to={`/players/${player.master_id}`} style={{ color: 'var(--t-secondary)', textDecoration: 'none' }}>{player.display_name}</Link>
                    : player?.display_name}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Main 2-column grid: [standings+schedule stacked] | [stats table] ── */}
        <div style={{ display: 'grid', gridTemplateColumns: '305px 1fr', gap: 20, alignItems: 'start' }}>

          {/* Left column: Standings + Schedule stacked */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Division Standings */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{ fontFamily: 'var(--font-h1)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)', marginBottom: 8 }}>
              {season.division ? `${season.division} Division` : 'Division'} · Standings
            </div>
            <div className="orange-scroll" style={{ border: '1px solid var(--surf-border)', borderRadius: 8, overflowY: 'auto', maxHeight: 270 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '44%' }} /><col style={{ width: '19%' }} /><col style={{ width: '19%' }} /><col style={{ width: '18%' }} />
                </colgroup>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                    {['Team','W','L','T'].map((h, i) => (
                      <th key={h} style={{ ...thStyle, textAlign: i === 0 ? 'left' : 'center', padding: '7px 12px' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {season.standings.map((row, i) => {
                    const isThisTeam = row.team_id === season.slug;
                    const rowColor = isThisTeam ? ORANGE : 'var(--t-primary)';
                    return (
                      <tr key={row.team_id} style={{ background: i % 2 === 1 ? 'var(--surf-bg-2)' : 'var(--surf-bg)', borderBottom: '1px solid var(--surf-border)' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, color: rowColor, fontWeight: isThisTeam ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.abbrev || row.team_id}</td>
                        <td style={{ ...tdStyle, color: rowColor }}>{row.wins ?? '—'}</td>
                        <td style={{ ...tdStyle, color: rowColor }}>{row.losses ?? '—'}</td>
                        <td style={{ ...tdStyle, color: rowColor }}>{row.ties ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Schedule */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{ fontFamily: 'var(--font-h1)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)', marginBottom: 8 }}>
              {year} Schedule
            </div>
            <div className="orange-scroll" style={{ border: '1px solid var(--surf-border)', borderRadius: 8, overflowY: 'auto', maxHeight: 508 }}>
              {season.games.length === 0
                ? <div style={{ padding: '24px 16px', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 12, textAlign: 'center' }}>No game results found.</div>
                : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                        <th style={{ ...thL, padding: '7px 12px' }}>Opponent</th>
                        <th style={thStyle}>Date</th>
                        <th style={thStyle}>Wk</th>
                        <th style={thStyle}>Score</th>
                        <th style={thStyle}>Record</th>
                      </tr>
                    </thead>
                    <tbody>
                      {season.games.map((g, i) => {
                        const resultColor = g.result === 'W' ? '#22c55e' : g.result === 'L' ? '#ef4444' : 'var(--t-muted)';
                        return (
                          <tr key={g.game_id} style={{ background: i % 2 === 1 ? 'var(--surf-bg-2)' : 'var(--surf-bg)', borderBottom: '1px solid var(--surf-border)' }}>
                            <td style={{ ...tdL, color: 'var(--t-primary)', padding: '8px 12px', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>{g.home ? 'vs' : '@'} {g.opponent}</td>
                            <td style={tdStyle}>{g.date ? g.date.slice(5).replace('-', '/') : '—'}</td>
                            <td style={{ ...tdStyle, color: 'var(--t-muted)' }}>{g.week ?? '—'}</td>
                            <td style={{ ...tdStyle, fontWeight: 600, color: resultColor }}>{g.team_score}–{g.opp_score}</td>
                            <td style={{ ...tdStyle, color: 'var(--t-muted)', fontSize: 10 }}>{g.record}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
              }
            </div>
          </div>

          </div>{/* end left column */}

          {/* Right: Full Stats Table */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{ fontFamily: 'var(--font-h1)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)', marginBottom: 8 }}>
              {year} Player Stats
            </div>
            <div className="orange-scroll" style={{ border: '1px solid var(--surf-border)', borderRadius: 8, overflowX: 'auto', overflowY: 'auto', maxHeight: 804 }}>
              {!sortedRoster && <div style={{ padding: '24px 16px', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '2px' }}>Loading…</div>}
              {sortedRoster && sortedRoster.length === 0 && <div style={{ padding: '24px 16px', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 12, textAlign: 'center' }}>No stats data.</div>}
              {sortedRoster && sortedRoster.length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 640 }}>
                  <colgroup>
                    <col style={{ width: 170 }} />
                    {['GP','G','A','HA','B','+/-','Cmp','Att','Cmp%','TA','Drops','Hk%'].map(h => (
                      <col key={h} style={{ width: 48 }} />
                    ))}
                  </colgroup>
                  <thead style={{ position: 'sticky', top: 0, background: 'var(--surf-bg)', zIndex: 1 }}>
                    <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                      <th style={{ ...thL, padding: '7px 12px' }}>Player</th>
                      {['GP','G','A','HA','B','+/-','Cmp','Att','Cmp%','TA','Drops','Hk%'].map(h => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRoster.map((p, i) => (
                      <tr key={p.player_id} style={{ background: i % 2 === 1 ? 'var(--surf-bg-2)' : 'var(--surf-bg)', borderBottom: '1px solid var(--surf-border)' }}>
                        <td style={{ ...tdL, color: 'var(--t-primary)', fontWeight: 600, padding: '7px 12px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {p.master_id
                            ? <Link to={`/players/${p.master_id}`} style={{ color: 'var(--t-primary)', textDecoration: 'none' }} onMouseEnter={e => e.target.style.color=ORANGE} onMouseLeave={e => e.target.style.color='var(--t-primary)'}>{p.display_name}</Link>
                            : p.display_name}
                        </td>
                        <td style={tdStyle}>{p.gp ?? '—'}</td>
                        <td style={{ ...tdStyle, color: (p.goals ?? 0) > 0 ? 'var(--t-primary)' : 'var(--t-muted)' }}>{p.goals ?? '—'}</td>
                        <td style={{ ...tdStyle, color: (p.assists ?? 0) > 0 ? 'var(--t-primary)' : 'var(--t-muted)' }}>{p.assists ?? '—'}</td>
                        <td style={tdStyle}>{p.hockey_assists ?? '—'}</td>
                        <td style={{ ...tdStyle, color: (p.blocks ?? 0) > 0 ? 'var(--t-primary)' : 'var(--t-muted)' }}>{p.blocks ?? '—'}</td>
                        <td style={{ ...tdStyle, color: p.plus_minus > 0 ? '#22c55e' : p.plus_minus < 0 ? '#ef4444' : 'var(--t-muted)' }}>
                          {p.plus_minus != null ? (p.plus_minus > 0 ? `+${p.plus_minus}` : p.plus_minus) : '—'}
                        </td>
                        <td style={tdStyle}>{p.completions ?? '—'}</td>
                        <td style={tdStyle}>{p.throw_attempts ?? '—'}</td>
                        <td style={tdStyle}>{p.completion_pct != null ? `${p.completion_pct}%` : '—'}</td>
                        <td style={{ ...tdStyle, color: (p.throwaways ?? 0) > 0 ? '#ef444488' : 'var(--t-muted)' }}>{p.throwaways ?? '—'}</td>
                        <td style={{ ...tdStyle, color: (p.drops ?? 0) > 0 ? '#ef444488' : 'var(--t-muted)' }}>{p.drops ?? '—'}</td>
                        <td style={tdStyle}>{p.huck_pct != null ? `${p.huck_pct}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

        </div>
      </div>
    );
  }

  // ── Full layout for 2021+ (shownspace data available) ───────────────────────
  return (
    <div style={{ position: 'relative', padding: 32, boxSizing: 'border-box' }}>

      {/* ── Left column: Standings + Game Log stacked ── */}
      <div style={{ position: 'absolute', left: 32, top: 32, bottom: 32, width: 260, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Division Standings */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '0 0 auto', maxHeight: '45%' }}>
          <div style={{ fontFamily: 'var(--font-h1)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)', marginBottom: 8 }}>
            {season.division ? `${season.division} Division` : 'Division'} · Final Standings
          </div>
          <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', border: '1px solid var(--surf-border)', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '40%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                  {['Team','W','L','T'].map((h, i) => (
                    <th key={h} style={{ padding: '7px 12px', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 400, textAlign: i === 0 ? 'left' : 'center' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {season.standings.map((row, i) => {
                  const isThisTeam = row.team_id === season.slug;
                  const isSelectedOpp = selectedOpponent === row.team_id;
                  const canFilter = !isThisTeam;
                  const rowColor = isSelectedOpp ? '#60a5fa' : isThisTeam ? ORANGE : 'var(--t-primary)';
                  return (
                    <tr
                      key={row.team_id}
                      onClick={() => canFilter && setSelectedOpponent(isSelectedOpp ? null : row.team_id)}
                      style={{
                        background: isSelectedOpp ? '#60a5fa22' : i % 2 === 1 ? 'var(--surf-bg-2)' : 'var(--surf-bg)',
                        borderBottom: '1px solid var(--surf-border)',
                        cursor: canFilter ? 'pointer' : 'default',
                        outline: isSelectedOpp ? '1px solid #60a5fa' : 'none',
                      }}
                    >
                      <td style={{ padding: '8px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, color: rowColor, fontWeight: isThisTeam || isSelectedOpp ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.abbrev || row.team_id}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 11, color: rowColor }}>{row.wins ?? '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 11, color: rowColor }}>{row.losses ?? '—'}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 11, color: rowColor }}>{row.ties ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Game Log */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div style={{ fontFamily: 'var(--font-h1)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)', marginBottom: 8, flexShrink: 0 }}>
            {year} Game Log
          </div>
          <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', border: '1px solid var(--surf-border)', borderRadius: 8 }}>
            {season.games.length === 0
              ? <div style={{ padding: '24px 16px', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 12, textAlign: 'center' }}>No final game results found.</div>
              : (
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '36%' }} />
                    <col style={{ width: '20%' }} />
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '22%' }} />
                  </colgroup>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                      {['Opponent','Date','Score','Record'].map((h, i) => (
                        <th key={i} style={{ padding: '7px 12px', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 400, textAlign: i === 0 ? 'left' : 'center' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {season.games.map((g, i) => {
                      const resultColor = g.result === 'W' ? '#22c55e' : g.result === 'L' ? '#ef4444' : 'var(--t-muted)';
                      const isSelected = selectedGameId === g.game_id;
                      const isOppMatch = selectedOpponent && g.opp_slug === selectedOpponent;
                      return (
                        <tr
                          key={g.game_id}
                          onClick={() => setSelectedGameId(isSelected ? null : g.game_id)}
                          style={{
                            background: isSelected ? `${ORANGE}22` : isOppMatch ? '#60a5fa11' : i % 2 === 1 ? 'var(--surf-bg-2)' : 'var(--surf-bg)',
                            borderBottom: '1px solid var(--surf-border)',
                            cursor: 'pointer',
                            outline: isSelected ? `1px solid ${ORANGE}` : isOppMatch ? '1px solid #60a5fa44' : 'none',
                          }}
                        >
                          <td style={{ padding: '8px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, color: isSelected ? ORANGE : 'var(--t-primary)', fontWeight: isSelected ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.home ? 'vs' : '@'} {g.opponent}</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)', textAlign: 'center' }}>{g.date ? g.date.slice(5).replace('-', '/') : '—'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 12, fontWeight: 600, color: resultColor }}>
                            {g.team_score}–{g.opp_score}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)' }}>{g.record}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            }
          </div>
        </div>
      </div>

      {/* ── Middle: Stat cards + throwing chart ── */}
      <div style={{ marginLeft: 284, marginRight: 284 }}>
        <TeamMiddlePanel season={season} roster={roster} year={year} teamAbbr={currentTeamId} teamSlug={teamSlug} selectedGameId={selectedGameId} opponentGameIds={opponentGameIds} />
      </div>

      {/* ── Right column: Roster ── */}
      <div style={{ position: 'absolute', right: 32, top: 32, width: 260, display: 'flex', flexDirection: 'column' }}>
        <div style={{ fontFamily: 'var(--font-h1)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)', marginBottom: 8, flexShrink: 0 }}>
          {year} Roster
        </div>
        <div className="orange-scroll" style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 392px)', border: '1px solid var(--surf-border)', borderRadius: 8 }}>
          {!roster && (
            <div style={{ padding: '24px 16px', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '2px' }}>Loading…</div>
          )}
          {roster && roster.length === 0 && (
            <div style={{ padding: '24px 16px', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 12, textAlign: 'center' }}>No roster data.</div>
          )}
          {roster && roster.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 'auto' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '13%' }} />
              </colgroup>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                  <th style={{ padding: '7px 12px', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 400, textAlign: 'left' }}>Player</th>
                  {['GP','G','A','B'].map(h => (
                    <th key={h} style={{ padding: '7px 6px', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 400, textAlign: 'center' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roster.map((p, i) => (
                  <tr key={p.player_id} style={{ background: i % 2 === 1 ? 'var(--surf-bg-2)' : 'var(--surf-bg)', borderBottom: '1px solid var(--surf-border)' }}>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.master_id
                        ? <Link to={`/players/${p.master_id}`}
                            style={{ color: 'var(--t-primary)', fontWeight: 600, textDecoration: 'none' }}
                            onMouseEnter={e => e.target.style.color = ORANGE}
                            onMouseLeave={e => e.target.style.color = 'var(--t-primary)'}
                          >{p.display_name}</Link>
                        : <span style={{ color: 'var(--t-primary)', fontWeight: 600 }}>{p.display_name}</span>
                      }
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)' }}>{p.gp ?? '—'}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)' }}>{p.goals ?? '—'}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)' }}>{p.assists ?? '—'}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)' }}>{p.blocks ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

    </div>
  );
}

// ── 2D Top-Down Field Chart ───────────────────────────────────────────────────
// SVG coordinate space: x 5–205, y 5–455 (200×450 field rect).
// End zones are 20/450 of total height = ~40px of the 450 range.
// We render the field portrait then scale to container.

const SVG_X0 = 5, SVG_Y0 = 5, SVG_W = 200, SVG_H = 450;
// Endzone lines in the UFA SVG are at absolute y=80 and y=380.
// Relative to SVG_Y0=5 that is 75 units each = 20 yards on a 120-yd field.
const EZ_H = 75;           // endzone height in SVG units
const EZ_FRAC = EZ_H / SVG_H; // ≈ 0.1667

const OUTCOME_COLOR = Object.fromEntries(OUTCOME_LIST.map(o => [o.key, o.color]));

function Field2D({ throws }) {
  // Sample down to at most 4000 arcs so the SVG stays snappy
  const sample = throws.length > 4000
    ? throws.filter((_, i) => i % Math.ceil(throws.length / 4000) === 0)
    : throws;

  const ezH = EZ_H; // 75 SVG units = 20 yards

  return (
    <svg
      viewBox={`${SVG_X0} ${SVG_Y0} ${SVG_W} ${SVG_H}`}
      style={{ width: '100%', height: '100%', display: 'block' }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id="field-clip-2d">
          <rect x={SVG_X0} y={SVG_Y0} width={SVG_W} height={SVG_H} />
        </clipPath>
      </defs>

      {/* ── Field background ── */}
      <rect x={SVG_X0} y={SVG_Y0} width={SVG_W} height={SVG_H} fill="#ffffff" />

      {/* End zones */}
      <rect x={SVG_X0} y={SVG_Y0} width={SVG_W} height={ezH} fill="#fde8d8" />
      <rect x={SVG_X0} y={SVG_Y0 + SVG_H - ezH} width={SVG_W} height={ezH} fill="#fde8d8" />

      {/* Playing field */}
      <rect x={SVG_X0} y={SVG_Y0 + ezH} width={SVG_W} height={SVG_H - 2 * ezH} fill="#f9f9f9" />

      {/* Field border */}
      <rect x={SVG_X0} y={SVG_Y0} width={SVG_W} height={SVG_H} fill="none" stroke={ORANGE} strokeWidth={1.5} />

      {/* End-zone goal lines */}
      <line x1={SVG_X0} y1={SVG_Y0 + ezH} x2={SVG_X0 + SVG_W} y2={SVG_Y0 + ezH} stroke={ORANGE} strokeWidth={1} />
      <line x1={SVG_X0} y1={SVG_Y0 + SVG_H - ezH} x2={SVG_X0 + SVG_W} y2={SVG_Y0 + SVG_H - ezH} stroke={ORANGE} strokeWidth={1} />

      {/* Mid-field line */}
      <line x1={SVG_X0} y1={SVG_Y0 + SVG_H / 2} x2={SVG_X0 + SVG_W} y2={SVG_Y0 + SVG_H / 2} stroke={ORANGE} strokeWidth={0.5} strokeDasharray="4 3" opacity={0.5} />

      {/* Throw arcs + receive dots — clipped to field rect */}
      <g clipPath="url(#field-clip-2d)">
      {sample.map((t, i) => {
        const color = OUTCOME_COLOR[t.pbp_throw_type] ?? '#999';
        const tx = t.svg_throw_x, ty = t.svg_throw_y;
        const rx = t.svg_recv_x,  ry = t.svg_recv_y;
        if (tx == null || ty == null) return null;
        // Throws with no receiver coords (throwaway, stall, callahan):
        // render an × at the thrower position.
        if (rx == null || ry == null) {
          const s = 2.2;
          return (
            <g key={i} opacity={0.7}>
              <line x1={tx-s} y1={ty-s} x2={tx+s} y2={ty+s} stroke={color} strokeWidth={1} />
              <line x1={tx+s} y1={ty-s} x2={tx-s} y2={ty+s} stroke={color} strokeWidth={1} />
            </g>
          );
        }
        return (
          <g key={i}>
            <line x1={tx} y1={ty} x2={rx} y2={ry} stroke={color} strokeWidth={0.6} opacity={0.45} />
            <circle cx={rx} cy={ry} r={1.1} fill={color} opacity={0.7} />
          </g>
        );
      })}
      </g>
    </svg>
  );
}

// ── Field Chart Helpers ─────────────────────────────────────────────────────

const GRID_COLS = 20, GRID_ROWS = 45;
const CELL_W = SVG_W / GRID_COLS;  // 10 SVG units
const CELL_H = SVG_H / GRID_ROWS;  // 10 SVG units
const COMPLETE_TYPES = new Set(['pass', 'score']);

// Builds a GRID_ROWS×GRID_COLS grid where every cell's value is the
// CUMULATIVE completion rate for endzone throws attempted from that
// y-distance-to-nearest-endzone or closer (additive, as requested).
// All columns in a given row share the same value → smooth horizontal bands.
// Thermal color ramp: blue → cyan → green → yellow → red
const JET_STOPS = [
  [0,    0,   0,   180],
  [0.25, 0,   180, 255],
  [0.5,  0,   220,   0],
  [0.75, 255, 220,   0],
  [1,    255,   0,   0],
];
function jetColor(t) {
  for (let i = 1; i < JET_STOPS.length; i++) {
    const [t0, r0, g0, b0] = JET_STOPS[i - 1];
    const [t1, r1, g1, b1] = JET_STOPS[i];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return `rgb(${Math.round(r0 + f * (r1 - r0))},${Math.round(g0 + f * (g1 - g0))},${Math.round(b0 + f * (b1 - b0))})`;
    }
  }
  return 'rgb(255,0,0)';
}
function jetRgbArr(t) {
  for (let i = 1; i < JET_STOPS.length; i++) {
    const [t0, r0, g0, b0] = JET_STOPS[i - 1];
    const [t1, r1, g1, b1] = JET_STOPS[i];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [Math.round(r0 + f*(r1-r0)), Math.round(g0 + f*(g1-g0)), Math.round(b0 + f*(b1-b0))];
    }
  }
  return [255, 0, 0];
}

function FieldLines() {
  return (
    <>
      <rect x={SVG_X0} y={SVG_Y0} width={SVG_W} height={SVG_H} fill="none" stroke={ORANGE} strokeWidth={1.5} />
      <line x1={SVG_X0} y1={SVG_Y0 + EZ_H} x2={SVG_X0 + SVG_W} y2={SVG_Y0 + EZ_H} stroke={ORANGE} strokeWidth={1} />
      <line x1={SVG_X0} y1={SVG_Y0 + SVG_H - EZ_H} x2={SVG_X0 + SVG_W} y2={SVG_Y0 + SVG_H - EZ_H} stroke={ORANGE} strokeWidth={1} />
      <line x1={SVG_X0} y1={SVG_Y0 + SVG_H / 2} x2={SVG_X0 + SVG_W} y2={SVG_Y0 + SVG_H / 2} stroke={ORANGE} strokeWidth={0.5} strokeDasharray="4 3" opacity={0.5} />
    </>
  );
}

function ReceiverHeatMap({ throws, leagueThrows }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    if (throws.length === 0 || leagueThrows.length === 0) return;

    const SIGMA = 10, KR = Math.ceil(3 * SIGMA);
    const kern = new Float32Array(2 * KR + 1);
    let ks = 0;
    for (let i = -KR; i <= KR; i++) {
      kern[i + KR] = Math.exp(-i * i / (2 * SIGMA * SIGMA));
      ks += kern[i + KR];
    }
    for (let i = 0; i < kern.length; i++) kern[i] /= ks;

    function buildDensity(throwSet) {
      const raw = new Float32Array(W * H);
      for (const t of throwSet) {
        const rx = t.svg_recv_x, ry = t.svg_recv_y;
        if (rx == null || ry == null) continue;
        const px = Math.max(0, Math.min(W - 1, Math.round((rx - SVG_X0) * W / SVG_W)));
        const py = Math.max(0, Math.min(H - 1, Math.round((ry - SVG_Y0) * H / SVG_H)));
        raw[py * W + px]++;
      }
      const tmp = new Float32Array(W * H);
      const out = new Float32Array(W * H);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let v = 0;
          for (let ki = 0; ki < kern.length; ki++)
            v += raw[y * W + Math.max(0, Math.min(W - 1, x + ki - KR))] * kern[ki];
          tmp[y * W + x] = v;
        }
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let v = 0;
          for (let ki = 0; ki < kern.length; ki++)
            v += tmp[Math.max(0, Math.min(H - 1, y + ki - KR)) * W + x] * kern[ki];
          out[y * W + x] = v;
        }
      return out;
    }

    const teamDensity   = buildDensity(throws);
    const leagueDensity = buildDensity(leagueThrows);

    const teamSum   = teamDensity.reduce((s, v) => s + v, 0) || 1;
    const leagueSum = leagueDensity.reduce((s, v) => s + v, 0) || 1;

    const MIN_LEAGUE_RAW = leagueSum / (W * H) * 0.01;
    const MIN_LEAGUE_N   = MIN_LEAGUE_RAW / leagueSum;
    const ratios = new Float32Array(W * H);
    for (let i = 0; i < ratios.length; i++) {
      const t = Math.max(teamDensity[i] / teamSum, MIN_LEAGUE_N);
      const l = Math.max(leagueDensity[i] / leagueSum, MIN_LEAGUE_N);
      ratios[i] = Math.log2(t / l);
    }

    const sorted = Array.from(ratios).sort((a, b) => a - b);
    const rLo = sorted[Math.floor(sorted.length * 0.05)];
    const rHi = sorted[Math.floor(sorted.length * 0.95)];
    const rSpan = rHi - rLo || 0.01;

    const img = ctx.createImageData(W, H);
    const d = img.data;
    for (let i = 0; i < ratios.length; i++) {
      const pi = i * 4;
      if (leagueDensity[i] < MIN_LEAGUE_RAW * 2) {
        d[pi] = 240; d[pi+1] = 240; d[pi+2] = 240; d[pi+3] = 255;
      } else {
        const t = Math.max(0, Math.min(1, (ratios[i] - rLo) / rSpan));
        const [r, g, b] = jetRgbArr(t);
        d[pi] = r; d[pi+1] = g; d[pi+2] = b; d[pi+3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [throws, leagueThrows]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} width={200} height={450}
              style={{ width: '100%', height: '100%', display: 'block' }} />
      <svg viewBox={`${SVG_X0} ${SVG_Y0} ${SVG_W} ${SVG_H}`}
           style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
           preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id="field-clip-hm"><rect x={SVG_X0} y={SVG_Y0} width={SVG_W} height={SVG_H} /></clipPath></defs>
        <g clipPath="url(#field-clip-hm)">
          <FieldLines />
        </g>
      </svg>
    </div>
  );
}

const THROW_TYPES = ['pass', 'score', 'drop', 'throwaway', 'stall', 'callahan'];

function TeamMiddlePanel({ season, roster, year, teamAbbr, teamSlug, selectedGameId, opponentGameIds }) {
  const [throwTypes,    setThrowTypes]    = useState(new Set(THROW_TYPES));
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [deepBallOnly,   setDeepBallOnly]  = useState(false);
  const [teamThrows,    setTeamThrows]    = useState([]);
  const [leagueThrows,  setLeagueThrows]  = useState([]);
  const [throwsStatus,  setThrowsStatus]  = useState('loading');

  // Reset player filter when year/team changes
  useEffect(() => { setSelectedPlayer(''); }, [year, teamAbbr]);

  useEffect(() => {
    if (!year || !teamSlug) return;
    let cancelled = false;
    setThrowsStatus('loading');
    setTeamThrows([]);
    setLeagueThrows([]);
    fetch(`/api/ufa/throws/${teamSlug}/${year}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => {
        if (cancelled) return;
        const items = d.items ?? [];
        setLeagueThrows(d.league_items ?? items);
        setTeamThrows(items);
        setThrowsStatus(items.length > 0 ? 'ready' : 'empty');
      })
      .catch(() => { if (!cancelled) setThrowsStatus('error'); });
    return () => { cancelled = true; };
  }, [year, teamSlug]);

  const playerOptions = useMemo(() => {
    const map = new Map();
    teamThrows.forEach(t => {
      if (t.thrower_id && t.thrower_name) map.set(t.thrower_id, t.thrower_name);
      if (t.receiver_id && t.receiver_name) map.set(t.receiver_id, t.receiver_name);
    });
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [teamThrows]);

  // 40 yards vertical = 40 * (450 SVG units / 120 yards) = 150 SVG units
  const DEEP_BALL_SVG = 150;

  const filteredThrows = useMemo(
    () => teamThrows.filter(t =>
      throwTypes.has(t.pbp_throw_type) &&
      (!selectedGameId || t.game_id === selectedGameId) &&
      (!opponentGameIds || opponentGameIds.has(t.game_id)) &&
      (!selectedPlayer || t.thrower_id === selectedPlayer || t.receiver_id === selectedPlayer) &&
      (!deepBallOnly || Math.abs((t.svg_recv_y ?? 0) - (t.svg_throw_y ?? 0)) >= DEEP_BALL_SVG)
    ),
    [teamThrows, throwTypes, selectedGameId, opponentGameIds, selectedPlayer, deepBallOnly],
  );

  const topScorer = useMemo(
    () => roster?.length ? [...roster].sort((a, b) => (b.goals ?? 0) - (a.goals ?? 0))[0] : null,
    [roster],
  );
  const topAssister = useMemo(
    () => roster?.length ? [...roster].sort((a, b) => (b.assists ?? 0) - (a.assists ?? 0))[0] : null,
    [roster],
  );

  const gToRatio = useMemo(() => {
    if (!teamThrows.length) return null;
    const scores = teamThrows.filter(t => t.pbp_throw_type === 'score').length;
    const turnovers = teamThrows.filter(t => ['drop','throwaway','stall','callahan'].includes(t.pbp_throw_type)).length;
    if (turnovers === 0) return null;
    return scores / turnovers;
  }, [teamThrows]);

  const scoringStats = useMemo(() => {
    const games = (season.games ?? []).filter(g => g.team_score != null && g.opp_score != null);
    if (!games.length) return null;
    const gp   = games.length;
    const pf   = games.reduce((s, g) => s + g.team_score, 0);
    const pa   = games.reduce((s, g) => s + g.opp_score,  0);
    const ppg  = pf / gp;
    const papg = pa / gp;
    const pyth = (ppg ** 2) / (ppg ** 2 + papg ** 2);
    return { ppg, papg, pyth, diff: pf - pa, gp, pf, pa };
  }, [season.games]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, flexShrink: 0 }}>
        <StatCard
          label="Most Goals"
          value={topScorer?.display_name ?? (roster ? '—' : '…')}
          sub={topScorer ? `${topScorer.goals} Goals` : undefined}
        />
        <StatCard
          label="Most Assists"
          value={topAssister?.display_name ?? (roster ? '—' : '…')}
          sub={topAssister ? `${topAssister.assists} Assists` : undefined}
        />
        <StatCard
          label="Goal / Turnover"
          value={gToRatio != null ? gToRatio.toFixed(2) : (teamThrows.length ? '—' : '…')}
          sub="Scores per turnover"
        />
        <StatCard
          label="Pythagorean W%"
          value={scoringStats ? scoringStats.pyth.toFixed(3) : '—'}
          sub={scoringStats ? `${scoringStats.pf} PF · ${scoringStats.pa} PA` : undefined}
        />
        <StatCard
          label="PPG / PAPG"
          value={scoringStats ? `${scoringStats.ppg.toFixed(1)} / ${scoringStats.papg.toFixed(1)}` : '—'}
          sub={scoringStats ? `over ${scoringStats.gp} games` : undefined}
        />
        <StatCard
          label="Point Diff"
          value={scoringStats ? `${scoringStats.diff > 0 ? '+' : ''}${scoringStats.diff}` : '—'}
          sub={scoringStats ? `${(scoringStats.diff / scoringStats.gp).toFixed(1)} per game` : undefined}
          color={scoringStats ? (scoringStats.diff > 0 ? '#22c55e' : scoringStats.diff < 0 ? '#ef4444' : undefined) : undefined}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
        <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', marginRight: 2 }}>Outcome</span>
        {OUTCOME_LIST.map(o => {
          const on = throwTypes.has(o.key);
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                const next = new Set(throwTypes);
                on ? next.delete(o.key) : next.add(o.key);
                setThrowTypes(next);
              }}
              style={{
                padding: '3px 10px',
                border: `1px solid ${on ? o.color : 'var(--surf-border)'}`,
                borderRadius: 12,
                background: on ? `${o.color}22` : 'transparent',
                color: on ? o.color : 'var(--t-muted)',
                fontFamily: 'var(--font-h2)',
                fontSize: 10,
                cursor: 'pointer',
                letterSpacing: '0.5px',
                transition: 'border-color .15s, color .15s, background .15s',
              }}
            >{o.label}</button>
          );
        })}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            onClick={() => setDeepBallOnly(v => !v)}
            style={{
              padding: '3px 10px',
              border: `1px solid ${deepBallOnly ? '#60a5fa' : 'var(--surf-border)'}`,
              borderRadius: 12,
              background: deepBallOnly ? '#60a5fa22' : 'transparent',
              color: deepBallOnly ? '#60a5fa' : 'var(--t-muted)',
              fontFamily: 'var(--font-h2)',
              fontSize: 10,
              cursor: 'pointer',
              letterSpacing: '0.5px',
              transition: 'border-color .15s, color .15s, background .15s',
              whiteSpace: 'nowrap',
            }}
          >40+ yd</button>
          <select
            className="orange-scroll"
            value={selectedPlayer}
            onChange={e => setSelectedPlayer(e.target.value)}
            style={{
              padding: '3px 8px',
              border: `1px solid ${selectedPlayer ? ORANGE : 'var(--surf-border)'}`,
              borderRadius: 12,
              background: selectedPlayer ? `${ORANGE}22` : 'var(--surf-bg)',
              color: selectedPlayer ? ORANGE : 'var(--t-muted)',
              fontFamily: 'var(--font-h2)',
              fontSize: 10,
              cursor: 'pointer',
              outline: 'none',
              letterSpacing: '0.5px',
              maxWidth: 160,
            }}
          >
            <option value="">All Players</option>
            {playerOptions.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {throwsStatus !== 'ready'
          ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--surf-border)', borderRadius: 8, color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '2px' }}>
              {throwsStatus === 'loading' ? 'Loading throws…' : `No throw data for ${year}.`}
            </div>
          ) : (
            [['Throw Chart', <Field2D throws={filteredThrows} key="f" />],
             ['Receiver Heat Map', <ReceiverHeatMap throws={filteredThrows} leagueThrows={leagueThrows} key="r" />],
             ['Completion Rate', <CompletionRateMap throws={teamThrows} key="c" />],
            ].map(([title, chart]) => (
              <div key={title} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontFamily: 'var(--font-h1)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)', flexShrink: 0 }}>{title}</div>
                <div style={{ width: '100%', aspectRatio: `${SVG_W} / ${SVG_H}`, border: '1px solid var(--surf-border)', borderRadius: 8, overflow: 'hidden' }}>
                  {chart}
                </div>
              </div>
            ))
          )
        }
      </div>

    </div>
  );
}

// Marching squares lookup: idx = (TL<<3)|(TR<<2)|(BR<<1)|BL, 1=above threshold
// Edges: pts[0]=T(top), pts[1]=R(right), pts[2]=B(bottom), pts[3]=L(left)
// Each entry is a list of [edgeA, edgeB] segments the isoline passes through.
const MS_CASES = [
  [],           // 0  0000  —
  [[3,2]],      // 1  0001  BL        → L–B
  [[2,1]],      // 2  0010  BR        → B–R
  [[3,1]],      // 3  0011  BL+BR     → L–R
  [[0,1]],      // 4  0100  TR        → T–R
  [[0,1],[3,2]],// 5  0101  TR+BL     saddle → T–R, L–B
  [[0,2]],      // 6  0110  TR+BR     → T–B
  [[0,3]],      // 7  0111  TR+BR+BL  (TL below) → T–L
  [[0,3]],      // 8  1000  TL        → T–L
  [[0,2]],      // 9  1001  TL+BL     → T–B
  [[0,3],[2,1]],// 10 1010  TL+BR     saddle → T–L, B–R
  [[0,1]],      // 11 1011  TL+BR+BL  (TR below) → T–R
  [[3,1]],      // 12 1100  TL+TR     → L–R
  [[2,1]],      // 13 1101  TL+TR+BL  (BR below) → B–R
  [[3,2]],      // 14 1110  TL+TR+BR  (BL below) → L–B
  [],           // 15 1111  —
];

function CompletionRateMap({ throws }) {
  const canvasRef = useRef(null);
  const [isoLines, setIsoLines] = useState([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 0, W, H);

    const EZ_GOAL_PY = Math.round(EZ_H * H / SVG_H);
    const EZ_RECV_MAX = SVG_Y0 + EZ_H;        // receiver in attacking end zone only
    const valid = throws.filter(t =>
      t.svg_throw_x != null && t.svg_throw_y != null &&
      t.svg_recv_y  != null && t.svg_recv_y <= EZ_RECV_MAX
    );
    if (valid.length < 10) { setIsoLines([]); return; }

    const throwPx = valid.map(t => ({
      px: Math.round((t.svg_throw_x - SVG_X0) * W / SVG_W),
      py: Math.round((t.svg_throw_y - SVG_Y0) * H / SVG_H),
      complete: COMPLETE_TYPES.has(t.pbp_throw_type) ? 1 : 0,
    }));
    throwPx.sort((a, b) => a.py - b.py);

    // ── Cumulative sweep starting at EZ goal line ─────────────────────────
    const compM = new Float32Array(W * H);
    const totM  = new Float32Array(W * H);
    let throwIdx = 0;

    while (throwIdx < throwPx.length && throwPx[throwIdx].py < EZ_GOAL_PY) throwIdx++;

    for (let py = EZ_GOAL_PY; py < H; py++) {
      if (py > EZ_GOAL_PY) {
        for (let px = 0; px < W; px++) {
          compM[py * W + px] = compM[(py - 1) * W + px];
          totM[py * W + px]  = totM[(py - 1) * W + px];
        }
      }
      while (throwIdx < throwPx.length && throwPx[throwIdx].py <= py) {
        const { px, complete } = throwPx[throwIdx];
        if (px >= 0 && px < W) {
          totM[py * W + px]++;
          compM[py * W + px] += complete;
        }
        throwIdx++;
      }
    }

    // ── Horizontal blur on compM and totM (σ=8) ───────────────────────────
    const SIGMA_H = 8, KR_H = Math.ceil(3 * SIGMA_H);
    const kernH = new Float32Array(2 * KR_H + 1);
    let ksH = 0;
    for (let i = -KR_H; i <= KR_H; i++) {
      kernH[i + KR_H] = Math.exp(-i * i / (2 * SIGMA_H * SIGMA_H));
      ksH += kernH[i + KR_H];
    }
    for (let i = 0; i < kernH.length; i++) kernH[i] /= ksH;

    function blurH(src) {
      const out = new Float32Array(W * H);
      for (let py = EZ_GOAL_PY; py < H; py++) {
        for (let px = 0; px < W; px++) {
          let v = 0;
          for (let ki = 0; ki < kernH.length; ki++) {
            const sx = Math.max(0, Math.min(W - 1, px + ki - KR_H));
            v += src[py * W + sx] * kernH[ki];
          }
          out[py * W + px] = v;
        }
      }
      return out;
    }

    const compB = blurH(compM);
    const totB  = blurH(totM);

    // ── Raw rates ─────────────────────────────────────────────────────────
    const rawRates = new Float32Array(W * H).fill(-1);
    for (let py = EZ_GOAL_PY; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const i = py * W + px;
        if (totB[i] >= 0.5) rawRates[i] = compB[i] / totB[i];
      }
    }

    // ── Forward-fill upward per column down to EZ_GOAL_PY ────────────────
    for (let px = 0; px < W; px++) {
      let firstDataRow = -1;
      for (let py = EZ_GOAL_PY; py < H; py++) {
        if (rawRates[py * W + px] >= 0) { firstDataRow = py; break; }
      }
      if (firstDataRow <= EZ_GOAL_PY) continue;
      const fillRate = rawRates[firstDataRow * W + px];
      for (let py = EZ_GOAL_PY; py < firstDataRow; py++) {
        rawRates[py * W + px] = fillRate;
      }
    }

    // ── 2D Gaussian blur on rates (σ=12) ──────────────────────────────────
    function blur2D(src, sigma) {
      const KR = Math.ceil(3 * sigma);
      const kern = new Float32Array(2 * KR + 1);
      let ks = 0;
      for (let i = -KR; i <= KR; i++) {
        kern[i + KR] = Math.exp(-i * i / (2 * sigma * sigma));
        ks += kern[i + KR];
      }
      for (let i = 0; i < kern.length; i++) kern[i] /= ks;

      const hasData = new Uint8Array(W * H);
      for (let i = 0; i < src.length; i++) if (src[i] >= 0) hasData[i] = 1;

      const tmp = new Float32Array(W * H).fill(-1);
      for (let py = EZ_GOAL_PY; py < H; py++) {
        for (let px = 0; px < W; px++) {
          let v = 0, w = 0;
          for (let ki = 0; ki < kern.length; ki++) {
            const sx = Math.max(0, Math.min(W - 1, px + ki - KR));
            const idx = py * W + sx;
            if (hasData[idx]) { v += src[idx] * kern[ki]; w += kern[ki]; }
          }
          if (w > 0) tmp[py * W + px] = v / w;
        }
      }

      const out = new Float32Array(W * H).fill(-1);
      for (let py = EZ_GOAL_PY; py < H; py++) {
        for (let px = 0; px < W; px++) {
          let v = 0, w = 0;
          for (let ki = 0; ki < kern.length; ki++) {
            const sy = Math.max(EZ_GOAL_PY, Math.min(H - 1, py + ki - KR));
            const idx = sy * W + px;
            if (tmp[idx] >= 0) { v += tmp[idx] * kern[ki]; w += kern[ki]; }
          }
          if (w > 0) out[py * W + px] = v / w;
        }
      }
      return out;
    }

    const rates = blur2D(rawRates, 12);

    // ── Fixed absolute scale: 65%–99% ─────────────────────────────────────
    const rLo = 0.65, rHi = 0.99, rSpan = rHi - rLo;

    // ── Colorize ──────────────────────────────────────────────────────────
    const img = ctx.createImageData(W, H);
    const d   = img.data;
    for (let i = 0; i < rates.length; i++) {
      const pi = i * 4;
      if (rates[i] < 0) {
        d[pi] = 232; d[pi+1] = 232; d[pi+2] = 232; d[pi+3] = 255;
      } else {
        const t = Math.max(0, Math.min(1, (rates[i] - rLo) / rSpan));
        const [rv, gv, bv] = jetRgbArr(t);
        d[pi] = rv; d[pi+1] = gv; d[pi+2] = bv; d[pi+3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // ── Marching squares — sample in canvas pixel space ───────────────────
    const GR = GRID_ROWS, GC = GRID_COLS;
    const sampled = Array.from({ length: GR }, (_, r) =>
      Array.from({ length: GC }, (_, c) => {
        const px = Math.min(W - 1, Math.round((c + 0.5) * W / GC));
        const py = Math.min(H - 1, Math.round((r + 0.5) * H / GR));
        const v = rates[py * W + px];
        return v >= 0 ? v : null;
      })
    );

    const cellW = SVG_W / GC;
    const cellH = SVG_H / GR;

    const isoThresholds = [0.70, 0.75, 0.80, 0.85, 0.90, 0.95];
    setIsoLines(isoThresholds.map(thresh => {
      const segs = [];
      for (let r = 0; r < GR - 1; r++) {
        for (let c = 0; c < GC - 1; c++) {
          const vTL=sampled[r][c], vTR=sampled[r][c+1];
          const vBR=sampled[r+1][c+1], vBL=sampled[r+1][c];
          if (vTL==null||vTR==null||vBR==null||vBL==null) continue;
          const idx=((vTL>=thresh?1:0)<<3)|((vTR>=thresh?1:0)<<2)|
                    ((vBR>=thresh?1:0)<<1)|(vBL>=thresh?1:0);
          if (idx===0||idx===15) continue;
          const x0 = SVG_X0 + c * cellW;
          const y0 = SVG_Y0 + r * cellH;
          const x1 = x0 + cellW;
          const y1 = y0 + cellH;
          const li=(a,b,va,vb)=>Math.abs(vb-va)<1e-9?(a+b)/2:a+(b-a)*(thresh-va)/(vb-va);
          const pts=[
            {x:li(x0,x1,vTL,vTR), y:y0},
            {x:x1, y:li(y0,y1,vTR,vBR)},
            {x:li(x0,x1,vBL,vBR), y:y1},
            {x:x0, y:li(y0,y1,vTL,vBL)},
          ];
          for (const [a,b] of MS_CASES[idx]) segs.push([pts[a],pts[b]]);
        }
      }
      const pct = Math.round(thresh * 100);
      return { thresh, pct, segs };
    }));
  }, [throws]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas ref={canvasRef} width={200} height={450}
              style={{ width: '100%', height: '100%', display: 'block' }} />
      <svg viewBox={`${SVG_X0} ${SVG_Y0} ${SVG_W} ${SVG_H}`}
           style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
           preserveAspectRatio="xMidYMid meet">
        <defs><clipPath id="field-clip-cr"><rect x={SVG_X0} y={SVG_Y0} width={SVG_W} height={SVG_H} /></clipPath></defs>
        <g clipPath="url(#field-clip-cr)">
        {isoLines.map(({ pct, segs }) => {
          if (segs.length === 0) return null;
          const mid = segs[Math.floor(segs.length / 2)];
          const lx = (mid[0].x + mid[1].x) / 2;
          const ly = (mid[0].y + mid[1].y) / 2;
          return (
            <g key={pct}>
              {segs.map(([p1,p2], i) => (
                <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                  stroke="rgba(255,255,255,0.85)" strokeWidth={1.2} />
              ))}
              <text x={lx} y={ly} fontSize={8} fill="white" textAnchor="middle"
                dominantBaseline="middle" fontWeight="bold"
                stroke="#222" strokeWidth={0.8} paintOrder="stroke">
                {pct}%
              </text>
            </g>
          );
        })}
        <FieldLines />
        </g>
      </svg>
    </div>
  );
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ border: '1px solid var(--surf-border)', borderRadius: 8, padding: '12px 16px', background: 'var(--surf-bg)', height: 76, boxSizing: 'border-box', overflow: 'hidden' }}>
      <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-h1)', fontSize: 14, fontWeight: 600, color: color ?? 'var(--t-primary)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: color ?? 'var(--t-secondary)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
    </div>
  );
}

// ── Records ───────────────────────────────────────────────────────────────────

function RecordsPanel({ franchiseId, teamSlug }) {
  const [data,   setData]   = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetch(`/api/ufa/records/${franchiseId}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => { if (!cancelled) { setData(d); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [franchiseId]);

  if (status === 'loading') {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>
        Loading…
      </div>
    );
  }
  if (status === 'error' || !data) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0', color: ORANGE, fontFamily: 'var(--font-body)', fontSize: 13 }}>
        Could not load records.
      </div>
    );
  }

  // cols: { label, width, align }
  const SEASON_COLS = [
    { label: 'Stat',   width: '25%', align: 'left'   },
    { label: 'Player', width: 'auto', align: 'left'  },
    { label: 'Count',  width: '15%', align: 'center' },
    { label: 'Year',   width: '15%', align: 'center' },
  ];
  const CAREER_COLS = [
    { label: 'Stat',   width: '25%', align: 'left'   },
    { label: 'Player', width: 'auto', align: 'left'  },
    { label: 'Count',  width: '15%', align: 'center' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: 32 }}>
      <RecordsTable
        title="Best Single Season"
        subtitle="Most in a single regular season while rostered on this franchise"
        rows={data.single_season}
        cols={SEASON_COLS}
        renderRow={r => [
          <StatLabel key="stat">{r.stat}</StatLabel>,
          <PlayerLink key="pl" slug={r.player_id}>{r.player}</PlayerLink>,
          <CountCell key="cnt">{r.count}</CountCell>,
          <YearCell key="yr">{r.year}</YearCell>,
        ]}
      />
      <RecordsTable
        title="Best Rookie Season"
        subtitle="Most in a player's first year in the league ever, while rostered on this franchise"
        rows={data.rookie_season ?? []}
        cols={SEASON_COLS}
        renderRow={r => [
          <StatLabel key="stat">{r.stat}</StatLabel>,
          <PlayerLink key="pl" slug={r.player_id}>{r.player}</PlayerLink>,
          <CountCell key="cnt">{r.count}</CountCell>,
          <YearCell key="yr">{r.year}</YearCell>,
        ]}
      />
      <RecordsTable
        title="Career Totals"
        subtitle="All-time totals accumulated while rostered on this franchise"
        rows={data.career}
        cols={CAREER_COLS}
        renderRow={r => [
          <StatLabel key="stat">{r.stat}</StatLabel>,
          <PlayerLink key="pl" slug={r.player_id}>{r.player}</PlayerLink>,
          <CountCell key="cnt">{r.count}</CountCell>,
        ]}
      />
    </div>
  );
}

function RecordsTable({ title, subtitle, rows, cols, renderRow }) {
  return (
    <div style={{ background: 'var(--surf-bg)', border: '1px solid var(--surf-border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--surf-border)' }}>
        <div style={{ fontFamily: 'var(--font-h1)', fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--t-primary)' }}>
          {title}
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--t-muted)', marginTop: 3, letterSpacing: '0.02em' }}>
          {subtitle}
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          {cols.map((c, i) => <col key={i} style={{ width: c.width }} />)}
        </colgroup>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
            {cols.map((c, i) => (
              <th key={i} style={{
                padding: '8px 12px',
                fontFamily: 'var(--font-h2)',
                fontSize: 9,
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
                color: 'var(--t-muted)',
                fontWeight: 400,
                textAlign: c.align,
              }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ background: i % 2 === 1 ? 'var(--surf-bg-2)' : 'transparent', borderBottom: '1px solid var(--surf-border)' }}>
              {renderRow(r).map((cell, j) => (
                <td key={j} style={{
                  padding: '9px 12px',
                  fontSize: 12,
                  textAlign: cols[j].align,
                  verticalAlign: 'middle',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatLabel({ children }) {
  return (
    <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: ORANGE }}>
      {children}
    </span>
  );
}

function PlayerLink({ slug, children }) {
  if (!slug) {
    return <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-primary)' }}>{children}</span>;
  }
  return (
    <Link
      to={`/players/${slug}`}
      style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-primary)', textDecoration: 'none' }}
      onMouseOver={e => e.currentTarget.style.color = ORANGE}
      onMouseOut={e => e.currentTarget.style.color = 'var(--t-primary)'}
    >
      {children}
    </Link>
  );
}

function CountCell({ children }) {
  const formatted = typeof children === 'number'
    ? children.toLocaleString()
    : children;
  return (
    <span style={{ fontFamily: 'var(--mono-clr, monospace)', fontSize: 12, color: 'var(--t-primary)', fontVariantNumeric: 'tabular-nums' }}>
      {formatted}
    </span>
  );
}

function YearCell({ children }) {
  return (
    <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-secondary)', letterSpacing: '0.05em' }}>
      {children}
    </span>
  );
}

// ── Overview Panel ────────────────────────────────────────────────────────────

// Pythagorean expectation: pf^e / (pf^e + pa^e), e≈2 for scoring sports
function pythagorean(pf, pa, exp = 2) {
  if (!pf && !pa) return null;
  return Math.pow(pf, exp) / (Math.pow(pf, exp) + Math.pow(pa, exp));
}

function SeasonHistoryChart({ rows, onYearClick }) {
  const [hovered, setHovered] = useState(null);
  const COL_W = 44;
  const PAD   = { t: 32, r: 48, b: 52, l: 48 };
  const SVG_H = 280;
  const areaH = SVG_H - PAD.t - PAD.b;
  const svgW  = COL_W * rows.length + PAD.l + PAD.r;

  // Dual-axis: left = point diff/game, right = pyth win%
  const maxDiff = Math.max(...rows.map(r => Math.abs(r.diff ?? 0)), 3);
  const diffToY = d => PAD.t + areaH / 2 - (d / maxDiff) * (areaH / 2) * 0.88;
  const pctToY  = p => PAD.t + (1 - p) * areaH;
  const BAR_W   = COL_W * 0.38;

  return (
    <div style={{ border: '1px solid var(--surf-border)', borderRadius: 10, background: 'var(--surf-bg)', overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--surf-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-h1)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)' }}>Season Timeline</div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--t-muted)', marginTop: 2 }}>Bars = avg point diff per game · Orange = Pythagorean W% · Click to explore season</div>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: '#22c55e', letterSpacing: '1px' }}>▪ Positive diff</span>
          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: '#ef4444', letterSpacing: '1px' }}>▪ Negative diff</span>
          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: ORANGE, letterSpacing: '1px' }}>── Pyth W%</span>
        </div>
      </div>
      <div className="orange-scroll" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <svg width={Math.max(svgW, 320)} height={SVG_H} viewBox={`0 0 ${svgW} ${SVG_H}`} style={{ display: 'block' }}>

          {/* Zero line + grid */}
          {[-1, -0.5, 0, 0.5, 1].map(f => {
            const y = PAD.t + areaH / 2 - f * (areaH / 2) * 0.88;
            return (
              <line key={f} x1={PAD.l} y1={y} x2={svgW - PAD.r} y2={y}
                style={{ stroke: 'var(--surf-border)' }}
                strokeWidth={f === 0 ? 1 : 0.4} strokeDasharray={f === 0 ? 'none' : '3,5'} />
            );
          })}

          {/* Left Y-axis: point diff */}
          {[maxDiff, maxDiff/2, 0, -maxDiff/2, -maxDiff].map(v => (
            <text key={v} x={PAD.l - 5} y={diffToY(v)} textAnchor="end" fontSize={8}
              dominantBaseline="middle" fontFamily="var(--font-h2)"
              style={{ fill: 'var(--t-muted)' }}>
              {v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0)}
            </text>
          ))}
          <text x={PAD.l - 5} y={PAD.t - 12} textAnchor="end" fontSize={8}
            fontFamily="var(--font-h2)" style={{ fill: 'var(--t-muted)' }}>pt diff/g</text>

          {/* Right Y-axis: Pyth W% */}
          {[1, 0.75, 0.5, 0.25, 0].map(v => (
            <text key={v} x={svgW - PAD.r + 4} y={pctToY(v)} fontSize={8}
              dominantBaseline="middle" fontFamily="var(--font-h2)" fill={ORANGE}>
              {(v * 100).toFixed(0)}%
            </text>
          ))}
          <text x={svgW - PAD.r + 4} y={PAD.t - 12} fontSize={8}
            fontFamily="var(--font-h2)" fill={ORANGE}>Pyth%</text>

          {/* Bars */}
          {rows.map((r, i) => {
            if (r.diff == null) return null;
            const cx   = PAD.l + i * COL_W + COL_W / 2;
            const zero = diffToY(0);
            const top  = diffToY(r.diff);
            const isPos = r.diff >= 0;
            const isHov = hovered === r.year;
            const barY  = isPos ? top : zero;
            const barH  = Math.abs(zero - top);
            return (
              <g key={r.year}
                onMouseEnter={() => setHovered(r.year)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onYearClick?.(r.year)}
                style={{ cursor: 'pointer' }}
              >
                <rect x={PAD.l + i * COL_W} y={PAD.t} width={COL_W} height={areaH}
                  style={{ fill: isHov ? 'rgba(234,96,32,0.06)' : 'transparent' }} />
                <rect x={cx - BAR_W / 2} y={barY} width={BAR_W} height={Math.max(barH, 1.5)}
                  fill={isPos ? (isHov ? '#22c55e' : '#22c55e77') : (isHov ? '#ef4444' : '#ef444477')} rx={2} />
                <text x={cx} y={SVG_H - PAD.b + 14}
                  textAnchor="end" fontSize={9} fontFamily="var(--font-h2)"
                  style={{ fill: isHov ? ORANGE : 'var(--t-muted)' }}
                  transform={`rotate(-45 ${cx} ${SVG_H - PAD.b + 14})`}
                >{r.year}</text>
              </g>
            );
          })}

          {/* Pyth W% line */}
          {(() => {
            const pts = rows.filter(r => r.pyth != null).map(r => {
              const cx = PAD.l + rows.indexOf(r) * COL_W + COL_W / 2;
              return `${cx},${pctToY(r.pyth)}`;
            });
            return pts.length >= 2
              ? <polyline points={pts.join(' ')} fill="none" stroke={ORANGE} strokeWidth={1.8} strokeLinejoin="round" />
              : null;
          })()}
          {rows.map((r, i) => {
            if (r.pyth == null) return null;
            const cx = PAD.l + i * COL_W + COL_W / 2;
            return <circle key={r.year} cx={cx} cy={pctToY(r.pyth)} r={hovered === r.year ? 4 : 2.5}
              fill={ORANGE} strokeWidth={1} style={{ stroke: 'var(--surf-bg)' }} />;
          })}

          {/* Actual win% dots (ghost) */}
          {rows.map((r, i) => {
            if (r.winPct == null) return null;
            const cx = PAD.l + i * COL_W + COL_W / 2;
            return <circle key={`act-${r.year}`} cx={cx} cy={pctToY(r.winPct)} r={2}
              fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1.2}
              strokeDasharray="2,2" />;
          })}

          {/* Hover tooltip */}
          {hovered != null && (() => {
            const r = rows.find(r => r.year === hovered);
            if (!r) return null;
            const i   = rows.indexOf(r);
            const cx  = PAD.l + i * COL_W + COL_W / 2;
            const TW  = 148, TH = 106;
            let tx = cx - TW / 2;
            if (tx < 2) tx = 2;
            if (tx + TW > svgW - 2) tx = svgW - TW - 2;
            const ty = 3;
            const luck = r.pyth != null && r.winPct != null ? r.winPct - r.pyth : null;
            const lc = luck != null ? (luck > 0.04 ? '#22c55e' : luck < -0.04 ? '#ef4444' : 'var(--t-muted)') : 'var(--t-muted)';
            const dc = (r.diff ?? 0) >= 0 ? '#22c55e' : '#ef4444';
            return (
              <g pointerEvents="none">
                <rect x={tx} y={ty} width={TW} height={TH} rx={6} strokeWidth={1}
                  style={{ fill: 'var(--card-bg)', stroke: 'var(--surf-border)' }} />
                <text x={tx + TW / 2} y={ty + 16} textAnchor="middle" fontSize={12} fontWeight={600}
                  fontFamily="var(--font-h1)" fill={ORANGE}>{r.year}</text>
                <text x={tx + 10} y={ty + 32} fontSize={10} fontFamily="var(--font-h2)"
                  style={{ fill: 'var(--t-primary)' }}>{r.w}–{r.l}{r.t ? `–${r.t}` : ''}</text>
                <text x={tx + TW - 10} y={ty + 32} textAnchor="end" fontSize={10}
                  fontFamily="var(--font-h2)" style={{ fill: 'var(--t-secondary)' }}>
                  {r.standing != null ? `#${r.standing} seed` : ''}
                </text>
                {r.diff != null && (
                  <text x={tx + 10} y={ty + 49} fontSize={9} fontFamily="var(--font-h2)" fill={dc}>
                    {(r.diff >= 0 ? '+' : '') + r.diff.toFixed(2)} pt diff/g
                  </text>
                )}
                {r.ppg != null && (
                  <text x={tx + 10} y={ty + 64} fontSize={9} fontFamily="var(--font-h2)"
                    style={{ fill: 'var(--t-muted)' }}>
                    {r.ppg.toFixed(1)} PF · {r.papg.toFixed(1)} PA per game
                  </text>
                )}
                {r.pyth != null && (
                  <text x={tx + 10} y={ty + 79} fontSize={9} fontFamily="var(--font-h2)" fill={ORANGE}>
                    Pyth {(r.pyth * 100).toFixed(1)}% · Act {r.winPct != null ? (r.winPct * 100).toFixed(1) + '%' : '—'}
                  </text>
                )}
                {luck != null && (
                  <text x={tx + 10} y={ty + 94} fontSize={9} fontFamily="var(--font-h2)" fill={lc}>
                    {luck > 0.04 ? '↑ Overperformed' : luck < -0.04 ? '↓ Underperformed' : '≈ As expected'} ({luck >= 0 ? '+' : ''}{(luck * 100).toFixed(1)}%)
                  </text>
                )}
              </g>
            );
          })()}
        </svg>
      </div>
    </div>
  );
}

function OverviewPanel({ franchiseId, onYearClick }) {
  const [seasons, setSeasons] = useState(null);
  const [records, setRecords] = useState(null);
  const [status,  setStatus]  = useState('loading');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    Promise.all([
      fetch(`/api/ufa/franchise/${franchiseId}/seasons`).then(r => r.json()),
      fetch(`/api/ufa/records/${franchiseId}`).then(r => r.json()),
    ])
      .then(([seasData, recData]) => {
        if (cancelled) return;
        setSeasons(seasData.seasons);
        setRecords(recData);
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [franchiseId]);

  const seasonRows = useMemo(() => {
    if (!seasons) return [];
    return seasons.map(s => {
      const w = s.wins ?? 0, l = s.losses ?? 0, t = s.ties ?? 0;
      const gp = w + l + t;
      let pf = 0, pa = 0, gc = 0;
      let homeW = 0, homeL = 0, awayW = 0, awayL = 0;
      let closeW = 0, closeL = 0; // 1-pt games
      let blowW = 0, blowL = 0;   // 4+ pt wins/losses
      const firstHalfGames = [], secondHalfGames = [];
      const games = s.games ?? [];
      games.forEach((g, idx) => {
        if (g.team_score != null && g.opp_score != null) {
          pf += g.team_score; pa += g.opp_score; gc++;
          const margin = g.team_score - g.opp_score;
          const isW = margin > 0, isL = margin < 0;
          if (g.home) { if (isW) homeW++; else if (isL) homeL++; }
          else        { if (isW) awayW++; else if (isL) awayL++; }
          if (Math.abs(margin) === 1) { if (isW) closeW++; else if (isL) closeL++; }
          if (Math.abs(margin) >= 4)  { if (isW) blowW++;  else if (isL) blowL++;  }
          if (idx < games.length / 2) firstHalfGames.push(g);
          else                        secondHalfGames.push(g);
        }
      });
      const halfWinPct = half => {
        const hw = half.filter(g => g.team_score > g.opp_score).length;
        return half.length > 0 ? hw / half.length : null;
      };
      const pyth = gc > 0 ? pythagorean(pf, pa) : null;
      return {
        year: s.year, w, l, t, gp,
        winPct:    gp > 0 ? w / gp : null,
        pyth,
        luck:      (gp > 0 && pyth != null) ? w / gp - pyth : null,
        ppg:       gc > 0 ? pf / gc : null,
        papg:      gc > 0 ? pa / gc : null,
        diff:      gc > 0 ? (pf - pa) / gc : null,
        standing:  s.standing,
        division:  s.division,
        homeW, homeL, awayW, awayL,
        closeW, closeL,
        blowW, blowL,
        firstHalfWinPct:  halfWinPct(firstHalfGames),
        secondHalfWinPct: halfWinPct(secondHalfGames),
      };
    });
  }, [seasons]);

  // Franchise-wide derived analytics
  const analytics = useMemo(() => {
    if (!seasonRows.length) return null;
    let tw = 0, tl = 0, tt = 0;
    let homeW = 0, homeL = 0, awayW = 0, awayL = 0;
    let closeW = 0, closeL = 0, blowW = 0, blowL = 0;
    let sumDiff = 0, diffN = 0;
    let sumLuck = 0, luckN = 0;
    let winStreakMax = 0, loseStreakMax = 0, winningSeasons = 0;
    let curW = 0, curL = 0;

    // Flatten all games for streak analysis
    const allGames = seasonRows.flatMap(r =>
      (seasons.find(s => s.year === r.year)?.games ?? [])
        .filter(g => g.team_score != null && g.opp_score != null)
    );
    let curStreak = 0, curStreakType = null;
    for (const g of allGames) {
      const res = g.team_score > g.opp_score ? 'W' : g.team_score < g.opp_score ? 'L' : 'T';
      if (res === 'W') {
        if (curStreakType === 'W') curStreak++; else { curStreak = 1; curStreakType = 'W'; }
        winStreakMax = Math.max(winStreakMax, curStreak);
      } else if (res === 'L') {
        if (curStreakType === 'L') curStreak++; else { curStreak = 1; curStreakType = 'L'; }
        loseStreakMax = Math.max(loseStreakMax, curStreak);
      } else { curStreak = 0; curStreakType = null; }
    }

    let consecutiveWinSeasons = 0, maxConsecWin = 0;
    for (const r of seasonRows) {
      tw += r.w; tl += r.l; tt += r.t;
      homeW += r.homeW; homeL += r.homeL;
      awayW += r.awayW; awayL += r.awayL;
      closeW += r.closeW; closeL += r.closeL;
      blowW += r.blowW; blowL += r.blowL;
      if (r.diff != null) { sumDiff += r.diff; diffN++; }
      if (r.luck != null) { sumLuck += r.luck; luckN++; }
      if (r.winPct != null && r.winPct > 0.5) {
        winningSeasons++;
        consecutiveWinSeasons++;
        maxConsecWin = Math.max(maxConsecWin, consecutiveWinSeasons);
      } else { consecutiveWinSeasons = 0; }
    }

    const tgp = tw + tl + tt;

    // Year-over-year improvement rate (% of transitions that were improvements)
    const improvements = seasonRows.slice(1).filter((r, i) =>
      r.winPct != null && seasonRows[i].winPct != null && r.winPct > seasonRows[i].winPct
    ).length;
    const transitions = seasonRows.slice(1).filter((r, i) =>
      r.winPct != null && seasonRows[i].winPct != null
    ).length;

    // Consistency: std dev of win%
    const validWinPcts = seasonRows.filter(r => r.winPct != null).map(r => r.winPct);
    const mean = validWinPcts.reduce((a, b) => a + b, 0) / (validWinPcts.length || 1);
    const variance = validWinPcts.reduce((a, b) => a + (b - mean) ** 2, 0) / (validWinPcts.length || 1);
    const stdDev = Math.sqrt(variance);

    return {
      tgp, tw, tl, tt,
      winPct: tgp > 0 ? tw / tgp : 0,
      seasons: seasonRows.length,
      winningSeasons,
      maxConsecWin,
      homeWinPct: (homeW + homeL) > 0 ? homeW / (homeW + homeL) : null,
      awayWinPct: (awayW + awayL) > 0 ? awayW / (awayW + awayL) : null,
      homeW, homeL, awayW, awayL,
      closeWinPct: (closeW + closeL) > 0 ? closeW / (closeW + closeL) : null,
      closeW, closeL,
      blowWinPct:  (blowW + blowL) > 0  ? blowW  / (blowW + blowL)  : null,
      blowW, blowL,
      avgDiff:  diffN > 0 ? sumDiff / diffN : null,
      avgLuck:  luckN > 0 ? sumLuck / luckN : null,
      winStreakMax, loseStreakMax,
      consistencyStdDev: stdDev,
      improvementRate: transitions > 0 ? improvements / transitions : null,
    };
  }, [seasonRows, seasons]);

  const careerLeaders = useMemo(() => {
    if (!records?.career) return [];
    const PRIORITY = ['Goals', 'Assists', 'Blocks', 'Completions', 'Yards Thrown', 'Yards Received', 'Plus / Minus', 'Hucks Completed'];
    return PRIORITY.map(label => records.career.find(r => r.stat === label)).filter(Boolean);
  }, [records]);

  // Top seasons by pyth overperformance (lucky) and underperformance
  const luckStories = useMemo(() => {
    const withLuck = seasonRows.filter(r => r.luck != null).sort((a, b) => Math.abs(b.luck) - Math.abs(a.luck));
    return withLuck.slice(0, 3);
  }, [seasonRows]);

  // Momentum: find multi-season runs (3+ consecutive winning or losing seasons)
  const eras = useMemo(() => {
    const result = [];
    let run = null;
    for (const r of seasonRows) {
      if (r.winPct == null) continue;
      const type = r.winPct > 0.5 ? 'good' : r.winPct < 0.5 ? 'bad' : 'even';
      if (!run || run.type !== type) {
        if (run && run.len >= 2) result.push(run);
        run = { type, start: r.year, end: r.year, len: 1, wins: r.w, losses: r.l };
      } else {
        run.end = r.year; run.len++; run.wins += r.w; run.losses += r.l;
      }
    }
    if (run && run.len >= 2) result.push(run);
    return result.filter(e => e.len >= 2).sort((a, b) => b.len - a.len).slice(0, 4);
  }, [seasonRows]);

  if (status === 'loading') return (
    <div style={{ textAlign: 'center', padding: '64px 0', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>Loading…</div>
  );
  if (status === 'error') return (
    <div style={{ textAlign: 'center', padding: '64px 0', color: ORANGE, fontFamily: 'var(--font-body)', fontSize: 13 }}>Could not load overview data.</div>
  );
  if (!analytics) return null;

  const pctFmt = v => v != null ? `${(v * 100).toFixed(1)}%` : '—';
  const signFmt = v => v != null ? `${v >= 0 ? '+' : ''}${v.toFixed(2)}` : '—';

  return (
    <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 28 }}>

      {/* ── Row 1: Franchise Identity Cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>

        {/* Identity card: overall */}
        <div style={{ border: '1px solid var(--surf-border)', borderRadius: 10, padding: '16px 18px', background: 'var(--surf-bg)', gridRow: 'span 1' }}>
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: 8 }}>Franchise Record</div>
          <div style={{ fontFamily: 'var(--font-h1)', fontSize: 22, fontWeight: 600, color: analytics.winPct >= 0.5 ? '#22c55e' : '#ef4444', lineHeight: 1 }}>
            {analytics.tw}–{analytics.tl}{analytics.tt ? `–${analytics.tt}` : ''}
          </div>
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-secondary)', marginTop: 6 }}>
            {pctFmt(analytics.winPct)} over {analytics.seasons} seasons · {analytics.tgp} games
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: '#22c55e', letterSpacing: '0.5px' }}>
              {analytics.winningSeasons} winning seasons
            </span>
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)' }}>
              {analytics.seasons - analytics.winningSeasons} below .500
            </span>
          </div>
        </div>

        {/* Home vs Away */}
        <div style={{ border: '1px solid var(--surf-border)', borderRadius: 10, padding: '16px 18px', background: 'var(--surf-bg)' }}>
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: 8 }}>Home / Away Split</div>
          <div style={{ display: 'flex', gap: 20 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 8, color: 'var(--t-muted)', letterSpacing: '1px', marginBottom: 3 }}>HOME</div>
              <div style={{ fontFamily: 'var(--font-h1)', fontSize: 16, fontWeight: 600, color: analytics.homeWinPct >= 0.5 ? '#22c55e' : '#ef4444' }}>{pctFmt(analytics.homeWinPct)}</div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', marginTop: 2 }}>{analytics.homeW}–{analytics.homeL}</div>
            </div>
            <div style={{ width: 1, background: 'var(--surf-border)', alignSelf: 'stretch' }} />
            <div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 8, color: 'var(--t-muted)', letterSpacing: '1px', marginBottom: 3 }}>AWAY</div>
              <div style={{ fontFamily: 'var(--font-h1)', fontSize: 16, fontWeight: 600, color: analytics.awayWinPct >= 0.5 ? '#22c55e' : '#ef4444' }}>{pctFmt(analytics.awayWinPct)}</div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', marginTop: 2 }}>{analytics.awayW}–{analytics.awayL}</div>
            </div>
          </div>
          {analytics.homeWinPct != null && analytics.awayWinPct != null && (
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', marginTop: 10, borderTop: '1px solid var(--surf-border)', paddingTop: 8 }}>
              {analytics.homeWinPct > analytics.awayWinPct
                ? `Home advantage: +${((analytics.homeWinPct - analytics.awayWinPct) * 100).toFixed(1)}% better at home`
                : analytics.homeWinPct < analytics.awayWinPct
                  ? `Road team: +${((analytics.awayWinPct - analytics.homeWinPct) * 100).toFixed(1)}% better away`
                  : 'Identical home/away record'}
            </div>
          )}
        </div>

        {/* Close games vs blowouts */}
        <div style={{ border: '1px solid var(--surf-border)', borderRadius: 10, padding: '16px 18px', background: 'var(--surf-bg)' }}>
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: 8 }}>Clutch & Blowout</div>
          <div style={{ display: 'flex', gap: 20 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 8, color: 'var(--t-muted)', letterSpacing: '1px', marginBottom: 3 }}>1-PT GAMES</div>
              <div style={{ fontFamily: 'var(--font-h1)', fontSize: 16, fontWeight: 600, color: analytics.closeWinPct >= 0.5 ? '#22c55e' : '#ef4444' }}>{pctFmt(analytics.closeWinPct)}</div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', marginTop: 2 }}>{analytics.closeW}–{analytics.closeL}</div>
            </div>
            <div style={{ width: 1, background: 'var(--surf-border)', alignSelf: 'stretch' }} />
            <div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 8, color: 'var(--t-muted)', letterSpacing: '1px', marginBottom: 3 }}>4+ MARGIN</div>
              <div style={{ fontFamily: 'var(--font-h1)', fontSize: 16, fontWeight: 600, color: analytics.blowWinPct >= 0.5 ? '#22c55e' : '#ef4444' }}>{pctFmt(analytics.blowWinPct)}</div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', marginTop: 2 }}>{analytics.blowW}–{analytics.blowL}</div>
            </div>
          </div>
          {analytics.closeWinPct != null && analytics.blowWinPct != null && (
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', marginTop: 10, borderTop: '1px solid var(--surf-border)', paddingTop: 8 }}>
              {analytics.closeWinPct > analytics.blowWinPct + 0.08
                ? 'Clutch: win close games at a higher rate than they blow teams out'
                : analytics.blowWinPct > analytics.closeWinPct + 0.08
                  ? 'Dominant: win big when they win, but struggle in close ones'
                  : 'Balanced: similar rate in close games and blowouts'}
            </div>
          )}
        </div>

        {/* Pythagorean luck + consistency */}
        <div style={{ border: '1px solid var(--surf-border)', borderRadius: 10, padding: '16px 18px', background: 'var(--surf-bg)' }}>
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: 8 }}>Luck & Consistency</div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 8, color: 'var(--t-muted)', letterSpacing: '1px', marginBottom: 3 }}>AVG LUCK</div>
              <div style={{ fontFamily: 'var(--font-h1)', fontSize: 16, fontWeight: 600, color: analytics.avgLuck > 0.03 ? '#22c55e' : analytics.avgLuck < -0.03 ? '#ef4444' : 'var(--t-secondary)' }}>
                {analytics.avgLuck != null ? `${analytics.avgLuck >= 0 ? '+' : ''}${(analytics.avgLuck * 100).toFixed(1)}%` : '—'}
              </div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', marginTop: 2 }}>actual − pyth W%</div>
            </div>
            <div style={{ width: 1, background: 'var(--surf-border)', alignSelf: 'stretch' }} />
            <div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 8, color: 'var(--t-muted)', letterSpacing: '1px', marginBottom: 3 }}>ΣDEV W%</div>
              <div style={{ fontFamily: 'var(--font-h1)', fontSize: 16, fontWeight: 600, color: analytics.consistencyStdDev < 0.1 ? '#22c55e' : analytics.consistencyStdDev > 0.18 ? '#ef4444' : 'var(--t-secondary)' }}>
                {(analytics.consistencyStdDev * 100).toFixed(1)}%
              </div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', marginTop: 2 }}>
                {analytics.consistencyStdDev < 0.1 ? 'very consistent' : analytics.consistencyStdDev > 0.18 ? 'volatile' : 'moderate swings'}
              </div>
            </div>
          </div>
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', borderTop: '1px solid var(--surf-border)', paddingTop: 8 }}>
            Win streak: {analytics.winStreakMax}  ·  Loss streak: {analytics.loseStreakMax}
            {analytics.improvementRate != null && ` · Y/Y improved ${(analytics.improvementRate * 100).toFixed(0)}% of seasons`}
          </div>
        </div>
      </div>

      {/* ── Row 2: Chart + Eras ── */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 62%', minWidth: 0 }}>
          <SeasonHistoryChart rows={seasonRows} onYearClick={onYearClick} />
        </div>

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Season table compressed */}
          <div style={{ border: '1px solid var(--surf-border)', borderRadius: 10, background: 'var(--surf-bg)', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--surf-border)', fontFamily: 'var(--font-h1)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)' }}>
              By Season
            </div>
            <div className="orange-scroll" style={{ maxHeight: 248, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '22%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '17%' }} />
                </colgroup>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                    {['Year', 'W–L', 'W%', 'Std', 'Pyth', 'Luck'].map((h, i) => (
                      <th key={h} style={{ padding: '6px 8px', fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 400, textAlign: i === 0 ? 'left' : 'center', position: 'sticky', top: 0, background: 'var(--surf-bg)', zIndex: 1 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...seasonRows].reverse().map((r, i) => {
                    const wc = r.winPct != null ? (r.winPct >= 0.5 ? '#22c55e' : '#ef4444') : 'var(--t-muted)';
                    const lc = r.luck != null ? (r.luck > 0.04 ? '#22c55e' : r.luck < -0.04 ? '#ef4444' : 'var(--t-muted)') : 'var(--t-muted)';
                    return (
                      <tr key={r.year}
                        onClick={() => onYearClick?.(r.year)}
                        style={{ background: i % 2 === 1 ? 'var(--surf-bg-2)' : 'var(--surf-bg)', borderBottom: '1px solid var(--surf-border)', cursor: 'pointer' }}
                        onMouseEnter={e => { e.currentTarget.style.background = `${ORANGE}11`; }}
                        onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 1 ? 'var(--surf-bg-2)' : 'var(--surf-bg)'; }}
                      >
                        <td style={{ padding: '7px 8px', fontFamily: 'var(--font-h2)', fontSize: 10, color: ORANGE, fontWeight: 600 }}>{r.year}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-primary)' }}>{r.w}–{r.l}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 10, color: wc, fontWeight: 600 }}>{r.winPct != null ? (r.winPct * 100).toFixed(0) + '%' : '—'}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)' }}>{r.standing != null ? `#${r.standing}` : '—'}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 10, color: ORANGE }}>{r.pyth != null ? (r.pyth * 100).toFixed(0) + '%' : '—'}</td>
                        <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 10, color: lc, fontWeight: 600 }}>{r.luck != null ? `${r.luck >= 0 ? '+' : ''}${(r.luck * 100).toFixed(1)}` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Most interesting luck seasons */}
          {luckStories.length > 0 && (
            <div style={{ border: '1px solid var(--surf-border)', borderRadius: 10, background: 'var(--surf-bg)', padding: '12px 14px' }}>
              <div style={{ fontFamily: 'var(--font-h1)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)', marginBottom: 10 }}>
                Luck Outliers
              </div>
              {luckStories.map(r => {
                const isOver = r.luck > 0;
                return (
                  <div key={r.year} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--surf-border)' }}
                    onClick={() => onYearClick?.(r.year)}>
                    <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: ORANGE, fontWeight: 600, width: 36 }}>{r.year}</span>
                    <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', flex: 1, marginLeft: 8 }}>
                      {r.w}–{r.l} actual · {r.pyth != null ? (r.pyth * 100).toFixed(0) + '% pyth' : ''}
                    </span>
                    <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, fontWeight: 600, color: isOver ? '#22c55e' : '#ef4444', marginLeft: 8 }}>
                      {isOver ? '↑' : '↓'} {Math.abs(r.luck * 100).toFixed(1)}%
                    </span>
                    <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', marginLeft: 8, width: 72, textAlign: 'right' }}>
                      {isOver ? 'overperformed' : 'underperformed'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 3: First/Second Half splits + eras ── */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

        {/* Season half splits: sparkline-style table */}
        <div style={{ flex: '0 0 38%', border: '1px solid var(--surf-border)', borderRadius: 10, background: 'var(--surf-bg)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--surf-border)' }}>
            <div style={{ fontFamily: 'var(--font-h1)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)' }}>First vs Second Half</div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: 'var(--t-muted)', marginTop: 2 }}>Do they finish strong or fade?</div>
          </div>
          <div className="orange-scroll" style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup><col style={{ width: '18%' }} /><col style={{ width: '22%' }} /><col style={{ width: '22%' }} /><col style={{ width: '22%' }} /><col style={{ width: '16%' }} /></colgroup>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                  {['Year', '1st Half', '2nd Half', 'Trend', 'Final'].map((h, i) => (
                    <th key={h} style={{ padding: '6px 8px', fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 400, textAlign: i === 0 ? 'left' : 'center', position: 'sticky', top: 0, background: 'var(--surf-bg)', zIndex: 1 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...seasonRows].reverse().filter(r => r.firstHalfWinPct != null && r.secondHalfWinPct != null).map((r, i) => {
                  const trend = r.secondHalfWinPct - r.firstHalfWinPct;
                  const tc = trend > 0.1 ? '#22c55e' : trend < -0.1 ? '#ef4444' : 'var(--t-muted)';
                  return (
                    <tr key={r.year}
                      onClick={() => onYearClick?.(r.year)}
                      style={{ background: i % 2 === 1 ? 'var(--surf-bg-2)' : 'var(--surf-bg)', borderBottom: '1px solid var(--surf-border)', cursor: 'pointer' }}
                      onMouseEnter={e => { e.currentTarget.style.background = `${ORANGE}11`; }}
                      onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 1 ? 'var(--surf-bg-2)' : 'var(--surf-bg)'; }}
                    >
                      <td style={{ padding: '7px 8px', fontFamily: 'var(--font-h2)', fontSize: 10, color: ORANGE, fontWeight: 600 }}>{r.year}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 10, color: r.firstHalfWinPct >= 0.5 ? '#22c55e' : '#ef4444' }}>{pctFmt(r.firstHalfWinPct)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 10, color: r.secondHalfWinPct >= 0.5 ? '#22c55e' : '#ef4444' }}>{pctFmt(r.secondHalfWinPct)}</td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 11, fontWeight: 600, color: tc }}>
                        {trend > 0.1 ? '↑' : trend < -0.1 ? '↓' : '→'} {Math.abs(trend * 100).toFixed(0)}%
                      </td>
                      <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 10, color: r.winPct >= 0.5 ? '#22c55e' : '#ef4444' }}>{pctFmt(r.winPct)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Franchise Eras */}
        {eras.length > 0 && (
          <div style={{ flex: '0 0 24%', border: '1px solid var(--surf-border)', borderRadius: 10, background: 'var(--surf-bg)', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--surf-border)' }}>
              <div style={{ fontFamily: 'var(--font-h1)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)' }}>Franchise Eras</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: 'var(--t-muted)', marginTop: 2 }}>Consecutive above/below .500 runs</div>
            </div>
            <div style={{ padding: '4px 0' }}>
              {eras.map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: i < eras.length - 1 ? '1px solid var(--surf-border)' : 'none' }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: e.type === 'good' ? '#22c55e' : e.type === 'bad' ? '#ef4444' : 'var(--t-muted)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-primary)', fontWeight: 600 }}>
                      {e.start === e.end ? String(e.start) : `${e.start}–${e.end}`}
                    </div>
                    <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', marginTop: 2 }}>
                      {e.len} seasons · {e.wins}–{e.losses}
                    </div>
                  </div>
                  <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, fontWeight: 600, color: e.type === 'good' ? '#22c55e' : e.type === 'bad' ? '#ef4444' : 'var(--t-muted)' }}>
                    {e.type === 'good' ? 'Dynasty' : e.type === 'bad' ? 'Rebuild' : 'Transition'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Career Leaders */}
        {careerLeaders.length > 0 && (
          <div style={{ flex: 1, minWidth: 0, border: '1px solid var(--surf-border)', borderRadius: 10, background: 'var(--surf-bg)', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--surf-border)', fontFamily: 'var(--font-h1)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)' }}>
              Career Leaders
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup><col style={{ width: '32%' }} /><col /><col style={{ width: '26%' }} /></colgroup>
              <tbody>
                {careerLeaders.map((r, i) => (
                  <tr key={r.stat} style={{ background: i % 2 === 1 ? 'var(--surf-bg-2)' : 'var(--surf-bg)', borderBottom: '1px solid var(--surf-border)' }}>
                    <td style={{ padding: '8px 12px', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', color: ORANGE }}>{r.stat}</td>
                    <td style={{ padding: '8px 12px' }}><PlayerLink slug={r.player_id}>{r.player}</PlayerLink></td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--font-h1)', fontSize: 13, fontWeight: 600, color: 'var(--t-primary)', fontVariantNumeric: 'tabular-nums' }}>
                      {typeof r.count === 'number' ? r.count.toLocaleString() : r.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}



// ── Game Viewer ──────────────────────────────────────────────────────────────

// Build scoring timeline from ufa_game_events (team's perspective).
// For each score event the x-position is the absolute_time of the VERY NEXT event
// in sequence (which is always a point-start with a real clock value).
// event types: 19=Goal, 12=Callahan(we scored), 15=Opp score, 23=Callahan(opp scored)
function buildScoreTimeline(teamEvents) {
  // O(1) lookup: seq → event
  const bySeq = {};
  for (const e of teamEvents) bySeq[e.seq] = e;

  const timeline = [];
  let ts = 0, os = 0;
  const recentOutcomes = [];   // rolling last-5: +1 = we scored, -1 = they scored

  for (const e of teamEvents) {
    const isScore = e.type === 19 || e.type === 12 || e.type === 15 || e.type === 23;
    if (!isScore) continue;

    // Pin at the absolute_time of the next event (point-start after this score)
    const next = bySeq[e.seq + 1];
    const absTime = next?.absolute_time ?? e.absolute_time ?? null;

    // poss: who starts the NEXT point on O?
    //   type 2 (Start O Point for our team) → our team on O next → +1
    //   type 1 (Start D Point for our team) → opp on O next      → -1
    const poss = next ? (next.type === 2 ? 1 : next.type === 1 ? -1 : 0) : 0;

    // momentum: net our-team scoring over the last 5 PRIOR points (before this one)
    const last5 = recentOutcomes.slice(-5);
    const momentum = last5.reduce((a, b) => a + b, 0);

    // line_edge from backend (null when wp_line_edge table not yet populated)
    const lineEdge = e.line_edge ?? null;

    const isTeam = (e.type === 19 || e.type === 12);
    const outcome = isTeam ? 1 : -1;

    if (e.type === 19) {
      ts++;
      timeline.push({ absTime, teamScore: ts, oppScore: os, scorer: e.receiver, assister: e.thrower, isCallahan: false, isTeam: true,  poss, momentum, lineEdge });
    } else if (e.type === 12) {
      ts++;
      timeline.push({ absTime, teamScore: ts, oppScore: os, scorer: e.defender, assister: null,        isCallahan: true,  isTeam: true,  poss, momentum, lineEdge });
    } else if (e.type === 15) {
      os++;
      timeline.push({ absTime, teamScore: ts, oppScore: os, scorer: null,        assister: null,        isCallahan: false, isTeam: false, poss, momentum, lineEdge });
    } else if (e.type === 23) {
      os++;
      timeline.push({ absTime, teamScore: ts, oppScore: os, scorer: null,        assister: null,        isCallahan: true,  isTeam: false, poss, momentum, lineEdge });
    }
    recentOutcomes.push(outcome);
  }
  return timeline;
}

// ── Win Probability Model ────────────────────────────────────────────────────
// Three-tier degradation based on available features:
//
//  FULL    (line_edge known):
//    z = 1.0555·Δ·√(t/T) + 0.0503·poss + 0.1133·momentum + 0.9353·lineEdge
//
//  PARTIAL (no line_edge):
//    z = 1.0555·Δ·√(t/T) + 0.0503·poss + 0.1133·momentum
//
//  BASE    (poss/momentum unavailable — fallback for very early events):
//    z = 1.1008·Δ·√(t/T)   (single-feature model, separate fitted k)
//
// All coefficients fitted from 782 UFA games (logistic regression, no intercept).
// Brier score: full/partial ≈ 0.107, base ≈ 0.1075.
// poss: +1 = our team on O next, -1 = opp on O next.
// momentum: net points over last 5 prior points (range -5 to +5).
// lineEdge: home_O_rate − away_O_rate from rolling C(7,5) subset history.
function winProbByTime(diff, absTime, totalGameTime, poss = 0, momentum = 0, lineEdge = null) {
  const progress = Math.min(1, (absTime + 1) / (totalGameTime + 1));
  const hasPossMom = poss !== 0 || momentum !== 0;
  let z;
  if (hasPossMom || lineEdge != null) {
    z  = 1.0555 * diff * Math.sqrt(progress);
    z += 0.0503  * poss;
    z += 0.1133  * momentum;
    if (lineEdge != null) z += 0.9353 * lineEdge;
  } else {
    // Base model (no context features available)
    z = 1.1008 * diff * Math.sqrt(progress);
  }
  return Math.min(0.98, Math.max(0.02, 1 / (1 + Math.exp(-z))));
}

// Win probability chart SVG
// x-axis = absolute game time in seconds (0 → totalGameTime)
// period_breaks carry { label, absolute_time } for bold dividers
// thin dotted ticks at 25/50/75% within each quarter
function WinProbChart({ timeline, totalGameTime = 2880, periodBreaks = [], teamAbbrev, oppAbbrev, finalTeamScore, finalOppScore, shownspaceWpTimeline }) {
  const [hovIdx, setHovIdx] = useState(null);

  // WP series: start (t=0, WP=50%) + one point per score + end
  // For each score event, prefer shownspace win_prob (matched by game_time_left proximity) over the local model.
  const points = useMemo(() => {
    // Build a lookup map for proximity matching: totalGameTime - gtl ≈ absTime
    // ssWp rows arrive sorted by global_event_seq (not by time), so linear scan is needed.
    const ssWp = shownspaceWpTimeline ?? [];
    function findShownspaceWp(absTime) {
      if (!ssWp.length) return null;
      let best = null, bestDist = Infinity;
      for (const row of ssWp) {
        const dist = Math.abs((totalGameTime - row.gtl) - absTime);
        if (dist < bestDist) { bestDist = dist; best = row; }
      }
      return best?.wp ?? null;
    }

    const pts = [{ x: 0, wp: 0.5 }];
    for (const e of timeline) {
      if (e.absTime == null) continue;
      const ssWpVal = findShownspaceWp(e.absTime);
      pts.push({
        x:     e.absTime,
        wp:    ssWpVal ??
               winProbByTime(e.teamScore - e.oppScore, e.absTime, totalGameTime,
                             e.poss, e.momentum, e.lineEdge),
        event: e,
      });
    }
    pts.push({
      x:  totalGameTime,
      wp: finalTeamScore > finalOppScore ? 0.99 : finalTeamScore < finalOppScore ? 0.01 : 0.5,
    });
    return pts;
  }, [timeline, totalGameTime, finalTeamScore, finalOppScore, shownspaceWpTimeline]);

  const W = 320, H = 320;
  const PAD = { t: 18, r: 16, b: 28, l: 36 };
  const aW = W - PAD.l - PAD.r;
  const aH = H - PAD.t - PAD.b;

  const xScale = t => PAD.l + (t / Math.max(totalGameTime, 1)) * aW;
  const yScale = wp => PAD.t + (1 - wp) * aH;
  const fmtTime = s => { const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };

  const polyline = points.map(p => `${xScale(p.x)},${yScale(p.wp)}`).join(' ');
  const fillPts  = [`${PAD.l},${yScale(0.5)}`, ...points.map(p => `${xScale(p.x)},${yScale(p.wp)}`), `${PAD.l + aW},${yScale(0.5)}`].join(' ');

  const scoreEvents = points.filter(p => p.event);
  const hovPt = hovIdx != null ? scoreEvents[hovIdx] : null;

  // Quarter boundaries from period_breaks; compute quarter tick positions
  // periodBreaks: [{ label:'q1', absolute_time:720 }, { label:'half', ...}, ...]
  const PLABELS = { q1: 'Q2', half: 'HALF', q3: 'Q4', reg: 'END', ot1: 'OT', ot2: 'OT2' };

  // Build periods from breaks so we can generate intra-quarter ticks
  const periodList = useMemo(() => {
    // sorted boundaries: always includes 0 as start, and totalGameTime as end
    const bkTimes = [0, ...periodBreaks.map(b => b.absolute_time), totalGameTime];
    const unique   = [...new Set(bkTimes)].sort((a, b) => a - b);
    const periods  = [];
    for (let i = 0; i < unique.length - 1; i++) {
      periods.push({ start: unique[i], end: unique[i + 1] });
    }
    return periods;
  }, [periodBreaks, totalGameTime]);

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      {/* Background */}
      <rect x={PAD.l} y={PAD.t} width={aW} height={aH} fill="var(--surf-bg-2)" rx={4} />

      {/* Intra-quarter ticks at 25/50/75% within each period */}
      {periodList.map(({ start, end }) =>
        [0.25, 0.5, 0.75].map(f => {
          const tx = xScale(start + (end - start) * f);
          return (
            <line key={`${start}-${f}`}
              x1={tx} y1={PAD.t} x2={tx} y2={PAD.t + aH}
              stroke="var(--surf-border)" strokeWidth={0.5} strokeDasharray="2 3" opacity={0.6} />
          );
        })
      )}

      {/* Period dividers (bold) */}
      {periodBreaks.map(b => {
        const bx = xScale(b.absolute_time);
        return (
          <g key={b.label}>
            <line x1={bx} y1={PAD.t} x2={bx} y2={PAD.t + aH}
              stroke="var(--surf-border)" strokeWidth={1.2} />
            <text x={bx} y={PAD.t + aH + 10} textAnchor="middle"
              fontSize={7} fontFamily="var(--font-h2)" style={{ fill: 'var(--t-muted)' }}>
              {PLABELS[b.label] ?? b.label.toUpperCase()}
            </text>
          </g>
        );
      })}

      {/* 50% line */}
      <line x1={PAD.l} y1={yScale(0.5)} x2={PAD.l + aW} y2={yScale(0.5)}
        stroke="var(--surf-border)" strokeWidth={1} strokeDasharray="4 3" />

      {/* Fill area */}
      <polygon points={fillPts} fill={finalTeamScore >= finalOppScore ? `${ORANGE}22` : '#ef444422'} />

      {/* WP line */}
      <polyline points={polyline} fill="none" stroke={ORANGE} strokeWidth={1.5} strokeLinejoin="round" />

      {/* Score pins */}
      {scoreEvents.map((p, i) => (
        <circle key={i}
          cx={xScale(p.x)} cy={yScale(p.wp)} r={hovIdx === i ? 4.5 : 3}
          fill={p.event.isTeam ? ORANGE : '#ef4444'}
          stroke="var(--surf-bg)" strokeWidth={1}
          style={{ cursor: 'pointer' }}
          onMouseEnter={() => setHovIdx(i)}
          onMouseLeave={() => setHovIdx(null)}
        />
      ))}

      {/* Hover tooltip */}
      {hovPt && (() => {
        const cx  = xScale(hovPt.x);
        const cy  = yScale(hovPt.wp);
        const e   = hovPt.event;
        const TW  = 164, TH = 60;
        const tx  = Math.min(cx + 8, W - TW - 2);
        const ty  = Math.max(2, cy - TH / 2);
        const pct = ((hovPt.x / Math.max(totalGameTime, 1)) * 100).toFixed(0);
        return (
          <g pointerEvents="none">
            <rect x={tx} y={ty} width={TW} height={TH} rx={5}
              style={{ fill: 'var(--card-bg)', stroke: 'var(--surf-border)' }} strokeWidth={1} />
            <text x={tx + 8} y={ty + 14} fontSize={9} fontWeight={600} fontFamily="var(--font-h2)"
              fill={e.isTeam ? ORANGE : '#ef4444'}>
              {e.isTeam ? teamAbbrev : oppAbbrev} — {e.teamScore}–{e.oppScore}
            </text>
            <text x={tx + 8} y={ty + 27} fontSize={9} fontFamily="var(--font-body)" style={{ fill: 'var(--t-primary)' }}>
              {e.isCallahan ? `Callahan: ${e.scorer ?? '?'}` : `${e.scorer ?? '?'} ← ${e.assister ?? '?'}`}
            </text>
            <text x={tx + 8} y={ty + 40} fontSize={8} fontFamily="var(--font-h2)" style={{ fill: 'var(--t-muted)' }}>
              {fmtTime(hovPt.x)} · {pct}% · WP: {(hovPt.wp * 100).toFixed(0)}%
            </text>
          </g>
        );
      })()}

      {/* Y-axis labels */}
      {[0, 0.25, 0.5, 0.75, 1].map(v => (
        <text key={v} x={PAD.l - 4} y={yScale(v)} textAnchor="end" dominantBaseline="middle"
          fontSize={7} fontFamily="var(--font-h2)" style={{ fill: 'var(--t-muted)' }}>
          {(v * 100).toFixed(0)}%
        </text>
      ))}

      {/* X-axis: period midpoint time labels (MM:SS) */}
      {periodList.map(({ start, end }) => {
        const mid = (start + end) / 2;
        return (
          <text key={mid} x={xScale(mid)} y={H - 2} textAnchor="middle"
            fontSize={7} fontFamily="var(--font-h2)" style={{ fill: 'var(--t-muted)' }}>
            {fmtTime(Math.round((start + end) / 2))}
          </text>
        );
      })}

      {/* Team corner labels */}
      <text x={PAD.l + 4} y={PAD.t + 11} fontSize={8} fontFamily="var(--font-h1)" fill={ORANGE}>{teamAbbrev}</text>
      <text x={PAD.l + aW - 4} y={PAD.t + aH - 4} fontSize={8} fontFamily="var(--font-h1)" fill="#ef4444" textAnchor="end">{oppAbbrev}</text>
    </svg>
  );
}

// Box score derived from throw data
// Build box score from ufa_game_events (one perspective each).
// event types — recording team actions:
//   19 = Goal      → receiver scored, thrower assisted
//   12 = Callahan  → defender scored (opp threw into our EZ)
//   20 = Drop      → receiver turned it
//   22 = Throwaway → thrower turned it
//   24 = Stall     → thrower turned it
function buildBoxScore(teamEvents, oppEvents) {
  function buildMap(events) {
    const map = {};
    const track = (name, slug, stat) => {
      const key = slug || name;
      if (!key) return;
      if (!map[key]) map[key] = { name: name ?? slug, goals: 0, assists: 0, turns: 0 };
      map[key][stat]++;
    };
    for (const e of events) {
      if (e.type === 19) {
        track(e.receiver, e.receiver_slug, 'goals');
        track(e.thrower,  e.thrower_slug,  'assists');
      } else if (e.type === 12) {
        track(e.defender, e.defender_slug, 'goals');
      } else if (e.type === 20) {
        track(e.receiver, e.receiver_slug, 'turns');
      } else if (e.type === 22 || e.type === 24) {
        track(e.thrower,  e.thrower_slug,  'turns');
      }
    }
    return Object.entries(map)
      .map(([, s]) => ({ ...s }))
      .filter(r => r.goals > 0 || r.assists > 0 || r.turns > 0)
      .sort((a, b) => (b.goals + b.assists) - (a.goals + a.assists));
  }
  return { team: buildMap(teamEvents), opp: buildMap(oppEvents) };
}

function BoxScoreTable({ rows, abbrev, score, isTeam }) {
  const accent = isTeam ? ORANGE : '#ef4444';
  return (
    <div style={{ flex: 1, minWidth: 0, border: '1px solid var(--surf-border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surf-bg)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--surf-border)', background: 'var(--surf-bg-2)' }}>
        <span style={{ fontFamily: 'var(--font-h1)', fontSize: 13, fontWeight: 700, color: accent }}>{abbrev}</span>
        <span style={{ fontFamily: 'var(--font-h1)', fontSize: 20, fontWeight: 700, color: accent }}>{score}</span>
      </div>
      <div className="orange-scroll" style={{ maxHeight: 240, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '52%' }} /><col style={{ width: '16%' }} /><col style={{ width: '16%' }} /><col style={{ width: '16%' }} />
          </colgroup>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
              {['Player', 'G', 'A', 'TO'].map((h, i) => (
                <th key={h} style={{ padding: '5px 8px', fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', fontWeight: 400, textAlign: i === 0 ? 'left' : 'center', position: 'sticky', top: 0, background: 'var(--surf-bg)', zIndex: 1 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--surf-border)', background: i % 2 === 1 ? 'var(--surf-bg-2)' : 'transparent' }}>
                <td style={{ padding: '5px 8px', fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name ?? r.id}</td>
                <td style={{ padding: '5px 8px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 11, color: r.goals > 0 ? '#22c55e' : 'var(--t-muted)', fontWeight: r.goals > 0 ? 600 : 400 }}>{r.goals || '—'}</td>
                <td style={{ padding: '5px 8px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 11, color: r.assists > 0 ? '#3b82f6' : 'var(--t-muted)', fontWeight: r.assists > 0 ? 600 : 400 }}>{r.assists || '—'}</td>
                <td style={{ padding: '5px 8px', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 11, color: r.turns > 0 ? '#ef4444' : 'var(--t-muted)' }}>{r.turns || '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} style={{ padding: '16px 8px', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>No stats</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Game field chart — events coordinate system: X −26.67…26.67, Y 0…120
// Y=0–20: defending end zone, Y=20–100: playing field, Y=100–120: scoring end zone
// Orange = team (our events), Red = opponent (their events from opp_events)
function GameField2D({ teamEvents, oppEvents, shownspaceThrows, shownspacePulls, ssIsHomeTeam }) {
  // Field constants in data coordinates
  const FX0 = -26.67, FW = 53.34;
  const FY0 = 0, FH = 120, EZH = 20;

  // Prefer shownspace data when available; fall back to legacy ufa_game_events
  const renderData = useMemo(() => {
    if (shownspaceThrows && shownspaceThrows.length > 0) {
      // Shownspace path: is_home_team determines team vs opp
      const throws = shownspaceThrows.map(t => ({
        ...t,
        isTeam: ssIsHomeTeam ? t.is_home_team === 1 : t.is_home_team === 0,
      }));
      const pulls = (shownspacePulls ?? []).map(p => ({
        ...p,
        isTeam: ssIsHomeTeam ? p.is_home_team === 1 : p.is_home_team === 0,
      }));
      return { throws, pulls, isShownspace: true };
    }
    // Legacy fallback
    const THROW_TYPES = new Set([18, 19, 20, 22]);
    const teamSet = new Set(teamEvents.filter(e => THROW_TYPES.has(e.type) && e.thrower_x != null));
    const all = [
      ...teamEvents.filter(e => THROW_TYPES.has(e.type) && e.thrower_x != null).map(e => ({ ...e, isTeam: true })),
      ...oppEvents.filter(e => THROW_TYPES.has(e.type) && e.thrower_x != null).map(e => ({ ...e, isTeam: false })),
    ];
    return { throws: all, pulls: [], isShownspace: false };
  }, [teamEvents, oppEvents, shownspaceThrows, shownspacePulls, ssIsHomeTeam]);

  const { throws, pulls } = renderData;
  const sample = throws.length > 3000
    ? throws.filter((_, i) => i % Math.ceil(throws.length / 3000) === 0)
    : throws;

  return (
    <svg viewBox={`${FX0 - 1} ${FY0 - 1} ${FW + 2} ${FH + 2}`}
      style={{ width: '100%', height: '100%', display: 'block' }}
      preserveAspectRatio="xMidYMid meet">
      <defs>
        <clipPath id="gf2-clip">
          <rect x={FX0} y={FY0} width={FW} height={FH} />
        </clipPath>
      </defs>
      {/* Field background */}
      <rect x={FX0} y={FY0} width={FW} height={FH} fill="#f9f9f9" />
      {/* End zones */}
      <rect x={FX0} y={FY0}           width={FW} height={EZH}  fill="#fde8d8" />
      <rect x={FX0} y={FH - EZH}      width={FW} height={EZH}  fill="#fde8d8" />
      {/* Playing field */}
      <rect x={FX0} y={FY0 + EZH}     width={FW} height={FH - 2 * EZH} fill="#f9f9f9" />
      {/* Border */}
      <rect x={FX0} y={FY0} width={FW} height={FH} fill="none" stroke={ORANGE} strokeWidth={0.8} />
      {/* Goal lines */}
      <line x1={FX0} y1={EZH}       x2={FX0 + FW} y2={EZH}       stroke={ORANGE} strokeWidth={0.5} />
      <line x1={FX0} y1={FH - EZH}  x2={FX0 + FW} y2={FH - EZH}  stroke={ORANGE} strokeWidth={0.5} />
      {/* Half-field */}
      <line x1={FX0} y1={FH / 2}    x2={FX0 + FW} y2={FH / 2}    stroke={ORANGE} strokeWidth={0.4} strokeDasharray="2 2" opacity={0.5} />
      <g clipPath="url(#gf2-clip)">
        {/* Pulls — dotted blue lines from Y=0 end zone back line to landing spot */}
        {pulls.map((p, i) => {
          if (p.pull_x == null || p.pull_y == null) return null;
          return (
            <line key={`pull-${i}`}
              x1={0} y1={FY0}
              x2={p.pull_x} y2={p.pull_y}
              stroke="#60a5fa" strokeWidth={0.5} strokeDasharray="2 1.5" opacity={0.55}
            />
          );
        })}
        {/* Throws */}
        {sample.map((t, i) => {
          const color = t.isTeam ? ORANGE : '#ef4444';
          const tx = t.thrower_x, ty = t.thrower_y;
          const rx = t.receiver_x ?? t.turnover_x;
          const ry = t.receiver_y ?? t.turnover_y;
          if (tx == null || ty == null) return null;
          if (rx == null || ry == null) {
            const s = 0.9;
            return <g key={i} opacity={0.6}><line x1={tx-s} y1={ty-s} x2={tx+s} y2={ty+s} stroke={color} strokeWidth={0.5} /><line x1={tx+s} y1={ty-s} x2={tx-s} y2={ty+s} stroke={color} strokeWidth={0.5} /></g>;
          }
          return (
            <g key={i}>
              <line x1={tx} y1={ty} x2={rx} y2={ry} stroke={color} strokeWidth={0.4} opacity={0.45} />
              <circle cx={rx} cy={ry} r={0.55} fill={color} opacity={0.7} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

// Game stat pill chips
function StatChip({ label, value, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '6px 12px', background: 'var(--surf-bg-2)', borderRadius: 6, border: '1px solid var(--surf-border)' }}>
      <span style={{ fontFamily: 'var(--font-h1)', fontSize: 16, fontWeight: 700, color: color ?? 'var(--t-primary)', lineHeight: 1 }}>{value}</span>
      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>{label}</span>
    </div>
  );
}

function GameViewerPanel({ franchiseId, teamAbbr, teamName }) {
  const [allGames,       setAllGames]       = useState(null);
  const [gamesStatus,    setGamesStatus]    = useState('loading');
  const [selectedGameId, setSelectedGameId] = useState(null);
  const [eventsCache,    setEventsCache]    = useState({});   // game_id → API response
  const [eventsLoading,  setEventsLoading]  = useState(false);

  // Filters
  const [filterYear,       setFilterYear]       = useState('all');
  const [filterOpponent,   setFilterOpponent]   = useState('all');

  // Load all games once
  useEffect(() => {
    let cancelled = false;
    setGamesStatus('loading');
    fetch(`/api/ufa/franchise/${franchiseId}/games`)
      .then(r => r.json())
      .then(gData => {
        if (cancelled) return;
        setAllGames(gData.games);
        setGamesStatus('ready');
      })
      .catch(() => { if (!cancelled) setGamesStatus('error'); });
    return () => { cancelled = true; };
  }, [franchiseId]);

  // Available opponent options
  const opponentOptions = useMemo(() => {
    if (!allGames) return [];
    const map = new Map();
    allGames.forEach(g => {
      if (!map.has(g.opp_franchise_id ?? g.opp_slug)) {
        map.set(g.opp_franchise_id ?? g.opp_slug, g.opp_abbrev);
      }
    });
    return [...map.entries()]
      .map(([id, abbrev]) => ({ id, abbrev }))
      .sort((a, b) => a.abbrev.localeCompare(b.abbrev));
  }, [allGames]);

  // Available year options
  const yearOptions = useMemo(() => {
    if (!allGames) return [];
    return [...new Set(allGames.map(g => g.year))].sort((a, b) => b - a);
  }, [allGames]);

  // Filtered game list
  const filteredGames = useMemo(() => {
    if (!allGames) return [];
    return allGames.filter(g => {
      if (filterYear !== 'all' && g.year !== Number(filterYear)) return false;
      if (filterOpponent !== 'all') {
        const key = g.opp_franchise_id ?? g.opp_slug;
        if (key !== filterOpponent) return false;
      }
      return true;
    });
  }, [allGames, filterYear, filterOpponent]);

  // Auto-select most recent game when filter changes
  useEffect(() => {
    if (filteredGames.length > 0) {
      setSelectedGameId(filteredGames[filteredGames.length - 1].game_id);
    } else {
      setSelectedGameId(null);
    }
  }, [filteredGames]);

  const selectedGame = useMemo(
    () => allGames?.find(g => g.game_id === selectedGameId) ?? null,
    [allGames, selectedGameId]
  );

  // Load events for selected game (cached by game_id)
  useEffect(() => {
    if (!selectedGameId) return;
    if (eventsCache[selectedGameId]) return;
    let cancelled = false;
    setEventsLoading(true);
    fetch(`/api/ufa/games/${selectedGameId}/events?franchise_id=${franchiseId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        if (cancelled) return;
        setEventsCache(prev => ({ ...prev, [selectedGameId]: data }));
        setEventsLoading(false);
      })
      .catch(() => { if (!cancelled) setEventsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedGameId, franchiseId]);

  const eventsData   = eventsCache[selectedGameId] ?? null;
  const teamEvents   = eventsData?.team_events  ?? [];
  const oppEvents    = eventsData?.opp_events   ?? [];
  const periodBreaks = eventsData?.period_breaks ?? [];
  const totalGameTime = eventsData?.total_game_time ?? 2880;

  // Display abbreviation: prefer the events API's resolved abbrev
  const curAbbr    = eventsData?.team_abbrev ?? teamAbbr;
  const oppAbbrev  = eventsData?.opp_abbrev  ?? selectedGame?.opp_abbrev ?? '';

  const scoreTimeline = useMemo(() => buildScoreTimeline(teamEvents), [teamEvents]);

  // Box score: prefer shownspace player_stats when available, fall back to derived
  const boxScore = useMemo(() => {
    const ps = eventsData?.player_stats;
    if (ps && (ps.team?.length || ps.opp?.length)) {
      return { team: ps.team ?? [], opp: ps.opp ?? [] };
    }
    return buildBoxScore(teamEvents, oppEvents);
  }, [eventsData, teamEvents, oppEvents]);

  // Aggregate stats from event types
  const gameStats = useMemo(() => {
    if (!teamEvents.length) return null;
    // Completions = passes + goals; attempts = those + drops + throwaways + stalls
    const COMP_TYPES = new Set([18, 19]);
    const TO_TYPES   = new Set([20, 22, 24]);
    const teamComp   = teamEvents.filter(e => COMP_TYPES.has(e.type)).length;
    const teamTurns  = teamEvents.filter(e => TO_TYPES.has(e.type)).length;
    const teamAtt    = teamComp + teamTurns;
    // Opponent turnovers visible from our perspective: type 13=throwaway, 14=stall, 11=block-causing-TO
    const OPP_TO_TYPES = new Set([13, 14]);
    const oppTurns   = teamEvents.filter(e => OPP_TO_TYPES.has(e.type)).length;
    return {
      teamComp, teamAtt,
      compPct: teamAtt > 0 ? (teamComp / teamAtt * 100).toFixed(1) : null,
      teamTurns, oppTurns,
      teamThrows: teamEvents.filter(e => COMP_TYPES.has(e.type) || TO_TYPES.has(e.type)).length,
      oppThrows: oppEvents.filter(e => COMP_TYPES.has(e.type) || TO_TYPES.has(e.type)).length,
    };
  }, [teamEvents, oppEvents]);

  const selectStyle = {
    background: 'var(--surf-bg)',
    color: 'var(--t-primary)',
    border: '1px solid var(--surf-border)',
    borderRadius: 6,
    padding: '5px 8px',
    fontFamily: 'var(--font-h2)',
    fontSize: 10,
    letterSpacing: '0.5px',
    cursor: 'pointer',
    minWidth: 90,
  };

  const LABEL = { fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-secondary)', marginBottom: 4 };

  if (gamesStatus === 'loading') return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>Loading…</div>
  );
  if (gamesStatus === 'error') return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: ORANGE }}>Failed to load games.</div>
  );

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0, overflow: 'hidden' }}>

      {/* ── Left sidebar: filters + game list ── */}
      <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--surf-border)', background: 'var(--surf-bg)', overflow: 'hidden' }}>

        {/* Filters */}
        <div style={{ padding: '14px 12px 10px', borderBottom: '1px solid var(--surf-border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontFamily: 'var(--font-h1)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)' }}>Games</div>
          <div>
            <div style={LABEL}>Year</div>
            <select className="orange-scroll" value={filterYear} onChange={e => setFilterYear(e.target.value)} style={selectStyle}>
              <option value="all">All Years</option>
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <div style={LABEL}>Opponent</div>
            <select className="orange-scroll" value={filterOpponent} onChange={e => setFilterOpponent(e.target.value)} style={{ ...selectStyle, maxWidth: 196 }}>
              <option value="all">All Opponents</option>
              {opponentOptions.map(o => <option key={o.id} value={o.id}>{o.abbrev}</option>)}
            </select>
          </div>
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)' }}>
            {filteredGames.length} game{filteredGames.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Game list */}
        <div className="orange-scroll" style={{ flex: 1, overflowY: 'auto' }}>
          {filteredGames.length === 0 && (
            <div style={{ padding: '24px 12px', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>No games found</div>
          )}
          {filteredGames.map(g => {
            const isSelected = g.game_id === selectedGameId;
            const rc = g.result === 'W' ? '#22c55e' : g.result === 'L' ? '#ef4444' : 'var(--t-muted)';
            return (
              <div key={g.game_id}
                onClick={() => setSelectedGameId(g.game_id)}
                style={{
                  padding: '9px 12px',
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--surf-border)',
                  background: isSelected ? `${ORANGE}18` : 'transparent',
                  borderLeft: isSelected ? `3px solid ${ORANGE}` : '3px solid transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = `${ORANGE}0a`; }}
                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                  <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', letterSpacing: '0.5px' }}>
                    {g.year} · {g.week?.replace('-', ' ') ?? ''}
                  </span>
                  <span style={{ fontFamily: 'var(--font-h1)', fontSize: 11, fontWeight: 700, color: rc }}>{g.result}</span>
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-primary)', fontWeight: isSelected ? 600 : 400 }}>
                  vs {g.opp_abbrev}
                </div>
                <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: rc, marginTop: 1 }}>
                  {g.team_score}–{g.opp_score}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="orange-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {!selectedGame && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase' }}>
            Select a game
          </div>
        )}

        {selectedGame && (<>

          {/* ── Game header ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '16px 20px', background: 'var(--surf-bg)', border: '1px solid var(--surf-border)', borderRadius: 10 }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-h1)', fontSize: 28, fontWeight: 700, color: ORANGE }}>{selectedGame.team_score}</div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-secondary)', marginTop: 2 }}>{curAbbr}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>{selectedGame.home ? 'Home' : 'Away'}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)', letterSpacing: '1px' }}>
                {selectedGame.date} · {selectedGame.week?.replace('-', ' ') ?? ''}
              </div>
              <div style={{ fontFamily: 'var(--font-h1)', fontSize: 18, color: selectedGame.result === 'W' ? '#22c55e' : '#ef4444', marginTop: 4 }}>
                {selectedGame.result === 'W' ? 'WIN' : selectedGame.result === 'L' ? 'LOSS' : 'TIE'}
              </div>
              {/* Game video links (shownspace) */}
              {eventsData?.links && (
                <div style={{ marginTop: 6, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {eventsData.links.yt_highlights && (
                    <a href={eventsData.links.yt_highlights} target="_blank" rel="noopener noreferrer"
                       style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', color: ORANGE, textDecoration: 'none', opacity: 0.8 }}>
                      Highlights ↗
                    </a>
                  )}
                  {eventsData.links.yt_full && (
                    <a href={eventsData.links.yt_full} target="_blank" rel="noopener noreferrer"
                       style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', color: ORANGE, textDecoration: 'none', opacity: 0.8 }}>
                      Full Game ↗
                    </a>
                  )}
                  {eventsData.links.watchufa_full && (
                    <a href={eventsData.links.watchufa_full} target="_blank" rel="noopener noreferrer"
                       style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', color: ORANGE, textDecoration: 'none', opacity: 0.8 }}>
                      WatchUFA ↗
                    </a>
                  )}
                </div>
              )}
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--font-h1)', fontSize: 28, fontWeight: 700, color: '#ef4444' }}>{selectedGame.opp_score}</div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-secondary)', marginTop: 2 }}>{oppAbbrev}</div>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>{selectedGame.home ? 'Away' : 'Home'}</div>
            </div>
          </div>

          {/* ── Loading events indicator ── */}
          {eventsLoading && (
            <div style={{ textAlign: 'center', padding: '12px 0', fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>Loading game data…</div>
          )}

          {/* ── Game stats chips ── */}
          {!eventsLoading && teamEvents.length > 0 && gameStats && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <StatChip label="Completions" value={`${gameStats.teamComp}/${gameStats.teamAtt}`} color={ORANGE} />
              <StatChip label="Comp%" value={gameStats.compPct ? `${gameStats.compPct}%` : '—'} color={ORANGE} />
              <StatChip label="Our TOs" value={gameStats.teamTurns} color={gameStats.teamTurns <= 3 ? '#22c55e' : gameStats.teamTurns >= 7 ? '#ef4444' : 'var(--t-primary)'} />
              <StatChip label="Opp TOs" value={gameStats.oppTurns} color={gameStats.oppTurns >= 5 ? '#22c55e' : 'var(--t-primary)'} />
              <StatChip label="Throw Ratio" value={`${gameStats.teamThrows} : ${gameStats.oppThrows}`} />
            </div>
          )}

          {/* ── Field chart + Win Probability + Box score ── */}
          {!eventsLoading && teamEvents.length > 0 && (
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>

              {/* Field chart */}
              <div style={{ flex: '0 0 360px', background: 'var(--surf-bg)', border: '1px solid var(--surf-border)', borderRadius: 10, padding: '12px 12px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontFamily: 'var(--font-h1)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)' }}>Field Chart</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 10, height: 3, background: ORANGE, borderRadius: 1 }} />
                    <span style={{ fontFamily: 'var(--font-h2)', fontSize: 8, color: 'var(--t-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>{curAbbr}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <div style={{ width: 10, height: 3, background: '#ef4444', borderRadius: 1 }} />
                    <span style={{ fontFamily: 'var(--font-h2)', fontSize: 8, color: 'var(--t-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>{oppAbbrev}</span>
                  </div>
                </div>
                <div style={{ aspectRatio: '54/122' }}>
                  <GameField2D
                    teamEvents={teamEvents}
                    oppEvents={oppEvents}
                    shownspaceThrows={eventsData?.shownspace_throws}
                    shownspacePulls={eventsData?.shownspace_pulls}
                    ssIsHomeTeam={eventsData?.ss_is_home_team}
                  />
                </div>
              </div>

              {/* Win probability chart */}
              {scoreTimeline.length > 0 && (
                <div style={{ flex: '0 0 320px', background: 'var(--surf-bg)', border: '1px solid var(--surf-border)', borderRadius: 10, padding: '12px 12px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontFamily: 'var(--font-h1)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)' }}>Win Probability</div>
                  <WinProbChart
                    timeline={scoreTimeline}
                    totalGameTime={totalGameTime}
                    periodBreaks={periodBreaks}
                    teamAbbrev={curAbbr}
                    oppAbbrev={oppAbbrev}
                    finalTeamScore={selectedGame.team_score}
                    finalOppScore={selectedGame.opp_score}
                    shownspaceWpTimeline={eventsData?.shownspace_wp_timeline}
                  />
                </div>
              )}

              {/* Box score */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ fontFamily: 'var(--font-h1)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)' }}>Box Score</div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <BoxScoreTable rows={boxScore.team} abbrev={curAbbr}   score={selectedGame.team_score} isTeam={true}  />
                  <BoxScoreTable rows={boxScore.opp}  abbrev={oppAbbrev} score={selectedGame.opp_score}  isTeam={false} />
                </div>

                {/* Scoring sequence */}
                {scoreTimeline.length > 0 && (
                  <div style={{ background: 'var(--surf-bg)', border: '1px solid var(--surf-border)', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontFamily: 'var(--font-h1)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)', marginBottom: 8 }}>Scoring Sequence</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {scoreTimeline.map((e, i) => (
                        <div key={i} style={{
                          padding: '3px 7px',
                          borderRadius: 4,
                          background: e.isTeam ? `${ORANGE}22` : '#ef444422',
                          border: `1px solid ${e.isTeam ? ORANGE : '#ef4444'}55`,
                          fontFamily: 'var(--font-h2)',
                          fontSize: 9,
                          color: e.isTeam ? ORANGE : '#ef4444',
                          cursor: 'default',
                        }}
                          title={e.isCallahan ? `Callahan: ${e.scorer ?? '?'}` : `${e.scorer ?? '?'} from ${e.assister ?? '?'}`}
                        >
                          {e.teamScore}–{e.oppScore}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* No event data fallback */}
          {!eventsLoading && !eventsData && (
            <div style={{ textAlign: 'center', padding: '40px 0', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--t-muted)' }}>
              No play-by-play data available for this game.
            </div>
          )}

        </>)}
      </div>
    </div>
  );
}

function ComingSoon({ tab }) {
  const label = TABS.find(t => t.key === tab)?.label ?? tab;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 200, gap: 12, opacity: 0.45 }}>
      <div style={{ fontFamily: 'var(--font-h1)', fontSize: 'clamp(2rem, 5vw, 4rem)', color: 'var(--t-muted)', textTransform: 'uppercase', letterSpacing: '-0.02em' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>
        Coming Soon
      </div>
    </div>
  );
}

function ActiveBadge({ active }) {
  return (
    <span style={{
      fontFamily: 'var(--font-h2)',
      fontSize: 8,
      letterSpacing: '1.5px',
      textTransform: 'uppercase',
      padding: '2px 7px',
      borderRadius: 4,
      background: active ? 'rgba(34,197,94,0.15)' : 'rgba(148,163,184,0.12)',
      color: active ? '#22c55e' : 'var(--t-muted)',
      border: active ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(148,163,184,0.2)',
      display: 'inline-block',
    }}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}
