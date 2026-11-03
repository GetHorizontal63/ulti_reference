import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { sankey as d3Sankey, sankeyLinkHorizontal, sankeyLeft } from 'd3-sankey';
import PageChrome from '../components/PageChrome.jsx';
import { LEVEL_STYLE } from '../utils/levelStyles.js';
import { OUTCOME_LIST } from '../components/ShotChart.jsx';

// ── Team / league image helpers ───────────────────────────────────────────────
const TEAM_IMG = {
  PUL: {
    'Atlanta Soul':          'atl_soul',
    'Austin Torch':          'atx_torch',
    'Columbus Pride':        'clb_pride',
    'DC Shadow':             'dc_shadow',
    'Indy Red':              'ind_red',
    'LA Astra':              'la_astra',
    'Medellín Revolution':   'med_revolution',
    'Milwaukee Monarchs':    'mil_monarchs',
    'Minnesota Strike':      'mn_strike',
    'Nashville NightShade':  'nsh_nightshade',
    'New York Gridlock':     'nyc_gridlock',
    'Philadelphia Surge':    'phi_surge',
    'Portland Rising':       'pme_portlandrising',
    'Raleigh Radiance':      'ral_radiance',
  },
  MLU: {
    'Boston Whitecaps':      'bos_whitecaps',
    'DC Current':            'dc_current',
    'New York Rumble':       'nyc_rumble',
    'Portland Stags':        'pdx_stags',
    'Philadelphia Spinners': 'phi_spinners',
    'Seattle Rainmakers':    'sea_rainmakers',
    'San Francisco Dogfish': 'sf_dogfish',
    'Vancouver Nighthawks':  'van_nighthawks',
  },
  WUL: {
    'Arizona Sidewinders':   'ari_sidewinders',
    'Bay Area Falcons':      'sf_falcons',
    'Colorado Alpenglow':    'col_alpenglow',
    'Los Angeles Astra':     'la_astra',
    'Oregon Onyx':           'ore_soar',
    'Oregon Soar':           'ore_soar',
    'San Diego Super Bloom': 'sd_superbloom',
    'Seattle Tempest':       'sea_tempest',
    'Utah Wild':             'uth_wild',
  },
  UFA: {
    'Atlanta Hustle':                'atl_hustle',
    'Austin Sol':                    'atx_sol',
    'Boston Glory':                  'bos_glory',
    'Carolina Flyers':               'car_flyers',
    'Charlotte Express':             'clt_express',
    'Chicago Union':                 'chi_union',
    'Cincinnati Revolution':         'cin_revolution',
    'Colorado Apex':                 'col_apex',
    'Dallas Legion':                 'dal_legion',
    'DC Breeze':                     'dc_breeze',
    'Detroit Mechanix':              'det_mechanix',
    'Indianapolis AlleyCats':        'ind_alleycats',
    'Houston Havoc':                 'htx_havoc',
    'LA Aviators':                   'la_aviators',
    'Las Vegas Bighorns':            'lv_bighorns',
    'Madison Radicals':              'mad_radicals',
    'Minnesota Wind Chill':          'mn_windchill',
    'Montreal Royal':                'mtl_royal',
    'Nashville Nightwatch':          'nas_nightwatch',
    'New Jersey Hammerheads':        'nj_hammerheads',
    'New York Empire':               'nyc_empire',
    'Oakland Spiders':               'oak_spiders',
    'Oregon Steel':                  'ore_steel',
    'Ottawa Outlaws':                'ott_outlaws',
    'Philadelphia Phoenix':          'phi_phoenix',
    'Philadelphia Spinners':         'phi_spinners',
    'Pittsburgh Thunderbirds':       'pit_thunderbirds',
    'Raleigh Flyers':                'ral_flyers',
    'Rochester Dragons':             'roc_dragons',
    'Salt Lake Shred':               'slc_shred',
    'San Diego Growlers':            'sd_growlers',
    'Seattle Cascades':              'sea_cascades',
    'Tampa Bay Cannons':             'tb_cannons',
    'Toronto Rush':                  'tor_rush',
  },
};
const LEAGUE_ICON = {
  PUL:  '/assets/png/PULicon.png',
  UFA:  '/assets/png/UFAIcon.png',
  MLU:  '/assets/png/MLUicon.png',
  USAU: '/assets/png/USAUicon.png',
  WUL:  '/assets/png/WULicon.png',
};
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
function teamImgSrc(league, teamName) {
  const slug = TEAM_IMG[league]?.[teamName];
  if (slug) return `${BASE}/assets/png/${league}_teams/${slug}.png`;
  return LEAGUE_ICON[league] ? `${BASE}${LEAGUE_ICON[league]}` : null;
}

// ── Passing Chart constants & components ────────────────────────────────────

const ORANGE = '#EA6020';
const SVG_X0 = 5, SVG_Y0 = 5, SVG_W = 200, SVG_H = 450;
const EZ_H = 75;
const GRID_COLS = 20, GRID_ROWS = 45;
const COMPLETE_TYPES = new Set(['pass', 'score']);
const THROW_TYPES = ['pass', 'score', 'drop', 'throwaway', 'stall', 'callahan'];
const OUTCOME_COLOR = Object.fromEntries(OUTCOME_LIST.map(o => [o.key, o.color]));
const FIELD_YARDS = 100;               // chart height in yards (0 = bottom, 100 = top)
const SVG_YARD    = SVG_H / FIELD_YARDS; // 4.5 SVG units per yard
// LOS mode: normalize thrower to the 20-yard line (goal line in standard view)
const SVG_LOS_Y = Math.round(SVG_Y0 + SVG_H - 20 * SVG_YARD);
const LOS_ABS_YARD = Math.round((SVG_Y0 + SVG_H - SVG_LOS_Y) / SVG_YARD); // = 20
const LOS_ABOVE   = 100;  // yards ahead of LOS to show in LOS mode
const LOS_BELOW   = 30;   // yards behind LOS to show in LOS mode
const LOS_VIEW_Y0 = SVG_LOS_Y - LOS_ABOVE * SVG_YARD;   // = -85
const LOS_VIEW_H  = (LOS_ABOVE + LOS_BELOW) * SVG_YARD;  // = 585

const JET_STOPS = [
  [0,    0,   0,   180],
  [0.25, 0,   180, 255],
  [0.5,  0,   220,   0],
  [0.75, 255, 220,   0],
  [1,    255,   0,   0],
];
function jetRgbArr(t) {
  for (let i = 1; i < JET_STOPS.length; i++) {
    const [t0, r0, g0, b0] = JET_STOPS[i - 1];
    const [t1, r1, g1, b1] = JET_STOPS[i];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return [Math.round(r0 + f*(r1-r0)), Math.round(g0 + f*(g1-g0)), Math.round(b0 + f*(b1-b0))];
    }
  }
  return [255, 0, 0];
}

function PChartFieldOverlay() {
  return (
    <>
      <rect x={SVG_X0} y={SVG_Y0} width={SVG_W} height={SVG_H} fill="none" stroke={ORANGE} strokeWidth={1.5} />
      <line x1={SVG_X0} y1={SVG_Y0+EZ_H} x2={SVG_X0+SVG_W} y2={SVG_Y0+EZ_H} stroke="rgba(255,255,255,0.7)" strokeWidth={1} />
      <line x1={SVG_X0} y1={SVG_Y0+SVG_H-EZ_H} x2={SVG_X0+SVG_W} y2={SVG_Y0+SVG_H-EZ_H} stroke="rgba(255,255,255,0.7)" strokeWidth={1} />
      <line x1={SVG_X0} y1={SVG_Y0+SVG_H/2} x2={SVG_X0+SVG_W} y2={SVG_Y0+SVG_H/2} stroke="rgba(255,255,255,0.4)" strokeWidth={0.5} strokeDasharray="4 3" />
    </>
  );
}

function PChartGridOverlay() {
  const elems = [];
  const yMin = LOS_ABS_YARD - LOS_BELOW; // -10 absolute
  const yMax = LOS_ABS_YARD + LOS_ABOVE; // 120 absolute
  for (let yard = yMin; yard <= yMax; yard++) {
    const y = SVG_Y0 + SVG_H - yard * SVG_YARD;
    if (yard % 10 === 0) {
      elems.push(<line key={`y${yard}`} x1={SVG_X0} y1={y} x2={SVG_X0+SVG_W} y2={y}
        stroke="rgba(255,255,255,0.35)" strokeWidth={yard%20===0?0.9:0.5} />);
    } else {
      elems.push(
        <line key={`hl${yard}`} x1={SVG_X0} y1={y} x2={SVG_X0+4} y2={y} stroke="rgba(255,255,255,0.2)" strokeWidth={0.35} />,
        <line key={`hr${yard}`} x1={SVG_X0+SVG_W-4} y1={y} x2={SVG_X0+SVG_W} y2={y} stroke="rgba(255,255,255,0.2)" strokeWidth={0.35} />
      );
    }
    if ((yard - LOS_ABS_YARD) % 20 === 0) {
      const relYard = yard - LOS_ABS_YARD;
      elems.push(
        <text key={`ll${yard}`} x={SVG_X0+2.5} y={y-1.5} fontSize={7} fill="rgba(255,255,255,0.75)" fontFamily="var(--font-h2)" textAnchor="start">{relYard}</text>,
        <text key={`lr${yard}`} x={SVG_X0+SVG_W-2.5} y={y-1.5} fontSize={7} fill="rgba(255,255,255,0.75)" fontFamily="var(--font-h2)" textAnchor="end">{relYard}</text>
      );
    }
  }
  return (
    <>
      {elems}
      <rect x={SVG_X0} y={LOS_VIEW_Y0} width={SVG_W} height={LOS_VIEW_H} fill="none" stroke={ORANGE} strokeWidth={1.5} />
    </>
  );
}

