import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import LeagueShell from '../components/LeagueShell.jsx';

const BASE   = import.meta.env.BASE_URL.replace(/\/$/, '');
const ORANGE = '#EA6020';

function calcNatlStats(breakdown, gFilter, dFilter) {
  if (!breakdown) return { natl_appearances: 0, natl_titles: 0, natl_runner_ups: 0, natl_semis: 0, last_title_yr: null, last_runner_up_yr: null, last_semi_yr: null, last_app_yr: null };
  const rows = typeof breakdown === 'string' ? JSON.parse(breakdown) : breakdown;
  const rel = rows.filter(r =>
    (!gFilter || r.g === gFilter) &&
    (!dFilter || r.d === dFilter)
  );
  return {
    natl_appearances: rel.reduce((s, r) => s + r.a, 0),
    natl_titles:      rel.reduce((s, r) => s + r.t, 0),
    natl_runner_ups:  rel.reduce((s, r) => s + (r.r  ?? 0), 0),
    natl_semis:       rel.reduce((s, r) => s + (r.sf ?? 0), 0),
    last_title_yr:      rel.reduce((mx, r) => (r.ly != null && r.ly > (mx ?? 0) ? r.ly : mx), null),
    last_runner_up_yr:  rel.reduce((mx, r) => (r.ry != null && r.ry > (mx ?? 0) ? r.ry : mx), null),
    last_semi_yr:       rel.reduce((mx, r) => (r.sy != null && r.sy > (mx ?? 0) ? r.sy : mx), null),
    last_app_yr:        rel.reduce((mx, r) => (r.ay != null && r.ay > (mx ?? 0) ? r.ay : mx), null),
  };
}

