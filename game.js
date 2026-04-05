'use strict';
// Moonshot - Earth-Moon orbital arcade. No libraries, no backend.
const canvas = document.getElementById('game');
const ctx    = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const CX = W / 2, CY = H / 2;

// Physics constants
// Orbit speed: v = sqrt(G*M/r). At r=90: v = sqrt(3000*12000/90) ~ 632 px/sim-s
// Thrust 180 px/sim-s^2 is ~28% of circular-orbit speed => very noticeable
// 1 real-second = TIME_SCALE sim-seconds (lets us tune feel independently)
const G          = 1800;
const EARTH_MASS = 7000;
const MOON_MASS  = 1800;
const EARTH_R    = 28;   // visual + collision
const MOON_R     = 11;
const MOON_ORBIT = 470;  // px from Earth centre
const TIME_SCALE = 0.44;    // sim-seconds per real-second
// Moon period ~45 real-seconds => omega = 2pi / (45 * TIME_SCALE)
const MOON_OMEGA = Math.sqrt(G * EARTH_MASS / Math.pow(MOON_ORBIT, 3));
const ROT_SPEED  = 3.2;  // rad / real-second
const THRUST     = 360;  // px / sim-s^2
const FUEL_DRAIN = 36;    // percent / sim-second while thrusting
const WARP_LEVELS = [1, 2, 3, 5];
const STABLE_INNER = 20; // px from Moon centre, inner win band
const STABLE_OUTER = 100;
const STABLE_HOLD  = 60;  // seconds within lunar distance band to win
const PRED_STEPS = 140;
const PRED_DT    = 0.09; // sim-s per prediction step
const TRAIL_MAX  = 450;
const ESCAPE_DIST = 1120;
const SUN_X = -900; // Sun is far off to the left (off-canvas)
const SUN_Y = CY;

// Stars (generated once, never redrawn outside render)
const STARS = Array.from({length:200}, () => ({
  x: Math.random()*W, y: Math.random()*H,
  r: Math.random()*1.4+0.25, a: Math.random()*0.65+0.35,
}));

// Input
const keys = new Set();
window.addEventListener('keydown', e => {
  const block = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'];
  if (block.includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyR')   { resetGame(); return; }
  if (e.code === 'Digit1') state.warpIdx = 0;
  if (e.code === 'Digit2') state.warpIdx = 1;
  if (e.code === 'Digit3') state.warpIdx = 2;
  if (e.code === 'Digit4') state.warpIdx = 3;
});
window.addEventListener('keyup', e => keys.delete(e.code));

// State
let state, rocket;

// Path length filter — prevents the prediction tail from jumping frame-to-frame
const pathLengthFilter = {
  len: 140,
  update(rawLen) {
    // Ease toward shorter lengths quickly, toward longer lengths slowly
    // This prevents the tail from suddenly extending/retracting each frame
    const alpha = rawLen < this.len ? 0.5 : 0.04;
    this.len = this.len + (rawLen - this.len) * alpha;
    return Math.round(this.len);
  },
  reset() { this.len = 140; }
};

// Collision marker filter — smooths jitter between frames
const collisionFilter = {
  x: 0, y: 0, body: null,
  frames: 0,       // consecutive frames with a collision detected
  SHOW_AFTER: 4,   // frames before marker appears
  HIDE_AFTER: 10,  // frames without detection before marker disappears
  missFrames: 0,   // consecutive frames without detection
  visible: false,
  update(col) {
    if (col) {
      this.missFrames = 0;
      this.frames++;
      // Low-pass: blend position toward new reading
      const a = this.frames < this.SHOW_AFTER ? 1.0 : 0.25;
      this.x = this.x + (col.x - this.x) * a;
      this.y = this.y + (col.y - this.y) * a;
      this.body = col.body;
      if (this.frames >= this.SHOW_AFTER) this.visible = true;
    } else {
      this.frames = 0;
      this.missFrames++;
      if (this.missFrames >= this.HIDE_AFTER) {
        this.visible = false;
        this.missFrames = 0;
      }
    }
    return this.visible ? { x: this.x, y: this.y, body: this.body } : null;
  },
  reset() { this.x=0; this.y=0; this.body=null; this.frames=0; this.missFrames=0; this.visible=false; }
};


function resetGame() {
  collisionFilter.reset();
  pathLengthFilter.reset();
  state = {
    warpIdx: 0, moonAngle: 0, earthAngle: 0, orientMode: 'prograde',
    outcome: 'playing', message: 'BURN PROGRADE TO REACH THE MOON',
    stableTimer: 0, trail: [],
  };
  const r0 = 75, ang = -Math.PI / 2;
  const x = CX + Math.cos(ang) * r0;
  const y = CY + Math.sin(ang) * r0;
  // Pure circular orbit: v = sqrt(G*M/r), tangent direction only
  const circV = Math.sqrt(G * EARTH_MASS / r0);
  const tx = -Math.sin(ang), ty = Math.cos(ang); // prograde tangent
  rocket = {
    x, y,
    vx: tx * circV, vy: ty * circV, angle: ang + Math.PI / 2, fuel: 100,
  };
  // Sync orient button highlights
  document.getElementById('btn-prograde') ?.classList.toggle('pressed', state.orientMode === 'prograde');
  document.getElementById('btn-retrograde')?.classList.toggle('pressed', state.orientMode === 'retrograde');
}

// Helpers
function moonXY(a) {
  return { x: CX + Math.cos(a)*MOON_ORBIT, y: CY + Math.sin(a)*MOON_ORBIT };
}

function gravAccel(bx, by, mass, x, y) {
  const dx = bx-x, dy = by-y;
  const d2 = dx*dx + dy*dy, d = Math.sqrt(d2);
  const a = (G * mass) / Math.max(d2, 100);
  return { ax: (dx/d)*a, ay: (dy/d)*a, dist: d };
}

// Self-contained polyline drawer — always resets dash, always restores state.
function strokePath(pts, color, width, dash) {
  if (!pts || pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = width || 1.5;
  ctx.setLineDash(dash || []);
  ctx.beginPath();
  let down = false;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], pp = pts[i-1];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { down = false; continue; }
    const gap = pp && Math.hypot(p.x-pp.x, p.y-pp.y) > 60;
    if (!down || gap) { ctx.moveTo(p.x, p.y); down = true; }
    else              { ctx.lineTo(p.x, p.y); }
  }
  ctx.stroke();
  ctx.setLineDash([]); // always reset before restore
  ctx.restore();
}

