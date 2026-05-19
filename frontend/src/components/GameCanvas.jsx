import { useEffect, useRef } from "react";

// ─── Constants ────────────────────────────────────────────────────────────────
const BASE_SPEED    = 0.013;
const TOL_BASE      = 0.11;
const PATH_W        = 90;
const TRAIL_LENGTH  = 28;
const CURSOR_SMOOTH = 0.22;
const LIVES_MAX     = 3;
const SCORE_PER_SEC = 200;
const BLINK_MIN_MS  = 60;
const BLINK_MAX_MS  = 400;
const D_INIT        = 0.30;
const D_MIN         = 0.00;
const D_MAX         = 1.00;
const FLOW_LOW      = 55;
const FLOW_HIGH     = 75;
const FLOW_CENTER   = 65;
const DDA_ALPHA     = 0.30;
const DDA_INTERVAL  = 2.0;
const DSMOOTH_RATE  = 0.012;

const CHECKPOINT_XS = [
  0.06, 0.12, 0.18, 0.24, 0.30, 0.36, 0.42, 0.48,
  0.54, 0.60, 0.66, 0.72, 0.78, 0.84, 0.90, 0.96,
];
const CHECKPOINT_BONUS = 500;
const MISS_PENALTY     = 200;
const BLINK_WINDOW     = 4.5;
const ZONE_MAX_FRAC    = 0.06;
const SEGMENT_BONUS    = 1000;

function getEffSpeed(D) { return BASE_SPEED * (0.70 + D * 0.60); }
function getEffTol(D)   { return TOL_BASE   * (1.60 - D); }

// ─── Audio ────────────────────────────────────────────────────────────────────
const MELODY = [
  261.63, 261.63, 392.00, 392.00, 440.00, 440.00, 392.00,
  349.23, 349.23, 329.63, 329.63, 293.66, 293.66, 261.63,
  392.00, 392.00, 349.23, 349.23, 329.63, 329.63, 293.66,
  392.00, 392.00, 349.23, 349.23, 329.63, 329.63, 293.66,
  261.63, 261.63, 392.00, 392.00, 440.00, 440.00, 392.00,
  349.23, 349.23, 329.63, 329.63, 293.66, 293.66, 261.63,
];

// q = 0 → fully distorted (playing poorly)  |  q = 1 → fully soft (playing well)
// Both music buses run simultaneously; crossfade between them via gain nodes.
function createAdaptiveMusicSystem(audioCtx) {
  const goodBus = audioCtx.createGain(); // soft pleasant music
  const badBus  = audioCtx.createGain(); // distorted harsh music
  goodBus.gain.value = 1.0;
  badBus.gain.value  = 0.0;
  goodBus.connect(audioCtx.destination);
  badBus.connect(audioCtx.destination);

  // Heavy distortion waveshaper for the bad bus
  const distort = audioCtx.createWaveShaper();
  distort.oversample = "4x";
  const dCurve = new Float32Array(512);
  const dAmt   = 120;
  for (let i = 0; i < 512; i++) {
    const x = (2 * i / 512) - 1;
    dCurve[i] = ((Math.PI + dAmt) * x) / (Math.PI + dAmt * Math.abs(x));
  }
  distort.curve = dCurve;
  distort.connect(badBus);

  // Sub-bass rumble drone on bad bus (always running at low level)
  const rumble  = audioCtx.createOscillator();
  const rumbleG = audioCtx.createGain();
  rumble.type = "sawtooth";
  rumble.frequency.value = 55;
  rumble.connect(rumbleG);
  rumbleG.connect(badBus);
  rumbleG.gain.value = 0.12;
  rumble.start();

  const bpm  = 132;
  const beat = 60 / bpm;
  let nextBeat = audioCtx.currentTime + 0.05;
  let idx = 0, alive = true;

  function tick() {
    if (!alive) return;
    while (nextBeat < audioCtx.currentTime + 0.3) {
      const freq = MELODY[idx % MELODY.length];
      const t    = nextBeat;

      // ── GOOD BUS: soft sine melody ──────────────────────────────────────
      const og = audioCtx.createOscillator();
      const gg = audioCtx.createGain();
      og.type = "sine";
      og.frequency.value = freq;
      og.connect(gg);
      gg.connect(goodBus);
      gg.gain.setValueAtTime(0, t);
      gg.gain.linearRampToValueAtTime(0.07, t + 0.018);
      gg.gain.exponentialRampToValueAtTime(0.001, t + beat * 0.90);
      og.start(t); og.stop(t + beat);

      // Octave pad every 4 beats on good bus
      if (idx % 4 === 0) {
        const op = audioCtx.createOscillator();
        const gp = audioCtx.createGain();
        op.type = "triangle";
        op.frequency.value = freq / 2;
        op.connect(gp);
        gp.connect(goodBus);
        gp.gain.setValueAtTime(0, t);
        gp.gain.linearRampToValueAtTime(0.045, t + 0.02);
        gp.gain.exponentialRampToValueAtTime(0.001, t + beat * 3.8);
        op.start(t); op.stop(t + beat * 4);
      }

      // ── BAD BUS: distorted sawtooth + detuned clone ──────────────────────
      const ob = audioCtx.createOscillator();
      const gb = audioCtx.createGain();
      ob.type = "sawtooth";
      ob.frequency.value = freq * (1 + (Math.random() - 0.5) * 0.022);
      ob.connect(gb);
      gb.connect(distort);
      gb.gain.setValueAtTime(0, t);
      gb.gain.linearRampToValueAtTime(0.20, t + 0.006);
      gb.gain.exponentialRampToValueAtTime(0.001, t + beat * 0.52);
      ob.start(t); ob.stop(t + beat);

      // Detuned dissonant clone (creates beating / clash)
      const od = audioCtx.createOscillator();
      const gd = audioCtx.createGain();
      od.type = "square";
      od.frequency.value = freq * 1.016;
      od.connect(gd);
      gd.connect(distort);
      gd.gain.setValueAtTime(0, t);
      gd.gain.linearRampToValueAtTime(0.10, t + 0.005);
      gd.gain.exponentialRampToValueAtTime(0.001, t + beat * 0.38);
      od.start(t); od.stop(t + beat);

      nextBeat += beat;
      idx++;
    }
    setTimeout(tick, 40);
  }
  tick();

  return {
    setQuality(q) {
      const now = audioCtx.currentTime;
      goodBus.gain.linearRampToValueAtTime(q * 0.90,       now + 0.6);
      badBus.gain.linearRampToValueAtTime((1 - q) * 0.70,  now + 0.6);
      rumbleG.gain.linearRampToValueAtTime((1 - q) * 0.14, now + 0.6);
    },
    stop() {
      alive = false;
      try { rumble.stop(); } catch (_) { /* already stopped */ }
      goodBus.disconnect();
      badBus.disconnect();
    },
  };
}

