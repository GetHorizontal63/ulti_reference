import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import PageChrome from '../components/PageChrome.jsx';

const BASE   = import.meta.env.BASE_URL.replace(/\/$/, '');
const ORANGE = '#EA6020';

const FALLBACK_COLORS = ['#B84D10', '#9A3E0B', '#7A3108', '#5C2406', '#C0581A', '#A04010'];

function fmtDate(str) {
  if (!str) return '';
  return new Date(str).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

// Markdown component overrides — themed to match the site design
const mdComponents = {
  h1: ({ children }) => (
    <h1 style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: '1.62rem', letterSpacing: '-0.02em', textTransform: 'uppercase', color: 'var(--t-primary)', margin: '2rem 0 0.75rem', lineHeight: 1.2 }}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: '1.2rem', letterSpacing: '-0.01em', textTransform: 'uppercase', color: 'var(--t-primary)', margin: '1.75rem 0 0.6rem', lineHeight: 1.2 }}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontFamily: 'var(--font-h2)', fontWeight: 600, fontSize: '0.96rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--orange)', margin: '1.5rem 0 0.5rem' }}>
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.8, lineHeight: 1.8, color: 'var(--t-secondary)', margin: '0 0 1rem' }}>
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul style={{ margin: '0 0 1rem', paddingLeft: 22, listStyle: 'disc' }}>
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol style={{ margin: '0 0 1rem', paddingLeft: 22 }}>
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li style={{ fontFamily: 'var(--font-body)', fontSize: 13.8, lineHeight: 1.8, color: 'var(--t-secondary)', marginBottom: 4 }}>
      {children}
    </li>
  ),
  strong: ({ children }) => (
    <strong style={{ fontFamily: 'var(--font-h2)', fontWeight: 600, color: 'var(--t-primary)' }}>
      {children}
    </strong>
  ),
  em: ({ children }) => (
    <em style={{ color: 'var(--t-secondary)' }}>{children}</em>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target={href?.startsWith('http') ? '_blank' : undefined}
      rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
      style={{ color: ORANGE, textDecoration: 'none', borderBottom: `1px solid rgba(234,96,32,0.35)`, transition: 'border-color .15s' }}
      onMouseEnter={e => e.currentTarget.style.borderBottomColor = ORANGE}
      onMouseLeave={e => e.currentTarget.style.borderBottomColor = 'rgba(234,96,32,0.35)'}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote style={{ margin: '1.25rem 0', padding: '14px 20px', borderLeft: `3px solid ${ORANGE}`, background: 'var(--surf-bg-2)', borderRadius: '0 8px 8px 0' }}>
      {children}
    </blockquote>
  ),
  code: ({ inline, children }) =>
    inline ? (
      <code style={{ fontFamily: 'monospace', fontSize: 12, background: 'var(--surf-bg-2)', border: '1px solid var(--surf-border)', borderRadius: 4, padding: '1px 6px', color: 'var(--orange)' }}>
        {children}
      </code>
    ) : (
      <pre style={{ background: 'var(--surf-bg-2)', border: '1px solid var(--surf-border)', borderRadius: 8, padding: '16px 18px', overflowX: 'auto', margin: '1rem 0' }}>
        <code style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--t-secondary)', lineHeight: 1.6 }}>
          {children}
        </code>
      </pre>
    ),
  hr: () => (
    <hr style={{ border: 'none', borderTop: '1px solid var(--surf-border)', margin: '2rem 0' }} />
  ),
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '1rem 0' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, fontFamily: 'var(--font-body)' }}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead style={{ background: 'var(--surf-bg-2)', borderBottom: '2px solid var(--surf-border)' }}>
      {children}
    </thead>
  ),
  th: ({ children }) => (
    <th style={{ padding: '8px 14px', textAlign: 'left', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td style={{ padding: '8px 14px', borderBottom: '1px solid var(--surf-border)', color: 'var(--t-secondary)', verticalAlign: 'top' }}>
      {children}
    </td>
  ),
};

export default function BlogPostPage() {
  const { postId } = useParams();
  const [post,   setPost]   = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    setStatus('loading');
    setPost(null);
    fetch(`/api/blog/${encodeURIComponent(postId)}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setPost(d); setStatus('ready'); })
      .catch(() => setStatus('error'));
  }, [postId]);

  const colorIdx = Math.abs(
    (postId || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  ) % FALLBACK_COLORS.length;
  const imgColor = FALLBACK_COLORS[colorIdx];

  const tags = post?.tags ? post.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

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

        {/* ── States ── */}
        {status === 'loading' && (
          <div style={{ padding: '64px 32px', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase' }}>
            Loading…
          </div>
        )}
        {status === 'error' && (
          <div style={{ padding: '64px 32px', textAlign: 'center', color: 'var(--orange)', fontSize: 13, fontFamily: 'var(--font-body)' }}>
            Post not found.
          </div>
        )}

        {/* ── Content ── */}
        {status === 'ready' && post && (
          <>
            {/* ── Hero image — locked, does not scroll ── */}
            <div style={{ width: '100%', height: 416, position: 'relative', overflow: 'hidden', background: post.cover_image_url ? '#111' : imgColor, flexShrink: 0 }}>
              {post.cover_image_url ? (
                <img src={post.cover_image_url} alt={post.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.07) 0px, rgba(0,0,0,0.07) 1px, transparent 1px, transparent 12px)' }} />
              )}
              {/* Strong bottom gradient for text legibility */}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0.1) 75%, transparent 100%)' }} />

              {/* Metadata overlay — bottom of hero */}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '28px 32px 28px' }}>
                {/* Category + tags row */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
                  {post.category && (
                    <span style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '3px 12px', borderRadius: 99, background: ORANGE, color: '#fff' }}>
                      {post.category}
                    </span>
                  )}
                  {tags.map(tag => (
                    <span key={tag} style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '3px 10px', borderRadius: 99, background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.22)', color: 'rgba(255,255,255,0.8)' }}>
                      {tag}
                    </span>
                  ))}
                </div>

                {/* Title */}
                <h1 style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: 'clamp(1.5rem, 2.8vw, 2.2rem)', letterSpacing: '-0.03em', textTransform: 'uppercase', color: '#fff', margin: '0 0 10px', lineHeight: 1.15 }}>
                  {post.title}
                </h1>

                {/* Subtitle */}
                {post.subtitle && (
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'rgba(255,255,255,0.72)', lineHeight: 1.5, marginBottom: 14, maxWidth: '65%' }}>
                    {post.subtitle}
                  </div>
                )}

                {/* Author · Date */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  {post.author && (
                    <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase', color: 'rgba(255,255,255,0.85)' }}>
                      {post.author}
                    </span>
                  )}
                  {post.author && post.published_at && (
                    <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>·</span>
                  )}
                  {post.published_at && (
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'rgba(255,255,255,0.6)' }}>
                      {fmtDate(post.published_at)}
                    </span>
                  )}
                  {post.updated_at && post.updated_at !== post.published_at && (
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                      · Updated {fmtDate(post.updated_at)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ── Scrollable content: body only ── */}
            <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>

            {/* ── Body ── */}
            <div style={{ padding: '20px 16px 32px', maxWidth: 1100, margin: '0 auto' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {post.body || ''}
                </ReactMarkdown>
            </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
