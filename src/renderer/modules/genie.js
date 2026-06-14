/**
 * macOS-style genie minimize animation.
 * Algorithm: divide the window into horizontal strips, warp each strip's
 * left edge and width using a sine wave (same technique as hbi99/genie.js),
 * and animate toward/from the bottom-right corner (mini-chat position).
 */

const STRIP_H = 3;        // px per strip
const CLOSE_MS = 380;
const OPEN_MS  = 460;

let cachedImage = null;   // reuse last-close frame for open

// ── helpers ────────────────────────────────────────────────────────────────

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }
function easeInCubic(t) { return t * t * t; }
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

async function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function captureWindow() {
  if (!window.chatWindow?.capturePage) return null;
  try {
    const dataUrl = await window.chatWindow.capturePage();
    return dataUrl ? loadImage(dataUrl) : null;
  } catch {
    return null;
  }
}

// ── strip renderer ─────────────────────────────────────────────────────────

function runStrips(canvas, img, direction, duration) {
  const W = window.innerWidth;
  const H = window.innerHeight;

  // Physical pixels so image pixels map 1-to-1
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:99999;pointer-events:none;";

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const N        = Math.ceil(H / STRIP_H);
  const increase = Math.PI / N;

  // Genie target: right edge, bottom of panel (where mini-chat bubble lives)
  const targetX = W;          // strips converge to the right wall
  const targetW = 4;          // collapsed width (nearly zero)

  // Sine-wave radians (from hbi99/genie.js)
  const radians_left  = Math.floor((targetX - 0) / 2);
  const radians_width = Math.floor((targetW - W) / 2);
  const rw_offset     = radians_width - targetW + targetX;

  // Scale image coords to CSS pixels
  const iW = img.naturalWidth  || W;
  const iH = img.naturalHeight || H;
  const sx = iW / W;   // image px per CSS px (horizontal)
  const sy = iH / H;   // image px per CSS px (vertical)

  return new Promise((resolve) => {
    const start = performance.now();

    function frame(now) {
      const elapsed = now - start;
      const rawT = clamp(elapsed / duration, 0, 1);

      ctx.clearRect(0, 0, W, H);

      for (let i = 0; i < N; i++) {
        const normPos = i / N; // 0 = top strip, 1 = bottom strip

        // Bottom strips collapse first on close; top strips expand first on open
        let stripRawT;
        if (direction === "close") {
          stripRawT = clamp((rawT - (1 - normPos) * 0.35) / 0.65, 0, 1);
        } else {
          stripRawT = clamp((rawT - normPos * 0.35) / 0.65, 0, 1);
        }

        const stripT = direction === "close"
          ? easeInCubic(stripRawT)
          : easeOutCubic(stripRawT);

        // Sine wave position (counter at 3π/2 ≈ 4.7 for first strip)
        const counter = 4.7 + i * increase;
        const sinVal  = Math.sin(counter);

        // "Collapsed" (genie-target) position for this strip
        const collLeft = Math.ceil(sinVal * radians_left + radians_left + targetX);
        const collW    = Math.ceil(sinVal * radians_width - rw_offset);

        // Interpolated destination rect (CSS pixels)
        let dLeft, dW, dY, dH;
        if (direction === "close") {
          dLeft = lerp(0,       collLeft,         stripT);
          dW    = lerp(W,       Math.max(collW, 1), stripT);
          dY    = lerp(i * STRIP_H, H - 1,        stripT);
          dH    = Math.max(lerp(STRIP_H, 0.5, stripT), 0.5);
        } else {
          dLeft = lerp(collLeft,         0,       stripT);
          dW    = lerp(Math.max(collW, 1), W,     stripT);
          dY    = lerp(H - 1, i * STRIP_H,        stripT);
          dH    = Math.max(lerp(0.5, STRIP_H, stripT), 0.5);
        }

        if (dW < 0.5) continue;

        // Alpha: fade out on close, fade in on open
        ctx.globalAlpha = clamp(
          direction === "close" ? 1 - stripT * 0.75 : 0.25 + stripT * 0.75,
          0, 1
        );

        // Source strip in image pixels
        const srcY  = i * STRIP_H * sy;
        const srcH  = Math.min(STRIP_H * sy, iH - srcY);
        if (srcH < 0.5) continue;

        ctx.drawImage(img, 0, srcY, iW, srcH, dLeft, dY, dW, dH);
      }

      ctx.globalAlpha = 1;

      if (rawT < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(frame);
  });
}

// ── public API ─────────────────────────────────────────────────────────────

export async function playGenieClose() {
  const panel = document.getElementById("chat-panel");
  if (!panel) return;

  // Capture BEFORE hiding so we see the actual panel content
  const img = await captureWindow();
  if (!img) return;

  cachedImage = img;
  panel.style.visibility = "hidden";

  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  await runStrips(canvas, img, "close", CLOSE_MS);
  canvas.remove();

  panel.style.visibility = "";
}

export async function playGenieOpen() {
  const panel = document.getElementById("chat-panel");
  if (!panel) return;

  // Hide panel before first paint so it doesn't flash in
  panel.style.visibility = "hidden";

  // Use cached image from last close, or capture current state
  const img = cachedImage || await captureWindow();
  cachedImage = null;

  if (!img) {
    // No image available (very first open) — just show instantly
    panel.style.visibility = "";
    return;
  }

  const canvas = document.createElement("canvas");
  document.body.appendChild(canvas);
  await runStrips(canvas, img, "open", OPEN_MS);
  canvas.remove();

  panel.style.visibility = "";
}
