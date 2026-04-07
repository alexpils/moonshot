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

**Full Mission** — Start from M00 Launch and fly the complete mission chain. Missions auto-chain with fuel carrying over. Endgame screen after M04 shows your stats for all missions.

**Single Mission** — Pick any unlocked mission and fly it standalone. Starts with a realistic fuel budget (M01: 100%, M02: 80%, M03: 60%, M04: 40%) simulating arriving on budget from the prior mission. Unlock logic still applies — beat missions in order.

---

## Controls

| Input | Action |
|-------|--------|
| **W / Space / ↑** | Thrust |
| **A / ←** | Rotate left |
| **D / →** | Rotate right |
| **E** | Prograde lock |
| **Q** | Retrograde lock |
| **1–4** | Time warp (1×, 2×, 3×, 5×) |
| **R** | Restart mission |

**Touch controls:** Rotate and thrust buttons on side panels. Warp cycle button (left panel, below RETRO) taps through 1×→2×→3×→5×→1×. Restart bottom-right. Portrait mode prompts you to rotate your device.

---

## HUD

- **Fuel gauge** — prominent bar at bottom center. Color-coded (blue→amber→red). Green target marker shows recommended fuel remaining for the next mission. M00 shows purple STAGE 2 marker at 50%.
- **Speed gauge** — arc gauge bottom-left
- **Trajectory prediction** — dashed yellow line showing your path. On M02 landing, tip color indicates: 🟢 TOUCHDOWN (on pad, safe speed) / 🟡 SLOW DOWN (on pad, too fast) / 🔴 MOON IMPACT (off pad)
- **Status bar** — mission guidance text at top center
- **Telemetry pills** — distances and warp factor

---

## Physics

- Newtonian gravity from Earth and Moon
- Symplectic Euler integration (energy-conserving)
- Moon orbits Earth in real time
- M00: two-stage rocket with atmospheric drag, exponential scale height
- M02: Moon-only gravity for landing scene
- Time warp: 1×, 2×, 3×, 5× (sub-stepped for stability)
- Camera: smooth blend to Moon-centred view when in lunar orbit

---

## Tech

Vanilla JS + HTML5 Canvas. No libraries, no build step. Single file (`game.js`, ~2200 lines). Served as static files.

```bash
# Run locally
python3 -m http.server 8081
# Open http://localhost:8081
```
