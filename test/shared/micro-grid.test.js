import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  MICRO_GRID_COLUMNS,
  MICRO_GRID_ROWS,
  buildMicroGridPrompt,
  computeMicroGridLayout,
  gridNumberToPixel,
  parseGridNumberFromResponse,
} = require("../../src/shared/micro-grid.js");

describe("computeMicroGridLayout", () => {
  it("derives fixed-size cells from crop dimensions", () => {
    expect(computeMicroGridLayout(1000, 800)).toEqual({
      width: 1000,
      height: 800,
      columns: MICRO_GRID_COLUMNS,
      rows: MICRO_GRID_ROWS,
      cellW: 100,
      cellH: 100,
    });
  });
});

describe("gridNumberToPixel", () => {
  it("maps cell 1 to the top-left cell center", () => {
    expect(gridNumberToPixel(1, 1000, 800)).toEqual({
      x: 50,
      y: 50,
      gridNumber: 1,
      cell: { x: 0, y: 0, w: 100, h: 100 },
    });
  });

  it("maps the first cell of row 2 using row-major numbering", () => {
    expect(gridNumberToPixel(11, 1000, 800)).toEqual({
      x: 50,
      y: 150,
      gridNumber: 11,
      cell: { x: 0, y: 100, w: 100, h: 100 },
    });
  });

  it("uses the remaining width and height for edge cells", () => {
    const point = gridNumberToPixel(80, 1000, 800);

    expect(point).toEqual({
      x: 950,
      y: 750,
      gridNumber: 80,
      cell: { x: 900, y: 700, w: 100, h: 100 },
    });
  });

  it("returns null for out-of-range grid numbers", () => {
    expect(gridNumberToPixel(0, 1000, 800)).toBeNull();
    expect(gridNumberToPixel(81, 1000, 800)).toBeNull();
  });
});

describe("parseGridNumberFromResponse", () => {
  it("extracts the first integer from model text", () => {
    expect(parseGridNumberFromResponse("The answer is 42.")).toBe(42);
    expect(parseGridNumberFromResponse("42")).toBe(42);
  });

  it("returns null when no integer is present", () => {
    expect(parseGridNumberFromResponse("none")).toBeNull();
  });
});

describe("buildMicroGridPrompt", () => {
  it("asks for only the micro-grid number of the target element", () => {
    expect(buildMicroGridPrompt("Save button")).toBe(
      "Identify the micro-grid number of the Save button. Answer only with the number."
    );
  });
});
