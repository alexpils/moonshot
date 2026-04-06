'use strict';
// Moonshot – Earth-Moon orbital arcade + Lunar Landing. No libraries, no backend.

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

const G          = 1800;
const EARTH_MASS = 7000;
const MOON_MASS  = 1800;
const MOON_OMEGA = Math.sqrt(G * EARTH_MASS / Math.pow(470, 3));
const TIME_SCALE = 0.44;
const ROT_SPEED  = 3.2;
const THRUST      = 360;   // orbit scene
const LAND_THRUST = 120;   // landing scene — finer control

const EARTH_R      = 28;
const MOON_R       = 11;
const MOON_ORBIT   = 470;
const FUEL_DRAIN   = 36;
const WARP_LEVELS  = [1, 2, 3, 5];
const STABLE_OUTER = 100;
const STABLE_HOLD  = 60;

// Landing scene
const LAND_MOON_R    = 300;
const LAND_ORBIT_R   = 490;
const LAND_SPEED_MAX = 55;
const PAD_HALF       = 0.30;
const PAD_ANGLE      = Math.PI / 2;
const LAND_ESCAPE    = 960;

const M3_ORBIT_MIN  = 360;
const M3_ORBIT_MAX  = 500;
const M3_HOLD       = 30;
const M3_THRUST     = 110;

const canvas = document.getElementById('game');
const ctx    = canvas.getContext('2d');
const W  = canvas.width;
const H  = canvas.height;
const CX = W / 2;
const CY = H / 2;

const PRED_STEPS    = 140;
const PRED_DT       = 0.09;
const PRED_SUBSTEPS = 4;
const TRAIL_MAX     = 450;
const ESCAPE_DIST   = Math.hypot(W / 2, H / 2);
const SUN_X         = -900;
const SUN_Y         = CY;

const STARS = Array.from({ length: 220 }, () => ({
  x: Math.random() * W, y: Math.random() * H,
  r: Math.random() * 1.4 + 0.25, a: Math.random() * 0.65 + 0.35,
  depth: Math.random(),
}));

const LAND_CRATERS = [
  { ax: -0.35, ay: -0.28, r: 36, depth: 0.7 },
  { ax:  0.42, ay:  0.18, r: 24, depth: 0.6 },
  { ax: -0.55, ay:  0.40, r: 18, depth: 0.5 },
  { ax:  0.18, ay: -0.55, r: 28, depth: 0.65 },
  { ax:  0.62, ay: -0.25, r: 16, depth: 0.45 },
  { ax: -0.10, ay:  0.65, r: 22, depth: 0.55 },
  { ax:  0.30, ay:  0.52, r: 14, depth: 0.4 },
  { ax: -0.68, ay: -0.10, r: 12, depth: 0.4 },
  { ax:  0.05, ay: -0.80, r: 10, depth: 0.35 },
  { ax: -0.45, ay:  0.70, r:  8, depth: 0.3 },
  { ax:  0.75, ay:  0.40, r:  9, depth: 0.3 },
  { ax: -0.20, ay: -0.72, r: 20, depth: 0.5 },
];

// ════════════════════════════════════════════════════════════════════════════
// SCENE MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════

let scene = 'title'; // 'title' | 'orbit' | 'landing' | 'm3'
const uiHitBoxes = {};
let orbitHandoff = null; // { relAngle, fuel }