// ─── Path — computed live every frame ─────────────────────────────────────────
// D=0 → one gentle wave  |  D=1 → tall multi-layer waves
function computePathY(absT, D, seed) {
  const amp1 = 0.08 + D * 0.22;
  const amp2 = D * 0.10;
  const amp3 = D * 0.06;
  const f1   = 1.5 + D * 3.5;
  const f2   = 7.0 + D * 6.0;
  const f3   = 15.0 + D * 8.0;
  const y = 0.5
    + amp1 * Math.sin(absT * Math.PI * f1 + seed)
    + amp2 * Math.sin(absT * Math.PI * f2 + seed * 1.7)
    + amp3 * Math.sin(absT * Math.PI * f3 + seed * 3.1);
  return Math.max(0.15, Math.min(0.85, y));
}

function buildCurrentPath(absoluteT, Dsmooth, seed) {
  const pts = [];
  for (let i = 0; i <= 500; i++) {
    const t = i / 500;
    pts.push({ x: t, y: computePathY(absoluteT + t, Dsmooth, seed) });
  }
  return pts;
}

function getPathY(path, x) {
  if (x < 0 || x > 1) return null;
  const raw = x * (path.length - 1);
  const lo  = Math.floor(raw);
  const hi  = Math.min(lo + 1, path.length - 1);
  return path[lo].y * (1 - (raw - lo)) + path[hi].y * (raw - lo);
}

function makeCheckpoints() {
  return CHECKPOINT_XS.map(x => ({
    x, cleared: false, active: false, missed: false, windowTimer: 0,
  }));
}

// ─── Draw: Blink zone ─────────────────────────────────────────────────────────
function zoneColor(urgency) {
  let r, g, b;
  if (urgency < 0.5) {
    r = Math.round(40 + 215 * (urgency * 2)); g = 220; b = Math.round(80 * (1 - urgency * 2));
  } else {
    r = 255; g = Math.round(220 * (1 - (urgency - 0.5) * 2)); b = 0;
  }
  return { r, g, b };
}

function drawBlinkZone(ctx, checkpoints, W, H, ts, progress) {
  const ZONE_MAX = W * ZONE_MAX_FRAC;
  const cursorX  = progress * W;
  const nextCp   = checkpoints
    .filter(c => !c.cleared && !c.missed && c.x > progress)
    .sort((a, b) => a.x - b.x)[0];
  if (!nextCp) return;
  const sx   = nextCp.x * W;
  const dist = sx - cursorX;
  if (dist <= 0 || dist >= ZONE_MAX) return;
  const urgency  = 1 - dist / ZONE_MAX;
  const { r, g, b } = zoneColor(urgency);
  const zonePulse = 0.55 + 0.45 * Math.sin(ts * 0.014);
  const zoneLeft  = Math.max(cursorX, sx - ZONE_MAX);
  const zoneW     = sx - zoneLeft;
  ctx.save();
  const hGrad = ctx.createLinearGradient(zoneLeft, 0, sx, 0);
  hGrad.addColorStop(0,    `rgba(${r},${g},${b},0.0)`);
  hGrad.addColorStop(0.3,  `rgba(${r},${g},${b},${0.15 * zonePulse})`);
  hGrad.addColorStop(0.75, `rgba(${r},${g},${b},${0.45 * zonePulse})`);
  hGrad.addColorStop(1,    `rgba(${r},${g},${b},${0.72 * zonePulse})`);
  ctx.fillStyle = hGrad;
  ctx.fillRect(zoneLeft, 0, zoneW, H);
  ctx.restore();
}

