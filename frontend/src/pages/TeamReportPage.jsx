import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

/* ── helpers ── */
function fmtDate(raw) {
  if (!raw) return '';
  try {
    const d = new Date(raw.length <= 10 ? raw + 'T12:00:00' : raw);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return raw; }
}

function fmtPct(val) {
  if (val == null || isNaN(val)) return '—';
  return `${Number(val).toFixed(1)}%`;
}

function Divider() {
  return <div style={{ borderTop: '1px solid #e0e0e0', margin: '20px 0' }} />;
}

function NotesBox() {
  const lines = 5;
  return (
    <div className="notes-footer" style={{ marginTop: 24, paddingTop: 14, borderTop: '2px solid #EA6020' }}>
      <div style={{
        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.10em', color: '#888', marginBottom: 8,
      }}>
        Notes
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="notes-line"
            style={{ height: 28, borderBottom: '1px solid #ddd' }}
          />
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.10em', color: '#888', marginBottom: 10,
    }}>
      {children}
    </div>
  );
}

/* ── Game Log Table ── */
function GameLog({ games }) {
  if (!games || games.length === 0) {
    return <div style={{ color: '#aaa', fontSize: 12 }}>No games found.</div>;
  }

  const TH = { padding: '4px 8px', fontSize: 11, fontWeight: 700, borderBottom: '2px solid #222', textAlign: 'left', whiteSpace: 'nowrap' };
  const THC = { ...TH, textAlign: 'center' };
  const TD = { padding: '3px 8px', fontSize: 11, borderBottom: '1px solid #ebebeb' };
  const TDC = { ...TD, textAlign: 'center' };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={TH}>Date</th>
          <th style={TH}>Wk</th>
          <th style={THC}>H/A</th>
          <th style={TH}>Opponent</th>
          <th style={THC}>Score</th>
          <th style={THC}>Result</th>
          <th style={THC}>Record</th>
        </tr>
      </thead>
      <tbody>
        {games.map((g, i) => {
          const win = g.result === 'W';
          const loss = g.result === 'L';
          const resColor = win ? '#16a34a' : loss ? '#dc2626' : '#888';
          return (
            <tr key={i} style={{ background: i % 2 === 1 ? '#f8f8f8' : 'white' }}>
              <td style={TD}>{fmtDate(g.date)}</td>
              <td style={{ ...TD, color: '#999' }}>{(g.week || '').replace('week-', '')}</td>
              <td style={TDC}>{g.home ? 'H' : 'A'}</td>
              <td style={{ ...TD, fontWeight: 600 }}>{g.opponent}</td>
              <td style={TDC}>{g.team_score} – {g.opp_score}</td>
              <td style={{ ...TDC, fontWeight: 700, color: resColor }}>{g.result}</td>
              <td style={{ ...TDC, color: '#555' }}>{g.record}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ── Roster Stats Table ── */
function RosterTable({ roster }) {
  if (!roster || roster.length === 0) {
    return <div style={{ color: '#aaa', fontSize: 12 }}>No roster data.</div>;
  }

  const sorted = [...roster].sort((a, b) => (b.goals || 0) - (a.goals || 0));

  const totals = sorted.reduce((a, r) => ({
    gp:   a.gp   + (r.gp || 0),
    g:    a.g    + (r.goals  || 0),
    as:   a.as   + (r.assists || 0),
    b:    a.b    + (r.blocks  || 0),
    t:    a.t    + (r.throwaways || 0),
    comp: a.comp + (r.completions || 0),
    att:  a.att  + (r.throw_attempts || 0),
    pm:   a.pm   + (r.plus_minus || 0),
  }), { gp: 0, g: 0, as: 0, b: 0, t: 0, comp: 0, att: 0, pm: 0 });
  const totCompPct = totals.att ? (totals.comp / totals.att * 100).toFixed(1) : null;

  const TH = { padding: '4px 6px', fontSize: 10, fontWeight: 700, borderBottom: '2px solid #222', textAlign: 'left', whiteSpace: 'nowrap' };
  const THR = { ...TH, textAlign: 'right' };
  const TD = { padding: '3px 6px', fontSize: 11, borderBottom: '1px solid #ebebeb' };
  const TDR = { ...TD, textAlign: 'right' };
  const FT = { padding: '4px 6px', fontSize: 11, fontWeight: 700, borderTop: '2px solid #222', background: '#f2f2f2' };
  const FTR = { ...FT, textAlign: 'right' };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={TH}>Player</th>
          <th style={THR}>GP</th>
          <th style={THR}>G</th>
          <th style={THR}>A</th>
          <th style={THR}>B</th>
          <th style={THR}>T</th>
          <th style={THR}>Comp%</th>
          <th style={THR}>+/−</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((r, i) => (
          <tr key={i} style={{ background: i % 2 === 1 ? '#f8f8f8' : 'white' }}>
            <td style={TD}>{r.display_name || '—'}</td>
            <td style={TDR}>{r.gp ?? 0}</td>
            <td style={TDR}>{r.goals    ?? 0}</td>
            <td style={TDR}>{r.assists  ?? 0}</td>
            <td style={TDR}>{r.blocks   ?? 0}</td>
            <td style={TDR}>{r.throwaways ?? 0}</td>
            <td style={TDR}>{fmtPct(r.completion_pct)}</td>
            <td style={TDR}>{r.plus_minus != null ? (r.plus_minus > 0 ? `+${r.plus_minus}` : r.plus_minus) : '—'}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td style={FT}>Team Total</td>
          <td style={FTR}>—</td>
          <td style={FTR}>{totals.g}</td>
          <td style={FTR}>{totals.as}</td>
          <td style={FTR}>{totals.b}</td>
          <td style={FTR}>{totals.t}</td>
          <td style={FTR}>{totCompPct ? `${totCompPct}%` : '—'}</td>
          <td style={FTR}>{totals.pm > 0 ? `+${totals.pm}` : totals.pm || '—'}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/* ── main component ── */
export default function TeamReportPage() {
  const { league, teamId }        = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const lg = (league || 'ufa').toLowerCase();

  const [teamInfo, setTeamInfo]   = useState(null);   // from /api/ufa/teams
  const [seasons, setSeasons]     = useState([]);      // from /api/ufa/franchise/{id}/seasons
  const [roster, setRoster]       = useState(null);    // from /api/ufa/franchise/{id}/roster/{year}
  const [selectedYear, setYear]   = useState(() => {
    const p = searchParams.get('year');
    return p ? parseInt(p) : null;
  });
  const [loading, setLoading]     = useState(true);
  const [rosterLoading, setRL]    = useState(false);
  const [error, setError]         = useState(null);

  /* fetch team + seasons on mount */
  useEffect(() => {
    if (!teamId || lg !== 'ufa') return;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch('/api/ufa/teams').then(r => r.ok ? r.json() : null),
      fetch(`/api/ufa/franchise/${encodeURIComponent(teamId)}/seasons`).then(r => r.ok ? r.json() : Promise.reject(r.status)),
    ])
      .then(([teamsData, seasonsData]) => {
        if (teamsData) {
          const found = teamsData.teams.find(t => t.franchise_id === teamId);
          setTeamInfo(found || null);
        }
        const sData = seasonsData.seasons || [];
        setSeasons(sData);

        // default to most recent year if not specified
        if (!selectedYear && sData.length > 0) {
          const maxYear = Math.max(...sData.map(s => s.year));
          setYear(maxYear);
        }
        setLoading(false);
      })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [teamId, lg]);

  /* fetch roster when year changes */
  useEffect(() => {
    if (!teamId || !selectedYear || lg !== 'ufa') return;
    setRL(true);
    setRoster(null);
    fetch(`/api/ufa/franchise/${encodeURIComponent(teamId)}/roster/${selectedYear}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setRoster(d ? d.roster : []); setRL(false); })
      .catch(() => { setRoster([]); setRL(false); });
  }, [teamId, selectedYear, lg]);

  if (loading) return <div style={{ background: 'white', minHeight: '100vh', padding: 40, color: '#333' }}>Loading report…</div>;
  if (error)   return <div style={{ background: 'white', minHeight: '100vh', padding: 40, color: '#c00' }}>Team not found.</div>;

  const teamName = teamInfo?.team_name || teamId;
  const currentSeason = seasons.find(s => s.year === selectedYear);
  const yearOptions = [...seasons].sort((a, b) => b.year - a.year).map(s => s.year);

  const record = currentSeason
    ? `${currentSeason.wins ?? '—'}-${currentSeason.losses ?? '—'}${currentSeason.ties ? `-${currentSeason.ties}` : ''}`
    : '—';

  const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  function handleYearChange(e) {
    const yr = parseInt(e.target.value);
    setYear(yr);
    setSearchParams({ year: yr }, { replace: true });
  }

  if (lg !== 'ufa') {
    return (
      <div style={{ background: 'white', minHeight: '100vh', padding: 48, fontFamily: "'Segoe UI', system-ui, Arial, sans-serif" }}>
        <div style={{ maxWidth: 600, margin: '0 auto', textAlign: 'center', color: '#888', paddingTop: 80 }}>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Team reports are currently available for UFA only.</div>
          <div style={{ fontSize: 13 }}>Support for {lg.toUpperCase()} teams coming soon.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: 'white', color: '#111', minHeight: '100vh', paddingBottom: 48, fontFamily: "'Segoe UI', system-ui, Arial, sans-serif" }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; color: #111 !important; overflow: hidden !important; }
          html { overflow: hidden !important; }
          *::-webkit-scrollbar { display: none !important; }
          * { scrollbar-width: none !important; }
          @page { margin: 0.65in 0.75in; size: 8.5in 11in portrait; }
          .rpt-wrap { padding: 0 0 2in !important; max-width: 100% !important; }
          table { font-size: 10px !important; }
          .notes-line { border-bottom: 1px solid #ccc !important; }
          .notes-footer { position: fixed !important; bottom: 0 !important; left: 0 !important; right: 0 !important; padding: 10px 0.75in 0 !important; background: white !important; margin-top: 0 !important; }
          .page-break { break-before: page !important; }
        }
      `}</style>

      <div className="rpt-wrap" style={{ maxWidth: 720, margin: '0 auto', padding: '32px 32px 0' }}>

        {/* Print + year selector bar */}
        <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ fontSize: 13, color: '#555', fontWeight: 600 }}>Season:</label>
            <select
              value={selectedYear || ''}
              onChange={handleYearChange}
              style={{
                border: '1px solid #ddd', borderRadius: 5, padding: '5px 10px',
                fontSize: 13, background: 'white', cursor: 'pointer',
              }}
            >
              {yearOptions.map(yr => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => window.print()}
            style={{
              background: '#EA6020', color: 'white', border: 'none',
              padding: '8px 22px', borderRadius: 6, fontSize: 13,
              cursor: 'pointer', fontWeight: 700, letterSpacing: '0.03em',
            }}
          >
            Print / Save PDF
          </button>
          <div style={{ fontSize: 10, color: '#aaa', marginTop: 5, textAlign: 'right' }}>
            In the print dialog → uncheck <strong>Headers and footers</strong>
          </div>
        </div>

        {/* Page header */}
        <div style={{ borderBottom: '3px solid #EA6020', paddingBottom: 10, marginBottom: 22 }}>
          <div style={{ fontSize: 10, color: '#999', fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase', marginBottom: 4 }}>
            UltiAnalytics · Team Season Report
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#111' }}>
              {teamName} &middot; {selectedYear || '—'}
            </div>
            <div style={{ fontSize: 11, color: '#999' }}>Generated {generated}</div>
          </div>
        </div>

        {/* Season summary card */}
        {currentSeason && (
          <div style={{
            display: 'flex', gap: 24,
            background: '#fafafa', border: '1px solid #e4e4e4',
            borderRadius: 8, padding: '14px 20px', marginBottom: 24,
          }}>
            <div style={{ textAlign: 'center', minWidth: 80 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#111', letterSpacing: '-0.02em', lineHeight: 1 }}>{record}</div>
              <div style={{ fontSize: 10, color: '#999', fontWeight: 700, letterSpacing: '0.08em', marginTop: 3 }}>RECORD</div>
            </div>
            <div style={{ width: 1, background: '#e0e0e0' }} />
            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              {currentSeason.division && (
                <div style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>{currentSeason.division}</div>
              )}
              {currentSeason.standing && (
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  {currentSeason.standing === 1 ? '1st' : currentSeason.standing === 2 ? '2nd' : currentSeason.standing === 3 ? '3rd' : `${currentSeason.standing}th`} in division
                </div>
              )}
            </div>
          </div>
        )}

        {/* Game Log */}
        <SectionLabel>Season Game Log — {selectedYear}</SectionLabel>
        <div style={{ marginBottom: 24 }}>
          <GameLog games={currentSeason?.games || []} />
        </div>

        <div className="page-break">
          <Divider />

          {/* Roster Stats */}
          <SectionLabel>Roster Statistics — {selectedYear}</SectionLabel>
          {rosterLoading ? (
            <div style={{ color: '#aaa', fontSize: 12, padding: '8px 0' }}>Loading roster…</div>
          ) : (
            <RosterTable roster={roster} />
          )}
        </div>

        {/* Notes box */}
        <NotesBox />

      </div>
    </div>
  );
}
