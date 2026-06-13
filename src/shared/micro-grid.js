const MICRO_GRID_COLUMNS = 10;
const MICRO_GRID_ROWS = 8;

function computeMicroGridLayout(width, height, columns = MICRO_GRID_COLUMNS, rows = MICRO_GRID_ROWS) {
  const w = Math.max(1, Math.round(Number(width)));
  const h = Math.max(1, Math.round(Number(height)));
  const cols = Math.max(1, Math.round(Number(columns)));
  const rowCount = Math.max(1, Math.round(Number(rows)));

  const cellW = Math.floor(w / cols);
  const cellH = Math.floor(h / rowCount);

  return {
    width: w,
    height: h,
    columns: cols,
    rows: rowCount,
    cellW,
    cellH,
  };
}

function gridNumberToPixel(gridNumber, width, height, columns = MICRO_GRID_COLUMNS, rows = MICRO_GRID_ROWS) {
  const layout = computeMicroGridLayout(width, height, columns, rows);
  const number = Math.round(Number(gridNumber));
  const index = number - 1;

  if (!Number.isFinite(number) || index < 0 || index >= layout.columns * layout.rows) {
    return null;
  }

  const col = index % layout.columns;
  const row = Math.floor(index / layout.columns);
  const x0 = col * layout.cellW;
  const y0 = row * layout.cellH;
  const cellW =
    col === layout.columns - 1 ? layout.width - x0 : layout.cellW;
  const cellH =
    row === layout.rows - 1 ? layout.height - y0 : layout.cellH;

  return {
    x: Math.round(x0 + cellW / 2),
    y: Math.round(y0 + cellH / 2),
    gridNumber: number,
    cell: { x: x0, y: y0, w: cellW, h: cellH },
  };
}

function parseGridNumberFromResponse(text) {
  const match = String(text ?? "").match(/\b(\d{1,3})\b/);
  if (!match) return null;

  const number = Number.parseInt(match[1], 10);
  return Number.isFinite(number) ? number : null;
}

function buildMicroGridPrompt(targetElement) {
  const target = String(targetElement ?? "").trim() || "target element";
  return `Identify the micro-grid number of the ${target}. Answer only with the number.`;
}

module.exports = {
  MICRO_GRID_COLUMNS,
  MICRO_GRID_ROWS,
  computeMicroGridLayout,
  gridNumberToPixel,
  parseGridNumberFromResponse,
  buildMicroGridPrompt,
};
