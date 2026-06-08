# Moonshot — Code Review

_Reviewed: 2026-04-06 | Reviewer: Mister Krabs 🦀 | File: game.js (~1998 lines)_
_Updated: 2026-04-07 — top 3+1 bugs fixed + dead code cleanup + symplectic Euler verified (see Fixes Applied below)_

---

## 1. Code Quality & Structure

**Overall shape:** One flat JS file with clear section banners. Fine for a solo project; at ~2000 lines it is starting to strain.

**Global state sprawl.** Every mission has its own top-level global pair (state/rocket, lState/lRocket, m3State/m3Rocket, m0State/m0Rocket, m4State/m4Rocket). This forces a deeply nested 5-way ternary dispatch that appears at least 4 times in the codebase (keydown handler ~line 155, initTouchControls, initOrientButtons, loop). A getActiveState() / getActiveRocket() helper would eliminate all of it.

**Copy-paste duplication.** The physics update structure is near-identical across updatePhysics, updateLandingPhysics, updateM3Physics, updateM4Physics (warp/substep loop, rotation, orientMode tracking, trail push). renderLanding and renderM3 share ~100 lines of identical moon-drawing code.

**Mixed var/const/let.** M4 code (~line 790+) uses var throughout while earlier missions use const/let. Inconsistent style.

**Dead variable:** m0Stage1Sep declared at ~line 107, never read.

**Identity ternary in resetLanding** (~line 297): both branches of the handoff ternary produce the identical string "IN LUNAR ORBIT — INITIATE DESCENT". Does nothing.

**LAND_FUEL_RATIO** could be a named constant instead of recomputing FUEL_DRAIN*(LAND_THRUST/THRUST) inline.
---

## 2. Performance (Render Loop, GC, Allocations)

**moonXY() allocates a new {x,y} object every call.** Called in physics substeps + prediction + render = ~50-100 allocs/frame, ~6000/sec at 60fps. Fix: reuse a cached object. Caveat: callers must not store the reference across calls.

**gravAccel() also allocates {ax,ay,dist} per call** on every substep. Same fix applies.

**Trajectory prediction runs every frame** (predictPath, predictLandingPath, predictM3Path, predictM4Path) doing up to 200 x 4 = 800 gravity evaluations per frame. Fine on desktop; painful on mobile. Cache and only recalculate when |delta-v| exceeds a threshold, or throttle to every 2-3 frames.

**strokePath rebuilds the trail canvas path from scratch every frame** via beginPath() + 450-point loop. An incremental offscreen canvas trail would be significantly faster.

**drawSpeedGauge redraws tick marks in a loop every frame** (up to 100 iterations). They never change shape. Prerender to an offscreen canvas.

**Gradients recreated every frame.** createRadialGradient/createLinearGradient for Earth, Moon, and atmosphere appear in every render call. Cache on startup, recreate only on resize.

**pts.slice(0, N) in render** allocates a new array every frame. Replace with a start-index draw loop.
---

## 3. Bugs / Edge Cases

**~~M4 stableTimer runs N× too fast at warp N. (Real bug.)~~ ✅ FIXED 2026-04-07** evalM4State() is called from inside the substep loop and receives realDt (the full un-warped frame delta). At warp 5 with 10 substeps, the timer accumulates realDt 10 times per frame. The hold could complete in ~3 real seconds at warp 5 instead of 60. M3 correctly accumulates its hold timer once per frame after the substep loop. Fix: move the stableTimer accumulation out of evalM4State and into a per-frame block as M3 does.

**evalState (orbit) recalculates moonNow redundantly** (~line 453). The moonXY(state.moonAngle) result is already computed at the top of the substep loop as , but evalState calls moonXY again. Pass  as a parameter.

**Stage separation (updateM0Physics, ~line 1445) is safe by accident.** The if-block runs inside the substep loop, but setting stage=2 prevents re-entry. The vy+30 separation kick is applied in world-space (downward canvas +Y), not rocket-frame, which looks physically wrong at non-vertical orientations.

**transition.start() win path is re-entrant-prone.** _(handleCanvasClick now guarded with `if (transition.active) return` — partially mitigated)_ After end("win",...) is called in evalState, the substep loop break fires on the *next* check, not immediately. Works correctly today but is fragile; a future refactor could cause double-fire of the transition callback.

