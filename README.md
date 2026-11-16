# 🚀 Moonshot

A physics-based space flight game. Navigate a rocket from Earth launch to lunar landing and back down through the atmosphere to splashdown — all in your browser, no installation required.

**[▶ Play on GitHub Pages](https://alexpils.github.io/moonshot)**

---

## Missions

| # | Mission | Objective |
|---|---------|-----------|
| M00 | 🚀 Launch | Launch from Earth, pitch over, achieve stable orbit |
| M01 | 🌍 Lunar Orbit | Burn prograde from Earth orbit to reach stable lunar orbit |
| M02 | 🌕 Lunar Landing | Descend and touch down on the landing pad at ≤ 55 u/s |
| M03 | 🚀 Lunar Ascent | Launch from the Moon back to lunar orbit |
| M04 | 🌍 Return Home | Navigate back to Earth and hold stable orbit |
| M05 | 🪂 Reentry | Deorbit, survive atmospheric entry, deploy parachutes and splash down |

### M05 Reentry in detail

1. **Deorbit burn** — point retrograde and burn. The prediction readout under the status bar tells you whether the entry is **✓ in the corridor**, a **⚠ skip-out** (too shallow) or a **⚠ burn-up** (too steep), and how far your splashdown will be from the recovery ship. *When* you burn moves the splashdown downrange.
2. **Entry** — the service module is jettisoned (and burns up) at the entry interface. The capsule is aerodynamically stable: **A/D tilt it** relative to the airflow. Tilting nose-up generates lift (flatter, cooler, but too much skips you back out); nose-down steepens the descent and overheats. Keep the heat shield inside the green cone on the attitude dial — outside it the bare hull heats 4× faster. **Q** snaps back to shield-forward; **E** flips the capsule (don't).
3. **Parachutes** — press **Space** to open the **drogue** below 300 u/s, then again for the **main** below 90 u/s. Opening either too fast tears it. Only a fresh press counts, and presses right after separation are ignored.
4. **Splashdown** — hit the water at ≤ 21 u/s. Rating (★–★★★) is your distance from the recovery ship; the endgame shows shield left instead of fuel.

Time warp drops to 1× automatically at separation and when each parachute window opens.

---

## Game Modes

**Full Mission** — Start from M00 Launch and fly the complete chain. Missions auto-chain with fuel carrying over. Endgame screen after M05 shows stats for all missions.

**Single Mission** — Pick any unlocked mission and fly it standalone. Starts with a realistic fuel budget simulating arriving on target from the prior mission:

| Mission | Start fuel | Target marker |
|---------|-----------|---------------|
| M01 Orbit | 100% | 80% |
| M02 Landing | 80% | 60% |
| M03 Ascent | 60% | 40% |
| M04 Return | 40% | 20% |
| M05 Reentry | 20% | — |

---

## Controls

### Desktop
| Input | Action |
|-------|--------|
| **W / Space / ↑** | Thrust (M05 after separation: deploy drogue, then main chute) |
| **A / ←** | Rotate left (M05 entry: tilt nose-down) |
| **D / →** | Rotate right (M05 entry: tilt nose-up) |
| **E** | Prograde lock |
| **Q** | Retrograde lock |
| **1–4** | Time warp (1×, 2×, 3×, 5×) |
| **R** | Restart mission |

### Touch
Side panels with rotate, thrust, PRO/RETRO buttons. In M05 the THRUST button becomes **CHUTE** after the service module separates. Warp cycle (left panel, below RETRO) taps through 1×→2×→3×→5×. Restart bottom-right. Portrait mode shows a rotate hint. Tap the fullscreen button (⛶) for best experience.

---

## HUD

- **Fuel gauge** — prominent bar at bottom center with glow. Color: blue→amber→red. Green target marker shows recommended fuel for the next mission. M00 shows purple STAGE 2 marker at 50%. In M05 it becomes the **SHIELD** bar after separation.
- **Speed gauge** — arc gauge bottom-left
- **Trajectory prediction** — dashed path showing where you're headed. On M02 landing the tip shows: 🟢 TOUCHDOWN / 🟡 SLOW DOWN / 🔴 MOON IMPACT. On M05 it shows 🟢 CHUTE ZONE / 🟡 SKIP-OUT / 🔴 BURN-UP, then the predicted splashdown, plus a verdict readout under the status bar
- **Attitude dial** (M05) — bottom-right: green cone = where the heat shield protects you, line = capsule nose, arrow = direction of travel, with tilt and lift direction
- **Status bar** — mission guidance at top center
- **Telemetry pills** — distances and warp factor

---

## Physics

- Newtonian gravity from Earth and Moon
- Symplectic Euler integration (energy-conserving)
- Moon orbits Earth in real time
- M00: two-stage rocket with atmospheric drag, exponential scale height
- M02: Moon-only gravity for landing scene
- M05: side-on entry model — gravity relieved by orbital speed (so a parking orbit exists), exponential atmosphere, quadratic drag (semi-implicit, stable under parachutes), lift from tilt (L/D 0.4), heat flux ∝ ρv³ feeding a hull-heat and shield-ablation model. Constants were tuned with a headless simulation so the entry corridor is real: lift-down always burns up, neutral survives small/medium burns, lift-up survives steep burns but skips out on shallow ones
- Time warp: 1×, 2×, 3×, 5× (sub-stepped for stability)
- Camera: smooth blend to Moon-centred view in lunar orbit

---

## Soundtrack

Each mission has its own track, all by Kevin MacLeod (incompetech.com), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/):

| Scene | Track |
|-------|-------|
| Title / Endgame | Rocket |
| M00 Launch / M05 Reentry | At Launch |
| M01–M03 | Mesmerizing Galaxy |
| M04 Return | Space Fighter |

Music attribution is shown as an overlay at the start of each scene.

---

## Tech

Vanilla JS + HTML5 Canvas. No libraries, no build step. Single game file (`game.js`, ~3050 lines). A scene registry (`SCENES` + `getActiveState`/`getActiveRocket`) drives all per-mission input, and shared HUD helpers (`drawHoldRing`, `drawTelemetryPills`, cached speed gauge) keep the six missions from duplicating render code.

```bash
# Run locally
python3 -m http.server 8081
# Open http://localhost:8081
```
