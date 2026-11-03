import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageChrome from '../components/PageChrome.jsx';

const BASE   = import.meta.env.BASE_URL.replace(/\/$/, '');
const ORANGE = '#EA6020';

const FALLBACK_COLORS = ['#B84D10', '#9A3E0B', '#7A3108', '#5C2406', '#C0581A', '#A04010'];

function fmtDate(str) {
  if (!str) return '';
  return new Date(str).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function PostCard({ post, onClick }) {
  const [hov, setHov] = useState(false);
  const colorIdx = Math.abs(
    (post.post_id || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  ) % FALLBACK_COLORS.length;
  const imgColor = FALLBACK_COLORS[colorIdx];

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 12,
        border: hov ? '1px solid rgba(234,96,32,0.45)' : '1px solid var(--surf-border)',
        background: 'var(--surf-bg-2)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color .15s, box-shadow .15s',
        boxShadow: hov ? '0 8px 24px rgba(0,0,0,0.18)' : 'none',
      }}
    >
      {/* Cover */}
      <div style={{ height: 180, position: 'relative', overflow: 'hidden', background: imgColor, flexShrink: 0 }}>
        {post.cover_image_url ? (
          <img
            src={post.cover_image_url}
            alt={post.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', transition: 'transform .3s' }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 1px, transparent 1px, transparent 12px)' }} />
        )}
        {post.featured === 1 && (
          <div style={{ position: 'absolute', top: 10, left: 12, background: ORANGE, borderRadius: 99, padding: '2px 10px', fontFamily: 'var(--font-h2)', fontSize: 7, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#fff' }}>
            Featured
          </div>
        )}
        {post.category && (
          <div style={{ position: 'absolute', bottom: 10, left: 12 }}>
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '3px 10px', borderRadius: 99, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff' }}>
              {post.category}
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: '18px 20px 22px', display: 'flex', flexDirection: 'column', flex: 1 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--t-muted)', marginBottom: 8 }}>
          {fmtDate(post.published_at)}
          {post.author && <span style={{ marginLeft: 8, opacity: 0.7 }}>· {post.author}</span>}
        </div>
        <div style={{
          fontFamily: 'var(--font-h1)', fontWeight: 600,
          fontSize: '0.95rem', letterSpacing: '-0.01em', lineHeight: 1.3,
          color: hov ? 'var(--orange)' : 'var(--t-primary)',
          marginBottom: 10, transition: 'color .15s',
        }}>
          {post.title}
        </div>
        {post.subtitle && (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-secondary)', marginBottom: 8, lineHeight: 1.4 }}>
            {post.subtitle}
          </div>
        )}
        {post.summary && (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)', lineHeight: 1.65, flex: 1,
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {post.summary}
          </div>
        )}
        <div style={{ marginTop: 16, fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: ORANGE }}>
          Read →
        </div>
      </div>
    </div>
  );
}

export default function BlogPage() {
  const navigate = useNavigate();
  const [posts,    setPosts]    = useState([]);
  const [status,   setStatus]   = useState('loading');
  const [query,    setQuery]    = useState('');
  const [category, setCategory] = useState('all');

  useEffect(() => {
    fetch('/api/blog?limit=50')
      .then(r => r.json())
      .then(d => { setPosts(d); setStatus('ready'); })
      .catch(() => setStatus('error'));
  }, []);

  const categories = useMemo(() => {
    const cats = [...new Set(posts.map(p => p.category).filter(Boolean))].sort();
    return ['all', ...cats];
  }, [posts]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return posts.filter(p => {
      const matchCat = category === 'all' || p.category === category;
      const matchQ   = !q || p.title?.toLowerCase().includes(q) || p.summary?.toLowerCase().includes(q);
      return matchCat && matchQ;
    });
  }, [posts, query, category]);

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', padding: '24px 16px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{
        maxWidth: 1560, width: '100%',
        height: 'calc(100vh - 48px)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--card-bg)',
        borderRadius: 4,
        border: '1px solid var(--card-border-clr)',
        boxShadow: 'var(--card-shadow)',
        backdropFilter: 'var(--card-backdrop)',
        overflow: 'hidden',
      }}>

        {/* ── Site chrome ── */}
        <PageChrome />

        {/* ── Header ── */}
        <div style={{ padding: '28px 32px 20px', borderBottom: '1px solid var(--nav-border)', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--orange)', opacity: 0.7, marginBottom: 6 }}>
              Ulti-Reference
            </div>
            <div style={{ fontFamily: 'var(--font-h1)', fontSize: 'clamp(1.5rem, 2.5vw, 2rem)', letterSpacing: '-0.02em', textTransform: 'uppercase', color: 'var(--t-primary)', marginBottom: 6 }}>
              Blog
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)' }}>
              Analysis, guides, and updates from the Ulti-Reference team.
            </div>
          </div>

          {/* Search + category filter */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            {/* Category pills */}
            {categories.length > 1 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {categories.map(c => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    style={{
                      padding: '4px 12px', borderRadius: 99, cursor: 'pointer',
                      fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase',
                      border: category === c ? `1px solid ${ORANGE}` : '1px solid var(--surf-border)',
                      background: category === c ? ORANGE : 'var(--surf-bg-2)',
                      color: category === c ? '#fff' : 'var(--t-muted)',
                      transition: 'background .12s, color .12s, border-color .12s',
                    }}
                  >
                    {c === 'all' ? 'All' : c}
                  </button>
                ))}
              </div>
            )}
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search posts…"
              style={{
                width: 280, height: 36, padding: '0 14px', borderRadius: 8,
                border: '1px solid var(--input-border)', background: 'var(--input-bg)',
                color: 'var(--input-clr)', fontFamily: 'var(--font-body)', fontSize: 12,
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* ── Content ── */}
        <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          <div style={{ padding: '28px 32px 48px' }}>

            {status === 'loading' && (
              <div style={{ padding: '64px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase' }}>Loading…</div>
            )}
            {status === 'error' && (
              <div style={{ padding: '64px 0', textAlign: 'center', color: 'var(--orange)', fontFamily: 'var(--font-body)', fontSize: 13 }}>Could not load posts.</div>
            )}

            {status === 'ready' && filtered.length === 0 && (
              <div style={{ padding: '64px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>No posts match.</div>
            )}

            {status === 'ready' && filtered.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 24 }}>
                {filtered.map(post => (
                  <PostCard
                    key={post.post_id}
                    post={post}
                    onClick={() => navigate(`/blog/${post.post_id}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
