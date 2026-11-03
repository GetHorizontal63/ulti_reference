import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';

// ── Status palette ────────────────────────────────────────────────────────────

const PALETTE = {
  operational: {
    bg:     'rgba(34,197,94,0.10)',
    border: 'rgba(34,197,94,0.35)',
    dot:    '#22c55e',
    text:   '#22c55e',
  },
  degraded: {
    bg:     'rgba(245,158,11,0.10)',
    border: 'rgba(245,158,11,0.35)',
    dot:    '#f59e0b',
    text:   '#f59e0b',
  },
  down: {
    bg:     'rgba(239,68,68,0.10)',
    border: 'rgba(239,68,68,0.35)',
    dot:    '#ef4444',
    text:   '#ef4444',
  },
  checking: {
    bg:     'rgba(107,114,128,0.10)',
    border: 'rgba(107,114,128,0.35)',
    dot:    '#6b7280',
    text:   '#9ca3af',
  },
};

const OVERALL_LABELS = {
  operational: 'All Systems Operational',
  degraded:    'Partial Degradation',
  outage:      'Service Outage',
  checking:    'Checking services…',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function PulseDot({ status, size = 10 }) {
  const p = PALETTE[status] ?? PALETTE.checking;
  return (
    <span
      style={{
        display:      'inline-block',
        width:        size,
        height:       size,
        borderRadius: '50%',
        background:   p.dot,
        boxShadow:    `0 0 ${size * 0.7}px ${size * 0.25}px ${p.dot}66`,
        flexShrink:   0,
      }}
    />
  );
}

function ServiceCard({ svc }) {
  const p = PALETTE[svc.status] ?? PALETTE.checking;
  return (
    <div
      style={{
        background:   p.bg,
        border:       `1px solid ${p.border}`,
        borderRadius: 12,
        padding:      '18px 20px',
        display:      'flex',
        flexDirection: 'column',
        gap:          10,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            fontFamily:   'var(--font-h2)',
            fontSize:     13,
            fontWeight:   600,
            color:        'var(--t-primary)',
            letterSpacing: '0.02em',
          }}
        >
          {svc.name}
        </span>
        <PulseDot status={svc.status} />
      </div>

      {/* Description */}
      <div
        style={{
          fontFamily:   'var(--font-body)',
          fontSize:     11,
          color:        'var(--t-muted)',
          letterSpacing: '0.3px',
        }}
      >
        {svc.description}
      </div>

      {/* Status line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          style={{
            fontFamily:    'var(--font-h2)',
            fontSize:      10,
            letterSpacing: '1px',
            textTransform: 'uppercase',
            color:         p.text,
          }}
        >
          {svc.message || svc.status}
        </span>
        {svc.response_ms != null && (
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--t-muted)' }}>
            {svc.response_ms} ms
          </span>
        )}
        <span
          style={{
            marginLeft:    'auto',
            fontFamily:    'var(--font-body)',
            fontSize:       9,
            color:         'var(--t-muted)',
            opacity:        0.55,
            letterSpacing: '0.5px',
          }}
        >
          {svc.code}
        </span>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StatusPage() {
  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastRefresh(new Date());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + auto-refresh every 60 s
  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 60_000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const overall        = data?.overall ?? 'checking';
  const overallPalette = PALETTE[overall] ?? PALETTE.checking;

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
          maxWidth:      960,
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
        {/* ── Nav ── */}
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
            {lastRefresh && (
              <span
                style={{
                  fontFamily: 'var(--font-body)',
                  fontSize:   10,
                  color:      'var(--t-muted)',
                }}
              >
                Updated {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchStatus}
              style={{
                background:    'none',
                border:        '1px solid var(--surf-border)',
                borderRadius:  6,
                padding:       '4px 12px',
                cursor:        'pointer',
                fontFamily:    'var(--font-h2)',
                fontSize:      10,
                letterSpacing: '1px',
                textTransform: 'uppercase',
                color:         'var(--t-muted)',
              }}
            >
              Refresh
            </button>
          </div>
        </nav>

        {/* ── Body ── */}
        <div
          className="orange-scroll"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '32px' }}
        >
          {/* Overall banner */}
          <div
            style={{
              background:    overallPalette.bg,
              border:        `1px solid ${overallPalette.border}`,
              borderRadius:  14,
              padding:       '22px 28px',
              marginBottom:  32,
              display:       'flex',
              alignItems:    'center',
              gap:           18,
            }}
          >
            <PulseDot status={overall} size={16} />
            <div>
              <div
                style={{
                  fontFamily:    'var(--font-h1)',
                  fontSize:      'clamp(1.1rem, 2vw, 1.5rem)',
                  fontWeight:    600,
                  color:         'var(--t-primary)',
                  letterSpacing: '-0.01em',
                  textTransform: 'uppercase',
                }}
              >
                {OVERALL_LABELS[overall] ?? overall}
              </div>
              {data?.overall_code && (
                <div
                  style={{
                    fontFamily: 'var(--font-body)',
                    fontSize:   11,
                    color:      'var(--t-muted)',
                    marginTop:  5,
                  }}
                >
                  Code {data.overall_code} — {data.overall_message}
                </div>
              )}
            </div>
          </div>

          {/* Section header */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontFamily:    'var(--font-h2)',
                fontSize:       9,
                letterSpacing: '2.5px',
                textTransform: 'uppercase',
                color:         'var(--orange)',
                opacity:        0.75,
                marginBottom:   5,
              }}
            >
              Services
            </div>
            <div
              style={{
                fontFamily:    'var(--font-h1)',
                fontSize:      'clamp(1.3rem, 2.5vw, 1.9rem)',
                fontWeight:    600,
                color:         'var(--t-primary)',
                letterSpacing: '-0.02em',
                textTransform: 'uppercase',
              }}
            >
              System Status
            </div>
          </div>

          {/* Error state */}
          {error && (
            <div
              style={{
                fontFamily:   'var(--font-body)',
                fontSize:      13,
                color:        '#ef4444',
                marginBottom:  20,
                padding:      '12px 16px',
                background:   'rgba(239,68,68,0.08)',
                border:       '1px solid rgba(239,68,68,0.25)',
                borderRadius:  8,
              }}
            >
              Failed to fetch status: {error}
            </div>
          )}

          {/* Loading */}
          {loading && !data && (
            <div style={{ fontFamily: 'var(--font-body)', color: 'var(--t-muted)', fontSize: 13 }}>
              Checking services…
            </div>
          )}

          {/* Service cards */}
          {data?.services && (
            <div
              style={{
                display:               'grid',
                gridTemplateColumns:   'repeat(auto-fill, minmax(275px, 1fr))',
                gap:                   14,
                marginBottom:          36,
              }}
            >
              {data.services.map(svc => (
                <ServiceCard key={svc.id} svc={svc} />
              ))}
            </div>
          )}

          {/* Status code legend */}
          {data?.status_codes && (
            <div>
              <div
                style={{
                  fontFamily:    'var(--font-h2)',
                  fontSize:       9,
                  letterSpacing: '2px',
                  textTransform: 'uppercase',
                  color:         'var(--t-muted)',
                  marginBottom:   12,
                }}
              >
                Status Code Reference
              </div>
              <div
                style={{
                  display:             'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
                  gap:                  6,
                }}
              >
                {Object.entries(data.status_codes).map(([code, label]) => (
                  <div
                    key={code}
                    style={{
                      display:      'flex',
                      alignItems:   'center',
                      gap:          10,
                      padding:      '7px 12px',
                      background:   'var(--surf-bg)',
                      borderRadius:  6,
                      border:       '1px solid var(--surf-border)',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-h2)',
                        fontSize:    11,
                        color:       Number(code) < 4000 ? '#22c55e' : '#f59e0b',
                        minWidth:    36,
                        fontWeight:  600,
                      }}
                    >
                      {code}
                    </span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--t-secondary)' }}>
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
