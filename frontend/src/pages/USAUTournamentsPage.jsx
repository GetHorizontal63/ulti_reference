import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import LeagueShell from '../components/LeagueShell.jsx';

const ORANGE = '#EA6020';
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';
const USAU_ICON = `${BASE}/assets/png/USAUicon.png`;
function usauLogo(filename) {
  if (!filename) return USAU_ICON;
  return `${BASE}/assets/png/USAU_teams/${filename}`;
}


function dateRange(start, end) {
  if (!start) return '\u2014';
  const sm = start.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!sm) return start;
  const sm_ = parseInt(sm[2], 10);
  const sd_ = parseInt(sm[3], 10);
  const em = end && end !== start ? end.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!em) return `${sm_}/${sd_}`;
  const em_ = parseInt(em[2], 10);
  const ed_ = parseInt(em[3], 10);
  // same month: 3/22-23
  if (sm[2] === em[2]) return `${sm_}/${sd_}\u2013${ed_}`;
  // cross-month: 5/31-6/1
  return `${sm_}/${sd_}\u2013${em_}/${ed_}`;
}

/* ── Tournament grid card ── */
function TournamentCard({ t, onClick, selected = false }) {
  const [hov, setHov] = useState(false);
  const location = [t.city, t.state].filter(Boolean).join(', ');
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        textAlign: 'left',
        padding: '18px 16px',
        borderRadius: 4,
        border: hov && !selected ? '1px solid rgba(234,96,32,0.6)' : '1px solid var(--surf-border)',
        background: 'var(--card-bg)',
        boxShadow: selected ? `inset 0 0 0 3px ${ORANGE}` : 'none',
        cursor: 'pointer',
        transition: 'border-color .12s, filter .12s, box-shadow .12s',
        filter: hov ? 'brightness(1.08)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: '100%',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden',
        minHeight: 100,
      }}
    >
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 1, background: 'linear-gradient(135deg, rgba(234,96,32,0.18) 0%, transparent 100%)', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#C04A10' }}>
              {t.season_year}
            </span>
            {t.divisions && <DivChips divisions={t.divisions} selected={selected} />}
          </div>
          {t.team_count > 0 && (
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 8, letterSpacing: '1px', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 99, background: ORANGE, border: `1px solid ${ORANGE}`, color: '#fff', whiteSpace: 'nowrap' }}>
              {t.team_count} teams
            </span>
          )}
        </div>
        <div style={{ fontFamily: 'var(--font-h1)', fontWeight: 700, fontSize: 15, color: '#C04A10', textTransform: 'uppercase', letterSpacing: '-0.02em', lineHeight: 1.15 }}>{t.event_title}</div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {location && <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#C04A10', opacity: 0.55 }}>{location}</span>}
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, color: '#C04A10', opacity: 0.55 }}>{dateRange(t.date_start, t.date_end)}</span>
        </div>
      </div>
    </button>
  );
}

/* ── Bracket round ordering ── */
function isChampionshipGame(g) {
  const sec = g.bracket_section || '';
  // '1st Place', '1st Place Bracket', '1st & 2nd Place', '1st - 8th Placement', etc.
  if (/^1st\b.{0,15}place/i.test(sec)) return true;
  // 'Championship', 'Championship Bracket', 'National Championship', etc.
  if (/champion/i.test(sec)) return true;
  // 'First Place', 'First Place Bracket', 'A Division First Place', etc.
  // Negative lookbehind prevents matching 'Twenty-first Place', 'Thirty-first Place', etc.
  if (/(?<![a-z-])first[\s\/&]*(?:and\s+second\s+)?place/i.test(sec)) return true;
  return false;
}

const BRACKET_ROUND_PRIORITY = {
  // 0 = play-in / pre-QF / round of 16
  'pre-quarterfinals': 0, 'pre-quarterfinal': 0, 'prequarterfinals': 0, 'prequarterfinal': 0,
  'pre-q': 0, 'pre-qs': 0, 'prequarters': 0, 'pre-quarters': 0, 'prequarter': 0,
  'pq': 0, 'preqfs': 0,
  'octafinals': 0, 'octafinal': 0, 'pre-octafinals': 0, 'pre-octafinal': 0,
  'round of 16': 0, 'sweet 16': 0, 'sweet sixteen': 0, 'round of 32': 0,
  'play in': 0, 'play-in': 0, 'play ins': 0, 'play-ins': 0,
  'crossover': 0, 'crossovers': 0,
  'first place play in': 0, 'first place play-in': 0,
  'semis play-in': 0, 'semis play-ins': 0, 'semis play in': 0,
  // 1 = quarterfinals
  'quarterfinals': 1, 'quarterfinal': 1, 'quarters': 1, 'quarter': 1,
  'quarter finals': 1, 'quarter-finals': 1, 'quarter final': 1, 'quarter-final': 1,
  'quaterfinals': 1, 'qfs': 1, 'qtrs': 1, 'elite 8': 1,
  'first place quarters': 1, 'first place quarterfinals': 1, 'first place quarter': 1,
  '1rst quarters': 1,
  // 2 = semifinals
  'semifinals': 2, 'semifinal': 2, 'semi-finals': 2, 'semi-final': 2, 'semis': 2,
  '1st place semis': 2, '1st place semi-finals': 2, '1st place semifinals': 2,
  'championship semis': 2, 'championship semi-final': 2, 'championship semifinals': 2,
  'final 4': 2, 'final four': 2,
  'first place semis': 2, 'first place semi': 2, 'first place semifinals': 2,
  '1rst semis': 2, '1rst place semis': 2,
  // 3 = 3rd place
  '3rd place': 3, '3rd place finals': 3, '3rd place final': 3,
  // 4 = championship final
  'finals': 4, 'final': 4, '1st place finals': 4, '1st place final': 4, 'championship': 4,
  '1st place': 4, 'championships': 4, 'championship final': 4, 'championship game': 4,
  'boys championship': 4, 'girls championship': 4,
  '1st/2nd place': 4, '1st & 2nd place': 4, '1st place game': 4,
  'first place': 4, 'first place finals': 4, 'first place final': 4, 'first place game': 4,
  'first place bid': 4, 'first place bracket': 4,
  'first and second place': 4, 'first/second': 4, 'first/second place': 4,
};
function getRoundPriority(r) {
  const key = (r || '').toLowerCase().trim();
  if (key in BRACKET_ROUND_PRIORITY) return BRACKET_ROUND_PRIORITY[key];
  if (/\bpre[\s-]?quart|\boct(?:a)?finals?|\bround\s+of\s+16\b|\bsweet\s*1[6s]\b|\bplay[\s-]?in\b|\bpq\b|\bpre[\s-]?qs?\b|\bcrossover\b/i.test(key)) return 0;
  if (/\bquart(?:er)?[\s-]?finals?\b|\bquarters?\b|\bqtrs?\b|\bqfs?\b|\belite\s*8\b/i.test(key)) return 1;
  if (/\bsemi[\s-]?finals?\b|\bsemis?\b|\bfinal\s*4\b|\bfinal\s*four\b/i.test(key)) return 2;
  if (/\b3rd\s*place\b/i.test(key)) return 3;
  if (/\bfinals?\b|\bchampionship\b|\b1st\s*place\b|(?<![a-z-])first\s*place/i.test(key)) return 4;
  return 50;
}

