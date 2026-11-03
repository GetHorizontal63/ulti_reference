import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';

// ── Shared styles ─────────────────────────────────────────────────────────────

const INPUT_STYLE = {
  background:   'var(--input-bg)',
  border:       '1px solid var(--input-border)',
  borderRadius:  6,
  padding:      '7px 12px',
  color:        'var(--input-clr)',
  fontFamily:   'var(--font-body)',
  fontSize:      13,
  outline:      'none',
  width:        '100%',
  boxSizing:    'border-box',
};

const BTN = (variant = 'default') => ({
  background:    variant === 'primary' ? 'var(--orange)'
               : variant === 'danger'  ? 'rgba(239,68,68,0.15)'
               : 'var(--surf-bg)',
  border:        variant === 'primary' ? '1px solid var(--orange-dark)'
               : variant === 'danger'  ? '1px solid rgba(239,68,68,0.40)'
               : '1px solid var(--surf-border)',
  color:         variant === 'primary' ? '#fff'
               : variant === 'danger'  ? '#ef4444'
               : 'var(--t-secondary)',
  borderRadius:  6,
  padding:      '7px 16px',
  cursor:       'pointer',
  fontFamily:   'var(--font-h2)',
  fontSize:      11,
  letterSpacing: '1px',
  textTransform: 'uppercase',
  whiteSpace:   'nowrap',
});

