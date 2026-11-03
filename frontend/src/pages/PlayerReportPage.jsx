import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

/* ── helpers ── */
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

/* ── UFA Season Stats Table ── */
function UFATable({ rows }) {
  if (!rows || rows.length === 0) return <div style={{ color: '#aaa', fontSize: 12 }}>No UFA data.</div>;

  const season = rows.filter(r => r.year);

  const totals = season.reduce((a, r) => ({
    gp:   a.gp   + (r.games_played  || r.gp  || 0),
    g:    a.g    + (r.goals   || 0),
    as:   a.as   + (r.assists  || 0),
    b:    a.b    + (r.blocks   || 0),
    t:    a.t    + (r.throwaways || 0),
    comp: a.comp + (r.completions || 0),
    att:  a.att  + (r.throw_attempts || 0),
    pm:   a.pm   + (r.plus_minus || 0),
  }), { gp: 0, g: 0, as: 0, b: 0, t: 0, comp: 0, att: 0, pm: 0 });
  const totCompPct = totals.att ? (totals.comp / totals.att * 100).toFixed(1) : null;

  const TH = { padding: '4px 6px', fontSize: 11, fontWeight: 700, borderBottom: '2px solid #222', textAlign: 'left', whiteSpace: 'nowrap' };
  const THR = { ...TH, textAlign: 'right' };
  const TD = { padding: '3px 6px', fontSize: 11, borderBottom: '1px solid #ebebeb' };
  const TDR = { ...TD, textAlign: 'right' };
  const FT = { padding: '4px 6px', fontSize: 11, fontWeight: 700, borderTop: '2px solid #222', background: '#f2f2f2' };
  const FTR = { ...FT, textAlign: 'right' };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={TH}>Year</th>
          <th style={TH}>Team</th>
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
        {season.map((r, i) => {
          const gp = r.games_played ?? r.gp ?? 0;
          return (
            <tr key={i} style={{ background: i % 2 === 1 ? '#f8f8f8' : 'white' }}>
              <td style={TD}>{r.year}</td>
              <td style={TD}>{r.team_name || r.team || '—'}</td>
              <td style={TDR}>{gp}</td>
              <td style={TDR}>{r.goals   ?? 0}</td>
              <td style={TDR}>{r.assists  ?? 0}</td>
              <td style={TDR}>{r.blocks   ?? 0}</td>
              <td style={TDR}>{r.throwaways ?? 0}</td>
              <td style={TDR}>{fmtPct(r.completion_pct)}</td>
              <td style={TDR}>{r.plus_minus != null ? (r.plus_minus > 0 ? `+${r.plus_minus}` : r.plus_minus) : '—'}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={2} style={FT}>Career Total</td>
          <td style={FTR}>{totals.gp}</td>
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

/* ── WUL Season Stats Table ── */
function WULTable({ rows }) {
  if (!rows || rows.length === 0) return <div style={{ color: '#aaa', fontSize: 12 }}>No WUL data.</div>;

  const totals = rows.reduce((a, r) => ({
    gp: a.gp + (r.games_played || 0),
    g:  a.g  + (r.g  || 0),
    as: a.as + (r.a  || 0),
    b:  a.b  + (r.b  || 0),
    t:  a.t  + (r.th || 0),
  }), { gp: 0, g: 0, as: 0, b: 0, t: 0 });

  const TH = { padding: '4px 6px', fontSize: 11, fontWeight: 700, borderBottom: '2px solid #222', textAlign: 'left' };
  const THR = { ...TH, textAlign: 'right' };
  const TD = { padding: '3px 6px', fontSize: 11, borderBottom: '1px solid #ebebeb' };
  const TDR = { ...TD, textAlign: 'right' };
  const FT = { padding: '4px 6px', fontSize: 11, fontWeight: 700, borderTop: '2px solid #222', background: '#f2f2f2' };
  const FTR = { ...FT, textAlign: 'right' };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={TH}>Year</th>
          <th style={TH}>Team</th>
          <th style={THR}>GP</th>
          <th style={THR}>G</th>
          <th style={THR}>A</th>
          <th style={THR}>B</th>
          <th style={THR}>T</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ background: i % 2 === 1 ? '#f8f8f8' : 'white' }}>
            <td style={TD}>{r.year}</td>
            <td style={TD}>{r.team || '—'}</td>
            <td style={TDR}>{r.games_played ?? 0}</td>
            <td style={TDR}>{r.g  ?? 0}</td>
            <td style={TDR}>{r.a  ?? 0}</td>
            <td style={TDR}>{r.b  ?? 0}</td>
            <td style={TDR}>{r.th ?? 0}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={2} style={FT}>Career Total</td>
          <td style={FTR}>{totals.gp}</td>
          <td style={FTR}>{totals.g}</td>
          <td style={FTR}>{totals.as}</td>
          <td style={FTR}>{totals.b}</td>
          <td style={FTR}>{totals.t}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/* ── PUL Season Stats Table ── */
function PULTable({ rows }) {
  if (!rows || rows.length === 0) return <div style={{ color: '#aaa', fontSize: 12 }}>No PUL data.</div>;

  const season = rows.filter(r => r.season !== 'career');

  const totals = season.reduce((a, r) => ({
    gp: a.gp + (r.games ?? r.gp ?? 0),
    g:  a.g  + (r.goals    || 0),
    as: a.as + (r.assists   || 0),
    b:  a.b  + (r.blocks    || 0),
    t:  a.t  + (r.throwaways || 0),
  }), { gp: 0, g: 0, as: 0, b: 0, t: 0 });

  const TH = { padding: '4px 6px', fontSize: 11, fontWeight: 700, borderBottom: '2px solid #222', textAlign: 'left' };
  const THR = { ...TH, textAlign: 'right' };
  const TD = { padding: '3px 6px', fontSize: 11, borderBottom: '1px solid #ebebeb' };
  const TDR = { ...TD, textAlign: 'right' };
  const FT = { padding: '4px 6px', fontSize: 11, fontWeight: 700, borderTop: '2px solid #222', background: '#f2f2f2' };
  const FTR = { ...FT, textAlign: 'right' };

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={TH}>Season</th>
          <th style={TH}>Team</th>
          <th style={THR}>GP</th>
          <th style={THR}>G</th>
          <th style={THR}>A</th>
          <th style={THR}>B</th>
          <th style={THR}>T</th>
        </tr>
      </thead>
      <tbody>
        {season.map((r, i) => (
          <tr key={i} style={{ background: i % 2 === 1 ? '#f8f8f8' : 'white' }}>
            <td style={TD}>{r.season}</td>
            <td style={TD}>{r.team || '—'}</td>
            <td style={TDR}>{r.games ?? r.gp ?? 0}</td>
            <td style={TDR}>{r.goals    ?? 0}</td>
            <td style={TDR}>{r.assists  ?? 0}</td>
            <td style={TDR}>{r.blocks   ?? 0}</td>
            <td style={TDR}>{r.throwaways ?? 0}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={2} style={FT}>Career Total</td>
          <td style={FTR}>{totals.gp}</td>
          <td style={FTR}>{totals.g}</td>
          <td style={FTR}>{totals.as}</td>
          <td style={FTR}>{totals.b}</td>
          <td style={FTR}>{totals.t}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/* ── main component ── */
export default function PlayerReportPage() {
  const { playerId } = useParams();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    if (!playerId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/players/${encodeURIComponent(playerId)}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [playerId]);

  if (loading) return <div style={{ background: 'white', minHeight: '100vh', padding: 40, color: '#333' }}>Loading report…</div>;
  if (error || !data) return <div style={{ background: 'white', minHeight: '100vh', padding: 40, color: '#c00' }}>Player not found.</div>;

  const { player, ufaStats = [], pulStats = [], wulStats = [] } = data;
  const hasUFA = ufaStats.length > 0;
  const hasWUL = wulStats.length > 0;
  const hasPUL = pulStats.filter(r => r.season !== 'career').length > 0;

  const leagues = [hasUFA && 'UFA', hasWUL && 'WUL', hasPUL && 'PUL'].filter(Boolean).join(' · ');

  /* career span */
  const allYears = [
    ...ufaStats.map(r => r.year).filter(Boolean),
    ...wulStats.map(r => r.year).filter(Boolean),
    ...pulStats.filter(r => r.season !== 'career').map(r => parseInt(r.season)).filter(Boolean),
  ];
  const careerSpan = allYears.length ? `${Math.min(...allYears)} – ${Math.max(...allYears)}` : '—';

  const generated = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

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

        {/* Print button */}
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
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
            UltiAnalytics · Player Report
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#111' }}>
              {player.display_name || player.name}
            </div>
            <div style={{ fontSize: 11, color: '#999' }}>Generated {generated}</div>
          </div>
        </div>

        {/* Player info strip */}
        <div style={{
          display: 'flex', gap: 24, alignItems: 'center',
          background: '#fafafa', border: '1px solid #e4e4e4',
          borderRadius: 8, padding: '12px 18px', marginBottom: 24,
        }}>
          {player.photo_url && (
            <img
              src={player.photo_url}
              alt={player.display_name || player.name}
              style={{ width: 60, height: 60, borderRadius: 6, objectFit: 'cover', border: '1px solid #e0e0e0' }}
              onError={e => { e.currentTarget.style.display = 'none'; }}
            />
          )}
          <div>
            {player.jersey_number && (
              <div style={{ fontSize: 11, color: '#999', marginBottom: 2 }}>
                #{player.jersey_number}
              </div>
            )}
            {player.current_team_name && (
              <div style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>{player.current_team_name}</div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              {leagues.split(' · ').map(lg => (
                <span key={lg} style={{
                  background: '#EA6020', color: 'white',
                  fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 99,
                  letterSpacing: '0.06em',
                }}>
                  {lg}
                </span>
              ))}
              <span style={{ fontSize: 11, color: '#888', alignSelf: 'center' }}>
                Career {careerSpan}
              </span>
            </div>
          </div>
        </div>

        {/* UFA Stats */}
        {hasUFA && (
          <>
            <SectionLabel>UFA Season Statistics</SectionLabel>
            <UFATable rows={ufaStats} />
          </>
        )}

        {/* WUL Stats */}
        {hasWUL && (
          <div className="page-break">
            {hasUFA && <Divider />}
            <SectionLabel>WUL Season Statistics</SectionLabel>
            <WULTable rows={wulStats} />
          </div>
        )}

        {/* PUL Stats */}
        {hasPUL && (
          <div className="page-break">
            {(hasUFA || hasWUL) && <Divider />}
            <SectionLabel>PUL Season Statistics</SectionLabel>
            <PULTable rows={pulStats} />
          </div>
        )}

        {/* No data */}
        {!hasUFA && !hasWUL && !hasPUL && (
          <div style={{ color: '#888', fontSize: 13, padding: '16px 0' }}>
            No season statistics available for this player.
          </div>
        )}

        {/* Notes box */}
        <NotesBox />

      </div>
    </div>
  );
}