// Fade transition state
const transition = {
  active: false,
  alpha: 0,       // 0 = transparent, 1 = full black
  phase: 'idle',  // 'fade-out' | 'hold' | 'fade-in'
  holdTimer: 0,
  onMid: null,    // callback fired when screen is fully black
  start(onMid) {
    this.active = true; this.alpha = 0; this.phase = 'fade-out';
    this.holdTimer = 0; this.onMid = onMid;
  },
  update(dt) {
    if (!this.active) return;
    if (this.phase === 'fade-out') {
      this.alpha = Math.min(1, this.alpha + dt * 2.2);
      if (this.alpha >= 1) { this.phase = 'hold'; this.holdTimer = 0; if (this.onMid) { this.onMid(); this.onMid = null; } }
    } else if (this.phase === 'hold') {
      this.holdTimer += dt;
      if (this.holdTimer > 0.35) this.phase = 'fade-in';
    } else if (this.phase === 'fade-in') {
      this.alpha = Math.max(0, this.alpha - dt * 1.6);
      if (this.alpha <= 0) { this.active = false; this.phase = 'idle'; }
    }
  },
  draw() {
    if (!this.active && this.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.restore();
  },
};

// ════════════════════════════════════════════════════════════════════════════
// PROGRESSION
// ════════════════════════════════════════════════════════════════════════════

const progress = {
  get mission1Beaten() { return localStorage.getItem('moonshot_m1') === '1'; },
  get mission2Beaten() { return localStorage.getItem('moonshot_m2') === '1'; },
  unlockMission1()     { localStorage.setItem('moonshot_m1', '1'); },
  unlockMission2()     { localStorage.setItem('moonshot_m2', '1'); },
};

// ════════════════════════════════════════════════════════════════════════════
// INPUT
// ════════════════════════════════════════════════════════════════════════════

const keys = new Set();

window.addEventListener('keydown', e => {
  const block = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
  if (block.includes(e.code)) e.preventDefault();
  keys.add(e.code);

  if (e.code === 'KeyR') {
    if (scene === 'orbit')   { resetGame(); return; }
    if (scene === 'landing') { resetLanding(orbitHandoff); return; }
    if (scene === 'm3')      { resetM3(); return; }
  }

  const tOrient = scene === 'orbit' ? state : (scene === 'landing' ? lState : (scene === 'm3' ? m3State : null));
  if (!tOrient) return;

  if (e.code === 'KeyE') {
    tOrient.orientMode = tOrient.orientMode === 'prograde' ? null : 'prograde';
    document.getElementById('btn-prograde')?.classList.toggle('pressed', tOrient.orientMode === 'prograde');
    document.getElementById('btn-retrograde')?.classList.toggle('pressed', false);
    return;
  }
  if (e.code === 'KeyQ') {
    tOrient.orientMode = tOrient.orientMode === 'retrograde' ? null : 'retrograde';
    document.getElementById('btn-retrograde')?.classList.toggle('pressed', tOrient.orientMode === 'retrograde');
    document.getElementById('btn-prograde')?.classList.toggle('pressed', false);
    return;
  }
  if (e.code === 'Digit1') tOrient.warpIdx = 0;
  if (e.code === 'Digit2') tOrient.warpIdx = 1;
  if (e.code === 'Digit3') tOrient.warpIdx = 2;
  if (e.code === 'Digit4') tOrient.warpIdx = 3;
});

window.addEventListener('keyup', e => keys.delete(e.code));

canvas.addEventListener('pointerdown', handleCanvasClick);

function handleCanvasClick(e) {
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx     = (e.clientX - rect.left) * scaleX;
  const cy     = (e.clientY - rect.top)  * scaleY;

  function hit(box) {
    return box && cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
  }

  if (scene === 'title') {
    if (hit(uiHitBoxes.mission1)) { scene = 'orbit'; resetGame(); }
    if (hit(uiHitBoxes.mission2) && progress.mission1Beaten) { scene = 'landing'; orbitHandoff = null; resetLanding(null); }
    if (hit(uiHitBoxes.mission3) && progress.mission2Beaten) { scene = 'm3'; resetM3(); }
  }
  if (scene === 'orbit') {
    if (hit(uiHitBoxes.beginDescent) && state.outcome === 'win') {
      const moon    = moonXY(state.moonAngle);
      const relX    = rocket.x - moon.x;
      const relY    = rocket.y - moon.y;
      const relDist = Math.hypot(relX, relY);

      // Moon velocity in world frame (tangent to orbit)
      const moonVx = -Math.sin(state.moonAngle) * MOON_ORBIT * MOON_OMEGA;
      const moonVy =  Math.cos(state.moonAngle) * MOON_ORBIT * MOON_OMEGA;

      // Rocket velocity relative to Moon
      const relVx = rocket.vx - moonVx;
      const relVy = rocket.vy - moonVy;
      const relSpeed = Math.hypot(relVx, relVy);

      // Speed ratio vs circular orbit speed at current Moon distance
      const circSpeedM1 = Math.sqrt(G * MOON_MASS / Math.max(relDist, 1));
      const speedRatio  = relSpeed / circSpeedM1;

      orbitHandoff = {
        relAngle: Math.atan2(relY, relX),
        speedRatio: Math.min(speedRatio, 2.5),
        vDirX: relSpeed > 0 ? relVx / relSpeed : 0,
        vDirY: relSpeed > 0 ? relVy / relSpeed : 1,
        fuel: rocket.fuel,
      };
      scene = 'landing';
      resetLanding(orbitHandoff);
    }
    if (hit(uiHitBoxes.backToTitle) && state.outcome !== 'playing') scene = 'title';
  }
  if (scene === 'landing') {
    if (hit(uiHitBoxes.retryLanding)) resetLanding(orbitHandoff);
    if (hit(uiHitBoxes.backToTitle))  scene = 'title';
  }
  if (scene === 'm3') {
    if (hit(uiHitBoxes.retryM3))    resetM3();
    if (hit(uiHitBoxes.backToTitle)) scene = 'title';
  }
}


// ════════════════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════════════════

let state, rocket;
let lState, lRocket;
let m3State, m3Rocket;

const pathLengthFilter = {
  len: 140,
  update(rawLen) {
    const alpha = rawLen < this.len ? 0.5 : 0.04;
    this.len += (rawLen - this.len) * alpha;
    return Math.round(this.len);
  },
  reset() { this.len = 140; },
};

const camera = {
  blend: 0, zoom: 1,
  reset() { this.blend = 0; this.zoom = 1; },
};

const collisionFilter = {
  x: 0, y: 0, body: null, frames: 0, missFrames: 0, visible: false,
  SHOW_AFTER: 4, HIDE_AFTER: 10,
  update(col) {
    if (col) {
      this.missFrames = 0; this.frames++;
      const a = this.frames < this.SHOW_AFTER ? 1.0 : 0.25;
      this.x += (col.x - this.x) * a; this.y += (col.y - this.y) * a;
      this.body = col.body;
      if (this.frames >= this.SHOW_AFTER) this.visible = true;
    } else {
      this.frames = 0; this.missFrames++;
      if (this.missFrames >= this.HIDE_AFTER) { this.visible = false; this.missFrames = 0; }
    }
    return this.visible ? { x: this.x, y: this.y, body: this.body } : null;
  },
  reset() { this.x=0; this.y=0; this.body=null; this.frames=0; this.missFrames=0; this.visible=false; },
};

// ════════════════════════════════════════════════════════════════════════════
// GAME RESET (ORBIT)
// ════════════════════════════════════════════════════════════════════════════

function resetGame() {
  collisionFilter.reset(); pathLengthFilter.reset(); camera.reset();
  uiHitBoxes.beginDescent = null; uiHitBoxes.backToTitle = null;

  state = {
    warpIdx: 0, moonAngle: 0, earthAngle: 0, orientMode: 'prograde',
    outcome: 'playing', message: 'BURN PROGRADE TO REACH THE MOON',
    stableTimer: 0, trail: [],
  };

  const r0 = 75, ang = -Math.PI / 2;
  const x = CX + Math.cos(ang) * r0, y = CY + Math.sin(ang) * r0;
  const circV = Math.sqrt(G * EARTH_MASS / r0);
  rocket = { x, y, vx: -Math.sin(ang)*circV, vy: Math.cos(ang)*circV, angle: ang+Math.PI/2, fuel: 100 };

  document.getElementById('btn-prograde')?.classList.toggle('pressed', true);
  document.getElementById('btn-retrograde')?.classList.toggle('pressed', false);
}

// ════════════════════════════════════════════════════════════════════════════
// LANDING RESET
// ════════════════════════════════════════════════════════════════════════════

function resetLanding(handoff) {
  collisionFilter.reset(); pathLengthFilter.reset();
  uiHitBoxes.retryLanding = null; uiHitBoxes.backToTitle = null;

  const startAngle = handoff ? handoff.relAngle : -Math.PI / 2;
  const startFuel  = handoff ? handoff.fuel     : 100;
  const lx = CX + Math.cos(startAngle) * LAND_ORBIT_R;
  const ly = CY + Math.sin(startAngle) * LAND_ORBIT_R;

  // Circular orbit speed at LAND_ORBIT_R
  const vCircM2 = Math.sqrt(G * MOON_MASS / LAND_ORBIT_R);

  let vx, vy, startRocketAngle;
  if (handoff && handoff.vDirX !== undefined) {
    // True handoff: preserve velocity direction + speed ratio from Mission 1
    const speed = vCircM2 * handoff.speedRatio;
    vx = handoff.vDirX * speed;
    vy = handoff.vDirY * speed;
    startRocketAngle = Math.atan2(vy, vx);
  } else {
    // Direct launch: clean circular orbit
    vx = -Math.sin(startAngle) * vCircM2;
    vy =  Math.cos(startAngle) * vCircM2;
    startRocketAngle = startAngle + Math.PI / 2;
  }

  lState = {
    warpIdx: 0, orientMode: 'prograde', outcome: 'playing',
    message: handoff ? 'IN LUNAR ORBIT \u2014 INITIATE DESCENT' : 'IN LUNAR ORBIT \u2014 INITIATE DESCENT',
    trail: [], fromOrbit: !!handoff,
  };
  lRocket = {
    x: lx, y: ly, vx, vy,
    angle: startRocketAngle, fuel: startFuel,
  };

  document.getElementById('btn-prograde')?.classList.toggle('pressed', true);
  document.getElementById('btn-retrograde')?.classList.toggle('pressed', false);
}



// ════════════════════════════════════════════════════════════════════════════
// M3 RESET
// ════════════════════════════════════════════════════════════════════════════

function resetM3() {
  collisionFilter.reset(); pathLengthFilter.reset();
  uiHitBoxes.retryM3 = null; uiHitBoxes.backToTitle = null;
  const padX = CX + Math.cos(PAD_ANGLE) * (LAND_MOON_R + 8);
  const padY = CY + Math.sin(PAD_ANGLE) * (LAND_MOON_R + 8);
  m3State = {
    warpIdx: 0, orientMode: null, outcome: 'playing',
    message: 'LAUNCH FROM THE MOON \u2014 ESTABLISH ORBIT',
    trail: [], stableTimer: 0,
  };
  m3Rocket = {
    x: padX, y: padY, vx: 0, vy: 0,
    angle: PAD_ANGLE - Math.PI / 2, fuel: 100,
  };
  document.getElementById('btn-prograde')?.classList.toggle('pressed', false);
  document.getElementById('btn-retrograde')?.classList.toggle('pressed', false);
}

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function moonXY(a) { return { x: CX+Math.cos(a)*MOON_ORBIT, y: CY+Math.sin(a)*MOON_ORBIT }; }

function gravAccel(bx, by, mass, x, y) {
  const dx=bx-x, dy=by-y, d2=dx*dx+dy*dy, d=Math.sqrt(d2), a=(G*mass)/Math.max(d2,100);
  return { ax:(dx/d)*a, ay:(dy/d)*a, dist:d };
}

function strokePath(pts, color, width, dash) {
  if (!pts || pts.length < 2) return;
  ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=width||1.5; ctx.setLineDash(dash||[]);
  ctx.beginPath();
  let down=false;
  for (let i=0;i<pts.length;i++) {
    const p=pts[i], pp=pts[i-1];
    if (!Number.isFinite(p.x)||!Number.isFinite(p.y)) { down=false; continue; }
    const gap=pp&&Math.hypot(p.x-pp.x,p.y-pp.y)>60;
    if (!down||gap) { ctx.moveTo(p.x,p.y); down=true; } else { ctx.lineTo(p.x,p.y); }
  }
  ctx.stroke(); ctx.setLineDash([]); ctx.restore();
}

function rrect(x,y,w,h,r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
}

function registerBtn(key,x,y,w,h) { uiHitBoxes[key]={x,y,w,h}; }

function drawCanvasBtn(key,label,x,y,w,h,opts={}) {
  registerBtn(key,x,y,w,h);
  ctx.save();
  ctx.fillStyle   = opts.fill   || 'rgba(20,30,60,0.92)';
  ctx.strokeStyle = opts.stroke || 'rgba(150,200,255,0.40)';
  ctx.lineWidth   = 1.5;
  rrect(x,y,w,h,12); ctx.fill(); ctx.stroke();
  ctx.fillStyle = opts.color || '#c8d8f8';
  ctx.font      = opts.fs    || '700 22px Inter,ui-sans-serif,sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, x+w/2, y+h/2+8);
  ctx.textAlign = 'left'; ctx.restore();
}

function surfacePoint(x0,y0,x1,y1,bx,by,r) {
  for (let b=0;b<12;b++) {
    const mx=(x0+x1)*0.5, my=(y0+y1)*0.5;
    if (Math.hypot(mx-bx,my-by)<r) { x1=mx; y1=my; } else { x0=mx; y0=my; }
  }
  return { x:(x0+x1)*0.5, y:(y0+y1)*0.5 };
}


// ════════════════════════════════════════════════════════════════════════════
// PHYSICS – ORBIT
// ════════════════════════════════════════════════════════════════════════════

function updatePhysics(realDt) {
  const warp=WARP_LEVELS[state.warpIdx], simDt=realDt*TIME_SCALE*warp, NSUB=warp*2, dt=simDt/NSUB;
  const left=keys.has('ArrowLeft')||keys.has('KeyA');
  const right=keys.has('ArrowRight')||keys.has('KeyD');
  const thrusting=(keys.has('ArrowUp')||keys.has('KeyW')||keys.has('Space'))&&rocket.fuel>0;

  state.earthAngle += 0.105 * realDt;
  if (left||right) state.orientMode=null;
  if (left)  rocket.angle -= ROT_SPEED*realDt*warp;
  if (right) rocket.angle += ROT_SPEED*realDt*warp;

  if (state.orientMode && !left && !right) {
    const pro=Math.atan2(rocket.vy,rocket.vx);
    const tgt=state.orientMode==='prograde'?pro:pro+Math.PI;
    let d=((tgt-rocket.angle+Math.PI*3)%(Math.PI*2))-Math.PI;
    const step=ROT_SPEED*1.5*realDt;
    rocket.angle += Math.abs(d)<step ? (d) : Math.sign(d)*step;
    if (Math.abs(d)<step) rocket.angle=tgt;
  }

  for (let s=0;s<NSUB;s++) {
    if (state.outcome!=='playing') break;
    state.moonAngle += MOON_OMEGA*dt;
    const moon=moonXY(state.moonAngle);
    const gE=gravAccel(CX,CY,EARTH_MASS,rocket.x,rocket.y);
    const gM=gravAccel(moon.x,moon.y,MOON_MASS,rocket.x,rocket.y);
    if (thrusting) { rocket.vx+=Math.cos(rocket.angle)*THRUST*dt; rocket.vy+=Math.sin(rocket.angle)*THRUST*dt; rocket.fuel=Math.max(0,rocket.fuel-FUEL_DRAIN*dt); }
    rocket.vx+=(gE.ax+gM.ax)*dt; rocket.vy+=(gE.ay+gM.ay)*dt;
    rocket.x+=rocket.vx*dt; rocket.y+=rocket.vy*dt;
    const last=state.trail[state.trail.length-1];
    if (!last||Math.hypot(rocket.x-last.x,rocket.y-last.y)>3) { state.trail.push({x:rocket.x,y:rocket.y}); if (state.trail.length>TRAIL_MAX) state.trail.shift(); }
    evalState(gE.dist,gM.dist,realDt);
  }
}

function evalState(dEarth,dMoon,realDt) {
  if (dEarth<=EARTH_R+5) return end('lose','CRASHED INTO EARTH');
  if (dMoon<=MOON_R+5)   return end('lose','CRASHED INTO THE MOON');
  if (Math.hypot(rocket.x-CX,rocket.y-CY)>ESCAPE_DIST) return end('lose','LOST IN SPACE');
  const moonNow=moonXY(state.moonAngle), dM=Math.hypot(rocket.x-moonNow.x,rocket.y-moonNow.y);
  if (rocket.fuel<=0&&dM>=STABLE_OUTER) return end('lose','OUT OF FUEL');
  if (dM<STABLE_OUTER) {
    state.stableTimer+=realDt;
    const rem=Math.max(0,STABLE_HOLD-state.stableTimer);
    state.message=rem>0?'HOLDING LUNAR ORBIT\u2026':'STABLE LUNAR ORBIT ACHIEVED!';
    if (state.stableTimer>=STABLE_HOLD) {
      end('win','LUNAR ORBIT ACHIEVED');
      // Capture handoff immediately and begin seamless transition
      const _moon   = moonXY(state.moonAngle);
      const _relX   = rocket.x - _moon.x, _relY = rocket.y - _moon.y;
      const _relDist = Math.hypot(_relX, _relY);
      const _moonVx = -Math.sin(state.moonAngle)*MOON_ORBIT*MOON_OMEGA;
      const _moonVy =  Math.cos(state.moonAngle)*MOON_ORBIT*MOON_OMEGA;
      const _relVx = rocket.vx-_moonVx, _relVy = rocket.vy-_moonVy;
      const _relSpeed = Math.hypot(_relVx, _relVy);
      const _circ = Math.sqrt(G*MOON_MASS/Math.max(_relDist,1));
      orbitHandoff = {
        relAngle: Math.atan2(_relY, _relX),
        speedRatio: Math.min(_relSpeed/_circ, 2.5),
        vDirX: _relSpeed>0?_relVx/_relSpeed:0,
        vDirY: _relSpeed>0?_relVy/_relSpeed:1,
        fuel: rocket.fuel,
      };
      progress.unlockMission1();
      transition.start(() => {
        scene = 'landing';
        resetLanding(orbitHandoff);
      });
    }
  } else {
    state.stableTimer=0;
    if (state.outcome==='playing') {
      const dE=Math.hypot(rocket.x-CX,rocket.y-CY);
      if (dM<110) state.message='APPROACHING THE MOON';
      else if (dE<130) state.message='IN LOW EARTH ORBIT';
      else state.message='IN TRANSFER ORBIT';
    }
  }
}

function end(outcome,msg) { state.outcome=outcome; state.message=msg; }

// ════════════════════════════════════════════════════════════════════════════
// PHYSICS – LANDING
// ════════════════════════════════════════════════════════════════════════════

function updateLandingPhysics(realDt) {
  const warp=WARP_LEVELS[lState.warpIdx], simDt=realDt*TIME_SCALE*warp, NSUB=warp*2, dt=simDt/NSUB;
  const left=keys.has('ArrowLeft')||keys.has('KeyA');
  const right=keys.has('ArrowRight')||keys.has('KeyD');
  const thrusting=(keys.has('ArrowUp')||keys.has('KeyW')||keys.has('Space'))&&lRocket.fuel>0;

  if (left||right) lState.orientMode=null;
  if (left)  lRocket.angle-=ROT_SPEED*realDt*warp;
  if (right) lRocket.angle+=ROT_SPEED*realDt*warp;

  if (lState.orientMode && !left && !right) {
    const pro=Math.atan2(lRocket.vy,lRocket.vx);
    const tgt=lState.orientMode==='prograde'?pro:pro+Math.PI;
    let d=((tgt-lRocket.angle+Math.PI*3)%(Math.PI*2))-Math.PI;
    const step=ROT_SPEED*1.5*realDt;
    if (Math.abs(d)<step) lRocket.angle=tgt; else lRocket.angle+=Math.sign(d)*step;
  }

  for (let s=0;s<NSUB;s++) {
    if (lState.outcome!=='playing') break;
    if (thrusting) { lRocket.vx+=Math.cos(lRocket.angle)*LAND_THRUST*dt; lRocket.vy+=Math.sin(lRocket.angle)*LAND_THRUST*dt; lRocket.fuel=Math.max(0,lRocket.fuel-FUEL_DRAIN*(LAND_THRUST/THRUST)*dt); }
    const gM=gravAccel(CX,CY,MOON_MASS,lRocket.x,lRocket.y);
    lRocket.vx+=gM.ax*dt; lRocket.vy+=gM.ay*dt;
    lRocket.x+=lRocket.vx*dt; lRocket.y+=lRocket.vy*dt;
    const last=lState.trail[lState.trail.length-1];
    if (!last||Math.hypot(lRocket.x-last.x,lRocket.y-last.y)>3) { lState.trail.push({x:lRocket.x,y:lRocket.y}); if (lState.trail.length>TRAIL_MAX) lState.trail.shift(); }
    evalLandingState(gM.dist);
  }
}

function evalLandingState(distToMoon) {
  if (distToMoon>LAND_ESCAPE) return endLanding('lose','LOST IN SPACE');
  const alt=distToMoon-LAND_MOON_R;
  if (lRocket.fuel<=0&&alt>60) return endLanding('lose','OUT OF FUEL');
  if (alt<=5) {
    const spd=Math.hypot(lRocket.vx,lRocket.vy);
    const ta=Math.atan2(lRocket.y-CY,lRocket.x-CX);
    let diff=ta-PAD_ANGLE;
    while (diff>Math.PI) diff-=2*Math.PI; while (diff<-Math.PI) diff+=2*Math.PI;
    const onPad=Math.abs(diff)<PAD_HALF;
    if (onPad&&spd<=LAND_SPEED_MAX) {
      endLanding('win','TOUCHDOWN! MISSION COMPLETE');
      progress.unlockMission2();
      transition.start(()=>{ scene='m3'; resetM3(); });
      return;
    }
    if (!onPad) return endLanding('lose','MISSED THE LANDING PAD');
    return endLanding('lose',`TOO FAST \u2014 ${spd.toFixed(0)} u/s`);
  }
  if (alt<80) lState.message='FINAL APPROACH';
  else if (alt<200) lState.message='DESCENT PHASE';
  else lState.message='IN LUNAR ORBIT \u2014 INITIATE DESCENT';
}

function endLanding(outcome,msg) { lState.outcome=outcome; lState.message=msg; }

// ════════════════════════════════════════════════════════════════════════════
// PHYSICS + EVAL – M3
// ════════════════════════════════════════════════════════════════════════════

function updateM3Physics(realDt) {
  const warp=WARP_LEVELS[m3State.warpIdx], simDt=realDt*TIME_SCALE*warp, NSUB=warp*2, dt=simDt/NSUB;
  const left=keys.has('ArrowLeft')||keys.has('KeyA');
  const right=keys.has('ArrowRight')||keys.has('KeyD');
  const thrusting=(keys.has('ArrowUp')||keys.has('KeyW')||keys.has('Space'))&&m3Rocket.fuel>0;

  if (left||right) m3State.orientMode=null;
  if (left)  m3Rocket.angle-=ROT_SPEED*realDt*warp;
  if (right) m3Rocket.angle+=ROT_SPEED*realDt*warp;

  if (m3State.orientMode&&!left&&!right) {
    const pro=Math.atan2(m3Rocket.vy,m3Rocket.vx);
    const tgt=m3State.orientMode==='prograde'?pro:pro+Math.PI;
    let d=((tgt-m3Rocket.angle+Math.PI*3)%(Math.PI*2))-Math.PI;
    const step=ROT_SPEED*1.5*realDt;
    if (Math.abs(d)<step) m3Rocket.angle=tgt; else m3Rocket.angle+=Math.sign(d)*step;
  }

  for (let s=0;s<NSUB;s++) {
    if (m3State.outcome!=='playing') break;
    if (thrusting) {
      m3Rocket.vx+=Math.cos(m3Rocket.angle)*M3_THRUST*dt;
      m3Rocket.vy+=Math.sin(m3Rocket.angle)*M3_THRUST*dt;
      m3Rocket.fuel=Math.max(0,m3Rocket.fuel-FUEL_DRAIN*(M3_THRUST/THRUST)*dt);
    }
    const gM=gravAccel(CX,CY,MOON_MASS,m3Rocket.x,m3Rocket.y);
    m3Rocket.vx+=gM.ax*dt; m3Rocket.vy+=gM.ay*dt;
    m3Rocket.x+=m3Rocket.vx*dt; m3Rocket.y+=m3Rocket.vy*dt;
    const last=m3State.trail[m3State.trail.length-1];
    if (!last||Math.hypot(m3Rocket.x-last.x,m3Rocket.y-last.y)>3) {
      m3State.trail.push({x:m3Rocket.x,y:m3Rocket.y});
      if (m3State.trail.length>TRAIL_MAX) m3State.trail.shift();
    }
    evalM3State(gM.dist, realDt/NSUB);
  }
}

function evalM3State(dist, dt) {
  if (dist<LAND_MOON_R+4) return endM3('lose','CRASHED INTO THE MOON');
  if (dist>LAND_ESCAPE)   return endM3('lose','LOST IN SPACE');
  if (m3Rocket.fuel<=0&&(dist<M3_ORBIT_MIN||dist>M3_ORBIT_MAX)) return endM3('lose','OUT OF FUEL');

  const inBand=dist>=M3_ORBIT_MIN&&dist<=M3_ORBIT_MAX;
  if (inBand) {
    m3State.stableTimer+=dt*WARP_LEVELS[m3State.warpIdx]*TIME_SCALE;
    const rem=Math.max(0,M3_HOLD-m3State.stableTimer);
    m3State.message=rem>0?'HOLDING ORBIT\u2026':'ORBIT ESTABLISHED!';
    if (m3State.stableTimer>=M3_HOLD) {
      endM3('win','MISSION COMPLETE');
      progress.unlockMission2();
      transition.start(()=>{
        scene='orbit';
        resetGame();
        // Place rocket near Moon in a stable orbit
        const moon=moonXY(state.moonAngle);
        const midR=(M3_ORBIT_MIN+M3_ORBIT_MAX)/2;
        const spA=-Math.PI/2;
        const vC=Math.sqrt(G*MOON_MASS/midR);
        const moonVx=-Math.sin(state.moonAngle)*MOON_ORBIT*MOON_OMEGA;
        const moonVy= Math.cos(state.moonAngle)*MOON_ORBIT*MOON_OMEGA;
        rocket.x=moon.x+Math.cos(spA)*midR;
        rocket.y=moon.y+Math.sin(spA)*midR;
        rocket.vx=-Math.sin(spA)*vC+moonVx;
        rocket.vy= Math.cos(spA)*vC+moonVy;
        rocket.fuel=m3Rocket.fuel;
        rocket.angle=spA+Math.PI/2;
        state.message='IN LUNAR ORBIT \u2014 BURN RETROGRADE TO RETURN HOME';
      });
    }
  } else {
    m3State.stableTimer=0;
    const alt=dist-LAND_MOON_R;
    if (alt<60)               m3State.message='LAUNCH \u2014 CLIMB TO ORBIT';
    else if (dist<M3_ORBIT_MIN) m3State.message='BELOW TARGET BAND \u2014 BURN PROGRADE';
    else                      m3State.message='ABOVE TARGET BAND \u2014 BURN RETROGRADE';
  }
}

function endM3(outcome,msg) { m3State.outcome=outcome; m3State.message=msg; }

function predictM3Path() {
  let px=m3Rocket.x,py=m3Rocket.y,pvx=m3Rocket.vx,pvy=m3Rocket.vy;
  const pts=[]; let col=null; const STEPS=200, subDt=PRED_DT/PRED_SUBSTEPS;
  for (let i=0;i<STEPS;i++) {
    let hit=false;
    for (let s=0;s<PRED_SUBSTEPS;s++) {
      const prevX=px,prevY=py;
      const gM=gravAccel(CX,CY,MOON_MASS,px,py);
      pvx+=gM.ax*subDt; pvy+=gM.ay*subDt; px+=pvx*subDt; py+=pvy*subDt;
      if (gM.dist<LAND_MOON_R) { const sp=surfacePoint(prevX,prevY,px,py,CX,CY,LAND_MOON_R); col={x:sp.x,y:sp.y,body:'MOON'}; pts.push(sp); hit=true; break; }
      if (gM.dist>LAND_ESCAPE||gM.dist<2) { hit=true; break; }
    }
    if (hit) break; pts.push({x:px,y:py});
  }
  return {pts,collision:col};
}




// ════════════════════════════════════════════════════════════════════════════
// TRAJECTORY PREDICTION
// ════════════════════════════════════════════════════════════════════════════

function predictPath() {
  let px=rocket.x,py=rocket.y,pvx=rocket.vx,pvy=rocket.vy,pAng=state.moonAngle;
  const pts=[]; let col=null; const subDt=PRED_DT/PRED_SUBSTEPS;
  for (let i=0;i<PRED_STEPS;i++) {
    let hit=false;
    for (let s=0;s<PRED_SUBSTEPS;s++) {
      const prevX=px,prevY=py;
      pAng+=MOON_OMEGA*subDt;
      const m=moonXY(pAng),gE=gravAccel(CX,CY,EARTH_MASS,px,py),gM=gravAccel(m.x,m.y,MOON_MASS,px,py);
      pvx+=(gE.ax+gM.ax)*subDt; pvy+=(gE.ay+gM.ay)*subDt; px+=pvx*subDt; py+=pvy*subDt;
      if (gE.dist<EARTH_R) { const sp=surfacePoint(prevX,prevY,px,py,CX,CY,EARTH_R); col={x:sp.x,y:sp.y,body:'EARTH'}; pts.push(sp); hit=true; break; }
      const mN=moonXY(pAng),md=Math.hypot(px-mN.x,py-mN.y);
      if (md<MOON_R) { const sp=surfacePoint(prevX,prevY,px,py,mN.x,mN.y,MOON_R); col={x:sp.x,y:sp.y,body:'MOON'}; pts.push(sp); hit=true; break; }
      if (Math.hypot(px-CX,py-CY)>ESCAPE_DIST+80||gE.dist<2||md<2) { hit=true; break; }
    }
    if (hit) break; pts.push({x:px,y:py});
  }
  return {pts,collision:col};
}

function predictLandingPath() {
  let px=lRocket.x,py=lRocket.y,pvx=lRocket.vx,pvy=lRocket.vy;
  const pts=[]; let col=null; const STEPS=200, subDt=PRED_DT/PRED_SUBSTEPS;
  for (let i=0;i<STEPS;i++) {
    let hit=false;
    for (let s=0;s<PRED_SUBSTEPS;s++) {
      const prevX=px,prevY=py;
      const gM=gravAccel(CX,CY,MOON_MASS,px,py);
      pvx+=gM.ax*subDt; pvy+=gM.ay*subDt; px+=pvx*subDt; py+=pvy*subDt;
      if (gM.dist<LAND_MOON_R) { const sp=surfacePoint(prevX,prevY,px,py,CX,CY,LAND_MOON_R); col={x:sp.x,y:sp.y,body:'MOON'}; pts.push(sp); hit=true; break; }
      if (gM.dist>LAND_ESCAPE||gM.dist<2) { hit=true; break; }
    }
    if (hit) break; pts.push({x:px,y:py});
  }
  return {pts,collision:col};
}

// ════════════════════════════════════════════════════════════════════════════
// SHADOW & LIGHTING
// ════════════════════════════════════════════════════════════════════════════

function drawShadow(bx,by,r,sunX,sunY) {
  const dx=sunX-bx,dy=sunY-by,dist=Math.hypot(dx,dy),nx=dx/dist,ny=dy/dist,blend=r*0.35;
  const g=ctx.createLinearGradient(bx+nx*blend,by+ny*blend,bx-nx*r,by-ny*r);
  g.addColorStop(0,'rgba(0,0,0,0)'); g.addColorStop(0.15,'rgba(0,0,0,0.10)');
  g.addColorStop(0.5,'rgba(0,0,0,0.60)'); g.addColorStop(1,'rgba(0,0,0,0.92)');
  ctx.save(); ctx.beginPath(); ctx.arc(bx,by,r,0,Math.PI*2); ctx.clip();
  ctx.fillStyle=g; ctx.fillRect(bx-r,by-r,r*2,r*2); ctx.restore();
}

function earthEclipseFactor(mx,my,sunX,sunY) {
  const ex=CX-sunX,ey=CY-sunY,al=Math.hypot(ex,ey),axNx=ex/al,axNy=ey/al;
  const emx=mx-CX,emy=my-CY,proj=emx*axNx+emy*axNy;
  if (proj<0) return 0;
  const perp=Math.hypot(emx-proj*axNx,emy-proj*axNy);
  const umbraR=Math.max(0,EARTH_R-proj*(EARTH_R/(al*0.9)));
  if (perp>umbraR+MOON_R) return 0;
  if (perp<umbraR-MOON_R) return 1;
  return 1-Math.min(1,(perp-(umbraR-MOON_R))/(2*MOON_R));
}

// ════════════════════════════════════════════════════════════════════════════
// COLLISION WARNING
// ════════════════════════════════════════════════════════════════════════════

function drawCollisionWarning(col) {
  const {x,y,body}=col, t=(Date.now()/400)%(Math.PI*2), pulse=0.55+0.45*Math.sin(t);
  ctx.save();
  ctx.strokeStyle=`rgba(255,80,80,${(0.3+0.3*Math.sin(t)).toFixed(2)})`; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(x,y,22+6*Math.sin(t),0,Math.PI*2); ctx.stroke();
  ctx.strokeStyle=`rgba(255,80,80,${pulse.toFixed(2)})`; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.arc(x,y,13,0,Math.PI*2); ctx.stroke();
  ctx.strokeStyle=`rgba(255,120,120,${pulse.toFixed(2)})`; ctx.lineWidth=2.5; ctx.lineCap='round';
  const s=7;
  ctx.beginPath(); ctx.moveTo(x-s,y-s); ctx.lineTo(x+s,y+s); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x+s,y-s); ctx.lineTo(x-s,y+s); ctx.stroke();
  const lY=y<CY?y+34:y-22;
  ctx.font='700 18px Inter,ui-sans-serif,sans-serif'; ctx.textAlign='center';
  const label='\u26a0 '+body+' IMPACT', bw=ctx.measureText(label).width+16;
  ctx.fillStyle='rgba(10,5,20,0.82)';
  ctx.beginPath(); ctx.roundRect(x-bw/2,lY-22,bw,26,6); ctx.fill();
  ctx.fillStyle=`rgba(255,120,120,${pulse.toFixed(2)})`; ctx.fillText(label,x,lY);
  ctx.textAlign='left'; ctx.restore();
}


