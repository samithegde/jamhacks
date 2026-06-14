import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { adaptGeminiToLearningWidget } = require("../../../src/main/ai/adapt-widget.js");

describe("adaptGeminiToLearningWidget", () => {
  it("extracts diagramCode from Gemini tutor replies", () => {
    expect(
      adaptGeminiToLearningWidget({
        explanation:
          "The Krebs cycle repeats in the mitochondria.\n\n```mermaid\ngraph TD\n  A-->B\n```",
        plan: [
          {
            action: "highlight",
            bbox: [50, 60, 150, 260],
            description: "Mitochondria label",
          },
        ],
      }),
    ).toEqual({
      widgetType: "classic",
      explanation: "The Krebs cycle repeats in the mitochondria.",
      diagramCode: "graph TD\n  A-->B",
    });
  });
});
