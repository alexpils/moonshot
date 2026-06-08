# 🚀 Moonshot

A physics-based space flight game. Navigate a rocket from Earth launch to lunar landing and back — all in your browser, no installation required.

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
| M05 | 🔒 Reentry | *Coming soon* |

---

## Game Modes

**Full Mission** — Start from M00 Launch and fly the complete chain. Missions auto-chain with fuel carrying over. Endgame screen after M04 shows stats for all missions.

**Single Mission** — Pick any unlocked mission and fly it standalone. Starts with a realistic fuel budget simulating arriving on target from the prior mission:

| Mission | Start fuel | Target marker |
|---------|-----------|---------------|
| M01 Orbit | 100% | 80% |
| M02 Landing | 80% | 60% |
| M03 Ascent | 60% | 40% |
| M04 Return | 40% | — |

---

## Controls

### Desktop
| Input | Action |
|-------|--------|
| **W / Space / ↑** | Thrust |
| **A / ←** | Rotate left |
| **D / →** | Rotate right |
| **E** | Prograde lock |
| **Q** | Retrograde lock |
| **1–4** | Time warp (1×, 2×, 3×, 5×) |
| **R** | Restart mission |

### Touch
Side panels with rotate, thrust, PRO/RETRO buttons. Warp cycle (left panel, below RETRO) taps through 1×→2×→3×→5×. Restart bottom-right. Portrait mode shows a rotate hint. Tap the fullscreen button (⛶) for best experience.

---

## HUD

- **Fuel gauge** — prominent bar at bottom center with glow. Color: blue→amber→red. Green target marker shows recommended fuel for the next mission. M00 shows purple STAGE 2 marker at 50%.
- **Speed gauge** — arc gauge bottom-left
- **Trajectory prediction** — dashed path showing where you're headed. On M02 landing the tip shows: 🟢 TOUCHDOWN / 🟡 SLOW DOWN / 🔴 MOON IMPACT
- **Status bar** — mission guidance at top center
- **Telemetry pills** — distances and warp factor

---

## Physics

- Newtonian gravity from Earth and Moon
- Symplectic Euler integration (energy-conserving)
- Moon orbits Earth in real time
- M00: two-stage rocket with atmospheric drag, exponential scale height
- M02: Moon-only gravity for landing scene
- Time warp: 1×, 2×, 3×, 5× (sub-stepped for stability)
- Camera: smooth blend to Moon-centred view in lunar orbit

---

## Soundtrack

Each mission has its own track, all by Kevin MacLeod (incompetech.com), licensed under [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/):

| Scene | Track |
|-------|-------|
| Title / Endgame | Rocket |
| M00 Launch | At Launch |
| M01–M03 | Mesmerizing Galaxy |
| M04 Return | Space Fighter |

Music attribution is shown as an overlay at the start of each scene.

---

## Tech

Vanilla JS + HTML5 Canvas. No libraries, no build step. Single game file (`game.js`, ~2400 lines). A scene registry (`SCENES` + `getActiveState`/`getActiveRocket`) drives all per-mission input, and shared HUD helpers (`drawHoldRing`, `drawTelemetryPills`, cached speed gauge) keep the five missions from duplicating render code.

```bash
# Run locally
python3 -m http.server 8081
# Open http://localhost:8081
```