// ─── Draw: Background ─────────────────────────────────────────────────────────
function drawBg(ctx, W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#05050f");
  g.addColorStop(1, "#08061a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(160,80,255,0.025)";
  ctx.lineWidth   = 1;
  for (let y = 74; y < H; y += 52) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.18, W / 2, H / 2, H);
  vg.addColorStop(0, "transparent");
  vg.addColorStop(1, "rgba(0,0,0,0.50)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

// ─── Draw: Path + tolerance band ──────────────────────────────────────────────
function drawPath(ctx, path, progress, W, H, onTrack, effTol) {
  const pts    = path.map(p => ({ sx: p.x * W, sy: p.y * H }));
  if (pts.length < 2) return;
  const bandPx = effTol * H;

  ctx.save();
  ctx.beginPath();
  pts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.sx, p.sy - bandPx);
    else         ctx.lineTo(p.sx, p.sy - bandPx);
  });
  for (let i = pts.length - 1; i >= 0; i--) {
    ctx.lineTo(pts[i].sx, pts[i].sy + bandPx);
  }
  ctx.closePath();
  ctx.fillStyle = onTrack ? "rgba(255,105,180,0.07)" : "rgba(180,0,255,0.07)";
  ctx.fill();

  ctx.setLineDash([5, 10]);
  ctx.strokeStyle = onTrack ? "rgba(255,105,180,0.22)" : "rgba(180,0,255,0.22)";
  ctx.lineWidth   = 1;
  [-1, 1].forEach(sign => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.sx, p.sy + sign * bandPx);
      else         ctx.lineTo(p.sx, p.sy + sign * bandPx);
    });
    ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.restore();

  const core  = onTrack ? "#ff69b4" : "#cc44ff";
  const glow  = onTrack ? "rgba(255,105,180," : "rgba(180,0,255,";
  const shine = onTrack ? "rgba(255,220,238,0.65)" : "rgba(228,180,255,0.65)";

  const line = (lw, style) => {
    ctx.beginPath();
    ctx.moveTo(pts[0].sx, pts[0].sy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].sx, pts[i].sy);
    ctx.strokeStyle = style;
    ctx.lineWidth   = lw;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";
    ctx.stroke();
  };

  line(PATH_W + 52, glow + "0.04)");
  line(PATH_W + 28, glow + "0.09)");
  line(PATH_W + 10, glow + "0.16)");
  line(PATH_W,      core);
  line(3,           shine);

  const playX = progress * W;
  if (playX > 4) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, playX, H);
    ctx.clip();
    line(PATH_W, "rgba(0,0,0,0.28)");
    ctx.restore();
  }

  const dotX = progress * W;
  const dotY = (getPathY(path, progress) ?? 0.5) * H;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.30)";
  ctx.fill();
}

