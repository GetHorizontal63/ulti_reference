import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { isLeagueEnabled } from '../utils/features.js';
import { LEVEL_STYLE } from '../utils/levelStyles.js';
import PageChrome from '../components/PageChrome.jsx';

const LEAGUES_LIST = ['All', 'UFA', 'MLU', 'WUL', 'PUL', 'USAU', 'International'].filter(isLeagueEnabled);
const SLIDER_MIN  = 2019;
const SLIDER_MAX  = 2026;
const PAGE_SIZE   = 36;

async function fetchPlayers({ q, league, yearFrom, yearTo, page }) {
  const params = new URLSearchParams();
  if (q)      params.set('q', q);
  if (league && league !== 'All') params.set('league', league);
  if (yearFrom > SLIDER_MIN) params.set('yearFrom', yearFrom);
  if (yearTo   < SLIDER_MAX) params.set('yearTo',   yearTo);
  params.set('limit',  PAGE_SIZE);
  params.set('offset', (page - 1) * PAGE_SIZE);
  const r = await fetch(`/api/players?${params}`);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

export default function PlayerSearchPage() {
  const [query,    setQuery]    = useState('');
  const [league,   setLeague]   = useState('All');
  const [page,     setPage]     = useState(1);
  const [yearFrom, setYearFrom] = useState(SLIDER_MIN);
  const [yearTo,   setYearTo]   = useState(SLIDER_MAX);

  const [players,    setPlayers]    = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [status,     setStatus]     = useState('idle'); // idle | loading | ready | error
  const [errorMsg,   setErrorMsg]   = useState(null);

  // Debounce text input
  const [debouncedQ, setDebouncedQ] = useState('');
  const debounceTimer = useRef(null);
  const handleQueryChange = (v) => {
    setQuery(v);
    clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedQ(v);
      setPage(1);
    }, 300);
  };

  const resetPage = (setter) => (v) => { setter(v); setPage(1); };

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorMsg(null);
    fetchPlayers({ q: debouncedQ, league, yearFrom, yearTo, page })
      .then((data) => {
        if (cancelled) return;
        setPlayers(data.players);
        setTotalCount(data.count);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(err.message);
        setStatus('error');
      });
    return () => { cancelled = true; };
  }, [debouncedQ, league, yearFrom, yearTo, page]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', padding: '24px 16px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

      {/* ── Dark card ── */}
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

        {/* ── Sticky header + filters ── */}
        <div style={{ padding: '24px 32px 16px', flexShrink: 0, borderBottom: '1px solid rgba(234,96,32,0.08)' }}>

          {/* Header */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--orange)', opacity: 0.75, marginBottom: 6 }}>
              Player Database
            </div>
            <h1 style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: 'clamp(1.4rem, 3vw, 2.2rem)', color: 'var(--t-primary)', margin: 0, letterSpacing: '-0.02em' }}>
              Find a Player
            </h1>
            <p style={{ marginTop: 4, fontSize: 12, color: 'var(--t-muted)', fontFamily: 'var(--font-body)' }}>
              UFA · PUL · 2019–2026
            </p>
          </div>

          {/* Search + filters */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 220px' }}>
              <label style={{ fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--orange)', fontFamily: 'var(--font-h2)', opacity: 0.7 }}>Search</label>
              <input
                type="text"
                placeholder="Name or team…"
                value={query}
                onChange={e => handleQueryChange(e.target.value)}
                className="search-input"
                style={{
                  padding: '9px 10px',
                  background: 'var(--input-bg)',
                  border: '1px solid var(--input-border)',
                  borderRadius: 6, color: 'var(--input-clr)',
                  fontFamily: 'var(--font-h2)', fontSize: 12,
                  outline: 'none', height: 38, boxSizing: 'border-box',
                }}
              />
            </div>
            <FilterSelect label="League" value={league} onChange={resetPage(setLeague)} options={LEAGUES_LIST} />
            <YearRangeSlider
              min={SLIDER_MIN} max={SLIDER_MAX}
              fromVal={yearFrom} toVal={yearTo}
              onFromChange={resetPage(setYearFrom)} onToChange={resetPage(setYearTo)}
            />
          </div>
        </div>

        {/* ── Results count + pagination ── */}
        <div style={{ padding: '10px 32px 6px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--orange)', opacity: 0.6, fontFamily: 'var(--font-h2)' }}>
            {status === 'loading' ? '…' : `${totalCount} result${totalCount !== 1 ? 's' : ''}`}
          </span>
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <PagBtn onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>‹</PagBtn>
              <span style={{ fontSize: 10, letterSpacing: '1px', color: 'var(--t-secondary)', fontFamily: 'var(--font-h2)' }}>
                {page} / {totalPages}
              </span>
              <PagBtn onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>›</PagBtn>
            </div>
          )}
        </div>

        {/* ── Scrollable player list ── */}
        <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 32px 32px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {status === 'error' ? (
              <div style={{ gridColumn: '1 / -1', padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                Failed to load players: {errorMsg}
              </div>
            ) : status === 'loading' && players.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                Loading…
              </div>
            ) : players.length === 0 ? (
              <div style={{ gridColumn: '1 / -1', padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                No players match those filters.
              </div>
            ) : players.map((p) => (
              <PlayerCard key={p.id} player={p} />
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

function PlayerCard({ player: p }) {
  const [hovered, setHovered] = useState(false);

  const initials  = p.name.split(' ').map(w => w[0]).join('').slice(0, 3);
  const isPro     = !!(p.ufa_id || p.pul_id || p.wul_id);
  const isIntl    = !!p.internationalId;
  const proStyle  = LEVEL_STYLE['Pro'];

  const yearLabel = p.yearStart && p.yearEnd
    ? p.yearStart === p.yearEnd ? String(p.yearEnd) : `${p.yearStart}–${p.yearEnd}`
    : p.yearEnd ? String(p.yearEnd) : null;

  const hasIds = p.ufa_id || p.pul_id || p.wul_id || p.usau_id;

  return (
    <Link
      to={`/players/${p.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', flexDirection: 'column',
        padding: '14px 16px',
        borderRadius: 10,
        background: hovered ? 'var(--surf-bg-hover)' : 'var(--surf-bg-2)',
        border: `1px solid ${hovered ? 'rgba(234,96,32,0.30)' : 'var(--surf-border)'}`,
        transition: 'background .15s, border-color .15s',
        textDecoration: 'none',
        gap: 10,
      }}
    >
      {/* ── Hero row: avatar + name/team + top-right chips ── */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>

        {/* Avatar */}
        <div style={{
          flexShrink: 0, width: 83, height: 83, borderRadius: 10,
          background: 'var(--avatar-bg)',
          border: '1px solid var(--avatar-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}>
          {p.photoUrl
            ? <img src={p.photoUrl} alt={p.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <span style={{ fontSize: 29, fontFamily: 'var(--font-h1)', color: 'var(--avatar-color)' }}>{initials}</span>
          }
        </div>

        {/* Name / team / active */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: '1.2rem', color: 'var(--t-primary)', letterSpacing: '-0.01em', lineHeight: 1.2 }}>
              {p.name}
            </span>
            {p.number != null && (
              <span style={{ fontFamily: 'var(--font-h1)', fontSize: '0.85rem', color: 'var(--orange)', opacity: 0.7 }}>
                #{p.number}
              </span>
            )}
          </div>

          {p.teams?.[0] && (
            <div style={{ marginTop: 2, fontSize: 14, color: 'var(--t-secondary)', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {p.teams[0].split('/')[0].trim()}
            </div>
          )}

          {p.active && (
            <div style={{ marginTop: 4, fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--orange)', fontFamily: 'var(--font-h2)' }}>
              Active
            </div>
          )}
        </div>

        {/* Top-right: International + Pro chips */}
        {(isIntl || isPro) && (
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 5, alignItems: 'flex-end' }}>
            {isIntl && (
              <span style={{
                width: 38, height: 18, borderRadius: 99, overflow: 'hidden',
                border: '1px solid rgba(0,80,180,0.22)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <img src={`${import.meta.env.BASE_URL}assets/png/International_teams/us.svg`} alt="USA"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </span>
            )}
            {isPro && (
              <span style={{
                height: 18, paddingLeft: 8, paddingRight: 8, borderRadius: 99,
                border: `1px solid ${proStyle.border}`,
                background: proStyle.bg, color: proStyle.text,
                fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase',
                fontFamily: 'var(--font-h2)', fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                lineHeight: 1,
              }}>
                Pro
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── League ID callouts ── */}
      {hasIds && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {p.ufa_id  && <IdPill label="UFA"  value={p.ufa_id}  />}
          {p.pul_id  && <IdPill label="PUL"  value={p.pul_id}  />}
          {p.wul_id  && <IdPill label="WUL"  value={p.wul_id}  />}
          {p.usau_id && <IdPill label="USAU" value={p.usau_id} />}
        </div>
      )}

      {/* ── Footer: year range + league labels ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginTop: 'auto', paddingTop: 8,
        borderTop: '1px solid var(--surf-divider)',
      }}>
        <span style={{ fontSize: 10, color: 'var(--t-muted)', fontFamily: 'var(--font-body)' }}>
          {yearLabel ?? '—'}
        </span>
        <span style={{ fontSize: 8, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--t-primary)', fontFamily: 'var(--font-h2)', fontWeight: 600, opacity: 0.65 }}>
          {(p.leagues ?? []).join(' · ')}
        </span>
      </div>
    </Link>
  );
}

function IdPill({ label, value }) {
  return (
    <div style={{ padding: '3px 9px', borderRadius: 6, background: 'var(--surf-bg)', border: '1px solid var(--surf-border)', flexShrink: 0 }}>
      <div style={{ fontSize: 7, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--orange)', fontFamily: 'var(--font-h2)', marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--mono-clr)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>{value}</div>
    </div>
  );
}

function PagBtn({ onClick, disabled, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      padding: '2px 10px', fontSize: 14, lineHeight: 1,
      background: 'transparent',
      border: '1px solid rgba(234,96,32,0.25)',
      borderRadius: 4, color: disabled ? 'rgba(255,245,237,0.2)' : 'var(--orange)',
      cursor: disabled ? 'default' : 'pointer',
      fontFamily: 'var(--font-h2)',
    }}>
      {children}
    </button>
  );
}

function YearRangeSlider({ min, max, fromVal, toVal, onFromChange, onToChange }) {
  const pct = v => ((v - min) / (max - min)) * 100;
  const fillLeft  = pct(fromVal);
  const fillWidth = pct(toVal) - pct(fromVal);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 180px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <label style={{ fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--orange)', fontFamily: 'var(--font-h2)', opacity: 0.7 }}>Years</label>
        <span style={{ fontSize: 9, color: 'var(--cream)', opacity: 0.55, fontFamily: 'var(--font-h2)', letterSpacing: '0.5px' }}>
          {fromVal === min && toVal === max ? 'All' : `${fromVal} – ${toVal}`}
        </span>
      </div>
      <div style={{ height: 38, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
        <div className="range-wrap" style={{ width: '100%' }}>
          <div className="range-track" />
          <div className="range-fill" style={{ left: `${fillLeft}%`, width: `${fillWidth}%` }} />
          <input
            type="range" min={min} max={max} value={fromVal}
            onChange={e => onFromChange(Math.min(Number(e.target.value), toVal - 1))}
          />
          <input
            type="range" min={min} max={max} value={toVal}
            onChange={e => onToChange(Math.max(Number(e.target.value), fromVal + 1))}
          />
        </div>
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 140px' }}>
      <label style={{ fontSize: 8, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--orange)', fontFamily: 'var(--font-h2)', opacity: 0.7 }}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: '9px 10px',
          background: 'var(--input-bg)',
          border: '1px solid var(--input-border)',
          borderRadius: 6, color: 'var(--input-clr)',
          fontFamily: 'var(--font-h2)', fontSize: 12,
          outline: 'none', cursor: 'pointer', height: 38, boxSizing: 'border-box',
        }}
      >
        {options.map(o => <option key={o} value={o} style={{ background: 'var(--orange)', color: '#fff' }}>{o}</option>)}
      </select>
    </div>
  );
}
