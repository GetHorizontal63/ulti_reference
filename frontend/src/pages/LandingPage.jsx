import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { pruneNav, isLeagueEnabled } from '../utils/features.js';

const BASE = import.meta.env.BASE_URL ?? '/';

const DEG = (d) => (d * Math.PI) / 180;
const COUNCIL_ANGLES = [DEG(15), DEG(8), 0, -DEG(8), -DEG(15)];
const TILT_X = -0.12;
const CANVAS_OFFSET = [32, 16, 0, 16, 32];

const LEAGUES = [
  {
    id:      'wfdf',
    label:   'WFDF',
    full:    'World Flying Disc Federation',
    stl:     `${BASE}assets/stl/WFDFicon.stl`,
    texture: `${BASE}assets/png/WFDFicon.png`,
    color:   '#003F87',
    active:  false,
    years:   [],
    links: [
      { label: 'Teams',   to: '/wfdf/teams' },
      { label: 'Games',   to: '/wfdf/games' },
    ],
  },
  {
    id:      'usau',
    label:   'USAU',
    full:    'USA Ultimate',
    stl:     `${BASE}assets/stl/USAUicon.stl`,
    texture: `${BASE}assets/png/USAUicon.png`,
    color:   '#FFFFFF',
    active:  true,
    years:   [2014, 2015, 2016, 2017, 2018, 2019, 2021, 2022, 2023, 2024, 2025, 2026],
    links: [
      { label: 'Club',     to: '/usau/club' },
      { label: 'College',  to: '/usau/college' },
      { label: 'Youth',    to: '/usau/youth' },
      { label: 'Rankings', to: '/usau/rankings' },
    ],
  },
  {
    id:      'pul',
    label:   'PUL',
    full:    'Premier Ultimate League',
    stl:     `${BASE}assets/stl/PULicon.stl`,
    texture: `${BASE}assets/png/PULicon.png`,
    color:   '#0F1D41',
    active:  true,
    years:   [2023, 2024],
    links: [
      { label: 'Teams',   to: '/pul/teams' },
      { label: 'Games',   to: '/pul/games' },
      { label: 'Compare', to: '/pul/compare' },
    ],
  },
  {
    id:      'wul',
    label:   'WUL',
    full:    "Western Ultimate League",
    stl:     `${BASE}assets/stl/WULicon.stl`,
    texture: `${BASE}assets/png/WULicon.png`,
    color:   '#2D758B',
    active:  true,
    years:   [2022, 2023, 2024, 2025, 2026],
    links: [
      { label: 'Teams',   to: '/wul/teams' },
      { label: 'Games',   to: '/wul/games' },
      { label: 'Compare', to: '/wul/compare' },
    ],
  },
  {
    id:      'ufa',
    label:   'UFA',
    full:    'Ultimate Frisbee Association',
    stl:     `${BASE}assets/stl/UFAIcon.stl`,
    texture: `${BASE}assets/png/UFAIcon.png`,
    color:   '#1A3053',
    active:  true,
    years:   [2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2021, 2022, 2023, 2024, 2025, 2026],
    links: [
      { label: 'Teams',   to: '/ufa/teams' },
      { label: 'Games',   to: '/ufa/games' },
      { label: 'Compare', to: '/ufa/compare' },
    ],
  },
  {
    id:      'mlu',
    label:   'MLU',
    full:    'Major League Ultimate',
    stl:     `${BASE}assets/stl/MLUicon.stl`,
    texture: `${BASE}assets/png/MLUicon.png`,
    color:   '#1A3A6B',
    active:  true,
    years:   [2013, 2014, 2015, 2016],
    links: [
      { label: 'Teams',   to: '/mlu/teams' },
      { label: 'Games',   to: '/mlu/games' },
      { label: 'Compare', to: '/mlu/compare' },
    ],
  },
];

// ─── Nav dropdown data ─────────────────────────────────────────────────────────
const NAV_ITEMS = pruneNav([
  {
    label: 'Leagues',
    sections: [
      {
        heading: 'Professional',
        links: [
          { label: 'WFDF — World Flying Disc Federation',   to: '/wfdf' },
          { label: 'PUL — Premier Ultimate League',         to: '/pul' },
          { label: 'WUL — Women\'s Ultimate League',        to: '/wul' },
          { label: 'UFA — Ultimate Frisbee Association',    to: '/ufa' },
          { label: 'MLU — Major League Ultimate',           to: '/mlu' },
        ],
      },
      {
        heading: 'Collegiate & Club',
        links: [
          { label: 'USAU — USA Ultimate',   to: '/usau' },
          { label: 'Club Division',         to: '/usau/club' },
          { label: 'College Division',      to: '/usau/college' },
          { label: 'Youth Division',        to: '/usau/youth' },
        ],
      },
    ],
  },
  {
    label: 'Players',
    sections: [
      {
        heading: 'Browse',
        links: [
          { label: 'Player Database',     to: '/players' },
          { label: 'USAU Player Stats',    to: '/usau' },
          { label: 'PUL Player Stats',     to: '/pul' },
          { label: 'WUL Player Stats',     to: '/wul' },
          { label: 'UFA Player Stats',     to: '/ufa' },
          { label: 'MLU Player Stats',     to: '/mlu' },
        ],
      },
      {
        heading: 'Tools',
        links: [
          { label: 'PUL Compare',  to: '/pul/compare' },
          { label: 'WUL Compare',  to: '/wul/compare' },
          { label: 'UFA Compare',  to: '/ufa/compare' },
          { label: 'MLU Compare',  to: '/mlu/compare' },
        ],
      },
    ],
  },
  {
    label: 'Teams',
    sections: [
      {
        heading: 'Professional',
        links: [
          { label: 'PUL Teams', to: '/pul/teams' },
          { label: 'WUL Teams', to: '/wul/teams' },
          { label: 'UFA Teams', to: '/ufa/teams' },
          { label: 'MLU Teams', to: '/mlu/teams' },
        ],
      },
      {
        heading: 'Rankings',
        links: [
          { label: 'USAU Club Rankings',    to: '/usau/rankings' },
          { label: 'USAU College Rankings', to: '/usau/rankings' },
        ],
      },
    ],
  },
  {
    label: 'Games',
    sections: [
      {
        heading: 'Box Scores',
        links: [
          { label: 'PUL Games', to: '/pul/games' },
          { label: 'WUL Games', to: '/wul/games' },
          { label: 'UFA Games', to: '/ufa/games' },
          { label: 'MLU Games', to: '/mlu/games' },
        ],
      },
    ],
  },
  {
    label: 'More',
    sections: [
      {
        heading: 'Site',
        links: [
          { label: 'Blog',                  to: '/blog' },
          { label: 'Subscribe',             to: '/subscribe' },
          { label: 'Submit UltiAnalytics',  to: '/submit/ultianalytics' },
          { label: 'Status',                to: '/status' },
        ],
      },
    ],
  },
]);

