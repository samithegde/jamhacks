const {
  MICRO_GRID_COLUMNS,
  MICRO_GRID_ROWS,
  gridNumberToPixel,
} = require("../../shared/micro-grid");
const { identifyMicroGridNumber } = require("./ollama-vision");

async function refineWithMicroGrid({
  griddedBase64,
  cropW,
  cropH,
  targetElement,
  columns = MICRO_GRID_COLUMNS,
  rows = MICRO_GRID_ROWS,
} = {}) {
  if (!griddedBase64) {
    return null;
  }

  const gridNumber = await identifyMicroGridNumber({
    imageBase64: griddedBase64,
    targetElement,
  });

  if (!gridNumber) {
    return null;
  }

  const point = gridNumberToPixel(gridNumber, cropW, cropH, columns, rows);
  if (!point) {
    return null;
  }

  return {
    x: point.x,
    y: point.y,
    gridNumber: point.gridNumber,
    method: "ollama-micro-grid",
  };
}

module.exports = {
  refineWithMicroGrid,
};
