import React, { useState, useEffect, useMemo, useRef } from 'react';
import LeagueShell from '../components/LeagueShell.jsx';
import { OUTCOME_LIST } from '../components/ShotChart.jsx';

const ORANGE = '#EA6020';

// SVG coordinate space mirrored from UFATeamPage
const SVG_X0 = 5, SVG_Y0 = 5, SVG_W = 200, SVG_H = 450;
const EZ_H = 75;
const PLAYING_YARDS  = 80;                                             // AUDL playing field
const DEF_GOAL_Y     = SVG_Y0 + SVG_H - EZ_H;                        // 380 – defending goal line
const ATK_GOAL_Y     = SVG_Y0 + EZ_H;                                // 80  – attacking goal line
const SVG_PER_YARD   = (DEF_GOAL_Y - ATK_GOAL_Y) / PLAYING_YARDS;   // 3.75
const YARD_MARKS     = Array.from({ length: 15 }, (_, i) => {
  const yd = (i + 1) * 5;
  return { y: DEF_GOAL_Y - yd * SVG_PER_YARD, major: yd % 10 === 0, label: Math.min(yd, PLAYING_YARDS - yd) };
});

// Canvas resolution – 4K: render at 8× the base 450×200 KDE grid
const CANVAS_W = 3600;   // 450 × 8
const CANVAS_H = 1600;   // 200 × 8
const CS = CANVAS_W / 450; // coordinate scale factor (= 8)

// Heat map – Gaussian KDE
const SOURCE_RADIUS_YARDS = 0.5;                              // data-collection radius (granularity)
const SOURCE_RADIUS    = SOURCE_RADIUS_YARDS * SVG_PER_YARD;  // 1.875 canvas px
const PIN_RADIUS_YARDS   = 3;                                  // visual drop-pin circle
const PIN_RADIUS         = PIN_RADIUS_YARDS   * SVG_PER_YARD;  // 11.25 canvas px
const DEST_RADIUS_YARDS  = 0.5;
const DEST_RADIUS        = DEST_RADIUS_YARDS  * SVG_PER_YARD;  // 1.875 canvas px — point-query radius
const DEST_RADIUS_SQ     = DEST_RADIUS * DEST_RADIUS;          // kept for point-query radius filter
const COMP_SIGMA         = 5 * SVG_PER_YARD;   // 18.75 px ≈ 5 yd — completion KDE bandwidth
const XG_SIGMA           = 9 * SVG_PER_YARD;   // 33.75 px ≈ 9 yd — xG KDE bandwidth (wider for league coverage)

const OUTCOME_COLOR = Object.fromEntries(OUTCOME_LIST.map(o => [o.key, o.color]));

const LABEL = {
  fontFamily: 'var(--font-h2)',
  fontSize: 9,
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color: 'var(--t-muted)',
  marginBottom: 5,
  display: 'block',
};

const SEL_STYLE = {
  background: 'var(--input-bg)',
  border: '1px solid var(--input-border)',
  color: 'var(--input-clr)',
  borderRadius: 6,
  padding: '7px 10px',
  fontFamily: 'var(--font-h2)',
  fontSize: 12,
  outline: 'none',
  cursor: 'pointer',
};

const UFA_SEASONS = [2026, 2025, 2024, 2023, 2022, 2021];
const UFA_YEAR_MIN = 2021;
const UFA_YEAR_MAX = new Date().getFullYear();

// rate 0-1 → [r, g, b]  thermal scale: blue → cyan → green → yellow → red
const THERMAL_STOPS = [
  [0.00, [  0,   0, 220]],
  [0.25, [  0, 210, 255]],
  [0.50, [ 20, 230,  80]],
  [0.75, [255, 220,   0]],
  [1.00, [255,  20,   0]],
];
function rateToRGB(rate) {
  const t = Math.max(0, Math.min(1, rate));
  for (let i = 1; i < THERMAL_STOPS.length; i++) {
    const [t0, c0] = THERMAL_STOPS[i - 1];
    const [t1, c1] = THERMAL_STOPS[i];
    if (t <= t1) {
      const s = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * s),
        Math.round(c0[1] + (c1[1] - c0[1]) * s),
        Math.round(c0[2] + (c1[2] - c0[2]) * s),
      ];
    }
  }
  return THERMAL_STOPS[THERMAL_STOPS.length - 1][1];
}

