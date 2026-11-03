import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

/* ── helpers ── */
const LEAGUE_LABEL = { ufa: 'UFA', wul: 'WUL', pul: 'PUL', mlu: 'MLU' };

function fmtDate(raw) {
  if (!raw) return '';
  try {
    const d = new Date(raw.length <= 10 ? raw + 'T12:00:00' : raw);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return raw; }
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

/* ── per-team stat table ── */
function StatTable({ title, players }) {
  if (!players) {
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{title}</div>
        <div style={{ color: '#aaa', fontSize: 12, padding: '8px 0' }}>Loading…</div>
      </div>
    );
  }
  if (players.length === 0) {
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{title}</div>
        <div style={{ color: '#aaa', fontSize: 12, padding: '8px 0' }}>No player data</div>
      </div>
    );
  }

  const tot = players.reduce(
    (a, p) => ({ g: a.g + (p.goals || 0), as: a.as + (p.assists || 0), t: a.t + (p.turnovers || 0), b: a.b + (p.blocks || 0) }),
    { g: 0, as: 0, t: 0, b: 0 }
  );

  const TH = { padding: '4px 6px', textAlign: 'left', fontSize: 11, fontWeight: 700, borderBottom: '2px solid #222' };
  const TC = { padding: '3px 6px', textAlign: 'center', fontSize: 11, fontWeight: 700, borderBottom: '2px solid #222' };
  const TD = { padding: '3px 6px', fontSize: 11, borderBottom: '1px solid #ebebeb' };
  const TDC = { ...TD, textAlign: 'center' };
  const FT = { padding: '4px 6px', fontSize: 11, fontWeight: 700, borderTop: '2px solid #222', background: '#f2f2f2' };
  const FTC = { ...FT, textAlign: 'center' };

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...TH, width: 28 }}>#</th>
            <th style={TH}>Name</th>
            <th style={TC}>G</th>
            <th style={TC}>A</th>
            <th style={TC}>T</th>
            <th style={TC}>B</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p, i) => (
            <tr key={i} style={{ background: i % 2 === 1 ? '#f8f8f8' : 'white' }}>
              <td style={{ ...TD, color: '#999' }}>{p.number ?? '—'}</td>
              <td style={TD}>{p.name}</td>
              <td style={TDC}>{p.goals ?? 0}</td>
              <td style={TDC}>{p.assists ?? 0}</td>
              <td style={TDC}>{p.turnovers ?? 0}</td>
              <td style={TDC}>{p.blocks ?? 0}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} style={FT}>Team Total</td>
            <td style={FTC}>{tot.g}</td>
            <td style={FTC}>{tot.as}</td>
            <td style={FTC}>{tot.t}</td>
            <td style={FTC}>{tot.b}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ── main component ── */