**M3 stableTimer double-reset.** Both evalM3State (~line 609) and the per-frame block in updateM3Physics reset stableTimer=0 when out of band. Harmless but confusing.

**ESCAPE_DIST** is half the canvas diagonal (~576u). The Moon orbit is 470u. Works, but looks accidental. Worth a comment.
---

## 4. Physics & Gameplay Feel

**Explicit Euler integration.** v += a*dt then x += v*dt is first-order and does not conserve energy. A circular orbit slowly spirals. Symplectic Euler (update v first, then x += v*dt) is a one-line change per substep and preserves energy far better for long coasting arcs.

**TIME_SCALE + substeps:** NSUB = warp*2 yields a substep dt of realDt * 0.44 * warp / (warp*2) = realDt * 0.22. At 60fps warp 1 that is ~3.7ms per substep, which is reasonable.

**gravAccel clamps d² to 100** (Math.max(d2, 100)), preventing singularities. The collision check radius (EARTH_R+5 = 33u, d² = 1089) should trigger before the clamp matters in practice.

**Landing win is altitude-only** (alt <= 5, speed <= 55). A 54 u/s sideways impact over the pad still wins. Adding a radial vs tangential speed check would make crashed landings feel more authentic.

**Prograde auto-orient is not warp-scaled.** The rotation step is ROT_SPEED * 1.5 * realDt regardless of warp. At warp 5, prograde tracking noticeably lags during burns. Multiply step by warp (or a damped fraction) to keep orientation responsive.

**M0 constant gravity** is an intentional design choice and well-executed. The transition to N-body mechanics in M1 is jarring by design.
---

## 5. Touch / Mobile

**Touch controls are well-structured** with pointerdown/up/out/cancel listeners and passive:false on touchmove. Simultaneous thrust + rotate works correctly since each button has independent listeners.

**pointerout as release handler** can misfire on fast swipes that leave button bounds before the pointer lifts. A window-level pointerup listener is more reliable.

**Canvas is fixed-size.** W/H are read once at startup, never updated. No resize handler exists. On a 390px-wide phone, the title screen 3-column card grid (totalW = 680*3 + 80 = 2120px) is completely off-screen. All HUD elements use hardcoded pixel positions assuming 1280x720+.

**No landscape lock or orientation prompt.** Portrait mode on mobile produces a broken render. A CSS @media (orientation: portrait) overlay would help significantly.

**Keyboard hint overlay is correctly hidden on touch** via ov.style.display = none. Good detail.

---

## 6. Ideas for Improvement

- **getActiveState() / getActiveRocket() helpers** — remove the 5-way ternary chains that appear 4+ times. Makes adding M5 a one-liner.
- **Offscreen canvas caching** for speed gauge ticks, crater layer, and gradient backgrounds. Biggest single performance win for mobile.
- **Symplectic Euler** — one-line change per substep, significantly better orbit energy conservation.
- **Sound effects via Web Audio API** — thruster hiss, landing thud, mission-complete chime. No libraries needed, large feel improvement.
- **Fuel star rating on win** — 3 stars >60% remaining, 2 stars >30%, 1 star landed. Easy addition to drawOutcomeBanner.
- **Mission timer + localStorage high scores** — the stableTimer pattern is already there; add missionStartTime and best-time tracking.
- **Throttle trajectory prediction** — recalculate only when |delta-v| > epsilon or every 3rd frame. Biggest CPU saving available.
- **Replace rrect manual arcTo** with ctx.roundRect() — now baseline in all modern browsers, 1 line vs 6.
- ~~**Dead code cleanup**~~ ✅ Fixed 2026-04-07 — removed `m0Stage1Sep`, fixed identity ternary in `resetLanding`, extracted `LAND_FUEL_RATIO` constant.
- **Mission 5 Reentry** — heat shield (angle of attack, thermal load), parachute deploy. The locked card slot is already on the title screen.

---

## 8. Fixes Applied

_2026-04-07 — applied by Mister Krabs 🦀_