// Rounded-rect path only (caller fills/strokes)
function rrect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y,   x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x,   y+h, r);
  ctx.arcTo(x,   y+h, x,   y,   r);
  ctx.arcTo(x,   y,   x+w, y,   r);
  ctx.closePath();
}

// Physics update
function updatePhysics(realDt) {
  const warp  = WARP_LEVELS[state.warpIdx];
  const simDt = realDt * TIME_SCALE * warp;
  const NSUB  = warp * 2;
  const dt    = simDt / NSUB;

  const left      = keys.has('ArrowLeft')  || keys.has('KeyA');
  const right     = keys.has('ArrowRight') || keys.has('KeyD');
  const thrusting = (keys.has('ArrowUp')   || keys.has('KeyW') || keys.has('Space'))
                    && rocket.fuel > 0;

  // Earth rotation — real time based, one full turn ~60s
  state.earthAngle += 0.105 * realDt;

  // Rotation outside substep loop — scaled to warp for responsiveness
  if (left || right) state.orientMode = null; // manual input cancels auto-orient
  if (left)  rocket.angle -= ROT_SPEED * realDt * warp;
  if (right) rocket.angle += ROT_SPEED * realDt * warp;

  // Auto-orient: smoothly rotate toward prograde or retrograde
  if (state.orientMode && !left && !right) {
    const proAngle = Math.atan2(rocket.vy, rocket.vx); // direction of velocity
    const targetAngle = state.orientMode === 'prograde' ? proAngle : proAngle + Math.PI;
    // Shortest angular delta
    let delta = ((targetAngle - rocket.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const step = ROT_SPEED * 1.5 * realDt;
    if (Math.abs(delta) < step) {
      rocket.angle = targetAngle;
    } else {
      rocket.angle += Math.sign(delta) * step;
    }
  }

  for (let s = 0; s < NSUB; s++) {
    if (state.outcome !== 'playing') break;
    state.moonAngle  += MOON_OMEGA * dt;
    const moon = moonXY(state.moonAngle);
    const gE = gravAccel(CX, CY, EARTH_MASS, rocket.x, rocket.y);
    const gM = gravAccel(moon.x, moon.y, MOON_MASS, rocket.x, rocket.y);

    if (thrusting) {
      rocket.vx  += Math.cos(rocket.angle) * THRUST * dt;
      rocket.vy  += Math.sin(rocket.angle) * THRUST * dt;
      rocket.fuel = Math.max(0, rocket.fuel - FUEL_DRAIN * dt);
    }

    rocket.vx += (gE.ax + gM.ax) * dt;
    rocket.vy += (gE.ay + gM.ay) * dt;
    rocket.x  += rocket.vx * dt;
    rocket.y  += rocket.vy * dt;

    const last = state.trail[state.trail.length-1];
    if (!last || Math.hypot(rocket.x-last.x, rocket.y-last.y) > 3) {
      state.trail.push({x: rocket.x, y: rocket.y});
      if (state.trail.length > TRAIL_MAX) state.trail.shift();
    }
    evalState(gE.dist, gM.dist, realDt);
  }
}

function evalState(dEarth, dMoon, realDt) {
  if (dEarth <= EARTH_R + 5)  return end('lose', 'CRASHED INTO EARTH');
  if (dMoon  <= MOON_R  + 5)  return end('lose', 'CRASHED INTO THE MOON');
  if (Math.hypot(rocket.x-CX, rocket.y-CY) > ESCAPE_DIST)
                               return end('lose', 'LOST IN SPACE');

  const moon  = moonXY(state.moonAngle);
  const distM = Math.hypot(rocket.x-moon.x, rocket.y-moon.y);
  const mvx   = -Math.sin(state.moonAngle) * MOON_ORBIT * MOON_OMEGA;
  const mvy   =  Math.cos(state.moonAngle) * MOON_ORBIT * MOON_OMEGA;
  const relV  = Math.hypot(rocket.vx-mvx, rocket.vy-mvy);
  const inBand = distM >= STABLE_INNER && distM < STABLE_OUTER;

  if (inBand) {
    state.stableTimer += realDt;
    const rem = Math.max(0, STABLE_HOLD - state.stableTimer);
    state.message = rem > 0
      ? 'HOLD DISTANCE < 100u FOR ' + rem.toFixed(1) + 's'
      : 'STABLE LUNAR ORBIT ACHIEVED!';
    if (state.stableTimer >= STABLE_HOLD) end('win', 'MISSION COMPLETE');
  } else {
    state.stableTimer = 0; // reset fully when leaving zone
    if (state.outcome === 'playing') {
      const dE = Math.hypot(rocket.x-CX, rocket.y-CY);
      if (distM < 110)   state.message = 'APPROACHING THE MOON';
      else if (dE < 130) state.message = 'IN LOW EARTH ORBIT';
      else               state.message = 'IN TRANSFER ORBIT';
    }
  }
}

function end(outcome, msg) { state.outcome = outcome; state.message = msg; }

// Trajectory prediction
// Uses sub-stepping (PRED_SUBSTEPS per PRED_DT) to reduce Euler error near bodies,
// plus a binary-search surface clamp when the path crosses inside a body radius.
const PRED_SUBSTEPS = 4; // sub-steps per PRED_DT — reduces integration error ~16×
function predictPath() {
  let px = rocket.x, py = rocket.y, pvx = rocket.vx, pvy = rocket.vy;
  let pAng = state.moonAngle;
  const pts = [];
  let collision = null;
  const subDt = PRED_DT / PRED_SUBSTEPS;

  // Binary-search helper: find the exact surface crossing point.
  // Walks backwards from inside the body to the surface using bisection.
  function surfacePoint(x0, y0, x1, y1, bx, by, r) {
    // x0,y0 is outside (or on surface), x1,y1 is inside.
    for (let b = 0; b < 12; b++) {
      const mx = (x0 + x1) * 0.5, my = (y0 + y1) * 0.5;
      if (Math.hypot(mx - bx, my - by) < r) { x1 = mx; y1 = my; }
      else                                   { x0 = mx; y0 = my; }
    }
    // Return midpoint of final bracket — within 0.5px of the surface
    return { x: (x0 + x1) * 0.5, y: (y0 + y1) * 0.5 };
  }

  for (let i = 0; i < PRED_STEPS; i++) {
    let hit = false;
    for (let s = 0; s < PRED_SUBSTEPS; s++) {
      const prevX = px, prevY = py;
      pAng += MOON_OMEGA * subDt;
      const m  = moonXY(pAng);
      const gE = gravAccel(CX, CY, EARTH_MASS, px, py);
      const gM = gravAccel(m.x, m.y, MOON_MASS, px, py);
      pvx += (gE.ax + gM.ax) * subDt;
      pvy += (gE.ay + gM.ay) * subDt;
      px  += pvx * subDt;
      py  += pvy * subDt;

      // Crossed into Earth?
      if (gE.dist < EARTH_R) {
        const sp = surfacePoint(prevX, prevY, px, py, CX, CY, EARTH_R);
        collision = { x: sp.x, y: sp.y, body: 'EARTH' };
        pts.push({ x: sp.x, y: sp.y });
        hit = true; break;
      }
      // Crossed into Moon?
      const mNow = moonXY(pAng); // moon position at current sub-step
      if (Math.hypot(px - mNow.x, py - mNow.y) < MOON_R) {
        const sp = surfacePoint(prevX, prevY, px, py, mNow.x, mNow.y, MOON_R);
        collision = { x: sp.x, y: sp.y, body: 'MOON' };
        pts.push({ x: sp.x, y: sp.y });
        hit = true; break;
      }
      // Escaped the system?
      if (Math.hypot(px - CX, py - CY) > ESCAPE_DIST + 80) { hit = true; break; }

      // Proximity instability guard: if we're very close to a body centre
      // (inside ~2 px of it) but didn't register a hit, Euler is diverging —
      // cut the path here rather than propagate garbage.
      if (gE.dist < 2 || Math.hypot(px - mNow.x, py - mNow.y) < 2) {
        hit = true; break;
      }
    }
    if (hit) break;
    pts.push({ x: px, y: py });
  }
  return { pts, collision };
}

// Unstable prediction marker — path goes unreliable here
function drawUnstableMarker(pt) {
  const { x, y } = pt;
  const t = (Date.now() / 600) % (Math.PI * 2);
  const pulse = 0.5 + 0.5 * Math.sin(t);
  ctx.save();
  ctx.strokeStyle = `rgba(251,211,77,${(0.3 + 0.3 * pulse).toFixed(2)})`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 5]);
  ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = `700 15px Inter,ui-sans-serif,sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(251,211,77,${(0.5 + 0.4 * pulse).toFixed(2)})`;
  ctx.fillText('?', x, y + 5);
  ctx.textAlign = 'left';
  ctx.restore();
}