// ─── Styles (inline, theme-aware) ─────────────────────────────────────────────
const S = {
  // top utility bar
  subnav: {
    width: '100%',
    background: 'var(--card-bg)',
    backdropFilter: 'var(--card-backdrop)',
    borderBottom: '1px solid var(--card-border-clr)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 16px',
    fontSize: 11,
    gap: 0,
  },
  subnavLink: {
    color: 'var(--t-muted)',
    textDecoration: 'none',
    padding: '2px 8px',
    fontFamily: 'var(--font-h2)',
    fontSize: 11,
    letterSpacing: '0.5px',
    transition: 'color .15s',
    whiteSpace: 'nowrap',
  },
  // main header band
  header: {
    background: 'var(--card-bg)',
    backdropFilter: 'var(--card-backdrop)',
    borderBottom: '2px solid var(--orange)',
    display: 'flex',
    alignItems: 'center',
    padding: '10px 16px',
    gap: 24,
  },
  siteName: {
    fontFamily: 'var(--font-h1)',
    fontWeight: 700,
    fontSize: 'clamp(1.1rem,2.2vw,1.6rem)',
    textTransform: 'uppercase',
    letterSpacing: '-0.01em',
    color: 'var(--t-primary)',
    whiteSpace: 'nowrap',
    lineHeight: 1,
    textDecoration: 'none',
  },
  tagline: {
    fontFamily: 'var(--font-h2)',
    fontSize: 11,
    color: 'var(--t-muted)',
    marginTop: 2,
  },
  // main nav bar
  mainNav: {
    background: 'var(--card-bg)',
    backdropFilter: 'var(--card-backdrop)',
    borderBottom: '1px solid var(--card-border-clr)',
    display: 'flex',
    alignItems: 'stretch',
    padding: '0 12px',
  },
  navItem: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  navBtn: {
    fontFamily: 'var(--font-h2)',
    fontSize: 12,
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
    color: 'var(--t-secondary)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '10px 14px',
    transition: 'color .15s',
    whiteSpace: 'nowrap',
    textDecoration: 'none',
    display: 'block',
  },
  // dropdown panel
  dropdown: {
    position: 'absolute',
    top: '100%',
    left: 0,
    zIndex: 100,
    background: 'var(--card-bg)',
    backdropFilter: 'var(--card-backdrop)',
    border: '1px solid var(--card-border-clr)',
    borderTop: '2px solid var(--orange)',
    boxShadow: 'var(--card-shadow)',
    display: 'flex',
    gap: 0,
    minWidth: 300,
    padding: '12px 0 8px',
  },
  dropdownSection: {
    padding: '0 20px',
    minWidth: 160,
  },
  dropdownHeading: {
    fontFamily: 'var(--font-h2)',
    fontSize: 9,
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    color: 'var(--orange)',
    opacity: 0.85,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottom: '1px solid var(--card-border-clr)',
  },
  dropdownLink: {
    display: 'block',
    fontFamily: 'var(--font-h2)',
    fontSize: 12,
    color: 'var(--t-secondary)',
    textDecoration: 'none',
    padding: '4px 0',
    whiteSpace: 'nowrap',
    transition: 'color .12s',
  },
  // body
  body: {
    maxWidth: 1100,
    margin: '0 auto',
    width: '100%',
    padding: '24px 16px',
  },
  // section card
  sectionCard: {
    border: '1px solid var(--card-border-clr)',
    borderTop: '2px solid var(--orange)',
    background: 'var(--card-bg)',
    backdropFilter: 'var(--card-backdrop)',
    boxShadow: 'var(--card-shadow)',
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 0,
  },
  sectionHead: {
    fontFamily: 'var(--font-h2)',
    fontSize: 11,
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    color: 'var(--orange)',
    padding: '8px 12px',
    borderBottom: '1px solid var(--card-border-clr)',
    background: 'rgba(234,96,32,0.08)',
  },
  sectionHead2: {
    fontFamily: 'var(--font-h2)',
    fontSize: 11,
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    color: 'var(--orange)',
  },
};