export default function GameReportPage() {
  const { league, gameId } = useParams();
  const lg = (league || 'ufa').toLowerCase();
  const leagueLabel = LEAGUE_LABEL[lg] || lg.toUpperCase();

  const [game, setGame]         = useState(null);
  const [teamPlayers, setTP]    = useState({});
  const [h2h, setH2h]           = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    if (!gameId || !lg) return;
    setLoading(true);
    setError(null);

    const gameUrl    = `/api/${lg}/games/${encodeURIComponent(gameId)}`;
    const rosterUrl  = lg === 'ufa'
      ? `/api/ufa/games/${encodeURIComponent(gameId)}/roster`
      : `/api/${lg}/games/${encodeURIComponent(gameId)}/players`;
    const h2hUrl     = `/api/${lg}/games/${encodeURIComponent(gameId)}/h2h`;

    Promise.all([
      fetch(gameUrl).then(r => r.ok ? r.json() : Promise.reject(r.status)),
      fetch(rosterUrl).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(h2hUrl).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([gameData, rosterData, h2hData]) => {
        setGame(gameData);
        setH2h(h2hData);

        if (rosterData) {
          const normalized = {};
          if (lg === 'ufa' && rosterData.teams) {
            for (const [tid, players] of Object.entries(rosterData.teams)) {
              normalized[tid] = players.map(p => ({
                name:      p.name,
                number:    p.number,
                goals:     p.goals     || 0,
                assists:   p.assists   || 0,
                turnovers: p.throwaways || 0,
                blocks:    p.blocks    || 0,
              }));
            }
          } else if (rosterData.players) {
            for (const p of rosterData.players) {
              const tid = p.team;
              if (!normalized[tid]) normalized[tid] = [];
              normalized[tid].push({
                name:      p.player,
                number:    p.jersey_number,
                goals:     p.goals     || 0,
                assists:   p.assists   || 0,
                turnovers: p.turnovers || 0,
                blocks:    p.blocks    || 0,
              });
            }
          }
          setTP(normalized);
        }
        setLoading(false);
      })
      .catch(err => { setError(String(err)); setLoading(false); });
  }, [lg, gameId]);

  if (loading) return <div style={{ background: 'white', minHeight: '100vh', padding: 40, color: '#333' }}>Loading report…</div>;
  if (error || !game) return <div style={{ background: 'white', minHeight: '100vh', padding: 40, color: '#c00' }}>Failed to load game data.</div>;

  const homeId  = game.home_team_id;
  const awayId  = game.away_team_id;

  const sort = arr => [...arr].sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999));
  const homePlayers = sort(teamPlayers[homeId] || []);
  const awayPlayers = sort(teamPlayers[awayId] || []);

  /* H2H orientation */
  const homeIsT1    = h2h && (h2h.team1 === homeId);
  const homeWins    = h2h ? (homeIsT1 ? h2h.team1_wins : h2h.team2_wins) : 0;
  const awayWins    = h2h ? (homeIsT1 ? h2h.team2_wins : h2h.team1_wins) : 0;

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

        {/* Game header */}
        <div style={{
          borderTop: '4px solid #EA6020', borderBottom: '1px solid #e4e4e4',
          marginBottom: 24, padding: '16px 0 20px',
        }}>
          {/* meta row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{
                background: '#EA6020', color: 'white', fontSize: 10, fontWeight: 800,
                padding: '2px 9px', borderRadius: 4, letterSpacing: '0.10em',
              }}>
                {leagueLabel}
              </span>
              <span style={{ fontSize: 11, color: '#888', letterSpacing: '0.04em' }}>
                {[game.year, game.week ? `Week ${game.week}` : null, game.date].filter(Boolean).join(' · ')}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                border: '1px solid #ccc', color: '#666',
                fontSize: 10, fontWeight: 700, padding: '2px 10px',
                borderRadius: 99, letterSpacing: '0.08em',
              }}>
                {(game.status || 'FINAL').toUpperCase()}
              </span>
              <span style={{ fontSize: 10, color: '#bbb' }}>Generated {generated}</span>
            </div>
          </div>

          {/* teams + score */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {/* Home */}
            <div style={{ flex: 1, textAlign: 'right', paddingRight: 24 }}>
              <div style={{ fontSize: 11, color: '#aaa', fontWeight: 700, letterSpacing: '0.10em', marginBottom: 4 }}>HOME</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#111', lineHeight: 1.1 }}>{game.home_team}</div>
            </div>
            {/* Score */}
            <div style={{ textAlign: 'center', minWidth: 130, borderLeft: '1px solid #e8e8e8', borderRight: '1px solid #e8e8e8', padding: '0 24px' }}>
              <div style={{ fontSize: 44, fontWeight: 900, color: '#EA6020', letterSpacing: '-0.03em', lineHeight: 1 }}>
                {game.home_score ?? '—'}&thinsp;–&thinsp;{game.away_score ?? '—'}
              </div>
            </div>
            {/* Away */}
            <div style={{ flex: 1, paddingLeft: 24 }}>
              <div style={{ fontSize: 11, color: '#aaa', fontWeight: 700, letterSpacing: '0.10em', marginBottom: 4 }}>AWAY</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#111', lineHeight: 1.1 }}>{game.away_team}</div>
            </div>
          </div>
        </div>

        {/* Player stats */}
        <SectionLabel>Player Statistics</SectionLabel>
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginBottom: 24 }}>
          <StatTable title={game.home_team} players={homePlayers} />
          <div style={{ width: 1, background: '#e0e0e0', alignSelf: 'stretch' }} />
          <StatTable title={game.away_team} players={awayPlayers} />
        </div>

        {/* H2H Section */}
        {h2h && (
          <div className="page-break">
            <Divider />
            <SectionLabel>Series History — All Time</SectionLabel>

            {/* Record row */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
              background: '#fafafa', border: '1px solid #e4e4e4', borderRadius: 8,
              padding: '12px 16px', marginBottom: 12,
            }}>
              <div style={{ flex: 1, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{game.home_team}</div>
              <div style={{ textAlign: 'center', minWidth: 100 }}>
                <div style={{ fontSize: 26, fontWeight: 900, color: '#EA6020', letterSpacing: '-0.02em' }}>
                  {homeWins} – {awayWins}
                </div>
                <div style={{ fontSize: 10, color: '#aaa', fontWeight: 700, letterSpacing: '0.08em' }}>ALL-TIME SERIES</div>
              </div>
              <div style={{ flex: 1, fontWeight: 700, fontSize: 13 }}>{game.away_team}</div>
            </div>

            {/* Game log */}
            {h2h.games && h2h.games.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #222' }}>
                    {['Year', 'Date', 'Home', 'Score', 'Away'].map(h => (
                      <th key={h} style={{ padding: '4px 8px', textAlign: h === 'Score' ? 'center' : 'left', fontSize: 11, fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...h2h.games].reverse().map((g, i) => {
                    const isCurrent = String(g.game_id) === String(gameId);
                    const winnerIsHome = (g.home_score || 0) > (g.away_score || 0);
                    return (
                      <tr key={i} style={{
                        background: isCurrent ? 'rgba(234,96,32,0.07)' : i % 2 === 1 ? '#f8f8f8' : 'white',
                        borderBottom: '1px solid #ebebeb',
                        fontWeight: isCurrent ? 700 : 400,
                      }}>
                        <td style={{ padding: '3px 8px' }}>{g.year}</td>
                        <td style={{ padding: '3px 8px' }}>{(g.date || '').slice(0, 10)}</td>
                        <td style={{ padding: '3px 8px', fontWeight: winnerIsHome ? 700 : 400 }}>{g.home_team_id}</td>
                        <td style={{ padding: '3px 8px', textAlign: 'center' }}>{g.home_score} – {g.away_score}</td>
                        <td style={{ padding: '3px 8px', fontWeight: !winnerIsHome ? 700 : 400 }}>{g.away_team_id}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
        {/* Notes box */}
        <NotesBox />
      </div>
    </div>
  );
}