function PChartField2D({ throws, losMode = false }) {
  const sample = throws.length > 4000
    ? throws.filter((_, i) => i % Math.ceil(throws.length / 4000) === 0)
    : throws;
  let bgElems;
  if (losMode) {
    const ge = [];
    const yMin = LOS_ABS_YARD - LOS_BELOW, yMax = LOS_ABS_YARD + LOS_ABOVE;
    for (let yard = yMin; yard <= yMax; yard++) {
      const y = SVG_Y0 + SVG_H - yard * SVG_YARD;
      if (yard % 10 === 0) {
        ge.push(<line key={`yl${yard}`} x1={SVG_X0} y1={y} x2={SVG_X0+SVG_W} y2={y}
          stroke={yard%20===0?'rgba(0,0,0,0.18)':'rgba(0,0,0,0.07)'} strokeWidth={yard%20===0?0.7:0.4} />);
      } else {
        ge.push(
          <line key={`hl${yard}`} x1={SVG_X0} y1={y} x2={SVG_X0+4} y2={y} stroke="rgba(0,0,0,0.07)" strokeWidth={0.35} />,
          <line key={`hr${yard}`} x1={SVG_X0+SVG_W-4} y1={y} x2={SVG_X0+SVG_W} y2={y} stroke="rgba(0,0,0,0.07)" strokeWidth={0.35} />
        );
      }
      if ((yard - LOS_ABS_YARD) % 20 === 0) {
        const relYard = yard - LOS_ABS_YARD;
        ge.push(
          <text key={`ll${yard}`} x={SVG_X0+2.5} y={y-1.5} fontSize={7} fill="rgba(0,0,0,0.25)" fontFamily="var(--font-h2)" textAnchor="start">{relYard}</text>,
          <text key={`lr${yard}`} x={SVG_X0+SVG_W-2.5} y={y-1.5} fontSize={7} fill="rgba(0,0,0,0.25)" fontFamily="var(--font-h2)" textAnchor="end">{relYard}</text>
        );
      }
    }
    bgElems = [
      <rect key="bg" x={SVG_X0} y={LOS_VIEW_Y0} width={SVG_W} height={LOS_VIEW_H} fill="#ffffff" />,
      ...ge,
      <rect key="border" x={SVG_X0} y={LOS_VIEW_Y0} width={SVG_W} height={LOS_VIEW_H} fill="none" stroke={ORANGE} strokeWidth={1.5} />,
    ];
  } else {
    bgElems = [
      <rect key="bg" x={SVG_X0} y={SVG_Y0} width={SVG_W} height={SVG_H} fill="#ffffff" />,
      <rect key="ez1" x={SVG_X0} y={SVG_Y0} width={SVG_W} height={EZ_H} fill="#fde8d8" />,
      <rect key="ez2" x={SVG_X0} y={SVG_Y0+SVG_H-EZ_H} width={SVG_W} height={EZ_H} fill="#fde8d8" />,
      <rect key="field" x={SVG_X0} y={SVG_Y0+EZ_H} width={SVG_W} height={SVG_H-2*EZ_H} fill="#f9f9f9" />,
      <rect key="border" x={SVG_X0} y={SVG_Y0} width={SVG_W} height={SVG_H} fill="none" stroke={ORANGE} strokeWidth={1.5} />,
      <line key="ez1l" x1={SVG_X0} y1={SVG_Y0+EZ_H} x2={SVG_X0+SVG_W} y2={SVG_Y0+EZ_H} stroke={ORANGE} strokeWidth={1} />,
      <line key="ez2l" x1={SVG_X0} y1={SVG_Y0+SVG_H-EZ_H} x2={SVG_X0+SVG_W} y2={SVG_Y0+SVG_H-EZ_H} stroke={ORANGE} strokeWidth={1} />,
      <line key="mid" x1={SVG_X0} y1={SVG_Y0+SVG_H/2} x2={SVG_X0+SVG_W} y2={SVG_Y0+SVG_H/2} stroke={ORANGE} strokeWidth={0.5} strokeDasharray="4 3" opacity={0.5} />,
    ];
  }
  return (
    <svg viewBox={losMode ? `${SVG_X0} ${LOS_VIEW_Y0} ${SVG_W} ${LOS_VIEW_H}` : `${SVG_X0} ${SVG_Y0} ${SVG_W} ${SVG_H}`}
         style={{ width: '100%', height: '100%', display: 'block' }}
         preserveAspectRatio="none">
      <defs><clipPath id="pc-field-clip-2d"><rect x={SVG_X0} y={losMode ? LOS_VIEW_Y0 : SVG_Y0} width={SVG_W} height={losMode ? LOS_VIEW_H : SVG_H} /></clipPath></defs>
      {bgElems}
      <g clipPath="url(#pc-field-clip-2d)">
        {sample.map((t, i) => {
          const color = OUTCOME_COLOR[t.pbp_throw_type] ?? '#999';
          const tx = t.svg_throw_x, ty = t.svg_throw_y;
          const rx = t.svg_recv_x,  ry = t.svg_recv_y;
          if (tx == null || ty == null) return null;
          if (rx == null || ry == null) {
            const s = 2.2;
            return (
              <g key={i} opacity={0.7}>
                <line x1={tx-s} y1={ty-s} x2={tx+s} y2={ty+s} stroke={color} strokeWidth={1} />
                <line x1={tx+s} y1={ty-s} x2={tx-s} y2={ty+s} stroke={color} strokeWidth={1} />
              </g>
            );
          }
          return (
            <g key={i}>
              <line x1={tx} y1={ty} x2={rx} y2={ry} stroke={color} strokeWidth={0.6} opacity={0.45} />
              <circle cx={rx} cy={ry} r={1.1} fill={color} opacity={0.7} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function PChartReceiverHeatMap({ throws, leagueThrows = [], xCoord = 'svg_recv_x', yCoord = 'svg_recv_y', losMode = false }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    if (throws.length === 0) return;
    const SIGMA = 10, KR = Math.ceil(3 * SIGMA);
    const kern = new Float32Array(2 * KR + 1);
    let ks = 0;
    for (let i = -KR; i <= KR; i++) { kern[i + KR] = Math.exp(-i*i/(2*SIGMA*SIGMA)); ks += kern[i + KR]; }
    for (let i = 0; i < kern.length; i++) kern[i] /= ks;
    const viewY0 = losMode ? LOS_VIEW_Y0 : SVG_Y0;
    const viewH  = losMode ? LOS_VIEW_H  : SVG_H;
    function buildDensity(throwSet) {
      const raw = new Float32Array(W * H);
      for (const t of throwSet) {
        const rx = t[xCoord], ry = t[yCoord];
        if (rx == null || ry == null) continue;
        const px = Math.max(0, Math.min(W-1, Math.round((rx-SVG_X0)*W/SVG_W)));
        const py = Math.max(0, Math.min(H-1, Math.round((ry-viewY0)*H/viewH)));
        raw[py*W+px]++;
      }
      const tmp = new Float32Array(W*H), out = new Float32Array(W*H);
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let v = 0;
          for (let ki = 0; ki < kern.length; ki++) { const xi = x+ki-KR; if (xi>=0&&xi<W) v += raw[y*W+xi]*kern[ki]; }
          tmp[y*W+x] = v;
        }
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          let v = 0;
          for (let ki = 0; ki < kern.length; ki++) { const yi = y+ki-KR; if (yi>=0&&yi<H) v += tmp[yi*W+x]*kern[ki]; }
          out[y*W+x] = v;
        }
      return out;
    }
    if (leagueThrows.length === 0) {
      // Raw density mode — no league normalization
      const dens = buildDensity(throws);
      const sorted2 = Array.from(dens).filter(v=>v>0).sort((a,b)=>a-b);
      const dHi = sorted2[Math.floor(sorted2.length*0.95)] || 1;
      const img2 = ctx.createImageData(W,H); const d2 = img2.data;
      for (let i = 0; i < dens.length; i++) {
        const pi = i*4, t = Math.min(1, dens[i]/dHi);
        if (t < 0.02) { d2[pi]=240;d2[pi+1]=240;d2[pi+2]=240;d2[pi+3]=255; }
        else { const[r,g,b]=jetRgbArr(t); d2[pi]=r;d2[pi+1]=g;d2[pi+2]=b;d2[pi+3]=255; }
      }
      ctx.putImageData(img2, 0, 0);
      return;
    }
    const teamDensity = buildDensity(throws), leagueDensity = buildDensity(leagueThrows);
    const teamSum = teamDensity.reduce((s,v)=>s+v,0)||1, leagueSum = leagueDensity.reduce((s,v)=>s+v,0)||1;
    const MIN_LEAGUE_RAW = leagueSum/(W*H)*0.01, MIN_LEAGUE_N = MIN_LEAGUE_RAW/leagueSum;
    const ratios = new Float32Array(W*H);
    for (let i = 0; i < ratios.length; i++) {
      const t = Math.max(teamDensity[i]/teamSum, MIN_LEAGUE_N);
      const l = Math.max(leagueDensity[i]/leagueSum, MIN_LEAGUE_N);
      ratios[i] = Math.log2(t/l);
    }
    const sorted = Array.from(ratios).sort((a,b)=>a-b);
    const rLo = sorted[Math.floor(sorted.length*0.05)], rHi = sorted[Math.floor(sorted.length*0.95)];
    const rSpan = rHi-rLo||0.01;
    const img = ctx.createImageData(W,H); const d = img.data;
    for (let i = 0; i < ratios.length; i++) {
      const pi = i*4;
      if (leagueDensity[i] < MIN_LEAGUE_RAW*2) { d[pi]=240;d[pi+1]=240;d[pi+2]=240;d[pi+3]=255; }
      else { const t=Math.max(0,Math.min(1,(ratios[i]-rLo)/rSpan));const[r,g,b]=jetRgbArr(t);d[pi]=r;d[pi+1]=g;d[pi+2]=b;d[pi+3]=255; }
    }
    ctx.putImageData(img,0,0);
  }, [throws, leagueThrows, xCoord, yCoord, losMode]);
  const hmViewY0 = losMode ? LOS_VIEW_Y0 : SVG_Y0;
  const hmViewH  = losMode ? LOS_VIEW_H  : SVG_H;
  return (
    <div style={{ position:'relative', width:'100%', height:'100%' }}>
      <canvas ref={canvasRef} width={200} height={losMode ? Math.round(LOS_VIEW_H) : SVG_H} style={{ width:'100%', height:'100%', display:'block' }} />
      <svg viewBox={`${SVG_X0} ${hmViewY0} ${SVG_W} ${hmViewH}`}
           style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }}
           preserveAspectRatio="none">
        <defs><clipPath id="pc-field-clip-hm"><rect x={SVG_X0} y={hmViewY0} width={SVG_W} height={hmViewH} /></clipPath></defs>
        <g clipPath="url(#pc-field-clip-hm)">{losMode ? <PChartGridOverlay /> : <PChartFieldOverlay />}</g>
      </svg>
    </div>
  );
}

const MS_CASES = [
  [],[[3,2]],[[2,1]],[[3,1]],[[0,1]],[[0,1],[3,2]],[[0,2]],[[0,3]],
  [[0,3]],[[0,2]],[[0,3],[2,1]],[[0,1]],[[3,1]],[[2,1]],[[3,2]],[],
];

function PChartCompletionRateMap({ throws }) {
  const canvasRef = useRef(null);
  const [isoLines, setIsoLines] = useState([]);
  const [hasData,  setHasData]  = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(0,0,W,H);
    const EZ_GOAL_PY = Math.round(EZ_H*H/SVG_H);
    const EZ_RECV_MAX = SVG_Y0+EZ_H;
    const valid = throws.filter(t => t.svg_throw_x!=null&&t.svg_throw_y!=null&&t.svg_recv_y!=null&&t.svg_recv_y<=EZ_RECV_MAX);
    if (valid.length < 10) { setIsoLines([]); setHasData(false); return; }
    const throwPx = valid.map(t => ({
      px: Math.round((t.svg_throw_x-SVG_X0)*W/SVG_W),
      py: Math.round((t.svg_throw_y-SVG_Y0)*H/SVG_H),
      complete: COMPLETE_TYPES.has(t.pbp_throw_type)?1:0,
    }));
    throwPx.sort((a,b)=>a.py-b.py);
    const compM = new Float32Array(W*H), totM = new Float32Array(W*H);
    let throwIdx = 0;
    while (throwIdx<throwPx.length&&throwPx[throwIdx].py<EZ_GOAL_PY) throwIdx++;
    for (let py = EZ_GOAL_PY; py < H; py++) {
      if (py>EZ_GOAL_PY) { for (let px=0;px<W;px++) { compM[py*W+px]=compM[(py-1)*W+px]; totM[py*W+px]=totM[(py-1)*W+px]; } }
      while (throwIdx<throwPx.length&&throwPx[throwIdx].py<=py) {
        const{px,complete}=throwPx[throwIdx]; if(px>=0&&px<W){totM[py*W+px]++;compM[py*W+px]+=complete;} throwIdx++;
      }
    }
    const SIGMA_H=8,KR_H=Math.ceil(3*SIGMA_H); const kernH=new Float32Array(2*KR_H+1); let ksH=0;
    for (let i=-KR_H;i<=KR_H;i++){kernH[i+KR_H]=Math.exp(-i*i/(2*SIGMA_H*SIGMA_H));ksH+=kernH[i+KR_H];}
    for (let i=0;i<kernH.length;i++) kernH[i]/=ksH;
    function blurH(src){const out=new Float32Array(W*H);for(let py=EZ_GOAL_PY;py<H;py++)for(let px=0;px<W;px++){let v=0;for(let ki=0;ki<kernH.length;ki++){const sx=Math.max(0,Math.min(W-1,px+ki-KR_H));v+=src[py*W+sx]*kernH[ki];}out[py*W+px]=v;}return out;}
    const compB=blurH(compM),totB=blurH(totM);
    const rawRates=new Float32Array(W*H).fill(-1);
    for(let py=EZ_GOAL_PY;py<H;py++)for(let px=0;px<W;px++){const i=py*W+px;if(totB[i]>=0.5)rawRates[i]=compB[i]/totB[i];}
    for(let px=0;px<W;px++){let fdr=-1;for(let py=EZ_GOAL_PY;py<H;py++){if(rawRates[py*W+px]>=0){fdr=py;break;}}if(fdr<=EZ_GOAL_PY)continue;const fr=rawRates[fdr*W+px];for(let py=EZ_GOAL_PY;py<fdr;py++)rawRates[py*W+px]=fr;}
    function blur2D(src,sigma){const KR=Math.ceil(3*sigma);const kern=new Float32Array(2*KR+1);let ks=0;for(let i=-KR;i<=KR;i++){kern[i+KR]=Math.exp(-i*i/(2*sigma*sigma));ks+=kern[i+KR];}for(let i=0;i<kern.length;i++)kern[i]/=ks;const hasData=new Uint8Array(W*H);for(let i=0;i<src.length;i++)if(src[i]>=0)hasData[i]=1;const tmp=new Float32Array(W*H).fill(-1);for(let py=EZ_GOAL_PY;py<H;py++)for(let px=0;px<W;px++){let v=0,w=0;for(let ki=0;ki<kern.length;ki++){const sx=Math.max(0,Math.min(W-1,px+ki-KR));const idx=py*W+sx;if(hasData[idx]){v+=src[idx]*kern[ki];w+=kern[ki];}}if(w>0)tmp[py*W+px]=v/w;}const out=new Float32Array(W*H).fill(-1);for(let py=EZ_GOAL_PY;py<H;py++)for(let px=0;px<W;px++){let v=0,w=0;for(let ki=0;ki<kern.length;ki++){const sy=Math.max(EZ_GOAL_PY,Math.min(H-1,py+ki-KR));const idx=sy*W+px;if(tmp[idx]>=0){v+=tmp[idx]*kern[ki];w+=kern[ki];}}if(w>0)out[py*W+px]=v/w;}return out;}
    const rates=blur2D(rawRates,12);
    const rLo=0.65,rHi=0.99,rSpan=rHi-rLo;
    const img=ctx.createImageData(W,H);const d=img.data;
    for(let i=0;i<rates.length;i++){const pi=i*4;if(rates[i]<0){d[pi]=232;d[pi+1]=232;d[pi+2]=232;d[pi+3]=255;}else{const t=Math.max(0,Math.min(1,(rates[i]-rLo)/rSpan));const[rv,gv,bv]=jetRgbArr(t);d[pi]=rv;d[pi+1]=gv;d[pi+2]=bv;d[pi+3]=255;}}
    ctx.putImageData(img,0,0);
    const GR=GRID_ROWS,GC=GRID_COLS;
    const sampled=Array.from({length:GR},(_,r)=>Array.from({length:GC},(_,c)=>{const px=Math.min(W-1,Math.round((c+0.5)*W/GC));const py=Math.min(H-1,Math.round((r+0.5)*H/GR));const v=rates[py*W+px];return v>=0?v:null;}));
    const cellW=SVG_W/GC,cellH=SVG_H/GR;
    setIsoLines([0.70,0.75,0.80,0.85,0.90,0.95].map(thresh=>{
      const segs=[];
      for(let r=0;r<GR-1;r++)for(let c=0;c<GC-1;c++){const vTL=sampled[r][c],vTR=sampled[r][c+1],vBR=sampled[r+1][c+1],vBL=sampled[r+1][c];if(vTL==null||vTR==null||vBR==null||vBL==null)continue;const idx=((vTL>=thresh?1:0)<<3)|((vTR>=thresh?1:0)<<2)|((vBR>=thresh?1:0)<<1)|(vBL>=thresh?1:0);if(idx===0||idx===15)continue;const x0=SVG_X0+c*cellW,y0=SVG_Y0+r*cellH,x1=x0+cellW,y1=y0+cellH;const li=(a,b,va,vb)=>Math.abs(vb-va)<1e-9?(a+b)/2:a+(b-a)*(thresh-va)/(vb-va);const pts=[{x:li(x0,x1,vTL,vTR),y:y0},{x:x1,y:li(y0,y1,vTR,vBR)},{x:li(x0,x1,vBL,vBR),y:y1},{x:x0,y:li(y0,y1,vTL,vBL)}];for(const[a,b]of MS_CASES[idx])segs.push([pts[a],pts[b]]);}
      return{thresh,pct:Math.round(thresh*100),segs};
    }));
    setHasData(true);
  }, [throws]);
  return (
    <div style={{ position:'relative', width:'100%', height:'100%' }}>
      <canvas ref={canvasRef} width={200} height={450} style={{ width:'100%', height:'100%', display:'block' }} />
      {!hasData && (
        <div style={{
          position:'absolute', inset:0,
          display:'flex', alignItems:'center', justifyContent:'center',
          padding:'0 12px',
        }}>
          <div style={{
            fontFamily:'var(--font-h2)', fontSize:9, letterSpacing:'1.2px',
            textTransform:'uppercase', color:'var(--t-muted)',
            textAlign:'center', lineHeight:1.6,
          }}>
            Requires 10+ passes<br/>toward end zone
          </div>
        </div>
      )}
      <svg viewBox={`${SVG_X0} ${SVG_Y0} ${SVG_W} ${SVG_H}`}
           style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }}
           preserveAspectRatio="none">
        <defs><clipPath id="pc-field-clip-cr"><rect x={SVG_X0} y={SVG_Y0} width={SVG_W} height={SVG_H} /></clipPath></defs>
        <g clipPath="url(#pc-field-clip-cr)">
          {isoLines.map(({pct,segs})=>{
            if(!segs.length)return null;
            const mid=segs[Math.floor(segs.length/2)];
            const lx=(mid[0].x+mid[1].x)/2,ly=(mid[0].y+mid[1].y)/2;
            return(
              <g key={pct}>
                {segs.map(([p1,p2],i)=><line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="rgba(255,255,255,0.85)" strokeWidth={1.2}/>)}
                <text x={lx} y={ly} fontSize={8} fill="white" textAnchor="middle" dominantBaseline="middle" fontWeight="bold" stroke="#222" strokeWidth={0.8} paintOrder="stroke">{pct}%</text>
              </g>
            );
          })}
          <PChartFieldOverlay />
        </g>
      </svg>
    </div>
  );
}

