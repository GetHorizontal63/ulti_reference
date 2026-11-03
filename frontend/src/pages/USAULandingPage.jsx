import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LEVEL_STYLE } from '../utils/levelStyles.js';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

const SCARD = { border: '1px solid var(--card-border-clr)', borderTop: '2px solid var(--orange)', background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', boxShadow: 'var(--card-shadow)', borderRadius: 2, overflow: 'hidden' };
const SHEAD = { fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--orange)', padding: '8px 12px', borderBottom: '1px solid var(--card-border-clr)', background: 'rgba(234,96,32,0.08)' };

function useDebounce(value, delay = 320) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const ORANGE = '#EA6020';

const TABS = [
  { key: 'Club',    label: 'Club',       levels: ['Club'],                              color: '#DC2626' },
  { key: 'College', label: 'College',    levels: ['College'],                           color: '#2563EB' },
  { key: 'Youth',   label: 'Youth / HS', levels: ['Youth Club U-20', 'High School'],   color: '#16A34A' },
];

const TAB_EVENT_DIVS = {
  Club:    ['Club'],
  College: ['College'],
  Youth:   ['Youth', 'High School'],
};

const FALLBACK_IMG_COLORS = ['#B84D10', '#9A3E0B', '#7A3108', '#5C2406', '#3D1804'];



const PAGE_SIZE = 50;

export default function USAULandingPage() {
  const navigate  = useNavigate();
  const inputRef   = useRef(null);
  const dropdownRef = useRef(null);
  const [query,          setQuery]         = useState('');
  const [programs,       setPrograms]      = useState([]);
  const [suggestions,    setSuggestions]   = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [total,          setTotal]         = useState(0);
  const [status,         setStatus]        = useState('idle');
  const [page,           setPage]          = useState(1);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [eventsStatus,   setEventsStatus]  = useState('loading');
  const [rankingsData,   setRankingsData]  = useState(null);
  const [rankingsStatus, setRankingsStatus] = useState('loading');
  const dq = useDebounce(query);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    fetch('/api/usau/upcoming-events')
      .then(r => r.json())
      .then(d => { setUpcomingEvents(d); setEventsStatus('ready'); })
      .catch(() => setEventsStatus('error'));
  }, []);

  useEffect(() => {
    fetch('/api/usau/official-rankings')
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => { setRankingsData(d); setRankingsStatus('ready'); })
      .catch(() => setRankingsStatus('error'));
  }, []);

  useEffect(() => {
    if (!dq) {
      setPrograms([]); setSuggestions([]); setTotal(0); setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    const p = new URLSearchParams({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
    p.set('q', dq);
    fetch(`/api/usau/programs?${p}`)
      .then(r => r.json())
      .then(d => {
        if (!cancelled) {
          setPrograms(d.programs);
          setTotal(d.count);
          setStatus('ready');
          setSuggestions(d.programs.slice(0, 5));
          setShowSuggestions(true);
        }
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [dq, page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function selectDivision(key) {
    navigate(`/usau/${key.toLowerCase()}`);
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', padding: '24px 16px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{
        maxWidth: 1560, width: '100%', margin: '0 auto',
        height: 'calc(100vh - 48px)',
        display: 'flex', flexDirection: 'column',
        borderRadius: 4,
        borderTop: '1px solid var(--card-border-clr)',
        borderBottom: '1px solid var(--card-border-clr)',
        background: 'transparent',
        overflow: 'hidden',
      }}>

        {/* ── Subnav ── */}
        <div style={{ flexShrink: 0, background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', borderBottom: '1px solid var(--card-border-clr)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 16px', gap: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            <Link to="/" style={{ color: 'var(--t-muted)', textDecoration: 'none', padding: '2px 8px', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '0.5px', transition: 'color .15s', whiteSpace: 'nowrap' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-muted)'; }}>Home</Link>
            <span style={{ color: 'var(--card-border-clr)', fontSize: 10 }}>|</span>
            {[
              { label: 'WFDF', to: '/wfdf' },
              { label: 'USAU', to: '/usau' },
              { label: 'PUL',  to: '/pul' },
              { label: 'WUL',  to: '/wul' },
              { label: 'UFA',  to: '/ufa' },
              { label: 'MLU',  to: '/mlu' },
            ].map((item, i, arr) => (
              <React.Fragment key={item.to}>
                <Link to={item.to} style={{ color: item.to === '/usau' ? 'var(--orange)' : 'var(--t-muted)', textDecoration: 'none', padding: '2px 8px', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '0.5px', transition: 'color .15s', whiteSpace: 'nowrap' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }} onMouseLeave={e => { e.currentTarget.style.color = item.to === '/usau' ? 'var(--orange)' : 'var(--t-muted)'; }}>
                  {item.label}
                </Link>
                {i < arr.length - 1 && <span style={{ color: 'var(--card-border-clr)', fontSize: 10 }}>|</span>}
              </React.Fragment>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            {[
              { label: 'Blog',      to: '/blog' },
              { label: 'Subscribe', to: '/subscribe' },
              { label: 'Account',   to: '/account' },
            ].map((item, i, arr) => (
              <React.Fragment key={item.to}>
                <Link to={item.to} style={{ color: 'var(--t-muted)', textDecoration: 'none', padding: '2px 8px', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '0.5px', transition: 'color .15s', whiteSpace: 'nowrap' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-muted)'; }}>
                  {item.label}
                </Link>
                {i < arr.length - 1 && <span style={{ color: 'var(--card-border-clr)', fontSize: 10 }}>|</span>}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* ── League hero band ── */}
        <div style={{ flexShrink: 0, background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', borderBottom: '2px solid var(--orange)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', position: 'relative', overflow: 'visible' }}>
            <div style={{ position: 'relative' }}>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '3px', textTransform: 'uppercase', color: 'var(--orange)', marginBottom: 3 }}>
                USA Ultimate
              </div>
              <h1 style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 'clamp(1.4rem, 2vw, 2rem)', color: 'var(--t-primary)', margin: 0, letterSpacing: '-0.03em', textTransform: 'uppercase', lineHeight: 1 }}>
                USAU
              </h1>
            </div>

            {/* Search */}
            <div style={{ width: 260, flexShrink: 0, position: 'relative' }}>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="School, city, program name…"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setPage(1); }}
                  onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                  className="search-input"
                  style={{ width: '100%', padding: '9px 32px 9px 12px', background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 6, color: 'var(--input-clr)', fontFamily: 'var(--font-h2)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
                />
                {/* Clear × */}
                {query && (
                  <button
                    onMouseDown={e => { e.preventDefault(); setQuery(''); setPage(1); setSuggestions([]); setShowSuggestions(false); }}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', padding: '0 2px', cursor: 'pointer', color: 'var(--t-muted)', fontSize: 14, lineHeight: 1, display: 'flex', alignItems: 'center' }}
                    tabIndex={-1}
                    aria-label="Clear search"
                  >×</button>
                )}
                {/* Typeahead dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                  <div
                    ref={dropdownRef}
                    style={{
                      position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                      background: 'var(--card-bg)',
                      border: '1px solid var(--surf-border)',
                      borderRadius: 8,
                      boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                      zIndex: 100,
                      overflow: 'hidden',
                    }}
                  >
                    {suggestions.map((p, i) => {
                      const logoSrc = p.logo_url || (p.logo_filename ? `${BASE}/assets/png/USAU_teams/${p.logo_filename}` : null);
                      const initials = (p.short_name || p.canonical_name).slice(0, 2).toUpperCase();
                      const lvl = LEVEL_STYLE[p.competition_level] ?? LEVEL_STYLE['Club'];
                      return (
                        <div
                          key={p.program_id}
                          onMouseDown={() => { setShowSuggestions(false); navigate(`/usau/program/${p.program_id}`); }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(234,96,32,0.08)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'var(--surf-bg-2)'}
                          style={{
                            textAlign: 'left', padding: '14px 16px',
                            cursor: 'pointer',
                            background: 'var(--surf-bg-2)',
                            borderBottom: i < suggestions.length - 1 ? '1px solid var(--surf-border)' : 'none',
                            transition: 'background .15s',
                            display: 'flex', gap: 12, alignItems: 'center',
                            position: 'relative', overflow: 'hidden',
                          }}
                        >
                          {logoSrc && (
                            <img src={logoSrc} aria-hidden="true" style={{ position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)', height: '120%', opacity: 0.05, pointerEvents: 'none' }} />
                          )}
                          <div style={{
                            width: 38, height: 38, borderRadius: 6, flexShrink: 0,
                            background: p.primary_color ? `${p.primary_color}22` : 'var(--surf-bg)',
                            border: p.primary_color ? `1px solid ${p.primary_color}44` : '1px solid var(--surf-border)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                            position: 'relative', zIndex: 1,
                          }}>
                            {logoSrc
                              ? <img src={logoSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 3 }} />
                              : <span style={{ fontFamily: 'var(--font-h1)', fontSize: 12, color: p.primary_color || 'var(--orange)', fontWeight: 700 }}>{initials}</span>
                            }
                          </div>
                          <div style={{ minWidth: 0, flex: 1, position: 'relative', zIndex: 1 }}>
                            <div style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: '0.88rem', color: 'var(--t-primary)', letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {p.canonical_name}
                            </div>
                            <div style={{ marginTop: 3, display: 'flex', gap: 8, alignItems: 'center' }}>
                              {p.city && <span style={{ fontSize: 10, color: 'var(--t-muted)', fontFamily: 'var(--font-body)' }}>{p.city}, {p.state}</span>}
                              {p.team_count > 0 && <span style={{ fontSize: 10, color: 'var(--t-muted)', fontFamily: 'var(--font-body)' }}>{p.team_count} team{p.team_count !== 1 ? 's' : ''}</span>}
                            </div>
                          </div>
                          <span style={{ position: 'relative', zIndex: 1, flexShrink: 0, fontSize: 8, letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'var(--font-h2)', fontWeight: 600, padding: '2px 7px', borderRadius: 99, border: `1px solid ${lvl.border}`, background: lvl.bg, color: lvl.text }}>
                            {p.competition_level}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
            </div>
        </div>

        {/* ── Event ticker ── */}
        <EventTicker items={upcomingEvents} />

        {/* ── Scrollable body ── */}
        <div className="orange-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <div style={{ display: 'flex', gap: 20, padding: '20px', alignItems: 'flex-start' }}>

            {/* ── Left: carousel always + results below when active ── */}
            <div style={{ flex: 3, minWidth: 0 }}>
              <div style={{ ...SCARD, background: 'transparent' }}>
                <BlogCarousel />
              </div>
              <div style={{ ...SCARD, marginTop: 20 }}>
                <div style={SHEAD}>Explore</div>
                <div style={{ padding: 12 }}>
                  <ExploreCards />
                </div>
              </div>
            </div>

            {/* ── Right sidebar: tabs + rankings ── */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Division tabs */}
              <div style={SCARD}>
                <div style={SHEAD}>Division</div>
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {TABS.map(t => (
                    <button
                      key={t.key}
                      onClick={() => selectDivision(t.key)}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        borderRadius: 6,
                        border: 'none',
                        background: t.color,
                        color: '#fff',
                        fontFamily: 'var(--font-h2)',
                        fontSize: 9,
                        letterSpacing: '1px',
                        textTransform: 'uppercase',
                        cursor: 'pointer',
                        transition: 'opacity .12s',
                        textAlign: 'left',
                      }}
                      onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                      onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                    >{t.label}</button>
                  ))}
                </div>
              </div>
              {/* Rankings */}
              <div style={{ ...SCARD, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <RankingsPanel data={rankingsData} status={rankingsStatus} />
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--card-border-clr)', background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, borderRadius: '0 0 4px 4px' }}>
          <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
            {[
              { label: 'Blog',                 to: '/blog' },
              { label: 'Subscribe',            to: '/subscribe' },
              { label: 'Account',              to: '/account' },
              { label: 'Submit UltiAnalytics', to: '/submit/ultianalytics' },
              { label: 'USAU Rankings',        to: '/usau' },
              { label: 'Status',               to: '/status' },
            ].map((lnk, i, arr) => (
              <React.Fragment key={lnk.to}>
                <Link to={lnk.to} style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)', textDecoration: 'none', padding: '2px 8px', transition: 'color .12s' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-muted)'; }}>
                  {lnk.label}
                </Link>
                {i < arr.length - 1 && <span style={{ color: 'var(--card-border-clr)', fontSize: 10, alignSelf: 'center' }}>|</span>}
              </React.Fragment>
            ))}
          </div>
          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)' }}>© {new Date().getFullYear()} Ulti-Reference</span>
        </div>
      </div>
    </div>
  );
}

/* ── USAU Official Rankings panel ── */
function RankingsPanel({ data, status }) {
  const [cat,    setCat]    = useState('club');
  const [divIdx, setDivIdx] = useState(0);

  const catData    = data?.[cat] ?? {};
  const divs       = catData.divisions ?? [];
  const safeDivIdx = Math.min(divIdx, divs.length - 1);
  const divData    = divs[safeDivIdx] ?? { teams: [] };

  const CAT_TABS = [
    { key: 'club',    label: 'Club' },
    { key: 'college', label: 'College' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ ...SHEAD, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Official Rankings</span>
        {catData.updated && (
          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '0.5px', fontWeight: 400, textTransform: 'none', color: 'var(--t-muted)' }}>Updated {catData.updated}</span>
        )}
      </div>
      {(status === 'loading' || status === 'error' || !data) ? (
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)', padding: '10px 12px' }}>
          {status === 'loading' ? 'Loading rankings…' : 'Rankings unavailable.'}
        </div>
      ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', flex: 1, minHeight: 0 }}>
      {/* Club / College tabs */}
      <div style={{ display: 'flex', gap: 4 }}>
        {CAT_TABS.map(c => (
          <button
            key={c.key}
            onClick={() => { setCat(c.key); setDivIdx(0); }}
            style={{
              flex: 1, padding: '5px 0',
              borderRadius: 4,
              border: '1px solid',
              borderColor: cat === c.key ? 'var(--orange)' : 'var(--card-border-clr)',
              background:  cat === c.key ? 'var(--orange)' : 'transparent',
              color:       cat === c.key ? '#fff' : 'var(--t-muted)',
              fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px',
              textTransform: 'uppercase', cursor: 'pointer', transition: 'all .12s',
            }}
          >{c.label}</button>
        ))}
      </div>

      {/* Division sub-tabs */}
      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {divs.map((d, i) => (
          <button
            key={d.name}
            onClick={() => setDivIdx(i)}
            style={{
              padding: '3px 7px',
              borderRadius: 3,
              border: '1px solid',
              borderColor: safeDivIdx === i ? 'var(--orange)' : 'var(--card-border-clr)',
              background:  safeDivIdx === i ? 'rgba(234,96,32,0.12)' : 'transparent',
              color:       safeDivIdx === i ? 'var(--orange)' : 'var(--t-muted)',
              fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '0.5px',
              textTransform: 'uppercase', cursor: 'pointer', transition: 'all .12s',
              whiteSpace: 'nowrap',
            }}
          >{d.name}</button>
        ))}
      </div>

      {/* Team list */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, borderTop: '1px solid var(--card-border-clr)', marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px', borderBottom: '1px solid var(--card-border-clr)', background: 'rgba(234,96,32,0.05)' }}>
          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--orange)' }}>{divData.name}</span>
          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 8, color: 'var(--t-muted)', letterSpacing: '0.3px' }}>{cat === 'club' ? '2025' : '2026'}</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }} className="orange-scroll">
          {divData.teams.length === 0 && (
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)', padding: '8px 12px' }}>No data.</div>
          )}
          {divData.teams.map((t, i) => (
            <div
              key={t.rank}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5.5px 10px',
                background: i % 2 === 0 ? 'transparent' : 'var(--surf-bg-2)',
                transition: 'background .1s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(234,96,32,0.08)'}
              onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--surf-bg-2)'}
            >
              <span style={{ width: 20, textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', flexShrink: 0 }}>{t.rank}</span>
              <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
              <span style={{ width: 38, textAlign: 'right', fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', flexShrink: 0 }}>{t.rating != null ? Math.round(t.rating) : '\u2014'}</span>
            </div>
          ))}
        </div>
      </div>
      </div>
      )}
    </div>
  );
}

