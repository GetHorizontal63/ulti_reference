import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import LeagueShell from '../components/LeagueShell.jsx';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

const GENDER_COLOR = { Men: '#3B82F6', Women: '#EC4899', Mixed: '#8B5CF6', Boys: '#3B82F6', Girls: '#EC4899' };
const GENDER_ORDER = ['Women', 'Men', 'Mixed', 'Boys', 'Girls'];

function suffixRank(team) {
  if (!team.is_b_team) return 0;
  const s = (team.b_team_suffix || 'B').toUpperCase();
  return s.charCodeAt(0) - 64;
}

function teamLabel(team, genderTeams) {
  const g = team.gender_division;
  const gLabel = g === 'Women' ? "Women's" : g === 'Men' ? "Men's" : g || 'Team';
  if (genderTeams.length <= 1) return gLabel;
  const sfx = team.is_b_team ? (team.b_team_suffix || 'B').toUpperCase() : 'A';
  return `${gLabel} ${sfx}`;
}

function fmt(val, decimals = 3) {
  if (val == null) return '—';
  return typeof val === 'number' ? val.toFixed(decimals) : val;
}

// ── Team content panel ───────────────────────────────────────────────────────
function TeamPanel({ team, selectedYear }) {
  const [seasonData,    setSeasonData]    = useState(null);
  const [seasonStatus,  setSeasonStatus]  = useState('idle');

  // Fetch season stats whenever selected year changes
  useEffect(() => {
    if (!team || !selectedYear) return;
    let cancelled = false;
    setSeasonStatus('loading');
    setSeasonData(null);
    fetch(`/api/usau/teams/${team.usau_team_id}/season/${selectedYear}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setSeasonData(d); setSeasonStatus('ready'); } })
      .catch(() => { if (!cancelled) setSeasonStatus('error'); });
    return () => { cancelled = true; };
  }, [team?.usau_team_id, selectedYear]);

  if (!team) return <EmptyState message="No teams linked yet." />;

  const accentColor = 'var(--orange)';

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Body */}
      {seasonStatus === 'loading' && (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase' }}>Loading…</div>
      )}
      {seasonStatus === 'error' && <EmptyState message="Failed to load season data." />}
      {seasonStatus === 'ready' && seasonData && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch' }}>

          {/* ── Left 80%: stats + tournaments ── */}
          <div style={{ flex: '0 0 80%', minWidth: 0, paddingRight: 32, display: 'flex', flexDirection: 'column' }}>

            <SectionHeader>Team Season Stats</SectionHeader>
            {/* Stat callouts */}
            {(() => {
              const totalGames = (seasonData.wins ?? 0) + (seasonData.losses ?? 0) + (seasonData.ties ?? 0);
              const ppg  = totalGames > 0 ? (seasonData.points_for  / totalGames).toFixed(2) : '—';
              const papg = totalGames > 0 ? (seasonData.points_against / totalGames).toFixed(2) : '—';
              const pdpg = totalGames > 0 ? ((seasonData.point_diff ?? 0) / totalGames).toFixed(2) : null;
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16, marginBottom: 32 }}>
                  <StatCard
                    label="Record"
                    value={`${seasonData.wins}–${seasonData.losses}${seasonData.ties > 0 ? `–${seasonData.ties}` : ''}`}
                    accent={accentColor}
                    sub={`${totalGames} game${totalGames !== 1 ? 's' : ''} played`}
                  />
                  <StatCard
                    label="Win %"
                    value={seasonData.win_pct != null ? seasonData.win_pct.toFixed(3) : '—'}
                    accent={accentColor}
                    sub={`${seasonData.wins}W · ${seasonData.losses}L`}
                  />
                  <StatCard
                    label="Pyth W%"
                    value={seasonData.pythagorean != null ? seasonData.pythagorean.toFixed(3) : '—'}
                    accent={accentColor}
                    sub={`${seasonData.points_for} PF · ${seasonData.points_against} PA`}
                  />
                  <StatCard
                    label="Point Diff"
                    value={seasonData.point_diff != null
                      ? (seasonData.point_diff > 0 ? '+' : '') + seasonData.point_diff
                      : '—'}
                    accent={accentColor}
                    sub={pdpg != null ? `${pdpg > 0 ? '+' : ''}${pdpg} per game` : undefined}
                  />
                  <StatCard
                    label="Pts / Gm"
                    value={ppg}
                    accent={accentColor}
                    sub={`${seasonData.points_for} total scored`}
                  />
                  <StatCard
                    label="PA / Gm"
                    value={papg}
                    accent={accentColor}
                    sub={`${seasonData.points_against} total allowed`}
                  />
                </div>
              );
            })()}

            {/* Tournaments */}
            <SectionHeader>Tournaments</SectionHeader>
            {seasonData.tournaments.length === 0 && <EmptyState message="No tournaments found." />}
            {seasonData.tournaments.length > 0 && (
              <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', borderRadius: 2 }}>
                <TournamentList tournaments={seasonData.tournaments} accentColor={accentColor} />
              </div>
            )}
          </div>

          {/* ── Right 20%: roster ── */}
          <div style={{ flex: '0 0 20%', minWidth: 0 }}>
            <SectionHeader>Roster</SectionHeader>
            {seasonData.roster.length === 0 && <EmptyState message="No roster." />}
            {seasonData.roster.length > 0 && (
              <div className="orange-scroll" style={{ borderRadius: 2, border: '1px solid var(--card-border-clr)', borderTop: '2px solid var(--orange)', background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', boxShadow: 'var(--card-shadow)', overflow: 'hidden', overflowY: 'auto', maxHeight: '100%' }}>
                {seasonData.roster.map((p, i) => (
                  <div key={`${p.player_name}-${i}`} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '9px 14px',
                    background: i % 2 === 0 ? 'var(--surf-bg)' : 'var(--surf-bg-2)',
                    borderBottom: i < seasonData.roster.length - 1 ? '1px solid var(--surf-border)' : 'none',
                  }}>
                    {p.master_id
                      ? <Link to={`/players/${p.master_id}`}
                          target="_blank" rel="noreferrer"
                          style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-primary)', fontWeight: 600, textDecoration: 'none' }}
                          onMouseEnter={e => e.target.style.color = accentColor}
                          onMouseLeave={e => e.target.style.color = 'var(--t-primary)'}
                        >{p.player_name}</Link>
                      : <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-primary)', fontWeight: 600 }}>{p.player_name}</span>
                    }
                    {p.jersey_number && (
                      <span style={{ fontSize: 10, color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', flexShrink: 0 }}>#{p.jersey_number}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function USAUProgramPage() {
  const { programId } = useParams();
  const [data,          setData]         = useState(null);
  const [status,        setStatus]       = useState('loading');
  const [activeSlotKey, setActiveSlotKey] = useState(null);
  const [seasons,       setSeasons]      = useState([]);
  const [yearTeamMap,   setYearTeamMap]  = useState({});  // year → usau_team_id
  const [selectedYear,  setSelectedYear] = useState(null);
  const [activeView,    setActiveView]   = useState('season'); // 'season' | 'history'

  const tabsScrollRef = useRef(null);
  const [canScrollLeft,  setCanScrollLeft]  = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollBtns = useCallback(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    const el = tabsScrollRef.current;
    if (!el) return;
    updateScrollBtns();
    el.addEventListener('scroll', updateScrollBtns);
    const ro = new ResizeObserver(updateScrollBtns);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', updateScrollBtns); ro.disconnect(); };
  }, [updateScrollBtns]);

  useEffect(() => {
    if (!programId) return;
    let cancelled = false;
    setStatus('loading');
    setActiveSlotKey(null);
    fetch(`/api/usau/programs/${programId}`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d  => { if (!cancelled) { setData(d); setStatus('ready'); } })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [programId]);

  const program = data?.program ?? null;
  const teams   = data?.teams   ?? [];

  const logoSrc = program
    ? (program.logo_url
        ? (program.logo_url.startsWith('/') ? `${BASE}${program.logo_url}` : program.logo_url)
        : (program.logo_filename ? `${BASE}/assets/png/USAU_teams/${program.logo_filename}` : null))
    : null;

  const orderedSlots = useMemo(() => {
    const isClub = program?.competition_level === 'Club';

    if (isClub) {
      // Club: one slot per team — no grouping
      return [...teams]
        .sort((a, b) => {
          const gi = GENDER_ORDER.indexOf(a.gender_division);
          const gj = GENDER_ORDER.indexOf(b.gender_division);
          const gd = (gi === -1 ? 99 : gi) - (gj === -1 ? 99 : gj);
          if (gd !== 0) return gd;
          return suffixRank(a) - suffixRank(b);
        })
        .map(t => ({
          key: t.usau_team_id,
          gender_division: t.gender_division,
          suffix: t.b_team_suffix ? t.b_team_suffix.toUpperCase() : 'A',
          teams: [t],
        }));
    }

    // College / Youth: group by (gender_division, b_team_suffix) across seasons
    const slotMap = {};
    for (const t of teams) {
      const g   = t.gender_division || 'Mixed';
      const sfx = t.b_team_suffix ? t.b_team_suffix.toUpperCase() : 'A';
      const key = `${g}__${sfx}`;
      if (!slotMap[key]) slotMap[key] = { key, gender_division: g, suffix: sfx, teams: [] };
      slotMap[key].teams.push(t);
    }
    return Object.values(slotMap).sort((a, b) => {
      const gi = GENDER_ORDER.indexOf(a.gender_division);
      const gj = GENDER_ORDER.indexOf(b.gender_division);
      const gd = (gi === -1 ? 99 : gi) - (gj === -1 ? 99 : gj);
      return gd !== 0 ? gd : a.suffix.localeCompare(b.suffix);
    });
  }, [teams, program?.competition_level]);

  // Re-check scroll arrows whenever the slot list changes
  useEffect(() => { updateScrollBtns(); }, [orderedSlots, updateScrollBtns]);

  const activeSlot = useMemo(() =>
    orderedSlots.find(s => s.key === activeSlotKey) ?? orderedSlots[0] ?? null,
  [orderedSlots, activeSlotKey]);

  // Derived: team to use for the currently selected year
  const activeTeamForYear = useMemo(() => {
    if (!activeSlot) return null;
    const tid = selectedYear != null ? yearTeamMap[selectedYear] : null;
    return (tid ? activeSlot.teams.find(t => t.usau_team_id === tid) : null)
        ?? activeSlot.teams[0]
        ?? null;
  }, [activeSlot, selectedYear, yearTeamMap]);

  // Fetch seasons when active slot changes — union across all team_ids in the slot
  const slotTeamIds = activeSlot ? activeSlot.teams.map(t => t.usau_team_id).sort().join(',') : '';
  useEffect(() => {
    if (!activeSlot) { setSeasons([]); setYearTeamMap({}); setSelectedYear(null); return; }
    let cancelled = false;
    setSeasons([]);
    setYearTeamMap({});
    setSelectedYear(null);
    Promise.all(
      activeSlot.teams.map(t =>
        fetch(`/api/usau/teams/${t.usau_team_id}/seasons`)
          .then(r => r.json())
          .then(yrs => yrs.map(y => ({ year: y, team_id: t.usau_team_id })))
          .catch(() => [])
      )
    ).then(results => {
      if (cancelled) return;
      // Build year→team_id map; if two teams share a year, prefer higher event_appearances
      const map = {};
      const appsMap = Object.fromEntries(activeSlot.teams.map(t => [t.usau_team_id, t.event_appearances || 0]));
      results.flat().forEach(({ year, team_id }) => {
        if (!map[year] || appsMap[team_id] > appsMap[map[year]]) map[year] = team_id;
      });
      const yrs = Object.keys(map).map(Number).sort((a, b) => b - a);
      setYearTeamMap(map);
      setSeasons(yrs);
      if (yrs.length > 0) setSelectedYear(yrs[0]);
    });
    return () => { cancelled = true; };
  }, [slotTeamIds]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <LeagueShell league="usau">
        {/* ── States ── */}
        {status === 'loading' && (
          <div style={{ padding: '64px 32px', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase' }}>
            Loading…
          </div>
        )}
        {status === 'error' && (
          <div style={{ padding: '64px 32px', textAlign: 'center', color: 'var(--orange)', fontSize: 13, fontFamily: 'var(--font-body)' }}>
            Program not found.
          </div>
        )}

        {/* ── Content ── */}
        {status === 'ready' && program && (
          <>
            {/* ── Hero ── */}
            <div style={{ padding: '144px 32px 20px', display: 'flex', gap: 28, alignItems: 'flex-start', position: 'relative', overflow: 'hidden', background: '#fff' }}>
              {logoSrc && (
                <img src={logoSrc} aria-hidden="true" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', height: '160%', width: 'auto', opacity: 0.1, pointerEvents: 'none', zIndex: 0 }} />
              )}
              {logoSrc && (
                <img src={logoSrc} alt={program.canonical_name} style={{ width: 72, height: 72, objectFit: 'contain', flexShrink: 0, alignSelf: 'flex-end', position: 'relative', zIndex: 1 }} />
              )}
              <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
                {/* Social links */}
                {(() => {
                  const links = [
                    { key: 'web',       url: program.web_url,       title: 'Website',   icon: (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    )},
                    { key: 'instagram',  url: program.instagram_url, title: 'Instagram', icon: (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
                    )},
                    { key: 'facebook',   url: program.facebook_url,  title: 'Facebook',  icon: (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
                    )},
                    { key: 'twitter',    url: program.twitter_url,   title: 'Twitter/X', icon: (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.737-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    )},
                    { key: 'bluesky',    url: program.bluesky_url,   title: 'Bluesky',   icon: (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.204-.659-.299-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/></svg>
                    )},
                  ].filter(l => l.url);
                  if (!links.length) return null;
                  return (
                    <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                      {links.map(l => (
                        <a key={l.key} href={l.url} target="_blank" rel="noopener noreferrer" title={l.title}
                          style={{ color: 'var(--t-muted)', display: 'flex', alignItems: 'center', transition: 'color .15s' }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--orange)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--t-muted)'}
                        >
                          {l.icon}
                        </a>
                      ))}
                    </div>
                  );
                })()}
                {program.city && (
                  <div style={{ fontSize: 11, color: 'var(--t-secondary)', fontFamily: 'var(--font-body)' }}>
                    {program.city}, {program.state}
                  </div>
                )}
                <h1 style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: 'clamp(1.4rem, 3vw, 2rem)', color: 'var(--t-primary)', margin: 0, letterSpacing: '-0.02em', textTransform: 'uppercase', display: 'flex', alignItems: 'flex-end' }}>
                  {program.canonical_name}
                </h1>
                {!program.active && (
                  <span style={{ fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', fontFamily: 'var(--font-h2)', color: 'var(--t-muted)', padding: '2px 8px', borderRadius: 99, border: '1px solid var(--surf-border)', marginTop: 5, display: 'inline-block' }}>
                    Inactive
                  </span>
                )}
              </div>
              {/* View toggle — bottom-right of hero */}
              <div style={{ position: 'absolute', bottom: 20, right: 32, display: 'flex', border: '1px solid var(--orange)', borderRadius: 4, overflow: 'hidden', zIndex: 1 }}>
                {['season', 'history'].map(v => (
                  <button
                    key={v}
                    onClick={() => setActiveView(v)}
                    style={{
                      flex: 1,
                      padding: '6px 18px',
                      background: activeView === v ? 'var(--orange)' : '#fff',
                      border: 'none',
                      borderLeft: v === 'history' ? '1px solid var(--orange)' : 'none',
                      fontFamily: 'var(--font-h2)',
                      fontSize: 9,
                      letterSpacing: '1.5px',
                      textTransform: 'uppercase',
                      color: activeView === v ? '#fff' : 'var(--orange)',
                      cursor: 'pointer',
                      transition: 'background .15s, color .15s',
                    }}
                  >{v}</button>
                ))}
              </div>
            </div>

            {/* ── Team Tabs ── */}
            <div style={{ display: 'flex', padding: '0 32px 10px', boxSizing: 'border-box', background: '#fff' }}>

              {/* 80% tabs strip — border-bottom matches stats callout width */}
              <div style={{ flex: '0 0 80%', paddingRight: 32, borderBottom: '1px solid var(--nav-border)', display: 'flex', alignItems: 'flex-end', minWidth: 0 }}>
                {/* Left arrow */}
                <button
                  onClick={() => { tabsScrollRef.current?.scrollBy({ left: -200, behavior: 'smooth' }); setTimeout(updateScrollBtns, 250); }}
                  style={{
                    flexShrink: 0, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    alignSelf: 'center', marginBottom: 6,
                    background: 'none', border: 'none', cursor: canScrollLeft ? 'pointer' : 'default',
                    color: 'var(--orange)', opacity: canScrollLeft ? 1 : 0.25, padding: 0, marginRight: 6,
                    fontSize: 22, fontWeight: 700, lineHeight: 1,
                    transition: 'opacity .15s',
                  }}
                >
                  ‹
                </button>

                {/* Scrollable tabs */}
                <div
                  ref={tabsScrollRef}
                  style={{
                    display: 'flex',
                    overflow: 'hidden',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {orderedSlots.length === 0 && (
                    <div style={{ padding: '14px 0', fontSize: 11, color: 'var(--t-muted)', fontFamily: 'var(--font-h2)' }}>No teams</div>
                  )}
                  {orderedSlots.map(slot => {
                    const isActive = (activeSlot?.key ?? orderedSlots[0]?.key) === slot.key;
                    const color = 'var(--orange)';
                    let label;
                    if (program.competition_level === 'Club') {
                      const recent = slot.teams.reduce((best, t) =>
                        (t.last_year || 0) > (best.last_year || 0) ? t : best, slot.teams[0]);
                      label = recent?.team_name || (slot.suffix === 'A'
                        ? (slot.gender_division === 'Women' ? "Women's" : slot.gender_division === 'Men' ? "Men's" : slot.gender_division)
                        : `${slot.gender_division === 'Women' ? "Women's" : slot.gender_division === 'Men' ? "Men's" : slot.gender_division} ${slot.suffix}`);
                    } else {
                      const g = slot.gender_division === 'Women' ? "Women's" : slot.gender_division === 'Men' ? "Men's" : slot.gender_division || 'Team';
                      label = slot.suffix === 'A' ? g : `${g} ${slot.suffix}`;
                    }
                    return (
                      <button
                        key={slot.key}
                        onClick={() => setActiveSlotKey(slot.key)}
                        style={{
                          flexShrink: 0,
                          width: 120,
                          padding: '10px 8px',
                          cursor: 'pointer', background: 'none', border: 'none',
                          borderBottom: isActive ? `2px solid ${color}` : '2px solid transparent',
                          fontFamily: 'var(--font-h2)', fontSize: 13, letterSpacing: '1.2px', textTransform: 'uppercase',
                          color: isActive ? color : 'var(--t-muted)',
                          transition: 'color .15s',
                          textAlign: 'center',
                        }}
                      >
                        <span style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          lineHeight: 1.3,
                          wordBreak: 'break-word',
                        }}>{label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Right arrow */}
                <button
                  onClick={() => { tabsScrollRef.current?.scrollBy({ left: 200, behavior: 'smooth' }); setTimeout(updateScrollBtns, 250); }}
                  style={{
                    flexShrink: 0, width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    alignSelf: 'center', marginBottom: 6,
                    background: 'none', border: 'none', cursor: canScrollRight ? 'pointer' : 'default',
                    color: 'var(--orange)', opacity: canScrollRight ? 1 : 0.25, padding: 0, marginLeft: 6,
                    fontSize: 22, fontWeight: 700, lineHeight: 1,
                    transition: 'opacity .15s',
                  }}
                >
                  ›
                </button>
              </div>

              {/* 20% dropdown — sits above the roster column */}
              <div style={{ flex: '0 0 20%', display: 'flex', alignItems: 'center', borderBottom: '1px solid transparent' }}>
                {activeView === 'season' && (
                  <select
                    value={selectedYear ?? ''}
                    onChange={e => setSelectedYear(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '5px 28px 5px 10px',
                      background: 'var(--input-bg)',
                      border: '1px solid var(--input-border)',
                      borderRadius: 6,
                      color: 'var(--input-clr)',
                      fontFamily: 'var(--font-h2)',
                      fontSize: 12,
                      cursor: 'pointer',
                      outline: 'none',
                      appearance: 'none',
                      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 8px center',
                    }}
                  >
                    {seasons.length === 0 && <option value="">No seasons</option>}
                    {seasons.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                )}
              </div>
            </div>

            {/* ── Team content ── */}
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: '28px 32px 48px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
              {activeView === 'season' && (
                <TeamPanel key={activeTeamForYear?.usau_team_id + '_' + selectedYear} team={activeTeamForYear} selectedYear={selectedYear} />
              )}
              {activeView === 'history' && (
                <HistoryPanel key={activeSlot?.key} teamIds={activeSlot ? activeSlot.teams.map(t => t.usau_team_id) : []} seasons={seasons} />
              )}
            </div>
          </>
        )}
    </LeagueShell>
  );
}

// ── History panel ─────────────────────────────────────────────────────────────
function HistoryPanel({ teamIds = [], seasons }) {
  const [histData,    setHistData]    = useState(null);
  const [histStatus,  setHistStatus]  = useState('idle');
  const [rivalFilter, setRivalFilter] = useState('all'); // 'all' | 'in' | 'out'

  const teamIdsKey = teamIds.slice().sort().join(',');

  useEffect(() => {
    if (!teamIds.length) return;
    let cancelled = false;
    setHistStatus('loading');
    setHistData(null);
    const [primary, ...extras] = teamIds;
    const url = extras.length
      ? `/api/usau/teams/${primary}/history?extra_ids=${extras.join(',')}`
      : `/api/usau/teams/${primary}/history`;
    fetch(url)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setHistData(d); setHistStatus('ready'); } })
      .catch(() => { if (!cancelled) setHistStatus('error'); });
    return () => { cancelled = true; };
  }, [teamIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!teamIds.length) return <EmptyState message="No team selected." />;

  const accent = 'var(--orange)';

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {histStatus === 'loading' && (
        <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase' }}>Loading…</div>
      )}
      {histStatus === 'error' && <EmptyState message="Failed to load history." />}
      {histStatus === 'ready' && histData && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'stretch' }}>

          {/* ── Left 80%: all-time stats + rivals ── */}
          <div style={{ flex: '0 0 80%', minWidth: 0, paddingRight: 32, display: 'flex', flexDirection: 'column' }}>
            <SectionHeader>All-Time Stats</SectionHeader>
            {(() => {
              const { wins, losses, ties, win_pct, points_for, points_against, point_diff, pythagorean, seasons_played, first_season, last_season } = histData;
              const played = wins + losses + ties;
              const ppg  = played > 0 ? (points_for  / played).toFixed(2) : '—';
              const papg = played > 0 ? (points_against / played).toFixed(2) : '—';
              const pdpg = played > 0 ? (point_diff / played).toFixed(2) : null;
              return (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 16, marginBottom: 32 }}>
                  <StatCard
                    label="All-Time Record"
                    value={`${wins}–${losses}${ties > 0 ? `–${ties}` : ''}`}
                    accent={accent}
                    sub={`${played} games played`}
                  />
                  <StatCard
                    label="Win %"
                    value={win_pct != null ? win_pct.toFixed(3) : '—'}
                    accent={accent}
                    sub={`${wins}W · ${losses}L`}
                  />
                  <StatCard
                    label="Pyth W%"
                    value={pythagorean != null ? pythagorean.toFixed(3) : '—'}
                    accent={accent}
                    sub={`${points_for} PF · ${points_against} PA`}
                  />
                  <StatCard
                    label="Point Diff"
                    value={point_diff != null ? (point_diff > 0 ? '+' : '') + point_diff : '—'}
                    accent={accent}
                    sub={pdpg != null ? `${pdpg > 0 ? '+' : ''}${pdpg} per game` : undefined}
                  />
                  <StatCard
                    label="Pts / Gm"
                    value={ppg}
                    accent={accent}
                    sub={`${points_for} total scored`}
                  />
                  <StatCard
                    label="PA / Gm"
                    value={papg}
                    accent={accent}
                    sub={`${points_against} total allowed`}
                  />
                </div>
              );
            })()}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--surf-border)', marginBottom: 12, paddingBottom: 8 }}>
              <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#fff', fontWeight: 700 }}>Top Rivals</span>
              {histData.home_region && (
                <div style={{ display: 'flex', border: '1px solid var(--orange)', borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
                  {[['all', 'All'], ['in', 'In Region'], ['out', 'Out of Region']].map(([val, label]) => (
                    <button key={val} onClick={() => setRivalFilter(val)} style={{
                      flex: 1,
                      padding: '4px 12px',
                      background: rivalFilter === val ? 'var(--orange)' : '#fff',
                      border: 'none',
                      borderLeft: val !== 'all' ? '1px solid var(--orange)' : 'none',
                      fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.2px',
                      textTransform: 'uppercase',
                      color: rivalFilter === val ? '#fff' : 'var(--orange)',
                      cursor: 'pointer', transition: 'background .15s, color .15s',
                    }}>{label}</button>
                  ))}
                </div>
              )}
            </div>
            {(() => {
              const filtered = rivalFilter === 'in'  ? histData.rivals_in
                             : rivalFilter === 'out' ? histData.rivals_out
                             : histData.rivals;
              if (filtered.length === 0) return <EmptyState message="No rivals in this category." />;
              const cols = Math.min(filtered.length, 4);
              return (
                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 20 }}>
                  {filtered.map(r => <RivalCard key={r.usau_team_id} rival={r} />)}
                </div>
              );
            })()}
          </div>

          {/* ── Right 20%: season-by-season log ── */}
          <div style={{ flex: '0 0 20%', minWidth: 0 }}>
            <SectionHeader>Season Log</SectionHeader>
            {histData.seasons.length === 0 && <EmptyState message="No seasons." />}
            {histData.seasons.length > 0 && (
              <div className="orange-scroll" style={{ borderRadius: 2, border: '1px solid var(--card-border-clr)', borderTop: '2px solid var(--orange)', background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', boxShadow: 'var(--card-shadow)', overflow: 'hidden', overflowY: 'auto', maxHeight: '100%' }}>
                {histData.seasons.map((s, i) => {
                  const gp = s.wins + s.losses + s.ties;
                  const pd = s.point_diff;
                  return (
                    <div key={s.year} style={{
                      display: 'grid', gridTemplateColumns: '1fr auto',
                      alignItems: 'center', gap: 8,
                      padding: '9px 14px',
                      background: i % 2 === 0 ? 'var(--surf-bg)' : 'var(--surf-bg-2)',
                      borderBottom: i < histData.seasons.length - 1 ? '1px solid var(--surf-border)' : 'none',
                    }}>
                      <div>
                        <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, fontWeight: 600, color: 'var(--t-primary)' }}>{s.year}</div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--t-muted)', marginTop: 1 }}>
                          {s.wins}–{s.losses}{s.ties > 0 ? `–${s.ties}` : ''}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: pd > 0 ? 'var(--orange)' : pd < 0 ? 'var(--t-muted)' : 'var(--t-secondary)', fontWeight: 600 }}>
                          {pd > 0 ? '+' : ''}{pd}
                        </div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: 'var(--t-muted)', marginTop: 1 }}>{gp} gm</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

function RivalCard({ rival }) {
  const pd   = rival.point_diff;
  const ppg  = rival.games_played > 0 ? (rival.points_for  / rival.games_played).toFixed(1) : '—';
  const papg = rival.games_played > 0 ? (rival.points_against / rival.games_played).toFixed(1) : '—';

  function fmtMatchupDate(d) {
    if (!d) return null;
    // mm/dd/yyyy → mm/dd/yy
    const p = d.split('/');
    if (p.length === 3) return `${p[0]}/${p[1]}/${p[2].slice(2)}`;
    return d;
  }

  function StatCell({ label, children, accent }) {
    return (
      <div style={{ paddingTop: 11, paddingBottom: 11, borderBottom: '1px solid var(--surf-border)' }}>
        <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: 3 }}>{label}</div>
        <div style={{ fontFamily: 'var(--font-h1)', fontSize: 18, fontWeight: 700, color: accent || 'var(--t-primary)' }}>{children}</div>
      </div>
    );
  }

  function MatchupRow({ label, game }) {
    if (!game) return null;
    const won = game.result === 'W';
    const lost = game.result === 'L';
    return (
      <div style={{ paddingTop: 11, paddingBottom: 11, borderBottom: '1px solid var(--surf-border)' }}>
        <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: 5 }}>{label}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontFamily: 'var(--font-h2)', fontSize: 9, fontWeight: 700, letterSpacing: '1px',
              textTransform: 'uppercase', padding: '2px 7px', borderRadius: 4,
              background: won ? 'var(--orange)' : 'var(--surf-bg-2)',
              color: won ? '#fff' : 'var(--t-muted)',
              border: won ? 'none' : '1px solid var(--surf-border)',
            }}>{game.result}</span>
            <span style={{ fontFamily: 'var(--font-h1)', fontSize: 16, fontWeight: 700, color: 'var(--t-primary)' }}>
              {game.our_score}–{game.opp_score}
            </span>
          </div>
          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)' }}>
            {fmtMatchupDate(game.date)}
          </span>
        </div>
      </div>
    );
  }

  const streakColor = rival.streak?.type === 'W' ? 'var(--orange)' : rival.streak?.type === 'L' ? 'var(--t-muted)' : 'var(--t-secondary)';

  return (
    <div style={{
      borderRadius: 2,
      border: '1px solid var(--card-border-clr)',
      borderTop: '2px solid var(--orange)',
      background: 'var(--card-bg)',
      backdropFilter: 'var(--card-backdrop)',
      boxShadow: 'var(--card-shadow)',
      overflow: 'hidden',
      padding: '18px 20px',
    }}>
      {/* Header */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--orange)', opacity: 0.7, marginBottom: 4 }}>
          {rival.games_played} games played
        </div>
        <div style={{ fontFamily: 'var(--font-h1)', fontSize: 18, fontWeight: 700, color: 'var(--t-primary)', lineHeight: 1.2 }}>
          {rival.team_name}
          {rival.b_team_suffix && rival.b_team_suffix !== 'A' && (
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 12, fontWeight: 400, color: 'var(--t-muted)', marginLeft: 6 }}>
              {rival.b_team_suffix}
            </span>
          )}
        </div>
      </div>

      {/* Uniform 2-column stat grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
        <StatCell label="H2H Record">
          {rival.wins}–{rival.losses}{rival.ties > 0 ? `–${rival.ties}` : ''}
        </StatCell>
        <StatCell label="Win %">
          {rival.win_pct != null ? rival.win_pct.toFixed(3) : '—'}
        </StatCell>

        <StatCell label="Pt Diff" accent={pd > 0 ? 'var(--orange)' : undefined}>
          {pd > 0 ? '+' : ''}{pd}
        </StatCell>
        <StatCell label="Streak" accent={streakColor}>
          {rival.streak ? `${rival.streak.type}${rival.streak.count}` : '—'}
        </StatCell>

        <StatCell label="Pts For / Gm">{ppg}</StatCell>
        <StatCell label="Pts Against / Gm">{papg}</StatCell>

        {rival.biggest_win && (
          <StatCell label="Biggest Win" accent="var(--orange)">
            +{rival.biggest_win.margin}
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)', fontWeight: 400, marginLeft: 6 }}>
              {rival.biggest_win.our_score}–{rival.biggest_win.opp_score} · {fmtMatchupDate(rival.biggest_win.date)}
            </span>
          </StatCell>
        )}
        {rival.biggest_loss && (
          <StatCell label="Biggest Loss">
            {rival.biggest_loss.margin}
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)', fontWeight: 400, marginLeft: 6 }}>
              {rival.biggest_loss.our_score}–{rival.biggest_loss.opp_score} · {fmtMatchupDate(rival.biggest_loss.date)}
            </span>
          </StatCell>
        )}
      </div>

      {/* First & last matchup */}
      <MatchupRow label="First Matchup" game={rival.first_game} />
      <MatchupRow label="Latest Matchup" game={rival.last_game} />
    </div>
  );
}


// ── Tournament list ───────────────────────────────────────────────────────────
function TournamentList({ tournaments, accentColor }) {
  const [expanded, setExpanded] = useState({});
  const toggle = slug => setExpanded(p => ({ ...p, [slug]: !p[slug] }));

  function fmtDate(d) {
    if (!d) return null;
    // mm/dd/yyyy (game_date)
    const slashParts = d.split('/');
    if (slashParts.length === 3) return `${slashParts[0]}/${slashParts[1]}/${slashParts[2].slice(2)}`;
    // YYYY-MM-DD (event date_start / date_end)
    const dashParts = d.split('-');
    if (dashParts.length === 3) return `${dashParts[1]}/${dashParts[2]}/${dashParts[0].slice(2)}`;
    return d;
  }
  function fmtTime(t) {
    if (!t) return null;
    return t.slice(0, 5);
  }

  return (
    <div style={{ borderRadius: 2, overflow: 'hidden', border: '1px solid var(--card-border-clr)', borderTop: '2px solid var(--orange)', background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', boxShadow: 'var(--card-shadow)' }}>
      {tournaments.map((t, i) => {
        const isOpen = !!expanded[t.event_slug];
        const isLast = i === tournaments.length - 1;
        return (
          <div key={t.event_slug}>
            {/* Header row */}
            <div
              onClick={() => toggle(t.event_slug)}
              style={{
                display: 'grid', gridTemplateColumns: '1fr auto',
                gap: 16, padding: '12px 18px', alignItems: 'center',
                background: i % 2 === 0 ? 'var(--surf-bg)' : 'var(--surf-bg-2)',
                borderBottom: (!isOpen && !isLast) ? '1px solid var(--surf-border)' : isOpen ? '1px solid var(--surf-border)' : 'none',
                cursor: t.games?.length ? 'pointer' : 'default',
                userSelect: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {t.games?.length > 0 && (
                  <span style={{
                    fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)',
                    display: 'inline-block',
                    transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 0.2s ease',
                  }}>▶</span>
                )}
                <div>
                  <div style={{ fontFamily: 'var(--font-h2)', fontSize: 12, color: 'var(--t-primary)', fontWeight: 600 }}>{t.event_title}</div>
                  {(t.city || t.state) && (
                    <div style={{ fontSize: 10, color: 'var(--t-muted)', marginTop: 2, fontFamily: 'var(--font-body)' }}>
                      {[t.city, t.state].filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
              </div>
              {(t.date_start || t.date_end) && (
                <div style={{ fontSize: 11, color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', whiteSpace: 'nowrap' }}>
                  {fmtDate(t.date_start ?? t.date_end)}
                </div>
              )}
            </div>

            {/* Game rows — animated via maxHeight */}
            <div style={{
              maxHeight: isOpen ? '9999px' : '0px',
              overflow: 'hidden',
              transition: isOpen ? 'max-height 0.35s ease' : 'max-height 0.2s ease',
              borderBottom: isOpen && !isLast ? '1px solid var(--surf-border)' : 'none',
            }}>
              <div>
                {t.games?.map((g, gi) => (
                  <div key={gi} style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr max-content max-content max-content 1fr auto',
                    gap: 8, padding: '9px 18px 9px 36px', alignItems: 'center',
                    background: 'var(--surf-bg-2)',
                    borderBottom: gi < (t.games.length - 1) ? '1px solid var(--surf-border)' : 'none',
                  }}>
                    <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-primary)', fontWeight: 600, textAlign: 'right' }}>{g.our_name}</div>
                    <div style={{ fontFamily: 'var(--font-h1)', fontSize: 14, fontWeight: 700, color: 'var(--t-primary)', textAlign: 'center', minWidth: 24 }}>{g.our_score}</div>
                    <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)', textAlign: 'center' }}>–</div>
                    <div style={{ fontFamily: 'var(--font-h1)', fontSize: 14, fontWeight: 700, color: 'var(--t-primary)', textAlign: 'center', minWidth: 24 }}>{g.opp_score}</div>
                    <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-primary)', fontWeight: 600, textAlign: 'left' }}>{g.opp_name}</div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {g.game_date && <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--orange)', whiteSpace: 'nowrap' }}>{fmtDate(g.game_date)}</div>}
                      {g.game_time && <div style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--orange)', opacity: 0.75, marginTop: 2 }}>{fmtTime(g.game_time)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, accent, sub }) {
  return (
    <div style={{
      borderRadius: 2, padding: '18px 20px',
      background: 'var(--card-bg)',
      backdropFilter: 'var(--card-backdrop)',
      border: '1px solid var(--card-border-clr)',
      borderTop: `2px solid ${accent}`,
      boxShadow: 'var(--card-shadow)',
      overflow: 'hidden',
    }}>
      <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-h1)', fontSize: 26, fontWeight: 700, color: 'var(--t-primary)', letterSpacing: '-0.02em' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--t-muted)', fontFamily: 'var(--font-body)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ children, style }) {
  return (
    <div style={{ fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '2.5px', textTransform: 'uppercase', color: '#fff', fontWeight: 700, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--surf-border)', ...style }}>
      {children}
    </div>
  );
}

function EmptyState({ message }) {
  return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontSize: 13, fontFamily: 'var(--font-body)' }}>
      {message}
    </div>
  );
}