const BRACKET_ROUND_ABBREV = {
  'pre-quarterfinals': 'Pre-QF', 'pre-quarterfinal': 'Pre-QF', 'prequarterfinals': 'Pre-QF', 'prequarterfinal': 'Pre-QF',
  'pre-q': 'Pre-QF', 'pre-qs': 'Pre-QF', 'prequarters': 'Pre-QF', 'pre-quarters': 'Pre-QF', 'prequarter': 'Pre-QF',
  'pq': 'Pre-QF', 'preqfs': 'Pre-QF',
  'octafinals': 'Round of 16', 'octafinal': 'Round of 16', 'pre-octafinals': 'Pre-R16', 'round of 16': 'Round of 16',
  'sweet 16': 'Round of 16', 'sweet sixteen': 'Round of 16', 'round of 32': 'Pre-R16',
  'play in': 'Play-In', 'play-in': 'Play-In', 'play ins': 'Play-In', 'play-ins': 'Play-In',
  'crossover': 'Play-In', 'crossovers': 'Play-In',
  'first place play in': 'Play-In', 'first place play-in': 'Play-In',
  'semis play-in': 'Play-In', 'semis play-ins': 'Play-In', 'semis play in': 'Play-In',
  'quarterfinals': 'Quarterfinal', 'quarterfinal': 'Quarterfinal', 'quarters': 'Quarterfinal', 'quarter': 'Quarterfinal',
  'quarter finals': 'Quarterfinal', 'quarter-finals': 'Quarterfinal', 'quarter final': 'Quarterfinal', 'quarter-final': 'Quarterfinal',
  'quaterfinals': 'Quarterfinal', 'qfs': 'Quarterfinal', 'qtrs': 'Quarterfinal', 'elite 8': 'Quarterfinal',
  'first place quarters': 'Quarterfinal', 'first place quarterfinals': 'Quarterfinal', 'first place quarter': 'Quarterfinal',
  '1rst quarters': 'Quarterfinal',
  'semifinals': 'Semifinal', 'semifinal': 'Semifinal', 'semi-finals': 'Semifinal', 'semi-final': 'Semifinal', 'semis': 'Semifinal',
  '1st place semis': 'Semifinal', 'championship semis': 'Semifinal', 'championship semi-final': 'Semifinal',
  'final 4': 'Semifinal', 'final four': 'Semifinal',
  'first place semis': 'Semifinal', 'first place semi': 'Semifinal', 'first place semifinals': 'Semifinal',
  '1rst semis': 'Semifinal', '1rst place semis': 'Semifinal',
  '3rd place': '3rd Place', '3rd place finals': '3rd Place', '3rd place final': '3rd Place',
  'finals': 'Championship', 'final': 'Championship', '1st place finals': 'Championship', '1st place final': 'Championship',
  'championship': 'Championship', '1st place': 'Championship', 'championships': 'Championship',
  'championship final': 'Championship', 'championship game': 'Championship',
  'boys championship': 'Championship', 'girls championship': 'Championship',
  '1st/2nd place': 'Championship', '1st & 2nd place': 'Championship', '1st place game': 'Championship',
  'first place': 'Championship', 'first place finals': 'Championship', 'first place final': 'Championship',
  'first place game': 'Championship', 'first place bid': 'Championship', 'first place bracket': 'Championship',
  'first and second place': 'Championship', 'first/second': 'Championship', 'first/second place': 'Championship',
};
function getRoundAbbrev(r) {
  const key = (r || '').toLowerCase().trim();
  if (key in BRACKET_ROUND_ABBREV) return BRACKET_ROUND_ABBREV[key];
  if (/\bpre[\s-]?quart|\boct(?:a)?finals?|\bround\s+of\s+16\b|\bsweet\s*1[6s]\b|\bplay[\s-]?in\b|\bpq\b|\bpre[\s-]?qs?\b|\bcrossover\b/i.test(key)) return 'Pre-QF';
  if (/\bquart(?:er)?[\s-]?finals?\b|\bquarters?\b|\bqtrs?\b|\bqfs?\b|\belite\s*8\b/i.test(key)) return 'Quarterfinal';
  if (/\bsemi[\s-]?finals?\b|\bsemis?\b|\bfinal\s*4\b|\bfinal\s*four\b/i.test(key)) return 'Semifinal';
  if (/\b3rd\s*place\b/i.test(key)) return '3rd Place';
  if (/\bfinals?\b|\bchampionship\b|\b1st\s*place\b|(?<![a-z-])first\s*place/i.test(key)) return 'Championship';
  return r;
}

