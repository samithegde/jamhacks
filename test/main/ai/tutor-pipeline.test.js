import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

const interactivePlan = {
  widgetType: "interactive-quiz",
  title: "Quiz",
  explanation: "Let's check your understanding with a quick practice quiz.",
  designPlan: {
    objective: "Practice",
    contentOutline: "One question",
    fallbackExplanation: "Fallback spoken text.",
  },
};

const implementation = {
  widgetTitle: "Quiz",
  htmlLayout: '<button data-action="next">Next</button>',
  scopedCss: ".btn {}",
  initialState: { step: 0 },
  mutationLogic: "if (action === 'next') state.step += 1;",
};

describe("tutor pipeline", () => {
  let tutor;
  let gemini;
  let groq;
  let ollama;

  beforeEach(() => {
    tutor = require("../../../src/main/ai/tutor.js");
    gemini = require("../../../src/main/gemini/service.js");
    groq = require("../../../src/main/groq/service.js");
    ollama = require("../../../src/main/ollama/service.js");

    vi.spyOn(gemini, "generateLearningWidget");
    vi.spyOn(groq, "isConfigured");
    vi.spyOn(groq, "implementInteractiveWidget");
    vi.spyOn(ollama, "implementInteractiveWidget");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns classic widget from single Gemini call", async () => {
    gemini.generateLearningWidget.mockResolvedValue({
      object: {
        widgetType: "classic",
        explanation: "Hello",
        diagramCode: "",
      },
      model: "gemini-2.5-flash",
      retrieval: null,
    });

    const result = await tutor.generateLearningWidget({
      userPrompt: "Explain hello",
      history: [{ sender: "user", text: "Explain hello" }],
      useGemini: true,
    });

    expect(result.widget.widgetType).toBe("classic");
    expect(result.widget.explanation).toBe("Hello");
    expect(gemini.generateLearningWidget).toHaveBeenCalledOnce();
    expect(groq.implementInteractiveWidget).not.toHaveBeenCalled();
  });

  it("runs Gemini plan then Groq implementation for interactive widgets", async () => {
    gemini.generateLearningWidget.mockResolvedValue({
      object: {
        widgetType: "interactive-quiz",
        widgetTitle: "Quiz",
        explanation: interactivePlan.explanation,
        designPlan: interactivePlan.designPlan,
      },
      model: "gemini-2.5-flash",
      retrieval: null,
    });
    groq.isConfigured.mockReturnValue(true);
    groq.implementInteractiveWidget.mockResolvedValue({
      object: implementation,
      model: "llama-3.3-70b-versatile",
    });

    const result = await tutor.generateLearningWidget({
      userPrompt: "Quiz me",
      history: [{ sender: "user", text: "Quiz me" }],
      useGemini: true,
    });

    expect(result.widget.widgetType).toBe("interactive-quiz");
    expect(result.widget.htmlLayout).toContain("data-action");
    expect(result.widget.explanation).toContain("practice quiz");
    expect(result.implProvider).toBe("groq");
    expect(result.model).toContain("gemini-2.5-flash");
    expect(groq.implementInteractiveWidget).toHaveBeenCalledOnce();
    expect(groq.implementInteractiveWidget).toHaveBeenCalledWith(
      expect.objectContaining({
        spokenSummary: undefined,
        geminiPlanText: undefined,
      }),
    );
    expect(ollama.implementInteractiveWidget).not.toHaveBeenCalled();
  });

  it("forwards Gemini plan text and spokenSummary to Groq", async () => {
    gemini.generateLearningWidget.mockResolvedValue({
      object: {
        widgetType: "interactive-quiz",
        widgetTitle: "Quiz",
        explanation: "Here is a full lesson before the quiz widget.",
        spokenSummary: "Time for a quick quiz!",
        designPlan: interactivePlan.designPlan,
      },
      model: "gemini-2.5-flash",
      retrieval: null,
      text: JSON.stringify({
        widgetType: "interactive-quiz",
        widgetTitle: "Quiz",
        explanation: "Here is a full lesson before the quiz widget.",
        spokenSummary: "Time for a quick quiz!",
        designPlan: interactivePlan.designPlan,
      }),
    });
    groq.isConfigured.mockReturnValue(true);
    groq.implementInteractiveWidget.mockResolvedValue({
      object: implementation,
      model: "llama-3.3-70b-versatile",
    });

    await tutor.generateLearningWidget({
      userPrompt: "Quiz me",
      history: [{ sender: "user", text: "Quiz me" }],
      useGemini: true,
    });

    expect(groq.implementInteractiveWidget).toHaveBeenCalledWith(
      expect.objectContaining({
        explanation: "Here is a full lesson before the quiz widget.",
        spokenSummary: "Time for a quick quiz!",
        geminiPlanText: expect.stringContaining("full lesson"),
      }),
    );
  });

  it("skips Groq when Gemini already returned a blueprint", async () => {
    gemini.generateLearningWidget.mockResolvedValue({
      object: {
        widgetType: "interactive-quiz",
        widgetTitle: "Quiz",
        htmlLayout: '<button data-action="next">Next</button>',
        scopedCss: ".btn {}",
        initialState: { step: 0 },
        mutationLogic: "if (action === 'next') state.step += 1;",
      },
      model: "gemini-2.5-flash",
      retrieval: null,
    });
    groq.isConfigured.mockReturnValue(true);

    const result = await tutor.generateLearningWidget({
      userPrompt: "Quiz me",
      history: [{ sender: "user", text: "Quiz me" }],
      useGemini: true,
    });

    expect(result.widget.widgetType).toBe("interactive-quiz");
    expect(result.widget.htmlLayout).toContain("data-action");
    expect(result.implProvider).toBe("gemini");
    expect(groq.implementInteractiveWidget).not.toHaveBeenCalled();
  });

  it("degrades to classic when Groq is not configured", async () => {
    gemini.generateLearningWidget.mockResolvedValue({
      object: {
        widgetType: "interactive-quiz",
        widgetTitle: "Quiz",
        explanation: interactivePlan.explanation,
        designPlan: interactivePlan.designPlan,
      },
      model: "gemini-2.5-flash",
      retrieval: null,
    });
    groq.isConfigured.mockReturnValue(false);

    const result = await tutor.generateLearningWidget({
      userPrompt: "Quiz me",
      history: [{ sender: "user", text: "Quiz me" }],
      useGemini: true,
    });

    expect(result.widget.widgetType).toBe("classic");
    expect(result.widget.explanation).toBe(interactivePlan.explanation);
    expect(result.degraded).toBe(true);
    expect(groq.implementInteractiveWidget).not.toHaveBeenCalled();
  });

  it("degrades to classic when Groq implementation fails", async () => {
    gemini.generateLearningWidget.mockResolvedValue({
      object: {
        widgetType: "interactive-quiz",
        widgetTitle: "Quiz",
        explanation: interactivePlan.explanation,
        designPlan: interactivePlan.designPlan,
      },
      model: "gemini-2.5-flash",
      retrieval: null,
    });
    groq.isConfigured.mockReturnValue(true);
    groq.implementInteractiveWidget.mockRejectedValue(new Error("Groq down"));

    const result = await tutor.generateLearningWidget({
      userPrompt: "Quiz me",
      history: [{ sender: "user", text: "Quiz me" }],
      useGemini: true,
    });

    expect(result.widget.widgetType).toBe("classic");
    expect(result.widget.explanation).toBe(interactivePlan.explanation);
    expect(result.degraded).toBe(true);
    expect(ollama.implementInteractiveWidget).not.toHaveBeenCalled();
  });

  it("throws when Gemini is disabled in tutor mode", async () => {
    await expect(
      tutor.generateLearningWidget({
        userPrompt: "Quiz me",
        history: [{ sender: "user", text: "Quiz me" }],
        useGemini: false,
      }),
    ).rejects.toThrow(/requires Gemini/);
  });

  it("adds interactive preference hint for quiz prompts", () => {
    const prompt = tutor.buildTutorWidgetSystemPrompt("Give me a quiz on cells");
    expect(prompt).toContain("prefer an interactive widgetType");
  });
});
