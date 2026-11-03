import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

// ── Coordinate system ──────────────────────────────────────────────────────
// Input: raw SVG pixels from player_field_map.py
//   svg_throw_x / svg_recv_x : 5→205  (left → right sideline)
//   svg_throw_y / svg_recv_y : 5→455  (attacking end line → defending end line)
//   Attacking goal line: y=80   Defending goal line: y=380   Center: x=105, y=230
//
// Output: Three.js world in yards
//   X = -((sx-5)/200 - 0.5) * FW   (flipped: SVG left → world +X)
//   Z =  (0.5 - (sy-5)/450) * FL   (flipped: SVG top/attacking → world +Z)

const FW = 53.3333;  // field width yards
const FL = 120;      // field length yards (including end zones)
const FH = FW / 2;   // half width
const EZ = 20;       // end zone depth yards

const svgToWorld = (sx, sy) => ({
  wx: -((sx - 5) / 200 - 0.5) * FW,
  wz:  (0.5 - (sy - 5) / 450) * FL,
});

// ── Outcome colors ─────────────────────────────────────────────────────────
const OUTCOMES = {
  pass:      { arc: 0x3a80cc, ring: 0x4a90d9, label: 'Pass'      },
  score:     { arc: 0x3fcf60, ring: 0x4fd46e, label: 'Score'     },
  drop:      { arc: 0xe6c84a, ring: 0xf2db70, label: 'Drop'      },
  throwaway: { arc: 0xcc3030, ring: 0xe84040, label: 'Throwaway' },
  stall:     { arc: 0x9333ea, ring: 0xa855f7, label: 'Stall'     },
  callahan:  { arc: 0x7f1d1d, ring: 0xa83232, label: 'Callahan'  },
};
const HOLLOW = { arc: 0x6a8ea8, ring: 0xb0c8d8 };
const CONNECTOR_COLOR = 0x7ab8e8;

export const OUTCOME_LIST = Object.entries(OUTCOMES).map(([key, v]) => ({
  key, label: v.label,
  color: `#${v.ring.toString(16).padStart(6, '0')}`,
  hollow: key === 'drop',
}));

// ── Shared geometry helpers ────────────────────────────────────────────────
const makeLine = (scene, p1, p2, color) => {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...p1), new THREE.Vector3(...p2),
  ]);
  const m = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
  scene.add(m);
  return m;
};

const makeGroupLine = (group, p1, p2, color) => {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(...p1), new THREE.Vector3(...p2),
  ]);
  group.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })));
};

