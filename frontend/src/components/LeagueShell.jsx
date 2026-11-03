import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { pruneNav } from '../utils/features.js';

const ORANGE = '#EA6020';

const SNL = {
  color: 'var(--t-muted)',
  textDecoration: 'none',
  padding: '2px 8px',
  fontFamily: 'var(--font-h2)',
  fontSize: 11,
  letterSpacing: '0.5px',
  transition: 'color .15s',
  whiteSpace: 'nowrap',
};
const SEP = { color: 'var(--card-border-clr)', fontSize: 10, userSelect: 'none' };

const LEAGUE_CONFIG = {
  ufa:  { abbr: 'UFA',  full: 'Ultimate Frisbee Association',       to: '/ufa',  links: [{ label: 'Games', to: '/ufa/games' }, { label: 'Teams', to: '/ufa/teams' }, { label: 'Compare', to: '/ufa/compare' }] },
  pul:  { abbr: 'PUL',  full: 'Premier Ultimate League',            to: '/pul',  links: [{ label: 'Games', to: '/pul/games' }, { label: 'Teams', to: '/pul/teams' }, { label: 'Compare', to: '/pul/compare' }] },
  wul:  { abbr: 'WUL',  full: "Western Ultimate League",            to: '/wul',  links: [{ label: 'Games', to: '/wul/games' }, { label: 'Teams', to: '/wul/teams' }, { label: 'Compare', to: '/wul/compare' }] },
  mlu:  { abbr: 'MLU',  full: 'Major League Ultimate \u00b7 2012\u20132016', to: '/mlu',  links: [{ label: 'Games', to: '/mlu/games' }, { label: 'Teams', to: '/mlu/teams' }, { label: 'Compare', to: '/mlu/compare' }] },
  usau: { abbr: 'USAU', full: 'USA Ultimate',                       to: '/usau', links: [{ label: 'Rankings', to: '/usau' }, { label: 'Tournaments', to: '/usau/tournaments' }, { label: 'Games', to: '/usau/games' }, { label: 'Club', to: '/usau/club' }, { label: 'College', to: '/usau/college' }] },
  wfdf: { abbr: 'WFDF', full: 'World Flying Disc Federation',       to: '/wfdf', links: [] },
};

const NAV_LEAGUES = pruneNav([
  { label: 'WFDF', to: '/wfdf' },
  { label: 'USAU', to: '/usau' },
  { label: 'PUL',  to: '/pul'  },
  { label: 'WUL',  to: '/wul'  },
  { label: 'UFA',  to: '/ufa'  },
  { label: 'MLU',  to: '/mlu'  },
]);

const FOOTER_LINKS = pruneNav([
  { label: 'Blog',                 to: '/blog' },
  { label: 'Subscribe',            to: '/subscribe' },
  { label: 'Account',              to: '/account' },
  { label: 'Submit UltiAnalytics', to: '/submit/ultianalytics' },
  { label: 'USAU Rankings',        to: '/usau' },
  { label: 'Status',               to: '/status' },
]);

