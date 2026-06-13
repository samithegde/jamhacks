const MICRO_GRID_COLUMNS = 10;
const MICRO_GRID_ROWS = 8;
const JPEG_QUALITY = 0.92;

function loadImage(base64) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load crop for micro-grid."));
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

function computeLayout(width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return {
    width: w,
    height: h,
    columns: MICRO_GRID_COLUMNS,
    rows: MICRO_GRID_ROWS,
    cellW: Math.floor(w / MICRO_GRID_COLUMNS),
    cellH: Math.floor(h / MICRO_GRID_ROWS),
  };
}

function getCellBounds(layout, index) {
  const col = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  const x = col * layout.cellW;
  const y = row * layout.cellH;
  const w =
    col === layout.columns - 1 ? layout.width - x : layout.cellW;
  const h = row === layout.rows - 1 ? layout.height - y : layout.cellH;

  return { x, y, w, h };
}

export async function applyMicroGridToCrop(base64, width, height) {
  const img = await loadImage(base64);
  const layout = computeLayout(width ?? img.naturalWidth, height ?? img.naturalHeight);

  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, layout.width, layout.height);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  ctx.lineWidth = Math.max(1, Math.round(Math.min(layout.width, layout.height) / 400));
  ctx.font = `700 ${Math.max(11, Math.min(18, Math.floor(layout.cellH * 0.42)))}px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const totalCells = layout.columns * layout.rows;

  for (let index = 0; index < totalCells; index += 1) {
    const { x, y, w, h } = getCellBounds(layout, index);
    const label = String(index + 1);

    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));

    const labelW = Math.ceil(ctx.measureText(label).width) + 10;
    const labelH = Math.max(16, Math.min(h - 4, Math.floor(layout.cellH * 0.45)));
    const labelX = x + w / 2 - labelW / 2;
    const labelY = y + h / 2 - labelH / 2;

    ctx.fillStyle = "rgba(0, 0, 0, 0.78)";
    ctx.fillRect(labelX, labelY, labelW, labelH);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.strokeRect(labelX + 0.5, labelY + 0.5, labelW - 1, labelH - 1);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x + w / 2, y + h / 2 + 0.5);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
  }

  return {
    base64: canvas.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1],
    columns: layout.columns,
    rows: layout.rows,
    cropW: layout.width,
    cropH: layout.height,
  };
}
