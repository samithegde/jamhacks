const MIN_DRAW_SIZE = 24;
const LABEL_HEIGHT = 22;

function loadImage(base64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load screenshot for annotation."));
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

function getMarkColor(id) {
  const palette = [
    "rgba(10, 132, 255, 0.9)",
    "rgba(255, 59, 48, 0.9)",
    "rgba(52, 199, 89, 0.9)",
    "rgba(255, 149, 0, 0.9)",
    "rgba(175, 82, 222, 0.9)",
  ];
  return palette[id % palette.length];
}

export async function annotateScreenshot(base64, marks = []) {
  if (!base64 || !Array.isArray(marks) || !marks.length) {
    return {
      annotatedBase64: base64,
      marks: Array.isArray(marks) ? marks : [],
      imageMeta: null,
    };
  }

  const img = await loadImage(base64);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  ctx.lineWidth = Math.max(3, Math.round(Math.min(canvas.width, canvas.height) / 500));
  ctx.font = "700 18px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textBaseline = "middle";

  for (const mark of marks) {
    const x = Math.round(Number(mark.x));
    const y = Math.round(Number(mark.y));
    const w = Math.round(Number(mark.w));
    const h = Math.round(Number(mark.h));
    if (![x, y, w, h].every(Number.isFinite) || w < MIN_DRAW_SIZE || h < MIN_DRAW_SIZE) {
      continue;
    }

    const color = getMarkColor(Number(mark.id) || 0);
    ctx.strokeStyle = color;
    ctx.fillStyle = color.replace("0.9", "0.16");
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);

    const label = String(mark.id);
    const metrics = ctx.measureText(label);
    const labelW = Math.ceil(metrics.width) + 14;
    const labelX = Math.max(0, Math.min(canvas.width - labelW, x));
    const labelY = Math.max(0, y - LABEL_HEIGHT);

    ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
    ctx.fillRect(labelX, labelY, labelW, LABEL_HEIGHT);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.strokeRect(labelX + 0.5, labelY + 0.5, labelW - 1, LABEL_HEIGHT - 1);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, labelX + 7, labelY + LABEL_HEIGHT / 2 + 0.5);
  }

  return {
    annotatedBase64: canvas.toDataURL("image/jpeg", 0.65).split(",")[1],
    marks,
    imageMeta: {
      width: canvas.width,
      height: canvas.height,
      dpr: window.devicePixelRatio || 1,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
    },
  };
}