/* ── Bracket matchup card ── */
function BracketMatchup({ game: g, navigate }) {
  const [hov, setHov] = useState(false);
  const hasScore = g.home_score != null && g.away_score != null;
  const homeWins = hasScore && g.home_score > g.away_score;
  const awayWins = hasScore && g.away_score > g.home_score;

  const cleanName = n => n ? n.replace(/\s*\(.*?\)\s*/g, '').trim() : n;

  const logoSize = Math.round(CARD_W * 0.8);

  const teamRow = (name, logo, score, wins) => (
    <div style={{
      position: 'relative',
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '14px 9px',
      background: wins ? 'rgba(234,96,32,0.13)' : 'transparent',
      borderRadius: 3,
      overflow: 'hidden',
    }}>
      {logo && (
        <img
          src={usauLogo(logo)} aria-hidden="true"
          style={{
            position: 'absolute',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: logoSize, height: logoSize,
            objectFit: 'contain', opacity: 0.05,
            pointerEvents: 'none', userSelect: 'none',
          }}
          onError={e => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      <img
        src={usauLogo(logo)} alt={name ?? ''} title={name ?? ''}
        style={{ height: 18, width: 18, objectFit: 'contain', flexShrink: 0, position: 'relative' }}
        onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = USAU_ICON; }}
      />
      <span style={{
        flex: 1, fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '0.5px',
        color: wins ? ORANGE : 'var(--t-primary)',
        fontWeight: wins ? 700 : 400,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        position: 'relative',
      }}>{name || '—'}</span>
      {hasScore && (
        <span style={{
          fontFamily: 'var(--font-h2)', fontSize: 12, fontWeight: 700,
          color: wins ? ORANGE : 'var(--t-muted)',
          minWidth: 18, textAlign: 'right', flexShrink: 0,
          position: 'relative',
        }}>{score}</span>
      )}
    </div>
  );

  return (
    <button
      onClick={() => g.game_id && navigate(`/usau/games/${encodeURIComponent(g.game_id)}`)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', flexDirection: 'column', gap: 0,
        border: hov ? `1px solid ${ORANGE}` : '1px solid var(--surf-border)',
        borderRadius: 5, background: 'var(--card-bg)',
        cursor: g.game_id ? 'pointer' : 'default',
        transition: 'border-color .12s',
        overflow: 'hidden', padding: 0,
        width: CARD_W, flexShrink: 0,
        textAlign: 'left',
      }}
    >
      {teamRow(cleanName(g.home_team), g.home_logo, g.home_score, homeWins)}
      <div style={{ height: 1, background: 'var(--surf-border)', margin: '0 8px' }} />
      {teamRow(cleanName(g.away_team), g.away_logo, g.away_score, awayWins)}
    </button>
  );
}

/* ── Short division label ── */
function shortDivLabel(divLabel) {
  if (!divLabel) return '?';
  if (/women/i.test(divLabel)) return 'Women';
  if (/mixed/i.test(divLabel)) return 'Mixed';
  if (/open/i.test(divLabel)) return 'Open';
  if (/men/i.test(divLabel)) return 'Men';
  const parts = divLabel.split('-').filter(Boolean);
  return parts[parts.length - 1] || divLabel;
}

/* ── Championship bracket view ── */
const CARD_W       = 194;
const CARD_H       = 87;
const COL_GAP      = 48;
const BASE_PAD     = 10;
const PLAYIN_DROP  = Math.round(CARD_H * 0.65); // how far below the QF center play-in cards sit

// Return 'DI' / 'DII' instead of 'D-I' / 'D-II' for use in combined slot labels
function shortCtxLabel(ctx) {
  if (!ctx) return 'Bracket';
  const c = ctx.trim();
  if (/^championship\s+bracket$/i.test(c)) return 'DI';
  if (/^bracket\s+play$/i.test(c))         return 'DII';
  // Strip trailing " Bracket" for other cases: "Gold Bracket" → "Gold"
  const stripped = c.replace(/\s+bracket$/i, '').trim();
  return stripped || c;
}

// Build a display label for a (div, ctx) slot.
// When a division has multiple sub-brackets (DI/DII), append the ctx suffix;
// otherwise just show the gender/division name.
function slotLabel(slot, allSlots) {
  const gender = shortDivLabel(slot.div);
  const divHasMultiCtx = allSlots.filter(s => s.div === slot.div).length > 1;
  if (!divHasMultiCtx || !slot.ctx) return gender;
  return `${gender} ${shortCtxLabel(slot.ctx)}`;
}

