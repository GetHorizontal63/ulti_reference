import React, { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { pruneNav } from '../utils/features.js';

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
          { label: "WUL — Women's Ultimate League",         to: '/wul' },
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
          { label: 'USAU Player Stats',   to: '/usau' },
          { label: 'PUL Player Stats',    to: '/pul' },
          { label: 'WUL Player Stats',    to: '/wul' },
          { label: 'UFA Player Stats',    to: '/ufa' },
          { label: 'MLU Player Stats',    to: '/mlu' },
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

// ─── Styles ────────────────────────────────────────────────────────────────────
const S = {
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
};

// ─── Dropdown Nav ──────────────────────────────────────────────────────────────
function NavDropdown({ item }) {
  const [open, setOpen] = useState(false);
  const ref   = useRef(null);
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
          {item.sections.map((sec, si) => (
            <div
              key={sec.heading}
              style={{
                ...S.dropdownSection,
                borderRight: si < item.sections.length - 1 ? '1px solid var(--card-border-clr)' : 'none',
              }}
            >
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

// ─── PageChrome ────────────────────────────────────────────────────────────────
// Drop-in replacement for the simple back-nav bar used on inner pages.
// Renders: subnav league strip + site header + main dropdown nav.
export default function PageChrome() {
  return (
    <div style={{ flexShrink: 0, background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', borderRadius: '4px 4px 0 0' }}>

      {/* ── Top subnav ── */}
      <div style={S.subnav}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          {pruneNav([
            { label: 'WFDF', to: '/wfdf' },
            { label: 'USAU', to: '/usau' },
            { label: 'PUL',  to: '/pul'  },
            { label: 'WUL',  to: '/wul'  },
            { label: 'UFA',  to: '/ufa'  },
            { label: 'MLU',  to: '/mlu'  },
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
              {i < arr.length - 1 && (
                <span style={{ color: 'var(--card-border-clr)', fontSize: 10 }}>|</span>
              )}
            </React.Fragment>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          {[
            { label: 'Blog',      to: '/blog'      },
            { label: 'Subscribe', to: '/subscribe' },
            { label: 'Account',   to: '/account'   },
          ].map((item, i, arr) => (
            <React.Fragment key={item.to}>
              <Link
                to={item.to}
                style={S.subnavLink}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-muted)'; }}
              >
                {item.label}
              </Link>
              {i < arr.length - 1 && (
                <span style={{ color: 'var(--card-border-clr)', fontSize: 10 }}>|</span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* ── Site header ── */}
      <div style={S.header}>
        <div>
          <Link to="/" style={S.siteName}>Ulti-Reference</Link>
          <div style={S.tagline}>Stats, throws &amp; analytics across professional ultimate frisbee</div>
        </div>
      </div>

      {/* ── Main nav ── */}
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

    </div>
  );
}