// Loop copies per event count for infinite scroll
const TICKER_LOOPS = [2, 8, 6, 5, 4, 3, 3, 3];
function loopsForCount(n) { return (n >= 1 && n < TICKER_LOOPS.length) ? TICKER_LOOPS[n] : 2; }

/* ── Tournament schedule ticker ── */
function EventTicker({ items }) {
  const trackRef  = useRef(null);
  const posRef    = useRef(0);
  const rafRef    = useRef(null);
  const pausedRef = useRef(false);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || !items.length) return;
    const PPS = 60;
    let last = null;
    const copies = loopsForCount(items.length);
    const step = (ts) => {
      if (!pausedRef.current) {
        if (last !== null) {
          const dt = Math.min(ts - last, 50);
          posRef.current += PPS * dt / 1000;
          const unit = track.scrollWidth / copies;
          if (posRef.current >= unit) posRef.current -= unit;
          track.style.transform = `translateX(${-Math.round(posRef.current)}px)`;
        }
        last = ts;
      } else {
        last = null;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [items]);

  if (!items.length) return null;

  const copies = loopsForCount(items.length);
  return (
    <div style={{
      borderBottom: '1px solid var(--card-border-clr)',
      overflow: 'hidden',
      position: 'relative',
      height: 38,
      display: 'flex',
      alignItems: 'center',
      background: 'var(--card-bg)',
    }}>
      <div
        ref={trackRef}
        className="score-ticker-track"
        onMouseEnter={() => { pausedRef.current = true; }}
        onMouseLeave={() => { pausedRef.current = false; }}
      >
        {Array.from({ length: copies }, (_, ci) => (
          <React.Fragment key={ci}>
            <div className="ticker-week-card"><span>UPCOMING</span></div>
            {items.map((ev, i) => (
              <div key={`${ci}-${i}`} style={{ display: 'flex', alignItems: 'stretch', boxShadow: 'inset -1px 0 0 var(--nav-border)', height: 38, flexShrink: 0 }}>
                <div style={{ background: ORANGE, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 14px', flexShrink: 0 }}>
                  <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '0.5px', color: '#fff', fontWeight: 700, whiteSpace: 'nowrap' }}>{ev.date}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 16px', flexShrink: 0, gap: 1 }}>
                  <span style={{ fontFamily: 'var(--font-h2)', fontSize: 12, letterSpacing: '0.5px', color: 'var(--t-primary)', whiteSpace: 'nowrap' }}>{ev.name}</span>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 9, color: 'var(--t-muted)', whiteSpace: 'nowrap' }}>{ev.location} · {ev.division}</span>
                </div>
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

/* ── Blog carousel ── */
function BlogCarousel() {
  const [posts,   setPosts]   = useState([]);
  const [status,  setStatus]  = useState('loading');
  const [current, setCurrent] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    fetch('/api/blog?limit=5')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setPosts(Array.isArray(d) ? d : []); setStatus('ready'); })
      .catch(() => setStatus('error'));
  }, []);

  const startTimer = (count) => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCurrent(c => (c + 1) % count);
    }, 5000);
  };

  useEffect(() => {
    if (posts.length < 2) return;
    startTimer(posts.length);
    return () => clearInterval(timerRef.current);
  }, [posts.length]);

  const goTo = (i) => {
    setCurrent(i);
    startTimer(posts.length);
  };

  if (status === 'loading') return <div style={{ aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t-muted)', fontSize: 11, fontStyle: 'italic' }}>Loading…</div>;
  if (status !== 'ready' || posts.length === 0) return null;

  return (
    <div style={{ position: 'relative', aspectRatio: '16/9', overflow: 'hidden' }}>
      {posts.map((post, i) => {
        const colorIdx = Math.abs((post.post_id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % FALLBACK_IMG_COLORS.length;
        return (
          <div
            key={post.post_id}
            style={{
              position: 'absolute', inset: 0,
              opacity: i === current ? 1 : 0,
              transition: 'opacity 0.5s ease',
              background: FALLBACK_IMG_COLORS[colorIdx],
              pointerEvents: i === current ? 'auto' : 'none',
            }}
          >
            {post.cover_image_url && (
              <img src={post.cover_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            )}
            {!post.cover_image_url && (
              <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.06) 0px, rgba(0,0,0,0.06) 1px, transparent 1px, transparent 14px)' }} />
            )}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0) 15%)' }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '14px 16px 28px' }}>
              {post.category && (
                <div style={{ marginBottom: 7 }}>
                  <span style={{ fontFamily: 'var(--font-h2)', fontSize: 7, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '2px 9px', borderRadius: 99, background: '#EA6020', color: '#fff' }}>
                    {post.category}
                  </span>
                </div>
              )}
              <Link
                to={`/blog/${post.post_id}`}
                style={{ display: 'block', fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: '0.9rem', letterSpacing: '-0.01em', color: '#fff', textDecoration: 'none', lineHeight: 1.25, marginBottom: 8, transition: 'color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.color = '#ffd0a8'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#fff'; }}
              >
                {post.title}
              </Link>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'rgba(255,255,255,0.55)' }}>
                  {post.author && <span>{post.author} · </span>}
                  {post.published_at ? new Date(post.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                </div>
                <Link
                  to={`/blog/${post.post_id}`}
                  style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#EA6020', textDecoration: 'none' }}
                >
                  Read →
                </Link>
              </div>
            </div>
          </div>
        );
      })}
      {posts.length > 1 && (
        <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 6, zIndex: 10 }}>
          {posts.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              style={{
                width: i === current ? 18 : 6,
                height: 6,
                borderRadius: 99,
                border: 'none',
                background: i === current ? '#EA6020' : 'rgba(255,255,255,0.45)',
                cursor: 'pointer',
                padding: 0,
                transition: 'width 0.3s ease, background 0.3s ease',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Explore cards ── */
const EXPLORE_TILES = [
  {
    key: 'tournaments',
    label: 'Tournaments',
    sub: 'Browse events by season, division, or region',
    route: '/usau/tournaments',
  },
  {
    key: 'players',
    label: 'Players',
    sub: 'Search athletes across all USAU divisions',
    route: '/players',
  },
  {
    key: 'programs',
    label: 'Programs',
    sub: 'Explore club, college, and youth programs',
    route: '/usau',
  },
  {
    key: 'rankings',
    label: 'Leaderboard',
    sub: 'Player stats leaderboard — G, A, D, T across all levels',
    route: '/usau/leaderboard',
  },
  {
    key: 'stats',
    label: 'Stats',
    sub: 'Game-level and season stats across all levels',
    route: null,
  },
  {
    key: 'games',
    label: 'Game Center',
    sub: 'Scores, box scores, and game progressions for nationals',
    route: '/usau/games',
  },
];

function ExploreCards() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridAutoRows: '1fr', gap: 10 }}>
      {EXPLORE_TILES.map(tile => (
        <div key={tile.key} style={{ border: '1px solid var(--card-border-clr)', borderTop: `2px solid ${tile.route ? 'var(--orange)' : 'var(--card-border-clr)'}`, background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', boxShadow: 'var(--card-shadow)', borderRadius: 2, overflow: 'hidden', display: 'flex', flexDirection: 'column', opacity: tile.route ? 1 : 0.5 }}>
          {tile.route ? (
            <Link
              to={tile.route}
              style={{ display: 'block', flex: 1, padding: '12px 14px', borderBottom: '1px solid var(--card-border-clr)', background: 'rgba(234,96,32,0.06)', transition: 'background .15s', textDecoration: 'none', minHeight: 106 }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(234,96,32,0.14)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(234,96,32,0.06)'; }}
            >
              <div style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: '1.15rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-primary)', lineHeight: 1 }}>{tile.label}</div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)', marginTop: 4, lineHeight: 1.4 }}>{tile.sub}</div>
            </Link>
          ) : (
            <div style={{ flex: 1, padding: '12px 14px', borderBottom: '1px solid var(--card-border-clr)', background: 'rgba(234,96,32,0.06)', minHeight: 106 }}>
              <div style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: '1.15rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-primary)', lineHeight: 1 }}>{tile.label}</div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)', marginTop: 4, lineHeight: 1.4 }}>{tile.sub}</div>
            </div>
          )}
          <div style={{ padding: '8px 14px' }}>
            {tile.route
              ? <Link to={tile.route} style={{ fontFamily: 'var(--font-h2)', fontSize: 12, color: 'var(--t-secondary)', textDecoration: 'none', transition: 'color .12s' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-secondary)'; }}>Explore →</Link>
              : <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)', letterSpacing: '1px', textTransform: 'uppercase' }}>Coming Soon</span>
            }
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Event sidebar row ── */
function EventRow({ event }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '10px 14px',
        borderRadius: 8,
        background: hovered ? 'var(--surf-bg)' : 'var(--surf-bg-2)',
        border: `1px solid ${hovered ? 'rgba(234,96,32,0.35)' : 'var(--surf-border)'}`,
        cursor: 'pointer',
        transition: 'background .12s, border-color .12s',
      }}
    >
      <div style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: '0.82rem', color: 'var(--t-primary)', lineHeight: 1.3, marginBottom: 5 }}>
        {event.name}
      </div>
      <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--t-muted)', marginBottom: 2 }}>{event.location}</div>
      <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '0.5px', color: 'var(--orange)', fontWeight: 600, marginBottom: 4 }}>{event.date}</div>
      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1px', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 99, background: 'rgba(234,96,32,0.12)', border: '1px solid rgba(234,96,32,0.35)', color: 'var(--orange)' }}>
        {event.division}
      </span>
    </div>
  );
}