// Clean program names by removing common institutional prefixes
function cleanProgramName(name) {
  if (!name) return name;
  const trimmed = name.trim();
  if (/^Georgia College\s*&\s*State University$/i.test(trimmed)) return trimmed;
  return trimmed
    .replace(/\bUniversity of\b/gi, '')
    .replace(/\bUniversity\b/gi, '')
    .replace(/\bCollege\b(?!\s+of\b)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();
}

const DIVISION_CONFIG = {
  club:    {
    label:       'Club',
    levels:      ['Club'],
    description: 'Club ultimate programs competing in USAU sanctioned events.',
    regions:     ['Great Lakes', 'Mid Atlantic', 'North Central', 'Northeast', 'Northwest', 'South Central', 'Southeast', 'Southwest'],
  },
  college: {
    label:       'College',
    levels:      ['College'],
    description: 'College programs competing across D-I, D-III, and Developmental divisions.',
    regions:     ['Atlantic Coast', 'Great Lakes', 'Metro East', 'New England', 'North Central', 'Northwest', 'Ohio Valley', 'South Central', 'Southeast', 'Southwest'],
  },
  youth:   {
    label:       'Youth / HS',
    levels:      ['Youth Club U-20', 'High School'],
    description: 'Youth and high school programs in the USAU competition structure.',
    regions:     ['Atlantic Coast', 'Great Lakes', 'Metro East', 'Mid Atlantic', 'New England', 'North Central', 'Northeast', 'Northwest', 'Ohio Valley', 'South Central', 'Southeast', 'Southwest'],
  },
};

// Abbreviation maps for filter chips
const REGION_ABBR = {
  'Atlantic Coast': 'AC',
  'Great Lakes': 'GL',
  'Metro East': 'ME',
  'Mid Atlantic': 'MA',
  'New England': 'NE',
  'North Central': 'NC',
  'Northeast': 'NE',
  'Northwest': 'NW',
  'Ohio Valley': 'OV',
  'South Central': 'SC',
  'Southeast': 'SE',
  'Southwest': 'SW',
};

const GENDER_ABBR = {
  'Men': 'M',
  'Women': 'W',
  'Mixed': 'X',
};

const DIV_LEVEL_ABBR = {
  'D-I': 'D1',
  'D-III': 'D3',
};

export default function USAUDivisionPage({ division }) {
  const navigate = useNavigate();
  const cfg      = DIVISION_CONFIG[division] ?? null;

  const [programs, setPrograms] = useState([]);
  const [status,   setStatus]   = useState('loading');
  const [query,    setQuery]    = useState('');
  const [sortKey,  setSortKey]  = useState('natl_titles');
  const [sortDir,  setSortDir]  = useState(-1);
  const [viewMode, setViewMode] = useState('grid');
  const [page,     setPage]     = useState(1);
  const [filterRegion,   setFilterRegion]   = useState('');
  const [filterGender,   setFilterGender]   = useState('');
  const [filterDivLevel, setFilterDivLevel] = useState('');

  const PAGE_SIZE = viewMode === 'table' ? 25 : 16;

  useEffect(() => {
    if (!cfg) return;
    let cancelled = false;
    setStatus('loading');
    const p = new URLSearchParams({ limit: 500, offset: 0 });
    cfg.levels.forEach(l => p.append('level', l));
    fetch(`/api/usau/programs?${p}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setPrograms(d.programs); setStatus('ready'); } })
      .catch(()  => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [division]);

  // Reset filters when switching division tabs
  useEffect(() => {
    setFilterRegion('');
    setFilterGender('');
    setFilterDivLevel('');
  }, [division]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return programs
      .map(p => {
        const stats = calcNatlStats(p.natl_breakdown, filterGender, filterDivLevel);
        return { ...p, natl_appearances: stats.natl_appearances, natl_titles: stats.natl_titles, natl_runner_ups: stats.natl_runner_ups, natl_semis: stats.natl_semis, last_title_yr: stats.last_title_yr, last_runner_up_yr: stats.last_runner_up_yr, last_semi_yr: stats.last_semi_yr, last_app_yr: stats.last_app_yr };
      })
      .filter(p =>
        (!q ||
          p.canonical_name?.toLowerCase().includes(q) ||
          p.short_name?.toLowerCase().includes(q) ||
          p.city?.toLowerCase().includes(q) ||
          p.state?.toLowerCase().includes(q) ||
          p.effective_region?.toLowerCase().includes(q)
        ) &&
        (!filterRegion   || p.effective_region === filterRegion) &&
        (!filterGender   || (p.gender_codes    ?? '').split(',').includes(filterGender)) &&
        (!filterDivLevel || (p.natl_div_levels ?? '').split(',').includes(filterDivLevel))
      )
      .sort((a, b) => {
        const av = a[sortKey] ?? '';
        const bv = b[sortKey] ?? '';
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
        return String(av).localeCompare(String(bv)) * sortDir;
      });
  }, [programs, query, sortKey, sortDir, filterRegion, filterGender, filterDivLevel]);

  useEffect(() => { setPage(1); }, [query, sortKey, sortDir, viewMode, filterRegion, filterGender, filterDivLevel]);

  const totalPages    = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pagedFiltered = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(1); }
  }

  const TH_BASE = {
    padding: '10px 16px',
    textAlign: 'left',
    fontFamily: 'var(--font-h2)',
    fontSize: 9,
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  };

  function SortTh({ label, field, style = {} }) {
    const active = sortKey === field;
    return (
      <th
        onClick={() => toggleSort(field)}
        style={{ ...TH_BASE, ...style, color: active ? ORANGE : 'var(--t-muted)' }}
      >
        {label}{active ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
      </th>
    );
  }

  if (!cfg) return null;

  return (
    <LeagueShell league="usau">
        {/* ── Header ── */}
        <div style={{ padding: '28px 32px 20px', borderBottom: '1px solid var(--nav-border)', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, background: 'var(--card-bg)', flexShrink: 0 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--orange)', opacity: 0.7, marginBottom: 6 }}>
              Programs
            </div>
            <div style={{ fontFamily: 'var(--font-h1)', fontSize: 'clamp(1.5rem, 2.5vw, 2rem)', letterSpacing: '-0.02em', textTransform: 'uppercase', color: 'var(--t-primary)', marginBottom: 6 }}>
              {cfg.label}
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)' }}>
              {cfg.description}
            </div>
          </div>

            {/* View toggle + search stacked */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            {/* View mode toggle */}
            <div style={{ display: 'flex', borderRadius: 7, overflow: 'hidden', border: '1px solid var(--surf-border)', flexShrink: 0 }}>
              {[['table', IconTable], ['grid', IconGrid]].map(([mode, Icon]) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  title={mode === 'table' ? 'Table view' : 'Grid view'}
                  style={{
                    width: 34, height: 34,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: 'none',
                    background: viewMode === mode ? ORANGE : 'var(--surf-bg-2)',
                    color: viewMode === mode ? '#fff' : 'var(--t-muted)',
                    cursor: 'pointer',
                    transition: 'background .12s, color .12s',
                  }}
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="School, city, state, region…"
              style={{
                width: 280,
                height: 36,
                padding: '0 14px',
                borderRadius: 8,
                border: '1px solid var(--input-border)',
                background: 'var(--input-bg)',
                color: 'var(--input-clr)',
                fontFamily: 'var(--font-body)',
                fontSize: 12,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* ── Filter + sort bar ── */}
        <div style={{ padding: '8px 32px', borderBottom: '1px solid var(--nav-border)', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap', background: 'var(--card-bg)' }}>
          {['', ...cfg.regions].map(r => (
            <button
              key={r || '__all'}
              onClick={() => setFilterRegion(r)}
              style={{
                height: 28, minWidth: 48, padding: '0 12px', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: filterRegion === r ? `1px solid ${ORANGE}` : '1px solid rgba(234,96,32,0.30)',
                background: filterRegion === r ? 'rgba(234,96,32,0.14)' : 'transparent',
                color: filterRegion === r ? ORANGE : 'var(--t-secondary)',
                fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '0.5px',
                cursor: 'pointer', transition: 'all .1s', whiteSpace: 'nowrap',
              }}
            >{r ? REGION_ABBR[r] : 'All'}</button>
          ))}

          {/* ── Gender filter ── */}
          <div style={{ width: 1, height: 18, background: 'var(--surf-border)', margin: '0 6px', flexShrink: 0 }} />
          {(division === 'club' ? [['M','Men'],['W','Women'],['X','Mixed']] : [['M','Men'],['W','Women']]).map(([code, label]) => (
            <button
              key={code}
              onClick={() => setFilterGender(g => g === code ? '' : code)}
              style={{
                height: 28, minWidth: 48, padding: '0 12px', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: filterGender === code ? `1px solid ${ORANGE}` : '1px solid rgba(234,96,32,0.30)',
                background: filterGender === code ? 'rgba(234,96,32,0.14)' : 'transparent',
                color: filterGender === code ? ORANGE : 'var(--t-secondary)',
                fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '0.5px',
                cursor: 'pointer', transition: 'all .1s', whiteSpace: 'nowrap',
              }}
            >{GENDER_ABBR[label]}</button>
          ))}

          {/* ── D-I / D-III filter (college only) ── */}
          {division === 'college' && <>
            <div style={{ width: 1, height: 18, background: 'var(--surf-border)', margin: '0 6px', flexShrink: 0 }} />
            {[['1','D-I'],['3','D-III']].map(([code, label]) => (
              <button
                key={code}
                onClick={() => setFilterDivLevel(v => v === code ? '' : code)}
                style={{
                  height: 28, minWidth: 48, padding: '0 12px', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: filterDivLevel === code ? `1px solid ${ORANGE}` : '1px solid rgba(234,96,32,0.30)',
                  background: filterDivLevel === code ? 'rgba(234,96,32,0.14)' : 'transparent',
                  color: filterDivLevel === code ? ORANGE : 'var(--t-secondary)',
                  fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '0.5px',
                  cursor: 'pointer', transition: 'all .1s', whiteSpace: 'nowrap',
                }}
              >{DIV_LEVEL_ABBR[label]}</button>
            ))}
          </>}

          <div style={{ width: 1, height: 18, background: 'var(--surf-border)', margin: '0 6px', flexShrink: 0 }} />
          {[{ key: 'canonical_name', label: 'A-Z', dir: 1 }, { key: 'natl_titles', label: 'Titles', dir: -1 }, { key: 'natl_appearances', label: 'Apps.', dir: -1 }].map(({ key, label, dir }) => (
            <button
              key={key}
              onClick={() => { if (sortKey === key) setSortDir(d => -d); else { setSortKey(key); setSortDir(dir); } }}
              style={{
                height: 28, minWidth: 68, padding: '0 12px', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: sortKey === key ? `1px solid ${ORANGE}` : '1px solid rgba(234,96,32,0.30)',
                background: sortKey === key ? 'rgba(234,96,32,0.14)' : 'transparent',
                color: sortKey === key ? ORANGE : 'var(--t-secondary)',
                fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '0.5px',
                cursor: 'pointer', transition: 'all .1s',
              }}
            >{label}{sortKey === key ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}</button>
          ))}
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '0.5px', color: 'var(--t-secondary)' }}>
            {filtered.length} program{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* ── States + content ── */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Loading / Error — always in scroll wrapper */}
          {(status === 'loading' || status === 'error') && (
            <div style={{ flex: 1 }}>
              {status === 'loading' && (
                <div style={{ padding: '64px 32px', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase' }}>Loading…</div>
              )}
              {status === 'error' && (
                <div style={{ padding: '64px 32px', textAlign: 'center', color: 'var(--orange)', fontFamily: 'var(--font-body)', fontSize: 13 }}>Could not load programs.</div>
              )}
            </div>
          )}

          {/* ── Table view: scrollable ── */}
          {status === 'ready' && viewMode === 'table' && (
            <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              <div style={{ padding: '16px 32px 24px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--surf-border)', tableLayout: 'fixed' }}>
                  <colgroup>
                    <col />{/* Program — fills remaining space */}
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '12%' }} />
                  </colgroup>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                    <tr style={{ background: 'var(--surf-bg-2)', borderBottom: '2px solid var(--surf-border)' }}>
                      <SortTh label="Program"            field="canonical_name"  style={{ paddingLeft: 20 }} />
                      <SortTh label="City"               field="city"            style={{ textAlign: 'center' }} />
                      <SortTh label="State"              field="state"           style={{ textAlign: 'center' }} />
                      <SortTh label="Teams"              field="team_count"      style={{ textAlign: 'center' }} />
                      <SortTh label="Natl Appearances"   field="natl_appearances" style={{ textAlign: 'center' }} />
                      <SortTh label="Natl Titles"        field="natl_titles"     style={{ textAlign: 'center' }} />
                      <SortTh label="Date Range"         field="first_year"      style={{ paddingRight: 20, textAlign: 'center' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {pagedFiltered.map((p, i) => (
                      <ProgramRow
                        key={p.program_id}
                        program={p}
                        striped={i % 2 === 1}
                        onClick={() => navigate(`/usau/program/${p.program_id}`)}
                      />
                    ))}
                    {pagedFiltered.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                          No programs match.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Grid view ── */}
          {status === 'ready' && viewMode === 'grid' && (
            <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 32px', boxSizing: 'border-box' }}>
              {pagedFiltered.length === 0 ? (
                <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>No programs match.</div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
                  {pagedFiltered.map((p, i) => (
                    <ProgramCard
                      key={p.program_id}
                      program={p}
                      onClick={() => navigate(`/usau/program/${p.program_id}`)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Pagination ── */}
          {status === 'ready' && totalPages > 1 && (
            <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 32px 14px', borderTop: '1px solid var(--nav-border)', background: 'var(--card-bg)' }}>
              <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-primary)' }}>
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ height: 34, padding: '0 18px', borderRadius: 6, border: '1px solid var(--nav-border)', background: 'transparent', color: page === 1 ? 'var(--t-muted)' : 'var(--t-primary)', fontFamily: 'var(--font-h2)', fontSize: 12, cursor: page === 1 ? 'default' : 'pointer', opacity: page === 1 ? 0.4 : 1 }}>← Prev</button>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ height: 34, padding: '0 18px', borderRadius: 6, border: `1px solid ${page === totalPages ? 'rgba(234,96,32,0.20)' : ORANGE}`, background: page === totalPages ? 'transparent' : ORANGE, color: page === totalPages ? 'var(--t-muted)' : '#fff', fontFamily: 'var(--font-h2)', fontSize: 12, cursor: page === totalPages ? 'default' : 'pointer', opacity: page === totalPages ? 0.4 : 1 }}>Next →</button>
              </div>
            </div>
          )}
        </div>{/* end content area */}
    </LeagueShell>
  ); // end outer
}

/* ── SVG icons ── */
function IconTable({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="2" width="14" height="2.5" rx="0.5" />
      <rect x="1" y="6.5" width="14" height="2" rx="0.5" />
      <rect x="1" y="10.5" width="14" height="2" rx="0.5" />
    </svg>
  );
}

function IconGrid({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor">
      <rect x="1"  y="1"  width="6" height="6" rx="1" />
      <rect x="9"  y="1"  width="6" height="6" rx="1" />
      <rect x="1"  y="9"  width="6" height="6" rx="1" />
      <rect x="9"  y="9"  width="6" height="6" rx="1" />
    </svg>
  );
}

function ProgramRow({ program: p, striped, onClick }) {
  const [hov, setHov] = useState(false);
  const USAU_ICON = `${BASE}/assets/png/USAUicon.png`;
  const logoSrc = (p.logo_url?.startsWith('/') ? `${BASE}${p.logo_url}` : p.logo_url) || (p.team_logo_filename ? `${BASE}/assets/png/USAU_teams/${p.team_logo_filename}` : USAU_ICON);
  const displayName = cleanProgramName(p.canonical_name);
  const initials = (p.short_name || displayName || '?').slice(0, 2).toUpperCase();

  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: hov ? 'rgba(234,96,32,0.07)' : striped ? 'var(--surf-bg-2)' : 'transparent',
        borderBottom: '1px solid var(--surf-border)',
        cursor: 'pointer',
        transition: 'background .1s',
      }}
    >
      {/* Program name + logo */}
      <td style={{ padding: '10px 16px 10px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img src={logoSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = USAU_ICON; }} />
          </div>
          <span style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: 13, color: hov ? 'var(--orange)' : 'var(--t-primary)', transition: 'color .1s' }}>
            {cleanProgramName(p.canonical_name)}
          </span>
        </div>
      </td>

      <td style={{ padding: '10px 16px', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-secondary)' }}>
        {p.city || '—'}
      </td>

      <td style={{ padding: '10px 16px', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-secondary)' }}>
        {p.state || '—'}
      </td>

      <td style={{ padding: '10px 16px', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>
        {p.team_count ?? 0}
      </td>

      <td style={{ padding: '10px 16px', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>
        {p.natl_appearances ?? 0}
      </td>

      <td style={{ padding: '10px 16px', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>
        {p.natl_titles ?? 0}
      </td>

      <td style={{ padding: '10px 20px 10px 16px', textAlign: 'center', fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>
        {p.first_year && p.last_year
          ? `${p.first_year} – ${p.last_year}`
          : p.first_year
          ? `${p.first_year} – `
          : '—'}
      </td>
    </tr>
  );
}

/* ── Grid card ── */
function ProgramCard({ program: p, onClick }) {
  const [hov, setHov] = useState(false);
  const USAU_ICON = `${BASE}/assets/png/USAUicon.png`;
  const logoSrc = (p.logo_url?.startsWith('/') ? `${BASE}${p.logo_url}` : p.logo_url) || (p.team_logo_filename ? `${BASE}/assets/png/USAU_teams/${p.team_logo_filename}` : USAU_ICON);
  const displayName = cleanProgramName(p.canonical_name);
  const initials    = (p.short_name || displayName || '?').slice(0, 2).toUpperCase();
  const titles      = p.natl_titles      ?? 0;
  const appearances  = p.natl_appearances ?? 0;
  const runnerUps    = p.natl_runner_ups  ?? 0;
  const semis        = p.natl_semis       ?? 0;
  const lastTitleYr     = p.last_title_yr     ?? null;
  const lastRunnerUpYr  = p.last_runner_up_yr ?? null;
  const lastSemiYr      = p.last_semi_yr      ?? null;
  const lastAppYr       = p.last_app_yr       ?? null;
  const years = p.first_year && p.last_year
    ? `${p.first_year}–${p.last_year}`
    : p.first_year ? `${p.first_year}–` : null;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        textAlign: 'left', width: '100%', boxSizing: 'border-box',
        padding: '20px 22px 18px', borderRadius: 4, minHeight: 196,
        border: hov ? `1px solid ${ORANGE}` : '1px solid var(--card-border-clr)',
        background: hov ? 'color-mix(in srgb, var(--card-bg) 92%, #EA6020 8%)' : 'var(--card-bg)',
        boxShadow: hov ? '0 6px 24px rgba(0,0,0,0.16)' : '0 1px 4px rgba(0,0,0,0.07)',
        transform: hov ? 'translateY(-2px)' : 'none',
        transition: 'border-color .12s, background .12s, box-shadow .12s, transform .1s',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        position: 'relative', overflow: 'hidden',
      }}
    >
      {/* Watermark logo — fills right half, very visible */}
      {true
        ? <img src={(p.logo_url?.startsWith('/') ? `${BASE}${p.logo_url}` : p.logo_url) || USAU_ICON} aria-hidden="true" alt=""
            style={{
              position: 'absolute', right: -40, bottom: -50,
              height: 302, width: 'auto',
              opacity: hov ? 0.15 : 0.1,
              pointerEvents: 'none', transition: 'opacity .15s',
            }}
            onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = USAU_ICON; }}
          />
        : <span aria-hidden="true" style={{
            position: 'absolute', right: 14, bottom: 10,
            fontFamily: 'var(--font-h1)', fontWeight: 900, fontSize: 56,
            color: ORANGE, opacity: 0.08, lineHeight: 1, pointerEvents: 'none', userSelect: 'none',
          }}>{initials}</span>
      }

      {/* Top: name */}
      <div style={{ position: 'relative' }}>
        <div style={{
          fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 18,
          color: hov ? ORANGE : 'var(--t-primary)',
          textTransform: 'uppercase', letterSpacing: '-0.02em', lineHeight: 1.15,
          transition: 'color .12s',
          overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          paddingRight: logoSrc ? 84 : 0,
        }}>{cleanProgramName(p.canonical_name)}</div>
        {(p.city || p.state) && (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)', marginTop: 4 }}>
            {[p.city, p.state].filter(Boolean).join(', ')}
          </div>
        )}
      </div>

      {/* Bottom: stats */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, position: 'relative', marginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', flex: 1, gap: 0 }}>
          {[
            { num: titles,     color: titles > 0 ? ORANGE : 'var(--surf-border)',     size: titles > 0 ? 40 : 28, weight: 900, label: 'natl titles', yr: lastTitleYr,    showYr: lastTitleYr != null && titles > 0 },
            { num: runnerUps,  color: runnerUps > 0 ? ORANGE : 'var(--surf-border)',  size: 22,                   weight: 700, label: 'runner-up',   yr: lastRunnerUpYr, showYr: lastRunnerUpYr != null && runnerUps > 0 },
            { num: semis,      color: semis > 0 ? ORANGE : 'var(--surf-border)',      size: 22,                   weight: 700, label: 'semis',        yr: lastSemiYr,     showYr: lastSemiYr != null && semis > 0 },
            { num: appearances,color: appearances > 0 ? ORANGE : 'var(--surf-border)',size: 22,                   weight: 700, label: 'appearances',  yr: lastAppYr,      showYr: lastAppYr != null },
          ].map(({ num, color, size, weight, label, yr, showYr }) => (
            <div key={label} style={{ flex: 1 }}>
              <span style={{ fontFamily: 'var(--font-h1)', fontWeight: weight, fontSize: size, color, lineHeight: 1 }}>{num}</span>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 7, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', marginTop: 2 }}>{label}</div>
              <div style={{ fontFamily: 'var(--font-h2)', fontWeight: 400, fontSize: 9, letterSpacing: '1px', color: 'var(--t-muted)', marginTop: 4, visibility: showYr ? 'visible' : 'hidden' }}>{yr ?? '0'}</div>
            </div>
          ))}
        </div>
        {years && (
          <div style={{ paddingBottom: 2, flexShrink: 0 }}>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--t-muted)', opacity: 0.6 }}>{years}</div>
          </div>
        )}
      </div>
    </div>
  );
}