const makePlane = (scene, width, depth, cx, cy, cz, color, opacity = 1) => {
  const geo = new THREE.PlaneGeometry(width, depth);
  const mat = new THREE.MeshLambertMaterial({
    color, side: THREE.DoubleSide, transparent: opacity < 1, opacity,
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(cx, cy, cz);
  scene.add(m);
  return m;
};

const makeSprite = (group, text, x, y, z, color, scale) => {
  const c2 = document.createElement('canvas');
  c2.width = 128; c2.height = 64;
  const ctx = c2.getContext('2d');
  ctx.font = 'bold 34px Barlow Condensed,Arial Narrow,sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 32);
  const tex = new THREE.CanvasTexture(c2);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  s.position.set(x, y, z);
  s.scale.set(scale, scale / 2, 1);
  group.add(s);
};

// ── Full Field geometry ────────────────────────────────────────────────────
// 120-yard field with end zones. Yard lines and hash marks on the 80-yard
// playing surface only. Brick marks at center of each end zone.
const buildFullField = (scene) => {
  const group = new THREE.Group();

  // Base plane.
  const basePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(FW, FL),
    new THREE.MeshLambertMaterial({ color: 0x0d1825, side: THREE.DoubleSide }),
  );
  basePlane.rotation.x = -Math.PI / 2;
  group.add(basePlane);

  // Alternating 5-yard bands — full field.
  for (let i = 0; i < FL / 5; i++) {
    const z = -FL / 2 + i * 5 + 2.5;
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(FW, 5),
      new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? 0x0d1825 : 0x0f1e2e, side: THREE.DoubleSide }),
    );
    band.rotation.x = -Math.PI / 2;
    band.position.set(0, 0.001, z);
    group.add(band);
  }

  // End zone tints.
  const ezMat = new THREE.MeshLambertMaterial({
    color: 0x0a1828, side: THREE.DoubleSide, transparent: true, opacity: 0.55,
  });
  [-1, 1].forEach((side) => {
    const ez = new THREE.Mesh(new THREE.PlaneGeometry(FW, EZ), ezMat);
    ez.rotation.x = -Math.PI / 2;
    ez.position.set(0, 0.002, side * (FL / 2 - EZ / 2));
    group.add(ez);
  });

  // Sidelines — full length.
  makeGroupLine(group, [-FH, 0.02, -FL/2], [-FH, 0.02, FL/2], 0x1e3852);
  makeGroupLine(group, [ FH, 0.02, -FL/2], [ FH, 0.02, FL/2], 0x1e3852);

  // End lines.
  makeGroupLine(group, [-FH, 0.02, -FL/2], [FH, 0.02, -FL/2], 0x3d88d0);
  makeGroupLine(group, [-FH, 0.02,  FL/2], [FH, 0.02,  FL/2], 0x3d88d0);

  // Goal lines.
  makeGroupLine(group, [-FH, 0.02, -FL/2+EZ], [FH, 0.02, -FL/2+EZ], 0x3d88d0);
  makeGroupLine(group, [-FH, 0.02,  FL/2-EZ], [FH, 0.02,  FL/2-EZ], 0x3d88d0);

  // Yard lines every 5 yards — playing field only.
  for (let yds = 0; yds <= 80; yds += 5) {
    const z = -FL/2 + EZ + yds;
    const color = (yds === 40 || yds % 10 === 0) ? 0x2a4a6e : 0x182f48;
    makeGroupLine(group, [-FH, 0.02, z], [FH, 0.02, z], color);
  }

  // Hash marks every yard — playing field only.
  for (let yds = 0; yds <= 80; yds++) {
    const z = -FL/2 + EZ + yds;
    makeGroupLine(group, [-3.1, 0.02, z], [-1.8, 0.02, z], 0x182f48);
    makeGroupLine(group, [ 1.8, 0.02, z], [ 3.1, 0.02, z], 0x182f48);
    makeGroupLine(group, [-FH+0.5, 0.02, z], [-FH+2.2, 0.02, z], 0x182f48);
    makeGroupLine(group, [ FH-2.2, 0.02, z], [ FH-0.5, 0.02, z], 0x182f48);
  }

  // Brick marks — center of each end zone.
  makeGroupLine(group, [-1.5, 0.02, -FL/2+EZ/2], [1.5, 0.02, -FL/2+EZ/2], 0x3d88d0);
  makeGroupLine(group, [-1.5, 0.02,  FL/2-EZ/2], [1.5, 0.02,  FL/2-EZ/2], 0x3d88d0);

  // Yard labels.
  [10, 20, 30, 40].forEach((yds) => {
    makeSprite(group, String(yds), -FH-3.5, 0.5, -FL/2+EZ+yds, '#7a9ab8', 6);
    makeSprite(group, String(yds),  FH+3.5, 0.5, -FL/2+EZ+yds, '#7a9ab8', 6);
    makeSprite(group, String(yds), -FH-3.5, 0.5,  FL/2-EZ-yds, '#7a9ab8', 6);
    makeSprite(group, String(yds),  FH+3.5, 0.5,  FL/2-EZ-yds, '#7a9ab8', 6);
  });
  makeSprite(group, 'GOAL', -FH-4, 0.5, -FL/2+EZ, '#4a90d9', 7);
  makeSprite(group, 'GOAL',  FH+4, 0.5, -FL/2+EZ, '#4a90d9', 7);
  makeSprite(group, 'GOAL', -FH-4, 0.5,  FL/2-EZ, '#4a90d9', 7);
  makeSprite(group, 'GOAL',  FH+4, 0.5,  FL/2-EZ, '#4a90d9', 7);

  scene.add(group);
  return group;
};

