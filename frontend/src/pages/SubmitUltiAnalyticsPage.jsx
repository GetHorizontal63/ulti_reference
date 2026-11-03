import React, { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';

// ── Shared style tokens ───────────────────────────────────────────────────────

const CARD = {
  background:   'var(--surf-bg)',
  border:       '1px solid var(--surf-border)',
  borderRadius:  10,
  padding:      '22px 24px',
};

const SECTION_HEAD = {
  fontFamily:    'var(--font-h2)',
  fontSize:       9,
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color:         'var(--orange)',
  opacity:        0.75,
  marginBottom:   6,
};

const LABEL_SM = {
  fontFamily:    'var(--font-h2)',
  fontSize:      10,
  letterSpacing: '1.5px',
  textTransform: 'uppercase',
  color:         'var(--t-muted)',
};

const LABEL_VAL = {
  fontFamily: 'var(--font-body)',
  fontSize:    14,
  color:       'var(--t-primary)',
};

const TH = {
  padding:       '7px 10px',
  fontFamily:    'var(--font-h2)',
  fontSize:       8,
  letterSpacing: '1.5px',
  textTransform: 'uppercase',
  color:         'var(--t-muted)',
  borderBottom:  '1px solid var(--surf-border)',
  textAlign:     'left',
  whiteSpace:    'nowrap',
};

const TD = {
  padding:    '8px 10px',
  fontFamily: 'var(--font-body)',
  fontSize:    13,
  color:       'var(--t-secondary)',
  borderBottom: '1px solid var(--surf-border)',
  whiteSpace:  'nowrap',
};

const TD_NUM = { ...TD, textAlign: 'right', fontFamily: 'var(--font-h2)', fontSize: 12 };

// ── Parser (mirrors pipelines/ultianalytics_ingest/parse_iexport.py) ─────────

const ACTION_MAP = {
  Goal:      'goal',
  Catch:     'catch',
  Throwaway: 'throwaway',
  Drop:      'drop',
  D:         'block',
  Pull:      'pull',
};

function normaliseAction(rawType, rawAction) {
  if (rawType === 'Defense' && rawAction === 'Goal') return 'opponent_goal';
  return ACTION_MAP[rawAction] ?? rawAction.toLowerCase();
}

function parseEvent(seq, raw) {
  const details = raw.details || {};
  return {
    seq,
    timestamp:       raw.timestamp,
    side:            (raw.type || '').toLowerCase(),
    action:          normaliseAction(raw.type || '', raw.action || ''),
    passer:          raw.passer   ?? null,
    receiver:        raw.receiver ?? null,
    defender:        raw.defender ?? null,
    pull_hangtime_ms: details.hangtime ?? null,
  };
}

function parsePoint(pointNum, raw) {
  const summary    = raw.summary || {};
  const score      = summary.score || {};
  const scoreAfter = { us: score.ours ?? 0, them: score.theirs ?? 0 };

  let scoreBefore = { ...scoreAfter };
  if (summary.finished) {
    const lineType   = summary.lineType || 'O';
    const eventsRaw  = raw.events || [];
    const lastEvent  = eventsRaw[eventsRaw.length - 1] || {};
    const opponentScored = lastEvent.type === 'Defense' && lastEvent.action === 'Goal';
    if (lineType === 'O') {
      scoreBefore.us = Math.max(0, scoreAfter.us - 1);
    } else if (opponentScored) {
      scoreBefore.them = Math.max(0, scoreAfter.them - 1);
    } else {
      scoreBefore.us = Math.max(0, scoreAfter.us - 1);
    }
  }

  return {
    point_num:        pointNum,
    line_type:        summary.lineType || 'O',
    line:             raw.line || [],
    score_before:     scoreBefore,
    score_after:      scoreAfter,
    elapsed_seconds:  summary.elapsedTime ?? null,
    finished:         summary.finished ?? false,
    substitutions:    (raw.substitutions || []).map(s => ({
      from_player: s.fromPlayer,
      to_player:   s.toPlayer,
      reason:      s.reason,
      timestamp:   s.timestamp,
    })),
    events: (raw.events || []).map((e, i) => parseEvent(i, e)),
  };
}

function parseIexport(text) {
  const outer = JSON.parse(text);
  if (!outer.teamJson || !outer.gameJson) throw new Error('Not a valid .iexport file.');

  const team      = JSON.parse(outer.teamJson);
  const game      = JSON.parse(outer.gameJson);
  const rawPoints = JSON.parse(game.pointsJson || '[]');
  const tsStr     = game.timestamp || '';
  const [datePart = '', timePart = ''] = tsStr.split(' ');
  const wind      = game.wind || {};

  const roster    = (team.players || []).map(p => ({
    name:     p.name,
    number:   p.number,
    position: p.position,
    gender:   p.male ? 'M' : 'F',
    absent:   p.absent ?? false,
  }));
  const pointsParsed = rawPoints.map((p, i) => parsePoint(i + 1, p));
  const playerStats  = computePlayerStats(roster, pointsParsed);
  roster.forEach(entry => { entry.stats = playerStats[entry.name] ?? emptyStats(); });

  return {
    source:      'ultianalytics',
    exported_at: outer.dateExported,
    exported_by: outer.userThatExported,
    game: {
      game_id:           game.gameId,
      team_cloud_id:     team.cloudId,
      team_name:         team.name,
      season:            team.season,
      opponent:          game.opponentName,
      tournament:        game.tournamentName || '',
      date:              datePart,
      time:              timePart,
      score_us:          game.ours,
      score_them:        game.theirs,
      game_point:        game.gamePoint,
      first_point_oline: game.firstPointOline ?? true,
      wind_mph:          wind.mph,
      wind_degrees:      wind.degrees,
    },
    roster,
    points: pointsParsed,
  };
}

// ── Per-player stat computation (mirrors parse_iexport.py) ─────────────────────

function emptyStats() {
  return {
    goals: 0, assists: 0, hockey_assists: 0,
    pass_attempts: 0, completions: 0, throwaways: 0, pass_pct: null,
    drops: 0, blocks: 0, callahans: 0,
    pulls: 0, pull_hangtime_avg_sec: null,
  };
}

function computePlayerStats(roster, points) {
  const stats    = {};
  const hangtimes = {};

  for (const p of roster) {
    stats[p.name]    = emptyStats();
    hangtimes[p.name] = [];
  }

  function get(name) {
    if (!name || name === 'Anonymous') return null;
    if (!stats[name]) { stats[name] = emptyStats(); hangtimes[name] = []; }
    return stats[name];
  }

  for (const point of points) {
    const events     = point.events;
    const scoreBefore = point.score_before;
    const scoreAfter  = point.score_after;
    const finished    = point.finished;

    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      const { action, passer, receiver, defender } = ev;

      if (action === 'goal') {
        const r = get(receiver); if (r) r.goals++;
        const p = get(passer);
        if (p) { p.assists++; p.pass_attempts++; p.completions++; }
        // Hockey assist: nearest prior catch event's passer
        for (let j = i - 1; j >= 0; j--) {
          const prev = events[j];
          if (prev.action === 'catch' && prev.side === 'offense') {
            const ha = get(prev.passer); if (ha) ha.hockey_assists++;
            break;
          }
          if (['throwaway', 'drop', 'block', 'pull'].includes(prev.action)) break;
        }
      } else if (action === 'catch') {
        const p = get(passer); if (p) { p.pass_attempts++; p.completions++; }
      } else if (action === 'throwaway' && ev.side === 'offense') {
        const p = get(passer); if (p) { p.pass_attempts++; p.throwaways++; }
      } else if (action === 'drop') {
        const p = get(passer); if (p) p.pass_attempts++;
        const r = get(receiver); if (r) r.drops++;
      } else if (action === 'block') {
        const d = get(defender);
        if (d) {
          d.blocks++;
          if (finished && i === events.length - 1 && scoreAfter.us > scoreBefore.us)
            d.callahans++;
        }
      } else if (action === 'pull') {
        const d = get(defender);
        if (d) {
          d.pulls++;
          if (ev.pull_hangtime_ms != null) hangtimes[defender].push(ev.pull_hangtime_ms);
        }
      }
    }
  }

  // Post-process
  for (const name of Object.keys(stats)) {
    const s  = stats[name];
    s.pass_pct = s.pass_attempts > 0
      ? Math.round(s.completions / s.pass_attempts * 1000) / 1000
      : null;
    const ht = hangtimes[name] || [];
    s.pull_hangtime_avg_sec = ht.length > 0
      ? Math.round(ht.reduce((a, b) => a + b, 0) / ht.length / 10) / 100
      : null;
  }

  return stats;
}

