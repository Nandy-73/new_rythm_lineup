# Rhythm Trace

An eye-gaze rhythm game built with React, HTML5 Canvas, and MediaPipe face tracking. Players follow a sinusoidal path using their eyes and blink at checkpoints — designed for research on Dynamic Difficulty Adjustment (DDA) in gaze-based interfaces.

Supports both **webcam-based gaze tracking** (via MediaPipe FaceLandmarker) and **Tobii Eye Tracker 4C / Pro** (via WebSocket backend).

---

## Features

- **Eye-gaze control** — cursor follows your iris position in real-time
- **Blink detection** — blink at checkpoints to score points
- **Dynamic Difficulty Adjustment (DDA)** — difficulty adapts to keep players in a flow state (toggleable for user testing)
- **Adaptive music** — dual-bus audio crossfades between pleasant and distorted based on accuracy
- **Tobii Pro support** — optional Python WebSocket backend for professional eye trackers
- **Webcam fallback** — works with any standard webcam using MediaPipe



## Prerequisites

- **Node.js** 18+ and **npm**
- A **webcam** (for MediaPipe mode) or **Tobii Eye Tracker 4C / Pro** (for Tobii mode)
- **Python 3.10+** (only if using Tobii backend)
- A modern browser (Chrome/Edge recommended for WebGL + SharedArrayBuffer support)

### MediaPipe WASM + Model Files

The webcam gaze tracker requires MediaPipe WASM files and the face landmark model. Download and place them:

