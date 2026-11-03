import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { pruneNav } from '../utils/features.js';

const BASE   = import.meta.env.BASE_URL.replace(/\/$/, '');
const ORANGE = '#EA6020';

const FALLBACK_IMG_COLORS = ['#B84D10', '#9A3E0B', '#7A3108', '#5C2406', '#3D1804'];

const SCARD = { border: '1px solid var(--card-border-clr)', borderTop: '2px solid var(--orange)', background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', boxShadow: 'var(--card-shadow)', borderRadius: 2, overflow: 'hidden', marginBottom: 20 };
const SHEAD = { fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--orange)', padding: '8px 12px', borderBottom: '1px solid var(--card-border-clr)', background: 'rgba(234,96,32,0.08)' };
const SNL   = { color: 'var(--t-muted)', textDecoration: 'none', padding: '2px 8px', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '0.5px', transition: 'color .15s', whiteSpace: 'nowrap' };
const SEP   = { color: 'var(--card-border-clr)', fontSize: 10 };

const EXPLORE_TILES = [
  { key: 'gamecenter', label: 'Game Center', sub: 'Browse game results and box scores',            href: '/pul/games' },
  { key: 'teams',     label: 'Teams',       sub: 'Rosters and team history across all seasons',  href: '/pul/teams' },
  { key: 'players',   label: 'Players',     sub: 'Search athletes across all PUL seasons',       href: '/pul/compare' },
  { key: 'compare',   label: 'Compare',     sub: 'Compare players head-to-head across seasons',  href: '/pul/compare' },
  { key: 'leader',    label: 'Leaderboard', sub: 'Season and career statistics by player',       href: '/pul/leaderboard', soon: true },
];

export default function PULLandingPage() {
  const navigate = useNavigate();

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', padding: '24px 16px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ maxWidth: 1560, width: '100%', height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--card-border-clr)', borderBottom: '1px solid var(--card-border-clr)', borderRadius: 4, overflow: 'hidden', background: 'transparent' }}>

        {/* ── Fixed chrome ── */}
        <div style={{ flexShrink: 0 }}>
          {/* ── Subnav ── */}
          <div style={{ background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', borderBottom: '1px solid var(--card-border-clr)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <Link to="/" style={SNL} onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-muted)'; }}>Home</Link>
              <span style={SEP}>|</span>
              {pruneNav([
                { label: 'WFDF', to: '/wfdf' },
                { label: 'USAU', to: '/usau' },
                { label: 'PUL',  to: '/pul' },
                { label: 'WUL',  to: '/wul' },
                { label: 'UFA',  to: '/ufa' },
                { label: 'MLU',  to: '/mlu' },
              ]).map((item, i, arr) => (
                <React.Fragment key={item.to}>
                  <Link to={item.to} style={{ ...SNL, color: item.to === '/pul' ? 'var(--orange)' : 'var(--t-muted)' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }} onMouseLeave={e => { e.currentTarget.style.color = item.to === '/pul' ? 'var(--orange)' : 'var(--t-muted)'; }}>{item.label}</Link>
                  {i < arr.length - 1 && <span style={SEP}>|</span>}
                </React.Fragment>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {pruneNav([{ label: 'Blog', to: '/blog' }, { label: 'Subscribe', to: '/subscribe' }, { label: 'Account', to: '/account' }]).map((item, i, arr) => (
                <React.Fragment key={item.to}>
                  <Link to={item.to} style={SNL} onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-muted)'; }}>{item.label}</Link>
                  {i < arr.length - 1 && <span style={SEP}>|</span>}
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* ── League hero band ── */}
          <div style={{ background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', borderBottom: '2px solid var(--orange)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'relative' }}>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '3px', textTransform: 'uppercase', color: 'var(--orange)', marginBottom: 3 }}>Premier Ultimate League</div>
              <h1 style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 'clamp(1.4rem, 2vw, 2rem)', color: 'var(--t-primary)', margin: 0, letterSpacing: '-0.03em', textTransform: 'uppercase', lineHeight: 1 }}>PUL</h1>
            </div>

          </div>
        </div>

        {/* ── Score ticker ── */}
        <ScoreTicker />

        {/* ── Scrollable body ── */}
        <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <div style={{ display: 'flex', gap: 20, padding: '20px', alignItems: 'flex-start' }}>

            {/* ── Left col (flex 3): carousel + explore ── */}
            <div style={{ flex: 3, minWidth: 0 }}>
              <div style={{ overflow: 'hidden', borderRadius: 2, marginBottom: 20 }}>
                <BlogCarousel />
              </div>
              <div style={SCARD}>
                <div style={SHEAD}>Explore</div>
                <div style={{ padding: 12 }}>
                  <ExploreCards />
                </div>
              </div>
            </div>

            {/* ── Right col (flex 1): standings ── */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={SCARD}>
                <div style={SHEAD}>Standings</div>
                <div style={{ padding: '10px 12px' }}>
                  <StandingsSidebar />
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--card-border-clr)', background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, borderRadius: '0 0 4px 4px' }}>
          <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
            {pruneNav([
              { label: 'Blog',                 to: '/blog' },
              { label: 'Subscribe',            to: '/subscribe' },
              { label: 'Account',              to: '/account' },
              { label: 'Submit UltiAnalytics', to: '/submit/ultianalytics' },
              { label: 'USAU Rankings',        to: '/usau' },
              { label: 'Status',               to: '/status' },
            ]).map((lnk, i, arr) => (
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

/* ── Score ticker (placeholder) ── */
function ScoreTicker() {
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
      <div className="ticker-week-card"><span>LIVE SCORES</span></div>
      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '1px', color: 'var(--t-muted)', padding: '0 20px', whiteSpace: 'nowrap' }}>
        Live results will appear here during the season
      </span>
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

  if (status === 'loading') return <div style={{ aspectRatio: '16/9', maxHeight: 'max(100px, calc(100vh - 620px))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t-muted)', fontSize: 11, fontStyle: 'italic' }}>Loading…</div>;
  if (status !== 'ready' || posts.length === 0) return null;

  return (
    <div style={{ position: 'relative', aspectRatio: '16/9', maxHeight: 'max(100px, calc(100vh - 620px))', overflow: 'hidden' }}>
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

/* ── PUL Standings sidebar ── */
function StandingsSidebar() {
  const [data,   setData]   = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    fetch('/api/pul/standings')
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => { setData(d); setStatus('ready'); })
      .catch(() => setStatus('error'));
  }, []);

  if (status === 'loading') return <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', padding: '8px 0' }}>Loading…</div>;
  if (status === 'error')   return <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>Could not load standings.</div>;

  const seasonLabel = data?.season || '2026';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {(data?.divisions || []).map(div => (
        <div key={div.division}>
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--orange)', fontWeight: 600, marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--card-border-clr)' }}>{div.division}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {(div.teams || []).map((t, i) => {
              const slug = PUL_LOGO[t.team];
              return (
                <Link key={t.team} to={`/pul/teams/${encodeURIComponent(t.team)}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', borderRadius: 4, textDecoration: 'none', background: i % 2 === 0 ? 'transparent' : 'var(--surf-bg-2)', transition: 'background .1s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(234,96,32,0.08)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--surf-bg-2)'; }}
                >
                  {slug
                    ? <img src={`${BASE}/assets/png/PUL_teams/${slug}.png`} alt="" style={{ width: 18, height: 18, objectFit: 'contain', flexShrink: 0 }} />
                    : <div style={{ width: 18, height: 18, flexShrink: 0 }} />
                  }
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.team}</span>
                  <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--mono-clr)', fontWeight: 600, flexShrink: 0 }}>{t.wins}-{t.losses}</span>
                  <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: (t.point_diff ?? 0) > 0 ? 'var(--orange)' : 'var(--t-muted)', flexShrink: 0, minWidth: 28, textAlign: 'right' }}>{(t.point_diff ?? 0) > 0 ? '+' : ''}{t.point_diff ?? ''}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExploreCards() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridAutoRows: '1fr', gap: 10 }}>
      {EXPLORE_TILES.map(tile => (
        <div key={tile.key} style={{ border: '1px solid var(--card-border-clr)', borderTop: `2px solid ${tile.soon ? 'var(--card-border-clr)' : 'var(--orange)'}`, background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', boxShadow: 'var(--card-shadow)', borderRadius: 2, overflow: 'hidden', display: 'flex', flexDirection: 'column', opacity: tile.soon ? 0.5 : 1 }}>
          <div style={{ display: 'block', flex: 1, padding: '12px 14px', borderBottom: '1px solid var(--card-border-clr)', background: 'rgba(234,96,32,0.06)', minHeight: 106, position: 'relative' }}>
            <div style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: '1.15rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-primary)', lineHeight: 1 }}>{tile.label}</div>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)', marginTop: 4, lineHeight: 1.4 }}>{tile.sub}</div>
            {tile.soon && <div style={{ position: 'absolute', top: 8, right: 10, fontFamily: 'var(--font-h2)', fontSize: 7, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--orange)', border: '1px solid var(--orange)', borderRadius: 99, padding: '2px 6px' }}>Coming Soon</div>}
          </div>
          <div style={{ padding: '8px 14px' }}>
            {tile.soon
              ? <span style={{ fontFamily: 'var(--font-h2)', fontSize: 12, color: 'var(--t-muted)', cursor: 'default' }}>Coming Soon</span>
              : <Link to={tile.href} style={{ fontFamily: 'var(--font-h2)', fontSize: 12, color: 'var(--t-secondary)', textDecoration: 'none', transition: 'color .12s' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-secondary)'; }}>Explore →</Link>
            }
          </div>
        </div>
      ))}
    </div>
  );
}