// Collision warning marker on predicted path
function drawCollisionWarning(col) {
  const { x, y, body } = col;
  const t = (Date.now() / 400) % (Math.PI * 2); // pulsing phase
  const pulse = 0.55 + 0.45 * Math.sin(t);

  ctx.save();

  // Pulsing outer ring
  ctx.strokeStyle = `rgba(255,80,80,${(0.3 + 0.3 * Math.sin(t)).toFixed(2)})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 22 + 6 * Math.sin(t), 0, Math.PI * 2);
  ctx.stroke();

  // Solid warning circle
  ctx.strokeStyle = `rgba(255,80,80,${pulse.toFixed(2)})`;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, y, 13, 0, Math.PI * 2);
  ctx.stroke();

  // ✕ cross
  ctx.strokeStyle = `rgba(255,120,120,${pulse.toFixed(2)})`;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  const s = 7;
  ctx.beginPath(); ctx.moveTo(x-s, y-s); ctx.lineTo(x+s, y+s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x+s, y-s); ctx.lineTo(x-s, y+s); ctx.stroke();

  // Label — offset so it doesn't overlap the body
  const labelY = y < CY ? y + 34 : y - 22;
  ctx.font = '700 18px Inter,ui-sans-serif,sans-serif';
  ctx.textAlign = 'center';
  const label = '⚠ ' + body + ' IMPACT';
  const metrics = ctx.measureText(label);
  const pad = 8;
  const bw = metrics.width + pad * 2;
  const bh = 26;
  const bx = x - bw / 2;
  const by = labelY - bh + 4;

  ctx.fillStyle = 'rgba(10,5,20,0.82)';
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 6);
  ctx.fill();

  ctx.fillStyle = `rgba(255,120,120,${pulse.toFixed(2)})`;
  ctx.fillText(label, x, labelY);

  ctx.textAlign = 'left';
  ctx.restore();
}

// Draw terminator shadow on a body: sun direction determines lit/dark half.
// Uses a radial gradient offset toward the sun to fake a crisp terminator.
function drawShadow(bx, by, r, sunX, sunY) {
  // Unit vector from body toward sun
  const dx = sunX - bx, dy = sunY - by;
  const dist = Math.hypot(dx, dy);
  const nx = dx / dist, ny = dy / dist;
  // Linear gradient along sun axis: lit on sun side, dark on anti-sun side
  // Terminator sits at the body centre, blend width ~ 0.3r for soft edge
  const blend = r * 0.35;
  const g = ctx.createLinearGradient(
    bx + nx * blend, by + ny * blend,   // start: just past centre toward sun (still lit)
    bx - nx * r,     by - ny * r        // end: far anti-sun edge (fully dark)
  );
  g.addColorStop(0,    'rgba(0,0,0,0)');
  g.addColorStop(0.15, 'rgba(0,0,0,0.10)');
  g.addColorStop(0.5,  'rgba(0,0,0,0.60)');
  g.addColorStop(1,    'rgba(0,0,0,0.92)');
  ctx.save();
  ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = g;
  ctx.fillRect(bx - r, by - r, r * 2, r * 2);
  ctx.restore();
}

// Project moon onto Earth-Sun axis to check if it's in Earth's umbra cone.
// Returns 0‥1: 0=fully lit, 1=fully eclipsed.
function earthEclipseFactor(moonX, moonY, sunX, sunY) {
  // Earth umbra: cone pointing away from sun, apex beyond Earth
  // Simplified: check if moon centre falls within a projected cone
  const exAxis = CX - sunX, eyAxis = CY - sunY; // sun→earth vector
  const axisLen = Math.hypot(exAxis, eyAxis);
  const axNx = exAxis / axisLen, axNy = eyAxis / axisLen; // normalised axis

  // Vector from Earth to Moon, projected onto umbra axis
  const emx = moonX - CX, emy = moonY - CY;
  const proj = emx * axNx + emy * axNy; // distance along axis (positive = shadow side)
  if (proj < 0) return 0; // moon is on sun-side of earth, no eclipse

  // Perpendicular distance from shadow axis
  const perpX = emx - proj * axNx, perpY = emy - proj * axNy;
  const perp = Math.hypot(perpX, perpY);

  // Umbra cone radius at distance proj: linearly shrinks from EARTH_R at apex
  // Using approximate umbra half-angle (Earth radius / dist to sun)
  const umbraR = Math.max(0, EARTH_R - proj * (EARTH_R / (axisLen * 0.9)));
  if (perp > umbraR + MOON_R) return 0;
  if (perp < umbraR - MOON_R) return 1; // fully inside umbra
  // Partial: smooth blend
  return 1 - Math.min(1, (perp - (umbraR - MOON_R)) / (2 * MOON_R));
}

// Render
function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha  = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.setLineDash([]);
  ctx.fillStyle = '#040814';
  ctx.fillRect(0, 0, W, H);

  // Stars
  for (const s of STARS) {
    ctx.globalAlpha = s.a;
    ctx.fillStyle = '#dbeafe';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI*2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const moon = moonXY(state.moonAngle);

  // Orbit guides — all inside save/restore, explicit setLineDash([]) before restore
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(100,130,255,0.18)';
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(CX, CY, MOON_ORBIT, 0, Math.PI*2); ctx.stroke();

  ctx.strokeStyle = 'rgba(100,210,255,0.14)';
  ctx.beginPath(); ctx.arc(CX, CY, 90, 0, Math.PI*2); ctx.stroke();

  // Win-zone circles: inner + outer boundary, bright when rocket is inside
  const distToMoon = Math.hypot(rocket.x - moon.x, rocket.y - moon.y);
  const inWinZone  = distToMoon >= STABLE_INNER && distToMoon < STABLE_OUTER;
  const zoneColor  = inWinZone ? 'rgba(134,239,172,0.90)' : 'rgba(134,239,172,0.22)';
  const zoneWidth  = inWinZone ? 2.5 : 1.0;
  ctx.strokeStyle  = zoneColor;
  ctx.lineWidth    = zoneWidth;
  ctx.setLineDash([5, 8]);
  ctx.beginPath(); ctx.arc(moon.x, moon.y, STABLE_OUTER, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Trail + prediction (each call fully self-contained)
  strokePath(state.trail, 'rgba(125,211,252,0.5)', 1.5, []);
  if (state.outcome === 'playing') {
    const pred = predictPath();
    const pts  = pred.pts;

    const smoothedCol = collisionFilter.update(pred.collision);
    const dispLen      = pathLengthFilter.update(pts.length);
    const dispPts      = pts.slice(0, dispLen);
    if (smoothedCol) {
      const splitAt = Math.max(0, dispPts.length - 20);
      strokePath(dispPts.slice(0, splitAt), 'rgba(251,211,77,0.55)', 1.3, [6,6]);
      strokePath(dispPts.slice(splitAt),    'rgba(255,80,80,0.75)',  2.0, []);
      drawCollisionWarning(smoothedCol);
    } else {
      strokePath(dispPts, 'rgba(251,211,77,0.55)', 1.3, [6,6]);
    }
  }

  // Earth's shadow cone cast into space — drawn before Earth so it layers behind
  {
    const dx = CX - SUN_X, dy = CY - SUN_Y;
    const dist = Math.hypot(dx, dy);
    const nx = dx / dist, ny = dy / dist;
    const coneLen = 600;
    const coneR0  = EARTH_R;
    const coneR1  = EARTH_R * 0.96;
    const px = -ny, py = nx;
    const tip = { x: CX + nx * coneLen, y: CY + ny * coneLen };
    ctx.save();
    const cg = ctx.createLinearGradient(CX, CY, tip.x, tip.y);
    cg.addColorStop(0,    'rgba(0,0,20,0.38)');
    cg.addColorStop(0.35, 'rgba(0,0,20,0.18)');
    cg.addColorStop(0.7,  'rgba(0,0,20,0.07)');
    cg.addColorStop(1,    'rgba(0,0,20,0)');
    ctx.beginPath();
    ctx.moveTo(CX + px * coneR0, CY + py * coneR0);
    ctx.lineTo(tip.x + px * coneR1, tip.y + py * coneR1);
    ctx.lineTo(tip.x - px * coneR1, tip.y - py * coneR1);
    ctx.lineTo(CX - px * coneR0, CY - py * coneR0);
    ctx.closePath();
    ctx.fillStyle = cg;
    ctx.fill();
    ctx.restore();
  }

  // Earth
  const atmosphere = ctx.createRadialGradient(CX, CY, EARTH_R * 0.7, CX, CY, EARTH_R * 2.6);
  atmosphere.addColorStop(0, 'rgba(96,165,250,0.22)');
  atmosphere.addColorStop(0.55, 'rgba(59,130,246,0.18)');
  atmosphere.addColorStop(1, 'rgba(59,130,246,0)');
  ctx.fillStyle = atmosphere;
  ctx.beginPath(); ctx.arc(CX, CY, EARTH_R * 2.6, 0, Math.PI * 2); ctx.fill();

  const earthGrad = ctx.createRadialGradient(CX - 10, CY - 12, 4, CX, CY, EARTH_R + 4);
  earthGrad.addColorStop(0, '#93c5fd');
  earthGrad.addColorStop(0.45, '#3b82f6');
  earthGrad.addColorStop(0.8, '#1d4ed8');
  earthGrad.addColorStop(1, '#172554');
  ctx.fillStyle = earthGrad;
  ctx.beginPath(); ctx.arc(CX, CY, EARTH_R, 0, Math.PI * 2); ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(CX, CY, EARTH_R, 0, Math.PI * 2);
  ctx.clip();
  // Rotate land/clouds around Earth centre — shadow drawn after, unaffected
  ctx.translate(CX, CY);
  ctx.rotate(state.earthAngle);
  ctx.translate(-CX, -CY);

  ctx.fillStyle = '#4ade80';
  ctx.beginPath();
  ctx.ellipse(CX - 9, CY - 6, 11, 7, 0.45, 0, Math.PI * 2);
  ctx.ellipse(CX - 2, CY + 4, 7, 5, 0.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.ellipse(CX + 9, CY + 7, 8, 5, -0.35, 0, Math.PI * 2);
  ctx.ellipse(CX + 4, CY - 10, 5, 3, 0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.beginPath();
  ctx.ellipse(CX - 6, CY - 11, 9, 2.6, 0.2, 0, Math.PI * 2);
  ctx.ellipse(CX + 10, CY - 2, 7, 2.2, -0.25, 0, Math.PI * 2);
  ctx.ellipse(CX - 2, CY + 12, 8, 2.4, 0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore(); // end land/cloud clip
  // Sun-based terminator shadow on Earth
  drawShadow(CX, CY, EARTH_R, SUN_X, SUN_Y);

  ctx.strokeStyle = 'rgba(191,219,254,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(CX, CY, EARTH_R + 1, 0, Math.PI * 2); ctx.stroke();

  // Moon
  const mg = ctx.createRadialGradient(moon.x,moon.y,3,moon.x,moon.y,26);
  mg.addColorStop(0,'rgba(220,220,220,0.5)');
  mg.addColorStop(1,'rgba(220,220,220,0)');
  ctx.fillStyle = mg;
  ctx.beginPath(); ctx.arc(moon.x,moon.y,26,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = '#9ca3af';
  ctx.beginPath(); ctx.arc(moon.x,moon.y,MOON_R,0,Math.PI*2); ctx.fill();
  // Craters: tidally locked — rotate with moon's orbital angle so same face always points at Earth
  ctx.save();
  ctx.translate(moon.x, moon.y);
  ctx.rotate(state.moonAngle + Math.PI / 2); // +PI/2 so face points inward toward Earth at start
  ctx.fillStyle = '#6b7280';
  ctx.beginPath(); ctx.arc(-3, -2, 3, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc( 4,  3, 2, 0, Math.PI*2); ctx.fill();
  ctx.restore();
  // Sun-based terminator shadow on Moon
  drawShadow(moon.x, moon.y, MOON_R, SUN_X, SUN_Y);
  // Earth eclipse shadow
  const eclF = earthEclipseFactor(moon.x, moon.y, SUN_X, SUN_Y);
  if (eclF > 0) {
    ctx.save();
    ctx.beginPath(); ctx.arc(moon.x, moon.y, MOON_R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = `rgba(0,0,0,${(eclF * 0.88).toFixed(2)})`;
    ctx.fillRect(moon.x - MOON_R, moon.y - MOON_R, MOON_R * 2, MOON_R * 2);
    ctx.restore();
  }

  // Rocket
  const thrusting = (keys.has('ArrowUp')||keys.has('KeyW')||keys.has('Space'))
                    && rocket.fuel > 0 && state.outcome === 'playing';
  ctx.save();
  ctx.translate(rocket.x, rocket.y);
  ctx.rotate(rocket.angle);
  if (thrusting) {
    ctx.fillStyle = 'rgba(251,146,60,' + (0.7 + Math.random()*0.3) + ')';
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(-15 - Math.random()*8, -3.5);
    ctx.lineTo(-15 - Math.random()*8,  3.5);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#f1f5f9';
  ctx.beginPath();
  ctx.moveTo(10,0); ctx.lineTo(-6,-5); ctx.lineTo(-4,0); ctx.lineTo(-6,5);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  drawHUD(moon);
}

function drawHUD(moon) {
  const speed = Math.hypot(rocket.vx, rocket.vy);
  const dE    = Math.hypot(rocket.x-CX, rocket.y-CY);
  const dM    = Math.hypot(rocket.x-moon.x, rocket.y-moon.y);
  const warp  = WARP_LEVELS[state.warpIdx];
  const okCol = state.outcome === 'win' ? '#86efac' : '#fca5a5';

  // Info panel (bottom-left)
  const px=22, py=H-205, pw=420, ph=180;
  ctx.save();
  ctx.fillStyle   = 'rgba(6,10,24,0.88)';
  ctx.strokeStyle = 'rgba(150,180,255,0.18)';
  ctx.lineWidth   = 1;
  rrect(px, py, pw, ph, 14); ctx.fill(); ctx.stroke();

  ctx.fillStyle = state.outcome === 'playing' ? '#e7f0ff' : okCol;
  ctx.font = '700 18px Inter,ui-sans-serif,sans-serif';
  ctx.fillText(state.message, px+18, py+32);

  const pct = Math.max(0, Math.min(1, rocket.fuel / 100));
  const fuelColor = pct > 0.3 ? '#38bdf8' : pct > 0.12 ? '#fbbf24' : '#f87171';

  // Safe fuel row (simple rects only, no rounded giant blob accidents)
  const fuelLabelX = px + 18;
  const fuelRowY = py + 58;
  ctx.fillStyle = '#9fb2d8';
  ctx.font = '700 14px Inter,ui-sans-serif,sans-serif';
  ctx.fillText('FUEL', fuelLabelX, fuelRowY - 10);

  ctx.fillStyle = fuelColor;
  ctx.font = '800 24px Inter,ui-sans-serif,sans-serif';
  ctx.fillText(rocket.fuel.toFixed(0) + '%', fuelLabelX, fuelRowY + 18);

  const barX = px + 112;
  const barY = py + 52;
  const barW = pw - 130;
  const barH = 20;
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = fuelColor;
  ctx.fillRect(barX, barY, barW * pct, barH);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.strokeRect(barX, barY, barW, barH);

  ctx.fillStyle = '#7a8cb0';
  ctx.font = '15px Inter,ui-sans-serif,sans-serif';
  [
    'Speed:      ' + speed.toFixed(1)       + ' u/s',
    'Dist Earth: ' + dE.toFixed(0)          + ' u',
    'Dist Moon:  ' + dM.toFixed(0)          + ' u',
    'Time Warp:  ' + warp + '\u00d7  (1\u20134)',
  ].forEach((t,i) => ctx.fillText(t, px+18, py+104+i*18));
  ctx.restore();

  // Win / lose banner
  if (state.outcome !== 'playing') {
    const bw=390, bh=96, bx2=W/2-195, by2=H/2-48;
    ctx.save();
    ctx.fillStyle   = 'rgba(6,10,24,0.92)';
    ctx.strokeStyle = state.outcome==='win'
      ? 'rgba(134,239,172,0.55)' : 'rgba(252,165,165,0.55)';
    ctx.lineWidth = 1.5;
    rrect(bx2, by2, bw, bh, 18); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = '800 28px Inter,ui-sans-serif,sans-serif';
    ctx.fillStyle = okCol;
    ctx.fillText(state.outcome==='win' ? '\uD83C\uDF15  MISSION COMPLETE' : '\uD83D\uDCA5  MISSION FAILED',
                 W/2, H/2+4);
    ctx.font = '14px Inter,ui-sans-serif,sans-serif';
    ctx.fillStyle = '#93afd4';
    ctx.fillText('Press R to restart', W/2, H/2+30);
    ctx.textAlign = 'left';
    ctx.restore();
  }
}

// Main loop
let lastNow = null;
function loop(now) {
  if (lastNow === null) lastNow = now;
  const realDt = Math.min((now - lastNow) / 1000, 0.05); // cap at 50ms
  lastNow = now;
  if (state.outcome === 'playing') updatePhysics(realDt);
  render();
  requestAnimationFrame(loop);
}


// ── Touch controls ─────────────────────────────────────────────────────────
// ── Fullscreen ──────────────────────────────────────────────────────────────
(function initFullscreen() {
  const btn = document.getElementById('btn-fullscreen');
  if (!btn) return;

  function toggleFS() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const el = document.documentElement;
      if (el.requestFullscreen)       el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen)       document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  }

  btn.addEventListener('pointerdown', e => { e.preventDefault(); toggleFS(); }, { passive: false });

  // Update icon based on state
  function onFSChange() {
    const inFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
    btn.textContent = inFS ? '✕' : '⛶';
    btn.style.display = inFS ? 'none' : '';
  }
  document.addEventListener('fullscreenchange',       onFSChange);
  document.addEventListener('webkitfullscreenchange', onFSChange);
})();

// ── Suppress long-press browser behaviour ──────────────────────────────────
(function suppressLongPress() {
  // Block context menu everywhere (long-press on Android, right-click on desktop)
  document.addEventListener('contextmenu', e => e.preventDefault(), { passive: false });
  // Block selection start
  document.addEventListener('selectstart', e => e.preventDefault(), { passive: false });
  // Block iOS callout / magnifier via touchstart
  document.addEventListener('touchstart', e => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('.side-ctrl, .bottom-bar, .fullscreen-btn')) {
      e.preventDefault();
    }
  }, { passive: false });
})();

// ── Prograde / Retrograde auto-orientation ────────────────────────────────
(function initOrientButtons() {
  // state.orientMode: null | 'prograde' | 'retrograde'
  // Applied each frame in updatePhysics before substeps

  function setMode(mode) {
    state.orientMode = state.orientMode === mode ? null : mode;
    document.getElementById('btn-prograde') .classList.toggle('pressed', state.orientMode === 'prograde');
    document.getElementById('btn-retrograde').classList.toggle('pressed', state.orientMode === 'retrograde');
  }

  ['btn-prograde', 'btn-retrograde'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      setMode(id === 'btn-prograde' ? 'prograde' : 'retrograde');
    }, { passive: false });
  });
})();

(function initTouchControls() {
  const MAP = {
    'btn-left':   'ArrowLeft',
    'btn-right':  'ArrowRight',
    'btn-thrust': 'Space',
  };

  function press(keyCode) { keys.add(keyCode); }
  function release(keyCode) { keys.delete(keyCode); }

  Object.entries(MAP).forEach(([id, keyCode]) => {
    const el = document.getElementById(id);
    if (!el) return;

    const setPressed = (on) => {
      on ? el.classList.add('pressed') : el.classList.remove('pressed');
      on ? press(keyCode) : release(keyCode);
    };

    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      // Cancel auto-orient when manually rotating
      if (id === 'btn-left' || id === 'btn-right') {
        state.orientMode = null;
        document.getElementById('btn-prograde') ?.classList.remove('pressed');
        document.getElementById('btn-retrograde')?.classList.remove('pressed');
      }
      setPressed(true);
    }, { passive: false });
    el.addEventListener('pointerup',   e => { e.preventDefault(); setPressed(false); }, { passive: false });
    el.addEventListener('pointerout',  e => { e.preventDefault(); setPressed(false); }, { passive: false });
    el.addEventListener('pointercancel', e => { setPressed(false); }, { passive: false });
  });

  // Warp buttons
  document.querySelectorAll('.warp-btn').forEach((btn, i) => {
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      state.warpIdx = i;
      document.querySelectorAll('.warp-btn').forEach((b, j) =>
        b.classList.toggle('active', j === i));
    }, { passive: false });
  });

  // Also sync warp button highlight from keyboard
  const origKeydown = window.onkeydown;
  window.addEventListener('keydown', e => {
    const map = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 };
    if (map[e.code] !== undefined) {
      document.querySelectorAll('.warp-btn').forEach((b, j) =>
        b.classList.toggle('active', j === map[e.code]));
    }
  });

  // Restart button
  const restartBtn = document.getElementById('btn-restart');
  if (restartBtn) {
    restartBtn.addEventListener('pointerdown', e => {
      e.preventDefault();
      resetGame();
    }, { passive: false });
  }

  // Prevent body scroll/zoom on touch
  document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
})();

resetGame();
// Sync orient button highlight to initial state
document.addEventListener('DOMContentLoaded', () => {});
(function syncOrientButtons() {
  document.getElementById('btn-prograde') ?.classList.toggle('pressed', state.orientMode === 'prograde');
  document.getElementById('btn-retrograde')?.classList.toggle('pressed', state.orientMode === 'retrograde');
})();
requestAnimationFrame(loop);