1. **WASM files** — download from the [@mediapipe/tasks-vision npm package](https://www.npmjs.com/package/@mediapipe/tasks-vision):
   ```
   frontend/public/wasm/
   ├── vision_wasm_internal.js
   └── vision_wasm_internal.wasm
   ```

2. **Face Landmarker model** — download `face_landmarker.task` from [MediaPipe Models](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker#models):
   ```
   frontend/public/models/
   └── face_landmarker.task
   ```

---

## Installation & Setup

### 1. Clone the repository

```bash
git clone https://github.com/nandy-73/new-rhythm-trace.git
cd new-rhythm-trace
```

### 2. Install frontend dependencies

```bash
cd frontend
npm install
```

### 3. Set up MediaPipe assets

```bash
# Create directories
mkdir -p public/wasm public/models

# Copy WASM files from node_modules
cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js public/wasm/
cp node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm public/wasm/

# Download face landmarker model
curl -L -o public/models/face_landmarker.task \
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
```

### 4. (Optional) Set up Tobii backend

Only needed if you have a Tobii eye tracker connected via USB:

```bash
cd ../backend
pip install -r requirements.txt
```

> **Note:** The `tobii-research` package requires the Tobii Pro SDK to be installed on your system.

---

## Running the Game

### Webcam Mode (default)

```bash
cd frontend
npm run dev
```

Open **http://localhost:3000** in Chrome/Edge. Allow camera access when prompted.

### Tobii Mode

1. Start the backend:
   ```bash
   cd backend
   python gaze_server.py
   ```

2. Edit `frontend/src/hooks/useGaze.js` — change line 4:
   ```js
   const USE_TOBII = true;   // change from false to true
   ```

3. Start the frontend:
   ```bash
   cd frontend
   npm run dev
   ```

4. Open **http://localhost:5173** in your browser.

---

## How to Play

1. **SPACE** — Start the game from the title screen
2. **Calibration screen** — Calibrate your Tobii tracker (or just press SPACE again for webcam mode)
3. **SPACE** — Begin playing
4. **Follow the path** — move your eyes to keep the cursor on the pink/purple neon line
5. **BLINK at checkpoints** — when you see "BLINK NOW!", blink to score bonus points
6. **B key** — simulates a blink (for testing without a tracker)
7. **ESC** — return to title screen

### Scoring

| Action | Points |
|--------|--------|
| Staying on track | 200/sec (+ combo multiplier) |
| Blink at checkpoint | +500 |
| Miss a checkpoint | -200 and lose 1 life |
| Complete a segment | +1000 |

You have **3 lives**. Missing a blink checkpoint costs one life. Game over when all lives are lost.

---

## DDA Toggle (for User Testing)

The game includes a **Dynamic Difficulty Adjustment** system that can be toggled for A/B testing:

Edit `frontend/src/components/GameCanvas.jsx`, line 4:

```js
// For fixed difficulty (user testing — Condition A):
const USE_DDA = false;

// For adaptive difficulty (original behavior — Condition B):
const USE_DDA = true;
```

When `USE_DDA = false`:
- Difficulty stays fixed at D=0.30 (30%)
- HUD shows "FIXED DIFFICULTY" instead of "DDA ACTIVE"
- Path complexity and speed remain constant

When `USE_DDA = true`:
- Difficulty adjusts every 2 seconds based on player accuracy
- Targets 55-75% accuracy (flow zone)
- HUD shows difficulty changes (HARDER/EASIER/FLOW ZONE)

---

## Configuration

### Key Constants (GameCanvas.jsx)

| Constant | Default | Description |
|----------|---------|-------------|
| `USE_DDA` | `false` | Enable/disable Dynamic Difficulty Adjustment |
| `BASE_SPEED` | `0.013` | Base horizontal scroll speed |
| `TOL_BASE` | `0.11` | Base tolerance band width |
| `LIVES_MAX` | `3` | Starting lives |
| `D_INIT` | `0.30` | Initial difficulty (0-1) |
| `FLOW_LOW` / `FLOW_HIGH` | `55` / `75` | Flow zone accuracy range (%) |
| `DDA_ALPHA` | `0.30` | DDA adjustment rate |
| `BLINK_WINDOW` | `2.0` | Seconds to blink at a checkpoint |
| `BLINK_MIN_MS` / `BLINK_MAX_MS` | `60` / `400` | Blink duration range (ms) |

### Gaze Settings (useGaze.js)

| Constant | Default | Description |
|----------|---------|-------------|
| `USE_TOBII` | `false` | Use Tobii tracker instead of webcam |
| `BLINK_THRESH` | `0.45` | Blendshape threshold for blink detection |
| `Y_LOW` / `Y_HIGH` | `0.28` / `0.72` | Vertical gaze mapping range |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18 + Vite 5 |
| Rendering | HTML5 Canvas 2D API |
| Gaze (webcam) | MediaPipe Tasks Vision (FaceLandmarker) |
| Gaze (Tobii) | tobii-research Python SDK + WebSocket |
| Audio | Web Audio API (dual-bus adaptive music) |
| Backend | Python asyncio + websockets |

---

## Building for Production

```bash
cd frontend
npm run build
```

Output will be in `frontend/dist/`. Serve with any static file server — but ensure COOP/COEP headers are set:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These headers are required for MediaPipe's SharedArrayBuffer/WASM support.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Camera not working | Check browser permissions, use HTTPS or localhost |
| "Failed to resolve @mediapipe/tasks-vision" | Run `npm install` in the `frontend` folder |
| MediaPipe WASM not loading | Copy WASM files to `public/wasm/` (see setup step 3) |
| Face model not loading | Download `face_landmarker.task` to `public/models/` |
| Tobii not detected | Check USB connection, install Tobii Pro SDK |
| Black screen / no rendering | Use Chrome or Edge (Firefox may not support all Canvas features) |
| Audio not playing | Click on the page first (browsers require user interaction for audio) |

---

## Authors

- **Vijaya Nanthini SELVAM** — University of Geneva, Faculty of Science
- **Alexandra Bolotina** — University of Geneva, Faculty of Science

Interaction Multimodale et Affective (D400002) — Academic Year 2025-2026

---

## License

This project is part of academic coursework at the University of Geneva.
