'use strict';
// Moonshot - Earth-Moon orbital arcade. No libraries, no backend.

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

// ── Physics ─────────────────────────────────────────────────────────────────
const G          = 1800;
const EARTH_MASS = 7000;
const MOON_MASS  = 1800;
const MOON_OMEGA = Math.sqrt(G * EARTH_MASS / Math.pow(470, 3)); // orbital angular velocity
const TIME_SCALE = 0.44;  // sim-seconds per real-second
const ROT_SPEED  = 3.2;   // rad / real-second
const THRUST     = 360;   // px / sim-s²

// ── Gameplay ────────────────────────────────────────────────────────────────
const EARTH_R      = 28;    // collision & visual radius
const MOON_R       = 11;
const MOON_ORBIT   = 470;   // px from Earth centre
const FUEL_DRAIN   = 36;    // percent / sim-second while thrusting
const WARP_LEVELS  = [1, 2, 3, 5];
const STABLE_OUTER = 100;   // px from Moon centre — outer win band
const STABLE_HOLD  = 60;    // seconds within lunar distance band to win

// ── Visual / Rendering ─────────────────────────────────────────────────────
const canvas = document.getElementById('game');
const ctx    = canvas.getContext('2d');
const W  = canvas.width;
const H  = canvas.height;
const CX = W / 2;
const CY = H / 2;

const PRED_STEPS    = 140;
const PRED_DT       = 0.09;   // sim-s per prediction step
const PRED_SUBSTEPS = 4;      // sub-steps per PRED_DT — reduces integration error
const TRAIL_MAX     = 450;
const ESCAPE_DIST   = Math.hypot(W / 2, H / 2); // triggers at canvas edge
const SUN_X         = -900;   // off-canvas left
const SUN_Y         = CY;

// Star field (generated once)
const STARS = Array.from({ length: 220 }, () => ({
  x: Math.random() * W,
  y: Math.random() * H,
  r: Math.random() * 1.4 + 0.25,
  a: Math.random() * 0.65 + 0.35,
  depth: Math.random(),
}));


// ════════════════════════════════════════════════════════════════════════════
// INPUT
// ════════════════════════════════════════════════════════════════════════════

const keys = new Set();

window.addEventListener('keydown', e => {
  const block = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
  if (block.includes(e.code)) e.preventDefault();
  keys.add(e.code);

  if (e.code === 'KeyR') { resetGame(); return; }

  if (e.code === 'KeyE') {
    state.orientMode = state.orientMode === 'prograde' ? null : 'prograde';
    document.getElementById('btn-prograde')?.classList.toggle('pressed', state.orientMode === 'prograde');
    document.getElementById('btn-retrograde')?.classList.toggle('pressed', false);
    return;
  }

  if (e.code === 'KeyQ') {
    state.orientMode = state.orientMode === 'retrograde' ? null : 'retrograde';
    document.getElementById('btn-retrograde')?.classList.toggle('pressed', state.orientMode === 'retrograde');
    document.getElementById('btn-prograde')?.classList.toggle('pressed', false);
    return;
  }

  if (e.code === 'Digit1') state.warpIdx = 0;
  if (e.code === 'Digit2') state.warpIdx = 1;
  if (e.code === 'Digit3') state.warpIdx = 2;
  if (e.code === 'Digit4') state.warpIdx = 3;
});

window.addEventListener('keyup', e => keys.delete(e.code));


// ════════════════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════════════════

let state, rocket;

// Smooths prediction path length to prevent frame-to-frame jitter
const pathLengthFilter = {
  len: 140,
  update(rawLen) {
    // Ease toward shorter lengths quickly, toward longer lengths slowly
    const alpha = rawLen < this.len ? 0.5 : 0.04;
    this.len = this.len + (rawLen - this.len) * alpha;
    return Math.round(this.len);
  },
  reset() { this.len = 140; },
};

// Camera: smoothly blends render origin between Earth-centre (0) and Moon-centre (1)
const camera = {
  blend: 0,
  zoom: 1,
  reset() { this.blend = 0; this.zoom = 1; },
};

