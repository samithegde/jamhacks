import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  normalizeCompletedActions,
  formatCompletedStepsBlock,
  buildNavigationStepUserText,
  buildNavigationSystemAddon,
  buildRecipeBlock,
} = require("../../../src/main/ai/step-context.js");

describe("normalizeCompletedActions", () => {
  it("keeps valid entries with step numbers", () => {
    expect(
      normalizeCompletedActions([
        { stepNumber: 1, description: "Open Settings", action: "cursor" },
        { stepNumber: 2, description: "Click Display", action: "highlight" },
      ]),
    ).toEqual([
      { stepNumber: 1, description: "Open Settings", action: "cursor" },
      { stepNumber: 2, description: "Click Display", action: "highlight" },
    ]);
  });

  it("drops entries without descriptions and assigns fallback step numbers", () => {
    expect(
      normalizeCompletedActions([
        { description: "First step" },
        { stepNumber: 0, description: "   " },
        { label: "From label", action: "cursor" },
      ]),
    ).toEqual([
      { stepNumber: 1, description: "First step", action: "cursor" },
      { stepNumber: 3, description: "From label", action: "cursor" },
    ]);
  });

  it("returns empty array for non-array input", () => {
    expect(normalizeCompletedActions(null)).toEqual([]);
    expect(normalizeCompletedActions(undefined)).toEqual([]);
  });
});

describe("formatCompletedStepsBlock", () => {
  it("formats multiple steps in order", () => {
    expect(
      formatCompletedStepsBlock([
        { stepNumber: 1, description: "Click Settings gear", action: "cursor" },
        { stepNumber: 2, description: "Open Display panel", action: "highlight" },
      ]),
    ).toBe(
      "Steps completed so far:\n" +
        "1. [cursor] Click Settings gear\n" +
        "2. [highlight] Open Display panel",
    );
  });

  it("returns empty string when there are no steps", () => {
    expect(formatCompletedStepsBlock([])).toBe("");
    expect(formatCompletedStepsBlock([{ stepNumber: 1, description: "" }])).toBe("");
  });
});

describe("buildNavigationStepUserText", () => {
  it("includes goal, completed steps, last action, and next-step question", () => {
    const text = buildNavigationStepUserText({
      goal: "Enable dark mode",
      lastAction: "Open Display panel",
      completedActions: [
        { stepNumber: 1, description: "Click Settings gear", action: "cursor" },
        { stepNumber: 2, description: "Open Display panel", action: "cursor" },
      ],
    });

    expect(text).toContain("Original goal: Enable dark mode");
    expect(text).toContain("Steps completed so far:");
    expect(text).toContain("1. [cursor] Click Settings gear");
    expect(text).toContain("2. [cursor] Open Display panel");
    expect(text).toContain("Last action completed: Open Display panel");
    expect(text).toContain("What is the single next step?");
  });

  it("includes recipe block with source attribution when present", () => {
    const text = buildNavigationStepUserText({
      goal: "Submit expense report",
      lastAction: "Open form",
      completedActions: [{ stepNumber: 1, description: "Open form", action: "cursor" }],
      recipe: {
        needsOnScreenGuidance: true,
        chunks: [{ source: "https://example.com/hr", text: "Step 1: Open HR portal" }],
      },
    });

    expect(text).toContain("[EXTERNAL KNOWLEDGE]");
    expect(text).toContain("[Source: https://example.com/hr]");
    expect(text).toContain("Step 1: Open HR portal");
    expect(text).toContain("on-screen UI guidance");
    expect(text.indexOf("[EXTERNAL KNOWLEDGE]")).toBeLessThan(text.indexOf("Original goal:"));
  });
});

describe("buildNavigationSystemAddon", () => {
  it("adds navigation override when on-screen guidance is needed", () => {
    const addon = buildNavigationSystemAddon({ needsOnScreenGuidance: true });
    expect(addon).toContain("Return a non-empty plan");
    expect(addon).toContain("sources lack specific steps");
  });

  it("returns empty string when guidance is not needed", () => {
    expect(buildNavigationSystemAddon({ needsOnScreenGuidance: false })).toBe("");
    expect(buildNavigationSystemAddon(null)).toBe("");
  });
});

describe("buildRecipeBlock", () => {
  it("tells the model to guide via screenshot when excerpts are thin", () => {
    const block = buildRecipeBlock(
      {
        needsOnScreenGuidance: true,
        chunks: [{ source: "https://youtube.com/watch?v=abc", text: "Learn to make a cube in Onshape." }],
      },
      { mode: "navigation" },
    );

    expect(block).toContain("Do not claim the sources lack steps");
    expect(block).toContain("Learn to make a cube in Onshape.");
  });
});