// ── Passing Habits ─────────────────────────────────────────────────────────────

const MID_NODES = {
  catches: { label: 'CATCHES', color: '#60a5fa' },
  goals:   { label: 'GOALS',   color: '#16a34a' },
  drops:   { label: 'DROPS',   color: '#f87171' },
};

function SankeyViz({ data, playerName }) {
  const { topPassers, topReceivers } = data;
  const NODE_W = 12, NODE_PAD = 8;
  const ML = 82, MR = 82, MT = 28, MB = 8;

  const containerRef = useRef(null);
  const [dims, setDims] = useState({ w: 500, h: 300 });
  const [tooltip, setTooltip] = useState(null);
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 10 && height > 10) setDims({ w: Math.round(width), h: Math.round(height) });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const W = dims.w, H = dims.h;

  const lastName = name => (name || '').split(' ').slice(-1)[0].toUpperCase();

  const { lNodes, lLinks } = useMemo(() => {
    const nodes = [
      ...topPassers.map((p, i) => ({ id: `p${i}`, name: p.name })),
      { id: 'catches', name: 'CATCHES' },
      { id: 'goals',   name: 'GOALS'   },
      { id: 'drops',   name: 'DROPS'   },
      ...topReceivers.map((r, i) => ({ id: `r${i}`, name: r.name })),
    ];
    const links = [
      ...topPassers.flatMap((p, i) => [
        p.catch > 0 ? { source: `p${i}`, target: 'catches', value: p.catch } : null,
        p.goal  > 0 ? { source: `p${i}`, target: 'goals',   value: p.goal  } : null,
        p.drop  > 0 ? { source: `p${i}`, target: 'drops',   value: p.drop  } : null,
      ].filter(Boolean)),
      ...topReceivers.flatMap((r, i) => [
        r.completions > 0 ? { source: 'catches', target: `r${i}`, value: r.completions, _type: 'completion' } : null,
        r.goals       > 0 ? { source: 'catches', target: `r${i}`, value: r.goals,       _type: 'assist'     } : null,
      ].filter(Boolean)),
    ];
    try {
      const gen = d3Sankey()
        .nodeId(d => d.id)
        .nodeAlign(sankeyLeft)
        .nodeWidth(NODE_W)
        .nodePadding(NODE_PAD)
        .extent([[ML, MT], [W - MR, H - MB]]);
      const result = gen({ nodes: nodes.map(n => ({ ...n })), links: links.map(l => ({ ...l })) });
      return { lNodes: result.nodes, lLinks: result.links };
    } catch { return { lNodes: [], lLinks: [] }; }
  }, [data, W, H]);

  const pathGen = sankeyLinkHorizontal();

  const nodeColor = n => MID_NODES[n.id]?.color
    ?? (n.id.startsWith('p') ? 'rgba(94,234,212,0.85)' : 'rgba(100,160,230,0.85)');

  const linkStroke = link => {
    if (link._type === 'assist') return 'rgba(22,163,74,0.45)';
    const tid = typeof link.target === 'object' ? link.target.id : link.target;
    const sid = typeof link.source === 'object' ? link.source.id : link.source;
    const mid = MID_NODES[tid] ?? MID_NODES[sid];
    if (!mid) return 'rgba(96,165,250,0.25)';
    return mid.color + '55';
  };

  const midColX = lNodes.find(n => n.id === 'catches');
  const headerMidX = midColX ? (midColX.x0 + midColX.x1) / 2 : W / 2;

  const tooltipLabel = link => {
    const rawSrc = (typeof link.source === 'object' ? link.source.name : link.source) || '';
    const rawTgt = (typeof link.target === 'object' ? link.target.name : link.target) || '';
    const tid = typeof link.target === 'object' ? link.target.id : link.target;
    const displayName = playerName || '';
    const src = rawSrc === 'CATCHES' ? displayName : rawSrc;
    const tgt = rawTgt === 'CATCHES' ? displayName : rawTgt;
    let type;
    if (link._type === 'assist')          type = 'assists';
    else if (link._type === 'completion') type = 'completions';
    else if (tid === 'catches') type = 'catches';
    else if (tid === 'goals')   type = 'goals scored';
    else if (tid === 'drops')   type = 'drops';
    else type = 'throws';
    return { src, tgt, count: link.value, type };
  };

  const handleLinkEnter = (e, link) => {
    setTooltip({ ...tooltipLabel(link), x: e.clientX, y: e.clientY });
  };
  const handleLinkMove = e => {
    setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : t);
  };

  return (
    <>
    <div ref={containerRef} style={{ flex: 1, position: 'relative', minHeight: 0 }}>
      <svg width={W} height={H} style={{ position: 'absolute', inset: 0, display: 'block' }}>
        {/* Column headers */}
        <text x={ML - NODE_W - 4} y={16} fontSize="7" fontFamily="var(--font-h2)" letterSpacing="1" fill="var(--t-muted)" textAnchor="end">From</text>
        <text x={headerMidX} y={16} fontSize="7" fontFamily="var(--font-h2)" letterSpacing="1" fill={ORANGE} textAnchor="middle">{(playerName || '').toUpperCase()}</text>
        <text x={W - MR + NODE_W + 4} y={16} fontSize="7" fontFamily="var(--font-h2)" letterSpacing="1" fill="var(--t-muted)" textAnchor="start">To</text>

        {/* Links */}
        {lLinks.map((link, i) => (
          <path key={i} d={pathGen(link)} fill="none"
            stroke={linkStroke(link)} strokeWidth={Math.max(1, link.width)}
            style={{ cursor: 'default' }}
            onMouseEnter={e => handleLinkEnter(e, link)}
            onMouseMove={handleLinkMove}
            onMouseLeave={() => setTooltip(null)} />
        ))}

        {/* Nodes */}
        {lNodes.map(node => (
          <rect key={node.id} x={node.x0} y={node.y0}
            width={node.x1 - node.x0} height={Math.max(1, node.y1 - node.y0)}
            fill={nodeColor(node)} rx={2} />
        ))}

        {/* Middle node labels */}
        {lNodes.filter(n => MID_NODES[n.id]).map(node => {
          const h = node.y1 - node.y0;
          if (h < 10) return null;
          return (
            <text key={`mlbl-${node.id}`}
              x={(node.x0 + node.x1) / 2} y={(node.y0 + node.y1) / 2}
              textAnchor="middle" dominantBaseline="middle"
              fontSize="6.5" fontFamily="var(--font-h2)" letterSpacing="0.4" fill="white">
              {MID_NODES[node.id].label}
            </text>
          );
        })}

        {/* Passer / receiver labels */}
        {lNodes.filter(n => !MID_NODES[n.id]).map(node => {
          const isLeft = node.id.startsWith('p');
          return (
            <text key={`lbl-${node.id}`}
              x={isLeft ? node.x0 - 5 : node.x1 + 5}
              y={(node.y0 + node.y1) / 2}
              textAnchor={isLeft ? 'end' : 'start'}
              dominantBaseline="middle"
              fontSize="8" fontFamily="var(--font-h2)" letterSpacing="0.3"
              fill="var(--t-secondary)">
              {lastName(node.name)}
            </text>
          );
        })}
      </svg>
    </div>
    {tooltip && (
      <div style={{
        position: 'fixed', left: tooltip.x + 14, top: tooltip.y - 36,
        background: 'var(--card-bg)', border: '1px solid var(--surf-border)',
        borderRadius: 6, padding: '5px 10px', pointerEvents: 'none', zIndex: 9999,
        fontFamily: 'var(--font-h2)', fontSize: 11, whiteSpace: 'nowrap',
        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      }}>
        <div style={{ color: 'var(--t-secondary)', letterSpacing: '0.3px' }}>
          {tooltip.src} → {tooltip.tgt}
        </div>
        <div style={{ color: ORANGE, fontWeight: 600, marginTop: 2 }}>
          {tooltip.count} {tooltip.type}
        </div>
      </div>
    )}
    </>
  );
}

function DirectionRose({ data }) {
  // data = [{i, count, pct}, ...] 10 segments, i=0 is forward (upfield)
  const W = 260, H = 260;
  const CX = W / 2, CY = H / 2;
  const MAX_R = 98, MIN_R = 22;
  const N = data.length; // 10
  const segRad = (2 * Math.PI) / N;
  const maxPct = Math.max(...data.map(d => d.pct), 0.0001);

  const paths = data.map(seg => {
    const startA = (seg.i - 0.5) * segRad - Math.PI / 2;
    const endA   = (seg.i + 0.5) * segRad - Math.PI / 2;
    const r = MIN_R + (seg.pct / maxPct) * (MAX_R - MIN_R);
    const cos0 = Math.cos(startA), sin0 = Math.sin(startA);
    const cos1 = Math.cos(endA),   sin1 = Math.sin(endA);
    const ix1 = CX + MIN_R * cos0, iy1 = CY + MIN_R * sin0;
    const ox1 = CX + r * cos0,     oy1 = CY + r * sin0;
    const ox2 = CX + r * cos1,     oy2 = CY + r * sin1;
    const ix2 = CX + MIN_R * cos1, iy2 = CY + MIN_R * sin1;
    const d = `M ${ix1} ${iy1} L ${ox1} ${oy1} A ${r} ${r} 0 0 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${MIN_R} ${MIN_R} 0 0 0 ${ix1} ${iy1} Z`;
    // % label at midpoint of arc
    const midA = seg.i * segRad - Math.PI / 2;
    const midR = MIN_R + (r - MIN_R) * 0.55;
    return { ...seg, d, r, midA, midR };
  });

  // Color: orange spectrum, opacity scales with value
  const segFill = seg => {
    const alpha = 0.25 + (seg.pct / maxPct) * 0.6;
    return `rgba(234,96,32,${alpha.toFixed(2)})`;
  };

  // Direction labels placed at exact cardinal angles, not segment centers
  const dirLabels = [
    { angle: -Math.PI / 2, label: 'FWD'  },  // up
    { angle: 0,            label: 'R'    },  // right
    { angle:  Math.PI / 2, label: 'BACK' },  // down
    { angle:  Math.PI,     label: 'L'    },  // left
  ];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%', display: 'block' }} preserveAspectRatio="xMidYMid meet">
      {/* Grid rings */}
      {[0.33, 0.66, 1.0].map(t => (
        <circle key={t} cx={CX} cy={CY} r={MIN_R + t * (MAX_R - MIN_R)}
          fill="none" stroke="rgba(128,128,128,0.15)" strokeWidth="0.5" />
      ))}
      {/* Spoke lines */}
      {data.map(seg => {
        const a = seg.i * segRad - Math.PI / 2;
        return (
          <line key={seg.i}
            x1={CX + MIN_R * Math.cos(a)} y1={CY + MIN_R * Math.sin(a)}
            x2={CX + MAX_R * Math.cos(a)} y2={CY + MAX_R * Math.sin(a)}
            stroke="rgba(128,128,128,0.18)" strokeWidth="0.5" />
        );
      })}
      {/* Segments */}
      {paths.map(seg => (
        <path key={seg.i} d={seg.d} fill={segFill(seg)} />
      ))}
      {/* Inner circle */}
      <circle cx={CX} cy={CY} r={MIN_R} fill="var(--surf-bg)" />
      {/* % labels */}
      {paths.map(seg => seg.pct >= 0.07 && (
        <text key={`pct-${seg.i}`}
          x={CX + seg.midR * Math.cos(seg.midA)}
          y={CY + seg.midR * Math.sin(seg.midA)}
          textAnchor="middle" dominantBaseline="middle"
          fontSize="7" fontFamily="var(--font-h2)" fill="white">
          {Math.round(seg.pct * 100)}%
        </text>
      ))}
      {/* Direction labels */}
      {dirLabels.map(({ angle, label }) => {
        const lr = MAX_R + 14;
        return (
          <text key={label} x={CX + lr * Math.cos(angle)} y={CY + lr * Math.sin(angle)}
            textAnchor="middle" dominantBaseline="middle"
            fontSize="8" fontFamily="var(--font-h2)" letterSpacing="0.5" fill="var(--t-muted)">
            {label}
          </text>
        );
      })}
    </svg>
  );
}