// Smooths collision marker position to reduce jitter
const collisionFilter = {
  x: 0,
  y: 0,
  body: null,
  frames: 0,
  missFrames: 0,
  visible: false,
  SHOW_AFTER: 4,
  HIDE_AFTER: 10,

  update(col) {
    if (col) {
      this.missFrames = 0;
      this.frames++;
      // Low-pass filter: blend position toward new reading
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

  reset() {
    this.x = 0;
    this.y = 0;
    this.body = null;
    this.frames = 0;
    this.missFrames = 0;
    this.visible = false;
  },
};


// ════════════════════════════════════════════════════════════════════════════
// GAME RESET
// ════════════════════════════════════════════════════════════════════════════

function resetGame() {
  collisionFilter.reset();
  pathLengthFilter.reset();
  camera.reset();

  state = {
    warpIdx: 0,
    moonAngle: 0,
    earthAngle: 0,
    orientMode: 'prograde',
    outcome: 'playing',
    message: 'BURN PROGRADE TO REACH THE MOON',
    stableTimer: 0,
    trail: [],
  };

  // Initial circular orbit around Earth
  const r0  = 75;
  const ang = -Math.PI / 2;
  const x   = CX + Math.cos(ang) * r0;
  const y   = CY + Math.sin(ang) * r0;

  // Pure circular orbit: v = sqrt(G*M/r), tangent direction
  const circV = Math.sqrt(G * EARTH_MASS / r0);
  const tx = -Math.sin(ang);
  const ty = Math.cos(ang);

  rocket = {
    x, y,
    vx: tx * circV,
    vy: ty * circV,
    angle: ang + Math.PI / 2,
    fuel: 100,
  };

  // Sync orient button highlights
  document.getElementById('btn-prograde')?.classList.toggle('pressed', state.orientMode === 'prograde');
  document.getElementById('btn-retrograde')?.classList.toggle('pressed', state.orientMode === 'retrograde');
}


// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

// Returns Moon world position for a given orbital angle
function moonXY(a) {
  return { x: CX + Math.cos(a) * MOON_ORBIT, y: CY + Math.sin(a) * MOON_ORBIT };
}

// Computes gravitational acceleration from body at (bx,by) with given mass
function gravAccel(bx, by, mass, x, y) {
  const dx = bx - x;
  const dy = by - y;
  const d2 = dx * dx + dy * dy;
  const d  = Math.sqrt(d2);
  const a  = (G * mass) / Math.max(d2, 100); // clamp to avoid singularity
  return { ax: (dx / d) * a, ay: (dy / d) * a, dist: d };
}

// Draws a polyline; handles gaps and always resets dash state
function strokePath(pts, color, width, dash) {
  if (!pts || pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width || 1.5;
  ctx.setLineDash(dash || []);
  ctx.beginPath();

  let down = false;
  for (let i = 0; i < pts.length; i++) {
    const p  = pts[i];
    const pp = pts[i - 1];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { down = false; continue; }
    const gap = pp && Math.hypot(p.x - pp.x, p.y - pp.y) > 60;
    if (!down || gap) { ctx.moveTo(p.x, p.y); down = true; }
    else              { ctx.lineTo(p.x, p.y); }
  }

  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

// Creates a rounded-rect path (caller fills/strokes)
function rrect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}


// ════════════════════════════════════════════════════════════════════════════
// PHYSICS UPDATE
// ════════════════════════════════════════════════════════════════════════════

function updatePhysics(realDt) {
  const warp = WARP_LEVELS[state.warpIdx];
  const simDt = realDt * TIME_SCALE * warp;
  const NSUB = warp * 2;
  const dt = simDt / NSUB;

  const left      = keys.has('ArrowLeft') || keys.has('KeyA');
  const right     = keys.has('ArrowRight') || keys.has('KeyD');
  const thrusting = (keys.has('ArrowUp') || keys.has('KeyW') || keys.has('Space')) && rocket.fuel > 0;

  // Earth rotation (visual only)
  state.earthAngle += 0.105 * realDt;

  // Manual rotation cancels auto-orient
  if (left || right) state.orientMode = null;
  if (left)  rocket.angle -= ROT_SPEED * realDt * warp;
  if (right) rocket.angle += ROT_SPEED * realDt * warp;

  // Auto-orient: smoothly rotate toward prograde or retrograde
  if (state.orientMode && !left && !right) {
    const proAngle = Math.atan2(rocket.vy, rocket.vx);
    const targetAngle = state.orientMode === 'prograde' ? proAngle : proAngle + Math.PI;
    let delta = ((targetAngle - rocket.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const step = ROT_SPEED * 1.5 * realDt;
    if (Math.abs(delta) < step) {
      rocket.angle = targetAngle;
    } else {
      rocket.angle += Math.sign(delta) * step;
    }
  }

  // Sub-step integration loop
  for (let s = 0; s < NSUB; s++) {
    if (state.outcome !== 'playing') break;

    state.moonAngle += MOON_OMEGA * dt;
    const moon = moonXY(state.moonAngle);
    const gE = gravAccel(CX, CY, EARTH_MASS, rocket.x, rocket.y);
    const gM = gravAccel(moon.x, moon.y, MOON_MASS, rocket.x, rocket.y);

    if (thrusting) {
      rocket.vx += Math.cos(rocket.angle) * THRUST * dt;
      rocket.vy += Math.sin(rocket.angle) * THRUST * dt;
      rocket.fuel = Math.max(0, rocket.fuel - FUEL_DRAIN * dt);
    }

    rocket.vx += (gE.ax + gM.ax) * dt;
    rocket.vy += (gE.ay + gM.ay) * dt;
    rocket.x += rocket.vx * dt;
    rocket.y += rocket.vy * dt;

    // Record trail point if moved enough
    const last = state.trail[state.trail.length - 1];
    if (!last || Math.hypot(rocket.x - last.x, rocket.y - last.y) > 3) {
      state.trail.push({ x: rocket.x, y: rocket.y });
      if (state.trail.length > TRAIL_MAX) state.trail.shift();
    }

    evalState(gE.dist, gM.dist, realDt);
  }
}


// ════════════════════════════════════════════════════════════════════════════
// STATE EVALUATION
// ════════════════════════════════════════════════════════════════════════════

function evalState(dEarth, dMoon, realDt) {
  if (dEarth <= EARTH_R + 5) return end('lose', 'CRASHED INTO EARTH');
  if (dMoon <= MOON_R + 5)   return end('lose', 'CRASHED INTO THE MOON');
  if (Math.hypot(rocket.x - CX, rocket.y - CY) > ESCAPE_DIST) {
    return end('lose', 'LOST IN SPACE');
  }

  // Out of fuel and not in lunar orbit — no way to complete mission
  const moonNow = moonXY(state.moonAngle);
  const distToMoon = Math.hypot(rocket.x - moonNow.x, rocket.y - moonNow.y);
  if (rocket.fuel <= 0 && distToMoon >= STABLE_OUTER) {
    return end('lose', 'OUT OF FUEL');
  }

  const inBand = distToMoon < STABLE_OUTER;

  if (inBand) {
    state.stableTimer += realDt;
    const rem = Math.max(0, STABLE_HOLD - state.stableTimer);
    state.message = rem > 0 ? 'HOLDING LUNAR ORBIT…' : 'STABLE LUNAR ORBIT ACHIEVED!';
    if (state.stableTimer >= STABLE_HOLD) end('win', 'MISSION COMPLETE');
  } else {
    state.stableTimer = 0;
    if (state.outcome === 'playing') {
      const dE = Math.hypot(rocket.x - CX, rocket.y - CY);
      if (distToMoon < 110)  state.message = 'APPROACHING THE MOON';
      else if (dE < 130)     state.message = 'IN LOW EARTH ORBIT';
      else                   state.message = 'IN TRANSFER ORBIT';
    }
  }
}

function end(outcome, msg) {
  state.outcome = outcome;
  state.message = msg;
}


// ════════════════════════════════════════════════════════════════════════════
// TRAJECTORY PREDICTION
// ════════════════════════════════════════════════════════════════════════════

function predictPath() {
  let px  = rocket.x;
  let py  = rocket.y;
  let pvx = rocket.vx;
  let pvy = rocket.vy;
  let pAng = state.moonAngle;

  const pts = [];
  let collision = null;
  const subDt = PRED_DT / PRED_SUBSTEPS;

  for (let i = 0; i < PRED_STEPS; i++) {
    let hit = false;

    for (let s = 0; s < PRED_SUBSTEPS; s++) {
      const prevX = px;
      const prevY = py;

      pAng += MOON_OMEGA * subDt;
      const m  = moonXY(pAng);
      const gE = gravAccel(CX, CY, EARTH_MASS, px, py);
      const gM = gravAccel(m.x, m.y, MOON_MASS, px, py);

      pvx += (gE.ax + gM.ax) * subDt;
      pvy += (gE.ay + gM.ay) * subDt;
      px  += pvx * subDt;
      py  += pvy * subDt;

      // Check Earth collision
      if (gE.dist < EARTH_R) {
        const sp = surfacePoint(prevX, prevY, px, py, CX, CY, EARTH_R);
        collision = { x: sp.x, y: sp.y, body: 'EARTH' };
        pts.push(sp);
        hit = true;
        break;
      }

      // Check Moon collision
      const mNow = moonXY(pAng);
      const moonDist = Math.hypot(px - mNow.x, py - mNow.y);
      if (moonDist < MOON_R) {
        const sp = surfacePoint(prevX, prevY, px, py, mNow.x, mNow.y, MOON_R);
        collision = { x: sp.x, y: sp.y, body: 'MOON' };
        pts.push(sp);
        hit = true;
        break;
      }

      // Check escape
      if (Math.hypot(px - CX, py - CY) > ESCAPE_DIST + 80) {
        hit = true;
        break;
      }

      // Instability guard: if very close to a body centre, Euler is diverging
      if (gE.dist < 2 || moonDist < 2) {
        hit = true;
        break;
      }
    }

    if (hit) break;
    pts.push({ x: px, y: py });
  }

  return { pts, collision };
}

// Binary-search to find exact surface crossing point
function surfacePoint(x0, y0, x1, y1, bx, by, r) {
  for (let b = 0; b < 12; b++) {
    const mx = (x0 + x1) * 0.5;
    const my = (y0 + y1) * 0.5;
    if (Math.hypot(mx - bx, my - by) < r) {
      x1 = mx; y1 = my;
    } else {
      x0 = mx; y0 = my;
    }
  }
  return { x: (x0 + x1) * 0.5, y: (y0 + y1) * 0.5 };
}


// ════════════════════════════════════════════════════════════════════════════
// VISUAL MARKERS (COLLISION & UNSTABLE PATH)
// ════════════════════════════════════════════════════════════════════════════

function drawCollisionWarning(col) {
  const { x, y, body } = col;
  const t = (Date.now() / 400) % (Math.PI * 2);
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
  ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();

  // Label
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


// ════════════════════════════════════════════════════════════════════════════
// SHADOW & LIGHTING
// ════════════════════════════════════════════════════════════════════════════

// Draws terminator shadow on a body based on sun direction
function drawShadow(bx, by, r, sunX, sunY) {
  const dx = sunX - bx;
  const dy = sunY - by;
  const dist = Math.hypot(dx, dy);
  const nx = dx / dist;
  const ny = dy / dist;

  const blend = r * 0.35;
  const g = ctx.createLinearGradient(
    bx + nx * blend, by + ny * blend,
    bx - nx * r,     by - ny * r
  );
  g.addColorStop(0,    'rgba(0,0,0,0)');
  g.addColorStop(0.15, 'rgba(0,0,0,0.10)');
  g.addColorStop(0.5,  'rgba(0,0,0,0.60)');
  g.addColorStop(1,    'rgba(0,0,0,0.92)');

  ctx.save();
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = g;
  ctx.fillRect(bx - r, by - r, r * 2, r * 2);
  ctx.restore();
}

// Returns 0‥1: 0 = fully lit, 1 = fully eclipsed by Earth's shadow
function earthEclipseFactor(moonX, moonY, sunX, sunY) {
  const exAxis = CX - sunX;
  const eyAxis = CY - sunY;
  const axisLen = Math.hypot(exAxis, eyAxis);
  const axNx = exAxis / axisLen;
  const axNy = eyAxis / axisLen;

  const emx = moonX - CX;
  const emy = moonY - CY;
  const proj = emx * axNx + emy * axNy;
  if (proj < 0) return 0; // Moon on sun-side of Earth

  const perpX = emx - proj * axNx;
  const perpY = emy - proj * axNy;
  const perp = Math.hypot(perpX, perpY);

  const umbraR = Math.max(0, EARTH_R - proj * (EARTH_R / (axisLen * 0.9)));
  if (perp > umbraR + MOON_R) return 0;
  if (perp < umbraR - MOON_R) return 1;

  return 1 - Math.min(1, (perp - (umbraR - MOON_R)) / (2 * MOON_R));
}


// ════════════════════════════════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════════════════════════════════

function render() {
  // Reset transform and state
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.setLineDash([]);
  ctx.fillStyle = '#040814';
  ctx.fillRect(0, 0, W, H);

  const moon = moonXY(state.moonAngle);

  // ── Stars (parallax background) ───────────────────────────────────────────
  {
    const parallaxScale = 0.18;
    const starCamX = (moon.x - CX) * camera.blend;
    const starCamY = (moon.y - CY) * camera.blend;
    const ox = (rocket.x - CX) * parallaxScale - starCamX * 0.05;
    const oy = (rocket.y - CY) * parallaxScale - starCamY * 0.05;

    for (const s of STARS) {
      const sx = ((s.x - ox * s.depth) % W + W) % W;
      const sy = ((s.y - oy * s.depth) % H + H) % H;
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#dbeafe';
      ctx.beginPath();
      ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ── Camera transform ──────────────────────────────────────────────────────
  const camX = (moon.x - CX) * camera.blend;
  const camY = (moon.y - CY) * camera.blend;
  ctx.save();
  ctx.translate(CX, CY);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-(CX + camX), -(CY + camY));

  // ── Orbit guides ──────────────────────────────────────────────────────────
  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([]);

  // Moon orbit path
  ctx.strokeStyle = 'rgba(100,130,255,0.18)';
  ctx.beginPath();
  ctx.arc(CX, CY, MOON_ORBIT, 0, Math.PI * 2);
  ctx.stroke();

  // Low Earth orbit guide
  ctx.strokeStyle = 'rgba(100,210,255,0.14)';
  ctx.beginPath();
  ctx.arc(CX, CY, 90, 0, Math.PI * 2);
  ctx.stroke();

  // Win-zone circle (brightens when rocket is inside)
  const distToMoon = Math.hypot(rocket.x - moon.x, rocket.y - moon.y);
  const inWinZone = distToMoon < STABLE_OUTER;
  ctx.strokeStyle = inWinZone ? 'rgba(134,239,172,0.90)' : 'rgba(134,239,172,0.22)';
  ctx.lineWidth = inWinZone ? 2.5 : 1.0;
  ctx.setLineDash([5, 8]);
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, STABLE_OUTER, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // ── Trail + prediction path ───────────────────────────────────────────────
  strokePath(state.trail, 'rgba(125,211,252,0.5)', 1.5, []);

  if (state.outcome === 'playing') {
    const pred = predictPath();
    const pts = pred.pts;
    const smoothedCol = collisionFilter.update(pred.collision);
    const dispLen = pathLengthFilter.update(pts.length);
    const dispPts = pts.slice(0, dispLen);

    if (smoothedCol) {
      const splitAt = Math.max(0, dispPts.length - 20);
      strokePath(dispPts.slice(0, splitAt), 'rgba(251,211,77,0.55)', 1.3, [6, 6]);
      strokePath(dispPts.slice(splitAt), 'rgba(255,80,80,0.75)', 2.0, []);
      drawCollisionWarning(smoothedCol);
    } else {
      strokePath(dispPts, 'rgba(251,211,77,0.55)', 1.3, [6, 6]);
    }
  }

  // ── Earth's shadow cone ───────────────────────────────────────────────────
  {
    const dx = CX - SUN_X;
    const dy = CY - SUN_Y;
    const dist = Math.hypot(dx, dy);
    const nx = dx / dist;
    const ny = dy / dist;
    const coneLen = 600;
    const coneR0 = EARTH_R;
    const coneR1 = EARTH_R * 0.96;
    const px = -ny;
    const py = nx;
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

  // ── Earth ─────────────────────────────────────────────────────────────────
  {
    // Atmosphere glow
    const atmosphere = ctx.createRadialGradient(CX, CY, EARTH_R * 0.7, CX, CY, EARTH_R * 2.6);
    atmosphere.addColorStop(0, 'rgba(96,165,250,0.22)');
    atmosphere.addColorStop(0.55, 'rgba(59,130,246,0.18)');
    atmosphere.addColorStop(1, 'rgba(59,130,246,0)');
    ctx.fillStyle = atmosphere;
    ctx.beginPath();
    ctx.arc(CX, CY, EARTH_R * 2.6, 0, Math.PI * 2);
    ctx.fill();

    // Planet body
    const earthGrad = ctx.createRadialGradient(CX - 10, CY - 12, 4, CX, CY, EARTH_R + 4);
    earthGrad.addColorStop(0, '#93c5fd');
    earthGrad.addColorStop(0.45, '#3b82f6');
    earthGrad.addColorStop(0.8, '#1d4ed8');
    earthGrad.addColorStop(1, '#172554');
    ctx.fillStyle = earthGrad;
    ctx.beginPath();
    ctx.arc(CX, CY, EARTH_R, 0, Math.PI * 2);
    ctx.fill();

    // Rotating surface features (land/clouds)
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, EARTH_R, 0, Math.PI * 2);
    ctx.clip();
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
    ctx.restore();

    // Terminator shadow
    drawShadow(CX, CY, EARTH_R, SUN_X, SUN_Y);

    // Rim highlight
    ctx.strokeStyle = 'rgba(191,219,254,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(CX, CY, EARTH_R + 1, 0, Math.PI * 2);
    ctx.stroke();
  }

  // ── Moon ──────────────────────────────────────────────────────────────────
  {
    // Glow
    const mg = ctx.createRadialGradient(moon.x, moon.y, 3, moon.x, moon.y, 26);
    mg.addColorStop(0, 'rgba(220,220,220,0.5)');
    mg.addColorStop(1, 'rgba(220,220,220,0)');
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.arc(moon.x, moon.y, 26, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = '#9ca3af';
    ctx.beginPath();
    ctx.arc(moon.x, moon.y, MOON_R, 0, Math.PI * 2);
    ctx.fill();

    // Craters (tidally locked — same face always points at Earth)
    ctx.save();
    ctx.translate(moon.x, moon.y);
    ctx.rotate(state.moonAngle + Math.PI / 2);
    ctx.fillStyle = '#6b7280';
    ctx.beginPath();
    ctx.arc(-3, -2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(4, 3, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Terminator shadow
    drawShadow(moon.x, moon.y, MOON_R, SUN_X, SUN_Y);

    // Earth eclipse shadow
    const eclF = earthEclipseFactor(moon.x, moon.y, SUN_X, SUN_Y);
    if (eclF > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(moon.x, moon.y, MOON_R, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = `rgba(0,0,0,${(eclF * 0.88).toFixed(2)})`;
      ctx.fillRect(moon.x - MOON_R, moon.y - MOON_R, MOON_R * 2, MOON_R * 2);
      ctx.restore();
    }
  }

  // ── Rocket ────────────────────────────────────────────────────────────────
  {
    const thrusting = (keys.has('ArrowUp') || keys.has('KeyW') || keys.has('Space'))
                      && rocket.fuel > 0 && state.outcome === 'playing';

    ctx.save();
    ctx.translate(rocket.x, rocket.y);
    ctx.rotate(rocket.angle);

    // Exhaust flame
    if (thrusting) {
      ctx.fillStyle = 'rgba(251,146,60,' + (0.7 + Math.random() * 0.3) + ')';
      ctx.beginPath();
      ctx.moveTo(-5, 0);
      ctx.lineTo(-15 - Math.random() * 8, -3.5);
      ctx.lineTo(-15 - Math.random() * 8, 3.5);
      ctx.closePath();
      ctx.fill();
    }

    // Body
    ctx.fillStyle = '#f1f5f9';
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, -5);
    ctx.lineTo(-4, 0);
    ctx.lineTo(-6, 5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  ctx.restore(); // end camera transform
  drawHUD(moon);
}


// ════════════════════════════════════════════════════════════════════════════
// HUD
// ════════════════════════════════════════════════════════════════════════════

function drawHUD(moon) {
  const speed = Math.hypot(rocket.vx, rocket.vy);
  const dE = Math.hypot(rocket.x - CX, rocket.y - CY);
  const dM = Math.hypot(rocket.x - moon.x, rocket.y - moon.y);
  const warp = WARP_LEVELS[state.warpIdx];
  const fuelPct = Math.max(0, Math.min(1, rocket.fuel / 100));

  drawStatusBar();
  drawFuelBar(fuelPct);
  drawSpeedGauge(speed);
  drawTelemetryPills(dE, dM, warp);
  drawCountdownOverlay();
  drawOutcomeBanner();
}

// Top-centre status message
function drawStatusBar() {
  const label = state.outcome === 'playing' ? state.message : '';
  if (!label) return;

  ctx.save();
  ctx.font = '700 22px Inter,ui-sans-serif,sans-serif';
  ctx.textAlign = 'center';
  const tw = ctx.measureText(label).width;
  const bw = tw + 48;
  const bh = 40;
  const bx = W / 2 - bw / 2;
  const by = 28;

  ctx.fillStyle = 'rgba(6,10,24,0.78)';
  ctx.strokeStyle = 'rgba(150,180,255,0.20)';
  ctx.lineWidth = 1;
  rrect(bx, by, bw, bh, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#c8d8f8';
  ctx.fillText(label, W / 2, by + 26);
  ctx.textAlign = 'left';
  ctx.restore();
}

// Bottom-centre fuel bar
function drawFuelBar(pct) {
  const fuelColor = pct > 0.3 ? '#38bdf8' : pct > 0.12 ? '#fbbf24' : '#f87171';
  const bw = 500;
  const bh = 8;
  const bx = W / 2 - bw / 2;
  const by = H - 60;

  ctx.save();

  // Track
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  rrect(bx, by, bw, bh, 4);
  ctx.fill();

  // Fill
  ctx.fillStyle = fuelColor;
  rrect(bx, by, bw * pct, bh, 4);
  ctx.fill();

  // Labels
  ctx.font = '700 13px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle = '#6b82a8';
  ctx.textAlign = 'left';
  ctx.fillText('FUEL', bx, by - 6);

  ctx.textAlign = 'right';
  ctx.fillStyle = fuelColor;
  ctx.fillText(rocket.fuel.toFixed(0) + '%', bx + bw, by - 6);

  ctx.textAlign = 'left';
  ctx.restore();
}

// Bottom-left arc gauge
function drawSpeedGauge(speed) {
  const gx = 120;
  const gy = H - 118;
  const gr = 82;
  const MAX_SPD = 1000;
  const startA = Math.PI * 0.75;   // 135°
  const endA = Math.PI * 2.25;     // 405° (270° sweep)
  const pct = Math.min(speed / MAX_SPD, 1);
  const fillEnd = startA + (endA - startA) * pct;
  const spdColor = speed < 400 ? '#38bdf8' : speed < 700 ? '#fbbf24' : '#f87171';

  ctx.save();

  // Outer glow
  ctx.beginPath();
  ctx.arc(gx, gy, gr + 2, startA, endA);
  ctx.strokeStyle = 'rgba(100,140,255,0.08)';
  ctx.lineWidth = 18;
  ctx.stroke();

  // Track
  ctx.beginPath();
  ctx.arc(gx, gy, gr, startA, endA);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 12;
  ctx.lineCap = 'butt';
  ctx.stroke();

  // Tick marks
  for (let v = 0; v <= MAX_SPD; v += 100) {
    const a = startA + (endA - startA) * (v / MAX_SPD);
    const inner = v % 500 === 0 ? gr - 18 : gr - 12;
    ctx.beginPath();
    ctx.moveTo(gx + Math.cos(a) * inner, gy + Math.sin(a) * inner);
    ctx.lineTo(gx + Math.cos(a) * (gr + 2), gy + Math.sin(a) * (gr + 2));
    ctx.strokeStyle = v % 500 === 0 ? 'rgba(180,200,255,0.5)' : 'rgba(180,200,255,0.2)';
    ctx.lineWidth = v % 500 === 0 ? 2 : 1;
    ctx.stroke();
  }

  // Active arc
  if (pct > 0) {
    ctx.beginPath();
    ctx.arc(gx, gy, gr, startA, fillEnd);
    ctx.strokeStyle = spdColor;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Needle dot
  ctx.beginPath();
  ctx.arc(gx + Math.cos(fillEnd) * gr, gy + Math.sin(fillEnd) * gr, 7, 0, Math.PI * 2);
  ctx.fillStyle = spdColor;
  ctx.fill();

  // Centre readout
  ctx.textAlign = 'center';
  ctx.font = '800 28px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle = spdColor;
  ctx.fillText(speed.toFixed(0), gx, gy + 10);
  ctx.font = '600 12px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle = '#4a6080';
  ctx.fillText('u/s', gx, gy + 28);

  // Scale labels
  ctx.font = '600 11px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle = 'rgba(180,200,255,0.3)';
  ctx.fillText('1000', gx + Math.cos(endA) * (gr + 16), gy + Math.sin(endA) * (gr + 16) + 4);
  ctx.fillText('0', gx + Math.cos(startA) * (gr + 16), gy + Math.sin(startA) * (gr + 16) + 4);

  ctx.textAlign = 'left';
  ctx.restore();
}

// Bottom-left data pills (next to gauge)
function drawTelemetryPills(dE, dM, warp) {
  const items = [
    { label: 'EARTH', value: dE.toFixed(0) + ' u' },
    { label: 'MOON', value: dM.toFixed(0) + ' u' },
    { label: 'WARP', value: warp + '×' },
  ];
  const pillW = 130;
  const pillH = 44;
  const pillGap = 10;
  const startX = 230;
  const startY = H - 80;

  ctx.save();
  items.forEach((item, i) => {
    const x = startX + i * (pillW + pillGap);
    const y = startY;

    ctx.fillStyle = 'rgba(6,10,24,0.82)';
    ctx.strokeStyle = 'rgba(100,140,255,0.15)';
    ctx.lineWidth = 1;
    rrect(x, y, pillW, pillH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#4a6080';
    ctx.font = '600 11px Inter,ui-sans-serif,sans-serif';
    ctx.fillText(item.label, x + 10, y + 14);

    ctx.fillStyle = '#ccddf8';
    ctx.font = '700 16px Inter,ui-sans-serif,sans-serif';
    ctx.fillText(item.value, x + 10, y + 33);
  });
  ctx.restore();
}

// Bottom-right countdown ring (shown while in win zone)
function drawCountdownOverlay() {
  if (state.outcome !== 'playing' || state.stableTimer <= 0) return;

  const rem = Math.max(0, STABLE_HOLD - state.stableTimer);
  const prog = state.stableTimer / STABLE_HOLD;
  const cx = W - 130;
  const cy = H - 130;
  const radius = 90;
  const pulse = 0.85 + 0.15 * Math.sin(Date.now() / 300);

  ctx.save();

  // Arc background
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2, false);
  ctx.strokeStyle = 'rgba(134,239,172,0.12)';
  ctx.lineWidth = 14;
  ctx.stroke();

  // Progress arc
  ctx.beginPath();
  ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog, false);
  ctx.strokeStyle = `rgba(134,239,172,${(0.7 * pulse).toFixed(2)})`;
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Centre text
  ctx.textAlign = 'center';
  ctx.font = '800 72px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle = `rgba(134,239,172,${pulse.toFixed(2)})`;
  ctx.fillText(rem > 0 ? Math.ceil(rem) : '✓', cx, cy + 24);

  ctx.font = '700 18px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle = 'rgba(134,239,172,0.6)';
  ctx.fillText('HOLD ORBIT', cx, cy + 60);

  ctx.textAlign = 'left';
  ctx.restore();
}

// Centre win/lose banner
function drawOutcomeBanner() {
  if (state.outcome === 'playing') return;

  const okCol = state.outcome === 'win' ? '#86efac' : '#fca5a5';
  const bw = 390;
  const bh = 96;
  const bx = W / 2 - 195;
  const by = H / 2 - 48;

  ctx.save();
  ctx.fillStyle = 'rgba(6,10,24,0.92)';
  ctx.strokeStyle = state.outcome === 'win'
    ? 'rgba(134,239,172,0.55)'
    : 'rgba(252,165,165,0.55)';
  ctx.lineWidth = 1.5;
  rrect(bx, by, bw, bh, 18);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'center';

  if (state.outcome === 'win') {
    ctx.font = '800 28px Inter,ui-sans-serif,sans-serif';
    ctx.fillStyle = okCol;
    ctx.fillText('\uD83C\uDF15  MISSION COMPLETE', W / 2, H / 2 + 4);
    ctx.font = '14px Inter,ui-sans-serif,sans-serif';
    ctx.fillStyle = '#93afd4';
    ctx.fillText('Press R to restart', W / 2, H / 2 + 30);
  } else {
    ctx.font = '800 26px Inter,ui-sans-serif,sans-serif';
    ctx.fillStyle = okCol;
    ctx.fillText('\uD83D\uDCA5  MISSION FAILED', W / 2, H / 2 - 12);
    ctx.font = '700 18px Inter,ui-sans-serif,sans-serif';
    ctx.fillStyle = 'rgba(252,165,165,0.8)';
    ctx.fillText(state.message, W / 2, H / 2 + 16);
    ctx.font = '14px Inter,ui-sans-serif,sans-serif';
    ctx.fillStyle = '#93afd4';
    ctx.fillText('Press R to restart', W / 2, H / 2 + 40);
  }

  ctx.textAlign = 'left';
  ctx.restore();
}


// ════════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ════════════════════════════════════════════════════════════════════════════

let lastNow = null;

function loop(now) {
  if (lastNow === null) lastNow = now;
  const realDt = Math.min((now - lastNow) / 1000, 0.05); // cap at 50ms
  lastNow = now;

  if (state.outcome === 'playing') updatePhysics(realDt);

  // Camera: ease toward Moon-centred when in orbit, back to Earth otherwise
  {
    const inOrbit = state.outcome === 'playing' && state.stableTimer > 0;
    const blendAlpha = 0.006;
    const targetBlend = inOrbit ? 1.0 : 0.0;
    camera.blend += (targetBlend - camera.blend) * blendAlpha;
    camera.zoom = 1.0 + 1.2 * camera.blend;
  }

  render();
  requestAnimationFrame(loop);
}


// ════════════════════════════════════════════════════════════════════════════
// TOUCH CONTROLS & UI
// ════════════════════════════════════════════════════════════════════════════

// Fullscreen toggle
(function initFullscreen() {
  const btn = document.getElementById('btn-fullscreen');
  if (!btn) return;

  function toggleFS() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      const el = document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' });
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  }

  btn.addEventListener('pointerdown', e => { e.preventDefault(); toggleFS(); }, { passive: false });

  function onFSChange() {
    const inFS = !!(document.fullscreenElement || document.webkitFullscreenElement);
    btn.textContent = inFS ? '✕' : '⛶';
    btn.style.display = inFS ? 'none' : '';
  }
  document.addEventListener('fullscreenchange', onFSChange);
  document.addEventListener('webkitfullscreenchange', onFSChange);
})();

// Suppress long-press browser behaviour
(function suppressLongPress() {
  document.addEventListener('contextmenu', e => e.preventDefault(), { passive: false });
  document.addEventListener('selectstart', e => e.preventDefault(), { passive: false });
  document.addEventListener('touchstart', e => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('.side-ctrl, .bottom-bar, .fullscreen-btn')) {
      e.preventDefault();
    }
  }, { passive: false });
})();

// Prograde/Retrograde auto-orientation buttons
(function initOrientButtons() {
  function setMode(mode) {
    state.orientMode = state.orientMode === mode ? null : mode;
    document.getElementById('btn-prograde')?.classList.toggle('pressed', state.orientMode === 'prograde');
    document.getElementById('btn-retrograde')?.classList.toggle('pressed', state.orientMode === 'retrograde');
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

// Touch control buttons
(function initTouchControls() {
  const MAP = {
    'btn-left': 'ArrowLeft',
    'btn-right': 'ArrowRight',
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
      if (id === 'btn-left' || id === 'btn-right') {
        state.orientMode = null;
        document.getElementById('btn-prograde')?.classList.remove('pressed');
        document.getElementById('btn-retrograde')?.classList.remove('pressed');
      }
      setPressed(true);
    }, { passive: false });

    el.addEventListener('pointerup', e => { e.preventDefault(); setPressed(false); }, { passive: false });
    el.addEventListener('pointerout', e => { e.preventDefault(); setPressed(false); }, { passive: false });
    el.addEventListener('pointercancel', () => { setPressed(false); }, { passive: false });
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

  // Sync warp button highlight from keyboard
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

// Hide overlay on touch devices
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
  const ov = document.querySelector('.overlay');
  if (ov) ov.style.display = 'none';
}


// ════════════════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════════════════

resetGame();

// Sync orient buttons to initial state
document.getElementById('btn-prograde')?.classList.toggle('pressed', state.orientMode === 'prograde');
document.getElementById('btn-retrograde')?.classList.toggle('pressed', state.orientMode === 'retrograde');

requestAnimationFrame(loop);