const CARD = {
  background:   'var(--surf-bg)',
  border:       '1px solid var(--surf-border)',
  borderRadius:  10,
  padding:      '20px 22px',
  marginBottom:  16,
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

const LABEL = {
  fontFamily:    'var(--font-h2)',
  fontSize:      11,
  letterSpacing: '0.5px',
  color:         'var(--t-secondary)',
  marginBottom:   5,
};

// ── Auth helper ───────────────────────────────────────────────────────────────

const SESSION_KEY = 'ult_admin_token';

async function adminFetch(path, token, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'X-Admin-Token': token,
      'Content-Type':  'application/json',
      ...(opts.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.detail?.message ?? json?.detail ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

// ── Login screen ──────────────────────────────────────────────────────────────

function LoginScreen({ onAuth }) {
  const [token,   setToken]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const submit = async e => {
    e.preventDefault();
    if (!token.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await adminFetch('/api/admin/verify', token, { method: 'POST' });
      sessionStorage.setItem(SESSION_KEY, token);
      onAuth(token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 420, margin: '80px auto', padding: '0 24px' }}>
      <div style={{ ...CARD, padding: '32px 28px' }}>
        <div style={SECTION_HEAD}>Admin Access</div>
        <h2
          style={{
            fontFamily:    'var(--font-h1)',
            fontSize:      'clamp(1.2rem, 2vw, 1.7rem)',
            fontWeight:    600,
            color:         'var(--t-primary)',
            letterSpacing: '-0.02em',
            textTransform: 'uppercase',
            marginBottom:  24,
          }}
        >
          Data Admin
        </h2>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={LABEL}>Admin Token</div>
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              placeholder="Enter admin token…"
              style={INPUT_STYLE}
              autoFocus
            />
          </div>

          {error && (
            <div
              style={{
                fontFamily:   'var(--font-body)',
                fontSize:      12,
                color:        '#ef4444',
                padding:      '8px 12px',
                background:   'rgba(239,68,68,0.08)',
                border:       '1px solid rgba(239,68,68,0.25)',
                borderRadius:  6,
              }}
            >
              {error}
            </div>
          )}

          <button type="submit" style={BTN('primary')} disabled={loading}>
            {loading ? 'Verifying…' : 'Authenticate'}
          </button>
        </form>

        <div
          style={{
            marginTop:  20,
            fontFamily: 'var(--font-body)',
            fontSize:    10,
            color:      'var(--t-muted)',
            lineHeight:  1.5,
          }}
        >
          Access requires an authorized IP address and valid admin token.
          Run <code style={{ color: 'var(--orange)' }}>python backend/admin_setup.py</code> to configure.
        </div>
      </div>
    </div>
  );
}

// ── Sync tab ──────────────────────────────────────────────────────────────────

function SyncTab({ token }) {
  const [state,   setState]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [args,    setArgs]    = useState({ '--run': true });
  const consoleRef = useRef(null);

  const ARG_OPTS = [
    { flag: '--run',       label: 'Run sync' },
    { flag: '--force',     label: 'Force rescrape' },
    { flag: '--ufa-only',  label: 'UFA only' },
    { flag: '--pul-only',  label: 'PUL only' },
    { flag: '--wul-only',  label: 'WUL only' },
    { flag: '--usau-only', label: 'USAU only' },
  ];

  const poll = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/sync/status', token);
      setState(s);
    } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { poll(); }, [poll]);

  useEffect(() => {
    if (state?.running) {
      const id = setInterval(poll, 2_000);
      return () => clearInterval(id);
    }
  }, [state?.running, poll]);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [state?.output]);

  const runSync = async () => {
    const selectedArgs = Object.entries(args)
      .filter(([, v]) => v)
      .map(([k]) => k);
    setLoading(true);
    try {
      await adminFetch('/api/admin/sync/run', token, {
        method: 'POST',
        body:   JSON.stringify({ args: selectedArgs }),
      });
      setTimeout(poll, 500);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const running = state?.running ?? false;

  return (
    <div>
      <div style={CARD}>
        <div style={SECTION_HEAD}>Arguments</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          {ARG_OPTS.map(({ flag, label }) => (
            <label
              key={flag}
              style={{
                display:    'flex',
                alignItems: 'center',
                gap:         6,
                cursor:     'pointer',
                fontFamily: 'var(--font-body)',
                fontSize:    12,
                color:      'var(--t-secondary)',
              }}
            >
              <input
                type="checkbox"
                checked={!!args[flag]}
                onChange={e => setArgs(prev => ({ ...prev, [flag]: e.target.checked }))}
                style={{ accentColor: 'var(--orange)' }}
              />
              {label}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={runSync}
            disabled={running || loading}
            style={BTN('primary')}
          >
            {running ? '⏳ Running…' : 'Run Sync'}
          </button>
          <button onClick={poll} style={BTN()}>Refresh Status</button>
          {state?.exit_code != null && (
            <span
              style={{
                fontFamily: 'var(--font-body)',
                fontSize:    12,
                color:      state.exit_code === 0 ? '#22c55e' : '#ef4444',
              }}
            >
              Exit {state.exit_code}
            </span>
          )}
          {state?.finished_at && (
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>
              Finished {new Date(state.finished_at).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {/* Console output */}
      <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding:       '10px 16px',
            borderBottom:  '1px solid var(--surf-border)',
            fontFamily:    'var(--font-h2)',
            fontSize:       10,
            letterSpacing: '1px',
            textTransform: 'uppercase',
            color:         'var(--t-muted)',
          }}
        >
          Output {state?.started_at && `— started ${new Date(state.started_at).toLocaleTimeString()}`}
        </div>
        <div
          ref={consoleRef}
          style={{
            height:     320,
            overflowY:  'auto',
            padding:    '12px 16px',
            fontFamily: '"Cascadia Code", "Consolas", monospace',
            fontSize:    11,
            color:      'var(--mono-clr)',
            lineHeight:  1.6,
            whiteSpace: 'pre-wrap',
            wordBreak:  'break-all',
          }}
        >
          {(state?.output ?? []).join('\n') || (running ? 'Starting…' : 'No output yet. Run sync to begin.')}
        </div>
      </div>
    </div>
  );
}

// ── Logs tab ──────────────────────────────────────────────────────────────────

function LogsTab({ token }) {
  const [logs,    setLogs]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [league,  setLeague]  = useState('');

  const fetch_ = async () => {
    setLoading(true);
    try {
      const qs  = league ? `?league=${league}&limit=300` : '?limit=300';
      const res = await adminFetch(`/api/admin/logs${qs}`, token);
      setLogs(res.logs);
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch_(); }, [league]);

  const STATUS_CLR = { success: '#22c55e', error: '#ef4444', empty: '#f59e0b', skipped: '#6b7280' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <select
          value={league}
          onChange={e => setLeague(e.target.value)}
          style={{ ...INPUT_STYLE, width: 160 }}
        >
          <option value="">All leagues</option>
          <option value="ufa">UFA</option>
          <option value="wul">WUL</option>
          <option value="pul">PUL</option>
        </select>
        <button onClick={fetch_} style={BTN()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        {logs && <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>{logs.length} entries</span>}
      </div>

      {logs && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                {['League', 'Year', 'Type', 'Status', 'Detail', 'Scraped At'].map(h => (
                  <th
                    key={h}
                    style={{
                      textAlign:     'left',
                      padding:       '6px 10px',
                      color:         'var(--t-muted)',
                      fontFamily:    'var(--font-h2)',
                      fontSize:       9,
                      letterSpacing: '1.5px',
                      textTransform: 'uppercase',
                      whiteSpace:    'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((r, i) => (
                <tr
                  key={i}
                  style={{ borderBottom: '1px solid var(--surf-divider)', background: i % 2 ? 'var(--surf-bg-2)' : 'transparent' }}
                >
                  <td style={{ padding: '5px 10px', color: 'var(--t-secondary)', textTransform: 'uppercase', fontSize: 11 }}>{r.league}</td>
                  <td style={{ padding: '5px 10px', color: 'var(--t-secondary)' }}>{r.year ?? '—'}</td>
                  <td style={{ padding: '5px 10px', color: 'var(--t-muted)' }}>{r.data_type ?? '—'}</td>
                  <td style={{ padding: '5px 10px' }}>
                    <span style={{ color: STATUS_CLR[r.status] ?? 'var(--t-muted)', fontWeight: 500 }}>{r.status}</span>
                  </td>
                  <td style={{ padding: '5px 10px', color: 'var(--t-muted)', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.detail}>{r.detail ?? '—'}</td>
                  <td style={{ padding: '5px 10px', color: 'var(--t-muted)', whiteSpace: 'nowrap' }}>
                    {r.scraped_at ? new Date(r.scraped_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>
              No log entries found.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Whitelist tab ─────────────────────────────────────────────────────────────

function WhitelistTab({ token }) {
  const [wl,       setWl]       = useState(null);
  const [newIP,    setNewIP]    = useState('');
  const [newCIDR,  setNewCIDR]  = useState('');
  const [loading,  setLoading]  = useState(false);
  const [cidrLoad, setCidrLoad] = useState(false);

  const TAILSCALE_CIDR = '100.64.0.0/10';

  const load = async () => {
    try {
      const res = await adminFetch('/api/admin/whitelist', token);
      setWl(res);
    } catch (err) { alert(err.message); }
  };

  useEffect(() => { load(); }, []);

  const addIP = async e => {
    e.preventDefault();
    if (!newIP.trim()) return;
    setLoading(true);
    try {
      await adminFetch('/api/admin/whitelist', token, {
        method: 'POST',
        body:   JSON.stringify({ ip: newIP.trim() }),
      });
      setNewIP('');
      await load();
    } catch (err) { alert(err.message); }
    finally { setLoading(false); }
  };

  const removeHash = async hash => {
    if (!confirm(`Remove hash ${hash.slice(0, 16)}…?`)) return;
    try {
      await adminFetch(`/api/admin/whitelist/${hash}`, token, { method: 'DELETE' });
      await load();
    } catch (err) { alert(err.message); }
  };

  const addCIDR = async (cidr) => {
    const c = (cidr ?? newCIDR).trim();
    if (!c) return;
    setCidrLoad(true);
    try {
      await adminFetch('/api/admin/whitelist/cidr', token, {
        method: 'POST',
        body:   JSON.stringify({ cidr: c }),
      });
      setNewCIDR('');
      await load();
    } catch (err) { alert(err.message); }
    finally { setCidrLoad(false); }
  };

  const removeCIDR = async cidr => {
    if (!confirm(`Remove CIDR ${cidr}?`)) return;
    try {
      await adminFetch(`/api/admin/whitelist/cidr?cidr=${encodeURIComponent(cidr)}`, token, { method: 'DELETE' });
      await load();
    } catch (err) { alert(err.message); }
  };

  const callerIsTailscale = wl?.caller_is_tailscale;
  const tailscaleAlready  = wl?.allowed_cidrs?.includes(TAILSCALE_CIDR);

  return (
    <div>
      {/* Caller info */}
      {wl && (
        <div
          style={{
            ...CARD,
            display:    'flex',
            alignItems: 'center',
            gap:        14,
            padding:    '12px 18px',
          }}
        >
          <span
            style={{
              width:        8,
              height:       8,
              borderRadius: '50%',
              background:   callerIsTailscale ? '#22c55e' : '#f59e0b',
              flexShrink:   0,
            }}
          />
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-secondary)' }}>
            Your IP: <code style={{ fontFamily: '"Cascadia Code","Consolas",monospace', color: 'var(--mono-clr)' }}>{wl.caller_ip}</code>
            {callerIsTailscale
              ? <span style={{ marginLeft: 10, color: '#22c55e' }}>✓ Tailscale</span>
              : <span style={{ marginLeft: 10, color: 'var(--t-muted)' }}>not Tailscale</span>
            }
          </span>
        </div>
      )}

      {/* CIDR ranges */}
      <div style={CARD}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={SECTION_HEAD}>Allowed CIDR Ranges</div>
          <button onClick={load} style={BTN()}>Refresh</button>
        </div>

        {/* Quick-add Tailscale */}
        {!tailscaleAlready && (
          <button
            onClick={() => addCIDR(TAILSCALE_CIDR)}
            disabled={cidrLoad}
            style={{ ...BTN('primary'), marginBottom: 14 }}
          >
            + Allow All Tailscale IPs (100.64.0.0/10)
          </button>
        )}

        {(wl?.allowed_cidrs ?? []).map(cidr => (
          <div
            key={cidr}
            style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'space-between',
              padding:        '8px 12px',
              background:     'var(--surf-bg-2)',
              borderRadius:    6,
              marginBottom:    6,
              gap:             12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <code style={{ fontFamily: '"Cascadia Code","Consolas",monospace', fontSize: 12, color: 'var(--mono-clr)' }}>
                {cidr}
              </code>
              {cidr === TAILSCALE_CIDR && (
                <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#22c55e', opacity: 0.9 }}>
                  Tailscale
                </span>
              )}
            </div>
            <button onClick={() => removeCIDR(cidr)} style={{ ...BTN('danger'), padding: '4px 10px', fontSize: 10 }}>
              Remove
            </button>
          </div>
        ))}

        {(wl?.allowed_cidrs ?? []).length === 0 && (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)', marginBottom: 10 }}>
            No CIDR ranges configured.
          </div>
        )}

        {/* Custom CIDR input */}
        <form
          onSubmit={e => { e.preventDefault(); addCIDR(); }}
          style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 12 }}
        >
          <div style={{ flex: 1 }}>
            <div style={LABEL}>Custom CIDR</div>
            <input
              type="text"
              value={newCIDR}
              onChange={e => setNewCIDR(e.target.value)}
              placeholder="e.g. 100.100.0.0/24"
              style={INPUT_STYLE}
            />
          </div>
          <button type="submit" style={BTN()} disabled={cidrLoad}>
            {cidrLoad ? 'Adding…' : 'Add CIDR'}
          </button>
        </form>
      </div>

      {/* Individual IP hashes */}
      <div style={CARD}>
        <div style={SECTION_HEAD}>Specific IP Hashes</div>
        <form onSubmit={addIP} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={LABEL}>IP Address (plain text — hashed server-side)</div>
            <input
              type="text"
              value={newIP}
              onChange={e => setNewIP(e.target.value)}
              placeholder="e.g. 100.x.y.z"
              style={INPUT_STYLE}
            />
          </div>
          <button type="submit" style={BTN('primary')} disabled={loading}>
            {loading ? 'Adding…' : 'Add'}
          </button>
        </form>

        {(wl?.ip_hashes ?? []).length === 0 && (
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)' }}>
            No individual IPs — use CIDR ranges above for Tailscale access.
          </div>
        )}

        {(wl?.ip_hashes ?? []).map(h => (
          <div
            key={h}
            style={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'space-between',
              padding:        '8px 12px',
              background:     'var(--surf-bg-2)',
              borderRadius:    6,
              marginBottom:    6,
              gap:             12,
            }}
          >
            <code style={{ fontFamily: '"Cascadia Code","Consolas",monospace', fontSize: 11, color: 'var(--mono-clr)', wordBreak: 'break-all' }}>
              {h}
            </code>
            <button onClick={() => removeHash(h)} style={{ ...BTN('danger'), padding: '4px 10px', fontSize: 10 }}>
              Remove
            </button>
          </div>
        ))}

        <div style={{ marginTop: 12, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>
          Token configured: {wl?.token_hash_set ? '✓ Yes' : '✗ No — run backend/admin_setup.py'}
        </div>
      </div>
    </div>
  );
}


// ── Validate tab ──────────────────────────────────────────────────────────────

function ValidateTab({ token }) {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/api/admin/validate', token);
      setResults(res);
    } catch (err) { alert(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { run(); }, []);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={run} style={BTN('primary')} disabled={loading}>
          {loading ? 'Running…' : 'Run Validation'}
        </button>
        {results?.checked_at && (
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>
            Checked {new Date(results.checked_at).toLocaleTimeString()}
          </span>
        )}
      </div>

      {results?.checks && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.checks.map((c, i) => (
            <div
              key={i}
              style={{
                display:      'flex',
                alignItems:   'center',
                gap:          14,
                padding:      '10px 16px',
                background:   'var(--surf-bg)',
                border:       '1px solid var(--surf-border)',
                borderRadius:  8,
              }}
            >
              <span
                style={{
                  width:       10,
                  height:      10,
                  borderRadius: '50%',
                  background:  c.error ? '#6b7280' : c.ok === true ? '#22c55e' : c.ok === false ? '#ef4444' : '#f59e0b',
                  flexShrink:  0,
                }}
              />
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-secondary)', flex: 1 }}>
                {c.check}
              </span>
              {c.error ? (
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: '#6b7280' }}>{c.error}</span>
              ) : (
                <span
                  style={{
                    fontFamily: 'var(--font-h2)',
                    fontSize:    12,
                    fontWeight:  600,
                    color:      c.ok === true ? '#22c55e' : c.ok === false ? '#ef4444' : 'var(--t-secondary)',
                    minWidth:    40,
                    textAlign:  'right',
                  }}
                >
                  {c.count?.toLocaleString() ?? '—'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Rescrape tab ──────────────────────────────────────────────────────────────

function RescrapeTab({ token }) {
  const [league,  setLeague]  = useState('ufa');
  const [seasons, setSeasons] = useState('');
  const [force,   setForce]   = useState(true);
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);

  const run = async e => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await adminFetch('/api/admin/rescrape', token, {
        method: 'POST',
        body:   JSON.stringify({
          league,
          seasons: seasons.split(',').map(s => parseInt(s.trim())).filter(Boolean),
          force,
        }),
      });
      setResult({ ok: true, msg: 'Rescrape started. Check the Sync tab for live output.' });
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={CARD}>
        <div style={SECTION_HEAD}>Force Rescrape</div>
        <form onSubmit={run} style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 460 }}>
          <div>
            <div style={LABEL}>League</div>
            <select value={league} onChange={e => setLeague(e.target.value)} style={{ ...INPUT_STYLE }}>
              <option value="ufa">UFA</option>
              <option value="pul">PUL</option>
              <option value="wul">WUL</option>
              <option value="usau">USAU</option>
            </select>
          </div>

          <div>
            <div style={LABEL}>Seasons (comma-separated years, optional)</div>
            <input
              type="text"
              value={seasons}
              onChange={e => setSeasons(e.target.value)}
              placeholder="e.g. 2024, 2025"
              style={INPUT_STYLE}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-secondary)' }}>
            <input
              type="checkbox"
              checked={force}
              onChange={e => setForce(e.target.checked)}
              style={{ accentColor: 'var(--orange)' }}
            />
            Force rescrape (ignore cached data)
          </label>

          <button type="submit" style={BTN('primary')} disabled={loading}>
            {loading ? 'Starting…' : 'Start Rescrape'}
          </button>
        </form>

        {result && (
          <div
            style={{
              marginTop:    16,
              fontFamily:   'var(--font-body)',
              fontSize:      12,
              padding:      '10px 14px',
              borderRadius:  6,
              background:   result.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
              border:       `1px solid ${result.ok ? 'rgba(34,197,94,0.30)' : 'rgba(239,68,68,0.30)'}`,
              color:        result.ok ? '#22c55e' : '#ef4444',
            }}
          >
            {result.msg}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Browse tab ────────────────────────────────────────────────────────────────

function BrowseTab({ token }) {
  const [tables,    setTables]    = useState(null);
  const [selected,  setSelected]  = useState('');
  const [tableData, setTableData] = useState(null);
  const [page,      setPage]      = useState(0);
  const [loading,   setLoading]   = useState(false);
  const [editCell,  setEditCell]  = useState(null); // { rowid, col, value }
  const [editVal,   setEditVal]   = useState('');

  useEffect(() => {
    adminFetch('/api/admin/tables', token).then(res => setTables(res.tables)).catch(err => alert(err.message));
  }, [token]);

  const loadTable = async (name, pg = 0) => {
    if (!name) return;
    setLoading(true);
    try {
      const res = await adminFetch(`/api/admin/table/${encodeURIComponent(name)}?page=${pg}&page_size=50`, token);
      setTableData(res);
      setPage(pg);
    } catch (err) { alert(err.message); }
    finally { setLoading(false); }
  };

  const onTableChange = name => {
    setSelected(name);
    setTableData(null);
    setPage(0);
    setEditCell(null);
    if (name) loadTable(name, 0);
  };

  const saveEdit = async () => {
    if (!editCell) return;
    try {
      await adminFetch(
        `/api/admin/table/${encodeURIComponent(selected)}/${editCell.rowid}`,
        token,
        { method: 'PATCH', body: JSON.stringify({ updates: { [editCell.col]: editVal } }) },
      );
      setEditCell(null);
      await loadTable(selected, page);
    } catch (err) { alert(err.message); }
  };

  const totalPages = tableData ? Math.ceil(tableData.total / 50) : 0;

  return (
    <div>
      {/* Table selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <select
          value={selected}
          onChange={e => onTableChange(e.target.value)}
          style={{ ...INPUT_STYLE, width: 260 }}
        >
          <option value="">— Select a table —</option>
          {(tables ?? []).map(t => (
            <option key={t.name} value={t.name}>
              {t.name} ({t.row_count.toLocaleString()} rows)
            </option>
          ))}
        </select>
        {selected && <button onClick={() => loadTable(selected, page)} style={BTN()} disabled={loading}>Refresh</button>}
      </div>

      {loading && <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--t-muted)' }}>Loading…</div>}

      {tableData && (
        <>
          {/* Pagination */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <button onClick={() => loadTable(selected, Math.max(0, page - 1))} disabled={page === 0} style={BTN()}>← Prev</button>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)' }}>
              Page {page + 1} / {totalPages} ({tableData.total.toLocaleString()} rows)
            </span>
            <button onClick={() => loadTable(selected, Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={BTN()}>Next →</button>
          </div>

          {/* Edit bar */}
          {editCell && (
            <div
              style={{
                display:      'flex',
                alignItems:   'center',
                gap:          10,
                marginBottom:  12,
                padding:      '10px 14px',
                background:   'rgba(234,96,32,0.08)',
                border:       '1px solid rgba(234,96,32,0.25)',
                borderRadius:  8,
              }}
            >
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-secondary)' }}>
                Editing <strong>{editCell.col}</strong> on row {editCell.rowid}:
              </span>
              <input
                value={editVal}
                onChange={e => setEditVal(e.target.value)}
                style={{ ...INPUT_STYLE, width: 240 }}
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditCell(null); }}
              />
              <button onClick={saveEdit} style={BTN('primary')}>Save</button>
              <button onClick={() => setEditCell(null)} style={BTN()}>Cancel</button>
            </div>
          )}

          {/* Table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-body)', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                  {tableData.columns.map(col => (
                    <th
                      key={col}
                      style={{
                        textAlign:     'left',
                        padding:       '6px 10px',
                        color:         'var(--t-muted)',
                        fontFamily:    'var(--font-h2)',
                        fontSize:       9,
                        letterSpacing: '1.5px',
                        textTransform: 'uppercase',
                        whiteSpace:    'nowrap',
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableData.rows.map((row, i) => (
                  <tr
                    key={row._rowid ?? i}
                    style={{ borderBottom: '1px solid var(--surf-divider)', background: i % 2 ? 'var(--surf-bg-2)' : 'transparent' }}
                  >
                    {tableData.columns.map(col => {
                      const val     = row[col];
                      const isEditing = editCell?.rowid === row._rowid && editCell?.col === col;
                      return (
                        <td
                          key={col}
                          title={val != null ? String(val) : ''}
                          style={{
                            padding:       '5px 10px',
                            color:         'var(--t-secondary)',
                            maxWidth:       180,
                            overflow:      'hidden',
                            textOverflow:  'ellipsis',
                            whiteSpace:    'nowrap',
                            cursor:        col === '_rowid' ? 'default' : 'pointer',
                            background:    isEditing ? 'rgba(234,96,32,0.12)' : undefined,
                          }}
                          onClick={() => {
                            if (col === '_rowid') return;
                            setEditCell({ rowid: row._rowid, col });
                            setEditVal(val != null ? String(val) : '');
                          }}
                        >
                          {val != null ? String(val) : <span style={{ color: 'var(--t-muted)', fontStyle: 'italic' }}>null</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tags autocomplete input ───────────────────────────────────────────────────

function TagsInput({ value, onChange, allTags }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  const parts   = value.split(',');
  const partial = parts[parts.length - 1].trimStart().toLowerCase();
  const used    = new Set(parts.slice(0, -1).map(p => p.trim().toLowerCase()));

  const suggestions = allTags
    .filter(t => partial.length > 0 && t.toLowerCase().includes(partial) && !used.has(t.toLowerCase()))
    .slice(0, 8);

  const pickTag = tag => {
    const prefix = parts.slice(0, -1).map(p => p.trim()).filter(Boolean).join(', ');
    onChange(prefix ? `${prefix}, ${tag}, ` : `${tag}, `);
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        placeholder="UFA, Strategy, Analytics…"
        style={INPUT_STYLE}
      />
      {open && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 2px)', left: 0, right: 0, zIndex: 200,
          background: 'var(--surf-bg)', border: '1px solid var(--surf-border)',
          borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          maxHeight: 180, overflowY: 'auto',
        }}>
          {suggestions.map(tag => (
            <button
              key={tag}
              type="button"
              onMouseDown={() => pickTag(tag)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '7px 12px', border: 'none', background: 'none',
                cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12,
                color: 'var(--t-secondary)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(234,96,32,0.10)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Blog tab ──────────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  post_id: '', title: '', subtitle: '', author: '',
  category: '', tags: '', cover_image_url: '',
  summary: '', body: '', featured: 0, published: 0, published_at: '',
};

function _slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function _isoToLocal(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  } catch { return ''; }
}

function BlogTab({ token }) {
  const [posts,    setPosts]    = useState(null);
  const [allTags,  setAllTags]  = useState([]);
  const [editing,  setEditing]  = useState(null);   // null | 'new' | post_id
  const [form,     setForm]     = useState(EMPTY_FORM);
  const [autoSlug, setAutoSlug] = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [msg,      setMsg]      = useState(null);   // { ok, text }

  const loadPosts = useCallback(async () => {
    try { setPosts(await adminFetch('/api/admin/blog', token)); }
    catch (err) { alert(err.message); }
  }, [token]);

  const loadTags = useCallback(async () => {
    try { setAllTags(await adminFetch('/api/admin/blog/tags', token)); } catch { /* ignore */ }
  }, [token]);

  useEffect(() => { loadPosts(); loadTags(); }, [loadPosts, loadTags]);

  // Auto-fill slug while title changes (new mode only)
  useEffect(() => {
    if (editing === 'new' && autoSlug) {
      setForm(f => ({ ...f, post_id: _slugify(f.title) }));
    }
  }, [form.title, editing, autoSlug]);

  const F = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const startNew = () => {
    setEditing('new');
    setForm(EMPTY_FORM);
    setAutoSlug(true);
    setMsg(null);
  };

  const startEdit = async postId => {
    try {
      const p = await adminFetch(`/api/admin/blog/${postId}`, token);
      setEditing(postId);
      setForm({
        post_id:         p.post_id         ?? '',
        title:           p.title           ?? '',
        subtitle:        p.subtitle        ?? '',
        author:          p.author          ?? '',
        category:        p.category        ?? '',
        tags:            p.tags            ?? '',
        cover_image_url: p.cover_image_url ?? '',
        summary:         p.summary         ?? '',
        body:            p.body            ?? '',
        featured:        p.featured        ? 1 : 0,
        published:       p.published       ? 1 : 0,
        published_at:    _isoToLocal(p.published_at),
      });
      setAutoSlug(false);
      setMsg(null);
    } catch (err) { alert(err.message); }
  };

  const cancel = () => { setEditing(null); setMsg(null); };

  const save = async () => {
    if (!form.title.trim()) { setMsg({ ok: false, text: 'Title is required' }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const pub_at  = form.published_at ? new Date(form.published_at).toISOString() : null;
      const payload = { ...form, published_at: pub_at };
      if (editing === 'new') {
        const res = await adminFetch('/api/admin/blog', token, {
          method: 'POST',
          body:   JSON.stringify(payload),
        });
        setMsg({ ok: true, text: `Created: ${res.post_id}` });
        setEditing(res.post_id);
        setAutoSlug(false);
      } else {
        await adminFetch(`/api/admin/blog/${editing}`, token, {
          method: 'PUT',
          body:   JSON.stringify(payload),
        });
        setMsg({ ok: true, text: 'Saved successfully' });
      }
      await loadPosts();
      await loadTags();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const del = async postId => {
    if (!confirm(`Delete "${postId}"? This cannot be undone.`)) return;
    try {
      await adminFetch(`/api/admin/blog/${postId}`, token, { method: 'DELETE' });
      if (editing === postId) cancel();
      await loadPosts();
    } catch (err) { alert(err.message); }
  };

  const ROW = { display: 'flex', gap: 12, marginBottom: 12 };
  const COL = { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 };

  return (
    <div style={{ display: 'flex', gap: 0, margin: '-24px -28px', height: 'calc(100vh - 195px)', overflow: 'hidden' }}>

      {/* ── Post list ── */}
      <div className="orange-scroll" style={{ width: 248, flexShrink: 0, borderRight: '1px solid var(--surf-border)', overflowY: 'auto', display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '12px', borderBottom: '1px solid var(--surf-border)', flexShrink: 0 }}>
          <button onClick={startNew} style={{ ...BTN('primary'), width: '100%', textAlign: 'center' }}>
            + New Post
          </button>
        </div>

        {posts === null
          ? <div style={{ padding: '16px 12px', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)' }}>Loading…</div>
          : posts.length === 0
          ? <div style={{ padding: '16px 12px', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)' }}>No posts yet.</div>
          : posts.map(p => {
              const isActive = editing === p.post_id;
              return (
                <div
                  key={p.post_id}
                  onClick={() => startEdit(p.post_id)}
                  style={{
                    padding: '10px 12px', cursor: 'pointer',
                    borderBottom: '1px solid var(--surf-divider)',
                    borderLeft: `3px solid ${isActive ? 'var(--orange)' : 'transparent'}`,
                    background: isActive ? 'rgba(234,96,32,0.08)' : 'transparent',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--surf-bg-2)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 4 }}>
                    <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: isActive ? 'var(--orange)' : 'var(--t-primary)', fontWeight: 600, lineHeight: 1.3, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.title || '(untitled)'}
                    </div>
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); del(p.post_id); }}
                      style={{ ...BTN('danger'), padding: '1px 6px', fontSize: 9, flexShrink: 0, lineHeight: '14px' }}
                    >×</button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <span style={{
                      fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1px', textTransform: 'uppercase',
                      padding: '1px 5px', borderRadius: 3,
                      background: p.published ? 'rgba(34,197,94,0.15)' : 'rgba(234,96,32,0.12)',
                      color: p.published ? '#22c55e' : 'var(--orange)',
                    }}>
                      {p.published ? 'published' : 'draft'}
                    </span>
                    {p.category && (
                      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 8, color: 'var(--t-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.category}
                      </span>
                    )}
                  </div>
                  {p.published_at && (
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--t-muted)', marginTop: 2 }}>
                      {new Date(p.published_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
              );
            })
        }
      </div>

      {/* ── Editor ── */}
      <div className="orange-scroll" style={{ flex: 1, overflowY: 'auto', height: '100%', padding: '18px 24px 36px' }}>
        {editing === null ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>
              Select a post or create a new one
            </div>
            <button onClick={startNew} style={BTN('primary')}>+ New Post</button>
          </div>
        ) : (
          <div style={{ maxWidth: 840 }}>

            {/* Editor header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={SECTION_HEAD}>{editing === 'new' ? 'New Post' : `Editing: ${editing}`}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={save} style={BTN('primary')} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                <button onClick={cancel} style={BTN()}>Cancel</button>
                {editing !== 'new' && (
                  <button onClick={() => del(editing)} style={BTN('danger')}>Delete</button>
                )}
              </div>
            </div>

            {msg && (
              <div style={{
                marginBottom: 16, padding: '8px 14px', borderRadius: 6,
                fontFamily: 'var(--font-body)', fontSize: 12,
                background: msg.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                border:     `1px solid ${msg.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                color:      msg.ok ? '#22c55e' : '#ef4444',
              }}>{msg.text}</div>
            )}

            {/* Row 1: slug + title */}
            <div style={ROW}>
              <div style={{ ...COL, flex: '0 0 220px' }}>
                <div style={LABEL}>Post ID / Slug</div>
                <input
                  value={form.post_id}
                  onChange={e => { F('post_id', e.target.value); setAutoSlug(false); }}
                  placeholder="my-post-slug"
                  style={{ ...INPUT_STYLE, fontFamily: '"Cascadia Code","Consolas",monospace', fontSize: 12 }}
                />
              </div>
              <div style={{ ...COL, flex: 2 }}>
                <div style={LABEL}>Title *</div>
                <input
                  value={form.title}
                  onChange={e => F('title', e.target.value)}
                  placeholder="Post title"
                  style={INPUT_STYLE}
                  autoFocus={editing === 'new'}
                />
              </div>
            </div>

            {/* Row 2: author + category + subtitle */}
            <div style={ROW}>
              <div style={COL}>
                <div style={LABEL}>Author</div>
                <input value={form.author} onChange={e => F('author', e.target.value)} placeholder="Author name" style={INPUT_STYLE} />
              </div>
              <div style={COL}>
                <div style={LABEL}>Category</div>
                <input value={form.category} onChange={e => F('category', e.target.value)} placeholder="e.g. Strategy" style={INPUT_STYLE} />
              </div>
              <div style={{ ...COL, flex: 2 }}>
                <div style={LABEL}>Subtitle</div>
                <input value={form.subtitle} onChange={e => F('subtitle', e.target.value)} placeholder="Short subtitle or teaser" style={INPUT_STYLE} />
              </div>
            </div>

            {/* Row 3: cover image */}
            <div style={{ marginBottom: 12 }}>
              <div style={LABEL}>Cover Image URL</div>
              <input
                value={form.cover_image_url}
                onChange={e => F('cover_image_url', e.target.value)}
                placeholder="https://example.com/image.jpg"
                style={INPUT_STYLE}
              />
            </div>

            {/* Row 4: tags */}
            <div style={{ marginBottom: 12 }}>
              <div style={LABEL}>Tags (comma-separated)</div>
              <TagsInput value={form.tags} onChange={v => F('tags', v)} allTags={allTags} />
            </div>

            {/* Row 5: summary */}
            <div style={{ marginBottom: 12 }}>
              <div style={LABEL}>Summary</div>
              <textarea
                value={form.summary}
                onChange={e => F('summary', e.target.value)}
                placeholder="Short description shown in post lists and link previews…"
                rows={3}
                style={{ ...INPUT_STYLE, resize: 'vertical', lineHeight: 1.5 }}
              />
            </div>

            {/* Row 6: body */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                <div style={LABEL}>Body</div>
                <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, color: 'var(--t-muted)' }}>
                  {form.body.length.toLocaleString()} chars
                </span>
              </div>
              <textarea
                value={form.body}
                onChange={e => F('body', e.target.value)}
                placeholder="Full post body (HTML or Markdown)…"
                rows={22}
                style={{ ...INPUT_STYLE, resize: 'vertical', lineHeight: 1.65, fontFamily: '"Cascadia Code","Consolas",monospace', fontSize: 12 }}
              />
            </div>

            {/* Row 7: featured + published + date */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 18, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-secondary)' }}>
                <input type="checkbox" checked={!!form.featured} onChange={e => F('featured', e.target.checked ? 1 : 0)} style={{ accentColor: 'var(--orange)' }} />
                Featured
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-secondary)' }}>
                <input type="checkbox" checked={!!form.published} onChange={e => F('published', e.target.checked ? 1 : 0)} style={{ accentColor: 'var(--orange)' }} />
                Published
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ ...LABEL, marginBottom: 0 }}>Published At</div>
                <input
                  type="datetime-local"
                  value={form.published_at}
                  onChange={e => F('published_at', e.target.value)}
                  style={{ ...INPUT_STYLE, width: 200 }}
                />
              </div>
            </div>

            {/* Bottom action bar */}
            <div style={{ display: 'flex', gap: 10, borderTop: '1px solid var(--surf-border)', paddingTop: 16 }}>
              <button onClick={save} style={BTN('primary')} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button onClick={cancel} style={BTN()}>Cancel</button>
              {editing !== 'new' && (
                <button onClick={() => del(editing)} style={BTN('danger')}>Delete Post</button>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

// ── Roadmap / Checklist tab ───────────────────────────────────────────────────

const ROADMAP_KEY = 'ult_roadmap_v1';

const SEED_SECTIONS = [
  {
    id: 'infrastructure', label: 'Core Infrastructure',
    items: [
      { id: 'infra-01', label: 'Docker & Docker Compose configuration' },
      { id: 'infra-02', label: 'Nginx reverse proxy config' },
      { id: 'infra-03', label: 'SQLite database with WAL mode' },
      { id: 'infra-04', label: 'Cloudflare tunnel / domain setup' },
      { id: 'infra-05', label: 'Environment variables & secrets management' },
      { id: 'infra-06', label: 'Python virtual environment & dependencies' },
      { id: 'infra-07', label: 'Health check endpoint (/api/health)' },
      { id: 'infra-08', label: 'CORS configuration (dev + prod origins)' },
      { id: 'infra-09', label: 'WAL lock fix for concurrent SQLite access' },
    ],
  },
  {
    id: 'backend', label: 'Backend API',
    items: [
      { id: 'api-01', label: 'FastAPI app scaffold & startup hooks' },
      { id: 'api-02', label: 'Auth system — JWT + subscription tiers' },
      { id: 'api-03', label: 'Stripe billing (checkout, portal, webhook)' },
      { id: 'api-04', label: 'Admin routes (IP whitelist, token auth)' },
      { id: 'api-05', label: 'Blog CRUD routes (GET / POST / PUT / DELETE)' },
      { id: 'api-06', label: 'Status & scrape-log routes' },
      { id: 'api-07', label: 'UltiAnalytics upload & submission routes' },
      { id: 'api-08', label: 'Data validation endpoint (/api/admin/validate)' },
      { id: 'api-09', label: 'DB browser & inline PATCH endpoint' },
      { id: 'api-10', label: 'Force rescrape endpoint' },
      { id: 'api-11', label: 'UFA teams, standings, schedule proxy' },
      { id: 'api-12', label: 'UFA player search & profile endpoints' },
      { id: 'api-13', label: 'UFA franchise records endpoint' },
      { id: 'api-14', label: 'Win probability & field value grid endpoints' },
    ],
  },
  {
    id: 'pipelines', label: 'Data Pipelines',
    items: [
      { id: 'pipe-01', label: 'UFA data pipeline (scraper + loader)' },
      { id: 'pipe-02', label: 'WUL data pipeline' },
      { id: 'pipe-03', label: 'PUL data pipeline' },
      { id: 'pipe-04', label: 'MLU data pipeline' },
      { id: 'pipe-05', label: 'USAU data pipeline (club / college / youth)' },
      { id: 'pipe-06', label: 'International data pipeline (USA / WFDF)' },
      { id: 'pipe-07', label: 'UPA data pipeline' },
      { id: 'pipe-08', label: 'UltiAnalytics ingest pipeline' },
      { id: 'pipe-09', label: 'Player identity resolution (master_players)' },
      { id: 'pipe-10', label: 'sync_all.py orchestrator' },
      { id: 'pipe-11', label: 'Scrape log tables (ufa / wul / pul)' },
      { id: 'pipe-12', label: 'USAU program & rankings scraper' },
    ],
  },
  {
    id: 'ufa-pages', label: 'UFA League Pages',
    items: [
      { id: 'ufa-01', label: '/ufa — Landing (standings, schedule, highlights)' },
      { id: 'ufa-02', label: '/ufa/teams — Teams index grid' },
      { id: 'ufa-03', label: '/ufa/teams/:id — Franchise page (roster, stats, records)' },
      { id: 'ufa-04', label: '/ufa/compare — Team comparison tool' },
      { id: 'ufa-05', label: '/ufa/throws — Throw chart / shot chart explorer' },
      { id: 'ufa-06', label: '/ufa/leaderboard — Player leaderboard' },
      { id: 'ufa-07', label: '/ufa/games — Games browser (filter, search)' },
      { id: 'ufa-08', label: '/ufa/games/:id — Individual game page' },
    ],
  },
  {
    id: 'wul-pages', label: 'WUL League Pages',
    items: [
      { id: 'wul-01', label: '/wul — Landing page' },
      { id: 'wul-02', label: '/wul/teams — Teams index' },
      { id: 'wul-03', label: '/wul/teams/:id — Team page' },
      { id: 'wul-04', label: '/wul/compare — Team comparison' },
      { id: 'wul-05', label: '/wul/games — Games browser' },
      { id: 'wul-06', label: '/wul/games/:id — Individual game page' },
    ],
  },
  {
    id: 'pul-pages', label: 'PUL League Pages',
    items: [
      { id: 'pul-01', label: '/pul — Landing page' },
      { id: 'pul-02', label: '/pul/teams — Teams index' },
      { id: 'pul-03', label: '/pul/teams/:id — Team page' },
      { id: 'pul-04', label: '/pul/compare — Team comparison' },
      { id: 'pul-05', label: '/pul/games — Games browser' },
      { id: 'pul-06', label: '/pul/games/:id — Individual game page' },
    ],
  },
  {
    id: 'mlu-pages', label: 'MLU League Pages',
    items: [
      { id: 'mlu-01', label: '/mlu — Landing page' },
      { id: 'mlu-02', label: '/mlu/teams — Teams index' },
      { id: 'mlu-03', label: '/mlu/teams/:id — Team page' },
      { id: 'mlu-04', label: '/mlu/compare — Team comparison' },
      { id: 'mlu-05', label: '/mlu/games — Games browser' },
      { id: 'mlu-06', label: '/mlu/games/:id — Individual game page' },
    ],
  },
  {
    id: 'usau-pages', label: 'USAU Section',
    items: [
      { id: 'usau-01', label: '/usau — Landing page' },
      { id: 'usau-02', label: '/usau/club — Club division page' },
      { id: 'usau-03', label: '/usau/college — College division page' },
      { id: 'usau-04', label: '/usau/youth — Youth division page' },
      { id: 'usau-05', label: '/usau/program/:id — Program detail page' },
      { id: 'usau-06', label: '/usau/leaderboard — USAU leaderboard' },
      { id: 'usau-07', label: '/usau/games — Games browser' },
      { id: 'usau-08', label: '/usau/games/:id — Individual game page' },
      { id: 'usau-09', label: 'USAU rankings page (advanced filters)' },
    ],
  },
  {
    id: 'player-features', label: 'Player Features',
    items: [
      { id: 'ply-01', label: '/players — Player search (cross-league)' },
      { id: 'ply-02', label: '/players/:id — Full player profile page' },
      { id: 'ply-03', label: '/player/:id — Legacy player page' },
      { id: 'ply-04', label: 'Cross-league player identity resolution display' },
      { id: 'ply-05', label: '/report/player/:id — Player stat report' },
    ],
  },
  {
    id: 'analytics', label: 'Analytics & Visualization',
    items: [
      { id: 'ana-01', label: 'ShotChart / throw visualization component' },
      { id: 'ana-02', label: 'Field value grid heatmap' },
      { id: 'ana-03', label: 'Win probability model (v3)' },
      { id: 'ana-04', label: 'Binomial score analysis' },
      { id: 'ana-05', label: 'Rubber band analysis' },
      { id: 'ana-06', label: 'Team comparison charts (head-to-head)' },
      { id: 'ana-07', label: 'Franchise records (single-season, career, rookie)' },
      { id: 'ana-08', label: 'Player leaderboard with multi-stat filters' },
      { id: 'ana-09', label: 'Interactive analysis export (HTML)' },
      { id: 'ana-10', label: '3D STL viewer component' },
    ],
  },
  {
    id: 'reports-section', label: 'Report Pages',
    items: [
      { id: 'rep-01', label: '/report/game/:league/:gameId — Game report' },
      { id: 'rep-02', label: '/report/player/:id — Player stat report' },
      { id: 'rep-03', label: '/report/team/:league/:id — Team season report' },
    ],
  },
  {
    id: 'blog-section', label: 'Blog & Content',
    items: [
      { id: 'blg-01', label: '/blog — Blog index page' },
      { id: 'blg-02', label: '/blog/:id — Blog post page' },
      { id: 'blg-03', label: 'Admin blog CMS (create / edit / delete / publish)' },
      { id: 'blg-04', label: 'Post categories & tag system' },
      { id: 'blg-05', label: 'Featured post support' },
      { id: 'blg-06', label: 'Blog cover images' },
    ],
  },
  {
    id: 'auth-subs', label: 'User Auth & Subscriptions',
    items: [
      { id: 'aut-01', label: '/subscribe — Subscription page' },
      { id: 'aut-02', label: '/account — Account management page' },
      { id: 'aut-03', label: 'User registration & login' },
      { id: 'aut-04', label: 'JWT session management' },
      { id: 'aut-05', label: 'Subscription tier enforcement (free / paid)' },
      { id: 'aut-06', label: 'Stripe checkout flow' },
      { id: 'aut-07', label: 'Stripe billing portal' },
      { id: 'aut-08', label: 'Stripe webhook handler' },
      { id: 'aut-09', label: 'Paywall banner component' },
      { id: 'aut-10', label: 'Login modal component' },
    ],
  },
  {
    id: 'ultianalytics', label: 'UltiAnalytics Community Data',
    items: [
      { id: 'ua-01', label: '/submit/ultianalytics — Upload page' },
      { id: 'ua-02', label: 'Team credential verification (email + code)' },
      { id: 'ua-03', label: '.iexport file parsing (frontend)' },
      { id: 'ua-04', label: 'Duplicate detection (file hash dedup)' },
      { id: 'ua-05', label: 'Admin review workflow (pending → viable → approved)' },
      { id: 'ua-06', label: 'Viability cross-check vs. USAU records' },
      { id: 'ua-07', label: 'Approved data promotion to reporting tables' },
      { id: 'ua-08', label: 'Upload audit log' },
    ],
  },
  {
    id: 'ux', label: 'Site-Wide UX',
    items: [
      { id: 'ux-01', label: 'Dark / light theme toggle' },
      { id: 'ux-02', label: 'Responsive layout (mobile-friendly)' },
      { id: 'ux-03', label: 'PageChrome / global navigation' },
      { id: 'ux-04', label: 'LeagueShell consistent page frame' },
      { id: 'ux-05', label: 'FilterPanel reusable component' },
      { id: 'ux-06', label: '/status — System status page' },
      { id: 'ux-07', label: '404 fallback redirect' },
      { id: 'ux-08', label: 'Logo assets (team logos, SVG patches)' },
      { id: 'ux-09', label: 'SEO meta tags & Open Graph' },
      { id: 'ux-10', label: 'Performance optimization (lazy loading, caching)' },
      { id: 'ux-11', label: 'Error boundaries' },
    ],
  },
  {
    id: 'admin-tools', label: 'Admin Tools',
    items: [
      { id: 'adm-01', label: '/admin — Admin page auth (IP + token)' },
      { id: 'adm-02', label: 'Sync tab (run sync_all.py with flags)' },
      { id: 'adm-03', label: 'Logs tab (scrape log browser)' },
      { id: 'adm-04', label: 'Blog tab (CMS)' },
      { id: 'adm-05', label: 'Whitelist tab (IP / CIDR management)' },
      { id: 'adm-06', label: 'Validate tab (data quality checks)' },
      { id: 'adm-07', label: 'Rescrape tab (targeted force rescrape)' },
      { id: 'adm-08', label: 'Browse DB tab (paginated viewer + inline edit)' },
      { id: 'adm-09', label: 'Reports tab (test links)' },
      { id: 'adm-10', label: 'Roadmap / Checklist tab' },
    ],
  },
];

function RoadmapTab() {
  const [saved, setSaved] = useState(() => {
    try { return JSON.parse(localStorage.getItem(ROADMAP_KEY) || '{}'); }
    catch { return {}; }
  });
  const [filter,         setFilter]         = useState('all'); // 'all' | 'todo' | 'done'
  const [search,         setSearch]         = useState('');
  const [addingTo,       setAddingTo]       = useState(null);  // section id
  const [newItemText,    setNewItemText]    = useState('');
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [collapsed,      setCollapsed]      = useState({});

  const completions = saved.completions    ?? {};
  const customItems = saved.customItems    ?? [];
  const customSects = saved.customSections ?? [];

  const persist = (updates) => {
    const next = { ...saved, ...updates };
    setSaved(next);
    try { localStorage.setItem(ROADMAP_KEY, JSON.stringify(next)); } catch { /* quota */ }
  };

  const toggleItem = (itemId) => {
    const newComp = { ...completions };
    if (newComp[itemId]) delete newComp[itemId];
    else newComp[itemId] = new Date().toISOString();
    persist({ completions: newComp });
  };

  const addCustomItem = (sectionId) => {
    if (!newItemText.trim()) return;
    const item = {
      id: `custom-${Date.now()}`,
      sectionId,
      label: newItemText.trim(),
      createdAt: new Date().toISOString(),
    };
    persist({ customItems: [...customItems, item] });
    setNewItemText('');
    setAddingTo(null);
  };

  const deleteCustomItem = (itemId) => {
    const newComp = { ...completions };
    delete newComp[itemId];
    persist({ customItems: customItems.filter(i => i.id !== itemId), completions: newComp });
  };

  const addCustomSection = () => {
    if (!newSectionName.trim()) return;
    const sect = { id: `sect-${Date.now()}`, label: newSectionName.trim() };
    persist({ customSections: [...customSects, sect] });
    setNewSectionName('');
    setShowAddSection(false);
  };

  const allSections = [
    ...SEED_SECTIONS.map(s => ({
      ...s,
      items: [...s.items, ...customItems.filter(ci => ci.sectionId === s.id)],
    })),
    ...customSects.map(s => ({
      ...s,
      items: customItems.filter(ci => ci.sectionId === s.id),
    })),
  ];

  const isMatch = (item) => {
    const done = !!completions[item.id];
    if (filter === 'todo' && done) return false;
    if (filter === 'done' && !done) return false;
    if (search.trim() && !item.label.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  };

  const totalItems = allSections.reduce((n, s) => n + s.items.length, 0);
  const doneItems  = allSections.reduce((n, s) => n + s.items.filter(i => completions[i.id]).length, 0);
  const pct        = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

  return (
    <div>
      {/* ── Header / progress ── */}
      <div style={{ ...CARD, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={SECTION_HEAD}>Development Roadmap</div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--t-secondary)', fontWeight: 500 }}>
              {doneItems} / {totalItems} complete &nbsp;·&nbsp; {pct}%
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {['all', 'todo', 'done'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{ ...BTN(filter === f ? 'primary' : 'default'), padding: '5px 12px', fontSize: 10 }}
              >
                {f === 'all' ? 'All' : f === 'todo' ? 'Todo' : 'Done'}
              </button>
            ))}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ height: 6, background: 'var(--surf-border)', borderRadius: 3, overflow: 'hidden', marginBottom: 12 }}>
          <div style={{
            height: '100%',
            width: `${pct}%`,
            background: pct === 100 ? '#22c55e' : 'var(--orange)',
            borderRadius: 3,
            transition: 'width .35s ease',
          }} />
        </div>

        {/* Search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search checklist items…"
          style={INPUT_STYLE}
        />
      </div>

      {/* ── Sections ── */}
      {allSections.map(section => {
        const visibleItems = section.items.filter(isMatch);
        if (filter !== 'all' && visibleItems.length === 0) return null;
        const secDone     = section.items.filter(i => completions[i.id]).length;
        const secTotal    = section.items.length;
        const allDone     = secTotal > 0 && secDone === secTotal;
        const isCollapsed = !!collapsed[section.id];

        return (
          <div key={section.id} style={{ ...CARD, marginBottom: 10 }}>
            {/* Section header — click to collapse */}
            <div
              onClick={() => setCollapsed(c => ({ ...c, [section.id]: !c[section.id] }))}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                cursor: 'pointer', marginBottom: isCollapsed ? 0 : 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ ...SECTION_HEAD, marginBottom: 0, color: allDone ? '#22c55e' : 'var(--orange)' }}>
                  {section.label}
                </span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)' }}>
                  {secDone}/{secTotal}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 56, height: 3, background: 'var(--surf-border)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${secTotal ? (secDone / secTotal) * 100 : 0}%`,
                    background: allDone ? '#22c55e' : 'var(--orange)',
                    borderRadius: 2,
                  }} />
                </div>
                <span style={{ fontSize: 9, color: 'var(--t-muted)', userSelect: 'none' }}>
                  {isCollapsed ? '▶' : '▼'}
                </span>
              </div>
            </div>

            {!isCollapsed && (
              <>
                {visibleItems.length === 0 ? (
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)', padding: '6px 0' }}>
                    No {filter} items in this section.
                  </div>
                ) : (
                  visibleItems.map((item, idx) => {
                    const done     = !!completions[item.id];
                    const doneAt   = completions[item.id];
                    const isCustom = !!item.createdAt;
                    return (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                          padding: '7px 0',
                          borderBottom: idx < visibleItems.length - 1 ? '1px solid var(--surf-divider)' : 'none',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={done}
                          onChange={() => toggleItem(item.id)}
                          style={{ accentColor: 'var(--orange)', marginTop: 2, flexShrink: 0, cursor: 'pointer' }}
                        />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontFamily: 'var(--font-body)', fontSize: 12,
                            color: done ? 'var(--t-muted)' : 'var(--t-secondary)',
                            textDecoration: done ? 'line-through' : 'none',
                            opacity: done ? 0.65 : 1,
                            lineHeight: 1.45,
                          }}>
                            {item.label}
                          </div>
                          {doneAt && (
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#22c55e', opacity: 0.85, marginTop: 2 }}>
                              ✓ {new Date(doneAt).toLocaleString()}
                            </div>
                          )}
                          {isCustom && !done && (
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--t-muted)', marginTop: 1 }}>
                              Added {new Date(item.createdAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                        {isCustom && (
                          <button
                            onClick={() => deleteCustomItem(item.id)}
                            style={{ ...BTN('danger'), padding: '2px 7px', fontSize: 9, flexShrink: 0, lineHeight: '14px' }}
                            title="Remove item"
                          >×</button>
                        )}
                      </div>
                    );
                  })
                )}

                {/* Inline add-item */}
                {addingTo === section.id ? (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                    <input
                      autoFocus
                      value={newItemText}
                      onChange={e => setNewItemText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') addCustomItem(section.id);
                        if (e.key === 'Escape') { setAddingTo(null); setNewItemText(''); }
                      }}
                      placeholder="New checklist item…"
                      style={{ ...INPUT_STYLE, flex: 1 }}
                    />
                    <button onClick={() => addCustomItem(section.id)} style={BTN('primary')}>Add</button>
                    <button onClick={() => { setAddingTo(null); setNewItemText(''); }} style={BTN()}>Cancel</button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setAddingTo(section.id); setNewItemText(''); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      marginTop: 10, background: 'none',
                      border: '1px dashed var(--surf-border)', borderRadius: 5,
                      padding: '5px 12px', cursor: 'pointer',
                      fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-muted)',
                    }}
                  >
                    + Add item
                  </button>
                )}
              </>
            )}
          </div>
        );
      })}

      {/* ── Add custom section ── */}
      <div style={{ ...CARD }}>
        {showAddSection ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              autoFocus
              value={newSectionName}
              onChange={e => setNewSectionName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') addCustomSection();
                if (e.key === 'Escape') { setShowAddSection(false); setNewSectionName(''); }
              }}
              placeholder="Section name…"
              style={{ ...INPUT_STYLE, flex: 1 }}
            />
            <button onClick={addCustomSection} style={BTN('primary')}>Create</button>
            <button onClick={() => { setShowAddSection(false); setNewSectionName(''); }} style={BTN()}>Cancel</button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddSection(true)}
            style={{
              display: 'block', width: '100%', textAlign: 'center',
              background: 'none', border: '1px dashed var(--surf-border)',
              borderRadius: 5, padding: '8px', cursor: 'pointer',
              fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)',
            }}
          >
            + Add Custom Section
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main admin page ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'sync',      label: 'Sync' },
  { id: 'logs',      label: 'Logs' },
  { id: 'blog',      label: 'Blog' },
  { id: 'whitelist', label: 'Whitelist' },
  { id: 'validate',  label: 'Validate' },
  { id: 'rescrape',  label: 'Rescrape' },
  { id: 'browse',    label: 'Browse DB' },
  { id: 'reports',   label: 'Reports' },
  { id: 'roadmap',   label: 'Roadmap' },
];

// ── ReportsTab ────────────────────────────────────────────────────────────────
function ReportsTab() {
  const LINK_STYLE = {
    display:       'inline-block',
    color:         'var(--orange)',
    fontFamily:    'var(--font-body)',
    fontSize:       12,
    textDecoration: 'none',
    padding:       '5px 14px',
    border:        '1px solid var(--orange)',
    borderRadius:   6,
    opacity:        0.85,
  };

  const rows = [
    {
      label:    'Game Report — UFA',
      href:     '/report/game/ufa/2026-05-10-OAK-ORE',
      note:     'Spiders @ Steel · May 10, 2026',
    },
    {
      label:    'Game Report — WUL',
      href:     '/report/game/wul/wul_2026-05-02_wul_01_wul_05',
      note:     'WUL game · May 2, 2026',
    },
    {
      label:    'Player Report',
      href:     '/report/player/00002715',
      note:     'Mischa Freystaetter',
    },
    {
      label:    'Team Season Report — UFA',
      href:     '/report/team/ufa/16?year=2025',
      note:     'Minnesota Wind Chill · 2025',
    },
  ];

  return (
    <div>
      <div style={{ ...SECTION_HEAD, marginBottom: 14 }}>Report Test Links</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map(r => (
          <div
            key={r.href}
            style={{
              ...CARD,
              display:    'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 0,
              padding:    '12px 18px',
            }}
          >
            <div>
              <div style={{ fontFamily: 'var(--font-h2)', fontSize: 13, color: 'var(--t-primary)', marginBottom: 3 }}>
                {r.label}
              </div>
              <div style={{ fontSize: 11, color: 'var(--t-muted)' }}>{r.note}</div>
              <div style={{ fontSize: 10, color: 'var(--t-muted)', opacity: 0.6, marginTop: 2, fontFamily: 'monospace' }}>{r.href}</div>
            </div>
            <a href={r.href} target="_blank" rel="noreferrer" style={LINK_STYLE}>
              Open ↗
            </a>
          </div>
        ))}
      </div>

      <div style={{ ...SECTION_HEAD, marginTop: 28, marginBottom: 8 }}>URL Patterns</div>
      <div style={{ ...CARD, fontFamily: 'monospace', fontSize: 11, color: 'var(--mono-clr)', lineHeight: 2 }}>
        /report/game/:league/:gameId<br />
        /report/player/:playerId<br />
        /report/team/:league/:teamId?year=YYYY
      </div>
    </div>
  );
}

export default function AdminPage() {
  const stored = sessionStorage.getItem(SESSION_KEY);
  const [token,   setToken]   = useState(stored ?? '');
  const [authed,  setAuthed]  = useState(false);
  const [activeTab, setActiveTab] = useState('sync');

  // Re-verify stored token on mount
  useEffect(() => {
    if (!stored) return;
    adminFetch('/api/admin/verify', stored, { method: 'POST' })
      .then(() => setAuthed(true))
      .catch(() => {
        sessionStorage.removeItem(SESSION_KEY);
        setToken('');
      });
  }, []);

  const handleAuth = tok => {
    setToken(tok);
    setAuthed(true);
  };

  const logout = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setToken('');
    setAuthed(false);
  };

  return (
    <div
      style={{
        height:     '100vh',
        overflow:   'hidden',
        display:    'flex',
        flexDirection: 'column',
        padding:    '24px 16px',
        boxSizing:  'border-box',
      }}
    >
      <div
        style={{
          maxWidth:      1200,
          width:         '100%',
          margin:        '0 auto',
          flex:          1,
          minHeight:     0,
          display:       'flex',
          flexDirection: 'column',
          background:    'var(--card-bg)',
          borderRadius:  16,
          border:        '1px solid var(--card-border-clr)',
          boxShadow:     'var(--card-shadow)',
          backdropFilter: 'var(--card-backdrop)',
          overflow:      'hidden',
        }}
      >
        {/* Nav */}
        <nav
          style={{
            padding:       '18px 32px',
            borderBottom:  '1px solid var(--nav-border)',
            flexShrink:    0,
            display:       'flex',
            alignItems:    'center',
            justifyContent: 'space-between',
          }}
        >
          <Link
            to="/"
            style={{
              fontFamily:    'var(--font-h2)',
              fontSize:      11,
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              color:         'var(--orange)',
              opacity:        0.6,
              textDecoration: 'none',
            }}
          >
            ← Ulti-Reference
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {authed && (
              <button onClick={logout} style={{ ...BTN('danger'), padding: '4px 12px', fontSize: 10 }}>
                Logout
              </button>
            )}
          </div>
        </nav>

        {/* Content */}
        {!authed ? (
          <div className="orange-scroll" style={{ flex: 1, overflowY: 'auto' }}>
            <LoginScreen onAuth={handleAuth} />
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Tab bar */}
            <div
              style={{
                display:      'flex',
                alignItems:   'center',
                gap:           2,
                padding:      '0 24px',
                borderBottom: '1px solid var(--nav-border)',
                flexShrink:   0,
              }}
            >
              <div
                style={{
                  fontFamily:    'var(--font-h2)',
                  fontSize:       9,
                  letterSpacing: '2px',
                  textTransform: 'uppercase',
                  color:         'var(--orange)',
                  opacity:        0.7,
                  marginRight:    12,
                  paddingBottom:   2,
                }}
              >
                Data Admin
              </div>
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    background:    'none',
                    border:        'none',
                    borderBottom:  activeTab === tab.id ? '2px solid var(--orange)' : '2px solid transparent',
                    padding:       '12px 16px',
                    cursor:        'pointer',
                    fontFamily:    'var(--font-h2)',
                    fontSize:       11,
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                    color:         activeTab === tab.id ? 'var(--orange)' : 'var(--t-muted)',
                    transition:    'color 0.15s',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div
              className="orange-scroll"
              style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 28px' }}
            >
              {activeTab === 'sync'      && <SyncTab      token={token} />}
              {activeTab === 'logs'      && <LogsTab      token={token} />}
              {activeTab === 'blog'      && <BlogTab      token={token} />}
              {activeTab === 'whitelist' && <WhitelistTab token={token} />}
              {activeTab === 'validate'  && <ValidateTab  token={token} />}
              {activeTab === 'rescrape'  && <RescrapeTab  token={token} />}
              {activeTab === 'browse'    && <BrowseTab    token={token} />}
              {activeTab === 'reports'   && <ReportsTab />}
              {activeTab === 'roadmap'   && <RoadmapTab />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