// ── LOS Field geometry ─────────────────────────────────────────────────────
// Completely separate diagram. The LOS is at z=0 in LOS-space.
// The field surface is a neutral plane — no end zones, no goal lines.
// Yard lines and hash marks run the full length of the rendered surface
// in both directions from the LOS. Only marking is the LOS line itself.
//
// LOS world-space: the LOS line is placed at z=0. Throws are plotted
// relative to the LOS — receiver z = throw air yards (positive = downfield).
const LOS_Z       =  0;    // LOS sits at world origin in LOS mode
const LOS_BEHIND  = 20;   // yards rendered behind LOS (negative Z)
const LOS_FORWARD = 100;  // yards rendered downfield (positive Z)
const LOS_CENTER  = (LOS_FORWARD - LOS_BEHIND) / 2;  // field center offset = +40

const buildLOSField = (scene) => {
  const group = new THREE.Group();

  // Base plane — neutral, no end zone distinction.
  const losTotal = LOS_BEHIND + LOS_FORWARD;
  const basePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(FW, losTotal),
    new THREE.MeshLambertMaterial({ color: 0x0d1825, side: THREE.DoubleSide }),
  );
  basePlane.rotation.x = -Math.PI / 2;
  basePlane.position.set(0, 0, LOS_CENTER);
  group.add(basePlane);

  // Alternating 5-yard bands — full rendered length.
  for (let i = 0; i < losTotal / 5; i++) {
    const z = -LOS_BEHIND + i * 5 + 2.5;
    const band = new THREE.Mesh(
      new THREE.PlaneGeometry(FW, 5),
      new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? 0x0d1825 : 0x0f1e2e, side: THREE.DoubleSide }),
    );
    band.rotation.x = -Math.PI / 2;
    band.position.set(0, 0.001, z);
    group.add(band);
  }

  // Sidelines.
  makeGroupLine(group, [-FH, 0.02, -LOS_BEHIND], [-FH, 0.02, LOS_FORWARD], 0x1e3852);
  makeGroupLine(group, [ FH, 0.02, -LOS_BEHIND], [ FH, 0.02, LOS_FORWARD], 0x1e3852);

  // End lines.
  makeGroupLine(group, [-FH, 0.02, -LOS_BEHIND], [FH, 0.02, -LOS_BEHIND], 0x182f48);
  makeGroupLine(group, [-FH, 0.02,  LOS_FORWARD], [FH, 0.02,  LOS_FORWARD], 0x182f48);

  // Yard lines every 5 yards — downfield +5..+100, behind -5..-20.
  for (let yds = 5; yds <= LOS_FORWARD; yds += 5) {
    const color = yds % 10 === 0 ? 0x2a4a6e : 0x182f48;
    makeGroupLine(group, [-FH, 0.02, yds], [FH, 0.02, yds], color);
  }
  for (let yds = 5; yds <= LOS_BEHIND; yds += 5) {
    const color = yds % 10 === 0 ? 0x2a4a6e : 0x182f48;
    makeGroupLine(group, [-FH, 0.02, -yds], [FH, 0.02, -yds], color);
  }

  // Hash marks every yard.
  for (let yds = 1; yds <= LOS_FORWARD; yds++) {
    makeGroupLine(group, [-3.1, 0.02, yds], [-1.8, 0.02, yds], 0x182f48);
    makeGroupLine(group, [ 1.8, 0.02, yds], [ 3.1, 0.02, yds], 0x182f48);
    makeGroupLine(group, [-FH+0.5, 0.02, yds], [-FH+2.2, 0.02, yds], 0x182f48);
    makeGroupLine(group, [ FH-2.2, 0.02, yds], [ FH-0.5, 0.02, yds], 0x182f48);
  }
  for (let yds = 1; yds <= LOS_BEHIND; yds++) {
    makeGroupLine(group, [-3.1, 0.02, -yds], [-1.8, 0.02, -yds], 0x182f48);
    makeGroupLine(group, [ 1.8, 0.02, -yds], [ 3.1, 0.02, -yds], 0x182f48);
    makeGroupLine(group, [-FH+0.5, 0.02, -yds], [-FH+2.2, 0.02, -yds], 0x182f48);
    makeGroupLine(group, [ FH-2.2, 0.02, -yds], [ FH-0.5, 0.02, -yds], 0x182f48);
  }

  // LOS line — the only special marking.
  makeGroupLine(group, [-FH, 0.04, LOS_Z], [FH, 0.04, LOS_Z], 0x4a90d9);
  makeSprite(group, 'LOS', -FH-4, 0.5, LOS_Z, '#4a90d9', 7);
  makeSprite(group, 'LOS',  FH+4, 0.5, LOS_Z, '#4a90d9', 7);

  // Signed yard labels every 10 yards.
  for (let yds = 10; yds <= LOS_FORWARD; yds += 10) {
    makeSprite(group, `+${yds}`, -FH-3.5, 0.5,  yds, '#4fd46e', 6);
    makeSprite(group, `+${yds}`,  FH+3.5, 0.5,  yds, '#4fd46e', 6);
  }
  for (let yds = 10; yds <= LOS_BEHIND; yds += 10) {
    makeSprite(group, `-${yds}`, -FH-3.5, 0.5, -yds, '#e84040', 6);
    makeSprite(group, `-${yds}`,  FH+3.5, 0.5, -yds, '#e84040', 6);
  }

  scene.add(group);
  return group;
};