function RangeSlider({ min, max, value, onChange, maxSpan }) {
  const [lo, hi] = value;
  const pct = v => ((v - min) / (max - min)) * 100;
  return (
    <div style={{ paddingTop: 2 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-h2)', fontSize: 10, color: ORANGE, marginBottom: 6 }}>
        <span>{lo}</span><span>{hi}</span>
      </div>
      <div className="range-wrap">
        <div className="range-track" />
        <div className="range-fill" style={{ left: `${pct(lo)}%`, width: `${pct(hi) - pct(lo)}%` }} />
        <input type="range" min={min} max={max} step={1} value={lo}
          onChange={e => {
            const newLo = Math.min(+e.target.value, hi - 1);
            onChange([newLo, maxSpan != null ? Math.min(hi, newLo + maxSpan) : hi]);
          }} />
        <input type="range" min={min} max={max} step={1} value={hi}
          onChange={e => {
            const newHi = Math.max(+e.target.value, lo + 1);
            onChange([maxSpan != null ? Math.max(lo, newHi - maxSpan) : lo, newHi]);
          }} />
      </div>
    </div>
  );
}

function Field2D({ selectedPoint, onPointClick, heatMapThrows = [], allThrows = [], layerMode = 'completion', fieldValueGrid = [] }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    // Blit a 450×200 ImageData onto the full 4K canvas via bilinear interpolation
    function blitKDE(imgData) {
      const tmp = new OffscreenCanvas(450, 200);
      tmp.getContext('2d').putImageData(imgData, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(tmp, 0, 0, CANVAS_W, CANVAS_H);
    }

    // ── COMPLETION MODE: Gaussian KDE on throw destinations ──
    if (layerMode === 'completion' && selectedPoint && heatMapThrows.length > 0) {
      const SIGMA     = COMP_SIGMA;
      const INV_2SIG2 = 1 / (2 * SIGMA * SIGMA);
      const spread    = Math.ceil(2.5 * SIGMA);
      const comp = new Float32Array(450 * 200);
      const tot  = new Float32Array(450 * 200);
      for (const t of heatMapThrows) {
        const rx = t.svg_recv_x ?? t.turnover_x;
        const ry = t.svg_recv_y ?? t.turnover_y;
        if (rx == null || ry == null) continue;
        const ci = 455 - ry;
        const cj = rx - 5;
        const isComp = t.pbp_throw_type === 'pass' || t.pbp_throw_type === 'score';
        const imin = Math.max(0,   Math.floor(ci - spread));
        const imax = Math.min(449, Math.ceil(ci  + spread));
        const jmin = Math.max(0,   Math.floor(cj - spread));
        const jmax = Math.min(199, Math.ceil(cj  + spread));
        for (let i = imin; i <= imax; i++) {
          for (let j = jmin; j <= jmax; j++) {
            const di = i - ci, dj = j - cj;
            const d2 = di * di + dj * dj;
            const w = Math.exp(-d2 * INV_2SIG2);
            const idx = j * 450 + i;
            tot[idx] += w;
            if (isComp) comp[idx] += w;
          }
        }
      }
      const imgData = ctx.createImageData(450, 200);
      for (let j = 0; j < 200; j++) {
        for (let i = 0; i < 450; i++) {
          const idx = j * 450 + i;
          const pix = idx * 4;
          if (tot[idx] < 0.3) { imgData.data[pix + 3] = 0; continue; }
          const rate = comp[idx] / tot[idx];
          const [r, g, b] = rateToRGB(rate);
          imgData.data[pix]     = r;
          imgData.data[pix + 1] = g;
          imgData.data[pix + 2] = b;
          imgData.data[pix + 3] = Math.min(210, Math.round(30 + tot[idx] * 22));
        }
      }
      blitKDE(imgData);
    }

    // ── XGOAL MODE: Gaussian KDE on throw origins, terminal throws only ──
    if (layerMode === 'xgoal' && allThrows.length > 0) {
      const SIGMA     = XG_SIGMA;
      const INV_2SIG2 = 1 / (2 * SIGMA * SIGMA);
      const spread    = Math.ceil(2.5 * SIGMA);
      const comp = new Float32Array(450 * 200);
      const tot  = new Float32Array(450 * 200);
      for (const t of allThrows) {
        const ox = t.svg_throw_x;
        const oy = t.svg_throw_y;
        if (ox == null || oy == null) continue;
        const isScore    = t.pbp_throw_type === 'score';
        const isTurnover = t.pbp_throw_type === 'drop' || t.pbp_throw_type === 'throwaway' || t.pbp_throw_type === 'stall';
        if (!isScore && !isTurnover) continue;
        const ci = 455 - oy;
        const cj = ox - 5;
        const imin = Math.max(0,   Math.floor(ci - spread));
        const imax = Math.min(449, Math.ceil(ci  + spread));
        const jmin = Math.max(0,   Math.floor(cj - spread));
        const jmax = Math.min(199, Math.ceil(cj  + spread));
        for (let i = imin; i <= imax; i++) {
          for (let j = jmin; j <= jmax; j++) {
            const di = i - ci, dj = j - cj;
            const d2 = di * di + dj * dj;
            const w = Math.exp(-d2 * INV_2SIG2);
            const idx = j * 450 + i;
            tot[idx] += w;
            if (isScore) comp[idx] += w;
          }
        }
      }
      const imgData = ctx.createImageData(450, 200);
      for (let j = 0; j < 200; j++) {
        for (let i = 0; i < 450; i++) {
          const idx = j * 450 + i;
          const pix = idx * 4;
          if (tot[idx] < 0.3) { imgData.data[pix + 3] = 0; continue; }
          const rate = comp[idx] / tot[idx];
          const [r, g, b] = rateToRGB(rate);
          imgData.data[pix]     = r;
          imgData.data[pix + 1] = g;
          imgData.data[pix + 2] = b;
          imgData.data[pix + 3] = Math.min(210, Math.round(40 + tot[idx] * 18));
        }
      }
      blitKDE(imgData);

      // ── Topo contour lines (iso-contours every 0.05; thick + numbered every 0.10) ──
      // All vector drawing uses CS-scaled coordinates so lines are crisp at 4K
      {
        const rateGrid = new Float32Array(90000);
        for (let idx = 0; idx < 90000; idx++) {
          if (tot[idx] >= 0.3) rateGrid[idx] = comp[idx] / tot[idx];
        }

        ctx.save();
        for (let step = 1; step <= 19; step++) {
          const level   = step * 0.05;
          const isMajor = step % 2 === 0;

          ctx.beginPath();
          // Horizontal edges
          for (let j = 0; j < 199; j++) {
            for (let i = 0; i < 450; i++) {
              const i0 = j * 450 + i, i1 = (j + 1) * 450 + i;
              if (tot[i0] < 0.3 || tot[i1] < 0.3) continue;
              if ((rateGrid[i0] < level) === (rateGrid[i1] < level)) continue;
              const t = (level - rateGrid[i0]) / (rateGrid[i1] - rateGrid[i0]);
              ctx.moveTo( i      * CS, (j + t) * CS);
              ctx.lineTo((i + 1) * CS, (j + t) * CS);
            }
          }
          // Vertical edges
          for (let j = 0; j < 200; j++) {
            for (let i = 0; i < 449; i++) {
              const i0 = j * 450 + i, i1 = j * 450 + i + 1;
              if (tot[i0] < 0.3 || tot[i1] < 0.3) continue;
              if ((rateGrid[i0] < level) === (rateGrid[i1] < level)) continue;
              const t = (level - rateGrid[i0]) / (rateGrid[i1] - rateGrid[i0]);
              ctx.moveTo((i + t) * CS,  j      * CS);
              ctx.lineTo((i + t) * CS, (j + 1) * CS);
            }
          }
          ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.80)' : 'rgba(255,255,255,0.28)';
          ctx.lineWidth   = isMajor ? 2.5 * CS : 0.7 * CS;
          ctx.stroke();

          if (isMajor) {
            const label = level.toFixed(2);
            ctx.font          = `bold ${8 * CS}px sans-serif`;
            ctx.textAlign     = 'center';
            ctx.textBaseline  = 'middle';
            ctx.fillStyle     = 'white';
            ctx.shadowColor   = 'rgba(0,0,0,0.85)';
            ctx.shadowBlur    = 3 * CS;
            for (const col of [55, 140, 225, 310, 395]) {
              for (let j = 2; j < 197; j++) {
                const i0 = j * 450 + col, i1 = (j + 1) * 450 + col;
                if (tot[i0] < 0.3 || tot[i1] < 0.3) continue;
                if ((rateGrid[i0] < level) !== (rateGrid[i1] < level)) {
                  const t = (level - rateGrid[i0]) / (rateGrid[i1] - rateGrid[i0]);
                  ctx.fillText(label, col * CS, (j + t) * CS);
                  break;
                }
              }
            }
          }
        }
        ctx.shadowBlur = 0;
        ctx.restore();
      }
    }

    // ── FIELD VALUE MODE: model scoring-probability surface ──
    if (layerMode === 'fieldvalue' && fieldValueGrid.length > 0) {
      const FV_XN = 51;   // x: -25 … 25
      const FV_YN = 101;  // y:   0 … 100
      const fvLookup = new Float32Array(FV_XN * FV_YN);
      let fvMin = Infinity, fvMax = -Infinity;
      for (const pt of fieldValueGrid) {
        const xi = pt.thrower_x + 25;
        const yi = pt.thrower_y;
        if (xi >= 0 && xi < FV_XN && yi >= 0 && yi < FV_YN) {
          fvLookup[yi * FV_XN + xi] = pt.fv_predicted;
          if (pt.fv_predicted < fvMin) fvMin = pt.fv_predicted;
          if (pt.fv_predicted > fvMax) fvMax = pt.fv_predicted;
        }
      }
      const fvRange = fvMax - fvMin || 1;
      const imgData = ctx.createImageData(450, 200);
      for (let j = 0; j < 200; j++) {        // canvas-y → lateral (thrower_x)
        for (let i = 0; i < 450; i++) {      // canvas-x → longitudinal (thrower_y)
          const fy = (i - 75) / 3.0;        // thrower_y: 0=def goal, 100=atk goal
          const fx = (j - 100) / 3.75;      // thrower_x: -25 … 25
          if (fy < 0 || fy > 100 || fx < -25 || fx > 25) continue;
          const fy0 = Math.floor(fy), fy1 = Math.min(100, fy0 + 1);
          const fx0 = Math.max(-25, Math.floor(fx)), fx1 = Math.min(25, fx0 + 1);
          const ty = fy - fy0, tx = fx - fx0;
          const xi0 = fx0 + 25, xi1 = Math.min(50, fx1 + 25);
          const fv = (1 - ty) * ((1 - tx) * fvLookup[fy0 * FV_XN + xi0] + tx * fvLookup[fy0 * FV_XN + xi1])
                   +      ty  * ((1 - tx) * fvLookup[fy1 * FV_XN + xi0] + tx * fvLookup[fy1 * FV_XN + xi1]);
          const norm = (fv - fvMin) / fvRange;   // stretch to full 0-1 colour range
          const [r, g, b] = rateToRGB(norm);
          const pix = (j * 450 + i) * 4;
          imgData.data[pix]     = r;
          imgData.data[pix + 1] = g;
          imgData.data[pix + 2] = b;
          imgData.data[pix + 3] = 170;
        }
      }
      blitKDE(imgData);
    }

    // ── Source-radius circle + contextual label ──
    if (selectedPoint) {
      const [spx, spy] = selectedPoint;
      const si = (455 - spy) * CS;
      const sj = (spx - 5)   * CS;

      let labelText = null;
      if (layerMode === 'completion' && heatMapThrows.length > 0) {
        const scores    = heatMapThrows.filter(t => t.pbp_throw_type === 'score').length;
        const turnovers = heatMapThrows.filter(t => ['drop', 'throwaway', 'stall'].includes(t.pbp_throw_type)).length;
        const terminal  = scores + turnovers;
        if (terminal > 0) labelText = `${Math.round(scores / terminal * 100)}% GE`;
      } else if (layerMode === 'xgoal' && allThrows.length > 0) {
        const INV_2XG2 = 1 / (2 * XG_SIGMA * XG_SIGMA);
        let wComp = 0, wTot = 0;
        for (const t of allThrows) {
          if (t.svg_throw_x == null || t.svg_throw_y == null) continue;
          const isScore    = t.pbp_throw_type === 'score';
          const isTurnover = t.pbp_throw_type === 'drop' || t.pbp_throw_type === 'throwaway' || t.pbp_throw_type === 'stall';
          if (!isScore && !isTurnover) continue;
          const dx = t.svg_throw_x - spx, dy = t.svg_throw_y - spy;
          const d2 = dx * dx + dy * dy;
          if (d2 > DEST_RADIUS_SQ) continue;
          const w = Math.exp(-d2 * INV_2XG2);
          wTot += w;
          if (isScore) wComp += w;
        }
        if (wTot > 0.3) labelText = `xG ${(wComp / wTot).toFixed(4)}`;
      }

      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth   = 2 * CS;
      ctx.setLineDash([4 * CS, 3 * CS]);
      ctx.beginPath();
      ctx.arc(si, sj, PIN_RADIUS * CS, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(si, sj, 2.5 * CS, 0, Math.PI * 2);
      ctx.fill();

      if (labelText) {
        ctx.font          = `bold ${9 * CS}px sans-serif`;
        ctx.textAlign     = 'center';
        ctx.textBaseline  = 'bottom';
        ctx.shadowColor   = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur    = 4 * CS;
        ctx.fillStyle     = 'white';
        ctx.fillText(labelText, si, Math.max(10 * CS, sj - PIN_RADIUS * CS - 2 * CS));
      }
      ctx.restore();
    }
  }, [selectedPoint, heatMapThrows, allThrows, layerMode, fieldValueGrid]);

  function handleSvgClick(e) {
    if (!onPointClick) return;
    const svg = e.currentTarget;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const sp = pt.matrixTransform(svg.getScreenCTM().inverse());
    onPointClick([sp.y, 460 - sp.x]);
  }

  return (
    <>
    <svg
      viewBox="5 5 450 200"
      style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }}
      preserveAspectRatio="xMidYMid meet"
      onClick={handleSvgClick}
    >
      {/* translate(460,0) rotate(90) → 90° CW; attacking end (low portrait-y) lands on RIGHT */}
      <g transform="translate(460, 0) rotate(90)">
        {/* Field background */}
        <rect x={SVG_X0} y={SVG_Y0} width={SVG_W} height={SVG_H} fill="#ffffff" />
        {/* End zones */}
        <rect x={SVG_X0} y={SVG_Y0} width={SVG_W} height={EZ_H} fill="#fde8d8" />
        <rect x={SVG_X0} y={SVG_Y0 + SVG_H - EZ_H} width={SVG_W} height={EZ_H} fill="#fde8d8" />
        {/* Playing field */}
        <rect x={SVG_X0} y={SVG_Y0 + EZ_H} width={SVG_W} height={SVG_H - 2 * EZ_H} fill="#f9f9f9" />

        {/* Yard tick marks at both sidelines; labels counter-rotated to read horizontally */}
        {YARD_MARKS.map(({ y, major, label }) => {
          const tl = major ? 9 : 4.5;
          const lx1 = SVG_X0 + 14, lx2 = SVG_X0 + SVG_W - 14;
          return (
            <g key={y}>
              <line x1={SVG_X0} y1={y} x2={SVG_X0 + tl} y2={y}
                stroke={ORANGE} strokeWidth={major ? 0.7 : 0.4} opacity={major ? 0.65 : 0.35} />
              <line x1={SVG_X0 + SVG_W} y1={y} x2={SVG_X0 + SVG_W - tl} y2={y}
                stroke={ORANGE} strokeWidth={major ? 0.7 : 0.4} opacity={major ? 0.65 : 0.35} />
              {major && (
                <>
                  <text x={lx1} y={y} fontSize={7} fill={ORANGE} opacity={0.55}
                    fontFamily="var(--font-h2)" textAnchor="middle" dominantBaseline="central"
                    transform={`rotate(-90,${lx1},${y})`}>{label}</text>
                  <text x={lx2} y={y} fontSize={7} fill={ORANGE} opacity={0.55}
                    fontFamily="var(--font-h2)" textAnchor="middle" dominantBaseline="central"
                    transform={`rotate(-90,${lx2},${y})`}>{label}</text>
                </>
              )}
            </g>
          );
        })}

        {/* Border */}
        <rect x={SVG_X0} y={SVG_Y0} width={SVG_W} height={SVG_H} fill="none" stroke={ORANGE} strokeWidth={1.5} />
        {/* Goal lines */}
        <line x1={SVG_X0} y1={SVG_Y0 + EZ_H} x2={SVG_X0 + SVG_W} y2={SVG_Y0 + EZ_H} stroke={ORANGE} strokeWidth={1} />
        <line x1={SVG_X0} y1={SVG_Y0 + SVG_H - EZ_H} x2={SVG_X0 + SVG_W} y2={SVG_Y0 + SVG_H - EZ_H} stroke={ORANGE} strokeWidth={1} />
        {/* Mid-field */}
        <line x1={SVG_X0} y1={SVG_Y0 + SVG_H / 2} x2={SVG_X0 + SVG_W} y2={SVG_Y0 + SVG_H / 2} stroke={ORANGE} strokeWidth={0.5} strokeDasharray="4 3" opacity={0.5} />

        {/* Brick marks – 20 yds from each goal line, centered on field width
            Line = 3 yds (±1.5 yd) perpendicular to sideline; circle = 4 yd diameter */}
        {[ATK_GOAL_Y + 20 * SVG_PER_YARD, DEF_GOAL_Y - 20 * SVG_PER_YARD].map(y => (
          <g key={`brick-${y}`} opacity={0.6}>
            <circle cx={SVG_X0 + SVG_W / 2} cy={y} r={2 * SVG_PER_YARD}
              fill="none" stroke={ORANGE} strokeWidth={0.75} />
            <line x1={SVG_X0 + SVG_W / 2 - 1.5 * SVG_PER_YARD} y1={y}
                  x2={SVG_X0 + SVG_W / 2 + 1.5 * SVG_PER_YARD} y2={y}
                  stroke={ORANGE} strokeWidth={0.9} />
          </g>
        ))}

        {/* Reverse brick marks – center of each end zone, same size */}
        {[(SVG_Y0 + ATK_GOAL_Y) / 2, (DEF_GOAL_Y + SVG_Y0 + SVG_H) / 2].map(y => (
          <g key={`rbrick-${y}`} opacity={0.45}>
            <circle cx={SVG_X0 + SVG_W / 2} cy={y} r={2 * SVG_PER_YARD}
              fill="none" stroke={ORANGE} strokeWidth={0.75} />
            <line x1={SVG_X0 + SVG_W / 2 - 1.5 * SVG_PER_YARD} y1={y}
                  x2={SVG_X0 + SVG_W / 2 + 1.5 * SVG_PER_YARD} y2={y}
                  stroke={ORANGE} strokeWidth={0.9} />
          </g>
        ))}
      </g>
    </svg>
    <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
    </>
  );
}

