const DEFAULT_PADDING_RATIO = 0.2;
const MIN_CROP_CSS = { width: 400, height: 300 };
const MIN_PADDING_CSS = 80;
const MAX_SCREEN_RATIO = 0.5;
const REFINE_JPEG_QUALITY = 0.92;

function loadImage(base64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load screenshot for cropping."));
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeCssBox(anchor) {
  const x = Number(anchor?.x);
  const y = Number(anchor?.y);
  const w = Number(anchor?.w ?? anchor?.width ?? 1);
  const h = Number(anchor?.h ?? anchor?.height ?? 1);

  if (![x, y].every(Number.isFinite)) {
    throw new Error("Crop anchor is missing x/y.");
  }

  return {
    x,
    y,
    w: Number.isFinite(w) && w > 0 ? w : 1,
    h: Number.isFinite(h) && h > 0 ? h : 1,
  };
}

export async function cropBase64Image(base64, anchor) {
  const img = await loadImage(base64);
  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;
  const dpr = window.devicePixelRatio || 1;
  const scaleX = imgW / (window.screen.width * dpr);
  const scaleY = imgH / (window.screen.height * dpr);
  const box = normalizeCssBox(anchor);

  const padXCss = Math.max(box.w * DEFAULT_PADDING_RATIO, MIN_PADDING_CSS);
  const padYCss = Math.max(box.h * DEFAULT_PADDING_RATIO, MIN_PADDING_CSS);
  const desiredWCss = clamp(
    Math.max(box.w + padXCss * 2, MIN_CROP_CSS.width),
    1,
    window.screen.width * MAX_SCREEN_RATIO
  );
  const desiredHCss = clamp(
    Math.max(box.h + padYCss * 2, MIN_CROP_CSS.height),
    1,
    window.screen.height * MAX_SCREEN_RATIO
  );

  const centerXCss = box.x + box.w / 2;
  const centerYCss = box.y + box.h / 2;
  const centerX = centerXCss * dpr * scaleX;
  const centerY = centerYCss * dpr * scaleY;
  const cropW = Math.round(desiredWCss * dpr * scaleX);
  const cropH = Math.round(desiredHCss * dpr * scaleY);

  const x1 = Math.round(clamp(centerX - cropW / 2, 0, Math.max(0, imgW - cropW)));
  const y1 = Math.round(clamp(centerY - cropH / 2, 0, Math.max(0, imgH - cropH)));
  const x2 = Math.min(imgW, x1 + cropW);
  const y2 = Math.min(imgH, y1 + cropH);
  const finalW = Math.max(1, x2 - x1);
  const finalH = Math.max(1, y2 - y1);

  const canvas = document.createElement("canvas");
  canvas.width = finalW;
  canvas.height = finalH;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, x1, y1, finalW, finalH, 0, 0, finalW, finalH);

  return {
    croppedBase64: canvas.toDataURL("image/jpeg", REFINE_JPEG_QUALITY).split(",")[1],
    x1,
    y1,
    cropW: finalW,
    cropH: finalH,
    markBBox: { ...box },
    dpr,
    scaleX,
    scaleY,
    imgW,
    imgH,
  };
}