// ── Component ──────────────────────────────────────────────────────────────
export default function ShotChart({
  throws,
  height,
  selectedPlayerId = null,
  fullScreen = false,
  view = 'field',
  isPossessionView = false,
}) {
  const wrapRef  = useRef(null);
  const stateRef = useRef(null);
  const items    = useMemo(() => throws ?? [], [throws]);

  // ── One-time scene + renderer setup ───────────────────────────────────
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1520);
    scene.fog = new THREE.Fog(0x0d1520, 200, 380);

    const camera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.1, 800);
    scene.add(new THREE.AmbientLight(0x445566, 1.4));
    const dl = new THREE.DirectionalLight(0x7799bb, 0.5);
    dl.position.set(10, 60, -20);
    scene.add(dl);

    // Build both field groups — only one visible at a time.
    const fullFieldGroup = buildFullField(scene);
    const losFieldGroup  = buildLOSField(scene);
    losFieldGroup.visible = false;

    // Throws group — rebuilt on data/view change.
    const throwsGroup = new THREE.Group();
    scene.add(throwsGroup);

    // Orbit controls.
    const target = new THREE.Vector3(0, 0, 0);
    const orbit  = { theta: Math.PI, phi: 0.55, radius: 110 };
    const placeCamera = () => {
      camera.position.set(
        target.x + orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta),
        target.y + orbit.radius * Math.cos(orbit.phi),
        target.z + orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta),
      );
      camera.lookAt(target);
    };
    placeCamera();

    const el = renderer.domElement;
    let drag = false; let prev = { x: 0, y: 0 };
    const onDown  = (e) => { drag = true; prev = { x: e.clientX, y: e.clientY }; };
    const onUp    = ()  => { drag = false; };
    const onMove  = (e) => {
      if (!drag) return;
      orbit.theta += (e.clientX - prev.x) * 0.005;
      orbit.phi    = Math.max(0.18, Math.min(1.45, orbit.phi + (e.clientY - prev.y) * 0.005));
      prev = { x: e.clientX, y: e.clientY };
      placeCamera();
    };
    const onWheel = (e) => {
      orbit.radius = Math.max(45, Math.min(260, orbit.radius + e.deltaY * 0.12));
      placeCamera();
    };
    el.addEventListener('mousedown',  onDown);
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('mousemove', onMove);
    el.addEventListener('wheel', onWheel, { passive: true });

    const onResize = () => {
      camera.aspect = wrap.clientWidth / wrap.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    };
    window.addEventListener('resize', onResize);

    let raf = 0;
    const tick = () => { raf = requestAnimationFrame(tick); renderer.render(scene, camera); };
    tick();

    stateRef.current = { scene, throwsGroup, renderer, camera, fullFieldGroup, losFieldGroup, target, placeCamera };

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousemove', onMove);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      wrap.removeChild(el);
      stateRef.current = null;
    };
  }, []);

  // ── Rebuild throws when data/view/selection changes ────────────────────
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    const { throwsGroup, fullFieldGroup, losFieldGroup, target, placeCamera } = st;

    const losMode = view === 'los';

    // Swap field geometry.
    fullFieldGroup.visible = !losMode;
    losFieldGroup.visible  =  losMode;

    // Reposition camera target.
    target.z = losMode ? LOS_CENTER : 0;
    placeCamera();

    // Clear previous throws.
    while (throwsGroup.children.length > 0) {
      const child = throwsGroup.children[0];
      throwsGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
        else child.material.dispose();
      }
    }

    const sorted = [...items].sort((a, b) =>
      (a.pbp_throw_type === 'pass' ? 0 : 1) - (b.pbp_throw_type === 'pass' ? 0 : 1)
    );

    // ── Coordinate conversion ──────────────────────────────────────────
    // Full field: direct svgToWorld mapping.
    // LOS view: all throwers locked to z=LOS_Z; receiver offset = air yards
    //   from thrower position (delta Z in yard space).
    const worldCoords = (t) => {
      const hasThrow   = t.svg_throw_x != null && t.svg_throw_y != null;
      const hasReceive = t.svg_recv_x  != null && t.svg_recv_y  != null;
      const origin  = hasThrow   ? svgToWorld(t.svg_throw_x, t.svg_throw_y) : { wx: 0, wz: 0 };
      const landing = hasReceive ? svgToWorld(t.svg_recv_x,  t.svg_recv_y)  : origin;

      const ox = origin.wx;
      const oz = losMode ? LOS_Z : origin.wz;
      const rx = landing.wx;
      const rz = losMode ? LOS_Z + (landing.wz - origin.wz) : landing.wz;
      return { ox, oz, rx, rz, hasReceive };
    };

    // ── Possession connector lines ─────────────────────────────────────
    if (isPossessionView && items.length > 1) {
      for (let i = 0; i < items.length - 1; i++) {
        const curr = items[i]; const next = items[i + 1];
        if (curr.svg_recv_x == null || next.svg_throw_x == null) continue;
        const { rx: x1, rz: z1 } = worldCoords(curr);
        const { ox: x2, oz: z2 } = worldCoords(next);
        const SEGS = 8;
        for (let s = 0; s < SEGS; s++) {
          const t0 = s / SEGS + 0.04; const t1 = (s + 0.55) / SEGS;
          throwsGroup.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(x1 + (x2-x1)*t0, 0.05, z1 + (z2-z1)*t0),
              new THREE.Vector3(x1 + (x2-x1)*t1, 0.05, z1 + (z2-z1)*t1),
            ]),
            new THREE.LineBasicMaterial({ color: CONNECTOR_COLOR, transparent: true, opacity: 0.55 }),
          ));
        }
        const dx = x2-x1; const dz = z2-z1; const len = Math.hypot(dx, dz);
        if (len > 1.5) {
          const ux = dx/len; const uz = dz/len;
          const tipX = x2 - ux*3.5; const tipZ = z2 - uz*3.5;
          throwsGroup.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(tipX - ux*4 + uz*1.8, 0.06, tipZ - uz*4 - ux*1.8),
              new THREE.Vector3(tipX, 0.06, tipZ),
              new THREE.Vector3(tipX - ux*4 - uz*1.8, 0.06, tipZ - uz*4 + ux*1.8),
            ]),
            new THREE.LineBasicMaterial({ color: CONNECTOR_COLOR, transparent: true, opacity: 0.7 }),
          ));
        }
      }
    }

    // ── Throw arcs + markers ───────────────────────────────────────────
    for (const t of sorted) {
      if (t.svg_throw_x == null && t.svg_throw_y == null &&
          t.svg_recv_x  == null && t.svg_recv_y  == null) continue;

      const { ox, oz, rx, rz, hasReceive } = worldCoords(t);
      const oy = 1.6;
      const palette = OUTCOMES[t.pbp_throw_type] ?? HOLLOW;
      const dist = Math.hypot(rx-ox, rz-oz);
      const apex = Math.max(2.5, dist * 0.22);

      // Bezier arc.
      const pts = [];
      const apexX = (ox+rx)/2; const apexZ = (oz+rz)/2;
      for (let k = 0; k <= 60; k++) {
        const u = k / 60;
        pts.push(new THREE.Vector3(
          (1-u)*(1-u)*ox + 2*(1-u)*u*apexX + u*u*rx,
          (1-u)*(1-u)*oy + 2*(1-u)*u*(oy+apex) + u*u*0,
          (1-u)*(1-u)*oz + 2*(1-u)*u*apexZ    + u*u*rz,
        ));
      }
      throwsGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: palette.arc, transparent: true, opacity: 0.78 }),
      ));

      const rectFilled   = !selectedPlayerId || t.thrower_id  === selectedPlayerId;
      const circleFilled = !selectedPlayerId || t.receiver_id === selectedPlayerId;

      // Origin square — full field only, not LOS, not possession.
      if (!losMode && !isPossessionView) {
        const rectGeo = new THREE.PlaneGeometry(1.6, 1.6);
        const rect = new THREE.Mesh(rectGeo, new THREE.MeshBasicMaterial({
          color: rectFilled ? palette.ring : 0xffffff,
          transparent: !rectFilled, opacity: rectFilled ? 0.95 : 0.0,
          side: THREE.DoubleSide,
        }));
        rect.rotation.x = -Math.PI / 2; rect.position.set(ox, 0.06, oz);
        throwsGroup.add(rect);
        const edgesLine = new THREE.LineSegments(
          new THREE.EdgesGeometry(rectGeo),
          new THREE.LineBasicMaterial({ color: palette.ring }),
        );
        edgesLine.rotation.x = -Math.PI / 2; edgesLine.position.set(ox, 0.07, oz);
        throwsGroup.add(edgesLine);
      }

      // Possession view: circle at first throw origin only.
      if (isPossessionView && items.indexOf(t) === 0) {
        const startRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.85, 0.16, 8, 28),
          new THREE.MeshBasicMaterial({ color: palette.ring }),
        );
        startRing.rotation.x = -Math.PI / 2; startRing.position.set(ox, 0.06, oz);
        throwsGroup.add(startRing);
        const startDot = new THREE.Mesh(
          new THREE.CircleGeometry(0.45, 16),
          new THREE.MeshBasicMaterial({ color: palette.ring, side: THREE.DoubleSide }),
        );
        startDot.rotation.x = -Math.PI / 2; startDot.position.set(ox, 0.07, oz);
        throwsGroup.add(startDot);
      }

      // Landing ring + dot.
      if (hasReceive) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.85, 0.16, 8, 28),
          new THREE.MeshBasicMaterial({ color: palette.ring }),
        );
        ring.rotation.x = -Math.PI / 2; ring.position.set(rx, 0.06, rz);
        throwsGroup.add(ring);
        if (circleFilled && t.pbp_throw_type !== 'drop') {
          const dot = new THREE.Mesh(
            new THREE.CircleGeometry(0.45, 16),
            new THREE.MeshBasicMaterial({ color: palette.ring, side: THREE.DoubleSide }),
          );
          dot.rotation.x = -Math.PI / 2; dot.position.set(rx, 0.07, rz);
          throwsGroup.add(dot);
        }
      }

      // Possession sequence label.
      if (isPossessionView) {
        const seqIdx = items.indexOf(t);
        if (seqIdx >= 0) {
          const c2 = document.createElement('canvas');
          c2.width = 64; c2.height = 64;
          const ctx = c2.getContext('2d');
          ctx.font = 'bold 36px Arial';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(String(seqIdx + 1), 32, 32);
          const sprite = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c2), transparent: true }),
          );
          sprite.position.set(ox, 4.5, oz);
          sprite.scale.set(4, 4, 1);
          throwsGroup.add(sprite);
        }
      }
    }
  }, [items, selectedPlayerId, view, isPossessionView]);

  return (
    <div className={fullScreen ? 'h-full w-full' : 'w-full'}>
      <div
        ref={wrapRef}
        style={fullScreen ? { height: '100%' } : { height: height ?? 540 }}
        className={
          'relative w-full overflow-hidden bg-[#0d1520] '
          + (fullScreen ? '' : 'rounded-lg shadow-md')
        }
      >
        <div className="pointer-events-none absolute right-3 top-2 text-[10px]
                        uppercase tracking-widest text-white/40">
          Drag · Scroll · UFA
        </div>
      </div>
      {!fullScreen && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1
                        text-[11px] font-semibold uppercase tracking-wider text-white/80">
          {Object.entries(OUTCOMES).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5 text-slate-200">
              <span className="inline-block h-3 w-3 rounded-full border-2"
                    style={{
                      borderColor: `#${v.ring.toString(16).padStart(6, '0')}`,
                      background: k === 'drop' ? 'transparent'
                                               : `#${v.ring.toString(16).padStart(6, '0')}`,
                    }} />
              <span>{v.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}