export default function UFAThrowChartPage() {
  const [teams,     setTeams]     = useState([]);
  const [teamId,    setTeamId]    = useState('');
  const [opponentId, setOpponentId] = useState('');
  const [yearRange, setYearRange] = useState([UFA_YEAR_MAX - 1, UFA_YEAR_MAX]);
  const [throws,    setThrows]    = useState([]);
  const [status,    setStatus]    = useState('idle');   // idle | loading | ready | error
  const [typeFilter, setTypeFilter] = useState(new Set(['pass', 'score', 'drop', 'throwaway', 'stall']));
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [layerMode,      setLayerMode]      = useState('completion'); // 'completion' | 'xgoal' | 'fieldvalue'
  const [xgData,         setXgData]         = useState([]);
  const [fvGrid,         setFvGrid]         = useState([]);

  // Load teams on mount
  useEffect(() => {
    fetch('/api/ufa/teams')
      .then(r => r.json())
      .then(d => {
        const active = d.teams.filter(t => t.active);
        setTeams(d.teams);
        if (active.length > 0) setTeamId(active[0].team_slug);
      })
      .catch(() => {});
  }, []);

  // Fetch throws when team/year range changes — debounced 400ms
  const fetchTimer = useRef(null);
  useEffect(() => {
    if (!teamId) { setThrows([]); setStatus('idle'); return; }
    setStatus('loading');
    clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(() => {
      const years = Array.from({ length: yearRange[1] - yearRange[0] + 1 }, (_, i) => yearRange[0] + i);
      Promise.all(
        years.map(y =>
          fetch(`/api/ufa/throws/${encodeURIComponent(teamId)}/${y}`)
            .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
            .then(d => d.items ?? [])
        )
      )
        .then(results => { setThrows(results.flat()); setStatus('ready'); })
        .catch(() => setStatus('error'));
    }, 400);
    return () => clearTimeout(fetchTimer.current);
  }, [teamId, yearRange[0], yearRange[1]]);

  // Fetch league-wide xG data (all teams, terminal throws only) for xG layer
  useEffect(() => {
    fetch(`/api/ufa/xgoal?year_min=${yearRange[0]}&year_max=${yearRange[1]}`)
      .then(r => r.json())
      .then(d => setXgData(d.items ?? []))
      .catch(() => setXgData([]));
  }, [yearRange[0], yearRange[1]]);

  // Fetch field-value grid once (static, model-derived scoring probability)
  useEffect(() => {
    fetch('/api/ufa/field-value-grid')
      .then(r => r.json())
      .then(d => setFvGrid(d.items ?? []))
      .catch(() => setFvGrid([]));
  }, []);

  const filtered = useMemo(
    () => throws.filter(t =>
      typeFilter.has(t.pbp_throw_type ?? 'pass') &&
      (opponentId === '' || t.opponent_id === opponentId)
    ),
    [throws, typeFilter, opponentId],
  );

  // Opponents that actually appear in the loaded data
  const availableOpponentIds = useMemo(
    () => new Set(throws.map(t => t.opponent_id).filter(Boolean)),
    [throws],
  );

  // Auto-reset opponent if it's no longer present after a team/season change
  useEffect(() => {
    if (availableOpponentIds.size > 0 && opponentId !== '' && !availableOpponentIds.has(opponentId)) {
      setOpponentId('');
    }
  }, [availableOpponentIds]);

  const heatMapThrows = useMemo(() => {
    if (!selectedPoint) return [];
    const [spx, spy] = selectedPoint;
    const r2 = SOURCE_RADIUS * SOURCE_RADIUS;
    return filtered.filter(t => {
      if (t.svg_throw_x == null || t.svg_throw_y == null) return false;
      const dx = t.svg_throw_x - spx, dy = t.svg_throw_y - spy;
      return dx * dx + dy * dy <= r2;
    });
  }, [selectedPoint, filtered]);

  function toggleType(key) {
    setTypeFilter(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const throwCount = filtered.length;

  // Group teams by active status for the dropdown
  const activeTeams  = teams.filter(t => t.active);
  const inactiveTeams = teams.filter(t => !t.active);

  return (
    <LeagueShell league="ufa">
      {/* Header */}
      <div style={{ padding: '28px 32px 16px', flexShrink: 0, background: 'var(--card-bg)', borderBottom: '1px solid var(--nav-border)' }}>
        <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase', color: ORANGE, opacity: 0.7, marginBottom: 6 }}>
          UFA
        </div>
        <h1 style={{ fontFamily: 'var(--font-h1)', fontWeight: 600, fontSize: 'clamp(1.5rem, 2.5vw, 2rem)', color: 'var(--t-primary)', margin: '0 0 4px', letterSpacing: '-0.02em', textTransform: 'uppercase', lineHeight: 1 }}>
          Throw Chart
        </h1>
        <p style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)', margin: 0 }}>
          Visualize throw sequences and field position for any UFA team-season · powered by Shownspace data
        </p>
      </div>

      {/* Main content: full-width landscape field, then controls below */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 16, padding: '20px 32px 24px', overflowY: 'auto' }}>

        {/* Field — landscape, fills width */}
        <div style={{
          width: '100%',
          aspectRatio: '450 / 200',
          border: '1px solid var(--orange)',
          borderTop: '2px solid var(--orange)',
          overflow: 'hidden',
          background: 'var(--card-bg)',
          backdropFilter: 'var(--card-backdrop)',
          boxShadow: 'var(--card-shadow)',
          flexShrink: 0,
          position: 'relative',
        }}>
          {status === 'loading' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)', textTransform: 'uppercase', letterSpacing: '2px' }}>
              Loading…
            </div>
          )}
          {status === 'error' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--t-muted)', padding: 24, textAlign: 'center' }}>
              No Shownspace data available for this team-season.
            </div>
          )}
          {status === 'idle' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--t-muted)' }}>
              Select a team to start.
            </div>
          )}
          {status === 'ready' && filtered.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--t-muted)', padding: 24, textAlign: 'center' }}>
              No throws match the selected filters.
            </div>
          )}

          {/* Hint: completion mode needs a click; xG mode shows automatically */}
          {layerMode === 'completion' && !selectedPoint && status === 'ready' && filtered.length > 0 && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none', fontFamily: 'var(--font-h2)', fontSize: 10,
              color: 'var(--t-muted)', letterSpacing: '1.5px', textTransform: 'uppercase',
            }}>
              Click anywhere to map completion rate
            </div>
          )}

          {status === 'ready' && filtered.length > 0 && (
            <Field2D
              selectedPoint={selectedPoint}
              onPointClick={setSelectedPoint}
              heatMapThrows={heatMapThrows}
              allThrows={xgData}
              layerMode={layerMode}
              fieldValueGrid={fvGrid}
            />
          )}
        </div>

        {/* Controls row: team/season + type filters + info */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap', flexShrink: 0 }}>

          {/* Team + Season selectors */}
          <div style={{ width: 200, border: '1px solid var(--card-border-clr)', borderTop: '2px solid var(--orange)', borderRadius: 2, padding: '14px 16px', background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', boxShadow: 'var(--card-shadow)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={LABEL}>Team</span>
              <select value={teamId} onChange={e => setTeamId(e.target.value)} style={SEL_STYLE}>
                <optgroup label="Active Teams">
                  {activeTeams.map(t => (
                    <option key={t.team_slug} value={t.team_slug}>{t.team_name}</option>
                  ))}
                </optgroup>
                {inactiveTeams.length > 0 && (
                  <optgroup label="Historical Teams">
                    {inactiveTeams.map(t => (
                      <option key={t.team_slug} value={t.team_slug}>{t.team_name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={LABEL}>Opponent</span>
              <select value={opponentId} onChange={e => setOpponentId(e.target.value)} style={SEL_STYLE}>
                <option value="">All opponents</option>
                <optgroup label="Active Teams">
                  {activeTeams.filter(t => t.team_slug !== teamId).map(t => (
                    <option key={t.team_slug} value={t.team_slug}>{t.team_name}</option>
                  ))}
                </optgroup>
                {inactiveTeams.filter(t => t.team_slug !== teamId).length > 0 && (
                  <optgroup label="Historical Teams">
                    {inactiveTeams.filter(t => t.team_slug !== teamId).map(t => (
                      <option key={t.team_slug} value={t.team_slug}>{t.team_name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
              <span style={LABEL}>Season</span>
              <RangeSlider min={UFA_YEAR_MIN} max={UFA_YEAR_MAX} value={yearRange} onChange={setYearRange} />
            </div>
            <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)', marginTop: 8 }}>
              {status === 'loading'
                ? 'Loading…'
                : selectedPoint && heatMapThrows.length > 0
                  ? `${heatMapThrows.length.toLocaleString()} throw${heatMapThrows.length !== 1 ? 's' : ''} from zone`
                  : `${throwCount.toLocaleString()} throw${throwCount !== 1 ? 's' : ''}`}
            </span>
          </div>

          {/* Throw type toggle buttons + layer selector */}
          <div style={{ width: 200, border: '1px solid var(--card-border-clr)', borderTop: '2px solid var(--orange)', borderRadius: 2, padding: '14px 16px', background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', boxShadow: 'var(--card-shadow)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: 6 }}>Layer</div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
              {[['completion', 'Completion %'], ['xgoal', 'Exp. Goals'], ['fieldvalue', 'Field Value']].map(([mode, lbl]) => (
                <button key={mode} onClick={() => setLayerMode(mode)} style={{
                  flex: 1, padding: '5px 4px',
                  border: `1px solid ${layerMode === mode ? ORANGE + '99' : 'var(--surf-border)'}`,
                  borderRadius: 4,
                  background: layerMode === mode ? ORANGE + '22' : 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-h2)', fontSize: 9,
                  color: layerMode === mode ? 'var(--t-primary)' : 'var(--t-muted)',
                  textTransform: 'uppercase', letterSpacing: '0.5px',
                  transition: 'all .12s',
                }}>{lbl}</button>
              ))}
            </div>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: 10 }}>
              Throw Types
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {OUTCOME_LIST.map(o => {
                const active = typeFilter.has(o.key);
                return (
                  <button
                    key={o.key}
                    onClick={() => toggleType(o.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '5px 10px',
                      border: `1px solid ${active ? o.color + '66' : 'var(--surf-border)'}`,
                      borderRadius: 4,
                      background: active ? o.color + '18' : 'transparent',
                      cursor: 'pointer',
                      transition: 'all .12s',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <svg width={8} height={8}>
                      <circle cx={4} cy={4} r={3.5} fill={active ? o.color : 'var(--t-muted)'} />
                    </svg>
                    <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: active ? 'var(--t-primary)' : 'var(--t-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                      {o.label}
                    </span>
                    {status === 'ready' && (
                      <span style={{ fontFamily: 'var(--font-h2)', fontSize: 10, color: 'var(--t-muted)', marginLeft: 2 }}>
                        {throws.filter(t => (t.pbp_throw_type ?? 'pass') === o.key).length.toLocaleString()}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Info card */}
          <div style={{ flex: 1, minWidth: 220, border: '1px solid var(--card-border-clr)', borderTop: '2px solid var(--orange)', borderRadius: 2, padding: '14px 16px', background: 'var(--card-bg)', backdropFilter: 'var(--card-backdrop)', boxShadow: 'var(--card-shadow)' }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--t-muted)', marginBottom: 8 }}>
              How to read
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--t-muted)', lineHeight: 1.5 }}>
              {layerMode === 'completion'
                ? <>Click anywhere on the field to map completions from that spot (3-yard radius). <span style={{ color: '#00d2ff' }}>Blue</span> = low, <span style={{ color: '#ffdc00' }}>yellow</span> = mid, <span style={{ color: '#ff1400' }}>red</span> = high completion rate. Dashed circle = source zone. GE% shown above marker.</>
                : layerMode === 'xgoal'
                  ? <>Field-wide expected goal probability from each throw origin (terminal throws only). <span style={{ color: '#ff1400' }}>Red</span> = high xG, <span style={{ color: '#00d2ff' }}>blue</span> = low. Click anywhere to read the exact xG value (0.0000 scale) at that spot.</>
                  : <>Model-derived scoring probability for each field position (normalised to data range). <span style={{ color: '#ff1400' }}>Red</span> = highest probability (attacking end), <span style={{ color: '#00d2ff' }}>blue</span> = lowest (defending end). Based on {fvGrid.length.toLocaleString()} grid points.</> }
            </div>
          </div>
        </div>
      </div>
    </LeagueShell>
  );
}
