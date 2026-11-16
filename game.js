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
const LAND_FUEL_RATIO = FUEL_DRAIN * (LAND_THRUST / THRUST); // fuel drain rate for landing scene
const PAD_HALF       = 0.30;
const PAD_ANGLE      = Math.PI / 2;
const LAND_ESCAPE    = 960;


// Mission 0 — Launch to orbit (ballistic feel, no orbital mechanics)
const M0_EARTH_R    = 24000;  // visual only — for Earth arc rendering
const M0_GRAVITY    = 320;   // constant downward pull (u/s²)
const M0_DRAG_CD    = 2;     // atmospheric drag coefficient
const M0_ATMO_SCALE = 350;    // drag halves every 350u altitude
const M0_TARGET_MIN = 800;   // target altitude band
const M0_TARGET_MAX = 1400;
const M0_HORIZ_MIN  = 0.75;   // must be 75% horizontal to win
const M0_HOLD       = 15;     // seconds to hold in band
const M0_STAGE_SPLIT = 50;    // stage sep at 50% fuel
const M0_FUEL_DRAIN  = 14;    // fuel drain rate (faster = more drama)
const M0_S1_THRUST  = 1100;    // stage 1 thrust (fights gravity+drag hard)
const M0_S2_THRUST  = 380;    // stage 2 (upper stage, efficient)
const M3_ORBIT_MIN  = 440;
const M3_ORBIT_MAX  = 540;
const M3_HOLD       = 60;
const M4_HOLD       = 30;
const M3_THRUST     = 110;

// Mission 5 — Reentry. Side-on, flat-Earth model: physics y = -altitude (canvas-style,
// down is +), gravity is relieved by horizontal speed (vx²/V_orb²) so a circular orbit
// exists. Tuned with a headless sim so the corridor is real: lift down always burns up,
// neutral survives small/medium deorbit burns, lift up survives steep burns but skips
// out of the atmosphere on shallow ones.
const M5_ORBIT_V     = 1350;   // circular orbit speed (horizontal)
const M5_G           = 33.75;  // surface gravity
const M5_SCALE_H     = 90;     // atmosphere scale height
const M5_ATMO_TOP    = 450;    // entry interface (5 scale heights); density is 0 above
const M5_RHO_TOP     = Math.exp(-M5_ATMO_TOP / M5_SCALE_H);
const M5_START_ALT   = 1450;   // parking orbit altitude
const M5_K_CAPSULE   = M5_G / (60 * 60); // drag coefficient → 60 u/s terminal at sea level
const M5_K_DROGUE    = M5_K_CAPSULE * 4;   // 30 u/s at sea level: slows you, but the main is still required
const M5_K_MAIN      = M5_K_CAPSULE * 20;
const M5_CHUTE_OPEN  = 1.0;    // seconds for a canopy to inflate fully
const M5_LD          = 0.4;    // capsule lift-to-drag at full tilt
const M5_SHIELD_HALF = 20 * Math.PI / 180; // shield protects within ±20° of the airflow
const M5_HEAT_IN     = 3467;   // hull heat gain per unit heat flux
const M5_HEAT_OUT    = 0.9;    // hull cooling rate (1/s)
const M5_HEAT_BARE   = 4;      // heat multiplier when the shield isn't facing the airflow (or is gone)
const M5_ABLATE      = 533;    // shield % lost per unit heat flux
const M5_THRUST      = 67.5;   // service module engine
const M5_FUEL_DRAIN  = 6;      // fuel %/s while burning
const M5_DROGUE_MAX  = 300;    // drogue tears above this speed
const M5_MAIN_MAX    = 90;     // main chute tears above this speed
const M5_SPLASH_MAX  = 21;     // safe splashdown speed
const M5_TILT_MAX    = 60 * Math.PI / 180;
const M5_TILT_RATE   = 0.6;    // rad/s
const M5_CHUTE_LOCK  = 1.0;    // seconds after separation before Space can open a chute
const M5_SHIP_X      = 55000;  // recovery ship downrange position: reachable from any sane plan by timing the burn
const M5_GROUND_SY   = 1360;   // screen y of sea level (fixed vertical camera, clear of the bottom HUD)
const M5_VIEW_Z      = 0.85;   // uniform world→screen scale (keeps angles true; whole flight fits vertically)

const canvas = document.getElementById('game');
const ctx    = canvas.getContext('2d');
const W  = canvas.width;
const H  = canvas.height;
const CX = W / 2;
const CY = H / 2;

// Integration: symplectic Euler — gravity/thrust applied to v before x += v*dt (energy-conserving for orbits)
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

let scene = 'title';
let titleMouse = { x: 0, y: 0 }; // for title parallax // 'title' | 'm0' | 'orbit' | 'landing' | 'm3' | 'm4' | 'endgame'
const missionLog = { m0:null, m1:null, m2:null, m3:null, m4:null, m5:null };
let missionMode = 'full'; // 'full' | 'single'
const uiHitBoxes = {};
let orbitHandoff = null; // { relAngle, fuel }
let m0OrbitDir = 1; // 1 = CW/east (default, original), -1 = CCW/west (set when M0 exits west)
let m3EntryFuel  = 100;  // fuel at M3 start — preserved on retry
let landingEntryFuel = 100; // fuel at M2 start in single mode
let m4EntryFuel  = 100;  // fuel at M4 start
let m5EntryFuel  = 100;  // fuel at M5 start

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
  get mission0Beaten() { return localStorage.getItem('moonshot_m0') === '1'; },
  get mission1Beaten() { return localStorage.getItem('moonshot_m1') === '1'; },
  get mission2Beaten() { return localStorage.getItem('moonshot_m2') === '1'; },
  get mission3Beaten() { return localStorage.getItem('moonshot_m3') === '1'; },
  get mission4Beaten() { return localStorage.getItem('moonshot_m4') === '1'; },
  unlockMission0()     { localStorage.setItem('moonshot_m0', '1'); },
  unlockMission1()     { localStorage.setItem('moonshot_m1', '1'); },
  unlockMission2()     { localStorage.setItem('moonshot_m2', '1'); },
  unlockMission3()     { localStorage.setItem('moonshot_m3', '1'); },
  unlockMission4()     { localStorage.setItem('moonshot_m4', '1'); },
};

// ════════════════════════════════════════════════════════════════════════════
// INPUT
// ════════════════════════════════════════════════════════════════════════════

const keys = new Set();

