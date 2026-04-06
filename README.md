# 🚀 Moonshot

A browser-based arcade space mission game built with **HTML5 Canvas**, **CSS**, and **vanilla JavaScript** — no libraries, no backend, no build step.

Guide your spacecraft through six sequential missions from Earth launch all the way to lunar orbit, landing, ascent, and return. Each mission unlocks after completing the previous one, and your remaining fuel carries forward.

---

## Missions

| # | Name | Objective |
|---|------|-----------|
| 00 | **Launch** | Launch from Earth and reach a stable low-Earth orbit corridor (800–1400 u altitude, ≥75% horizontal velocity) |
| 01 | **Lunar Orbit** | Perform a trans-lunar injection and hold stable orbit around the Moon |
| 02 | **Lunar Landing** | De-orbit and land softly on the lunar surface (touchdown speed ≤ 55 u/s, on the designated pad) |
| 03 | **Lunar Ascent** | Launch from the Moon and reach lunar orbit |
| 04 | **Return Home** | Navigate back from lunar orbit to Earth |
| 05 | **Reentry** | *(Coming soon)* Atmospheric reentry and splashdown |

Progress is saved in `localStorage`. Mission cards unlock in sequence — beating M0 unlocks M1, and so on.

---

## Controls

### Keyboard
| Key | Action |
|-----|--------|
| `W` / `Space` | Thrust |
| `A` / `D` | Rotate left / right |
| `E` | Prograde lock |
| `Q` | Retrograde lock |
| `1` – `4` | Time warp (1×, 2×, 3×, 5×) |
| `R` | Restart mission |

### Touch (tablet / mobile)
- **PRO / RETRO** buttons — prograde/retrograde orientation lock
- **◁ / ▷** buttons — rotate
- **▲ THRUST** button — thrust
- **Warp buttons** — time warp
- **↺ Restart** — restart mission
- **☰** — return to mission select

---

## Gameplay Details

### Fuel
- Starts at 100% for Mission 00 and Mission 01
- Carries over from M1 → M2 → M3 → M4 (the fuel you land with is the fuel you ascend with)
- Retry preserves the fuel you had when you entered that mission

### Physics
- **M0 (Launch):** Constant gravity (320 u/s²) + exponential atmospheric drag. Ballistic feel, no orbital mechanics.
- **M1–M4 (Space):** Newtonian gravity from Moon (G=1800, M=1800). Full orbital mechanics — you can achieve real orbits, slingshots, and escape trajectories.
- **M2 (Landing):** Reduced thrust (120 vs 360) for fine control. Trajectory prediction arc shown.
- Substep physics loop at fixed 120 Hz for stability, time-warp up to 5×.

### Win Conditions
- **M0:** Hold orbit corridor for 15 s
- **M1:** Hold stable lunar orbit band for 30 s
- **M2:** Touchdown on pad at ≤ 55 u/s
- **M3:** Hold lunar orbit band (440–540 px) for 30 s
- **M4:** Return to Earth proximity and hold stable for required time

### Transitions
All mission completions fade seamlessly into the next scene — no button clicks required on win. Fuel and orbital state are carried across the handoff.

---

## Technical Notes

- Canvas fixed at **2400 × 1600** (CSS-scaled to fit the viewport)
- Single `game.js` (~2000 lines), single `style.css`, single `index.html`
- No external dependencies — runs offline from the filesystem
- Touch controls hidden on desktop (hover + fine pointer media query)
- Star parallax on title screen: mouse-driven on desktop, static on touch
- Progress stored in `localStorage` keys: `moonshot_m1`, `moonshot_m2`, `moonshot_m3`

---

## Running Locally

```bash
# Clone
git clone https://github.com/alexpils/moonshot.git
cd moonshot

# Serve (any static server works)
python3 -m http.server 8081
# → http://localhost:8081
```

Or just open `index.html` directly in a browser (file:// works fine).

---

## Development

All game logic lives in `game.js`. Key sections:

- **Constants** — physics, mission params, canvas size
- **Progress / localStorage** — unlock system
- **Render loop** — `requestAnimationFrame` driver with substep physics
- **Per-mission state + renderers** — `m0State`/`m0Rocket`, `state`/`rocket`, `lState`/`lRocket`, `m3State`, `m4State`
- **Transition system** — fade-in/out between missions
- **`drawOutcomeBanner()`** — unified win/fail banner across all missions
- **`renderTitle()`** — 3×2 mission card grid, star parallax

---

*Built as a side project. Contributions welcome.*