export default function LeagueShell({ league, children }) {
  const loc = useLocation();
  const cfg = LEAGUE_CONFIG[league] ?? LEAGUE_CONFIG.ufa;

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', padding: '24px 16px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{
        maxWidth: 1560, width: '100%',
        height: 'calc(100vh - 48px)',
        display: 'flex', flexDirection: 'column',
        borderRadius: 4,
        border: '1px solid var(--card-border-clr)',
        boxShadow: 'var(--card-shadow)',
        backdropFilter: 'var(--card-backdrop)',
        overflow: 'hidden',
      }}>

        {/* ── Subnav ── */}
        <div style={{
          flexShrink: 0,
          background: 'var(--card-bg)',
          backdropFilter: 'var(--card-backdrop)',
          borderBottom: '1px solid var(--card-border-clr)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '4px 16px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Link
              to="/"
              style={SNL}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-muted)'; }}
            >Home</Link>
            <span style={SEP}>|</span>
            {NAV_LEAGUES.map((item, i, arr) => {
              const isActive = item.to === cfg.to;
              return (
                <React.Fragment key={item.to}>
                  <Link
                    to={item.to}
                    style={{ ...SNL, color: isActive ? 'var(--orange)' : 'var(--t-muted)' }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }}
                    onMouseLeave={e => { e.currentTarget.style.color = isActive ? 'var(--orange)' : 'var(--t-muted)'; }}
                  >{item.label}</Link>
                  {i < arr.length - 1 && <span style={SEP}>|</span>}
                </React.Fragment>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {pruneNav([{ label: 'Blog', to: '/blog' }, { label: 'Subscribe', to: '/subscribe' }, { label: 'Account', to: '/account' }]).map((item, i, arr) => (
              <React.Fragment key={item.to}>
                <Link
                  to={item.to}
                  style={SNL}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-muted)'; }}
                >{item.label}</Link>
                {i < arr.length - 1 && <span style={SEP}>|</span>}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* ── Hero band ── */}
        <div style={{
          flexShrink: 0,
          background: 'var(--card-bg)',
          backdropFilter: 'var(--card-backdrop)',
          borderBottom: '2px solid var(--orange)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 20px',
          overflow: 'hidden',
        }}>
          <Link to={cfg.to} style={{ textDecoration: 'none' }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '3px', textTransform: 'uppercase', color: 'var(--orange)', marginBottom: 3 }}>{cfg.full}</div>
            <h1 style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 'clamp(1.4rem, 2vw, 2rem)', color: 'var(--t-primary)', margin: 0, letterSpacing: '-0.03em', textTransform: 'uppercase', lineHeight: 1 }}>{cfg.abbr}</h1>
          </Link>
          {cfg.links.length > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              {cfg.links.map(lnk => {
                const isActive = loc.pathname === lnk.to || (lnk.to !== cfg.to && loc.pathname.startsWith(lnk.to + '/'));
                return (
                  <Link
                    key={lnk.to}
                    to={lnk.to}
                    style={{
                      fontFamily: 'var(--font-h2)',
                      fontSize: 9,
                      letterSpacing: '1px',
                      textTransform: 'uppercase',
                      textDecoration: 'none',
                      padding: '5px 10px',
                      border: `1px solid ${isActive ? ORANGE : 'var(--card-border-clr)'}`,
                      borderRadius: 3,
                      transition: 'all .12s',
                      background: isActive ? 'rgba(234,96,32,0.12)' : 'transparent',
                      color: isActive ? ORANGE : 'var(--t-secondary)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = ORANGE; e.currentTarget.style.color = ORANGE; }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = isActive ? ORANGE : 'var(--card-border-clr)';
                      e.currentTarget.style.color = isActive ? ORANGE : 'var(--t-secondary)';
                    }}
                  >{lnk.label} →</Link>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Content ── */}
        {children}

        {/* ── Footer ── */}
        <div style={{
          flexShrink: 0,
          borderTop: '1px solid var(--card-border-clr)',
          background: 'var(--card-bg)',
          backdropFilter: 'var(--card-backdrop)',
          padding: '10px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 8,
          borderRadius: '0 0 4px 4px',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {FOOTER_LINKS.map((lnk, i, arr) => (
              <React.Fragment key={lnk.to}>
                <Link
                  to={lnk.to}
                  style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)', textDecoration: 'none', padding: '2px 8px', transition: 'color .12s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--orange-light)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-muted)'; }}
                >{lnk.label}</Link>
                {i < arr.length - 1 && <span style={{ color: 'var(--card-border-clr)', fontSize: 10, alignSelf: 'center', userSelect: 'none' }}>|</span>}
              </React.Fragment>
            ))}
          </div>
          <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)' }}>© {new Date().getFullYear()} Ulti-Reference</span>
        </div>

      </div>
    </div>
  );
}