function ChampionshipBracket({ games, navigate, selectedDiv, selectedCtx, eventSlug }) {
  const slug = (eventSlug || '').toLowerCase();
  const isDeepTournament = /national|college.champion|club.champion|us.open/i.test(slug);

  const bracketGames = games.filter(g => isChampionshipGame(g) && (!selectedDiv || g.division_label === selectedDiv));

  const depthFiltered = isDeepTournament
    ? bracketGames
    : bracketGames.filter(g => getRoundPriority(g.round) >= 1);

  // Filter by sub-bracket context when one is selected (e.g. DI vs DII at HS events)
  const displayGames = selectedCtx
    ? depthFiltered.filter(g => g.round_context === selectedCtx)
    : depthFiltered;

  if (displayGames.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.4 }}>No bracket data available</span>
      </div>
    );
  }

  // Group by round, sort early → late.
  // Normalize key: strip time/field annotations in parentheses so "Semis (10am - U1)"
  // and "Semis (2:30pm - U2)" both collapse into the same "Semis" column.
  const byRound = {};
  for (const g of displayGames) {
    const key = (g.round || 'Unknown').replace(/\s*\([^)]*\)/g, '').trim() || 'Unknown';
    if (!byRound[key]) byRound[key] = [];
    byRound[key].push(g);
  }
  const rounds = Object.keys(byRound).sort((a, b) =>
    getRoundPriority(a) - getRoundPriority(b)
  );

  const isPlayInRound = r => getRoundPriority(r) === 0;
  const hasPlayIn     = rounds.some(isPlayInRound);
  const mainRounds    = rounds.filter(r => !isPlayInRound(r));
  const mainMaxCount  = mainRounds.reduce((m, r) => Math.max(m, byRound[r].length), 1);
  const totalH        = mainMaxCount * (CARD_H + BASE_PAD) + (hasPlayIn ? PLAYIN_DROP : 0);
  const totalW        = rounds.length * (CARD_W + COL_GAP) - COL_GAP;

  // Card center Y for game gi in a given round (play-in uses same totalH-based slot, offset by PLAYIN_DROP)
  const cardCenterY = (gi, rName) => {
    const n     = byRound[rName].length;
    const slotH = totalH / n;
    const yOff  = isPlayInRound(rName) ? PLAYIN_DROP : 0;
    return gi * slotH + slotH / 2 + yOff;
  };

  // How far play-in cards actually extend below totalH (using same slotH = totalH/n)
  let playInOverflow = 0;
  if (hasPlayIn) {
    for (const r of rounds.filter(isPlayInRound)) {
      const n        = byRound[r].length;
      const slotH    = totalH / n;
      const lastEdge = (n - 1) * slotH + (slotH - CARD_H) / 2 + PLAYIN_DROP + CARD_H;
      playInOverflow = Math.max(playInOverflow, Math.max(0, lastEdge - totalH));
    }
  }
  const canvasH = totalH + playInOverflow;

  // SVG connector lines
  const lines = [];
  for (let ri = 0; ri < rounds.length - 1; ri++) {
    const gA    = byRound[rounds[ri]];
    const gB    = byRound[rounds[ri + 1]];
    const xRight = ri * (CARD_W + COL_GAP) + CARD_W;
    const xMid   = xRight + COL_GAP / 2;
    const xLeft  = (ri + 1) * (CARD_W + COL_GAP);
    const ratio  = gA.length / gB.length;
    const stroke = 'rgba(255,255,255,0.18)';
    for (let jb = 0; jb < gB.length; jb++) {
      const yCB = cardCenterY(jb, rounds[ri + 1]);
      if (Number.isInteger(ratio) && ratio >= 2) {
        // Standard N:1 convergence — N source cards fan into one target
        const yTop = cardCenterY(jb * ratio,             rounds[ri]);
        const yBot = cardCenterY(jb * ratio + ratio - 1, rounds[ri]);
        lines.push(<line key={`ht-${ri}-${jb}`} x1={xRight} y1={yTop} x2={xMid}  y2={yTop} stroke={stroke} strokeWidth={1} />);
        lines.push(<line key={`hb-${ri}-${jb}`} x1={xRight} y1={yBot} x2={xMid}  y2={yBot} stroke={stroke} strokeWidth={1} />);
        lines.push(<line key={`vv-${ri}-${jb}`} x1={xMid}   y1={yTop} x2={xMid}  y2={yBot} stroke={stroke} strokeWidth={1} />);
        lines.push(<line key={`hc-${ri}-${jb}`} x1={xMid}   y1={yCB}  x2={xLeft} y2={yCB}  stroke={stroke} strokeWidth={1} />);
      } else if (gA.length === gB.length) {
        // 1:1 — play-in feeds directly into one slot via elbow (right → up/down → right)
        const yCA = cardCenterY(jb, rounds[ri]);
        lines.push(<line key={`ea-${ri}-${jb}`} x1={xRight} y1={yCA} x2={xMid} y2={yCA} stroke={stroke} strokeWidth={1} />);
        lines.push(<line key={`eb-${ri}-${jb}`} x1={xMid}   y1={yCA} x2={xMid} y2={yCB} stroke={stroke} strokeWidth={1} />);
        lines.push(<line key={`ec-${ri}-${jb}`} x1={xMid}   y1={yCB} x2={xLeft} y2={yCB} stroke={stroke} strokeWidth={1} />);
      } else {
        // Non-standard ratio (e.g. 3→2 in clipped elimination formats) —
        // draw entry stubs only; don't attempt to fan incorrectly
        lines.push(<line key={`ns-${ri}-${jb}`} x1={xMid} y1={yCB} x2={xLeft} y2={yCB} stroke={stroke} strokeWidth={1} />);
      }
    }
    // For non-standard ratios, also draw exit stubs from each source game
    if (!Number.isInteger(ratio) || (ratio < 1 && ratio > 0)) {
      for (let ja = 0; ja < gA.length; ja++) {
        const yCA = cardCenterY(ja, rounds[ri]);
        lines.push(<line key={`nx-${ri}-${ja}`} x1={xRight} y1={yCA} x2={xMid} y2={yCA} stroke={stroke} strokeWidth={1} />);
      }
    }
  }

  return (
    <div style={{ padding: '20px 24px 28px' }}>
      {/* Centering wrapper — fills full width so bracket is centered when it fits */}
      <div style={{ minWidth: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Round column headers */}
        <div style={{ display: 'flex', marginBottom: 14, width: totalW }}>
          {rounds.map((rName, ri) => {
            const label   = getRoundAbbrev(rName);
            const isChamp = getRoundPriority(rName) >= 4;
            return (
              <div key={rName} style={{
                width: CARD_W, marginLeft: ri === 0 ? 0 : COL_GAP,
                fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase',
                color: '#fff',
                borderBottom: `1px solid rgba(255,255,255,0.18)`,
                paddingBottom: 6,
              }}>{label}</div>
            );
          })}
        </div>
        {/* Bracket canvas — height includes play-in card overflow so nothing bleeds into grid below */}
        <div style={{ position: 'relative', width: totalW, height: canvasH }}>
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
            {lines}
          </svg>
          {rounds.map((rName, ri) => {
            const gs    = byRound[rName];
            const slotH = totalH / gs.length;
            const yOff  = isPlayInRound(rName) ? PLAYIN_DROP : 0;
            return gs.map((g, gi) => (
              <div key={g.game_id} style={{
                position: 'absolute',
                top:  gi * slotH + (slotH - CARD_H) / 2 + yOff,
                left: ri * (CARD_W + COL_GAP),
              }}>
                <BracketMatchup game={g} navigate={navigate} />
              </div>
            ));
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Finishers helpers ── */
function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function deriveFinishers(allGames, selectedDiv) {
  const cleanN = n => n ? n.replace(/\s*\(.*?\)\s*/g, '').trim() : n;
  const games  = selectedDiv ? allGames.filter(g => g.division_label === selectedDiv) : allGames;
  const finals = games.filter(g => {
    return getRoundPriority(g.round) === 4 && g.home_score != null && g.away_score != null;
  });

  // Group by base placement number
  const byPlace = {};
  for (const g of finals) {
    const label = g.bracket_section || g.round_context || '';
    let bp = null;
    const ms = label.match(/(\d+)(?:st|nd|rd|th)/i);
    if (ms) bp = parseInt(ms[1]);
    else {
      const mr = (g.round || '').match(/(\d+)(?:st|nd|rd|th)/i);
      bp = mr ? parseInt(mr[1]) : 1;
    }
    if (!byPlace[bp]) byPlace[bp] = [];
    byPlace[bp].push(g);
  }

  const placements = [];
  for (const [bpStr, gs] of Object.entries(byPlace)) {
    const bp = parseInt(bpStr);
    if (bp > 16) continue;
    gs.forEach((g, idx) => {
      const homeWins = g.home_score > g.away_score;
      const wp = bp + idx * 2, lp = bp + idx * 2 + 1;
      if (wp <= 16) placements.push({ place: wp, team: cleanN(homeWins ? g.home_team : g.away_team), logo: homeWins ? g.home_logo : g.away_logo });
      if (lp <= 16) placements.push({ place: lp, team: cleanN(homeWins ? g.away_team : g.home_team), logo: homeWins ? g.away_logo : g.home_logo });
    });
  }
  return placements.sort((a, b) => a.place - b.place);
}

const CHIP_H = Math.round(CARD_H / 2);

function FinishersGrid({ games, selectedDiv, nationalsFinishers }) {
  const finishers = nationalsFinishers ?? deriveFinishers(games, selectedDiv);
  // Always render 16 slots — fill gaps with empty placeholders so the grid is a fixed size.
  // Tied teams share the same place number (e.g. T7 → both have place 7); bump the second
  // to the next empty slot so neither is dropped.
  const GRID_SIZE = 16;
  const byPlace = {};
  for (const f of finishers) {
    let p = f.place;
    while (byPlace[p]) p++;
    byPlace[p] = f;
  }
  const slots = Array.from({ length: GRID_SIZE }, (_, i) => byPlace[i + 1] ?? { place: i + 1, team: null, logo: null });
  return (
    <div style={{ padding: '24px 24px 28px', borderTop: '1px solid rgba(255,255,255,0.18)' }}>
      <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: '#fff', marginBottom: 12 }}>Final Standings</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {slots.map(f => f.team ? (
            <div key={f.place} style={{
              position: 'relative', overflow: 'hidden',
              height: CHIP_H, borderRadius: 5,
              border: '1px solid var(--surf-border)',
              background: 'var(--card-bg)',
              display: 'flex', alignItems: 'center', padding: '0 10px', gap: 6,
            }}>
              {/* watermark */}
              {f.logo && <div style={{
                position: 'absolute', inset: 0,
                backgroundImage: `url(${usauLogo(f.logo)})`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'center',
                backgroundSize: `${CHIP_H * 0.85}px ${CHIP_H * 0.85}px`,
                opacity: 0.09,
                pointerEvents: 'none',
              }} />}
              {/* visible logo */}
              <img
                src={f.logo ? usauLogo(f.logo) : USAU_ICON} alt={f.team ?? ''}
                style={{ height: 18, width: 18, objectFit: 'contain', flexShrink: 0, position: 'relative' }}
                onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = USAU_ICON; }}
              />
              {/* team name */}
              <span style={{
                fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '0.3px',
                color: 'var(--t-primary)', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0,
                position: 'relative',
              }}>{f.team}</span>
              {/* placement */}
              <span style={{
                flexShrink: 0, position: 'relative',
                fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px',
                textTransform: 'uppercase',
                color: f.place <= 3 ? ORANGE : 'var(--t-muted)',
              }}>{ordinal(f.place)}</span>
            </div>
          ) : (
            <div key={f.place} style={{ height: CHIP_H }} />
        ))}
      </div>
    </div>
  );
}

const NATIONALS_RE = /national|college.champion|club.champion/i;

/* ── Right panel: championship bracket for selected tournament ── */
function TournamentGamesPanel({ tournament: t }) {
  const navigate = useNavigate();
  const [games,        setGames]        = useState([]);
  const [gStatus,      setGStatus]      = useState('idle');
  const [selectedSlot, setSelectedSlot] = useState(null); // { div, ctx }
  const [natFinishers, setNatFinishers] = useState(null);

  // Helpers derived from slot
  const selectedDiv = selectedSlot?.div ?? null;
  const selectedCtx = selectedSlot?.ctx ?? null;

  // Compute the ordered flat list of (div, ctx) slots from bracket games
  const bracketSlots = (gs) => {
    const seen = new Map();
    for (const g of gs.filter(isChampionshipGame)) {
      const div = g.division_label || '';
      const ctx = g.round_context   || null;
      const key = `${div}||${ctx}`;
      if (!seen.has(key)) seen.set(key, { div, ctx });
    }
    return [...seen.values()];
  };

  useEffect(() => {
    if (!t) return;
    setGames([]); setGStatus('loading'); setSelectedSlot(null);
    fetch(`/api/usau/tournament/${encodeURIComponent(t.event_slug)}/games`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const gs = d?.games || [];
        setGames(gs);
        setGStatus('ready');
        setNatFinishers(null);
        const slots = bracketSlots(gs);
        setSelectedSlot(slots[0] ?? null);
      })
      .catch(() => setGStatus('error'));
  }, [t?.event_slug]);

  // Fetch nationals finish data when this is a nationals-type tournament
  useEffect(() => {
    if (!t || !selectedDiv || !NATIONALS_RE.test(t.event_slug)) return;
    setNatFinishers(null);
    fetch(`/api/usau/tournament/${encodeURIComponent(t.event_slug)}/nationals?division_label=${encodeURIComponent(selectedDiv)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.finishers?.length) setNatFinishers(d.finishers); })
      .catch(() => {});
  }, [t?.event_slug, selectedDiv]);

  if (!t) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.5 }}>Select a tournament to preview</div>
    </div>
  );

  const location = [t.city, t.state].filter(Boolean).join(', ');

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Tournament header */}
      <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--surf-border)', position: 'relative', overflow: 'hidden', flexShrink: 0, background: 'var(--card-bg)' }}>
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(234,96,32,0.10) 0%, transparent 60%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* Top row: year/location left, division toggle right */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: ORANGE, opacity: 0.8 }}>
              <span>{t.season_year}{location ? ` \u00b7 ${location}` : ''}</span>
              {t.divisions && <DivChips divisions={t.divisions} />}
            </div>
            {gStatus === 'ready' && (() => {
              const slots = bracketSlots(games);
              if (slots.length < 2) return null;
              return (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
                  {slots.map(slot => {
                    const key    = `${slot.div}||${slot.ctx}`;
                    const active = selectedSlot && `${selectedSlot.div}||${selectedSlot.ctx}` === key;
                    const label  = slotLabel(slot, slots);
                    return (
                      <button key={key} onClick={() => setSelectedSlot(slot)} style={{
                        fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase',
                        padding: '3px 8px', borderRadius: 3,
                        border: `1px solid ${active ? ORANGE : 'rgba(234,96,32,0.45)'}`,
                        background: active ? ORANGE : 'transparent',
                        color: active ? '#fff' : ORANGE,
                        cursor: 'pointer', transition: 'all .12s',
                      }}>{label}</button>
                    );
                  })}
                </div>
              );
            })()}
          </div>
          <div style={{ fontFamily: 'var(--font-h1)', fontSize: 16, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '-0.02em', color: 'var(--t-primary)', marginBottom: 4 }}>
            {t.event_title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1px', color: 'var(--t-muted)' }}>{dateRange(t.date_start, t.date_end)}</span>
            {t.event_url && (
              <a href={t.event_url} target="_blank" rel="noopener noreferrer"
                style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)', textDecoration: 'none' }}
                onMouseEnter={e => { e.currentTarget.style.color = ORANGE; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-muted)'; }}
              >USAU Page ↗</a>
            )}
          </div>
        </div>
      </div>

      {gStatus === 'loading' && (
        <div style={{ padding: '32px 0', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.5 }}>Loading…</div>
      )}
      {gStatus === 'ready' && games.length === 0 && (
        <div style={{ padding: '48px 0', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', opacity: 0.4 }}>No game data available</div>
      )}
      {gStatus === 'ready' && games.length > 0 && (
        <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          <ChampionshipBracket games={games} navigate={navigate} selectedDiv={selectedDiv} selectedCtx={selectedCtx} eventSlug={t?.event_slug} />
        </div>
      )}
      {gStatus === 'ready' && games.length > 0 && (
        <div style={{ flexShrink: 0 }}>
          <FinishersGrid games={games} selectedDiv={selectedDiv} nationalsFinishers={natFinishers} />
        </div>
      )}
    </div>
  );
}

/* ── Pager ── */
function Pager({ page, totalPages, onPage, total, pageSize, scrollbarW = 0 }) {
  if (total === 0) return null;
  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  return (
    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `10px ${24 + scrollbarW}px 14px 24px` }}>
      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>
        {start}–{end} of {total}
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => onPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ height: 28, padding: '0 12px', borderRadius: 4, border: `1px solid ${ORANGE}`, background: 'var(--card-bg)', color: ORANGE, fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1px', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}>← Prev</button>
        <button onClick={() => onPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={{ height: 28, padding: '0 12px', borderRadius: 4, border: `1px solid ${ORANGE}`, background: 'var(--card-bg)', color: ORANGE, fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1px', cursor: page >= totalPages - 1 ? 'default' : 'pointer', opacity: page >= totalPages - 1 ? 0.4 : 1 }}>Next →</button>
      </div>
    </div>
  );
}

/* ── Division letter chips ── */
const DIV_ORDER = ['M','S','A','B','C','D','X'];
function DivChips({ divisions = '', selected = false }) {
  if (!divisions) return <span style={{ color: selected ? 'rgba(255,255,255,0.5)' : 'var(--t-muted)', fontSize: 10 }}>—</span>;
  return (
    <div style={{ display: 'flex', gap: 2, flexWrap: 'nowrap', alignItems: 'center' }}>
      {divisions.split('').map(c => (
        <span key={c} style={{
          fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: 0,
          padding: '1px 4px', borderRadius: 3, lineHeight: 1.6,
          background: selected ? 'rgba(255,255,255,0.25)' : 'rgba(234,96,32,0.15)',
          color: selected ? '#fff' : ORANGE,
          border: `1px solid ${selected ? 'rgba(255,255,255,0.35)' : 'rgba(234,96,32,0.35)'}`,
        }}>{c}</span>
      ))}
    </div>
  );
}

function useDebounce(val, ms = 300) {
  const [v, setV] = useState(val);
  useEffect(() => { const t = setTimeout(() => setV(val), ms); return () => clearTimeout(t); }, [val, ms]);
  return v;
}

const CACHE_KEY = 'usau_tournaments_view_state';
function loadCache() {
  try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null') || {}; } catch { return {}; }
}

/* ── Main page ── */
export default function USAUTournamentsPage() {
  const scrollRef = useRef(null);
  const [scrollbarW, setScrollbarW] = useState(0);
  useEffect(() => {
    if (scrollRef.current) setScrollbarW(scrollRef.current.offsetWidth - scrollRef.current.clientWidth);
  });

  const _c = useRef(loadCache()).current;

  const [tournaments,        setTournaments]        = useState([]);
  const [years,              setYears]              = useState([]);
  const [levels,             setLevels]             = useState([]);
  const [status,             setStatus]             = useState('loading');
  const [query,              setQuery]              = useState(_c.query       ?? '');
  const [yearFilter,         setYearFilter]         = useState(_c.yearFilter  ?? '');
  const [levelFilter,        setLevelFilter]        = useState(_c.levelFilter ?? '');
  const [sortKey,            setSortKey]            = useState(_c.sortKey     ?? 'date_start');
  const [sortDir,            setSortDir]            = useState(_c.sortDir     ?? -1);
  const [page,               setPage]               = useState(_c.page        ?? 0);
  const [selectedTournament, setSelectedTournament] = useState(_c.selectedTournament ?? null);

  const dq = useDebounce(query);

  useEffect(() => {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ query, yearFilter, levelFilter, sortKey, sortDir, page, selectedTournament }));
  }, [query, yearFilter, levelFilter, sortKey, sortDir, page, selectedTournament]);

  const _mounted = useRef(false);
  useEffect(() => {
    if (!_mounted.current) { _mounted.current = true; return; }
    setPage(0);
  }, [dq, yearFilter, levelFilter, sortKey, sortDir]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    const params = new URLSearchParams({ limit: '500' });
    if (dq)          params.set('q',     dq);
    if (yearFilter)  params.set('year',  yearFilter);
    if (levelFilter) params.set('level', levelFilter);
    fetch(`/api/usau/tournaments?${params}`)
      .then(r => r.json())
      .then(d => {
        if (!cancelled) {
          setTournaments(d.tournaments || []);
          setYears(d.years   || []);
          setLevels(d.levels || []);
          setStatus('ready');
        }
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [dq, yearFilter, levelFilter]);

  const filtered = useMemo(() => {
    return [...tournaments].filter(t => !/cancelled/i.test(t.event_name ?? '')).sort((a, b) => {
      const av = a[sortKey] ?? ''; const bv = b[sortKey] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
  }, [tournaments, sortKey, sortDir]);

  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (!autoSelectedRef.current && filtered.length > 0) {
      setSelectedTournament(filtered[0]);
      autoSelectedRef.current = true;
    }
  }, [filtered]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(-1); }
  }

  function SortTh({ label, field, style = {} }) {
    const active = sortKey === field;
    return (
      <th onClick={() => toggleSort(field)} style={{ padding: '10px 12px', textAlign: 'left', fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', background: 'var(--thead-bg)', ...style, color: active ? ORANGE : 'var(--t-muted)' }}>
        {label}{active ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}
      </th>
    );
  }

  const selStyle = { height: 32, padding: '0 10px', borderRadius: 6, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--input-clr)', fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1px', outline: 'none', cursor: 'pointer' };

  const PAGE_SIZE_TABLE = 50;
  const PAGE_SIZE = PAGE_SIZE_TABLE;
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <LeagueShell league="usau">
      {/* ── Header ── */}
      <div style={{ padding: '28px 32px 20px', borderBottom: '1px solid var(--nav-border)', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, flexShrink: 0, background: 'var(--card-bg)' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--orange)', opacity: 0.7, marginBottom: 6 }}>USA Ultimate</div>
          <div style={{ fontFamily: 'var(--font-h1)', fontSize: 'clamp(1.5rem, 2.5vw, 2rem)', letterSpacing: '-0.02em', textTransform: 'uppercase', color: 'var(--t-primary)', marginBottom: 6 }}>
            Tournament Center
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} style={selStyle}>
              <option value="">All Years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select value={levelFilter} onChange={e => setLevelFilter(e.target.value)} style={selStyle}>
              <option value="">All Levels</option>
              {levels.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search tournaments, city, state\u2026"
              style={{ width: 260, height: 36, padding: '0 14px', borderRadius: 8, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--input-clr)', fontFamily: 'var(--font-body)', fontSize: 12, outline: 'none', boxSizing: 'border-box' }}
            />
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>

        {/* ── Left: Tournament list ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'clip', borderRight: '1px solid var(--nav-border)' }}>
          {status === 'loading' && (
            <div style={{ padding: '48px 0', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>Loading\u2026</div>
          )}
          {status === 'error' && (
            <div style={{ padding: '48px 0', textAlign: 'center', fontFamily: 'var(--font-body)', color: 'var(--t-muted)' }}>Could not load tournaments.</div>
          )}
          {status === 'ready' && tournaments.length === 0 && (
            <div style={{ padding: '64px 0', textAlign: 'center', fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)' }}>No tournaments found.</div>
          )}

          {/* Fixed table header */}
          {status === 'ready' && tournaments.length > 0 && (
            <div style={{ flexShrink: 0, marginTop: 16, paddingLeft: 24, paddingRight: 24 + scrollbarW }}>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 38 }} />
                  <col />
                  <col style={{ width: 56 }} />
                  <col style={{ width: 62 }} />
                  <col style={{ width: 44 }} />
                </colgroup>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--surf-border)' }}>
                    <SortTh label="Year"       field="season_year" style={{ textAlign: 'center' }} />
                    <SortTh label="Tournament" field="event_title" />
                    <SortTh label="Div"        field="divisions"   style={{ textAlign: 'center' }} />
                    <SortTh label="Date"       field="date_start"  style={{ textAlign: 'center' }} />
                    <SortTh label="Teams"      field="team_count"  style={{ textAlign: 'center' }} />
                  </tr>
                </thead>
              </table>
            </div>
          )}

          {/* Table view */}
          {status === 'ready' && tournaments.length > 0 && (
            <>
              <div ref={scrollRef} className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'scroll', overflowX: 'auto', paddingLeft: 24, paddingRight: 24, paddingBottom: 8 }}>
                <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: 38 }} />
                    <col />
                    <col style={{ width: 56 }} />
                    <col style={{ width: 62 }} />
                    <col style={{ width: 44 }} />
                  </colgroup>
                  <tbody>
                    {slice.map(t => {
                      const isSel = selectedTournament?.event_slug === t.event_slug;
                      const cellMuted   = isSel ? 'rgba(255,255,255,0.8)' : 'var(--t-muted)';
                      const cellPrimary = isSel ? 'white' : 'var(--t-primary)';
                      return (
                        <tr
                          key={t.event_slug}
                          style={{ borderBottom: '1px solid var(--surf-border)', background: isSel ? ORANGE : 'var(--card-bg)', cursor: 'pointer', transition: 'background .1s' }}
                          onClick={() => setSelectedTournament(t)}
                          onMouseEnter={e => { if (!isSel) e.currentTarget.style.boxShadow = 'inset 0 0 0 1000px rgba(234,96,32,0.22)'; }}
                          onMouseLeave={e => { if (!isSel) e.currentTarget.style.boxShadow = 'none'; }}
                        >
                          <td style={{ padding: '10px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, color: cellMuted, textAlign: 'center' }}>{t.season_year ?? '\u2014'}</td>
                          <td style={{ padding: '10px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, color: cellPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.event_title ?? '\u2014'}</td>
                          <td style={{ padding: '8px 12px', verticalAlign: 'middle', textAlign: 'center' }}><DivChips divisions={t.divisions} selected={isSel} /></td>
                          <td style={{ padding: '8px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, color: cellMuted, whiteSpace: 'nowrap', textAlign: 'center' }}>{dateRange(t.date_start, t.date_end)}</td>
                          <td style={{ padding: '8px 12px', fontFamily: 'var(--font-h2)', fontSize: 11, color: t.team_count > 0 ? cellPrimary : cellMuted, textAlign: 'center' }}>{t.team_count || '\u2014'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Pager page={page} totalPages={totalPages} onPage={setPage} total={filtered.length} pageSize={PAGE_SIZE_TABLE} scrollbarW={scrollbarW} />
            </>
          )}


        </div>

        {/* ── Right: Tournament games panel ── */}
        <div style={{ flex: 2, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 16 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <TournamentGamesPanel tournament={selectedTournament} />
          </div>
        </div>
      </div>
    </LeagueShell>
  );
}