// ════════════════════════════════════════════════════════════════════════════
// ROCKET DRAW
// ════════════════════════════════════════════════════════════════════════════

function drawRocket(x,y,angle,thrusting) {
  ctx.save(); ctx.translate(x,y); ctx.rotate(angle);
  if (thrusting) {
    ctx.fillStyle='rgba(251,146,60,'+(0.7+Math.random()*0.3)+')';
    ctx.beginPath(); ctx.moveTo(-5,0); ctx.lineTo(-15-Math.random()*8,-3.5); ctx.lineTo(-15-Math.random()*8,3.5); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle='#f1f5f9';
  ctx.beginPath(); ctx.moveTo(10,0); ctx.lineTo(-6,-5); ctx.lineTo(-4,0); ctx.lineTo(-6,5); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
// RENDER – TITLE
// ════════════════════════════════════════════════════════════════════════════

function renderTitle() {
  ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha=1; ctx.setLineDash([]);
  const bg=ctx.createRadialGradient(CX,CY,100,CX,CY,H);
  bg.addColorStop(0,'#080e22'); bg.addColorStop(1,'#020610');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  for (const s of STARS) { ctx.globalAlpha=s.a; ctx.fillStyle='#dbeafe'; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill(); }
  ctx.globalAlpha=1;

  ctx.textAlign='center';
  ctx.font='800 160px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle='rgba(200,216,255,0.08)'; ctx.fillText('MOONSHOT',CX,CY-120);

  ctx.font='800 110px Inter,ui-sans-serif,sans-serif';
  const tg=ctx.createLinearGradient(CX-400,0,CX+400,0);
  tg.addColorStop(0,'#60a5fa'); tg.addColorStop(0.5,'#c8d8f8'); tg.addColorStop(1,'#818cf8');
  ctx.fillStyle=tg; ctx.fillText('MOONSHOT',CX,CY-120);

  ctx.font='400 38px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle='rgba(148,175,220,0.7)'; ctx.fillText('Choose your mission',CX,CY-50);

  const cardW=560,cardH=230,gap=60,totalW=cardW*2+gap,cardY=CY+20;
  const card1X=CX-totalW/2, card2X=CX-totalW/2+cardW+gap;

  function drawCard(key,x,y,w,h,icon,num,title2,sub,locked=false) {
    registerBtn(key,x,y,w,h);
    ctx.save();
    ctx.fillStyle=locked?'rgba(8,12,28,0.88)':'rgba(12,18,40,0.88)';
    ctx.strokeStyle=locked?'rgba(60,80,130,0.3)':'rgba(120,160,255,0.35)'; ctx.lineWidth=1.5;
    rrect(x,y,w,h,18); ctx.fill(); ctx.stroke();
    if (!locked) {
      const glow=ctx.createLinearGradient(x,y,x,y+h);
      glow.addColorStop(0,'rgba(100,140,255,0.08)'); glow.addColorStop(1,'rgba(100,140,255,0)');
      ctx.fillStyle=glow; rrect(x,y,w,h,18); ctx.fill();
    }
    ctx.font='80px sans-serif'; ctx.fillStyle=locked?'rgba(150,160,200,0.3)':'rgba(255,255,255,0.9)'; ctx.textAlign='left'; ctx.fillText(icon,x+30,y+90);
    ctx.font='600 22px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=locked?'rgba(80,100,160,0.4)':'rgba(100,160,255,0.7)'; ctx.textAlign='right'; ctx.fillText('MISSION '+num,x+w-24,y+36);
    ctx.font='800 44px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=locked?'rgba(120,130,170,0.35)':'#c8d8f8'; ctx.textAlign='left'; ctx.fillText(title2,x+30,y+132);
    ctx.font='400 26px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=locked?'rgba(120,130,170,0.4)':'rgba(148,175,220,0.7)'; ctx.fillText(sub,x+30,y+170);
    ctx.restore();
  }

  const cardW3=cardW, card3X=card2X+cardW+gap;
  // Widen layout to 3 cards — shift all left
  const shift=(cardW+gap);
  drawCard('mission1',card1X-shift/2,cardY,cardW,cardH,'\uD83C\uDF0D','01','LUNAR ORBIT','Achieve stable orbit around the Moon',false);
  drawCard('mission2',(card2X-shift/2),cardY,cardW,cardH,progress.mission1Beaten?'\uD83C\uDF15':'\uD83D\uDD12','02','LUNAR LANDING',progress.mission1Beaten?'Land softly on the Moon\'s surface':'Complete Lunar Orbit first',!progress.mission1Beaten);
  drawCard('mission3',(card3X-shift/2),cardY,cardW3,cardH,progress.mission2Beaten?'\uD83D\uDE80':'\uD83D\uDD12','03','LUNAR ASCENT',progress.mission2Beaten?'Launch and establish Moon orbit':'Complete Lunar Landing first',!progress.mission2Beaten);

  ctx.textAlign='center';
  ctx.font='400 24px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle='rgba(100,130,180,0.5)';
  ctx.fillText('A/D \u00b7 Rotate   \u2003W/Space \u00b7 Thrust   \u2003E \u00b7 Prograde   \u2003Q \u00b7 Retrograde   \u20031\u20134 \u00b7 Warp   \u2003R \u00b7 Restart',CX,cardY+cardH+55);
  ctx.textAlign='left';
}


// ════════════════════════════════════════════════════════════════════════════
// RENDER – ORBIT
// ════════════════════════════════════════════════════════════════════════════

function render() {
  ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.setLineDash([]);
  ctx.fillStyle='#040814'; ctx.fillRect(0,0,W,H);

  const moon=moonXY(state.moonAngle);

  // Stars with parallax
  { const ps=0.18, scx=(moon.x-CX)*camera.blend, scy=(moon.y-CY)*camera.blend;
    const ox=(rocket.x-CX)*ps-scx*0.05, oy=(rocket.y-CY)*ps-scy*0.05;
    for (const s of STARS) { const sx=((s.x-ox*s.depth)%W+W)%W, sy=((s.y-oy*s.depth)%H+H)%H; ctx.globalAlpha=s.a; ctx.fillStyle='#dbeafe'; ctx.beginPath(); ctx.arc(sx,sy,s.r,0,Math.PI*2); ctx.fill(); }
    ctx.globalAlpha=1; }

  const camX=(moon.x-CX)*camera.blend, camY=(moon.y-CY)*camera.blend;
  ctx.save(); ctx.translate(CX,CY); ctx.scale(camera.zoom,camera.zoom); ctx.translate(-(CX+camX),-(CY+camY));

  // Orbit guides
  ctx.save(); ctx.lineWidth=1; ctx.setLineDash([]);
  ctx.strokeStyle='rgba(100,130,255,0.18)'; ctx.beginPath(); ctx.arc(CX,CY,MOON_ORBIT,0,Math.PI*2); ctx.stroke();
  ctx.strokeStyle='rgba(100,210,255,0.14)'; ctx.beginPath(); ctx.arc(CX,CY,90,0,Math.PI*2); ctx.stroke();
  const dM=Math.hypot(rocket.x-moon.x,rocket.y-moon.y), inWZ=dM<STABLE_OUTER;
  ctx.strokeStyle=inWZ?'rgba(134,239,172,0.90)':'rgba(134,239,172,0.22)'; ctx.lineWidth=inWZ?2.5:1.0; ctx.setLineDash([5,8]);
  ctx.beginPath(); ctx.arc(moon.x,moon.y,STABLE_OUTER,0,Math.PI*2); ctx.stroke();
  ctx.setLineDash([]); ctx.restore();

  strokePath(state.trail,'rgba(125,211,252,0.5)',1.5,[]);

  if (state.outcome==='playing') {
    const pred=predictPath(), pts=pred.pts;
    const sc=collisionFilter.update(pred.collision), dispPts=pts.slice(0,pathLengthFilter.update(pts.length));
    if (sc) { const sp=Math.max(0,dispPts.length-20); strokePath(dispPts.slice(0,sp),'rgba(251,211,77,0.55)',1.3,[6,6]); strokePath(dispPts.slice(sp),'rgba(255,80,80,0.75)',2.0,[]); drawCollisionWarning(sc); }
    else strokePath(dispPts,'rgba(251,211,77,0.55)',1.3,[6,6]);
  }

  // Earth shadow cone
  { const dx=CX-SUN_X,dy=CY-SUN_Y,dist=Math.hypot(dx,dy),nx=dx/dist,ny=dy/dist;
    const coneLen=600,r0=EARTH_R,r1=EARTH_R*0.96,px=-ny,py=nx,tip={x:CX+nx*coneLen,y:CY+ny*coneLen};
    ctx.save(); const cg=ctx.createLinearGradient(CX,CY,tip.x,tip.y);
    cg.addColorStop(0,'rgba(0,0,20,0.38)'); cg.addColorStop(0.35,'rgba(0,0,20,0.18)'); cg.addColorStop(0.7,'rgba(0,0,20,0.07)'); cg.addColorStop(1,'rgba(0,0,20,0)');
    ctx.beginPath(); ctx.moveTo(CX+px*r0,CY+py*r0); ctx.lineTo(tip.x+px*r1,tip.y+py*r1); ctx.lineTo(tip.x-px*r1,tip.y-py*r1); ctx.lineTo(CX-px*r0,CY-py*r0); ctx.closePath(); ctx.fillStyle=cg; ctx.fill(); ctx.restore(); }

  // Earth
  { const atm=ctx.createRadialGradient(CX,CY,EARTH_R*0.7,CX,CY,EARTH_R*2.6);
    atm.addColorStop(0,'rgba(96,165,250,0.22)'); atm.addColorStop(0.55,'rgba(59,130,246,0.18)'); atm.addColorStop(1,'rgba(59,130,246,0)');
    ctx.fillStyle=atm; ctx.beginPath(); ctx.arc(CX,CY,EARTH_R*2.6,0,Math.PI*2); ctx.fill();
    const eg=ctx.createRadialGradient(CX-10,CY-12,4,CX,CY,EARTH_R+4);
    eg.addColorStop(0,'#93c5fd'); eg.addColorStop(0.45,'#3b82f6'); eg.addColorStop(0.8,'#1d4ed8'); eg.addColorStop(1,'#172554');
    ctx.fillStyle=eg; ctx.beginPath(); ctx.arc(CX,CY,EARTH_R,0,Math.PI*2); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(CX,CY,EARTH_R,0,Math.PI*2); ctx.clip(); ctx.translate(CX,CY); ctx.rotate(state.earthAngle); ctx.translate(-CX,-CY);
    ctx.fillStyle='#4ade80'; ctx.beginPath(); ctx.ellipse(CX-9,CY-6,11,7,0.45,0,Math.PI*2); ctx.ellipse(CX-2,CY+4,7,5,0.15,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#22c55e'; ctx.beginPath(); ctx.ellipse(CX+9,CY+7,8,5,-0.35,0,Math.PI*2); ctx.ellipse(CX+4,CY-10,5,3,0.1,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.42)'; ctx.beginPath(); ctx.ellipse(CX-6,CY-11,9,2.6,0.2,0,Math.PI*2); ctx.ellipse(CX+10,CY-2,7,2.2,-0.25,0,Math.PI*2); ctx.ellipse(CX-2,CY+12,8,2.4,0.1,0,Math.PI*2); ctx.fill(); ctx.restore();
    drawShadow(CX,CY,EARTH_R,SUN_X,SUN_Y);
    ctx.strokeStyle='rgba(191,219,254,0.45)'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.arc(CX,CY,EARTH_R+1,0,Math.PI*2); ctx.stroke(); }

  // Moon
  { const mg=ctx.createRadialGradient(moon.x,moon.y,3,moon.x,moon.y,26);
    mg.addColorStop(0,'rgba(220,220,220,0.5)'); mg.addColorStop(1,'rgba(220,220,220,0)');
    ctx.fillStyle=mg; ctx.beginPath(); ctx.arc(moon.x,moon.y,26,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#9ca3af'; ctx.beginPath(); ctx.arc(moon.x,moon.y,MOON_R,0,Math.PI*2); ctx.fill();
    ctx.save(); ctx.translate(moon.x,moon.y); ctx.rotate(state.moonAngle+Math.PI/2);
    ctx.fillStyle='#6b7280'; ctx.beginPath(); ctx.arc(-3,-2,3,0,Math.PI*2); ctx.fill(); ctx.beginPath(); ctx.arc(4,3,2,0,Math.PI*2); ctx.fill(); ctx.restore();
    drawShadow(moon.x,moon.y,MOON_R,SUN_X,SUN_Y);
    const eclF=earthEclipseFactor(moon.x,moon.y,SUN_X,SUN_Y);
    if (eclF>0) { ctx.save(); ctx.beginPath(); ctx.arc(moon.x,moon.y,MOON_R,0,Math.PI*2); ctx.clip(); ctx.fillStyle=`rgba(0,0,0,${(eclF*0.88).toFixed(2)})`; ctx.fillRect(moon.x-MOON_R,moon.y-MOON_R,MOON_R*2,MOON_R*2); ctx.restore(); } }

  drawRocket(rocket.x,rocket.y,rocket.angle, state.outcome==='playing'&&rocket.fuel>0&&(keys.has('ArrowUp')||keys.has('KeyW')||keys.has('Space')));
  ctx.restore();
  drawOrbitHUD(moon);
}


// ════════════════════════════════════════════════════════════════════════════
// RENDER – LANDING
// ════════════════════════════════════════════════════════════════════════════

function renderLanding() {
  ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.setLineDash([]);
  ctx.fillStyle='#020610'; ctx.fillRect(0,0,W,H);

  for (const s of STARS) { ctx.globalAlpha=s.a*0.7; ctx.fillStyle='#dbeafe'; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill(); }
  ctx.globalAlpha=1;

  // Moon body
  { const mg=ctx.createRadialGradient(CX,CY,LAND_MOON_R*0.9,CX,CY,LAND_MOON_R*1.25);
    mg.addColorStop(0,'rgba(180,180,160,0.18)'); mg.addColorStop(1,'rgba(180,180,160,0)');
    ctx.fillStyle=mg; ctx.beginPath(); ctx.arc(CX,CY,LAND_MOON_R*1.25,0,Math.PI*2); ctx.fill();
    const ms=ctx.createRadialGradient(CX-LAND_MOON_R*0.3,CY-LAND_MOON_R*0.3,LAND_MOON_R*0.1,CX,CY,LAND_MOON_R);
    ms.addColorStop(0,'#c4c6cc'); ms.addColorStop(0.5,'#9ca3af'); ms.addColorStop(1,'#6b7280');
    ctx.fillStyle=ms; ctx.beginPath(); ctx.arc(CX,CY,LAND_MOON_R,0,Math.PI*2); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(CX,CY,LAND_MOON_R,0,Math.PI*2); ctx.clip();
    for (const c of LAND_CRATERS) {
      const cx2=CX+c.ax*LAND_MOON_R, cy2=CY+c.ay*LAND_MOON_R;
      ctx.fillStyle=`rgba(80,84,92,${c.depth*0.7})`; ctx.beginPath(); ctx.arc(cx2,cy2,c.r,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=`rgba(200,205,215,${c.depth*0.4})`; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(cx2-c.r*0.15,cy2-c.r*0.15,c.r,Math.PI*1.0,Math.PI*1.8); ctx.stroke();
    }
    ctx.restore();
    drawShadow(CX,CY,LAND_MOON_R,-1200,CY);
    ctx.strokeStyle='rgba(220,224,230,0.35)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(CX,CY,LAND_MOON_R+1,0,Math.PI*2); ctx.stroke(); }

  // Landing pad
  { const padA0=PAD_ANGLE-PAD_HALF, padA1=PAD_ANGLE+PAD_HALF;
    const t=(Date.now()/500)%(Math.PI*2), pulse=0.7+0.3*Math.sin(t);
    ctx.strokeStyle=`rgba(251,191,36,${(0.15*pulse).toFixed(2)})`; ctx.lineWidth=22; ctx.lineCap='round';
    ctx.beginPath(); ctx.arc(CX,CY,LAND_MOON_R,padA0,padA1); ctx.stroke();
    ctx.strokeStyle=`rgba(251,191,36,${(0.85*pulse).toFixed(2)})`; ctx.lineWidth=8;
    ctx.beginPath(); ctx.arc(CX,CY,LAND_MOON_R,padA0,padA1); ctx.stroke();
    ctx.lineWidth=3;
    for (let i=0;i<=4;i++) {
      const a=padA0+(padA1-padA0)*(i/4);
      ctx.strokeStyle=`rgba(251,191,36,${(0.6*pulse).toFixed(2)})`;
      ctx.beginPath(); ctx.moveTo(CX+Math.cos(a)*(LAND_MOON_R-12),CY+Math.sin(a)*(LAND_MOON_R-12)); ctx.lineTo(CX+Math.cos(a)*(LAND_MOON_R+8),CY+Math.sin(a)*(LAND_MOON_R+8)); ctx.stroke();
    }
    // LZ label — upright, just outside pad center
    const lzDist=LAND_MOON_R+48;
    const lzX=CX+Math.cos(PAD_ANGLE)*lzDist, lzY=CY+Math.sin(PAD_ANGLE)*lzDist;
    ctx.save();
    ctx.font=`700 30px Inter,ui-sans-serif,sans-serif`;
    ctx.fillStyle=`rgba(251,191,36,${(0.85*pulse).toFixed(2)})`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText('LZ',lzX,lzY);
    ctx.textAlign='left'; ctx.textBaseline='alphabetic'; ctx.restore();
    ctx.setLineDash([]); ctx.lineCap='butt'; }

  // Prediction
  if (lState.outcome==='playing') {
    const pred=predictLandingPath(), pts=pred.pts;
    const sc=collisionFilter.update(pred.collision), dispPts=pts.slice(0,pathLengthFilter.update(pts.length));
    if (sc) { const sp=Math.max(0,dispPts.length-20); strokePath(dispPts.slice(0,sp),'rgba(251,211,77,0.45)',1.3,[6,6]); strokePath(dispPts.slice(sp),'rgba(255,80,80,0.75)',2.0,[]); drawCollisionWarning(sc); }
    else strokePath(dispPts,'rgba(251,211,77,0.45)',1.3,[6,6]);
  }

  strokePath(lState.trail,'rgba(125,211,252,0.4)',1.5,[]);
  const thrusting=(keys.has('ArrowUp')||keys.has('KeyW')||keys.has('Space'))&&lRocket.fuel>0&&lState.outcome==='playing';
  drawRocket(lRocket.x,lRocket.y,lRocket.angle,thrusting);
  drawLandingHUD();
}


// ════════════════════════════════════════════════════════════════════════════
// HUD – ORBIT
// ════════════════════════════════════════════════════════════════════════════

function drawOrbitHUD(moon) {
  const speed=Math.hypot(rocket.vx,rocket.vy);
  const dE=Math.hypot(rocket.x-CX,rocket.y-CY);
  const dM=Math.hypot(rocket.x-moon.x,rocket.y-moon.y);
  const warp=WARP_LEVELS[state.warpIdx];
  const fuelPct=Math.max(0,Math.min(1,rocket.fuel/100));
  drawStatusBar(state.outcome==='playing'?state.message:'');
  drawFuelBar(fuelPct,rocket.fuel);
  drawSpeedGauge(speed);
  drawTelemetryPills(dE,dM,warp);
  drawCountdownOverlay();
  drawOrbitOutcomeBanner();
}

function drawStatusBar(label) {
  if (!label) return;
  ctx.save(); ctx.font='700 22px Inter,ui-sans-serif,sans-serif'; ctx.textAlign='center';
  const bw=ctx.measureText(label).width+48, bh=40, bx=W/2-bw/2, by=28;
  ctx.fillStyle='rgba(6,10,24,0.78)'; ctx.strokeStyle='rgba(150,180,255,0.20)'; ctx.lineWidth=1;
  rrect(bx,by,bw,bh,10); ctx.fill(); ctx.stroke();
  ctx.fillStyle='#c8d8f8'; ctx.fillText(label,W/2,by+26); ctx.textAlign='left'; ctx.restore();
}

function drawFuelBar(pct,fuelVal) {
  const fc=pct>0.3?'#38bdf8':pct>0.12?'#fbbf24':'#f87171';
  const bw=500,bh=8,bx=W/2-250,by=H-60;
  ctx.save();
  ctx.fillStyle='rgba(255,255,255,0.08)'; rrect(bx,by,bw,bh,4); ctx.fill();
  ctx.fillStyle=fc; rrect(bx,by,bw*pct,bh,4); ctx.fill();
  ctx.font='700 13px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle='#6b82a8'; ctx.textAlign='left'; ctx.fillText('FUEL',bx,by-6);
  ctx.textAlign='right'; ctx.fillStyle=fc; ctx.fillText(fuelVal.toFixed(0)+'%',bx+bw,by-6);
  ctx.textAlign='left'; ctx.restore();
}

function drawSpeedGauge(speed, MAX_SPD=1000) {
  const gx=120,gy=H-118,gr=82;
  const startA=Math.PI*0.75,endA=Math.PI*2.25,pct=Math.min(speed/MAX_SPD,1);
  const fillEnd=startA+(endA-startA)*pct;
  const sc=speed<MAX_SPD*0.4?'#38bdf8':speed<MAX_SPD*0.7?'#fbbf24':'#f87171';
  ctx.save();
  ctx.beginPath(); ctx.arc(gx,gy,gr+2,startA,endA); ctx.strokeStyle='rgba(100,140,255,0.08)'; ctx.lineWidth=18; ctx.stroke();
  ctx.beginPath(); ctx.arc(gx,gy,gr,startA,endA); ctx.strokeStyle='rgba(255,255,255,0.07)'; ctx.lineWidth=12; ctx.lineCap='butt'; ctx.stroke();
  const tickStep=MAX_SPD<=100?10:100, majorEvery=MAX_SPD<=100?50:500;
  for (let v=0;v<=MAX_SPD;v+=tickStep) {
    const a=startA+(endA-startA)*(v/MAX_SPD), inner=v%majorEvery===0?gr-18:gr-12;
    ctx.beginPath(); ctx.moveTo(gx+Math.cos(a)*inner,gy+Math.sin(a)*inner); ctx.lineTo(gx+Math.cos(a)*(gr+2),gy+Math.sin(a)*(gr+2));
    ctx.strokeStyle=v%majorEvery===0?'rgba(180,200,255,0.5)':'rgba(180,200,255,0.2)'; ctx.lineWidth=v%majorEvery===0?2:1; ctx.stroke();
  }
  if (pct>0) { ctx.beginPath(); ctx.arc(gx,gy,gr,startA,fillEnd); ctx.strokeStyle=sc; ctx.lineWidth=12; ctx.lineCap='round'; ctx.stroke(); }
  ctx.beginPath(); ctx.arc(gx+Math.cos(fillEnd)*gr,gy+Math.sin(fillEnd)*gr,7,0,Math.PI*2); ctx.fillStyle=sc; ctx.fill();
  ctx.textAlign='center';
  ctx.font='800 28px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=sc; ctx.fillText(speed.toFixed(0),gx,gy+10);
  ctx.font='600 12px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle='#4a6080'; ctx.fillText('u/s',gx,gy+28);
  ctx.font='600 11px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle='rgba(180,200,255,0.3)';
  ctx.fillText(MAX_SPD,gx+Math.cos(endA)*(gr+16),gy+Math.sin(endA)*(gr+16)+4);
  ctx.fillText('0',gx+Math.cos(startA)*(gr+16),gy+Math.sin(startA)*(gr+16)+4);
  ctx.textAlign='left'; ctx.restore();
}

function drawTelemetryPills(dE,dM,warp) {
  const items=[{label:'EARTH',value:dE.toFixed(0)+' u'},{label:'MOON',value:dM.toFixed(0)+' u'},{label:'WARP',value:warp+'\u00d7'}];
  const pw=130,ph=44,gap=10,sx=230,sy=H-80;
  ctx.save();
  items.forEach((item,i) => {
    const x=sx+i*(pw+gap),y=sy;
    ctx.fillStyle='rgba(6,10,24,0.82)'; ctx.strokeStyle='rgba(100,140,255,0.15)'; ctx.lineWidth=1;
    rrect(x,y,pw,ph,8); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#4a6080'; ctx.font='600 11px Inter,ui-sans-serif,sans-serif'; ctx.fillText(item.label,x+10,y+14);
    ctx.fillStyle='#ccddf8'; ctx.font='700 16px Inter,ui-sans-serif,sans-serif'; ctx.fillText(item.value,x+10,y+33);
  });
  ctx.restore();
}

function drawCountdownOverlay() {
  if (state.outcome!=='playing'||state.stableTimer<=0) return;
  const rem=Math.max(0,STABLE_HOLD-state.stableTimer), prog=state.stableTimer/STABLE_HOLD;
  const cx2=W-130,cy2=H-130,radius=90,pulse=0.85+0.15*Math.sin(Date.now()/300);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx2,cy2,radius,-Math.PI/2,-Math.PI/2+Math.PI*2,false);
  ctx.strokeStyle='rgba(134,239,172,0.12)'; ctx.lineWidth=14; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx2,cy2,radius,-Math.PI/2,-Math.PI/2+Math.PI*2*prog,false);
  ctx.strokeStyle=`rgba(134,239,172,${(0.7*pulse).toFixed(2)})`; ctx.lineWidth=14; ctx.lineCap='round'; ctx.stroke();
  ctx.textAlign='center';
  ctx.font='800 72px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle=`rgba(134,239,172,${pulse.toFixed(2)})`; ctx.fillText(rem>0?Math.ceil(rem):'\u2713',cx2,cy2+24);
  ctx.font='700 18px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle='rgba(134,239,172,0.6)'; ctx.fillText('HOLD ORBIT',cx2,cy2+60);
  ctx.textAlign='left'; ctx.restore();
}

function drawOrbitOutcomeBanner() {
  // Win case: seamless transition fires automatically, no banner needed
  if (state.outcome==='playing'||state.outcome==='win') return;
  const okCol='#fca5a5';
  const bw=500, bh=170, bx=W/2-bw/2, by=H/2-bh/2;
  ctx.save();
  ctx.fillStyle='rgba(6,10,24,0.95)'; ctx.strokeStyle='rgba(252,165,165,0.55)'; ctx.lineWidth=1.5;
  rrect(bx,by,bw,bh,18); ctx.fill(); ctx.stroke();
  ctx.textAlign='center';
  ctx.font='800 28px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=okCol; ctx.fillText('\uD83D\uDCA5  MISSION FAILED',W/2,by+50);
  ctx.font='700 20px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle='rgba(252,165,165,0.8)'; ctx.fillText(state.message,W/2,by+86);
  ctx.font='500 17px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle='rgba(180,140,140,0.6)'; ctx.fillText('Press R to retry',W/2,by+116);
  drawCanvasBtn('backToTitle','\u2190 Menu',W/2-76,by+bh-58,152,44,{fill:'rgba(10,15,30,0.9)',stroke:'rgba(100,130,200,0.4)',color:'#8899cc',fs:'600 20px Inter,ui-sans-serif,sans-serif'});
  ctx.textAlign='left'; ctx.restore();
}


// ════════════════════════════════════════════════════════════════════════════
// HUD – LANDING
// ════════════════════════════════════════════════════════════════════════════

function drawLandingHUD() {
  const speed=Math.hypot(lRocket.vx,lRocket.vy);
  const distToMoon=Math.hypot(lRocket.x-CX,lRocket.y-CY);
  const alt=Math.max(0,distToMoon-LAND_MOON_R);
  const fuelPct=Math.max(0,Math.min(1,lRocket.fuel/100));
  const warp=WARP_LEVELS[lState.warpIdx];

  // Status bar
  if (lState.outcome==='playing') drawStatusBar(lState.message);

  // Fuel bar
  drawFuelBar(fuelPct,lRocket.fuel);

  // Speed gauge scaled to landing speeds
  drawSpeedGauge(speed, 100);

  // Vertical speed: radial component toward Moon surface (positive = descending)
  const surfNx=(lRocket.x-CX)/Math.max(distToMoon,1);
  const surfNy=(lRocket.y-CY)/Math.max(distToMoon,1);
  const descentRate=-(lRocket.vx*surfNx+lRocket.vy*surfNy);

  // Landing-specific telemetry pills (speed pill removed — gauge covers it)
  { const altColor=alt<80?'#f87171':alt<200?'#fbbf24':'#38bdf8';
    const vsColor=descentRate>80?'#f87171':descentRate>20?'#fbbf24':'#4ade80';
    const items=[
      {label:'ALT',value:alt.toFixed(0)+' u',color:altColor},
      {label:'V-SPEED',value:(descentRate>=0?'\u25bc ':' \u25b2 ')+Math.abs(descentRate).toFixed(0),color:vsColor},
      {label:'WARP',value:warp+'\u00d7',color:'#ccddf8'},
    ];
    const pw=130,ph=44,gap=10,sx=230,sy=H-80;
    ctx.save();
    items.forEach((item,i) => {
      const x=sx+i*(pw+gap),y=sy;
      ctx.fillStyle='rgba(6,10,24,0.82)'; ctx.strokeStyle='rgba(100,140,255,0.15)'; ctx.lineWidth=1;
      rrect(x,y,pw,ph,8); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#4a6080'; ctx.font='600 11px Inter,ui-sans-serif,sans-serif'; ctx.fillText(item.label,x+10,y+14);
      ctx.fillStyle=item.color||'#ccddf8'; ctx.font='700 16px Inter,ui-sans-serif,sans-serif'; ctx.fillText(item.value,x+10,y+33);
    });
    ctx.restore(); }

  drawLandingOutcomeBanner();
}

function drawLandingOutcomeBanner() {
  if (lState.outcome==='playing') return;
  if (lState.outcome==='win') return; // seamless transition handles win
  const isWin=lState.outcome==='win';
  const okCol=isWin?'#86efac':'#fca5a5';
  const bw=500, bh=isWin?160:180, bx=W/2-bw/2, by=H/2-bh/2;
  ctx.save();
  ctx.fillStyle='rgba(6,10,24,0.95)'; ctx.strokeStyle=isWin?'rgba(134,239,172,0.6)':'rgba(252,165,165,0.55)'; ctx.lineWidth=1.5;
  rrect(bx,by,bw,bh,18); ctx.fill(); ctx.stroke();
  ctx.textAlign='center';
  if (isWin) {
    ctx.font='800 34px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=okCol; ctx.fillText('\uD83C\uDF15  TOUCHDOWN!',W/2,by+52);
    ctx.font='600 22px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle='rgba(134,239,172,0.8)'; ctx.fillText('MISSION COMPLETE',W/2,by+88);
  } else {
    ctx.font='800 28px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=okCol; ctx.fillText('\uD83D\uDCA5  MISSION FAILED',W/2,by+50);
    ctx.font='700 20px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle='rgba(252,165,165,0.8)'; ctx.fillText(lState.message,W/2,by+86);
    ctx.font='500 17px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle='rgba(180,140,140,0.6)'; ctx.fillText('Aim for the landing zone below ' + LAND_SPEED_MAX + ' u/s',W/2,by+116);
  }
  const btnY = by+bh-58;
  drawCanvasBtn('retryLanding','\u21ba Retry',W/2-166,btnY,152,44,{fill:'rgba(20,30,60,0.95)',stroke:'rgba(150,200,255,0.4)',color:'#c8d8f8',fs:'700 21px Inter,ui-sans-serif,sans-serif'});
  drawCanvasBtn('backToTitle','\u2190 Menu',W/2+14,btnY,152,44,{fill:'rgba(10,15,30,0.9)',stroke:'rgba(100,130,200,0.4)',color:'#8899cc',fs:'600 21px Inter,ui-sans-serif,sans-serif'});
  ctx.textAlign='left'; ctx.restore();
}


// ════════════════════════════════════════════════════════════════════════════
// MAIN LOOP
// ════════════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════════════
// RENDER + HUD – M3
// ════════════════════════════════════════════════════════════════════════════

function renderM3() {
  ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.setLineDash([]);
  ctx.fillStyle='#020610'; ctx.fillRect(0,0,W,H);
  for (const s of STARS) { ctx.globalAlpha=s.a*0.7; ctx.fillStyle='#dbeafe'; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill(); }
  ctx.globalAlpha=1;

  // Moon
  { const mg=ctx.createRadialGradient(CX,CY,LAND_MOON_R*0.9,CX,CY,LAND_MOON_R*1.25);
    mg.addColorStop(0,'rgba(180,180,160,0.18)'); mg.addColorStop(1,'rgba(180,180,160,0)');
    ctx.fillStyle=mg; ctx.beginPath(); ctx.arc(CX,CY,LAND_MOON_R*1.25,0,Math.PI*2); ctx.fill();
    const ms=ctx.createRadialGradient(CX-LAND_MOON_R*0.3,CY-LAND_MOON_R*0.3,LAND_MOON_R*0.1,CX,CY,LAND_MOON_R);
    ms.addColorStop(0,'#c4c6cc'); ms.addColorStop(0.5,'#9ca3af'); ms.addColorStop(1,'#6b7280');
    ctx.fillStyle=ms; ctx.beginPath(); ctx.arc(CX,CY,LAND_MOON_R,0,Math.PI*2); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(CX,CY,LAND_MOON_R,0,Math.PI*2); ctx.clip();
    for (const c of LAND_CRATERS) {
      const cx2=CX+c.ax*LAND_MOON_R, cy2=CY+c.ay*LAND_MOON_R;
      ctx.fillStyle=`rgba(80,84,92,${c.depth*0.7})`; ctx.beginPath(); ctx.arc(cx2,cy2,c.r,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=`rgba(200,205,215,${c.depth*0.4})`; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(cx2-c.r*0.15,cy2-c.r*0.15,c.r,Math.PI,Math.PI*1.8); ctx.stroke();
    }
    ctx.restore();
    drawShadow(CX,CY,LAND_MOON_R,-1200,CY);
    ctx.strokeStyle='rgba(220,224,230,0.35)'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(CX,CY,LAND_MOON_R+1,0,Math.PI*2); ctx.stroke(); }

  // Launch pad marker (dim reminder)
  { const t=(Date.now()/600)%(Math.PI*2), pulse=0.4+0.2*Math.sin(t);
    ctx.strokeStyle=`rgba(251,191,36,${pulse.toFixed(2)})`; ctx.lineWidth=4; ctx.lineCap='round';
    ctx.beginPath(); ctx.arc(CX,CY,LAND_MOON_R,PAD_ANGLE-PAD_HALF,PAD_ANGLE+PAD_HALF); ctx.stroke();
    ctx.lineCap='butt'; }

  // Target orbit band
  { const dist=Math.hypot(m3Rocket.x-CX,m3Rocket.y-CY);
    const inBand=dist>=M3_ORBIT_MIN&&dist<=M3_ORBIT_MAX;
    const t=(Date.now()/800)%(Math.PI*2), pulse=0.5+0.3*Math.sin(t);
    ctx.save(); ctx.setLineDash([8,12]);
    const ba=inBand?(0.75+0.2*pulse).toFixed(2):(0.2+0.08*pulse).toFixed(2);
    ctx.strokeStyle=`rgba(134,239,172,${ba})`; ctx.lineWidth=inBand?2.5:1.5;
    ctx.beginPath(); ctx.arc(CX,CY,M3_ORBIT_MIN,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(CX,CY,M3_ORBIT_MAX,0,Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(CX,CY,M3_ORBIT_MAX,0,Math.PI*2,false); ctx.arc(CX,CY,M3_ORBIT_MIN,0,Math.PI*2,true);
    ctx.fillStyle=inBand?'rgba(134,239,172,0.07)':'rgba(134,239,172,0.02)'; ctx.fill();
    ctx.restore(); }

  // Prediction + trail + rocket
  if (m3State.outcome==='playing') {
    const pred=predictM3Path(), pts=pred.pts;
    const sc=collisionFilter.update(pred.collision), dispPts=pts.slice(0,pathLengthFilter.update(pts.length));
    if (sc) { const sp=Math.max(0,dispPts.length-20); strokePath(dispPts.slice(0,sp),'rgba(251,211,77,0.45)',1.3,[6,6]); strokePath(dispPts.slice(sp),'rgba(255,80,80,0.75)',2.0,[]); drawCollisionWarning(sc); }
    else strokePath(dispPts,'rgba(251,211,77,0.45)',1.3,[6,6]);
  }
  strokePath(m3State.trail,'rgba(125,211,252,0.4)',1.5,[]);
  const thr=(keys.has('ArrowUp')||keys.has('KeyW')||keys.has('Space'))&&m3Rocket.fuel>0&&m3State.outcome==='playing';
  drawRocket(m3Rocket.x,m3Rocket.y,m3Rocket.angle,thr);
  drawM3HUD();
}

function drawM3HUD() {
  const speed=Math.hypot(m3Rocket.vx,m3Rocket.vy);
  const dist=Math.hypot(m3Rocket.x-CX,m3Rocket.y-CY);
  const alt=Math.max(0,dist-LAND_MOON_R);
  const fuelPct=Math.max(0,Math.min(1,m3Rocket.fuel/100));
  const warp=WARP_LEVELS[m3State.warpIdx];
  const inBand=dist>=M3_ORBIT_MIN&&dist<=M3_ORBIT_MAX;

  if (m3State.outcome==='playing') drawStatusBar(m3State.message);
  drawFuelBar(fuelPct,m3Rocket.fuel);
  drawSpeedGauge(speed,400);

  // Hold countdown ring
  if (m3State.outcome==='playing'&&m3State.stableTimer>0) {
    const rem=Math.max(0,M3_HOLD-m3State.stableTimer), prog=m3State.stableTimer/M3_HOLD;
    const cx2=W-130,cy2=H-130,radius=90,pulse=0.85+0.15*Math.sin(Date.now()/300);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx2,cy2,radius,-Math.PI/2,-Math.PI/2+Math.PI*2); ctx.strokeStyle='rgba(134,239,172,0.12)'; ctx.lineWidth=14; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx2,cy2,radius,-Math.PI/2,-Math.PI/2+Math.PI*2*prog); ctx.strokeStyle=`rgba(134,239,172,${(0.7*pulse).toFixed(2)})`; ctx.lineWidth=14; ctx.lineCap='round'; ctx.stroke();
    ctx.textAlign='center';
    ctx.font='800 72px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=`rgba(134,239,172,${pulse.toFixed(2)})`; ctx.fillText(rem>0?Math.ceil(rem):'\u2713',cx2,cy2+24);
    ctx.font='700 18px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle='rgba(134,239,172,0.6)'; ctx.fillText('HOLD ORBIT',cx2,cy2+60);
    ctx.textAlign='left'; ctx.restore();
  }

  // Pills
  { const altC=alt<80?'#f87171':alt<200?'#fbbf24':'#38bdf8';
    const distC=inBand?'#4ade80':(dist<M3_ORBIT_MIN?'#f87171':'#fbbf24');
    const items=[{label:'ALT',value:alt.toFixed(0)+' u',color:altC},{label:'ORBIT R',value:dist.toFixed(0)+' u',color:distC},{label:'WARP',value:warp+'\u00d7',color:'#ccddf8'}];
    const pw=130,ph=44,gap=10,sx=230,sy=H-80;
    ctx.save();
    items.forEach((item,i)=>{ const x=sx+i*(pw+gap),y=sy;
      ctx.fillStyle='rgba(6,10,24,0.82)'; ctx.strokeStyle='rgba(100,140,255,0.15)'; ctx.lineWidth=1; rrect(x,y,pw,ph,8); ctx.fill(); ctx.stroke();
      ctx.fillStyle='#4a6080'; ctx.font='600 11px Inter,ui-sans-serif,sans-serif'; ctx.fillText(item.label,x+10,y+14);
      ctx.fillStyle=item.color||'#ccddf8'; ctx.font='700 16px Inter,ui-sans-serif,sans-serif'; ctx.fillText(item.value,x+10,y+33);
    }); ctx.restore(); }

  drawM3OutcomeBanner();
}

function drawM3OutcomeBanner() {
  if (m3State.outcome==='playing'||m3State.outcome==='win') return;
  const bw=500, bh=170, bx=W/2-bw/2, by=H/2-bh/2;
  ctx.save();
  ctx.fillStyle='rgba(6,10,24,0.95)'; ctx.strokeStyle='rgba(252,165,165,0.55)'; ctx.lineWidth=1.5;
  rrect(bx,by,bw,bh,18); ctx.fill(); ctx.stroke();
  ctx.textAlign='center';
  ctx.font='800 28px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle='#fca5a5'; ctx.fillText('\uD83D\uDCA5  MISSION FAILED',W/2,by+50);
  ctx.font='700 20px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle='rgba(252,165,165,0.8)'; ctx.fillText(m3State.message,W/2,by+86);
  ctx.font='500 17px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle='rgba(180,140,140,0.6)'; ctx.fillText('Press R to retry',W/2,by+116);
  drawCanvasBtn('retryM3','\u21ba Retry',W/2-166,by+bh-58,152,44,{fill:'rgba(20,30,60,0.95)',stroke:'rgba(150,200,255,0.4)',color:'#c8d8f8',fs:'700 21px Inter,ui-sans-serif,sans-serif'});
  drawCanvasBtn('backToTitle','\u2190 Menu',W/2+14,by+bh-58,152,44,{fill:'rgba(10,15,30,0.9)',stroke:'rgba(100,130,200,0.4)',color:'#8899cc',fs:'600 21px Inter,ui-sans-serif,sans-serif'});
  ctx.textAlign='left'; ctx.restore();
}


let lastNow = null;

function loop(now) {
  if (lastNow===null) lastNow=now;
  const realDt=Math.min((now-lastNow)/1000,0.05);
  lastNow=now;

  if (scene==='orbit') {
    if (state.outcome==='playing') updatePhysics(realDt);
    const inOrbit=state.stableTimer>0;
    camera.blend += ((inOrbit?1.0:0.0)-camera.blend)*0.006;
    camera.zoom = 1.0+1.2*camera.blend;
  }
  if (scene==='landing' && lState.outcome==='playing') updateLandingPhysics(realDt);
  if (scene==='m3' && m3State.outcome==='playing') updateM3Physics(realDt);
  transition.update(realDt);

  if (scene==='title')        renderTitle();
  else if (scene==='orbit')   render();
  else if (scene==='landing') renderLanding();
  else if (scene==='m3')      renderM3();
  transition.draw();

  requestAnimationFrame(loop);
}

// ════════════════════════════════════════════════════════════════════════════
// TOUCH CONTROLS & UI
// ════════════════════════════════════════════════════════════════════════════

(function initFullscreen() {
  const btn=document.getElementById('btn-fullscreen'); if (!btn) return;
  function toggleFS() {
    if (!document.fullscreenElement&&!document.webkitFullscreenElement) {
      const el=document.documentElement;
      if (el.requestFullscreen) el.requestFullscreen({navigationUI:'hide'}); else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    } else { if (document.exitFullscreen) document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); }
  }
  btn.addEventListener('pointerdown',e=>{e.preventDefault();toggleFS();},{passive:false});
  function onFSChange() { const inFS=!!(document.fullscreenElement||document.webkitFullscreenElement); btn.textContent=inFS?'\u2715':'\u26f6'; btn.style.display=inFS?'none':''; }
  document.addEventListener('fullscreenchange',onFSChange); document.addEventListener('webkitfullscreenchange',onFSChange);
})();

(function suppressLongPress() {
  document.addEventListener('contextmenu',e=>e.preventDefault(),{passive:false});
  document.addEventListener('selectstart',e=>e.preventDefault(),{passive:false});
  document.addEventListener('touchstart',e=>{ if (e.target.tagName==='BUTTON'||e.target.closest('.side-ctrl,.bottom-bar,.fullscreen-btn')) e.preventDefault(); },{passive:false});
})();

(function initOrientButtons() {
  function setMode(mode) {
    const tgt=scene==='m3'?m3State:(scene==='landing'?lState:state);
    if (!tgt) return;
    tgt.orientMode=tgt.orientMode===mode?null:mode;
    document.getElementById('btn-prograde')?.classList.toggle('pressed',tgt.orientMode==='prograde');
    document.getElementById('btn-retrograde')?.classList.toggle('pressed',tgt.orientMode==='retrograde');
  }
  ['btn-prograde','btn-retrograde'].forEach(id=>{
    const el=document.getElementById(id); if (!el) return;
    el.addEventListener('pointerdown',e=>{e.preventDefault();setMode(id==='btn-prograde'?'prograde':'retrograde');},{passive:false});
  });
})();

(function initTouchControls() {
  const MAP={'btn-left':'ArrowLeft','btn-right':'ArrowRight','btn-thrust':'Space'};
  function press(k){keys.add(k);} function release(k){keys.delete(k);}
  Object.entries(MAP).forEach(([id,kc])=>{
    const el=document.getElementById(id); if (!el) return;
    const setP=on=>{ on?el.classList.add('pressed'):el.classList.remove('pressed'); on?press(kc):release(kc); };
    el.addEventListener('pointerdown',e=>{
      e.preventDefault();
      if (id==='btn-left'||id==='btn-right') {
        const tgt=scene==='m3'?m3State:(scene==='landing'?lState:state);
        if (tgt) { tgt.orientMode=null; document.getElementById('btn-prograde')?.classList.remove('pressed'); document.getElementById('btn-retrograde')?.classList.remove('pressed'); }
      }
      setP(true);
    },{passive:false});
    el.addEventListener('pointerup',e=>{e.preventDefault();setP(false);},{passive:false});
    el.addEventListener('pointerout',e=>{e.preventDefault();setP(false);},{passive:false});
    el.addEventListener('pointercancel',()=>setP(false),{passive:false});
  });

  document.querySelectorAll('.warp-btn').forEach((btn,i)=>{
    btn.addEventListener('pointerdown',e=>{
      e.preventDefault();
      const tgt=scene==='m3'?m3State:(scene==='landing'?lState:state);
      if (tgt) tgt.warpIdx=i;
      document.querySelectorAll('.warp-btn').forEach((b,j)=>b.classList.toggle('active',j===i));
    },{passive:false});
  });

  window.addEventListener('keydown',e=>{
    const map={Digit1:0,Digit2:1,Digit3:2,Digit4:3};
    if (map[e.code]!==undefined) document.querySelectorAll('.warp-btn').forEach((b,j)=>b.classList.toggle('active',j===map[e.code]));
  });

  const rb=document.getElementById('btn-restart');
  if (rb) rb.addEventListener('pointerdown',e=>{e.preventDefault(); if(scene==='orbit')resetGame(); else if(scene==='landing')resetLanding(orbitHandoff); else if(scene==='m3')resetM3();},{passive:false});

  document.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});
  document.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});
})();

if ('ontouchstart' in window||navigator.maxTouchPoints>0) {
  const ov=document.querySelector('.overlay'); if (ov) ov.style.display='none';
}

// ════════════════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════════════════

// Pre-init dummy state so keydown handler doesn't crash before first scene
state  = { orientMode: 'prograde', warpIdx: 0, outcome: 'playing', message: '', stableTimer: 0, trail: [], moonAngle: 0, earthAngle: 0 };
lState = { orientMode: 'prograde', warpIdx: 0, outcome: 'playing', message: '', trail: [], fromOrbit: false };
rocket  = { x: CX, y: CY, vx: 0, vy: 0, angle: 0, fuel: 100 };
lRocket = { x: CX, y: CY, vx: 0, vy: 0, angle: 0, fuel: 100 };
m3State = { orientMode: null, warpIdx: 0, outcome: 'playing', message: '', trail: [], stableTimer: 0 };
m3Rocket = { x: CX, y: CY, vx: 0, vy: 0, angle: 0, fuel: 100 };

requestAnimationFrame(loop);