// ─── Draw: Checkpoints ────────────────────────────────────────────────────────
function drawCheckpoints(ctx, path, checkpoints, W, H, ts, progress) {
  checkpoints.forEach(cp => {
    if (cp.cleared || cp.missed) return;
    const sx    = cp.x * W;
    const py    = (getPathY(path, cp.x) ?? 0.5) * H;
    const halfH = PATH_W * 1.0;
    const dist  = sx - progress * W;
    if (dist <= 0) return;

    if (cp.active) {
      const urgency = Math.max(0, Math.min(1, 1 - cp.windowTimer / BLINK_WINDOW));
      const { r, g, b } = zoneColor(urgency);
      const col   = `rgb(${r},${g},${b})`;
      const colA  = `rgba(${r},${g},${b},0.45)`;
      const pulse = 0.72 + 0.28 * Math.sin(ts * 0.010);

      ctx.save();
      const aura = ctx.createRadialGradient(sx, py, 0, sx, py, halfH * 1.7);
      aura.addColorStop(0, `rgba(${r},${g},${b},${0.12 * pulse})`);
      aura.addColorStop(1, "transparent");
      ctx.fillStyle = aura;
      ctx.fillRect(sx - halfH * 1.7, py - halfH * 1.7, halfH * 3.4, halfH * 3.4);
      ctx.restore();

      ctx.save();
      ctx.globalAlpha = 0.82 + 0.18 * Math.sin(ts * 0.013);
      ctx.shadowColor = col;
      ctx.shadowBlur  = 20;
      ctx.strokeStyle = col;
      ctx.lineWidth   = 3;
      [-5, 5].forEach(dx => {
        ctx.beginPath();
        ctx.moveTo(sx + dx, py - halfH);
        ctx.lineTo(sx + dx, py + halfH);
        ctx.stroke();
      });
      ctx.lineWidth   = 1.5;
      ctx.strokeStyle = colA;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(sx, py - halfH);
      ctx.lineTo(sx, py + halfH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowBlur = 0;
      ctx.restore();

      ctx.save();
      ctx.fillStyle   = col;
      ctx.shadowColor = col;
      ctx.shadowBlur  = 14;
      [py - halfH, py + halfH].forEach(dy => {
        ctx.beginPath();
        ctx.moveTo(sx,     dy - 8);
        ctx.lineTo(sx + 8, dy);
        ctx.lineTo(sx,     dy + 8);
        ctx.lineTo(sx - 8, dy);
        ctx.closePath();
        ctx.fill();
      });
      ctx.restore();

    } else {
      const pulse = 0.25 + 0.15 * Math.sin(ts * 0.004 + cp.x * 8);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = "#7777cc";
      ctx.lineWidth   = 1.5;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.moveTo(sx, py - halfH * 0.80);
      ctx.lineTo(sx, py + halfH * 0.80);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#9999dd";
      ctx.beginPath();
      ctx.arc(sx, py, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  });
}

// ─── Draw: Blink prompt ───────────────────────────────────────────────────────
function drawBlinkPrompt(ctx, W, H, checkpoints, ts) {
  const cp = checkpoints.find(c => c.active && !c.cleared && !c.missed);
  if (!cp) return;

  const frac  = Math.max(0, cp.windowTimer / BLINK_WINDOW);
  const pulse = 0.78 + 0.22 * Math.sin(ts * 0.018);
  const textY = H * 0.82;

  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(0,0,0,0.58)";
  ctx.beginPath();
  ctx.roundRect(W / 2 - 210, textY - 54, 420, 72, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,224,102,0.25)";
  ctx.lineWidth   = 1;
  ctx.stroke();

  ctx.font        = "bold 46px monospace";
  ctx.fillStyle   = "#ffe066";
  ctx.shadowColor = "#ffe066";
  ctx.shadowBlur  = 28;
  ctx.globalAlpha = pulse;
  ctx.fillText("BLINK  NOW!", W / 2, textY);
  ctx.shadowBlur  = 0;
  ctx.globalAlpha = 1;

  const bw = 340, bh = 6;
  const bx = W / 2 - bw / 2;
  const by = textY + 14;
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 3);
  ctx.fill();
  ctx.fillStyle = frac > 0.35 ? "#ffe066" : "#ff4444";
  if (frac > 0) {
    ctx.beginPath();
    ctx.roundRect(bx, by, bw * frac, bh, 3);
    ctx.fill();
  }
  ctx.restore();
}

// ─── Draw: Blink feedback ─────────────────────────────────────────────────────
function drawBlinkFeedback(ctx, W, H, feedback, ts) {
  if (!feedback) return;
  const age = ts - feedback.ts;
  if (age > 1200) return;
  const alpha = 1 - age / 1200;
  const rise  = -80 * (age / 1200);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign   = "center";
  ctx.font        = "bold 44px monospace";
  ctx.fillStyle   = feedback.type === "hit" ? "#4eff91" : "#ff4444";
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur  = 26;
  ctx.fillText(
    feedback.type === "hit" ? `+${CHECKPOINT_BONUS}  BLINKED!` : `-${MISS_PENALTY}  MISSED!`,
    W / 2, H * 0.57 + rise,
  );
  ctx.shadowBlur = 0;
  ctx.restore();
}

// ─── Draw: DDA feedback ───────────────────────────────────────────────────────
function drawDDAFeedback(ctx, W, H, ddaFeedback, ts) {
  if (!ddaFeedback) return;
  const age = ts - ddaFeedback.ts;
  if (age > 2200) return;
  const alpha = age < 350 ? age / 350 : age > 1800 ? (2200 - age) / 400 : 1;
  const color = ddaFeedback.dir > 0 ? "#ff9944" : "#44aaff";
  const text  = ddaFeedback.dir > 0 ? "▲  HARDER" : "▼  EASIER";

  ctx.save();
  ctx.globalAlpha = alpha * 0.92;
  ctx.textAlign   = "center";
  ctx.font        = "bold 22px monospace";
  ctx.fillStyle   = color;
  ctx.shadowColor = color;
  ctx.shadowBlur  = 18;
  ctx.fillText(text, W * 0.80, H * 0.90);
  ctx.shadowBlur  = 0;
  ctx.restore();
}

// ─── Draw: Cursor ─────────────────────────────────────────────────────────────
function drawCursor(ctx, trailData, cursorX, cursorY, W, H, onTrack, ts) {
  const cx    = cursorX;
  const cy    = cursorY * H;
  const color = onTrack ? "#ffe066" : "#ff5555";
  const glow  = onTrack ? "rgba(255,224,102," : "rgba(255,80,80,";

  trailData.forEach((pt, i) => {
    const frac = i / trailData.length;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y * H, 2 + 5 * frac, 0, Math.PI * 2);
    ctx.fillStyle = glow + (frac * 0.40) + ")";
    ctx.fill();
  });

  [46, 32, 20].forEach((r, i) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = glow + [0.03, 0.06, 0.12][i] + ")";
    ctx.fill();
  });

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ts * 0.0016);
  ctx.beginPath();
  ctx.arc(0, 0, 21, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1.5;
  ctx.setLineDash([5, 13]);
  ctx.globalAlpha = 0.62;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2.5;
  ctx.shadowColor = color;
  ctx.shadowBlur  = 16;
  ctx.globalAlpha = 0.92;
  ctx.stroke();
  ctx.shadowBlur  = 0;
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fillStyle   = color;
  ctx.shadowColor = color;
  ctx.shadowBlur  = 10;
  ctx.fill();
  ctx.shadowBlur  = 0;

  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
}

