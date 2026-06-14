import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildImplementationMessages,
  WIDGET_IMPLEMENTATION_SYSTEM_PROMPT,
} = require("../../../src/main/ai/implement-widget.js");
const {
  buildInteractiveWidgetImplementationInstructions,
} = require("../../../src/main/ai/learning-widget-schema.js");

describe("implement-widget", () => {
  it("buildImplementationMessages includes Gemini widget instructions and user query", () => {
    const messages = buildImplementationMessages({
      designPlan: {
        objective: "Practice fractions",
        contentOutline: "Add two fractions",
        userFlow: ["Enter answer", "Check"],
        stateKeys: { answer: "string" },
        uiSections: ["prompt", "input", "submit"],
      },
      widgetType: "code-playground",
      title: "Fraction Playground",
      explanation: "To add fractions, find a common denominator and add the numerators.",
      spokenSummary: "Let's practice adding fractions together.",
      userPrompt: "Help me practice fractions",
      geminiPlanText: JSON.stringify({
        widgetType: "code-playground",
        widgetTitle: "Fraction Playground",
        designPlan: { objective: "Practice fractions", contentOutline: "Add two fractions" },
      }),
      recipe: {
        chunks: [{ text: "To add fractions, find a common denominator.", source: "notes" }],
        ragQuery: "fractions",
      },
    });

    expect(messages.systemPrompt).toContain(WIDGET_IMPLEMENTATION_SYSTEM_PROMPT.slice(0, 20));
    expect(messages.systemPrompt).toContain(
      buildInteractiveWidgetImplementationInstructions().slice(0, 30),
    );
    expect(messages.systemPrompt).toContain("common denominator");
    expect(messages.userPrompt).toContain("Help me practice fractions");
    expect(messages.userPrompt).toContain("common denominator");
    expect(messages.userPrompt).toContain("Fraction Playground");
    expect(messages.userPrompt).toContain("Practice fractions");
    expect(messages.userPrompt).toContain("[GEMINI WIDGET INSTRUCTIONS]");
    expect(messages.userPrompt).toContain("find a common denominator");
    expect(messages.userPrompt).toContain("Let's practice adding fractions together.");
    expect(messages.userPrompt).toContain("[GEMINI PLAN RESPONSE]");
    expect(messages.userPrompt).toContain("htmlLayout");
  });
});
