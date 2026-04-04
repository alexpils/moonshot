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


function resetGame() {
  state = {
    warpIdx: 0, moonAngle: 0,
    outcome: 'playing', message: 'BURN PROGRADE TO REACH THE MOON',
    stableTimer: 0, trail: [],
  };
  const r0 = 185, ang = -Math.PI / 2;
  const x = CX + Math.cos(ang) * r0;
  const y = CY + Math.sin(ang) * r0;
  const moon = moonXY(state.moonAngle);
  const gM = gravAccel(moon.x, moon.y, MOON_MASS, x, y);
  const earthCircV = Math.sqrt(G * EARTH_MASS / r0);
  const tx = -Math.sin(ang), ty = Math.cos(ang);
  const moonTangential = gM.ax * tx + gM.ay * ty;
  const v0 = Math.max(0, earthCircV - moonTangential * 8);
  rocket = {
    x, y,
    vx: tx * v0, vy: ty * v0, angle: ang + Math.PI / 2, fuel: 100,
  };
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

  // Rotation outside substep loop — scaled to warp for responsiveness
  if (left)  rocket.angle -= ROT_SPEED * realDt * warp;
  if (right) rocket.angle += ROT_SPEED * realDt * warp;

  for (let s = 0; s < NSUB; s++) {
    if (state.outcome !== 'playing') break;
    state.moonAngle += MOON_OMEGA * dt;
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
    state.stableTimer = Math.max(0, state.stableTimer - realDt * 0.25);
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
function predictPath() {
  let px = rocket.x, py = rocket.y, pvx = rocket.vx, pvy = rocket.vy;
  let pAng = state.moonAngle;
  const pts = [];
  for (let i = 0; i < PRED_STEPS; i++) {
    pAng += MOON_OMEGA * PRED_DT;
    const m  = moonXY(pAng);
    const gE = gravAccel(CX, CY, EARTH_MASS, px, py);
    const gM = gravAccel(m.x, m.y, MOON_MASS, px, py);
    pvx += (gE.ax + gM.ax) * PRED_DT;
    pvy += (gE.ay + gM.ay) * PRED_DT;
    px  += pvx * PRED_DT;
    py  += pvy * PRED_DT;
    pts.push({x: px, y: py});
    if (gE.dist < EARTH_R || gM.dist < MOON_R) break;
    if (Math.hypot(px-CX, py-CY) > ESCAPE_DIST + 80) break;
  }
  return pts;
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

  ctx.strokeStyle = 'rgba(134,239,172,0.25)';
  ctx.setLineDash([5,8]);
  ctx.beginPath();
  ctx.arc(moon.x, moon.y, (STABLE_INNER+STABLE_OUTER)/2, 0, Math.PI*2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // Trail + prediction (each call fully self-contained)
  strokePath(state.trail, 'rgba(125,211,252,0.5)', 1.5, []);
  if (state.outcome === 'playing') {
    strokePath(predictPath(), 'rgba(251,211,77,0.55)', 1.3, [6,6]);
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

  const nightShade = ctx.createLinearGradient(CX - EARTH_R, CY - EARTH_R, CX + EARTH_R, CY + EARTH_R);
  nightShade.addColorStop(0, 'rgba(0,0,0,0)');
  nightShade.addColorStop(0.55, 'rgba(0,0,0,0.05)');
  nightShade.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = nightShade;
  ctx.beginPath(); ctx.arc(CX, CY, EARTH_R, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

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
  ctx.fillStyle = '#6b7280';
  ctx.beginPath(); ctx.arc(moon.x-3,moon.y-2,3,0,Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(moon.x+4,moon.y+3,2,0,Math.PI*2); ctx.fill();

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

resetGame();
requestAnimationFrame(loop);