/* ── Division hub card ── */
/* ── Program card (results grid) ── */
function ProgramCard({ program: p, onClick }) {
  const [hovered, setHovered] = useState(false);
  const logoSrc = p.logo_url || (p.logo_filename ? `${BASE}/assets/png/USAU_teams/${p.logo_filename}` : null);
  const initials = (p.short_name || p.canonical_name).slice(0, 2).toUpperCase();
  const lvl = LEVEL_STYLE[p.competition_level] ?? LEVEL_STYLE['Club'];

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        textAlign: 'left',
        padding: '14px 16px',
        borderRadius: 8,
        cursor: 'pointer',
        background: hovered ? 'var(--surf-bg)' : 'var(--surf-bg-2)',
        border: `1px solid ${hovered ? 'rgba(234,96,32,0.30)' : 'var(--surf-border)'}`,
        transition: 'background .15s, border-color .15s',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Watermark */}
      {logoSrc && (
        <img src={logoSrc} aria-hidden="true" style={{ position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)', height: '120%', opacity: 0.05, pointerEvents: 'none' }} />
      )}

      {/* Logo avatar */}
      <div style={{
        width: 38, height: 38, borderRadius: 6, flexShrink: 0,
        background: p.primary_color ? `${p.primary_color}22` : 'var(--surf-bg)',
        border: p.primary_color ? `1px solid ${p.primary_color}44` : '1px solid var(--surf-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        position: 'relative', zIndex: 1,
      }}>
        {logoSrc
          ? <img src={logoSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 3 }} />
          : <span style={{ fontFamily: 'var(--font-h1)', fontSize: 12, color: p.primary_color || 'var(--orange)', fontWeight: 700 }}>{initials}</span>
        }
      </div>

      {/* Text */}
      <div style={{ minWidth: 0, flex: 1, position: 'relative', zIndex: 1 }}>
        <div style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: '0.88rem', color: 'var(--t-primary)', letterSpacing: '-0.01em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.canonical_name}
        </div>
        <div style={{ marginTop: 3, display: 'flex', gap: 8, alignItems: 'center' }}>
          {p.city && <span style={{ fontSize: 10, color: 'var(--t-muted)', fontFamily: 'var(--font-body)' }}>{p.city}, {p.state}</span>}
          {p.team_count > 0 && <span style={{ fontSize: 10, color: 'var(--t-muted)', fontFamily: 'var(--font-body)' }}>{p.team_count} team{p.team_count !== 1 ? 's' : ''}</span>}
        </div>
      </div>

      {/* Level badge */}
      <span style={{ position: 'relative', zIndex: 1, flexShrink: 0, fontSize: 8, letterSpacing: '1px', textTransform: 'uppercase', fontFamily: 'var(--font-h2)', fontWeight: 600, padding: '2px 7px', borderRadius: 99, border: `1px solid ${lvl.border}`, background: lvl.bg, color: lvl.text }}>
        {p.competition_level}
      </span>
    </button>
  );
}

function PagBtn({ onClick, disabled, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      padding: '2px 10px', fontSize: 14, lineHeight: 1, background: 'transparent',
      border: '1px solid rgba(234,96,32,0.25)', borderRadius: 4,
      color: disabled ? 'rgba(255,245,237,0.2)' : 'var(--orange)',
      cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-h2)',
    }}>{children}</button>
  );
}