// ─── Dropdown Nav ──────────────────────────────────────────────────────────────
function NavDropdown({ item }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const timer = useRef(null);

  const show = () => { clearTimeout(timer.current); setOpen(true); };
  const hide = () => { timer.current = setTimeout(() => setOpen(false), 120); };

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div
      ref={ref}
      style={S.navItem}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      <span
        style={{
          ...S.navBtn,
          color: open ? 'var(--cream)' : 'var(--t-secondary)',
          borderBottom: open ? '2px solid var(--orange)' : '2px solid transparent',
        }}
      >
        {item.label}
      </span>
      {open && (
        <div style={S.dropdown} onMouseEnter={show} onMouseLeave={hide}>
          {item.sections.map((sec) => (
            <div key={sec.heading} style={{ ...S.dropdownSection, borderRight: item.sections.indexOf(sec) < item.sections.length - 1 ? '1px solid var(--card-border-clr)' : 'none' }}>
              <div style={S.dropdownHeading}>{sec.heading}</div>
              {sec.links.map((lnk) => (
                <Link
                  key={lnk.to + lnk.label}
                  to={lnk.to}
                  style={S.dropdownLink}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-secondary)'; }}
                >
                  {lnk.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── League Card ──────────────────────────────────────────────────────────────
function LeagueCard({ league }) {
  const navigate = useNavigate();
  const { id, label, full, texture, active, years, links } = league;
  const yearRange = years && years.length > 0 ? `${Math.min(...years)}–${Math.max(...years)}` : (years !== null ? 'Coming Soon' : null);

  return (
    <div
      style={{
        border: '1px solid var(--card-border-clr)',
        borderTop: '2px solid var(--orange)',
        background: 'var(--card-bg)',
        backdropFilter: 'var(--card-backdrop)',
        boxShadow: 'var(--card-shadow)',
        borderRadius: 2,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 3D disc + header */}
      <div
        onClick={() => active && navigate(`/${id}`)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 14px',
          cursor: active ? 'pointer' : 'default',
          borderBottom: '1px solid var(--card-border-clr)',
          background: 'rgba(234,96,32,0.06)',
          transition: 'background .15s',
        }}
        onMouseEnter={e => { if (active) e.currentTarget.style.background = 'rgba(234,96,32,0.14)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(234,96,32,0.06)'; }}
      >
        <img
          src={texture}
          alt={label}
          style={{ width: 54, height: 54, objectFit: 'contain', flexShrink: 0, borderRadius: 4 }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: '1.15rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-primary)', lineHeight: 1 }}>
            {label}
          </div>
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)', marginTop: 2 }}>{full}</div>
          {yearRange && (
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)', marginTop: 3 }}>{yearRange}</div>
          )}
        </div>
      </div>

      {/* Sub-links */}
      <div style={{ padding: '8px 14px', display: 'flex', flexWrap: 'wrap', gap: '4px 0' }}>
        {links.map((lnk, i) => (
          <React.Fragment key={lnk.to}>
            <Link
              to={lnk.to}
              style={{ fontFamily: 'var(--font-h2)', fontSize: 12, color: 'var(--t-secondary)', textDecoration: 'none', transition: 'color .12s' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-secondary)'; }}
            >
              {lnk.label}
            </Link>
            {i < links.length - 1 && (
              <span style={{ color: 'var(--t-muted)', margin: '0 8px', fontSize: 11 }}>·</span>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ─── What's Happening (Ultiworld RSS via backend proxy) ───────────────────────
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

const NEWS_TABS = [
  { label: 'Pro',     division: 'pro',     link: 'https://ultiworld.com/division/pul,wul,ufa/' },
  { label: 'Club',    division: 'club',    link: 'https://ultiworld.com/division/usau-club/' },
  { label: 'College', division: 'college', link: 'https://ultiworld.com/division/usau-college/' },
  { label: 'Youth',   division: 'youth',   link: 'https://ultiworld.com/division/usau-high-school,usau-youth-club/' },
];

function fmtDate(str) {
  try { return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}

const _POST_COLORS = ['#B84D10', '#9A3E0B', '#7A3108', '#5C2406', '#C0581A', '#A04010'];

function RecentPosts() {
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

  return (
    <div style={S.sectionCard}>
      {status === 'loading' && (
        <div style={{ aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t-muted)', fontSize: 11, fontStyle: 'italic' }}>Loading…</div>
      )}
      {status === 'error' && (
        <div style={{ aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t-muted)', fontSize: 11, fontStyle: 'italic' }}>Could not load posts.</div>
      )}
      {status === 'ready' && posts.length === 0 && (
        <div style={{ aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t-muted)', fontSize: 11, fontStyle: 'italic' }}>No posts yet.</div>
      )}

      {status === 'ready' && posts.length > 0 && (
        <div style={{ position: 'relative', aspectRatio: '16/9', overflow: 'hidden' }}>
          {/* ── Slides ── */}
          {posts.map((post, i) => {
            const colorIdx = Math.abs((post.post_id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % _POST_COLORS.length;
            return (
              <div
                key={post.post_id}
                style={{
                  position: 'absolute', inset: 0,
                  opacity: i === current ? 1 : 0,
                  transition: 'opacity 0.5s ease',
                  background: _POST_COLORS[colorIdx],
                  pointerEvents: i === current ? 'auto' : 'none',
                }}
              >
                {post.cover_image_url && (
                  <img src={post.cover_image_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                )}
                {!post.cover_image_url && (
                  <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.06) 0px, rgba(0,0,0,0.06) 1px, transparent 1px, transparent 14px)' }} />
                )}
                {/* Bottom gradient */}
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0) 15%)' }} />
                {/* Text overlay */}
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
                      {fmtDate(post.published_at)}
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

          {/* ── Dot nav (on image) ── */}
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
      )}
    </div>
  );
}

function WhatsHappening() {
  const [active, setActive]   = useState(0);
  const [cache,  setCache]    = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (cache[active] !== undefined) return;
    setLoading(true);
    const tab = NEWS_TABS[active];
    fetch(`${API_BASE}/api/news?division=${tab.division}`)
      .then(r => r.json())
      .then(data => {
        setCache(prev => ({ ...prev, [active]: data.items ?? [] }));
        setLoading(false);
      })
      .catch(() => {
        setCache(prev => ({ ...prev, [active]: [] }));
        setLoading(false);
      });
  }, [active]);

  const tab   = NEWS_TABS[active];
  const items = cache[active];

  const tabBtn = (i) => ({
    fontFamily: 'var(--font-h2)',
    fontSize: 10,
    letterSpacing: '1px',
    textTransform: 'uppercase',
    padding: '3px 10px',
    border: active === i ? '1px solid var(--orange)' : '1px solid var(--card-border-clr)',
    borderRadius: 2,
    background: active === i ? 'var(--orange)' : 'transparent',
    color: active === i ? '#fff' : 'var(--t-muted)',
    cursor: 'pointer',
    transition: 'all .12s',
  });

  return (
    <div style={{ ...S.sectionCard, flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* header + tabs */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--card-border-clr)', background: 'rgba(234,96,32,0.08)', flexShrink: 0 }}>
        <span style={S.sectionHead2}>What's Happening</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {NEWS_TABS.map((t, i) => (
            <button key={t.label} onClick={() => setActive(i)} style={tabBtn(i)}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* stories — scrollable, fills remaining height */}
      <div style={{ padding: '10px 14px 6px', flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ paddingTop: 16, textAlign: 'center', color: 'var(--t-muted)', fontSize: 11, fontStyle: 'italic' }}>Loading…</div>
        )}
        {!loading && items && items.length === 0 && (
          <div style={{ paddingTop: 16, textAlign: 'center', color: 'var(--t-muted)', fontSize: 11, fontStyle: 'italic' }}>No recent {tab.label.toLowerCase()} stories — check back during season.</div>
        )}
        {!loading && items && items.map((item, i) => (
          <div key={i} style={{ borderBottom: '1px solid var(--card-border-clr)', padding: '6px 0' }}>
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'block', fontFamily: 'var(--font-h2)', fontSize: 13, color: 'var(--t-secondary)', textDecoration: 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3, transition: 'color .12s' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-secondary)'; }}
            >
              {item.title}
            </a>
            <div style={{ fontSize: 10, color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {item.author ? `${item.author} · ` : ''}{fmtDate(item.pubDate)}
            </div>
          </div>
        ))}
        <div style={{ paddingTop: 6, flexShrink: 0 }}>
          <a
            href={tab.link}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--orange)', textDecoration: 'none', letterSpacing: '0.5px' }}
          >
            More at Ultiworld →
          </a>
        </div>
      </div>
    </div>
  );
}


// 2 divisions × 6 teams exact height:
// borderTop(2) + header(36) + bodyPad(20) + 2×(divHead(26)+6teams(149)) + divGap(14) + borderBot(1) = 423px
const STANDINGS_H = 460;

const STANDINGS_LEAGUES = ['UFA', 'WUL', 'PUL'];

const COL_HEAD = { fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 600 };

const PUL_LOGO = {
  'Philadelphia Surge':   'phi_surge',
  'New York Gridlock':    'nyc_gridlock',
  'Indy Red':             'ind_red',
  'Milwaukee Monarchs':   'mil_monarchs',
  'Minnesota Strike':     'mn_strike',
  'DC Shadow':            'dc_shadow',
  'Atlanta Soul':         'atl_soul',
  'Raleigh Radiance':     'ral_radiance',
  'Austin Torch':         'atx_torch',
  'Nashville NightShade': 'nsh_nightshade',
  'Columbus Pride':       'clb_pride',
  'LA Astra':             'la_astra',
  'Portland Rising':      'pme_portlandrising',
};

const LEAGUE_BADGE_COLOR = { UFA: '#1a6fc4', PUL: '#c42b1a', WUL: '#1a9c5b', International: '#8c5fc4', USAU: '#888' };

function RandomPlayerCard() {
  const [player,  setPlayer]  = useState(null);
  const [status,  setStatus]  = useState('loading');

  const load = () => {
    setStatus('loading');
    setPlayer(null);
    fetch('/api/players/random')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setPlayer(d); setStatus('ready'); })
      .catch(() => setStatus('error'));
  };

  useEffect(() => { load(); }, []);

  const c   = player?.career  || {};
  const ss  = player?.seasons || [];
  const hasSS  = c.gp > 0;
  const compPct = hasSS && c.throws > 0 ? ((c.completions / c.throws) * 100).toFixed(1) : null;
  const huckPct = hasSS && c.hucks_thrown > 0 ? ((c.hucks_completed / c.hucks_thrown) * 100).toFixed(1) : null;

  const perGame = (v) => hasSS && c.gp > 0 ? (v / c.gp).toFixed(1) : '—';

  const STAT_LABEL = { fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', marginTop: 3 };
  const STAT_VAL   = { fontFamily: 'var(--font-h1)', fontSize: 18, fontWeight: 700, color: 'var(--orange)', lineHeight: 1 };
  const SUB_VAL    = { fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-secondary)', marginTop: 1 };
  const SEC_HEAD   = { fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', borderBottom: '1px solid var(--card-border-clr)', paddingBottom: 4, marginBottom: 8 };

  return (
    <div style={{ ...S.sectionCard, flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--card-border-clr)', background: 'rgba(234,96,32,0.08)', flexShrink: 0 }}>
        <span style={S.sectionHead2}>Player Spotlight</span>
        <button onClick={load} title="Random player" style={{ background: 'transparent', border: '1px solid var(--card-border-clr)', borderRadius: 2, cursor: 'pointer', padding: '2px 8px', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--t-muted)', transition: 'all .12s' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--orange)'; e.currentTarget.style.color = 'var(--orange)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--card-border-clr)'; e.currentTarget.style.color = 'var(--t-muted)'; }}
        >Shuffle ↺</button>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 10px' }}>
        {status === 'loading' && <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', padding: '40px 0', textAlign: 'center' }}>Loading…</div>}
        {status === 'error'   && <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)', padding: '40px 0', textAlign: 'center' }}>Could not load player.</div>}

        {status === 'ready' && player && (<>

          {/* ── Hero: photo + identity ── */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 14 }}>
            {player.photo_url ? (
              <img src={player.photo_url} alt={player.name}
                style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 6, flexShrink: 0, border: '2px solid var(--card-border-clr)' }}
                onError={e => { e.currentTarget.style.display = 'none'; }}
              />
            ) : (
              <div style={{ width: 100, height: 100, borderRadius: 6, flexShrink: 0, border: '2px solid var(--card-border-clr)', background: 'var(--surf-bg-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontFamily: 'var(--font-h1)', fontSize: 36, color: 'var(--t-muted)', opacity: 0.3 }}>?</span>
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              {player.number != null && (
                <div style={{ fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1px', color: 'var(--orange)', marginBottom: 2 }}>#{player.number}</div>
              )}
              <div style={{ fontFamily: 'var(--font-h1)', fontSize: 18, fontWeight: 700, color: 'var(--t-primary)', lineHeight: 1.2, marginBottom: 4 }}>{player.name}</div>
              {player.team && <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-secondary)', marginBottom: 7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.team}</div>}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {player.leagues.map(lg => (
                  <span key={lg} style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1px', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 2, background: LEAGUE_BADGE_COLOR[lg] || '#555', color: '#fff' }}>{lg}</span>
                ))}
              </div>
              {ss.length > 0 && (
                <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)', marginTop: 6 }}>
                  {ss[ss.length - 1].year}–{ss[0].year} · {ss.length} season{ss.length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>

          {/* ── Career stats ── */}
          <div style={{ marginBottom: 14 }}>
            <div style={SEC_HEAD}>Career Totals{hasSS ? ` · ${c.gp} GP` : ''}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {[
                  { label: 'Goals',   val: c.goals   ?? '—', sub: hasSS ? `${perGame(c.goals)}/gm`   : '—' },
                  { label: 'Assists', val: c.assists  ?? '—', sub: hasSS ? `${perGame(c.assists)}/gm` : '—' },
                  { label: 'Blocks',  val: c.blocks   ?? '—', sub: hasSS ? `${perGame(c.blocks)}/gm`  : '—' },
                  { label: 'Comp %',  val: compPct ? `${compPct}%` : '—', sub: hasSS && c.throws ? `${c.throws} att` : '—' },
                  { label: 'Hucks',   val: c.hucks_thrown ?? '—', sub: huckPct ? `${huckPct}% cmp` : '—' },
                  { label: 'AEC',     val: c.total_aec != null ? (c.total_aec > 0 ? `+${c.total_aec}` : `${c.total_aec}`) : '—', sub: 'career' },
                ].map(({ label, val, sub }) => (
                  <div key={label} style={{ background: 'var(--surf-bg-2)', borderRadius: 4, padding: '8px 6px', textAlign: 'center' }}>
                    <div style={STAT_VAL}>{val}</div>
                    <div style={STAT_LABEL}>{label}</div>
                    {sub && <div style={SUB_VAL}>{sub}</div>}
                  </div>
                ))}
              </div>
            </div>

          {/* ── Season-by-season ── */}
          <div style={{ marginBottom: 12 }}>
            <div style={SEC_HEAD}>Season Log</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-h2)', fontSize: 9, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 32 }} />{/* Year */}
                  <col style={{ width: 26 }} />{/* Lg */}
                  <col />{/* Team — fills remaining */}
                  <col style={{ width: 22 }} />{/* GP */}
                  <col style={{ width: 20 }} />{/* G */}
                  <col style={{ width: 20 }} />{/* A */}
                  <col style={{ width: 20 }} />{/* B */}
                  <col style={{ width: 34 }} />{/* Cmp% */}
                  <col style={{ width: 30 }} />{/* AEC */}
                </colgroup>
                <thead>
                  <tr style={{ color: 'var(--t-muted)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                    {['Year', 'Lg', 'Team', 'GP', 'G', 'A', 'B', 'Cmp%', 'AEC'].map(h => (
                      <th key={h} style={{ textAlign: h === 'Team' ? 'left' : 'right', padding: '2px 4px', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 5 }, (_, i) => {
                    const s = ss[i] || null;
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--surf-bg-2)', color: 'var(--t-primary)' }}>
                        <td style={{ textAlign: 'right', padding: '3px 4px', color: 'var(--orange)', fontWeight: 700 }}>{s?.year ?? '—'}</td>
                        <td style={{ textAlign: 'right', padding: '3px 4px', color: s ? (LEAGUE_BADGE_COLOR[s.league] || 'var(--t-muted)') : 'var(--t-muted)', fontWeight: 700 }}>{s?.league ?? '—'}</td>
                        <td style={{ textAlign: 'left', padding: '3px 4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--t-secondary)' }}>{s?.team ?? '—'}</td>
                        <td style={{ textAlign: 'right', padding: '3px 4px' }}>{s != null ? (s.gp      ?? '—') : '—'}</td>
                        <td style={{ textAlign: 'right', padding: '3px 4px' }}>{s != null ? (s.goals   ?? '—') : '—'}</td>
                        <td style={{ textAlign: 'right', padding: '3px 4px' }}>{s != null ? (s.assists ?? '—') : '—'}</td>
                        <td style={{ textAlign: 'right', padding: '3px 4px' }}>{s != null ? (s.blocks  ?? '—') : '—'}</td>
                        <td style={{ textAlign: 'right', padding: '3px 4px' }}>{s?.comp_pct != null ? `${s.comp_pct}%` : '—'}</td>
                        <td style={{ textAlign: 'right', padding: '3px 4px', color: s?.aec > 0 ? 'var(--orange)' : s?.aec < 0 ? '#e05555' : 'inherit' }}>{s?.aec != null && s.aec !== 0 ? (s.aec > 0 ? `+${s.aec}` : s.aec) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

          {/* ── Footer link ── */}
          <Link to={`/players/${player.id}`} style={{ display: 'block', textAlign: 'center', padding: '7px 0', borderRadius: 3, border: '1px solid var(--orange)', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--orange)', textDecoration: 'none', transition: 'all .12s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--orange)'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--orange)'; }}
          >View Full Profile →</Link>

        </>)}
      </div>
    </div>
  );
}

function StandingsCard() {
  const [data,   setData]   = useState({ PUL: null, WUL: null, UFA: null });
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    Promise.all([
      fetch('/api/pul/standings').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/wul/standings').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/ufa/standings').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([pul, wul, ufa]) => {
      setData({ PUL: pul, WUL: wul, UFA: ufa });
      setStatus('ready');
    }).catch(() => setStatus('error'));
  }, []);

  const LEAGUE_HEAD = { fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 700, borderBottom: '1px solid var(--orange)', paddingBottom: 5, marginBottom: 10, display: 'block' };

  return (
    <div style={S.sectionCard}>
      {/* header */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--card-border-clr)', background: 'rgba(234,96,32,0.08)' }}>
        <span style={S.sectionHead2}>Standings</span>
      </div>

      {/* body */}
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {status === 'loading' && (
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', padding: '12px 0' }}>Loading…</div>
        )}
        {status === 'error' && (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)', padding: '12px 0' }}>Could not load standings.</div>
        )}

        {/* PUL */}
        {status === 'ready' && data.PUL && (
          <div style={{ paddingBottom: 20 }}>
            <div style={LEAGUE_HEAD}>PUL</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {(data.PUL.divisions || []).map(div => (
                <div key={div.division}>
                  <div style={{ marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--card-border-clr)' }}>
                    <span style={COL_HEAD}>{div.division}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {(div.teams || []).map((t, i) => {
                      const slug = PUL_LOGO[t.team];
                      return (
                        <Link key={t.team} to={`/pul/teams/${encodeURIComponent(t.team)}`}
                          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 5px', borderRadius: 4, textDecoration: 'none', background: i % 2 === 0 ? 'transparent' : 'var(--surf-bg-2)', transition: 'background .1s' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(234,96,32,0.08)'}
                          onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--surf-bg-2)'}
                        >
                          {slug && <img src={`${BASE}assets/png/PUL_teams/${slug}.png`} alt="" style={{ width: 16, height: 16, objectFit: 'contain', flexShrink: 0 }} onError={e => { e.currentTarget.style.display = 'none'; }} />}
                          <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--t-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.team}</span>
                          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--mono-clr)', fontWeight: 600, flexShrink: 0 }}>{t.wins}-{t.losses}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* WUL */}
        {status === 'ready' && data.WUL && (
          <div style={{ borderTop: '1px solid var(--card-border-clr)', paddingTop: 16, paddingBottom: 20 }}>
            <div style={LEAGUE_HEAD}>WUL</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {(data.WUL.divisions || []).map(div => (
                <div key={div.division}>
                  <div style={{ marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--card-border-clr)' }}>
                    <span style={COL_HEAD}>{div.division}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {(div.teams || []).map((t, i) => (
                      <Link key={t.team} to={t.franchise_id ? `/wul/teams/${t.franchise_id}` : '#'}
                        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 5px', borderRadius: 4, textDecoration: 'none', background: i % 2 === 0 ? 'transparent' : 'var(--surf-bg-2)', transition: 'background .1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(234,96,32,0.08)'}
                        onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--surf-bg-2)'}
                      >
                        {t.logo_slug && <img src={`${BASE}assets/png/WUL_teams/${t.logo_slug}.png`} alt="" style={{ width: 16, height: 16, objectFit: 'contain', flexShrink: 0 }} onError={e => { e.currentTarget.style.display = 'none'; }} />}
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--t-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.team}</span>
                        <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--mono-clr)', fontWeight: 600, flexShrink: 0 }}>{t.wins}-{t.losses}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* UFA */}
        {status === 'ready' && data.UFA && (
          <div style={{ borderTop: '1px solid var(--card-border-clr)', paddingTop: 16 }}>
            <div style={LEAGUE_HEAD}>UFA</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {(data.UFA.divisions || []).map((div) => (
                <div key={div.division}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--card-border-clr)' }}>
                    {div.icon && <img src={div.icon} alt="" style={{ width: 13, height: 13, objectFit: 'contain', opacity: 0.7 }} />}
                    <span style={COL_HEAD}>{div.division}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {(div.teams || []).map((t, i) => (
                      <a key={t.name} href={`https://www.watchufa.com/${t.teamID}`} target="_blank" rel="noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 5px', borderRadius: 4, textDecoration: 'none', background: i % 2 === 0 ? 'transparent' : 'var(--surf-bg-2)', transition: 'background .1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(234,96,32,0.08)'}
                        onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--surf-bg-2)'}
                      >
                        {t.icon && <img src={t.icon} alt="" style={{ width: 16, height: 16, objectFit: 'contain', flexShrink: 0 }} />}
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--t-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                        <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--mono-clr)', fontWeight: 600, flexShrink: 0 }}>{t.wins}-{t.losses}{t.ties ? `-${t.ties}` : ''}</span>
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
const WRAP = {
  maxWidth: 1560,
  width: '100%',
  margin: '0 auto',
  flexGrow: 1,
  border: '1px solid var(--card-border-clr)',
  boxShadow: 'var(--card-shadow)',
  borderRadius: 4,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

function useWindowWidth() {
  const [w, setW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1200));
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return w;
}

function MobileNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const toggle = (label) => setExpanded(p => p === label ? null : label);
  const close = () => setMenuOpen(false);

  return (
    <div>
      {/* ── Trigger bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', background: 'var(--card-bg)', borderBottom: menuOpen ? 'none' : '1px solid var(--card-border-clr)' }}>
        <Link
          to="/players"
          onClick={close}
          style={{ ...S.navBtn, color: 'var(--orange-light)', padding: '10px 0' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--cream)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--orange-light)'; }}
        >Player Search</Link>
        <button
          onClick={() => { setMenuOpen(o => !o); if (menuOpen) setExpanded(null); }}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '10px 4px', color: 'var(--t-secondary)', fontSize: 20, lineHeight: 1 }}
        >
          {menuOpen ? '\u2715' : '\u2630'}
        </button>
      </div>

      {/* ── Expanded panel ── */}
      {menuOpen && (
        <div style={{ background: 'var(--card-bg)', borderBottom: '2px solid var(--orange)' }}>
          {NAV_ITEMS.map(item => (
            <div key={item.label} style={{ borderBottom: '1px solid var(--card-border-clr)' }}>
              <button
                onClick={() => toggle(item.label)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-h2)', fontSize: 12, letterSpacing: '0.8px', textTransform: 'uppercase', color: expanded === item.label ? 'var(--orange)' : 'var(--t-secondary)', transition: 'color .12s' }}
              >
                <span>{item.label}</span>
                <span style={{ fontSize: 10, display: 'inline-block', transition: 'transform .15s', transform: expanded === item.label ? 'rotate(180deg)' : 'none' }}>\u25be</span>
              </button>
              {expanded === item.label && (
                <div style={{ background: 'var(--surf-bg-2)', paddingBottom: 8 }}>
                  {item.sections.map(sec => (
                    <div key={sec.heading} style={{ padding: '8px 20px 4px' }}>
                      <div style={{ ...S.dropdownHeading, marginBottom: 6 }}>{sec.heading}</div>
                      {sec.links.map(lnk => (
                        <Link
                          key={lnk.to + lnk.label}
                          to={lnk.to}
                          onClick={close}
                          style={{ ...S.dropdownLink, display: 'block', padding: '7px 0', fontSize: 13 }}
                          onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange)'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-secondary)'; }}
                        >{lnk.label}</Link>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function LandingPage() {
  const isMobile = useWindowWidth() < 768;
  const standingsRef = useRef(null);
  const [standingsH, setStandingsH] = useState(0);
  useEffect(() => {
    if (isMobile) { setStandingsH(0); return; }
    const el = standingsRef.current;
    if (!el) return;
    const ro = new ResizeObserver(e => setStandingsH(e[0].contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile]);
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', padding: isMobile ? '0' : '24px 16px', boxSizing: 'border-box' }}>
    <div style={{ ...WRAP, height: isMobile ? '100dvh' : 'calc(100vh - 48px)', borderRadius: isMobile ? 0 : 4 }}>

      {/* ── Top subnav ── */}
      <div style={{ flexShrink: 0, background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', borderRadius: '4px 4px 0 0' }}>
      {!isMobile && <div style={{ ...S.subnav, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          {pruneNav([
            { label: 'WFDF', to: '/wfdf' },
            { label: 'USAU', to: '/usau' },
            { label: 'PUL',  to: '/pul' },
            { label: 'WUL',  to: '/wul' },
            { label: 'UFA',  to: '/ufa' },
            { label: 'MLU',  to: '/mlu' },
          ]).map((item, i, arr) => (
            <React.Fragment key={item.to}>
              <Link
                to={item.to}
                style={S.subnavLink}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-muted)'; }}
              >
                {item.label}
              </Link>
              {i < arr.length - 1 && <span style={{ color: 'var(--card-border-clr)', fontSize: 10 }}>|</span>}
            </React.Fragment>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          {pruneNav([
            { label: 'Blog',      to: '/blog' },
            { label: 'Subscribe', to: '/subscribe' },
            { label: 'Account',   to: '/account' },
          ]).map((item, i, arr) => (
            <React.Fragment key={item.to}>
              <Link
                to={item.to}
                style={S.subnavLink}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-muted)'; }}
              >
                {item.label}
              </Link>
              {i < arr.length - 1 && <span style={{ color: 'var(--card-border-clr)', fontSize: 10 }}>|</span>}
            </React.Fragment>
          ))}
        </div>
      </div>}

      {/* ── Site header ── */}
      <div style={S.header}>
        <div>
          <Link to="/" style={S.siteName}>Ulti-Reference</Link>
          <div style={S.tagline}>Stats, throws &amp; analytics across professional ultimate frisbee</div>
        </div>
      </div>

      {/* ── Main nav ── */}
      {isMobile ? <MobileNav /> : (
        <div style={S.mainNav}>
          {NAV_ITEMS.map((item) => (
            <NavDropdown key={item.label} item={item} />
          ))}
          <div style={{ flex: 1 }} />
          <Link
            to="/players"
            style={{ ...S.navBtn, color: 'var(--orange-light)', display: 'flex', alignItems: 'center' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--cream)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--orange-light)'; }}
          >
            Player Search
          </Link>
        </div>
      )}
      </div>{/* end header chrome */}

      {/* ── Body ── */}
      <div className="orange-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ ...S.body, margin: 0, maxWidth: 'none', display: 'flex', gap: 20, alignItems: isMobile ? 'stretch' : 'flex-start', flexDirection: isMobile ? 'column' : 'row', padding: isMobile ? '12px 12px' : '24px 16px' }}>

          {/* ── Left: carousel + leagues + what's happening (3x width) ── */}
          <div style={{ flex: isMobile ? 'none' : 3, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20, ...((!isMobile && standingsH) ? { height: standingsH } : {}) }}>
            <RecentPosts />

            <div style={S.sectionCard}>
              <div style={S.sectionHead}>Leagues</div>
              <div style={{ padding: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                {LEAGUES.filter(l => isLeagueEnabled(l.id)).map((league) => (
                  <LeagueCard key={league.id} league={league} />
                ))}
              </div>
            </div>

            {/* ── Bottom row: news + player spotlight ── */}
            <div style={{ display: 'flex', gap: 20, alignItems: 'stretch', flex: isMobile ? 'none' : 1, minHeight: isMobile ? 'auto' : 0, flexDirection: isMobile ? 'column' : 'row' }}>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}><WhatsHappening /></div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}><RandomPlayerCard /></div>
            </div>
          </div>

          {/* ── Right: standings (1x width) ── */}
          <div ref={standingsRef} style={{ flex: isMobile ? 'none' : 1, minWidth: 0 }}>
            <StandingsCard />
          </div>

        </div>
      </div>

      {/* ── Footer ── */}
      <div style={{ flexShrink: 0, borderTop: '1px solid var(--card-border-clr)', background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, borderRadius: '0 0 4px 4px' }}>
        <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
          {pruneNav([
            { label: 'Blog',                to: '/blog' },
            { label: 'Account',             to: '/account' },
            { label: 'Submit UltiAnalytics', to: '/submit/ultianalytics' },
          ]).map((lnk, i, arr) => (
            <React.Fragment key={lnk.to}>
              <Link
                to={lnk.to}
                style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)', textDecoration: 'none', padding: '2px 8px', transition: 'color .12s' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-muted)'; }}
              >
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

// LeagueIcon kept for backward compat (no longer used on landing page)
function LeagueIcon({ league, rotationY, rotationX = 0, canvasDown = 0, itemIndex = 0, onClick }) {
  const { label, full, stl, texture, color, active, years } = league;
  const glb = `${BASE}assets/glb/${label}icon.glb`;

  return (
    <div
      onClick={onClick}
      className={[
        `flex flex-col items-center select-none min-w-0 league-item-${itemIndex}`,
        active ? 'cursor-pointer group' : 'cursor-default',
      ].join(' ')}
      style={{ flex: '1 1 0' }}
    >
      <div style={{
        width: '100%',
        aspectRatio: '1 / 1',
        maxHeight: 'min(18vw, 38vh)',
        maxWidth:  'min(18vw, 38vh)',
        margin: '0 auto',
        transform: canvasDown ? `translateY(${canvasDown}px)` : undefined,
      }}>
        <STLViewer url={stl} glb={glb ?? null} rotationY={rotationY} rotationX={rotationX} color={color} texture={!glb ? texture : null} />
      </div>
      <div style={{
        marginTop: 12,
        fontFamily: 'var(--font-h1)',
        fontWeight: 600,
        fontSize: '1.4rem',
        textTransform: 'uppercase',
        letterSpacing: '0.18em',
        lineHeight: 1,
        color: active ? 'var(--cream)' : 'var(--text-cream)',
        opacity: active ? 1 : 0.7,
      }}>
        {label}
      </div>
      <div style={{ marginTop: 4, fontSize: 10, letterSpacing: '0.08em', color: 'var(--text-cream)', opacity: 0.5, textAlign: 'center' }}>{full}</div>
      {active && Array.isArray(years) ? (
        <div style={{ marginTop: 8, fontSize: 10, fontWeight: 600, color: 'var(--orange-pale)', letterSpacing: '0.08em' }}>
          {Math.min(...years)}–{Math.max(...years)}
        </div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--orange-light)', opacity: 0.5 }}>
          Coming soon
        </div>
      )}
    </div>
  );
}