function PlayerPassingHabitsPanel({ playerId, ufaId, playerName, selectedYears }) {
  const [allThrows, setAllThrows] = useState([]);
  const [status,    setStatus]    = useState('loading');

  useEffect(() => {
    if (!ufaId) { setStatus('empty'); return; }
    setStatus('loading');
    fetch(`/api/players/${playerId}/throws`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setAllThrows(d.items || []); setStatus('ready'); })
      .catch(() => setStatus('error'));
  }, [playerId, ufaId]);

  const filtered = useMemo(
    () => !selectedYears ? allThrows : allThrows.filter(t => selectedYears.has(t.year)),
    [allThrows, selectedYears]
  );

  const sankeyData = useMemo(() => {
    if (!filtered.length) return null;
    const myReceives = filtered.filter(t => t.receiver_id === ufaId && t.thrower_id && t.thrower_id !== ufaId);
    const myThrows   = filtered.filter(t => t.thrower_id === ufaId   && t.receiver_id && t.receiver_id !== ufaId);

    // Per-passer outcome breakdown
    const passerMap = {};
    for (const t of myReceives) {
      const key = t.thrower_id;
      if (!passerMap[key]) passerMap[key] = { name: t.thrower_name || key, goal: 0, catch: 0, drop: 0 };
      if (t.pbp_throw_type === 'score') passerMap[key].goal++;
      else if (t.pbp_throw_type === 'drop') passerMap[key].drop++;
      else passerMap[key].catch++;
    }
    const TOP_N = 10;
    const allPassers = Object.values(passerMap)
      .map(p => ({ ...p, total: p.goal + p.catch + p.drop }))
      .sort((a, b) => b.total - a.total);
    const topPassers = allPassers.slice(0, TOP_N);
    if (allPassers.length > TOP_N) {
      const rest = allPassers.slice(TOP_N);
      topPassers.push(rest.reduce(
        (acc, p) => ({ name: 'Other', goal: acc.goal + p.goal, catch: acc.catch + p.catch, drop: acc.drop + p.drop, total: acc.total + p.total }),
        { name: 'Other', goal: 0, catch: 0, drop: 0, total: 0 }
      ));
    }

    const receiverMap = {};
    for (const t of myThrows) {
      const key = t.receiver_id;
      if (!receiverMap[key]) receiverMap[key] = { name: t.receiver_name || key, completions: 0, goals: 0 };
      if (t.pbp_throw_type === 'score')      receiverMap[key].goals++;
      else if (t.pbp_throw_type === 'pass')  receiverMap[key].completions++;
    }
    const allReceivers = Object.values(receiverMap)
      .map(r => ({ ...r, total: r.completions + r.goals }))
      .filter(r => r.total > 0)
      .sort((a, b) => b.total - a.total);
    const topReceivers = allReceivers.slice(0, TOP_N);
    if (allReceivers.length > TOP_N) {
      const rest = allReceivers.slice(TOP_N);
      topReceivers.push(rest.reduce(
        (acc, r) => ({ name: 'Other', completions: acc.completions + r.completions, goals: acc.goals + r.goals, total: acc.total + r.total }),
        { name: 'Other', completions: 0, goals: 0, total: 0 }
      ));
    }

    const totalGoals   = myReceives.filter(t => t.pbp_throw_type === 'score').length;
    const totalCatches = myReceives.filter(t => t.pbp_throw_type !== 'score' && t.pbp_throw_type !== 'drop').length;
    const totalDrops   = myReceives.filter(t => t.pbp_throw_type === 'drop').length;
    const totalReceived = totalGoals + totalCatches + totalDrops;
    const totalThrown   = myThrows.length;

    if (!totalReceived && !totalThrown) return null;
    return { topPassers, topReceivers, totalGoals, totalCatches, totalDrops, totalReceived, totalThrown };
  }, [filtered, ufaId]);

  const radarData = useMemo(() => {
    const valid = filtered.filter(t =>
      t.thrower_id === ufaId &&
      t.svg_throw_x != null && t.svg_throw_y != null &&
      t.svg_recv_x  != null && t.svg_recv_y  != null &&
      COMPLETE_TYPES.has(t.pbp_throw_type)
    );
    if (!valid.length) return null;
    const N = 12;
    const counts = new Array(N).fill(0);
    for (const t of valid) {
      const dx = t.svg_recv_x - t.svg_throw_x;
      const dy = t.svg_throw_y - t.svg_recv_y;
      const norm = ((Math.atan2(dx, dy) * 180 / Math.PI % 360) + 360) % 360;
      counts[Math.floor(norm / (360 / N)) % N]++;
    }
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    return counts.map((c, i) => ({ i, count: c, pct: c / total }));
  }, [filtered, ufaId]);

  const receptionRadarData = useMemo(() => {
    const valid = filtered.filter(t =>
      t.receiver_id === ufaId &&
      t.svg_throw_x != null && t.svg_throw_y != null &&
      t.svg_recv_x  != null && t.svg_recv_y  != null &&
      COMPLETE_TYPES.has(t.pbp_throw_type)
    );
    if (!valid.length) return null;
    const N = 12;
    const counts = new Array(N).fill(0);
    for (const t of valid) {
      const dx = t.svg_recv_x - t.svg_throw_x;
      const dy = t.svg_throw_y - t.svg_recv_y;
      const norm = ((Math.atan2(dx, dy) * 180 / Math.PI % 360) + 360) % 360;
      counts[Math.floor(norm / (360 / N)) % N]++;
    }
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    return counts.map((c, i) => ({ i, count: c, pct: c / total }));
  }, [filtered, ufaId]);

  const labelStyle = { fontFamily: 'var(--font-h1)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--t-secondary)', flexShrink: 0 };
  const panelStyle = { flex: 1, minHeight: 200, borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' };

  if (status === 'loading') return <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px' }}>Loading…</div>;
  if (status !== 'ready' || (!sankeyData && !radarData && !receptionRadarData)) return <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px' }}>No passing data available.</div>;

  return (
    <div style={{ display: 'flex', gap: 20, flex: 1, minHeight: 0 }}>
      {/* Sankey */}
      <div style={{ flex: 2, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={labelStyle}>Connection Flow</div>
        <div style={panelStyle}>
          {sankeyData
            ? <SankeyViz data={sankeyData} playerName={playerName} />
            : <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px' }}>No data</div>
          }
        </div>
      </div>

      {/* Direction roses */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={labelStyle}>Throw Direction</div>
          <div style={panelStyle}>
            {radarData
              ? <DirectionRose data={radarData} />
              : <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px' }}>No data</div>
            }
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={labelStyle}>Reception Direction</div>
          <div style={panelStyle}>
            {receptionRadarData
              ? <DirectionRose data={receptionRadarData} />
              : <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px' }}>No data</div>
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PlayerSeasonStatsPanel ────────────────────────────────────────────────────
const STAT_GROUPS = [
  {
    key: 'boxscore', label: 'Box Score',
    cols: [
      { key: 'goals',         label: 'G',   tip: 'Goals' },
      { key: 'assists',       label: 'A',   tip: 'Assists' },
      { key: 'hockey_assists',label: 'HA',  tip: 'Hockey Assists' },
      { key: 'blocks',        label: 'B',   tip: 'Blocks' },
      { key: 'completions',   label: 'C',   tip: 'Completions' },
      { key: 'throwaways',    label: 'T',   tip: 'Throwaways' },
      { key: 'cp_pct',        label: 'CP%', tip: 'Completion %', pct: true },
    ],
  },
  {
    key: 'throwing', label: 'Throwing',
    cols: [
      { key: 'hucks_thrown',  label: 'HuT',   tip: 'Hucks Thrown' },
      { key: 'hucks_caught',  label: 'HuR',   tip: 'Hucks Received' },
      { key: 'hu_cp_pct',     label: 'HuCP%', tip: 'Huck Completion %', pct: true },
      { key: 'hu_ap_pct',     label: 'HuAP%', tip: 'Huck Attempt %', pct: true },
      { key: 'xcp',           label: 'xCP',   tip: 'Expected Completion %', pct: true },
      { key: 'cpoe',          label: 'CPOE',  tip: 'Completion % Over Expected', pct: true },
    ],
  },
  {
    key: 'efficiency', label: 'Efficiency',
    cols: [
      { key: 'oe', label: 'OE', tip: 'Offensive Efficiency', pct: true },
      { key: 'de', label: 'DE', tip: 'Defensive Efficiency', pct: true },
    ],
  },
  {
    key: 'usage', label: 'Usage',
    cols: [
      { key: 'gp',     label: 'GP',     tip: 'Games Played' },
      { key: 'o_pts',  label: 'OPts',   tip: 'Offensive Points Played' },
      { key: 'd_pts',  label: 'DPts',   tip: 'Defensive Points Played' },
      { key: 'o_poss', label: 'OPoss',  tip: 'Offensive Possessions' },
      { key: 'd_poss', label: 'DPoss',  tip: 'Defensive Possessions' },
      { key: 'oi_pct', label: 'OI%',    tip: 'Offensive Involvement %', pct: true },
    ],
  },
  {
    key: 'edge', label: 'Ultiworld EDGE',
    cols: [
      { key: 'edge',   label: 'EDGE',   tip: 'Total EDGE (Offensive + Block)' },
      { key: 'edge_o', label: 'EDGE-O', tip: 'Offensive EDGE (yards, scores, turnovers)' },
      { key: 'edge_b', label: 'EDGE-B', tip: 'Block EDGE' },
    ],
  },
  {
    key: 'contribution', label: 'Shown Space Contribution',
    cols: [
      { key: 'total_aec',        label: 'aEC',   tip: 'Adjusted Expected Contribution' },
      { key: 'thrower_aec',      label: 'T-aEC', tip: 'Thrower aEC' },
      { key: 'receiver_aec',     label: 'R-aEC', tip: 'Receiver aEC' },
      { key: 'lag_contribution', label: 'LC',    tip: 'Lag Contribution' },
      { key: 'pi_t',             label: 'PI-T',  tip: 'Player Impact (Team)', pct: true },
      { key: 'pi_p',             label: 'PI-P',  tip: 'Player Impact (Possession)', pct: true },
    ],
  },
];

// Rate stats — skip dividing by GP in "per game" mode
const RATE_COLS = new Set(['cp_pct','hu_cp_pct','hu_ap_pct','xcp','cpoe','pi_t','pi_p','oe','de','oi_pct']);
// Possession-denominated stats for "per 100 poss" — offensive possessions
const PER_POSS_DENOM = {
  default:       'o_poss',
  blocks:        'd_poss',
  de:            'd_poss',
  hucks_caught:  'o_poss',
  // these don't make sense per-poss; hide them
  gp: null, o_pts: null, d_pts: null, o_poss: null, d_poss: null, oi_pct: null,
  edge: null, edge_o: null, edge_b: null,
};

function _pctileColor(p) {
  if (p == null) return null;
  const r1 = 220, g1 = 60,  b1 = 60;   // red
  const r2 = 150, g2 = 150, b2 = 150;   // grey
  const r3 = 60,  g3 = 190, b3 = 90;    // green
  let r, g, b;
  if (p <= 50) {
    const t = p / 50;
    r = Math.round(r1 + (r2 - r1) * t);
    g = Math.round(g1 + (g2 - g1) * t);
    b = Math.round(b1 + (b2 - b1) * t);
  } else {
    const t = (p - 50) / 50;
    r = Math.round(r2 + (r3 - r2) * t);
    g = Math.round(g2 + (g3 - g2) * t);
    b = Math.round(b2 + (b3 - b2) * t);
  }
  return `rgb(${r},${g},${b})`;
}
function _fmt(val, col, view, row) {
  if (val == null) return '—';
  if (RATE_COLS.has(col.key)) {
    return col.pct ? `${Number(val).toFixed(1)}%` : val.toFixed(1);
  }
  if (view === 'pergame') {
    const gp = row.gp || 1;
    return (val / gp).toFixed(1);
  }
  if (view === 'per100') {
    const denomKey = PER_POSS_DENOM[col.key] ?? PER_POSS_DENOM.default;
    if (!denomKey) return '—';
    const den = row[denomKey] || 0;
    if (!den) return '—';
    return ((val / den) * 100).toFixed(1);
  }
  // total — integers stay whole, decimals to 1dp
  return Number.isInteger(val) ? val : val.toFixed(1);
}

function PlayerSeasonStatsPanel({ playerId, ufaId, usauId, usauNatStats, usauNatStatus }) {
  const [data,   setData]   = useState(null);
  const [status, setStatus] = useState(ufaId ? 'loading' : 'skip');
  const [view,   setView]   = useState('total'); // 'total' | 'pergame' | 'per100'
  const [tooltip, setTooltip] = useState(null);
  const [expandedYears, setExpandedYears] = useState(new Set());
  const expandedInitRef = useRef(false);

  useEffect(() => {
    if (!ufaId) { setStatus('skip'); return; }
    setStatus('loading');
    fetch(`/api/players/${playerId}/season_stats`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { setData(d); setStatus('ready'); })
      .catch(() => setStatus('error'));
  }, [playerId, ufaId]);

  const ufaReady  = status === 'ready' && data && (data.career || data.seasons?.length);
  const usauReady = usauNatStatus === 'ready' && usauNatStats?.seasons?.length > 0;

  // Build unified year groups: UFA rows + USAU rows keyed by year
  const yearGroups = useMemo(() => {
    const map = new Map();
    if (ufaReady && data.seasons) {
      for (const r of data.seasons) {
        if (!map.has(r.year)) map.set(r.year, []);
        map.get(r.year).push({ ...r, _league: 'UFA' });
      }
    }
    if (usauReady) {
      for (const r of usauNatStats.seasons) {
        if (!map.has(r.year)) map.set(r.year, []);
        map.get(r.year).push({
          year: r.year, gp: r.gp,
          goals: r.goals, assists: r.assists,
          blocks: r.blocks, throwaways: r.throwaways,
          _league: 'USAU', _level: r.level,
        });
      }
    }
    const levelOrder = { UFA: 0, Club: 1, College: 2 };
    function rowRank(r) { return r._league === 'UFA' ? 0 : (levelOrder[r._level] ?? 99); }
    return [...map.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, rows]) => ({ year, rows: rows.slice().sort((a, b) => rowRank(a) - rowRank(b)) }));
  }, [data, usauNatStats, ufaReady, usauReady]);

  // Auto-expand years that have multiple leagues on first load
  useEffect(() => {
    if (expandedInitRef.current || yearGroups.length === 0) return;
    expandedInitRef.current = true;
    setExpandedYears(new Set(yearGroups.filter(g => g.rows.length > 1).map(g => g.year)));
  }, [yearGroups]);

  function toggleExpandYear(year) {
    setExpandedYears(prev => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year); else next.add(year);
      return next;
    });
  }

  const isLoading = (ufaId && status === 'loading') || (usauId && usauNatStatus === 'loading');
  const hasAnyData = ufaReady || usauReady;

  if (isLoading && !hasAnyData) {
    return <div style={{ padding: 32, textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: 2 }}>Loading…</div>;
  }
  if (!hasAnyData) {
    return <div style={{ padding: 48, textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: 2 }}>No stats available</div>;
  }

  const visibleGroups = STAT_GROUPS.map(g => ({
    ...g,
    cols: view === 'total' ? g.cols : g.cols.filter(c => !RATE_COLS.has(c.key)),
  })).filter(g => g.cols.length > 0);
  const allCols = visibleGroups.flatMap(g => g.cols);

  const cellBase = { padding: '5px 10px', whiteSpace: 'nowrap', fontSize: 12, fontFamily: 'var(--font-h2)', borderBottom: '1px solid var(--surf-border)', textAlign: 'center' };
  const headerBase = { ...cellBase, fontSize: 10, letterSpacing: '0.5px', color: 'var(--t-muted)', fontWeight: 600, textAlign: 'center', borderBottom: '2px solid var(--surf-border)' };
  const groupHeaderBase = { padding: '4px 10px', fontSize: 9, letterSpacing: '1.5px', fontFamily: 'var(--font-h2)', fontWeight: 700, textAlign: 'center', textTransform: 'uppercase', color: 'var(--t-secondary)', borderBottom: '1px solid var(--surf-border)', borderTop: '1px solid var(--surf-border)' };

  const toggleBtnStyle = (active, i) => ({
    padding: '5px 14px', fontSize: 10, letterSpacing: '1px', fontFamily: 'var(--font-h2)',
    border: 'none', borderLeft: i > 0 ? '1px solid var(--surf-border)' : 'none',
    borderRadius: 0, cursor: 'pointer',
    background: active ? ORANGE : 'transparent',
    color: active ? '#fff' : 'var(--t-secondary)',
    fontWeight: active ? 700 : 400,
  });

  const levelColors = { Club: 'var(--t-secondary)', College: 'var(--t-secondary)', Mixed: 'var(--t-secondary)', Beach: 'var(--t-secondary)' };
  const showPer100 = ufaReady;

  // Career row: prefer UFA career; fall back to USAU-only career
  const career = ufaReady ? data.career : (usauReady ? { ...usauNatStats.career, _league: 'USAU' } : null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* View toggle */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', padding: '10px 14px 8px', borderBottom: '1px solid var(--surf-border)' }}>
        <div style={{ display: 'flex', overflow: 'hidden', borderRadius: 4, border: '1px solid var(--surf-border)' }}>
          {[['total','Total'],['pergame','Per Game'],...(showPer100 ? [['per100','Per 100 Poss']] : [])].map(([k,l], i) => (
            <button key={k} style={toggleBtnStyle(view === k, i)} onClick={() => setView(k)}>{l}</button>
          ))}
        </div>
      </div>

      {/* Scrollable table */}
      <div className="orange-scroll" style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width: '100%', minWidth: `${130 + allCols.length * 62}px` }}>
          <colgroup>
            <col style={{ width: 130 }} />
            {allCols.map(c => <col key={c.key} />)}
          </colgroup>
          <thead style={{ position: 'sticky', top: 0, zIndex: 3 }}>
            <tr>
              <th style={{ ...groupHeaderBase, textAlign: 'left', position: 'sticky', left: 0, zIndex: 4, borderRight: '1px solid var(--surf-border)', background: 'var(--sticky-row-even)' }}></th>
              {visibleGroups.map(g => (
                <th key={g.key} colSpan={g.cols.length} style={{ ...groupHeaderBase, borderLeft: '1px solid var(--surf-border)', background: 'var(--sticky-row-even)' }}>
                  {g.label}
                </th>
              ))}
            </tr>
            <tr>
              <th style={{ ...headerBase, textAlign: 'center', position: 'sticky', left: 0, background: 'var(--sticky-row-even)', zIndex: 4, borderRight: '1px solid var(--surf-border)' }}>Season</th>
              {visibleGroups.map(g => g.cols.map((col, ci) => (
                <th key={col.key}
                  style={{ ...headerBase, cursor: 'default', borderLeft: ci === 0 ? '1px solid var(--surf-border)' : undefined, background: 'var(--sticky-row-even)' }}
                  onMouseEnter={e => setTooltip({ text: col.tip, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {col.label}
                </th>
              )))}
            </tr>
          </thead>
          <tbody>
            {/* Career row */}
            {career && (() => {
              const isUFACareer = career._league !== 'USAU';
              return (
                <tr key="career">
                  <td style={{ ...cellBase, textAlign: 'center', position: 'sticky', left: 0, background: 'var(--sticky-row-career)', zIndex: 2, overflow: 'hidden', borderRight: '1px solid var(--surf-border)', fontWeight: 700, color: ORANGE }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      {isUFACareer && career.team_id && (
                        <img src={`/assets/png/${career.team_id}.png`} alt="" style={{ width: 18, height: 18, objectFit: 'contain', flexShrink: 0 }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                      )}
                      <span>Career</span>
                    </div>
                  </td>
                  {visibleGroups.map(g => g.cols.map((col, ci) => {
                    const raw = career[col.key];
                    const display = _fmt(raw, col, view, career);
                    return (
                      <td key={col.key} style={{ ...cellBase, background: 'rgba(234,96,32,0.07)', borderLeft: ci === 0 ? '1px solid var(--surf-border)' : undefined, color: raw == null ? 'var(--t-muted)' : 'var(--t-primary)', lineHeight: 1.2 }}>
                        <div>{display}</div>
                        <div style={{ fontSize: 6, color: 'transparent', marginTop: 1 }}>·</div>
                      </td>
                    );
                  }))}
                </tr>
              );
            })()}

            {/* Year groups */}
            {yearGroups.map((group, gi) => {
              const { year, rows } = group;
              const isMulti = rows.length > 1;
              const isExpanded = expandedYears.has(year);
              const evenBg    = gi % 2 === 0 ? 'var(--surf-bg)'  : 'var(--card-bg)';
              const evenSticky= gi % 2 === 0 ? 'var(--sticky-row-even)' : 'var(--sticky-row-odd)';

              // Aggregate row for collapsed year header: box-score cols summed from all rows,
              // advanced stats taken from UFA row only (USAU excluded)
              const BOX_KEYS = ['gp', 'goals', 'assists', 'blocks', 'throwaways'];
              const ufaRowRef = rows.find(r => r._league === 'UFA') ?? null;
              const aggRow = ufaRowRef ? { ...ufaRowRef } : {};
              for (const k of BOX_KEYS) aggRow[k] = rows.reduce((s, r) => s + (r[k] ?? 0), 0);

              return (
                <React.Fragment key={year}>
                  {/* Year header row — only for multi-league years */}
                  {isMulti && (
                    <tr style={{ cursor: 'pointer' }} onClick={() => toggleExpandYear(year)}>
                      <td style={{ ...cellBase, textAlign: 'center', position: 'sticky', left: 0, background: evenSticky, zIndex: 2, borderRight: '1px solid var(--surf-border)', fontWeight: 600, color: 'var(--t-primary)', userSelect: 'none' }}>
                        <span style={{ position: 'absolute', left: 5, top: '50%', transform: 'translateY(-50%)', fontSize: 9, color: 'var(--t-muted)' }}>{isExpanded ? '▾' : '▸'}</span>
                        <span>{year}</span>
                      </td>
                      {allCols.map((col, ci) => {
                        const raw = aggRow[col.key];
                        const display = _fmt(raw, col, view, aggRow);
                        return (
                          <td key={col.key} style={{ ...cellBase, background: evenBg, borderLeft: ci === 0 ? '1px solid var(--surf-border)' : undefined, color: raw == null ? 'var(--t-muted)' : 'var(--t-primary)', lineHeight: 1.2 }}>
                            <div>{display}</div>
                            <div style={{ fontSize: 6, color: 'transparent', marginTop: 1 }}>·</div>
                          </td>
                        );
                      })}
                    </tr>
                  )}

                  {/* Data rows: always shown for single-league years; shown when expanded for multi */}
                  {(!isMulti || isExpanded) && rows.map((row, ri) => {
                    const isUSAU  = row._league === 'USAU';
                    const subEven = (gi * 10 + ri) % 2 === 0;
                    const rowBg     = subEven ? 'var(--surf-bg)' : 'var(--card-bg)';
                    const stickyBg  = subEven ? 'var(--sticky-row-even)' : 'var(--sticky-row-odd)';
                    const teamSlug  = row.team_id;
                    return (
                      <tr key={`${year}-${row._league}-${row._level ?? ''}-${ri}`}>
                        <td style={{ ...cellBase, textAlign: 'center', position: 'sticky', left: 0, background: stickyBg, zIndex: 2, overflow: 'hidden', borderRight: '1px solid var(--surf-border)', color: 'var(--t-primary)', lineHeight: 1.3 }}>
                          {isMulti ? (
                            /* Sub-row: show level label only */
                            isUSAU ? (
                              <span style={{ fontSize: 10, color: 'var(--t-secondary)' }}>{row._level ?? 'Club'}</span>
                            ) : (
                              <>
                                {teamSlug && <img src={`/assets/png/${teamSlug}.png`} alt="" style={{ width: 16, height: 16, objectFit: 'contain', marginRight: 4, verticalAlign: 'middle' }} onError={e => { e.currentTarget.style.display = 'none'; }} />}
                                <span style={{ fontSize: 10, color: ORANGE, fontWeight: 700 }}>Pro</span>
                              </>
                            )
                          ) : (
                            /* Flat row: show year (+ USAU level if applicable) */
                            <>
                              {!isUSAU && teamSlug && <img src={`/assets/png/${teamSlug}.png`} alt="" style={{ width: 18, height: 18, objectFit: 'contain', marginRight: 5, verticalAlign: 'middle' }} onError={e => { e.currentTarget.style.display = 'none'; }} />}
                              <span>{year}</span>
                              {isUSAU && row._level && <span style={{ fontSize: 9, color: 'var(--t-muted)', marginLeft: 4 }}>· {row._level}</span>}
                            </>
                          )}
                        </td>
                        {visibleGroups.map(g => g.cols.map((col, ci) => {
                          const raw = row[col.key];
                          const display = _fmt(raw, col, view, row);
                          const pctile = isUSAU ? null : row[`${col.key}_pctile`];
                          const pctileColor = _pctileColor(pctile);
                          return (
                            <td key={col.key}
                              style={{ ...cellBase, position: 'relative', zIndex: 0, background: rowBg, borderLeft: ci === 0 ? '1px solid var(--surf-border)' : undefined, color: raw == null ? 'var(--t-muted)' : 'var(--t-primary)', lineHeight: 1.2 }}
                            >
                              <div>{display}</div>
                              <div style={{ fontSize: 6, color: pctile != null ? pctileColor : 'transparent', marginTop: 1, letterSpacing: '0.3px' }}>{pctile != null ? `${pctile}th` : '·'}</div>
                            </td>
                          );
                        }))}
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div style={{ position: 'fixed', top: tooltip.y - 30, left: tooltip.x + 10, background: 'var(--card-bg)', border: '1px solid var(--surf-border)', borderRadius: 4, padding: '4px 8px', fontSize: 11, color: 'var(--t-primary)', pointerEvents: 'none', zIndex: 9999, fontFamily: 'var(--font-h2)', whiteSpace: 'nowrap' }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

function PlayerPassingChartPanel({ playerId, ufaId, selectedYears }) {
  const [allThrows,    setAllThrows]    = useState([]);
  const [allTimeThrows, setAllTimeThrows] = useState([]);
  const [leagueThrows, setLeagueThrows] = useState([]);
  const [throwTypes,   setThrowTypes]   = useState(new Set(THROW_TYPES));
  const [deepBallOnly, setDeepBallOnly] = useState(false);
  const [viewMode,     setViewMode]     = useState('point');
  const [losMode,      setLosMode]      = useState(false);
  const [status,       setStatus]       = useState('loading');

  useEffect(() => {
    if (!playerId) return;
    let cancelled = false;
    setStatus('loading');
    setAllThrows([]); setLeagueThrows([]);
    const url = `/api/players/${playerId}/throws`;
    fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => {
        if (cancelled) return;
        setAllThrows(d.items ?? []);
        setAllTimeThrows(d.items ?? []);
        setLeagueThrows(d.league_items ?? []);
        setStatus((d.items ?? []).length > 0 ? 'ready' : 'empty');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, [playerId]);

  const DEEP_BALL_SVG = 40 * SVG_YARD; // 40 yards downfield progression
  const displayThrows = useMemo(() => {
    const base = !selectedYears ? allThrows : allThrows.filter(t => selectedYears.has(t.year));
    return base.filter(t =>
      throwTypes.has(t.pbp_throw_type) &&
      (!deepBallOnly || (t.svg_throw_y ?? 0) - (t.svg_recv_y ?? 0) >= DEEP_BALL_SVG)
    );
  }, [allThrows, selectedYears, throwTypes, deepBallOnly]);

  function applyLOS(arr) {
    return arr.map(t => {
      if (t.svg_throw_y == null) return t;
      const dy = SVG_LOS_Y - t.svg_throw_y;
      return { ...t, svg_throw_y: SVG_LOS_Y, svg_recv_y: t.svg_recv_y != null ? t.svg_recv_y + dy : null };
    });
  }
  const throwChartThrows = useMemo(() => {
    const f = displayThrows.filter(t => t.thrower_id === ufaId);
    return losMode ? applyLOS(f) : f;
  }, [displayThrows, ufaId, losMode]);
  const recvChartThrows = useMemo(() => {
    const f = displayThrows.filter(t => t.receiver_id === ufaId);
    return losMode ? applyLOS(f) : f;
  }, [displayThrows, ufaId, losMode]);
  const completionRateThrows = useMemo(
    () => allTimeThrows.filter(t => t.thrower_id === ufaId),
    [allTimeThrows, ufaId]
  );

  if (status === 'loading') {
    return <div style={{ padding:'48px 0', textAlign:'center', color:'var(--t-muted)', fontFamily:'var(--font-h2)', fontSize:11, letterSpacing:'2px' }}>Loading throws…</div>;
  }
  if (status === 'error' || status === 'empty') {
    return <div style={{ padding:'48px 0', textAlign:'center', color:'var(--t-muted)', fontFamily:'var(--font-h2)', fontSize:11, letterSpacing:'2px' }}>No throw data available.</div>;
  }

  return (
    <div style={{ display:'flex', gap:20, flex:1, minHeight:0 }}>

      {/* ── Left controls column ── */}
      <div style={{ flexShrink:0, width:130, display:'flex', flexDirection:'column', gap:5 }}>
        <div style={{ fontFamily:'var(--font-h2)', fontSize:9, letterSpacing:'1.5px', textTransform:'uppercase', color:'var(--t-muted)', marginBottom:2 }}>Outcome</div>
        {OUTCOME_LIST.map(o => {
          const on = throwTypes.has(o.key);
          return (
            <button key={o.key} type="button"
              onClick={() => { const next=new Set(throwTypes); on?next.delete(o.key):next.add(o.key); setThrowTypes(next); }}
              style={{ padding:'4px 8px', border:`1px solid ${on?ORANGE:'var(--surf-border)'}`, borderRadius:12, background:on?`${ORANGE}22`:'transparent', color:on?ORANGE:'var(--t-muted)', fontFamily:'var(--font-h2)', fontSize:10, cursor:'pointer', letterSpacing:'0.5px', transition:'border-color .15s,color .15s,background .15s', textAlign:'left', width:'100%' }}
            >{o.label}</button>
          );
        })}
        <div style={{ height:1, background:'var(--surf-border)', margin:'6px 0' }} />
        <button type="button"
          onClick={() => setDeepBallOnly(v=>!v)}
          style={{ padding:'4px 8px', border:`1px solid ${deepBallOnly?ORANGE:'var(--surf-border)'}`, borderRadius:12, background:deepBallOnly?`${ORANGE}22`:'transparent', color:deepBallOnly?ORANGE:'var(--t-muted)', fontFamily:'var(--font-h2)', fontSize:10, cursor:'pointer', letterSpacing:'0.5px', transition:'border-color .15s,color .15s,background .15s', textAlign:'left', width:'100%' }}
        >40+ yd</button>
        <button type="button"
          onClick={() => setViewMode(v => v === 'point' ? 'heatmap' : 'point')}
          style={{ padding:'4px 8px', border:`1px solid ${viewMode==='heatmap'?ORANGE:'var(--surf-border)'}`, borderRadius:12, background:viewMode==='heatmap'?`${ORANGE}22`:'transparent', color:viewMode==='heatmap'?ORANGE:'var(--t-muted)', fontFamily:'var(--font-h2)', fontSize:10, cursor:'pointer', letterSpacing:'0.5px', transition:'border-color .15s,color .15s,background .15s', textAlign:'left', width:'100%' }}
        >Heat Map</button>
        <button type="button"
          onClick={() => setLosMode(v => !v)}
          style={{ padding:'4px 8px', border:`1px solid ${losMode?ORANGE:'var(--surf-border)'}`, borderRadius:12, background:losMode?`${ORANGE}22`:'transparent', color:losMode?ORANGE:'var(--t-muted)', fontFamily:'var(--font-h2)', fontSize:10, cursor:'pointer', letterSpacing:'0.5px', transition:'border-color .15s,color .15s,background .15s', textAlign:'left', width:'100%' }}
        >Line of Scrimmage</button>
      </div>

      {/* ── Charts ── */}
      <div style={{ flex:1, minWidth:0, display:'flex', gap:10 }}>
        {[
          ['Throw Chart',
            viewMode === 'heatmap'
              ? <PChartReceiverHeatMap throws={throwChartThrows} xCoord="svg_throw_x" yCoord="svg_throw_y" losMode={losMode} key="f" />
              : <PChartField2D throws={throwChartThrows} losMode={losMode} key="f" />,
          ],
          ['Receiver Chart',
            viewMode === 'heatmap'
              ? <PChartReceiverHeatMap throws={recvChartThrows} leagueThrows={leagueThrows} losMode={losMode} key="r" />
              : <PChartField2D throws={recvChartThrows} losMode={losMode} key="r" />,
          ],
          ['Completion Rate', <PChartCompletionRateMap throws={completionRateThrows} key="c" />],
        ].map(([title, chart]) => (
          <div key={title} style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', gap:4 }}>
            <div style={{ fontFamily:'var(--font-h1)', fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.1em', color:'var(--t-secondary)', flexShrink:0 }}>{title}</div>
            <div style={{ flex:1, minHeight:0, border:'1px solid var(--surf-border)', borderRadius:8, overflow:'hidden' }}>
              {chart}
            </div>
          </div>
        ))}
      </div>

    </div>
  );
}

export default function PlayerProfilePage() {
  const { id } = useParams();
  const [apiData, setApiData] = useState(null);
  const [status,  setStatus]  = useState('loading'); // loading | ready | error
  const [errorMsg, setErrorMsg] = useState(null);

  // null = career aggregate; Set<number> = selected years
  const [selectedYears, setSelectedYears] = useState(null);

  // Bottom tab area
  const [bottomTab, setBottomTab] = useState('videos');
  const [videos, setVideos] = useState([]);
  const [videosStatus, setVideosStatus] = useState('idle'); // idle | loading | ready | error
  const [activeVideo, setActiveVideo] = useState(null);
  const [accolades, setAccolades] = useState([]);
  const [accoladesStatus, setAccoladesStatus] = useState('idle');
  const [statsLeague, setStatsLeague] = useState('all'); // 'all'|'ufa'|'pul'|'wul'|'usau'
  const [usauNatStats, setUsauNatStats] = useState(null);
  const [usauNatStatus, setUsauNatStatus] = useState('idle');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setStatus('loading');
    setApiData(null);
    setSelectedYears(null);
    setVideos([]);
    setVideosStatus('idle');
    setActiveVideo(null);
    setAccolades([]);
    setAccoladesStatus('idle');
    setStatsLeague('all');
    setUsauNatStats(null);
    setUsauNatStatus('idle');
    fetch(`/api/players/${id}`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(d => { if (!cancelled) { setApiData(d); setStatus('ready'); } })
      .catch(e => { if (!cancelled) { setErrorMsg(e.message); setStatus('error'); } });
    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    const usauId = apiData?.player?.usau_id;
    if (!usauId) { setUsauNatStats(null); setUsauNatStatus('skip'); return; }
    let cancelled = false;
    setUsauNatStatus('loading');
    fetch(`/api/players/${id}/usau_season_stats`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(d => { if (!cancelled) { setUsauNatStats(d); setUsauNatStatus('ready'); } })
      .catch(() => { if (!cancelled) setUsauNatStatus('error'); });
    return () => { cancelled = true; };
  }, [id, apiData]);

  // ── Derived from API ────────────────────────────────────────────────────
  const player            = apiData?.player      ?? null;
  const ufaStats          = apiData?.ufaStats    ?? [];
  const pulStats          = apiData?.pulStats?.filter(s => s.season !== 'career') ?? [];
  const wulStats          = apiData?.wulStats    ?? [];
  const mluStats          = apiData?.mluStats    ?? [];
  const usauHistory       = apiData?.usauHistory ?? [];
  const internationalData = apiData?.international ?? [];

  const maxYear = useMemo(() => Math.max(...ufaStats.map(s => s.year), 0), [ufaStats]);

  // Career entry per season for the timeline section
  const careerEntries = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const sorted = [...ufaStats]
      .filter(s => !/^allstars/i.test(s.team_id ?? ''))
      .sort((a, b) => a.year - b.year);
    const groups = [];
    for (const s of sorted) {
      const team = s.team_name ?? s.team_id ?? '—';
      const last = groups[groups.length - 1];
      if (last && last.team === team) {
        last.yearEnd = s.year;
        last.active  = s.year === currentYear;
      } else {
        groups.push({ team, league: 'UFA', yearStart: s.year, yearEnd: s.year, active: s.year === currentYear });
      }
    }
    // Fallback: if no season rows but ufa_players has team info, add a single entry
    if (groups.filter(g => g.league === 'UFA').length === 0 && player?.ufa_id && player?.current_team_name) {
      const yr = player.most_recent_team_year ?? currentYear;
      groups.push({ team: player.current_team_name, league: 'UFA', yearStart: yr, yearEnd: yr, active: yr === currentYear });
    }
    // Add PUL entries grouped by team+consecutive seasons
    const pulSorted = [...pulStats].sort((a, b) => a.season.localeCompare(b.season));
    for (const s of pulSorted) {
      const team = s.team || '—';
      const yr   = parseInt(s.season, 10);
      const last = groups.find(g => g.league === 'PUL' && g.team === team);
      if (last && last.yearEnd === yr - 1) {
        last.yearEnd = yr;
        last.active  = yr === currentYear;
      } else {
        groups.push({ team, league: 'PUL', yearStart: yr, yearEnd: yr, active: yr === currentYear });
      }
    }
    // Add WUL entries grouped by team+consecutive seasons
    const wulSorted = [...wulStats].sort((a, b) => a.year - b.year);
    for (const s of wulSorted) {
      const team = s.team || '—';
      const yr   = s.year;
      const last = groups.find(g => g.league === 'WUL' && g.team === team);
      if (last && last.yearEnd === yr - 1) {
        last.yearEnd = yr;
        last.active  = yr === currentYear;
      } else {
        groups.push({ team, league: 'WUL', yearStart: yr, yearEnd: yr, active: yr === currentYear });
      }
    }
    // Add MLU entries grouped by team+consecutive seasons
    const mluSorted = [...mluStats].sort((a, b) => a.year - b.year);
    for (const s of mluSorted) {
      const team = s.team || '—';
      const yr   = s.year;
      const last = groups.find(g => g.league === 'MLU' && g.team === team);
      if (last && last.yearEnd === yr - 1) {
        last.yearEnd = yr;
      } else {
        groups.push({ team, league: 'MLU', yearStart: yr, yearEnd: yr, active: false });
      }
    }
    return groups.sort((a, b) => b.yearEnd - a.yearEnd).map(g => ({
      ...g,
      years: g.yearStart === g.yearEnd ? String(g.yearStart) : `${g.yearStart}–${g.yearEnd}`,
    }));
  }, [ufaStats, pulStats, wulStats, mluStats, player, maxYear]);

  // USAU entries grouped by competition level → team+consecutive seasons
  const usauEntries = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const LEVEL_ORDER = ['Club', 'College', 'Youth', 'High School', 'Middle School', 'Beach'];
    const buckets = {};
    const sorted = [...usauHistory].sort((a, b) => a.year - b.year);
    for (const s of sorted) {
      const rawLevel = s.competition_level || 'Club';
      // Normalise bucket key
      let bucket = rawLevel;
      if (/youth/i.test(rawLevel)) bucket = 'Youth';
      else if (/high.?school/i.test(rawLevel)) bucket = 'High School';
      else if (/middle.?school/i.test(rawLevel)) bucket = 'Middle School';
      else if (/college/i.test(rawLevel)) bucket = 'College';
      else if (/beach/i.test(rawLevel)) bucket = 'Beach';
      else if (/club/i.test(rawLevel)) bucket = 'Club';
      if (!buckets[bucket]) buckets[bucket] = [];
      const team = s.team_name || '—';
      const yr   = s.year;
      const logo = s.logo_filename || null;
      // Find the most recent existing stint for this team in this bucket
      const sameTeamIdx = buckets[bucket].reduce((found, g, i) => g.team === team ? i : found, -1);
      if (sameTeamIdx !== -1) {
        const existing = buckets[bucket][sameTeamIdx];
        // Only break into a new stint if a DIFFERENT team appeared in a later year after this one
        const interrupted = buckets[bucket].slice(sameTeamIdx + 1).some(g => g.yearStart > existing.yearEnd);
        if (!interrupted) {
          if (yr > existing.yearEnd) existing.yearEnd = yr;
          existing.active = existing.yearEnd === currentYear;
          if (logo && !existing.logo) existing.logo = logo;
        } else {
          buckets[bucket].push({ team, logo, yearStart: yr, yearEnd: yr, active: yr === currentYear });
        }
      } else {
        buckets[bucket].push({ team, logo, yearStart: yr, yearEnd: yr, active: yr === currentYear });
      }
    }
    // Sort within each bucket descending; order buckets by LEVEL_ORDER
    return LEVEL_ORDER
      .filter(lbl => buckets[lbl])
      .map(lbl => ({
        label: lbl,
        entries: buckets[lbl]
          .sort((a, b) => b.yearEnd - a.yearEnd)
          .map(g => ({ ...g, years: g.yearStart === g.yearEnd ? String(g.yearStart) : `${g.yearStart}–${g.yearEnd}` })),
      }));
  }, [usauHistory]);

  function toggleYear(year) {
    setSelectedYears(prev => {
      const next = new Set(prev ?? []);
      if (next.has(year)) { next.delete(year); return next.size === 0 ? null : next; }
      next.add(year);
      return next;
    });
  }

  const displayStats = useMemo(() => {
    const inclUFA  = statsLeague === 'all' || statsLeague === 'ufa';
    const inclPUL  = statsLeague === 'all' || statsLeague === 'pul';
    const inclWUL  = statsLeague === 'all' || statsLeague === 'wul';
    const inclUSAU = statsLeague === 'all' || statsLeague === 'usau';
    const ufaRows  = inclUFA  ? (!selectedYears ? ufaStats  : ufaStats.filter(s => selectedYears.has(s.year))) : [];
    const pulRows  = inclPUL  ? (!selectedYears ? pulStats  : pulStats.filter(s => selectedYears.has(parseInt(s.season, 10)))) : [];
    const wulRows  = inclWUL  ? (!selectedYears ? wulStats  : wulStats.filter(s => selectedYears.has(s.year))) : [];
    const usauRows = inclUSAU && usauNatStats?.seasons
      ? (!selectedYears ? usauNatStats.seasons : usauNatStats.seasons.filter(s => selectedYears.has(s.year)))
      : [];

    const sum = { throws: 0, completions: 0, goals: 0, throwaways: 0, assists: 0, blocks: 0, games_played: 0 };
    for (const r of ufaRows) {
      sum.throws        += r.throw_attempts  ?? 0;
      sum.completions   += r.completions     ?? 0;
      sum.goals         += r.goals           ?? 0;
      sum.throwaways    += r.throwaways      ?? 0;
      sum.assists       += r.assists         ?? 0;
      sum.blocks        += r.blocks          ?? 0;
      sum.games_played  += r.games_played    ?? 0;
    }
    for (const r of pulRows) {
      const t = r.throws     ?? 0;
      const e = r.throw_err  ?? 0;
      sum.throws        += t;
      sum.completions   += t - e;
      sum.goals         += r.goals         ?? 0;
      sum.throwaways    += e;
      sum.assists       += r.assists       ?? 0;
      sum.blocks        += r.blocks        ?? 0;
      sum.games_played  += r.games_played  ?? 0;
    }
    for (const r of wulRows) {
      const th   = r.th   ?? 0;
      const ther = r.ther ?? 0;
      sum.throws        += th;
      sum.completions   += th - ther;
      sum.goals         += r.g           ?? 0;
      sum.throwaways    += ther;
      sum.assists       += r.a           ?? 0;
      sum.blocks        += r.b           ?? 0;
      sum.games_played  += r.games_played ?? 0;
    }
    for (const r of usauRows) {
      sum.goals        += r.goals      ?? 0;
      sum.assists      += r.assists    ?? 0;
      sum.blocks       += r.blocks     ?? 0;
      sum.throwaways   += r.throwaways ?? 0;
      sum.games_played += r.gp        ?? 0;
    }
    const completionPct = sum.throws > 0
      ? Math.round(sum.completions / sum.throws * 100) + '%'
      : '—';
    return { ...sum, completionPct };
  }, [selectedYears, ufaStats, pulStats, wulStats, statsLeague, usauNatStats]);

  // Years available for the active stats league
  const availableYears = useMemo(() => {
    const inclUFA  = statsLeague === 'all' || statsLeague === 'ufa';
    const inclPUL  = statsLeague === 'all' || statsLeague === 'pul';
    const inclWUL  = statsLeague === 'all' || statsLeague === 'wul';
    const inclUSAU = statsLeague === 'all' || statsLeague === 'usau';
    const ufaYrs   = inclUFA  ? ufaStats.map(s => s.year) : [];
    const pulYrs   = inclPUL  ? pulStats.map(s => parseInt(s.season, 10)) : [];
    const wulYrs   = inclWUL  ? wulStats.map(s => s.year) : [];
    const usauYrs  = inclUSAU ? (usauNatStats?.seasons ?? []).map(s => s.year) : [];
    return [...new Set([...ufaYrs, ...pulYrs, ...wulYrs, ...usauYrs])].sort((a, b) => b - a);
  }, [ufaStats, pulStats, wulStats, statsLeague, usauNatStats]);

  // League toggle options for the stat cards section
  const statLeagueOptions = useMemo(() => {
    const opts = [];
    if (ufaStats.length || pulStats.length || wulStats.length) opts.push('all');
    if (ufaStats.length) opts.push('ufa');
    if (pulStats.length) opts.push('pul');
    if (wulStats.length) opts.push('wul');
    if (usauNatStats?.seasons?.length) opts.push('usau');
    return opts;
  }, [ufaStats, pulStats, wulStats, usauNatStats]);

  const displayName = player?.display_name ?? player?.name ?? id;
  const initials    = displayName.split(' ').map(w => w[0]).join('').slice(0, 3);
  const proStyle    = LEVEL_STYLE['Pro'];

  // ── Loading / error states ──────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-body)' }}>
        Loading…
      </div>
    );
  }
  if (status === 'error' || !player) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ color: 'var(--t-muted)', fontFamily: 'var(--font-body)' }}>Player not found {errorMsg ? `(${errorMsg})` : ''}</div>
        <Link to="/players" style={{ color: 'var(--orange)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase' }}>← Back to search</Link>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', padding: '24px 16px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

      {/* ── Card ── */}
      <div style={{
        maxWidth: 1560, width: '100%',
        height: 'calc(100vh - 48px)',
        display: 'flex', flexDirection: 'column',
        background: 'var(--card-bg)',
        borderRadius: 4,
        boxShadow: 'var(--card-shadow)',
        border: '1px solid var(--card-border-clr)',
        backdropFilter: 'var(--card-backdrop)',
        overflow: 'hidden',
      }}>

        {/* ── Site chrome ── */}
        <PageChrome />

        {/* ── Hero ── */}
        <div style={{ padding: '32px 32px 20px', display: 'flex', gap: 28, alignItems: 'flex-start', flexShrink: 0 }}>

            {/* Avatar */}
            <div style={{
              flexShrink: 0, width: 110, height: 110, borderRadius: 8,
              alignSelf: 'flex-start',
              background: 'var(--avatar-bg)',
              border: '1.5px solid var(--avatar-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              {player.photo_url
                ? <img src={player.photo_url} alt={displayName} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 36, fontFamily: 'var(--font-h1)', color: 'var(--avatar-color)' }}>{initials}</span>
              }
            </div>

            {/* Name / meta */}
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
                <h1 style={{
                  fontFamily: 'var(--font-h1)', fontWeight: 600,
                  fontSize: 'clamp(1.8rem, 4vw, 2.8rem)',
                  color: 'var(--t-primary)', margin: 0, letterSpacing: '-0.02em',
                }}>
                  {displayName}
                </h1>
                {player.jersey_number != null && (
                  <span style={{
                    fontFamily: 'var(--font-h1)', fontSize: '1.4rem',
                    color: 'var(--orange)', opacity: 0.7,
                  }}>
                    #{player.jersey_number}
                  </span>
                )}
              </div>

              {(player.current_team_name || player.most_recent_team_name) && (
                <div style={{
                  fontSize: 13, color: 'var(--t-secondary)',
                  fontFamily: 'var(--font-body)',
                }}>
                  {player.current_team_name ?? player.most_recent_team_name}
                </div>
              )}

              {/* Chips: International flag + Pro */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {internationalData.length > 0 && (
                  <span style={{
                    width: 44, height: 22, borderRadius: 99, overflow: 'hidden',
                    border: '1px solid rgba(0,80,180,0.22)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <img src={`${import.meta.env.BASE_URL}assets/png/International_teams/us.svg`} alt="USA" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </span>
                )}
                {(player.ufa_id || player.pul_id || player.wul_id) && (
                <span style={{
                  width: 44, height: 22, borderRadius: 99,
                  border: `1px solid ${proStyle.border}`,
                  background: proStyle.bg,
                  color: proStyle.text,
                  fontSize: 10, letterSpacing: '1.5px', textTransform: 'uppercase',
                  fontFamily: 'var(--font-h2)', fontWeight: 600,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, lineHeight: 1, paddingLeft: '1.5px',
                }}>
                  Pro
                </span>
                )}
              </div>
            </div>
        </div>

        {/* ── Split panel ── */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', alignItems: 'stretch', padding: '0 32px 48px', boxSizing: 'border-box' }}>

          {/* Left 75%: League ID + Statistics */}
          <div style={{ flex: '0 0 75%', minWidth: 0, paddingRight: 32, overflowY: 'hidden', display: 'flex', flexDirection: 'column' }}>

          {/* ── League ID ────────────────────────────────────────────── */}
          <section style={{ marginBottom: 32 }}>
            <SectionLabel>League ID</SectionLabel>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
              {player.ufa_id && (
                <div style={{ padding: '6px 14px', borderRadius: 6, background: 'var(--surf-bg)', border: '1px solid var(--surf-border)' }}>
                  <div style={{ fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--orange)', fontFamily: 'var(--font-h2)', marginBottom: 2 }}>UFA</div>
                  <div style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--mono-clr)' }}>{player.ufa_id}</div>
                </div>
              )}
              {player.pul_id && (
                <div style={{ padding: '6px 14px', borderRadius: 6, background: 'var(--surf-bg)', border: '1px solid var(--surf-border)' }}>
                  <div style={{ fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--orange)', fontFamily: 'var(--font-h2)', marginBottom: 2 }}>PUL</div>
                  <div style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--mono-clr)' }}>{player.pul_id}</div>
                </div>
              )}
              {player.wul_id && (
                <div style={{ padding: '6px 14px', borderRadius: 6, background: 'var(--surf-bg)', border: '1px solid var(--surf-border)' }}>
                  <div style={{ fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--orange)', fontFamily: 'var(--font-h2)', marginBottom: 2 }}>WUL</div>
                  <div style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--mono-clr)' }}>{player.wul_id}</div>
                </div>
              )}
              {player.usau_id && (
                <div style={{ padding: '6px 14px', borderRadius: 6, background: 'var(--surf-bg)', border: '1px solid var(--surf-border)' }}>
                  <div style={{ fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--orange)', fontFamily: 'var(--font-h2)', marginBottom: 2 }}>USAU</div>
                  <div style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--mono-clr)' }}>{player.usau_id}</div>
                </div>
              )}
            </div>
          </section>

          {/* ── Stats ────────────────────────────────────────────────── */}
          <section style={{ paddingBottom: 32, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 }}>
              <SectionLabel style={{ marginBottom: 0 }}>Statistics</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
                {/* League selector — right aligned, above year selector */}
                {statLeagueOptions.length > 1 && (
                  <div style={{ display: 'flex', overflow: 'hidden', borderRadius: 4, border: '1px solid rgba(234,96,32,0.22)' }}>
                    {statLeagueOptions.map((lg, i) => (
                      <button key={lg} type="button"
                        onClick={() => { setStatsLeague(lg); setSelectedYears(null); }}
                        style={{
                          padding: '5px 0', width: 54, fontSize: 10, letterSpacing: '1.5px',
                          textTransform: 'uppercase', fontFamily: 'var(--font-h2)', fontWeight: 600,
                          background: statsLeague === lg ? 'var(--orange)' : 'transparent',
                          color: statsLeague === lg ? '#fff' : 'var(--orange)',
                          border: 'none',
                          cursor: 'pointer',
                        }}>
                        {lg === 'all' ? 'All' : lg.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
                {/* Year selector */}
                <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(234,96,32,0.18)' }}>
                  <button type="button" onClick={() => setSelectedYears(null)} style={{
                    padding: '5px 0', width: 54, fontSize: 10, letterSpacing: '1.5px',
                    textTransform: 'uppercase', fontFamily: 'var(--font-h2)', fontWeight: 600,
                    background: !selectedYears ? 'var(--orange)' : 'transparent',
                    color: !selectedYears ? '#fff' : 'var(--orange)',
                    border: 'none', cursor: 'pointer', transition: 'background .15s',
                  }}>Career</button>
                  {availableYears.map(yr => {
                    const active = selectedYears?.has(yr);
                    return (
                      <button key={yr} type="button" onClick={() => toggleYear(yr)} style={{
                        padding: '5px 0', width: 54, fontSize: 10, letterSpacing: '1.5px',
                        textTransform: 'uppercase', fontFamily: 'var(--font-h2)', fontWeight: 600,
                        background: active ? proStyle.bg : 'transparent',
                        color: active ? proStyle.text : 'var(--orange)',
                        border: 'none', cursor: 'pointer', transition: 'background .15s',
                      }}>{yr}</button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr)',
              gap: 12,
            }}>
{(() => {
                const gp = displayStats.games_played;
                const pg = (n) => gp > 0 ? (n / gp).toFixed(1) + ' / g' : null;
                const atRatio = displayStats.throwaways > 0
                  ? (displayStats.assists / displayStats.throwaways).toFixed(1) + ' A/T'
                  : null;
                return [
                  ['Pass Attempts', displayStats.throws,      pg(displayStats.throws)],
                  ['Completion',    displayStats.completionPct, atRatio],
                  ['Goals',         displayStats.goals,        pg(displayStats.goals)],
                  ['Assists',       displayStats.assists,      pg(displayStats.assists)],
                  ['Throwaways',    displayStats.throwaways,   pg(displayStats.throwaways)],
                  ['Blocks',        displayStats.blocks,       pg(displayStats.blocks)],
                ].map(([label, value, sub]) => (
                  <div key={label} style={{
                    padding: '4px 20px', borderRadius: 8,
                    background: 'var(--surf-bg)',
                    border: '1px solid var(--surf-border)',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--orange)', fontFamily: 'var(--font-h2)', marginBottom: 8 }}>{label}</div>
                    <div style={{ fontFamily: 'var(--font-h1)', fontSize: '2rem', fontWeight: 600, color: 'var(--t-primary)', lineHeight: 1 }}>{value ?? '—'}</div>
                    {sub && <div style={{ marginTop: 6, fontSize: 10, color: 'var(--t-muted)', fontFamily: 'var(--font-body)' }}>{sub}</div>}
                  </div>
                ));
              })()}
            </div>

            {player.bio_text && (
              <div style={{ marginTop: 16, padding: '14px 18px', borderRadius: 8, background: 'var(--note-bg)', border: '1px solid var(--note-border)' }}>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--note-clr)', fontFamily: 'var(--font-body)', lineHeight: 1.6 }}>
                  {player.bio_text}
                </p>
              </div>
            )}
          </section>

          {/* ── Bottom tabbed area ── */}
          <section style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {(() => {
              const hasProId = !!(player.ufa_id || player.pul_id || player.wul_id);
              const hasStats = !!(hasProId || player.usau_id);
              const tabs = [
                { key: 'videos',       label: 'Videos' },
                ...(player.ufa_id ? [{ key: 'passing_chart',  label: 'Passing Chart'  }] : []),
                ...(player.ufa_id ? [{ key: 'passing_habits', label: 'Passing Habits' }] : []),
                ...(hasStats      ? [{ key: 'season_stats', label: 'Season Stats'   }] : []),
                { key: 'accolades',   label: 'Accolades' },
              ];
              return (
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                  {/* Tab bar */}
                  <div style={{ display: 'flex', borderBottom: '1px solid var(--nav-border)', marginBottom: 20, flexShrink: 0 }}>
                    {tabs.map(t => (
                      <button key={t.key} type="button"
                        onClick={() => setBottomTab(t.key)}
                        style={{
                          padding: '8px 20px',
                          background: 'none', border: 'none', cursor: 'pointer',
                          borderBottom: bottomTab === t.key ? '2px solid var(--orange)' : '2px solid transparent',
                          fontFamily: 'var(--font-h2)', fontSize: 10, letterSpacing: '1.5px',
                          textTransform: 'uppercase',
                          color: bottomTab === t.key ? 'var(--orange)' : 'var(--t-muted)',
                          transition: 'color .15s',
                          marginBottom: -1,
                        }}
                      >{t.label}</button>
                    ))}
                  </div>
                  <div className={bottomTab !== 'passing_chart' && bottomTab !== 'passing_habits' ? 'orange-scroll' : ''}
                       style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
                                overflowY: (bottomTab === 'passing_chart' || bottomTab === 'passing_habits') ? 'hidden' : 'auto' }}>
                    {/* Videos panel */}
                    {bottomTab === 'videos' && (
                      <VideoPanel id={id} usauId={player.usau_id}
                        videos={videos} setVideos={setVideos}
                        videosStatus={videosStatus} setVideosStatus={setVideosStatus}
                        activeVideo={activeVideo} setActiveVideo={setActiveVideo}
                      />
                    )}

                    {/* Accolades panel */}
                    {bottomTab === 'accolades' && (
                      <AccoladesPanel id={id}
                        accolades={accolades} setAccolades={setAccolades}
                        accoladesStatus={accoladesStatus} setAccoladesStatus={setAccoladesStatus}
                      />
                    )}

                    {/* Passing habits panel */}
                    {bottomTab === 'passing_habits' && (
                      <PlayerPassingHabitsPanel playerId={id} ufaId={player.ufa_id} playerName={player.display_name ?? player.name} selectedYears={selectedYears} />
                    )}

                    {/* Passing chart panel */}
                    {bottomTab === 'passing_chart' && (
                      <PlayerPassingChartPanel playerId={id} ufaId={player.ufa_id} selectedYears={selectedYears} />
                    )}

                    {/* Blank panel */}
                    {bottomTab === 'season_stats' && (
                      <PlayerSeasonStatsPanel playerId={id} ufaId={player.ufa_id} usauId={player.usau_id} usauNatStats={usauNatStats} usauNatStatus={usauNatStatus} />
                    )}
                  </div>
                </div>
              );
            })()}
          </section>

          </div>{/* end left panel */}

          {/* Right 25%: Career Timeline */}
          <div style={{ flex: '0 0 25%', minWidth: 0, borderLeft: '1px solid var(--surf-border)', paddingLeft: 24, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flexShrink: 0, marginBottom: 12 }}><SectionLabel>Career</SectionLabel></div>
            <div className="orange-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>

              {/* ── International section ── */}
              {internationalData.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase',
                    color: 'var(--t-primary)', fontFamily: 'var(--font-h2)', fontWeight: 600,
                    padding: '2px 10px', borderRadius: 99,
                    background: 'rgba(0,80,180,0.10)', border: '1px solid rgba(0,80,180,0.22)',
                    whiteSpace: 'nowrap',
                  }}>
                    International
                  </span>
                  <div style={{ flex: 1, height: 1, background: 'rgba(0,80,180,0.15)' }} />
                </div>
                <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--surf-border)' }}>
                  {internationalData.map((entry, i) => {
                    const label = `${entry.division.charAt(0).toUpperCase()}${entry.division.slice(1)} ${entry.event_type.toUpperCase().replace('_', ' ')}`;
                    const record = (entry.wins != null && entry.losses != null) ? `${entry.wins}–${entry.losses}` : null;
                    return (
                      <div key={entry.tournament_key} style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 100px 80px',
                        alignItems: 'center',
                        gap: 16,
                        padding: '12px 18px',
                        borderBottom: i < internationalData.length - 1 ? '1px solid var(--surf-divider)' : 'none',
                        background: 'var(--surf-bg-2)',
                      }}>
                        <div>
                          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 14, color: 'var(--t-primary)', fontWeight: 600 }}>
                            Team USA
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--t-muted)', marginTop: 2 }}>
                            {label}{entry.location ? ` · ${entry.location}` : ''}
                          </div>
                        </div>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--years-clr)', textAlign: 'right' }}>
                          {entry.year}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          {entry.finish && (
                            <span style={{ fontSize: 11, fontFamily: 'var(--font-h2)', color: 'var(--orange)', fontWeight: 700 }}>{entry.finish}</span>
                          )}
                          {record && !entry.finish && (
                            <span style={{ fontSize: 11, fontFamily: 'var(--font-body)', color: 'var(--t-muted)' }}>{record}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

              {/* Pro group header */}
              {careerEntries.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase',
                    color: proStyle.text, fontFamily: 'var(--font-h2)', fontWeight: 600,
                    padding: '2px 10px', borderRadius: 99,
                    background: proStyle.bg, border: `1px solid ${proStyle.border}`,
                    whiteSpace: 'nowrap',
                  }}>
                    Pro
                  </span>
                  <div style={{ flex: 1, height: 1, background: proStyle.border, opacity: 0.20 }} />
                </div>
                <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--surf-border)' }}>
                  {careerEntries.map((entry, i) => {
                    const bgBase = entry.active ? 'var(--surf-bg-active)' : 'var(--surf-bg-2)';
                    const imgSrc = teamImgSrc(entry.league, entry.team);
                    return (
                    <div key={`${entry.league}-${entry.team}-${entry.yearStart}`} style={{
                      position: 'relative',
                      overflow: 'hidden',
                      display: 'grid',
                      gridTemplateColumns: '1fr 140px',
                      alignItems: 'center',
                      gap: 16,
                      padding: '12px 18px',
                      borderBottom: i < careerEntries.length - 1 ? '1px solid var(--surf-divider)' : 'none',
                      background: bgBase,
                    }}>
                      {imgSrc && (
                        <img
                          src={imgSrc}
                          aria-hidden="true"
                          style={{
                            position: 'absolute',
                            zIndex: 0,
                            left: '15%',
                            top: '60%',
                            transform: 'translate(-50%, -50%)',
                            height: '270%',
                            width: 'auto',
                            opacity: 0.12,
                            pointerEvents: 'none',
                            userSelect: 'none',
                          }}
                        />
                      )}
                      <div style={{ position: 'relative', zIndex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--font-h2)', fontSize: 14, color: 'var(--t-primary)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {entry.team}
                          {entry.active && (
                            <span style={{ marginLeft: 8, fontSize: 9, color: 'var(--orange)', letterSpacing: '1px', textTransform: 'uppercase' }}>Active</span>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--orange)', opacity: 0.6, marginTop: 2 }}>{entry.level ?? entry.league}</div>
                      </div>
                      <div style={{ position: 'relative', zIndex: 1, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--years-clr)', textAlign: 'right' }}>
                        {entry.years}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
              )}

              {/* ── USAU sections — one per competition level ── */}
              {usauEntries.map(({ label, entries }) => (
                <div key={label} style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                    <span style={{
                      fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase',
                      color: 'var(--t-primary)', fontFamily: 'var(--font-h2)', fontWeight: 600,
                      padding: '2px 10px', borderRadius: 99,
                      background: 'rgba(0,80,180,0.10)', border: '1px solid rgba(0,80,180,0.22)',
                      whiteSpace: 'nowrap',
                    }}>{label}</span>
                    <div style={{ flex: 1, height: 1, background: 'rgba(0,80,180,0.15)' }} />
                  </div>
                  <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--surf-border)' }}>
                    {entries.map((entry, i) => {
                      const imgSrc = entry.logo
                        ? `${BASE}/assets/png/USAU_teams/${entry.logo}`
                        : `${BASE}/assets/png/USAUicon.png`;
                      return (
                      <div key={`${entry.team}-${entry.yearStart}`} style={{
                        position: 'relative',
                        overflow: 'hidden',
                        display: 'grid',
                        gridTemplateColumns: '1fr 140px',
                        alignItems: 'center',
                        gap: 16,
                        padding: '12px 18px',
                        borderBottom: i < entries.length - 1 ? '1px solid var(--surf-divider)' : 'none',
                        background: entry.active ? 'var(--surf-bg-active)' : 'var(--surf-bg-2)',
                      }}>
                        <img
                          src={imgSrc}
                          aria-hidden="true"
                          style={{
                            position: 'absolute',
                            zIndex: 0,
                            left: '15%',
                            top: '60%',
                            transform: 'translate(-50%, -50%)',
                            height: '270%',
                            width: 'auto',
                            opacity: 0.12,
                            pointerEvents: 'none',
                            userSelect: 'none',
                          }}
                        />
                        <div style={{ position: 'relative', zIndex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--font-h2)', fontSize: 14, color: 'var(--t-primary)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {entry.team}
                            {entry.active && (
                              <span style={{ marginLeft: 8, fontSize: 9, color: 'var(--orange)', letterSpacing: '1px', textTransform: 'uppercase' }}>Active</span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--orange)', opacity: 0.6, marginTop: 2 }}>USAU</div>
                        </div>
                        <div style={{ position: 'relative', zIndex: 1, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--years-clr)', textAlign: 'right' }}>
                          {entry.years}
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              ))}

            </div>
          </div>

        </div>{/* end split panel */}
      </div>
    </div>
  );
}

// ── VideoPanel ────────────────────────────────────────────────────────────────
function ytEmbedUrl(url) {
  if (!url) return null;
  // already an embed URL
  if (url.includes('youtube.com/embed/')) return url;
  // youtu.be/ID
  const shortMatch = url.match(/youtu\.be\/([^?&]+)/);
  if (shortMatch) return `https://www.youtube.com/embed/${shortMatch[1]}`;
  // youtube.com/watch?v=ID
  const watchMatch = url.match(/[?&]v=([^&]+)/);
  if (watchMatch) return `https://www.youtube.com/embed/${watchMatch[1]}`;
  return null;
}

function VideoPanel({ id, usauId, videos, setVideos, videosStatus, setVideosStatus, activeVideo, setActiveVideo }) {
  const [autoplay, setAutoplay] = React.useState(false);
  useEffect(() => {
    if (!usauId || videosStatus !== 'idle') return;
    let cancelled = false;
    setVideosStatus('loading');
    fetch(`/api/players/${id}/videos`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        setVideos(d.videos ?? []);
        setActiveVideo(d.videos?.[0] ?? null);
        setVideosStatus('ready');
      })
      .catch(() => { if (!cancelled) setVideosStatus('error'); });
    return () => { cancelled = true; };
  }, [id, usauId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!usauId) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px' }}>
        No USAU ID linked — videos unavailable
      </div>
    );
  }
  if (videosStatus === 'loading') {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px' }}>
        Loading…
      </div>
    );
  }
  if (videosStatus === 'error') {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px' }}>
        Failed to load videos
      </div>
    );
  }
  if (videosStatus === 'ready' && videos.length === 0) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px' }}>
        No videos found
      </div>
    );
  }
  if (videosStatus !== 'ready') return null;

  const embedSrc = ytEmbedUrl(activeVideo?.nomination_video_url);
  const finalSrc  = embedSrc ? embedSrc + (autoplay ? '?autoplay=1' : '') : null;

  return (
    <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>

      {/* Main player */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {embedSrc ? (
          <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, borderRadius: 10, overflow: 'hidden', background: '#000' }}>
            <iframe
              key={finalSrc}
              src={finalSrc}
              title={`${activeVideo?.award} ${activeVideo?.year}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
            />
          </div>
        ) : (
          <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px' }}>
            Unable to embed video
          </div>
        )}
        {activeVideo && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontFamily: 'var(--font-h2)', fontSize: 13, fontWeight: 600, color: 'var(--t-primary)' }}>{activeVideo.award}</div>
            <div style={{ fontSize: 11, color: 'var(--t-muted)', fontFamily: 'var(--font-body)', marginTop: 2 }}>{activeVideo.year}</div>
          </div>
        )}
      </div>

      {/* Carousel */}
      {videos.length > 0 && (
        <div className="orange-scroll" style={{ width: 200, flexShrink: 0, maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {videos.map((v, i) => {
            const isActive = v === activeVideo;
            return (
              <button key={i} type="button" onClick={() => { setAutoplay(true); setActiveVideo(v); }} style={{
                background: isActive ? 'var(--surf-bg)' : 'transparent',
                border: `1px solid ${isActive ? 'var(--orange)' : 'var(--surf-border)'}`,
                borderRadius: 8, padding: '10px 12px', cursor: 'pointer', textAlign: 'left',
                transition: 'border-color .15s, background .15s',
              }}>
                <div style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: isActive ? 'var(--orange)' : 'var(--t-primary)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {v.award}
                </div>
                <div style={{ fontSize: 10, color: 'var(--t-muted)', fontFamily: 'var(--font-body)', marginTop: 2 }}>{v.year}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── AccoladesPanel ────────────────────────────────────────────────────────────
const LEAGUE_LABEL = { USAU: 'USAU', UFA: 'UFA', PUL: 'PUL', WUL: 'WUL', MLU: 'MLU' };

function AccoladesPanel({ id, accolades, setAccolades, accoladesStatus, setAccoladesStatus }) {
  useEffect(() => {
    if (accoladesStatus !== 'idle') return;
    let cancelled = false;
    setAccoladesStatus('loading');
    fetch(`/api/players/${id}/accolades`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setAccolades(d.accolades ?? []); setAccoladesStatus('ready'); } })
      .catch(() => { if (!cancelled) setAccoladesStatus('error'); });
    return () => { cancelled = true; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (accoladesStatus === 'loading') return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px' }}>Loading…</div>
  );
  if (accoladesStatus === 'error') return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px' }}>Failed to load accolades</div>
  );
  if (accoladesStatus === 'ready' && accolades.length === 0) return (
    <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--t-muted)', fontFamily: 'var(--font-h2)', fontSize: 11, letterSpacing: '2px' }}>No accolades found</div>
  );
  if (accoladesStatus !== 'ready') return null;

  // Group by year
  const byYear = {};
  for (const a of accolades) {
    if (!byYear[a.year]) byYear[a.year] = [];
    byYear[a.year].push(a);
  }
  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {years.map(yr => (
        <div key={yr}>
          {/* Year header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{ fontFamily: 'var(--font-h1)', fontSize: 18, fontWeight: 600, color: 'var(--t-primary)' }}>{yr}</div>
            <div style={{ flex: 1, height: 1, background: 'var(--surf-border)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {byYear[yr].map((a, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '12px 16px', borderRadius: 8,
                background: i % 2 === 0 ? 'var(--surf-bg)' : 'var(--surf-bg-2)',
                border: '1px solid var(--surf-border)',
              }}>
                {/* League badge */}
                <div style={{
                  flexShrink: 0, padding: '2px 8px', borderRadius: 99,
                  background: 'rgba(234,96,32,0.10)', border: '1px solid rgba(234,96,32,0.25)',
                  fontFamily: 'var(--font-h2)', fontSize: 9, letterSpacing: '1.5px',
                  textTransform: 'uppercase', color: 'var(--orange)',
                }}>
                  {LEAGUE_LABEL[a.league] ?? a.league}
                </div>

                {/* Accolade name */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-h2)', fontSize: 13, fontWeight: 600, color: 'var(--t-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.accolade}
                  </div>
                  {(a.division || a.gender) && (
                    <div style={{ fontSize: 10, color: 'var(--t-muted)', fontFamily: 'var(--font-body)', marginTop: 2 }}>
                      {[a.division, a.gender === 'M' ? 'Men' : a.gender === 'F' ? 'Women' : a.gender].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>

                {/* Awarding body + link */}
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  {a.award_url ? (
                    <a href={a.award_url} target="_blank" rel="noopener noreferrer"
                      style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-secondary)', textDecoration: 'none', transition: 'color .15s' }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--orange)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--t-secondary)'}
                    >
                      {a.awarding_body} ↗
                    </a>
                  ) : (
                    <span style={{ fontFamily: 'var(--font-h2)', fontSize: 11, color: 'var(--t-muted)' }}>{a.awarding_body}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children, style = {} }) {
  return (
    <div style={{
      fontSize: 9, letterSpacing: '2.5px', textTransform: 'uppercase',
      fontFamily: 'var(--font-h2)', fontWeight: 600,
      color: 'var(--orange)', opacity: 0.75,
      paddingBottom: 6,
      borderBottom: '1px solid var(--section-div)',
      marginBottom: 8,
      ...style,
    }}>
      {children}
    </div>
  );
}
