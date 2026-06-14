import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  parseLearningWidget,
  extractDiagramFromExplanation,
  isInteractiveWidget,
} = require("../../../src/main/ai/learning-widget-schema.js");

describe("learning-widget-schema", () => {
  it("parses a valid learning widget", () => {
    expect(
      parseLearningWidget({
        explanation: "Photosynthesis converts light into chemical energy.",
        diagramCode: "graph TD\n  A[Light] --> B[Chloroplast]",
      }),
    ).toEqual({
      widgetType: "classic",
      explanation: "Photosynthesis converts light into chemical energy.",
      diagramCode: "graph TD\n  A[Light] --> B[Chloroplast]",
      widgetSummary: "",
    });
  });

  it("defaults diagramCode", () => {
    expect(
      parseLearningWidget({
        explanation: "Only text.",
      }),
    ).toEqual({
      widgetType: "classic",
      explanation: "Only text.",
      diagramCode: "",
      widgetSummary: "",
    });
  });

  it("parses classic widget with explicit widgetType", () => {
    const result = parseLearningWidget({
      widgetType: "classic",
      explanation: "Explicit classic.",
    });
    expect(result.widgetType).toBe("classic");
    expect(result.explanation).toBe("Explicit classic.");
  });

  it("extracts mermaid blocks from explanation", () => {
    expect(
      extractDiagramFromExplanation(
        "Here is the cycle.\n\n```mermaid\ngraph LR\n  A-->B\n```\n\nAny questions?",
      ),
    ).toEqual({
      diagramCode: "graph LR\n  A-->B",
      explanation: "Here is the cycle.\n\nAny questions?",
    });
  });

  // --- Interactive widget tests ---

  const validQuiz = {
    widgetType: "interactive-quiz",
    title: "Quick Quiz",
    htmlLayout: '<div><p data-state-key="score">0</p><button id="btn">Answer</button></div>',
    initialState: { score: 0 },
    interactions: [
      {
        elementSelector: "#btn",
        eventType: "click",
        mutationLogic: "state.score += 1;",
      },
    ],
    stateBindings: [
      { stateKey: "score", selector: "[data-state-key='score']", attr: "textContent" },
    ],
  };

  it("parses a valid interactive-quiz widget", () => {
    const result = parseLearningWidget(validQuiz);
    expect(result.widgetType).toBe("interactive-quiz");
    expect(result.title).toBe("Quick Quiz");
    expect(result.interactions).toHaveLength(1);
    expect(result.stateBindings).toHaveLength(1);
  });

  it("parses a valid code-playground widget", () => {
    const result = parseLearningWidget({
      ...validQuiz,
      widgetType: "code-playground",
      title: "Playground",
    });
    expect(result.widgetType).toBe("code-playground");
  });

  it("parses a valid concept-graph widget", () => {
    const result = parseLearningWidget({
      ...validQuiz,
      widgetType: "concept-graph",
      title: "Graph",
    });
    expect(result.widgetType).toBe("concept-graph");
  });

  it("rejects interactive widget with <script> in htmlLayout", () => {
    expect(() =>
      parseLearningWidget({
        ...validQuiz,
        htmlLayout: '<script>alert(1)</script><div></div>',
      }),
    ).toThrow(/script/i);
  });

  it("rejects interactive widget with inline event handler in htmlLayout", () => {
    expect(() =>
      parseLearningWidget({
        ...validQuiz,
        htmlLayout: '<div onclick="evil()">hi</div>',
      }),
    ).toThrow(/event handler/i);
  });

  it("rejects interactive widget with javascript: URL in htmlLayout", () => {
    expect(() =>
      parseLearningWidget({
        ...validQuiz,
        htmlLayout: '<a href="javascript:void(0)">link</a>',
      }),
    ).toThrow(/javascript:/i);
  });

  it("rejects scopedCss with @import", () => {
    expect(() =>
      parseLearningWidget({
        ...validQuiz,
        scopedCss: "@import url('evil.css');",
      }),
    ).toThrow(/@import/i);
  });

  it("rejects scopedCss with external url()", () => {
    expect(() =>
      parseLearningWidget({
        ...validQuiz,
        scopedCss: "div { background: url(https://evil.com/x.png); }",
      }),
    ).toThrow(/external url/i);
  });

  it("rejects interaction with forbidden selector :root", () => {
    expect(() =>
      parseLearningWidget({
        ...validQuiz,
        interactions: [{ elementSelector: ":root", eventType: "click", mutationLogic: "" }],
      }),
    ).toThrow(/Forbidden.*selector/i);
  });

  it("rejects interaction with /deep/ combinator in selector", () => {
    expect(() =>
      parseLearningWidget({
        ...validQuiz,
        interactions: [
          { elementSelector: "div /deep/ span", eventType: "click", mutationLogic: "" },
        ],
      }),
    ).toThrow(/Forbidden.*selector/i);
  });

  it("rejects mutationLogic with forbidden keyword 'window'", () => {
    expect(() =>
      parseLearningWidget({
        ...validQuiz,
        interactions: [
          { elementSelector: "#btn", eventType: "click", mutationLogic: "window.alert(1);" },
        ],
      }),
    ).toThrow(/forbidden keyword/i);
  });

  it("rejects mutationLogic with forbidden keyword 'fetch'", () => {
    expect(() =>
      parseLearningWidget({
        ...validQuiz,
        interactions: [
          { elementSelector: "#btn", eventType: "click", mutationLogic: "fetch('/api');" },
        ],
      }),
    ).toThrow(/forbidden keyword/i);
  });

  // --- isInteractiveWidget helper ---

  it("isInteractiveWidget returns true for interactive-quiz", () => {
    expect(isInteractiveWidget({ widgetType: "interactive-quiz" })).toBe(true);
  });

  it("isInteractiveWidget returns true for code-playground", () => {
    expect(isInteractiveWidget({ widgetType: "code-playground" })).toBe(true);
  });

  it("isInteractiveWidget returns false for classic", () => {
    expect(isInteractiveWidget({ widgetType: "classic" })).toBe(false);
  });

  it("isInteractiveWidget returns false for missing widgetType", () => {
    expect(isInteractiveWidget({ explanation: "hi" })).toBe(false);
  });

  it("isInteractiveWidget returns false for null", () => {
    expect(isInteractiveWidget(null)).toBe(false);
  });

  it("userWantsInteractiveWidget detects quiz and practice prompts", () => {
    const {
      userWantsInteractiveWidget,
      resolveOllamaLearningWidgetPlanSchema,
      parseLearningWidget,
      parseLearningWidgetPlan,
      mergeInteractiveWidget,
      buildClassicFallbackFromPlan,
      isInteractiveWidgetPlan,
      normalizeGeminiInteractiveWidget,
    } = require("../../../src/main/ai/learning-widget-schema.js");

    expect(userWantsInteractiveWidget("Give me a quiz on photosynthesis")).toBe(true);
    expect(userWantsInteractiveWidget("can you test me on the periodic table")).toBe(true);
    expect(userWantsInteractiveWidget("Explain photosynthesis")).toBe(false);

    expect(resolveOllamaLearningWidgetPlanSchema().required).toEqual(["widgetType"]);

    const normalized = normalizeGeminiInteractiveWidget({
      widgetTitle: "Counter",
      htmlLayout: '<button data-action="increment">+</button>',
      scopedCss: ".btn { padding: 8px; }",
      initialState: { count: 0 },
      mutationLogic: "if (action === 'increment') state.count += 1;",
    });
    expect(parseLearningWidget(normalized).title).toBe("Counter");
    expect(parseLearningWidget(normalized).mutationLogic).toContain("increment");
  });

  it("parses interactive widget plan without blueprint fields", () => {
    const { parseLearningWidgetPlan, isInteractiveWidgetPlan } = require(
      "../../../src/main/ai/learning-widget-schema.js",
    );

    const plan = parseLearningWidgetPlan({
      widgetType: "interactive-quiz",
      widgetTitle: "Photosynthesis Quiz",
      explanation:
        "Photosynthesis converts light energy into chemical energy stored in glucose.",
      designPlan: {
        objective: "Test understanding of photosynthesis",
        userFlow: ["Read question", "Select answer", "See feedback"],
        stateKeys: { score: "number", questionIndex: "number" },
        uiSections: ["header", "question", "choices", "feedback"],
        contentOutline: "3 multiple-choice questions about chloroplasts and light reactions.",
        fallbackExplanation: "Here is a spoken summary about photosynthesis.",
      },
    });

    expect(plan.widgetType).toBe("interactive-quiz");
    expect(plan.title).toBe("Photosynthesis Quiz");
    expect(plan.explanation).toContain("Photosynthesis");
    expect(plan.designPlan.objective).toContain("photosynthesis");
    expect(isInteractiveWidgetPlan(plan)).toBe(true);
  });

  it("coerces interactive plan from explanation-only Gemini payload", () => {
    const { parseLearningWidgetPlan, isInteractiveWidgetPlan } = require(
      "../../../src/main/ai/learning-widget-schema.js",
    );

    const plan = parseLearningWidgetPlan({
      widgetType: "interactive-quiz",
      widgetTitle: "Periodic Table Quiz",
      explanation: "Question 1: Which block contains alkali metals?",
    });

    expect(plan.widgetType).toBe("interactive-quiz");
    expect(plan.designPlan.contentOutline).toContain("alkali metals");
    expect(isInteractiveWidgetPlan(plan)).toBe(true);
  });

  it("parses Gemini blueprint payloads without a design plan", () => {
    const { parseLearningWidgetPlan } = require("../../../src/main/ai/learning-widget-schema.js");

    const widget = parseLearningWidgetPlan({
      widgetType: "interactive-quiz",
      widgetTitle: "Counter",
      htmlLayout: '<button data-action="increment">+</button>',
      scopedCss: ".btn { padding: 8px; }",
      initialState: { count: 0 },
      mutationLogic: "if (action === 'increment') state.count += 1;",
    });

    expect(widget.htmlLayout).toContain("data-action");
    expect(widget.mutationLogic).toContain("increment");
  });

  it("mergeInteractiveWidget combines plan and implementation", () => {
    const { mergeInteractiveWidget } = require("../../../src/main/ai/learning-widget-schema.js");

    const merged = mergeInteractiveWidget(
      {
        widgetType: "interactive-quiz",
        title: "Quiz",
        explanation: "Full lesson on fractions before the practice widget.",
        designPlan: { objective: "Practice", contentOutline: "Q1" },
      },
      {
        widgetTitle: "Quiz",
        htmlLayout: '<button data-action="next">Next</button>',
        scopedCss: ".btn { padding: 8px; }",
        initialState: { step: 0 },
        mutationLogic: "if (action === 'next') state.step += 1;",
      },
    );

    expect(merged.title).toBe("Quiz");
    expect(merged.explanation).toContain("fractions");
    expect(merged.htmlLayout).toContain("data-action");
    expect(merged.mutationLogic).toContain("next");
  });

  it("buildClassicFallbackFromPlan uses fallbackExplanation", () => {
    const { buildClassicFallbackFromPlan } = require(
      "../../../src/main/ai/learning-widget-schema.js",
    );

    expect(
      buildClassicFallbackFromPlan({
        title: "Quiz",
        designPlan: { fallbackExplanation: "Spoken fallback." },
      }),
    ).toEqual({
      widgetType: "classic",
      explanation: "Spoken fallback.",
      diagramCode: "",
    });
  });

  it("parses unified learning schema interactive payload with widgetTitle", () => {
    const result = parseLearningWidget({
      widgetType: "interactive-quiz",
      widgetTitle: "Water Cycle Quiz",
      htmlLayout: '<button data-action="next">Next</button>',
      scopedCss: ".btn { padding: 8px; }",
      initialState: { step: 0 },
      mutationLogic: "if (action === 'next') state.step += 1;",
    });
    expect(result.widgetType).toBe("interactive-quiz");
    expect(result.title).toBe("Water Cycle Quiz");
    expect(result.mutationLogic).toContain("next");
  });

  it("INTERACTIVE_WIDGET_JSON_SCHEMA matches the five-field interactive contract", () => {
    const { INTERACTIVE_WIDGET_JSON_SCHEMA } = require("../../../src/main/ai/learning-widget-schema.js");

    expect(INTERACTIVE_WIDGET_JSON_SCHEMA.required).toEqual([
      "widgetTitle",
      "htmlLayout",
      "scopedCss",
      "initialState",
      "mutationLogic",
    ]);
    expect(INTERACTIVE_WIDGET_JSON_SCHEMA.properties.mutationLogic.description).toContain(
      "evaluating state changes",
    );
  });
});
