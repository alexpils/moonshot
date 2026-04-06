# Moonshot — Code Review

_Reviewed: 2026-04-06 | Reviewer: Mister Krabs 🦀 | File: game.js (~1998 lines)_

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

**M4 stableTimer runs N× too fast at warp N. (Real bug.)** evalM4State() is called from inside the substep loop and receives realDt (the full un-warped frame delta). At warp 5 with 10 substeps, the timer accumulates realDt 10 times per frame. The hold could complete in ~3 real seconds at warp 5 instead of 60. M3 correctly accumulates its hold timer once per frame after the substep loop. Fix: move the stableTimer accumulation out of evalM4State and into a per-frame block as M3 does.

**evalState (orbit) recalculates moonNow redundantly** (~line 453). The moonXY(state.moonAngle) result is already computed at the top of the substep loop as , but evalState calls moonXY again. Pass  as a parameter.

**Stage separation (updateM0Physics, ~line 1445) is safe by accident.** The if-block runs inside the substep loop, but setting stage=2 prevents re-entry. The vy+30 separation kick is applied in world-space (downward canvas +Y), not rocket-frame, which looks physically wrong at non-vertical orientations.

**transition.start() win path is re-entrant-prone.** After end("win",...) is called in evalState, the substep loop break fires on the *next* check, not immediately. Works correctly today but is fragile; a future refactor could cause double-fire of the transition callback.

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