// ─── Draw: HUD ────────────────────────────────────────────────────────────────
function drawHUD(ctx, W, H, score, lives, accuracy, combo, wsStatus, progress, D, Dsmooth, inFlowZone, diffDir) {
  const barH = 72;
  ctx.fillStyle = "rgba(4,3,14,0.93)";
  ctx.fillRect(0, 0, W, barH);

  const dClr   = D < 0.35 ? "#44aaff" : D > 0.70 ? "#ff9944" : "#4eff91";
  const borderG = ctx.createLinearGradient(0, 0, W, 0);
  borderG.addColorStop(0,    "transparent");
  borderG.addColorStop(0.10, dClr + "99");
  borderG.addColorStop(0.90, dClr + "99");
  borderG.addColorStop(1,    "transparent");
  ctx.strokeStyle = borderG;
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, barH);
  ctx.lineTo(W, barH);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.font      = "9px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillText("LIVES", 20, 13);
  for (let i = 0; i < LIVES_MAX; i++) {
    ctx.beginPath();
    ctx.arc(20 + i * 27, 38, 9, 0, Math.PI * 2);
    if (i < lives) {
      ctx.fillStyle   = "#ff69b4";
      ctx.shadowColor = "#ff69b4";
      ctx.shadowBlur  = 12;
      ctx.fill();
      ctx.shadowBlur  = 0;
    } else {
      ctx.strokeStyle = "rgba(255,105,180,0.18)";
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }
  }

  ctx.textAlign   = "center";
  ctx.font        = "bold 38px monospace";
  ctx.fillStyle   = "#ffffff";
  ctx.shadowColor = "#ff69b4";
  ctx.shadowBlur  = 20;
  ctx.fillText(String(Math.floor(score)).padStart(8, "0"), W / 2, 50);
  ctx.shadowBlur  = 0;
  ctx.font      = "9px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillText("SCORE", W / 2, 65);

  ctx.textAlign = "right";
  ctx.font      = "11px monospace";
  ctx.fillStyle = "rgba(170,170,210,0.85)";
  ctx.fillText(`ACC  ${accuracy.toFixed(1)}%`, W - 20, 14);

  const ddaLabel = inFlowZone
    ? "◆  FLOW  ZONE"
    : diffDir > 0 ? "▲  HARDER"
    : diffDir < 0 ? "▼  EASIER"
    : "DDA  ACTIVE";
  const ddaColor = inFlowZone ? "#4eff91" : diffDir > 0 ? "#ff9944" : diffDir < 0 ? "#44aaff" : "#888899";
  ctx.font      = "10px monospace";
  ctx.fillStyle = ddaColor;
  ctx.fillText(ddaLabel, W - 20, 30);

  const dbW = 120, dbH = 6, dbX = W - 20 - dbW, dbY = 36;
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  ctx.roundRect(dbX, dbY, dbW, dbH, 3);
  ctx.fill();
  ctx.fillStyle = "rgba(78,255,145,0.10)";
  ctx.beginPath();
  ctx.roundRect(dbX + dbW * 0.40, dbY, dbW * 0.20, dbH, 3);
  ctx.fill();
  const fillG = ctx.createLinearGradient(dbX, 0, dbX + dbW, 0);
  fillG.addColorStop(0,   "#44aaff");
  fillG.addColorStop(0.4, "#4eff91");
  fillG.addColorStop(1,   "#ff9944");
  ctx.fillStyle = fillG;
  ctx.beginPath();
  ctx.roundRect(dbX, dbY, Math.max(4, dbW * Dsmooth), dbH, 3);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(dbX + dbW * Dsmooth, dbY + dbH / 2, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.font      = "9px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillText(`DIFFICULTY  ${Math.round(D * 100)}%`, W - 20, 56);

  if (combo > 2) {
    ctx.font        = "bold 12px monospace";
    ctx.fillStyle   = "#ffe066";
    ctx.shadowColor = "#ffe066";
    ctx.shadowBlur  = 8;
    ctx.fillText(`×${combo}  COMBO`, W - 20, 68);
    ctx.shadowBlur  = 0;
  }

  const pw  = W * 0.44;
  const ph  = 5;
  const px  = W / 2 - pw / 2;
  const pby = H - 14;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.roundRect(px, pby, pw, ph, 3);
  ctx.fill();
  if (progress > 0.002) {
    const pg = ctx.createLinearGradient(px, 0, px + pw, 0);
    pg.addColorStop(0, "#cc44ff");
    pg.addColorStop(1, "#ff69b4");
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.roundRect(px, pby, pw * Math.min(1, progress), ph, 3);
    ctx.fill();
  }

  ctx.textAlign = "left";
  ctx.font      = "10px monospace";
  const tColor  = wsStatus === "connected" ? "#4eff91" : wsStatus === "connecting" ? "#ffaa44" : "#ff5555";
  const tLabel  = wsStatus === "connected" ? "● TRACKER" : wsStatus === "connecting" ? "◌ CONNECTING" : "○ NO TRACKER";
  ctx.fillStyle = tColor;
  ctx.fillText(tLabel, 20, H - 10);
  ctx.textAlign = "right";
  ctx.font      = "10px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillText(`${Math.min(100, Math.floor(progress * 100))}%`, W - 20, H - 10);
}

// ─── Draw: Danger vignette ────────────────────────────────────────────────────
function drawDangerVignette(ctx, W, H, lives) {
  if (lives >= 2) return;
  const t = lives === 0 ? 1.0 : 0.55;
  ctx.fillStyle = `rgba(200,0,0,${t * 0.09})`;
  ctx.fillRect(0, 0, W, H);
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.20, W / 2, H / 2, H * 0.92);
  v.addColorStop(0, "transparent");
  v.addColorStop(1, `rgba(180,0,0,${t * 0.40})`);
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
}

// ─── Draw: Idle ───────────────────────────────────────────────────────────────
function drawIdle(ctx, W, H) {
  drawBg(ctx, W, H);
  ctx.textAlign   = "center";
  ctx.font        = "bold 80px monospace";
  ctx.fillStyle   = "#ff69b4";
  ctx.shadowColor = "#ff69b4";
  ctx.shadowBlur  = 38;
  ctx.fillText("RHYTHM", W / 2, H / 2 - 58);
  ctx.fillStyle   = "#cc44ff";
  ctx.shadowColor = "#cc44ff";
  ctx.fillText("TRACE", W / 2, H / 2 + 32);
  ctx.shadowBlur  = 0;
  ctx.font      = "15px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.38)";
  ctx.fillText("EYE-GAZE RHYTHM GAME  ·  TOBII 4C / PRO", W / 2, H / 2 + 82);
  const pulse   = 0.55 + 0.45 * Math.sin(Date.now() / 500);
  ctx.font      = "bold 22px monospace";
  ctx.fillStyle = `rgba(255,224,102,${pulse})`;
  ctx.fillText("PRESS  SPACE  TO  BEGIN", W / 2, H / 2 + 132);
  ctx.textAlign = "left";
}