| # | Fix | Location | Notes |
|---|-----|----------|-------|
| 1 | Guard `handleCanvasClick` with `if (transition.active) return` | `handleCanvasClick()` top | Prevents double-firing outcome buttons during fade transitions |
| 2 | Reset `orbitHandoff = null` on all title entries | New `enterTitle()` helper | All `scene='title'` assignments replaced with `enterTitle()`, including menu button. Ensures direct M2 start is always fresh. |
| 3 | M4 `stableTimer` warp-speed bug | `updateM4Physics()` | Moved `evalM4State()` call from inside substep loop to once per frame. At warp 5 the timer was accumulating 10× per frame; now correct. |
| 4 | `setTouchUIVisible` event-driven (not per-frame) | `loop()` + scene entry points | Removed per-frame call in render loop; added explicit `setTouchUIVisible(true/false)` at each scene transition point instead. |
| 5 | Symplectic Euler verified + documented | Comment at line ~60 | Integration was already symplectic (v updated before x) — added comment to document this. No code change needed. |
| 6 | Dead code: remove `m0Stage1Sep` | Global state block | Variable declared but never read — removed. |
| 7 | Dead code: fix identity ternary in `resetLanding` | `resetLanding()` | Both branches produced the same string — simplified to a direct assignment. |
| 8 | Dead code: extract `LAND_FUEL_RATIO` constant | Constants block + landing physics | `FUEL_DRAIN*(LAND_THRUST/THRUST)` inlined in physics loop — extracted to named constant. |

_2026-06-08 — refactor pass_

| # | Fix | Location | Notes |
|---|-----|----------|-------|
| 9  | `getActiveState()` / `getActiveRocket()` + `SCENES` registry | new block after STATE | Replaced the 5-way `scene === ... ? ... : ...` ternary in the keydown handler, restart (`R` + side button), orient buttons, touch rotate, warp buttons, and warp-cycle button. Adding a mission is now one registry entry. |
| 10 | Latent input bugs fixed by the registry | touch rotate / warp / `R` | Touch rotate + warp buttons previously never targeted M0 (ternary omitted it); `R` in single-mode landing reset to 100% fuel instead of the 80% entry budget. The single restart path fixes both. |
| 11 | `drawHoldRing()` extracted | HUD helpers | The hold-orbit countdown ring was copy-pasted 4× (orbit/M0/M3/M4) with only colour + hold-time differing. One helper, `rgb` + `holdMax` params. |
| 12 | `drawTelemetryPills(items)` unified | HUD helpers | Bottom-row pills were inlined 4× (landing/M3/M0) plus the orbit/M4 version. Now one renderer takes `[{label,value,color?}]`. |
| 13 | Speed gauge static layer cached | `gaugeStaticLayer()` / `drawSpeedGauge()` | Background arcs + tick marks + end labels (~10–100 strokes/frame) now render once per `MAX_SPD` into an offscreen canvas and are blitted each frame. Only the fill arc, needle, and number redraw. |

**Still open (next session):**
- Cache Earth/Moon/atmosphere gradients to offscreen canvases (remaining performance item)
- `var` → `const`/`let` sweep in M0/M4 code (cosmetic consistency)
- Web Audio sound effects
- Fuel star rating on win screen
- Mission timer + localStorage best times


---

## 7. Summary

Moonshot is a polished, genuinely fun browser game that punches well above its weight for a solo vanilla-JS project. The visual layer — lighting, shadows, eclipse calculations, parallax title — is well above average. The mission progression and orbit-handoff system are thoughtful and work correctly.

**Top 3 priorities:**

1. ~~**Fix the M4 stableTimer bug**~~ ✅ Fixed 2026-04-07 — `evalM4State` moved out of substep loop.
2. **Cache gradients and speed gauge ticks to offscreen canvases** — the biggest practical performance improvement, especially on mobile. _(still open)_
3. **Add getActiveState() helper** — the 5-way ternary dispatch is a maintainability timebomb; every new mission makes it worse. _(still open)_

The codebase is well-commented where it matters (physics math, camera, handoff logic) and the section banners make navigation easy. Solid foundation for Mission 5 and beyond.

**Overall code quality: 7/10**
_Well above average for a solo/game-jam project. Deductions for: significant copy-paste duplication across missions, no mobile viewport adaptation, and one real logic bug (M4 timer). The physics is arcade-accurate and the visual quality is genuinely impressive._