window.addEventListener('keydown', e => {
  const block = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
  if (block.includes(e.code)) e.preventDefault();
  keys.add(e.code);

  if (e.code === 'KeyR') { restartActiveScene(); return; }
  // M5: thrust keys double as the parachute key once the service module is gone.
  // Only a fresh press counts (auto-repeat from a held key is ignored).
  if (scene === 'm5' && !e.repeat && (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp')) m5RequestChute();

  const tOrient = getActiveState();
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

canvas.addEventListener('pointerdown', function(e){e.preventDefault();if(scene==='title')musicPlayTitle();handleCanvasClick(e);},{passive:false});
canvas.addEventListener('pointermove', function(e){
  if (scene!=='title') return;
  const rect=canvas.getBoundingClientRect();
  titleMouse.x=(e.clientX-rect.left)*(canvas.width/rect.width);
  titleMouse.y=(e.clientY-rect.top)*(canvas.height/rect.height);
},{passive:true});


// ── MUSIC ─────────────────────────────────────────────────────────────────────
// --- Music System ---
// To assign a different track per scene, update MISSION_TRACKS below.
// All scenes currently use Rocket.mp3 as placeholder.
const MISSION_TRACKS = {
  title:   'audio/Rocket.mp3',
  m0:      'audio/AtLaunch.mp3',
  orbit:   'audio/MesmerizingGalaxyLoop.mp3',
  landing: 'audio/MesmerizingGalaxyLoop.mp3',
  m3:      'audio/MesmerizingGalaxyLoop.mp3',
  m4:      'audio/SpaceFighterLoop.mp3',
  m5:      'audio/AtLaunch.mp3',
  endgame: 'audio/Rocket.mp3',
};


// Track info per audio file — { title, artist }
const TRACK_TITLES = {
  'audio/Rocket.mp3':               { title: 'Rocket',                    artist: 'Kevin MacLeod (incompetech.com)' },
  'audio/AtLaunch.mp3':             { title: 'At Launch',                 artist: 'Kevin MacLeod (incompetech.com)' },
  'audio/MesmerizingGalaxyLoop.mp3':{ title: 'Mesmerizing Galaxy',        artist: 'Kevin MacLeod (incompetech.com)' },
  'audio/SpaceFighterLoop.mp3':      { title: 'Space Fighter',             artist: 'Kevin MacLeod (incompetech.com)' },
};
const bgMusic = document.getElementById('bg-music');
let musicStarted = false;
let musicCurrentTrack = null;
let musicFadeTimer = null;

function musicFadeTo(targetVol, durationMs, onDone) {
  if (!bgMusic) return;
  if (musicFadeTimer) clearInterval(musicFadeTimer);
  const startVol = bgMusic.volume;
  const steps = 30;
  const stepMs = durationMs / steps;
  const delta = (targetVol - startVol) / steps;
  let i = 0;
  musicFadeTimer = setInterval(() => {
    i++;
    bgMusic.volume = Math.max(0, Math.min(1, startVol + delta * i));
    if (i >= steps) {
      bgMusic.volume = targetVol;
      clearInterval(musicFadeTimer);
      if (targetVol === 0) bgMusic.pause();
      if (onDone) onDone();
    }
  }, stepMs);
}

function musicPlayScene(sceneName) {
  if (!bgMusic) return;
  const track = MISSION_TRACKS[sceneName] || MISSION_TRACKS['title'];
  if (!musicStarted) {
    // First interaction — just start the track
    bgMusic.src = track;
    bgMusic.loop = true;
    bgMusic.volume = 0;
    bgMusic.play().catch(() => {});
    musicStarted = true;
    musicCurrentTrack = track;
    musicFadeTo(0.55, 1500);
    return;
  }
  if (track === musicCurrentTrack) {
    // Same track — resume/fade in if paused
    if (bgMusic.paused) {
      bgMusic.volume = 0;
      bgMusic.play().catch(() => {});
    }
    musicFadeTo(0.55, 1000);
    return;
  }
  // Different track — crossfade: fade out, swap, fade in
  musicFadeTo(0, 600, () => {
    bgMusic.src = track;
    bgMusic.loop = true;
    bgMusic.currentTime = 0;
    bgMusic.volume = 0;
    bgMusic.play().catch(() => {});
    musicCurrentTrack = track;
    musicFadeTo(0.55, 1000);
  });
}

// Legacy alias used by fullscreen button and canvas tap (title screen entry)
function musicPlayTitle() { musicPlayScene('title'); }

function musicStopForMission() {
  musicFadeTo(0, 800);
}
// --- Music Attribution Overlay ---
let musicAttribAlpha = 0;       // 0 = hidden, 1 = fully visible
let musicAttribHoldTimer = 0;   // counts down hold time before fading
const ATTRIB_HOLD_S  = 4;       // seconds fully visible
const ATTRIB_FADE_S  = 1.2;     // seconds to fade out

function musicAttribShow() {
  musicAttribAlpha = 1;
  musicAttribHoldTimer = ATTRIB_HOLD_S;
}
function musicAttribTick(dt) {
  if (musicAttribAlpha <= 0) return;
  if (musicAttribHoldTimer > 0) {
    musicAttribHoldTimer = Math.max(0, musicAttribHoldTimer - dt);
  } else {
    musicAttribAlpha = Math.max(0, musicAttribAlpha - dt / ATTRIB_FADE_S);
  }
}
function drawMusicAttrib(alphaOverride) {
  if (!bgMusic) return;
  const alpha = (alphaOverride !== undefined) ? alphaOverride : musicAttribAlpha;
  if (alpha <= 0) return;
  const trackSrc = bgMusic.src ? bgMusic.src.replace(window.location.href.replace(/[^/]*$/, ''), '') : '';
  const trackInfo = TRACK_TITLES[trackSrc] || TRACK_TITLES[Object.keys(TRACK_TITLES)[0]];
  // lines: [label, title, artist, (gap), cc-license, cc-url]
  const measureLines = ['Current track:', trackInfo.title, trackInfo.artist,
    'Licensed under Creative Commons: By Attribution 4.0',
    'http://creativecommons.org/licenses/by/4.0/'];
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = '600 20px Inter,ui-sans-serif,sans-serif';
  const attrMaxW = Math.max(...measureLines.map(l => ctx.measureText(l).width));
  const attrPadX = 14, attrPadY = 12, attrLineH = 26, attrX = 16;
  // 5 text lines + 1 blank gap line between artist and CC
  const attrBoxH = 6 * attrLineH + attrPadY * 2;
  const attrBoxW = attrMaxW + attrPadX * 2;
  const attrY = H - 16 - attrBoxH;
  ctx.fillStyle = 'rgba(5,8,22,0.72)';
  rrect(attrX, attrY, attrBoxW, attrBoxH, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(100,130,180,0.18)'; ctx.lineWidth = 1;
  rrect(attrX, attrY, attrBoxW, attrBoxH, 8); ctx.stroke();
  ctx.textAlign = 'left';
  const tx = attrX + attrPadX, ty = attrY + attrPadY + 18;
  ctx.font = '400 18px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle = `rgba(100,130,180,${0.60 * alpha})`;
  ctx.fillText('Current track:', tx, ty);
  ctx.font = '600 20px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle = `rgba(148,175,220,${0.80 * alpha})`;
  ctx.fillText(trackInfo.title,  tx, ty + attrLineH);
  ctx.font = '400 18px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle = `rgba(148,175,220,${0.70 * alpha})`;
  ctx.fillText(trackInfo.artist, tx, ty + attrLineH * 2);
  ctx.fillStyle = `rgba(120,150,200,${0.60 * alpha})`;
  ctx.fillText('Licensed under Creative Commons: By Attribution 4.0', tx, ty + attrLineH * 4);
  ctx.fillText('http://creativecommons.org/licenses/by/4.0/', tx, ty + attrLineH * 5);
  ctx.restore();
}


function enterTitle() {
  scene = 'title';
  orbitHandoff = null; // clear handoff so direct M2 start is always fresh
  setThrustButtonMode('thrust');
  setTouchUIVisible(false);
  musicPlayScene('title'); musicAttribShow();
}

function handleCanvasClick(e) {
  if (transition.active) return; // ignore clicks during fade transitions
  const rect   = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const cx     = (e.clientX - rect.left) * scaleX;
  const cy     = (e.clientY - rect.top)  * scaleY;

  function hit(box) {
    return box && cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
  }

  if (scene === 'title') {
    if (hit(uiHitBoxes.modeFullBtn))   { missionMode = 'full'; }
    if (hit(uiHitBoxes.modeSingleBtn)) { missionMode = 'single'; }
    if (hit(uiHitBoxes.mission0)) { scene = 'm0'; resetM0(); setTouchUIVisible(true); musicPlayScene('m0'); musicAttribShow(); }
    if (hit(uiHitBoxes.mission1) && missionMode !== 'full' && progress.mission0Beaten) { scene = 'orbit'; resetGame(); setTouchUIVisible(true); musicPlayScene('orbit'); musicAttribShow(); }
    if (hit(uiHitBoxes.mission2) && missionMode !== 'full' && progress.mission1Beaten) { scene = 'landing'; orbitHandoff = null; landingEntryFuel = 80; resetLanding(null,80); setTouchUIVisible(true); musicPlayScene('landing'); musicAttribShow(); }
    if (hit(uiHitBoxes.mission3) && missionMode !== 'full' && progress.mission2Beaten) { scene = 'm3'; m3EntryFuel = 60; resetM3(60); setTouchUIVisible(true); musicPlayScene('m3'); musicAttribShow(); }
    if (hit(uiHitBoxes.mission4) && missionMode !== 'full' && progress.mission3Beaten) { scene = 'm4'; m4EntryFuel = 40; resetM4(40); setTouchUIVisible(true); musicPlayScene('m4'); musicAttribShow(); }
    if (hit(uiHitBoxes.mission5) && missionMode !== 'full' && progress.mission4Beaten) { scene = 'm5'; m5EntryFuel = 20; resetM5(20); setTouchUIVisible(true); musicPlayScene('m5'); musicAttribShow(); }
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
      setTouchUIVisible(true);
    }
    if (hit(uiHitBoxes.retryGame) && state.outcome !== 'playing')   resetGame();
    if (hit(uiHitBoxes.backToTitle) && state.outcome !== 'playing') enterTitle();
  }
  if (scene === 'landing') {
    if (hit(uiHitBoxes.retryLanding)) resetLanding(orbitHandoff, landingEntryFuel);
    if (hit(uiHitBoxes.backToTitle))  enterTitle();
  }
  if (scene === 'm3') {
    if (hit(uiHitBoxes.retryM3))    resetM3(m3EntryFuel);
    if (hit(uiHitBoxes.backToTitle)) enterTitle();
  }
  if (scene === 'm0') {
    if (hit(uiHitBoxes.retryM0))     resetM0();
    if (hit(uiHitBoxes.backToTitle)) enterTitle();
  }
  if (scene === 'm4') {
    if (hit(uiHitBoxes.retryM4))    resetM4(m4EntryFuel);
    if (hit(uiHitBoxes.backToTitle)) enterTitle();
  }
  if (scene === 'm5') {
    if (hit(uiHitBoxes.retryM5))    resetM5(m5EntryFuel);
    if (hit(uiHitBoxes.backToTitle)) enterTitle();
  }
  if (scene === 'endgame') {
    if (hit(uiHitBoxes.playAgain))   { scene='m0'; resetM0(); setTouchUIVisible(true); musicPlayScene('m0'); musicAttribShow(); }
    if (hit(uiHitBoxes.backToTitle)) enterTitle();
  }
}


// ════════════════════════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════════════════════════

let state, rocket;
let lState, lRocket;
let m3State, m3Rocket;
let m0State, m0Rocket;
let m4State, m4Rocket;
let m5State, m5Rocket;

// ── Scene registry ───────────────────────────────────────────────────────────
// Single source of truth mapping the active scene → its state/rocket/restart.
// Getters read the live module-level bindings (which reset functions reassign),
// so this stays correct after every reset. Adding a mission = one entry here
// instead of editing the 5-way ternary that used to live in every input handler.
const SCENES = {
  m0:      { get state(){ return m0State; }, get rocket(){ return m0Rocket; }, restart(){ resetM0(); } },
  orbit:   { get state(){ return state;   }, get rocket(){ return rocket;   }, restart(){ resetGame(); } },
  landing: { get state(){ return lState;  }, get rocket(){ return lRocket;  }, restart(){ resetLanding(orbitHandoff, landingEntryFuel); } },
  m3:      { get state(){ return m3State; }, get rocket(){ return m3Rocket; }, restart(){ resetM3(m3EntryFuel); } },
  m4:      { get state(){ return m4State; }, get rocket(){ return m4Rocket; }, restart(){ resetM4(m4EntryFuel); } },
  m5:      { get state(){ return m5State; }, get rocket(){ return m5Rocket; }, restart(){ resetM5(m5EntryFuel); } },
};
function getActiveState()  { return SCENES[scene] ? SCENES[scene].state  : null; }
function getActiveRocket() { return SCENES[scene] ? SCENES[scene].rocket : null; }
function restartActiveScene() { if (SCENES[scene]) SCENES[scene].restart(); }

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

function resetGame(startFuel) {
  if (startFuel === undefined) startFuel = 100;
  collisionFilter.reset(); pathLengthFilter.reset(); camera.reset();
  uiHitBoxes.beginDescent = null; uiHitBoxes.backToTitle = null;

  state = {
    warpIdx: 0, moonAngle: 0, earthAngle: 0, orientMode: 'prograde',
    outcome: 'playing', message: 'BURN PROGRADE TO REACH THE MOON',
    stableTimer: 0, trail: [],
    missionStartTime: performance.now(), maxSpeed: 0,
  };

  const r0 = 75, ang = -Math.PI / 2;
  const x = CX + Math.cos(ang) * r0, y = CY + Math.sin(ang) * r0;
  const circV = Math.sqrt(G * EARTH_MASS / r0);
  // m0OrbitDir: 1=CW/east (original default), -1=CCW/west. Set by M0 exit direction.
  const dir = m0OrbitDir;
  rocket = { x, y, vx: -Math.sin(ang)*circV*dir, vy: Math.cos(ang)*circV*dir, angle: ang+Math.PI/2, fuel: startFuel };

  document.getElementById('btn-prograde')?.classList.toggle('pressed', true);
  document.getElementById('btn-retrograde')?.classList.toggle('pressed', false);
}

// ════════════════════════════════════════════════════════════════════════════
// LANDING RESET
// ════════════════════════════════════════════════════════════════════════════

function resetLanding(handoff, singleFuel) {
  collisionFilter.reset(); pathLengthFilter.reset();
  uiHitBoxes.retryLanding = null; uiHitBoxes.backToTitle = null;

  const startAngle = handoff ? handoff.relAngle : -Math.PI / 2;
  const startFuel  = handoff ? handoff.fuel : (singleFuel !== undefined ? singleFuel : 100);
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
    message: 'IN LUNAR ORBIT \u2014 INITIATE DESCENT',
    trail: [], fromOrbit: !!handoff,
    missionStartTime: performance.now(), maxSpeed: 0,
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

function resetM3(startFuel = 100) {
  collisionFilter.reset(); pathLengthFilter.reset();
  uiHitBoxes.retryM3 = null; uiHitBoxes.backToTitle = null;
  const padX = CX + Math.cos(PAD_ANGLE) * (LAND_MOON_R + 8);
  const padY = CY + Math.sin(PAD_ANGLE) * (LAND_MOON_R + 8);
  m3State = {
    warpIdx: 0, orientMode: null, outcome: 'playing',
    message: 'LAUNCH FROM THE MOON \u2014 ESTABLISH ORBIT',
    trail: [], stableTimer: 0, launched: false,
    missionStartTime: performance.now(), maxSpeed: 0,
  };
  m3Rocket = {
    x: padX, y: padY, vx: 0, vy: 0,
    angle: PAD_ANGLE, fuel: startFuel,
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
  if (left||right) { state.orientMode=null;
    document.getElementById('btn-prograde')?.classList.remove('pressed');
    document.getElementById('btn-retrograde')?.classList.remove('pressed');
  }
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
    {const _s=Math.hypot(rocket.vx,rocket.vy);if(_s>state.maxSpeed)state.maxSpeed=_s;}
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
      missionLog.m1={time:(performance.now()-state.missionStartTime)/1000,fuel:rocket.fuel,maxSpeed:state.maxSpeed};
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
        musicPlayScene('landing'); musicAttribShow();
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

  if (left||right) { lState.orientMode=null;
    document.getElementById('btn-prograde')?.classList.remove('pressed');
    document.getElementById('btn-retrograde')?.classList.remove('pressed');
  }
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
    if (thrusting) { lRocket.vx+=Math.cos(lRocket.angle)*LAND_THRUST*dt; lRocket.vy+=Math.sin(lRocket.angle)*LAND_THRUST*dt; lRocket.fuel=Math.max(0,lRocket.fuel-LAND_FUEL_RATIO*dt); }
    const gM=gravAccel(CX,CY,MOON_MASS,lRocket.x,lRocket.y);
    lRocket.vx+=gM.ax*dt; lRocket.vy+=gM.ay*dt;
    lRocket.x+=lRocket.vx*dt; lRocket.y+=lRocket.vy*dt;
    {const _s=Math.hypot(lRocket.vx,lRocket.vy);if(_s>lState.maxSpeed)lState.maxSpeed=_s;}
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
      missionLog.m2={time:(performance.now()-lState.missionStartTime)/1000,fuel:lRocket.fuel,maxSpeed:lState.maxSpeed};
      const _m3Fuel = lRocket.fuel;
      m3EntryFuel = _m3Fuel;
      transition.start(()=>{ scene='m3'; resetM3(_m3Fuel); musicPlayScene('m3'); musicAttribShow(); });
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

  if (left||right) { m3State.orientMode=null;
    document.getElementById('btn-prograde')?.classList.remove('pressed');
    document.getElementById('btn-retrograde')?.classList.remove('pressed');
  }
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
      m3State.launched = true;
      m3Rocket.vx+=Math.cos(m3Rocket.angle)*M3_THRUST*dt;
      m3Rocket.vy+=Math.sin(m3Rocket.angle)*M3_THRUST*dt;
      m3Rocket.fuel=Math.max(0,m3Rocket.fuel-FUEL_DRAIN*(M3_THRUST/THRUST)*dt);
    }
    const gM=gravAccel(CX,CY,MOON_MASS,m3Rocket.x,m3Rocket.y);
    if (m3State.launched) { m3Rocket.vx+=gM.ax*dt; m3Rocket.vy+=gM.ay*dt; }
    m3Rocket.x+=m3Rocket.vx*dt; m3Rocket.y+=m3Rocket.vy*dt;
    {const _s=Math.hypot(m3Rocket.vx,m3Rocket.vy);if(_s>m3State.maxSpeed)m3State.maxSpeed=_s;}
    const last=m3State.trail[m3State.trail.length-1];
    if (!last||Math.hypot(m3Rocket.x-last.x,m3Rocket.y-last.y)>3) {
      m3State.trail.push({x:m3Rocket.x,y:m3Rocket.y});
      if (m3State.trail.length>TRAIL_MAX) m3State.trail.shift();
    }
    evalM3State(gM.dist);
  }
  // Accumulate hold timer once per frame (not per substep)
  if (m3State.outcome==='playing') {
    if (m3State._inBand) { m3State.stableTimer+=realDt; }
    else { m3State.stableTimer=0; }
    if (m3State.stableTimer>=M3_HOLD&&!transition.active) {
      endM3('win','MISSION COMPLETE');
      progress.unlockMission3();
      missionLog.m3={time:(performance.now()-m3State.missionStartTime)/1000,fuel:m3Rocket.fuel,maxSpeed:m3State.maxSpeed};
      var _m4f=m3Rocket.fuel; m4EntryFuel=_m4f;
      transition.start(function(){scene='m4';resetM4(_m4f);musicPlayScene('m4'); musicAttribShow();});
    }
  }
}

function evalM3State(dist) {
  if (!m3State.launched) return;
  if (dist<LAND_MOON_R+4) return endM3('lose','CRASHED INTO THE MOON');
  if (dist>LAND_ESCAPE)   return endM3('lose','LOST IN SPACE');
  if (m3Rocket.fuel<=0&&(dist<M3_ORBIT_MIN||dist>M3_ORBIT_MAX)) return endM3('lose','OUT OF FUEL');

  m3State._inBand = dist>=M3_ORBIT_MIN&&dist<=M3_ORBIT_MAX;
  if (m3State._inBand) {
    const rem=Math.max(0,M3_HOLD-m3State.stableTimer);
    m3State.message=rem>0?'HOLDING ORBIT\u2026':'ORBIT ESTABLISHED!';
    // win handled per-frame in updateM3Physics
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
      if (gM.dist<LAND_MOON_R) {
        const sp=surfacePoint(prevX,prevY,px,py,CX,CY,LAND_MOON_R);
        const impactAngle=Math.atan2(sp.y-CY,sp.x-CX);
        let padDiff=impactAngle-PAD_ANGLE; while(padDiff>Math.PI)padDiff-=2*Math.PI; while(padDiff<-Math.PI)padDiff+=2*Math.PI;
        const onPadPred=Math.abs(padDiff)<PAD_HALF;
        col={x:sp.x,y:sp.y,body:onPadPred?'TOUCHDOWN':'MOON'};
        pts.push(sp); hit=true; break;
      }
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

// col: {x, y, body, tdSafe?, tdWarn?} — optional overrides used by M5:
//   tone: 'safe'|'warn'|'danger', icon: 'check'|'arrow'|'x', label: string
function drawCollisionWarning(col) {
  const {x,y,body}=col;
  const tone = col.tone || (col.tdSafe?'safe':col.tdWarn?'warn':'danger');
  const icon = col.icon || (body==='TOUCHDOWN' ? (col.tdSafe?'check':'arrow') : 'x');
  const tdSafe = tone==='safe', tdWarn = tone==='warn';
  const t=(Date.now()/400)%(Math.PI*2), pulse=0.55+0.45*Math.sin(t);
  // Color: green=safe, amber=warning, red=danger
  const cr = tdSafe?'74,222,128':tdWarn?'251,191,36':'255,80,80';
  const cl = tdSafe?'134,239,172':tdWarn?'253,211,77':'255,120,120';
  ctx.save();
  ctx.strokeStyle=`rgba(${cr},${(0.3+0.3*Math.sin(t)).toFixed(2)})`; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(x,y,22+6*Math.sin(t),0,Math.PI*2); ctx.stroke();
  ctx.strokeStyle=`rgba(${cr},${pulse.toFixed(2)})`; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.arc(x,y,13,0,Math.PI*2); ctx.stroke();
  if (icon!=='x') {
    ctx.strokeStyle=`rgba(${cl},${pulse.toFixed(2)})`; ctx.lineWidth=2.5; ctx.lineCap='round';
    if (icon==='check') {
      // Checkmark
      ctx.beginPath(); ctx.moveTo(x-6,y); ctx.lineTo(x-1,y+6); ctx.lineTo(x+7,y-6); ctx.stroke();
    } else {
      // Down-arrow: slow down!
      ctx.beginPath(); ctx.moveTo(x,y-6); ctx.lineTo(x,y+5); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x-5,y+1); ctx.lineTo(x,y+6); ctx.lineTo(x+5,y+1); ctx.stroke();
    }
  } else {
    ctx.strokeStyle=`rgba(${cl},${pulse.toFixed(2)})`; ctx.lineWidth=2.5; ctx.lineCap='round';
    const s=7;
    ctx.beginPath(); ctx.moveTo(x-s,y-s); ctx.lineTo(x+s,y+s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x+s,y-s); ctx.lineTo(x-s,y+s); ctx.stroke();
  }
  const lY=y<CY?y+34:y-22;
  ctx.font='700 18px Inter,ui-sans-serif,sans-serif'; ctx.textAlign='center';
  const label=col.label || (tdSafe?'\u2713 TOUCHDOWN':tdWarn?'\u26a0 SLOW DOWN':'\u26a0 '+body+' IMPACT');
  const bw=ctx.measureText(label).width+16;
  ctx.fillStyle='rgba(10,5,20,0.82)';
  ctx.beginPath(); ctx.roundRect(x-bw/2,lY-22,bw,26,6); ctx.fill();
  ctx.fillStyle=`rgba(${cl},${pulse.toFixed(2)})`; ctx.fillText(label,x,lY);
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


// ════════════════════════════════════════════════════════════════════════════
// SHARED OUTCOME BANNER
// ════════════════════════════════════════════════════════════════════════════
function drawOutcomeBanner(outcome, message, opts) {
  if (outcome==='playing') return;
  var isWin = outcome==='win';
  var bw=540, bh=196, bx=W/2-bw/2, by=H/2-bh/2;
  ctx.save();
  ctx.fillStyle='rgba(6,10,24,0.95)';
  ctx.strokeStyle=isWin?'rgba(134,239,172,0.6)':'rgba(252,165,165,0.55)'; ctx.lineWidth=1.5;
  rrect(bx,by,bw,bh,18); ctx.fill(); ctx.stroke();
  ctx.textAlign='center';
  var textCol=isWin?'#86efac':'#fca5a5';
  var subCol=isWin?'rgba(134,239,172,0.8)':'rgba(252,165,165,0.8)';
  // Headline
  ctx.font='800 28px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=textCol;
  ctx.fillText(isWin?(opts.winLine1||'\u2713  MISSION COMPLETE'):'\uD83D\uDCA5  MISSION FAILED',W/2,by+48);
  // Sub-line
  ctx.font='600 20px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=subCol;
  ctx.fillText(isWin?(opts.winLine2||''):(message||''),W/2,by+82);
  // Hint (lose only)
  if (!isWin && opts.hint) {
    ctx.font='500 16px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle='rgba(180,140,140,0.55)';
    ctx.fillText(opts.hint,W/2,by+112);
  }
  // Buttons at fixed distance from bottom — never overlap text
  var btnY=by+bh-52;
  if (isWin) {
    drawCanvasBtn(opts.winBtnKey||'backToTitle',opts.winBtnLabel||'\u2190 Continue',
      W/2-110,btnY,220,44,{fill:'rgba(20,60,30,0.95)',stroke:'rgba(134,239,172,0.7)',color:'#86efac',fs:'700 20px Inter,ui-sans-serif,sans-serif'});
  } else {
    if (opts.retryKey) {
      drawCanvasBtn(opts.retryKey,opts.retryLabel||'\u21ba Retry',
        W/2-176,btnY,162,44,{fill:'rgba(20,30,60,0.95)',stroke:'rgba(150,200,255,0.4)',color:'#c8d8f8',fs:'700 20px Inter,ui-sans-serif,sans-serif'});
    }
    drawCanvasBtn('backToTitle','\u2190 Menu',
      opts.retryKey?W/2+14:W/2-81,btnY,162,44,{fill:'rgba(10,15,30,0.9)',stroke:'rgba(100,130,200,0.4)',color:'#8899cc',fs:'600 20px Inter,ui-sans-serif,sans-serif'});
  }
  ctx.textAlign='left'; ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
// ENDGAME WIN SCREEN
// ════════════════════════════════════════════════════════════════════════════
function formatTime(s){if(s==null)return'\u2014';var m=Math.floor(s/60),sec=Math.floor(s%60);return m>0?m+'m '+sec+'s':sec+'s';}
function renderEndgame(){
  ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.setLineDash([]);
  var bg=ctx.createRadialGradient(CX,CY,80,CX,CY,H);
  bg.addColorStop(0,'#0a1028');bg.addColorStop(1,'#020610');
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
  for(var st of STARS){ctx.globalAlpha=st.a*0.6;ctx.fillStyle='#dbeafe';ctx.beginPath();ctx.arc(st.x,st.y,st.r,0,Math.PI*2);ctx.fill();}
  ctx.globalAlpha=1;ctx.textAlign='center';
  ctx.font='800 52px Inter,ui-sans-serif,sans-serif';
  var hg=ctx.createLinearGradient(CX-300,0,CX+300,0);
  hg.addColorStop(0,'#86efac');hg.addColorStop(0.5,'#d9f99d');hg.addColorStop(1,'#86efac');
  ctx.fillStyle=hg;ctx.fillText('\uD83C\uDF0D  MISSION ACCOMPLISHED',CX,92);
  ctx.font='400 22px Inter,ui-sans-serif,sans-serif';ctx.fillStyle='rgba(148,220,160,0.65)';
  ctx.fillText('All six missions complete \u2014 you flew to the Moon and back.',CX,132);
  var missions=[
    {key:'m0',label:'M00',name:'Launch',icon:'\uD83D\uDE80'},
    {key:'m1',label:'M01',name:'Lunar Orbit',icon:'\uD83C\uDF0D'},
    {key:'m2',label:'M02',name:'Lunar Landing',icon:'\uD83C\uDF15'},
    {key:'m3',label:'M03',name:'Lunar Ascent',icon:'\uD83D\uDE80'},
    {key:'m4',label:'M04',name:'Return Home',icon:'\uD83C\uDF0D'},
    {key:'m5',label:'M05 \u00B7 shield left',name:'Reentry',icon:'\uD83E\uDE82'},
  ];
  var colW=198,tableW=colW*5,tableX=CX-tableW/2,headerY=200,rowH=90,firstRowY=252;
  ctx.font='700 15px Inter,ui-sans-serif,sans-serif';ctx.fillStyle='rgba(148,175,220,0.5)';ctx.textAlign='left';
  ['MISSION','TIME','FUEL LEFT','MAX SPEED','RATING'].forEach(function(h,i){ctx.fillText(h,tableX+i*colW+(i===0?0:14),headerY);});
  ctx.strokeStyle='rgba(100,140,255,0.18)';ctx.lineWidth=1;ctx.setLineDash([]);
  ctx.beginPath();ctx.moveTo(tableX,headerY+14);ctx.lineTo(tableX+tableW,headerY+14);ctx.stroke();
  missions.forEach(function(m,i){
    var log=missionLog[m.key],y=firstRowY+i*rowH;
    ctx.fillStyle=i%2===0?'rgba(255,255,255,0.03)':'rgba(0,0,0,0)';
    ctx.fillRect(tableX-8,y-28,tableW+16,rowH-4);
    ctx.textAlign='left';
    ctx.font='700 18px Inter,ui-sans-serif,sans-serif';ctx.fillStyle='#c8d8f8';
    ctx.fillText(m.icon+' '+m.name,tableX,y);
    ctx.font='500 13px Inter,ui-sans-serif,sans-serif';ctx.fillStyle='rgba(100,140,200,0.55)';
    ctx.fillText(m.label,tableX,y+20);
    if(!log){ctx.font='500 16px Inter,ui-sans-serif,sans-serif';ctx.fillStyle='rgba(150,150,180,0.35)';ctx.fillText('\u2014',tableX+colW+14,y);return;}
    ctx.font='600 20px Inter,ui-sans-serif,sans-serif';ctx.fillStyle='#e2e8f8';
    ctx.fillText(formatTime(log.time),tableX+colW+14,y);
    var fp=Math.round(log.fuel);
    ctx.fillStyle=fp>=50?'#86efac':fp>=25?'#fde68a':'#fca5a5';
    ctx.fillText(fp+'%',tableX+colW*2+14,y);
    ctx.fillStyle='#e2e8f8';
    ctx.fillText(Math.round(log.maxSpeed)+' u/s',tableX+colW*3+14,y);
    ctx.font='22px sans-serif';
    // Most missions rate on fuel left; M05 logs its own rating (distance to the recovery ship)
    var stars=log.stars!=null?log.stars:(fp>=60?3:fp>=30?2:1);
    ctx.fillText('\u2B50'.repeat(stars),tableX+colW*4+14,y+2);
  });
  var divY=firstRowY+missions.length*rowH-2;
  ctx.strokeStyle='rgba(100,140,255,0.18)';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(tableX,divY);ctx.lineTo(tableX+tableW,divY);ctx.stroke();
  ctx.setLineDash([]);
  var btnY=divY+52;
  drawCanvasBtn('playAgain','\u21ba  Play Again',CX-242,btnY,220,52,{fill:'rgba(12,30,20,0.95)',stroke:'rgba(134,239,172,0.5)',color:'#86efac',fs:'700 20px Inter,ui-sans-serif,sans-serif'});
  drawCanvasBtn('backToTitle','\u2190  Main Menu',CX+22,btnY,220,52,{fill:'rgba(10,15,30,0.9)',stroke:'rgba(100,130,200,0.4)',color:'#8899cc',fs:'600 20px Inter,ui-sans-serif,sans-serif'});
  transition.draw();
}


function renderTitle() {
  ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha=1; ctx.setLineDash([]);
  const bg=ctx.createRadialGradient(CX,CY,100,CX,CY,H);
  bg.addColorStop(0,'#080e22'); bg.addColorStop(1,'#020610');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  // Stars with mouse parallax on desktop, fixed on touch
  { const ox=(titleMouse.x-CX)*0.04, oy=(titleMouse.y-CY)*0.04;
    for (const s of STARS) {
      const sx=((s.x-ox*s.depth)%W+W)%W, sy=((s.y-oy*s.depth)%H+H)%H;
      ctx.globalAlpha=s.a; ctx.fillStyle='#dbeafe';
      ctx.beginPath(); ctx.arc(sx,sy,s.r,0,Math.PI*2); ctx.fill();
    }
  }
  ctx.globalAlpha=1;

  ctx.textAlign='center';
  ctx.font='800 160px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle='rgba(200,216,255,0.08)'; ctx.fillText('MOONSHOT',CX,400);

  ctx.font='800 110px Inter,ui-sans-serif,sans-serif';
  const tg=ctx.createLinearGradient(CX-400,0,CX+400,0);
  tg.addColorStop(0,'#60a5fa'); tg.addColorStop(0.5,'#c8d8f8'); tg.addColorStop(1,'#818cf8');
  ctx.fillStyle=tg; ctx.fillText('MOONSHOT',CX,400);

  ctx.font='400 38px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle='rgba(148,175,220,0.7)'; ctx.fillText('Choose your mission',CX,510);
  // Mode toggle pills
  { var pillW=200,pillH=48,pillGap=20,pillY=564,pill1X=CX-pillW-pillGap/2,pill2X=CX+pillGap/2;
    registerBtn('modeFullBtn',  pill1X, pillY, pillW, pillH);
    registerBtn('modeSingleBtn',pill2X, pillY, pillW, pillH);
    var modes=[{key:'full',label:'Full Mission',x:pill1X},{key:'single',label:'Single Mission',x:pill2X}];
    modes.forEach(function(m){
      var active=missionMode===m.key;
      ctx.fillStyle=active?'rgba(60,100,255,0.30)':'rgba(12,18,40,0.70)';
      ctx.strokeStyle=active?'rgba(120,160,255,0.80)':'rgba(80,110,180,0.35)';
      ctx.lineWidth=active?2:1.5;
      rrect(m.x,pillY,pillW,pillH,24); ctx.fill(); ctx.stroke();
      ctx.font=(active?'700':'500')+' 18px Inter,ui-sans-serif,sans-serif';
      ctx.fillStyle=active?'#c8d8f8':'rgba(148,175,220,0.55)';
      ctx.textAlign='center'; ctx.fillText(m.label,m.x+pillW/2,pillY+pillH*0.65);
    });
  }

  const cardW=420,cardH=230,cardY=CY+20;

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
    // Scale fonts proportionally to card width (base: w=680)
    var fs=w/680;
    ctx.font=Math.round(64*fs)+'px sans-serif'; ctx.fillStyle=locked?'rgba(150,160,200,0.3)':'rgba(255,255,255,0.9)'; ctx.textAlign='left'; ctx.fillText(icon,x+24,y+h*0.46);
    ctx.font='600 '+Math.round(18*fs)+'px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=locked?'rgba(80,100,160,0.4)':'rgba(100,160,255,0.7)'; ctx.textAlign='right'; ctx.fillText('MISSION '+num,x+w-18,y+h*0.2);
    ctx.font='800 '+Math.round(34*fs)+'px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=locked?'rgba(120,130,170,0.35)':'#c8d8f8'; ctx.textAlign='left'; ctx.fillText(title2,x+24,y+h*0.68);
    ctx.font='400 '+Math.round(19*fs)+'px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=locked?'rgba(120,130,170,0.4)':'rgba(148,175,220,0.7)'; ctx.fillText(sub,x+24,y+h*0.88);
    ctx.restore();
  }

  // 2-row grid layout: 3 cards per row
  var cW=680, cH=210, cGapX=40, cGapY=28;
  var row1Y=632, row2Y=632+cH+cGapY;
  var totalW=cW*3+cGapX*2, col0=CX-totalW/2, col1=col0+cW+cGapX, col2=col1+cW+cGapX;
  drawCard('mission0',col0,row1Y,cW,cH,'\uD83D\uDE80','00','LAUNCH',            'Launch from Earth to orbit', false);
  var fullLock = missionMode === 'full';
  drawCard('mission1',col1,row1Y,cW,cH,
    (!fullLock&&progress.mission0Beaten)?'\uD83C\uDF0D':'\uD83D\uDD12','01','LUNAR ORBIT',
    fullLock?'Start from Launch in full mode':(progress.mission0Beaten?'Reach stable lunar orbit':'Complete Launch first'),
    fullLock||!progress.mission0Beaten);
  drawCard('mission2',col2,row1Y,cW,cH,
    (!fullLock&&progress.mission1Beaten)?'\uD83C\uDF15':'\uD83D\uDD12','02','LUNAR LANDING',
    fullLock?'Start from Launch in full mode':(progress.mission1Beaten?'Land softly on the Moon':'Complete Lunar Orbit first'),
    fullLock||!progress.mission1Beaten);
  drawCard('mission3',col0,row2Y,cW,cH,
    (!fullLock&&progress.mission2Beaten)?'\uD83D\uDE80':'\uD83D\uDD12','03','LUNAR ASCENT',
    fullLock?'Start from Launch in full mode':(progress.mission2Beaten?'Launch from Moon to orbit':'Complete Lunar Landing first'),
    fullLock||!progress.mission2Beaten);
  drawCard('mission4',col1,row2Y,cW,cH,
    (!fullLock&&progress.mission3Beaten)?'\uD83C\uDF0D':'\uD83D\uDD12','04','RETURN HOME',
    fullLock?'Start from Launch in full mode':(progress.mission3Beaten?'Navigate back to Earth':'Complete Lunar Ascent first'),
    fullLock||!progress.mission3Beaten);
  drawCard('mission5',col2,row2Y,cW,cH,
    (!fullLock&&progress.mission4Beaten)?'\uD83E\uDE82':'\uD83D\uDD12','05','REENTRY',
    fullLock?'Start from Launch in full mode':(progress.mission4Beaten?'Survive reentry and splash down':'Complete Return Home first'),
    fullLock||!progress.mission4Beaten);

  ctx.textAlign='center';
  ctx.font='400 24px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle='rgba(100,130,180,0.5)';
  ctx.fillText('A/D \u00b7 Rotate   \u2003W/Space \u00b7 Thrust   \u2003E \u00b7 Prograde   \u2003Q \u00b7 Retrograde   \u20031\u20134 \u00b7 Warp   \u2003R \u00b7 Restart',CX,row2Y+cH+48);

  drawMusicAttrib(1); // title screen: always fully visible

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
    if (sc) {
      const sp=Math.max(0,dispPts.length-20);
      const isTD=sc.body==='TOUCHDOWN';
      const curSpd=Math.hypot(lRocket.vx,lRocket.vy);
      // TOUCHDOWN zone: on-pad; safe = current speed ok; warn = too fast
      const tdSafe=isTD&&curSpd<=LAND_SPEED_MAX;
      const tdWarn=isTD&&curSpd>LAND_SPEED_MAX;
      const tailCol=tdSafe?'rgba(74,222,128,0.85)':tdWarn?'rgba(251,191,36,0.85)':'rgba(255,80,80,0.75)';
      strokePath(dispPts.slice(0,sp),'rgba(251,211,77,0.45)',1.3,[6,6]);
      strokePath(dispPts.slice(sp),tailCol,2.0,[]);
      // Pass speed state into warning renderer
      drawCollisionWarning(Object.assign({},sc,{tdSafe,tdWarn}));
    } else strokePath(dispPts,'rgba(251,211,77,0.45)',1.3,[6,6]);
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
  drawFuelBar(fuelPct,rocket.fuel,{markers:[{pct:0.80,label:'TARGET',color:'#4ade80'}]});
  drawSpeedGauge(speed);
  drawTelemetryPills([{label:'EARTH',value:dE.toFixed(0)+' u'},{label:'MOON',value:dM.toFixed(0)+' u'},{label:'WARP',value:warp+'×'}]);
  drawCountdownOverlay();
  drawMusicAttrib();
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

function drawFuelBar(pct,fuelVal,opts) {
  opts = opts||{};
  const fc = pct>0.35?'#38bdf8':pct>0.15?'#fbbf24':'#f87171';
  const bw=540,bh=22,bx=W/2-270,by=H-58;
  ctx.save();

  // Track background
  ctx.fillStyle='rgba(255,255,255,0.06)';
  rrect(bx,by,bw,bh,6); ctx.fill();

  // Filled portion with glow
  if (pct>0) {
    ctx.shadowColor=fc; ctx.shadowBlur=10;
    ctx.fillStyle=fc; rrect(bx,by,bw*pct,bh,6); ctx.fill();
    ctx.shadowBlur=0;
  }

  // Inner highlight stripe
  if (pct>0.02) {
    ctx.fillStyle='rgba(255,255,255,0.10)';
    rrect(bx+2,by+3,bw*pct-4,6,3); ctx.fill();
  }

  // Thin border
  ctx.strokeStyle='rgba(100,140,255,0.18)'; ctx.lineWidth=1;
  rrect(bx,by,bw,bh,6); ctx.stroke();

  // Tick marks every 25%
  ctx.strokeStyle='rgba(255,255,255,0.12)'; ctx.lineWidth=1;
  [0.25,0.5,0.75].forEach(function(t){
    var tx=bx+bw*t;
    ctx.beginPath(); ctx.moveTo(tx,by+2); ctx.lineTo(tx,by+bh-2); ctx.stroke();
  });

  // Markers (e.g. stage sep, target fuel)
  if (opts.markers) {
    opts.markers.forEach(function(mk){
      var mx=bx+bw*mk.pct;
      var col=mk.color||'#facc15';
      // Vertical marker line (full bar height, extends above)
      ctx.strokeStyle=col; ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(mx,by-10); ctx.lineTo(mx,by+bh+4); ctx.stroke();
      // Diamond cap
      ctx.fillStyle=col;
      ctx.beginPath(); ctx.moveTo(mx,by-14); ctx.lineTo(mx+5,by-8); ctx.lineTo(mx,by-2); ctx.lineTo(mx-5,by-8); ctx.closePath(); ctx.fill();
      // Label above
      ctx.font='600 11px Inter,ui-sans-serif,sans-serif';
      ctx.fillStyle=col; ctx.textAlign='center';
      ctx.fillText(mk.label,mx,by-18);
    });
  }

  // Labels
  ctx.font='700 13px Inter,ui-sans-serif,sans-serif';
  ctx.fillStyle='rgba(100,130,180,0.7)'; ctx.textAlign='left';
  ctx.shadowBlur=0;
  ctx.fillText(opts.label||'FUEL',bx,by-6);
  ctx.textAlign='right'; ctx.fillStyle=fc;
  ctx.fillText(fuelVal.toFixed(0)+'%',bx+bw,by-6);
  ctx.textAlign='left'; ctx.restore();
}

// The gauge's static layer (background arcs, tick marks, end labels) only depends
// on MAX_SPD, so it is rendered once per scale into an offscreen canvas and blitted
// each frame instead of re-stroking ~100 ticks every frame.
const SPEED_GAUGE_PAD = 30;
const _gaugeCache = new Map();
function gaugeStaticLayer(MAX_SPD, gr) {
  let cached = _gaugeCache.get(MAX_SPD);
  if (cached) return cached;
  const size = (gr + SPEED_GAUGE_PAD) * 2;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const g = c.getContext('2d');
  const gx = gr + SPEED_GAUGE_PAD, gy = gr + SPEED_GAUGE_PAD;
  const startA = Math.PI*0.75, endA = Math.PI*2.25;
  g.beginPath(); g.arc(gx,gy,gr+2,startA,endA); g.strokeStyle='rgba(100,140,255,0.08)'; g.lineWidth=18; g.stroke();
  g.beginPath(); g.arc(gx,gy,gr,startA,endA); g.strokeStyle='rgba(255,255,255,0.07)'; g.lineWidth=12; g.lineCap='butt'; g.stroke();
  const tickStep=MAX_SPD<=100?10:100, majorEvery=MAX_SPD<=100?50:500;
  for (let v=0;v<=MAX_SPD;v+=tickStep) {
    const a=startA+(endA-startA)*(v/MAX_SPD), inner=v%majorEvery===0?gr-18:gr-12;
    g.beginPath(); g.moveTo(gx+Math.cos(a)*inner,gy+Math.sin(a)*inner); g.lineTo(gx+Math.cos(a)*(gr+2),gy+Math.sin(a)*(gr+2));
    g.strokeStyle=v%majorEvery===0?'rgba(180,200,255,0.5)':'rgba(180,200,255,0.2)'; g.lineWidth=v%majorEvery===0?2:1; g.stroke();
  }
  g.textAlign='center';
  g.font='600 11px Inter,ui-sans-serif,sans-serif'; g.fillStyle='rgba(180,200,255,0.3)';
  g.fillText(String(MAX_SPD),gx+Math.cos(endA)*(gr+16),gy+Math.sin(endA)*(gr+16)+4);
  g.fillText('0',gx+Math.cos(startA)*(gr+16),gy+Math.sin(startA)*(gr+16)+4);
  cached = { canvas: c };
  _gaugeCache.set(MAX_SPD, cached);
  return cached;
}

function drawSpeedGauge(speed, MAX_SPD=1000) {
  const gx=120,gy=H-118,gr=82;
  const startA=Math.PI*0.75,endA=Math.PI*2.25,pct=Math.min(speed/MAX_SPD,1);
  const fillEnd=startA+(endA-startA)*pct;
  const sc=speed<MAX_SPD*0.4?'#38bdf8':speed<MAX_SPD*0.7?'#fbbf24':'#f87171';
  ctx.save();
  ctx.drawImage(gaugeStaticLayer(MAX_SPD,gr).canvas, gx-(gr+SPEED_GAUGE_PAD), gy-(gr+SPEED_GAUGE_PAD));
  if (pct>0) { ctx.beginPath(); ctx.arc(gx,gy,gr,startA,fillEnd); ctx.strokeStyle=sc; ctx.lineWidth=12; ctx.lineCap='round'; ctx.stroke(); }
  ctx.beginPath(); ctx.arc(gx+Math.cos(fillEnd)*gr,gy+Math.sin(fillEnd)*gr,7,0,Math.PI*2); ctx.fillStyle=sc; ctx.fill();
  ctx.textAlign='center';
  ctx.font='800 28px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=sc; ctx.fillText(speed.toFixed(0),gx,gy+10);
  ctx.font='600 12px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle='#4a6080'; ctx.fillText('u/s',gx,gy+28);
  ctx.textAlign='left'; ctx.restore();
}

// Bottom-row telemetry pills. items: [{label, value, color?}]
function drawTelemetryPills(items) {
  const pw=130,ph=44,gap=10,sx=230,sy=H-80;
  ctx.save();
  items.forEach((item,i) => {
    const x=sx+i*(pw+gap),y=sy;
    ctx.fillStyle='rgba(6,10,24,0.82)'; ctx.strokeStyle='rgba(100,140,255,0.15)'; ctx.lineWidth=1;
    rrect(x,y,pw,ph,8); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#4a6080'; ctx.font='600 11px Inter,ui-sans-serif,sans-serif'; ctx.fillText(item.label,x+10,y+14);
    ctx.fillStyle=item.color||'#ccddf8'; ctx.font='700 16px Inter,ui-sans-serif,sans-serif'; ctx.fillText(item.value,x+10,y+33);
  });
  ctx.restore();
}

// Mission-complete "hold orbit" countdown ring (bottom-right). rgb = "r,g,b" string.
function drawHoldRing(timer, holdMax, rgb) {
  const rem=Math.max(0,holdMax-timer), prog=timer/holdMax;
  const cx2=W-130,cy2=H-130,radius=90,pulse=0.85+0.15*Math.sin(Date.now()/300);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx2,cy2,radius,-Math.PI/2,-Math.PI/2+Math.PI*2); ctx.strokeStyle=`rgba(${rgb},0.12)`; ctx.lineWidth=14; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx2,cy2,radius,-Math.PI/2,-Math.PI/2+Math.PI*2*prog); ctx.strokeStyle=`rgba(${rgb},${(0.7*pulse).toFixed(2)})`; ctx.lineWidth=14; ctx.lineCap='round'; ctx.stroke();
  ctx.textAlign='center';
  ctx.font='800 72px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=`rgba(${rgb},${pulse.toFixed(2)})`; ctx.fillText(rem>0?Math.ceil(rem):'\u2713',cx2,cy2+24);
  ctx.font='700 18px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle=`rgba(${rgb},0.6)`; ctx.fillText('HOLD ORBIT',cx2,cy2+60);
  ctx.textAlign='left'; ctx.restore();
}

function drawCountdownOverlay() {
  if (state.outcome!=='playing'||state.stableTimer<=0) return;
  drawHoldRing(state.stableTimer, STABLE_HOLD, '134,239,172');
}

function drawOrbitOutcomeBanner(){
  if(state.outcome==='playing'||state.outcome==='win')return;drawOutcomeBanner(state.outcome,state.message,{retryKey:'retryGame',retryLabel:'\u21ba Retry',winLine1:'\uD83C\uDF0D  LUNAR ORBIT ACHIEVED',winLine2:'MISSION COMPLETE',hint:'Hold stable lunar orbit for 60 seconds'});
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
  drawFuelBar(fuelPct,lRocket.fuel,{markers:[{pct:0.60,label:'TARGET',color:'#4ade80'}]});

  // Speed gauge scaled to landing speeds
  drawSpeedGauge(speed, 100);

  // Vertical speed: radial component toward Moon surface (positive = descending)
  const surfNx=(lRocket.x-CX)/Math.max(distToMoon,1);
  const surfNy=(lRocket.y-CY)/Math.max(distToMoon,1);
  const descentRate=-(lRocket.vx*surfNx+lRocket.vy*surfNy);

  // Landing-specific telemetry pills (speed pill removed — gauge covers it)
  { const altColor=alt<80?'#f87171':alt<200?'#fbbf24':'#38bdf8';
    const vsColor=descentRate>80?'#f87171':descentRate>20?'#fbbf24':'#4ade80';
    drawTelemetryPills([
      {label:'ALT',value:alt.toFixed(0)+' u',color:altColor},
      {label:'V-SPEED',value:(descentRate>=0?'\u25bc ':' \u25b2 ')+Math.abs(descentRate).toFixed(0),color:vsColor},
      {label:'WARP',value:warp+'\u00d7',color:'#ccddf8'},
    ]); }

  drawMusicAttrib();
  drawLandingOutcomeBanner();
}

function drawLandingOutcomeBanner(){
  if(lState.outcome==='playing'||lState.outcome==='win')return;drawOutcomeBanner(lState.outcome,lState.message,{retryKey:'retryLanding',retryLabel:'\u21ba Retry',winLine1:'\uD83C\uDF15  TOUCHDOWN!',winLine2:'MISSION COMPLETE',hint:'Aim for the LZ below '+LAND_SPEED_MAX+' u/s'});
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
    const pred=m3State.launched?predictM3Path():{pts:[],collision:null}, pts=pred.pts;
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
  drawFuelBar(fuelPct,m3Rocket.fuel,{markers:[{pct:0.40,label:'TARGET',color:'#4ade80'}]});
  drawSpeedGauge(speed,400);

  // Hold countdown ring
  if (m3State.outcome==='playing'&&m3State.stableTimer>0) drawHoldRing(m3State.stableTimer, M3_HOLD, '134,239,172');

  // Pills
  { const altC=alt<80?'#f87171':alt<200?'#fbbf24':'#38bdf8';
    const distC=inBand?'#4ade80':(dist<M3_ORBIT_MIN?'#f87171':'#fbbf24');
    drawTelemetryPills([{label:'ALT',value:alt.toFixed(0)+' u',color:altC},{label:'ORBIT R',value:dist.toFixed(0)+' u',color:distC},{label:'WARP',value:warp+'\u00d7',color:'#ccddf8'}]); }

  drawMusicAttrib();
  drawM3OutcomeBanner();
}

function drawM3OutcomeBanner(){
  if (transition.active) return;
  drawOutcomeBanner(m3State.outcome,m3State.message,{retryKey:'retryM3',retryLabel:'\u21ba Retry',winLine1:'\uD83D\uDE80  LUNAR ORBIT ACHIEVED',winLine2:'MISSION COMPLETE — PREPARE FOR RETURN',hint:'Reach the orbit band and hold for 60s'});
}



// ════════════════════════════════════════════════════════════════════════════
// M4 — RETURN TO EARTH
// ════════════════════════════════════════════════════════════════════════════

const M4_STABLE_R   = 130;
const M4_STABLE_MIN = 60;

function resetM4(startFuel) {
  if (startFuel === undefined) startFuel = 100;
  collisionFilter.reset(); pathLengthFilter.reset(); camera.reset();
  uiHitBoxes.retryM4 = null; uiHitBoxes.backToTitle = null;
  var a0=0, moon=moonXY(a0), midR=(M3_ORBIT_MIN+M3_ORBIT_MAX)/2, spA=-Math.PI/2;
  var vC=Math.sqrt(G*MOON_MASS/midR);
  var mvx=-Math.sin(a0)*MOON_ORBIT*MOON_OMEGA, mvy=Math.cos(a0)*MOON_ORBIT*MOON_OMEGA;
  m4State={warpIdx:0,moonAngle:a0,earthAngle:0,orientMode:'retrograde',outcome:'playing',
    message:'IN LUNAR ORBIT \u2014 BURN RETROGRADE TO RETURN HOME',stableTimer:0,trail:[],missionStartTime:performance.now(),maxSpeed:0};
  m4Rocket={x:moon.x+Math.cos(spA)*midR,y:moon.y+Math.sin(spA)*midR,
    vx:-Math.sin(spA)*vC+mvx,vy:Math.cos(spA)*vC+mvy,angle:spA+Math.PI/2,fuel:startFuel};
  document.getElementById('btn-prograde')?.classList.toggle('pressed',false);
  document.getElementById('btn-retrograde')?.classList.toggle('pressed',true);
}

function endM4(o,m){m4State.outcome=o;m4State.message=m;}

function evalM4State(dE,dM,realDt) {
  if (dE<=EARTH_R+5) return endM4('lose','CRASHED INTO EARTH');
  if (dM<=MOON_R+5)  return endM4('lose','CRASHED INTO THE MOON');
  if (Math.hypot(m4Rocket.x-CX,m4Rocket.y-CY)>ESCAPE_DIST) return endM4('lose','LOST IN SPACE');
  if (m4Rocket.fuel<=0&&dE>M4_STABLE_R) return endM4('lose','OUT OF FUEL');
  var inB=dE>=M4_STABLE_MIN&&dE<=M4_STABLE_R;
  if (inB) {
    m4State.stableTimer+=realDt;
    var rem=Math.max(0,M4_HOLD-m4State.stableTimer);
    m4State.message=rem>0?'HOLDING EARTH ORBIT\u2026':'EARTH ORBIT ACHIEVED!';
    if (m4State.stableTimer>=M4_HOLD&&!transition.active){
      endM4('win','MISSION COMPLETE');
      missionLog.m4={time:(performance.now()-m4State.missionStartTime)/1000,fuel:m4Rocket.fuel,maxSpeed:m4State.maxSpeed};
      progress.unlockMission4();
      var _m5f=m4Rocket.fuel; m5EntryFuel=_m5f;
      transition.start(function(){scene='m5';resetM5(_m5f);musicPlayScene('m5'); musicAttribShow();});
    }
  } else {
    m4State.stableTimer=0;
    var dE2=Math.hypot(m4Rocket.x-CX,m4Rocket.y-CY);
    var mn=moonXY(m4State.moonAngle),dM2=Math.hypot(m4Rocket.x-mn.x,m4Rocket.y-mn.y);
    if (dE2<150) m4State.message='APPROACHING EARTH \u2014 CIRCULARISE ORBIT';
    else if (dM2<200) m4State.message='DEPARTING LUNAR ORBIT \u2014 BURN FOR EARTH';
    else m4State.message='TRANS-EARTH INJECTION \u2014 COAST TO EARTH';
  }
}

function updateM4Physics(realDt) {
  var warp=WARP_LEVELS[m4State.warpIdx],simDt=realDt*TIME_SCALE*warp,NSUB=warp*2,dt=simDt/NSUB;
  var left=keys.has('ArrowLeft')||keys.has('KeyA'),right=keys.has('ArrowRight')||keys.has('KeyD');
  var thr=(keys.has('ArrowUp')||keys.has('KeyW')||keys.has('Space'))&&m4Rocket.fuel>0;
  m4State.earthAngle+=0.105*realDt;
  if (left||right) { m4State.orientMode=null;
    document.getElementById('btn-prograde')?.classList.remove('pressed');
    document.getElementById('btn-retrograde')?.classList.remove('pressed');
  }
  if (left)  m4Rocket.angle-=ROT_SPEED*realDt*warp;
  if (right) m4Rocket.angle+=ROT_SPEED*realDt*warp;
  if (m4State.orientMode&&!left&&!right) {
    var pro=Math.atan2(m4Rocket.vy,m4Rocket.vx),tgt=m4State.orientMode==='prograde'?pro:pro+Math.PI;
    var d=((tgt-m4Rocket.angle+Math.PI*3)%(Math.PI*2))-Math.PI,step=ROT_SPEED*1.5*realDt;
    if (Math.abs(d)<step) m4Rocket.angle=tgt; else m4Rocket.angle+=Math.sign(d)*step;
  }
  for (var s=0;s<NSUB;s++) {
    if (m4State.outcome!=='playing') break;
    m4State.moonAngle+=MOON_OMEGA*dt;
    var moon=moonXY(m4State.moonAngle),gE=gravAccel(CX,CY,EARTH_MASS,m4Rocket.x,m4Rocket.y),gM=gravAccel(moon.x,moon.y,MOON_MASS,m4Rocket.x,m4Rocket.y);
    if (thr){m4Rocket.vx+=Math.cos(m4Rocket.angle)*THRUST*dt;m4Rocket.vy+=Math.sin(m4Rocket.angle)*THRUST*dt;m4Rocket.fuel=Math.max(0,m4Rocket.fuel-FUEL_DRAIN*dt);}
    m4Rocket.vx+=(gE.ax+gM.ax)*dt;m4Rocket.vy+=(gE.ay+gM.ay)*dt;m4Rocket.x+=m4Rocket.vx*dt;m4Rocket.y+=m4Rocket.vy*dt;
    {var _s=Math.hypot(m4Rocket.vx,m4Rocket.vy);if(_s>m4State.maxSpeed)m4State.maxSpeed=_s;}
    var last=m4State.trail[m4State.trail.length-1];
    if (!last||Math.hypot(m4Rocket.x-last.x,m4Rocket.y-last.y)>3){m4State.trail.push({x:m4Rocket.x,y:m4Rocket.y});if(m4State.trail.length>TRAIL_MAX)m4State.trail.shift();}
  }
  // evalM4State called once per frame (not per substep) to avoid stableTimer running N× too fast at warp N
  if (m4State.outcome==='playing') {
    var moon=moonXY(m4State.moonAngle),gE=gravAccel(CX,CY,EARTH_MASS,m4Rocket.x,m4Rocket.y),gM=gravAccel(moon.x,moon.y,MOON_MASS,m4Rocket.x,m4Rocket.y);
    evalM4State(gE.dist,gM.dist,realDt);
  }
}

function predictM4Path() {
  var px=m4Rocket.x,py=m4Rocket.y,pvx=m4Rocket.vx,pvy=m4Rocket.vy,pA=m4State.moonAngle,pts=[],col=null,subDt=PRED_DT/PRED_SUBSTEPS;
  for (var i=0;i<PRED_STEPS;i++) {
    var hit=false;
    for (var s=0;s<PRED_SUBSTEPS;s++) {
      var px0=px,py0=py;pA+=MOON_OMEGA*subDt;
      var m=moonXY(pA),gE=gravAccel(CX,CY,EARTH_MASS,px,py),gM=gravAccel(m.x,m.y,MOON_MASS,px,py);
      pvx+=(gE.ax+gM.ax)*subDt;pvy+=(gE.ay+gM.ay)*subDt;px+=pvx*subDt;py+=pvy*subDt;
      if (gE.dist<EARTH_R){var sp=surfacePoint(px0,py0,px,py,CX,CY,EARTH_R);col={x:sp.x,y:sp.y,body:'EARTH'};pts.push(sp);hit=true;break;}
      var mN=moonXY(pA),md=Math.hypot(px-mN.x,py-mN.y);
      if (md<MOON_R){var sp2=surfacePoint(px0,py0,px,py,mN.x,mN.y,MOON_R);col={x:sp2.x,y:sp2.y,body:'MOON'};pts.push(sp2);hit=true;break;}
      if (Math.hypot(px-CX,py-CY)>ESCAPE_DIST+80||gE.dist<2||md<2){hit=true;break;}
    }
    if (hit) break; pts.push({x:px,y:py});
  }
  return {pts:pts,collision:col};
}

function renderM4() {
  ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.setLineDash([]);
  ctx.fillStyle='#040814';ctx.fillRect(0,0,W,H);
  var moon=moonXY(m4State.moonAngle);
  for (var i=0;i<STARS.length;i++){var s=STARS[i];ctx.globalAlpha=s.a;ctx.fillStyle='#dbeafe';ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill();}
  ctx.globalAlpha=1;
  ctx.save();
  ctx.lineWidth=1;ctx.strokeStyle='rgba(100,130,255,0.18)';ctx.beginPath();ctx.arc(CX,CY,MOON_ORBIT,0,Math.PI*2);ctx.stroke();
  var dE2=Math.hypot(m4Rocket.x-CX,m4Rocket.y-CY),inB=dE2>=M4_STABLE_MIN&&dE2<=M4_STABLE_R;
  ctx.save();ctx.setLineDash([5,8]);
  ctx.strokeStyle=inB?'rgba(96,165,250,0.9)':'rgba(96,165,250,0.25)';ctx.lineWidth=inB?2.5:1.0;
  ctx.beginPath();ctx.arc(CX,CY,M4_STABLE_R,0,Math.PI*2);ctx.stroke();
  ctx.beginPath();ctx.arc(CX,CY,M4_STABLE_MIN,0,Math.PI*2);ctx.stroke();
  ctx.setLineDash([]);ctx.restore();
  var dx=CX-SUN_X,dy=CY-SUN_Y,dl=Math.hypot(dx,dy),nx=dx/dl,ny=dy/dl,cL=600,cpx=-ny,cpy=nx,tip={x:CX+nx*cL,y:CY+ny*cL};
  ctx.save();var cg=ctx.createLinearGradient(CX,CY,tip.x,tip.y);
  cg.addColorStop(0,'rgba(0,0,20,0.38)');cg.addColorStop(0.35,'rgba(0,0,20,0.18)');cg.addColorStop(0.7,'rgba(0,0,20,0.07)');cg.addColorStop(1,'rgba(0,0,20,0)');
  ctx.beginPath();ctx.moveTo(CX+cpx*EARTH_R,CY+cpy*EARTH_R);ctx.lineTo(tip.x+cpx*EARTH_R*0.96,tip.y+cpy*EARTH_R*0.96);ctx.lineTo(tip.x-cpx*EARTH_R*0.96,tip.y-cpy*EARTH_R*0.96);ctx.lineTo(CX-cpx*EARTH_R,CY-cpy*EARTH_R);ctx.closePath();ctx.fillStyle=cg;ctx.fill();ctx.restore();
  var atm=ctx.createRadialGradient(CX,CY,EARTH_R*0.7,CX,CY,EARTH_R*2.6);
  atm.addColorStop(0,'rgba(96,165,250,0.22)');atm.addColorStop(0.55,'rgba(59,130,246,0.18)');atm.addColorStop(1,'rgba(59,130,246,0)');
  ctx.fillStyle=atm;ctx.beginPath();ctx.arc(CX,CY,EARTH_R*2.6,0,Math.PI*2);ctx.fill();
  var eg=ctx.createRadialGradient(CX-10,CY-12,4,CX,CY,EARTH_R+4);
  eg.addColorStop(0,'#93c5fd');eg.addColorStop(0.45,'#3b82f6');eg.addColorStop(0.8,'#1d4ed8');eg.addColorStop(1,'#172554');
  ctx.fillStyle=eg;ctx.beginPath();ctx.arc(CX,CY,EARTH_R,0,Math.PI*2);ctx.fill();
  ctx.save();ctx.beginPath();ctx.arc(CX,CY,EARTH_R,0,Math.PI*2);ctx.clip();ctx.translate(CX,CY);ctx.rotate(m4State.earthAngle);ctx.translate(-CX,-CY);
  ctx.fillStyle='#4ade80';ctx.beginPath();ctx.ellipse(CX-9,CY-6,11,7,0.45,0,Math.PI*2);ctx.ellipse(CX-2,CY+4,7,5,0.15,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#22c55e';ctx.beginPath();ctx.ellipse(CX+9,CY+7,8,5,-0.35,0,Math.PI*2);ctx.ellipse(CX+4,CY-10,5,3,0.1,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.42)';ctx.beginPath();ctx.ellipse(CX-6,CY-11,9,2.6,0.2,0,Math.PI*2);ctx.ellipse(CX+10,CY-2,7,2.2,-0.25,0,Math.PI*2);ctx.ellipse(CX-2,CY+12,8,2.4,0.1,0,Math.PI*2);ctx.fill();ctx.restore();
  drawShadow(CX,CY,EARTH_R,SUN_X,SUN_Y);
  ctx.strokeStyle='rgba(191,219,254,0.45)';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(CX,CY,EARTH_R+1,0,Math.PI*2);ctx.stroke();
  var mg=ctx.createRadialGradient(moon.x,moon.y,3,moon.x,moon.y,26);
  mg.addColorStop(0,'rgba(220,220,220,0.5)');mg.addColorStop(1,'rgba(220,220,220,0)');
  ctx.fillStyle=mg;ctx.beginPath();ctx.arc(moon.x,moon.y,26,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#9ca3af';ctx.beginPath();ctx.arc(moon.x,moon.y,MOON_R,0,Math.PI*2);ctx.fill();
  ctx.save();ctx.translate(moon.x,moon.y);ctx.rotate(m4State.moonAngle+Math.PI/2);
  ctx.fillStyle='#6b7280';ctx.beginPath();ctx.arc(-3,-2,3,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(4,3,2,0,Math.PI*2);ctx.fill();ctx.restore();
  drawShadow(moon.x,moon.y,MOON_R,SUN_X,SUN_Y);
  strokePath(m4State.trail,'rgba(125,211,252,0.5)',1.5,[]);
  if (m4State.outcome==='playing'){
    var pred=predictM4Path(),pts=pred.pts,sc=collisionFilter.update(pred.collision),dp=pts.slice(0,pathLengthFilter.update(pts.length));
    if (sc){var sp=Math.max(0,dp.length-20);strokePath(dp.slice(0,sp),'rgba(251,211,77,0.55)',1.3,[6,6]);strokePath(dp.slice(sp),'rgba(255,80,80,0.75)',2.0,[]);drawCollisionWarning(sc);}
    else strokePath(dp,'rgba(251,211,77,0.55)',1.3,[6,6]);
  }
  drawRocket(m4Rocket.x,m4Rocket.y,m4Rocket.angle,m4State.outcome==='playing'&&m4Rocket.fuel>0&&(keys.has('ArrowUp')||keys.has('KeyW')||keys.has('Space')));
  ctx.restore();
  drawM4HUD(moon);
}

function drawM4HUD(moon) {
  var speed=Math.hypot(m4Rocket.vx,m4Rocket.vy),dE=Math.hypot(m4Rocket.x-CX,m4Rocket.y-CY);
  var dM=Math.hypot(m4Rocket.x-moon.x,m4Rocket.y-moon.y),warp=WARP_LEVELS[m4State.warpIdx];
  var fuelPct=Math.max(0,Math.min(1,m4Rocket.fuel/100));
  if (m4State.outcome==='playing') drawStatusBar(m4State.message);
  drawFuelBar(fuelPct,m4Rocket.fuel,{markers:[{pct:0.20,label:'TARGET',color:'#4ade80'}]});
  drawSpeedGauge(speed);
  if (m4State.outcome==='playing'&&m4State.stableTimer>0) drawHoldRing(m4State.stableTimer, M4_HOLD, '96,165,250');
  drawTelemetryPills([{label:'EARTH',value:dE.toFixed(0)+' u'},{label:'MOON',value:dM.toFixed(0)+' u'},{label:'WARP',value:warp+'\u00d7'}]);
  drawMusicAttrib();
  drawM4OutcomeBanner();
}

function drawM4OutcomeBanner(){
  if (transition.active) return;
  drawOutcomeBanner(m4State.outcome,m4State.message,{retryKey:'retryM4',retryLabel:'\u21ba Retry',winLine1:'\uD83C\uDF0D  EARTH ORBIT ACHIEVED',winLine2:'MISSION COMPLETE — WELCOME HOME',hint:'Navigate back to Earth orbit and hold'});
}


// ════════════════════════════════════════════════════════════════════════════
// M0 — LAUNCH TO EARTH ORBIT
// ════════════════════════════════════════════════════════════════════════════

function resetM0() {
  collisionFilter.reset(); pathLengthFilter.reset();
  uiHitBoxes.retryM0 = null; uiHitBoxes.backToTitle = null;
  m0State = {
    warpIdx: 0, orientMode: null, outcome: 'playing',
    message: 'IGNITION \u2014 BURN PROGRADE TO REACH ORBIT',
    trail: [], stableTimer: 0, stage: 1,
    stage1: null, // falling stage object {x,y,vx,vy}
    launched: false,
    missionStartTime: performance.now(), maxSpeed: 0,
  };
  m0Rocket = { x: CX, y: H-35, vx: 0, vy: 0, angle: -Math.PI/2, fuel: 100 };
  document.getElementById('btn-prograde')?.classList.toggle('pressed', false);
  document.getElementById('btn-retrograde')?.classList.toggle('pressed', false);
}

function endM0(o,m){m0State.outcome=o;m0State.message=m;}

function updateM0Physics(realDt) {
  var warp=WARP_LEVELS[m0State.warpIdx],simDt=realDt*TIME_SCALE*warp,NSUB=warp*2,dt=simDt/NSUB;
  var left=keys.has('ArrowLeft')||keys.has('KeyA'),right=keys.has('ArrowRight')||keys.has('KeyD');
  var thr=(keys.has('ArrowUp')||keys.has('KeyW')||keys.has('Space'))&&m0Rocket.fuel>0&&m0State.outcome==='playing';

  var M0_ROT = ROT_SPEED * 0.25; // heavy rocket turns slowly
  if (left||right) {
    m0State.orientMode=null;
    document.getElementById('btn-prograde')?.classList.remove('pressed');
    document.getElementById('btn-retrograde')?.classList.remove('pressed');
  }
  if (m0State.launched) {
    if (left)  m0Rocket.angle-=M0_ROT*realDt*warp;
    if (right) m0Rocket.angle+=M0_ROT*realDt*warp;
  }
  if (m0State.launched&&m0State.orientMode&&!left&&!right) {
    var pro=Math.atan2(m0Rocket.vy,m0Rocket.vx),tgt=m0State.orientMode==='prograde'?pro:pro+Math.PI;
    var d=((tgt-m0Rocket.angle+Math.PI*3)%(Math.PI*2))-Math.PI,step=M0_ROT*1.5*realDt;
    if (Math.abs(d)<step) m0Rocket.angle=tgt; else m0Rocket.angle+=Math.sign(d)*step;
  }

  for (var s=0;s<NSUB;s++) {
    if (m0State.outcome!=='playing') break;

    // Stage separation
    if (m0State.stage===1&&m0Rocket.fuel<=M0_STAGE_SPLIT) {
      m0State.stage=2;
      m0State.stage1={x:m0Rocket.x,y:m0Rocket.y,vx:m0Rocket.vx*0.9,vy:m0Rocket.vy+30};
    }

    // Thrust
    var thrust=m0State.stage===1?M0_S1_THRUST:M0_S2_THRUST;
    if (thr) {
      m0State.launched=true;
      m0Rocket.vx+=Math.cos(m0Rocket.angle)*thrust*dt;
      m0Rocket.vy+=Math.sin(m0Rocket.angle)*thrust*dt;
      m0Rocket.fuel=Math.max(0,m0Rocket.fuel-M0_FUEL_DRAIN*dt);
    }

    // Skip all physics until first thrust
    if (!m0State.launched) continue;

    // Constant gravity straight down (ballistic feel)
    m0Rocket.vy+=M0_GRAVITY*dt;

    // Atmospheric drag — exponential with altitude
    var alt=m0AltRocket();
    var density=Math.exp(-Math.max(0,alt)/M0_ATMO_SCALE);
    var speed=Math.hypot(m0Rocket.vx,m0Rocket.vy);
    if (speed>0) {
      var drag=M0_DRAG_CD*density*speed*dt;
      m0Rocket.vx-=(m0Rocket.vx/speed)*drag;
      m0Rocket.vy-=(m0Rocket.vy/speed)*drag;
    }

    m0Rocket.x+=m0Rocket.vx*dt; m0Rocket.y+=m0Rocket.vy*dt;
    {var _s=Math.hypot(m0Rocket.vx,m0Rocket.vy);if(_s>m0State.maxSpeed)m0State.maxSpeed=_s;}

    // Falling stage 1 — simple gravity, no drag
    if (m0State.stage1) {
      m0State.stage1.vy+=M0_GRAVITY*dt;
      m0State.stage1.x+=m0State.stage1.vx*dt;
      m0State.stage1.y+=m0State.stage1.vy*dt;
    }

    var last=m0State.trail[m0State.trail.length-1];
    if (!last||Math.hypot(m0Rocket.x-last.x,m0Rocket.y-last.y)>3){m0State.trail.push({x:m0Rocket.x,y:m0Rocket.y});if(m0State.trail.length>TRAIL_MAX)m0State.trail.shift();}
    evalM0State(alt);
  }

  // Per-frame hold timer
  if (m0State.outcome==='playing') {
    var alt2=m0AltRocket();
    // hFrac = fraction of velocity that is tangential (perpendicular to radial = "horizontal" along curvature)
    var eCY2=H+M0_EARTH_R-30, rdx=m0Rocket.x-CX, rdy=m0Rocket.y-eCY2;
    var rLen=Math.hypot(rdx,rdy)||1, rNx=rdx/rLen, rNy=rdy/rLen;
    var spd=Math.hypot(m0Rocket.vx,m0Rocket.vy);
    var radialV=m0Rocket.vx*rNx+m0Rocket.vy*rNy;
    var tangV=Math.sqrt(Math.max(0,spd*spd-radialV*radialV));
    var hFrac=spd>0?tangV/spd:0;
    var inBand=alt2>=M0_TARGET_MIN&&alt2<=M0_TARGET_MAX&&hFrac>=M0_HORIZ_MIN;
    if (inBand) {
      m0State.stableTimer+=realDt;
      var rem=Math.max(0,M0_HOLD-m0State.stableTimer);
      m0State.message=rem>0?'DOWNRANGE — HOLD TRAJECTORY…':'ORBIT ACHIEVED!';
      if (m0State.stableTimer>=M0_HOLD&&!transition.active) {
        endM0('win','ORBIT ACHIEVED');
        progress.unlockMission0();
        missionLog.m0={time:(performance.now()-m0State.missionStartTime)/1000,fuel:m0Rocket.fuel,maxSpeed:m0State.maxSpeed};
        m0OrbitDir = m0Rocket.vx < 0 ? -1 : 1; // west launch (vx<0) → CCW (dir=-1), east → CW (dir=1)
        transition.start(function(){scene='orbit';resetGame();musicPlayScene('orbit'); musicAttribShow();});
      }
    } else {
      m0State.stableTimer=0;
      if (m0State.outcome==='playing') {
        if (alt2<80)                   m0State.message='IGNITION — BURN PROGRADE';
        else if (alt2<M0_TARGET_MIN)   m0State.message='PITCH OVER — GO DOWNRANGE';
        else if (hFrac<M0_HORIZ_MIN)   m0State.message='MORE HORIZONTAL — PITCH OVER';
        else if (m0Rocket.fuel<=0)     m0State.message='OUT OF FUEL';
        else                           m0State.message='HOLD TRAJECTORY';
      }
    }
  }
}

function m0AltRocket() {
  // Radial distance from Earth center minus Earth radius = altitude above surface
  var eCY = H + M0_EARTH_R - 30;
  return Math.hypot(m0Rocket.x - CX, m0Rocket.y - eCY) - M0_EARTH_R;
}

function evalM0State(alt) {
  if (!m0State.launched) return;
  if (alt < -5)   return endM0('lose','CRASHED INTO EARTH');
  if (alt > M0_EARTH_R) return endM0('lose','LOST IN SPACE');
  if (m0Rocket.fuel<=0 && alt < M0_TARGET_MIN) return endM0('lose','OUT OF FUEL');
}

function renderM0() {
  ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.setLineDash([]);

  // ── Camera: follow rocket, keep it at 65% down / 50% across ─────────────
  var camX = CX - m0Rocket.x;          // horizontal follow
  var targetY = H * 0.65;
  var camY = targetY - m0Rocket.y;      // vertical follow
  // On ground, don't scroll below launch position
  camY = Math.min(camY, 0);

  // Altitude for effects
  var alt = m0AltRocket();

  // Sky gradient (fixed, behind world)
  var sky=ctx.createLinearGradient(0,0,0,H);
  sky.addColorStop(0,'#020610'); sky.addColorStop(0.35,'#0a1a3a');
  sky.addColorStop(0.75,'#1a4a8a'); sky.addColorStop(1,'#2a6ac0');
  ctx.fillStyle=sky; ctx.fillRect(0,0,W,H);

  // Stars (fade in with altitude)
  var starAlpha=Math.min(1,alt/500);
  for (var i=0;i<STARS.length;i++) {
    var s=STARS[i]; ctx.globalAlpha=s.a*starAlpha; ctx.fillStyle='#dbeafe';
    ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha=1;

  // ── World transform ──────────────────────────────────────────────────────
  ctx.save();
  ctx.translate(camX, camY);

  // Earth arc
  var eCY = H + M0_EARTH_R - 30;
  var eg=ctx.createRadialGradient(CX,eCY,M0_EARTH_R*0.98,CX,eCY,M0_EARTH_R*1.04);
  eg.addColorStop(0,'rgba(59,130,246,0.25)'); eg.addColorStop(1,'rgba(59,130,246,0)');
  ctx.fillStyle=eg; ctx.beginPath(); ctx.arc(CX,eCY,M0_EARTH_R*1.04,0,Math.PI*2); ctx.fill();
  var eb=ctx.createRadialGradient(CX,eCY,M0_EARTH_R*0.3,CX,eCY,M0_EARTH_R);
  eb.addColorStop(0,'#60a5fa'); eb.addColorStop(0.4,'#3b82f6'); eb.addColorStop(0.8,'#1d4ed8'); eb.addColorStop(1,'#172554');
  ctx.fillStyle=eb; ctx.beginPath(); ctx.arc(CX,eCY,M0_EARTH_R,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle='rgba(147,197,253,0.35)'; ctx.lineWidth=3;
  ctx.beginPath(); ctx.arc(CX,eCY,M0_EARTH_R+1,0,Math.PI*2); ctx.stroke();

  // Target corridor — circular arcs centred on Earth
  ctx.save(); ctx.setLineDash([8,14]);
  ctx.strokeStyle='rgba(134,239,172,0.35)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(CX,eCY,M0_EARTH_R+M0_TARGET_MIN,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(CX,eCY,M0_EARTH_R+M0_TARGET_MAX,0,Math.PI*2); ctx.stroke();
  ctx.setLineDash([]);
  // Subtle corridor fill
  ctx.globalAlpha=0.04; ctx.fillStyle='#86efac';
  ctx.beginPath(); ctx.arc(CX,eCY,M0_EARTH_R+M0_TARGET_MAX,0,Math.PI*2); ctx.fill();
  ctx.globalAlpha=1;
  ctx.restore();

  // Falling stage 1
  if (m0State.stage1) {
    var st=m0State.stage1;
    ctx.save(); ctx.translate(st.x,st.y);
    ctx.rotate(Math.atan2(st.vy,st.vx)+Math.PI);
    ctx.fillStyle='rgba(150,160,180,0.7)';
    ctx.fillRect(-4,-3,22,6); ctx.restore();
  }

  // Trail
  strokePath(m0State.trail,'rgba(125,211,252,0.4)',1.5,[]);

  // Launch complex (only before launch)
  drawM0LaunchComplex();

  // Rocket
  drawM0Rocket();

  ctx.restore(); // end world transform

  drawM0HUD();
}


function drawM0LaunchComplex() {
  var bx = CX, by = H - 35;
  ctx.save();

  // Launch mount — small square base
  ctx.fillStyle = '#4a4540';
  ctx.fillRect(bx - 18, by - 10, 36, 10);

  // Hold-down arms
  ctx.strokeStyle = '#78716c'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(bx - 10, by - 10); ctx.lineTo(bx - 8, by - 44); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bx + 10, by - 10); ctx.lineTo(bx + 8, by - 44); ctx.stroke();
  ctx.lineCap = 'butt';

  // Service tower — right side, simple lattice
  var tx = bx + 36, ty = by - 10, tH = 140;
  ctx.strokeStyle = '#64748b'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(tx,    ty); ctx.lineTo(tx,    ty - tH); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tx+12, ty); ctx.lineTo(tx+12, ty - tH); ctx.stroke();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#475569';
  for (var y = 0; y < tH; y += 24) {
    ctx.beginPath(); ctx.moveTo(tx, ty-y); ctx.lineTo(tx+12, ty-y-24); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx+12, ty-y); ctx.lineTo(tx, ty-y-24); ctx.stroke();
  }

  // Access arm at mid-height
  ctx.strokeStyle = '#64748b'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(tx, ty - tH*0.55); ctx.lineTo(bx + 8, ty - tH*0.55); ctx.stroke();

  // Lightning mast
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(tx+6, ty-tH); ctx.lineTo(tx+6, ty-tH-28); ctx.stroke();

  ctx.restore();
}

function drawM0Rocket() {
  var thr=(keys.has('ArrowUp')||keys.has('KeyW')||keys.has('Space'))&&m0Rocket.fuel>0&&m0State.outcome==='playing';
  ctx.save(); ctx.translate(m0Rocket.x,m0Rocket.y); ctx.rotate(m0Rocket.angle);
  // local +x = UP on canvas (nose direction), local -x = DOWN (tail/Earth)
  // Translate to center of mass so rotation feels natural
  // Stage 1 attached: spans -42..+16 = 58u, CM at midpoint -13 → shift +13
  // Stage 2 only:     spans  -6..+16 = 22u, CM at midpoint  +5 → shift  -5
  ctx.translate(m0State.stage===1 ? 42 : 6, 0); // pivot at nozzle

  // Stage 1 body (tail direction = -x, toward Earth)
  if (m0State.stage===1) {
    ctx.fillStyle='#64748b';
    ctx.fillRect(-34,-5,28,10);
    ctx.fillStyle='#475569';
    ctx.beginPath(); ctx.moveTo(-34,-5); ctx.lineTo(-42,-8); ctx.lineTo(-42,8); ctx.lineTo(-34,5); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#94a3b8'; ctx.fillRect(-8,-6,4,12);
  }

  // Exhaust flame (shoots out -x tail, further negative)
  if (thr) {
    var fl=22+Math.random()*16;
    var x0=m0State.stage===1?-42:-6;
    ctx.fillStyle='rgba(251,146,60,'+(0.7+Math.random()*0.3)+')';
    ctx.beginPath(); ctx.moveTo(x0,-5); ctx.lineTo(x0-fl,0); ctx.lineTo(x0,5); ctx.closePath(); ctx.fill();
    ctx.fillStyle='rgba(253,224,71,'+(0.5+Math.random()*0.3)+')';
    ctx.beginPath(); ctx.moveTo(x0,-2); ctx.lineTo(x0-fl*0.55,0); ctx.lineTo(x0,2); ctx.closePath(); ctx.fill();
  }

  // Upper stage capsule (nose at +x, upward)
  ctx.fillStyle='#f1f5f9';
  ctx.beginPath(); ctx.moveTo(16,0); ctx.lineTo(-4,-6); ctx.lineTo(-4,6); ctx.closePath(); ctx.fill();
  ctx.fillStyle='rgba(255,255,255,0.4)';
  ctx.beginPath(); ctx.moveTo(16,0); ctx.lineTo(0,-2); ctx.lineTo(0,2); ctx.closePath(); ctx.fill();

  ctx.restore();
}
function drawM0HUD() {
  var speed=Math.hypot(m0Rocket.vx,m0Rocket.vy);
  var alt=m0AltRocket();
  var fuelPct=Math.max(0,Math.min(1,m0Rocket.fuel/100));
  var warp=WARP_LEVELS[m0State.warpIdx];
  var eCY2=H+M0_EARTH_R-30, rdx2=m0Rocket.x-CX, rdy2=m0Rocket.y-eCY2;
  var rLen2=Math.hypot(rdx2,rdy2)||1;
  var radV2=m0Rocket.vx*(rdx2/rLen2)+m0Rocket.vy*(rdy2/rLen2);
  var tangV2=Math.sqrt(Math.max(0,speed*speed-radV2*radV2));
  var hFrac=speed>0?tangV2/speed:0;

  if (m0State.outcome==='playing') drawStatusBar(m0State.message);
  { var m0markers=[];
    if(m0State.stage===1) m0markers.push({pct:0.50,label:'STAGE 2',color:'#a78bfa'});
    drawFuelBar(fuelPct,m0Rocket.fuel,{markers:m0markers}); }
  drawSpeedGauge(speed,800);

  // Hold countdown
  if (m0State.outcome==='playing'&&m0State.stableTimer>0) drawHoldRing(m0State.stableTimer, M0_HOLD, '134,239,172');

  // Pills
  var inBand=alt>=M0_TARGET_MIN&&alt<=M0_TARGET_MAX;
  var altC=inBand?'#4ade80':(alt<M0_TARGET_MIN?'#f87171':'#fbbf24');
  var hPct=Math.round(hFrac*100), hC=hFrac>=M0_HORIZ_MIN?'#4ade80':(hFrac>0.5?'#fbbf24':'#f87171');
  var stageC=m0State.stage===1?'#fbbf24':'#94a3b8';
  drawTelemetryPills([
    {label:'ALT',value:alt.toFixed(0)+' u',color:altC},
    {label:'HORIZ',value:hPct+'%',color:hC},
    {label:'STAGE',value:m0State.stage===1?'1':'2 (SEP)',color:stageC},
    {label:'WARP',value:warp+'\u00d7',color:'#ccddf8'},
  ]);

  drawMusicAttrib();
  drawM0OutcomeBanner();
}

function drawM0OutcomeBanner(){
  if (transition.active) return;
  drawOutcomeBanner(m0State.outcome,m0State.message,{retryKey:'retryM0',retryLabel:'\u21ba Retry',winLine1:'\uD83C\uDF0D  ORBIT ACHIEVED',winLine2:'STAGE 1 SEPARATED — MISSION COMPLETE',hint:'Pitch over after launch to go downrange'});
}

// ════════════════════════════════════════════════════════════════════════════
// M5 — REENTRY
// ════════════════════════════════════════════════════════════════════════════
// World coords: x = downrange distance, y = -altitude (canvas convention, so angles,
// thrust maths and drawing work exactly like the other missions).
// Phases: deorbit burn → service module separation at the entry interface →
// entry (attitude = tilt relative to the airflow, tilt gives lift) → drogue → main → splashdown.

const M5_CAP_SX = W * 0.38; // capsule's fixed screen x (camera follows it downrange)

function m5Wrap(a) { return ((a + Math.PI) % (Math.PI*2) + Math.PI*2) % (Math.PI*2) - Math.PI; }

function m5Density(alt) {
  if (alt >= M5_ATMO_TOP) return 0;
  return Math.exp(-Math.max(0, alt) / M5_SCALE_H) - M5_RHO_TOP; // continuous: exactly 0 at the top
}

// One integration step. b: {x,y,vx,vy} (mutated). c: {angle, chute, chuteT, separated, thrust, k?}
// Shared by the live physics, the prediction and the jettisoned service module.
function m5Step(b, dt, c) {
  const rho = m5Density(-b.y);
  const v = Math.hypot(b.vx, b.vy) || 1e-6;
  const open = Math.min(1, c.chuteT / M5_CHUTE_OPEN); // canopies inflate gradually (no infinite snatch load)
  const K = c.k || (c.chute === 2 ? M5_K_DROGUE + (M5_K_MAIN - M5_K_DROGUE) * open
                  : c.chute === 1 ? M5_K_CAPSULE + (M5_K_DROGUE - M5_K_CAPSULE) * open
                  : M5_K_CAPSULE);
  const aDrag = K * rho * v * v;
  // Lift acts perpendicular to the velocity, on the "up" side, scaled by how far the
  // nose is tilted toward up (full lift at the edge of the shield's protected cone).
  let ux = b.vy / v, uy = -b.vx / v; if (uy > 0) { ux = -ux; uy = -uy; }
  let aLift = 0, liftFrac = 0;
  if (!c.chute && c.separated) {
    liftFrac = Math.max(-1, Math.min(1, (Math.cos(c.angle)*ux + Math.sin(c.angle)*uy) / Math.sin(M5_SHIELD_HALF)));
    aLift = M5_LD * M5_K_CAPSULE * rho * v * v * liftFrac;
  }
  const gEff = M5_G * (1 - (b.vx*b.vx) / (M5_ORBIT_V*M5_ORBIT_V)); // gravity relieved by orbital speed
  b.vy += gEff * dt;
  if (c.thrust) { b.vx += Math.cos(c.angle) * c.thrust * dt; b.vy += Math.sin(c.angle) * c.thrust * dt; }
  b.vx += ux * aLift * dt; b.vy += uy * aLift * dt;
  const f = 1 / (1 + K * rho * v * dt); // semi-implicit drag: stable even under the main chute
  b.vx *= f; b.vy *= f;
  b.x += b.vx * dt; b.y += b.vy * dt;
  return { rho, v, liftFrac, gLoad: Math.hypot(aDrag, aLift) / M5_G };
}

// Heating for one step. h: {heat, shield} (mutated; also gets q and off). Returns true on burn-through.
// The shield is the capsule's base, so it faces the airflow when the nose points retrograde.
function m5Heat(h, b, angle, dt) {
  const v = Math.hypot(b.vx, b.vy) || 1e-6;
  const q = m5Density(-b.y) * Math.pow(v / 1000, 3);
  const off = Math.acos(Math.max(-1, Math.min(1, -(Math.cos(angle)*b.vx + Math.sin(angle)*b.vy) / v)));
  let mult = 1;
  if (off <= M5_SHIELD_HALF + 1e-6 && h.shield > 0) h.shield = Math.max(0, h.shield - q * M5_ABLATE * dt); // epsilon: exactly at the cone edge counts as protected
  else mult = M5_HEAT_BARE;
  h.heat = Math.max(0, h.heat + (q * M5_HEAT_IN * mult - h.heat * M5_HEAT_OUT) * dt);
  h.q = q; h.off = off;
  return h.heat >= 100;
}

function resetM5(startFuel) {
  if (startFuel === undefined) startFuel = 100;
  collisionFilter.reset();
  uiHitBoxes.retryM5 = null; uiHitBoxes.backToTitle = null;
  m5State = {
    warpIdx: 0, orientMode: 'retrograde', outcome: 'playing',
    message: 'DEORBIT BURN — POINT RETROGRADE AND BURN',
    trail: [], separated: false, sepReal: 0, tilt: 0, cueDrogue: false, cueMain: false,
    heat: 0, shield: 100, q: 0, off: 0, gLoad: 0, liftFrac: 0, chute: 0, chuteT: 0,
    module: null, pred: null, predTick: 0, shake: 0, winDelay: 0,
    missionStartTime: performance.now(), maxSpeed: 0,
  };
  m5Rocket = { x: 0, y: -M5_START_ALT, vx: M5_ORBIT_V, vy: 0, angle: Math.PI, fuel: startFuel };
  setThrustButtonMode('thrust');
  document.getElementById('btn-prograde')?.classList.toggle('pressed', false);
  document.getElementById('btn-retrograde')?.classList.toggle('pressed', true);
}

function endM5(o, m) { m5State.outcome = o; m5State.message = m; }

// Drop time warp to 1× at decision points (entry, drogue window, main window), so warp
// can never skip past a moment where the player has to act.
function m5Unwarp() {
  if (m5State.warpIdx === 0) return;
  m5State.warpIdx = 0;
  resetWarpCycleBtn();
  document.querySelectorAll('.warp-btn').forEach((b, j) => b.classList.toggle('active', j === 0));
}

function m5Separate() {
  const s = m5State, r = m5Rocket;
  s.separated = true; s.sepReal = 0;
  m5Unwarp();
  s.tilt = m5Wrap(r.angle - Math.atan2(-r.vy, -r.vx)); // keep the current attitude
  s.module = { x: r.x - Math.cos(r.angle) * 22, y: r.y - Math.sin(r.angle) * 22, vx: r.vx - 6, vy: r.vy + 4,
               angle: r.angle, spin: 0.8, burn: 0, q: 0 };
  setThrustButtonMode('chute');
}

// Space / W / ↑ (fresh press) or the touch CHUTE button.
function m5RequestChute() {
  const s = m5State, r = m5Rocket;
  if (!s || s.outcome !== 'playing' || !s.separated || transition.active) return;
  if (s.sepReal < M5_CHUTE_LOCK) return; // ignore presses right after separation
  const v = Math.hypot(r.vx, r.vy);
  if (s.chute === 0) {
    if (v > M5_DROGUE_MAX) return endM5('lose', 'DROGUE TORN — OPENED AT ' + v.toFixed(0) + ' u/s');
    s.chute = 1; s.chuteT = 0;
  } else if (s.chute === 1 && s.chuteT >= M5_CHUTE_OPEN) {
    if (v > M5_MAIN_MAX) return endM5('lose', 'MAIN CHUTE TORN — OPENED AT ' + v.toFixed(0) + ' u/s');
    s.chute = 2; s.chuteT = 0;
  }
}

function updateM5(realDt) {
  const s = m5State, r = m5Rocket;
  s.shake = Math.max(0, s.shake - realDt * 3);
  if (s.outcome === 'win') {
    s.winDelay -= realDt;
    if (s.winDelay <= 0 && !transition.active && scene === 'm5')
      transition.start(function(){ scene = 'endgame'; setThrustButtonMode('thrust'); musicPlayScene('endgame'); musicAttribShow(); });
    return;
  }
  if (s.outcome !== 'playing') return;

  const warp = WARP_LEVELS[s.warpIdx], simDt = realDt * TIME_SCALE * warp, NSUB = warp * 2, dt = simDt / NSUB;
  const left  = keys.has('ArrowLeft')  || keys.has('KeyA');
  const right = keys.has('ArrowRight') || keys.has('KeyD');
  const thrusting = !s.separated && (keys.has('ArrowUp') || keys.has('KeyW') || keys.has('Space')) && r.fuel > 0;
  if (s.separated) s.sepReal += realDt;

  if (left || right) {
    s.orientMode = null;
    document.getElementById('btn-prograde')?.classList.remove('pressed');
    document.getElementById('btn-retrograde')?.classList.remove('pressed');
  }
  if (!s.separated) {
    // Free attitude before separation, exactly like the other missions
    if (left)  r.angle -= ROT_SPEED * realDt * warp;
    if (right) r.angle += ROT_SPEED * realDt * warp;
    if (s.orientMode && !left && !right) {
      const pro = Math.atan2(r.vy, r.vx), tgt = s.orientMode === 'prograde' ? pro : pro + Math.PI;
      const d = m5Wrap(tgt - r.angle), step = ROT_SPEED * 1.5 * realDt;
      if (Math.abs(d) < step) r.angle = tgt; else r.angle += Math.sign(d) * step;
    }
  } else if (s.chute) {
    s.tilt = 0; // hanging under a canopy
  } else {
    // The capsule is aerodynamically stable: attitude is a tilt relative to the airflow.
    // A/D change the tilt (can't be pushed past ±60°); Q returns to shield-forward, E flips it (fatal).
    const step = M5_TILT_RATE * realDt * warp;
    const nt = s.tilt + (right ? step : 0) - (left ? step : 0);
    if (Math.abs(nt) <= M5_TILT_MAX || Math.abs(nt) < Math.abs(s.tilt)) s.tilt = nt;
    if (s.orientMode && !left && !right) {
      const tgt = s.orientMode === 'retrograde' ? 0 : Math.PI;
      const d = m5Wrap(tgt - s.tilt), st = M5_TILT_RATE * 2 * realDt;
      s.tilt = Math.abs(d) < st ? tgt : s.tilt + Math.sign(d) * st;
    }
  }

  for (let i = 0; i < NSUB; i++) {
    if (s.outcome !== 'playing') break;
    if (!s.separated && -r.y < M5_ATMO_TOP) m5Separate();
    if (s.separated) {
      r.angle = Math.atan2(-r.vy, -r.vx) + s.tilt;
      if (m5Heat(s, r, r.angle, dt)) {
        s.shake = 1;
        endM5('lose', s.shield > 0 ? 'BURNED UP — HEAT SHIELD OVERWHELMED' : 'BURNED UP — HEAT SHIELD ABLATED AWAY');
        break;
      }
    }
    if (s.chute) s.chuteT += dt;
    if (thrusting) r.fuel = Math.max(0, r.fuel - M5_FUEL_DRAIN * dt);
    const aero = m5Step(r, dt, { angle: r.angle, chute: s.chute, chuteT: s.chuteT, separated: s.separated,
                                 thrust: thrusting && r.fuel > 0 ? M5_THRUST : 0 });
    s.gLoad = aero.gLoad; s.liftFrac = aero.liftFrac;
    if (aero.v > s.maxSpeed) s.maxSpeed = aero.v;
    if (s.module) {
      const m = s.module;
      const ma = m5Step(m, dt, { angle: m.angle, chute: 0, chuteT: 0, separated: false, thrust: 0, k: M5_K_CAPSULE * 1.6 });
      m.q = ma.rho * Math.pow(ma.v / 1000, 3);
      m.burn = Math.min(1, m.burn + m.q * 25 * dt); // no shield: it tumbles and burns up
      m.angle += m.spin * dt;
      if (m.burn >= 1 || m.y >= 0) s.module = null;
    }
    const last = s.trail[s.trail.length-1];
    if (!last || Math.hypot(r.x-last.x, r.y-last.y) > 20) { s.trail.push({x:r.x, y:r.y}); if (s.trail.length > TRAIL_MAX) s.trail.shift(); }
    evalM5State();
  }
  if (s.separated && !s.chute) s.shake = Math.max(s.shake, Math.min(1, s.q / 0.05) * 0.6);
}

function evalM5State() {
  const s = m5State, r = m5Rocket, alt = -r.y;
  const v = Math.hypot(r.vx, r.vy);
  if (alt <= 0) {
    r.y = 0;
    if (v <= M5_SPLASH_MAX) return m5Win();
    return endM5('lose', s.chute === 2 ? 'HARD SPLASHDOWN — ' + v.toFixed(0) + ' u/s'
                       : s.chute === 1 ? 'HARD SPLASHDOWN — MAIN CHUTE NOT DEPLOYED'
                       : 'HARD SPLASHDOWN — NO PARACHUTE');
  }
  if (s.separated && alt > M5_ATMO_TOP && r.vy < 0) return endM5('lose', 'SKIPPED OFF THE ATMOSPHERE');
  if (!s.separated && alt > M5_START_ALT + 1500) return endM5('lose', 'LOST IN SPACE');
  if (!s.separated && r.fuel <= 0 && s.pred && s.pred.outcome === 'orbit') return endM5('lose', 'OUT OF FUEL — STRANDED IN ORBIT');

  // Guidance
  if (!s.separated) {
    const burning = (keys.has('ArrowUp') || keys.has('KeyW') || keys.has('Space')) && r.fuel > 0;
    s.message = burning ? 'DEORBIT BURN'
      : (!s.pred || s.pred.outcome === 'orbit') ? 'DEORBIT BURN — POINT RETROGRADE AND BURN'
      : 'COASTING TO ENTRY INTERFACE';
  } else if (s.chute === 0) {
    if (v <= M5_DROGUE_MAX && !s.cueDrogue) { s.cueDrogue = true; m5Unwarp(); }
    if (s.off > M5_SHIELD_HALF) s.message = 'SHIELD NOT FACING THE AIRFLOW!';
    else if (v <= M5_DROGUE_MAX) s.message = 'DEPLOY DROGUE — PRESS SPACE';
    else if (s.q > 0.02) s.message = 'PLASMA BLACKOUT — HOLD THE SHIELD FORWARD';
    else s.message = 'ENTRY INTERFACE — TILT UP FOR LIFT';
  } else if (s.chute === 1) {
    const mainOk = v <= M5_MAIN_MAX && s.chuteT >= M5_CHUTE_OPEN;
    if (mainOk && !s.cueMain) { s.cueMain = true; m5Unwarp(); }
    s.message = mainOk ? 'DEPLOY MAIN CHUTE — PRESS SPACE' : 'DROGUE OUT — MAIN BELOW ' + M5_MAIN_MAX + ' u/s';
  } else {
    s.message = 'MAIN CHUTE OUT — STAND BY FOR SPLASHDOWN';
  }
}

function m5Win() {
  const s = m5State, r = m5Rocket;
  const dist = Math.abs(r.x - M5_SHIP_X);
  const stars = dist < 1500 ? 3 : dist < 5000 ? 2 : 1;
  endM5('win', 'SPLASHDOWN!');
  missionLog.m5 = { time: (performance.now() - s.missionStartTime) / 1000, fuel: s.shield, maxSpeed: s.maxSpeed, stars, shipDist: dist };
  s.winDelay = 3;
}

// Predicts the capsule's path assuming the current tilt is held and no more thrust.
// Returns { pts, mark: {x,y,tone,icon,label}|null, outcome }.
function predictM5Path() {
  const s = m5State, r = m5Rocket;
  const b = { x: r.x, y: r.y, vx: r.vx, vy: r.vy };
  const h = { heat: s.heat, shield: s.shield };
  let sep = s.separated, chute = s.chute, chuteT = s.chuteT;
  const tilt = s.separated ? s.tilt : m5Wrap(r.angle - Math.atan2(-r.vy, -r.vx));
  const DT = 0.1, pts = [{x:b.x, y:b.y}];
  let mark = null, outcome = 'orbit';
  for (let i = 0; i < 2500; i++) {
    if (!sep && -b.y < M5_ATMO_TOP) sep = true;
    const angle = sep ? Math.atan2(-b.vy, -b.vx) + (chute ? 0 : tilt) : r.angle;
    if (sep && m5Heat(h, b, angle, DT)) { mark = { x:b.x, y:b.y, tone:'danger', icon:'x', label:'⚠ BURN-UP' }; outcome = 'burn'; break; }
    if (chute) chuteT += DT;
    m5Step(b, DT, { angle, chute, chuteT, separated: sep, thrust: 0 });
    if (i % 2 === 0) pts.push({x:b.x, y:b.y});
    const v = Math.hypot(b.vx, b.vy);
    if (sep && -b.y > M5_ATMO_TOP && b.vy < 0) { mark = { x:b.x, y:b.y, tone:'warn', icon:'x', label:'⚠ SKIP-OUT' }; outcome = 'skip'; break; }
    if (-b.y > M5_START_ALT + 1500) { outcome = 'lost'; break; }
    if (sep && chute === 0 && v <= M5_DROGUE_MAX) { mark = { x:b.x, y:b.y, tone:'safe', icon:'check', label:'✓ CHUTE ZONE' }; outcome = 'corridor'; break; }
    if (-b.y <= 0) {
      const ok = v <= M5_SPLASH_MAX;
      mark = { x:b.x, y:0, tone: ok ? 'safe' : 'warn', icon: ok ? 'check' : 'arrow',
               label: ok ? '✓ SPLASHDOWN' : (chute === 1 ? '⚠ DEPLOY MAIN' : '⚠ HARD SPLASHDOWN') };
      outcome = ok ? 'splash' : 'hard'; break;
    }
  }
  pts.push({x:b.x, y:b.y});
  return { pts, mark, outcome };
}

// ── M5 rendering ─────────────────────────────────────────────────────────────

let _m5SkyGrad = null, _m5SeaGrad = null;
function m5SkyGradient() {
  if (_m5SkyGrad) return _m5SkyGrad;
  const ei = (M5_GROUND_SY - M5_ATMO_TOP * M5_VIEW_Z) / M5_GROUND_SY; // entry interface, as a gradient stop
  const g = ctx.createLinearGradient(0, 0, 0, M5_GROUND_SY);
  g.addColorStop(0, '#020610'); g.addColorStop(ei - 0.09, '#040a1c'); g.addColorStop(ei, '#0a1a3a');
  g.addColorStop(0.86, '#1a4a8a'); g.addColorStop(1, '#3b7fd0');
  return (_m5SkyGrad = g);
}
function m5SeaGradient() {
  if (_m5SeaGrad) return _m5SeaGrad;
  const g = ctx.createLinearGradient(0, M5_GROUND_SY, 0, H);
  g.addColorStop(0, '#1d4f8f'); g.addColorStop(1, '#071a36');
  return (_m5SeaGrad = g);
}

function m5Sx(x) { return M5_CAP_SX + (x - m5Rocket.x) * M5_VIEW_Z; }
function m5Sy(y) { return M5_GROUND_SY + y * M5_VIEW_Z; }

function m5StrokeWorld(pts, from, to, color, width, dash) {
  if (to - from < 2) return;
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
  ctx.beginPath(); ctx.moveTo(m5Sx(pts[from].x), m5Sy(pts[from].y));
  for (let i = from + 1; i < to; i++) ctx.lineTo(m5Sx(pts[i].x), m5Sy(pts[i].y));
  ctx.stroke(); ctx.restore();
}

function fmtDist(d) { return d >= 1000 ? (d / 1000).toFixed(1) + 'k' : d.toFixed(0); }

function renderM5() {
  const s = m5State, r = m5Rocket;
  ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.setLineDash([]);
  const t = Date.now() / 1000;
  const eiY = M5_GROUND_SY - M5_ATMO_TOP * M5_VIEW_Z;

  // Sky + stars (stars fade out toward the atmosphere, slow parallax downrange)
  ctx.fillStyle = m5SkyGradient(); ctx.fillRect(0, 0, W, M5_GROUND_SY);
  for (const st of STARS) {
    const sy = st.y * (eiY / H);
    const a = Math.max(0, Math.min(1, (eiY - sy) / 300)) * st.a;
    if (a <= 0.02) continue;
    const sx = ((st.x - r.x * 0.02 * st.depth) % W + W) % W;
    ctx.globalAlpha = a; ctx.fillStyle = '#dbeafe'; ctx.beginPath(); ctx.arc(sx, sy, st.r, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Shake during peak heating (screen-space offset of the world)
  ctx.save();
  if (s.shake > 0.01 && s.outcome === 'playing') ctx.translate((Math.random()-0.5) * 8 * s.shake, (Math.random()-0.5) * 8 * s.shake);

  // Entry interface
  ctx.save(); ctx.setLineDash([10, 14]); ctx.strokeStyle = 'rgba(134,239,172,0.22)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, eiY); ctx.lineTo(W, eiY); ctx.stroke(); ctx.setLineDash([]);
  ctx.font = '600 15px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle = 'rgba(134,239,172,0.45)'; ctx.textAlign = 'left';
  ctx.fillText('ENTRY INTERFACE', 24, eiY - 8); ctx.restore();

  // Horizon haze + sea + waves
  { const hz = ctx.createLinearGradient(0, M5_GROUND_SY - 90, 0, M5_GROUND_SY);
    hz.addColorStop(0, 'rgba(147,197,253,0)'); hz.addColorStop(1, 'rgba(147,197,253,0.22)');
    ctx.fillStyle = hz; ctx.fillRect(0, M5_GROUND_SY - 90, W, 90);
    ctx.fillStyle = m5SeaGradient(); ctx.fillRect(0, M5_GROUND_SY, W, H - M5_GROUND_SY);
    ctx.strokeStyle = 'rgba(191,219,254,0.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, M5_GROUND_SY); ctx.lineTo(W, M5_GROUND_SY); ctx.stroke();
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 4; k++) {
      const wy = M5_GROUND_SY + 16 + k * 30, off = r.x * M5_VIEW_Z * (0.9 + k * 0.08);
      ctx.strokeStyle = `rgba(147,197,253,${(0.14 - k * 0.025).toFixed(3)})`;
      ctx.beginPath();
      for (let sx = 0; sx <= W; sx += 30) {
        const yy = wy + Math.sin((sx + off) / 70 + t * 1.3 + k) * (2 + k);
        if (sx === 0) ctx.moveTo(sx, yy); else ctx.lineTo(sx, yy);
      }
      ctx.stroke();
    }
  }

  // Recovery ship (or an edge marker pointing to it)
  { const shipSx = m5Sx(M5_SHIP_X), gy = M5_GROUND_SY;
    if (shipSx > -120 && shipSx < W + 120) {
      ctx.save(); ctx.translate(shipSx, gy);
      ctx.fillStyle = '#334155';
      ctx.beginPath(); ctx.moveTo(-70, -6); ctx.lineTo(64, -6); ctx.lineTo(54, 10); ctx.lineTo(-62, 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#475569'; ctx.fillRect(-30, -24, 40, 18); ctx.fillRect(-20, -36, 18, 12);
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-11, -36); ctx.lineTo(-11, -58); ctx.stroke();
      const p = 0.5 + 0.5 * Math.sin(t * 4);
      ctx.fillStyle = `rgba(251,146,60,${(0.5 + 0.5 * p).toFixed(2)})`; ctx.beginPath(); ctx.arc(-11, -60, 4, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = `rgba(251,146,60,${(0.4 * (1 - p)).toFixed(2)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(-11, -60, 6 + 16 * p, 0, Math.PI*2); ctx.stroke();
      ctx.font = '700 15px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle = 'rgba(253,186,116,0.85)'; ctx.textAlign = 'center';
      ctx.fillText('RECOVERY SHIP', 0, -76);
      ctx.restore();
    } else {
      const ahead = shipSx >= W;
      const label = ahead ? 'SHIP ' + fmtDist(Math.abs(M5_SHIP_X - r.x)) + ' ▶' : '◀ SHIP ' + fmtDist(Math.abs(M5_SHIP_X - r.x));
      ctx.save(); ctx.font = '700 16px Inter,ui-sans-serif,sans-serif'; ctx.textAlign = ahead ? 'right' : 'left';
      const tw = ctx.measureText(label).width + 20, lx = ahead ? W - 24 - tw : 24, ly = M5_GROUND_SY - 46;
      ctx.fillStyle = 'rgba(6,10,24,0.75)'; rrect(lx, ly, tw, 30, 8); ctx.fill();
      ctx.fillStyle = 'rgba(253,186,116,0.9)'; ctx.fillText(label, ahead ? W - 34 : 34, ly + 21); ctx.restore();
    }
  }

  // Trail
  m5StrokeWorld(s.trail, 0, s.trail.length, s.separated ? 'rgba(253,186,116,0.45)' : 'rgba(125,211,252,0.4)', 1.5);

  // Prediction (recomputed every 3rd frame — it integrates up to 250 s ahead)
  if (s.outcome === 'playing') {
    if (!s.pred || (s.predTick++ % 3) === 0) s.pred = predictM5Path();
    const pts = s.pred.pts, mk = s.pred.mark;
    if (mk) {
      const tail = Math.max(0, pts.length - 14);
      const tailCol = mk.tone === 'safe' ? 'rgba(74,222,128,0.85)' : mk.tone === 'warn' ? 'rgba(251,191,36,0.85)' : 'rgba(255,80,80,0.75)';
      m5StrokeWorld(pts, 0, tail + 1, 'rgba(251,211,77,0.55)', 1.5, [8, 8]);
      m5StrokeWorld(pts, tail, pts.length, tailCol, 2.2);
    } else {
      m5StrokeWorld(pts, 0, pts.length, 'rgba(251,211,77,0.55)', 1.5, [8, 8]);
    }
  }

  // Jettisoned service module, burning up
  if (s.module) {
    const m = s.module, mx = m5Sx(m.x), my = m5Sy(m.y), fade = 1 - m.burn;
    ctx.save(); ctx.translate(mx, my); ctx.rotate(m.angle);
    if (m.q > 0.002) {
      const gl = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
      gl.addColorStop(0, `rgba(255,200,120,${(0.8 * Math.min(1, m.q / 0.02)).toFixed(2)})`); gl.addColorStop(1, 'rgba(255,90,30,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = fade; ctx.fillStyle = '#94a3b8'; ctx.fillRect(-10, -7, 20, 14);
    ctx.fillStyle = '#475569'; ctx.fillRect(-17, -5, 7, 10);
    ctx.restore();
  }

  // Capsule
  const csx = M5_CAP_SX, csy = m5Sy(r.y);
  const thrusting = s.outcome === 'playing' && !s.separated && r.fuel > 0 && (keys.has('ArrowUp') || keys.has('KeyW') || keys.has('Space'));
  if (s.chute) drawM5Chutes(csx, csy, s, r);
  drawM5Capsule(csx, csy, r.angle, s, thrusting, r);
  ctx.restore(); // end shake

  // Prediction marker on top (hidden when it would sit on the capsule — the status bar says it then)
  if (s.outcome === 'playing' && s.pred && s.pred.mark) {
    const mk = s.pred.mark, mx = m5Sx(mk.x), my = m5Sy(mk.y);
    if (Math.hypot(mx - csx, my - csy) > 110)
      drawCollisionWarning({ x: mx, y: my, body: '', tone: mk.tone, icon: mk.icon, label: mk.label });
  }

  drawM5HUD();
}

function drawM5Capsule(sx, sy, angle, s, thrusting, r) {
  const v = Math.hypot(r.vx, r.vy) || 1;
  const hot = s.separated ? Math.min(1, s.q / 0.04) : 0;
  // Plasma trail streaming behind the capsule
  if (hot > 0.03 && !s.chute) {
    const bx = -r.vx / v, by = -r.vy / v, len = 40 + 220 * hot;
    const g = ctx.createLinearGradient(sx, sy, sx + bx * len, sy + by * len);
    g.addColorStop(0, `rgba(255,170,90,${(0.75 * hot).toFixed(2)})`); g.addColorStop(1, 'rgba(255,80,40,0)');
    ctx.save(); ctx.strokeStyle = g; ctx.lineCap = 'round'; ctx.lineWidth = 6 + 12 * hot;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + bx * len, sy + by * len); ctx.stroke(); ctx.restore();
  }
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(angle);
  // local +x = nose; the heat shield is the base at -x
  if (!s.separated) {
    ctx.fillStyle = '#94a3b8'; ctx.fillRect(-32, -7, 21, 14);
    ctx.fillStyle = '#64748b'; ctx.fillRect(-32, -7, 3, 14);
    ctx.fillStyle = '#475569'; ctx.beginPath(); ctx.moveTo(-32,-4); ctx.lineTo(-39,-7); ctx.lineTo(-39,7); ctx.lineTo(-32,4); ctx.closePath(); ctx.fill();
    if (thrusting) {
      const fl = 14 + Math.random() * 10;
      ctx.fillStyle = 'rgba(251,146,60,' + (0.7 + Math.random() * 0.3) + ')';
      ctx.beginPath(); ctx.moveTo(-39,-5); ctx.lineTo(-39 - fl, 0); ctx.lineTo(-39, 5); ctx.closePath(); ctx.fill();
    }
  }
  // Shield glow: on the leading side of the capsule (the base when the attitude is right)
  if (hot > 0.03) {
    const lx = Math.cos(-angle) * r.vx / v - Math.sin(-angle) * r.vy / v;
    const ly = Math.sin(-angle) * r.vx / v + Math.cos(-angle) * r.vy / v;
    const gx = lx * 13, gy = ly * 13, gr = 10 + 26 * hot;
    const g = ctx.createRadialGradient(gx, gy, 1, gx, gy, gr);
    g.addColorStop(0, `rgba(255,245,215,${(0.95 * hot).toFixed(2)})`);
    g.addColorStop(0.4, `rgba(255,150,60,${(0.7 * hot).toFixed(2)})`);
    g.addColorStop(1, 'rgba(255,60,90,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, gr, 0, Math.PI*2); ctx.fill();
  }
  // Capsule body (truncated cone) + ablative shield
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath(); ctx.moveTo(-11, -10); ctx.lineTo(8, -3.5); ctx.lineTo(8, 3.5); ctx.lineTo(-11, 10); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#cbd5e1'; ctx.fillRect(8, -2.5, 3, 5);
  ctx.fillStyle = '#1e293b'; ctx.fillRect(-2, -4.5, 3.5, 3);
  const shieldCol = s.shield > 40 ? '#8b5a3c' : s.shield > 0 ? '#5b3a28' : '#2b1d16';
  ctx.fillStyle = shieldCol;
  ctx.beginPath(); ctx.moveTo(-11, -10); ctx.quadraticCurveTo(-17, 0, -11, 10); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawM5Chutes(sx, sy, s, r) {
  const v = Math.hypot(r.vx, r.vy) || 1;
  const ux = -r.vx / v, uy = -r.vy / v; // canopy trails opposite to the motion
  const open = Math.min(1, s.chuteT / M5_CHUTE_OPEN);
  const main = s.chute === 2;
  const len = (main ? 74 : 44) * (0.45 + 0.55 * open);
  const rad = (main ? 36 : 12) * (0.25 + 0.75 * open);
  const cx = sx + ux * len, cy = sy + uy * len, px = -uy, py = ux;
  ctx.save();
  ctx.strokeStyle = 'rgba(226,232,240,0.55)'; ctx.lineWidth = 1;
  for (const k of [-1, -0.45, 0.45, 1]) { ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(cx + px * rad * k, cy + py * rad * k); ctx.stroke(); }
  ctx.translate(cx, cy); ctx.rotate(Math.atan2(uy, ux));
  ctx.beginPath(); ctx.ellipse(0, 0, rad * 0.55, rad, 0, -Math.PI/2, Math.PI/2); ctx.closePath();
  ctx.fillStyle = main ? '#f97316' : '#fb923c'; ctx.fill();
  if (main) {
    ctx.save(); ctx.clip(); ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = -2; i <= 2; i += 2) ctx.fillRect(0, i * rad / 3 - rad / 6, rad, rad / 3);
    ctx.restore();
  }
  ctx.restore();
}

// Attitude dial (bottom-right): green cone = shield protected, line = capsule nose,
// grey arrow = direction of travel.
function drawM5AttitudeDial(s, r) {
  const cx = W - 130, cy = H - 140, R = 74;
  const flow = Math.atan2(r.vy, r.vx), retro = flow + Math.PI;
  const off = Math.abs(m5Wrap(r.angle - retro));
  const ok = off <= M5_SHIELD_HALF;
  ctx.save();
  ctx.fillStyle = 'rgba(6,10,24,0.82)'; ctx.strokeStyle = 'rgba(100,140,255,0.15)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R + 14, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(74,222,128,0.18)';
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, retro - M5_SHIELD_HALF, retro + M5_SHIELD_HALF); ctx.closePath(); ctx.fill();
  // direction of travel
  ctx.strokeStyle = 'rgba(148,163,184,0.55)'; ctx.lineWidth = 2;
  const fx = cx + Math.cos(flow) * R, fy = cy + Math.sin(flow) * R;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(fx, fy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx - Math.cos(flow - 0.4) * 10, fy - Math.sin(flow - 0.4) * 10);
  ctx.lineTo(fx - Math.cos(flow + 0.4) * 10, fy - Math.sin(flow + 0.4) * 10); ctx.closePath(); ctx.fillStyle = 'rgba(148,163,184,0.55)'; ctx.fill();
  // capsule nose
  ctx.strokeStyle = ok ? '#4ade80' : '#f87171'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(r.angle) * (R - 6), cy + Math.sin(r.angle) * (R - 6)); ctx.stroke();
  ctx.fillStyle = ok ? '#4ade80' : '#f87171'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI*2); ctx.fill();
  // labels
  let up = 0;
  { const v = Math.hypot(r.vx, r.vy) || 1; let ux = r.vy / v, uy = -r.vx / v; if (uy > 0) { ux = -ux; uy = -uy; }
    up = Math.cos(r.angle) * ux + Math.sin(r.angle) * uy; }
  const deg = Math.round(off * 180 / Math.PI) * (up >= 0 ? 1 : -1);
  ctx.textAlign = 'center';
  ctx.font = '700 15px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle = ok ? '#86efac' : '#fca5a5';
  ctx.fillText(s.separated ? 'TILT ' + (deg > 0 ? '+' : '') + deg + '°' : (ok ? 'RETROGRADE ✓' : 'OFF RETRO ' + Math.abs(deg) + '°'), cx, cy + R + 36);
  if (s.separated && !s.chute) {
    ctx.font = '600 13px Inter,ui-sans-serif,sans-serif';
    ctx.fillStyle = Math.abs(s.liftFrac) < 0.15 ? 'rgba(148,175,220,0.7)' : s.liftFrac > 0 ? '#86efac' : '#fca5a5';
    ctx.fillText(Math.abs(s.liftFrac) < 0.15 ? 'NEUTRAL' : s.liftFrac > 0 ? 'LIFT ▲' : 'LIFT ▼', cx, cy + R + 54);
  }
  ctx.font = '600 11px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle = '#4a6080';
  ctx.fillText('ATTITUDE', cx, cy - R - 20);
  ctx.textAlign = 'left'; ctx.restore();
}

// Verdict of the trajectory prediction, under the status bar. The marker on the path is
// often far off-screen during the deorbit burn, which is exactly when this matters most.
const M5_PRED_TEXT = {
  orbit:    ['STILL IN ORBIT — BURN RETROGRADE', '148,175,220'],
  lost:     ['⚠ ESCAPING ORBIT',                '255,120,120'],
  corridor: ['✓ ENTRY IN CORRIDOR',             '134,239,172'],
  skip:     ['⚠ SKIP-OUT PREDICTED',            '253,211,77'],
  burn:     ['⚠ BURN-UP PREDICTED',             '255,120,120'],
  hard:     ['⚠ HARD SPLASHDOWN PREDICTED',     '253,211,77'],
  splash:   ['✓ SAFE SPLASHDOWN',               '134,239,172'],
};
function drawM5PredictionReadout(pred) {
  if (!pred || !M5_PRED_TEXT[pred.outcome]) return;
  let [text, rgb] = M5_PRED_TEXT[pred.outcome];
  // Targeting feedback: where the predicted chute zone / splash point is relative to the ship
  if (pred.mark && (pred.outcome === 'corridor' || pred.outcome === 'splash' || pred.outcome === 'hard')) {
    const d = pred.mark.x - M5_SHIP_X;
    text += '  ·  ' + (Math.abs(d) < 400 ? 'ON THE SHIP' : fmtDist(Math.abs(d)) + (d < 0 ? ' SHORT OF SHIP' : ' PAST SHIP'));
  }
  ctx.save(); ctx.font = '700 17px Inter,ui-sans-serif,sans-serif'; ctx.textAlign = 'center';
  const bw = ctx.measureText(text).width + 32, bx = W/2 - bw/2, by = 78;
  ctx.fillStyle = 'rgba(6,10,24,0.78)'; ctx.strokeStyle = `rgba(${rgb},0.45)`; ctx.lineWidth = 1;
  rrect(bx, by, bw, 32, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = `rgb(${rgb})`; ctx.fillText(text, W/2, by + 22);
  ctx.textAlign = 'left'; ctx.restore();
}

function drawM5HUD() {
  const s = m5State, r = m5Rocket;
  const speed = Math.hypot(r.vx, r.vy), alt = Math.max(0, -r.y), warp = WARP_LEVELS[s.warpIdx];
  if (s.outcome === 'playing') { drawStatusBar(s.message); drawM5PredictionReadout(s.pred); }
  if (s.separated) drawFuelBar(Math.max(0, Math.min(1, s.shield / 100)), s.shield, { label: 'SHIELD' });
  else drawFuelBar(Math.max(0, Math.min(1, r.fuel / 100)), r.fuel);
  drawSpeedGauge(speed, 2000);
  const altC = alt > M5_ATMO_TOP ? '#ccddf8' : '#38bdf8';
  const vs = r.vy, vsC = s.chute ? (vs > M5_SPLASH_MAX ? '#fbbf24' : '#4ade80') : '#ccddf8';
  const gC = s.gLoad < 4 ? '#4ade80' : s.gLoad < 8 ? '#fbbf24' : '#f87171';
  const hC = s.heat < 50 ? '#4ade80' : s.heat < 80 ? '#fbbf24' : '#f87171';
  drawTelemetryPills([
    { label: 'ALT', value: alt.toFixed(0) + ' u', color: altC },
    { label: 'V-SPEED', value: (vs >= 0 ? '▼ ' : '▲ ') + Math.abs(vs).toFixed(0), color: vsC },
    { label: 'G-LOAD', value: s.gLoad.toFixed(1) + ' g', color: gC },
    { label: 'HULL HEAT', value: Math.round(s.heat) + '%', color: hC },
    { label: 'WARP', value: warp + '×', color: '#ccddf8' },
  ]);
  if (!s.chute && s.outcome === 'playing') drawM5AttitudeDial(s, r);
  drawMusicAttrib();
  if (s.outcome === 'win') {
    const d = missionLog.m5 ? missionLog.m5.shipDist : 0, stars = missionLog.m5 ? missionLog.m5.stars : 1;
    ctx.save(); ctx.textAlign = 'center';
    ctx.font = '800 44px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle = '#86efac';
    ctx.fillText('🪂  SPLASHDOWN!', W/2, H/2 - 60);
    ctx.font = '600 22px Inter,ui-sans-serif,sans-serif'; ctx.fillStyle = 'rgba(134,239,172,0.85)';
    ctx.fillText(fmtDist(d) + ' u from the recovery ship   ' + '⭐'.repeat(stars), W/2, H/2 - 20);
    ctx.restore();
  } else if (!transition.active) {
    drawOutcomeBanner(s.outcome, s.message, { retryKey: 'retryM5', retryLabel: '↺ Retry',
      hint: 'Shield forward · tilt up for lift · drogue ≤' + M5_DROGUE_MAX + ', main ≤' + M5_MAIN_MAX + ' u/s' });
  }
}

var _leftCtrl, _rightCtrl;
function initTouchUI() {
  _leftCtrl  = document.querySelector('.side-ctrl.left-ctrl');
  _rightCtrl = document.querySelector('.side-ctrl.right-ctrl');
  setTouchUIVisible(false);
}
function resetWarpCycleBtn() {
  const btn = document.getElementById('btn-warp-cycle');
  if (btn) btn.textContent = '1×';
}
function setTouchUIVisible(vis) {
  [_leftCtrl, _rightCtrl].forEach(function(el){
    if (!el) return;
    if (vis) el.classList.remove('hidden');
    else     el.classList.add('hidden');
  });
  if (vis) { resetWarpCycleBtn(); }
}
// M5 turns the touch THRUST button into the parachute button after separation.
function setThrustButtonMode(mode) {
  const btn = document.getElementById('btn-thrust');
  if (!btn) return;
  btn.innerHTML = mode === 'chute' ? '◎<br><span>CHUTE</span>' : '▲<br><span>THRUST</span>';
}

let lastNow = null;

function loop(now) {
  if (lastNow===null) lastNow=now;
  const realDt=Math.min((now-lastNow)/1000,0.05);
  lastNow=now;

  if (scene==='m0' && m0State.outcome==='playing') updateM0Physics(realDt);
  if (scene==='orbit') {
    if (state.outcome==='playing') updatePhysics(realDt);
    const inOrbit=state.stableTimer>0;
    camera.blend += ((inOrbit?1.0:0.0)-camera.blend)*0.006;
    camera.zoom = 1.0+1.2*camera.blend;
  }
  if (scene==='landing' && lState.outcome==='playing') updateLandingPhysics(realDt);
  if (scene==='m3' && m3State.outcome==='playing') updateM3Physics(realDt);
  if (scene==='m4' && m4State.outcome==='playing') updateM4Physics(realDt);
  if (scene==='m5') updateM5(realDt);
  transition.update(realDt);
  if (scene !== 'title') musicAttribTick(realDt);

  if (scene==='endgame')      renderEndgame();
  else if (scene==='title')  renderTitle();
  else if (scene==='m0')      renderM0();
  else if (scene==='orbit')   render();
  else if (scene==='landing') renderLanding();
  else if (scene==='m3')      renderM3();
  else if (scene==='m4')      renderM4();
  else if (scene==='m5')      renderM5();
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
  btn.addEventListener('pointerdown',e=>{e.preventDefault();musicPlayTitle();toggleFS();},{passive:false});
  const menuBtn=document.getElementById('btn-menu');
  if (menuBtn) menuBtn.addEventListener('pointerdown',e=>{e.preventDefault();if(scene!=='title')enterTitle();},{passive:false});

  initTouchUI();
  function onFSChange() { const inFS=!!(document.fullscreenElement||document.webkitFullscreenElement); btn.textContent=inFS?'\u2715':'\u26f6'; btn.style.display=inFS?'none':''; }
  document.addEventListener('fullscreenchange',onFSChange); document.addEventListener('webkitfullscreenchange',onFSChange);
})();

(function suppressLongPress() {
  document.addEventListener('contextmenu',e=>e.preventDefault(),{passive:false});
  document.addEventListener('selectstart',e=>e.preventDefault(),{passive:false});
  document.addEventListener('touchstart',e=>{ if (e.target.tagName==='BUTTON'||e.target.closest('.side-ctrl,.fullscreen-btn')) e.preventDefault(); },{passive:false});
})();

(function initOrientButtons() {
  function setMode(mode) {
    const tgt=getActiveState();
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
        const tgt=getActiveState();
        if (tgt) { tgt.orientMode=null; document.getElementById('btn-prograde')?.classList.remove('pressed'); document.getElementById('btn-retrograde')?.classList.remove('pressed'); }
      }
      if (id==='btn-thrust' && scene==='m5') m5RequestChute(); // pointerdown is a fresh press by nature
      setP(true);
    },{passive:false});
    el.addEventListener('pointerup',e=>{e.preventDefault();setP(false);},{passive:false});
    el.addEventListener('pointerout',e=>{e.preventDefault();setP(false);},{passive:false});
    el.addEventListener('pointercancel',()=>setP(false),{passive:false});
  });

  document.querySelectorAll('.warp-btn').forEach((btn,i)=>{
    btn.addEventListener('pointerdown',e=>{
      e.preventDefault();
      const tgt=getActiveState();
      if (tgt) tgt.warpIdx=i;
      document.querySelectorAll('.warp-btn').forEach((b,j)=>b.classList.toggle('active',j===i));
    },{passive:false});
  });

  window.addEventListener('keydown',e=>{
    const map={Digit1:0,Digit2:1,Digit3:2,Digit4:3};
    if (map[e.code]!==undefined) document.querySelectorAll('.warp-btn').forEach((b,j)=>b.classList.toggle('active',j===map[e.code]));
  });

  // Warp cycle button (mobile side panel)
  const warpCycleBtn = document.getElementById('btn-warp-cycle');
  if (warpCycleBtn) {
    warpCycleBtn.addEventListener('pointerdown', e => {
      e.preventDefault();
      const tgt = getActiveState();
      if (!tgt) return;
      tgt.warpIdx = (tgt.warpIdx + 1) % WARP_LEVELS.length;
      warpCycleBtn.textContent = WARP_LEVELS[tgt.warpIdx] + '×';
      // Sync hidden desktop warp buttons
      document.querySelectorAll('.warp-btn').forEach((b,j) => b.classList.toggle('active', j===tgt.warpIdx));
    }, {passive:false});
  }

  // Also sync warp cycle btn label when keyboard warp keys used
  window.addEventListener('keydown', e => {
    const map = {Digit1:0,Digit2:1,Digit3:2,Digit4:3};
    if (map[e.code] !== undefined && warpCycleBtn) {
      warpCycleBtn.textContent = WARP_LEVELS[map[e.code]] + '×';
    }
  });

  const rb=document.getElementById('btn-restart');
  if (rb) rb.addEventListener('pointerdown',e=>{e.preventDefault(); restartActiveScene();},{passive:false});

  document.addEventListener('touchmove',e=>e.preventDefault(),{passive:false});
  document.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});
})();


// Portrait hint — JS-driven for reliability across all mobile browsers
(function initPortraitHint() {
  const hint = document.querySelector('.portrait-hint');
  if (!hint) return;
  const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  function check() {
    const portrait = window.innerHeight > window.innerWidth;
    hint.style.display = (isTouch && portrait) ? 'flex' : 'none';
  }
  window.addEventListener('resize', check);
  window.addEventListener('orientationchange', check);
  check();
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
m0State = { orientMode: 'prograde', warpIdx: 0, outcome: 'playing', message: '', trail: [], stableTimer: 0, stage: 1, stage1: null, missionStartTime: performance.now(), maxSpeed: 0 };
m0Rocket = { x: CX, y: H-35, vx: 0, vy: 0, angle: -Math.PI/2, fuel: 100 };
m3State = { orientMode: null, warpIdx: 0, outcome: 'playing', message: '', trail: [], stableTimer: 0 };
m3Rocket = { x: CX, y: CY, vx: 0, vy: 0, angle: 0, fuel: 100 };
m4State  = { orientMode: 'retrograde', warpIdx: 0, outcome: 'playing', message: '', trail: [], stableTimer: 0, moonAngle: 0, earthAngle: 0, missionStartTime: performance.now(), maxSpeed: 0 };
m4Rocket = { x: CX, y: CY, vx: 0, vy: 0, angle: 0, fuel: 100 };
m5State  = { orientMode: 'retrograde', warpIdx: 0, outcome: 'playing', message: '', trail: [], separated: false, chute: 0 };
m5Rocket = { x: 0, y: -M5_START_ALT, vx: M5_ORBIT_V, vy: 0, angle: Math.PI, fuel: 100 };

requestAnimationFrame(loop);