// ─── Draw: Calibration prompt ─────────────────────────────────────────────────
function drawCalibPrompt(ctx, W, H, wsStatus) {
  drawBg(ctx, W, H);
  ctx.fillStyle = "rgba(255,224,102,0.06)";
  ctx.fillRect(0, H * 0.09, W, H * 0.175);

  ctx.textAlign   = "center";
  ctx.font        = "bold 38px monospace";
  ctx.fillStyle   = "#ffe066";
  ctx.shadowColor = "#ffe066";
  ctx.shadowBlur  = 22;
  ctx.fillText("TOBII  CALIBRATION  REQUIRED", W / 2, H * 0.19);
  ctx.shadowBlur  = 0;

  ctx.font      = "15px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.48)";
  ctx.fillText("Calibrate the eye tracker for each player — every session", W / 2, H * 0.265);

  const steps = [
    { num: "1", text: "Open  Tobii  Pro  Eye  Tracker  Manager  software" },
    { num: "2", text: "Select  or  create  a  profile  for  this  player" },
    { num: "3", text: "Run  the  full  eye  calibration  procedure" },
    { num: "4", text: "Close  the  Tobii  calibration  window  when  done" },
  ];
  const cW = Math.min(W * 0.60, 720);
  const cX = W / 2 - cW / 2;
  const cH = 52;
  let   cY = H * 0.33;
  steps.forEach(({ num, text }) => {
    ctx.save();
    ctx.fillStyle   = "rgba(255,255,255,0.04)";
    ctx.strokeStyle = "rgba(255,224,102,0.12)";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.roundRect(cX, cY, cW, cH, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,224,102,0.14)";
    ctx.beginPath();
    ctx.roundRect(cX + 10, cY + 10, 32, 32, 6);
    ctx.fill();
    ctx.font      = "bold 17px monospace";
    ctx.fillStyle = "#ffe066";
    ctx.textAlign = "center";
    ctx.fillText(num, cX + 26, cY + 32);
    ctx.font      = "16px monospace";
    ctx.fillStyle = "#dcdcf0";
    ctx.textAlign = "left";
    ctx.fillText(text, cX + 58, cY + 32);
    ctx.restore();
    cY += cH + 10;
  });

  const connected = wsStatus === "connected";
  ctx.textAlign   = "center";
  ctx.font        = "bold 14px monospace";
  ctx.fillStyle   = connected ? "#4eff91" : "#ff9944";
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur  = connected ? 10 : 0;
  ctx.fillText(
    connected ? "● Tobii tracker connected and ready" : "◌ Tobii tracker not detected — check USB connection",
    W / 2, H * 0.79,
  );
  ctx.shadowBlur = 0;
  const pulse   = 0.55 + 0.45 * Math.sin(Date.now() / 480);
  ctx.font      = "bold 21px monospace";
  ctx.fillStyle = `rgba(255,224,102,${pulse})`;
  ctx.fillText(
    connected ? "PRESS  SPACE  WHEN  CALIBRATION  IS  COMPLETE" : "Connect the tracker, calibrate, then press SPACE",
    W / 2, H * 0.89,
  );
  ctx.textAlign = "left";
}

// ─── Draw: Game over ──────────────────────────────────────────────────────────
function drawGameOver(ctx, W, H, score, accuracy, distanceTraveled, blinksHit, blinksMissed) {
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.fillRect(0, 0, W, H);

  const pw = Math.min(W * 0.58, 680);
  const ph = H * 0.72;
  const px = W / 2 - pw / 2;
  const py = H / 2 - ph / 2;

  ctx.fillStyle   = "rgba(5,3,18,0.98)";
  ctx.strokeStyle = "rgba(255,68,68,0.32)";
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 20);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "center";

  ctx.font        = "bold 54px monospace";
  ctx.fillStyle   = "#ff4444";
  ctx.shadowColor = "#ff4444";
  ctx.shadowBlur  = 30;
  ctx.fillText("GAME  OVER", W / 2, py + 70);
  ctx.shadowBlur  = 0;

  ctx.strokeStyle = "rgba(255,68,68,0.14)";
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(px + 60, py + 90);
  ctx.lineTo(px + pw - 60, py + 90);
  ctx.stroke();

  ctx.font      = "12px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.fillText(`DISTANCE  TRAVELED  ×${distanceTraveled}`, W / 2, py + 114);

  const total       = blinksHit + blinksMissed;
  const blinkAccPct = total > 0 ? (blinksHit / total * 100).toFixed(1) : "—";

  ctx.font        = "bold 34px monospace";
  ctx.fillStyle   = "#4eff91";
  ctx.shadowColor = "#4eff91";
  ctx.shadowBlur  = 18;
  ctx.fillText(`✓  ${String(blinksHit).padStart(3)}`, W / 2 - 90, py + 168);
  ctx.shadowBlur  = 0;
  ctx.font      = "11px monospace";
  ctx.fillStyle = "rgba(78,255,145,0.55)";
  ctx.fillText("BLINKS  HIT", W / 2 - 90, py + 190);

  ctx.font        = "bold 34px monospace";
  ctx.fillStyle   = "#ff4444";
  ctx.shadowColor = "#ff4444";
  ctx.shadowBlur  = 18;
  ctx.fillText(`✗  ${String(blinksMissed).padStart(3)}`, W / 2 + 90, py + 168);
  ctx.shadowBlur  = 0;
  ctx.font      = "11px monospace";
  ctx.fillStyle = "rgba(255,68,68,0.55)";
  ctx.fillText("BLINKS  MISSED", W / 2 + 90, py + 190);

  ctx.font      = "14px monospace";
  ctx.fillStyle = "#ffe066";
  ctx.fillText(`BLINK  ACCURACY  ${blinkAccPct}%`, W / 2, py + 220);

  ctx.strokeStyle = "rgba(255,255,255,0.07)";
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(px + 60, py + 238);
  ctx.lineTo(px + pw - 60, py + 238);
  ctx.stroke();

  ctx.font        = "bold 44px monospace";
  ctx.fillStyle   = "#ffffff";
  ctx.shadowColor = "#ff69b4";
  ctx.shadowBlur  = 22;
  ctx.fillText(String(Math.floor(score)).padStart(8, "0"), W / 2, py + 292);
  ctx.shadowBlur  = 0;
  ctx.font      = "11px monospace";
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillText("FINAL  SCORE", W / 2, py + 313);

  ctx.font      = "16px monospace";
  ctx.fillStyle = "#9999bb";
  ctx.fillText(`GAZE  ACCURACY  ${accuracy.toFixed(1)}%`, W / 2, py + 348);

  const pulse   = 0.48 + 0.52 * Math.sin(Date.now() / 480);
  ctx.font      = "bold 17px monospace";
  ctx.fillStyle = `rgba(255,224,102,${pulse})`;
  ctx.fillText("PRESS  SPACE  TO  RECALIBRATE  &  TRY  AGAIN", W / 2, py + ph - 26);
  ctx.textAlign = "left";
}