// ── Box score derivation ──────────────────────────────────────────────────────

function buildBoxScore(data) {
  const { game, points } = data;

  // Goals per "quarter" — UltiAnalytics doesn't track halves so we approximate
  // by dividing points into first-half (≤ half of game_point, capped ≤ game.score total)
  // and second-half buckets.
  const half = Math.ceil((game.game_point || 15) / 2);

  let usH1 = 0, usH2 = 0, themH1 = 0, themH2 = 0;

  points.forEach(pt => {
    const after = pt.score_after;
    const before = pt.score_before;
    const usScored   = after.us   > before.us;
    const themScored = after.them > before.them;
    const isH1 = (after.us + after.them) <= (half + 1);

    if (isH1) {
      if (usScored)   usH1++;
      if (themScored) themH1++;
    } else {
      if (usScored)   usH2++;
      if (themScored) themH2++;
    }
  });

  return {
    us:   { h1: usH1,   h2: usH2,   total: game.score_us },
    them: { h1: themH1, h2: themH2, total: game.score_them },
  };
}

function buildPointSummary(data) {
  return data.points.map(pt => {
    const eventCount = pt.events.length;
    const completions = pt.events.filter(e => e.action === 'catch').length;
    const turnovers   = pt.events.filter(
      e => e.action === 'throwaway' || e.action === 'drop'
    ).length;
    return {
      num:      pt.point_num,
      type:     pt.line_type,
      result:   pt.finished
        ? (pt.score_after.us > pt.score_before.us ? 'Hold/Break (Us)' : 'Hold/Break (Them)')
        : '—',
      score:    `${pt.score_after.us}–${pt.score_after.them}`,
      elapsed:  pt.elapsed_seconds != null ? `${pt.elapsed_seconds}s` : '—',
      players:  pt.line.join(', '),
      events:   eventCount,
      comp:     completions,
      to:       turnovers,
    };
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetaRow({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 100 }}>
      <span style={LABEL_SM}>{label}</span>
      <span style={LABEL_VAL}>{value ?? '—'}</span>
    </div>
  );
}

function BoxScoreTable({ boxScore, teamName, opponent }) {
  const rows = [
    { label: teamName || 'Us',   ...boxScore.us },
    { label: opponent || 'Them', ...boxScore.them },
  ];

  return (
    <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', marginTop: 4 }}>
      <thead>
        <tr>
          <th style={{ ...TH, width: '45%' }}>Team</th>
          <th style={{ ...TH, textAlign: 'center', width: '15%' }}>H1</th>
          <th style={{ ...TH, textAlign: 'center', width: '15%' }}>H2</th>
          <th style={{ ...TH, textAlign: 'center', width: '25%' }}>Final</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.label}>
            <td style={{ ...TD, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</td>
            <td style={{ ...TD_NUM, textAlign: 'center' }}>{r.h1}</td>
            <td style={{ ...TD_NUM, textAlign: 'center' }}>{r.h2}</td>
            <td style={{ ...TD_NUM, textAlign: 'center', color: 'var(--orange)', fontFamily: 'var(--font-h1)', fontSize: 16 }}>
              {r.total}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const _PT_LEFT = new Set(['Result', 'Players on field']);

function PointsTable({ rows }) {
  const cols = ['#', 'Line', 'Score', 'Result', 'Time', 'Comp', 'T/O', 'Players on field'];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 680 }}>
        <thead>
          <tr>
            {cols.map(h => (
              <th
                key={h}
                style={{
                  ...TH,
                  textAlign: _PT_LEFT.has(h) ? 'left' : 'center',
                  ...(h === 'Players on field' ? { minWidth: 200 } : {}),
                }}
              >{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.num} style={{ background: r.num % 2 === 0 ? 'var(--surf-bg-2)' : 'transparent' }}>
              <td style={{ ...TD_NUM, textAlign: 'center' }}>{r.num}</td>
              <td style={{ ...TD, textAlign: 'center', color: r.type === 'O' ? 'var(--orange)' : 'var(--t-muted)' }}>
                {r.type === 'O' ? 'O' : 'D'}
              </td>
              <td style={{ ...TD_NUM, textAlign: 'center', fontFamily: 'var(--font-h1)', fontSize: 13 }}>{r.score}</td>
              <td style={TD}>{r.result}</td>
              <td style={{ ...TD_NUM, textAlign: 'center' }}>{r.elapsed}</td>
              <td style={{ ...TD_NUM, textAlign: 'center' }}>{r.comp}</td>
              <td style={{ ...TD_NUM, textAlign: 'center' }}>{r.to}</td>
              <td style={{ ...TD, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--t-muted)', fontSize: 11 }}>
                {r.players}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STAT_COLS = [
  { key: 'goals',               label: 'G',    title: 'Goals',                   align: 'right' },
  { key: 'assists',             label: 'A',    title: 'Assists',                 align: 'right' },
  { key: 'hockey_assists',      label: 'HA',   title: 'Hockey Assists',          align: 'right' },
  { key: 'pass_attempts',       label: 'PA',   title: 'Pass Attempts',           align: 'right' },
  { key: 'completions',         label: 'Cmp',  title: 'Completions',             align: 'right' },
  { key: 'throwaways',          label: 'TO',   title: 'Throwaways',              align: 'right' },
  { key: 'pass_pct',            label: 'Pct%', title: 'Pass %',                  align: 'right', fmt: v => v != null ? (v * 100).toFixed(1) + '%' : '—' },
  { key: 'drops',               label: 'Dr',   title: 'Drops',                   align: 'right' },
  { key: 'blocks',              label: 'Blk',  title: 'Blocks',                  align: 'right' },
  { key: 'callahans',           label: 'Cal',  title: 'Callahans Caught',        align: 'right' },
  { key: 'pulls',               label: 'Pull', title: 'Pulls',                   align: 'right' },
  { key: 'pull_hangtime_avg_sec', label: 'HT', title: 'Pull Hang Time Avg (sec)', align: 'right', fmt: v => v != null ? v.toFixed(2) + 's' : '—' },
];

function RosterTable({ roster }) {
  const active = roster.filter(p => !p.absent);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 800 }}>
        <thead>
          <tr>
            <th style={TH}>#</th>
            <th style={TH}>Name</th>
            <th style={TH}>Pos</th>
            {STAT_COLS.map(c => (
              <th key={c.key} style={{ ...TH, textAlign: 'right' }} title={c.title}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {active.map((p, i) => {
            const s = p.stats || emptyStats();
            return (
              <tr key={i} style={{ background: i % 2 === 0 ? 'var(--surf-bg-2)' : 'transparent' }}>
                <td style={TD_NUM}>{p.number || '—'}</td>
                <td style={TD}>{p.name}</td>
                <td style={{ ...TD, color: 'var(--t-muted)' }}>{p.position}</td>
                {STAT_COLS.map(c => {
                  const raw = s[c.key];
                  const display = c.fmt ? c.fmt(raw) : (raw ?? '—');
                  const isZero = !c.fmt && raw === 0;
                  return (
                    <td
                      key={c.key}
                      style={{
                        ...TD_NUM,
                        color: isZero ? 'var(--t-muted)' : (c.key === 'pass_pct' ? 'var(--t-secondary)' : 'var(--t-secondary)'),
                        opacity: isZero ? 0.35 : 1,
                      }}
                    >
                      {display}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

// Small reusable inline field
function Field({ label, type = 'text', value, onChange, disabled, placeholder }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={LABEL_SM}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        style={{
          fontFamily:   'var(--font-body)',
          fontSize:      14,
          color:        'var(--t-primary)',
          background:   'var(--surf-bg)',
          border:       '1px solid var(--surf-border)',
          borderRadius:  6,
          padding:      '9px 12px',
          outline:      'none',
          width:        '100%',
          boxSizing:    'border-box',
          opacity:       disabled ? 0.55 : 1,
        }}
      />
    </div>
  );
}

function ErrorBanner({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      marginTop: 12, padding: '9px 14px', borderRadius: 6,
      background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
      color: '#ef4444', fontFamily: 'var(--font-body)', fontSize: 13,
    }}>
      {msg}
    </div>
  );
}

export default function SubmitUltiAnalyticsPage() {
  // ── Credentials state ────────────────────────────────────────────────────
  const [email,        setEmail]        = useState('');
  const [uploadCode,   setUploadCode]   = useState('');
  const [verified,     setVerified]     = useState(null);  // {team_cloud_id, team_name, division}
  const [verifyError,  setVerifyError]  = useState(null);
  const [verifying,    setVerifying]    = useState(false);

  // ── Upload / parse state ─────────────────────────────────────────────────
  const [parsed,   setParsed]   = useState(null);
  const [error,    setError]    = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [fileName, setFileName] = useState(null);

  // ── Submit state ─────────────────────────────────────────────────────────
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitted,   setSubmitted]   = useState(null);  // {submission_id, status} | null

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleVerify = async () => {
    setVerifyError(null);
    setVerifying(true);
    try {
      const res  = await fetch('/api/ua/verify-team', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: email.trim().toLowerCase(), upload_code: uploadCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
      setVerified(data);
    } catch (err) {
      setVerifyError(err.message || 'Verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const handleFile = useCallback(file => {
    setError(null);
    setParsed(null);
    setSubmitted(null);
    setSubmitError(null);
    setFileName(file.name);
    setLoading(true);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        setParsed(parseIexport(e.target.result));
      } catch (err) {
        setError(err.message || 'Failed to parse file.');
      } finally {
        setLoading(false);
      }
    };
    reader.onerror = () => { setError('Could not read file.'); setLoading(false); };
    reader.readAsText(file, 'utf-8');
  }, []);

  const handleReset = () => {
    setParsed(null);
    setError(null);
    setFileName(null);
    setSubmitted(null);
    setSubmitError(null);
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res  = await fetch('/api/ua/submit', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          email:       email.trim().toLowerCase(),
          upload_code: uploadCode,
          payload:     parsed,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
      setSubmitted(data);
    } catch (err) {
      setSubmitError(err.message || 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const boxScore  = parsed ? buildBoxScore(parsed)     : null;
  const pointRows = parsed ? buildPointSummary(parsed) : null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        height:        '100vh',
        overflow:      'hidden',
        display:       'flex',
        flexDirection: 'column',
        padding:       '24px 16px',
        boxSizing:     'border-box',
      }}
    >
      <div
        style={{
          maxWidth:       960,
          width:          '100%',
          margin:         '0 auto',
          flex:            1,
          minHeight:       0,
          display:        'flex',
          flexDirection:  'column',
          background:     'var(--card-bg)',
          borderRadius:    16,
          border:         '1px solid var(--card-border-clr)',
          boxShadow:      'var(--card-shadow)',
          backdropFilter: 'var(--card-backdrop)',
          overflow:       'hidden',
        }}
      >
        {/* ── Nav ── */}
        <nav
          style={{
            padding:        '18px 32px',
            borderBottom:   '1px solid var(--nav-border)',
            flexShrink:      0,
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'space-between',
          }}
        >
          <Link
            to="/"
            style={{
              fontFamily:    'var(--font-h2)',
              fontSize:       11,
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              color:         'var(--orange)',
              opacity:        0.6,
              textDecoration: 'none',
            }}
          >
            ← Ulti-Reference
          </Link>
        </nav>

        {/* ── Scrollable body ── */}
        <div
          className="orange-scroll"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '32px' }}
        >
          {/* Page header */}
          <div style={{ marginBottom: 28 }}>
            <div style={{ ...SECTION_HEAD, marginBottom: 4 }}>UltiAnalytics</div>
            <div
              style={{
                fontFamily:    'var(--font-h1)',
                fontSize:      'clamp(1.3rem, 2.5vw, 1.9rem)',
                fontWeight:     600,
                color:         'var(--t-primary)',
                letterSpacing: '-0.02em',
                textTransform: 'uppercase',
              }}
            >
              Submit Game
            </div>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--t-muted)', marginTop: 8, maxWidth: 540 }}>
              Upload a <strong style={{ color: 'var(--t-secondary)' }}>.iexport</strong> file
              exported from the UltiAnalytics app. Review the parsed box score, then submit for review.
            </p>
          </div>

          {/* ── Step 1: Team credentials ── */}
          {!verified ? (
            <div style={{ ...CARD, maxWidth: 440, marginBottom: 24 }}>
              <div style={SECTION_HEAD}>1 · Identify Your Team</div>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--t-muted)', marginBottom: 18, marginTop: 4 }}>
                Enter the email address and upload code registered for your team.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Field
                  label="Authorised Email"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  disabled={verifying}
                  placeholder="team@example.com"
                />
                <Field
                  label="Upload Code"
                  type="password"
                  value={uploadCode}
                  onChange={setUploadCode}
                  disabled={verifying}
                  placeholder="••••••••"
                />
              </div>
              <ErrorBanner msg={verifyError} />
              <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={handleVerify}
                  disabled={verifying || !email.trim() || !uploadCode.trim()}
                  style={{
                    background:    verifying ? 'var(--surf-bg)' : 'var(--orange)',
                    border:        '1px solid var(--orange-dark)',
                    borderRadius:   8,
                    padding:       '9px 28px',
                    cursor:         verifying ? 'default' : 'pointer',
                    fontFamily:    'var(--font-h2)',
                    fontSize:       11,
                    letterSpacing: '1.5px',
                    textTransform: 'uppercase',
                    color:          verifying ? 'var(--t-muted)' : '#fff',
                    opacity:        (!email.trim() || !uploadCode.trim()) ? 0.45 : 1,
                  }}
                >
                  {verifying ? 'Verifying…' : 'Verify Team →'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* ── Verified badge ── */}
              <div
                style={{
                  display:      'flex',
                  alignItems:   'center',
                  gap:           10,
                  marginBottom:  20,
                  padding:      '10px 16px',
                  borderRadius:  8,
                  background:   'rgba(34,197,94,0.06)',
                  border:       '1px solid rgba(34,197,94,0.2)',
                }}
              >
                <span style={{ color: '#22c55e', fontSize: 16 }}>✓</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '1px', color: '#22c55e' }}>
                    {verified.team_name}
                  </span>
                  {verified.division && (
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)', marginLeft: 8 }}>
                      · {verified.division}
                    </span>
                  )}
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)', marginLeft: 8 }}>
                    · {email}
                  </span>
                </div>
                <button
                  onClick={() => { setVerified(null); setUploadCode(''); handleReset(); }}
                  style={{
                    background:    'transparent',
                    border:        '1px solid var(--surf-border)',
                    borderRadius:   20,
                    padding:       '4px 12px',
                    cursor:        'pointer',
                    fontFamily:    'var(--font-h2)',
                    fontSize:       10,
                    letterSpacing: '0.5px',
                    color:         'var(--t-muted)',
                  }}
                >
                  Change
                </button>
              </div>

              {/* ── Step 2: Upload file ── */}
              {!parsed && (
                <div style={{ ...CARD, marginBottom: 24 }}>
                  <div style={SECTION_HEAD}>2 · Upload File</div>
                  <DropZone onFile={handleFile} disabled={loading} />
                  {loading && (
                    <div style={{ textAlign: 'center', marginTop: 16, color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
                      Parsing…
                    </div>
                  )}
                  <ErrorBanner msg={error} />
                </div>
              )}

              {/* ── Preview sections ── */}
              {parsed && (
                <>
                  {/* File chip + reset */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: 'var(--surf-bg)', border: '1px solid var(--surf-border)',
                      borderRadius: 20, padding: '5px 12px',
                      fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-secondary)',
                    }}>
                      <span style={{ color: 'var(--orange)' }}>●</span>
                      {fileName}
                    </div>
                    <button
                      onClick={handleReset}
                      style={{
                        background: 'transparent', border: '1px solid var(--surf-border)',
                        borderRadius: 20, padding: '5px 12px', cursor: 'pointer',
                        fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '0.5px',
                        color: 'var(--t-muted)',
                      }}
                    >
                      Change file
                    </button>
                  </div>

                  {/* Sections 3 + 4 side-by-side: 70 / 30 */}
                  <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'stretch' }}>
                    <div style={{ ...CARD, flex: '0 0 70%', minWidth: 0 }}>
                      <div style={SECTION_HEAD}>3 · Game Details</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px 32px', marginTop: 8 }}>
                        <MetaRow label="Your Team"   value={parsed.game.team_name} />
                        <MetaRow label="Opponent"    value={parsed.game.opponent}  />
                        <MetaRow label="Date"        value={parsed.game.date}      />
                        <MetaRow label="Time"        value={parsed.game.time}      />
                        <MetaRow label="Season"      value={parsed.game.season}    />
                        <MetaRow label="Tournament"  value={parsed.game.tournament || '—'} />
                        <MetaRow label="Game To"     value={parsed.game.game_point} />
                        <MetaRow label="First Point" value={parsed.game.first_point_oline ? 'O-Line' : 'D-Line'} />
                        {parsed.game.wind_mph > 0 && (
                          <MetaRow label="Wind" value={`${parsed.game.wind_mph} mph @ ${parsed.game.wind_degrees}°`} />
                        )}
                      </div>
                    </div>
                    <div style={{ ...CARD, flex: '1 1 0', minWidth: 0 }}>
                      <div style={SECTION_HEAD}>4 · Box Score</div>
                      <BoxScoreTable boxScore={boxScore} teamName={parsed.game.team_name} opponent={parsed.game.opponent} />
                    </div>
                  </div>

                  {/* Point-by-point */}
                  <div style={{ ...CARD, marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                      <div style={SECTION_HEAD}>5 · Point-by-Point</div>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)' }}>
                        {parsed.points.length} points
                      </span>
                    </div>
                    <PointsTable rows={pointRows} />
                  </div>

                  {/* Roster + stats */}
                  <div style={{ ...CARD, marginBottom: 28 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                      <div style={SECTION_HEAD}>6 · Roster &amp; Stats</div>
                      <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)' }}>
                        {parsed.roster.filter(p => !p.absent).length} active players
                        {parsed.roster.some(p => p.absent) && ` (${parsed.roster.filter(p => p.absent).length} absent)`}
                      </span>
                    </div>
                    <RosterTable roster={parsed.roster} />
                  </div>

                  {/* Submit / success */}
                  {submitted ? (
                    <div style={{
                      textAlign: 'center', padding: '18px 24px', borderRadius: 10,
                      background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)',
                      color: '#22c55e', fontFamily: 'var(--font-h2)', fontSize: 13, letterSpacing: '1px',
                    }}>
                      Submitted — thank you! Submission #{submitted.submission_id} is pending review.
                    </div>
                  ) : (
                    <>
                      <ErrorBanner msg={submitError} />
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: submitError ? 12 : 0 }}>
                        <button
                          onClick={handleSubmit}
                          disabled={submitting}
                          style={{
                            background:    submitting ? 'var(--surf-bg)' : 'var(--orange)',
                            border:        '1px solid var(--orange-dark)',
                            borderRadius:   8,
                            padding:       '11px 32px',
                            cursor:         submitting ? 'default' : 'pointer',
                            fontFamily:    'var(--font-h1)',
                            fontSize:       15,
                            fontWeight:     600,
                            letterSpacing: '1px',
                            textTransform: 'uppercase',
                            color:          submitting ? 'var(--t-muted)' : '#fff',
                          }}
                        >
                          {submitting ? 'Submitting…' : 'Submit Game ›'}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