// ─── Component ────────────────────────────────────────────────────────────────
export function GameCanvas({ gaze, status }) {
  const canvasRef   = useRef(null);
  const gazeRef     = useRef(null);
  const statusRef   = useRef("connecting");
  const stateRef    = useRef(null);
  const rafRef      = useRef(null);
  const audioCtxRef = useRef(null);
  const musicRef    = useRef(null);

  useEffect(() => { gazeRef.current = gaze; },    [gaze]);
  useEffect(() => { statusRef.current = status; }, [status]);

  function freshState() {
    return {
      phase:           "idle",
      progress:        0,
      absoluteT:       0,
      seed:            Math.random() * 1000,
      Dsmooth:         D_INIT,
      checkpoints:     makeCheckpoints(),
      trail:           [],
      cursorY:         0.5,
      lives:           LIVES_MAX,
      score:           0,
      accuracy:        100,
      accHistory:      [],
      combo:           0,
      onTrack:         true,
      D:               D_INIT,
      inFlowZone:      false,
      diffDir:         0,
      ddaTimer:        DDA_INTERVAL,
      lastTs:          null,
      blinksHit:       0,
      blinksMissed:    0,
      finalScore:      0,
      finalAcc:        100,
      finalDistance:   0,
      finalHit:        0,
      finalMissed:     0,
      gazeAbsent:      false,
      gazeAbsentStart: 0,
      blinkFeedback:   null,
      ddaFeedback:     null,
      forcedBlink:     false,
      musicQuality:    1.0,
      mqTimer:         0,
    };
  }

  function startMusic() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ac = audioCtxRef.current;
    if (ac.state === "suspended") ac.resume();
    musicRef.current?.stop();
    musicRef.current = createAdaptiveMusicSystem(ac);
  }

  useEffect(() => {
    stateRef.current = freshState();

    function onKey(e) {
      if (e.code !== "Space" && e.code !== "KeyB" && e.code !== "Escape") return;
      const s = stateRef.current;
      if (e.code === "Escape" && s.phase !== "idle") {
        musicRef.current?.stop();
        stateRef.current = { ...freshState(), phase: "idle" };
        return;
      }
      if (e.code === "Space") {
        if (s.phase === "idle") {
          stateRef.current = { ...freshState(), phase: "calibprompt" };
        } else if (s.phase === "calibprompt") {
          stateRef.current = { ...freshState(), phase: "playing" };
          startMusic();
        } else if (s.phase === "gameover") {
          stateRef.current = { ...freshState(), phase: "calibprompt" };
        }
      }
      if (e.code === "KeyB" && s.phase === "playing") {
        s.forcedBlink = true;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      musicRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext("2d");

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    function frame(ts) {
      const s  = stateRef.current;
      const dt = s.lastTs ? Math.min((ts - s.lastTs) / 1000, 0.05) : 0;
      s.lastTs = ts;

      const W  = canvas.width;
      const H  = canvas.height;
      const g  = gazeRef.current;
      const ws = statusRef.current;
      const gazeValid = g && g.valid !== false;

      if (s.phase === "idle") {
        drawIdle(ctx, W, H);
        rafRef.current = requestAnimationFrame(frame);
        return;
      }
      if (s.phase === "calibprompt") {
        drawCalibPrompt(ctx, W, H, ws);
        rafRef.current = requestAnimationFrame(frame);
        return;
      }
      if (s.phase === "gameover") {
        drawBg(ctx, W, H);
        drawGameOver(ctx, W, H, s.finalScore, s.finalAcc, s.finalDistance, s.finalHit, s.finalMissed);
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      // ── playing ──

      s.Dsmooth = s.Dsmooth + (s.D - s.Dsmooth) * DSMOOTH_RATE;
      const currentPath = buildCurrentPath(s.absoluteT, s.Dsmooth, s.seed);
      const effTol = getEffTol(s.D);

      // Blink detection
      let blinked = false;
      if (s.forcedBlink) {
        blinked       = true;
        s.forcedBlink = false;
      } else if (!gazeValid) {
        if (!s.gazeAbsent) {
          s.gazeAbsent      = true;
          s.gazeAbsentStart = ts;
        }
      } else if (s.gazeAbsent) {
        const gap = ts - s.gazeAbsentStart;
        if (gap >= BLINK_MIN_MS && gap <= BLINK_MAX_MS) blinked = true;
        s.gazeAbsent = false;
      }

      // Cursor
      if (gazeValid) s.cursorY += (g.y - s.cursorY) * CURSOR_SMOOTH;
      s.trail.push({ x: s.progress * W, y: s.cursorY });
      if (s.trail.length > TRAIL_LENGTH) s.trail.shift();

      // Advance progress
      s.progress += getEffSpeed(s.D) * dt;

      const pathY = getPathY(currentPath, s.progress);
      const dist  = pathY !== null ? Math.abs(s.cursorY - pathY) : 1;
      s.onTrack   = dist < effTol;

      if (s.onTrack) {
        s.combo  = Math.min(s.combo + 1, 9999);
        s.score += SCORE_PER_SEC * dt * (1 + s.combo / 60);
      } else {
        s.combo = 0;
      }

      s.accHistory.push(s.onTrack ? 100 : Math.max(0, 100 - dist * 500));
      if (s.accHistory.length > 180) s.accHistory.shift();
      s.accuracy = s.accHistory.reduce((a, b) => a + b, 0) / s.accHistory.length;

      // Adaptive music — crossfade soft ↔ distorted based on accuracy
      // quality = 0 when accuracy ≤ 35%  |  quality = 1 when accuracy ≥ 75%
      const targetQ = Math.max(0, Math.min(1, (s.accuracy - 35) / 40));
      s.musicQuality += (targetQ - s.musicQuality) * 0.04;
      s.mqTimer -= dt;
      if (s.mqTimer <= 0) {
        s.mqTimer = 0.15;
        musicRef.current?.setQuality(s.musicQuality);
      }

      // DDA
      s.inFlowZone = s.accuracy >= FLOW_LOW && s.accuracy <= FLOW_HIGH;
      s.ddaTimer  -= dt;
      if (s.ddaTimer <= 0) {
        s.ddaTimer    = DDA_INTERVAL;
        const prevD   = s.D;
        const delta   = DDA_ALPHA * (s.accuracy - FLOW_CENTER) / 100;
        s.D = Math.max(D_MIN, Math.min(D_MAX, s.D + delta));
        if (Math.abs(s.D - prevD) > 0.005) {
          s.diffDir    = s.D > prevD ? 1 : -1;
          s.ddaFeedback = { ts, dir: s.diffDir };
        } else {
          s.diffDir = 0;
        }
      }

      // Checkpoints
      const cursorScreenX = s.progress * W;
      s.checkpoints.forEach(cp => {
        if (cp.cleared || cp.missed) return;
        const dist2 = cp.x * W - cursorScreenX;
        if (!cp.active && dist2 >= 0 && dist2 < W * ZONE_MAX_FRAC) {
          cp.active      = true;
          cp.windowTimer = BLINK_WINDOW;
        }
        if (cp.active) {
          cp.windowTimer -= dt;
          if (blinked) {
            cp.cleared      = true;
            cp.active       = false;
            s.score        += CHECKPOINT_BONUS;
            s.blinksHit    += 1;
            s.blinkFeedback = { type: "hit", ts };
          } else if (cp.windowTimer <= 0 || dist2 < -W * 0.04) {
            cp.missed       = true;
            cp.active       = false;
            s.score         = Math.max(0, s.score - MISS_PENALTY);
            s.lives        -= 1;
            s.blinksMissed += 1;
            s.blinkFeedback = { type: "miss", ts };
          }
        }
      });

      // ── Segment end / game over ───────────────────────────────────────────
      if (s.lives <= 0) {
        s.finalScore    = s.score;
        s.finalAcc      = s.accuracy;
        s.finalDistance = Math.floor(s.absoluteT + s.progress);
        s.finalHit      = s.blinksHit;
        s.finalMissed   = s.blinksMissed;
        s.phase         = "gameover";
        musicRef.current?.stop();
        musicRef.current = null;
      } else if (s.progress >= 1.0) {
        s.score        += SEGMENT_BONUS;
        s.absoluteT    += 1.0;
        s.progress      = 0;
        s.checkpoints   = makeCheckpoints();
        s.blinkFeedback = null;
        s.gazeAbsent    = false;
        s.trail         = [];
      }

      // ── Render ────────────────────────────────────────────────────────────
      drawBg(ctx, W, H);
      drawBlinkZone(ctx, s.checkpoints, W, H, ts, s.progress);
      drawPath(ctx, currentPath, s.progress, W, H, s.onTrack, effTol);
      drawCheckpoints(ctx, currentPath, s.checkpoints, W, H, ts, s.progress);
      drawDangerVignette(ctx, W, H, s.lives);
      drawCursor(ctx, s.trail, s.progress * W, s.cursorY, W, H, s.onTrack, ts);
      drawBlinkPrompt(ctx, W, H, s.checkpoints, ts);
      drawBlinkFeedback(ctx, W, H, s.blinkFeedback, ts);
      drawDDAFeedback(ctx, W, H, s.ddaFeedback, ts);
      drawHUD(ctx, W, H, s.score, s.lives, s.accuracy, s.combo, ws, s.progress, s.D, s.Dsmooth, s.inFlowZone, s.diffDir);

      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: "block", width: "100vw", height: "100vh", cursor: "none" }}
    />
  );
}